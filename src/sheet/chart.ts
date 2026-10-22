// Charts of sheet data, as Excel makes them: scatter (x–y), line, column, bar, area, pie, combo
// (columns and lines, with a second value axis), histogram, box and whisker, bubble and radar.
// Each series reads its numbers from cells, so the chart follows the sheet as it changes. A
// scatter series can carry a fitted line (with its equation and R²) and error bars, for kinetics,
// calibration curves and the like. Data in rows hidden by a filter is left out, as Excel does by
// default, so a filtered table charts only what shows.

import type { Sheet, Workbook } from './workbook';
import { formulaRefs, adjustFormula, renameSheetInFormula, SheetChange } from './formula';
import { Range, colName, quoteSheet, keyOf } from './refs';
import type { Value } from './values';
import { isError } from './values';
import type { FitKind } from './fit';

export type ChartKind = 'scatter' | 'line' | 'column' | 'bar' | 'area' | 'pie' | 'combo' | 'histogram' | 'box' | 'bubble' | 'radar';
export type MarkerShape = 'circle' | 'square' | 'diamond' | 'triangle' | 'cross' | 'none';

export interface SeriesFit {
  kind: FitKind;
  showEq?: boolean;
  showR2?: boolean;
  /** Fix where the line crosses x = 0 (straight line and polynomials; exponential: its value at 0). */
  intercept?: number;
  /** Extend the line beyond the data, in x units. */
  forward?: number;
  backward?: number;
  color?: string;
  /** List the line in the legend (as Excel does); off leaves it out. */
  legend?: boolean;
  /** Where the equation sits, as a fraction of the plot (dragged by hand); unset: beside the line's end. */
  labelAt?: { x: number; y: number };
}

export interface ErrorBars {
  kind: 'fixed' | 'percent' | 'stdev' | 'cells';
  value?: number;
  /** For 'cells': the plus (and minus, else the same) amounts, one per point. */
  plus?: string;
  minus?: string;
}

export interface Series {
  /** A name typed in, or a cell reference ("=Sheet1!$B$1"). */
  name?: string;
  /** X values (scatter) or category labels, as a reference; unset: 1, 2, 3… */
  x?: string;
  /** The numbers, as a reference ("=Sheet1!$B$2:$B$9"). */
  y: string;
  color?: string;
  marker?: MarkerShape;
  markerSize?: number;
  /** Scatter: join the points with a line. Line charts: false hides it (markers only). */
  line?: boolean;
  smooth?: boolean;
  dash?: 'solid' | 'dash' | 'dot';
  lineWidth?: number;
  fit?: SeriesFit;
  errors?: ErrorBars;
  /** Show each point's value beside it. */
  labels?: boolean;
  /** Scatter: labels show each point's x value (m/z over a mass spectrum's peaks) in place of y. */
  labelX?: boolean;
  /** An Excel number format for the labels (unset: the axis's). */
  labelFmt?: string;
  /**
   * Scatter: draw each point as a line up (or down) from zero, as peaks in a mass spectrum. Saved
   * for Excel as error bars running from each point to zero.
   */
  sticks?: boolean;
  /** Combo charts: drawn as columns or as a line (unset: the first series columns, the rest lines). */
  as?: 'column' | 'line';
  /** Combo charts: measured on the second value axis, on the right (unset: every series but the first). */
  secondary?: boolean;
  /** Bubble charts: the bubble sizes, as a reference (each bubble's area goes with its number). */
  size?: string;
}

export interface ChartAxis {
  title?: string;
  min?: number;
  max?: number;
  /** Gap between labelled ticks (unset: chosen to fit). */
  step?: number;
  log?: boolean;
  grid?: boolean;
  /** An Excel number format for the labels. */
  numFmt?: string;
  reverse?: boolean;
}

export interface Chart {
  id: number;
  kind: ChartKind;
  title?: string;
  series: Series[];
  x: ChartAxis;
  y: ChartAxis;
  legend: 'right' | 'bottom' | 'top' | 'none';
  /** Columns, bars and areas stacked on each other. */
  stacked?: boolean;
  /** Colours given to series without their own. */
  palette?: string;
  font?: string;
  fontSize?: number;
  /** The chart's background colour; 'none' for see-through (on slides). Unset: white. */
  background?: string;
  /** Draw the thin border round the chart (on unless turned off). */
  border?: boolean;
  /** Include data from hidden rows and columns (off: a filtered table charts what shows). */
  showHidden?: boolean;
  /** Combo charts: the second value axis, on the right. */
  y2?: ChartAxis;
  /** Histograms: how the numbers are put into bins (unset: Excel's automatic width, Scott's rule). */
  bins?: Bins;
  /** Box and whisker charts: what is shown and how the quartiles are worked out. */
  boxes?: BoxOptions;
  /** Radar charts: filled shapes in place of lines with markers. */
  filled?: boolean;
  /** A PivotChart: the id of the PivotTable it charts (its series follow the report when it refreshes). */
  pivot?: number;
  /** Where it sits: its top-left corner in a cell, and its size, in pixels at 100%. */
  at: { row: number; col: number; dx: number; dy: number };
  w: number;
  h: number;
}

export interface Bins {
  /** The width of each bin. */
  width?: number;
  /** The number of bins (used when no width is set). */
  count?: number;
  /** Everything above this goes in one last bin ("> 90"). */
  overflow?: number;
  /** Everything at or below this goes in one first bin ("≤ 10"). */
  underflow?: number;
}

export interface BoxOptions {
  /** The mean as a cross (on unless turned off). */
  mean?: boolean;
  /** A line joining the means of each category. */
  meanLine?: boolean;
  /** Points beyond 1.5 × the box's height drawn on their own (on unless turned off). */
  outliers?: boolean;
  /** Every other point drawn too. */
  points?: boolean;
  /** How the quartiles are worked out: Excel's exclusive median (QUARTILE.EXC, its default) or inclusive (QUARTILE.INC). */
  quartiles?: 'exclusive' | 'inclusive';
}

/** Combo charts: how a series is drawn, and whether on the second axis. */
export const comboAs = (s: Series, i: number): 'column' | 'line' => s.as ?? (i === 0 ? 'column' : 'line');
export const onSecondAxis = (s: Series, i: number): boolean => s.secondary ?? i > 0;

/** Charts Excel keeps in its newer chart part (chartEx, Excel 2016 and later). */
export const isChartEx = (k: ChartKind): boolean => k === 'histogram' || k === 'box';

/** Charts whose x values are numbers (an axis of values, not of categories). */
export const isXY = (k: ChartKind): boolean => k === 'scatter' || k === 'bubble';

/** Colour sets for series, the first as Excel's Office colours. */
export const CHART_PALETTES: Record<string, { name: string; colors: string[] }> = {
  office: { name: 'Office', colors: ['#4472c4', '#ed7d31', '#a5a5a5', '#ffc000', '#5b9bd5', '#70ad47', '#264478', '#9e480e', '#636363', '#997300'] },
  safe: { name: 'Colour-blind safe (Okabe–Ito)', colors: ['#0072b2', '#e69f00', '#009e73', '#d55e00', '#56b4e9', '#cc79a7', '#f0e442', '#000000'] },
  journal: { name: 'Black and greys (for print)', colors: ['#000000', '#555555', '#888888', '#bbbbbb', '#333333', '#777777'] },
  blues: { name: 'Blues', colors: ['#08306b', '#2171b5', '#6baed6', '#9ecae1', '#4292c6', '#c6dbef'] },
  warm: { name: 'Warm', colors: ['#b2182b', '#ef8a62', '#f4a582', '#d6604d', '#fddbc7', '#67001f'] },
  muted: { name: 'Muted', colors: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'] },
};

export const MARKERS: MarkerShape[] = ['circle', 'square', 'diamond', 'triangle', 'cross'];

export const CHART_NAMES: Record<ChartKind, string> = {
  scatter: 'Scatter (x–y)', line: 'Line', column: 'Column', bar: 'Bar', area: 'Area', pie: 'Pie',
  combo: 'Combo (columns and lines)', histogram: 'Histogram', box: 'Box and whisker', bubble: 'Bubble', radar: 'Radar',
};

let nextChartId = 1;
export function seenChartId(id: number): void {
  if (id >= nextChartId) nextChartId = id + 1;
}
export const newChartId = (): number => nextChartId++;

/** Do two charts chart the same cells the same way (so our own copy of a chart can stand in for Excel's)? */
export function sameChartData(a: Chart, b: Chart): boolean {
  const kindOf = (k: ChartKind) => (k === 'bar' ? 'column' : k);
  if (kindOf(a.kind) !== kindOf(b.kind) || a.series.length !== b.series.length) return false;
  const norm = (t: string | undefined) => (t ?? '').replace(/^=/, '').replace(/'/g, '').toUpperCase();
  return a.series.every((s, i) => norm(s.y) === norm(b.series[i].y) && norm(s.x) === norm(b.series[i].x) && norm(s.size) === norm(b.series[i].size) && !!s.fit === !!b.series[i].fit && (s.fit?.kind ?? '') === (b.series[i].fit?.kind ?? ''));
}

/** A reference to a block of cells on a sheet, as a chart keeps it ("=Sheet1!$B$2:$B$9"). */
export function refText(sheet: string, r: Range): string {
  const a = `$${colName(r.c1)}$${r.r1 + 1}`, b = `$${colName(r.c2)}$${r.r2 + 1}`;
  return `=${quoteSheet(sheet)}!${a === b ? a : `${a}:${b}`}`;
}

/** The sheet and block a reference names (null when it doesn't read or names no sheet there is). */
export function readRef(wb: Workbook, text: string | undefined, home: Sheet): { sheet: Sheet; range: Range } | null {
  if (!text?.trim()) return null;
  const t = text.trim().startsWith('=') ? text.trim() : '=' + text.trim();
  let refs;
  try { refs = formulaRefs(t); } catch { return null; }
  const ref = refs[0];
  if (!ref || ref.broken) return null;
  const sheet = ref.sheet !== undefined ? wb.sheetNamed(ref.sheet) : home;
  if (!sheet) return null;
  const b = ref.b ?? ref.a;
  return { sheet, range: { r1: Math.min(ref.a.row, b.row), c1: Math.min(ref.a.col, b.col), r2: Math.max(ref.a.row, b.row), c2: Math.max(ref.a.col, b.col) } };
}

/** The values of a reference in reading order, leaving out hidden rows and columns unless asked. */
export function refValues(wb: Workbook, text: string | undefined, home: Sheet, showHidden = false, leaveOut?: Map<Sheet, Set<number>>): Value[] | null {
  const got = readRef(wb, text, home);
  if (!got) return null;
  const { sheet: s, range: r } = got;
  const out: Value[] = [];
  const r2 = Math.min(r.r2, Math.max(s.lastRow, r.r1)), c2 = Math.min(r.c2, Math.max(s.lastCol, r.c1));
  const out2 = leaveOut?.get(s);
  for (let row = r.r1; row <= r2; row++) {
    if (!showHidden && s.hiddenRows.has(row)) continue;
    if (out2?.has(row)) continue;
    for (let col = r.c1; col <= c2; col++) {
      if (!showHidden && s.hiddenCols.has(col)) continue;
      out.push(s.values.get(keyOf(row, col)) ?? null);
    }
  }
  return out;
}

/** A series made ready to draw. */
export interface SeriesData {
  name: string;
  /** X values for a scatter chart (NaN where a cell isn't a number). */
  xs: number[];
  /** Category labels for other charts. */
  cats: string[];
  /** The numbers (NaN where a cell isn't a number: a gap). */
  ys: number[];
  plus?: number[];
  minus?: number[];
  /** Bubble sizes (bubble charts). */
  sizes?: number[];
  color: string;
  index: number;
}

const toNum = (v: Value): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const toLabel = (v: Value): string => (v === null || isError(v) ? '' : typeof v === 'number' ? String(Number(v.toPrecision(10))) : String(v));

/** The series of a chart with their numbers read from the sheets. */
export function chartData(wb: Workbook, home: Sheet, chart: Chart, leaveOut?: Map<Sheet, Set<number>>): SeriesData[] {
  const palette = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  return chart.series.map((s, i) => {
    const yv = refValues(wb, s.y, home, chart.showHidden, leaveOut) ?? [];
    const xv = s.x ? refValues(wb, s.x, home, chart.showHidden, leaveOut) ?? [] : null;
    const ys = yv.map(toNum);
    const xs = xv ? xv.map(toNum) : ys.map((_, j) => j + 1);
    const cats = xv ? xv.map(toLabel) : ys.map((_, j) => String(j + 1));
    let name = s.name ?? '';
    if (name.startsWith('=')) name = (refValues(wb, name, home, true) ?? []).map(toLabel).join(' ');
    const d: SeriesData = { name: name || `Series ${i + 1}`, xs, cats, ys, color: s.color ?? palette[i % palette.length], index: i };
    if (chart.kind === 'bubble') {
      const sz = s.size ? (refValues(wb, s.size, home, chart.showHidden, leaveOut) ?? []).map(toNum) : [];
      d.sizes = ys.map((_, j) => (s.size ? sz[j] ?? NaN : 1));
    }
    const e = s.errors;
    if (e) {
      if (e.kind === 'cells') {
        const p = (refValues(wb, e.plus, home, chart.showHidden, leaveOut) ?? []).map(toNum);
        const m = e.minus ? (refValues(wb, e.minus, home, chart.showHidden, leaveOut) ?? []).map(toNum) : p;
        d.plus = ys.map((_, j) => p[j] ?? NaN);
        d.minus = ys.map((_, j) => m[j] ?? NaN);
      } else if (e.kind === 'stdev') {
        const ok = ys.filter(Number.isFinite);
        const mean = ok.reduce((a, b) => a + b, 0) / (ok.length || 1);
        const sd = ok.length > 1 ? Math.sqrt(ok.reduce((a, b) => a + (b - mean) ** 2, 0) / (ok.length - 1)) : 0;
        d.plus = ys.map(() => sd * (e.value ?? 1));
        d.minus = d.plus;
      } else {
        d.plus = ys.map((y) => (e.kind === 'percent' ? Math.abs(y) * (e.value ?? 5) / 100 : e.value ?? 1));
        d.minus = d.plus;
      }
    }
    return d;
  });
}

/**
 * A new chart of a block of cells, laid out as Excel lays one out: a header row names the series;
 * for a scatter chart the first column is x and each other column a series; for other charts a
 * first column of text gives the categories.
 */
export function chartFromRange(sheet: Sheet, r: Range, kind: ChartKind): Chart {
  const isNum = (row: number, col: number) => typeof sheet.value(row, col) === 'number';
  const isText = (row: number, col: number) => typeof sheet.value(row, col) === 'string' && sheet.value(row, col) !== '';
  let header = false;
  for (let c = r.c1; c <= r.c2; c++) if (isText(r.r1, c) && r.r2 > r.r1 && (isNum(r.r1 + 1, c) || c > r.c1)) header = true;
  const first = header ? r.r1 + 1 : r.r1;
  const textCats = r.c2 > r.c1 && !isNum(first, r.c1) && isText(first, r.c1);
  const firstIsX = r.c2 > r.c1 && (isXY(kind) || textCats) && kind !== 'histogram';
  const ref = (c1: number, rr1: number, rr2: number) => refText(sheet.name, { r1: rr1, c1, r2: rr2, c2: c1 });
  const series: Series[] = [];
  // a bubble chart takes its columns in pairs: the heights, then the sizes
  const stride = kind === 'bubble' ? 2 : 1;
  for (let c = firstIsX || (kind === 'histogram' && textCats) ? r.c1 + 1 : r.c1; c <= r.c2; c += stride) {
    series.push({
      ...(header ? { name: ref(c, r.r1, r.r1) } : {}),
      ...(firstIsX ? { x: ref(r.c1, first, r.r2) } : {}),
      y: ref(c, first, r.r2),
      ...(stride === 2 && c + 1 <= r.c2 ? { size: ref(c + 1, first, r.r2) } : {}),
    });
  }
  // a pie and a histogram chart one column of numbers
  if (kind === 'pie' || kind === 'histogram') series.splice(1);
  const xTitle = isXY(kind) && header && firstIsX ? String(sheet.value(r.r1, r.c1) ?? '') : undefined;
  const yTitle = isXY(kind) && header && series.length === 1 ? String(sheet.value(r.r1, r.c1 + 1) ?? '') : undefined;
  const yCol = firstIsX || (kind === 'histogram' && textCats) ? r.c1 + 1 : r.c1;
  return {
    id: nextChartId++,
    kind,
    ...(series.length === 1 && header && !isXY(kind) ? { title: String(sheet.value(r.r1, yCol) ?? '') } : {}),
    series,
    x: { ...(xTitle ? { title: xTitle } : {}), grid: false },
    y: { ...(yTitle ? { title: yTitle } : {}), grid: kind !== 'pie' },
    legend: (series.length > 1 && kind !== 'combo') || kind === 'pie' ? 'right' : kind === 'combo' && series.length > 1 ? 'bottom' : 'none',
    at: { row: r.r1, col: r.c2 + 2, dx: 0, dy: 0 },
    w: 480,
    h: 290,
  };
}

/** A chart with every formula reference passed through a change (rows inserted, a sheet renamed). */
export function mapChartRefs(c: Chart, fn: (formula: string) => string): Chart {
  const m = (t: string | undefined) => (t && t.startsWith('=') ? fn(t) : t);
  return {
    ...c,
    series: c.series.map((s) => ({
      ...s,
      name: m(s.name),
      x: m(s.x),
      y: m(s.y)!,
      ...(s.size ? { size: m(s.size) } : {}),
      ...(s.errors ? { errors: { ...s.errors, plus: m(s.errors.plus), minus: m(s.errors.minus) } } : {}),
    })),
  };
}

export const adjustChart = (c: Chart, home: string, ch: SheetChange): Chart => mapChartRefs(c, (f) => adjustFormula(f, home, ch));
export const renameInChart = (c: Chart, from: string, to: string): Chart => mapChartRefs(c, (f) => renameSheetInFormula(f, from, to));

// ---------------------------------------------------------------- axes

/** Ticks for an axis: a "nice" step (1, 2 or 5 × a power of ten) giving about `want` gaps. */
export function niceTicks(lo: number, hi: number, want = 5, step?: number): { min: number; max: number; step: number; ticks: number[] } {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  if (lo === hi) { const d = lo === 0 ? 1 : Math.abs(lo) * 0.1; lo -= d; hi += d; }
  if (lo > hi) [lo, hi] = [hi, lo];
  let s = step;
  if (!s || s <= 0) {
    const raw = (hi - lo) / want;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    s = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  const min = Math.floor(lo / s + 1e-9) * s, max = Math.ceil(hi / s - 1e-9) * s;
  const ticks: number[] = [];
  for (let v = min, i = 0; v <= max + s * 1e-9 && i < 1000; v = min + ++i * s) ticks.push(Number(v.toPrecision(12)));
  return { min, max, step: s, ticks };
}

/** Ticks for a log axis: the powers of ten covering the range. */
export function logTicks(lo: number, hi: number): { min: number; max: number; ticks: number[] } {
  const a = Math.floor(Math.log10(Math.max(lo, 1e-300))), b = Math.ceil(Math.log10(Math.max(hi, 1e-300)));
  const ticks: number[] = [];
  for (let e = a; e <= Math.max(b, a + 1); e++) ticks.push(Math.pow(10, e));
  return { min: ticks[0], max: ticks[ticks.length - 1], ticks };
}

/** Is a range of cells all numbers (for picking a scatter chart)? */
export function columnIsNumbers(sheet: Sheet, col: number, r1: number, r2: number): boolean {
  let any = false;
  for (let r = r1; r <= r2; r++) {
    const v = sheet.value(r, col);
    if (v === null || v === '') continue;
    if (typeof v !== 'number') return false;
    any = true;
  }
  return any;
}
