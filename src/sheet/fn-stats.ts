// Statistical functions as Excel has them: standard deviation and variance, the t-test and the t
// and normal distributions, confidence intervals, LINEST and LOGEST, percentiles and quartiles,
// RANK, LARGE and SMALL. The older names (STDEVP, VARP, TTEST, TINV, PERCENTILE…) give the same
// results as the new ones, as in Excel.

import { Arg, Block, FnDef, array, asBlock, at, numArg, numbers, omitted, optBool, optNumber, scalar } from './args';
import { leastSquares, normCdf, normInv, normPdf, percentile, tCdf, tInv, tPdf, tTail } from './stats';
import { CellError, ERR, Value, isError, sigFigs15, toBool } from './values';

const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]): number => sum(xs) / xs.length;

/** Sum of squared differences from the mean. */
function devSq(xs: number[]): number {
  const m = mean(xs);
  return xs.reduce((s, x) => s + (x - m) ** 2, 0);
}

/** Variance of a sample (n − 1) or of a whole population (n). */
const variance = (sample: boolean) => (xs: number[]): Value => {
  const d = sample ? xs.length - 1 : xs.length;
  return d < 1 ? ERR.div0(sample ? 'Needs at least two numbers' : 'No numbers') : devSq(xs) / d;
};

const ofNumbers = (f: (xs: number[]) => Value): FnDef => ({
  min: 1, max: 255,
  fn: (args) => { const xs = numbers(args); return isError(xs) ? xs : f(xs); },
});

const sqrtOf = (f: (xs: number[]) => Value) => (xs: number[]): Value => { const v = f(xs); return typeof v === 'number' ? Math.sqrt(v) : v; };

/** Numeric arguments, each read as a number (an error is returned as it is). */
function nums(args: Arg[], ...idx: number[]): number[] | CellError {
  const out: number[] = [];
  for (const i of idx) {
    const x = numArg(args, i);
    if (isError(x)) return x;
    out.push(x);
  }
  return out;
}

const tooFewDf = () => ERR.num('Degrees of freedom must be 1 or more');

// ---------------------------------------------------------------- t-test

function tTest(a: Arg, b: Arg, tails: number, type: number): Value {
  if (tails !== 1 && tails !== 2) return ERR.num('Tails is 1 or 2');
  if (type < 1 || type > 3) return ERR.num('Type is 1 (paired), 2 (equal variances) or 3 (unequal variances)');
  let t: number, df: number;
  if (type === 1) {
    const A = asBlock(a), B = asBlock(b);
    if (A.h * A.w !== B.h * B.w) return ERR.na('Paired data must have the same number of values');
    const fa = A.block.flat(), fb = B.block.flat();
    const d: number[] = [];
    for (let i = 0; i < Math.max(fa.length, fb.length); i++) {
      const x = fa[i] ?? null, y = fb[i] ?? null;
      if (isError(x)) return x;
      if (isError(y)) return y;
      if (typeof x === 'number' && typeof y === 'number') d.push(x - y);
    }
    const n = d.length;
    if (n < 2) return ERR.div0('Needs at least two pairs');
    const sd = Math.sqrt(devSq(d) / (n - 1));
    if (sd === 0) return ERR.div0('The differences are all the same');
    t = mean(d) / (sd / Math.sqrt(n));
    df = n - 1;
  } else {
    const xs = numbers([asBlock(a)]), ys = numbers([asBlock(b)]);
    if (isError(xs)) return xs;
    if (isError(ys)) return ys;
    const n1 = xs.length, n2 = ys.length;
    if (n1 < 2 || n2 < 2) return ERR.div0('Each set needs at least two numbers');
    const v1 = devSq(xs) / (n1 - 1), v2 = devSq(ys) / (n2 - 1);
    const diff = mean(xs) - mean(ys);
    if (type === 2) {
      df = n1 + n2 - 2;
      const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
      const se = Math.sqrt(pooled * (1 / n1 + 1 / n2));
      if (se === 0) return ERR.div0('Neither set varies');
      t = diff / se;
    } else {
      const q1 = v1 / n1, q2 = v2 / n2;
      if (q1 + q2 === 0) return ERR.div0('Neither set varies');
      t = diff / Math.sqrt(q1 + q2);
      // Welch–Satterthwaite degrees of freedom (not rounded, as in Excel)
      df = (q1 + q2) ** 2 / (q1 ** 2 / (n1 - 1) + q2 ** 2 / (n2 - 1));
    }
  }
  return tails * tTail(Math.abs(t), df);
}

const T_TEST: FnDef = {
  min: 4, max: 4,
  fn: (args) => {
    const n = nums(args, 2, 3);
    if (isError(n)) return n;
    return tTest(args[0], args[1], Math.trunc(n[0]), Math.trunc(n[1]));
  },
};

// ---------------------------------------------------------------- distributions

const T_INV_2T: FnDef = {
  min: 2, max: 2,
  fn: (args) => {
    const n = nums(args, 0, 1);
    if (isError(n)) return n;
    const [p, df] = [n[0], Math.trunc(n[1])];
    if (p <= 0 || p > 1) return ERR.num('The chance must be above 0 and at most 1');
    if (df < 1) return tooFewDf();
    return Math.abs(tInv(p / 2, df));
  },
};

const NORM_S_INV: FnDef = {
  min: 1, max: 1,
  fn: (args) => {
    const p = numArg(args, 0);
    if (isError(p)) return p;
    return p <= 0 || p >= 1 ? ERR.num('The chance must be between 0 and 1') : normInv(p);
  },
};

const NORM_INV: FnDef = {
  min: 3, max: 3,
  fn: (args) => {
    const n = nums(args, 0, 1, 2);
    if (isError(n)) return n;
    const [p, m, sd] = n;
    if (p <= 0 || p >= 1) return ERR.num('The chance must be between 0 and 1');
    if (sd <= 0) return ERR.num('The standard deviation must be above 0');
    return m + sd * normInv(p);
  },
};

/** NORM.DIST(x, mean, sd, cumulative); NORMDIST is the same. */
const NORM_DIST: FnDef = {
  min: 4, max: 4,
  fn: (args) => {
    const n = nums(args, 0, 1, 2);
    if (isError(n)) return n;
    const cum = toBool(scalar(args[3]));
    if (isError(cum)) return cum;
    const [x, m, sd] = n;
    if (sd <= 0) return ERR.num('The standard deviation must be above 0');
    const z = (x - m) / sd;
    return cum ? normCdf(z) : normPdf(z) / sd;
  },
};

/** CONFIDENCE.NORM (and CONFIDENCE) or CONFIDENCE.T: half the width of the confidence interval of a mean. */
const confidence = (t: boolean): FnDef => ({
  min: 3, max: 3,
  fn: (args) => {
    const n = nums(args, 0, 1, 2);
    if (isError(n)) return n;
    const [alpha, sd] = n, size = Math.trunc(n[2]);
    if (alpha <= 0 || alpha >= 1) return ERR.num('Alpha must be between 0 and 1');
    if (sd <= 0) return ERR.num('The standard deviation must be above 0');
    if (size < 1) return ERR.num('The sample size must be 1 or more');
    if (t && size === 1) return ERR.div0('A sample of one has no spread');
    const crit = t ? Math.abs(tInv(alpha / 2, size - 1)) : -normInv(alpha / 2);
    return (crit * sd) / Math.sqrt(size);
  },
});

// ---------------------------------------------------------------- LINEST and LOGEST

/** The known y's and x's of LINEST: x is one column of values per variable. */
function fitData(args: Arg[]): { y: number[]; xs: number[][]; k: number } | CellError {
  const Y = asBlock(args[0]);
  const read = (b: Block, i: number, j: number): number | CellError => {
    const v = at(b, i, j);
    if (isError(v)) return v;
    return typeof v === 'number' ? v : ERR.value('LINEST needs numbers in every cell');
  };
  const y: number[] = [];
  for (let i = 0; i < Y.h; i++) for (let j = 0; j < Y.w; j++) {
    const v = read(Y, i, j);
    if (isError(v)) return v;
    y.push(v);
  }
  const n = y.length;
  if (omitted(args, 1)) return { y, xs: y.map((_, i) => [i + 1]), k: 1 };
  const X = asBlock(args[1]);
  const xs: number[][] = [];
  if (X.h * X.w === n) {
    // one variable, laid out like the y's
    for (let i = 0; i < X.h; i++) for (let j = 0; j < X.w; j++) {
      const v = read(X, i, j);
      if (isError(v)) return v;
      xs.push([v]);
    }
    return { y, xs, k: 1 };
  }
  if (Y.w === 1 && X.h === n) {
    for (let i = 0; i < n; i++) {
      const row: number[] = [];
      for (let j = 0; j < X.w; j++) { const v = read(X, i, j); if (isError(v)) return v; row.push(v); }
      xs.push(row);
    }
    return { y, xs, k: X.w };
  }
  if (Y.h === 1 && X.w === n) {
    for (let j = 0; j < n; j++) {
      const row: number[] = [];
      for (let i = 0; i < X.h; i++) { const v = read(X, i, j); if (isError(v)) return v; row.push(v); }
      xs.push(row);
    }
    return { y, xs, k: X.h };
  }
  return ERR.ref('The known x\'s don\'t line up with the known y\'s');
}

const linest = (log: boolean): FnDef => ({
  min: 1, max: 4,
  fn: (args) => {
    const d = fitData(args);
    if (isError(d)) return d;
    const constant = optBool(args, 2, true), stats = optBool(args, 3, false);
    if (isError(constant)) return constant;
    if (isError(stats)) return stats;
    let y = d.y;
    if (log) {
      if (y.some((v) => v <= 0)) return ERR.num('LOGEST needs y values above 0');
      y = y.map(Math.log);
    }
    const f = leastSquares(y, d.xs, omitted(args, 2) || constant);
    if (!f) return ERR.num('Too few values for the fit');
    const num = (x: number): Value => (Number.isFinite(x) ? x : ERR.num());
    const na = (): Value => ERR.na('');
    const out = (x: number): Value => num(log ? Math.exp(x) : x);
    const hasConst = omitted(args, 2) || constant;
    const rows: Value[][] = [[...[...f.coef].reverse().map(out), hasConst ? out(f.intercept) : log ? 1 : 0]];
    if (stats) {
      const w = d.k + 1, fill = (r: Value[]) => [...r, ...Array.from({ length: w - r.length }, na)];
      rows.push([...[...f.se].reverse().map(num), hasConst ? num(f.seIntercept) : na()]);
      rows.push(fill([num(f.r2), num(f.sey)]));
      rows.push(fill([num(f.F), f.df]));
      rows.push(fill([f.ssreg, f.ssresid]));
    }
    return array(rows);
  },
});

// ---------------------------------------------------------------- ranking and percentiles

const sorted = (xs: number[]): number[] => [...xs].sort((a, b) => a - b);

const percentileFn = (exc: boolean): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const xs = numbers([asBlock(args[0])]);
    if (isError(xs)) return xs;
    const k = numArg(args, 1);
    if (isError(k)) return k;
    if (!xs.length) return ERR.num('No numbers');
    const r = percentile(sorted(xs), k, exc);
    return Number.isNaN(r) ? ERR.num('The percentile is out of range') : r;
  },
});

const quartileFn = (exc: boolean): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const xs = numbers([asBlock(args[0])]);
    if (isError(xs)) return xs;
    const q = numArg(args, 1);
    if (isError(q)) return q;
    const k = Math.trunc(q);
    if (!xs.length || k < (exc ? 1 : 0) || k > (exc ? 3 : 4)) return ERR.num(exc ? 'The quartile is 1, 2 or 3' : 'The quartile is 0 to 4');
    const r = percentile(sorted(xs), k / 4, exc);
    return Number.isNaN(r) ? ERR.num('Too few numbers for that quartile') : r;
  },
});

const rankFn = (avg: boolean): FnDef => ({
  min: 2, max: 3,
  fn: (args) => {
    const x = numArg(args, 0);
    if (isError(x)) return x;
    const xs = numbers([asBlock(args[1])]);
    if (isError(xs)) return xs;
    const order = optNumber(args, 2, 0);
    if (isError(order)) return order;
    const asc = order !== 0;
    const same = (v: number) => sigFigs15(v) === sigFigs15(x);
    const ties = xs.filter(same).length;
    if (!ties) return ERR.na('The number is not in the list');
    const before = xs.filter((v) => !same(v) && (asc ? v < x : v > x)).length;
    return avg ? before + (ties + 1) / 2 : before + 1;
  },
});

/** LARGE (k-th largest) and SMALL (k-th smallest). */
const kth = (largest: boolean): FnDef => ({
  min: 2, max: 2,
  fn: (args) => {
    const xs = numbers([asBlock(args[0])]);
    if (isError(xs)) return xs;
    const k0 = numArg(args, 1);
    if (isError(k0)) return k0;
    // a fractional k counts up for LARGE and down for SMALL, as in Excel
    const k = largest ? Math.ceil(k0) : Math.floor(k0);
    if (k < 1 || k > xs.length) return ERR.num(`k must be from 1 to the count of numbers (${xs.length})`);
    const s = sorted(xs);
    return largest ? s[s.length - k] : s[k - 1];
  },
});

export const STATS_FUNCTIONS: Record<string, FnDef> = {
  'STDEV.S': ofNumbers(sqrtOf(variance(true))),
  'STDEV.P': ofNumbers(sqrtOf(variance(false))),
  STDEVP: ofNumbers(sqrtOf(variance(false))),
  VAR: ofNumbers(variance(true)),
  'VAR.S': ofNumbers(variance(true)),
  'VAR.P': ofNumbers(variance(false)),
  VARP: ofNumbers(variance(false)),
  'T.TEST': T_TEST,
  TTEST: T_TEST,
  // T.INV(p, df): the left-tailed inverse
  'T.INV': {
    min: 2, max: 2,
    fn: (args) => {
      const n = nums(args, 0, 1);
      if (isError(n)) return n;
      const [p, df] = [n[0], Math.trunc(n[1])];
      if (p <= 0 || p >= 1) return ERR.num('The chance must be between 0 and 1');
      if (df < 1) return tooFewDf();
      return tInv(p, df);
    },
  },
  'T.INV.2T': T_INV_2T,
  TINV: T_INV_2T,
  'T.DIST': {
    min: 3, max: 3,
    fn: (args) => {
      const n = nums(args, 0, 1);
      if (isError(n)) return n;
      const cum = toBool(scalar(args[2]));
      if (isError(cum)) return cum;
      const [x, df] = [n[0], Math.trunc(n[1])];
      if (df < 1) return tooFewDf();
      return cum ? tCdf(x, df) : tPdf(x, df);
    },
  },
  'T.DIST.2T': {
    min: 2, max: 2,
    fn: (args) => {
      const n = nums(args, 0, 1);
      if (isError(n)) return n;
      const [x, df] = [n[0], Math.trunc(n[1])];
      if (x < 0) return ERR.num('x must be 0 or more');
      if (df < 1) return tooFewDf();
      return 2 * tTail(x, df);
    },
  },
  'T.DIST.RT': {
    min: 2, max: 2,
    fn: (args) => {
      const n = nums(args, 0, 1);
      if (isError(n)) return n;
      const [x, df] = [n[0], Math.trunc(n[1])];
      if (df < 1) return tooFewDf();
      return x >= 0 ? tTail(x, df) : 1 - tTail(-x, df);
    },
  },
  // TDIST(x, df, tails): the older form
  TDIST: {
    min: 3, max: 3,
    fn: (args) => {
      const n = nums(args, 0, 1, 2);
      if (isError(n)) return n;
      const [x, df, tails] = [n[0], Math.trunc(n[1]), Math.trunc(n[2])];
      if (x < 0) return ERR.num('x must be 0 or more');
      if (df < 1) return tooFewDf();
      if (tails !== 1 && tails !== 2) return ERR.num('Tails is 1 or 2');
      return tails * tTail(x, df);
    },
  },
  'NORM.S.INV': NORM_S_INV,
  NORMSINV: NORM_S_INV,
  'NORM.INV': NORM_INV,
  NORMINV: NORM_INV,
  'NORM.S.DIST': {
    min: 2, max: 2,
    fn: (args) => {
      const z = numArg(args, 0);
      if (isError(z)) return z;
      const cum = toBool(scalar(args[1]));
      if (isError(cum)) return cum;
      return cum ? normCdf(z) : normPdf(z);
    },
  },
  NORMSDIST: { min: 1, max: 1, fn: (args) => { const z = numArg(args, 0); return isError(z) ? z : normCdf(z); } },
  'NORM.DIST': NORM_DIST,
  NORMDIST: NORM_DIST,
  CONFIDENCE: confidence(false),
  'CONFIDENCE.NORM': confidence(false),
  'CONFIDENCE.T': confidence(true),
  LINEST: linest(false),
  LOGEST: linest(true),
  PERCENTILE: percentileFn(false),
  'PERCENTILE.INC': percentileFn(false),
  'PERCENTILE.EXC': percentileFn(true),
  QUARTILE: quartileFn(false),
  'QUARTILE.INC': quartileFn(false),
  'QUARTILE.EXC': quartileFn(true),
  RANK: rankFn(false),
  'RANK.EQ': rankFn(false),
  'RANK.AVG': rankFn(true),
  LARGE: kth(true),
  SMALL: kth(false),
};
