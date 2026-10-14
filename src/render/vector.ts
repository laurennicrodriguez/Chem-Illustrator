// Recording what the renderer draws as plain shapes and text, so a drawing can be turned into
// a vector picture (EMF for Word and PowerPoint, SVG). It behaves like the parts of a canvas
// that the renderer uses; curves are kept as Bézier segments and dashes are cut into pieces,
// so every output format can draw the result with only lines, curves and text.

import { arialWidth } from '../text-metrics';

export type Seg =
  | { k: 'M'; x: number; y: number }
  | { k: 'L'; x: number; y: number }
  | { k: 'C'; x1: number; y1: number; x2: number; y2: number; x: number; y: number }
  | { k: 'Z' };

export interface StrokeStyle { color: string; width: number; cap: CanvasLineCap; join: CanvasLineJoin }

/** A picture: its image data, where it shows (x, y, w, h), and the part of it cut off on each side. */
export interface ImageItem {
  kind: 'image';
  src: string;
  x: number; y: number; w: number; h: number;
  crop?: { l: number; t: number; r: number; b: number };
  px?: { w: number; h: number };
}

export type Item =
  | { kind: 'path'; segs: Seg[]; fill?: string; stroke?: StrokeStyle }
  | { kind: 'text'; text: string; x: number; y: number; size: number; family: string; bold: boolean; italic: boolean; color: string; widths: number[]; /** Turned anticlockwise, in degrees (90: reads upwards). */ angle?: number }
  | ImageItem;

/** A path that remembers its segments (stands in for the browser's Path2D). */
export class VecPath {
  segs: Seg[] = [];
  private sx = 0;
  private sy = 0;
  private cx = 0;
  private cy = 0;
  private open = false;

  moveTo(x: number, y: number): void {
    this.segs.push({ k: 'M', x, y });
    this.sx = this.cx = x; this.sy = this.cy = y; this.open = true;
  }

  lineTo(x: number, y: number): void {
    if (!this.open) { this.moveTo(x, y); return; }
    this.segs.push({ k: 'L', x, y });
    this.cx = x; this.cy = y;
  }

  bezierCurveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    if (!this.open) this.moveTo(x1, y1);
    this.segs.push({ k: 'C', x1, y1, x2, y2, x, y });
    this.cx = x; this.cy = y;
  }

  quadraticCurveTo(qx: number, qy: number, x: number, y: number): void {
    if (!this.open) this.moveTo(qx, qy);
    const x0 = this.cx, y0 = this.cy;
    this.bezierCurveTo(x0 + (2 / 3) * (qx - x0), y0 + (2 / 3) * (qy - y0), x + (2 / 3) * (qx - x), y + (2 / 3) * (qy - y), x, y);
  }

  closePath(): void {
    if (!this.open) return;
    this.segs.push({ k: 'Z' });
    this.cx = this.sx; this.cy = this.sy;
  }

  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath();
  }

  roundRect(x: number, y: number, w: number, h: number, radii: number | number[] = 0): void {
    const r = Math.max(0, Math.min(typeof radii === 'number' ? radii : radii[0] ?? 0, Math.abs(w) / 2, Math.abs(h) / 2));
    if (!r) { this.rect(x, y, w, h); return; }
    this.moveTo(x + r, y);
    this.lineTo(x + w - r, y);
    this.ellipseArc(x + w - r, y + r, r, r, -Math.PI / 2, 0, false, false);
    this.lineTo(x + w, y + h - r);
    this.ellipseArc(x + w - r, y + h - r, r, r, 0, Math.PI / 2, false, false);
    this.lineTo(x + r, y + h);
    this.ellipseArc(x + r, y + h - r, r, r, Math.PI / 2, Math.PI, false, false);
    this.lineTo(x, y + r);
    this.ellipseArc(x + r, y + r, r, r, Math.PI, (3 * Math.PI) / 2, false, false);
    this.closePath();
  }

  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    this.ellipseArc(x, y, r, r, a0, a1, ccw, true);
  }

  ellipse(x: number, y: number, rx: number, ry: number, rotation: number, a0: number, a1: number, ccw = false): void {
    // the renderer only draws unrotated ellipses
    void rotation;
    this.ellipseArc(x, y, rx, ry, a0, a1, ccw, true);
  }

  /** An elliptical arc as cubic Béziers (at most 90° each), joined to the current point. */
  private ellipseArc(x: number, y: number, rx: number, ry: number, a0: number, a1: number, ccw: boolean, join: boolean): void {
    const TAU = Math.PI * 2;
    let sweep = a1 - a0;
    if (!ccw && sweep < 0) sweep = (sweep % TAU) + TAU;
    if (ccw && sweep > 0) sweep = (sweep % TAU) - TAU;
    if (Math.abs(a1 - a0) >= TAU - 1e-9) sweep = ccw ? -TAU : TAU;
    const start = { x: x + rx * Math.cos(a0), y: y + ry * Math.sin(a0) };
    if (!this.open) this.moveTo(start.x, start.y);
    else if (join || Math.hypot(start.x - this.cx, start.y - this.cy) > 1e-9) this.lineTo(start.x, start.y);
    const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / n;
    const k = (4 / 3) * Math.tan(step / 4);
    for (let i = 0; i < n; i++) {
      const t0 = a0 + step * i, t1 = t0 + step;
      const c0 = Math.cos(t0), s0 = Math.sin(t0), c1 = Math.cos(t1), s1 = Math.sin(t1);
      this.bezierCurveTo(
        x + rx * (c0 - k * s0), y + ry * (s0 + k * c0),
        x + rx * (c1 + k * s1), y + ry * (s1 - k * c1),
        x + rx * c1, y + ry * s1,
      );
    }
  }
}

interface State {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  font: string;
  dash: number[];
}

/**
 * Stands in for a canvas's 2D context and records the drawing. Only what the renderer uses is
 * provided; anything else would be a mistake in the renderer and throws.
 */
/** The width of one character in a font (Arial's widths when not given). */
export type CharWidth = (ch: string, size: number, family: string, bold: boolean, italic: boolean) => number;

export class VectorContext {
  items: Item[] = [];
  /** Text is placed with these widths (a document's fonts), else Arial's. */
  constructor(private charWidth: CharWidth | null = null) {}
  private path = new VecPath();
  private st: State = { fillStyle: '#000', strokeStyle: '#000', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', font: '10px Arial', dash: [] };
  private stack: State[] = [];
  textBaseline: CanvasTextBaseline = 'alphabetic';
  imageSmoothingEnabled = true;

  get fillStyle(): string { return this.st.fillStyle; }
  set fillStyle(v: string) { this.st.fillStyle = v; }
  get strokeStyle(): string { return this.st.strokeStyle; }
  set strokeStyle(v: string) { this.st.strokeStyle = v; }
  get lineWidth(): number { return this.st.lineWidth; }
  set lineWidth(v: number) { this.st.lineWidth = v; }
  get lineCap(): CanvasLineCap { return this.st.lineCap; }
  set lineCap(v: CanvasLineCap) { this.st.lineCap = v; }
  get lineJoin(): CanvasLineJoin { return this.st.lineJoin; }
  set lineJoin(v: CanvasLineJoin) { this.st.lineJoin = v; }
  get font(): string { return this.st.font; }
  set font(v: string) { this.st.font = v; }

  save(): void { this.stack.push({ ...this.st, dash: [...this.st.dash] }); }
  restore(): void { const s = this.stack.pop(); if (s) this.st = s; }
  setLineDash(d: number[]): void { this.st.dash = d.length % 2 ? [...d, ...d] : [...d]; }
  getLineDash(): number[] { return [...this.st.dash]; }
  setTransform(): void { /* drawings are recorded in document coordinates */ }

  beginPath(): void { this.path = new VecPath(); }
  moveTo(x: number, y: number): void { this.path.moveTo(x, y); }
  lineTo(x: number, y: number): void { this.path.lineTo(x, y); }
  bezierCurveTo(a: number, b: number, c: number, d: number, e: number, f: number): void { this.path.bezierCurveTo(a, b, c, d, e, f); }
  quadraticCurveTo(a: number, b: number, c: number, d: number): void { this.path.quadraticCurveTo(a, b, c, d); }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw?: boolean): void { this.path.arc(x, y, r, a0, a1, ccw); }
  ellipse(x: number, y: number, rx: number, ry: number, rot: number, a0: number, a1: number, ccw?: boolean): void { this.path.ellipse(x, y, rx, ry, rot, a0, a1, ccw); }
  rect(x: number, y: number, w: number, h: number): void { this.path.rect(x, y, w, h); }
  roundRect(x: number, y: number, w: number, h: number, r?: number | number[]): void { this.path.roundRect(x, y, w, h, r); }
  closePath(): void { this.path.closePath(); }

  fill(p?: VecPath | Path2D): void {
    const segs = ((p as VecPath | undefined) ?? this.path).segs;
    if (segs.length) this.items.push({ kind: 'path', segs: [...segs], fill: this.st.fillStyle });
  }

  stroke(p?: VecPath | Path2D): void {
    const segs = ((p as VecPath | undefined) ?? this.path).segs;
    if (!segs.length) return;
    const stroke: StrokeStyle = { color: this.st.strokeStyle, width: this.st.lineWidth, cap: this.st.lineCap, join: this.st.lineJoin };
    this.items.push({ kind: 'path', segs: this.st.dash.length ? dashed(segs, this.st.dash) : [...segs], stroke });
  }

  fillRect(x: number, y: number, w: number, h: number): void {
    const p = new VecPath();
    p.rect(x, y, w, h);
    this.items.push({ kind: 'path', segs: p.segs, fill: this.st.fillStyle });
  }

  strokeRect(x: number, y: number, w: number, h: number): void {
    const p = new VecPath();
    p.rect(x, y, w, h);
    this.stroke(p);
  }

  clearRect(): void { /* a picture starts empty */ }

  fillText(text: string, x: number, y: number): void {
    const f = parseFont(this.st.font);
    const cw = this.charWidth;
    const widths = [...text].map((ch) => (cw ? cw(ch, f.size, f.family, f.bold, f.italic) : arialWidth(ch, f.size, f.bold)));
    this.items.push({ kind: 'text', text, x, y, size: f.size, family: f.family, bold: f.bold, italic: f.italic, color: this.st.fillStyle, widths });
  }

  /** Text turned about its starting point (degrees anticlockwise), which a canvas does with rotate(). */
  fillTextTurned(text: string, x: number, y: number, angle: number): void {
    this.fillText(text, x, y);
    const it = this.items[this.items.length - 1];
    if (angle && it.kind === 'text') it.angle = angle;
  }

  measureText(text: string): TextMetrics {
    const f = parseFont(this.st.font);
    const cw = this.charWidth;
    return { width: cw ? [...text].reduce((n, ch) => n + cw(ch, f.size, f.family, f.bold, f.italic), 0) : arialWidth(text, f.size, f.bold) } as TextMetrics;
  }

  drawImage(): void { throw new Error('The renderer records pictures with picture()'); }

  /** A picture on the drawing (see Renderer.drawPicture). */
  picture(s: { src?: string; x1: number; y1: number; x2: number; y2: number; crop?: ImageItem['crop']; px?: ImageItem['px'] }): void {
    if (!s.src) return;
    const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
    this.items.push({ kind: 'image', src: s.src, x, y, w: Math.abs(s.x2 - s.x1), h: Math.abs(s.y2 - s.y1), crop: s.crop, px: s.px });
  }
}

/** "italic bold 7.5px Arial, 'Liberation Sans', sans-serif" → its parts. */
export function parseFont(font: string): { size: number; family: string; bold: boolean; italic: boolean } {
  const m = /([\d.]+)px\s+(.*)$/.exec(font);
  const size = m ? Number(m[1]) : 10;
  const family = (m?.[2] ?? 'Arial').split(',')[0].trim().replace(/^['"]|['"]$/g, '') || 'Arial';
  return { size, family, bold: /\bbold\b|\b[6-9]00\b/.test(font), italic: /\bitalic\b|\boblique\b/.test(font) };
}

/** Colour as red, green, blue (0–255) and opacity (0–1). Unknown colours are black. */
export function parseColor(c: string): { r: number; g: number; b: number; a: number } {
  const s = c.trim().toLowerCase();
  const named: Record<string, string> = { black: '#000000', white: '#ffffff', red: '#ff0000', blue: '#0000ff', transparent: '#00000000' };
  const h = named[s] ?? s;
  if (/^#[0-9a-f]{3,4}$/.test(h)) {
    const v = [...h.slice(1)].map((x) => parseInt(x + x, 16));
    return { r: v[0], g: v[1], b: v[2], a: v.length > 3 ? v[3] / 255 : 1 };
  }
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(h)) {
    const v = [1, 3, 5, 7].map((i) => parseInt(h.slice(i, i + 2) || 'ff', 16));
    return { r: v[0], g: v[1], b: v[2], a: v[3] / 255 };
  }
  const m = /^rgba?\(([^)]+)\)$/.exec(h);
  if (m) {
    const v = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    return { r: v[0] ?? 0, g: v[1] ?? 0, b: v[2] ?? 0, a: v[3] ?? 1 };
  }
  return { r: 0, g: 0, b: 0, a: 1 };
}

/** Flatten a path to polylines (one per subpath), for dashing and for size. */
export function flatten(segs: Seg[], tol = 0.05): { pts: { x: number; y: number }[]; closed: boolean }[] {
  const out: { pts: { x: number; y: number }[]; closed: boolean }[] = [];
  let cur: { pts: { x: number; y: number }[]; closed: boolean } | null = null;
  for (const s of segs) {
    if (s.k === 'M') { cur = { pts: [{ x: s.x, y: s.y }], closed: false }; out.push(cur); continue; }
    if (!cur) continue;
    const last = cur.pts[cur.pts.length - 1];
    if (s.k === 'L') cur.pts.push({ x: s.x, y: s.y });
    else if (s.k === 'C') {
      const l = Math.hypot(s.x1 - last.x, s.y1 - last.y) + Math.hypot(s.x2 - s.x1, s.y2 - s.y1) + Math.hypot(s.x - s.x2, s.y - s.y2);
      const n = Math.max(2, Math.min(64, Math.ceil(Math.sqrt(l / tol))));
      for (let i = 1; i <= n; i++) {
        const t = i / n, u = 1 - t;
        cur.pts.push({
          x: u * u * u * last.x + 3 * u * u * t * s.x1 + 3 * u * t * t * s.x2 + t * t * t * s.x,
          y: u * u * u * last.y + 3 * u * u * t * s.y1 + 3 * u * t * t * s.y2 + t * t * t * s.y,
        });
      }
    } else if (s.k === 'Z') {
      cur.closed = true;
      cur.pts.push({ ...cur.pts[0] });
      cur = { pts: [{ ...cur.pts[0] }], closed: false };
      out.push(cur);
    }
  }
  return out.filter((p) => p.pts.length > 1);
}

/** Cut a path into dashes, as separate line pieces. */
export function dashed(segs: Seg[], pattern: number[]): Seg[] {
  const total = pattern.reduce((a, b) => a + b, 0);
  if (total <= 0) return [...segs];
  const out: Seg[] = [];
  for (const { pts } of flatten(segs)) {
    let idx = 0, left = pattern[0], on = true, penDown = false;
    for (let i = 1; i < pts.length; i++) {
      let a = pts[i - 1];
      const b = pts[i];
      let segLen = Math.hypot(b.x - a.x, b.y - a.y);
      while (segLen > 1e-9) {
        const step = Math.min(left, segLen);
        const t = step / segLen;
        const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        if (on) {
          if (!penDown) { out.push({ k: 'M', x: a.x, y: a.y }); penDown = true; }
          out.push({ k: 'L', x: p.x, y: p.y });
        }
        a = p;
        segLen -= step;
        left -= step;
        if (left <= 1e-9) {
          idx = (idx + 1) % pattern.length;
          left = pattern[idx];
          on = !on;
          penDown = false;
        }
      }
    }
  }
  return out;
}

/** Smallest box holding everything drawn (text boxes estimated from their font size). */
export function itemBounds(items: Item[]): { x1: number; y1: number; x2: number; y2: number } | null {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const grow = (x: number, y: number) => { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; };
  for (const it of items) {
    if (it.kind === 'text') {
      const w = it.widths.reduce((a, b) => a + b, 0);
      grow(it.x, it.y - it.size * 0.8);
      grow(it.x + w, it.y + it.size * 0.25);
    } else if (it.kind === 'image') {
      grow(it.x, it.y);
      grow(it.x + it.w, it.y + it.h);
    } else {
      const pad = it.stroke ? it.stroke.width / 2 : 0;
      for (const s of it.segs) {
        if (s.k === 'Z') continue;
        grow(s.x - pad, s.y - pad); grow(s.x + pad, s.y + pad);
        if (s.k === 'C') { grow(s.x1, s.y1); grow(s.x2, s.y2); }
      }
    }
  }
  return x1 === Infinity ? null : { x1, y1, x2, y2 };
}
