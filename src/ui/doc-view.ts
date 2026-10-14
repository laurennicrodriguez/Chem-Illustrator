// The pages of a document on screen: grey around white pages, one under another, scrolled
// with the scroll bars or the mouse wheel and zoomed with Ctrl+wheel. Only the pages in view
// are drawn. Text is drawn by the same layout the PDF and Word files are made from, with the
// fonts' published widths, so what is on screen is what prints.

import type { Rect } from '../geom';
import type { DocLayout, PageBox, PlacedObject } from '../document/doc-layout';
import type { DocFile } from '../document/doc-file';
import { figures } from '../document/doc-file';
import { drawHeaderFooter } from '../document/doc-paint';
import { SHADOWS, type DocText } from '../document/document';
import { drawLayout } from '../text/draw';
import { selectionRects } from '../text/layout';
import { imageFor, onImageReady } from '../render/images';

/** Grey space round the pages, in pixels. */
const PAD_X = 24;
const PAD_Y = 16;
const SURROUND = '#d5d8de';
const SELECTION = 'rgba(40, 120, 255, 0.25)';
const OBJECT_FRAME = '#2f6fdf';
/** 100%: a point of the page is a point on the screen (96 pixels to the inch). */
export const ACTUAL = 96 / 72;

/** What the view draws over the text: selection, caret, underlines, the chosen figure. */
export interface Overlay {
  selection: [number, number] | null;
  caret: { x: number; y1: number; y2: number } | null;
  squiggles: { start: number; end: number; color: string }[];
  /** The figure or picture picked on its own (framed, with a handle to resize it). */
  picked: number | null;
  /** A bibliography picked on its own (framed on every page it is on). */
  framed: number | null;
  /** Found text to show (find and replace). */
  found: [number, number][];
}

export class DocView {
  readonly canvas: HTMLCanvasElement;
  readonly scroller: HTMLDivElement;
  private space: HTMLDivElement;
  zoom = ACTUAL;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private queued = false;
  file: DocFile | null = null;
  overlay: () => Overlay = () => ({ selection: null, caret: null, squiggles: [], picked: null, found: [], framed: null });
  /** Called after the view scrolls or zooms (the hidden text field follows the caret). */
  onMove: () => void = () => {};

  constructor(readonly host: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'doc-canvas';
    this.scroller = document.createElement('div');
    this.scroller.className = 'doc-scroll';
    this.space = document.createElement('div');
    this.space.className = 'doc-space';
    this.scroller.append(this.space);
    host.append(this.canvas, this.scroller);
    this.scroller.addEventListener('scroll', () => { this.redraw(); this.onMove(); });
    this.scroller.addEventListener('wheel', (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const r = this.scroller.getBoundingClientRect();
      this.setZoom(this.zoom * Math.exp(-e.deltaY * 0.0015), { x: e.clientX - r.left, y: e.clientY - r.top });
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(host);
    onImageReady(() => { if (this.file) this.redraw(); });
  }

  private get layout(): DocLayout | null {
    return this.file ? this.file.layout() : null;
  }

  // ---------------------------------------------------------------- size, scroll and zoom

  resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.sizeSpace();
    this.paint();
  }

  /** The scrolled area: every page at this zoom, with grey round them. */
  sizeSpace(): void {
    const lay = this.layout;
    if (!lay) return;
    const last = lay.pages[lay.pages.length - 1];
    const w = lay.pageW * this.zoom + 2 * PAD_X;
    const h = (last.top + lay.pageH) * this.zoom + 2 * PAD_Y;
    this.space.style.width = `${Math.ceil(w)}px`;
    this.space.style.height = `${Math.ceil(h)}px`;
  }

  /** Left edge of the pages on screen (they sit in the middle when the window is wider). */
  private get ox(): number {
    const lay = this.layout;
    const pw = (lay?.pageW ?? 612) * this.zoom;
    return Math.max(PAD_X, (this.scroller.clientWidth - pw) / 2);
  }

  /** A point of the document (points) on screen (pixels from the view's top left). */
  toScreen(x: number, y: number): { x: number; y: number } {
    return { x: this.ox + x * this.zoom - this.scroller.scrollLeft, y: PAD_Y + y * this.zoom - this.scroller.scrollTop };
  }

  /** A point on screen (client coordinates) in the document. */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.scroller.getBoundingClientRect();
    return { x: (clientX - r.left + this.scroller.scrollLeft - this.ox) / this.zoom, y: (clientY - r.top + this.scroller.scrollTop - PAD_Y) / this.zoom };
  }

  /** Zoom, keeping the point under `at` (pixels in the view) where it is. */
  setZoom(z: number, at?: { x: number; y: number }): void {
    z = Math.max(0.25, Math.min(6, z));
    const a = at ?? { x: this.scroller.clientWidth / 2, y: this.scroller.clientHeight / 2 };
    const before = { x: (a.x + this.scroller.scrollLeft - this.ox) / this.zoom, y: (a.y + this.scroller.scrollTop - PAD_Y) / this.zoom };
    this.zoom = z;
    this.sizeSpace();
    this.scroller.scrollLeft = before.x * z + this.ox - a.x;
    this.scroller.scrollTop = before.y * z + PAD_Y - a.y;
    this.paint();
    this.onMove();
  }

  /** Zoom so a page's width fills the window. */
  fitWidth(): void {
    const lay = this.layout;
    if (!lay) return;
    this.setZoom((this.scroller.clientWidth - 2 * PAD_X - 16) / lay.pageW);
  }

  /** Scroll so a part of the document (points) is in view. */
  reveal(r: Rect, margin = 24): void {
    const s = this.scroller;
    const top = PAD_Y + r.y1 * this.zoom, bottom = PAD_Y + r.y2 * this.zoom;
    if (top - margin < s.scrollTop) s.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > s.scrollTop + s.clientHeight) s.scrollTop = bottom + margin - s.clientHeight;
    const left = this.ox + r.x1 * this.zoom, right = this.ox + r.x2 * this.zoom;
    if (left - margin < s.scrollLeft) s.scrollLeft = Math.max(0, left - margin);
    else if (right + margin > s.scrollLeft + s.clientWidth) s.scrollLeft = right + margin - s.clientWidth;
  }

  /** Scroll to the top of a page. */
  scrollToPage(i: number): void {
    const lay = this.layout;
    if (!lay) return;
    const p = lay.pages[Math.max(0, Math.min(lay.pages.length - 1, i))];
    this.scroller.scrollTop = PAD_Y + p.top * this.zoom - PAD_Y;
  }

  /** The page in the middle of the view (for "Page 3 of 12"). */
  currentPage(): number {
    const lay = this.layout;
    if (!lay) return 0;
    const mid = (this.scroller.scrollTop + this.scroller.clientHeight / 2 - PAD_Y) / this.zoom;
    let best = 0;
    for (const p of lay.pages) if (p.top <= mid) best = p.index;
    return best;
  }

  // ---------------------------------------------------------------- drawing

  redraw(): void {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => {
      this.queued = false;
      this.paint();
    });
  }

  paint(): void {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = SURROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const file = this.file;
    const lay = this.layout;
    if (!file || !lay) return;
    const t = file.t;
    const k = this.zoom;
    const ox = this.ox - this.scroller.scrollLeft, oy = PAD_Y - this.scroller.scrollTop;
    // the part of the document in view, in points
    const top = -oy / k, bottom = (this.h - oy) / k;
    const ov = this.overlay();
    const visible = lay.pages.filter((p) => p.top + lay.pageH >= top && p.top <= bottom);
    ctx.setTransform(d * k, 0, 0, d * k, d * ox, d * oy);
    ctx.fontKerning = 'none';
    for (const p of visible) this.paper(ctx, p, lay);
    for (const p of visible) {
      drawHeaderFooter(ctx, t, p, lay);
      // the found text and the selection, under the text
      const from = lay.text.lines[p.first]?.start ?? 0;
      const to = p.end > p.first ? lay.text.lines[p.end - 1].end : from;
      const inPage = (a: number, b: number) => b >= from && a <= to;
      ctx.fillStyle = 'rgba(255, 200, 0, 0.45)';
      for (const [a, b] of ov.found) if (inPage(a, b)) for (const r of rectsOn(lay, p, a, b)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      if (ov.selection && inPage(...ov.selection)) {
        ctx.fillStyle = SELECTION;
        for (const r of rectsOn(lay, p, ...ov.selection)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      drawLayout(ctx, lay.text, 0, 0, p.first, p.end);
      for (const o of lay.objects) if (o.page === p.index) this.object(ctx, t, o);
      const px = 1 / k;
      for (const s of ov.squiggles) {
        if (!inPage(s.start, s.end)) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.1 * px;
        for (const r of rectsOn(lay, p, s.start, s.end)) squiggle(ctx, r, px);
      }
    }
    // the picked figure's frame and handle
    if (ov.picked !== null) {
      const o = lay.objects.find((x) => x.id === ov.picked);
      if (o) {
        const px = 1 / k;
        ctx.strokeStyle = OBJECT_FRAME;
        ctx.lineWidth = 1.2 * px;
        ctx.strokeRect(o.x, o.y, o.w, o.h);
        ctx.fillStyle = '#fff';
        const hs = 7 * px;
        ctx.fillRect(o.x + o.w - hs / 2, o.y + o.h - hs / 2, hs, hs);
        ctx.strokeRect(o.x + o.w - hs / 2, o.y + o.h - hs / 2, hs, hs);
      }
    }
    if (ov.framed !== null) {
      ctx.strokeStyle = OBJECT_FRAME;
      ctx.lineWidth = 1.2 / k;
      for (const o of lay.objects) if (o.id === ov.framed) ctx.strokeRect(o.x - 2, o.y - 1, o.w + 4, o.h + 2);
    }
    if (ov.caret) {
      ctx.fillStyle = '#000';
      ctx.fillRect(ov.caret.x - 0.6 / k, ov.caret.y1, 1.2 / k, ov.caret.y2 - ov.caret.y1);
    }
  }

  /** A white page with its shadow, and faint corner marks where the text area starts and ends. */
  private paper(ctx: CanvasRenderingContext2D, p: PageBox, lay: DocLayout): void {
    const k = this.zoom;
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.18)';
    ctx.shadowBlur = 4 * this.dpr;
    ctx.shadowOffsetY = 1 * this.dpr;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, p.top, lay.pageW, lay.pageH);
    ctx.restore();
    const t = this.file!.t;
    const x1 = t.page.left, x2 = lay.pageW - t.page.right, y1 = p.top + t.page.top, y2 = p.top + lay.pageH - t.page.bottom;
    const m = 12;
    ctx.strokeStyle = '#c4c8cf';
    ctx.lineWidth = 0.8 / k;
    ctx.beginPath();
    for (const [x, y, sx, sy] of [[x1, y1, -1, -1], [x2, y1, 1, -1], [x1, y2, -1, 1], [x2, y2, 1, 1]] as const) {
      ctx.moveTo(x + sx * m, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * m);
    }
    ctx.stroke();
  }

  private object(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject): void {
    const obj = t.objects[o.id];
    if (!obj) return;
    const look = obj.kind === 'drawing' || obj.kind === 'picture' ? obj.look : undefined;
    if (look?.shadow) {
      // a shadow is a box's: the figure sits on white, and the white casts it
      const s = SHADOWS[look.shadow];
      const k = this.zoom * this.dpr;
      ctx.save();
      ctx.shadowColor = `rgba(0, 0, 0, ${s.alpha})`;
      ctx.shadowBlur = s.blur * k;
      ctx.shadowOffsetX = ctx.shadowOffsetY = s.off * k;
      ctx.fillStyle = '#fff';
      ctx.fillRect(o.x, o.y, o.w, o.h);
      ctx.restore();
    }
    this.figure(ctx, t, o);
    if (look?.frame) {
      ctx.strokeStyle = look.frameColor ?? '#000';
      ctx.lineWidth = look.frame;
      ctx.strokeRect(o.x, o.y, o.w, o.h);
    }
  }

  private figure(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject): void {
    const obj = t.objects[o.id];
    if (!obj) return;
    if (obj.kind === 'drawing') {
      const bmp = figures.bitmap(obj.contents, t.drawingStyle, (o.w / Math.max(1, figures.size(obj.contents, t.drawingStyle).w)) * this.zoom * this.dpr, true);
      if (bmp) ctx.drawImage(bmp, o.x, o.y, o.w, o.h);
    } else if (obj.kind === 'picture') {
      // pictures (EMF spectra from MestReNova too) are decoded once, shared with the drawings
      const img = imageFor(obj.src);
      if (img) ctx.drawImage(img, o.x, o.y, o.w, o.h);
      else {
        ctx.fillStyle = '#eceef2';
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
    }
  }
}

/** Rectangles covering text on one page (only that page's lines are looked at). */
function rectsOn(lay: DocLayout, p: PageBox, a: number, b: number): Rect[] {
  const sub = { ...lay.text, lines: lay.text.lines.slice(p.first, p.end) };
  if (!sub.lines.length) return [];
  return selectionRects(sub, a, b);
}

function squiggle(ctx: CanvasRenderingContext2D, r: Rect, px: number): void {
  const y = r.y2 - (r.y2 - r.y1) * 0.12;
  const step = 2 * px;
  ctx.beginPath();
  for (let x = r.x1, k = 0; x <= r.x2 + 1e-9; x += step, k++) {
    const yy = y + (k % 2 ? step * 0.6 : 0);
    if (k) ctx.lineTo(x, yy); else ctx.moveTo(x, yy);
  }
  ctx.stroke();
}
