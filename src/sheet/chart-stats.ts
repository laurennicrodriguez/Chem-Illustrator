// The numbers behind a histogram and a box and whisker chart, worked out as Excel 2016 works them
// out: bins of equal width from the smallest value (Scott's normal reference rule when no width
// is given), each holding the values above its start up to and including its end; quartiles by
// the exclusive or inclusive median (QUARTILE.EXC or QUARTILE.INC), whiskers out to the furthest
// points within 1.5 × the box's height, and the points beyond them as outliers.

import type { Bins, BoxOptions } from './chart';

export interface Histogram {
  /** Each bin's label: "[1, 3]", "(3, 5]", and "≤ 0" or "> 9" for the underflow and overflow bins. */
  labels: string[];
  counts: number[];
  /** The bin width used (worked out when none was given). */
  width: number;
}

const short = (v: number) => String(Number(v.toPrecision(6)));

/** Put the numbers into bins. */
export function histogram(values: number[], bins: Bins = {}): Histogram {
  const xs = values.filter(Number.isFinite);
  if (!xs.length) return { labels: [], counts: [], width: 0 };
  const min = xs.reduce((a, b) => (b < a ? b : a), Infinity), max = xs.reduce((a, b) => (b > a ? b : a), -Infinity);
  const under = bins.underflow !== undefined && bins.underflow > min ? bins.underflow : undefined;
  const over = bins.overflow !== undefined && bins.overflow < max ? bins.overflow : undefined;
  const lo = under ?? min, hi = over ?? max;
  let width = bins.width && bins.width > 0 ? bins.width : 0;
  if (!width && bins.count && bins.count > 0) width = (hi - lo) / Math.round(bins.count);
  if (!width) {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1)) : 0;
    width = (3.5 * sd) / Math.cbrt(xs.length);
  }
  if (!(width > 0)) width = hi > lo ? hi - lo : 1;
  const n = Math.min(1000, Math.max(1, Math.ceil((hi - lo) / width - 1e-9)));
  const counts = new Array<number>(n).fill(0);
  let below = 0, above = 0;
  for (const v of xs) {
    if (under !== undefined && v <= under) { below++; continue; }
    if (over !== undefined && v > over) { above++; continue; }
    const k = Math.min(n - 1, Math.max(0, Math.ceil((v - lo) / width - 1e-9) - 1));
    counts[k]++;
  }
  const labels = counts.map((_, k) => `${k === 0 && under === undefined ? '[' : '('}${short(lo + k * width)}, ${short(lo + (k + 1) * width)}]`);
  if (under !== undefined) { labels.unshift(`≤ ${short(under)}`); counts.unshift(below); }
  if (over !== undefined) { labels.push(`> ${short(over)}`); counts.push(above); }
  return { labels, counts, width };
}

export interface BoxStats {
  q1: number; median: number; q3: number;
  /** The ends of the whiskers: the furthest points within 1.5 × the box's height. */
  lo: number; hi: number;
  mean: number;
  outliers: number[];
  /** The points within the whiskers. */
  inside: number[];
  n: number;
}

/** A quartile (p = 0.25, 0.5, 0.75) of numbers in order, as QUARTILE.EXC or QUARTILE.INC. */
export function quartile(sorted: number[], p: number, method: 'exclusive' | 'inclusive' = 'exclusive'): number {
  const n = sorted.length;
  if (!n) return NaN;
  let h = method === 'exclusive' ? (n + 1) * p - 1 : (n - 1) * p;
  h = Math.min(n - 1, Math.max(0, h));
  const i = Math.floor(h);
  return i + 1 < n ? sorted[i] + (h - i) * (sorted[i + 1] - sorted[i]) : sorted[i];
}

/** The box, whiskers and outliers of some numbers (null when there are none). */
export function boxStats(values: number[], opts: BoxOptions = {}): BoxStats | null {
  const xs = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = opts.quartiles ?? 'exclusive';
  const q1 = quartile(xs, 0.25, m), median = quartile(xs, 0.5, m), q3 = quartile(xs, 0.75, m);
  const reach = 1.5 * (q3 - q1);
  const inside = xs.filter((v) => v >= q1 - reach - 1e-12 && v <= q3 + reach + 1e-12);
  const outliers = xs.filter((v) => !inside.includes(v));
  return {
    q1, median, q3,
    lo: inside.length ? inside[0] : q1,
    hi: inside.length ? inside[inside.length - 1] : q3,
    mean: xs.reduce((a, b) => a + b, 0) / xs.length,
    outliers, inside, n: xs.length,
  };
}

/**
 * A box and whisker chart's boxes: one for each series in each category. The categories are the
 * different labels of the first series' labels column, in the order they first come (rows with
 * the same label make one box); with no labels there is one category.
 */
export function boxGroups(series: { cats: string[]; ys: number[] }[], hasLabels: boolean, opts: BoxOptions = {}): { cats: string[]; stats: (BoxStats | null)[][] } {
  const cats: string[] = [];
  if (hasLabels) for (const s of series) for (const c of s.cats) if (!cats.includes(c)) cats.push(c);
  if (!cats.length) cats.push('');
  const stats = series.map((s) => cats.map((c) => boxStats(s.ys.filter((_, j) => !hasLabels || s.cats[j] === c), opts)));
  return { cats, stats };
}
