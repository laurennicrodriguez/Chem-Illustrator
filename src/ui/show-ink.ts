// Pointer tools in the slide show and presenter view, as in PowerPoint: the laser pointer (a red
// dot that follows the mouse), the pen and the highlighter (drawing on the slide), the eraser
// (a stroke at a time) and Erase All Ink on Slide. A small bar at the bottom left picks them,
// with the pen's colour; the keys are PowerPoint's: Ctrl+L laser, Ctrl+P pen, Ctrl+I
// highlighter, Ctrl+E eraser, Ctrl+A arrow, E erases the slide's ink. Esc puts the pen down
// (the arrow) before it ends the show.
//
// Ink is kept per slide in the slide's own points, so it stays put when the window changes size.
// At the end of the show the presenter is asked whether to keep it; kept ink becomes shapes on
// the slides (inkShape), which go to PowerPoint as freeforms.

import type { Vec, Rect } from '../geom';
import type { Shape } from '../model';
import { inkId } from '../design/geo';

export type InkTool = 'arrow' | 'laser' | 'pen' | 'highlighter' | 'eraser';

/** A line of ink: drawn with the pen or highlighter, in its colour and width (points), through points on the slide. */
export interface Stroke { tool: 'pen' | 'highlighter'; color: string; width: number; pts: Vec[] }

export const PEN_COLOURS = ['#e53935', '#1e5bd8', '#2e8b57', '#111111', '#ffffff'];
export const HIGHLIGHT_COLOURS = ['#ffeb3b', '#7cf27c', '#5ee0ff', '#ff8ad8'];
const PEN_WIDTH = 2.5, HIGHLIGHT_WIDTH = 14;

/** Points closer together than this (in points) aren't kept, so a line isn't heavier than it need be. */
const STEP = 0.75;

/** A stroke as a shape to keep on the slide (null for one too small to see). */
export function inkShape(s: Stroke): Omit<Shape, 'id'> | null {
  if (!s.pts.length) return null;
  const r = s.width / 2 + 0.5;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of s.pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  const box: Rect = { x1: x1 - r, y1: y1 - r, x2: x2 + r, y2: y2 + r };
  return {
    kind: 'geo', geo: inkId(s.width, s.pts, box), ...box, filled: true, fillColor: s.color, color: s.color, lineWidth: 0,
    ...(s.tool === 'highlighter' ? { transparency: 0.5 } : {}), name: s.tool === 'highlighter' ? 'Highlighter ink' : 'Ink',
  };
}

/** Whether a stroke passes within `tol` points of a point (for the eraser). */
export function strokeNear(s: Stroke, p: Vec, tol: number): boolean {
  const d = tol + s.width / 2;
  for (let i = 0; i < s.pts.length; i++) {
    const a = s.pts[i], b = s.pts[Math.min(s.pts.length - 1, i + 1)];
    const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
    if (Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y) <= d) return true;
  }
  return false;
}

export interface InkHooks {
  /** The slide showing, and where it sits on the canvas (CSS pixels; k pixels per point). */
  slide(): number;
  place(): { x: number; y: number; k: number };
  /** The slide's ink changed (presenter view sends it to the audience). */
  changed?(i: number, strokes: Stroke[]): void;
  /** The laser moved (a point on the slide) or went away (null). */
  laser?(p: Vec | null): void;
}

export class ShowInk {
  tool: InkTool = 'arrow';
  private penColour = PEN_COLOURS[0];
  private highlightColour = HIGHLIGHT_COLOURS[0];
  private ink = new Map<number, Stroke[]>();
  private drawing: Stroke | null = null;
  private laserAt: Vec | null = null;
  private overlay = document.createElement('canvas');
  private bar: HTMLDivElement | null = null;
  private buttons = new Map<string, HTMLButtonElement>();
  private swatches: HTMLDivElement | null = null;

  /** `canvas` is the show's canvas, inside `root`; `controls`: show the tool bar (not in the audience's window). */
  constructor(private root: HTMLElement, private canvas: HTMLCanvasElement, private hooks: InkHooks, controls = true) {
    const o = this.overlay;
    o.className = 'show-ink';
    o.style.position = 'absolute';
    o.style.pointerEvents = 'none';
    o.style.touchAction = 'none';
    canvas.parentElement?.append(o);
    o.addEventListener('pointerdown', (e) => this.down(e));
    o.addEventListener('pointermove', (e) => this.move(e));
    o.addEventListener('pointerup', (e) => this.up(e));
    o.addEventListener('pointercancel', (e) => this.up(e));
    // a click that drew doesn't go on through the show
    o.addEventListener('click', (e) => e.stopPropagation());
    o.addEventListener('pointerleave', () => { if (this.tool === 'laser') this.setLaser(null); });
    // the laser follows the mouse over the slide even when clicks go through to the show
    canvas.parentElement?.addEventListener('pointermove', (e) => { if (this.tool === 'laser') this.setLaser(this.toSlide(e)); });
    if (controls) this.makeBar();
  }

  /** Whether any slide has ink. */
  get any(): boolean { return [...this.ink.values()].some((l) => l.length); }

  /** The ink on every slide, by slide number. */
  all(): Map<number, Stroke[]> { return new Map([...this.ink].filter(([, l]) => l.length)); }

  /** A slide's ink, as sent from the presenter's window. */
  setSlideInk(i: number, strokes: Stroke[]): void {
    this.ink.set(i, strokes);
    this.paint();
  }

  /** The laser where the presenter's is (audience window). */
  showLaser(p: Vec | null): void { this.laserAt = p; this.paint(); }

  /** Pick a tool (as the bar or the keys do). */
  use(tool: InkTool): void {
    this.tool = tool;
    this.drawing = null;
    if (tool !== 'laser') this.setLaser(null);
    const drawing = tool === 'pen' || tool === 'highlighter' || tool === 'eraser';
    this.overlay.style.pointerEvents = drawing ? 'auto' : 'none';
    this.overlay.style.cursor = tool === 'eraser' ? 'cell' : drawing ? 'crosshair' : '';
    this.root.classList.toggle('laser-on', tool === 'laser');
    for (const [k, b] of this.buttons) b.setAttribute('aria-pressed', String(k === tool));
    this.showSwatches();
    this.paint();
  }

  /** Erase All Ink on Slide (E). */
  eraseSlide(): void {
    const i = this.hooks.slide();
    if (!this.ink.get(i)?.length) return;
    this.ink.set(i, []);
    this.hooks.changed?.(i, []);
    this.paint();
  }

  /** A key in the show: true when it was one of the ink tools' keys. */
  key(e: KeyboardEvent): boolean {
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (ctrl && k === 'l') { this.use(this.tool === 'laser' ? 'arrow' : 'laser'); return true; }
    if (ctrl && k === 'p') { this.use('pen'); return true; }
    if (ctrl && k === 'i') { this.use('highlighter'); return true; }
    if (ctrl && k === 'e') { this.use('eraser'); return true; }
    if (ctrl && k === 'a') { this.use('arrow'); return true; }
    if (!ctrl && k === 'e') { this.eraseSlide(); return true; }
    if (e.key === 'Escape' && this.tool !== 'arrow') { this.use('arrow'); return true; }
    return false;
  }

  /** Follow the show canvas's size and position, and draw the slide's ink (after a change of slide or size). */
  paint(): void {
    const o = this.overlay, c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || c.width / dpr, h = c.clientHeight || c.height / dpr;
    o.style.left = `${c.offsetLeft}px`;
    o.style.top = `${c.offsetTop}px`;
    o.style.width = `${w}px`;
    o.style.height = `${h}px`;
    const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
    if (o.width !== pw) o.width = pw;
    if (o.height !== ph) o.height = ph;
    const g = o.getContext('2d');
    if (!g) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, pw, ph);
    const { x, y, k } = this.hooks.place();
    g.setTransform(k * dpr, 0, 0, k * dpr, x * dpr, y * dpr);
    const lines = [...(this.ink.get(this.hooks.slide()) ?? []), ...(this.drawing ? [this.drawing] : [])];
    for (const s of lines) {
      g.save();
      g.lineCap = 'round';
      g.lineJoin = 'round';
      g.strokeStyle = s.color;
      g.fillStyle = s.color;
      g.lineWidth = s.width;
      if (s.tool === 'highlighter') g.globalAlpha = 0.5;
      g.beginPath();
      if (s.pts.length === 1) { g.arc(s.pts[0].x, s.pts[0].y, s.width / 2, 0, Math.PI * 2); g.fill(); }
      else {
        g.moveTo(s.pts[0].x, s.pts[0].y);
        for (const p of s.pts.slice(1)) g.lineTo(p.x, p.y);
        g.stroke();
      }
      g.restore();
    }
    const l = this.laserAt;
    if (l) {
      // a red dot with a glow, the same size whatever the slide's scale
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const px = x + l.x * k, py = y + l.y * k;
      const glow = g.createRadialGradient(px, py, 0, px, py, 14);
      glow.addColorStop(0, 'rgba(255,40,40,0.95)');
      glow.addColorStop(0.35, 'rgba(255,40,40,0.8)');
      glow.addColorStop(1, 'rgba(255,40,40,0)');
      g.fillStyle = glow;
      g.beginPath();
      g.arc(px, py, 14, 0, Math.PI * 2);
      g.fill();
    }
  }

  remove(): void {
    this.overlay.remove();
    this.bar?.remove();
    this.root.classList.remove('laser-on');
  }

  // ---------------------------------------------------------------- drawing

  private toSlide(e: PointerEvent | MouseEvent): Vec {
    const r = this.canvas.getBoundingClientRect();
    const { x, y, k } = this.hooks.place();
    return { x: (e.clientX - r.left - x) / k, y: (e.clientY - r.top - y) / k };
  }

  private setLaser(p: Vec | null): void {
    if (!p && !this.laserAt) return;
    this.laserAt = p;
    this.hooks.laser?.(p);
    this.paint();
  }

  private down(e: PointerEvent): void {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    this.overlay.setPointerCapture?.(e.pointerId);
    const p = this.toSlide(e);
    if (this.tool === 'eraser') { this.erase(p); return; }
    if (this.tool !== 'pen' && this.tool !== 'highlighter') return;
    const hl = this.tool === 'highlighter';
    this.drawing = { tool: this.tool, color: hl ? this.highlightColour : this.penColour, width: hl ? HIGHLIGHT_WIDTH : PEN_WIDTH, pts: [p] };
    this.paint();
  }

  private move(e: PointerEvent): void {
    if (this.tool === 'eraser' && e.buttons & 1) { this.erase(this.toSlide(e)); return; }
    const d = this.drawing;
    if (!d) return;
    const p = this.toSlide(e), last = d.pts[d.pts.length - 1];
    if (Math.hypot(p.x - last.x, p.y - last.y) < STEP) return;
    d.pts.push(p);
    this.paint();
  }

  private up(e: PointerEvent): void {
    e.stopPropagation();
    const d = this.drawing;
    this.drawing = null;
    if (!d) return;
    const i = this.hooks.slide();
    const list = [...(this.ink.get(i) ?? []), d];
    this.ink.set(i, list);
    this.hooks.changed?.(i, list);
    this.paint();
  }

  private erase(p: Vec): void {
    const i = this.hooks.slide();
    const list = this.ink.get(i) ?? [];
    const k = this.hooks.place().k || 1;
    const left = list.filter((s) => !strokeNear(s, p, 6 / k));
    if (left.length === list.length) return;
    this.ink.set(i, left);
    this.hooks.changed?.(i, left);
    this.paint();
  }

  // ---------------------------------------------------------------- the bar

  private makeBar(): void {
    const bar = (this.bar = document.createElement('div'));
    bar.className = 'show-tools';
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Pointer tools');
    const tools: [InkTool | 'erase-all', string, string][] = [
      ['arrow', '➚', 'Arrow: clicks go on through the show (Ctrl+A)'],
      ['laser', '◉', 'Laser pointer: a red dot that follows the mouse (Ctrl+L)'],
      ['pen', '✎', 'Pen: draw on the slide (Ctrl+P)'],
      ['highlighter', '▮', 'Highlighter: mark the slide (Ctrl+I)'],
      ['eraser', '⌫', 'Eraser: click or drag over ink to take it off (Ctrl+E)'],
      ['erase-all', '✕', 'Erase All Ink on Slide (E)'],
    ];
    for (const [id, icon, tip] of tools) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = icon;
      b.title = tip;
      b.setAttribute('aria-label', tip);
      if (id !== 'erase-all') b.setAttribute('aria-pressed', String(id === this.tool));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (id === 'erase-all') this.eraseSlide(); else this.use(id); });
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      if (id !== 'erase-all') this.buttons.set(id, b);
      bar.append(b);
    }
    this.swatches = document.createElement('div');
    this.swatches.className = 'show-swatches';
    bar.append(this.swatches);
    bar.addEventListener('click', (e) => e.stopPropagation());
    bar.addEventListener('contextmenu', (e) => e.stopPropagation());
    this.root.append(bar);
    this.showSwatches();
  }

  private showSwatches(): void {
    const box = this.swatches;
    if (!box) return;
    const hl = this.tool === 'highlighter';
    box.hidden = !(this.tool === 'pen' || hl);
    if (box.hidden) return;
    const cur = hl ? this.highlightColour : this.penColour;
    box.replaceChildren(...(hl ? HIGHLIGHT_COLOURS : PEN_COLOURS).map((c) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'show-swatch';
      b.style.background = c;
      b.title = `Ink colour ${c}`;
      b.setAttribute('aria-label', `Ink colour ${c}`);
      b.setAttribute('aria-pressed', String(c === cur));
      b.addEventListener('click', (e) => { e.stopPropagation(); if (hl) this.highlightColour = c; else this.penColour = c; this.showSwatches(); });
      return b;
    }));
  }
}
