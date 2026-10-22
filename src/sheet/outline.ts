// Data > Outline: Group and Ungroup rows or columns (up to seven levels deep), show and hide the
// details of a group, show the outline to a level (the 1 2 3 buttons), Auto Outline from the
// formulas, and Subtotal: a total row under each change in a column, worked out with SUBTOTAL,
// and a grand total, all grouped so the details fold away. Saved to Excel as its own outline
// (outlineLevel on rows and columns, the summary rows' places in sheetPr).

import type { Sheet } from './workbook';
import { Range, keyOf, colName } from './refs';
import { formulaRefs } from './formula';

export const MAX_LEVEL = 7;

export interface OutlineSettings {
  /** Summary rows above their details (unset: below, Excel's default). */
  summaryAbove?: boolean;
  /** Summary columns to the left of their details (unset: to the right). */
  summaryLeft?: boolean;
}

export type Axis = 'row' | 'col';

const levelsOf = (s: Sheet, axis: Axis) => (axis === 'row' ? s.rowLevels : s.colLevels);
const setLevel = (s: Sheet, axis: Axis, i: number, n: number) => (axis === 'row' ? s.setRowLevel(i, n) : s.setColLevel(i, n));
const isHidden = (s: Sheet, axis: Axis, i: number) => (axis === 'row' ? s.hiddenRows.has(i) : s.hiddenCols.has(i));
const setHidden = (s: Sheet, axis: Axis, i: number, on: boolean) => (axis === 'row' ? s.setRowHidden(i, on) : s.setColHidden(i, on));
const summaryBefore = (s: Sheet, axis: Axis) => !!(axis === 'row' ? s.outline?.summaryAbove : s.outline?.summaryLeft);

/** The deepest level in use (0: no outline). */
export function maxLevel(s: Sheet, axis: Axis): number {
  let m = 0;
  for (const v of levelsOf(s, axis).values()) if (v > m) m = v;
  return m;
}

/** Group rows or columns a level deeper. False when some are already seven deep. */
export function group(s: Sheet, axis: Axis, from: number, to: number): boolean {
  const levels = levelsOf(s, axis);
  for (let i = from; i <= to; i++) if ((levels.get(i) ?? 0) >= MAX_LEVEL) return false;
  for (let i = from; i <= to; i++) setLevel(s, axis, i, (levels.get(i) ?? 0) + 1);
  return true;
}

/** Take rows or columns a level out (hidden ones that leave every group are shown). False when none were grouped. */
export function ungroup(s: Sheet, axis: Axis, from: number, to: number): boolean {
  const levels = levelsOf(s, axis);
  let any = false;
  for (let i = from; i <= to; i++) {
    const n = levels.get(i) ?? 0;
    if (!n) continue;
    any = true;
    setLevel(s, axis, i, n - 1);
    if (n === 1 && isHidden(s, axis, i)) setHidden(s, axis, i, false);
  }
  return any;
}

/** Clear Outline: every level gone, and the rows and columns it hid shown. */
export function clearOutline(s: Sheet, axis: Axis): void {
  for (const i of [...levelsOf(s, axis).keys()]) {
    setLevel(s, axis, i, 0);
    if (isHidden(s, axis, i)) setHidden(s, axis, i, false);
  }
}

export interface OutlineGroup {
  level: number;
  from: number;
  to: number;
  /** Where its +/− button goes: the summary row or column (after the group, or before it). */
  button: number;
  collapsed: boolean;
}

/** Every group: the runs of rows (or columns) at each level or deeper. */
export function outlineGroups(s: Sheet, axis: Axis): OutlineGroup[] {
  const levels = levelsOf(s, axis);
  if (!levels.size) return [];
  const keys = [...levels.keys()].sort((a, b) => a - b);
  const before = summaryBefore(s, axis);
  const out: OutlineGroup[] = [];
  const top = maxLevel(s, axis);
  for (let L = 1; L <= top; L++) {
    let start = -1, prev = -2;
    const close = () => {
      if (start < 0) return;
      let collapsed = true;
      for (let i = start; i <= prev; i++) if (!isHidden(s, axis, i)) { collapsed = false; break; }
      out.push({ level: L, from: start, to: prev, button: before ? Math.max(0, start - 1) : prev + 1, collapsed });
      start = -1;
    };
    for (const k of keys) {
      if ((levels.get(k) ?? 0) < L) continue;
      if (k !== prev + 1) close();
      if (start < 0) start = k;
      prev = k;
    }
    close();
  }
  return out;
}

/** Hide Detail and Show Detail: fold a group away, or open it (its inner groups that were folded stay folded). */
export function setCollapsed(s: Sheet, axis: Axis, g: OutlineGroup, collapse: boolean): void {
  if (collapse) {
    for (let i = g.from; i <= g.to; i++) setHidden(s, axis, i, true);
    return;
  }
  // inner groups stay as they were: folded ones are those whose summary row is not hidden itself but whose details all are
  const inner = outlineGroups(s, axis).filter((x) => x.level > g.level && x.from >= g.from && x.to <= g.to && x.collapsed);
  for (let i = g.from; i <= g.to; i++) {
    if (inner.some((x) => x.level === g.level + 1 && i >= x.from && i <= x.to)) continue;
    setHidden(s, axis, i, false);
  }
}

/** The group whose button is at a row or column at a level, if any. */
export function groupAtButton(s: Sheet, axis: Axis, at: number, level: number): OutlineGroup | undefined {
  return outlineGroups(s, axis).find((g) => g.level === level && g.button === at);
}

/** The 1 2 3 buttons: show rows (or columns) above a level, hide the deeper ones. */
export function showLevel(s: Sheet, axis: Axis, n: number): void {
  for (const [i, lv] of levelsOf(s, axis)) setHidden(s, axis, i, lv >= n);
}

/**
 * Auto Outline: rows whose formulas add up the rows just above them (=SUM(C2:C5) in C6) become
 * a group of those rows, and the same across columns. Returns how many groups were made.
 */
export function autoOutline(s: Sheet, R: Range): number {
  let made = 0;
  for (const axis of ['row', 'col'] as Axis[]) {
    const spans: [number, number][] = [];
    for (let r = R.r1; r <= R.r2; r++) {
      for (let c = R.c1; c <= R.c2; c++) {
        const f = s.formulas.get(keyOf(r, c));
        if (!f) continue;
        for (const ref of formulaRefs(f)) {
          if (ref.sheet !== undefined || ref.kind !== 'range' || !ref.b) continue;
          const b = { r1: Math.min(ref.a.row, ref.b.row), r2: Math.max(ref.a.row, ref.b.row), c1: Math.min(ref.a.col, ref.b.col), c2: Math.max(ref.a.col, ref.b.col) };
          if (axis === 'row' && b.c1 === c && b.c2 === c && b.r2 === r - 1 && b.r1 < b.r2) spans.push([b.r1, b.r2]);
          if (axis === 'col' && b.r1 === r && b.r2 === r && b.c2 === c - 1 && b.c1 < b.c2) spans.push([b.c1, b.c2]);
        }
      }
    }
    // each block once; larger blocks (grand totals) take in smaller ones
    const seen = new Set<string>();
    for (const [a, b] of spans.sort((x, y) => (y[1] - y[0]) - (x[1] - x[0]))) {
      const id = `${a}:${b}`;
      if (seen.has(id)) continue;
      seen.add(id);
      if (group(s, axis, a, b)) made++;
    }
  }
  return made;
}

// ---------------------------------------------------------------- subtotals

/** SUBTOTAL's function numbers, by name in the Subtotal window. */
export const SUBTOTAL_FUNCTIONS: [string, number][] = [['Sum', 9], ['Count', 3], ['Average', 1], ['Max', 4], ['Min', 5], ['Product', 6], ['Count Numbers', 2], ['StdDev', 7], ['StdDevp', 8], ['Var', 10], ['Varp', 11]];

export interface SubtotalOptions {
  /** The column whose changes start a new group. */
  by: number;
  /** SUBTOTAL's function number (9 sum…). */
  fn: number;
  /** The columns added up. */
  cols: number[];
  /** Take away subtotals already there first (unset: keep them, nesting the new ones inside). */
  replace?: boolean;
  /** A page break after each group. */
  pageBreaks?: boolean;
  /** Totals above each group instead of below it. */
  above?: boolean;
}

const isSubtotalRow = (s: Sheet, r: number, R: Range) => {
  for (let c = R.c1; c <= R.c2; c++) if (/^=\s*SUBTOTAL\s*\(/i.test(s.cell(r, c)?.input ?? '')) return true;
  return false;
};

/** Remove All: the subtotal rows go, and the outline with them. Returns the table's block afterwards. */
export function removeSubtotals(s: Sheet, R: Range): Range {
  let r2 = R.r2;
  for (let r = R.r2; r > R.r1; r--) {
    if (!isSubtotalRow(s, r, R)) continue;
    s.deleteRows(r, 1);
    r2--;
  }
  const out = { ...R, r2 };
  for (let r = out.r1; r <= out.r2 + 1; r++) {
    if (s.rowLevels.has(r)) s.setRowLevel(r, 0);
    if (s.hiddenRows.has(r) && !s.filter) s.setRowHidden(r, false);
  }
  return out;
}

/**
 * Data > Subtotal: a row after (or before) each run of the same value in a column, with SUBTOTAL
 * of the chosen columns, and a Grand Total; the rows are grouped in an outline so the details
 * fold away. `R` is the table with its header row. Returns the table's block afterwards.
 */
export function addSubtotals(s: Sheet, R: Range, o: SubtotalOptions): Range | string {
  if (R.r2 <= R.r1) return 'Subtotal needs a table with a header row and rows of data under it.';
  if (!o.cols.length) return 'Tick at least one column to add a subtotal to.';
  let T = o.replace ? removeSubtotals(s, R) : { ...R };
  const key = (r: number) => s.shownText(r, o.by);
  const fnName = SUBTOTAL_FUNCTIONS.find(([, n]) => n === o.fn)?.[0] ?? 'Total';
  const label = (v: string) => (o.fn === 9 ? `${v} Total` : `${v} ${fnName}`);
  const deepest = Math.max(0, ...[...s.rowLevels.entries()].filter(([r]) => r > T.r1 && r <= T.r2).map(([, v]) => v));
  if (deepest + 2 > MAX_LEVEL) return 'The outline is seven levels deep already.';
  // groups of rows with the same value, top to bottom (existing subtotal rows end a group)
  const groups: [number, number][] = [];
  let start = -1;
  for (let r = T.r1 + 1; r <= T.r2 + 1; r++) {
    const end = r > T.r2 || isSubtotalRow(s, r, T) || (start >= 0 && key(r) !== key(start));
    if (start >= 0 && end) { groups.push([start, r - 1]); start = -1; }
    if (r <= T.r2 && !isSubtotalRow(s, r, T) && start < 0) start = r;
  }
  if (!groups.length) return 'There are no rows of data to add up.';
  const subtotalRow = (row: number, from: number, to: number, text: string) => {
    s.setInput(row, o.by, text);
    s.patchStyle({ r1: row, c1: o.by, r2: row, c2: o.by }, { bold: true });
    for (const c of o.cols) {
      const col = colName(c);
      s.setInput(row, c, `=SUBTOTAL(${o.fn},${col}${from + 1}:${col}${to + 1})`);
      s.patchStyle({ r1: row, c1: c, r2: row, c2: c }, { bold: true });
    }
  };
  // from the bottom up, so rows already placed don't move
  let added = 0;
  const firstData = T.r1 + 1;
  for (let i = groups.length - 1; i >= 0; i--) {
    let [a, b] = groups[i];
    const name = key(a);
    // the total sits at the level its rows were at, and they go one deeper
    const lv = s.rowLevels.get(a) ?? 0;
    const row = o.above ? a : b + 1;
    s.insertRows(row, 1);
    if (o.above) { a++; b++; }
    subtotalRow(row, a, b, label(name));
    s.setRowLevel(row, lv);
    for (let r = a; r <= b; r++) s.setRowLevel(r, (s.rowLevels.get(r) ?? 0) + 1);
    added++;
  }
  T = { ...T, r2: T.r2 + added };
  // the grand total, over everything (SUBTOTAL leaves the subtotals out)
  const grandRow = o.above ? firstData : T.r2 + 1;
  s.insertRows(grandRow, 1);
  T = { ...T, r2: T.r2 + 1 };
  const from = o.above ? firstData + 1 : firstData, to = o.above ? T.r2 : T.r2 - 1;
  subtotalRow(grandRow, from, to, o.fn === 9 ? 'Grand Total' : `Grand ${fnName}`);
  for (let r = from; r <= to; r++) s.setRowLevel(r, (s.rowLevels.get(r) ?? 0) + 1);
  if (o.above !== !!s.outline?.summaryAbove) s.setOutline({ ...s.outline, summaryAbove: o.above || undefined });
  if (o.pageBreaks) {
    const rowBreaks = new Set(s.pageSetup?.rowBreaks ?? []);
    for (let r = T.r1 + 1; r < T.r2; r++) {
      if (r === grandRow || !isSubtotalRow(s, r, T)) continue;
      const next = o.above ? r : r + 1;
      if (next > T.r1 + 1 && next < (o.above ? T.r2 + 1 : grandRow)) rowBreaks.add(next);
    }
    s.setPageSetup({ ...s.pageSetup, rowBreaks: [...rowBreaks].sort((a, b) => a - b) });
  }
  return T;
}
