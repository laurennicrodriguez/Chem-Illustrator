// Fitted lines (Excel's trendlines) by least squares: straight line, polynomial, exponential,
// logarithmic and power, with the equation and R² worked out as Excel works them out (for the
// exponential and power fits, R² is that of the straight line through the logarithms).

export type FitKind = 'linear' | 'poly2' | 'poly3' | 'exp' | 'log' | 'power';

export interface Fit {
  kind: FitKind;
  /** Coefficients: linear and polynomial c0 + c1·x + c2·x²…; exp a·e^(b·x) as [a, b]; log a·ln(x) + b as [a, b]; power a·x^b as [a, b]. */
  coef: number[];
  r2: number;
  /** How many points it was fitted to. */
  n: number;
}

export const FIT_NAMES: Record<FitKind, string> = {
  linear: 'Straight line', poly2: 'Polynomial (x²)', poly3: 'Polynomial (x³)', exp: 'Exponential', log: 'Logarithmic', power: 'Power',
};

/** Solve a small linear system by Gaussian elimination with pivoting (null when singular). */
function solve(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    if (Math.abs(m[piv][col]) < 1e-300) return null;
    [m[col], m[piv]] = [m[piv], m[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let k = col; k <= n; k++) m[r][k] -= f * m[col][k];
    }
  }
  return m.map((row, i) => row[n] / row[i]);
}

/** Polynomial least squares of a degree; `intercept` fixes the value at x = 0. */
function polyFit(xs: number[], ys: number[], degree: number, intercept?: number): number[] | null {
  const start = intercept === undefined ? 0 : 1;
  const terms = degree + 1 - start;
  const a = Array.from({ length: terms }, () => new Array<number>(terms).fill(0));
  const b = new Array<number>(terms).fill(0);
  for (let i = 0; i < xs.length; i++) {
    const y = ys[i] - (intercept ?? 0);
    for (let j = 0; j < terms; j++) {
      const pj = Math.pow(xs[i], j + start);
      b[j] += pj * y;
      for (let k = 0; k < terms; k++) a[j][k] += pj * Math.pow(xs[i], k + start);
    }
  }
  const c = solve(a, b);
  if (!c) return null;
  return intercept === undefined ? c : [intercept, ...c];
}

const polyAt = (c: number[], x: number) => c.reduce((s, ci, i) => s + ci * Math.pow(x, i), 0);

/** R² of predictions against values. */
function rSquared(ys: number[], pred: number[], throughOrigin = false): number {
  const mean = throughOrigin ? 0 : ys.reduce((s, y) => s + y, 0) / ys.length;
  let ssRes = 0, ssTot = 0;
  for (let i = 0; i < ys.length; i++) { ssRes += (ys[i] - pred[i]) ** 2; ssTot += (ys[i] - mean) ** 2; }
  return ssTot === 0 ? 1 : 1 - ssRes / ssTot;
}

/**
 * Fit points. Points that can't be used (not numbers, or x ≤ 0 for log and power, y ≤ 0 for exp
 * and power) are left out, as Excel leaves them out. Null when too few are left.
 */
export function fitPoints(kind: FitKind, xs: number[], ys: number[], intercept?: number): Fit | null {
  const px: number[] = [], py: number[] = [];
  for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
    const x = xs[i], y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if ((kind === 'log' || kind === 'power') && x <= 0) continue;
    if ((kind === 'exp' || kind === 'power') && y <= 0) continue;
    px.push(x); py.push(y);
  }
  const degree = kind === 'poly2' ? 2 : kind === 'poly3' ? 3 : 1;
  if (px.length < degree + 1 - (intercept !== undefined && (kind === 'linear' || kind.startsWith('poly')) ? 1 : 0) || px.length < 2) return null;
  switch (kind) {
    case 'linear': case 'poly2': case 'poly3': {
      const c = polyFit(px, py, degree, intercept);
      if (!c) return null;
      return { kind, coef: c, r2: rSquared(py, px.map((x) => polyAt(c, x)), intercept !== undefined), n: px.length };
    }
    case 'exp': {
      const ly = py.map(Math.log);
      const c = polyFit(px, ly, 1, intercept !== undefined && intercept > 0 ? Math.log(intercept) : undefined);
      if (!c) return null;
      return { kind, coef: [Math.exp(c[0]), c[1]], r2: rSquared(ly, px.map((x) => c[0] + c[1] * x)), n: px.length };
    }
    case 'log': {
      const lx = px.map(Math.log);
      const c = polyFit(lx, py, 1);
      if (!c) return null;
      return { kind, coef: [c[1], c[0]], r2: rSquared(py, lx.map((x) => c[0] + c[1] * x)), n: px.length };
    }
    case 'power': {
      const lx = px.map(Math.log), ly = py.map(Math.log);
      const c = polyFit(lx, ly, 1);
      if (!c) return null;
      return { kind, coef: [Math.exp(c[0]), c[1]], r2: rSquared(ly, lx.map((x) => c[0] + c[1] * x)), n: px.length };
    }
  }
}

/** The fitted value at x. */
export function fitAt(f: Fit, x: number): number {
  switch (f.kind) {
    case 'linear': case 'poly2': case 'poly3': return polyAt(f.coef, x);
    case 'exp': return f.coef[0] * Math.exp(f.coef[1] * x);
    case 'log': return x > 0 ? f.coef[0] * Math.log(x) + f.coef[1] : NaN;
    case 'power': return x > 0 ? f.coef[0] * Math.pow(x, f.coef[1]) : NaN;
  }
}

/** A number for an equation: 4 significant figures, as Excel shows them, with E notation for very big or small. */
export function fitNumber(v: number, digits = 4): string {
  if (v === 0 || !Number.isFinite(v)) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(digits - 1).split('e');
    return `${Number(m)}E${Number(e) >= 0 ? '+' : '−'}${String(Math.abs(Number(e))).padStart(2, '0')}`.replace('-', '−');
  }
  return String(Number(v.toPrecision(digits))).replace('-', '−');
}

/** The equation of a fit as Excel writes it: "y = 0.0123x + 1.234". */
export function fitEquation(f: Fit, digits = 4): string {
  const n = (v: number) => fitNumber(v, digits);
  const signed = (v: number) => (v < 0 ? ` − ${n(-v)}` : ` + ${n(v)}`);
  switch (f.kind) {
    case 'linear': case 'poly2': case 'poly3': {
      const parts: string[] = [];
      for (let i = f.coef.length - 1; i >= 0; i--) {
        const c = f.coef[i];
        if (i > 0 && c === 0) continue;
        const term = i === 0 ? '' : i === 1 ? 'x' : `x${i === 2 ? '²' : '³'}`;
        if (!parts.length) parts.push(`${n(c)}${term}`);
        else parts.push(`${signed(c)}${term}`);
      }
      return `y = ${parts.join('')}`;
    }
    case 'exp': return `y = ${n(f.coef[0])}e^${n(f.coef[1])}x`;
    case 'log': return `y = ${n(f.coef[0])}ln(x)${signed(f.coef[1])}`;
    case 'power': return `y = ${n(f.coef[0])}x^${n(f.coef[1])}`;
  }
}

/** R² as Excel shows it: "R² = 0.9987". */
export const r2Text = (f: Fit, digits = 4): string => `R² = ${f.r2.toFixed(digits)}`;
