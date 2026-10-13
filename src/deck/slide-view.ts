// Drawing whole slides: the slide's background, logo, number and footer from the master, then
// its drawing. The same code draws the slide being edited (under the drawing), the slide list,
// the slide show and PDF pages, so they all look the same.

import { Doc } from '../model';
import { Renderer, withMeasure } from '../render/renderer';
import { imageFor } from '../render/images';
import { VectorContext, VecPath, Item } from '../render/vector';
import { arialWidth } from '../text-metrics';
import { Master, SlideSize, LayoutId, decorFrames, showsNumber } from './deck';

/** Grey around the slide while editing, as in PowerPoint. */
export const SURROUND = '#d5d8de';

/** What a slide's page needs from its deck. */
export interface SlidePage { size: SlideSize; master: Master; layout: LayoutId; index: number }

// Drawing whole slides never draws on screen through the renderer's own canvases.
const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;

/**
 * The slide's background, logo, slide number and footer, in slide points. With `surround`,
 * everything outside the slide is filled with that colour (the grey around the slide).
 */
export function drawSlidePage(ctx: CanvasRenderingContext2D, p: SlidePage, surround: string | null = null): void {
  const { size, master: m } = p;
  if (surround) {
    const far = 1e5;
    ctx.fillStyle = surround;
    ctx.fillRect(-far, -far, 2 * far, far); // above
    ctx.fillRect(-far, size.h, 2 * far, far); // below
    ctx.fillRect(-far, 0, far, size.h); // left
    ctx.fillRect(size.w, 0, far, size.h); // right
  }
  ctx.fillStyle = m.background;
  ctx.fillRect(0, 0, size.w, size.h);
  const d = decorFrames(size, m);
  if (m.logo && d.logo) {
    const box = { x1: d.logo.x1, y1: d.logo.y1, x2: d.logo.x2, y2: d.logo.y2 };
    if ('picture' in ctx) (ctx as unknown as { picture(s: object): void }).picture({ src: m.logo.src, px: m.logo.px, ...box });
    else {
      const img = imageFor(m.logo.src);
      if (img) ctx.drawImage(img, box.x1, box.y1, box.x2 - box.x1, box.y2 - box.y1);
    }
  }
  const text = (s: string, r: { x1: number; y1: number; x2: number; y2: number }, align: 'right' | 'center') => {
    ctx.font = `${m.footerSize}px ${m.bodyFont}, Arial, sans-serif`;
    ctx.fillStyle = m.footerColor;
    const w = ctx.measureText(s).width;
    const x = align === 'right' ? r.x2 - w : (r.x1 + r.x2 - w) / 2;
    ctx.fillText(s, x, (r.y1 + r.y2) / 2 + 0.35 * m.footerSize);
  };
  if (showsNumber(m, p.layout)) text(String(p.index + 1), d.number, 'right');
  if (m.footer.trim()) text(m.footer, d.footer, 'center');
}

/** A whole slide (page and drawing) drawn on `ctx`, which is already scaled to slide points. */
export function drawSlide(ctx: CanvasRenderingContext2D, p: SlidePage, doc: Doc): void {
  drawSlidePage(ctx, p);
  const r = new Renderer(noCanvas, noCanvas);
  r.showWarnings = false;
  r.drawDocument(ctx, doc);
}

/**
 * A whole slide recorded as shapes and text (for PDF pages), in slide points. Text is laid out
 * with Arial's widths, as in the pictures for PowerPoint, to match the PDF's Helvetica.
 */
export function recordSlide(p: SlidePage, doc: Doc): Item[] {
  const ctx = new VectorContext();
  const r = new Renderer(noCanvas, noCanvas);
  r.showWarnings = false;
  r.makePath = () => new VecPath() as unknown as Path2D;
  const c = ctx as unknown as CanvasRenderingContext2D;
  withMeasure((t, s, _font, style) => arialWidth(t, s, /bold/.test(style)), () => {
    drawSlidePage(c, p);
    r.drawDocument(c, doc);
  });
  return ctx.items;
}

/**
 * Paint a slide on a canvas `w` × `h` CSS pixels big, centred with `fill` around it (black
 * for a slide show). Returns where the slide went, in CSS pixels.
 */
export function paintSlide(canvas: HTMLCanvasElement, w: number, h: number, dpr: number, p: SlidePage, doc: Doc, fill: string | null = null): { x: number; y: number; k: number } {
  const pw = Math.max(1, Math.round(w * dpr)), ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, pw, ph);
  } else ctx.clearRect(0, 0, pw, ph);
  const k = Math.min(w / p.size.w, h / p.size.h);
  const x = (w - p.size.w * k) / 2, y = (h - p.size.h * k) / 2;
  ctx.setTransform(k * dpr, 0, 0, k * dpr, x * dpr, y * dpr);
  // nothing spills outside the slide
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, p.size.w, p.size.h);
  ctx.clip();
  drawSlide(ctx, p, doc);
  ctx.restore();
  return { x, y, k };
}
