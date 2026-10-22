// Turning text into a table and a table back into text (Word's Convert Text to Table and
// Convert to Text), splitting a table in two (Split Table), and merging a block of cells. Each
// gives a new document (or table); the caller makes it one undo step.

import type { ParaStyle, TableCell, TableData, TextRun } from '../model';
import * as rt from '../richtext';
import { cleanPara, fitParas, paraCount, paraRange, splitParagraphs } from '../text/paragraphs';
import { coveringCell, isCovered, rowSpanOf, spanOf } from '../table';
import { nextObjectId, objectOffsets, objectRun, paraFromStyle, styleOf, type DocObject, type DocText } from './document';
import type { CellBlock } from './table-styles';

/** What separates the cells in the text: tabs, commas, semicolons, each paragraph its own cell, or another character. */
export type Separator = 'tab' | 'comma' | 'semicolon' | 'para' | { other: string };

export const SEPARATOR_NAMES: [string, string][] = [['tab', 'Tabs'], ['comma', 'Commas'], ['semicolon', 'Semicolons'], ['para', 'Paragraphs'], ['other', 'Other']];

const sepChar = (s: Separator): string => (s === 'tab' ? '\t' : s === 'comma' ? ',' : s === 'semicolon' ? ';' : s === 'para' ? '\n' : s.other.slice(0, 1) || '\t');

function allParas(t: Pick<DocText, 'runs' | 'paras'>): ParaStyle[] {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)));
}

/** The separator the paragraphs most likely use: tabs if any, else commas, else semicolons, else each paragraph a cell. */
export function guessSeparator(lines: string[]): Separator {
  if (lines.some((l) => l.includes('\t'))) return 'tab';
  if (lines.length && lines.every((l) => l.includes(','))) return 'comma';
  if (lines.length && lines.every((l) => l.includes(';'))) return 'semicolon';
  return 'para';
}

/** A paragraph's runs cut at each separator character (the separators left out). */
function cutRuns(runs: TextRun[], ch: string): TextRun[][] {
  const out: TextRun[][] = [[]];
  for (const r of runs) {
    if (r.obj !== undefined) { out[out.length - 1].push(r); continue; }
    r.text.split(ch).forEach((piece, i) => {
      if (i > 0) out.push([]);
      if (piece) out[out.length - 1].push({ ...r, text: piece });
    });
  }
  return out.map((cell) => rt.normalizeRuns(cell).filter((r) => r.text));
}

export interface TextToTableOptions {
  sep: Separator;
  /** How many columns (the most cells in a paragraph when left out; for 'para', the cells per row). */
  cols?: number;
  /** The width the columns share. */
  width: number;
  lines?: TableData['lines'];
  style?: string;
}

/**
 * Paragraphs `first` to `last` as a table: each paragraph a row, cut into cells at the
 * separator (or, with 'para', each paragraph a cell, `cols` to a row). The table takes their
 * place as a paragraph of its own; its id is given back.
 */
export function textToTable(t: DocText, first: number, last: number, opts: TextToTableOptions): { t: DocText; id: number } {
  const text = rt.plainText(t.runs);
  const paras = allParas(t);
  last = Math.min(last, paras.length - 1);
  const parts = splitParagraphs(t.runs);
  const ch = sepChar(opts.sep);
  let rows: { runs: TextRun[]; ps: ParaStyle }[][] = [];
  if (ch === '\n') {
    const cells = parts.slice(first, last + 1).map((runs, i) => ({ runs: rt.normalizeRuns(runs).filter((r) => r.text), ps: paras[first + i] }));
    const n = Math.max(1, Math.floor(opts.cols ?? 1));
    for (let i = 0; i < cells.length; i += n) rows.push(cells.slice(i, i + n));
  } else {
    rows = parts.slice(first, last + 1).map((runs, i) => cutRuns(runs, ch).map((cell) => ({ runs: cell, ps: paras[first + i] })));
  }
  const n = Math.max(1, opts.cols ?? 0, ...rows.map((r) => r.length));
  const width = Math.max(18 * n, opts.width);
  const w = Math.floor((width / n) * 100) / 100;
  const table: TableData = {
    cols: Array(n).fill(w),
    rows: rows.map((row) => Array.from({ length: n }, (_, c): TableCell => {
      const x = row[c];
      if (!x) return { runs: [] };
      const cell: TableCell = { runs: x.runs };
      if (x.ps.align && x.ps.align !== 'left') cell.align = x.ps.align;
      return cell;
    })),
    head: 0,
    lines: opts.lines ?? 'grid',
    align: Array(n).fill('left'),
  };
  if (opts.style) { table.style = opts.style; table.head = 1; }
  if (!table.rows.length) table.rows.push(Array.from({ length: n }, () => ({ runs: [] })));
  const id = nextObjectId(t);
  const start = paraRange(text, first).start, end = paraRange(text, last).end;
  const style = rt.styleOf(rt.sliceRuns(t.runs, start, Math.max(start + 1, end))[0] ?? { text: '' });
  const atEnd = end >= text.length;
  const runs = rt.normalizeRuns([
    ...rt.sliceRuns(t.runs, 0, start),
    objectRun(id, cleanStyle(style)),
    ...(atEnd ? [{ ...cleanStyle(style), text: '\n' }] : []),
    ...rt.sliceRuns(t.runs, end, text.length),
  ]);
  // a table's paragraph has no spacing or indent of its own (as in Word)
  const tp = cleanPara({ ...paras[first], spaceBefore: 0, spaceAfter: 0, firstLine: 0, indent: undefined, list: undefined, level: undefined, style: undefined, align: undefined, pageBreak: undefined });
  const N = paraFromStyle(styleOf(t, {}), {});
  const out = [...paras.slice(0, first), tp, ...(atEnd ? [N] : []), ...paras.slice(last + 1)];
  return { t: { ...t, runs, paras: out, objects: { ...t.objects, [id]: { kind: 'table', table } } }, id };
}

const cleanStyle = (s: rt.RunStyle): rt.RunStyle => {
  const { obj: _, ...rest } = s as rt.RunStyle & { obj?: number };
  return rest;
};

/** A cell's text as paragraphs of runs (a table in it as its own text, each row a paragraph). */
function cellParas(t: DocText, cell: TableCell, sep: Separator): TextRun[][] {
  const out: TextRun[][] = [];
  for (const para of splitParagraphs(cell.runs)) {
    const inner = para.length === 1 && para[0].obj !== undefined ? t.objects[para[0].obj] : undefined;
    if (inner?.kind === 'table') out.push(...tableParas(t, inner.table, sep).map((p) => p.runs));
    else out.push(para);
  }
  return out.length ? out : [[]];
}

/** A table's text, each row a paragraph (or, with 'para', each cell's paragraphs), cells joined by the separator. */
function tableParas(t: DocText, tab: TableData, sep: Separator): { runs: TextRun[]; align?: ParaStyle['align'] }[] {
  const ch = sepChar(sep);
  const out: { runs: TextRun[]; align?: ParaStyle['align'] }[] = [];
  tab.rows.forEach((row, r) => {
    const line: TextRun[] = [];
    let first = true;
    for (let c = 0; c < tab.cols.length; c++) {
      const o = coveringCell(tab, r, c);
      if (o.c !== c) continue;
      // a cell merged down from above stays empty, so the columns still line up
      const cell = o.r === r ? row[c] ?? { runs: [] } : { runs: [] };
      const ps = cellParas(t, cell, sep);
      if (ch === '\n') {
        if (o.r !== r) continue;
        for (const p of ps) out.push({ runs: p, align: cell.align });
        continue;
      }
      if (!first) line.push({ ...(line.length ? cleanStyle(rt.styleOf(line[line.length - 1])) : {}), text: ch });
      first = false;
      ps.forEach((p, i) => {
        if (i > 0) line.push({ text: '\n' });
        line.push(...p);
      });
    }
    if (ch !== '\n') out.push({ runs: line });
  });
  return out;
}

/** A table as text (Word's Convert to Text): its rows become paragraphs where it was. */
export function tableToText(t: DocText, id: number, sep: Separator): { t: DocText; start: number; end: number } | null {
  const o = t.objects[id];
  const at = objectOffsets(t.runs).get(id);
  if (o?.kind !== 'table' || at === undefined) return null;
  const text = rt.plainText(t.runs);
  const paras = allParas(t);
  const p = paraCount(text.slice(0, at)) - 1;
  const lines = tableParas(t, o.table, sep);
  const N = paraFromStyle(styleOf(t, {}), {});
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  lines.forEach((l, i) => {
    if (i > 0) runs.push({ text: '\n' });
    const clean = l.runs.map((r) => ({ ...r, text: r.text }));
    runs.push(...clean);
    // a paragraph break inside a cell's text makes more paragraphs
    const n = paraCount(rt.plainText(clean));
    for (let k = 0; k < n; k++) ps.push(l.align && l.align !== 'left' ? { ...N, align: l.align } : N);
  });
  const body = rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, at), ...runs, ...rt.sliceRuns(t.runs, at + 1, text.length)]);
  const objects: Record<number, DocObject> = { ...t.objects };
  delete objects[id];
  const length = rt.plainText(runs).length;
  return { t: { ...t, runs: body, paras: [...paras.slice(0, p), ...ps, ...paras.slice(p + 1)], objects }, start: at, end: at + length };
}

/**
 * Split a table in the text above row `r` (Word's Split Table): the rows from `r` on become a
 * table of their own after it, with an empty paragraph between. A cell merged down across the
 * split is split there. Null for a first row, or a table that isn't in the text.
 */
export function splitTable(t: DocText, id: number, r: number): { t: DocText; id: number } | null {
  const o = t.objects[id];
  const at = objectOffsets(t.runs).get(id);
  if (o?.kind !== 'table' || at === undefined || r <= 0 || r >= o.table.rows.length) return null;
  const tab = o.table;
  const top = tab.rows.slice(0, r).map((row) => [...row]);
  const bottom = tab.rows.slice(r).map((row) => [...row]);
  for (let c = 0; c < tab.cols.length; c++) {
    const own = coveringCell(tab, r, c);
    if (own.c !== c) continue;
    const down = rowSpanOf(tab, own.r, own.c);
    if (own.r >= r || own.r + down <= r) continue;
    // the merged cell ends at the split; under it, an empty cell merged over the rest
    const cell = { ...top[own.r][c] };
    if (r - own.r > 1) cell.rowSpan = r - own.r; else delete cell.rowSpan;
    top[own.r][c] = cell;
    const rest = own.r + down - r;
    const under: TableCell = { runs: [] };
    const span = spanOf(tab, own.r, own.c);
    if (span > 1) under.span = span;
    if (rest > 1) under.rowSpan = rest;
    if (cell.fill) under.fill = cell.fill;
    if (cell.borders) under.borders = cell.borders;
    bottom[0][c] = under;
  }
  const head = Math.min(tab.head, r);
  const a: TableData = { ...tab, rows: top, head };
  const b: TableData = { ...tab, rows: bottom, head: 0, title: undefined, notes: undefined };
  const nid = nextObjectId(t);
  const style = rt.styleOf(rt.sliceRuns(t.runs, at, at + 1)[0] ?? { text: '' });
  const text = rt.plainText(t.runs);
  const paras = allParas(t);
  const p = paraCount(text.slice(0, at)) - 1;
  const nl = { ...cleanStyle(style), text: '\n' };
  const runs = rt.normalizeRuns([...rt.sliceRuns(t.runs, 0, at + 1), nl, nl, objectRun(nid, cleanStyle(style)), ...rt.sliceRuns(t.runs, at + 1, text.length)]);
  const N = paraFromStyle(styleOf(t, {}), {});
  return {
    t: { ...t, runs, paras: [...paras.slice(0, p + 1), N, paras[p], ...paras.slice(p + 1)], objects: { ...t.objects, [id]: { ...o, table: a }, [nid]: { kind: 'table', table: b } } },
    id: nid,
  };
}

/** Can a block of cells be merged into one: more than one cell, and no merged cell reaching out of it. */
export function canMergeBlock(t: TableData, b: CellBlock): boolean {
  if (b.r0 === b.r1 && b.c0 === b.c1) return false;
  for (let r = b.r0; r <= b.r1; r++) {
    for (let c = b.c0; c <= b.c1; c++) {
      const o = coveringCell(t, r, c);
      if (o.r < b.r0 || o.c < b.c0) return false;
      if (o.r === r && o.c === c && (r + rowSpanOf(t, r, c) - 1 > b.r1 || c + spanOf(t, r, c) - 1 > b.c1)) return false;
    }
  }
  return coveringCell(t, b.r0, b.c0).r === b.r0 && coveringCell(t, b.r0, b.c0).c === b.c0 && !isCovered(t, b.r0, b.c0);
}

/** Merge a block of cells into its top left one, the others' text after its own as paragraphs (Word's Merge Cells). */
export function mergeBlock(t: TableData, b: CellBlock): TableData {
  if (!canMergeBlock(t, b)) return t;
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  let any = false;
  for (let r = b.r0; r <= b.r1; r++) {
    for (let c = b.c0; c <= b.c1; c++) {
      if (isCovered(t, r, c)) continue;
      const cell = t.rows[r][c];
      if (!cell.runs.some((x) => x.text) && (r !== b.r0 || c !== b.c0)) continue;
      if (any) runs.push({ ...(runs.length ? cleanStyle(rt.styleOf(runs[runs.length - 1])) : {}), text: '\n' });
      any = true;
      runs.push(...cell.runs);
      const n = paraCount(rt.plainText(cell.runs));
      for (let i = 0; i < n; i++) paras.push(cell.paras?.[i] ?? {});
    }
  }
  const first = t.rows[b.r0][b.c0];
  const merged: TableCell = { ...first, runs: rt.normalizeRuns(runs).filter((x) => x.text) };
  if (paras.some((p) => Object.keys(p).length)) merged.paras = paras; else delete merged.paras;
  if (b.c1 > b.c0) merged.span = b.c1 - b.c0 + 1; else delete merged.span;
  if (b.r1 > b.r0) merged.rowSpan = b.r1 - b.r0 + 1; else delete merged.rowSpan;
  return {
    ...t,
    rows: t.rows.map((row, r) => row.map((cell, c) => {
      if (r === b.r0 && c === b.c0) return merged;
      if (r >= b.r0 && r <= b.r1 && c >= b.c0 && c <= b.c1) return { runs: [] };
      return cell;
    })),
  };
}

/** The block two cells make (dragged from one to the other), grown to take in any merged cell it cuts. */
export function blockOf(t: TableData, a: { r: number; c: number }, b: { r: number; c: number }): CellBlock {
  let r0 = Math.min(a.r, b.r), r1 = Math.max(a.r, b.r), c0 = Math.min(a.c, b.c), c1 = Math.max(a.c, b.c);
  for (let grew = true; grew;) {
    grew = false;
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const o = coveringCell(t, r, c);
        const er = o.r + rowSpanOf(t, o.r, o.c) - 1, ec = o.c + spanOf(t, o.r, o.c) - 1;
        if (o.r < r0) { r0 = o.r; grew = true; }
        if (o.c < c0) { c0 = o.c; grew = true; }
        if (er > r1) { r1 = er; grew = true; }
        if (ec > c1) { c1 = ec; grew = true; }
      }
    }
  }
  return { r0, c0, r1, c1 };
}
