// Pictures of a drawing for other programs: the renderer draws into a recording context, and
// the recording becomes an EMF (Word, PowerPoint), an SVG, or a PNG.

import { Doc } from '../model';
import { Renderer, withMeasure } from './renderer';
import { VectorContext, VecPath, Item, itemBounds } from './vector';
import { itemsToEmf, EmfBox } from './emf';
import { itemsToSvg } from './svg';
import { arialWidth } from '../text-metrics';

export interface Picture {
  items: Item[];
  /** The area the picture shows, in points (the drawing plus a small margin). */
  box: EmfBox;
}

// The recording renderer never draws on screen, so it gets stand-in canvases.
const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;

/** Record a drawing as shapes and text. Null when there is nothing to show. */
export function recordPicture(doc: Doc, margin = 2): Picture | null {
  const r = new Renderer(noCanvas, noCanvas);
  r.showWarnings = false;
  r.makePath = () => new VecPath() as unknown as Path2D;
  const ctx = new VectorContext();
  // Word and PowerPoint draw the text in Arial, so lay it out with Arial's widths
  withMeasure((t, s, _font, style) => arialWidth(t, s, /bold/.test(style)), () => r.drawDocument(ctx as unknown as CanvasRenderingContext2D, doc));
  const b = itemBounds(ctx.items);
  if (!b) return null;
  return { items: ctx.items, box: { x1: b.x1 - margin, y1: b.y1 - margin, x2: b.x2 + margin, y2: b.y2 + margin } };
}

export function pictureEmf(p: Picture): Uint8Array {
  return itemsToEmf(p.items, p.box);
}

export function pictureSvg(p: Picture): string {
  return itemsToSvg(p.items, p.box);
}

// Bitmaps are kept below these sizes so a huge drawing does not run the computer out of memory.
const MAX_SIDE = 8000;
const MAX_PIXELS = 12e6;

/**
 * The drawing painted on a canvas at `dpi` dots per inch, or fewer for very large drawings
 * (the resolution used is returned with it). Browser only.
 */
export function pictureCanvas(doc: Doc, p: Picture, dpi = 300): { canvas: HTMLCanvasElement; dpi: number } {
  const pw = p.box.x2 - p.box.x1, ph = p.box.y2 - p.box.y1;
  let k = dpi / 72;
  k = Math.min(k, MAX_SIDE / pw, MAX_SIDE / ph, Math.sqrt(MAX_PIXELS / (pw * ph)));
  const w = Math.max(1, Math.ceil(pw * k)), h = Math.max(1, Math.ceil(ph * k));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, -p.box.x1 * k, -p.box.y1 * k);
  const r = new Renderer(noCanvas, noCanvas);
  r.showWarnings = false;
  withMeasure((t, s, _font, style) => arialWidth(t, s, /bold/.test(style)), () => r.drawDocument(ctx, doc));
  return { canvas, dpi: k * 72 };
}

/** A PNG of a picture canvas, with a transparent background. */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture'))), 'image/png'));
}

/** A Windows bitmap (DIB) of a picture canvas on white, for programs that cannot take EMF or PNG. */
export function canvasDib(canvas: HTMLCanvasElement, dpi: number): Uint8Array {
  const { width: w, height: h } = canvas;
  return rgbaToDib(canvas.getContext('2d')!.getImageData(0, 0, w, h).data, w, h, dpi);
}

/**
 * Pixels (red, green, blue, alpha; top row first) as a 24-bit DIB: a BITMAPINFOHEADER and
 * the rows bottom first, blue-green-red, each padded to four bytes (the published BMP
 * layout). Transparent pixels become white.
 */
export function rgbaToDib(px: ArrayLike<number>, w: number, h: number, dpi: number): Uint8Array {
  const row = (w * 3 + 3) & ~3;
  const out = new Uint8Array(40 + row * h);
  const v = new DataView(out.buffer);
  const ppm = Math.round(dpi / 0.0254);
  v.setUint32(0, 40, true); // header size
  v.setInt32(4, w, true);
  v.setInt32(8, h, true); // positive: bottom row first
  v.setUint16(12, 1, true); // planes
  v.setUint16(14, 24, true); // bits per pixel
  v.setUint32(16, 0, true); // BI_RGB, not compressed
  v.setUint32(20, row * h, true);
  v.setInt32(24, ppm, true);
  v.setInt32(28, ppm, true);
  for (let y = 0; y < h; y++) {
    let o = 40 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = px[i + 3] / 255;
      const mix = (c: number) => Math.round(c * a + 255 * (1 - a));
      out[o++] = mix(px[i + 2]);
      out[o++] = mix(px[i + 1]);
      out[o++] = mix(px[i]);
    }
  }
  return out;
}
