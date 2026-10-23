// Finding your way round the endless drawing, on screen (Settings ▸ Navigation; the sums are in
// orientation-prefs.ts): the navigator map in a corner, arrows at the window's edge toward
// things out of sight, the dot grid painted behind the drawing, and the tint outside it. None
// of it is saved, printed, copied or exported.

import type { Rect } from '../geom';
import {
  type OrientPrefs, type EdgeMark, NAV_SIZES, GRID_SPACING, GRID_ALPHA, TINT_ALPHA,
  gridStep, seenRect, inside, union, fitInto, edgeMarks,
} from '../orientation-prefs';

export interface OrientView {
  view: { ox: number; oy: number; scale: number };
  width: number;
  height: number;
  dpr: number;
}

const reduceMotion = () => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Move the view so the point `p` (in points) is in the middle of the window, gliding there unless motion is reduced. */
export function glideTo(r: OrientView, p: { x: number; y: number }, moved: () => void): void {
  const tx = r.width / 2 - p.x * r.view.scale, ty = r.height / 2 - p.y * r.view.scale;
  const fx = r.view.ox, fy = r.view.oy;
  if (reduceMotion() || Math.hypot(tx - fx, ty - fy) < 2) { r.view.ox = tx; r.view.oy = ty; moved(); return; }
  const t0 = performance.now(), ms = 220;
  const step = () => {
    const t = Math.min(1, (performance.now() - t0) / ms);
    const e = 1 - (1 - t) ** 3;
    r.view.ox = fx + (tx - fx) * e;
    r.view.oy = fy + (ty - fy) * e;
    moved();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------- dot grid and tint

/**
 * The dot grid, painted into the drawing's tiles under everything else (the drawing's page
 * decoration): dots in points, spread out as you zoom out so they never crowd.
 */
export function paintGrid(ctx: CanvasRenderingContext2D, prefs: OrientPrefs, dpr: number, dark: boolean): void {
  if (!prefs.dotGrid) return;
  const m = ctx.getTransform();
  const k = m.a;
  if (!(k > 0)) return;
  const scale = k / (dpr || 1);
  const step = gridStep(GRID_SPACING[prefs.gridSpacing], scale);
  const w = ctx.canvas.width, h = ctx.canvas.height;
  const x1 = -m.e / k, y1 = -m.f / k, x2 = (w - m.e) / k, y2 = (h - m.f) / k;
  // a dot about 1.6 screen pixels across
  const s = 1.6 / scale;
  ctx.save();
  // (the dark page's filter turns the page round, so the same grey shows on it)
  ctx.fillStyle = `rgba(70, 80, 100, ${GRID_ALPHA[prefs.gridStrength] * (dark ? 0.8 : 1)})`;
  for (let x = Math.floor(x1 / step) * step; x <= x2; x += step) {
    for (let y = Math.floor(y1 / step) * step; y <= y2; y += step) ctx.fillRect(x - s / 2, y - s / 2, s, s);
  }
  ctx.restore();
}

/** The tint on the empty space beyond everything drawn: the window, less the drawing and a margin round it. Drawn on the overlay, in points. */
export function paintTint(ctx: CanvasRenderingContext2D, prefs: OrientPrefs, r: OrientView, content: Rect | null, margin: number): void {
  if (!prefs.tint || !content) return;
  const seen = seenRect(r.view, r.width, r.height);
  const c = { x1: content.x1 - margin, y1: content.y1 - margin, x2: content.x2 + margin, y2: content.y2 + margin };
  if (inside(seen, c)) return;
  ctx.save();
  ctx.fillStyle = `rgba(40, 55, 85, ${TINT_ALPHA[prefs.tintStrength]})`;
  ctx.beginPath();
  ctx.rect(seen.x1 - 1, seen.y1 - 1, seen.x2 - seen.x1 + 2, seen.y2 - seen.y1 + 2);
  ctx.rect(c.x1, c.y1, c.x2 - c.x1, c.y2 - c.y1);
  ctx.fill('evenodd');
  ctx.restore();
}

// ---------------------------------------------------------------- the navigator

export interface NavigatorHooks {
  /** What is drawn (null when nothing is). */
  content: () => Rect | null;
  /** The drawing's version: the map is drawn again when it changes. */
  version: () => number;
  /** Paint the drawing on a canvas whose transform maps points to its pixels. */
  paint: (ctx: CanvasRenderingContext2D) => void;
  background: () => string;
  /** The view moved. */
  moved: () => void;
  /** Fit the whole drawing in the window. */
  fit: () => void;
  /** Something is being dragged on the drawing: the map waits until it is put down. */
  busy: () => boolean;
}

/** A small map of the whole drawing in a corner of the window, with a box for the part on screen. Click or drag in it to move there. */
export class Navigator {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  /** The drawing drawn small, and the box of the drawing it shows. */
  private thumb: HTMLCanvasElement | OffscreenCanvas | null = null;
  private thumbBox: Rect | null = null;
  private thumbVersion = -1;
  private thumbKey = '';
  private lastPaint = 0;
  private paintMs = 0;
  private waiting = 0;
  private key = '';
  /** Where the map shows the drawing now: screen px = point × k + o. */
  private map = { k: 1, ox: 0, oy: 0 };
  /** Kept still while dragging in the map, so the point under the pointer stays put. */
  private frozen: Rect | null = null;
  shown = false;

  constructor(host: HTMLElement, private r: OrientView, private prefs: () => OrientPrefs, private hooks: NavigatorHooks) {
    this.el = document.createElement('div');
    this.el.className = 'navigator';
    this.el.hidden = true;
    this.el.title = 'Navigator: click or drag to move round the drawing; double-click to fit it all in the window (Settings ▸ Navigation)';
    this.canvas = document.createElement('canvas');
    this.el.append(this.canvas);
    host.append(this.el);
    this.el.addEventListener('pointerdown', (e) => this.down(e));
    this.el.addEventListener('dblclick', (e) => { e.preventDefault(); this.hooks.fit(); });
    this.el.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  }

  /** Called every frame: shows, hides and redraws the map when something it shows changed. */
  update(on: boolean): void {
    const p = this.prefs();
    const content = on && p.navigator ? this.hooks.content() : null;
    const seen = seenRect(this.r.view, this.r.width, this.r.height);
    const show = !!content && !(p.navHideAll && inside(content, seen));
    if (show !== this.shown) { this.shown = show; this.el.hidden = !show; this.key = ''; }
    if (!show || !content) return;
    const size = NAV_SIZES[p.navSize];
    this.place(p, size);
    const dpr = this.r.dpr || 1;
    if (this.canvas.width !== Math.round(size.w * dpr) || this.canvas.height !== Math.round(size.h * dpr)) {
      this.canvas.width = Math.round(size.w * dpr);
      this.canvas.height = Math.round(size.h * dpr);
      this.canvas.style.width = `${size.w}px`;
      this.canvas.style.height = `${size.h}px`;
      this.key = '';
    }
    this.refreshThumb(content, size);
    const { ox, oy, scale } = this.r.view;
    const key = `${ox}|${oy}|${scale}|${this.r.width}|${this.r.height}|${this.thumbKey}|${dpr}`;
    if (key === this.key) return;
    this.key = key;
    this.draw(seen, size, dpr);
  }

  /** The drawing drawn small, again when it changed (not while something is dragged, and not more often than drawing it takes). */
  private refreshThumb(content: Rect, size: { w: number; h: number }): void {
    const v = this.hooks.version();
    if (v === this.thumbVersion && this.thumb && this.thumb.width === Math.round(size.w * (this.r.dpr || 1))) return;
    const now = performance.now();
    const gap = Math.max(200, this.paintMs * 4);
    if (this.thumb && (this.hooks.busy() || now - this.lastPaint < gap)) {
      // try again soon (no frame may come once the drawing is still)
      if (!this.waiting) this.waiting = window.setTimeout(() => { this.waiting = 0; this.key = ''; this.update(true); }, Math.max(60, gap - (now - this.lastPaint)));
      return;
    }
    const dpr = this.r.dpr || 1;
    const w = Math.round(size.w * dpr), h = Math.round(size.h * dpr);
    const c: HTMLCanvasElement | OffscreenCanvas = this.thumb && this.thumb.width === w && this.thumb.height === h ? this.thumb
      : typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = c.getContext('2d') as CanvasRenderingContext2D;
    // room round the drawing, so the edges show
    const m = Math.max(content.x2 - content.x1, content.y2 - content.y1) * 0.06 + 10;
    const box = { x1: content.x1 - m, y1: content.y1 - m, x2: content.x2 + m, y2: content.y2 + m };
    const f = fitInto(box, w, h, 0);
    const t0 = performance.now();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(f.k, 0, 0, f.k, f.ox, f.oy);
    try { this.hooks.paint(ctx); } catch { /* a map that can't be drawn just stays empty */ }
    this.paintMs = performance.now() - t0;
    this.lastPaint = performance.now();
    this.thumb = c;
    // the part of the drawing the small picture covers
    this.thumbBox = { x1: -f.ox / f.k, y1: -f.oy / f.k, x2: (w - f.ox) / f.k, y2: (h - f.oy) / f.k };
    this.thumbVersion = v;
    this.thumbKey = `${v}|${w}|${h}`;
  }

  private draw(seen: Rect, size: { w: number; h: number }, dpr: number): void {
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.hooks.background();
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (!this.thumb || !this.thumbBox) return;
    // the map shows the drawing and the part on screen, wherever that is
    const all = this.frozen ?? union(this.thumbBox, seen);
    const f = fitInto(all, size.w, size.h, 4);
    this.map = f;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tb = this.thumbBox;
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.thumb, tb.x1 * f.k + f.ox, tb.y1 * f.k + f.oy, (tb.x2 - tb.x1) * f.k, (tb.y2 - tb.y1) * f.k);
    // the window: the rest of the map a little shaded, and the box outlined
    const x = seen.x1 * f.k + f.ox, y = seen.y1 * f.k + f.oy, w = (seen.x2 - seen.x1) * f.k, h = (seen.y2 - seen.y1) * f.k;
    ctx.fillStyle = 'rgba(30, 40, 60, 0.05)';
    ctx.beginPath();
    ctx.rect(0, 0, size.w, size.h);
    ctx.rect(x, y, w, h);
    ctx.fill('evenodd');
    const accent = getComputedStyle(this.el).getPropertyValue('--accent').trim() || '#2f6fdf';
    ctx.strokeStyle = accent;
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, Math.max(2, w - 1.5), Math.max(2, h - 1.5));
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.el.setPointerCapture(e.pointerId);
    this.frozen = this.thumbBox ? union(this.thumbBox, seenRect(this.r.view, this.r.width, this.r.height)) : null;
    const go = (ev: PointerEvent) => {
      const b = this.canvas.getBoundingClientRect();
      const px = ev.clientX - b.left, py = ev.clientY - b.top;
      const p = { x: (px - this.map.ox) / this.map.k, y: (py - this.map.oy) / this.map.k };
      this.r.view.ox = this.r.width / 2 - p.x * this.r.view.scale;
      this.r.view.oy = this.r.height / 2 - p.y * this.r.view.scale;
      this.hooks.moved();
    };
    go(e);
    const up = () => {
      this.el.removeEventListener('pointermove', go);
      this.el.removeEventListener('pointerup', up);
      this.el.removeEventListener('pointercancel', up);
      this.frozen = null;
      this.key = '';
      this.hooks.moved();
    };
    this.el.addEventListener('pointermove', go);
    this.el.addEventListener('pointerup', up);
    this.el.addEventListener('pointercancel', up);
  }

  /** Where the map sits in the window (CSS px from its top left): a corner, clear of the scroll bars. */
  private where(p: OrientPrefs, size: { w: number; h: number }): Rect {
    const left = p.navCorner === 'tl' || p.navCorner === 'bl', top = p.navCorner === 'tl' || p.navCorner === 'tr';
    const x1 = left ? 10 : this.r.width - 18 - size.w, y1 = top ? 10 : this.r.height - 18 - size.h;
    return { x1, y1, x2: x1 + size.w, y2: y1 + size.h };
  }

  private placed = '';
  private place(p: OrientPrefs, size: { w: number; h: number }): void {
    const b = this.where(p, size);
    const k = `${b.x1},${b.y1}`;
    if (k === this.placed) return;
    this.placed = k;
    this.el.style.transform = `translate(${b.x1}px, ${b.y1}px)`;
  }

  /** Where the map is, to keep the edge arrows off it (null when hidden). */
  box(): Rect | null {
    if (!this.shown) return null;
    const p = this.prefs();
    return this.where(p, NAV_SIZES[p.navSize]);
  }
}

// ---------------------------------------------------------------- arrows at the edge

export interface Target { box: Rect; what: 'structure' | 'text' | 'arrow' | 'shape' }

/** Arrows at the window's edge pointing to things scrolled out of sight. Click one to glide to the nearest of them. */
export class EdgeArrows {
  private layer: HTMLDivElement;
  private pool: HTMLButtonElement[] = [];
  private marks: EdgeMark<Target>[] = [];
  private key = '';

  constructor(host: HTMLElement, private r: OrientView, private moved: () => void) {
    this.layer = document.createElement('div');
    this.layer.className = 'edge-arrows';
    this.layer.setAttribute('aria-hidden', 'true');
    host.append(this.layer);
  }

  /** Called every frame with what there is to point to (null hides the arrows). */
  update(targets: Target[] | null, version: number, avoid: Rect | null): void {
    const { ox, oy, scale } = this.r.view;
    const key = targets ? `${ox}|${oy}|${scale}|${this.r.width}|${this.r.height}|${version}|${targets.length}|${avoid ? `${avoid.x1},${avoid.y1}` : ''}` : 'off';
    if (key === this.key) return;
    this.key = key;
    this.marks = targets ? edgeMarks(targets.map((t) => ({ box: t.box, item: t })), this.r.view, this.r.width, this.r.height, avoid) : [];
    while (this.pool.length < this.marks.length) this.pool.push(this.make());
    this.pool.forEach((b, i) => {
      const m = this.marks[i];
      b.hidden = !m;
      if (!m) return;
      const { x, y } = m;
      b.style.transform = `translate(${x - 11}px, ${y - 11}px)`;
      (b.firstElementChild as HTMLElement).style.transform = `rotate(${m.angle}rad)`;
      const n = m.items.length;
      const count = b.lastElementChild as HTMLElement;
      count.hidden = n < 2;
      count.textContent = n > 99 ? '99+' : String(n);
      b.title = n > 1 ? `${n} things this way: click to go to the nearest` : `${this.name(m.nearest)} this way: click to go to it`;
    });
  }

  private name(t: Target): string {
    return t.what === 'structure' ? 'A structure' : t.what === 'text' ? 'Some text' : t.what === 'arrow' ? 'An arrow' : 'A shape';
  }

  private make(): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'edge-arrow';
    b.tabIndex = -1;
    b.innerHTML = '<svg viewBox="0 0 22 22" aria-hidden="true"><path d="M5 5 17.5 11 5 17 8.5 11Z"/></svg><span class="edge-count" hidden></span>';
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('click', () => {
      const m = this.marks[this.pool.indexOf(b)];
      if (!m) return;
      const t = m.nearest.box;
      glideTo(this.r, { x: (t.x1 + t.x2) / 2, y: (t.y1 + t.y2) / 2 }, this.moved);
    });
    this.layer.append(b);
    return b;
  }
}
