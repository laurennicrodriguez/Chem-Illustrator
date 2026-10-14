// Windows metafiles (EMF) shown as SVG: the coordinate mapping, pens and brushes, text, clipping
// and bitmaps, checked on metafiles built here record by record, on our own copied pictures, and
// (when CHEM_TEST_FILES points at them) on the pictures inside the owner's ChemDraw files.

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { unzlibSync } from 'fflate';
import { emfToSvg, emfSize, decodeDib, rgbaToPng, pngWithDpi, crc32 } from '../src/render/emf-read';
import { itemsToEmf } from '../src/render/emf';
import { VecPath } from '../src/render/vector';

/** Builds an EMF a record at a time, with a header for a 1000 × 500 pixel picture on a 100 px/mm device. */
class Emf {
  private recs: number[][] = [];
  rec(type: number, ...ints: number[]): this {
    this.recs.push([type, 8 + ints.length * 4, ...ints]);
    return this;
  }
  raw(type: number, body: Uint8Array): this {
    const words = new Uint32Array(body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength));
    this.recs.push([type, 8 + body.length, ...words]);
    return this;
  }
  bytes(): Uint8Array {
    const header = new DataView(new ArrayBuffer(108));
    const h = [1, 108, 0, 0, 999, 499, 0, 0, 1000, 500, 0x464d4520, 0x10000, 0, 0, 0, 0, 0, 0, 10000, 10000, 100, 100, 0, 0, 0, 100000, 100000];
    h.forEach((v, i) => header.setInt32(i * 4, v | 0, true));
    const all = [...this.recs, [14, 20, 0, 16, 20]];
    const words = all.flat();
    const out = new Uint8Array(108 + words.length * 4);
    out.set(new Uint8Array(header.buffer));
    const dv = new DataView(out.buffer);
    words.forEach((v, i) => dv.setInt32(108 + i * 4, v | 0, true));
    return out;
  }
}
const f32 = (v: number) => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v, true); return b.getInt32(0, true); };

describe('EMF pictures as SVG', () => {
  it('turns the picture frame into the SVG size and view', () => {
    const r = emfToSvg(new Emf().rec(43, 0, 0, 100, 100).bytes())!;
    // a 10 mm × 5 mm frame on a device of 100 pixels per millimetre
    expect(r.w).toBeCloseTo((10 / 25.4) * 72, 2);
    expect(r.svg).toContain('viewBox="0 0 1000 500"');
    expect(emfSize(new Emf().bytes())).toEqual({ w: expect.closeTo(28.35, 1), h: expect.closeTo(14.17, 1) });
  });
  it('maps the picture’s units onto the page (window and viewport)', () => {
    const r = emfToSvg(new Emf()
      .rec(17, 8) // anisotropic
      .rec(9, 100, 100).rec(11, 1000, -500) // 100 units across, y up
      .rec(10, 0, 100) // window origin at the top
      .rec(43, 10, 90, 50, 40) // a rectangle
      .bytes())!;
    expect(r.svg).toMatch(/M100 50L500 50L500 300L100 300Z/);
  });
  it('follows world transforms, saved and restored', () => {
    const r = emfToSvg(new Emf()
      .rec(33) // save
      .rec(35, f32(2), 0, 0, f32(2), f32(100), f32(50)) // scale 2, then move
      .rec(43, 0, 0, 10, 10)
      .rec(34, -1) // restore
      .rec(43, 0, 0, 10, 10)
      .bytes())!;
    expect(r.svg).toContain('M100 50L120 50L120 70L100 70Z');
    expect(r.svg).toContain('M0 0L10 0L10 10L0 10Z');
  });
  it('draws with the chosen pens and brushes', () => {
    const r = emfToSvg(new Emf()
      .rec(38, 1, 0x2000 | 0x10000 | 1, 10, 0, 0x0000ff) // geometric dashed red pen, 10 wide
      .rec(39, 2, 0, 0x00ff00, 0) // solid green brush
      .rec(37, 1).rec(37, 2)
      .rec(19, 2) // winding fill
      .rec(43, 0, 0, 100, 100)
      .rec(37, 0x80000008) // no pen
      .rec(43, 200, 0, 300, 100)
      .bytes())!;
    expect(r.svg).toContain('fill="#00ff00" fill-rule="nonzero"');
    expect(r.svg).toMatch(/stroke="#ff0000" stroke-width="10" stroke-linecap="round" stroke-linejoin="miter" stroke-miterlimit="10" stroke-dasharray="30 10"/);
    expect(r.svg.match(/stroke="#ff0000"/g)!.length).toBe(1);
  });
  it('joins a long run of thin lines into one path (a spectrum)', () => {
    const e = new Emf();
    for (let i = 0; i < 50; i++) e.rec(4, 0, 0, 0, 0, 2, i * 10, 0, i * 10 + 10, 5); // Polyline
    const r = emfToSvg(e.bytes())!;
    expect(r.svg.match(/<path/g)!.length).toBe(1);
    expect(r.vectors).toBe(1);
  });
  it('builds paths and fills them', () => {
    const r = emfToSvg(new Emf()
      .rec(59) // begin path
      .rec(27, 0, 0).rec(54, 100, 0).rec(54, 100, 100).rec(61)
      .rec(60).rec(62, 0, 0, 0, 0) // end, fill
      .bytes())!;
    expect(r.svg).toContain('<path d="M0 0L100 0L100 100Z" fill="#ffffff"');
  });
  it('clips to rectangles, and forgets the clip on restore', () => {
    const r = emfToSvg(new Emf()
      .rec(33).rec(30, 10, 10, 50, 50).rec(43, 0, 0, 100, 100).rec(34, -1).rec(43, 0, 0, 100, 100)
      .bytes())!;
    expect(r.svg).toContain('<clipPath id="emfclip1"><path d="M10 10L50 10L50 50L10 50Z"');
    expect(r.svg).toMatch(/<g clip-path="url\(#emfclip1\)"><path d="M0 0L100 0L100 100L0 100Z"[^>]*\/><path[^>]*\/><\/g><path/);
  });
  it('places text with its font, alignment, spacing and angle', () => {
    const font = new Uint8Array(92 + 4);
    const fv = new DataView(font.buffer);
    fv.setUint32(0, 3, true); fv.setInt32(4, -40, true); fv.setInt32(12, 900, true); fv.setInt32(20, 700, true);
    [...'Arial'].forEach((c, i) => fv.setUint16(32 + i * 2, c.charCodeAt(0), true));
    const txt = new Uint8Array(76 + 8 + 12);
    const tv = new DataView(txt.buffer);
    // reference point, 3 characters, string at 76 + 8, no options, spacing at 92
    tv.setInt32(28, 500, true); tv.setInt32(32, 400, true); tv.setUint32(36, 3, true); tv.setUint32(40, 84, true); tv.setUint32(64, 92, true);
    [...'δ7 '].forEach((c, i) => tv.setUint16(76 + i * 2, c.charCodeAt(0), true));
    const body = new Uint8Array(txt.length + 12);
    body.set(txt);
    new DataView(body.buffer).setInt32(84, 20, true); new DataView(body.buffer).setInt32(88, 22, true); new DataView(body.buffer).setInt32(92, 24, true);
    const r = emfToSvg(new Emf().raw(82, font).rec(37, 3).rec(22, 24).rec(18, 1).rec(24, 0x000080).raw(84, body.subarray(0, 96)).bytes())!;
    expect(r.svg).toContain('transform="translate(500 400) rotate(-90)"');
    expect(r.svg).toContain('x="0 20 42"');
    expect(r.svg).toContain('font-size="40"');
    expect(r.svg).toContain('font-weight="bold"');
    expect(r.svg).toContain('fill="#800000"');
    expect(r.svg).toContain('>δ7 </text>');
  });
  it('reads bitmaps of every depth, top row first', () => {
    // 2 × 2, 24 bits, rows stored bottom first and padded to 4 bytes
    const bmi = new Uint8Array(40);
    const v = new DataView(bmi.buffer);
    v.setUint32(0, 40, true); v.setInt32(4, 2, true); v.setInt32(8, 2, true); v.setUint16(12, 1, true); v.setUint16(14, 24, true);
    const bits = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, /* bottom: blue, green */ 0, 0, 255, 255, 255, 255, 0, 0 /* top: red, white */]);
    const d = decodeDib(bmi, bits)!;
    expect(d.kind).toBe('rgba');
    if (d.kind === 'rgba') expect([...d.rgba.subarray(0, 8)]).toEqual([255, 0, 0, 255, 255, 255, 255, 255]);
    // 1 bit with a two-colour table
    const mono = new Uint8Array(48);
    const mv = new DataView(mono.buffer);
    mv.setUint32(0, 40, true); mv.setInt32(4, 3, true); mv.setInt32(8, -1, true); mv.setUint16(14, 1, true);
    mono.set([0, 0, 0, 0, 255, 255, 255, 0], 40);
    const m = decodeDib(mono, new Uint8Array([0b10100000, 0, 0, 0]))!;
    if (m.kind === 'rgba') expect([...m.rgba].filter((_, i) => i % 4 === 0)).toEqual([255, 0, 255]);
  });
  it('writes PNG files a reader accepts', () => {
    const png = rgbaToPng(new Uint8Array([255, 0, 0, 255, 0, 0, 255, 128]), 2, 1);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const dv = new DataView(png.buffer);
    expect(dv.getUint32(16)).toBe(2);
    const idatLen = dv.getUint32(33);
    const raw = unzlibSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 255, 0, 0, 255, 0, 0, 255, 128]);
  });
  it('shows a picture copied from this program the same way', () => {
    const p = new VecPath();
    p.moveTo(10, 10); p.lineTo(40, 10);
    const emf = itemsToEmf([
      { kind: 'path', segs: p.segs, stroke: { color: '#000000', width: 0.6, cap: 'round', join: 'round' } },
      { kind: 'text', text: 'OH', x: 42, y: 14, size: 10, family: 'Arial', bold: false, italic: false, color: '#000000', widths: [7.8, 7.2] },
    ], { x1: 0, y1: 0, x2: 60, y2: 20 });
    const r = emfToSvg(emf)!;
    expect(r.w).toBeCloseTo(60, 0);
    expect(r.h).toBeCloseTo(20, 0);
    expect(r.svg).toContain('>OH</text>');
    expect(r.svg).toMatch(/<path d="M[\d.]+ [\d.]+L[\d.]+ [\d.]+"/);
  });
  it('says so when a file is not a metafile, or draws nothing', () => {
    expect(emfToSvg(new Uint8Array(200))).toBeNull();
    expect(emfToSvg(new Emf().rec(70, 0).bytes())).toBeNull();
  });

  const dir = process.env.CHEM_TEST_FILES ?? '';
  it.skipIf(!dir || !existsSync(dir))('shows every metafile in the ChemDraw test files', () => {
    let n = 0;
    for (const name of readdirSync(dir).filter((f) => f.endsWith('.cdxml'))) {
      const text = readFileSync(join(dir, name), 'utf8');
      for (const m of text.matchAll(/EnhancedMetafile="([0-9A-Fa-f\s]+)"/g)) {
        const hex = m[1].replace(/\s/g, '');
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
        const r = emfToSvg(bytes);
        expect(r, `${name} picture ${n}`).not.toBeNull();
        expect(r!.svg.length).toBeGreaterThan(200);
        n++;
      }
    }
    expect(n).toBeGreaterThan(0);
  });
});

describe('PNG resolution (Export Picture)', () => {
  const chunks = (png: Uint8Array) => {
    const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
    const out: { type: string; data: Uint8Array; crcOk: boolean }[] = [];
    for (let i = 8; i + 12 <= png.length;) {
      const len = dv.getUint32(i);
      const type = String.fromCharCode(...png.subarray(i + 4, i + 8));
      out.push({ type, data: png.subarray(i + 8, i + 8 + len), crcOk: crc32(png.subarray(i + 4, i + 8 + len)) === dv.getUint32(i + 8 + len) });
      i += 12 + len;
    }
    return out;
  };
  const png = rgbaToPng(new Uint8Array(16).fill(200), 2, 2);

  it('writes the dpi as dots per metre straight after the header, with a good checksum', () => {
    const c = chunks(pngWithDpi(png, 300));
    expect(c.map((x) => x.type)).toEqual(['IHDR', 'pHYs', ...chunks(png).slice(1).map((x) => x.type)]);
    const p = new DataView(c[1].data.buffer, c[1].data.byteOffset);
    expect(p.getUint32(0)).toBe(11811); // 300 / 0.0254
    expect(p.getUint32(4)).toBe(11811);
    expect(c[1].data[8]).toBe(1);
    expect(c.every((x) => x.crcOk)).toBe(true);
  });

  it('replaces an older resolution instead of adding a second one', () => {
    const c = chunks(pngWithDpi(pngWithDpi(png, 150), 600));
    expect(c.filter((x) => x.type === 'pHYs')).toHaveLength(1);
    expect(new DataView(c[1].data.buffer, c[1].data.byteOffset).getUint32(0)).toBe(23622);
  });

  it('leaves a file that is not a PNG alone', () => {
    const junk = new Uint8Array([1, 2, 3]);
    expect(pngWithDpi(junk, 300)).toBe(junk);
  });
});
