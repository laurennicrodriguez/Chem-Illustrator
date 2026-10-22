// What-If Analysis, as Excel's Data tab has it: Goal Seek (find the value of one cell that makes
// a formula give a target) and Data Tables (a block of results for a list of values tried in
// one input cell, or every pair of values tried in two). Both try values without changing the
// sheet: the workbook works out what the formulas would give and puts everything back (see
// Workbook.whatIf). Solver, which tries many cells at once, is in solver.ts.

import type { Range } from './refs';

/**
 * A data table (Excel's {=TABLE(row_input, col_input)}): the block of results it fills. Its
 * input values are in the row above and the column to the left of the results; the formulas
 * whose results it shows are in the top-left corner (two inputs), along the top row (an input
 * for the column of values), or down the left column (an input for the row of values).
 */
export interface DataTable {
  id: number;
  /** The result cells (not the values tried or the formulas). */
  ref: Range;
  /** Where the values along the top row are put in, as a reference ("=$B$1"). */
  rowInput?: string;
  /** Where the values down the left column are put in. */
  colInput?: string;
}

let nextId = 1;
export const newDataTableId = (): number => nextId++;
export const seenDataTableId = (id: number): void => { if (id >= nextId) nextId = id + 1; };

/** For one result cell of a data table: the cell whose formula gives it, and the values to put in each input. */
export interface DataTableCell {
  /** The formula's cell. */
  formula: { row: number; col: number };
  /** The cells the values come from (row input's, column input's). */
  rowValue?: { row: number; col: number };
  colValue?: { row: number; col: number };
}

/** Where a data table's result cell gets its formula and its input values. */
export function dataTableCell(t: DataTable, row: number, col: number): DataTableCell {
  const R = t.ref;
  if (t.rowInput && t.colInput) {
    return { formula: { row: R.r1 - 1, col: R.c1 - 1 }, rowValue: { row: R.r1 - 1, col }, colValue: { row, col: R.c1 - 1 } };
  }
  if (t.colInput) return { formula: { row: R.r1 - 1, col }, colValue: { row, col: R.c1 - 1 } };
  return { formula: { row, col: R.c1 - 1 }, rowValue: { row: R.r1 - 1, col } };
}

/**
 * The data table Excel would make of a selected block: its result cells, or why it can't. A
 * block for one input needs a row and a column of values and formulas; for two, a formula in
 * its top-left corner as well.
 */
export function dataTableRef(sel: Range): Range | string {
  if (sel.r2 <= sel.r1 || sel.c2 <= sel.c1) return 'Select the whole table: the values to try, the formulas, and the cells for the results (at least two rows and two columns).';
  return { r1: sel.r1 + 1, c1: sel.c1 + 1, r2: sel.r2, c2: sel.c2 };
}

// ---------------------------------------------------------------- Goal Seek

export interface GoalSeekResult {
  /** The value found for the changing cell (the best tried, when no exact answer was found). */
  x: number;
  /** What the formula gives with it. */
  y: number;
  found: boolean;
  steps: number;
}

/**
 * Find x where f(x) = target, starting from x0, as Goal Seek does: steps along the slope (a
 * secant), and when a sign change brackets the answer, a safe mix of secant and bisection within
 * it. Stops when the formula is within `tolerance` of the target (Excel's default 0.001), or
 * after `maxSteps` tries (Excel's 100).
 */
export function goalSeek(f: (x: number) => number, target: number, x0: number, tolerance = 0.001, maxSteps = 100): GoalSeekResult {
  const g = (x: number) => f(x) - target;
  let best = { x: x0, y: f(x0) };
  let steps = 1;
  const better = (x: number, y: number) => { if (Number.isFinite(y) && (!Number.isFinite(best.y) || Math.abs(y - target) < Math.abs(best.y - target))) best = { x, y }; };
  if (Math.abs(best.y - target) <= tolerance) return { ...best, found: true, steps };
  let a = x0, ga = best.y - target;
  // a first step a little way off the start, to read the slope
  let b = x0 === 0 ? 0.01 : x0 * 1.01, gb = g(b);
  steps++;
  better(b, gb + target);
  let lo: number | null = null, hi: number | null = null, glo = 0;
  const bracket = (x1: number, g1: number, x2: number, g2: number) => {
    if (Number.isFinite(g1) && Number.isFinite(g2) && Math.sign(g1) !== Math.sign(g2)) { lo = x1; glo = g1; hi = x2; }
  };
  bracket(a, ga, b, gb);
  while (steps < maxSteps) {
    if (Math.abs(gb) <= tolerance) return { x: b, y: gb + target, found: true, steps };
    let next: number;
    if (lo !== null && hi !== null) {
      // inside a bracket: the secant step if it lands inside, else halve it
      const s = Number.isFinite(ga) && gb !== ga ? b - (gb * (b - a)) / (gb - ga) : NaN;
      const L = Math.min(lo, hi), H = Math.max(lo, hi);
      next = s > L && s < H ? s : (lo + hi) / 2;
    } else if (Number.isFinite(ga) && Number.isFinite(gb) && gb !== ga) {
      next = b - (gb * (b - a)) / (gb - ga);
      // don't leap too far at once
      const span = Math.max(Math.abs(b - a) * 100, Math.abs(b) * 10, 1);
      if (Math.abs(next - b) > span) next = b + Math.sign(next - b) * span;
    } else {
      // flat, or the formula failed: look further away
      next = b + (b - a || 1) * 2;
    }
    if (!Number.isFinite(next)) break;
    const gn = g(next);
    steps++;
    better(next, gn + target);
    if (lo !== null && hi !== null) {
      if (Number.isFinite(gn) && Math.sign(gn) === Math.sign(glo)) { lo = next; glo = gn; } else hi = next;
    } else bracket(b, gb, next, gn);
    a = b; ga = gb; b = next; gb = gn;
    if (lo !== null && hi !== null && Math.abs(hi - lo) <= 1e-15 * Math.max(1, Math.abs(hi))) break;
  }
  return { ...best, found: Math.abs(best.y - target) <= tolerance, steps };
}
