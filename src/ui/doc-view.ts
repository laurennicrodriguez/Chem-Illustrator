// The pages of a document on screen: grey around white pages, one under another, scrolled
// with the scroll bars or the mouse wheel and zoomed with Ctrl+wheel. Only the pages in view
// are drawn. Text is drawn by the same layout the PDF and Word files are made from, with the
// fonts' published widths, so what is on screen is what prints.

import type { Rect } from '../geom';
import { PAGE_GAP, type DocLayout, type PageBox, type PlacedObject } from '../document/doc-layout';
import { SHEET_MARGIN, breaksIn, continuous, outlineMarks, type DocViewKind } from '../document/doc-views';
import type { LaidLine } from '../text/layout';
import type { DocFile } from '../document/doc-file';
import { figures } from '../document/doc-file';
import { drawDocTable, drawHeaderFooter } from '../document/doc-paint';
import { BOX_PAD, SHADOWS, lookOf, type DocText } from '../document/document';
import { drawLayout } from '../text/draw';
import { drawMath } from '../document/math';
import { selectionRects } from '../text/layout';
import { imageFor, onImageReady } from '../render/images';
import { paintChartBox } from '../render/chart-box-paint';

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
  /** The text box being typed into, and its selection (in the document's coordinates). */
  editing?: { id: number; cell?: boolean; selection: Rect[] } | null;
  /** Text with comments on it, shaded (more strongly for the comment being looked at). */
  comments?: { start: number; end: number; active: boolean }[];
}

export class DocView {
  readonly canvas: HTMLCanvasElement;
  readonly scroller: HTMLDivElement;
  private space: HTMLDivElement;
  zoom = ACTUAL;
  /** Room kept to the right of the pages, in pixels (for the comments beside them). */
  gutter = 0;
  private dpr = 1;
  private w = 0;
  private h = 0;
  private queued = false;
  file: DocFile | null = null;
  overlay: () => Overlay = () => ({ selection: null, caret: null, squiggles: [], picked: null, found: [], framed: null });
  /** Called after the view scrolls or zooms (the hidden text field follows the caret). */
  onMove: () => void = () => {};
  /** Called when the view changes size or zoom, before it is laid out for it (Web Layout wraps to the window). */
  onResize: () => void = () => {};
  /** Pages in rows of this many (View > Multiple Pages), or 1. */
  perRow = 1;
  /** Pages side by side in one row, scrolled across (View > Side to Side, and Read Mode). */
  sideways = false;
  /** Read Mode: the wheel turns the pages two at a time instead of scrolling. */
  turnPages: ((dir: 1 | -1) => void) | null = null;
  private wheelSum = 0;
  /** Outline: where each paragraph's level mark was drawn (to fold a heading by clicking it). */
  private marks: { para: number; x: number; y: number }[] = [];

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
      if (this.turnPages && !(e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this.wheelSum += Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
        if (Math.abs(this.wheelSum) >= 60) { this.turnPages(this.wheelSum > 0 ? 1 : -1); this.wheelSum = 0; }
        return;
      }
      // pages side by side: the wheel turns them
      if (this.sideways && !(e.ctrlKey || e.metaKey) && Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        this.scroller.scrollLeft += e.deltaY;
        return;
      }
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

  /** The view the document is shown in (Print Layout unless another is chosen). */
  get kind(): DocViewKind {
    return this.file?.view.kind ?? 'print';
  }

  /** One long sheet with no pages (Web Layout, Outline, Draft). */
  private get endless(): boolean {
    return continuous(this.kind);
  }

  /** Where a page sits in the scrolled area, in points from the top left of the first (before zooming). */
  place(p: PageBox, lay: DocLayout): { x: number; y: number } {
    if (this.endless) return { x: 0, y: p.top };
    const W = lay.pageW + PAGE_GAP, H = lay.pageH + PAGE_GAP;
    if (this.sideways) return { x: p.index * W, y: 0 };
    if (this.perRow > 1) return { x: (p.index % this.perRow) * W, y: Math.floor(p.index / this.perRow) * H };
    return { x: 0, y: p.top };
  }

  /** The size of everything shown, in points: the pages as arranged, or the long sheet down to its last line. */
  private extent(lay: DocLayout): { w: number; h: number } {
    const n = lay.pages.length;
    const W = lay.pageW + PAGE_GAP, H = lay.pageH + PAGE_GAP;
    if (this.endless) {
      let bottom = 0;
      for (const l of lay.text.lines) bottom = Math.max(bottom, l.y + (l.below ?? l.descent));
      for (const o of lay.objects) bottom = Math.max(bottom, o.y + o.h);
      return { w: lay.pageW, h: bottom + SHEET_MARGIN + 0.5 * Math.max(0, this.scroller.clientHeight / this.zoom) };
    }
    if (this.sideways) return { w: n * W - PAGE_GAP, h: lay.pageH };
    if (this.perRow > 1) return { w: Math.min(this.perRow, n) * W - PAGE_GAP, h: Math.ceil(n / this.perRow) * H - PAGE_GAP };
    return { w: lay.pageW, h: lay.pages[n - 1].top + lay.pageH };
  }

  resize(): void {
    const r = this.host.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(1, Math.round(r.width));
    this.h = Math.max(1, Math.round(r.height));
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.canvas.style.width = `${this.w}px`;
    this.canvas.style.height = `${this.h}px`;
    this.onResize();
    this.sizeSpace();
    this.paint();
  }

  /** The scrolled area: every page at this zoom, with grey round them. */
  sizeSpace(): void {
    const lay = this.layout;
    if (!lay) return;
    const e = this.extent(lay);
    const w = e.w * this.zoom + 2 * PAD_X + this.gutter;
    const h = e.h * this.zoom + 2 * PAD_Y;
    this.space.style.width = `${Math.ceil(w)}px`;
    this.space.style.height = `${Math.ceil(h)}px`;
  }

  /** Left edge of the pages in the scrolled area (they sit in the middle when the window is wider). */
  private get ox(): number {
    const lay = this.layout;
    const pw = (lay ? this.extent(lay).w : 612) * this.zoom;
    return Math.max(PAD_X, (this.scroller.clientWidth - this.gutter - pw) / 2);
  }

  /** Top edge of the pages in the scrolled area (pages side by side sit in the middle when the window is taller). */
  private get oy(): number {
    const lay = this.layout;
    if (!lay || !this.sideways || this.endless) return PAD_Y;
    return Math.max(PAD_Y, (this.scroller.clientHeight - lay.pageH * this.zoom) / 2);
  }

  /** The page a point of the document (points) is on. */
  private pageAt(lay: DocLayout, y: number): PageBox {
    let best = lay.pages[0];
    for (const p of lay.pages) if (p.top <= y) best = p;
    return best;
  }

  /** A point of the document (points) on screen (pixels from the view's top left). */
  toScreen(x: number, y: number): { x: number; y: number } {
    const lay = this.layout;
    const p = lay ? this.pageAt(lay, y) : null;
    const pos = lay && p ? this.place(p, lay) : { x: 0, y: 0 };
    const top = p ? p.top : 0;
    return { x: this.ox + (pos.x + x) * this.zoom - this.scroller.scrollLeft, y: this.oy + (pos.y + y - top) * this.zoom - this.scroller.scrollTop };
  }

  /** A point on screen (client coordinates) in the document: on the page nearest it. */
  toDoc(clientX: number, clientY: number): { x: number; y: number } {
    const r = this.scroller.getBoundingClientRect();
    const vx = (clientX - r.left + this.scroller.scrollLeft - this.ox) / this.zoom;
    const vy = (clientY - r.top + this.scroller.scrollTop - this.oy) / this.zoom;
    const lay = this.layout;
    if (!lay || this.endless || (!this.sideways && this.perRow === 1)) return { x: vx, y: vy };
    let best = lay.pages[0], dist = Infinity;
    for (const p of lay.pages) {
      const pos = this.place(p, lay);
      const dx = Math.max(pos.x - vx, 0, vx - pos.x - lay.pageW), dy = Math.max(pos.y - vy, 0, vy - pos.y - lay.pageH);
      const d = dx * dx + dy * dy;
      if (d < dist) { dist = d; best = p; }
    }
    const pos = this.place(best, lay);
    return { x: vx - pos.x, y: vy - pos.y + best.top };
  }

  /** The pages and the room beside them are wider than the view. */
  overflows(): boolean {
    const lay = this.layout;
    return !!lay && this.extent(lay).w * this.zoom + 2 * PAD_X + this.gutter > this.scroller.clientWidth;
  }

  /** Web Layout and Outline: the width of the window, in points, for the text to wrap to. */
  sheetWidth(): number {
    return Math.max(1, this.scroller.clientWidth - this.gutter - 2 * PAD_X - 4) / this.zoom;
  }

  /** The pages' width in points. */
  pageWidth(): number {
    return this.layout?.pageW ?? 612;
  }

  /** Where a stretch of the text is, in the document's coordinates (one box per line). */
  rangeRects(a: number, b: number): Rect[] {
    const lay = this.layout;
    return lay && lay.text.lines.length ? selectionRects(lay.text, a, b) : [];
  }

  /** Zoom, keeping the point under `at` (pixels in the view) where it is. */
  setZoom(z: number, at?: { x: number; y: number }): void {
    z = Math.max(0.1, Math.min(6, z));
    const a = at ?? { x: this.scroller.clientWidth / 2, y: this.scroller.clientHeight / 2 };
    const before = { x: (a.x + this.scroller.scrollLeft - this.ox) / this.zoom, y: (a.y + this.scroller.scrollTop - this.oy) / this.zoom };
    this.zoom = z;
    this.onResize();
    this.sizeSpace();
    this.scroller.scrollLeft = before.x * z + this.ox - a.x;
    this.scroller.scrollTop = before.y * z + this.oy - a.y;
    this.paint();
    this.onMove();
  }

  /** Zoom so a page's width (or the row of pages') fills the window. */
  fitWidth(): void {
    const lay = this.layout;
    if (!lay) return;
    const w = this.sideways ? 2 * lay.pageW + PAGE_GAP : this.extent(lay).w;
    this.setZoom((this.scroller.clientWidth - 2 * PAD_X - 16 - this.gutter) / w);
  }

  /** Zoom so whole pages show: one (One Page), or a row of them (Multiple Pages, Side to Side: two). */
  fitPages(): void {
    const lay = this.layout;
    if (!lay) return;
    const n = this.sideways ? Math.min(2, lay.pages.length) : Math.min(this.perRow, lay.pages.length);
    const w = n * lay.pageW + (n - 1) * PAGE_GAP;
    const kx = (this.scroller.clientWidth - 2 * PAD_X - this.gutter - (this.sideways ? 0 : 16)) / w;
    const ky = (this.scroller.clientHeight - 2 * PAD_Y - (this.sideways ? 16 : 0)) / lay.pageH;
    this.setZoom(Math.min(kx, ky));
  }

  /** Scroll so a part of the document (points) is in view. */
  reveal(r: Rect, margin = 24): void {
    const s = this.scroller;
    const lay = this.layout;
    const p = lay ? this.pageAt(lay, r.y1) : null;
    const pos = lay && p ? this.place(p, lay) : { x: 0, y: 0 };
    const dy = pos.y - (p?.top ?? 0);
    const top = this.oy + (r.y1 + dy) * this.zoom, bottom = this.oy + (r.y2 + dy) * this.zoom;
    if (top - margin < s.scrollTop) s.scrollTop = Math.max(0, top - margin);
    else if (bottom + margin > s.scrollTop + s.clientHeight) s.scrollTop = bottom + margin - s.clientHeight;
    const left = this.ox + (pos.x + r.x1) * this.zoom, right = this.ox + (pos.x + r.x2) * this.zoom;
    if (left - margin < s.scrollLeft) s.scrollLeft = Math.max(0, left - margin);
    else if (right + margin > s.scrollLeft + s.clientWidth) s.scrollLeft = right + margin - s.clientWidth;
  }

  /** Scroll to the top of a page (pages side by side: its left edge). */
  scrollToPage(i: number): void {
    const lay = this.layout;
    if (!lay) return;
    const p = lay.pages[Math.max(0, Math.min(lay.pages.length - 1, i))];
    const pos = this.place(p, lay);
    this.scroller.scrollTop = pos.y * this.zoom;
    if (this.sideways || this.perRow > 1) this.scroller.scrollLeft = pos.x * this.zoom + (this.sideways ? this.ox - PAD_X : 0);
  }

  /** The page in the middle of the view (for "Page 3 of 12"); pages side by side: the first one wholly in view. */
  currentPage(): number {
    const lay = this.layout;
    if (!lay) return 0;
    const k = this.zoom;
    if (this.sideways) {
      const left = (this.scroller.scrollLeft - this.ox) / k;
      for (const p of lay.pages) if (this.place(p, lay).x >= left - 1) return p.index;
      return lay.pages.length - 1;
    }
    const mx = (this.scroller.scrollLeft + this.scroller.clientWidth / 2 - this.ox) / k;
    const my = (this.scroller.scrollTop + this.scroller.clientHeight / 2 - this.oy) / k;
    if (this.endless) return this.pageAt(lay, my).index;
    let best = 0, dist = Infinity;
    for (const p of lay.pages) {
      const pos = this.place(p, lay);
      const dx = Math.max(pos.x - mx, 0, mx - pos.x - lay.pageW), dy = Math.max(pos.y - my, 0, my - pos.y - lay.pageH);
      if (dx * dx + dy * dy < dist) { dist = dx * dx + dy * dy; best = p.index; }
    }
    return best;
  }

  /** The pages in view (pages side by side: those wholly or mostly in view). */
  pagesInView(): number[] {
    const lay = this.layout;
    if (!lay) return [];
    const k = this.zoom, sl = this.scroller.scrollLeft, w = this.scroller.clientWidth;
    return lay.pages.filter((p) => {
      const x = this.ox + this.place(p, lay).x * k - sl;
      return x + lay.pageW * k * 0.5 > 0 && x + lay.pageW * k * 0.5 < w;
    }).map((p) => p.index);
  }

  /** Outline view: the paragraph whose level mark is under a point (client coordinates), if any. */
  markAt(clientX: number, clientY: number): number | null {
    if (this.kind !== 'outline') return null;
    const p = this.toDoc(clientX, clientY);
    const r = 7 / Math.max(this.zoom, 0.5);
    for (const m of this.marks) if (Math.abs(p.x - m.x) <= r && Math.abs(p.y - m.y) <= r) return m.para;
    return null;
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
    const endless = this.endless;
    // the views without pages are white right across
    ctx.fillStyle = endless ? '#fff' : SURROUND;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const file = this.file;
    const lay = this.layout;
    if (!file || !lay) return;
    const t = file.t;
    const k = this.zoom;
    const ox = this.ox - this.scroller.scrollLeft, oy = this.oy - this.scroller.scrollTop;
    const ov = this.overlay();
    // each page drawn where it is placed (one under another, in rows, or side by side)
    const at = (p: PageBox) => {
      const pos = this.place(p, lay);
      ctx.setTransform(d * k, 0, 0, d * k, d * (ox + pos.x * k), d * (oy + (pos.y - p.top) * k));
    };
    const visible = lay.pages.filter((p) => {
      const pos = this.place(p, lay);
      const x = ox + pos.x * k, y = oy + pos.y * k;
      return x < this.w && x + lay.pageW * k > 0 && y < this.h && y + lay.pageH * k > 0;
    });
    ctx.fontKerning = 'none';
    if (!endless) for (const p of visible) { at(p); this.paper(ctx, p, lay); }
    for (const p of visible) {
      at(p);
      if (!endless) drawHeaderFooter(ctx, t, p, lay);
      // the found text and the selection, under the text
      const from = lay.text.lines[p.first]?.start ?? 0;
      const to = p.end > p.first ? lay.text.lines[p.end - 1].end : from;
      const inPage = (a: number, b: number) => b >= from && a <= to;
      for (const c of ov.comments ?? []) {
        if (!inPage(c.start, c.end)) continue;
        ctx.fillStyle = c.active ? 'rgba(232, 160, 40, 0.42)' : 'rgba(240, 190, 90, 0.22)';
        for (const r of rectsOn(lay, p, c.start, c.end)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      ctx.fillStyle = 'rgba(255, 200, 0, 0.45)';
      for (const [a, b] of ov.found) if (inPage(a, b)) for (const r of rectsOn(lay, p, a, b)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      if (ov.selection && inPage(...ov.selection)) {
        ctx.fillStyle = SELECTION;
        for (const r of rectsOn(lay, p, ...ov.selection)) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      // figures behind the text first, then the text, then the rest
      for (const o of lay.objects) if (o.page === p.index && o.wrap === 'behind') this.object(ctx, t, o, lay);
      drawLayout(ctx, lay.text, 0, 0, p.first, p.end);
      // tables, then the figures (some of them in table cells)
      // (a table in a cell after the table holding it)
      const tabs = lay.objects.filter((o) => o.page === p.index && t.objects[o.id]?.kind === 'table').sort((a, b) => (lay.tables.get(a.id)?.depth ?? 0) - (lay.tables.get(b.id)?.depth ?? 0));
      for (const o of tabs) {
        const obj = t.objects[o.id];
        const tb = lay.tables.get(o.id);
        if (obj?.kind === 'table' && tb) drawDocTable(ctx, obj.table, tb, p.index, { color: '#9fb4d8', px: 1 / k });
      }
      for (const o of lay.objects) if (o.page === p.index && o.wrap !== 'behind' && t.objects[o.id]?.kind !== 'table') this.object(ctx, t, o, lay);
      const px = 1 / k;
      for (const s of ov.squiggles) {
        if (!inPage(s.start, s.end)) continue;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 1.1 * px;
        for (const r of rectsOn(lay, p, s.start, s.end)) squiggle(ctx, r, px);
      }
    }
    if (endless) {
      at(lay.pages[0]);
      if (this.kind === 'draft') this.breaks(ctx, t, lay);
      if (this.kind === 'outline') this.outline(ctx, t, lay);
    }
    const onPageOf = (o: PlacedObject) => at(lay.pages[o.page] ?? lay.pages[0]);
    // the picked figure's frame and handle
    if (ov.picked !== null) {
      const o = lay.objects.find((x) => x.id === ov.picked);
      if (o) {
        onPageOf(o);
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
      for (const o of lay.objects) if (o.id === ov.framed) { onPageOf(o); ctx.strokeRect(o.x - 2, o.y - 1, o.w + 4, o.h + 2); }
    }
    if (ov.editing) {
      const o = lay.objects.find((x) => x.id === ov.editing!.id);
      if (o) {
        onPageOf(o);
        ctx.fillStyle = SELECTION;
        for (const r of ov.editing.selection) ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1);
      }
      if (o && !ov.editing.cell) {
        ctx.strokeStyle = OBJECT_FRAME;
        ctx.lineWidth = 1 / k;
        ctx.setLineDash([4 / k, 3 / k]);
        ctx.strokeRect(o.x - 1.5 / k, o.y - 1.5 / k, o.w + 3 / k, o.h + 3 / k);
        ctx.setLineDash([]);
      }
    }
    if (ov.caret) {
      at(this.pageAt(lay, ov.caret.y1));
      ctx.fillStyle = '#000';
      ctx.fillRect(ov.caret.x - 0.6 / k, ov.caret.y1, 1.2 / k, ov.caret.y2 - ov.caret.y1);
    }
  }

  /** Draft: a dotted line, labelled, where a page or column break is. */
  private breaks(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout): void {
    const k = this.zoom;
    for (const b of breaksIn(t)) {
      const top = lay.paraTops[b.para];
      if (!top) continue;
      const y = top.y - 5;
      ctx.strokeStyle = '#8a8f98';
      ctx.lineWidth = 1 / k;
      ctx.setLineDash([2 / k, 2 / k]);
      ctx.beginPath();
      ctx.moveTo(SHEET_MARGIN, y);
      ctx.lineTo(lay.pageW - SHEET_MARGIN, y);
      ctx.stroke();
      ctx.setLineDash([]);
      const label = b.kind === 'page' ? 'Page Break' : 'Column Break';
      ctx.font = `${9 / Math.max(k / ACTUAL, 0.6)}px Arial, sans-serif`;
      const w = ctx.measureText(label).width + 8 / k;
      ctx.fillStyle = '#fff';
      ctx.fillRect(lay.pageW / 2 - w / 2, y - 6 / k, w, 12 / k);
      ctx.fillStyle = '#6b7079';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, lay.pageW / 2, y);
      ctx.textAlign = 'start';
      ctx.textBaseline = 'alphabetic';
    }
  }

  /** Outline: each paragraph's mark at its left (⊕ a heading with text under it, ⊖ one without, a dot for body text), a grey line under a folded heading. */
  private outline(ctx: CanvasRenderingContext2D, t: DocText, lay: DocLayout): void {
    const o = this.file?.view.outline;
    this.marks = [];
    if (!o) return;
    const k = this.zoom;
    const firstLine = new Map<number, LaidLine>();
    for (const l of lay.text.lines) if (!firstLine.has(l.para)) firstLine.set(l.para, l);
    ctx.lineWidth = 1 / k;
    for (const m of outlineMarks(t, o)) {
      const l = firstLine.get(m.para);
      if (!l) continue;
      const r = Math.min(4.5, Math.max(3, l.size * 0.3));
      const x = l.left - 9 - r, y = l.y - l.ascent * 0.38;
      this.marks.push({ para: m.para, x, y });
      ctx.strokeStyle = '#5b6170';
      ctx.fillStyle = '#5b6170';
      if (m.kind === 'body') {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x - r * 0.55, y);
      ctx.lineTo(x + r * 0.55, y);
      if (m.kind !== 'empty') { ctx.moveTo(x, y - r * 0.55); ctx.lineTo(x, y + r * 0.55); }
      ctx.stroke();
      if (m.kind === 'folded') {
        ctx.strokeStyle = '#9aa0aa';
        ctx.lineWidth = 1.5 / k;
        ctx.beginPath();
        ctx.moveTo(l.x, l.y + l.descent + 2);
        ctx.lineTo(l.x + Math.max(l.width, 24), l.y + l.descent + 2);
        ctx.stroke();
        ctx.lineWidth = 1 / k;
      }
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

  private object(ctx: CanvasRenderingContext2D, t: DocText, o: PlacedObject, lay: DocLayout): void {
    const obj = t.objects[o.id];
    if (!obj) return;
    const look = lookOf(obj);
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
    if (obj.kind === 'textbox') {
      if (obj.fill) {
        ctx.fillStyle = obj.fill;
        ctx.fillRect(o.x, o.y, o.w, o.h);
      }
      const bl = lay.boxes.get(o.id);
      if (bl) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(o.x, o.y, o.w, o.h);
        ctx.clip();
        drawLayout(ctx, bl, o.x + BOX_PAD.x, o.y + BOX_PAD.y - bl.box.y1);
        ctx.restore();
      }
    } else if (obj.kind === 'math') {
      const m = lay.maths.get(o.id);
      if (m) drawMath(ctx, m, o.x, o.y + m.ascent, m.family, m.color);
    } else this.figure(ctx, t, o);
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
    } else if (obj.kind === 'picture' && obj.chart) {
      // a chart is drawn from its data, sharp at any zoom
      paintChartBox(ctx, obj.chart, o.x, o.y, o.w, o.h);
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
