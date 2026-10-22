// Solver on a sheet: the model's cells read from its references, its limits worked out by
// trying values in the variable cells (Workbook.whatIf), the answer written back, and Excel's
// Answer Report.

import type { Sheet, Workbook } from './workbook';
import { Range, keyOf, rowOf, colOf, cellName, colName } from './refs';
import { nameTarget } from './names';
import { formatValue } from './numfmt';
import { isError, type Value } from './values';
import { isBlock } from './args';
import { Problem, SolveResult, SolverModel, SolverRel, solve, STATUS_TEXT } from './solver';

/** The blocks a reference list names, on the sheet ("=$B$1:$B$3,$D$2"). */
export function refBlocks(text: string, s: Sheet): Range[] | string {
  const parts = text.replace(/^=/, '').split(',').map((t) => t.trim()).filter(Boolean);
  if (!parts.length) return 'Give the cells.';
  const out: Range[] = [];
  for (const p of parts) {
    const t = nameTarget(p);
    if (!t) return `"${p}" isn't a cell or block of cells.`;
    if (t.sheet && t.sheet.toLowerCase() !== s.name.toLowerCase()) return 'Solver works on the cells of one sheet: the variable cells and constraints must be on the sheet the objective is on.';
    out.push(t.range);
  }
  return out;
}

const cellsOf = (blocks: Range[]): number[] => {
  const keys: number[] = [];
  for (const R of blocks) for (let r = R.r1; r <= R.r2; r++) for (let c = R.c1; c <= R.c2; c++) keys.push(keyOf(r, c));
  return keys;
};

/** A plain number written as a limit (=10, 0.5), else null. */
const constantOf = (t: string | undefined): number | null => {
  if (t === undefined) return null;
  const x = t.trim().replace(/^=/, '');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(x) ? Number(x) : null;
};

/** One constraint, cell by cell: its left cell and how to read its right side. */
interface Row {
  lhs: number;
  rel: '<=' | '=' | '>=';
  /** A constant, a cell, or a formula worked out at the left cell. */
  rhs: { k: 'num'; v: number } | { k: 'cell'; key: number } | { k: 'formula'; f: string };
  /** For the report: the constraint as written. */
  text: string;
}

export interface Built {
  problem: Problem;
  vars: number[];
  objective: number;
  rows: Row[];
  /** Which of the constraints became bounds on the variables (they are reported too). */
  bounds: Row[];
  sign: number;
}

/** Turn a model on a sheet into numbers for the engines (or say what's wrong with it). */
export function buildProblem(wb: Workbook, s: Sheet, m: SolverModel): Built | string {
  const obj = refBlocks(m.objective, s);
  if (typeof obj === 'string') return `Objective: ${obj}`;
  if (obj.length !== 1 || obj[0].r1 !== obj[0].r2 || obj[0].c1 !== obj[0].c2) return 'The objective must be one cell.';
  const objective = keyOf(obj[0].r1, obj[0].c1);
  if (!s.formulas.has(objective)) return 'The objective cell must hold a formula (one that depends on the variable cells).';
  const vb = refBlocks(m.vars, s);
  if (typeof vb === 'string') return `Variable cells: ${vb}`;
  const vars = [...new Set(cellsOf(vb))];
  if (vars.length > 200) return 'Solver takes at most 200 variable cells.';
  for (const k of vars) {
    if (s.formulas.has(k)) return `Variable cell ${cellName(rowOf(k), colOf(k))} holds a formula: variable cells must hold numbers (or be empty).`;
    const v = s.values.get(k);
    if (v !== undefined && v !== null && typeof v !== 'number') return `Variable cell ${cellName(rowOf(k), colOf(k))} holds text: variable cells must hold numbers (or be empty).`;
  }
  const n = vars.length;
  const varIndex = new Map(vars.map((k, i) => [k, i]));
  const lower = new Array<number>(n).fill(-Infinity), upper = new Array<number>(n).fill(Infinity);
  const integer = new Array<boolean>(n).fill(false);
  const allDifferent: number[][] = [];
  const rows: Row[] = [];
  const bounds: Row[] = [];
  for (const c of m.constraints) {
    const lb = refBlocks(c.lhs, s);
    if (typeof lb === 'string') return `Constraint ${c.lhs}: ${lb}`;
    const lk = cellsOf(lb);
    if (c.rel === 'int' || c.rel === 'bin' || c.rel === 'dif') {
      const idx = lk.map((k) => varIndex.get(k));
      if (idx.some((i) => i === undefined)) return `${c.lhs}: whole-number, binary and all-different constraints can only be on variable cells.`;
      for (const i of idx as number[]) {
        integer[i] = true;
        if (c.rel === 'bin') { lower[i] = Math.max(lower[i], 0); upper[i] = Math.min(upper[i], 1); }
        if (c.rel === 'dif') { lower[i] = Math.max(lower[i], 1); upper[i] = Math.min(upper[i], lk.length); }
      }
      if (c.rel === 'dif') allDifferent.push(idx as number[]);
      continue;
    }
    const rel = c.rel as '<=' | '=' | '>=';
    const num = constantOf(c.rhs);
    let rhsCells: number[] | null = null;
    if (num === null) {
      const rb = refBlocks(c.rhs ?? '', s);
      if (typeof rb !== 'string') {
        const rk = cellsOf(rb);
        if (rk.length === lk.length) rhsCells = rk;
        else if (rk.length === 1) rhsCells = lk.map(() => rk[0]);
        else return `Constraint ${c.lhs} ${c.rel} ${c.rhs}: the two sides must be the same size (or the right one cell).`;
      } else if (!c.rhs?.trim()) return `Constraint ${c.lhs}: give its limit.`;
    }
    const text = `${c.lhs.replace(/^=/, '')} ${c.rel} ${(c.rhs ?? '').replace(/^=/, '')}`;
    lk.forEach((k, i) => {
      const row: Row = { lhs: k, rel, text, rhs: num !== null ? { k: 'num', v: num } : rhsCells ? { k: 'cell', key: rhsCells[i] } : { k: 'formula', f: c.rhs!.startsWith('=') ? c.rhs! : `=${c.rhs}` } };
      // a variable held to a number is a bound on it
      const vi = varIndex.get(k);
      if (vi !== undefined && num !== null) {
        if (rel !== '<=') lower[vi] = Math.max(lower[vi], num);
        if (rel !== '>=') upper[vi] = Math.min(upper[vi], num);
        bounds.push(row);
      } else rows.push(row);
    });
  }
  if (m.nonNegative) for (let i = 0; i < n; i++) if (lower[i] === -Infinity) lower[i] = 0;
  const sign = m.goal === 'max' ? -1 : 1;
  const limits = rows.map((r) => ({ rel: r.rel }));
  const valueLimit = m.goal === 'value';
  if (valueLimit) limits.push({ rel: '=' });
  const inputsFor = (x: number[]) => vars.map((key, i) => ({ s, key, value: x[i] as Value }));
  const num = (v: Value | undefined): number => (typeof v === 'number' ? v : v === null || v === undefined ? 0 : typeof v === 'boolean' ? (v ? 1 : 0) : NaN);
  const evaluate = (x: number[]) => wb.whatIf(inputsFor(x), () => {
    const fv = num(s.values.get(objective));
    const g = rows.map((r) => {
      const left = num(s.values.get(r.lhs));
      let right: number;
      if (r.rhs.k === 'num') right = r.rhs.v;
      else if (r.rhs.k === 'cell') right = num(s.values.get(r.rhs.key));
      else {
        const a = wb.formulaArg(s, r.rhs.f, rowOf(r.lhs), colOf(r.lhs));
        right = num(isBlock(a) ? a.block[0]?.[0] : (a as Value));
      }
      return left - right;
    });
    if (valueLimit) g.push(fv - (m.value ?? 0));
    return { f: valueLimit ? (Number.isFinite(fv) ? 0 : NaN) : sign * fv, g };
  });
  const x0 = vars.map((k) => {
    const v = s.values.get(k);
    return typeof v === 'number' ? v : 0;
  }).map((v, i) => Math.min(upper[i], Math.max(lower[i], v)));
  const now = Date.now();
  const maxTime = m.maxTime && m.maxTime < 1e6 ? m.maxTime : 30;
  const problem: Problem = {
    n, x0, lower, upper, integer: m.ignoreInt ? integer.map(() => false) : integer, allDifferent: m.ignoreInt ? [] : allDifferent, limits, evaluate,
    precision: m.precision ?? 1e-6, intTolerance: m.intTolerance ?? 0.01, convergence: m.convergence ?? 1e-4,
    deadline: now + maxTime * 1000, maxEvaluations: m.maxIterations && m.maxIterations < 1e7 ? Math.max(1000, m.maxIterations * 50) : 200000,
    population: m.population ?? 100, seed: m.seed ?? 0,
  };
  return { problem, vars, objective, rows, bounds, sign };
}

export interface SolverRun {
  built: Built;
  result: SolveResult;
  /** The values the variable cells and objective had before. */
  before: { x: number[]; objective: Value };
  message: string;
  /** Whether the answer is worth keeping (Excel offers Keep Solver Solution either way). */
  ok: boolean;
}

/** Solve a model on a sheet. Nothing on the sheet changes: the caller writes the answer in (see keepAnswer). */
export function runSolver(wb: Workbook, s: Sheet, m: SolverModel): SolverRun | string {
  const built = buildProblem(wb, s, m);
  if (typeof built === 'string') return built;
  const before = { x: built.vars.map((k) => { const v = s.values.get(k); return typeof v === 'number' ? v : 0; }), objective: s.values.get(built.objective) ?? null };
  const result = solve(built.problem, m.engine);
  const ok = result.status === 'optimal' || result.status === 'converged' || result.status === 'limit';
  return { built, result, before, ok, message: result.message ?? STATUS_TEXT[result.status] };
}

/** Write the answer into the variable cells (inside an edit). */
export function keepAnswer(s: Sheet, run: SolverRun): void {
  run.built.vars.forEach((k, i) => {
    const v = run.result.x[i];
    const c = s.cells.get(k);
    s.setCell(rowOf(k), colOf(k), { ...c, input: String(+v.toPrecision(15)) });
  });
}

/**
 * Excel's Answer Report, as rows of cells: the objective's original and final values, each
 * variable's, and each constraint with its value, formula, status (Binding or Not Binding) and
 * slack. Read after the answer is kept, so the final values are the sheet's.
 */
export function answerReport(s: Sheet, m: SolverModel, run: SolverRun, when: Date): (Value)[][] {
  const out: Value[][] = [];
  const name = (k: number) => {
    // the label to the left of the cell, as Excel names cells in its reports
    const r = rowOf(k), c = colOf(k);
    for (let cc = c - 1; cc >= 0; cc--) { const v = s.values.get(keyOf(r, cc)); if (typeof v === 'string' && v) return v; }
    for (let rr = r - 1; rr >= 0; rr--) { const v = s.values.get(keyOf(rr, c)); if (typeof v === 'string' && v) return v; }
    return '';
  };
  const addr = (k: number) => `$${colName(colOf(k))}$${rowOf(k) + 1}`;
  const show = (v: Value | undefined) => (v === undefined ? null : v);
  out.push(['Answer Report']);
  out.push([`Worksheet: [${s.name}]`]);
  out.push([`Report Created: ${when.toLocaleString()}`]);
  out.push([`Result: ${run.message}`]);
  out.push([`Solver Engine: ${m.engine === 'simplex' ? 'Simplex LP' : m.engine === 'evolutionary' ? 'Evolutionary' : 'GRG Nonlinear'}`]);
  out.push([`Solution Time: ${((Date.now() - (when.getTime())) / 1000).toFixed(3)} Seconds. Evaluations: ${run.result.evaluations}`]);
  out.push([]);
  out.push([`Objective Cell (${m.goal === 'max' ? 'Max' : m.goal === 'min' ? 'Min' : `Value Of ${m.value ?? 0}`})`]);
  out.push([null, 'Cell', 'Name', 'Original Value', 'Final Value']);
  out.push([null, addr(run.built.objective), name(run.built.objective), show(run.before.objective), show(s.values.get(run.built.objective))]);
  out.push([]);
  out.push(['Variable Cells']);
  out.push([null, 'Cell', 'Name', 'Original Value', 'Final Value', 'Integer']);
  run.built.vars.forEach((k, i) => out.push([null, addr(k), name(k), run.before.x[i], show(s.values.get(k)), run.built.problem.integer[i] ? 'Integer' : 'Contin']));
  out.push([]);
  out.push(['Constraints']);
  out.push([null, 'Cell', 'Name', 'Cell Value', 'Formula', 'Status', 'Slack']);
  for (const r of [...run.built.rows, ...run.built.bounds]) {
    const left = s.values.get(r.lhs);
    const right = r.rhs.k === 'num' ? r.rhs.v : r.rhs.k === 'cell' ? s.values.get(r.rhs.key) : null;
    const slack = typeof left === 'number' && typeof right === 'number' ? Math.abs(left - right) : null;
    const binding = slack !== null && slack <= Math.max(1e-6, (run.built.problem.precision) * Math.max(1, Math.abs(typeof right === 'number' ? right : 0)));
    const formula = `${addr(r.lhs)}${r.rel}${r.rhs.k === 'num' ? r.rhs.v : r.rhs.k === 'cell' ? addr(r.rhs.key) : r.rhs.f.replace(/^=/, '')}`;
    out.push([null, addr(r.lhs), name(r.lhs), show(left), formula, binding ? 'Binding' : 'Not Binding', slack]);
  }
  for (const c of m.constraints) if (c.rel === 'int' || c.rel === 'bin' || c.rel === 'dif') out.push([null, `${c.lhs.replace(/^=/, '')}=${c.rel === 'int' ? 'Integer' : c.rel === 'bin' ? 'Binary' : 'AllDifferent'}`]);
  return out;
}

/** How a value reads in a message (the objective's final value). */
export const valueText = (v: Value | undefined): string => (v === undefined || v === null ? '' : isError(v) ? v.code : formatValue(v).text);

/** The relation's text in the window's list ("<=", "int"…). */
export const REL_TEXT: Record<SolverRel, string> = { '<=': '<=', '=': '=', '>=': '>=', int: 'int', bin: 'bin', dif: 'dif' };

/** A model's constraints as the Solver window lists them ("$B$4 <= 10"). */
export const constraintText = (c: SolverModel['constraints'][number]): string =>
  `${c.lhs.replace(/^=/, '')} ${REL_TEXT[c.rel]} ${c.rel === 'int' ? 'integer' : c.rel === 'bin' ? 'binary' : c.rel === 'dif' ? 'AllDifferent' : (c.rhs ?? '').replace(/^=/, '')}`;
