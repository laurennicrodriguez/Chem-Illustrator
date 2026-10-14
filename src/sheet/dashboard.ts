// Dashboards: a sheet of tiles (charts, headline numbers, tables, slicers, galleries of
// structures, notes) laid out on a grid and fed by the workbook's tables. Clicking values in a
// slicer filters every tile fed by the same table, as PowerBI's slicers do; the cells themselves
// are never changed.

import type { Sheet, Workbook } from './workbook';
import type { Range } from './refs';
import { inRange } from './refs';
import type { Value } from './values';
import { isError } from './values';
import { Chart, SeriesData, readRef, refText, mapChartRefs } from './chart';
import { adjustFormula, renameSheetInFormula, SheetChange } from './formula';

/** Where a tile's rows come from: a table by name (it grows with the table), or a block of cells with a header row. */
export interface Source {
  table?: string;
  range?: string;
}

export type Aggregate = 'count' | 'countValues' | 'sum' | 'average' | 'median' | 'min' | 'max' | 'stdev' | 'distinct';

export const AGGREGATE_NAMES: Record<Aggregate, string> = {
  count: 'Number of rows', countValues: 'Number of values', sum: 'Sum', average: 'Average', median: 'Median', min: 'Smallest', max: 'Largest', stdev: 'Standard deviation', distinct: 'Number of different values',
};

interface TileBase {
  id: number;
  /** Place on the grid: column, row, width and height in grid squares. */
  x: number; y: number; w: number; h: number;
  title?: string;
  /** Background colour of the tile (unset: white). */
  fill?: string;
}

export interface ChartTile extends TileBase {
  kind: 'chart';
  chart: Chart;
  /** Rows with the same label are combined into one bar or point (an average, a total…); unset: one per row. */
  group?: Aggregate;
}
export interface KpiTile extends TileBase {
  kind: 'kpi';
  source?: Source;
  column?: string;
  agg: Aggregate;
  /** Instead of an aggregate: any formula ("=AVERAGE(Sheet1!C2:C20)"), which slicers don't filter. */
  formula?: string;
  numFmt?: string;
  /** A target: the number shows green when it meets it (or red when not). */
  target?: number;
  higherIsBetter?: boolean;
  /** Text after the number (" %", " h"). */
  suffix?: string;
}
export interface TableTile extends TileBase { kind: 'table'; source: Source; columns?: string[]; sortBy?: string; descending?: boolean; maxRows?: number }
export interface SlicerTile extends TileBase { kind: 'slicer'; source: Source; column: string; selected?: string[] }
export interface GalleryTile extends TileBase { kind: 'gallery'; source: Source; structure: string; labels?: string[]; size?: number }
export interface TextTile extends TileBase { kind: 'text'; text: string; size?: number; bold?: boolean; align?: 'left' | 'center' | 'right'; color?: string }

export type Tile = ChartTile | KpiTile | TableTile | SlicerTile | GalleryTile | TextTile;
export type TileKind = Tile['kind'];

export const TILE_NAMES: Record<TileKind, string> = {
  chart: 'Chart', kpi: 'Headline number', table: 'Table', slicer: 'Slicer (filter buttons)', gallery: 'Structure gallery', text: 'Text',
};

export interface Dashboard {
  tiles: Tile[];
  /** Grid columns across the page (tiles snap to them). */
  cols: number;
  /** Height of a grid row, in pixels at 100%. */
  rowH: number;
  /** Space between tiles, in pixels. */
  gap: number;
  background?: string;
}

export const newDashboard = (): Dashboard => ({ tiles: [], cols: 12, rowH: 60, gap: 10 });

let nextTileId = 1;
export function seenTileId(id: number): void { if (id >= nextTileId) nextTileId = id + 1; }
export const newTileId = (): number => nextTileId++;

// ---------------------------------------------------------------- sources

export interface Resolved {
  sheet: Sheet;
  range: Range;
  /** Column names from the header row (made unique, as a table's are). */
  names: string[];
  /** The rows of data (header and totals rows left out). */
  rows: number[];
}

/** The cells a source names; null when its table or sheet has gone. */
export function resolveSource(wb: Workbook, src: Source | undefined): Resolved | null {
  if (!src) return null;
  let sheet: Sheet | undefined, range: Range | undefined, totals = false;
  if (src.table) {
    for (const s of wb.sheets) {
      const t = s.tables.find((x) => x.name.toLowerCase() === src.table!.toLowerCase());
      if (t) { sheet = s; range = t.range; totals = !!t.totals; break; }
    }
  }
  if (!sheet && src.range) {
    const got = readRef(wb, src.range, wb.sheet);
    if (got) {
      sheet = got.sheet;
      // a whole-column or overlong block stops at the last row in use
      range = { ...got.range, r2: Math.min(got.range.r2, Math.max(got.range.r1, got.sheet.lastRow, got.sheet.lastDataRow)) };
    }
  }
  if (!sheet || !range) return null;
  const seen = new Map<string, number>();
  const names: string[] = [];
  for (let c = range.c1; c <= range.c2; c++) {
    let n = sheet.shownText(range.r1, c).trim() || `Column${c - range.c1 + 1}`;
    const k = n.toLowerCase();
    const count = seen.get(k) ?? 0;
    seen.set(k, count + 1);
    if (count) n = `${n}${count + 1}`;
    names.push(n);
  }
  const rows: number[] = [];
  for (let r = range.r1 + 1; r <= range.r2 - (totals ? 1 : 0); r++) rows.push(r);
  return { sheet, range, names, rows };
}

export const sourceKey = (src: Source | undefined): string => (src?.table ? `t:${src.table.toLowerCase()}` : `r:${(src?.range ?? '').replace(/^=/, '').replace(/\$/g, '').toUpperCase()}`);
export const sourceName = (src: Source | undefined): string => src?.table ?? (src?.range ?? '').replace(/^=/, '').replace(/\$/g, '');

/** A column of a source by name (any case), else by its letter position (1-based number). */
export function columnOf(res: Resolved, name: string | undefined): number | null {
  if (!name) return null;
  const i = res.names.findIndex((n) => n.toLowerCase() === name.toLowerCase());
  return i >= 0 ? res.range.c1 + i : null;
}

/** How a value shows on a slicer button (empty cells as "(blank)"). */
export function slicerText(v: Value): string {
  if (v === null || v === '') return '(blank)';
  if (isError(v)) return String((v as { code?: string }).code ?? v);
  if (typeof v === 'number') return String(Number(v.toPrecision(12)));
  return String(v);
}

/** The different values in a column of a source, in sheet order (numbers sorted when all are numbers). */
export function distinctValues(wb: Workbook, src: Source, column: string): string[] {
  const res = resolveSource(wb, src);
  const col = res ? columnOf(res, column) : null;
  if (!res || col === null) return [];
  const seen = new Map<string, Value>();
  for (const r of res.rows) {
    const v = res.sheet.value(r, col);
    const t = slicerText(v);
    if (!seen.has(t)) seen.set(t, v);
  }
  const list = [...seen];
  if (list.every(([, v]) => typeof v === 'number')) list.sort((a, b) => (a[1] as number) - (b[1] as number));
  return list.map(([t]) => t);
}

/**
 * The rows each slicer leaves out: by sheet, then row. Slicers on one source combine (a row must
 * pass them all), and the rows they leave out are left out of every tile reading those cells.
 */
export function slicerMask(wb: Workbook, d: Dashboard): Map<Sheet, Set<number>> {
  const out = new Map<Sheet, Set<number>>();
  for (const t of d.tiles) {
    if (t.kind !== 'slicer' || !t.selected?.length) continue;
    const res = resolveSource(wb, t.source);
    const col = res ? columnOf(res, t.column) : null;
    if (!res || col === null) continue;
    const keep = new Set(t.selected);
    let set = out.get(res.sheet);
    if (!set) out.set(res.sheet, (set = new Set()));
    for (const r of res.rows) if (!keep.has(slicerText(res.sheet.value(r, col)))) set.add(r);
  }
  return out;
}

/** The rows of a source a tile shows, with the slicers applied. */
export function shownRows(res: Resolved, mask: Map<Sheet, Set<number>>): number[] {
  const m = mask.get(res.sheet);
  return m ? res.rows.filter((r) => !m.has(r)) : res.rows;
}

/** A headline number: an aggregate of a column over the rows the slicers leave, or a formula. */
export function kpiValue(wb: Workbook, t: KpiTile, mask: Map<Sheet, Set<number>>): Value {
  if (t.formula?.trim()) return wb.formulaAt(wb.sheet, t.formula, { row: 0, col: 0 }, 0, 0);
  const res = resolveSource(wb, t.source);
  if (!res) return null;
  const rows = shownRows(res, mask);
  if (t.agg === 'count') return rows.length;
  const col = columnOf(res, t.column);
  if (col === null) return null;
  const vals = rows.map((r) => res.sheet.value(r, col));
  return aggregate(t.agg, vals);
}

export function aggregate(agg: Aggregate, vals: Value[]): Value {
  const nums = vals.filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  switch (agg) {
    case 'count': return vals.length;
    case 'countValues': return vals.filter((v) => v !== null && v !== '').length;
    case 'distinct': return new Set(vals.filter((v) => v !== null && v !== '').map(slicerText)).size;
    case 'sum': return nums.reduce((a, b) => a + b, 0);
    case 'average': return nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : null;
    case 'min': return nums.length ? nums.reduce((a, b) => (b < a ? b : a)) : null;
    case 'max': return nums.length ? nums.reduce((a, b) => (b > a ? b : a)) : null;
    case 'median': {
      if (!nums.length) return null;
      const s = [...nums].sort((a, b) => a - b), m = s.length >> 1;
      return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
    }
    case 'stdev': {
      if (nums.length < 2) return null;
      const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
      return Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (nums.length - 1));
    }
  }
}

/**
 * Series with rows of the same label combined (bars per catalyst, not per run). Labels keep the
 * order they first appear in; with an average or median, the error bars become the standard
 * deviation of each group when the chart has error bars. Scatter charts are left as they are.
 */
export function groupSeries(data: SeriesData[], kind: Chart['kind'], agg: Aggregate | undefined): SeriesData[] {
  if (!agg || kind === 'scatter') return data;
  return data.map((d) => {
    const order: string[] = [];
    const groups = new Map<string, number[]>();
    d.cats.forEach((c, j) => {
      let g = groups.get(c);
      if (!g) { groups.set(c, (g = [])); order.push(c); }
      g.push(d.ys[j]);
    });
    const ys = order.map((c) => {
      const v = aggregate(agg, groups.get(c)!.map((y) => (Number.isFinite(y) ? y : null)));
      return typeof v === 'number' ? v : NaN;
    });
    const out: SeriesData = { ...d, cats: order, xs: order.map((_, j) => j + 1), ys, plus: undefined, minus: undefined };
    if (d.plus && (agg === 'average' || agg === 'median')) {
      out.plus = order.map((c) => {
        const sd = aggregate('stdev', groups.get(c)!.map((y) => (Number.isFinite(y) ? y : null)));
        return typeof sd === 'number' ? sd : 0;
      });
      out.minus = out.plus;
    }
    return out;
  });
}

/** True when a chart's labels repeat (so combining rows would help). */
export const labelsRepeat = (data: SeriesData[]): boolean => data.some((d) => new Set(d.cats).size < d.cats.length);

/** A chart of columns of a source: x (or labels) and one or more value columns. */
export function chartOfColumns(res: Resolved, kind: Chart['kind'], x: string | undefined, ys: string[], id: number): Chart {
  const ref = (col: number, r1: number, r2: number) => refText(res.sheet.name, { r1, c1: col, r2, c2: col });
  const first = res.range.r1 + 1, last = Math.max(first, res.rows[res.rows.length - 1] ?? first);
  const xc = columnOf(res, x);
  const series = ys.map((name) => columnOf(res, name)).filter((c): c is number => c !== null).map((c) => ({
    name: ref(c, res.range.r1, res.range.r1),
    ...(xc !== null ? { x: ref(xc, first, last) } : {}),
    y: ref(c, first, last),
  }));
  return {
    id, kind, series,
    x: { ...(kind === 'scatter' && x ? { title: x } : {}), grid: false },
    y: { ...(series.length === 1 && kind === 'scatter' ? { title: ys[0] } : {}), grid: kind !== 'pie' },
    legend: series.length > 1 || kind === 'pie' ? 'right' : 'none',
    ...(series.length === 1 && kind !== 'scatter' ? { title: ys[0] } : {}),
    at: { row: 0, col: 0, dx: 0, dy: 0 }, w: 480, h: 290,
  };
}

// ---------------------------------------------------------------- keeping references right

function mapRefs(d: Dashboard, fn: (f: string) => string): Dashboard {
  const src = (s: Source | undefined) => (s?.range ? { ...s, range: fn(s.range.startsWith('=') ? s.range : '=' + s.range) } : s);
  return {
    ...d,
    tiles: d.tiles.map((t): Tile => {
      switch (t.kind) {
        case 'chart': return { ...t, chart: mapChartRefs(t.chart, fn) };
        case 'kpi': return { ...t, source: src(t.source), ...(t.formula ? { formula: fn(t.formula.startsWith('=') ? t.formula : '=' + t.formula) } : {}) };
        case 'table': case 'slicer': case 'gallery': return { ...t, source: src(t.source)! };
        default: return t;
      }
    }),
  };
}

export const mapDashboardRefs = mapRefs;
export const adjustDashboard = (d: Dashboard, home: string, ch: SheetChange): Dashboard => mapRefs(d, (f) => adjustFormula(f, home, ch));
export const renameInDashboard = (d: Dashboard, from: string, to: string): Dashboard => mapRefs(d, (f) => renameSheetInFormula(f, from, to));

/** Is a cell inside a source (so a click on the sheet could find the tiles it feeds)? */
export const sourceHas = (res: Resolved, s: Sheet, r: number, c: number): boolean => res.sheet === s && inRange(res.range, r, c);

/** A free place on the grid for a new tile of a size: the first row it fits in, left to right. */
export function freeSpot(d: Dashboard, w: number, h: number): { x: number; y: number } {
  const taken = (x: number, y: number) => d.tiles.some((t) => x < t.x + t.w && t.x < x + w && y < t.y + t.h && t.y < y + h);
  for (let y = 0; y < 500; y++) for (let x = 0; x + w <= d.cols; x++) if (!taken(x, y)) return { x, y };
  return { x: 0, y: Math.max(0, ...d.tiles.map((t) => t.y + t.h)) };
}
