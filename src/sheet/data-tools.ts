// Excel's tools for cleaning and arranging data, on a sheet: Find and Replace, Go To Special,
// the Series window, Paste Special, Text to Columns, Remove Duplicates and Advanced Filter.
// Flash Fill has a file of its own (flash-fill.ts). Each change here is made inside the caller's
// Workbook.edit, so it is one step to undo.

import type { Sheet, Cell, CellBlock, CellStyle } from './workbook';
import { valueInput } from './workbook';
import { Range, keyOf, rowOf, colOf, inRange, MAX_ROWS, MAX_COLS } from './refs';
import { shiftFormula, transposeFormula, formulaRefs, type RefToken } from './formula';
import { Value, isError, readTyped, compareValues, sigFigs15, CellError } from './values';
import { serialToDate } from './numfmt';
import { copyNote } from './notes';

// ---------------------------------------------------------------- areas

/** Cells (by key) as few blocks as is quick to find: runs along each row, joined down when they line up. */
export function cellsToAreas(keys: number[]): Range[] {
  const sorted = [...new Set(keys)].sort((a, b) => a - b);
  const runs: Range[] = [];
  for (const k of sorted) {
    const r = rowOf(k), c = colOf(k);
    const last = runs[runs.length - 1];
    if (last && last.r1 === r && last.c2 === c - 1) last.c2 = c;
    else runs.push({ r1: r, c1: c, r2: r, c2: c });
  }
  // a run under one of the same width in the row above joins it
  const open = new Map<string, Range>();
  const out: Range[] = [];
  for (const run of runs) {
    const id = `${run.c1}:${run.c2}`;
    const above = open.get(id);
    if (above && above.r2 === run.r1 - 1) { above.r2 = run.r1; continue; }
    open.set(id, run);
    out.push(run);
  }
  return out;
}

/** Every cell of some blocks, in reading order, without repeats. */
export function* areaCells(areas: Range[]): Generator<{ r: number; c: number }> {
  const seen = new Set<number>();
  for (const a of areas) {
    for (let r = a.r1; r <= a.r2; r++) {
      for (let c = a.c1; c <= a.c2; c++) {
        const k = keyOf(r, c);
        if (seen.has(k)) continue;
        seen.add(k);
        yield { r, c };
      }
    }
  }
}

const isSingle = (R: Range) => R.r1 === R.r2 && R.c1 === R.c2;

/** Where a search or Go To Special looks: the selection, or the sheet's used cells when one cell is selected. */
export function searchArea(s: Sheet, sel: Range): Range | null {
  if (!isSingle(sel)) return s.clip(sel);
  const last = Math.max(s.lastRow, s.lastDataRow);
  return last < 0 ? null : { r1: 0, c1: 0, r2: last, c2: Math.max(0, s.lastCol) };
}

// ---------------------------------------------------------------- find and replace

export interface FindOptions {
  text: string;
  matchCase?: boolean;
  /** Match entire cell contents. */
  whole?: boolean;
  /** Formulas: what was typed (a formula's text); values: what the cell shows; notes: the text of notes and comments. */
  lookIn?: 'formulas' | 'values' | 'notes';
  /** Search down each column in turn, rather than along each row. */
  byColumns?: boolean;
}

/**
 * The words looked for as a pattern, with Excel's wildcards: ? any one character, * any run of
 * them, and ~ before either (or before ~) for the character itself.
 */
export function findPattern(o: FindOptions, global = false): RegExp {
  let src = '';
  const t = o.text;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (ch === '~' && i + 1 < t.length && '*?~'.includes(t[i + 1])) { src += '\\' + t[++i]; continue; }
    if (ch === '*') src += '[\\s\\S]*?';
    else if (ch === '?') src += '[\\s\\S]';
    else src += ch.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  if (o.whole) src = `^${src}$`;
  return new RegExp(src, `${o.matchCase ? '' : 'i'}${global ? 'g' : ''}u`);
}

/** The text a cell is searched in, by Look In. */
export function searchedText(s: Sheet, r: number, c: number, lookIn: FindOptions['lookIn'] = 'formulas'): string | null {
  if (lookIn === 'notes') {
    const n = s.noteAt(r, c);
    if (!n) return null;
    return [n.text, ...(n.replies ?? []).map((x) => x.text)].join('\n');
  }
  const cell = s.cell(r, c);
  const input = s.effectiveInput(r, c);
  const v = s.values.get(keyOf(r, c));
  if (!input && !cell?.structure && (v === undefined || v === null)) return null;
  if (lookIn === 'formulas' && input) return input;
  return s.shownText(r, c);
}

/** The cells that hold the words looked for, in the order Find Next visits them. */
export function findCells(s: Sheet, o: FindOptions, within: Range | null = null): { r: number; c: number }[] {
  if (!o.text) return [];
  const re = findPattern(o);
  const keys = new Set<number>(o.lookIn === 'notes' ? s.notes.keys() : [...s.cells.keys(), ...s.values.keys()]);
  // property columns' cells that are worked out are in values; a filter or chart doesn't matter here
  const hits: { r: number; c: number }[] = [];
  for (const k of keys) {
    const r = rowOf(k), c = colOf(k);
    if (within && !inRange(within, r, c)) continue;
    const m = s.mergeAt(r, c);
    if (m && (m.r1 !== r || m.c1 !== c)) continue;
    const text = searchedText(s, r, c, o.lookIn);
    if (text !== null && re.test(text)) hits.push({ r, c });
  }
  return hits.sort(o.byColumns ? (a, b) => a.c - b.c || a.r - b.r : (a, b) => a.r - b.r || a.c - b.c);
}

/** Text with the words looked for replaced (all of them, or the whole text with Match Entire Cell Contents). */
export function replaceIn(text: string, o: FindOptions, by: string): string {
  if (o.whole) return findPattern(o).test(text) ? by : text;
  // the replacement is taken as it is ($ has no special meaning)
  return text.replace(findPattern(o, true), () => by);
}

/**
 * Replace in one cell: what was typed (a formula's text, or a constant) changes, as Excel's
 * Replace does. Structures and cells worked out by a property column are left alone. True when
 * the cell changed.
 */
export function replaceCell(s: Sheet, r: number, c: number, o: FindOptions, by: string): boolean {
  const cell = s.cell(r, c);
  if (!cell?.input || cell.structure) return false;
  if (!findPattern(o).test(cell.input)) return false;
  const next = replaceIn(cell.input, o, by);
  if (next === cell.input) return false;
  s.setInput(r, c, next);
  return true;
}

// ---------------------------------------------------------------- go to special

export type ValueTypes = { numbers?: boolean; text?: boolean; logicals?: boolean; errors?: boolean };

export type SpecialKind =
  | 'notes' | 'constants' | 'formulas' | 'blanks' | 'region' | 'lastcell' | 'visible'
  | 'rowdiff' | 'coldiff' | 'precedents' | 'dependents' | 'condformats' | 'validation' | 'structures';

export interface SpecialOptions {
  kind: SpecialKind;
  /** Constants and formulas: which kinds of value. */
  types?: ValueTypes;
  /** Precedents and dependents: every level, not only the cells named directly. */
  allLevels?: boolean;
  /** Conditional formats and data validation: only cells with the same rules as the active cell. */
  same?: boolean;
}

const ofType = (v: Value | undefined, t: ValueTypes): boolean =>
  v instanceof CellError ? !!t.errors : typeof v === 'number' ? !!t.numbers : typeof v === 'boolean' ? !!t.logicals : typeof v === 'string' ? !!t.text : false;

/** The block a reference covers on a sheet (whole columns reach down to the last row in use). */
function refRange(ref: RefToken, s: Sheet): Range {
  if (ref.kind === 'cols') return { r1: 0, c1: Math.min(ref.a.col, ref.b!.col), r2: Math.max(0, s.lastRow, s.lastDataRow), c2: Math.max(ref.a.col, ref.b!.col) };
  const b = ref.b ?? ref.a;
  return { r1: Math.min(ref.a.row, b.row), c1: Math.min(ref.a.col, b.col), r2: Math.max(ref.a.row, b.row), c2: Math.max(ref.a.col, b.col) };
}

/** The references of a cell's formula that point at this sheet (its own sheet, or named by it). */
function sameSheetRefs(s: Sheet, r: number, c: number): Range[] {
  const f = s.formulas.get(keyOf(r, c)) ?? s.effectiveInput(r, c);
  if (!f?.startsWith('=')) return [];
  return formulaRefs(f).filter((x) => !x.broken && (!x.sheet || x.sheet.toLowerCase() === s.name.toLowerCase())).map((x) => refRange(x, s));
}

/**
 * Go To Special: the cells of a kind, as blocks. It looks within the selection, or the whole
 * sheet when one cell is selected. Null when there are none.
 */
export function goToSpecial(s: Sheet, sel: Range, active: { r: number; c: number }, o: SpecialOptions): Range[] | null {
  const area = searchArea(s, sel);
  const keys: number[] = [];
  const each = (fn: (r: number, c: number) => boolean) => {
    if (!area) return;
    // only the cells in use, unless the area is small enough to walk
    const span = (area.r2 - area.r1 + 1) * (area.c2 - area.c1 + 1);
    if (span <= 200000) {
      for (let r = area.r1; r <= area.r2; r++) for (let c = area.c1; c <= area.c2; c++) if (fn(r, c)) keys.push(keyOf(r, c));
    } else {
      for (const k of new Set([...s.cells.keys(), ...s.values.keys()])) if (inRange(area, rowOf(k), colOf(k)) && fn(rowOf(k), colOf(k))) keys.push(k);
    }
  };
  const types = o.types ?? { numbers: true, text: true, logicals: true, errors: true };
  switch (o.kind) {
    case 'notes':
      for (const k of s.notes.keys()) if (!area || isSingle(sel) || inRange(area, rowOf(k), colOf(k))) keys.push(k);
      break;
    case 'constants':
      each((r, c) => { const cell = s.cell(r, c); return !!cell?.input && !cell.input.startsWith('=') && !s.defAt(r, c) && ofType(s.values.get(keyOf(r, c)), types); });
      break;
    case 'formulas':
      each((r, c) => s.formulas.has(keyOf(r, c)) && ofType(s.values.get(keyOf(r, c)), types));
      break;
    case 'structures':
      each((r, c) => !!s.cell(r, c)?.structure);
      break;
    case 'blanks': {
      // as Excel: empty cells up to the last cell in use (not the endless rows below)
      const R = isSingle(sel) ? area : s.clip(sel);
      if (R) for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
        const v = s.values.get(keyOf(r, c));
        const m = s.mergeAt(r, c);
        if (m && (m.r1 !== r || m.c1 !== c)) continue;
        if ((v === undefined || v === null || v === '') && !s.cell(r, c)?.structure && !s.cell(r, c)?.input) keys.push(keyOf(r, c));
      }
      break;
    }
    case 'region':
      return [s.currentRegion(active.r, active.c)];
    case 'lastcell': {
      const r = Math.max(s.lastRow, s.lastDataRow), c = s.lastCol;
      return r < 0 || c < 0 ? null : [{ r1: r, c1: c, r2: r, c2: c }];
    }
    case 'visible': {
      const R = isSingle(sel) ? area : sel;
      if (!R) return null;
      const out: Range[] = [];
      // runs of shown rows, each split at hidden columns
      const colRuns: [number, number][] = [];
      for (let c = R.c1; c <= Math.min(R.c2, Math.max(s.lastCol + 1, R.c1 + 200)); c++) {
        if (s.hiddenCols.has(c)) continue;
        const last = colRuns[colRuns.length - 1];
        if (last && last[1] === c - 1) last[1] = c; else colRuns.push([c, c]);
      }
      if (R.c2 > s.lastCol + 1 && R.c2 - R.c1 > 200 && colRuns.length) colRuns[colRuns.length - 1][1] = R.c2;
      let r = R.r1;
      const rEnd = Math.min(R.r2, Math.max(s.lastRow, s.lastDataRow) + 1, MAX_ROWS - 1);
      while (r <= rEnd) {
        while (r <= rEnd && s.hiddenRows.has(r)) r++;
        if (r > rEnd) break;
        const start = r;
        while (r + 1 <= rEnd && !s.hiddenRows.has(r + 1)) r++;
        const end = r === rEnd && R.r2 > rEnd ? R.r2 : r;
        for (const [c1, c2] of colRuns) out.push({ r1: start, c1, r2: end, c2 });
        r++;
      }
      return out.length ? out : null;
    }
    case 'rowdiff': case 'coldiff': {
      // each row (column) compared with the cell in the active cell's column (row)
      const R = s.clip(sel) ?? sel;
      const byRow = o.kind === 'rowdiff';
      const comparison = (r: number, c: number) => (byRow ? [r, active.c] : [active.r, c]);
      const look = (r: number, c: number): string => {
        const input = s.effectiveInput(r, c);
        // formulas compare by what they work out relative to their cell (=A2*2 and =A3*2 are alike)
        if (input?.startsWith('=')) return 'f' + shiftFormula(input, -r, -c);
        const v = s.values.get(keyOf(r, c));
        return s.cell(r, c)?.structure ? 's' + String(v) : 'v' + (v === undefined || v === null ? '' : typeof v === 'string' ? v.toLowerCase() : String(v));
      };
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) {
        const [cr, cc] = comparison(r, c);
        if ((r !== cr || c !== cc) && look(r, c) !== look(cr, cc)) keys.push(keyOf(r, c));
      }
      break;
    }
    case 'precedents': {
      const R = s.clip(sel) ?? sel;
      const seen = new Set<number>();
      let frontier: number[] = [];
      for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) frontier.push(keyOf(r, c));
      while (frontier.length) {
        const next: number[] = [];
        for (const k of frontier) {
          for (const ref of sameSheetRefs(s, rowOf(k), colOf(k))) {
            const clip = s.clip(ref) ?? ref;
            for (let r = clip.r1; r <= Math.min(clip.r2, clip.r1 + 5000); r++) for (let c = clip.c1; c <= Math.min(clip.c2, clip.c1 + 500); c++) {
              const kk = keyOf(r, c);
              if (seen.has(kk)) continue;
              seen.add(kk);
              next.push(kk);
            }
          }
        }
        frontier = o.allLevels ? next : [];
      }
      keys.push(...seen);
      break;
    }
    case 'dependents': {
      // formulas on this sheet that read the selected cells (and, for every level, those reading them)
      const formulas: { k: number; refs: Range[] }[] = [];
      for (const k of s.formulas.keys()) formulas.push({ k, refs: sameSheetRefs(s, rowOf(k), colOf(k)) });
      const R = s.clip(sel) ?? sel;
      let targets: Range[] = [R];
      const seen = new Set<number>();
      while (targets.length) {
        const found: Range[] = [];
        for (const f of formulas) {
          if (seen.has(f.k)) continue;
          if (f.refs.some((x) => targets.some((t) => x.r1 <= t.r2 && t.r1 <= x.r2 && x.c1 <= t.c2 && t.c1 <= x.c2))) {
            seen.add(f.k);
            found.push({ r1: rowOf(f.k), c1: colOf(f.k), r2: rowOf(f.k), c2: colOf(f.k) });
          }
        }
        targets = o.allLevels ? found : [];
      }
      keys.push(...seen);
      break;
    }
    case 'condformats': case 'validation': {
      const ranges: Range[] = [];
      if (o.kind === 'condformats') {
        const here = s.condFormats.filter((cf) => cf.ranges.some((x) => inRange(x, active.r, active.c)));
        for (const cf of s.condFormats) if (!o.same || here.includes(cf)) ranges.push(...cf.ranges);
        if (o.same && !here.length) return null;
      } else {
        const here = s.validationAt(active.r, active.c);
        if (o.same && !here) return null;
        for (const v of s.validations) if (!o.same || v === here) ranges.push(...v.ranges);
      }
      return ranges.length ? ranges.map((x) => ({ ...x })) : null;
    }
  }
  if (!keys.length) return null;
  return cellsToAreas(keys);
}

// ---------------------------------------------------------------- the Series window

export interface SeriesOptions {
  /** Series in rows (along each row) or columns (down each column). */
  by: 'rows' | 'cols';
  type: 'linear' | 'growth' | 'date' | 'auto';
  /** Dates: the step is in days, weekdays, months or years. */
  unit?: 'day' | 'weekday' | 'month' | 'year';
  step: number;
  /** The series stops before passing this value. */
  stop?: number;
  /** Trend: a best-fit line (or growth curve) through the values already there, as Excel's Trend box. */
  trend?: boolean;
}

/** Excel's date number for a day. */
const dateSerial = (y: number, m: number, d: number) => (Date.UTC(y, m, d) - Date.UTC(1899, 11, 30)) / 86400000;

/** A date number moved on by some days, weekdays, months or years (the time of day kept). */
export function addDate(serial: number, n: number, unit: SeriesOptions['unit'] = 'day'): number {
  const whole = Math.floor(serial), time = serial - whole;
  const d = serialToDate(whole);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  if (unit === 'month' || unit === 'year') {
    const months = unit === 'year' ? n * 12 : n;
    const ty = y + Math.floor((m + months) / 12), tm = ((m + months) % 12 + 12) % 12;
    // the 31st becomes the last day of a shorter month, as Excel's EDATE
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    return dateSerial(ty, tm, Math.min(day, last)) + time;
  }
  if (unit === 'weekday') {
    let out = whole;
    const dir = Math.sign(n);
    for (let left = Math.abs(Math.round(n)); left > 0; ) {
      out += dir;
      const wd = serialToDate(out).getUTCDay();
      if (wd !== 0 && wd !== 6) left--;
    }
    return out + time;
  }
  return serial + n;
}

/** Least squares through points (x = 0, 1, 2…): the line's start and step. */
function fitLine(ys: number[]): { a: number; b: number } {
  const n = ys.length;
  const mx = (n - 1) / 2, my = ys.reduce((p, q) => p + q, 0) / n;
  let sxy = 0, sxx = 0;
  ys.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; });
  const b = sxx ? sxy / sxx : 0;
  return { a: my - b * mx, b };
}

/**
 * Fill each row (or column) of the selection from its first cell, or the cells filled at its
 * start: linear steps, growth (times the step), dates, or AutoFill. With a stop value the
 * series ends before passing it (and goes on past a one-cell selection as far as it needs).
 * Returns how many cells were filled.
 */
export function fillSeries(s: Sheet, R: Range, o: SeriesOptions): number {
  const along = o.by === 'rows';
  const lineCount = along ? R.r2 - R.r1 + 1 : R.c2 - R.c1 + 1;
  let len = along ? R.c2 - R.c1 + 1 : R.r2 - R.r1 + 1;
  // a single cell with a stop value: the series runs on until it passes it
  if (len === 1 && o.stop !== undefined && o.type !== 'auto') len = Math.min(along ? MAX_COLS - R.c1 : MAX_ROWS - R.r1, 10000);
  let filled = 0;
  for (let l = 0; l < lineCount; l++) {
    const at = (i: number): [number, number] => (along ? [R.r1 + l, R.c1 + i] : [R.r1 + i, R.c1 + l]);
    const num = (i: number): number | null => {
      const [r, c] = at(i);
      const v = s.values.get(keyOf(r, c));
      return typeof v === 'number' ? v : null;
    };
    // the values at the start (Trend fits through all of them; otherwise the first is the start)
    let known = 0;
    while (known < len && num(known) !== null) known++;
    if (!known) continue;
    const [r0, c0] = at(0);
    const style: CellStyle | undefined = s.cell(r0, c0)?.style;
    if (o.type === 'auto') {
      const src: Range = along ? { r1: R.r1 + l, c1: R.c1, r2: R.r1 + l, c2: R.c1 + known - 1 } : { r1: R.r1, c1: R.c1 + l, r2: R.r1 + known - 1, c2: R.c1 + l };
      const dst: Range = along ? { ...src, c2: R.c2 } : { ...src, r2: R.r2 };
      if ((along ? dst.c2 : dst.r2) > (along ? src.c2 : src.r2)) { s.fill(src, dst, true); filled += (along ? dst.c2 - src.c2 : dst.r2 - src.r2); }
      continue;
    }
    const ys = Array.from({ length: known }, (_, i) => num(i)!);
    let value: (i: number) => number;
    let from = 1;
    if (o.trend && known > 1 && o.type !== 'date') {
      // as in Excel, the values there are replaced by the trend's too
      from = 0;
      if (o.type === 'growth' && ys.every((y) => y > 0)) {
        const f = fitLine(ys.map(Math.log));
        value = (i) => Math.exp(f.a + f.b * i);
      } else {
        const f = fitLine(ys);
        value = (i) => f.a + f.b * i;
      }
    } else {
      const start = ys[0];
      value = o.type === 'growth' ? (i) => start * o.step ** i : o.type === 'date' ? (i) => addDate(start, o.step * i, o.unit) : (i) => start + o.step * i;
    }
    const up = o.type === 'growth' ? (o.step >= 1) === (ys[0] >= 0) : o.step >= 0;
    for (let i = from; i < len; i++) {
      const v = sigFigs15(value(i));
      if (!Number.isFinite(v)) break;
      if (o.stop !== undefined && (up ? v > o.stop + 1e-12 : v < o.stop - 1e-12)) break;
      const [r, c] = at(i);
      if (r >= MAX_ROWS || c >= MAX_COLS) break;
      const old = s.cell(r, c);
      s.setCell(r, c, { ...old, input: String(v), structure: undefined, style: old?.style ?? style });
      filled++;
    }
  }
  return filled;
}

// ---------------------------------------------------------------- Paste Special

export type PasteWhat = 'all' | 'formulas' | 'values' | 'formats' | 'notes' | 'validation' | 'no-borders' | 'widths' | 'formulas-numfmt' | 'values-numfmt';
export type PasteOp = 'none' | 'add' | 'subtract' | 'multiply' | 'divide';

export interface PasteSpecialOptions {
  what: PasteWhat;
  op?: PasteOp;
  /** Empty cells copied don't replace what is under them. */
  skipBlanks?: boolean;
  /** Rows become columns. */
  transpose?: boolean;
}

/** Where the cells were copied from, for column widths and data validation (null for text from elsewhere). */
export interface PasteSource { sheet: Sheet; range: Range }

const OPS: Record<Exclude<PasteOp, 'none'>, string> = { add: '+', subtract: '-', multiply: '*', divide: '/' };

/** A value combined with another by an operation (empty counts as 0, as in Excel). */
function combine(a: Value, b: Value, op: Exclude<PasteOp, 'none'>): Value | null {
  const x = a === null ? 0 : a, y = b === null ? 0 : b;
  if (typeof x !== 'number' || typeof y !== 'number') return null;
  switch (op) {
    case 'add': return x + y;
    case 'subtract': return x - y;
    case 'multiply': return x * y;
    case 'divide': return y === 0 ? new CellError('#DIV/0!') : x / y;
  }
}

/**
 * Paste Special: some part of the copied cells (values, formats, formulas, notes, validation,
 * column widths…), maybe combined with what is there by an operation, skipping blanks, or
 * turned rows to columns. Returns the block pasted into.
 */
export function pasteSpecial(s: Sheet, at: { row: number; col: number }, block: CellBlock, o: PasteSpecialOptions, src: PasteSource | null = null): Range {
  const rows = o.transpose ? block.cols : block.rows, cols = o.transpose ? block.rows : block.cols;
  const target: Range = { r1: at.row, c1: at.col, r2: Math.min(MAX_ROWS - 1, at.row + rows - 1), c2: Math.min(MAX_COLS - 1, at.col + cols - 1) };
  const op = o.op && o.op !== 'none' ? o.op : null;
  if (o.what === 'widths') {
    if (src) for (let j = 0; j < cols; j++) {
      const from = o.transpose ? null : src.range.c1 + j;
      const w = from === null ? undefined : src.sheet.colWidths.get(from);
      if (from !== null) s.setColWidth(at.col + j, w);
    }
    return target;
  }
  if (o.what === 'validation') {
    if (src) {
      const rules = src.sheet.validations.filter((v) => v.ranges.some((x) => x.r1 <= src.range.r2 && src.range.r1 <= x.r2 && x.c1 <= src.range.c2 && src.range.c1 <= x.c2));
      const rest = s.validations.map((v) => ({ ...v, ranges: v.ranges.flatMap((x) => cut(x, target)) })).filter((v) => v.ranges.length);
      const moved = rules.map((v) => ({ ...v, ranges: [target] }));
      s.setValidations([...rest, ...moved.slice(0, 1)]);
    }
    return target;
  }
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols; j++) {
      const si = o.transpose ? j : i, sj = o.transpose ? i : j;
      const from = block.cells[si]?.[sj];
      const r = at.row + i, c = at.col + j;
      if (r >= MAX_ROWS || c >= MAX_COLS) continue;
      const blank = !from?.input && !from?.structure;
      if (o.skipBlanks && blank) continue;
      const old = s.cell(r, c);
      if (o.what === 'notes') {
        const n = block.notes?.[si]?.[sj];
        if (n) s.setNote(r, c, copyNote(n));
        continue;
      }
      if (o.what === 'formats') { s.setCell(r, c, { ...old, style: from?.style }); continue; }
      // what goes in: a formula moved to its new cell, or what it showed when copied
      let input = from?.input;
      const shown = block.shown?.[si]?.[sj];
      const valuesOnly = o.what === 'values' || o.what === 'values-numfmt';
      if (input?.startsWith('=')) {
        if (valuesOnly && shown !== undefined) input = shown;
        else if (block.origin && o.transpose) input = transposeFormula(input, { row: block.origin.row + si, col: block.origin.col + sj }, { row: r, col: c });
        else if (block.origin) input = shiftFormula(input, r - (block.origin.row + si), c - (block.origin.col + sj));
      }
      if (op && !from?.structure) {
        const combined = combineInputs(s, r, c, input, op);
        if (combined === null) continue;
        input = combined;
      }
      let style: CellStyle | undefined;
      switch (o.what) {
        case 'all': style = from?.style; break;
        case 'no-borders': style = from?.style ? { ...from.style, borders: undefined } : undefined; break;
        case 'formulas-numfmt': case 'values-numfmt': style = { ...old?.style, numFmt: from?.style?.numFmt }; break;
        default: style = old?.style;
      }
      if (op && (o.what === 'formulas' || o.what === 'values')) style = old?.style;
      const keepStructure = from?.structure && !op ? from.structure : undefined;
      const link = o.what === 'all' || o.what === 'no-borders' ? from?.link : old?.link;
      s.setCell(r, c, { input: keepStructure ? undefined : input || undefined, structure: keepStructure, style, link });
      const n = block.notes?.[si]?.[sj];
      if ((o.what === 'all' || o.what === 'no-borders') && n) s.setNote(r, c, copyNote(n));
    }
  }
  return target;
}

/** What a cell holds after an operation with a pasted input: a number, or a formula joining the two. */
function combineInputs(s: Sheet, r: number, c: number, pasted: string | undefined, op: Exclude<PasteOp, 'none'>): string | null {
  const mine = s.effectiveInput(r, c);
  const mineFormula = mine?.startsWith('='), pastedFormula = pasted?.startsWith('=');
  if (mineFormula || pastedFormula) {
    const left = mineFormula ? `(${mine!.slice(1)})` : mine ? numberOrNull(mine) : '0';
    const right = pastedFormula ? `(${pasted!.slice(1)})` : pasted ? numberOrNull(pasted) : '0';
    if (left === null || right === null) return null;
    return `=${left}${OPS[op]}${right}`;
  }
  const a = mine ? readTyped(mine).value : null, b = pasted ? readTyped(pasted).value : null;
  const v = combine(a, b, op);
  if (v === null) return mine === undefined && b !== null ? pasted ?? null : null;
  return valueInput(v);
}

const numberOrNull = (t: string): string | null => {
  const v = readTyped(t).value;
  return typeof v === 'number' ? String(v) : null;
};

/** A block with another cut out of it, as up to four blocks. */
function cut(a: Range, b: Range): Range[] {
  if (a.r2 < b.r1 || b.r2 < a.r1 || a.c2 < b.c1 || b.c2 < a.c1) return [a];
  const out: Range[] = [];
  if (a.r1 < b.r1) out.push({ ...a, r2: b.r1 - 1 });
  if (a.r2 > b.r2) out.push({ ...a, r1: b.r2 + 1 });
  const r1 = Math.max(a.r1, b.r1), r2 = Math.min(a.r2, b.r2);
  if (a.c1 < b.c1) out.push({ r1, r2, c1: a.c1, c2: b.c1 - 1 });
  if (a.c2 > b.c2) out.push({ r1, r2, c1: b.c2 + 1, c2: a.c2 });
  return out;
}

// ---------------------------------------------------------------- Text to Columns

export interface SplitOptions {
  mode: 'delimited' | 'fixed';
  /** The characters that separate the pieces (delimited). */
  delimiters?: string;
  /** Several separators in a row count as one. */
  consecutive?: boolean;
  /** Text inside these quotes is kept whole, separators and all ('' for none). */
  qualifier?: string;
  /** Fixed width: where the text is cut (characters from the start). */
  breaks?: number[];
  /** Each column's data format: General (read as typed), Text (kept as text) or Skip (left out). */
  formats?: ('general' | 'text' | 'skip')[];
}

/** One text cut into pieces. */
export function splitText(text: string, o: SplitOptions): string[] {
  if (o.mode === 'fixed') {
    const cuts = [...new Set((o.breaks ?? []).filter((b) => b > 0))].sort((a, b) => a - b);
    const out: string[] = [];
    let from = 0;
    for (const b of cuts) { if (b >= text.length) break; out.push(text.slice(from, b).trim()); from = b; }
    out.push(text.slice(from).trim());
    return out;
  }
  const seps = o.delimiters ?? '\t';
  const q = o.qualifier ?? '';
  const out: string[] = [];
  let cur = '', inQuote = false, quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q && ch === q) {
      if (inQuote && text[i + 1] === q) { cur += q; i++; continue; }
      inQuote = !inQuote;
      quoted = true;
      continue;
    }
    if (!inQuote && seps.includes(ch)) {
      if (o.consecutive && cur === '' && !quoted && out.length && i > 0 && seps.includes(text[i - 1])) continue;
      out.push(cur);
      cur = '';
      quoted = false;
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  // a separator at the very start counts once even with Treat Consecutive as One
  return o.consecutive && out.length > 1 && out[0] === '' && seps.includes(text[0]) ? out.slice(1) : out;
}

/**
 * Text to Columns: each cell of one column cut into pieces, put in the cells to its right (or
 * from `dest`). Returns how many columns the pieces took.
 */
export function textToColumns(s: Sheet, R: Range, o: SplitOptions, dest: { row: number; col: number } = { row: R.r1, col: R.c1 }): number {
  let widest = 0;
  const end = Math.min(R.r2, Math.max(s.lastRow, s.lastDataRow));
  const lines: { r: number; parts: string[] }[] = [];
  for (let r = R.r1; r <= end; r++) {
    const cell = s.cell(r, R.c1);
    if (cell?.structure || cell?.input?.startsWith('=')) continue;
    const v = s.values.get(keyOf(r, R.c1));
    if (v === undefined || v === null || v === '') continue;
    const text = typeof v === 'string' ? v : s.shownText(r, R.c1);
    lines.push({ r, parts: splitText(text, o) });
  }
  for (const { r, parts } of lines) {
    let col = dest.col;
    parts.forEach((p, i) => {
      const f = o.formats?.[i] ?? 'general';
      if (f === 'skip') return;
      const row = dest.row + (r - R.r1);
      const old = s.cell(row, col);
      const input = f === 'text' ? (p ? `'${p}` : '') : p;
      if (input) s.setCell(row, col, { input, style: f === 'text' ? { ...old?.style, numFmt: '@' } : old?.style, link: old?.link });
      else s.setCell(row, col, { style: old?.style });
      col++;
    });
    widest = Math.max(widest, col - dest.col);
  }
  return widest;
}

// ---------------------------------------------------------------- Remove Duplicates

/**
 * Remove Duplicates: rows of a block that repeat an earlier row in the chosen columns (by what
 * the cells show, ignoring capitals, as in Excel; structures by their SMILES) are taken out, and
 * the rows below move up within the block. Returns how many went and how many stay.
 */
export function removeDuplicates(s: Sheet, R: Range, cols: number[], header: boolean): { removed: number; kept: number } {
  const first = header ? R.r1 + 1 : R.r1;
  const last = Math.min(R.r2, Math.max(s.lastRow, s.lastDataRow));
  const seen = new Set<string>();
  const keep: number[] = [];
  for (let r = first; r <= last; r++) {
    const id = cols.map((c) => s.shownText(r, c).toLowerCase()).join('\u0001');
    if (seen.has(id)) continue;
    seen.add(id);
    keep.push(r);
  }
  const total = Math.max(0, last - first + 1);
  if (keep.length === total) return { removed: 0, kept: total };
  moveRowsUp(s, { ...R, r1: first, r2: last }, keep);
  return { removed: total - keep.length, kept: keep.length };
}

/** The given rows of a block, in order, moved to its top (formulas and notes with them); the rest of the block emptied. */
function moveRowsUp(s: Sheet, R: Range, keep: number[]): void {
  const width = R.c2 - R.c1 + 1;
  const lines = keep.map((row) => ({
    row,
    cells: Array.from({ length: width }, (_, j) => s.cell(row, R.c1 + j)),
    notes: Array.from({ length: width }, (_, j) => s.noteAt(row, R.c1 + j)),
  }));
  for (let r = R.r1; r <= R.r2; r++) {
    const i = r - R.r1;
    const line = lines[i];
    for (let j = 0; j < width; j++) {
      const col = R.c1 + j;
      if (!line) {
        // a property column's cells stay worked out; everything else empties
        s.setCell(r, col, undefined);
        s.setNote(r, col, undefined);
        continue;
      }
      const c = line.cells[j];
      const input = c?.input?.startsWith('=') ? shiftFormula(c.input, r - line.row, 0) : c?.input;
      s.setCell(r, col, c ? { ...c, input } : undefined);
      s.setNote(r, col, line.notes[j]);
    }
  }
}

// ---------------------------------------------------------------- Advanced Filter

/** One test from a criteria cell: ">5", "<>done", "=", "Pd*", or plain text (begins with). */
export function criterionTest(crit: string | number | boolean): (v: Value, shown: string) => boolean {
  if (typeof crit === 'number' || typeof crit === 'boolean') return (v) => v !== null && !isError(v) && compareValues(v, crit) === 0;
  const m = /^(<=|>=|<>|<|>|=)?(.*)$/s.exec(crit)!;
  const op = m[1] ?? '';
  const rest = m[2];
  const num = rest.trim() !== '' && Number.isFinite(Number(rest)) ? Number(rest) : null;
  if (!op) {
    // plain text: cells beginning with it (with wildcards); a number: equal to it
    if (num !== null) return (v) => typeof v === 'number' && sigFigs15(v) === sigFigs15(num);
    const re = findPattern({ text: rest + '*', whole: true });
    return (_v, shown) => re.test(shown);
  }
  if (op === '=' && rest === '') return (v, shown) => v === null || shown === '';
  if (op === '<>' && rest === '') return (v, shown) => v !== null && shown !== '';
  const want: Value = num ?? rest;
  const textEq = typeof want === 'string' && (op === '=' || op === '<>') ? findPattern({ text: rest, whole: true }) : null;
  return (v, shown) => {
    if (textEq) { const eq = textEq.test(shown); return op === '=' ? eq : !eq; }
    if (v === null || isError(v)) return op === '<>';
    if (typeof want === 'number' && typeof v !== 'number') return op === '<>';
    if (typeof want === 'string' && typeof v !== 'string') return op === '<>';
    const c = compareValues(v, want);
    switch (op) {
      case '<': return c < 0;
      case '<=': return c <= 0;
      case '>': return c > 0;
      case '>=': return c >= 0;
      case '=': return c === 0;
      default: return c !== 0;
    }
  };
}

export interface AdvancedFilter {
  /** The list, its first row the headers. */
  list: Range;
  /** The criteria: a row of headers naming columns of the list, and rows of tests under them (each row is one way to pass). */
  criteria: Range | null;
  unique?: boolean;
  /** Copy the rows that pass to here (null: filter the list in place, hiding the rest). */
  copyTo?: { row: number; col: number } | null;
}

/** Which rows of the list pass the criteria (and, with Unique, aren't a repeat). */
export function advancedRows(s: Sheet, f: AdvancedFilter): number[] {
  const L = f.list;
  const heads = new Map<string, number>();
  for (let c = L.c1; c <= L.c2; c++) heads.set(s.shownText(L.r1, c).trim().toLowerCase(), c);
  type Test = (r: number) => boolean;
  const ways: Test[][] = [];
  const C = f.criteria;
  if (C) {
    for (let cr = C.r1 + 1; cr <= C.r2; cr++) {
      const tests: Test[] = [];
      for (let cc = C.c1; cc <= C.c2; cc++) {
        const input = s.effectiveInput(cr, cc);
        if (!input) continue;
        const head = s.shownText(C.r1, cc).trim().toLowerCase();
        const col = heads.get(head);
        if (input.startsWith('=') && col === undefined) {
          // a computed criterion: a formula about the list's first row of data, TRUE for rows to show
          const home = { row: L.r1 + 1, col: L.c1 };
          tests.push((r) => s.wb.formulaAt(s, input, home, r, L.c1) === true);
          continue;
        }
        if (col === undefined) continue;
        const v = s.values.get(keyOf(cr, cc));
        const crit = input.startsWith('=') ? (v === null || v === undefined || isError(v) ? '' : typeof v === 'string' ? v : v) : input.startsWith("'") ? input.slice(1) : readTyped(input).value ?? '';
        const t = criterionTest(crit as string | number | boolean);
        tests.push((r) => t(s.value(r, col), s.shownText(r, col)));
      }
      if (tests.length) ways.push(tests);
    }
  }
  const out: number[] = [];
  const seen = new Set<string>();
  const last = Math.min(L.r2, Math.max(s.lastRow, s.lastDataRow));
  for (let r = L.r1 + 1; r <= last; r++) {
    if (ways.length && !ways.some((w) => w.every((t) => t(r)))) continue;
    if (f.unique) {
      const id = Array.from({ length: L.c2 - L.c1 + 1 }, (_, j) => s.shownText(r, L.c1 + j).toLowerCase()).join('\u0001');
      if (seen.has(id)) continue;
      seen.add(id);
    }
    out.push(r);
  }
  return out;
}

/** Advanced Filter: hide the rows that fail (in place) or copy the header and the rows that pass. Returns how many passed of how many. */
export function applyAdvancedFilter(s: Sheet, f: AdvancedFilter): { shown: number; total: number } {
  const L = f.list;
  const pass = advancedRows(s, f);
  const last = Math.min(L.r2, Math.max(s.lastRow, s.lastDataRow));
  const total = Math.max(0, last - L.r1);
  if (!f.copyTo) {
    const ok = new Set(pass);
    for (let r = L.r1 + 1; r <= last; r++) s.setRowHidden(r, !ok.has(r));
    return { shown: pass.length, total };
  }
  const to = f.copyTo;
  const width = L.c2 - L.c1 + 1;
  // values as they show (formulas are worked out once, as Excel's copy does), with their formats
  const copyRow = (from: number, row: number) => {
    for (let j = 0; j < width; j++) {
      const col = L.c1 + j;
      const c: Cell | undefined = s.cell(from, col);
      const input = s.effectiveInput(from, col);
      const value = input?.startsWith('=') ? valueInput(s.value(from, col)) : input;
      s.setCell(row, to.col + j, { input: value || undefined, structure: c?.structure, style: s.styleAt(from, col), link: c?.link });
    }
  };
  // what was in the place copied to before goes, down to the end of what is in use there
  const oldEnd = Math.max(s.lastRow, to.row);
  for (let r = to.row; r <= oldEnd; r++) for (let j = 0; j < width; j++) if (s.cell(r, to.col + j)) s.setCell(r, to.col + j, undefined);
  copyRow(L.r1, to.row);
  pass.forEach((r, i) => copyRow(r, to.row + 1 + i));
  return { shown: pass.length, total };
}

/** Show the rows of a block again (Data > Clear after an Advanced Filter in place). */
export function showAllRows(s: Sheet, R: Range): number {
  let n = 0;
  for (const r of [...s.hiddenRows.keys()]) if (r >= R.r1 && r <= R.r2) { s.setRowHidden(r, false); n++; }
  return n;
}
