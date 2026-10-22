// Picture Format: brightness and contrast, sharpening, recolouring, see-through, Remove
// Background and cutting a picture to a shape, as PowerPoint and Word do them. The picture's
// own data stays as it was; what is shown is worked out from it and kept, keyed by the settings,
// so a picture is only worked out again when a setting changes. The pixel work is plain
// functions on RGBA pixels (top row first), so it can be tested without a browser.

import type { BackgroundRemoval, PictureFx, Recolor } from '../model';
import { geoDef, moveSteps, traceSteps } from '../design/geo';
import { dataUrl, imageFor, loadImage } from './images';

type Px = Uint8ClampedArray | Uint8Array;

/** PowerPoint's sepia: black in the shadows to a warm light brown in the highlights. */
export const SEPIA_LIGHT = '#efdcbc';
/** Washout (PowerPoint's): much brighter, much less contrast. */
export const WASHOUT = { bright: 0.7, contrast: -0.7 };
/** How near a colour counts for Remove Background unless chosen. */
export const BG_TOL = 0.12;

/** Settings worth showing: none of them left at their resting value. */
export function tidyFx(fx: PictureFx | undefined): PictureFx | undefined {
  if (!fx) return undefined;
  const out: PictureFx = {};
  const num = (v: number | undefined) => (v !== undefined && Number.isFinite(v) && Math.abs(v) > 1e-4 ? Math.max(-1, Math.min(1, v)) : undefined);
  const b = num(fx.bright), c = num(fx.contrast), s = num(fx.sharpen);
  if (b !== undefined) out.bright = b;
  if (c !== undefined) out.contrast = c;
  if (s !== undefined) out.sharpen = s;
  if (fx.recolor) out.recolor = fx.recolor;
  if (fx.alpha && fx.alpha > 1e-4) out.alpha = Math.min(1, fx.alpha);
  if (fx.clear) out.clear = fx.clear;
  if (fx.bg) out.bg = fx.bg;
  if (fx.shape && fx.shape !== 'rect') out.shape = fx.shape;
  return Object.keys(out).length ? out : undefined;
}

/** True when the picture is shown changed. */
export const hasFx = (fx: PictureFx | undefined): fx is PictureFx => !!tidyFx(fx);

/** The settings PowerPoint and Word keep worked into the picture itself (they can't redo them on the fly). */
export function bakedPart(fx: PictureFx | undefined): PictureFx | undefined {
  return tidyFx(fx && { sharpen: fx.sharpen, bg: fx.bg });
}

// ---------------------------------------------------------------- colours

/** #rrggbb as [r, g, b] (black when it can't be read). */
export function rgbOf(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return [0, 0, 0];
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** Lightness as Office's greyscale works it out. */
const luma = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

// ---------------------------------------------------------------- pixel work

/** Brightness and contrast, in place: contrast stretches round the middle grey, then brightness adds. */
export function brightContrast(d: Px, bright = 0, contrast = 0): void {
  if (!bright && !contrast) return;
  const c = Math.max(-1, Math.min(0.98, contrast));
  const k = Math.tan(((c + 1) * Math.PI) / 4);
  const add = bright * 255;
  const lut = new Uint8ClampedArray(256);
  for (let v = 0; v < 256; v++) lut[v] = clamp255((v - 127.5) * k + 127.5 + add);
  for (let i = 0; i < d.length; i += 4) {
    d[i] = lut[d[i]];
    d[i + 1] = lut[d[i + 1]];
    d[i + 2] = lut[d[i + 2]];
  }
}

/** The colours changed as chosen, in place. */
export function recolor(d: Px, rc: Recolor): void {
  if (rc.kind === 'washout') { brightContrast(d, WASHOUT.bright, WASHOUT.contrast); return; }
  const tint = rc.kind === 'sepia' ? { dark: [0, 0, 0], light: rgbOf(SEPIA_LIGHT) } : rc.kind === 'tint' ? { dark: rgbOf(rc.dark), light: rgbOf(rc.light) } : null;
  const cut = rc.kind === 'bw' ? 255 * (rc.level ?? 0.5) : 0;
  for (let i = 0; i < d.length; i += 4) {
    const y = luma(d[i], d[i + 1], d[i + 2]);
    if (rc.kind === 'grey') {
      d[i] = d[i + 1] = d[i + 2] = y;
    } else if (rc.kind === 'bw') {
      d[i] = d[i + 1] = d[i + 2] = y >= cut ? 255 : 0;
    } else if (tint) {
      const t = y / 255;
      d[i] = tint.dark[0] + (tint.light[0] - tint.dark[0]) * t;
      d[i + 1] = tint.dark[1] + (tint.light[1] - tint.dark[1]) * t;
      d[i + 2] = tint.dark[2] + (tint.light[2] - tint.dark[2]) * t;
    }
  }
}

/** The whole picture made see-through by `amount` (0 to 1), in place. */
export function fade(d: Px, amount: number): void {
  if (amount <= 0) return;
  const k = 1 - Math.min(1, amount);
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] * k;
}

/** One colour (and colours within a few steps of it) made see-through, in place. Returns how many pixels. */
export function clearColour(d: Px, hex: string, tol = 10): number {
  const [r, g, b] = rgbOf(hex);
  let n = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol && d[i + 3]) { d[i + 3] = 0; n++; }
  }
  return n;
}

/** Each colour channel averaged over a 3 × 3 square (edges repeat), into a new array. */
function blur3(d: Px, w: number, h: number): Float32Array {
  const tmp = new Float32Array(d.length), out = new Float32Array(d.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, l = (y * w + Math.max(0, x - 1)) * 4, r = (y * w + Math.min(w - 1, x + 1)) * 4;
      for (let k = 0; k < 3; k++) tmp[i + k] = (d[l + k] + d[i + k] + d[r + k]) / 3;
    }
  }
  for (let y = 0; y < h; y++) {
    const u = Math.max(0, y - 1), v = Math.min(h - 1, y + 1);
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, a = (u * w + x) * 4, b = (v * w + x) * 4;
      for (let k = 0; k < 3; k++) out[i + k] = (tmp[a + k] + tmp[i + k] + tmp[b + k]) / 3;
    }
  }
  return out;
}

/** Sharper (amount up to 1, an unsharp mask) or softer (down to -1, blurred), in place. */
export function sharpen(d: Px, w: number, h: number, amount: number): void {
  if (!amount || w < 2 || h < 2) return;
  let b = blur3(d, w, h);
  if (amount < 0) {
    // softening goes further than one pass of the small blur
    const t = new Uint8ClampedArray(b);
    b = blur3(t, w, h);
  }
  const k = amount > 0 ? amount * 2 : amount;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) d[i + c] = clamp255(d[i + c] + k * (d[i + c] - b[i + c]));
  }
}

/** A part of the picture in pixels: x0, y0 inclusive, x1, y1 exclusive. */
export interface PxRect { x0: number; y0: number; x1: number; y1: number }

/**
 * Remove Background, in place: the colours most common round the edge of `area` (the part of the
 * picture shown) are the background, and every pixel joined to them through colours near them
 * goes; so do those joined to a `drop` mark. Pixels joined to a `keep` mark stay. The edge
 * between what stays and what goes is softened by a pixel. Returns how many pixels went.
 */
export function removeBackground(d: Px, w: number, h: number, bg: BackgroundRemoval, area: PxRect = { x0: 0, y0: 0, x1: w, y1: h }): number {
  const tol = Math.max(0.005, Math.min(1, bg.tol ?? BG_TOL)) * 441.7;
  const x0 = Math.max(0, Math.floor(area.x0)), y0 = Math.max(0, Math.floor(area.y0));
  const x1 = Math.min(w, Math.ceil(area.x1)), y1 = Math.min(h, Math.ceil(area.y1));
  if (x1 - x0 < 1 || y1 - y0 < 1) return 0;
  const near = (i: number, r: number, g: number, b: number) => {
    const dr = d[i * 4] - r, dg = d[i * 4 + 1] - g, db = d[i * 4 + 2] - b;
    return dr * dr + dg * dg + db * db <= tol * tol;
  };
  // marks are fractions of the whole picture (as Office keeps them), kept inside the part shown
  const at = (fx: number, fy: number) => {
    const x = Math.max(x0, Math.min(x1 - 1, Math.floor(fx * w))), y = Math.max(y0, Math.min(y1 - 1, Math.floor(fy * h)));
    return y * w + x;
  };
  const n = w * h;
  // flood from seeds through pixels near each seed's own colour; `mark` says which flood got a pixel
  const flood = (mark: Uint8Array, seeds: number[], stop: Uint8Array | null) => {
    const ref = new Int32Array(n).fill(-1);
    const stack: number[] = [];
    for (const s of seeds) if (!mark[s] && !(stop && stop[s])) { mark[s] = 1; ref[s] = s; stack.push(s); }
    while (stack.length) {
      const i = stack.pop()!;
      const o = ref[i] * 4, r = d[o], g = d[o + 1], b = d[o + 2];
      const x = i % w, y = (i - x) / w;
      const go = (j: number) => {
        if (mark[j] || (stop && stop[j])) return;
        if (d[j * 4 + 3] === 0 || near(j, r, g, b)) { mark[j] = 1; ref[j] = ref[i]; stack.push(j); }
      };
      if (x > x0) go(i - 1);
      if (x < x1 - 1) go(i + 1);
      if (y > y0) go(i - w);
      if (y < y1 - 1) go(i + w);
    }
  };
  const keep = new Uint8Array(n);
  if (bg.keep?.length) flood(keep, bg.keep.map(([fx, fy]) => at(fx, fy)), null);
  // the background's colours: those that cover a good share of the edge
  const edge: number[] = [];
  for (let x = x0; x < x1; x++) { edge.push(y0 * w + x); if (y1 - 1 > y0) edge.push((y1 - 1) * w + x); }
  for (let y = y0 + 1; y < y1 - 1; y++) { edge.push(y * w + x0); if (x1 - 1 > x0) edge.push(y * w + x1 - 1); }
  const bins = new Map<number, number>();
  const bin = (i: number) => (d[i * 4 + 3] < 8 ? -1 : ((d[i * 4] >> 4) << 8) | ((d[i * 4 + 1] >> 4) << 4) | (d[i * 4 + 2] >> 4));
  for (const i of edge) bins.set(bin(i), (bins.get(bin(i)) ?? 0) + 1);
  const common = [...bins].filter(([k, c]) => k >= 0 && c >= edge.length * 0.1).map(([k]) => [((k >> 8) & 15) * 16 + 8, ((k >> 4) & 15) * 16 + 8, (k & 15) * 16 + 8]);
  const seeds = edge.filter((i) => d[i * 4 + 3] < 8 || common.some(([r, g, b]) => near(i, r, g, b)));
  for (const [fx, fy] of bg.drop ?? []) seeds.push(at(fx, fy));
  const gone = new Uint8Array(n);
  flood(gone, seeds, keep);
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (gone[i]) {
        if (d[i * 4 + 3]) count++;
        d[i * 4 + 3] = 0;
      }
    }
  }
  // a soft edge: what stays beside what went is half see-through
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * w + x;
      if (gone[i]) continue;
      const by = (x > x0 && gone[i - 1]) || (x < x1 - 1 && gone[i + 1]) || (y > y0 && gone[i - w]) || (y < y1 - 1 && gone[i + w]);
      if (by) d[i * 4 + 3] = Math.round(d[i * 4 + 3] * 0.6);
    }
  }
  return count;
}

/**
 * Every setting but the shape worked into the pixels, in place, in the order PowerPoint works
 * them: Remove Background and sharpening (kept in the picture), then the see-through colour,
 * brightness and contrast, the new colours and the see-through amount.
 */
export function applyFx(d: Px, w: number, h: number, fx: PictureFx, area?: PxRect, only?: 'baked' | 'live'): void {
  if (only !== 'live') {
    if (fx.bg) removeBackground(d, w, h, fx.bg, area);
    if (fx.sharpen) sharpen(d, w, h, fx.sharpen);
  }
  if (only === 'baked') return;
  if (fx.clear) clearColour(d, fx.clear);
  brightContrast(d, fx.bright ?? 0, fx.contrast ?? 0);
  if (fx.recolor) recolor(d, fx.recolor);
  if (fx.alpha) fade(d, fx.alpha);
}

// ---------------------------------------------------------------- the shapes

/** The shapes a picture can be cut to (Crop to Shape), by PowerPoint's names, with ours for them. */
export const PICTURE_SHAPES: { prst: string; name: string }[] = [
  { prst: 'rect', name: 'Rectangle' },
  { prst: 'roundRect', name: 'Rounded rectangle' },
  { prst: 'ellipse', name: 'Oval' },
  { prst: 'triangle', name: 'Triangle' },
  { prst: 'rtTriangle', name: 'Right triangle' },
  { prst: 'diamond', name: 'Diamond' },
  { prst: 'parallelogram', name: 'Parallelogram' },
  { prst: 'trapezoid', name: 'Trapezoid' },
  { prst: 'pentagon', name: 'Pentagon' },
  { prst: 'hexagon', name: 'Hexagon' },
  { prst: 'octagon', name: 'Octagon' },
  { prst: 'star5', name: 'Star' },
  { prst: 'plus', name: 'Cross' },
  { prst: 'heart', name: 'Heart' },
  { prst: 'cloud', name: 'Cloud' },
  { prst: 'chevron', name: 'Chevron' },
  { prst: 'homePlate', name: 'Pentagon arrow' },
  { prst: 'rightArrow', name: 'Right arrow' },
];

/** The library's shape for one of PowerPoint's preset names (null for a rectangle, or one we don't draw). */
export function shapeDef(prst: string | undefined): ReturnType<typeof geoDef> | null {
  if (!prst || prst === 'rect') return null;
  const def = geoDef(prst);
  return def.prst === prst ? def : null;
}

/** True when a picture can be cut to PowerPoint's preset shape of this name. */
export const knownShape = (prst: string): boolean => prst === 'rect' || !!shapeDef(prst);

/** The outline of the shape a picture is cut to, on a canvas (or anything drawn like one), filling x, y, w, h. */
export function traceShape(ctx: Parameters<typeof traceSteps>[0], prst: string, x: number, y: number, w: number, h: number): boolean {
  const def = shapeDef(prst);
  if (!def) return false;
  traceSteps(ctx, moveSteps(def.draw(w, h).body, x, y));
  return true;
}

// ---------------------------------------------------------------- shown pictures

/** What a picture's showing depends on. */
interface FxPicture { src?: string; fx?: PictureFx; crop?: { l: number; t: number; r: number; b: number }; px?: { w: number; h: number } }

interface Made { canvas: HTMLCanvasElement; url?: string }
/** Pictures worked out, by their data, then by their settings (most recently used last). */
const made = new Map<string, Map<string, Made>>();
let count = 0;
const KEEP = 24;

function keyOf(p: FxPicture, fx: PictureFx): string {
  const c = p.crop;
  return `${JSON.stringify(fx)}|${c ? [c.l, c.t, c.r, c.b].join() : ''}`;
}

/** Biggest side a picture is worked on at (larger ones are shrunk first). */
const MAX_SIDE = 4096;

/** The picture worked out on a new canvas from its loaded image. */
export function makeFxCanvas(img: HTMLImageElement | HTMLCanvasElement | ImageBitmap, p: FxPicture, fx: PictureFx, only?: 'baked' | 'live'): HTMLCanvasElement {
  let iw = (img as HTMLImageElement).naturalWidth || img.width || p.px?.w || 1;
  let ih = (img as HTMLImageElement).naturalHeight || img.height || p.px?.h || 1;
  // a vector picture (SVG) is drawn at its saved pixel size, or twice its own
  if (/^data:image\/(svg|x-emf)/.test(p.src ?? '')) {
    const k = Math.max(1, (p.px?.w ?? iw * 2) / iw);
    iw *= k; ih *= k;
  }
  const k = Math.min(1, MAX_SIDE / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * k)), h = Math.max(1, Math.round(ih * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(img, 0, 0, w, h);
  const cr = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
  const area = { x0: cr.l * w, y0: cr.t * h, x1: (1 - cr.r) * w, y1: (1 - cr.b) * h };
  const data = g.getImageData(0, 0, w, h);
  applyFx(data.data, w, h, fx, area, only);
  g.putImageData(data, 0, 0);
  if (only !== 'baked' && fx.shape && shapeDef(fx.shape)) {
    // cut to the shape: only what is inside its outline (filling the part shown) stays
    g.globalCompositeOperation = 'destination-in';
    g.beginPath();
    traceShape(g, fx.shape, area.x0, area.y0, area.x1 - area.x0, area.y1 - area.y0);
    g.fill();
    g.globalCompositeOperation = 'source-over';
  }
  return c;
}

function find(p: FxPicture, fx: PictureFx): Made | null {
  if (typeof document === 'undefined' || !p.src) return null;
  const key = keyOf(p, fx);
  let mine = made.get(p.src);
  const got = mine?.get(key);
  if (got) {
    // used now: last to be forgotten
    made.delete(p.src);
    made.set(p.src, mine!);
    return got;
  }
  const img = imageFor(p.src);
  if (!img) return null;
  let m: Made;
  try {
    m = { canvas: makeFxCanvas(img, p, fx) };
  } catch {
    return null;
  }
  if (!mine) made.set(p.src, (mine = new Map()));
  mine.set(key, m);
  count++;
  // forget the oldest pictures' versions once there are many (a slider makes one per step)
  if (mine.size > 4) { mine.delete(mine.keys().next().value!); count--; }
  for (const [src, list] of made) {
    if (count <= KEEP || list === mine) break;
    count -= list.size;
    made.delete(src);
  }
  return m;
}

/** The picture as shown (a canvas the same size as its image), or null when it is shown as it is or hasn't loaded. */
export function fxCanvas(p: FxPicture): HTMLCanvasElement | null {
  const fx = tidyFx(p.fx);
  return fx ? find(p, fx)?.canvas ?? null : null;
}

/** The picture as shown, as a PNG data URL (its own data when unchanged or not loaded yet). */
export function fxSrc(p: FxPicture): string | undefined {
  const fx = tidyFx(p.fx);
  if (!fx || !p.src) return p.src;
  const m = find(p, fx);
  if (!m) return p.src;
  m.url ??= m.canvas.toDataURL('image/png');
  return m.url;
}

/** The picture with only the settings `only` says worked in, as PNG bytes, once its image has loaded (null with nothing to do). */
export async function fxPng(p: FxPicture, only?: 'baked' | 'live'): Promise<Uint8Array | null> {
  const fx = only === 'baked' ? bakedPart(p.fx) : tidyFx(p.fx);
  if (!fx || !p.src || typeof document === 'undefined') return null;
  const img = await loadImage(p.src);
  const c = makeFxCanvas(img, p, fx, only);
  const blob = await new Promise<Blob | null>((ok) => c.toBlob(ok, 'image/png'));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

/** The picture as shown, as a data URL, once loaded (for exports, which can wait). */
export async function fxSrcAsync(p: FxPicture): Promise<string | undefined> {
  if (!hasFx(p.fx) || !p.src) return p.src;
  const png = await fxPng(p).catch(() => null);
  return png ? dataUrl(png, 'image/png') : p.src;
}
