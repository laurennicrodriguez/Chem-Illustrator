// The statistics behind the sheet's statistical functions: the normal and Student's t
// distributions (and their inverses), percentiles, and least-squares fits with Excel's LINEST
// layout. Worked to full double precision, so results agree with Excel's to the digits it shows.

const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
  -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

/** ln Γ(x) for x > 0 (Lanczos). */
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * x))) - lnGamma(1 - x);
  x -= 1;
  let a = LANCZOS[0];
  const t = x + 7.5;
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** The continued fraction of the incomplete beta function (modified Lentz). */
function betaFraction(a: number, b: number, x: number): number {
  const TINY = 1e-300;
  let c = 1, d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 1000; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d; if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/** The regularised incomplete beta function I_x(a, b). */
export function betaInc(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const front = Math.exp(lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  return x < (a + 1) / (a + b + 2) ? (front * betaFraction(a, b, x)) / a : 1 - (front * betaFraction(b, a, 1 - x)) / b;
}

/** Student's t: the chance of a value at or below t, with df degrees of freedom (df need not be whole). */
export function tCdf(t: number, df: number): number {
  const tail = 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
  return t > 0 ? 1 - tail : tail;
}

/** The chance of a value above |t| (one tail), kept exact far out in the tail. */
export function tTail(t: number, df: number): number {
  return 0.5 * betaInc(df / (df + t * t), df / 2, 0.5);
}

/** Student's t density. */
export function tPdf(t: number, df: number): number {
  return Math.exp(lnGamma((df + 1) / 2) - lnGamma(df / 2) - 0.5 * Math.log(df * Math.PI) - ((df + 1) / 2) * Math.log(1 + (t * t) / df));
}

/** The t with a chance p of a value at or below it (left tail), 0 < p < 1. */
export function tInv(p: number, df: number): number {
  if (p === 0.5) return 0;
  if (p > 0.5) return -tInv(1 - p, df);
  // p < 0.5: t is negative; bracket it, then bisect and polish with Newton steps
  let lo = -1, hi = 0;
  while (tCdf(lo, df) > p) { hi = lo; lo *= 2; if (lo < -1e12) break; }
  let t = (lo + hi) / 2;
  for (let i = 0; i < 200; i++) {
    const f = tCdf(t, df) - p;
    if (f > 0) hi = t; else lo = t;
    const step = f / tPdf(t, df);
    let next = t - step;
    if (!(next > lo && next < hi)) next = (lo + hi) / 2;
    if (Math.abs(next - t) <= 1e-15 * Math.max(1, Math.abs(t))) { t = next; break; }
    t = next;
  }
  return t;
}

/** The regularised lower incomplete gamma function P(a, x). */
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0;
  const lead = Math.exp(-x + a * Math.log(x) - lnGamma(a));
  if (x < a + 1) {
    let sum = 1 / a, term = sum;
    for (let n = 1; n < 1000; n++) {
      term *= x / (a + n);
      sum += term;
      if (Math.abs(term) < Math.abs(sum) * 1e-17) break;
    }
    return sum * lead;
  }
  return 1 - gammaQFraction(a, x) * lead;
}

function gammaQFraction(a: number, x: number): number {
  const TINY = 1e-300;
  let b = x + 1 - a, c = 1 / TINY, d = 1 / b, h = d;
  for (let i = 1; i < 1000; i++) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b; if (Math.abs(d) < TINY) d = TINY;
    c = b + an / c; if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-16) break;
  }
  return h;
}

/** erfc(x), accurate in the far tails too. */
export function erfc(x: number): number {
  if (x < 0) return 2 - erfc(-x);
  if (x < 0.5) return 1 - gammaP(0.5, x * x);
  return gammaQFraction(0.5, x * x) * Math.exp(-x * x - lnGamma(0.5) + 0.5 * Math.log(x * x));
}

/** The standard normal distribution: the chance of a value at or below z. */
export const normCdf = (z: number): number => 0.5 * erfc(-z / Math.SQRT2);

export const normPdf = (z: number): number => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** The z with a chance p of a value at or below it (Acklam's start, polished by Halley steps). */
export function normInv(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  let x: number;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  } else if (p <= 1 - lo) {
    const q = p - 0.5, r = q * q;
    x = ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  } else {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  for (let i = 0; i < 2; i++) {
    // the error measured on the side of the tail that keeps it exact
    const e = x < 0 ? 0.5 * erfc(-x / Math.SQRT2) - p : (1 - p) - 0.5 * erfc(x / Math.SQRT2);
    const u = e * Math.sqrt(2 * Math.PI) * Math.exp((x * x) / 2);
    x -= u / (1 + (x * u) / 2);
  }
  return x;
}

/** The k-th percentile of sorted numbers by Excel's PERCENTILE.INC (exc false) or PERCENTILE.EXC (exc true); NaN when k is out of range. */
export function percentile(sorted: number[], k: number, exc: boolean): number {
  const n = sorted.length;
  if (!n) return NaN;
  let h: number;
  if (exc) {
    h = k * (n + 1) - 1;
    if (h < 0 || h > n - 1) return NaN;
  } else {
    if (k < 0 || k > 1) return NaN;
    h = k * (n - 1);
  }
  const i = Math.floor(h), f = h - i;
  return f === 0 || i + 1 >= n ? sorted[i] : sorted[i] + f * (sorted[i + 1] - sorted[i]);
}

/** A least-squares fit as Excel's LINEST lays it out: 1 row of coefficients, or 5 rows with the statistics. */
export interface Fit {
  /** Coefficients for each x, in the order the x columns were given. */
  coef: number[];
  intercept: number;
  /** Standard errors of each coefficient (same order), and of the intercept (NaN when it is fixed at 0). */
  se: number[];
  seIntercept: number;
  r2: number;
  sey: number;
  F: number;
  df: number;
  ssreg: number;
  ssresid: number;
}

/**
 * Least squares of y on the columns of xs (xs[i] holds the x values of observation i). With
 * `constant` false the line goes through the origin. A column that is a combination of the
 * others is dropped (its coefficient and error are 0), as Excel does. Null when there are too few
 * observations.
 */
export function leastSquares(y: number[], xs: number[][], constant: boolean): Fit | null {
  const n = y.length, k = xs[0]?.length ?? 0;
  const p = k + (constant ? 1 : 0);
  // design matrix columns: the x's, then a column of ones
  const col = (j: number, i: number): number => (j < k ? xs[i][j] : 1);
  // centred data when there is a constant keeps the sums well conditioned
  const my = constant ? y.reduce((s, v) => s + v, 0) / n : 0;
  const mx = Array.from({ length: k }, (_, j) => (constant ? xs.reduce((s, r) => s + r[j], 0) / n : 0));
  const X = (j: number, i: number) => xs[i][j] - mx[j];
  // normal equations of the centred x's (the intercept follows from the means)
  const A: number[][] = Array.from({ length: k }, (_, a) => Array.from({ length: k }, (_, b) => { let s = 0; for (let i = 0; i < n; i++) s += X(a, i) * X(b, i); return s; }));
  const rhs = Array.from({ length: k }, (_, a) => { let s = 0; for (let i = 0; i < n; i++) s += X(a, i) * (y[i] - my); return s; });
  // invert by Gauss-Jordan, dropping columns whose pivot vanishes (collinear x's)
  const inv: number[][] = A.map((row, a) => row.map((_, b) => (a === b ? 1 : 0)));
  const M = A.map((r) => [...r]);
  const dropped = new Array<boolean>(k).fill(false);
  const scale = Math.max(1e-300, ...A.map((r, a) => Math.abs(r[a])));
  for (let c = 0; c < k; c++) {
    if (Math.abs(M[c][c]) <= 1e-12 * scale) { dropped[c] = true; continue; }
    const piv = M[c][c];
    for (let j = 0; j < k; j++) { M[c][j] /= piv; inv[c][j] /= piv; }
    for (let r = 0; r < k; r++) {
      if (r === c || M[r][c] === 0) continue;
      const f = M[r][c];
      for (let j = 0; j < k; j++) { M[r][j] -= f * M[c][j]; inv[r][j] -= f * inv[c][j]; }
    }
  }
  for (let c = 0; c < k; c++) if (dropped[c]) for (let j = 0; j < k; j++) { inv[c][j] = 0; inv[j][c] = 0; }
  const coef = Array.from({ length: k }, (_, a) => (dropped[a] ? 0 : inv[a].reduce((s, v, b) => s + v * rhs[b], 0)));
  const intercept = constant ? my - coef.reduce((s, m, j) => s + m * mx[j], 0) : 0;
  const used = p - dropped.filter(Boolean).length;
  const df = n - used;
  if (df < 0 || n === 0) return null;
  let ssresid = 0, sstot = 0;
  for (let i = 0; i < n; i++) {
    let fit = intercept;
    for (let j = 0; j < k; j++) fit += coef[j] * col(j, i);
    ssresid += (y[i] - fit) ** 2;
    sstot += constant ? (y[i] - my) ** 2 : y[i] ** 2;
  }
  const ssreg = sstot - ssresid;
  const s2 = df > 0 ? ssresid / df : NaN;
  const se = coef.map((_, a) => (dropped[a] ? 0 : Math.sqrt(s2 * inv[a][a])));
  let seIntercept = NaN;
  if (constant) {
    // var(b) = s²(1/n + mx' (X'X)⁻¹ mx)
    let q = 0;
    for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) q += mx[a] * inv[a][b] * mx[b];
    seIntercept = Math.sqrt(s2 * (1 / n + q));
  }
  const r2 = sstot === 0 ? NaN : ssreg / sstot;
  const regDf = used - (constant ? 1 : 0);
  const F = regDf > 0 && df > 0 && ssresid > 0 ? ssreg / regDf / s2 : NaN;
  return { coef, intercept, se, seIntercept, r2, sey: Math.sqrt(s2), F, df, ssreg, ssresid };
}
