// Pictures on the page: each image is decoded once and kept, keyed by its data. Drawing asks
// for an image and gets it when it is ready; until then the picture shows as a grey box, and
// a redraw is asked for when it arrives. Windows metafiles (EMF, from MestReNova, Excel and
// Office) are kept as they are, and shown through an SVG copy so they stay sharp.

import { emfToSvg, emfSize } from './emf-read';

interface Entry { img: HTMLImageElement; ready: boolean; failed: boolean }

const cache = new Map<string, Entry>();
const listeners: (() => void)[] = [];

/** Call `fn` whenever a picture finishes loading (to redraw). */
export function onImageReady(fn: () => void): () => void {
  listeners.push(fn);
  return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
}

const shown = new Map<string, string | null>();

/** What a browser can show for a picture: EMF pictures become SVG (null when that can't be done). */
export function showableSrc(src: string): string | null {
  if (!src.startsWith('data:image/x-emf')) return src;
  let s = shown.get(src);
  if (s === undefined) {
    try {
      const svg = emfToSvg(fromDataUrl(src).bytes);
      s = svg ? dataUrl(new TextEncoder().encode(svg.svg), 'image/svg+xml') : null;
    } catch {
      s = null;
    }
    shown.set(src, s);
  }
  return s;
}

/** The decoded image, or null while it loads (or when it can't be shown). */
export function imageFor(src: string): HTMLImageElement | null {
  let e = cache.get(src);
  if (!e) {
    if (typeof Image === 'undefined') return null;
    const img = new Image();
    e = { img, ready: false, failed: false };
    cache.set(src, e);
    const entry = e;
    img.onload = () => { entry.ready = true; for (const f of listeners) f(); };
    img.onerror = () => { entry.failed = true; };
    const s = showableSrc(src);
    if (s) img.src = s; else entry.failed = true;
  }
  return e.ready ? e.img : null;
}

/** True when a picture's data could not be read as an image. */
export function imageFailed(src: string): boolean {
  return cache.get(src)?.failed ?? false;
}

/** Load a picture and wait for it. */
export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      if (!cache.has(src)) cache.set(src, { img, ready: true, failed: false });
      resolve(img);
    };
    img.onerror = () => reject(new Error('This picture could not be read'));
    const s = showableSrc(src);
    if (s) img.src = s; else reject(new Error('This picture could not be read'));
  });
}

/** Bytes as a data URL. */
export function dataUrl(bytes: Uint8Array, mime: string): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode(...bytes.subarray(i, i + CH));
  return `data:${mime};base64,${btoa(s)}`;
}

/** The bytes and type of a data URL. */
export function fromDataUrl(src: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(src);
  if (!m) throw new Error('Not a data URL');
  const mime = m[1];
  if (m[2]) {
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { mime, bytes };
  }
  return { mime, bytes: new TextEncoder().encode(decodeURIComponent(m[3])) };
}

const BY_EXTENSION: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', webp: 'image/webp',
  svg: 'image/svg+xml', emf: 'image/x-emf', tif: 'image/tiff', tiff: 'image/tiff',
};

/**
 * A WebP picture as PNG (Word and PowerPoint files can't hold WebP), drawn by the browser.
 * Null when it can't be read.
 */
export async function webpToPng(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const bmp = await createImageBitmap(new Blob([bytes as BlobPart], { type: 'image/webp' }));
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    c.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    return new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
  } catch {
    return null;
  }
}

/** A picture file's type, from its first bytes, or else from its name. Null when it isn't a picture. */
export function pictureMime(name: string, b: Uint8Array): string | null {
  const at = (i: number, ...xs: number[]) => xs.every((x, k) => b[i + k] === x);
  if (at(0, 0x89, 0x50, 0x4e, 0x47)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x47, 0x49, 0x46, 0x38)) return 'image/gif';
  if (at(0, 0x42, 0x4d)) return 'image/bmp';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  // a Windows enhanced metafile: record type 1, then " EMF" 40 bytes in
  if (at(0, 1, 0, 0, 0) && at(40, 0x20, 0x45, 0x4d, 0x46)) return 'image/x-emf';
  if (/<svg[\s>]/i.test(new TextDecoder().decode(b.subarray(0, 2000)))) return 'image/svg+xml';
  return BY_EXTENSION[name.toLowerCase().split('.').pop() ?? ''] ?? null;
}

/** A picture's size in pixels, from its header. */
export function imageSize(b: Uint8Array, mime: string): { w: number; h: number } | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  try {
    if (mime === 'image/png' && b.length >= 24) return { w: dv.getUint32(16), h: dv.getUint32(20) };
    if (mime === 'image/gif' && b.length > 10) return { w: dv.getUint16(6, true), h: dv.getUint16(8, true) };
    if (mime === 'image/bmp' && b.length > 26) return { w: Math.abs(dv.getInt32(18, true)), h: Math.abs(dv.getInt32(22, true)) };
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i++; continue; }
        const m = b[i + 1];
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: dv.getUint16(i + 7), h: dv.getUint16(i + 5) };
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; }
        i += 2 + dv.getUint16(i + 2);
      }
    }
    if (mime === 'image/x-emf' && b.length > 40) {
      // its intended size (the frame, in hundredths of a millimetre), as pixels at 96 per inch
      const pt = emfSize(b);
      if (pt) return { w: Math.round(pt.w / 0.75), h: Math.round(pt.h / 0.75) };
      const w = dv.getInt32(16, true) - dv.getInt32(8, true), h = dv.getInt32(20, true) - dv.getInt32(12, true);
      if (w > 0 && h > 0) return { w, h };
    }
    if (mime === 'image/svg+xml') {
      const t = new TextDecoder().decode(b.subarray(0, 2000));
      const vb = /viewBox\s*=\s*["']\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(t);
      if (vb) return { w: Number(vb[1]), h: Number(vb[2]) };
      const w = /\swidth\s*=\s*["']([\d.]+)/.exec(t), h = /\sheight\s*=\s*["']([\d.]+)/.exec(t);
      if (w && h) return { w: Number(w[1]), h: Number(h[1]) };
    }
  } catch {
    return null;
  }
  return null;
}
