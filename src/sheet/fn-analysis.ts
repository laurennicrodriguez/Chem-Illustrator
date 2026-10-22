// Statistical functions that go with the Analysis ToolPak's reports, as Excel has them: the F
// distribution and F-test, skewness and kurtosis, the mode, covariance, sums of squared
// differences (which moving-average and smoothing reports use for their standard errors) and
// percent rank.

import { Arg, FnDef, isBlock, numArg, numbers, omitted, scalar } from './args';
import { fCdf, fPdf, fTail, fInvTail } from './stats';
import { kurtOf, modeOf, skewOf } from './analysis-tools';
import { CellError, ERR, Value, isError, toBool } from './values';

/** Numbers from the arguments at these places (an error is returned as it is). */
function nums(args: Arg[], ...idx: number[]): number[] | CellError {
  const out: number[] = [];
  for (const i of idx) {
    const x = numArg(args, i);
    if (isError(x)) return x;
    out.push(x);
  }
  return out;
}

/** Matching pairs of numbers from two blocks the same size, skipping pairs where either isn't a number. */
function pairs(a: Arg, b: Arg): { xs: number[]; ys: number[] } | CellError {
  const flat = (x: Arg): Value[] => (isBlock(x) ? x.block.flat() : [x]);
  const xa = flat(a), xb = flat(b);
  if (xa.length !== xb.length) return ERR.na('The two ranges are different sizes');
  const out = { xs: [] as number[], ys: [] as number[] };
  for (let i = 0; i < xa.length; i++) {
    if (isError(xa[i])) return xa[i] as CellError;
    if (isError(xb[i])) return xb[i] as CellError;
    if (typeof xa[i] === 'number' && typeof xb[i] === 'number') { out.xs.push(xa[i] as number); out.ys.push(xb[i] as number); }
  }
  return out;
}

const dfs = (n: number[]): [number, number] | CellError => {
  const d1 = Math.trunc(n[1]), d2 = Math.trunc(n[2]);
  return d1 < 1 || d2 < 1 ? ERR.num('Degrees of freedom must be 1 or more') : [d1, d2];
};

const F_DIST_RT: FnDef = {
  min: 3, max: 3,
  fn: (args) => {
    const n = nums(args, 0, 1, 2);
    if (isError(n)) return n;
    const d = dfs(n);
    if (isError(d)) return d;
    if (n[0] < 0) return ERR.num('x must be 0 or more');
    return fTail(n[0], d[0], d[1]);
  },
};

const F_INV_RT: FnDef = {
  min: 3, max: 3,
  fn: (args) => {
    const n = nums(args, 0, 1, 2);
    if (isError(n)) return n;
    const d = dfs(n);
    if (isError(d)) return d;
    if (n[0] <= 0 || n[0] > 1) return ERR.num('The chance must be above 0, and at most 1');
    return n[0] === 1 ? 0 : fInvTail(n[0], d[0], d[1]);
  },
};

const F_TEST: FnDef = {
  min: 2, max: 2,
  fn: (args) => {
    const a = numbers([args[0]]), b = numbers([args[1]]);
    if (isError(a)) return a;
    if (isError(b)) return b;
    if (a.length < 2 || b.length < 2) return ERR.div0('Each array needs at least two numbers');
    const v = (xs: number[]) => { const m = xs.reduce((s, x) => s + x, 0) / xs.length; return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1); };
    const va = v(a), vb = v(b);
    if (va === 0 || vb === 0) return ERR.div0('A variance is 0');
    const F = va / vb, p = fCdf(F, a.length - 1, b.length - 1);
    return 2 * Math.min(p, 1 - p);
  },
};

const ofNumbers = (f: (xs: number[]) => Value): FnDef => ({
  min: 1, max: 255,
  fn: (args) => { const xs = numbers(args); return isError(xs) ? xs : f(xs); },
});

const covariance = (sample: boolean): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const p = pairs(args[0], args[1]);
    if (isError(p)) return p;
    const n = p.xs.length;
    if (n < (sample ? 2 : 1)) return ERR.div0('Needs more pairs of numbers');
    const mx = p.xs.reduce((s, x) => s + x, 0) / n, my = p.ys.reduce((s, y) => s + y, 0) / n;
    let s = 0;
    for (let i = 0; i < n; i++) s += (p.xs[i] - mx) * (p.ys[i] - my);
    return s / (sample ? n - 1 : n);
  },
});

const sumPairs = (f: (x: number, y: number) => number): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const p = pairs(args[0], args[1]);
    if (isError(p)) return p;
    let s = 0;
    for (let i = 0; i < p.xs.length; i++) s += f(p.xs[i], p.ys[i]);
    return s;
  },
});

/**
 * PERCENTRANK.INC / .EXC: where x falls among the numbers, as a fraction, interpolated between
 * the numbers around it, and cut (not rounded) to `significance` digits (3 when left out).
 */
const percentRank = (exc: boolean): FnDef => ({
  min: 2, max: 3,
  fn: (args) => {
    const xs = numbers([args[0]]);
    if (isError(xs)) return xs;
    const x = numArg(args, 1);
    if (isError(x)) return x;
    const sig = omitted(args, 2) ? 3 : numArg(args, 2);
    if (isError(sig)) return sig;
    const digits = Math.trunc(sig);
    if (digits < 1) return ERR.num('Significance must be 1 or more');
    const s = [...xs].sort((a, b) => a - b), n = s.length;
    if (!n || x < s[0] || x > s[n - 1]) return ERR.na('x is outside the numbers');
    const rankAt = (v: number) => {
      // how many numbers are below v (the first place it would go)
      let lo = 0;
      while (lo < n && s[lo] < v) lo++;
      return lo;
    };
    let r: number;
    const i = rankAt(x);
    if (s[i] === x) r = exc ? (i + 1) / (n + 1) : n > 1 ? i / (n - 1) : 1;
    else {
      // between s[i − 1] and s[i]
      const lo = s[i - 1], hi = s[i];
      const r0 = exc ? i / (n + 1) : (i - 1) / (n - 1), r1 = exc ? (i + 1) / (n + 1) : i / (n - 1);
      r = r0 + ((x - lo) / (hi - lo)) * (r1 - r0);
    }
    const f = 10 ** digits;
    return Math.floor(r * f + 1e-9) / f;
  },
});

export const ANALYSIS_FUNCTIONS: Record<string, FnDef> = {
  'F.DIST': {
    min: 4, max: 4,
    fn: (args) => {
      const n = nums(args, 0, 1, 2);
      if (isError(n)) return n;
      const d = dfs(n);
      if (isError(d)) return d;
      const cum = toBool(scalar(args[3]));
      if (isError(cum)) return cum;
      if (n[0] < 0) return ERR.num('x must be 0 or more');
      return cum ? fCdf(n[0], d[0], d[1]) : fPdf(n[0], d[0], d[1]);
    },
  },
  'F.DIST.RT': F_DIST_RT,
  FDIST: F_DIST_RT,
  'F.INV': {
    min: 3, max: 3,
    fn: (args) => {
      const n = nums(args, 0, 1, 2);
      if (isError(n)) return n;
      const d = dfs(n);
      if (isError(d)) return d;
      if (n[0] < 0 || n[0] >= 1) return ERR.num('The chance must be at least 0, and below 1');
      return n[0] === 0 ? 0 : fInvTail(1 - n[0], d[0], d[1]);
    },
  },
  'F.INV.RT': F_INV_RT,
  FINV: F_INV_RT,
  'F.TEST': F_TEST,
  FTEST: F_TEST,
  SKEW: ofNumbers(skewOf),
  KURT: ofNumbers(kurtOf),
  'MODE.SNGL': ofNumbers((xs) => (xs.length ? modeOf(xs) : ERR.na('No numbers'))),
  MODE: ofNumbers((xs) => (xs.length ? modeOf(xs) : ERR.na('No numbers'))),
  'COVARIANCE.P': covariance(false),
  COVAR: covariance(false),
  'COVARIANCE.S': covariance(true),
  SUMXMY2: sumPairs((x, y) => (x - y) ** 2),
  SUMX2MY2: sumPairs((x, y) => x * x - y * y),
  SUMX2PY2: sumPairs((x, y) => x * x + y * y),
  'PERCENTRANK.INC': percentRank(false),
  PERCENTRANK: percentRank(false),
  'PERCENTRANK.EXC': percentRank(true),
};
