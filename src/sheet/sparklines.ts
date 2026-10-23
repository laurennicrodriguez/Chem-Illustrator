// Insert > Sparklines: a little line, column or win/loss chart inside a cell, of a row or column of
// numbers (yields across a screen, conversion over time). Sparklines made together are a group
// that shares its look: colours, the points marked (high, low, first, last, negative, every
// point), the axis and how empty cells show. Saved to Excel as its own sparklines (the x14
// extension of a worksheet), so they come back in either program.

import type { Range } from './refs';
import { parseRange, rangeName } from './refs';

export type SparkKind = 'line' | 'column' | 'winloss';

export interface Sparkline {
  /** The cell it is drawn in. */
  row: number;
  col: number;
  /** The cells it charts, as a reference (B2:F2, or Data!B2:F2 on another sheet). */
  data: string;
}

/** Where an axis of a group starts or ends: each sparkline its own, the same for the group, or a number. */
export type SparkAxisLimit = 'each' | 'group' | number;

export interface SparklineGroup {
  id: number;
  kind: SparkKind;
  items: Sparkline[];
  /** "#rrggbb" colours. */
  color: string;
  negColor: string;
  markerColor: string;
  highColor: string;
  lowColor: string;
  firstColor: string;
  lastColor: string;
  axisColor?: string;
  /** Which points stand out. */
  markers?: boolean;
  high?: boolean;
  low?: boolean;
  first?: boolean;
  last?: boolean;
  negative?: boolean;
  /** Draw the line where the values cross zero. */
  axis?: boolean;
  /** Line width in points (unset: 0.75). */
  weight?: number;
  /** Empty cells: a gap (unset), zero, or the line joined across them. */
  empty?: 'zero' | 'span';
  /** Values shown in hidden rows and columns too. */
  hidden?: boolean;
  minAxis?: SparkAxisLimit;
  maxAxis?: SparkAxisLimit;
  /** Right to left. */
  rtl?: boolean;
}

/** Excel's first sparkline style: dark blue, with red for the points marked. */
export const SPARK_DEFAULTS = { color: '#376092', negColor: '#d00000', markerColor: '#d00000', highColor: '#d00000', lowColor: '#d00000', firstColor: '#d00000', lastColor: '#d00000' };

/** Ready-made looks for the Sparkline tab's Style gallery: line colour and marked points. */
export const SPARK_STYLES: { name: string; color: string; mark: string; neg: string }[] = [
  { name: 'Dark blue', color: '#376092', mark: '#d00000', neg: '#d00000' },
  { name: 'Blue', color: '#4472c4', mark: '#ed7d31', neg: '#c00000' },
  { name: 'Teal', color: '#2d6a7a', mark: '#e07a3f', neg: '#b33951' },
  { name: 'Green', color: '#548235', mark: '#c00000', neg: '#c00000' },
  { name: 'Orange', color: '#c55a11', mark: '#2f5597', neg: '#7f7f7f' },
  { name: 'Grey', color: '#595959', mark: '#c00000', neg: '#c00000' },
  { name: 'Purple', color: '#7030a0', mark: '#00b050', neg: '#c00000' },
  { name: 'Black', color: '#000000', mark: '#ff0000', neg: '#ff0000' },
];

let nextId = 1;
export function newSparkId(): number { return nextId++; }
export function seenSparkId(id: number): void { if (id >= nextId) nextId = id + 1; }

/** A group made from one block of data and the cells to put the sparklines in (one each along its rows or columns). */
export function makeSparklines(kind: SparkKind, data: Range, place: Range, sheet?: string): SparklineGroup | string {
  const cells: { row: number; col: number }[] = [];
  for (let r = place.r1; r <= place.r2; r++) for (let c = place.c1; c <= place.c2; c++) cells.push({ row: r, col: c });
  const rows = data.r2 - data.r1 + 1, cols = data.c2 - data.c1 + 1;
  const prefix = sheet ? `${/^[A-Za-z_][A-Za-z0-9_.]*$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!` : '';
  const ref = (R: Range) => prefix + rangeName(R);
  let pieces: Range[];
  if (cells.length === 1) pieces = [data];
  // one sparkline for each row of data (the cells in a column), or each column (the cells in a row)
  else if (place.c1 === place.c2 && cells.length === rows) pieces = cells.map((_, i) => ({ r1: data.r1 + i, c1: data.c1, r2: data.r1 + i, c2: data.c2 }));
  else if (place.r1 === place.r2 && cells.length === cols) pieces = cells.map((_, i) => ({ r1: data.r1, c1: data.c1 + i, r2: data.r2, c2: data.c1 + i }));
  else if (cells.length === rows) pieces = cells.map((_, i) => ({ r1: data.r1 + i, c1: data.c1, r2: data.r1 + i, c2: data.c2 }));
  else if (cells.length === cols) pieces = cells.map((_, i) => ({ r1: data.r1, c1: data.c1 + i, r2: data.r2, c2: data.c1 + i }));
  else return 'The place for the sparklines needs one cell for each row (or column) of the data.';
  if (place.r1 !== place.r2 && place.c1 !== place.c2) return 'Put the sparklines in one row or one column of cells.';
  return { id: newSparkId(), kind, items: cells.map((c, i) => ({ ...c, data: ref(pieces[i]) })), ...SPARK_DEFAULTS };
}

/** A sparkline's data reference split into its sheet (undefined: the sparkline's own) and block. */
export function sparkSource(data: string): { sheet?: string; range: Range } | null {
  const bang = data.lastIndexOf('!');
  const sheet = bang < 0 ? undefined : data.slice(0, bang).replace(/^'(.*)'$/, '$1').replace(/''/g, "'");
  const range = parseRange(data.slice(bang + 1).replace(/\$/g, ''));
  return range ? { sheet, range } : null;
}

/** The group and sparkline drawn in a cell, if any. */
export function sparklineAt(groups: SparklineGroup[], row: number, col: number): { group: SparklineGroup; item: Sparkline } | null {
  for (const g of groups) for (const it of g.items) if (it.row === row && it.col === col) return { group: g, item: it };
  return null;
}

/** Sparklines after rows or columns go in or out: each moves with its cell (and its data's block with its cells); one whose cell goes is gone. */
export function moveSparklines(groups: SparklineGroup[], axis: 'row' | 'col', at: number, count: number): SparklineGroup[] {
  const out: SparklineGroup[] = [];
  for (const g of groups) {
    const items: Sparkline[] = [];
    for (const it of g.items) {
      const i = axis === 'row' ? it.row : it.col;
      if (count < 0 && i >= at && i < at - count) continue;
      const n = i >= at ? i + count : i;
      items.push(n === i ? it : axis === 'row' ? { ...it, row: n } : { ...it, col: n });
    }
    if (items.length) out.push(items.some((x, k) => x !== g.items[k]) || items.length !== g.items.length ? { ...g, items } : g);
  }
  return out;
}

// ---------------------------------------------------------------- what is drawn

export interface SparkShape {
  /** A line through the points (gaps break it: null). */
  line?: ({ x: number; y: number } | null)[];
  /** Columns or win/loss bars: each with its colour. */
  bars?: { x: number; y: number; w: number; h: number; color: string }[];
  /** Points marked on a line. */
  dots?: { x: number; y: number; color: string }[];
  /** The zero line, if shown. */
  axis?: number;
}

/**
 * Where everything goes in a box of w × h pixels: values in order (null for an empty cell), and
 * the lowest and highest the axis runs to (the group's, when it shares them).
 */
export function sparkShape(g: SparklineGroup, values: (number | null)[], w: number, h: number, lim?: { min: number; max: number }): SparkShape {
  let vals = g.empty === 'zero' ? values.map((v) => v ?? 0) : values.slice();
  if (g.rtl) vals = vals.reverse();
  const nums = vals.filter((v): v is number => v !== null);
  if (!nums.length) return {};
  const pad = 2;
  const innerW = Math.max(1, w - 2 * pad), innerH = Math.max(1, h - 2 * pad);
  const n = vals.length;
  const hi = Math.max(...nums), lo = Math.min(...nums);
  // a mark on each special point (the first of equal highs and lows)
  const firstAt = vals.findIndex((v) => v !== null);
  let lastAt = -1;
  for (let i = n - 1; i >= 0; i--) if (vals[i] !== null) { lastAt = i; break; }
  const hiAt = vals.indexOf(hi), loAt = vals.indexOf(lo);
  const markOf = (i: number, v: number): string | null => {
    if (g.kind === 'winloss' || g.kind === 'column') {
      if (g.high && i === hiAt) return g.highColor;
      if (g.low && i === loAt) return g.lowColor;
      if (g.first && i === firstAt) return g.firstColor;
      if (g.last && i === lastAt) return g.lastColor;
      if (v < 0 && (g.negative || g.kind === 'winloss')) return g.negColor;
      return null;
    }
    if (g.high && i === hiAt) return g.highColor;
    if (g.low && i === loAt) return g.lowColor;
    if (g.first && i === firstAt) return g.firstColor;
    if (g.last && i === lastAt) return g.lastColor;
    if (g.negative && v < 0) return g.negColor;
    if (g.markers) return g.markerColor;
    return null;
  };
  if (g.kind === 'winloss') {
    const slot = innerW / n, bw = Math.max(1, slot * 0.7), mid = pad + innerH / 2;
    const bars = vals.flatMap((v, i) => (v === null || v === 0 ? [] : [{ x: pad + i * slot + (slot - bw) / 2, y: v > 0 ? pad : mid, w: bw, h: innerH / 2, color: markOf(i, v) ?? g.color }]));
    return { bars, ...(g.axis ? { axis: mid } : {}) };
  }
  // columns stand on zero unless the axis is set otherwise
  let min = lim?.min ?? (g.kind === 'column' ? Math.min(0, lo) : lo);
  let max = lim?.max ?? hi;
  if (max === min) { max += 1; min -= g.kind === 'column' ? 0 : 1; }
  const yOf = (v: number) => pad + innerH - ((Math.min(max, Math.max(min, v)) - min) / (max - min)) * innerH;
  const zero = min <= 0 && max >= 0 ? yOf(0) : undefined;
  if (g.kind === 'column') {
    const slot = innerW / n, bw = Math.max(1, slot * 0.75);
    const base = zero ?? yOf(min);
    const bars = vals.flatMap((v, i) => {
      if (v === null) return [];
      const y = yOf(v);
      return [{ x: pad + i * slot + (slot - bw) / 2, y: Math.min(y, base), w: bw, h: Math.max(1, Math.abs(base - y)), color: markOf(i, v) ?? g.color }];
    });
    return { bars, ...(g.axis && zero !== undefined ? { axis: zero } : {}) };
  }
  const xOf = (i: number) => pad + (n === 1 ? innerW / 2 : (i / (n - 1)) * innerW);
  const line: ({ x: number; y: number } | null)[] = [];
  vals.forEach((v, i) => {
    if (v === null) { if (g.empty !== 'span') line.push(null); return; }
    line.push({ x: xOf(i), y: yOf(v) });
  });
  const dots = vals.flatMap((v, i) => {
    if (v === null) return [];
    const c = markOf(i, v);
    return c ? [{ x: xOf(i), y: yOf(v), color: c }] : [];
  });
  return { line, dots, ...(g.axis && zero !== undefined ? { axis: zero } : {}) };
}
