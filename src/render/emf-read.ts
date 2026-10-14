// Windows Enhanced Metafiles (EMF) turned into SVG, so pictures pasted from MestReNova, Excel,
// Origin or Office (spectra, charts) stay sharp at any zoom. Written from Microsoft's published
// [MS-EMF] specification: the records are played in order, keeping the drawing state Windows
// keeps (pens, brushes, fonts, the mapping from the picture's units to the page, clipping),
// and each line, shape, piece of text and bitmap becomes SVG.
//
// Skipped: palettes and colour management (they only matter on old screens and printers), and
// EMF+ records. EMF+ sits in comments, and "dual" files, which is what Windows programs write,
// repeat everything as ordinary records, so nothing is lost.

import { zlibSync } from 'fflate';

export interface EmfSvg {
  svg: string;
  /** The picture's size in points (from the file's frame). */
  w: number;
  h: number;
  /** How many lines, shapes and pieces of text it has (0: only bitmaps, a photo rather than a chart). */
  vectors: number;
}

// ---------------------------------------------------------------- small helpers

/** An affine map: x' = a·x + c·y + e, y' = b·x + d·y + f (SVG's order). */
type M = [number, number, number, number, number, number];
const IDENTITY: M = [1, 0, 0, 1, 0, 0];
/** Apply p, then q. */
const mul = (p: M, q: M): M => [
  p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3],
  p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3],
  p[4] * q[0] + p[5] * q[2] + q[4], p[4] * q[1] + p[5] * q[3] + q[5],
];

const num = (v: number): string => String(Math.round(v * 100) / 100);
const esc = (t: string): string => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const colorRef = (v: number): string => '#' + [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff].map((c) => c.toString(16).padStart(2, '0')).join('');

function base64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---------------------------------------------------------------- bitmaps

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A PNG file marked with its resolution (dots per inch), so journals' and Word's checks read it
 * at the size it was made for. The mark goes just after the header, replacing any there.
 */
export function pngWithDpi(png: Uint8Array, dpi: number): Uint8Array {
  if (png.length < 33 || png[1] !== 0x50) return png;
  const dv0 = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const parts: Uint8Array[] = [png.subarray(0, 33)];
  // keep every chunk after IHDR except an old pHYs
  for (let i = 33; i + 12 <= png.length;) {
    const len = dv0.getUint32(i);
    const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
    if (type !== 'pHYs') parts.push(png.subarray(i, i + 12 + len));
    i += 12 + len;
  }
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(21);
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, 9);
  phys.set([0x70, 0x48, 0x59, 0x73], 4);
  dv.setUint32(8, ppm);
  dv.setUint32(12, ppm);
  phys[16] = 1; // metres
  dv.setUint32(17, crc32(phys.subarray(4, 17)));
  parts.splice(1, 0, phys);
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** RGBA pixels as a PNG file. */
export function rgbaToPng(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array): Uint8Array => {
    const out = new Uint8Array(12 + data.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, data.length);
    for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
    out.set(data, 8);
    dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w); dv.setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw)), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

type Bitmap = { kind: 'rgba'; w: number; h: number; rgba: Uint8Array } | { kind: 'file'; mime: string; bytes: Uint8Array };

/** A device-independent bitmap (header, colours, pixels) as RGBA pixels, top row first. */
export function decodeDib(bmi: Uint8Array, bits: Uint8Array): Bitmap | null {
  if (bmi.length < 12) return null;
  const dv = new DataView(bmi.buffer, bmi.byteOffset, bmi.byteLength);
  const size = dv.getUint32(0, true);
  let w: number, h: number, bpp: number, comp = 0, used = 0;
  if (size === 12) {
    w = dv.getUint16(4, true); h = dv.getInt16(6, true); bpp = dv.getUint16(10, true);
  } else {
    if (bmi.length < 40) return null;
    w = dv.getInt32(4, true); h = dv.getInt32(8, true); bpp = dv.getUint16(14, true);
    comp = dv.getUint32(16, true); used = dv.getUint32(32, true);
  }
  if (comp === 4) return { kind: 'file', mime: 'image/jpeg', bytes: bits };
  if (comp === 5) return { kind: 'file', mime: 'image/png', bytes: bits };
  if (w <= 0 || h === 0 || w * Math.abs(h) > 64e6 || (comp !== 0 && comp !== 3)) return null;
  const topDown = h < 0;
  h = Math.abs(h);
  // colours (for 1, 4 and 8 bits per pixel) or the bit masks (BI_BITFIELDS)
  const tableAt = size;
  const palette: number[][] = [];
  if (bpp <= 8) {
    const n = used || 1 << bpp;
    const step = size === 12 ? 3 : 4;
    for (let i = 0; i < n && tableAt + i * step + 2 < bmi.length; i++) {
      const o = tableAt + i * step;
      palette.push([bmi[o + 2], bmi[o + 1], bmi[o]]);
    }
  }
  let masks = bpp === 16 ? [0x7c00, 0x03e0, 0x001f] : [0xff0000, 0xff00, 0xff];
  if (comp === 3) {
    const at = size >= 52 ? 40 : size;
    if (at + 12 <= bmi.length) masks = [dv.getUint32(at, true), dv.getUint32(at + 4, true), dv.getUint32(at + 8, true)];
  }
  const shift = (m: number) => { let s = 0; while (m && !((m >>> s) & 1)) s++; return s; };
  const scale = (m: number) => { const top = m >>> shift(m); return top ? 255 / top : 0; };
  const ms = masks.map(shift), mk = masks.map(scale);
  const stride = ((w * bpp + 31) >>> 5) * 4;
  if (bits.length < stride * (h - 1) + Math.ceil((w * bpp) / 8)) return null;
  const bdv = new DataView(bits.buffer, bits.byteOffset, bits.byteLength);
  const rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const row = (topDown ? y : h - 1 - y) * stride;
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      let r = 0, g = 0, b = 0;
      if (bpp <= 8) {
        const bit = x * bpp;
        const byte = bits[row + (bit >>> 3)];
        const idx = (byte >>> (8 - bpp - (bit & 7))) & ((1 << bpp) - 1);
        [r, g, b] = palette[idx] ?? [idx ? 255 : 0, idx ? 255 : 0, idx ? 255 : 0];
      } else if (bpp === 24) {
        const p = row + x * 3;
        b = bits[p]; g = bits[p + 1]; r = bits[p + 2];
      } else if (bpp === 16 || bpp === 32) {
        const v = bpp === 16 ? bdv.getUint16(row + x * 2, true) : bdv.getUint32(row + x * 4, true);
        r = Math.round(((v & masks[0]) >>> ms[0]) * mk[0]);
        g = Math.round(((v & masks[1]) >>> ms[1]) * mk[1]);
        b = Math.round(((v & masks[2]) >>> ms[2]) * mk[2]);
      } else return null;
      rgba[o] = r; rgba[o + 1] = g; rgba[o + 2] = b; rgba[o + 3] = 255;
    }
  }
  return { kind: 'rgba', w, h, rgba };
}

// ---------------------------------------------------------------- drawing state

interface Pen { style: number; width: number; color: string; cosmetic: boolean; dashes: number[] }
interface Brush { color: string | null; opacity: number }
interface Font { height: number; weight: number; italic: boolean; underline: boolean; strike: boolean; escapement: number; face: string }
type Obj = { kind: 'pen'; pen: Pen } | { kind: 'brush'; brush: Brush } | { kind: 'font'; font: Font };

interface State {
  pen: Pen; brush: Brush; font: Font;
  textColor: string; bkColor: string; bkOpaque: boolean; fillRule: 'evenodd' | 'nonzero'; textAlign: number;
  mapMode: number; wOrg: [number, number]; wExt: [number, number]; vOrg: [number, number]; vExt: [number, number];
  world: M; clip: string | null; metaClip: string | null; arcClockwise: boolean; miter: number;
}

const BLACK_PEN: Pen = { style: 0, width: 0, color: '#000000', cosmetic: true, dashes: [] };
const NULL_PEN: Pen = { style: 5, width: 0, color: '#000000', cosmetic: true, dashes: [] };
const STOCK: Record<number, Obj> = {
  0: { kind: 'brush', brush: { color: '#ffffff', opacity: 1 } },
  1: { kind: 'brush', brush: { color: '#c0c0c0', opacity: 1 } },
  2: { kind: 'brush', brush: { color: '#808080', opacity: 1 } },
  3: { kind: 'brush', brush: { color: '#404040', opacity: 1 } },
  4: { kind: 'brush', brush: { color: '#000000', opacity: 1 } },
  5: { kind: 'brush', brush: { color: null, opacity: 1 } },
  6: { kind: 'pen', pen: { ...BLACK_PEN, color: '#ffffff' } },
  7: { kind: 'pen', pen: BLACK_PEN },
  8: { kind: 'pen', pen: NULL_PEN },
  18: { kind: 'brush', brush: { color: '#ffffff', opacity: 1 } },
  19: { kind: 'pen', pen: BLACK_PEN },
};
const SYSTEM_FONT: Font = { height: -16, weight: 700, italic: false, underline: false, strike: false, escapement: 0, face: 'Arial' };

// Symbol font letters (Windows puts them at U+F020–U+F0FF) as the Unicode characters they show.
const SYMBOL_LETTERS = 'ΑΒΧΔΕΦΓΗΙϑΚΛΜΝΟΠΘΡΣΤΥςΩΞΨΖ';
const symbolChar = (c: number): string => {
  const k = c >= 0xf000 ? c - 0xf000 : c;
  if (k >= 0x41 && k <= 0x5a) return SYMBOL_LETTERS[k - 0x41];
  if (k >= 0x61 && k <= 0x7a) return 'αβχδεφγηιϕκλμνοπθρστυϖωξψζ'[k - 0x61];
  const more: Record<number, string> = { 0xb0: '°', 0xb1: '±', 0xb4: '×', 0xb8: '÷', 0xae: '→', 0xac: '←', 0xad: '↑', 0xaf: '↓', 0xab: '↔', 0xa3: '≤', 0xb3: '≥', 0xb9: '≠', 0xbb: '≈', 0xa5: '∞', 0xb6: '∂', 0xd6: '√', 0xe5: '∑' };
  return more[k] ?? String.fromCharCode(k);
};

// ---------------------------------------------------------------- the player

/** An EMF file as an SVG picture, or null when it isn't one or holds nothing that can be drawn. */
export function emfToSvg(bytes: Uint8Array): EmfSvg | null {
  if (bytes.length < 88) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (dv.getUint32(0, true) !== 1 || dv.getUint32(40, true) !== 0x464d4520) return null;
  const i32 = (o: number) => dv.getInt32(o, true);
  const u32 = (o: number) => dv.getUint32(o, true);
  const headerSize = u32(4);

  // the reference device: pixels per millimetre, from its size (in micrometres when given)
  let pxmmX = i32(72) / Math.max(1, i32(80)), pxmmY = i32(76) / Math.max(1, i32(84));
  if (headerSize >= 108 && u32(100) > 0 && u32(104) > 0) { pxmmX = i32(72) / (u32(100) / 1000); pxmmY = i32(76) / (u32(104) / 1000); }
  if (!(pxmmX > 0) || !(pxmmY > 0)) { pxmmX = pxmmY = 96 / 25.4; }
  // the picture's area: its frame (hundredths of a millimetre), or else its bounds (pixels)
  let fx = (i32(24) * pxmmX) / 100, fy = (i32(28) * pxmmY) / 100;
  let fw = ((i32(32) - i32(24)) * pxmmX) / 100, fh = ((i32(36) - i32(28)) * pxmmY) / 100;
  if (!(fw > 0 && fh > 0)) { fx = i32(8); fy = i32(12); fw = i32(16) - i32(8) + 1; fh = i32(20) - i32(12) + 1; }
  if (!(fw > 0 && fh > 0)) return null;
  const pxPerPt = ((pxmmX + pxmmY) / 2) * (25.4 / 72);
  const hairline = Math.max(1, 0.5 * pxPerPt);

  let s: State = {
    pen: BLACK_PEN, brush: { color: '#ffffff', opacity: 1 }, font: SYSTEM_FONT,
    textColor: '#000000', bkColor: '#ffffff', bkOpaque: true, fillRule: 'evenodd', textAlign: 0,
    mapMode: 1, wOrg: [0, 0], wExt: [1, 1], vOrg: [0, 0], vExt: [1, 1], world: IDENTITY, clip: null, metaClip: null,
    arcClockwise: false, miter: 10,
  };
  const saved: State[] = [];
  const objects = new Map<number, Obj>();
  const defs: string[] = [];
  const body: string[] = [];
  let clipIds = 0;
  let drawn = 0, images = 0;
  let openClip: string | null = null;

  // logical units → page → device
  let T: M = IDENTITY;
  const update = () => {
    let sx = 1, sy = 1;
    const fixed: Record<number, number> = { 2: 0.1, 3: 0.01, 4: 0.254, 5: 0.0254, 6: 25.4 / 1440 };
    if (fixed[s.mapMode]) { sx = fixed[s.mapMode] * pxmmX; sy = -fixed[s.mapMode] * pxmmY; }
    else if (s.mapMode === 7 || s.mapMode === 8) {
      sx = s.vExt[0] / (s.wExt[0] || 1); sy = s.vExt[1] / (s.wExt[1] || 1);
      if (s.mapMode === 7) { const k = Math.min(Math.abs(sx), Math.abs(sy)); sx = Math.sign(sx) * k; sy = Math.sign(sy) * k; }
    }
    const page: M = [sx, 0, 0, sy, s.vOrg[0] - s.wOrg[0] * sx, s.vOrg[1] - s.wOrg[1] * sy];
    T = mul(s.world, page);
  };
  update();
  const X = (x: number, y: number) => T[0] * x + T[2] * y + T[4];
  const Y = (x: number, y: number) => T[1] * x + T[3] * y + T[5];
  const P = (x: number, y: number) => `${num(X(x, y))} ${num(Y(x, y))}`;
  const scaleOf = () => Math.sqrt(Math.abs(T[0] * T[3] - T[1] * T[2])) || 1;

  // ---- output, grouped by clipping; strokes in the same style are joined into one path
  let pending: { attrs: string; clip: string | null; d: string[] } | null = null;
  const flush = () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    put(`<path d="${p.d.join('')}" ${p.attrs}/>`, p.clip);
  };
  const put = (el: string, clip = s.clip) => {
    if (pending) flush();
    if (clip !== openClip) {
      if (openClip) body.push('</g>');
      if (clip) body.push(`<g clip-path="url(#${clip})">`);
      openClip = clip;
    }
    body.push(el);
    drawn++;
  };

  const strokeAttrs = (pen: Pen): string | null => {
    if (pen.style === 5) return null;
    // thin (cosmetic) pens draw as hairlines; others as wide as asked, but never vanishing
    const width = pen.cosmetic ? hairline : Math.max(0.25 * pxPerPt, pen.width * scaleOf());
    const cap = pen.style & 0x0f00, join = pen.style & 0xf000, kind = pen.style & 0x0f;
    let dash = '';
    // Windows' dashes: in pixels for thin (cosmetic) pens, in pen widths for wide ones
    const pattern: Record<number, number[]> = pen.cosmetic
      ? { 1: [18, 6], 2: [3, 3], 3: [9, 6, 3, 6], 4: [9, 3, 3, 3, 3, 3] }
      : { 1: [3, 1], 2: [1, 1], 3: [3, 1, 1, 1], 4: [3, 1, 1, 1, 1, 1] };
    if (kind === 7 && pen.dashes.length) dash = pen.dashes.map((v) => num(Math.max(0.5, v * (pen.cosmetic ? hairline : scaleOf())))).join(' ');
    else if (pattern[kind]) dash = pattern[kind].map((v) => num(v * width)).join(' ');
    return `fill="none" stroke="${pen.color}" stroke-width="${num(width)}"` +
      ` stroke-linecap="${cap === 0x100 ? 'square' : cap === 0x200 ? 'butt' : 'round'}"` +
      ` stroke-linejoin="${join === 0x1000 ? 'bevel' : join === 0x2000 ? 'miter' : 'round'}"` +
      (join === 0x2000 ? ` stroke-miterlimit="${num(Math.max(1, s.miter))}"` : '') + (dash ? ` stroke-dasharray="${dash}"` : '');
  };
  const stroke = (d: string) => {
    const attrs = strokeAttrs(s.pen);
    if (!attrs || !d) return;
    if (pending && pending.attrs === attrs && pending.clip === s.clip && pending.d.length < 4000) { pending.d.push(d); return; }
    flush();
    pending = { attrs, clip: s.clip, d: [d] };
  };
  const fill = (d: string, brush = s.brush) => {
    if (!brush.color || !d) return;
    put(`<path d="${d}" fill="${brush.color}"${brush.opacity < 1 ? ` fill-opacity="${brush.opacity}"` : ''} fill-rule="${s.fillRule}"/>`);
  };
  const fillStroke = (d: string) => { fill(d); stroke(d); };

  // ---- clipping: each new clip is the old one narrowed (an SVG clipPath clipped by the last)
  const addClip = (d: string, rule: 'nonzero' | 'evenodd' = 'nonzero', from = s.clip): string => {
    const id = `emfclip${++clipIds}`;
    defs.push(`<clipPath id="${id}"${from ? ` clip-path="url(#${from})"` : ''}><path d="${d}" clip-rule="${rule}"/></clipPath>`);
    return id;
  };
  const rectPath = (l: number, t: number, r: number, b: number) => `M${P(l, t)}L${P(r, t)}L${P(r, b)}L${P(l, b)}Z`;
  const deviceRect = (l: number, t: number, r: number, b: number) => `M${num(l)} ${num(t)}L${num(r)} ${num(t)}L${num(r)} ${num(b)}L${num(l)} ${num(b)}Z`;

  // ---- the path being built between BeginPath and EndPath, and the current position
  let inPath = false;
  let path: string[] = [];
  let cp: [number, number] = [0, 0];
  const lineFrom = (pts: [number, number][], start: [number, number] | null): string => {
    if (!pts.length) return '';
    let d = start ? `M${P(start[0], start[1])}` : '';
    pts.forEach(([x, y], i) => { d += (i === 0 && !start ? 'M' : 'L') + P(x, y); });
    return d;
  };
  const bezierFrom = (pts: [number, number][], start: [number, number]): string => {
    let d = `M${P(start[0], start[1])}`;
    for (let i = 0; i + 2 < pts.length; i += 3) d += `C${P(...pts[i])} ${P(...pts[i + 1])} ${P(...pts[i + 2])}`;
    return d;
  };
  /** Draw (or add to the path) an open figure. */
  const openFigure = (d: string) => { if (inPath) path.push(d); else stroke(d); };
  /** Draw (or add to the path) a closed, filled figure. */
  const closedFigure = (d: string) => { if (inPath) path.push(d + 'Z'); else fillStroke(d + 'Z'); };
  /** Continue the figure from the current position (LineTo, PolylineTo, PolyBezierTo). */
  const continueFigure = (d: string) => {
    if (inPath) {
      // the path already stands at the current position unless this starts it
      const last = path[path.length - 1];
      path.push(last === undefined || /Z$/.test(last) ? d : d.replace(/^M[^LC]*/, ''));
    } else stroke(d);
  };

  const points = (o: number, n: number, short: boolean): [number, number][] => {
    const out: [number, number][] = [];
    const step = short ? 4 : 8;
    for (let i = 0; i < n && o + i * step + step <= bytes.length; i++) {
      const p = o + i * step;
      out.push(short ? [dv.getInt16(p, true), dv.getInt16(p + 2, true)] : [i32(p), i32(p + 4)]);
    }
    return out;
  };

  // ellipses and arcs, as curves in the picture's own units (so any transform keeps them exact)
  const K = 0.5522847498;
  const ellipse = (l: number, t: number, r: number, b: number): string => {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
    return `M${P(cx + rx, cy)}` +
      `C${P(cx + rx, cy + K * ry)} ${P(cx + K * rx, cy + ry)} ${P(cx, cy + ry)}` +
      `C${P(cx - K * rx, cy + ry)} ${P(cx - rx, cy + K * ry)} ${P(cx - rx, cy)}` +
      `C${P(cx - rx, cy - K * ry)} ${P(cx - K * rx, cy - ry)} ${P(cx, cy - ry)}` +
      `C${P(cx + K * rx, cy - ry)} ${P(cx + rx, cy - K * ry)} ${P(cx + rx, cy)}Z`;
  };
  /** Points along an arc of the ellipse in box l,t,r,b from the ray through (x1,y1) to the ray through (x2,y2). */
  const arcPoints = (l: number, t: number, r: number, b: number, x1: number, y1: number, x2: number, y2: number): [number, number][] => {
    const cx = (l + r) / 2, cy = (t + b) / 2, rx = Math.abs(r - l) / 2, ry = Math.abs(b - t) / 2;
    const a1 = Math.atan2((y1 - cy) / (ry || 1), (x1 - cx) / (rx || 1));
    let a2 = Math.atan2((y2 - cy) / (ry || 1), (x2 - cx) / (rx || 1));
    // counter-clockwise as seen on the page: decreasing angle when y runs down the page
    const flipped = T[0] * T[3] - T[1] * T[2] < 0;
    const down = s.arcClockwise !== flipped;
    if (down) { while (a2 <= a1) a2 += 2 * Math.PI; } else { while (a2 >= a1) a2 -= 2 * Math.PI; }
    const n = Math.max(4, Math.ceil((Math.abs(a2 - a1) / (2 * Math.PI)) * 72));
    const out: [number, number][] = [];
    for (let i = 0; i <= n; i++) {
      const a = a1 + ((a2 - a1) * i) / n;
      out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
    }
    return out;
  };

  // ---- pictures
  const ROP = { SRCCOPY: 0xcc0020, SRCAND: 0x8800c6, SRCPAINT: 0xee0086, SRCINVERT: 0x660046, NOTSRCCOPY: 0x330008, PATCOPY: 0xf00021, BLACKNESS: 0x42, WHITENESS: 0xff0062 };
  const bitmap = (off: number, bmiOff: number, bmiSize: number, bitsOff: number, bitsSize: number, rop: number,
    dest: [number, number, number, number], src: [number, number, number, number]) => {
    const [dx, dy, dw, dh] = dest;
    if (!bmiSize) {
      // no bitmap: fill the area with the brush, black or white
      const area = rectPath(dx, dy, dx + dw, dy + dh);
      if (rop === ROP.BLACKNESS) fill(area, { color: '#000000', opacity: 1 });
      else if (rop === ROP.WHITENESS) fill(area, { color: '#ffffff', opacity: 1 });
      else if (rop === ROP.PATCOPY) fill(area);
      return;
    }
    const bmi = bytes.subarray(off + bmiOff, off + bmiOff + bmiSize), bits = bytes.subarray(off + bitsOff, off + bitsOff + bitsSize);
    const dib = decodeDib(bmi, bits);
    if (!dib) return;
    let href: string;
    if (dib.kind === 'file') href = `data:${dib.mime};base64,${base64(dib.bytes)}`;
    else {
      // the part of the bitmap that is drawn (rows counted from the bottom, as Windows does)
      const [sx, sy, sw, sh] = src;
      let { w, h, rgba } = dib;
      const x0 = Math.max(0, Math.min(w, sx)), w2 = Math.max(1, Math.min(w - x0, sw || w));
      const y0 = Math.max(0, Math.min(h, h - sy - (sh || h))), h2 = Math.max(1, Math.min(h - y0, sh || h));
      if (x0 || y0 || w2 !== w || h2 !== h) {
        const part = new Uint8Array(w2 * h2 * 4);
        for (let y = 0; y < h2; y++) part.set(rgba.subarray(((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + w2) * 4), y * w2 * 4);
        rgba = part; w = w2; h = h2;
      }
      // masks and inverted copies: white does nothing when ANDed, black nothing when ORed
      if (rop === ROP.SRCAND || rop === ROP.SRCPAINT || rop === ROP.SRCINVERT || rop === ROP.NOTSRCCOPY) {
        const blank = rop === ROP.SRCAND ? 255 : 0;
        for (let i = 0; i < rgba.length; i += 4) {
          if (rop === ROP.NOTSRCCOPY) { rgba[i] = 255 - rgba[i]; rgba[i + 1] = 255 - rgba[i + 1]; rgba[i + 2] = 255 - rgba[i + 2]; continue; }
          if (rgba[i] === blank && rgba[i + 1] === blank && rgba[i + 2] === blank) rgba[i + 3] = 0;
        }
      }
      href = `data:image/png;base64,${base64(rgbaToPng(rgba, w, h))}`;
    }
    // the unit square mapped onto the destination
    const m = mul([dw, 0, 0, dh, dx, dy], T);
    put(`<image width="1" height="1" preserveAspectRatio="none" transform="matrix(${m.map(num).join(' ')})" href="${href}"/>`);
    images++;
  };

  // ---- text
  const text = (o: number, wide: boolean) => {
    const ref: [number, number] = [i32(o + 36), i32(o + 40)];
    const n = u32(o + 44), offString = u32(o + 48), options = u32(o + 52), offDx = u32(o + 72);
    if (!n || options & 0x10) return; // glyph numbers, not characters: the font file would be needed
    const codes: number[] = [];
    for (let i = 0; i < n; i++) {
      const p = o + offString + (wide ? i * 2 : i);
      if (p + (wide ? 2 : 1) > bytes.length) break;
      codes.push(wide ? dv.getUint16(p, true) : bytes[p]);
    }
    const pdy = (options & 0x2000) !== 0;
    const dx: number[] = [];
    if (offDx) for (let i = 0; i < codes.length; i++) {
      const p = o + offDx + i * (pdy ? 8 : 4);
      if (p + 4 > bytes.length) break;
      dx.push(i32(p));
    }
    const f = s.font;
    const symbol = /^symbol$/i.test(f.face);
    // characters (joining surrogate pairs), each with its advance
    const chars: string[] = [], adv: number[] = [];
    for (let i = 0; i < codes.length; i++) {
      let c = codes[i];
      if (c === 0) continue;
      let d = dx[i] ?? 0;
      if (wide && c >= 0xd800 && c < 0xdc00 && i + 1 < codes.length) { c = 0x10000 + ((c - 0xd800) << 10) + (codes[i + 1] - 0xdc00); d += dx[i + 1] ?? 0; i++; }
      const ch = symbol ? symbolChar(c) : wide ? String.fromCodePoint(c) : c >= 0x80 && c < 0xa0 ? String.fromCharCode(WIN1252[c - 0x80] ?? c) : String.fromCharCode(c);
      chars.push(ch < ' ' ? ' ' : ch);
      adv.push(d);
    }
    if (!chars.length) return;
    const em = (f.height < 0 ? -f.height : f.height > 0 ? f.height * 0.9 : 12);
    const sxLen = Math.hypot(T[0], T[1]) || 1, syLen = Math.hypot(T[2], T[3]) || 1;
    const size = em * syLen;
    const at: [number, number] = s.textAlign & 1 ? cp : ref;
    const px = X(at[0], at[1]), py = Y(at[0], at[1]);
    const angle = Math.atan2(T[1], T[0]) * (180 / Math.PI) - f.escapement / 10;
    const hasDx = dx.length > 0;
    const total = hasDx ? adv.reduce((a, b) => a + b, 0) * sxLen : chars.length * size * 0.55;
    const h = s.textAlign & 6;
    const start = h === 6 ? -total / 2 : h === 2 ? -total : 0;
    const v = s.textAlign & 24;
    const base = v === 24 ? 0 : v === 8 ? -0.212 * size : 0.905 * size;
    const tf = `translate(${num(px)} ${num(py)})${Math.abs(angle) > 0.01 ? ` rotate(${num(angle)})` : ''}`;
    if (options & 0x2) {
      // opaque: the given rectangle filled with the background colour first
      const r = [i32(o + 56), i32(o + 60), i32(o + 64), i32(o + 68)];
      if (r[2] > r[0] && r[3] > r[1]) fill(rectPath(r[0], r[1], r[2], r[3]), { color: s.bkColor, opacity: 1 });
    } else if (s.bkOpaque) {
      put(`<rect transform="${tf}" x="${num(start)}" y="${num(base - 0.905 * size)}" width="${num(total)}" height="${num(1.117 * size)}" fill="${s.bkColor}"/>`);
    }
    let xs = '';
    if (hasDx) {
      let x = start;
      xs = chars.map((_, i) => { const v = num(x); x += adv[i] * sxLen; return v; }).join(' ');
    }
    const anchor = hasDx || h === 0 ? '' : ` text-anchor="${h === 6 ? 'middle' : 'end'}"`;
    const deco = [f.underline ? 'underline' : '', f.strike ? 'line-through' : ''].filter(Boolean).join(' ');
    const family = [...new Set([symbol ? 'Arial' : f.face || 'Arial', 'Arial', 'Helvetica', 'sans-serif'])].join(', ');
    put(`<text transform="${tf}" x="${hasDx ? xs : num(start)}" y="${num(base)}" font-family="${esc(family)}"` +
      ` font-size="${num(size)}"${f.weight >= 600 ? ' font-weight="bold"' : ''}${f.italic ? ' font-style="italic"' : ''}` +
      `${deco ? ` text-decoration="${deco}"` : ''}${anchor} fill="${s.textColor}" xml:space="preserve">${esc(chars.join(''))}</text>`);
    if (s.textAlign & 1) cp = [cp[0] + (hasDx ? adv.reduce((a, b) => a + b, 0) : 0), cp[1]];
  };

  const regionRects = (o: number, len: number): string => {
    if (len < 32) return '';
    const count = u32(o + 8);
    let d = '';
    for (let i = 0; i < count && o + 32 + i * 16 + 16 <= bytes.length; i++) {
      const p = o + 32 + i * 16;
      d += deviceRect(i32(p), i32(p + 4), i32(p + 8), i32(p + 12));
    }
    return d;
  };

  // ---- play the records
  let off = 0;
  for (let count = 0; off + 8 <= bytes.length && count < 2_000_000; count++) {
    const type = u32(off), size = u32(off + 4);
    if (size < 8 || off + size > bytes.length) break;
    const o = off;
    off += size;
    switch (type) {
      case 14: off = bytes.length; break; // EOF
      // ---- lines and shapes
      case 2: case 85: { // PolyBezier
        const pts = points(o + 28, u32(o + 24), type === 85);
        if (pts.length) openFigure(bezierFrom(pts.slice(1), pts[0]));
        break;
      }
      case 3: case 86: { // Polygon
        const pts = points(o + 28, u32(o + 24), type === 86);
        if (pts.length > 1) closedFigure(lineFrom(pts, null));
        break;
      }
      case 4: case 87: { // Polyline
        const pts = points(o + 28, u32(o + 24), type === 87);
        if (pts.length > 1) openFigure(lineFrom(pts, null));
        break;
      }
      case 5: case 88: { // PolyBezierTo
        const pts = points(o + 28, u32(o + 24), type === 88);
        if (pts.length >= 3) { continueFigure(bezierFrom(pts, cp)); cp = pts[Math.floor(pts.length / 3) * 3 - 1]; }
        break;
      }
      case 6: case 89: { // PolylineTo
        const pts = points(o + 28, u32(o + 24), type === 89);
        if (pts.length) { continueFigure(lineFrom(pts, cp)); cp = pts[pts.length - 1]; }
        break;
      }
      case 7: case 8: case 90: case 91: { // PolyPolyline, PolyPolygon
        const short = type >= 90, closed = type === 8 || type === 91;
        const polys = u32(o + 24), total = u32(o + 28);
        const all = points(o + 32 + polys * 4, total, short);
        let at = 0, d = '';
        for (let i = 0; i < polys; i++) {
          const n = u32(o + 32 + i * 4);
          const pts = all.slice(at, at + n);
          at += n;
          if (pts.length < 2) continue;
          if (closed) d += lineFrom(pts, null) + 'Z';
          else openFigure(lineFrom(pts, null));
        }
        if (closed && d) { if (inPath) path.push(d); else fillStroke(d); }
        break;
      }
      case 56: case 92: { // PolyDraw: points, each with how to reach it
        const short = type === 92, n = u32(o + 24);
        const pts = points(o + 28, n, short);
        const kinds = o + 28 + n * (short ? 4 : 8);
        let d = '';
        for (let i = 0; i < pts.length; i++) {
          const k = bytes[kinds + i] ?? 2;
          if ((k & 6) === 6) d += `M${P(...pts[i])}`;
          else if ((k & 6) === 4 && i + 2 < pts.length) { d += `${d ? '' : `M${P(...cp)}`}C${P(...pts[i])} ${P(...pts[i + 1])} ${P(...pts[i + 2])}`; i += 2; }
          else d += (d ? 'L' : `M${P(...cp)}L`) + P(...pts[i]);
          if (k & 1) d += 'Z';
          cp = pts[i];
        }
        if (d) openFigure(d);
        break;
      }
      case 27: // MoveToEx
        cp = [i32(o + 8), i32(o + 12)];
        if (inPath) path.push(`M${P(...cp)}`);
        break;
      case 54: { // LineTo
        const to: [number, number] = [i32(o + 8), i32(o + 12)];
        continueFigure(`M${P(...cp)}L${P(...to)}`);
        cp = to;
        break;
      }
      case 15: { // SetPixelV
        const x = i32(o + 8), y = i32(o + 12);
        put(`<rect x="${num(X(x, y))}" y="${num(Y(x, y))}" width="1" height="1" fill="${colorRef(u32(o + 16))}"/>`);
        break;
      }
      case 42: closedFigure(ellipse(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)).slice(0, -1)); break;
      case 43: { // Rectangle
        const [l, t, r, b] = [i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)];
        closedFigure(`M${P(l, t)}L${P(r, t)}L${P(r, b)}L${P(l, b)}`);
        break;
      }
      case 44: { // RoundRect
        const [l, t, r, b] = [i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)];
        const rx = Math.min(Math.abs(r - l) / 2, i32(o + 24) / 2), ry = Math.min(Math.abs(b - t) / 2, i32(o + 28) / 2);
        const kx = K * rx, ky = K * ry;
        closedFigure(`M${P(l + rx, t)}L${P(r - rx, t)}C${P(r - rx + kx, t)} ${P(r, t + ry - ky)} ${P(r, t + ry)}` +
          `L${P(r, b - ry)}C${P(r, b - ry + ky)} ${P(r - rx + kx, b)} ${P(r - rx, b)}` +
          `L${P(l + rx, b)}C${P(l + rx - kx, b)} ${P(l, b - ry + ky)} ${P(l, b - ry)}` +
          `L${P(l, t + ry)}C${P(l, t + ry - ky)} ${P(l + rx - kx, t)} ${P(l + rx, t)}`);
        break;
      }
      case 45: case 46: case 47: case 55: { // Arc, Chord, Pie, ArcTo
        const box = [i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)] as const;
        const pts = arcPoints(...box, i32(o + 24), i32(o + 28), i32(o + 32), i32(o + 36));
        if (type === 45) openFigure(lineFrom(pts, null));
        else if (type === 55) { continueFigure(lineFrom(pts, cp)); cp = pts[pts.length - 1]; }
        else if (type === 46) closedFigure(lineFrom(pts, null));
        else closedFigure(lineFrom(pts, [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2]));
        break;
      }
      case 41: { // AngleArc
        const cx = i32(o + 8), cy = i32(o + 12), r = u32(o + 16), a0 = dv.getFloat32(o + 20, true), sweep = dv.getFloat32(o + 24, true);
        const pts: [number, number][] = [];
        const n = Math.max(4, Math.ceil(Math.abs(sweep) / 5));
        for (let i = 0; i <= n; i++) { const a = ((a0 + (sweep * i) / n) * Math.PI) / 180; pts.push([cx + r * Math.cos(a), cy - r * Math.sin(a)]); }
        continueFigure(lineFrom(pts, cp));
        cp = pts[pts.length - 1];
        break;
      }
      // ---- paths
      case 59: inPath = true; path = []; break; // BeginPath
      case 60: inPath = false; break; // EndPath
      case 68: inPath = false; path = []; break; // AbortPath
      case 61: if (path.length) path.push('Z'); break; // CloseFigure
      case 62: fill(path.join('')); path = []; break; // FillPath
      case 63: fillStroke(path.join('')); path = []; break; // StrokeAndFillPath
      case 64: stroke(path.join('')); path = []; break; // StrokePath
      case 67: { // SelectClipPath
        const d = path.join('');
        const mode = u32(o + 8);
        if (d) s.clip = addClip(d, s.fillRule, mode === 5 ? s.metaClip : s.clip);
        path = [];
        break;
      }
      // ---- regions
      case 71: case 74: { // FillRgn, PaintRgn
        const len = u32(o + 24);
        const brushObj = type === 71 ? objects.get(u32(o + 28)) : undefined;
        const d = regionRects(o + (type === 71 ? 32 : 28), len);
        if (d) fill(d, brushObj?.kind === 'brush' ? brushObj.brush : s.brush);
        break;
      }
      // ---- clipping
      case 30: s.clip = addClip(rectPath(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20))); break; // IntersectClipRect
      case 29: s.clip = addClip(deviceRect(fx - 1e5, fy - 1e5, fx + fw + 1e5, fy + fh + 1e5) + rectPath(i32(o + 8), i32(o + 12), i32(o + 16), i32(o + 20)), 'evenodd'); break;
      case 28: s.metaClip = s.clip; break; // SetMetaRgn
      case 75: { // ExtSelectClipRgn
        const len = u32(o + 8), mode = u32(o + 12);
        const d = regionRects(o + 16, len);
        if (mode === 5) s.clip = d ? addClip(d, 'nonzero', s.metaClip) : s.metaClip;
        else if (mode === 1 && d) s.clip = addClip(d);
        break;
      }
      // ---- the coordinate mapping
      case 17: s.mapMode = u32(o + 8); update(); break;
      case 9: s.wExt = [i32(o + 8), i32(o + 12)]; update(); break;
      case 10: s.wOrg = [i32(o + 8), i32(o + 12)]; update(); break;
      case 11: s.vExt = [i32(o + 8), i32(o + 12)]; update(); break;
      case 12: s.vOrg = [i32(o + 8), i32(o + 12)]; update(); break;
      case 31: case 32: { // ScaleViewportExtEx, ScaleWindowExtEx
        const k: [number, number] = [i32(o + 8) / (i32(o + 12) || 1), i32(o + 16) / (i32(o + 20) || 1)];
        if (type === 31) s.vExt = [s.vExt[0] * k[0], s.vExt[1] * k[1]]; else s.wExt = [s.wExt[0] * k[0], s.wExt[1] * k[1]];
        update();
        break;
      }
      case 35: case 36: { // SetWorldTransform, ModifyWorldTransform
        const x: M = [0, 4, 8, 12, 16, 20].map((k) => dv.getFloat32(o + 8 + k, true)) as M;
        const mode = type === 35 ? 4 : u32(o + 32);
        s.world = mode === 1 ? IDENTITY : mode === 2 ? mul(x, s.world) : mode === 3 ? mul(s.world, x) : x;
        update();
        break;
      }
      case 33: saved.push({ ...s }); break; // SaveDC
      case 34: { // RestoreDC
        const k = i32(o + 8);
        const at = k < 0 ? saved.length + k : k - 1;
        if (at >= 0 && at < saved.length) { s = saved[at]; saved.length = at; update(); }
        break;
      }
      // ---- settings
      case 18: s.bkOpaque = u32(o + 8) === 2; break;
      case 19: s.fillRule = u32(o + 8) === 2 ? 'nonzero' : 'evenodd'; break;
      case 22: s.textAlign = u32(o + 8); break;
      case 24: s.textColor = colorRef(u32(o + 8)); break;
      case 25: s.bkColor = colorRef(u32(o + 8)); break;
      case 57: s.arcClockwise = u32(o + 8) === 2; break;
      case 58: { const v = u32(o + 8); s.miter = v > 0 && v < 1000 ? v : dv.getFloat32(o + 8, true) || 10; break; }
      // ---- pens, brushes and fonts
      case 38: { // CreatePen
        const style = u32(o + 12), width = i32(o + 16);
        objects.set(u32(o + 8), { kind: 'pen', pen: { style, width, color: colorRef(u32(o + 24)), cosmetic: width === 0, dashes: [] } });
        break;
      }
      case 95: { // ExtCreatePen
        const style = u32(o + 28), width = u32(o + 32), brushStyle = u32(o + 36), nDash = u32(o + 48);
        const dashes: number[] = [];
        for (let i = 0; i < nDash && o + 52 + i * 4 + 4 <= o + size; i++) dashes.push(u32(o + 52 + i * 4));
        const geometric = (style & 0xf0000) === 0x10000;
        objects.set(u32(o + 8), { kind: 'pen', pen: { style: brushStyle === 1 ? 5 : style, width, color: colorRef(u32(o + 40)), cosmetic: !geometric, dashes } });
        break;
      }
      case 39: { // CreateBrushIndirect
        const style = u32(o + 12);
        objects.set(u32(o + 8), { kind: 'brush', brush: { color: style === 1 ? null : colorRef(u32(o + 16)), opacity: style === 2 ? 0.35 : 1 } });
        break;
      }
      case 93: case 94: { // CreateMonoBrush, CreateDIBPatternBrushPt: the pattern's average colour
        const dib = decodeDib(bytes.subarray(o + u32(o + 16), o + u32(o + 16) + u32(o + 20)), bytes.subarray(o + u32(o + 24), o + u32(o + 24) + u32(o + 28)));
        let color = '#808080';
        if (dib?.kind === 'rgba') {
          const sum = [0, 0, 0];
          for (let i = 0; i < dib.rgba.length; i += 4) { sum[0] += dib.rgba[i]; sum[1] += dib.rgba[i + 1]; sum[2] += dib.rgba[i + 2]; }
          const n = dib.rgba.length / 4 || 1;
          color = '#' + sum.map((v) => Math.round(v / n).toString(16).padStart(2, '0')).join('');
        }
        objects.set(u32(o + 8), { kind: 'brush', brush: { color, opacity: 1 } });
        break;
      }
      case 82: { // ExtCreateFontIndirectW
        let face = '';
        for (let i = 0; i < 32; i++) {
          const c = dv.getUint16(o + 40 + i * 2, true);
          if (!c) break;
          face += String.fromCharCode(c);
        }
        objects.set(u32(o + 8), {
          kind: 'font',
          font: { height: i32(o + 12), escapement: i32(o + 20), weight: i32(o + 28), italic: bytes[o + 32] !== 0, underline: bytes[o + 33] !== 0, strike: bytes[o + 34] !== 0, face },
        });
        break;
      }
      case 37: { // SelectObject
        const h = u32(o + 8);
        const obj = h & 0x80000000 ? (h & 0x7fffffff) >= 10 && (h & 0x7fffffff) <= 17 ? { kind: 'font' as const, font: SYSTEM_FONT } : STOCK[h & 0x7fffffff] : objects.get(h);
        if (obj?.kind === 'pen') s.pen = obj.pen;
        else if (obj?.kind === 'brush') s.brush = obj.brush;
        else if (obj?.kind === 'font') s.font = obj.font;
        break;
      }
      case 40: objects.delete(u32(o + 8)); break; // DeleteObject
      // ---- text
      case 83: text(o, false); break;
      case 84: text(o, true); break;
      // ---- bitmaps
      case 76: case 77: case 114: { // BitBlt, StretchBlt, AlphaBlend
        const dest: [number, number, number, number] = [i32(o + 24), i32(o + 28), i32(o + 32), i32(o + 36)];
        const rop = type === 114 ? ROP.SRCCOPY : u32(o + 40);
        const stretch = type !== 76;
        const src: [number, number, number, number] = [i32(o + 44), i32(o + 48), stretch ? i32(o + 100) : dest[2], stretch ? i32(o + 104) : dest[3]];
        bitmap(o, u32(o + 84), u32(o + 88), u32(o + 92), u32(o + 96), rop, dest, src);
        break;
      }
      case 80: { // SetDIBitsToDevice
        const dest: [number, number, number, number] = [i32(o + 24), i32(o + 28), i32(o + 40), i32(o + 44)];
        bitmap(o, u32(o + 48), u32(o + 52), u32(o + 56), u32(o + 60), ROP.SRCCOPY, dest, [i32(o + 32), i32(o + 36), i32(o + 40), i32(o + 44)]);
        break;
      }
      case 81: { // StretchDIBits
        const dest: [number, number, number, number] = [i32(o + 24), i32(o + 28), i32(o + 72), i32(o + 76)];
        bitmap(o, u32(o + 48), u32(o + 52), u32(o + 56), u32(o + 60), u32(o + 68), dest, [i32(o + 32), i32(o + 36), i32(o + 40), i32(o + 44)]);
        break;
      }
      default: break; // comments (and the EMF+ inside them), palettes, colour management
    }
  }
  flush();
  if (openClip) body.push('</g>');
  if (!drawn) return null;
  const W = fw / pxPerPt, H = fh / pxPerPt;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${num(W)}pt" height="${num(H)}pt" viewBox="${num(fx)} ${num(fy)} ${num(fw)} ${num(fh)}">` +
    (defs.length ? `<defs>${defs.join('')}</defs>` : '') + body.join('') + '</svg>';
  return { svg, w: W, h: H, vectors: drawn - images };
}

/** The size of an EMF picture in points, from its frame. */
export function emfSize(bytes: Uint8Array): { w: number; h: number } | null {
  if (bytes.length < 40) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const w = ((dv.getInt32(32, true) - dv.getInt32(24, true)) / 2540) * 72, h = ((dv.getInt32(36, true) - dv.getInt32(28, true)) / 2540) * 72;
  return w > 0 && h > 0 ? { w, h } : null;
}

// Windows-1252 characters 0x80–0x9F (EXTTEXTOUTA text)
const WIN1252 = [0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f,
  0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178];
