// Drawing a chart: on the sheet's canvas, or into a recording (VectorContext) that becomes an SVG
// or EMF picture for documents and slides. Everything is laid out in the chart's own pixels at
// 100%; the caller scales the canvas. Titles take simple sub- and superscripts: k_{obs}, s^{−1}.

import type { Chart, ChartAxis, SeriesData, MarkerShape } from '../sheet/chart';
import { niceTicks, logTicks, CHART_PALETTES } from '../sheet/chart';
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
}

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

/** The fitted line of each series (worked out once and shared by the drawing and the side panel). */
export function chartFits(chart: Chart, data: SeriesData[]): (Fit | null)[] {
  return chart.series.map((s, i) => {
    const d = data[i];
    if (!s.fit || !d || chart.kind === 'pie') return null;
    const xs = chart.kind === 'scatter' ? d.xs : d.ys.map((_, j) => j + 1);
    return fitPoints(s.fit.kind, xs, d.ys, s.fit.intercept);
  });
}

interface LegendItem { name: string; color: string; kind: 'line' | 'box' | 'fit'; marker?: MarkerShape; dash?: number[]; line?: boolean }

export function drawChart(ctx: Ctx, chart: Chart, data: SeriesData[], w: number, h: number): ChartHits {
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
  } else {
    data.forEach((d, i) => {
      const s = chart.series[i];
      const lineLike = kind === 'scatter' || kind === 'line';
      const sticks = kind === 'scatter' && !!s.sticks;
      legend.push({ name: d.name, color: d.color, kind: lineLike ? 'line' : 'box', marker: lineLike ? s.marker ?? (kind === 'scatter' && !sticks ? 'circle' : 'none') : undefined, dash: dashOf(s.dash), line: kind === 'line' ? s.line !== false : !!s.line || sticks });
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

  if (kind === 'pie') return drawPie(ctx, chart, data, { x: left, y: top, w: Math.max(1, right - left), h: Math.max(1, bottom - top) }, fs, family);

  // value ranges
  const horizontal = kind === 'bar';
  const ncat = Math.max(0, ...data.map((d) => d.ys.length));
  let ylo = Infinity, yhi = -Infinity, xlo = Infinity, xhi = -Infinity;
  const growY = (v: number) => { if (Number.isFinite(v)) { if (v < ylo) ylo = v; if (v > yhi) yhi = v; } };
  const growX = (v: number) => { if (Number.isFinite(v)) { if (v < xlo) xlo = v; if (v > xhi) xhi = v; } };
  const stackable = chart.stacked && (kind === 'column' || kind === 'bar' || kind === 'area');
  if (stackable) {
    for (let j = 0; j < ncat; j++) {
      let pos = 0, neg = 0;
      for (const d of data) { const v = d.ys[j]; if (Number.isFinite(v)) { if (v >= 0) pos += v; else neg += v; } }
      growY(pos); growY(neg);
    }
  } else {
    data.forEach((d) => d.ys.forEach((v, j) => { growY(v); if (d.plus) growY(v + (d.plus[j] || 0)); if (d.minus) growY(v - (d.minus[j] || 0)); }));
  }
  if (kind === 'scatter') data.forEach((d) => d.xs.forEach((x, j) => { if (Number.isFinite(d.ys[j])) growX(x); }));
  // sticks stand on zero, and keep clear of the plot's sides
  const anySticks = kind === 'scatter' && chart.series.some((s) => s.sticks);
  if (anySticks) {
    growY(0);
    if (xlo !== Infinity) { const padX = Math.max(0.5, (xhi - xlo) * 0.05); xlo -= padX; xhi += padX; }
  }
  // fitted lines reach beyond the data when asked
  chart.series.forEach((s, i) => {
    const f = fits[i];
    if (!f || !s.fit) return;
    const xs = kind === 'scatter' ? data[i].xs.filter(Number.isFinite) : data[i].ys.map((_, j) => j + 1);
    const a = least(xs) - (s.fit.backward ?? 0), b = most(xs) + (s.fit.forward ?? 0);
    if (kind === 'scatter') { growX(a); growX(b); }
    growY(fitAt(f, a)); growY(fitAt(f, b));
  });
  if (ylo === Infinity) { ylo = 0; yhi = 1; }
  if (xlo === Infinity) { xlo = 0; xhi = 1; }

  const valueAxisDef = horizontal ? chart.x : chart.y;
  const catAxisDef = horizontal ? chart.y : chart.x;
  const zero = kind === 'column' || kind === 'bar' || kind === 'area' ? 'always' : 'auto';
  const vAxis = numAxis(ylo, yhi, valueAxisDef, zero, Math.max(3, Math.round((horizontal ? w / 80 : h / 40))));
  const xAxis = kind === 'scatter' ? numAxis(xlo, xhi, chart.x, 'auto', Math.max(3, Math.round(w / 80))) : null;

  // room for titles and tick labels
  const xTitle = horizontal ? chart.x.title : chart.x.title, yTitle = chart.y.title;
  if (xTitle) bottom -= fs * 1.5 + 2;
  if (yTitle) left += fs * 1.5 + 2;
  const tickFs = fs * 0.92;
  const cats = data[0]?.cats ?? [];
  const leftLabels = horizontal ? cats.slice(0, ncat) : vAxis.ticks.map(vAxis.label);
  const leftW = Math.max(0, ...leftLabels.map((l) => measure(ctx, l, opt(tickFs))));
  left += Math.min(leftW, w * 0.35) + 6;
  bottom -= tickFs * 1.4 + 2;
  const bottomLabels = horizontal ? vAxis.ticks.map(vAxis.label) : xAxis ? xAxis.ticks.map(xAxis.label) : [];
  if (bottomLabels.length) right -= Math.min(measure(ctx, bottomLabels[bottomLabels.length - 1], opt(tickFs)) / 2, 30);
  const plot: Box = { x: left, y: top + fs * 0.5, w: Math.max(10, right - left), h: Math.max(10, bottom - top - fs * 0.5) };

  // where things go
  const X = (f: number) => plot.x + f * plot.w;
  const Y = (f: number) => plot.y + plot.h - f * plot.h;
  const band = (horizontal ? plot.h : plot.w) / Math.max(1, ncat);
  const catAt = (j: number) => (horizontal ? (catAxisDef.reverse ? plot.y + plot.h - (j + 0.5) * band : plot.y + (j + 0.5) * band) : catAxisDef.reverse ? plot.x + plot.w - (j + 0.5) * band : plot.x + (j + 0.5) * band);
  const valAt = (v: number) => (horizontal ? X(vAxis.frac(v)) : Y(vAxis.frac(v)));
  const ptX = (d: SeriesData, j: number) => (xAxis ? X(xAxis.frac(d.xs[j])) : catAt(j));

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
  const base = valAt(vAxis.log ? vAxis.min : Math.min(Math.max(0, vAxis.min), vAxis.max));
  if (kind === 'column' || kind === 'bar') {
    const groupW = band / 1.8;
    const each = stackable ? groupW : groupW / Math.max(1, data.length);
    const pos = new Array<number>(ncat).fill(0), neg = new Array<number>(ncat).fill(0);
    data.forEach((d, i) => {
      ctx.fillStyle = d.color;
      d.ys.forEach((v, j) => {
        if (!Number.isFinite(v)) return;
        let a: number, b: number;
        if (stackable) { const from = v >= 0 ? pos[j] : neg[j]; a = valAt(from); b = valAt(from + v); if (v >= 0) pos[j] += v; else neg[j] += v; }
        else { a = base; b = valAt(v); }
        const c = catAt(j) - groupW / 2 + (stackable ? 0 : i * each);
        const lo = Math.min(a, b), len = Math.abs(b - a);
        const r = horizontal ? clipBox({ x: lo, y: c, w: len, h: each }, plot) : clipBox({ x: c, y: lo, w: each, h: len }, plot);
        if (r) ctx.fillRect(r.x, r.y, r.w, r.h);
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
    for (const f of stackable ? fills : fills) {
      ctx.beginPath();
      f.up.forEach((v, j) => (j ? ctx.lineTo(catAt(j), clampY(valAt(v), plot)) : ctx.moveTo(catAt(j), clampY(valAt(v), plot))));
      for (let j = f.low.length - 1; j >= 0; j--) ctx.lineTo(catAt(j), clampY(stackable ? valAt(f.low[j]) : base, plot));
      ctx.closePath();
      ctx.fillStyle = stackable ? f.d.color : withAlpha(f.d.color, 0.75);
      (ctx as CanvasRenderingContext2D).fill();
    }
  }

  // axis lines
  ctx.strokeStyle = AXIS;
  ctx.lineWidth = 1;
  ctx.beginPath();
  if (horizontal) { const x = Math.round(base) + 0.5; ctx.moveTo(x, plot.y); ctx.lineTo(x, plot.y + plot.h); }
  else {
    const y = Math.round(kind === 'scatter' || kind === 'line' ? plot.y + plot.h : base) + 0.5;
    ctx.moveTo(plot.x, y); ctx.lineTo(plot.x + plot.w, y);
    if (kind === 'scatter') { ctx.moveTo(Math.round(plot.x) + 0.5, plot.y); ctx.lineTo(Math.round(plot.x) + 0.5, plot.y + plot.h); }
  }
  ctx.stroke();

  // lines, error bars and markers
  const inside = (x: number, y: number) => x >= plot.x - 0.5 && x <= plot.x + plot.w + 0.5 && y >= plot.y - 0.5 && y <= plot.y + plot.h + 0.5;
  data.forEach((d, i) => {
    const s = chart.series[i];
    if (kind === 'column' || kind === 'bar' || kind === 'area') return;
    const pts: [number, number][] = d.ys.map((v, j) => [ptX(d, j), Number.isFinite(v) && (!vAxis.log || v > 0) ? Y(vAxis.frac(v)) : NaN]);
    const showLine = kind === 'line' ? s.line !== false : !!s.line;
    if (showLine) {
      ctx.strokeStyle = d.color;
      ctx.lineWidth = s.lineWidth ?? 2;
      ctx.lineJoin = 'round'; ctx.lineCap = 'round';
      ctx.setLineDash(dashOf(s.dash));
      let line = pts;
      if (kind === 'scatter') line = pts.filter((p) => Number.isFinite(p[0])).slice().sort((a, b) => a[0] - b[0]);
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
  // error bars and markers go over every line
  data.forEach((d, i) => {
    const s = chart.series[i];
    const bars = kind === 'column' || kind === 'bar';
    const groupW = band / 1.8, each = stackable ? groupW : groupW / Math.max(1, data.length);
    if (d.plus) {
      ctx.strokeStyle = '#404040'; ctx.lineWidth = 1; ctx.setLineDash([]);
      ctx.beginPath();
      d.ys.forEach((v, j) => {
        if (!Number.isFinite(v)) return;
        const c = bars ? catAt(j) - groupW / 2 + (stackable ? 0 : i * each) + each / 2 : ptX(d, j);
        const hi = v + (d.plus![j] || 0), lo = v - (d.minus![j] || 0);
        if (horizontal) {
          const seg = clipSegment(valAt(lo), c, valAt(hi), c, plot);
          if (!seg) return;
          ctx.moveTo(seg[0], c); ctx.lineTo(seg[2], c);
          for (const x of [valAt(lo), valAt(hi)]) if (x >= plot.x && x <= plot.x + plot.w) { ctx.moveTo(x, c - 3); ctx.lineTo(x, c + 3); }
        } else {
          if (!Number.isFinite(c)) return;
          const seg = clipSegment(c, valAt(hi), c, valAt(lo), plot);
          if (!seg) return;
          ctx.moveTo(c, seg[1]); ctx.lineTo(c, seg[3]);
          for (const y of [valAt(lo), valAt(hi)]) if (y >= plot.y && y <= plot.y + plot.h) { ctx.moveTo(c - 3, y); ctx.lineTo(c + 3, y); }
        }
      });
      ctx.stroke();
    }
    if (bars || kind === 'area') return;
    const marker = s.marker ?? (kind === 'scatter' && !s.sticks ? 'circle' : 'none');
    const size = s.markerSize ?? 7;
    d.ys.forEach((v, j) => {
      const x = ptX(d, j), y = Number.isFinite(v) && (!vAxis.log || v > 0) ? Y(vAxis.frac(v)) : NaN;
      if (Number.isFinite(x) && Number.isFinite(y) && inside(x, y)) drawMarker(ctx, marker, x, y, size, d.color);
    });
  });

  // fitted lines and their equations
  const fitLabels: ChartHits['fitLabels'] = [];
  const taken: [number, number][] = [];
  data.forEach((d) => d.ys.forEach((v, j) => { const x = ptX(d, j), y = valAt(v); if (Number.isFinite(x) && Number.isFinite(y)) taken.push([x, y]); }));
  chart.series.forEach((s, i) => {
    const f = fits[i], d = data[i];
    if (!f || !s.fit || !d) return;
    const xs = kind === 'scatter' ? d.xs.filter(Number.isFinite) : d.ys.map((_, j) => j + 1);
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
    const xs = kind === 'scatter' ? d.xs.filter(Number.isFinite) : d.ys.map((_, j) => j + 1);
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
        let n = 0;
        for (const [px, py] of taken) if (px >= x - 4 && px <= x + bw + 4 && py >= y - 4 && py <= y + bh + 4) n++;
        for (const l of fitLabels) if (x < l.box.x + l.box.w && l.box.x < x + bw && y < l.box.y + l.box.h && l.box.y < y + bh) n += 1000;
        return n;
      };
      const xs2 = [plot.x + plot.w - bw - 6, plot.x + 6], best = { x: xs2[0], y: plot.y + 6, n: Infinity };
      for (let k = 0; k < 4; k++) {
        for (const x of xs2) {
          for (const y of [plot.y + 6 + k * (bh + 4), plot.y + plot.h - bh - 6 - k * (bh + 4)]) {
            const n = busy(x, y) + k * 0.5;
            if (n < best.n) Object.assign(best, { x, y, n });
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
    if (!chart.series[i].labels) return;
    const bars = kind === 'column' || kind === 'bar';
    const groupW = band / 1.8, each = stackable ? groupW : groupW / Math.max(1, data.length);
    const showX = kind === 'scatter' && chart.series[i].labelX;
    d.ys.forEach((v, j) => {
      if (!Number.isFinite(v)) return;
      if (showX && !Number.isFinite(d.xs[j])) return;
      const fmt = chart.series[i].labelFmt;
      const t = showX ? formatValue(d.xs[j], fmt ?? chart.x.numFmt).text : formatValue(v, fmt ?? valueAxisDef.numFmt).text;
      if (horizontal) {
        const c = catAt(j) - groupW / 2 + (stackable ? 0 : i * each) + each / 2;
        text(ctx, t, valAt(v) + 4, c + tickFs * 0.35, opt(tickFs));
      } else {
        const x = bars ? catAt(j) - groupW / 2 + (stackable ? 0 : i * each) + each / 2 : ptX(d, j);
        const y = valAt(v);
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
    if (xAxis) for (const t of xAxis.ticks) text(ctx, xAxis.label(t), X(xAxis.frac(t)), plot.y + plot.h + tickFs * 1.2, { ...tick, align: 'center' });
    else {
      const widest = Math.max(1, ...cats.slice(0, ncat).map((c) => measure(ctx, c, tick)));
      labelCats(ctx, cats.slice(0, ncat), catAt, band, widest + 8, (l, p) => text(ctx, l, p, plot.y + plot.h + tickFs * 1.2, { ...tick, align: 'center' }));
    }
  }

  // axis titles
  if (xTitle) text(ctx, xTitle, plot.x + plot.w / 2, h - pad - (chart.legend === 'bottom' && legend.length ? h - pad - bottom - tickFs * 1.4 - fs * 1.5 - 6 : 0) - fs * 0.3, opt(fs, { align: 'center' }));
  if (yTitle) text(ctx, yTitle, pad + fs * 1.1, plot.y + plot.h / 2, opt(fs, { align: 'center', angle: 90 }));

  return { plot, fitLabels, fits };
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

function drawPie(ctx: Ctx, chart: Chart, data: SeriesData[], area: Box, fs: number, family: string): ChartHits {
  const d = data[0];
  const plot = area;
  if (!d) return { plot, fitLabels: [], fits: [] };
  const pal = (CHART_PALETTES[chart.palette ?? 'office'] ?? CHART_PALETTES.office).colors;
  const vals = d.ys.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = vals.reduce((a, b) => a + b, 0);
  const cx = area.x + area.w / 2, cy = area.y + area.h / 2, r = Math.max(4, Math.min(area.w, area.h) / 2 - 4);
  let a0 = -Math.PI / 2;
  vals.forEach((v, j) => {
    if (!total || !v) return;
    const a1 = a0 + (v / total) * Math.PI * 2;
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
    ctx.fillStyle = pal[j % pal.length]; (ctx as CanvasRenderingContext2D).fill();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
    if (chart.series[0]?.labels) {
      const m = (a0 + a1) / 2;
      const t = `${Math.round((v / total) * 1000) / 10}%`;
      text(ctx, t, cx + Math.cos(m) * r * 0.65, cy + Math.sin(m) * r * 0.65 + fs * 0.35, { size: fs * 0.92, family, align: 'center', color: '#ffffff', bold: true });
    }
    a0 = a1;
  });
  return { plot, fitLabels: [], fits: [] };
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
