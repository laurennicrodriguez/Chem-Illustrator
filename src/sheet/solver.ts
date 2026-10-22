// Solver, as Excel's Data tab has it: change some cells (the variables) to make one cell (the
// objective) as large or as small as it can be, or equal to a value, while other cells keep to
// limits (constraints: ≤, =, ≥, whole numbers, 0 or 1, all different). Three engines, as Excel
// has: Simplex LP for linear models (exact, with branch and bound for whole numbers), GRG
// Nonlinear for smooth models (here an augmented Lagrangian over a bounded quasi-Newton search),
// and Evolutionary (differential evolution) for anything else.
//
// The model is kept as Excel keeps it, in hidden names on the sheet (solver_opt, solver_adj,
// solver_lhs1…), so a model set up in either program opens in the other.

import type { DefinedName } from './names';
import type { Sheet } from './workbook';
import { quoteSheet } from './refs';

export type SolverRel = '<=' | '=' | '>=' | 'int' | 'bin' | 'dif';
export type SolverEngine = 'grg' | 'simplex' | 'evolutionary';

export interface SolverConstraint {
  /** The cells held to the limit ("=$B$4" or "=$B$4:$B$6"). */
  lhs: string;
  rel: SolverRel;
  /** The limit: a number, a cell or block the same size, or a formula ("=10", "=$C$4:$C$6"); unset for int, bin and dif. */
  rhs?: string;
}

export interface SolverModel {
  objective: string;
  goal: 'max' | 'min' | 'value';
  value?: number;
  /** The variable cells ("=$B$1:$B$3", or several blocks with commas). */
  vars: string;
  constraints: SolverConstraint[];
  /** Make Unconstrained Variables Non-Negative (on in Excel's window). */
  nonNegative: boolean;
  engine: SolverEngine;
  /** Constraint Precision (0.000001). */
  precision?: number;
  /** Integer Optimality, as a fraction (Excel's 1% is 0.01). */
  intTolerance?: number;
  /** Convergence for GRG and Evolutionary (0.0001). */
  convergence?: number;
  /** Limits: seconds and iterations (or subproblems). */
  maxTime?: number;
  maxIterations?: number;
  /** Evolutionary population size and random seed (0: a new one each time). */
  population?: number;
  seed?: number;
  /** Ignore Integer Constraints (solve the relaxed model). */
  ignoreInt?: boolean;
}

export const defaultModel = (): SolverModel => ({ objective: '', goal: 'max', vars: '', constraints: [], nonNegative: true, engine: 'grg' });

// ---------------------------------------------------------------- kept as Excel keeps it

const REL_CODE: Record<SolverRel, number> = { '<=': 1, '=': 2, '>=': 3, int: 4, bin: 5, dif: 6 };
const CODE_REL: Record<number, SolverRel> = { 1: '<=', 2: '=', 3: '>=', 4: 'int', 5: 'bin', 6: 'dif' };
const ENGINE_CODE: Record<SolverEngine, number> = { grg: 1, simplex: 2, evolutionary: 3 };

/** The hidden names Excel's Solver keeps its model in, for one sheet. */
/** One area of cells ($B$1 or $B$1:$C$4), with no sheet named. */
const AREA = /^\$?[A-Za-z]{1,3}\$?\d+(?::\$?[A-Za-z]{1,3}\$?\d+)?$/;

/** References with their sheet's name, as Excel's Solver writes them (Model!$B$1); anything else as it is. */
function withSheet(formula: string, sheet: string): string {
  const body = formula.replace(/^=/, '');
  const areas = body.split(',');
  if (!areas.every((a) => AREA.test(a.trim()))) return formula;
  return '=' + areas.map((a) => `${quoteSheet(sheet)}!${a.trim()}`).join(',');
}

/** References on the model's own sheet without its name (as the Solver window shows them). */
function ownSheet(formula: string, sheet: string): string {
  const prefix = `${quoteSheet(sheet)}!`.toLowerCase();
  const body = formula.replace(/^=/, '');
  const areas = body.split(',');
  if (!areas.every((a) => a.trim().toLowerCase().startsWith(prefix) && AREA.test(a.trim().slice(prefix.length)))) return formula;
  return '=' + areas.map((a) => a.trim().slice(prefix.length)).join(',');
}

export function modelNames(m: SolverModel, sheet: Sheet): DefinedName[] {
  const name = (n: string, formula: string): DefinedName => {
    const f = formula.startsWith('=') ? formula : `=${formula}`;
    return { name: n, formula: /^solver_(adj|opt|lhs\d+|rhs\d+)$/.test(n) ? withSheet(f, sheet.name) : f, sheet, hidden: true };
  };
  const num = (x: number) => String(x);
  const out: DefinedName[] = [
    name('solver_adj', m.vars),
    name('solver_cvg', num(m.convergence ?? 0.0001)),
    name('solver_drv', '1'),
    name('solver_eng', num(ENGINE_CODE[m.engine])),
    name('solver_est', '1'),
    name('solver_itr', num(m.maxIterations ?? 2147483647)),
    name('solver_lin', m.engine === 'simplex' ? '1' : '2'),
    name('solver_mip', '2147483647'),
    name('solver_mni', '30'),
    name('solver_mrt', '0.075'),
    name('solver_msl', '2'),
    name('solver_neg', m.nonNegative ? '1' : '2'),
    name('solver_nod', '2147483647'),
    name('solver_num', num(m.constraints.length)),
    name('solver_nwt', '1'),
    name('solver_opt', m.objective),
    name('solver_pre', num(m.precision ?? 0.000001)),
    name('solver_rbv', '1'),
    name('solver_rlx', m.ignoreInt ? '1' : '2'),
    name('solver_rsd', num(m.seed ?? 0)),
    name('solver_scl', '1'),
    name('solver_sho', '2'),
    name('solver_ssz', num(m.population ?? 100)),
    name('solver_tim', num(m.maxTime ?? 2147483647)),
    name('solver_tol', num(m.intTolerance ?? 0.01)),
    name('solver_typ', num(m.goal === 'max' ? 1 : m.goal === 'min' ? 2 : 3)),
    name('solver_val', num(m.value ?? 0)),
    name('solver_ver', '3'),
  ];
  m.constraints.forEach((c, i) => {
    out.push(name(`solver_lhs${i + 1}`, c.lhs));
    out.push(name(`solver_rel${i + 1}`, num(REL_CODE[c.rel])));
    // whole-number, binary and all-different constraints name their kind as Excel writes it
    out.push(name(`solver_rhs${i + 1}`, c.rel === 'int' ? '"integer"' : c.rel === 'bin' ? '"binary"' : c.rel === 'dif' ? '"AllDifferent"' : c.rhs ?? '0'));
  });
  return out;
}

/** Is a name one of Solver's own? */
export const isSolverName = (n: string): boolean => /^solver_/i.test(n);

/** The model kept in a sheet's hidden names (null when there is none). */
export function modelFromNames(names: readonly DefinedName[], sheet: Sheet): SolverModel | null {
  const get = (n: string) => {
    const f = names.find((x) => x.sheet === sheet && x.name.toLowerCase() === n)?.formula;
    return f === undefined ? f : ownSheet(f, sheet.name);
  };
  const numOf = (n: string, dflt: number) => {
    const f = get(n);
    const v = f === undefined ? NaN : Number(f.replace(/^=/, ''));
    return Number.isFinite(v) ? v : dflt;
  };
  const opt = get('solver_opt'), adj = get('solver_adj');
  if (opt === undefined && adj === undefined) return null;
  const typ = numOf('solver_typ', 1);
  const eng = numOf('solver_eng', numOf('solver_lin', 2) === 1 ? 2 : 1);
  const constraints: SolverConstraint[] = [];
  const count = numOf('solver_num', 0);
  for (let i = 1; i <= count; i++) {
    const lhs = get(`solver_lhs${i}`);
    const rel = CODE_REL[numOf(`solver_rel${i}`, 1)];
    if (!lhs || !rel) continue;
    const rhs = get(`solver_rhs${i}`);
    constraints.push(rel === 'int' || rel === 'bin' || rel === 'dif' ? { lhs, rel } : { lhs, rel, rhs: rhs ?? '=0' });
  }
  return {
    objective: opt ?? '', goal: typ === 2 ? 'min' : typ === 3 ? 'value' : 'max', value: numOf('solver_val', 0), vars: adj ?? '',
    constraints, nonNegative: numOf('solver_neg', 1) === 1, engine: eng === 2 ? 'simplex' : eng === 3 ? 'evolutionary' : 'grg',
    precision: numOf('solver_pre', 0.000001), intTolerance: numOf('solver_tol', 0.01), convergence: numOf('solver_cvg', 0.0001),
    maxTime: numOf('solver_tim', 2147483647), maxIterations: numOf('solver_itr', 2147483647), population: numOf('solver_ssz', 100),
    seed: numOf('solver_rsd', 0), ignoreInt: numOf('solver_rlx', 2) === 1,
  };
}

// ---------------------------------------------------------------- the problem, as numbers

/** One limit on the model, as numbers: g(x) rel 0, where g is the left side less the right. */
export interface Limit {
  rel: '<=' | '=' | '>=';
}

/** What the engines solve: minimise f(x) subject to limits g_i(x) (≤ 0, = 0 or ≥ 0) and bounds. */
export interface Problem {
  n: number;
  x0: number[];
  lower: number[];
  upper: number[];
  integer: boolean[];
  /** Groups of variables that must all differ (and be 1…k). */
  allDifferent: number[][];
  limits: Limit[];
  /** The objective (to minimise) and each limit's g (left less right), at x; NaN for an error. */
  evaluate(x: number[]): { f: number; g: number[] };
  precision: number;
  intTolerance: number;
  convergence: number;
  /** Stops after this many milliseconds, or evaluations. */
  deadline: number;
  maxEvaluations: number;
  population: number;
  seed: number;
}

export type SolveStatus =
  | 'optimal' // found a solution: all constraints and optimality conditions satisfied
  | 'converged' // converged to the current solution (GRG / Evolutionary)
  | 'infeasible' // could not find a feasible solution
  | 'unbounded' // the objective does not converge
  | 'notLinear' // the linearity conditions for Simplex LP are not satisfied
  | 'limit' // stopped at the time or iteration limit
  | 'error'; // an error value in the objective or a constraint

export interface SolveResult {
  status: SolveStatus;
  x: number[];
  f: number;
  g: number[];
  evaluations: number;
  message?: string;
}

/** Excel's words for each outcome, as the Solver Results window shows them. */
export const STATUS_TEXT: Record<SolveStatus, string> = {
  optimal: 'Solver found a solution. All Constraints and optimality conditions are satisfied.',
  converged: 'Solver has converged to the current solution. All Constraints are satisfied.',
  infeasible: 'Solver could not find a feasible solution.',
  unbounded: 'The Objective Cell values do not converge.',
  notLinear: 'The linearity conditions required by this LP Solver are not satisfied.',
  limit: 'Solver stopped at the limit you set (time or iterations), with the best solution it had found.',
  error: 'Solver encountered an error value in the Objective Cell or a Constraint cell.',
};

/** How far x breaks the limits and bounds (0 when it keeps them all). */
export function violation(p: Problem, x: number[], g: number[]): number {
  let v = 0;
  p.limits.forEach((l, i) => {
    const gi = g[i];
    if (!Number.isFinite(gi)) { v = Infinity; return; }
    if (l.rel === '<=') v = Math.max(v, gi);
    else if (l.rel === '>=') v = Math.max(v, -gi);
    else v = Math.max(v, Math.abs(gi));
  });
  for (let j = 0; j < p.n; j++) v = Math.max(v, p.lower[j] - x[j], x[j] - p.upper[j]);
  return Math.max(0, v);
}

class Counter {
  evaluations = 0;
  start = Date.now();
  constructor(private p: Problem) {}
  eval(x: number[]) { this.evaluations++; return this.p.evaluate(x); }
  get out(): boolean { return this.evaluations >= this.p.maxEvaluations || Date.now() > this.p.deadline; }
}

export function solve(p: Problem, engine: SolverEngine): SolveResult {
  const ctr = new Counter(p);
  if (p.allDifferent.length && engine !== 'evolutionary') {
    return { status: 'error', x: p.x0, f: NaN, g: [], evaluations: 0, message: 'An all-different (dif) constraint needs the Evolutionary engine.' };
  }
  const first = ctr.eval(p.x0);
  if (!Number.isFinite(first.f)) return { status: 'error', x: p.x0, f: first.f, g: first.g, evaluations: 1 };
  if (engine === 'simplex') return simplexEngine(p, ctr, first);
  if (engine === 'evolutionary') return evolutionary(p, ctr);
  const anyInt = p.integer.some(Boolean);
  return anyInt ? branchAndBound(p, ctr, (lo, hi, start) => grg({ ...p, lower: lo, upper: hi, x0: start }, ctr)) : grg(p, ctr);
}

// ---------------------------------------------------------------- Simplex LP

function simplexEngine(p: Problem, ctr: Counter, base: { f: number; g: number[] }): SolveResult {
  const n = p.n, m = p.limits.length;
  // the slopes, by a unit step in each variable from the start
  const x0 = p.x0;
  const c: number[] = [], A: number[][] = Array.from({ length: m }, () => new Array<number>(n).fill(0));
  for (let j = 0; j < n; j++) {
    const x = [...x0];
    x[j] += 1;
    const e = ctr.eval(x);
    if (!Number.isFinite(e.f) || e.g.some((v) => !Number.isFinite(v))) return { status: 'error', x: x0, f: base.f, g: base.g, evaluations: ctr.evaluations };
    c.push(e.f - base.f);
    for (let i = 0; i < m; i++) A[i][j] = e.g[i] - base.g[i];
  }
  // the model must be linear: check at another point
  const scale = (v: number) => Math.max(1, Math.abs(v));
  const probe = x0.map((v, j) => v + (j % 3 === 0 ? 1.7 : j % 3 === 1 ? -0.6 : 2.3));
  const e = ctr.eval(probe);
  const lin = (val: number, b0: number, row: number[]) => b0 + row.reduce((s, a, j) => s + a * (probe[j] - x0[j]), 0) - val;
  if (Math.abs(lin(e.f, base.f, c)) > 1e-6 * scale(e.f) || A.some((row, i) => Math.abs(lin(e.g[i], base.g[i], row)) > 1e-6 * scale(e.g[i]))) {
    return { status: 'notLinear', x: x0, f: base.f, g: base.g, evaluations: ctr.evaluations };
  }
  // g(x) = g0 + A (x − x0): limits A x rel A x0 − g0
  const b = A.map((row, i) => row.reduce((s, a, j) => s + a * x0[j], 0) - base.g[i]);
  const f0 = base.f - c.reduce((s, cj, j) => s + cj * x0[j], 0);
  const relax = (lo: number[], hi: number[]): SolveResult => {
    const r = lp(c, A, b, p.limits.map((l) => l.rel), lo, hi);
    if (r.status !== 'optimal') return { status: r.status, x: x0, f: NaN, g: [], evaluations: ctr.evaluations };
    return { status: 'optimal', x: r.x, f: f0 + r.value, g: [], evaluations: ctr.evaluations };
  };
  const res = p.integer.some(Boolean) ? branchAndBound(p, ctr, (lo, hi) => relax(lo, hi)) : relax(p.lower, p.upper);
  if (res.status !== 'optimal' && res.status !== 'limit') return { ...res, x: x0, f: base.f, g: base.g };
  // the answer worked out on the sheet itself (and snapped to whole numbers where it should be)
  const x = res.x.map((v, j) => (p.integer[j] ? Math.round(v) : Math.abs(v) < 1e-12 ? 0 : v));
  const fin = ctr.eval(x);
  return { status: res.status, x, f: fin.f, g: fin.g, evaluations: ctr.evaluations };
}

/**
 * A linear programme: minimise c·x with each row of A x (≤, =, ≥) b and lo ≤ x ≤ hi, by the
 * two-phase simplex method on a dense tableau (Bland's rule, so it can't cycle). Variables
 * without a lower bound are split into two.
 */
export function lp(c: number[], A: number[][], b: number[], rel: ('<=' | '=' | '>=')[], lo: number[], hi: number[]): { status: 'optimal' | 'infeasible' | 'unbounded'; x: number[]; value: number } {
  const n = c.length;
  // x_j = lo_j + y_j (y ≥ 0), or y⁺ − y⁻ when there is no lower bound
  const cols: { j: number; sign: number }[] = [];
  const shift = lo.map((l) => (Number.isFinite(l) ? l : 0));
  for (let j = 0; j < n; j++) {
    cols.push({ j, sign: 1 });
    if (!Number.isFinite(lo[j])) cols.push({ j, sign: -1 });
  }
  const rows: { a: number[]; rel: '<=' | '=' | '>='; b: number }[] = [];
  A.forEach((row, i) => {
    const rhs = b[i] - row.reduce((s, a, j) => s + a * shift[j], 0);
    rows.push({ a: cols.map((k) => row[k.j] * k.sign), rel: rel[i], b: rhs });
  });
  // upper bounds become rows
  for (let j = 0; j < n; j++) {
    if (!Number.isFinite(hi[j])) continue;
    if (hi[j] < lo[j]) return { status: 'infeasible', x: [], value: NaN };
    rows.push({ a: cols.map((k) => (k.j === j ? k.sign : 0)), rel: '<=', b: hi[j] - shift[j] });
  }
  // right-hand sides made non-negative
  for (const r of rows) if (r.b < 0) { r.a = r.a.map((v) => -v); r.b = -r.b; r.rel = r.rel === '<=' ? '>=' : r.rel === '>=' ? '<=' : '='; }
  const nv = cols.length, m = rows.length;
  // columns: variables, slacks / surpluses, artificials
  const nSlack = rows.filter((r) => r.rel !== '=').length;
  const nArt = rows.filter((r) => r.rel !== '<=').length;
  const W = nv + nSlack + nArt;
  const T: number[][] = [];
  const basis: number[] = [];
  let si = nv, ai = nv + nSlack;
  for (const r of rows) {
    const row = new Array<number>(W + 1).fill(0);
    r.a.forEach((v, j) => (row[j] = v));
    if (r.rel === '<=') { row[si] = 1; basis.push(si++); }
    else if (r.rel === '>=') { row[si++] = -1; row[ai] = 1; basis.push(ai++); }
    else { row[ai] = 1; basis.push(ai++); }
    row[W] = r.b;
    T.push(row);
  }
  const pivot = (pr: number, pc: number) => {
    const pv = T[pr][pc];
    for (let k = 0; k <= W; k++) T[pr][k] /= pv;
    for (let i = 0; i < m; i++) {
      if (i === pr || T[i][pc] === 0) continue;
      const f = T[i][pc];
      for (let k = 0; k <= W; k++) T[i][k] -= f * T[pr][k];
    }
    basis[pr] = pc;
  };
  const EPS = 1e-9;
  /** Simplex iterations for the objective `obj` (costs by column); false when unbounded. */
  const run = (obj: number[], allowed: (k: number) => boolean): boolean => {
    for (let iter = 0; iter < 50000; iter++) {
      // reduced costs
      let enter = -1;
      for (let k = 0; k < W; k++) {
        if (!allowed(k) || basis.includes(k)) continue;
        let rc = obj[k];
        for (let i = 0; i < m; i++) rc -= obj[basis[i]] * T[i][k];
        if (rc < -EPS) { enter = k; break; }
      }
      if (enter < 0) return true;
      let leave = -1, best = Infinity;
      for (let i = 0; i < m; i++) {
        if (T[i][enter] > EPS) {
          const ratio = T[i][W] / T[i][enter];
          if (ratio < best - EPS || (Math.abs(ratio - best) <= EPS && basis[i] < basis[leave])) { best = ratio; leave = i; }
        }
      }
      if (leave < 0) return false;
      pivot(leave, enter);
    }
    return true;
  };
  // phase 1: drive the artificials out
  if (nArt) {
    const obj1 = new Array<number>(W).fill(0);
    for (let k = nv + nSlack; k < W; k++) obj1[k] = 1;
    run(obj1, () => true);
    let infeas = 0;
    for (let i = 0; i < m; i++) if (basis[i] >= nv + nSlack) infeas += T[i][W];
    if (infeas > 1e-7 * Math.max(1, ...rows.map((r) => Math.abs(r.b)))) return { status: 'infeasible', x: [], value: NaN };
    // artificials left in the basis at zero: pivot them out where a real column can take their place
    for (let i = 0; i < m; i++) {
      if (basis[i] < nv + nSlack) continue;
      let k = 0;
      while (k < nv + nSlack && Math.abs(T[i][k]) <= EPS) k++;
      if (k < nv + nSlack) pivot(i, k);
    }
  }
  const obj2 = new Array<number>(W).fill(0);
  cols.forEach((k, idx) => (obj2[idx] = c[k.j] * k.sign));
  if (!run(obj2, (k) => k < nv + nSlack)) return { status: 'unbounded', x: [], value: NaN };
  const y = new Array<number>(W).fill(0);
  for (let i = 0; i < m; i++) y[basis[i]] = T[i][W];
  const x = shift.slice();
  cols.forEach((k, idx) => (x[k.j] += k.sign * y[idx]));
  const value = c.reduce((s, cj, j) => s + cj * x[j], 0);
  return { status: 'optimal', x, value };
}

// ---------------------------------------------------------------- whole numbers: branch and bound

function branchAndBound(p: Problem, ctr: Counter, relaxed: (lo: number[], hi: number[], start: number[]) => SolveResult): SolveResult {
  const ints = p.integer.map((v, j) => (v ? j : -1)).filter((j) => j >= 0);
  let best: SolveResult | null = null;
  let hitLimit = false;
  const stack: { lo: number[]; hi: number[]; start: number[] }[] = [{ lo: p.lower.slice(), hi: p.upper.slice(), start: p.x0.slice() }];
  let nodes = 0;
  while (stack.length) {
    if (ctr.out || nodes > 5000) { hitLimit = true; break; }
    nodes++;
    const node = stack.pop()!;
    const r = relaxed(node.lo, node.hi, node.start);
    if (r.status !== 'optimal' && r.status !== 'converged') {
      if (r.status === 'unbounded' && !best) return r;
      continue;
    }
    // no better than the best whole-number answer so far (within Integer Optimality)
    if (best && r.f >= best.f - p.intTolerance * Math.abs(best.f) - 1e-12) continue;
    let branch = -1, far = 0;
    for (const j of ints) {
      const d = Math.abs(r.x[j] - Math.round(r.x[j]));
      if (d > 1e-6 && d > far) { far = d; branch = j; }
    }
    if (branch < 0) { best = { ...r, x: r.x.map((v, j) => (p.integer[j] ? Math.round(v) : v)) }; continue; }
    const v = r.x[branch];
    const down = { lo: node.lo.slice(), hi: node.hi.slice(), start: r.x.slice() };
    down.hi[branch] = Math.floor(v);
    const up = { lo: node.lo.slice(), hi: node.hi.slice(), start: r.x.slice() };
    up.lo[branch] = Math.ceil(v);
    // the nearer side first
    if (v - Math.floor(v) < 0.5) stack.push(up, down); else stack.push(down, up);
  }
  if (!best) return { status: hitLimit ? 'limit' : 'infeasible', x: p.x0, f: NaN, g: [], evaluations: ctr.evaluations };
  return { ...best, status: hitLimit ? 'limit' : best.status, evaluations: ctr.evaluations };
}

// ---------------------------------------------------------------- GRG Nonlinear

/**
 * Smooth models: an augmented Lagrangian (limits folded into the objective with multipliers
 * that are improved each round), each round minimised by a quasi-Newton (BFGS) search kept
 * inside the variables' bounds, with gradients from small steps (central differences).
 */
function grg(p: Problem, ctr: Counter): SolveResult {
  const clamp = (x: number[]) => x.map((v, j) => Math.min(p.upper[j], Math.max(p.lower[j], v)));
  let x = clamp(p.x0);
  const lambda = new Array<number>(p.limits.length).fill(0);
  let rho = 10;
  let cur = ctr.eval(x);
  if (!Number.isFinite(cur.f)) return { status: 'error', x, f: cur.f, g: cur.g, evaluations: ctr.evaluations };
  // the objective's size sets the penalty's scale
  const fScale = Math.max(1, Math.abs(cur.f));
  const merit = (e: { f: number; g: number[] }) => {
    let L = e.f / fScale;
    p.limits.forEach((l, i) => {
      const g = e.g[i];
      if (!Number.isFinite(g)) { L = Infinity; return; }
      if (l.rel === '=') L += lambda[i] * g + (rho / 2) * g * g;
      else {
        // ≤: g ≤ 0; ≥: −g ≤ 0
        const h = l.rel === '<=' ? g : -g;
        const t = Math.max(0, lambda[i] + rho * h);
        L += (t * t - lambda[i] * lambda[i]) / (2 * rho);
      }
    });
    return L;
  };
  let lastViol = violation(p, x, cur.g);
  let status: SolveStatus = 'converged';
  for (let outer = 0; outer < 30; outer++) {
    const inner = bfgs(x, (y) => merit(ctr.eval(y)), p, ctr);
    x = inner.x;
    cur = ctr.eval(x);
    if (!Number.isFinite(cur.f)) return { status: 'error', x, f: cur.f, g: cur.g, evaluations: ctr.evaluations };
    const viol = violation(p, x, cur.g);
    // multipliers from the limits at the new point
    p.limits.forEach((l, i) => {
      const g = cur.g[i];
      if (l.rel === '=') lambda[i] += rho * g;
      else lambda[i] = Math.max(0, lambda[i] + rho * (l.rel === '<=' ? g : -g));
    });
    if (viol <= p.precision && (inner.converged || outer > 3) && (!p.limits.length || outer > 0)) { status = inner.converged ? 'optimal' : 'converged'; break; }
    if (viol > 0.25 * lastViol) rho = Math.min(rho * 10, 1e12);
    lastViol = viol;
    if (ctr.out) { status = 'limit'; break; }
  }
  const viol = violation(p, x, cur.g);
  if (viol > Math.max(p.precision * 10, 1e-6)) return { status: ctr.out ? 'limit' : 'infeasible', x, f: cur.f, g: cur.g, evaluations: ctr.evaluations };
  if (Math.abs(cur.f) > 1e30) status = 'unbounded';
  return { status, x, f: cur.f, g: cur.g, evaluations: ctr.evaluations };
}

/** Minimise a function inside bounds: BFGS steps, projected back inside, with a backtracking line search. */
function bfgs(x0: number[], F: (x: number[]) => number, p: Problem, ctr: Counter): { x: number[]; converged: boolean } {
  const n = x0.length;
  const clamp = (x: number[]) => x.map((v, j) => Math.min(p.upper[j], Math.max(p.lower[j], v)));
  let x = clamp(x0);
  let fx = F(x);
  const grad = (x: number[], fx: number) => x.map((v, j) => {
    const h = 1e-6 * Math.max(1, Math.abs(v));
    const up = Math.min(p.upper[j], v + h), dn = Math.max(p.lower[j], v - h);
    const xu = [...x], xd = [...x];
    xu[j] = up; xd[j] = dn;
    if (up - dn <= 0) return 0;
    if (up === v) return (fx - F(xd)) / (v - dn);
    if (dn === v) return (F(xu) - fx) / (up - v);
    return (F(xu) - F(xd)) / (up - dn);
  });
  let g = grad(x, fx);
  let H: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  const tol = p.convergence;
  for (let iter = 0; iter < 500; iter++) {
    if (ctr.out) return { x, converged: false };
    // variables held at a bound with the slope pushing them out stay put
    const free = x.map((v, j) => !((v <= p.lower[j] && g[j] > 0) || (v >= p.upper[j] && g[j] < 0)));
    let d = H.map((row) => -row.reduce((s, h, k) => s + (free[k] ? h * g[k] : 0), 0)).map((v, j) => (free[j] ? v : 0));
    let slope = d.reduce((s, v, j) => s + v * g[j], 0);
    if (!(slope < 0)) {
      // not downhill: start the curvature again from steepest descent
      H = H.map((row, i) => row.map((_, j) => (i === j ? 1 : 0)));
      d = g.map((v, j) => (free[j] ? -v : 0));
      slope = d.reduce((s, v, j) => s + v * g[j], 0);
    }
    const gnorm = Math.sqrt(g.reduce((s, v, j) => s + (free[j] ? v * v : 0), 0));
    if (gnorm < 1e-10 || slope === 0) return { x, converged: true };
    let t = 1, xn = x, fn = fx;
    for (let ls = 0; ls < 40; ls++) {
      xn = clamp(x.map((v, j) => v + t * d[j]));
      fn = F(xn);
      if (Number.isFinite(fn) && fn <= fx + 1e-4 * t * slope) break;
      t /= 2;
    }
    if (!(fn < fx)) return { x, converged: true };
    const gn = grad(xn, fn);
    const s = xn.map((v, j) => v - x[j]), y = gn.map((v, j) => v - g[j]);
    const sy = s.reduce((a, v, j) => a + v * y[j], 0);
    const rel = Math.abs(fn - fx) / Math.max(1, Math.abs(fx));
    x = xn; fx = fn; g = gn;
    if (rel < tol * 1e-3 && Math.sqrt(s.reduce((a, v) => a + v * v, 0)) < 1e-9 * Math.max(1, Math.sqrt(x.reduce((a, v) => a + v * v, 0)))) return { x, converged: true };
    if (sy > 1e-12) {
      // BFGS update of the inverse curvature
      const Hy = H.map((row) => row.reduce((a, h, k) => a + h * y[k], 0));
      const yHy = y.reduce((a, v, j) => a + v * Hy[j], 0);
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        H[i][j] += ((sy + yHy) * s[i] * s[j]) / (sy * sy) - (Hy[i] * s[j] + s[i] * Hy[j]) / sy;
      }
    }
  }
  return { x, converged: false };
}

// ---------------------------------------------------------------- Evolutionary

/** A random source with a seed. */
function rng(seed: number): () => number {
  let a = (seed || Math.floor(Math.random() * 2 ** 32)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Differential evolution (rand/1/bin), the limits as penalties, whole numbers rounded, all-different groups repaired. */
function evolutionary(p: Problem, ctr: Counter): SolveResult {
  const n = p.n;
  if (p.lower.some((v) => !Number.isFinite(v)) || p.upper.some((v) => !Number.isFinite(v))) {
    return { status: 'error', x: p.x0, f: NaN, g: [], evaluations: 0, message: 'The Evolutionary engine needs bounds on every variable cell (constraints such as $B$2 <= 100 and $B$2 >= 0).' };
  }
  const rand = rng(p.seed);
  const tidy = (x: number[]) => {
    const y = x.map((v, j) => {
      const c = Math.min(p.upper[j], Math.max(p.lower[j], v));
      return p.integer[j] ? Math.round(c) : c;
    });
    // all-different groups: put the values in the order the vector ranks them
    for (const grp of p.allDifferent) {
      const order = grp.map((j) => ({ j, v: y[j] })).sort((a, b) => a.v - b.v);
      order.forEach((o, k) => (y[o.j] = k + 1));
    }
    return y;
  };
  const score = (x: number[]) => {
    const e = ctr.eval(x);
    const v = violation(p, x, e.g);
    return { x, f: e.f, g: e.g, v, s: Number.isFinite(e.f) ? e.f : Infinity };
  };
  // feasible beats infeasible; then the objective, or the smaller violation
  const better = (a: ReturnType<typeof score>, b: ReturnType<typeof score>) =>
    (a.v <= p.precision) !== (b.v <= p.precision) ? a.v <= p.precision : a.v > p.precision ? a.v < b.v : a.s < b.s;
  const size = Math.max(10, Math.min(200, p.population));
  let pop = [score(tidy(p.x0))];
  while (pop.length < size) pop.push(score(tidy(p.lower.map((lo, j) => lo + rand() * (p.upper[j] - lo)))));
  let best = pop.reduce((a, b) => (better(b, a) ? b : a));
  let still = 0;
  let status: SolveStatus = 'converged';
  for (let gen = 0; gen < 2000; gen++) {
    if (ctr.out) { status = 'limit'; break; }
    const was = best.s, wasV = best.v;
    pop = pop.map((cur, i) => {
      let a = i, b = i, c = i;
      while (a === i) a = Math.floor(rand() * size);
      while (b === i || b === a) b = Math.floor(rand() * size);
      while (c === i || c === a || c === b) c = Math.floor(rand() * size);
      const F = 0.5 + 0.3 * rand(), CR = 0.9;
      const jr = Math.floor(rand() * n);
      const trial = cur.x.map((v, j) => (j === jr || rand() < CR ? pop[a].x[j] + F * (pop[b].x[j] - pop[c].x[j]) : v));
      const t = score(tidy(trial));
      return better(t, cur) ? t : cur;
    });
    best = pop.reduce((x, y) => (better(y, x) ? y : x));
    const improved = best.v < wasV - 1e-12 || (best.s < was - p.convergence * Math.max(1, Math.abs(was)));
    still = improved ? 0 : still + 1;
    if (still >= 50) break;
  }
  if (best.v > p.precision) return { status: status === 'limit' ? 'limit' : 'infeasible', x: best.x, f: best.f, g: best.g, evaluations: ctr.evaluations };
  return { status, x: best.x, f: best.f, g: best.g, evaluations: ctr.evaluations };
}
