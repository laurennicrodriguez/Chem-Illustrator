// Drawing a chart: on the sheet's canvas, or into a recording (VectorContext) that becomes an SVG
// or EMF picture for documents and slides. Everything is laid out in the chart's own pixels at
// 100%; the caller scales the canvas. Titles take simple sub- and superscripts: k_{obs}, s^{−1}.

import type { Chart, ChartAxis, ChartPick, SeriesData, MarkerShape } from '../sheet/chart';
import { niceTicks, logTicks, CHART_PALETTES, isXY, isLevelled, comboAs, onSecondAxis } from '../sheet/chart';
import { histogram, boxGroups } from '../sheet/chart-stats';
import { sankeyFlows } from '../sheet/sankey';
import { hierarchy, nodeAt, validPath, squarify, type HierNode } from '../sheet/hierarchy';
import { fitPoints, fitAt, fitEquation, r2Text, Fit, FitKind } from '../sheet/fit';
import { cssFamily } from '../text/layout';
import { formatValue, generalNumber } from '../sheet/numfmt';
import { VectorContext, Item, Seg } from './vector';
import { itemsToSvg } from './svg';

// smallest and largest of a series (Math.min(...xs) overflows the stack for very long ones)
const least = (xs: number[]) => xs.reduce((a, b) => (b < a ? b : a), Infinity);
const most = (xs: number[]) => xs.reduce((a, b) => (b > a ? b : a), -Infinity);

type Ctx = CanvasRenderingContext2D | VectorContext;
export interface Box { x: number; y: number; w: number; h: number }

/** What was drawn where, so the sheet can tell what a click lands on. */
export interface ChartHits {
  plot: Box;
  /** The boxes of fitted-line equations (dragged to move them). */
  fitLabels: { series: number; box: Box }[];
  /** The fitted lines worked out, one per series (null where none). */
  fits: (Fit | null)[];
  /** Bars, pie slices, a Sankey chart's nodes and bands, a treemap's boxes and a decomposition tree's nodes, with what a click on each picks. */
  parts?: ChartPart[];
}

export type { ChartPick };

/**
 * A part of a chart. `drill`, on a treemap or decomposition tree, is the chart's `path` a click on
 * it leads to: a treemap drilled into a box's category (or back up, from its trail of categories),
 * a decomposition tree's node expanded (or closed up again).
 */
export type ChartPart = (
  | { shape: 'box'; box: Box; pick: ChartPick }
  | { shape: 'slice'; cx: number; cy: number; r: number; a0: number; a1: number; pick: ChartPick }
  /** A band from x0 to x1, its top and bottom at each end, curving as drawn (sankeyCurve). */
  | { shape: 'band'; x0: number; x1: number; top0: number; bottom0: number; top1: number; bottom1: number; pick: ChartPick }
) & { drill?: string[] };

/** The part of a chart at a point (in the chart's own pixels), and what clicking it picks. */
export function partAt(hits: ChartHits, x: number, y: number): ChartPick | null {
  return partHit(hits, x, y)?.pick ?? null;
}

/** The part of a chart at a point (in the chart's own pixels). */
export function partHit(hits: ChartHits, x: number, y: number): ChartPart | null {
  const parts = hits.parts ?? [];
  // nodes and bars over bands
  for (let k = parts.length - 1; k >= 0; k--) {
    const p = parts[k];
    if (p.shape === 'box') { if (x >= p.box.x && x <= p.box.x + p.box.w && y >= p.box.y && y <= p.box.y + p.box.h) return p; continue; }
    if (p.shape === 'slice') {
      const dx = x - p.cx, dy = y - p.cy;
      if (Math.hypot(dx, dy) > p.r) continue;
      let a = Math.atan2(dy, dx);
      while (a < p.a0) a += 2 * Math.PI;
      if (a <= p.a1) return p;
      continue;
    }
    if (x < p.x0 || x > p.x1 || p.x1 <= p.x0) continue;
    // where along the curve this x is (it runs one way), then the band's top and bottom there
    let lo = 0, hi = 1;
    for (let i = 0; i < 30; i++) { const m = (lo + hi) / 2; if (sankeyCurve(p.x0, p.x1, m).x < x) lo = m; else hi = m; }
    const e = sankeyCurve(p.x0, p.x1, lo).e;
    const top = p.top0 + (p.top1 - p.top0) * e, bottom = p.bottom0 + (p.bottom1 - p.bottom0) * e;
    if (y >= top && y <= bottom) return p;
  }
  return null;
}

/** A band's curve (a cubic with its handles halfway across) at t: how far across, and how far from its start height to its end height (0 to 1). */
function sankeyCurve(x0: number, x1: number, t: number): { x: number; e: number } {
  return { x: x0 + (x1 - x0) * (1.5 * t - 1.5 * t * t + t * t * t), e: 3 * t * t - 2 * t * t * t };
}

/** Do two picks pick the same thing? */
export const samePick = (a: ChartPick | undefined, b: ChartPick | undefined): boolean =>
  !!a && !!b && a.length === b.length && a.every((p, i) => p.level === b[i].level && p.value === b[i].value);

const TEXT = '#404040', AXIS = '#bfbfbf', GRID = '#e3e3e3';
export const CHART_FONT = 'Arial';

// ---------------------------------------------------------------- text with sub- and superscripts

interface Run { t: string; pos: 'base' | 'sub' | 'sup' }

/** Split "k_{obs} (s^{-1})" into runs; a single character may follow _ or ^ without braces; \_ is a plain _. */
export function textRuns(text: string): Run[] {
  const out: Run[] = [];
  let buf = '';
  const flush = () => { if (buf) { out.push({ t: buf, pos: 'base' }); buf = ''; } };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '\\' && (text[i + 1] === '_' || text[i + 1] === '^')) { buf += text[++i]; continue; }
    if ((ch === '_' || ch === '^') && i + 1 < text.length) {
      let t: string;
      if (text[i + 1] === '{') {
        const end = text.indexOf('}', i + 2);
        if (end < 0) { buf += ch; continue; }
        t = text.slice(i + 2, end);
        i = end;
      } else {
        t = text[i + 1];
        i++;
      }
      flush();
      if (t) out.push({ t, pos: ch === '_' ? 'sub' : 'sup' });
      continue;
    }
    buf += ch;
  }
  flush();
  return out;
}

interface TextOpts { size: number; bold?: boolean; color?: string; align?: 'left' | 'center' | 'right'; angle?: 0 | 90; family: string }

const fontOf = (size: number, bold: boolean | undefined, family: string) => `${bold ? 'bold ' : ''}${size}px ${family}`;

function measure(ctx: Ctx, text: string, o: TextOpts): number {
  let w = 0;
  for (const r of textRuns(text)) {
    ctx.font = fontOf(r.pos === 'base' ? o.size : o.size * 0.7, o.bold, o.family);
    w += ctx.measureText(r.t).width;
  }
  return w;
}

/** Draw text with its baseline at y (for upward text, x is the baseline). Returns its width. */
function text(ctx: Ctx, s: string, x: number, y: number, o: TextOpts): number {
  if (!s) return 0;
  const w = measure(ctx, s, o);
  const start = o.align === 'center' ? -w / 2 : o.align === 'right' ? -w : 0;
  ctx.fillStyle = o.color ?? TEXT;
  let dx = start;
  for (const r of textRuns(s)) {
    const size = r.pos === 'base' ? o.size : o.size * 0.7;
    const dy = r.pos === 'sub' ? o.size * 0.25 : r.pos === 'sup' ? -o.size * 0.38 : 0;
    ctx.font = fontOf(size, o.bold, o.family);
    if (o.angle === 90) {
      // the text frame turned a quarter anticlockwise: along the text is up the page
      if (ctx instanceof VectorContext) ctx.fillTextTurned(r.t, x + dy, y - dx, 90);
      else {
        ctx.save();
        ctx.translate(x + dy, y - dx);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(r.t, 0, 0);
        ctx.restore();
      }
    } else ctx.fillText(r.t, x + dx, y + dy);
    dx += ctx.measureText(r.t).width;
  }
  return w;
}

// ---------------------------------------------------------------- axes

interface NumAxis {
  min: number; max: number; ticks: number[]; log: boolean; reverse: boolean; step: number;
  /** Where a value falls, 0 to 1 along the axis. */
  frac(v: number): number;
  label(v: number): string;
}

/**
 * A value axis over the data's range. As in Excel, column, bar and area charts start at zero, and
 * other charts do too unless the numbers sit far from it. Set min, max or step win.
 */
export function numAxis(lo: number, hi: number, a: ChartAxis, zero: 'always' | 'auto', want = 5): NumAxis {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) { lo = 0; hi = 1; }
  const log = !!a.log;
  let min: number, max: number, ticks: number[], step = 0;
  if (log) {
    const t = logTicks(a.min && a.min > 0 ? a.min : lo > 0 ? lo : 1, a.max && a.max > 0 ? a.max : hi > 0 ? hi : 10);
    min = a.min && a.min > 0 ? a.min : t.min;
    max = a.max && a.max > 0 ? a.max : t.max;
    ticks = t.ticks.filter((v) => v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9));
  } else {
    if (a.min === undefined && a.max === undefined) {
      if (zero === 'always' || (lo > 0 && (hi - lo) / hi > 1 / 6)) lo = Math.min(lo, 0);
      if (zero === 'always' || (hi < 0 && (hi - lo) / -lo > 1 / 6)) hi = Math.max(hi, 0);
    }
    if (a.min !== undefined) lo = a.min;
    if (a.max !== undefined) hi = a.max;
    if (hi <= lo) hi = lo + (Math.abs(lo) || 1);
    const t = niceTicks(lo, hi, want, a.step);
    min = a.min ?? t.min;
    max = a.max ?? t.max;
    step = t.step;
    ticks = t.ticks.filter((v) => v >= min - step * 1e-9 && v <= max + step * 1e-9);
  }
  const reverse = !!a.reverse;
  const frac = (v: number) => {
    const f = log ? (Math.log10(v) - Math.log10(min)) / (Math.log10(max) - Math.log10(min)) : (v - min) / (max - min);
    return reverse ? 1 - f : f;
  };
  const decimals = step > 0 && step < 1 ? Math.min(10, Math.ceil(-Math.log10(step) - 1e-9) + (/[^0]5$|25$/.test(String(step)) && step < 1 ? 0 : 0)) : 0;
  const label = (v: number) => {
    if (a.numFmt) return formatValue(v, a.numFmt).text;
    if (log || step >= 1 || step === 0) return generalNumber(v);
    return v.toFixed(Math.max(decimals, decimalsIn(step)));
  };
  return { min, max, ticks, log, reverse, step, frac, label };
}

const decimalsIn = (v: number) => { const s = String(Number(v.toPrecision(10))); const i = s.indexOf('.'); return i < 0 ? 0 : s.length - i - 1; };

// ---------------------------------------------------------------- shapes

/** Clip a segment to a box (Liang–Barsky); null when none of it is inside. */
export function clipSegment(x1: number, y1: number, x2: number, y2: number, b: Box): [number, number, number, number] | null {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy], q = [x1 - b.x, b.x + b.w - x1, y1 - b.y, b.y + b.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return null; continue; }
    const r = q[i] / p[i];
    if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
}

/** A line through points (NaN points leave a gap), cut off at the edge of the box. */
function polyline(ctx: Ctx, pts: [number, number][], box: Box): void {
  ctx.beginPath();
  let penX = NaN, penY = NaN;
  for (let i = 1; i < pts.length; i++) {
    const [ax, ay] = pts[i - 1], [bx, by] = pts[i];
    if (![ax, ay, bx, by].every(Number.isFinite)) continue;
    const c = clipSegment(ax, ay, bx, by, box);
    if (!c) continue;
    if (!(Math.abs(c[0] - penX) <= 0.01 && Math.abs(c[1] - penY) <= 0.01)) ctx.moveTo(c[0], c[1]);
    ctx.lineTo(c[2], c[3]);
    penX = c[2]; penY = c[3];
  }
  ctx.stroke();
}

/** Points along a smooth curve through points (Catmull–Rom), for smoothed lines. */
function smoothPoints(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    if (![p1, p2].every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]))) { out.push(p1, [NaN, NaN]); continue; }
    const q0 = Number.isFinite(p0[1]) ? p0 : p1, q3 = Number.isFinite(p3[1]) ? p3 : p2;
    for (let k = 0; k < 12; k++) {
      const t = k / 12, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(q0[0], p1[0], p2[0], q3[0]), f(q0[1], p1[1], p2[1], q3[1])]);
    }
  }
  if (pts.length) out.push(pts[pts.length - 1]);
  return out;
}

export function drawMarker(ctx: Ctx, shape: MarkerShape, x: number, y: number, size: number, color: string): void {
  if (shape === 'none') return;
  const r = size / 2;
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(x, y, r, 0, Math.PI * 2);
  else if (shape === 'square') ctx.rect(x - r, y - r, size, size);
  else if (shape === 'diamond') { ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath(); }
  else if (shape === 'triangle') { ctx.moveTo(x, y - r * 1.2); ctx.lineTo(x + r * 1.1, y + r * 0.8); ctx.lineTo(x - r * 1.1, y + r * 0.8); ctx.closePath(); }
  if (shape === 'cross') {
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r); ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
    return;
  }
  ctx.fillStyle = color;
  (ctx as CanvasRenderingContext2D).fill();
}

const dashOf = (d: string | undefined): number[] => (d === 'dash' ? [6, 4] : d === 'dot' ? [1.5, 3] : []);

// ---------------------------------------------------------------- the chart

const SHORT_FIT: Record<FitKind, string> = { linear: 'Linear', poly2: 'Poly.', poly3: 'Poly.', exp: 'Expon.', log: 'Log.', power: 'Power' };

/** Charts that take fitted lines (as Excel gives trendlines to). */
const FITTED = new Set<Chart['kind']>(['scatter', 'line', 'column', 'bar', 'area', 'bubble']);

/** A histogram's one series as the counts in its bins, to be drawn as columns. */
export function histogramData(chart: Chart, data: SeriesData[]): SeriesData[] {
  const d = data[0];
  if (!d) return [];
  const h = histogram(d.ys, chart.bins);
  return [{ ...d, cats: h.labels, ys: h.counts, xs: h.counts.map((_, j) => j + 1), plus: undefined, minus: undefined }];
}

/** The fitted line of each series (worked out once and shared by the drawing and the side panel). */
export function chartFits(chart: Chart, data: SeriesData[]): (Fit | null)[] {
  return chart.series.map((s, i) => {
    const d = data[i];
    if (!s.fit || !d || !FITTED.has(chart.kind)) return null;
    const xs = isXY(chart.kind) ? d.xs : d.ys.map((_, j) => j + 1);
    return fitPoints(s.fit.kind, xs, d.ys, s.fit.intercept);
  });
}

interface LegendItem { name: string; color: string; kind: 'line' | 'box' | 'fit'; marker?: MarkerShape; dash?: number[]; line?: boolean }

/**
 * Draw a chart. `lit` is the same chart's data with a click's pick applied (a dashboard): bars,
 * slices and Sankey nodes and bands are drawn faded, with what the pick leaves drawn solid over
 * them, as PowerBI highlights.
 */
export function drawChart(ctx: Ctx, chart: Chart, data0: SeriesData[], w: number, h: number, lit?: SeriesData[]): ChartHits {
  // a histogram is drawn as columns of the counts in its bins
  const data = chart.kind === 'histogram' ? histogramData(chart, data0) : data0;
  const family = chart.font ? `${cssFamily(chart.font)}, ${CHART_FONT}` : CHART_FONT;
  const fs = chart.fontSize ?? 12;
  const opt = (size: number, more: Partial<TextOpts> = {}): TextOpts => ({ size, family, ...more });
  const kind = chart.kind;
  const fits = chartFits(chart, data);

  // background and border
  ctx.setLineDash([]);
  if (chart.background !== 'none') { ctx.fillStyle = chart.background || '#ffffff'; ctx.fillRect(0, 0, w, h); }
  if (chart.border !== false) { ctx.strokeStyle = '#d9d9d9'; ctx.lineWidth = 1; ctx.strokeRect(0.5, 0.5, w - 1, h - 1); }

  const pad = 10;
  let top = pad, bottom = h - pad, left = pad, right = w - pad;

  if (chart.title) {
    const ts = fs * 1.4;
    text(ctx, chart.title, w / 2, top + ts * 0.9, opt(ts, { align: 'center' }));
    top += ts * 1.3 + 4;
  }

  // legend
  const legend: LegendItem[] = [];
  if (kind === 'pie') {
    const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
    (data[0]?.cats ?? []).forEach((c, i) => legend.push({ name: c || String(i + 1), color: pal[i % pal.length], kind: 'box' }));
  } else if (!isLevelled(kind)) {
    data.forEach((d, i) => {
      const s = chart.series[i];
      const lineLike = kind === 'scatter' || kind === 'line' || kind === 'bubble' || (kind === 'radar' && !chart.filled) || (kind === 'combo' && comboAs(s, i) === 'line');
      const sticks = kind === 'scatter' && !!s.sticks;
      const joined = kind === 'line' || kind === 'radar' || kind === 'combo';
      legend.push({ name: d.name, color: d.color, kind: lineLike ? 'line' : 'box', marker: lineLike ? kind === 'bubble' ? 'circle' : s.marker ?? (kind === 'scatter' && !sticks ? 'circle' : 'none') : undefined, dash: dashOf(s.dash), line: kind === 'bubble' ? false : joined ? s.line !== false : !!s.line || sticks });
    });
    chart.series.forEach((s, i) => {
      if (s.fit && fits[i] && s.fit.legend !== false) legend.push({ name: `${SHORT_FIT[s.fit.kind]} (${data[i].name})`, color: s.fit.color ?? data[i].color, kind: 'fit' });
    });
  }
  const sw = 22; // legend key width
  if (chart.legend !== 'none' && legend.length) {
    const widths = legend.map((l) => measure(ctx, l.name, opt(fs)) + sw + 6);
    const rowH = fs * 1.5;
    if (chart.legend === 'right') {
      const lw = Math.min(Math.max(...widths), w * 0.4);
      const lh = rowH * legend.length;
      const lx = right - lw;
      let ly = Math.max(top, top + (bottom - top - lh) / 2);
      for (const l of legend) { legendKey(ctx, l, lx, ly + rowH / 2, sw); text(ctx, l.name, lx + sw + 6, ly + rowH / 2 + fs * 0.35, opt(fs)); ly += rowH; }
      right = lx - 10;
    } else {
      // rows of entries, centred
      const rows: { items: number[]; w: number }[] = [{ items: [], w: 0 }];
      legend.forEach((_, i) => {
        const r = rows[rows.length - 1];
        if (r.items.length && r.w + widths[i] + 12 > right - left) rows.push({ items: [i], w: widths[i] });
        else { r.items.push(i); r.w += widths[i] + (r.items.length > 1 ? 12 : 0); }
      });
      const lh = rows.length * rowH;
      let ly = chart.legend === 'top' ? top : bottom - lh;
      for (const r of rows) {
        let lx = (left + right) / 2 - r.w / 2;
        for (const i of r.items) { legendKey(ctx, legend[i], lx, ly + rowH / 2, sw); text(ctx, legend[i].name, lx + sw + 6, ly + rowH / 2 + fs * 0.35, opt(fs)); lx += widths[i] + 12; }
        ly += rowH;
      }
      if (chart.legend === 'top') top += lh + 4; else bottom -= lh + 4;
    }
  }

  if (kind === 'pie') return drawPie(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, fs, family, lit);
  if (kind === 'sankey') return drawSankey(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, opt, lit);
  if (kind === 'treemap') return drawTreemap(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, opt, lit);
  if (kind === 'decomp') return drawDecomp(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, opt, lit);
  if (kind === 'radar') return drawRadar(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, opt);

  // value ranges
  const horizontal = kind === 'bar';
  const xy = isXY(kind);
  const combo = kind === 'combo';
  const boxes = kind === 'box' ? boxGroups(data, chart.series.some((s) => !!s.x), chart.boxes) : null;
  /** Series drawn as columns (or bars), and which of them each is. */
  const isBar = (i: number) => kind === 'column' || kind === 'bar' || kind === 'histogram' || (combo && comboAs(chart.series[i], i) === 'column');
  const barNo = data.map((_, i) => data.slice(0, i).filter((__, k) => isBar(k)).length);
  const nBars = Math.max(1, data.filter((_, i) => isBar(i)).length);
  /** Series measured on the second value axis (combo charts). */
  const onRight = (i: number) => combo && onSecondAxis(chart.series[i], i);
  const anyRight = data.some((_, i) => onRight(i));
  const ncat = boxes ? boxes.cats.length : Math.max(0, ...data.map((d) => d.ys.length));
  const lim = { l: [Infinity, -Infinity], r: [Infinity, -Infinity] };
  let xlo = Infinity, xhi = -Infinity;
  const grow = (v: number, side: 'l' | 'r' = 'l') => { const L = lim[side]; if (Number.isFinite(v)) { if (v < L[0]) L[0] = v; if (v > L[1]) L[1] = v; } };
  const growY = (v: number) => grow(v);
  const growX = (v: number) => { if (Number.isFinite(v)) { if (v < xlo) xlo = v; if (v > xhi) xhi = v; } };
  const stackable = chart.stacked && (kind === 'column' || kind === 'bar' || kind === 'area');
  if (stackable) {
    for (let j = 0; j < ncat; j++) {
      let pos = 0, neg = 0;
      for (const d of data) { const v = d.ys[j]; if (Number.isFinite(v)) { if (v >= 0) pos += v; else neg += v; } }
      growY(pos); growY(neg);
    }
  } else if (boxes) {
    for (const row of boxes.stats) for (const b of row) if (b) { growY(b.lo); growY(b.hi); b.outliers.forEach(growY); growY(b.mean); }
  } else {
    data.forEach((d, i) => {
      const side = onRight(i) ? 'r' : 'l';
      d.ys.forEach((v, j) => { grow(v, side); if (d.plus) grow(v + (d.plus[j] || 0), side); if (d.minus) grow(v - (d.minus[j] || 0), side); });
    });
  }
  if (xy) data.forEach((d) => d.xs.forEach((x, j) => { if (Number.isFinite(d.ys[j])) growX(x); }));
  // sticks stand on zero, and keep clear of the plot's sides
  const anySticks = kind === 'scatter' && chart.series.some((s) => s.sticks);
  if (anySticks) {
    growY(0);
    if (xlo !== Infinity) { const padX = Math.max(0.5, (xhi - xlo) * 0.05); xlo -= padX; xhi += padX; }
  }
  // bubbles keep clear of the plot's edges
  if (kind === 'bubble') {
    if (xlo !== Infinity) { const p = (xhi - xlo || Math.abs(xlo) || 1) * 0.12; xlo -= p; xhi += p; }
    if (lim.l[0] !== Infinity) { const p = (lim.l[1] - lim.l[0] || Math.abs(lim.l[0]) || 1) * 0.12; lim.l[0] -= p; lim.l[1] += p; }
  }
  // fitted lines reach beyond the data when asked
  chart.series.forEach((s, i) => {
    const f = fits[i];
    if (!f || !s.fit) return;
    const xs = xy ? data[i].xs.filter(Number.isFinite) : data[i].ys.map((_, j) => j + 1);
    const a = least(xs) - (s.fit.backward ?? 0), b = most(xs) + (s.fit.forward ?? 0);
    if (xy) { growX(a); growX(b); }
    growY(fitAt(f, a)); growY(fitAt(f, b));
  });
  for (const L of [lim.l, lim.r]) if (L[0] === Infinity) { L[0] = 0; L[1] = 1; }
  if (xlo === Infinity) { xlo = 0; xhi = 1; }

  const valueAxisDef = horizontal ? chart.x : chart.y;
  const catAxisDef = horizontal ? chart.y : chart.x;
  const barsOn = (side: boolean) => data.some((_, i) => isBar(i) && onRight(i) === side);
  const zero = kind === 'column' || kind === 'bar' || kind === 'area' || kind === 'histogram' || (combo && barsOn(false)) ? 'always' : 'auto';
  const vAxis = numAxis(lim.l[0], lim.l[1], valueAxisDef, zero, Math.max(3, Math.round((horizontal ? w / 80 : h / 40))));
  const v2Axis = anyRight ? numAxis(lim.r[0], lim.r[1], chart.y2 ?? {}, barsOn(true) ? 'always' : 'auto', Math.max(3, Math.round(h / 40))) : null;
  const xAxis = xy ? numAxis(xlo, xhi, chart.x, 'auto', Math.max(3, Math.round(w / 80))) : null;
  const axisOf = (i: number) => (onRight(i) ? v2Axis! : vAxis);

  // room for titles and tick labels
  const xTitle = chart.x.title, yTitle = chart.y.title, y2Title = v2Axis ? chart.y2?.title : undefined;
  const y2TitleX = right - fs * 0.3;
  if (xTitle) bottom -= fs * 1.5 + 2;
  if (yTitle) left += fs * 1.5 + 2;
  if (y2Title) right -= fs * 1.5 + 2;
  const tickFs = fs * 0.92;
  const cats = boxes ? boxes.cats : data[0]?.cats ?? [];
  const leftLabels = horizontal ? cats.slice(0, ncat) : vAxis.ticks.map(vAxis.label);
  const leftW = Math.max(0, ...leftLabels.map((l) => measure(ctx, l, opt(tickFs))));
  left += Math.min(leftW, w * 0.35) + 6;
  bottom -= tickFs * 1.4 + 2;
  const bottomLabels = horizontal ? vAxis.ticks.map(vAxis.label) : xAxis ? xAxis.ticks.map(xAxis.label) : [];
  if (v2Axis) right -= Math.min(Math.max(0, ...v2Axis.ticks.map((t) => measure(ctx, v2Axis.label(t), opt(tickFs)))), w * 0.3) + 6;
  else if (bottomLabels.length) right -= Math.min(measure(ctx, bottomLabels[bottomLabels.length - 1], opt(tickFs)) / 2, 30);
  const plot: Box = { x: left, y: top + fs * 0.5, w: Math.max(10, right - left), h: Math.max(10, bottom - top - fs * 0.5) };

  // where things go
  const X = (f: number) => plot.x + f * plot.w;
  const Y = (f: number) => plot.y + plot.h - f * plot.h;
  const band = (horizontal ? plot.h : plot.w) / Math.max(1, ncat);
  const catAt = (j: number) => (horizontal ? (catAxisDef.reverse ? plot.y + plot.h - (j + 0.5) * band : plot.y + (j + 0.5) * band) : catAxisDef.reverse ? plot.x + plot.w - (j + 0.5) * band : plot.x + (j + 0.5) * band);
  const valAt = (v: number, i = -1) => (horizontal ? X(vAxis.frac(v)) : Y((i >= 0 ? axisOf(i) : vAxis).frac(v)));
  const ptX = (d: SeriesData, j: number) => (xAxis ? X(xAxis.frac(d.xs[j])) : catAt(j));
  // columns side by side in each category (a histogram's touch)
  const groupW = kind === 'histogram' ? Math.max(1, band - 1) : band / 1.8;
  const each = stackable ? groupW : groupW / (boxes ? Math.max(1, data.length) : nBars);
  const barMid = (i: number, j: number) => catAt(j) - groupW / 2 + (stackable ? 0 : (boxes ? i : barNo[i]) * each) + each / 2;
  const inside = (x: number, y: number) => x >= plot.x - 0.5 && x <= plot.x + plot.w + 0.5 && y >= plot.y - 0.5 && y <= plot.y + plot.h + 0.5;

  // grid lines
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.strokeStyle = GRID;
  if (valueAxisDef.grid !== false) {
    ctx.beginPath();
    for (const t of vAxis.ticks) {
      const p = Math.round(valAt(t)) + 0.5;
      if (horizontal) { ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); } else { ctx.moveTo(plot.x, p); ctx.lineTo(plot.x + plot.w, p); }
    }
    ctx.stroke();
  }
  if (xAxis && chart.x.grid) {
    ctx.beginPath();
    for (const t of xAxis.ticks) { const p = Math.round(X(xAxis.frac(t))) + 0.5; ctx.moveTo(p, plot.y); ctx.lineTo(p, plot.y + plot.h); }
    ctx.stroke();
  }

  // columns, bars and areas
  const baseOf = (a: NumAxis) => (horizontal ? X : Y)(a.frac(a.log ? a.min : Math.min(Math.max(0, a.min), a.max)));
  const base = baseOf(vAxis);
  const parts: ChartPart[] = [];
  if (data.some((_, i) => isBar(i))) {
    const pos = new Array<number>(ncat).fill(0), neg = new Array<number>(ncat).fill(0);
    data.forEach((d, i) => {
      if (!isBar(i)) return;
      // with a pick, what it leaves of each bar (by its label), drawn solid over the faded whole
      const shown = lit && kind !== 'histogram' ? new Map((lit[i]?.cats ?? []).map((c, j) => [c, lit[i].ys[j]] as const).reverse()) : null;
      d.ys.forEach((v, j) => {
        if (!Number.isFinite(v)) return;
        let a: number, b: number;
        if (stackable) { const from = v >= 0 ? pos[j] : neg[j]; a = valAt(from); b = valAt(from + v); if (v >= 0) pos[j] += v; else neg[j] += v; }
        else { a = baseOf(axisOf(i)); b = valAt(v, i); }
        const c = barMid(i, j) - each / 2;
        const rect = (p: number, q: number) => { const lo = Math.min(p, q), len = Math.abs(q - p); return horizontal ? clipBox({ x: lo, y: c, w: len, h: each }, plot) : clipBox({ x: c, y: lo, w: each, h: len }, plot); };
        const r = rect(a, b);
        if (!r) return;
        const kept = shown?.get(d.cats[j]);
        ctx.fillStyle = shown ? withAlpha(d.color, 0.3) : d.color;
        ctx.fillRect(r.x, r.y, r.w, r.h);
        if (shown && kept !== undefined && Number.isFinite(kept) && kept !== 0) {
          // a stacked bar shows solid whole when the pick leaves any of it
          const s = stackable ? r : rect(a, valAt(kept, i));
          if (s) { ctx.fillStyle = d.color; ctx.fillRect(s.x, s.y, s.w, s.h); }
        }
        if (kind !== 'histogram' && d.cats[j]) parts.push({ shape: 'box', box: r, pick: [{ level: 0, value: d.cats[j] }] });
      });
    });
  } else if (kind === 'area') {
    const lower = new Array<number>(ncat).fill(0);
    const fills = data.map((d) => {
      const up = d.ys.map((v, j) => (Number.isFinite(v) ? v : 0) + (stackable ? lower[j] : 0));
      const low = stackable ? lower.slice() : new Array<number>(ncat).fill(0);
      if (stackable) up.forEach((v, j) => (lower[j] = v));
      return { d, up, low };
    });
    for (const f of fills) {
      ctx.beginPath();
      f.up.forEach((v, j) => (j ? ctx.lineTo(catAt(j), clampY(valAt(v), plot)) : ctx.moveTo(catAt(j), clampY(valAt(v), plot))));
      for (let j = f.low.length - 1; j >= 0; j--) ctx.lineTo(catAt(j), clampY(stackable ? valAt(f.low[j]) : base, plot));
      ctx.closePath();
      ctx.fillStyle = stackable ? f.d.color : withAlpha(f.d.color, 0.75);
      (ctx as CanvasRenderingContext2D).fill();
    }
  }

  // boxes and whiskers
  if (boxes) {
    const o = chart.boxes ?? {};
    const bw = each * 0.8;
    data.forEach((d, i) => {
      const means: [number, number][] = [];
      boxes.stats[i].forEach((b, j) => {
        if (!b) { means.push([NaN, NaN]); return; }
        const cx = barMid(i, j);
        const yq1 = valAt(b.q1), yq3 = valAt(b.q3);
        ctx.setLineDash([]);
        ctx.strokeStyle = d.color; ctx.lineWidth = 1.25; ctx.lineCap = 'butt';
        ctx.beginPath();
        // whiskers with their caps
        for (const [from, to] of [[b.q1, b.lo], [b.q3, b.hi]]) {
          const seg = clipSegment(cx, valAt(from), cx, valAt(to), plot);
          if (seg) { ctx.moveTo(seg[0], seg[1]); ctx.lineTo(seg[2], seg[3]); }
          const yy = valAt(to);
          if (yy >= plot.y && yy <= plot.y + plot.h) { ctx.moveTo(cx - bw / 4, yy); ctx.lineTo(cx + bw / 4, yy); }
        }
        ctx.stroke();
        const r = clipBox({ x: cx - bw / 2, y: Math.min(yq1, yq3), w: bw, h: Math.max(0.5, Math.abs(yq1 - yq3)) }, plot);
        if (r) {
          ctx.fillStyle = withAlpha(d.color, 0.3);
          ctx.fillRect(r.x, r.y, r.w, r.h);
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        }
        const ym = valAt(b.median);
        if (ym >= plot.y && ym <= plot.y + plot.h) { ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx - bw / 2, ym); ctx.lineTo(cx + bw / 2, ym); ctx.stroke(); }
        const dots = [...(o.points ? b.inside.map((v) => [v, 0] as const) : []), ...(o.outliers !== false ? b.outliers.map((v) => [v, 1] as const) : [])];
        for (const [v, out] of dots) {
          const y = valAt(v);
          if (!inside(cx, y)) continue;
          ctx.beginPath(); ctx.arc(cx, y, 2.5, 0, Math.PI * 2);
          ctx.fillStyle = out ? '#ffffff' : d.color; (ctx as CanvasRenderingContext2D).fill();
          ctx.lineWidth = 1; ctx.stroke();
        }
        const ymean = valAt(b.mean);
        means.push([cx, ymean]);
        if (o.mean !== false && inside(cx, ymean)) drawMarker(ctx, 'cross', cx, ymean, 6, darker(d.color));
      });
      if (o.meanLine && means.length > 1) {
        ctx.strokeStyle = d.color; ctx.lineWidth = 1.25; ctx.setLineDash([]);
        polyline(ctx, means, plot);
      }
    });
  }

  // axis lines
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  if (horizontal) { const x = Math.round(base) + 0.5; ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); }
  else {
    const y = Math.round(kind === 'scatter' || kind === 'line' || kind === 'bubble' || kind === 'box' ? plot.y + plot.h : base) + 0.5;
    ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y);
    if (xy) { ctx.moveTo(Math.round(plot.x) + 0.5, plot.y); ctx.lineTo(Math.round(plot.x) + 0.5, plot.y + plot.h); }
  }
  ctx.stroke();

  // lines, error bars and markers
  const noLine = (i: number) => isBar(i) || kind === 'area' || kind === 'box' || kind === 'bubble';
  data.forEach((d, i) => {
    const s = chart.series[i];
    if (noLine(i)) return;
    const a = axisOf(i);
    const pts: [number, number][] = d.ys.map((v, j) => [ptX(d, j), Number.isFinite(v) && (!a.log || v > 0) ? Y(a.frac(v)) : NaN]);
    const showLine = kind === 'line' || combo ? s.line !== false : !!s.line;
    if (showLine) {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = s.lineWidth ?? 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(dashOf(s.dash));
      let line = pts;
      if (kind === 'scatter') line = pts.filter((p) => Number.isFinite(p[0])).slice().sort((p, q) => p[0] - q[0]);
      polyline(ctx, s.smooth ? smoothPoints(line) : line, plot);
      ctx.setLineDash([]);
    }
  });
  // sticks (a mass spectrum's peaks), from zero to each point
  if (anySticks) {
    const zeroY = clampY(Y(vAxis.frac(vAxis.log ? vAxis.min : Math.min(Math.max(0, vAxis.min), vAxis.max))), plot);
    data.forEach((d, i) => {
      const s = chart.series[i];
      if (!s.sticks) return;
      ctx.strokeStyle = d.color;
      ctx.lineWidth = s.lineWidth ?? 1.5;
      ctx.lineCap = 'butt';
      ctx.setLineDash(dashOf(s.dash));
      ctx.beginPath();
      d.ys.forEach((v, j) => {
        const x = ptX(d, j);
        if (!Number.isFinite(v) || !Number.isFinite(x) || x < plot.x || x > plot.x + plot.w) return;
        ctx.moveTo(x, zeroY);
        ctx.lineTo(x, clampY(Y(vAxis.frac(v)), plot));
      });
      ctx.stroke();
      ctx.setLineDash([]);
    });
    // the zero line, when it isn't the bottom of the plot (calculated peaks drawn downwards)
    if (zeroY < plot.y + plot.h - 1) {
      ctx.strokeStyle = AXIS; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(plot.x, Math.round(zeroY) + 0.5); ctx.lineTo(plot.x + plot.w, Math.round(zeroY) + 0.5); ctx.stroke();
    }
  }
  // bubbles: each one's area goes with its size, the largest a quarter of the plot across (as Excel)
  if (kind === 'bubble') {
    const biggest = Math.max(0, ...data.flatMap((d) => (d.sizes ?? []).filter((v) => Number.isFinite(v) && v > 0)));
    const rMax = Math.min(plot.w, plot.h) / 8;
    data.forEach((d) => {
      d.ys.forEach((v, j) => {
        const size = d.sizes?.[j] ?? NaN;
        const x = ptX(d, j), y = Number.isFinite(v) && (!vAxis.log || v > 0) ? Y(vAxis.frac(v)) : NaN;
        if (!Number.isFinite(x) || !Number.isFinite(y) || !inside(x, y) || !(size > 0) || !biggest) return;
        const r = Math.max(1.5, rMax * Math.sqrt(size / biggest));
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = withAlpha(d.color, 0.75); (ctx as CanvasRenderingContext2D).fill();
        ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.setLineDash([]); ctx.stroke();
      });
    });
  }
  // error bars and markers go over every line
  data.forEach((d, i) => {
    const s = chart.series[i];
    const bars = isBar(i);
    if (d.plus && !boxes) {
      ctx.strokeStyle = '#404040'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      d.ys.forEach((v, j) => {
        if (!Number.isFinite(v)) return;
        const c = bars ? barMid(i, j) : ptX(d, j);
        const hi = v + (d.plus![j] || 0), lo = v - (d.minus![j] || 0);
        if (horizontal) {
          const seg = clipSegment(valAt(lo), c, valAt(hi), c, plot);
          if (!seg) return;
          ctx.moveTo(seg[0], c); ctx.lineTo(seg[2], c);
          for (const x of [valAt(lo), valAt(hi)]) if (x >= plot.x && x <= plot.x + plot.w) { ctx.moveTo(x, c - 3); ctx.lineTo(x, c + 3); }
        } else {
          if (!Number.isFinite(c)) return;
          const seg = clipSegment(c, valAt(hi, i), c, valAt(lo, i), plot);
          if (!seg) return;
          ctx.moveTo(c, seg[1]); ctx.lineTo(c, seg[3]);
          for (const y of [valAt(lo, i), valAt(hi, i)]) if (y >= plot.y && y <= plot.y + plot.h) { ctx.moveTo(c - 3, y); ctx.lineTo(c + 3, y); }
        }
      });
      ctx.stroke();
    }
    if (noLine(i)) return;
    const a = axisOf(i);
    const marker = s.marker ?? (kind === 'scatter' && !s.sticks ? 'circle' : 'none');
    const size = s.markerSize ?? 7;
    d.ys.forEach((v, j) => {
      const x = ptX(d, j), y = Number.isFinite(v) && (!a.log || v > 0) ? Y(a.frac(v)) : NaN;
      if (Number.isFinite(x) && Number.isFinite(y) && inside(x, y)) drawMarker(ctx, marker, x, y, size, d.color);
    });
  });

  // fitted lines and their equations
  const fitLabels: ChartHits['fitLabels'] = [];
  const taken: [number, number][] = [];
  data.forEach((d, i) => d.ys.forEach((v, j) => { const x = isBar(i) ? barMid(i, j) : ptX(d, j), y = valAt(v, i); if (Number.isFinite(x) && Number.isFinite(y)) taken.push([x, y]); }));
  chart.series.forEach((s, i) => {
    const f = fits[i], d = data[i];
    if (!f || !s.fit || !d) return;
    const xs = xy ? d.xs.filter(Number.isFinite) : d.ys.map((_, j) => j + 1);
    const a = least(xs), b = most(xs);
    for (let k = 0; k <= 40; k++) {
      const x = a + ((b - a) * k) / 40, y = fitAt(f, x);
      const px = xAxis ? X(xAxis.frac(x)) : catAt(x - 1), py = valAt(y);
      if (Number.isFinite(px) && Number.isFinite(py)) taken.push([px, py]);
    }
  });
  chart.series.forEach((s, i) => {
    const f = fits[i], d = data[i];
    if (!f || !s.fit || !d) return;
    const xs = xy ? d.xs.filter(Number.isFinite) : d.ys.map((_, j) => j + 1);
    let a = least(xs) - (s.fit.backward ?? 0), b = most(xs) + (s.fit.forward ?? 0);
    if (f.kind === 'log' || f.kind === 'power') a = Math.max(a, least(xs.filter((x) => x > 0)) * 0.01);
    const toX = (x: number) => (xAxis ? X(xAxis.frac(x)) : catAt(x - 1));
    const pts: [number, number][] = [];
    const n = f.kind === 'linear' ? 1 : 80;
    for (let k = 0; k <= n; k++) {
      const x = a + ((b - a) * k) / n, y = fitAt(f, x);
      pts.push([toX(x), Number.isFinite(y) && (!vAxis.log || y > 0) ? Y(vAxis.frac(y)) : NaN]);
    }
    const color = s.fit.color ?? d.color;
    ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineCap = 'butt';
    ctx.setLineDash([5, 3]);
    polyline(ctx, pts, plot);
    ctx.setLineDash([]);
    const lines = [s.fit.showEq ? fitEquation(f) : '', s.fit.showR2 ? r2Text(f) : ''].filter(Boolean);
    if (!lines.length) return;
    const lfs = fs * 0.95;
    const bw = Math.max(...lines.map((l) => measure(ctx, l, opt(lfs)))), bh = lines.length * lfs * 1.3;
    let bx: number, by: number;
    if (s.fit.labelAt) { bx = plot.x + s.fit.labelAt.x * plot.w; by = plot.y + s.fit.labelAt.y * plot.h; }
    else {
      // the corner of the plot where it covers the fewest points, lines and other equations
      const busy = (x: number, y: number) => {
        let n2 = 0;
        for (const [px, py] of taken) if (px >= x - 4 && px <= x + bw + 4 && py >= y - 4 && py <= y + bh + 4) n2++;
        for (const l of fitLabels) if (x < l.box.x + l.box.w && l.box.x < x + bw && y < l.box.y + l.box.h && l.box.y < y + bh) n2 += 1000;
        return n2;
      };
      const xs2 = [plot.x + plot.w - bw - 6, plot.x + 6], best = { x: xs2[0], y: plot.y + 6, n: Infinity };
      for (let k = 0; k < 4; k++) {
        for (const x of xs2) {
          for (const y of [plot.y + 6 + k * (bh + 4), plot.y + plot.h - bh - 6 - k * (bh + 4)]) {
            const n2 = busy(x, y) + k * 0.5;
            if (n2 < best.n) Object.assign(best, { x, y, n: n2 });
          }
        }
      }
      bx = best.x; by = best.y;
    }
    lines.forEach((l, k) => text(ctx, l, bx, by + lfs * (1 + k * 1.3), opt(lfs, { color })));
    fitLabels.push({ series: i, box: { x: bx - 2, y: by - 2, w: bw + 4, h: bh + 4 } });
  });

  // value labels
  data.forEach((d, i) => {
    if (!chart.series[i].labels || boxes) return;
    const bars = isBar(i);
    const showX = kind === 'scatter' && chart.series[i].labelX;
    d.ys.forEach((v, j) => {
      if (!Number.isFinite(v)) return;
      if (showX && !Number.isFinite(d.xs[j])) return;
      const fmt = chart.series[i].labelFmt;
      const t = showX ? formatValue(d.xs[j], fmt ?? chart.x.numFmt).text : formatValue(v, fmt ?? (onRight(i) ? chart.y2?.numFmt : valueAxisDef.numFmt)).text;
      if (horizontal) {
        text(ctx, t, valAt(v) + 4, barMid(i, j) + tickFs * 0.35, opt(tickFs));
      } else {
        const x = bars ? barMid(i, j) : ptX(d, j);
        const y = valAt(v, i);
        // under a peak drawn downwards
        const below = chart.series[i].sticks && v < 0;
        if (inside(x, y)) text(ctx, t, x, below ? y + tickFs + 4 : y - 6, opt(tickFs, { align: 'center' }));
      }
    });
  });

  // tick labels
  const tick = opt(tickFs);
  if (horizontal) {
    for (const t of vAxis.ticks) text(ctx, vAxis.label(t), valAt(t), plot.y + plot.h + tickFs * 1.2, { ...tick, align: 'center' });
    labelCats(ctx, cats.slice(0, ncat), (j) => catAt(j), plot.h / Math.max(1, ncat), tickFs * 1.3, (l, p) => text(ctx, l, plot.x - 6, p + tickFs * 0.35, { ...tick, align: 'right' }));
  } else {
    for (const t of vAxis.ticks) text(ctx, vAxis.label(t), plot.x - 6, valAt(t) + tickFs * 0.35, { ...tick, align: 'right' });
    if (v2Axis) for (const t of v2Axis.ticks) text(ctx, v2Axis.label(t), plot.x + plot.w + 6, Y(v2Axis.frac(t)) + tickFs * 0.35, tick);
    if (xAxis) for (const t of xAxis.ticks) text(ctx, xAxis.label(t), X(xAxis.frac(t)), plot.y + plot.h + tickFs * 1.2, { ...tick, align: 'center' });
    else {
      const widest = Math.max(1, ...cats.slice(0, ncat).map((c) => measure(ctx, c, tick)));
      labelCats(ctx, cats.slice(0, ncat), catAt, band, widest + 8, (l, p) => text(ctx, l, p, plot.y + plot.h + tickFs * 1.2, { ...tick, align: 'center' }));
    }
  }

  // axis titles
  if (xTitle) text(ctx, xTitle, plot.x + plot.w / 2, h - pad - (chart.legend === 'bottom' && legend.length ? h - pad - bottom - tickFs * 1.4 - fs * 1.5 - 6 : 0) - fs * 0.3, opt(fs, { align: 'center' }));
  if (yTitle) text(ctx, yTitle, pad + fs * 1.1, plot.y + plot.h / 2, opt(fs, { align: 'center', angle: 90 }));
  if (y2Title) text(ctx, y2Title, y2TitleX, plot.y + plot.h / 2, opt(fs, { align: 'center', angle: 90 }));

  return { plot, fitLabels, fits, parts };
}

/** Label categories, skipping some when they would overlap. */
function labelCats(_ctx: Ctx, cats: string[], at: (j: number) => number, band: number, need: number, draw: (label: string, pos: number) => void): void {
  const every = Math.max(1, Math.ceil(need / Math.max(1, band)));
  cats.forEach((c, j) => { if (j % every === 0) draw(c, at(j)); });
}

function legendKey(ctx: Ctx, l: LegendItem, x: number, cy: number, w: number): void {
  ctx.setLineDash([]);
  if (l.kind === 'box') { ctx.fillStyle = l.color; ctx.fillRect(x + w / 2 - 5, cy - 5, 10, 10); return; }
  if (l.kind === 'fit' || l.line) {
    ctx.strokeStyle = l.color; ctx.lineWidth = l.kind === 'fit' ? 1.5 : 2;
    ctx.setLineDash(l.kind === 'fit' ? [5, 3] : l.dash ?? []);
    ctx.beginPath(); ctx.moveTo(x, cy); ctx.lineTo(x + w, cy); ctx.stroke();
    ctx.setLineDash([]);
  }
  if (l.marker && l.marker !== 'none') drawMarker(ctx, l.marker, x + w / 2, cy, 7, l.color);
}

function clipBox(r: Box, b: Box): Box | null {
  const x1 = Math.max(r.x, b.x), y1 = Math.max(r.y, b.y), x2 = Math.min(r.x + r.w, b.x + b.w), y2 = Math.min(r.y + r.h, b.y + b.h);
  return x2 > x1 && y2 > y1 ? { x: x1, y: y1, w: x2 - x1, h: y2 - y1 } : null;
}

const clampY = (y: number, b: Box) => Math.min(b.y + b.h, Math.max(b.y, Number.isFinite(y) ? y : b.y + b.h));

function withAlpha(hex: string, a: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** A colour mixed with white (`t` of the way to white). */
function lighter(hex: string, t: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.round(c + (255 - c) * t).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** Text cut short with an ellipsis to fit a width ('' when not even the first letter fits). */
function fitText(ctx: Ctx, s: string, width: number, o: TextOpts): string {
  if (measure(ctx, s, o) <= width) return s;
  let lo = 0, hi = s.length;
  while (lo < hi) { const m = Math.ceil((lo + hi) / 2); if (measure(ctx, s.slice(0, m) + '…', o) <= width) lo = m; else hi = m - 1; }
  return lo ? s.slice(0, lo) + '…' : '';
}

/** A darker shade of a colour (a box's mean marker, against its own fill). */
function darker(hex: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const f = (c: number) => Math.round(c * 0.6).toString(16).padStart(2, '0');
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

/** A radar chart: a spoke for each category, the values out along them, each series a closed line (or filled shape). */
function drawRadar(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, opt: (size: number, more?: Partial<TextOpts>) => TextOpts): ChartHits {
  const fs = chart.fontSize ?? 12, tickFs = fs * 0.92;
  const plot = area;
  const n = Math.max(0, ...data.map((d) => d.ys.length));
  if (!n) return { plot, fitLabels: [], fits: [] };
  let lo = Infinity, hi = -Infinity;
  for (const d of data) for (const v of d.ys) if (Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  if (lo === Infinity) { lo = 0; hi = 1; }
  const a = numAxis(lo, hi, { ...chart.y, log: false }, 'auto', 5);
  const cats = (data[0]?.cats ?? []).slice(0, n);
  const labelW = Math.max(0, ...cats.map((c) => measure(ctx, c, opt(tickFs))));
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2;
  const R = Math.max(10, Math.min(area.w / 2 - Math.min(labelW, area.w * 0.25) - 8, area.h / 2 - tickFs * 1.6));
  const ang = (j: number) => -Math.PI / 2 + (2 * Math.PI * j) / n;
  const at = (j: number, v: number): [number, number] => {
    const f = Math.max(0, Math.min(1, a.frac(v)));
    return [cx + Math.cos(ang(j)) * R * f, cy + Math.sin(ang(j)) * R * f];
  };
  // the web: a ring at each tick, and the spokes
  ctx.lineWidth = 1; ctx.setLineDash([]);
  if (chart.y.grid !== false) {
    ctx.strokeStyle = GRID;
    for (const t of a.ticks) {
      ctx.beginPath();
      for (let j = 0; j <= n; j++) { const [x, y] = at(j % n, t); if (j) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
      ctx.stroke();
    }
  }
  ctx.strokeStyle = AXIS;
  ctx.beginPath();
  for (let j = 0; j < n; j++) { ctx.moveTo(cx, cy); const [x, y] = at(j, a.max); ctx.lineTo(x, y); }
  ctx.stroke();
  // the series
  data.forEach((d, i) => {
    const s = chart.series[i];
    const pts = d.ys.map((v, j) => (Number.isFinite(v) ? at(j, v) : at(j, a.min)));
    if (!pts.length) return;
    ctx.beginPath();
    pts.forEach(([x, y], j) => (j ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    if (chart.filled) {
      ctx.fillStyle = withAlpha(d.color, 0.6);
      (ctx as CanvasRenderingContext2D).fill();
      ctx.strokeStyle = d.color; ctx.lineWidth = 1; ctx.stroke();
      return;
    }
    if (s.line !== false) {
      ctx.strokeStyle = d.color; ctx.lineWidth = s.lineWidth ?? 2; ctx.lineJoin = 'round';
      ctx.setLineDash(dashOf(s.dash)); ctx.stroke(); ctx.setLineDash([]);
    }
    const marker = s.marker ?? 'none';
    for (const [x, y] of pts) drawMarker(ctx, marker, x, y, s.markerSize ?? 7, d.color);
  });
  // values shown
  data.forEach((d, i) => {
    if (!chart.series[i].labels) return;
    d.ys.forEach((v, j) => {
      if (!Number.isFinite(v)) return;
      const [x, y] = at(j, v);
      text(ctx, formatValue(v, chart.series[i].labelFmt ?? chart.y.numFmt).text, x, y - 6, opt(tickFs, { align: 'center' }));
    });
  });
  // the scale up the first spoke, and the categories round the outside
  for (const t of a.ticks) { const [x, y] = at(0, t); text(ctx, a.label(t), x + 4, y + tickFs * 0.35, opt(tickFs * 0.9)); }
  cats.forEach((c, j) => {
    const cos = Math.cos(ang(j)), sin = Math.sin(ang(j));
    const x = cx + cos * (R + 6), y = cy + sin * (R + 6) + tickFs * 0.35 + sin * tickFs * 0.5;
    text(ctx, c, x, y, opt(tickFs, { align: Math.abs(cos) < 0.2 ? 'center' : cos > 0 ? 'left' : 'right' }));
  });
  return { plot, fitLabels: [], fits: [] };
}

function drawPie(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, fs: number, family: string, lit?: SeriesData[]): ChartHits {
  const d = data[0];
  const plot = area;
  if (!d) return { plot, fitLabels: [], fits: [] };
  const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  const vals = d.ys.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2, r = Math.max(4, Math.min(area.w, area.h) / 2 - 4);
  // with a pick, the slices it leaves nothing of are faded
  const kept = lit ? new Set((lit[0]?.cats ?? []).filter((_, j) => lit[0].ys[j] > 0)) : null;
  const parts: ChartPart[] = [];
  let a0 = -Math.PI / 2;
  vals.forEach((v, j) => {
    if (!total || !v) return;
    const a1 = a0 + (v / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    const c = pal[j % pal.length];
    ctx.fillStyle = kept && !kept.has(d.cats[j]) ? withAlpha(c, 0.3) : c; (ctx as CanvasRenderingContext2D).fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
    if (d.cats[j]) parts.push({ shape: 'slice', cx, cy, r, a0, a1, pick: [{ level: 0, value: d.cats[j] }] });
    if (chart.series[0]?.labels) {
      const m = (a0 + a1) / 2;
      const t = `${Math.round((v / total) * 1000) / 10}%`;
      text(ctx, t, cx + Math.cos(m) * r * 0.65, cy + Math.sin(m) * r * 0.65 + fs * 0.35, { size: fs * 0.92, family, align: 'center', color: '#ffffff', bold: true });
    }
    a0 = a1;
  });
  return { plot, fitLabels: [], fits: [], parts };
}

/**
 * A Sankey chart: a column of nodes for each level, each node as tall as all the rows through it,
 * and bands from each node to the next level's nodes, as wide as the rows they carry. A level's
 * name goes over its column, and each node's label and total beside it.
 */
function drawSankey(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, opt: (size: number, more?: Partial<TextOpts>) => TextOpts, lit?: SeriesData[]): ChartHits {
  const fs = chart.fontSize ?? 12, tickFs = fs * 0.92;
  const flows = sankeyFlows(data);
  const L = flows.levels.length;
  const parts: ChartPart[] = [];
  const out = (): ChartHits => ({ plot: area, fitLabels: [], fits: [], parts });
  if (!L || flows.levels.every((l) => !l.length)) return out();
  const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  // the levels' names over their columns
  let top = area.y;
  const named = data.some((d, i) => d.name && d.name !== `Series ${i + 1}`);
  if (named) {
    data.forEach((d, i) => {
      const x = L === 1 ? area.x + area.w / 2 : area.x + (i * area.w) / (L - 1);
      text(ctx, d.name, x, top + tickFs, opt(tickFs, { bold: true, align: L === 1 ? 'center' : i === 0 ? 'left' : i === L - 1 ? 'right' : 'center' }));
    });
    top += tickFs * 1.8;
  }
  const h = Math.max(10, area.y + area.h - top);
  const nodeW = Math.max(8, Math.min(16, area.w * 0.022));
  const colX = (i: number) => (L === 1 ? area.x + (area.w - nodeW) / 2 : area.x + (i * (area.w - nodeW)) / (L - 1));
  // one scale for every level: the fullest level fills the height, less the gaps between its nodes
  // (narrower gaps in a level of many nodes, so the gaps never take more than a third of it)
  const most = Math.max(1, ...flows.levels.map((l) => l.length));
  const gap = Math.max(1, Math.min(10, h * 0.025, (h / 3) / Math.max(1, most - 1)));
  const k = Math.min(...flows.levels.filter((l) => l.length).map((l) => Math.max(1, h - gap * (l.length - 1)) / l.reduce((a, n) => a + n.value, 0)));
  // with a pick, what it leaves is drawn solid and the rest faded
  const litFlows = lit ? sankeyFlows(lit) : null;
  const litNodes = litFlows ? new Set(litFlows.levels.flatMap((l) => l.map((n) => `${n.level}\u0000${n.label}`))) : null;
  const litLinks = litFlows ? new Set(litFlows.links.map((l) => `${l.level}\u0000${l.from}\u0000${l.to}`)) : null;
  type Placed = { x: number; y: number; h: number; color: string; out: number; in: number };
  const at = new Map<string, Placed>();
  let colour = 0;
  flows.levels.forEach((level, i) => {
    const used = level.reduce((a, n) => a + n.value * k, 0) + gap * Math.max(0, level.length - 1);
    let y = top + Math.max(0, (h - used) / 2);
    for (const n of level) {
      const nh = Math.max(1, n.value * k);
      at.set(`${i}\u0000${n.label}`, { x: colX(i), y, h: nh, color: pal[colour++ % pal.length], out: y, in: y });
      y += nh + gap;
    }
  });
  // the bands, under the nodes
  for (const l of flows.links) {
    const f = at.get(`${l.level}\u0000${l.from}`), t = at.get(`${l.level + 1}\u0000${l.to}`);
    if (!f || !t) continue;
    const wd = l.value * k;
    const x0 = f.x + nodeW, x1 = t.x, xm = (x0 + x1) / 2;
    const y0 = f.out, y1 = t.in;
    f.out += wd; t.in += wd;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.bezierCurveTo(xm, y0, xm, y1, x1, y1);
    ctx.lineTo(x1, y1 + wd);
    ctx.bezierCurveTo(xm, y1 + wd, xm, y0 + wd, x0, y0 + wd);
    ctx.closePath();
    const on = !litLinks || litLinks.has(`${l.level}\u0000${l.from}\u0000${l.to}`);
    ctx.fillStyle = withAlpha(f.color, on ? 0.42 : 0.12);
    (ctx as CanvasRenderingContext2D).fill();
    parts.push({ shape: 'band', x0, x1, top0: y0, bottom0: y0 + wd, top1: y1, bottom1: y1 + wd, pick: [{ level: l.level, value: l.from }, { level: l.level + 1, value: l.to }] });
  }
  // the nodes, and their labels beside them (the last level's on its left)
  flows.levels.forEach((level, i) => {
    for (const n of level) {
      const p = at.get(`${i}\u0000${n.label}`)!;
      const on = !litNodes || litNodes.has(`${i}\u0000${n.label}`);
      ctx.fillStyle = on ? p.color : withAlpha(p.color, 0.3);
      ctx.fillRect(p.x, p.y, nodeW, p.h);
      parts.push({ shape: 'box', box: { x: p.x, y: p.y, w: nodeW, h: p.h }, pick: [{ level: i, value: n.label }] });
      if (p.h < tickFs * 0.7 && level.length > 1) continue;
      const last = i === L - 1 && L > 1;
      text(ctx, `${n.label} (${generalNumber(n.value)})`, last ? p.x - 4 : p.x + nodeW + 4, p.y + p.h / 2 + tickFs * 0.35, opt(tickFs, { align: last ? 'right' : 'left' }));
    }
  });
  return out();
}

/** The categories of a path as a pick (a category at each level from the first). */
const pathPick = (path: readonly string[]): ChartPick => path.map((value, level) => ({ level, value }));

/** Is a node of the whole still there (any of it) once a pick is applied? */
const litHas = (lit: HierNode | null, node: HierNode): boolean => !lit || (nodeAt(lit, node.path)?.value ?? 0) > 0;

/**
 * A treemap: the categories of the level it is drilled to (the first, undrilled) as boxes as big
 * as the rows in them, each holding the next level's categories as smaller boxes in shades of its
 * colour. Drilled in, a trail of categories over it ("All › Aromatic") leads back up.
 */
function drawTreemap(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, opt: (size: number, more?: Partial<TextOpts>) => TextOpts, lit?: SeriesData[]): ChartHits {
  const fs = chart.fontSize ?? 12, small = fs * 0.92;
  const parts: ChartPart[] = [];
  const out = (): ChartHits => ({ plot: area, fitLabels: [], fits: [], parts });
  const root = hierarchy(data);
  if (!root.value) return out();
  const path = validPath(root, chart.path);
  const at = nodeAt(root, path)!;
  const litRoot = lit ? hierarchy(lit) : null;
  const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  let top = area.y;
  // the trail back up: each category but the last leads back to it
  if (path.length) {
    const crumbs = ['All', ...path];
    let x = area.x;
    const y = top + small;
    crumbs.forEach((c, i) => {
      const last = i === crumbs.length - 1;
      const cw = text(ctx, c, x, y, opt(small, { bold: last, color: last ? TEXT : '#2f5597' }));
      if (!last) {
        parts.push({ shape: 'box', box: { x, y: top, w: cw, h: small * 1.4 }, pick: [], drill: path.slice(0, i) });
        x += cw + text(ctx, ' › ', x + cw, y, opt(small, { color: '#8c8c8c' }));
      }
    });
    top += small * 1.8;
  }
  const box = { x: area.x, y: top, w: area.w, h: Math.max(1, area.y + area.h - top) };
  /** A box's words: its category, and its amount under it where there's room. */
  const label = (n: HierNode, r: Box, bold: boolean) => {
    if (r.w < small * 1.5 || r.h < small * 1.3) return;
    const o = opt(small, { color: '#ffffff', bold });
    const name = fitText(ctx, n.label, r.w - 8, o);
    if (!name) return;
    text(ctx, name, r.x + 4, r.y + small + 2, o);
    if (r.h >= small * 2.7) text(ctx, generalNumber(n.value), r.x + 4, r.y + small * 2.2 + 2, opt(small * 0.9, { color: '#ffffff' }));
  };
  // nothing below the category drilled to: it fills the box
  const groups = at.children.length ? at.children : [at];
  const rects = squarify(groups.map((g) => g.value), box);
  groups.forEach((g, k) => {
    const r = { x: rects[k].x + 1, y: rects[k].y + 1, w: rects[k].w - 2, h: rects[k].h - 2 };
    if (r.w < 1 || r.h < 1) return;
    const colour = pal[k % pal.length];
    const head = small * 1.6;
    const nested = g !== at && g.children.length > 0 && r.h > head + small * 1.5 && r.w > small * 3;
    ctx.fillStyle = litHas(litRoot, g) ? colour : withAlpha(colour, 0.3);
    ctx.fillRect(r.x, r.y, r.w, r.h);
    const drill = g !== at && g.children.length ? g.path : undefined;
    if (!nested) {
      label(g, r, false);
      parts.push({ shape: 'box', box: r, pick: pathPick(g.path), ...(drill ? { drill } : {}) });
      return;
    }
    // a band across its top with its category, then its own categories in shades of its colour
    const hb = { x: r.x, y: r.y, w: r.w, h: head };
    const o = opt(small, { color: '#ffffff', bold: true });
    const name = fitText(ctx, `${g.label} (${generalNumber(g.value)})`, r.w - 8, o) || fitText(ctx, g.label, r.w - 8, o);
    if (name) text(ctx, name, r.x + 4, r.y + small * 1.15, o);
    const inner = { x: r.x + 2, y: r.y + head, w: r.w - 4, h: r.h - head - 2 };
    const kids = squarify(g.children.map((c) => c.value), inner);
    g.children.forEach((c, m) => {
      const kr = { x: kids[m].x + 0.75, y: kids[m].y + 0.75, w: kids[m].w - 1.5, h: kids[m].h - 1.5 };
      if (kr.w < 1 || kr.h < 1) return;
      const shade = lighter(colour, Math.min(0.45, 0.12 + (m % 5) * 0.07));
      ctx.fillStyle = litHas(litRoot, c) ? shade : withAlpha(shade, 0.3);
      ctx.fillRect(kr.x, kr.y, kr.w, kr.h);
      label(c, kr, false);
      // a click inside drills into the box it is in (into it, if it goes further down)
      parts.push({ shape: 'box', box: kr, pick: pathPick(c.path), drill: g.path });
    });
    parts.push({ shape: 'box', box: hb, pick: pathPick(g.path), drill: g.path });
  });
  return out();
}

/**
 * A decomposition tree, as PowerBI draws one: the total, then a column for each level the tree is
 * expanded to, each node a bar as long as its share of the node it splits, with lines from the
 * node expanded to the nodes it splits into. Clicking a node expands it; clicking it again closes
 * it up.
 */
function drawDecomp(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, opt: (size: number, more?: Partial<TextOpts>) => TextOpts, lit?: SeriesData[]): ChartHits {
  const fs = chart.fontSize ?? 12, small = fs * 0.92;
  const parts: ChartPart[] = [];
  const out = (): ChartHits => ({ plot: area, fitLabels: [], fits: [], parts });
  const L = data.length;
  const root = hierarchy(data);
  if (!L || !root.value) return out();
  // the last level has nothing under it to expand
  const path = validPath(root, chart.path).slice(0, L - 1);
  const litRoot = lit ? hierarchy(lit) : null;
  const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  const colour = pal[0];
  // the columns: the total, then what each node expanded splits into
  const cols: HierNode[][] = [[root]];
  for (let i = 0; i <= path.length && i < L; i++) cols.push(nodeAt(root, path.slice(0, i))!.children);
  const colW = area.w / Math.max(cols.length, 3);
  const barW = Math.max(20, colW - 30);
  const nodeH = small * 2.7;
  // each column's name over it
  const named = data.some((d, i) => d.name && d.name !== `Series ${i + 1}`);
  const headH = small * 1.8;
  cols.forEach((_, i) => {
    const name = i === 0 ? 'Total' : named ? data[i - 1].name : `Level ${i}`;
    text(ctx, fitText(ctx, name, colW - 6, opt(small, { bold: true })), area.x + i * colW, area.y + small, opt(small, { bold: true, color: '#595959' }));
  });
  const top = area.y + headH, h = Math.max(nodeH, area.y + area.h - top);
  const fits = Math.max(1, Math.floor(h / nodeH));
  /** Where each column's expanded node's bar is (the lines to the next column start there). */
  let from: { x: number; y: number } | null = null;
  cols.forEach((col, i) => {
    const x = area.x + i * colW;
    const parent = i === 0 ? null : nodeAt(root, path.slice(0, i - 1))!;
    // more than fit: the largest, and a note of how many more
    const shown = col.length > fits ? col.slice(0, Math.max(1, fits - 1)) : col;
    const rows = shown.length + (shown.length < col.length ? 1 : 0);
    // centred on the node it splits, as far as the column allows
    const want = from ? from.y - (rows * nodeH) / 2 : top + (h - rows * nodeH) / 2;
    const y0 = Math.max(top, Math.min(want, top + h - rows * nodeH));
    let next: { x: number; y: number } | null = null;
    shown.forEach((n, k) => {
      const y = y0 + k * nodeH;
      const barY = y + small * 1.45, barH = Math.max(5, small * 0.8);
      const open = i > 0 && path[i - 1] === n.label;
      const on = litHas(litRoot, n);
      if (from) {
        ctx.strokeStyle = open ? '#7f7f7f' : '#c9c9c9'; ctx.lineWidth = open ? 1.5 : 1; ctx.setLineDash([]);
        const xm = (from.x + x) / 2, yy = barY + barH / 2;
        ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.bezierCurveTo(xm, from.y, xm, yy, x - 2, yy); ctx.stroke();
      }
      const share = parent ? n.value / (parent.value || 1) : 1;
      ctx.fillStyle = '#ededed';
      ctx.fillRect(x, barY, barW, barH);
      const c = i === 0 || open ? darker(colour) : colour;
      ctx.fillStyle = on ? c : withAlpha(c, 0.3);
      ctx.fillRect(x, barY, Math.max(1, barW * share), barH);
      const amount = generalNumber(n.value);
      const vo = opt(small, { align: 'right', color: on ? TEXT : '#a6a6a6' });
      const aw = measure(ctx, amount, vo);
      text(ctx, amount, x + barW, y + small * 1.05, vo);
      const lo = opt(small, { bold: open || i === 0, color: on ? TEXT : '#a6a6a6' });
      text(ctx, fitText(ctx, i === 0 ? 'Total' : n.label, barW - aw - 6, lo), x, y + small * 1.05, lo);
      if (open) next = { x: x + barW, y: barY + barH / 2 };
      if (i === 0) next = { x: x + barW, y: barY + barH / 2 };
      // what a click does: the total closes everything up; a node expands (or closes up, open)
      const expandable = i > 0 && i < L;
      const drill = i === 0 ? [] : open ? path.slice(0, i - 1) : expandable ? n.path : undefined;
      parts.push({ shape: 'box', box: { x, y, w: barW, h: nodeH }, pick: pathPick(n.path), ...(drill ? { drill } : {}) });
    });
    if (shown.length < col.length) text(ctx, `+${col.length - shown.length} more`, x, y0 + shown.length * nodeH + small * 1.1, opt(small * 0.9, { color: '#8c8c8c' }));
    from = next;
  });
  return out();
}

// ---------------------------------------------------------------- pictures

/** A chart as shapes and text in points (96 pixels to 72 points), for SVG and EMF pictures. */
export function chartItems(chart: Chart, data: SeriesData[]): Item[] {
  const v = new VectorContext();
  drawChart(v, chart, data, chart.w, chart.h);
  return scaleItems(v.items, 0.75);
}

/** A chart as an SVG picture (for documents, slides and Save as Picture). */
export function chartSvg(chart: Chart, data: SeriesData[]): string {
  return itemsToSvg(chartItems(chart, data), { x1: 0, y1: 0, x2: chart.w * 0.75, y2: chart.h * 0.75 });
}

function scaleItems(items: Item[], k: number): Item[] {
  const seg = (s: Seg): Seg => (s.k === 'Z' ? s : s.k === 'C' ? { k: 'C', x1: s.x1 * k, y1: s.y1 * k, x2: s.x2 * k, y2: s.y2 * k, x: s.x * k, y: s.y * k } : { k: s.k, x: s.x * k, y: s.y * k });
  return items.map((it) => {
    if (it.kind === 'path') return { ...it, segs: it.segs.map(seg), ...(it.stroke ? { stroke: { ...it.stroke, width: it.stroke.width * k } } : {}) };
    if (it.kind === 'text') return { ...it, x: it.x * k, y: it.y * k, size: it.size * k, widths: it.widths.map((w) => w * k) };
    return { ...it, x: it.x * k, y: it.y * k, w: it.w * k, h: it.h * k };
  });
}

/** A chart drawn on a new canvas at a scale (PNG pictures). */
export function chartCanvas(chart: Chart, data: SeriesData[], scale = 2): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.round(chart.w * scale);
  c.height = Math.round(chart.h * scale);
  const ctx = c.getContext('2d')!;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  drawChart(ctx, chart, data, chart.w, chart.h);
  return c;
}
