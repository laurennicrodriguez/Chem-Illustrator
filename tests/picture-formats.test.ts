// TIFF and EPS picture export: LZW that a TIFF reader can undo, the file's tags, and an EPS
// with its bounding box, fonts in Windows' Western characters, and pictures blended with white.

import { describe, it, expect } from 'vitest';
import { lzw, writeTiff } from '../src/render/tiff';
import { itemsToEps, ascii85 } from '../src/render/eps';

/** TIFF's LZW, undone (the reader's side, with the early change). */
function unlzw(b: Uint8Array): Uint8Array {
  const out: number[] = [];
  let table: number[][] = [];
  const reset = () => { table = []; for (let i = 0; i < 256; i++) table.push([i]); table.push([], []); };
  reset();
  let width = 9, bitPos = 0, prev: number[] | null = null;
  const read = () => {
    let v = 0;
    for (let i = 0; i < width; i++, bitPos++) v = (v << 1) | ((b[bitPos >> 3] >> (7 - (bitPos & 7))) & 1);
    return v;
  };
  for (;;) {
    const code = read();
    if (code === 257) break;
    if (code === 256) { reset(); width = 9; prev = null; continue; }
    let entry: number[];
    if (code < table.length) entry = table[code];
    else if (prev) entry = [...prev, prev[0]];
    else throw new Error('bad code');
    out.push(...entry);
    if (prev) table.push([...prev, entry[0]]);
    prev = entry;
    if (table.length + 1 >= 1 << width && width < 12) width++;
  }
  return Uint8Array.from(out);
}

describe('TIFF pictures', () => {
  it('compresses so a reader gets the same bytes back, past a full table', () => {
    let seed = 1;
    const data = new Uint8Array(40000).map((_, i) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return i % 97 < 60 ? 255 : seed & 0xff; });
    expect(unlzw(lzw(data))).toEqual(data);
    expect(unlzw(lzw(new Uint8Array(0)))).toEqual(new Uint8Array(0));
  });

  it('writes the size, LZW, RGB with alpha when see-through, and the resolution', () => {
    const px = new Uint8Array(3 * 2 * 4).fill(200);
    const t = writeTiff(px, 3, 2, 600, true);
    const v = new DataView(t.buffer);
    expect(String.fromCharCode(t[0], t[1])).toBe('II');
    const ifd = v.getUint32(4, true), n = v.getUint16(ifd, true);
    const tags = new Map<number, number>();
    for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; tags.set(v.getUint16(e, true), v.getUint16(e + 2, true) === 3 && v.getUint32(e + 4, true) === 1 ? v.getUint16(e + 8, true) : v.getUint32(e + 8, true)); }
    expect(tags.get(256)).toBe(3);
    expect(tags.get(257)).toBe(2);
    expect(tags.get(259)).toBe(5);
    expect(tags.get(277)).toBe(4);
    expect(tags.get(338)).toBe(2);
    const res = tags.get(282)!;
    expect(v.getUint32(res, true) / v.getUint32(res + 4, true)).toBe(600);
    // one strip: its bytes undo to the pixels
    const strip = t.subarray(tags.get(273)!, tags.get(273)! + tags.get(279)!);
    expect(unlzw(strip)).toEqual(new Uint8Array(24).fill(200));
    // without see-through parts the alpha channel is left out
    expect(writeTiff(px, 3, 2, 300, false).length).toBeLessThan(t.length);
  });
});

describe('EPS pictures', () => {
  it('writes ASCII85 that ends properly', () => {
    expect(ascii85(new Uint8Array([0, 0, 0, 0]))).toBe('z~>');
    expect(ascii85(new TextEncoder().encode('Man '))).toBe('9jqo^~>');
    expect(ascii85(new TextEncoder().encode('Ma'))).toBe('9jn~>');
  });

  it('has a bounding box, flips the page, uses standard fonts and blends see-through colours with white', async () => {
    const eps = await itemsToEps([
      { kind: 'path', segs: [{ k: 'M', x: 0, y: 0 }, { k: 'L', x: 10, y: 0 }, { k: 'L', x: 10, y: 10 }, { k: 'Z' }], fill: 'rgba(255,0,0,0.5)' },
      { kind: 'text', text: 'Café – β', x: 5, y: 20, size: 10, family: 'Arial', bold: false, italic: false, color: '#000', widths: Array(8).fill(5) },
      { kind: 'image', src: 'x', x: 0, y: 0, w: 10, h: 10 },
    ], { x1: 0, y1: 0, x2: 100.5, y2: 50 }, async () => ({ kind: 'raw', w: 1, h: 1, rgb: new Uint8Array([0, 0, 0]), alpha: new Uint8Array([0]) }));
    expect(eps.startsWith('%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 101 50\n')).toBe(true);
    expect(eps).toContain('%%HiResBoundingBox: 0 0 100.5 50');
    expect(eps).toContain('1 0.5 0.5 rg');
    expect(eps).toContain('0 50 translate 1 -1 scale');
    expect(eps).toMatch(/\/F1 \/Helvetica findfont .* dup 150 \/endash put .* definefont def/);
    expect(eps).toContain('/F2 /Symbol findfont def');
    expect(eps).toContain('(Caf\\351 \\226 ) show');
    expect(eps).toContain('/LZWDecode filter');
    expect(eps.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
