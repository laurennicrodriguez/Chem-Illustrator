// The Analysis ToolPak, as Excel's Data Analysis window has it: descriptive statistics, histograms,
// regression, ANOVA (single factor, and two factors with and without replication), t-tests
// (paired, equal and unequal variances), the F-test and z-test, correlation and covariance
// matrices, moving averages and exponential smoothing, rank and percentile, sampling, random
// numbers and Fourier analysis. Each tool lays its results out in a block of cells as Excel does,
// with the same headings, so a report reads the same whichever program made it. The results are
// numbers (as Excel's are), except moving averages and exponential smoothing, which are formulas
// reading the input cells, again as Excel writes them.

import type { CellStyle } from './workbook';
import { ERR, Value, isError } from './values';
import { leastSquares, tTail, tInv, normCdf, normInv, fTail, fCdf, fInvTail } from './stats';

/** A cell of a tool's results: a value, or a formula (moving averages and smoothing). */
export type OutCell = Value | { f: string };

/** A tool's results, laid out from the top-left corner of the output. */
export interface ToolOutput {
  cells: OutCell[][];
  /** Formatting for blocks of the results (headings in italics, lines under tables, percentages). */
  styles: { r1: number; c1: number; r2: number; c2: number; style: CellStyle }[];
  /** Where the histogram tool's table sits (for its chart): rows of bins and frequencies. */
  chart?: { r1: number; r2: number; cumulative: boolean };
}

/** One group of numbers (a column or row of the input), with its label. Blank cells are null. */
export interface Group {
  label: string;
  values: (number | null)[];
}

class Out {
  cells: OutCell[][] = [];
  styles: ToolOutput['styles'] = [];
  put(r: number, c: number, v: OutCell): void {
    while (this.cells.length <= r) this.cells.push([]);
    const row = this.cells[r];
    while (row.length < c) row.push(null);
    row[c] = v;
  }
  row(r: number, c: number, vs: OutCell[]): void {
    vs.forEach((v, i) => this.put(r, c + i, v));
  }
  style(r1: number, c1: number, r2: number, c2: number, style: CellStyle): void {
    this.styles.push({ r1, c1, r2, c2, style });
  }
  /** A table's heading row in italics with a line above and below, and a line under its last row. */
  table(head: number, last: number, c1: number, c2: number): void {
    this.style(head, c1, head, c2, { italic: true, borders: { top: { style: 'medium' }, bottom: { style: 'thin' } } });
    this.style(last, c1, last, c2, { borders: { bottom: { style: 'medium' } } });
  }
  get height(): number { return this.cells.length; }
  done(): ToolOutput {
    const w = Math.max(0, ...this.cells.map((r) => r.length));
    for (const r of this.cells) while (r.length < w) r.push(null);
    return { cells: this.cells, styles: this.styles };
  }
}

// ---------------------------------------------------------------- reading the input

/**
 * The groups of an input block: each column (or row, with `byRows`) a group, its first cell the
 * label when `labels` is on. Text in the numbers is a mistake (as in Excel); blank cells are kept
 * as null so paired data stays paired.
 */
export function groupsOf(block: Value[][], byRows: boolean, labels: boolean): Group[] | string {
  const h = block.length, w = Math.max(0, ...block.map((r) => r.length));
  const n = byRows ? h : w, len = byRows ? w : h;
  const out: Group[] = [];
  for (let g = 0; g < n; g++) {
    const at = (i: number): Value => (byRows ? block[g]?.[i] : block[i]?.[g]) ?? null;
    const first = labels ? at(0) : null;
    const label = labels ? (first === null ? '' : String(isError(first) ? first.code : first)) : `${byRows ? 'Row' : 'Column'} ${g + 1}`;
    const values: (number | null)[] = [];
    for (let i = labels ? 1 : 0; i < len; i++) {
      const v = at(i);
      if (v === null || v === '') values.push(null);
      else if (typeof v === 'number') values.push(v);
      else if (typeof v === 'boolean') values.push(v ? 1 : 0);
      else return `The input holds ${isError(v) ? `an error (${v.code})` : `text ("${v}")`} where a number is needed${labels ? '' : ' (if its first row or column is labels, tick Labels)'}.`;
    }
    out.push({ label, values });
  }
  return out;
}

const nums = (g: Group): number[] => g.values.filter((v): v is number => v !== null);
const sum = (xs: number[]): number => xs.reduce((s, x) => s + x, 0);
const mean = (xs: number[]): number => sum(xs) / xs.length;
const devSq = (xs: number[]): number => { const m = mean(xs); return xs.reduce((s, x) => s + (x - m) ** 2, 0); };
const sampleVar = (xs: number[]): Value => (xs.length > 1 ? devSq(xs) / (xs.length - 1) : ERR.div0());
const orNA = (x: number): Value => (Number.isFinite(x) ? x : ERR.na());
const orDiv0 = (x: number): Value => (Number.isFinite(x) ? x : ERR.div0());

/** The most frequent value (the first to reach the top count, as MODE.SNGL), or #N/A when none repeats. */
export function modeOf(xs: number[]): Value {
  const count = new Map<number, number>();
  let best: number | null = null, top = 1;
  for (const x of xs) {
    const c = (count.get(x) ?? 0) + 1;
    count.set(x, c);
    if (c > top) { top = c; best = x; }
  }
  // the first value in the list with the top count
  if (best === null) return ERR.na('No value comes up more than once');
  return xs.find((x) => count.get(x) === top)!;
}

/** Sample skewness, as SKEW. */
export function skewOf(xs: number[]): Value {
  const n = xs.length;
  if (n < 3) return ERR.div0('Needs at least three numbers');
  const m = mean(xs), s = Math.sqrt(devSq(xs) / (n - 1));
  if (s === 0) return ERR.div0('The numbers are all the same');
  return (n / ((n - 1) * (n - 2))) * xs.reduce((a, x) => a + ((x - m) / s) ** 3, 0);
}

/** Sample excess kurtosis, as KURT. */
export function kurtOf(xs: number[]): Value {
  const n = xs.length;
  if (n < 4) return ERR.div0('Needs at least four numbers');
  const m = mean(xs), s = Math.sqrt(devSq(xs) / (n - 1));
  if (s === 0) return ERR.div0('The numbers are all the same');
  const q = xs.reduce((a, x) => a + ((x - m) / s) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * q - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
}

// ---------------------------------------------------------------- Descriptive Statistics

export interface DescriptiveOptions {
  summary: boolean;
  /** Confidence Level for Mean, as a percentage (95); unset: not shown. */
  confidence?: number;
  /** Kth Largest and Kth Smallest; unset: not shown. */
  kLargest?: number;
  kSmallest?: number;
}

export function descriptive(groups: Group[], o: DescriptiveOptions): ToolOutput | string {
  if (!o.summary && o.confidence === undefined && o.kLargest === undefined && o.kSmallest === undefined) return 'Tick at least one of Summary statistics, Confidence Level for Mean, Kth Largest or Kth Smallest.';
  const out = new Out();
  groups.forEach((g, gi) => {
    const xs = nums(g), n = xs.length, c = gi * 2;
    out.put(0, c, g.label);
    out.style(0, c, 0, c + 1, { italic: true, align: 'center', borders: { top: { style: 'medium' }, bottom: { style: 'thin' } } });
    let r = 2;
    const line = (label: string, v: Value) => { out.row(r++, c, [label, v]); };
    if (o.summary) {
      const sd = n > 1 ? Math.sqrt(devSq(xs) / (n - 1)) : NaN;
      const sorted = [...xs].sort((a, b) => a - b);
      const med = n ? (n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2) : NaN;
      line('Mean', n ? mean(xs) : ERR.div0());
      line('Standard Error', orDiv0(sd / Math.sqrt(n)));
      line('Median', orNA(med));
      line('Mode', n ? modeOf(xs) : ERR.na());
      line('Standard Deviation', orDiv0(sd));
      line('Sample Variance', sampleVar(xs));
      line('Kurtosis', kurtOf(xs));
      line('Skewness', skewOf(xs));
      line('Range', n ? sorted[n - 1] - sorted[0] : 0);
      line('Minimum', n ? sorted[0] : 0);
      line('Maximum', n ? sorted[n - 1] : 0);
      line('Sum', sum(xs));
      line('Count', n);
    }
    if (o.kLargest !== undefined) {
      const k = Math.trunc(o.kLargest), s = [...xs].sort((a, b) => b - a);
      line(`Largest(${k})`, k >= 1 && k <= n ? s[k - 1] : ERR.num());
    }
    if (o.kSmallest !== undefined) {
      const k = Math.trunc(o.kSmallest), s = [...xs].sort((a, b) => a - b);
      line(`Smallest(${k})`, k >= 1 && k <= n ? s[k - 1] : ERR.num());
    }
    if (o.confidence !== undefined) {
      const a = 1 - o.confidence / 100;
      const sd = n > 1 ? Math.sqrt(devSq(xs) / (n - 1)) : NaN;
      line(`Confidence Level(${o.confidence.toFixed(1)}%)`, n > 1 && a > 0 && a < 1 ? -tInv(a / 2, n - 1) * sd / Math.sqrt(n) : ERR.num());
    }
    out.style(r - 1, c, r - 1, c + 1, { borders: { bottom: { style: 'medium' } } });
  });
  return out.done();
}

// ---------------------------------------------------------------- Histogram

export interface HistogramOptions {
  /** The upper edges of the bins, in order; unset: evenly spread between the smallest and largest numbers. */
  bins?: number[];
  binLabel?: string;
  /** Pareto: a second copy of the table sorted by frequency, largest first. */
  pareto?: boolean;
  /** Cumulative percentage beside each count. */
  cumulative?: boolean;
}

/**
 * The bins Excel makes when none are given: as many as the square root of the count, evenly
 * spaced from the smallest number (each bin the numbers above the one before, up to its own edge).
 */
export function autoBins(xs: number[]): number[] {
  if (!xs.length) return [];
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const k = Math.max(1, Math.round(Math.sqrt(xs.length)));
  if (hi === lo) return [lo];
  const w = (hi - lo) / k;
  return Array.from({ length: k + 1 }, (_, i) => lo + i * w);
}

export function histogram(data: number[], o: HistogramOptions): ToolOutput | string {
  if (!data.length) return 'The input range holds no numbers.';
  const bins = (o.bins?.length ? [...o.bins] : autoBins(data)).sort((a, b) => a - b);
  const counts = new Array<number>(bins.length + 1).fill(0);
  for (const x of data) {
    let i = bins.findIndex((b) => x <= b);
    if (i < 0) i = bins.length;
    counts[i]++;
  }
  const out = new Out();
  const n = data.length;
  const labels: Value[] = [...bins, 'More'];
  const table = (c: number, order: number[], head: string) => {
    out.row(0, c, [head, 'Frequency', ...(o.cumulative ? ['Cumulative %'] : [])]);
    let run = 0;
    order.forEach((i, j) => {
      run += counts[i];
      out.row(j + 1, c, [labels[i], counts[i], ...(o.cumulative ? [run / n] : [])]);
    });
    const w = o.cumulative ? 2 : 1;
    out.table(0, order.length, c, c + w);
    if (o.cumulative) out.style(1, c + 2, order.length, c + 2, { numFmt: '0.00%' });
  };
  const order = labels.map((_, i) => i);
  table(0, order, o.binLabel || 'Bin');
  if (o.pareto) {
    // largest first; ties keep the bin order, and the More bin goes last among its equals
    const sorted = [...order].sort((a, b) => counts[b] - counts[a] || a - b);
    table(o.cumulative ? 4 : 3, sorted, o.binLabel || 'Bin');
  }
  const res = out.done();
  res.chart = { r1: 1, r2: labels.length, cumulative: !!o.cumulative };
  return res;
}

// ---------------------------------------------------------------- Regression

export interface RegressionOptions {
  yLabel?: string;
  xLabels?: string[];
  /** Constant is Zero: the line goes through the origin. */
  zeroConstant?: boolean;
  /** Confidence level as a percentage (the second pair of limits); 95 when unset. */
  confidence?: number;
  residuals?: boolean;
  standardResiduals?: boolean;
  normalProbability?: boolean;
}

export function regression(y: (number | null)[], xCols: (number | null)[][], o: RegressionOptions): ToolOutput | string {
  const k = xCols.length;
  if (!k) return 'Give the input X range.';
  if (xCols.some((c) => c.length !== y.length)) return 'The input Y and X ranges must have the same number of rows.';
  if (k > 16) return 'Regression takes at most 16 X columns.';
  const rows: number[] = [];
  for (let i = 0; i < y.length; i++) {
    if (y[i] === null && xCols.every((c) => c[i] === null)) continue;
    if (y[i] === null || xCols.some((c) => c[i] === null)) return `Row ${i + 1} of the input has a blank cell: every row needs its Y and every X.`;
    rows.push(i);
  }
  const Y = rows.map((i) => y[i]!);
  const X = rows.map((i) => xCols.map((c) => c[i]!));
  const constant = !o.zeroConstant;
  const fit = leastSquares(Y, X, constant);
  const n = Y.length;
  if (!fit || n <= k + (constant ? 1 : 0) - 1 || n < 2) return 'There are too few rows of data for this many X columns.';
  const out = new Out();
  out.put(0, 0, 'SUMMARY OUTPUT');
  // regression statistics
  out.put(2, 0, 'Regression Statistics');
  out.style(2, 0, 2, 1, { italic: true, borders: { top: { style: 'medium' }, bottom: { style: 'thin' } } });
  const r2 = fit.r2;
  const dfReg = k, dfRes = fit.df;
  const adj = constant ? 1 - (1 - r2) * (n - 1) / dfRes : 1 - (1 - r2) * n / dfRes;
  out.row(3, 0, ['Multiple R', orNA(Math.sqrt(r2))]);
  out.row(4, 0, ['R Square', orNA(r2)]);
  out.row(5, 0, ['Adjusted R Square', orNA(adj)]);
  out.row(6, 0, ['Standard Error', orNA(fit.sey)]);
  out.row(7, 0, ['Observations', n]);
  out.style(7, 0, 7, 1, { borders: { bottom: { style: 'medium' } } });
  // ANOVA
  out.put(9, 0, 'ANOVA');
  out.row(10, 0, ['', 'df', 'SS', 'MS', 'F', 'Significance F']);
  const msReg = fit.ssreg / dfReg, msRes = dfRes > 0 ? fit.ssresid / dfRes : NaN;
  const F = msReg / msRes;
  out.row(11, 0, ['Regression', dfReg, fit.ssreg, msReg, orNA(F), Number.isFinite(F) ? fTail(F, dfReg, dfRes) : ERR.na()]);
  out.row(12, 0, ['Residual', dfRes, fit.ssresid, orDiv0(msRes)]);
  out.row(13, 0, ['Total', dfReg + dfRes, fit.ssreg + fit.ssresid]);
  out.table(10, 13, 0, 5);
  // coefficients
  const conf = o.confidence ?? 95;
  const tc95 = dfRes > 0 ? -tInv(0.025, dfRes) : NaN, tcC = dfRes > 0 ? -tInv((1 - conf / 100) / 2, dfRes) : NaN;
  out.row(15, 0, ['', 'Coefficients', 'Standard Error', 't Stat', 'P-value', 'Lower 95%', 'Upper 95%', `Lower ${conf.toFixed(1)}%`, `Upper ${conf.toFixed(1)}%`]);
  const coefRow = (r: number, label: string, b: number, se: number) => {
    const t = b / se;
    const ok = Number.isFinite(se) && se > 0;
    out.row(r, 0, [label, b, ok ? se : ERR.na(), ok ? t : ERR.na(), ok ? 2 * tTail(Math.abs(t), dfRes) : ERR.na(),
      ok ? b - tc95 * se : ERR.na(), ok ? b + tc95 * se : ERR.na(), ok ? b - tcC * se : ERR.na(), ok ? b + tcC * se : ERR.na()]);
  };
  if (constant) coefRow(16, 'Intercept', fit.intercept, fit.seIntercept);
  else out.row(16, 0, ['Intercept', 0, ERR.na(), ERR.na(), ERR.na(), ERR.na(), ERR.na(), ERR.na(), ERR.na()]);
  for (let j = 0; j < k; j++) coefRow(17 + j, o.xLabels?.[j] || (k === 1 ? 'X Variable 1' : `X Variable ${j + 1}`), fit.coef[j], fit.se[j]);
  out.table(15, 16 + k, 0, 8);
  // residuals, and the normal probability plot's table beside them
  let r = 16 + k + 4;
  if (o.residuals || o.standardResiduals) {
    const predicted = X.map((xs) => fit.intercept + xs.reduce((s, x, j) => s + x * fit.coef[j], 0));
    const res = Y.map((v, i) => v - predicted[i]);
    const mr = mean(res);
    // standard residuals: each residual over the standard deviation of the residuals
    const sdRes = Math.sqrt(res.reduce((s, e) => s + (e - mr) ** 2, 0) / (n - 1));
    out.put(r, 0, 'RESIDUAL OUTPUT');
    const head = ['Observation', `Predicted ${o.yLabel || 'Y'}`, 'Residuals', ...(o.standardResiduals ? ['Standard Residuals'] : [])];
    out.row(r + 2, 0, head);
    res.forEach((e, i) => out.row(r + 3 + i, 0, [i + 1, predicted[i], e, ...(o.standardResiduals ? [orDiv0(e / sdRes)] : [])]));
    out.table(r + 2, r + 2 + n, 0, head.length - 1);
  }
  if (o.normalProbability) {
    const c = o.residuals || o.standardResiduals ? (o.standardResiduals ? 5 : 4) : 0;
    out.put(r, c, 'PROBABILITY OUTPUT');
    out.row(r + 2, c, ['Percentile', o.yLabel || 'Y']);
    [...Y].sort((a, b) => a - b).forEach((v, i) => out.row(r + 3 + i, c, [(100 * (i + 0.5)) / n, v]));
    out.table(r + 2, r + 2 + n, c, c + 1);
  }
  return out.done();
}

// ---------------------------------------------------------------- ANOVA

const ANOVA_HEAD = ['Source of Variation', 'SS', 'df', 'MS', 'F', 'P-value', 'F crit'];

function anovaRow(label: string, ss: number, df: number, msErr: number, dfErr: number, alpha: number): OutCell[] {
  const ms = ss / df, F = ms / msErr;
  const ok = df > 0 && dfErr > 0 && Number.isFinite(F);
  return [label, ss, df, orDiv0(ms), ok ? F : ERR.div0(), ok ? fTail(F, df, dfErr) : ERR.div0(), df > 0 && dfErr > 0 ? fInvTail(alpha, df, dfErr) : ERR.num()];
}

function summaryLine(label: string, xs: number[]): OutCell[] {
  return [label, xs.length, sum(xs), xs.length ? mean(xs) : ERR.div0(), sampleVar(xs)];
}

export function anovaSingle(groups: Group[], alpha: number): ToolOutput | string {
  const gs = groups.map((g) => ({ label: g.label, xs: nums(g) }));
  if (gs.length < 2) return 'ANOVA needs at least two groups.';
  if (gs.some((g) => !g.xs.length)) return 'Every group needs at least one number.';
  const all = gs.flatMap((g) => g.xs);
  const N = all.length, k = gs.length, grand = mean(all);
  const ssb = gs.reduce((s, g) => s + g.xs.length * (mean(g.xs) - grand) ** 2, 0);
  const ssw = gs.reduce((s, g) => s + devSq(g.xs), 0);
  const out = new Out();
  out.put(0, 0, 'Anova: Single Factor');
  out.put(2, 0, 'SUMMARY');
  out.row(3, 0, ['Groups', 'Count', 'Sum', 'Average', 'Variance']);
  gs.forEach((g, i) => out.row(4 + i, 0, summaryLine(g.label, g.xs)));
  out.table(3, 3 + k, 0, 4);
  const r = 4 + k + 2;
  out.put(r, 0, 'ANOVA');
  out.row(r + 1, 0, ANOVA_HEAD);
  const msw = ssw / (N - k);
  out.row(r + 2, 0, anovaRow('Between Groups', ssb, k - 1, msw, N - k, alpha));
  out.row(r + 3, 0, ['Within Groups', ssw, N - k, orDiv0(msw)]);
  out.row(r + 5, 0, ['Total', ssb + ssw, N - 1]);
  out.table(r + 1, r + 5, 0, 6);
  return out.done();
}

/** Two factors, one number for each row and column (rows of the input are one factor, its columns the other). */
export function anovaTwoNoRep(block: number[][], rowLabels: string[], colLabels: string[], alpha: number): ToolOutput | string {
  const R = block.length, C = block[0]?.length ?? 0;
  if (R < 2 || C < 2) return 'This ANOVA needs at least two rows and two columns of numbers.';
  const all = block.flat(), grand = mean(all);
  const rowMeans = block.map((r) => mean(r)), colMeans = Array.from({ length: C }, (_, j) => mean(block.map((r) => r[j])));
  const ssr = C * rowMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssc = R * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const sst = devSq(all), sse = sst - ssr - ssc;
  const out = new Out();
  out.put(0, 0, 'Anova: Two-Factor Without Replication');
  out.row(2, 0, ['SUMMARY', 'Count', 'Sum', 'Average', 'Variance']);
  block.forEach((row, i) => out.row(3 + i, 0, summaryLine(rowLabels[i], row)));
  let r = 3 + R + 1;
  for (let j = 0; j < C; j++) out.row(r + j, 0, summaryLine(colLabels[j], block.map((x) => x[j])));
  out.table(2, r + C - 1, 0, 4);
  r += C + 2;
  out.put(r, 0, 'ANOVA');
  out.row(r + 1, 0, ANOVA_HEAD);
  const dfe = (R - 1) * (C - 1), mse = sse / dfe;
  out.row(r + 2, 0, anovaRow('Rows', ssr, R - 1, mse, dfe, alpha));
  out.row(r + 3, 0, anovaRow('Columns', ssc, C - 1, mse, dfe, alpha));
  out.row(r + 4, 0, ['Error', sse, dfe, orDiv0(mse)]);
  out.row(r + 6, 0, ['Total', sst, R * C - 1]);
  out.table(r + 1, r + 6, 0, 6);
  return out.done();
}

/**
 * Two factors with repeats: the input has column labels in its first row and sample labels in its
 * first column; each sample takes `perSample` rows (the repeats).
 */
export function anovaTwoRep(block: Value[][], perSample: number, alpha: number): ToolOutput | string {
  const per = Math.trunc(perSample);
  if (per < 2) return 'Rows per sample must be 2 or more.';
  const head = block[0] ?? [];
  const C = head.length - 1;
  const body = block.slice(1);
  if (C < 2) return 'The input needs a column of sample labels and at least two columns of numbers.';
  if (!body.length || body.length % per) return `The rows of numbers (${body.length}) must divide into samples of ${per} rows.`;
  const S = body.length / per;
  const cell = (s: number, j: number): number[] | string => {
    const xs: number[] = [];
    for (let i = 0; i < per; i++) {
      const v = body[s * per + i]?.[j + 1] ?? null;
      if (typeof v !== 'number') return `Every cell needs a number (row ${s * per + i + 2} of the input, column ${j + 2}).`;
      xs.push(v);
    }
    return xs;
  };
  const cells: number[][][] = [];
  for (let s = 0; s < S; s++) {
    const row: number[][] = [];
    for (let j = 0; j < C; j++) {
      const xs = cell(s, j);
      if (typeof xs === 'string') return xs;
      row.push(xs);
    }
    cells.push(row);
  }
  const label = (v: Value, dflt: string) => (v === null || v === '' ? dflt : String(isError(v) ? v.code : v));
  const colLabels = head.slice(1).map((v, j) => label(v, `Column ${j + 1}`));
  const sampleLabels = Array.from({ length: S }, (_, s) => label(body[s * per]?.[0] ?? null, `Sample ${s + 1}`));
  const all = cells.flat(2), grand = mean(all), N = all.length;
  const sampleMeans = cells.map((row) => mean(row.flat()));
  const colMeans = Array.from({ length: C }, (_, j) => mean(cells.flatMap((row) => row[j])));
  const ssS = C * per * sampleMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssC = S * per * colMeans.reduce((s, m) => s + (m - grand) ** 2, 0);
  const ssW = cells.flat().reduce((s, xs) => s + devSq(xs), 0);
  const ssT = devSq(all), ssI = ssT - ssS - ssC - ssW;
  const out = new Out();
  out.put(0, 0, 'Anova: Two-Factor With Replication');
  out.row(2, 0, ['SUMMARY', ...colLabels, 'Total']);
  out.style(2, 0, 2, C + 1, { italic: true, borders: { top: { style: 'medium' }, bottom: { style: 'thin' } } });
  let r = 3;
  const block4 = (title: string, groups: number[][]) => {
    out.put(r, 0, title);
    out.style(r, 0, r, 0, { italic: true });
    const lines: [string, (xs: number[]) => Value][] = [['Count', (xs) => xs.length], ['Sum', sum], ['Average', mean], ['Variance', sampleVar]];
    lines.forEach(([name, f], i) => out.row(r + 1 + i, 0, [name, ...groups.map(f)]));
    r += 6;
  };
  cells.forEach((row, s) => block4(sampleLabels[s], [...row, row.flat()]));
  block4('Total', Array.from({ length: C }, (_, j) => cells.flatMap((row) => row[j])));
  out.style(r - 2, 0, r - 2, C + 1, { borders: { bottom: { style: 'medium' } } });
  r += 1;
  out.put(r, 0, 'ANOVA');
  out.row(r + 1, 0, ANOVA_HEAD);
  const dfW = N - S * C, msW = ssW / dfW;
  out.row(r + 2, 0, anovaRow('Sample', ssS, S - 1, msW, dfW, alpha));
  out.row(r + 3, 0, anovaRow('Columns', ssC, C - 1, msW, dfW, alpha));
  out.row(r + 4, 0, anovaRow('Interaction', ssI, (S - 1) * (C - 1), msW, dfW, alpha));
  out.row(r + 5, 0, ['Within', ssW, dfW, orDiv0(msW)]);
  out.row(r + 7, 0, ['Total', ssT, N - 1]);
  out.table(r + 1, r + 7, 0, 6);
  return out.done();
}

// ---------------------------------------------------------------- t-tests, F-test, z-test

/** "Variable 1" for an unlabelled group, as the ToolPak heads its columns. */
const variableLabel = (g: Group, i: number) => (/^(Column|Row) \d+$/.test(g.label) ? `Variable ${i}` : g.label);

export type TTestKind = 'paired' | 'equal' | 'unequal';

const T_TITLES: Record<TTestKind, string> = {
  paired: 't-Test: Paired Two Sample for Means',
  equal: 't-Test: Two-Sample Assuming Equal Variances',
  unequal: 't-Test: Two-Sample Assuming Unequal Variances',
};

export function tTest(kind: TTestKind, a: Group, b: Group, hypDiff: number, alpha: number): ToolOutput | string {
  let xa = nums(a), xb = nums(b);
  if (kind === 'paired') {
    if (a.values.length !== b.values.length) return 'Paired data needs the two ranges the same size.';
    const pairs = a.values.map((v, i) => [v, b.values[i]] as const).filter(([p, q]) => p !== null && q !== null) as [number, number][];
    xa = pairs.map((p) => p[0]); xb = pairs.map((p) => p[1]);
  }
  if (xa.length < 2 || xb.length < 2) return 'Each variable needs at least two numbers.';
  const n1 = xa.length, n2 = xb.length, m1 = mean(xa), m2 = mean(xb);
  const v1 = devSq(xa) / (n1 - 1), v2 = devSq(xb) / (n2 - 1);
  const out = new Out();
  out.put(0, 0, T_TITLES[kind]);
  out.row(2, 0, ['', variableLabel(a, 1), variableLabel(b, 2)]);
  out.row(3, 0, ['Mean', m1, m2]);
  out.row(4, 0, ['Variance', v1, v2]);
  out.row(5, 0, ['Observations', n1, n2]);
  let r = 6, t: number, df: number;
  if (kind === 'paired') {
    const d = xa.map((x, i) => x - xb[i]);
    const md = mean(d), sd = Math.sqrt(devSq(d) / (n1 - 1));
    let sxy = 0;
    for (let i = 0; i < n1; i++) sxy += (xa[i] - m1) * (xb[i] - m2);
    out.row(r++, 0, ['Pearson Correlation', orDiv0(sxy / Math.sqrt(devSq(xa) * devSq(xb)))]);
    df = n1 - 1;
    t = (md - hypDiff) / (sd / Math.sqrt(n1));
    out.row(r++, 0, ['Hypothesized Mean Difference', hypDiff]);
  } else if (kind === 'equal') {
    df = n1 + n2 - 2;
    const pooled = ((n1 - 1) * v1 + (n2 - 1) * v2) / df;
    out.row(r++, 0, ['Pooled Variance', pooled]);
    out.row(r++, 0, ['Hypothesized Mean Difference', hypDiff]);
    t = (m1 - m2 - hypDiff) / Math.sqrt(pooled * (1 / n1 + 1 / n2));
  } else {
    const q1 = v1 / n1, q2 = v2 / n2;
    // Welch's degrees of freedom, rounded to a whole number as the ToolPak does
    df = Math.round((q1 + q2) ** 2 / (q1 ** 2 / (n1 - 1) + q2 ** 2 / (n2 - 1)));
    out.row(r++, 0, ['Hypothesized Mean Difference', hypDiff]);
    t = (m1 - m2 - hypDiff) / Math.sqrt(q1 + q2);
  }
  out.row(r++, 0, ['df', df]);
  const ok = Number.isFinite(t) && df >= 1;
  out.row(r++, 0, ['t Stat', ok ? t : ERR.div0()]);
  out.row(r++, 0, ['P(T<=t) one-tail', ok ? tTail(Math.abs(t), df) : ERR.div0()]);
  out.row(r++, 0, ['t Critical one-tail', df >= 1 ? -tInv(alpha, df) : ERR.num()]);
  out.row(r++, 0, ['P(T<=t) two-tail', ok ? 2 * tTail(Math.abs(t), df) : ERR.div0()]);
  out.row(r++, 0, ['t Critical two-tail', df >= 1 ? -tInv(alpha / 2, df) : ERR.num()]);
  out.table(2, r - 1, 0, 2);
  return out.done();
}

export function fTest(a: Group, b: Group, alpha: number): ToolOutput | string {
  const xa = nums(a), xb = nums(b);
  if (xa.length < 2 || xb.length < 2) return 'Each variable needs at least two numbers.';
  const v1 = devSq(xa) / (xa.length - 1), v2 = devSq(xb) / (xb.length - 1);
  const d1 = xa.length - 1, d2 = xb.length - 1;
  const F = v1 / v2;
  const out = new Out();
  out.put(0, 0, 'F-Test Two-Sample for Variances');
  out.row(2, 0, ['', variableLabel(a, 1), variableLabel(b, 2)]);
  out.row(3, 0, ['Mean', mean(xa), mean(xb)]);
  out.row(4, 0, ['Variance', v1, v2]);
  out.row(5, 0, ['Observations', xa.length, xb.length]);
  out.row(6, 0, ['df', d1, d2]);
  if (!Number.isFinite(F)) out.row(7, 0, ['F', ERR.div0()]);
  else {
    out.row(7, 0, ['F', F]);
    // the tail on the side F falls, as the ToolPak reports it
    out.row(8, 0, ['P(F<=f) one-tail', F >= 1 ? fTail(F, d1, d2) : fCdf(F, d1, d2)]);
    out.row(9, 0, ['F Critical one-tail', F >= 1 ? fInvTail(alpha, d1, d2) : fInvTail(1 - alpha, d1, d2)]);
  }
  out.table(2, 9, 0, 2);
  return out.done();
}

export function zTest(a: Group, b: Group, var1: number, var2: number, hypDiff: number, alpha: number): ToolOutput | string {
  const xa = nums(a), xb = nums(b);
  if (!xa.length || !xb.length) return 'Each variable needs at least one number.';
  if (!(var1 > 0) || !(var2 > 0)) return 'Give both known variances (above 0).';
  const z = (mean(xa) - mean(xb) - hypDiff) / Math.sqrt(var1 / xa.length + var2 / xb.length);
  const out = new Out();
  out.put(0, 0, 'z-Test: Two Sample for Means');
  out.row(2, 0, ['', variableLabel(a, 1), variableLabel(b, 2)]);
  out.row(3, 0, ['Mean', mean(xa), mean(xb)]);
  out.row(4, 0, ['Known Variance', var1, var2]);
  out.row(5, 0, ['Observations', xa.length, xb.length]);
  out.row(6, 0, ['Hypothesized Mean Difference', hypDiff]);
  out.row(7, 0, ['z', z]);
  out.row(8, 0, ['P(Z<=z) one-tail', 1 - normCdf(Math.abs(z))]);
  out.row(9, 0, ['z Critical one-tail', -normInv(alpha)]);
  out.row(10, 0, ['P(Z<=z) two-tail', 2 * (1 - normCdf(Math.abs(z)))]);
  out.row(11, 0, ['z Critical two-tail', -normInv(alpha / 2)]);
  out.table(2, 11, 0, 2);
  return out.done();
}

// ---------------------------------------------------------------- Correlation and Covariance

/** A lower-triangle matrix of every pair of groups: Pearson's r, or the population covariance (as the ToolPak gives). */
export function matrix(groups: Group[], kind: 'correlation' | 'covariance'): ToolOutput | string {
  if (groups.length < 1) return 'Give the input range.';
  const len = Math.max(...groups.map((g) => g.values.length));
  // rows where every group has a number
  const keep = Array.from({ length: len }, (_, i) => i).filter((i) => groups.every((g) => g.values[i] !== null && g.values[i] !== undefined));
  if (keep.length < 2) return 'Each variable needs at least two numbers in matching rows.';
  const cols = groups.map((g) => keep.map((i) => g.values[i]!));
  const ms = cols.map(mean);
  const cov = (a: number, b: number) => cols[a].reduce((s, x, i) => s + (x - ms[a]) * (cols[b][i] - ms[b]), 0) / keep.length;
  const out = new Out();
  out.row(0, 0, ['', ...groups.map((g) => g.label)]);
  groups.forEach((g, i) => {
    out.put(1 + i, 0, g.label);
    for (let j = 0; j <= i; j++) {
      const v = kind === 'covariance' ? cov(i, j) : cov(i, j) / Math.sqrt(cov(i, i) * cov(j, j));
      out.put(1 + i, 1 + j, orDiv0(v));
    }
  });
  out.table(0, groups.length, 0, groups.length);
  return out.done();
}

// ---------------------------------------------------------------- Moving Average and Exponential Smoothing

/**
 * A moving average of the last `interval` values, as formulas reading the input cells (`refs`
 * names each one, in order). With `stdErrors`, a second column of standard errors. In the
 * formulas, %OUT<i> stands for the forecast in row i of the results (the caller puts in its cell).
 */
export function movingAverage(refs: string[], interval: number, stdErrors: boolean): ToolOutput | string {
  const k = Math.trunc(interval);
  if (k < 2) return 'The interval must be 2 or more.';
  if (refs.length < k) return `The input needs at least ${k} values for this interval.`;
  const out = new Out();
  refs.forEach((_, i) => {
    out.put(i, 0, i < k - 1 ? ERR.na() : { f: `=AVERAGE(${refs[i - k + 1]}:${refs[i]})` });
  });
  if (stdErrors) {
    // the error over the last `interval` forecasts: needs as many forecasts as the interval
    refs.forEach((_, i) => {
      const first = i - k + 1 - (k - 1);
      out.put(i, 1, first < 0 ? ERR.na() : { f: `=SQRT(SUMXMY2(${refs[i - k + 1]}:${refs[i]},${'%OUT'}${i - k + 1}:${'%OUT'}${i})/${k})` });
    });
  }
  return out.done();
}

/**
 * Exponential smoothing: each forecast is (1 − damping) × the last value + damping × the last
 * forecast, as formulas. The first has nothing before it (#N/A); the second is the first value.
 */
export function expSmoothing(refs: string[], damping: number, stdErrors: boolean): ToolOutput | string {
  if (!(damping >= 0 && damping <= 1)) return 'The damping factor is from 0 to 1 (0.3 is usual).';
  if (refs.length < 2) return 'The input needs at least two values.';
  const a = +(1 - damping).toPrecision(12), d = +damping.toPrecision(12);
  const out = new Out();
  refs.forEach((_, i) => {
    out.put(i, 0, i === 0 ? ERR.na() : i === 1 ? { f: `=${refs[0]}` } : { f: `=${a}*${refs[i - 1]}+${d}*%OUT${i - 1}` });
  });
  if (stdErrors) {
    // over the last three forecasts, as the ToolPak does
    refs.forEach((_, i) => {
      out.put(i, 1, i < 4 ? ERR.na() : { f: `=SQRT(SUMXMY2(${refs[i - 2]}:${refs[i]},%OUT${i - 2}:%OUT${i})/3)` });
    });
  }
  return out.done();
}

// ---------------------------------------------------------------- Rank and Percentile

export function rankPercentile(groups: Group[]): ToolOutput | string {
  const out = new Out();
  groups.forEach((g, gi) => {
    const c = gi * 4;
    const pts = g.values.map((v, i) => ({ v, i })).filter((p): p is { v: number; i: number } => p.v !== null);
    const n = pts.length;
    out.row(0, c, ['Point', g.label, 'Rank', 'Percent']);
    const sorted = [...pts].sort((p, q) => q.v - p.v || p.i - q.i);
    sorted.forEach((p, j) => {
      const rank = 1 + pts.filter((q) => q.v > p.v).length;
      const below = pts.filter((q) => q.v < p.v).length;
      // PERCENTRANK.INC of the value in its own data, cut (not rounded) to three decimals
      const pr = n > 1 ? Math.floor((below / (n - 1)) * 1000 + 1e-9) / 1000 : 1;
      out.row(1 + j, c, [p.i + 1, p.v, rank, pr]);
    });
    out.table(0, n, c, c + 3);
    out.style(1, c + 3, Math.max(1, n), c + 3, { numFmt: '0.00%' });
  });
  return out.done();
}

// ---------------------------------------------------------------- Sampling and Random Number Generation

/** A random source with a seed (the same seed gives the same numbers, as the ToolPak's Random Seed). */
export function seededRandom(seed?: number): () => number {
  let a = (seed === undefined || !Number.isFinite(seed) ? Math.floor(Math.random() * 2 ** 32) : Math.trunc(seed)) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sample(xs: number[], how: { periodic: number } | { random: number }, rnd: () => number): ToolOutput | string {
  if (!xs.length) return 'The input range holds no numbers.';
  const out = new Out();
  if ('periodic' in how) {
    const p = Math.trunc(how.periodic);
    if (p < 1 || p > xs.length) return `The period is from 1 to the count of numbers (${xs.length}).`;
    for (let i = p - 1, r = 0; i < xs.length; i += p) out.put(r++, 0, xs[i]);
  } else {
    const n = Math.trunc(how.random);
    if (n < 1) return 'The number of samples must be 1 or more.';
    // with replacement, as the ToolPak samples
    for (let r = 0; r < n; r++) out.put(r, 0, xs[Math.floor(rnd() * xs.length)]);
  }
  return out.done();
}

export type RandomDistribution =
  | { kind: 'uniform'; from: number; to: number }
  | { kind: 'normal'; mean: number; sd: number }
  | { kind: 'bernoulli'; p: number }
  | { kind: 'binomial'; p: number; trials: number }
  | { kind: 'poisson'; lambda: number }
  | { kind: 'patterned'; from: number; to: number; step: number; repeatEach: number; repeatSeq: number }
  | { kind: 'discrete'; values: number[]; probs: number[] };

export function randomNumbers(dist: RandomDistribution, variables: number, count: number, rnd: () => number): ToolOutput | string {
  const nv = Math.max(1, Math.trunc(variables || 1));
  const out = new Out();
  if (dist.kind === 'patterned') {
    if (!(dist.step > 0) || dist.to < dist.from) return 'Give a range from a smaller to a larger number, and a step above 0.';
    const seq: number[] = [];
    for (let s = 0; s < Math.max(1, dist.repeatSeq); s++)
      for (let x = dist.from; x <= dist.to + 1e-9 * Math.abs(dist.step); x += dist.step)
        for (let e = 0; e < Math.max(1, dist.repeatEach); e++) seq.push(+x.toPrecision(15));
    for (let v = 0; v < nv; v++) seq.forEach((x, i) => out.put(i, v, x));
    return out.done();
  }
  const n = Math.trunc(count);
  if (n < 1) return 'Give the number of random numbers (1 or more).';
  if (nv * n > 1_000_000) return 'That is more than a million numbers.';
  let draw: () => number;
  switch (dist.kind) {
    case 'uniform': draw = () => dist.from + (dist.to - dist.from) * rnd(); break;
    case 'normal': {
      if (!(dist.sd >= 0)) return 'The standard deviation must be 0 or more.';
      draw = () => dist.mean + dist.sd * normInv(Math.min(1 - 1e-16, Math.max(1e-16, rnd())));
      break;
    }
    case 'bernoulli':
      if (!(dist.p >= 0 && dist.p <= 1)) return 'The p value is from 0 to 1.';
      draw = () => (rnd() < dist.p ? 1 : 0);
      break;
    case 'binomial': {
      if (!(dist.p >= 0 && dist.p <= 1) || !(dist.trials >= 1)) return 'Give a p value from 0 to 1 and 1 or more trials.';
      const t = Math.trunc(dist.trials);
      draw = () => { let k = 0; for (let i = 0; i < t; i++) if (rnd() < dist.p) k++; return k; };
      break;
    }
    case 'poisson': {
      if (!(dist.lambda > 0)) return 'Lambda must be above 0.';
      draw = () => {
        // counting steps until the running product drops below e^−λ (fine for the λ a sheet uses)
        if (dist.lambda > 500) return Math.max(0, Math.round(dist.lambda + Math.sqrt(dist.lambda) * normInv(Math.min(1 - 1e-16, Math.max(1e-16, rnd())))));
        const L = Math.exp(-dist.lambda);
        let k = 0, p = rnd();
        while (p > L) { k++; p *= rnd(); }
        return k;
      };
      break;
    }
    case 'discrete': {
      const total = dist.probs.reduce((s, p) => s + p, 0);
      if (!dist.values.length || dist.values.length !== dist.probs.length || Math.abs(total - 1) > 1e-9 || dist.probs.some((p) => p < 0))
        return 'The value and probability input range needs two columns: values, and their probabilities adding up to 1.';
      draw = () => {
        let u = rnd();
        for (let i = 0; i < dist.values.length; i++) { u -= dist.probs[i]; if (u < 0) return dist.values[i]; }
        return dist.values[dist.values.length - 1];
      };
      break;
    }
  }
  for (let r = 0; r < n; r++) for (let v = 0; v < nv; v++) out.put(r, v, draw());
  return out.done();
}

// ---------------------------------------------------------------- Fourier Analysis

/** A complex number as Excel's engineering functions write it ("3+4i", "-2i", "5"). */
export function complexText(re: number, im: number): string {
  const f = (x: number) => String(+x.toPrecision(15));
  const r = Math.abs(re) < 1e-15 * Math.max(1, Math.abs(im)) ? 0 : re, i = Math.abs(im) < 1e-15 * Math.max(1, Math.abs(re)) ? 0 : im;
  if (i === 0) return f(r);
  const im1 = i === 1 ? '' : i === -1 ? '-' : f(i);
  if (r === 0) return `${im1}i`;
  return `${f(r)}${i > 0 ? '+' : ''}${im1}i`;
}

/** Read a complex number written as Excel writes them (a number, "3+4i", "-2.5j"); null when it isn't one. */
export function readComplex(v: Value): [number, number] | null {
  if (typeof v === 'number') return [v, 0];
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, '');
  const num = '[+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?';
  let m = new RegExp(`^(${num})$`).exec(s);
  if (m) return [Number(m[1]), 0];
  m = new RegExp(`^(${num})?([+-](?:\\d+(?:\\.\\d*)?|\\.\\d+)?(?:[eE][+-]?\\d+)?|(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)?[ij]$`).exec(s);
  if (!m) return null;
  const re = m[1] && m[2] !== undefined ? Number(m[1]) : 0;
  let imText = m[2] ?? m[1] ?? '';
  if (m[1] && m[2] === undefined) imText = m[1];
  const im = imText === '' || imText === '+' ? 1 : imText === '-' ? -1 : Number(imText);
  return Number.isFinite(re) && Number.isFinite(im) ? [re, im] : null;
}

/** The fast Fourier transform (or its inverse) of 2^k complex values, as text the IM… functions read. */
export function fourier(values: Value[], inverse: boolean): ToolOutput | string {
  const n = values.length;
  if (n < 2 || n > 4096 || (n & (n - 1))) return 'Fourier analysis takes 2, 4, 8, … up to 4096 values (a power of 2).';
  const re = new Float64Array(n), im = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const c = readComplex(values[i]);
    if (!c) return `Cell ${i + 1} of the input isn't a number or a complex number such as 3+4i.`;
    [re[i], im[i]] = c;
  }
  // bit-reversed order, then the butterflies
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  const sign = inverse ? 1 : -1;
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (sign * 2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
        const a = i + k, b = a + len / 2;
        const xr = re[b] * wr - im[b] * wi, xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  const out = new Out();
  for (let i = 0; i < n; i++) out.put(i, 0, inverse ? complexText(re[i] / n, im[i] / n) : complexText(re[i], im[i]));
  return out.done();
}
