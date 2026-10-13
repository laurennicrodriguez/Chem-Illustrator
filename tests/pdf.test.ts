// PDF export: a well-formed file (every object where the index says), text in the standard
// fonts with Greek letters from Symbol, pictures stored once, and cropping by clipping.

import { describe, it, expect } from 'vitest';
import { unzlibSync } from 'fflate';
import { writePdf, textPieces, standardFont, jpegInfo, PdfPage } from '../src/io/pdf';
import { VecPath } from '../src/render/vector';

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join('');

/** The objects of a PDF by number, checking the cross-reference table points at each. */
function objects(pdf: Uint8Array): Map<number, string> {
  const s = latin1(pdf);
  const start = Number(/startxref\s+(\d+)/.exec(s)![1]);
  expect(s.slice(start, start + 4)).toBe('xref');
  const [, first, count] = /^xref\s+(\d+) (\d+)/.exec(s.slice(start))!.map(Number);
  expect(first).toBe(0);
  const rows = s.slice(start).split('\n').slice(3, 3 + count - 1);
  const out = new Map<number, string>();
  rows.forEach((r, i) => {
    const at = Number(r.slice(0, 10));
    expect(s.slice(at).startsWith(`${i + 1} 0 obj`)).toBe(true);
    out.set(i + 1, s.slice(at, s.indexOf('endobj', at)));
  });
  return out;
}

/** The page's drawing instructions, unpacked. */
function content(objs: Map<number, string>, pageObj: string): string {
  const n = Number(/\/Contents (\d+) 0 R/.exec(pageObj)![1]);
  const body = objs.get(n)!;
  const data = body.slice(body.indexOf('stream\n') + 7, body.lastIndexOf('\nendstream'));
  return latin1(unzlibSync(Uint8Array.from(data, (c) => c.charCodeAt(0))));
}

const square = () => { const p = new VecPath(); p.rect(10, 10, 20, 20); return p.segs; };

describe('PDF files', () => {
  it('splits text between the font and Symbol, keeping each piece in place', () => {
    const t = textPieces('2 h, 50 °C → α', Array(14).fill(2));
    expect(t.map((p) => p.symbol)).toEqual([false, true, false, true]);
    expect(t[1].codes).toEqual([0xae]); // →
    expect(t[3].codes).toEqual([0x61]); // α
    expect(t[1].dx).toBe(11 * 2);
    expect(t[3].dx).toBe(13 * 2);
    expect(t[0].codes.includes(0xb0)).toBe(true); // ° is in the font itself
    expect(textPieces('a\u{1F600}b', [1, 1, 1])[0].codes).toEqual([0x61, 0x3f, 0x62]);
  });
  it('picks the standard font that looks most like each font', () => {
    expect(standardFont('Arial', false, false)).toBe('Helvetica');
    expect(standardFont('Calibri', true, false)).toBe('Helvetica-Bold');
    expect(standardFont('Times New Roman', false, true)).toBe('Times-Italic');
    expect(standardFont('Courier New', true, true)).toBe('Courier-BoldOblique');
    expect(standardFont('Liberation Sans', false, false)).toBe('Helvetica');
  });
  it('reads a JPEG’s size and colours', () => {
    // SOI, then a baseline frame header: 8 bits, 20 high, 30 wide, 3 components
    const b = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 20, 0, 30, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(jpegInfo(b)).toEqual({ w: 30, h: 20, components: 3 });
  });
  it('writes pages that a PDF reader can find its way round', async () => {
    const pages: PdfPage[] = [
      {
        w: 960, h: 540, items: [
          { kind: 'path', segs: square(), fill: '#ff0000' },
          { kind: 'path', segs: square(), stroke: { color: 'rgba(0,0,0,0.5)', width: 1.2, cap: 'round', join: 'round' } },
          { kind: 'text', text: 'Yield (β) 80%', x: 100, y: 200, size: 24, family: 'Arial', bold: true, italic: false, color: '#000000', widths: Array(13).fill(10) },
          { kind: 'image', src: 'data:image/png;base64,AAAA', x: 500, y: 100, w: 200, h: 100, crop: { l: 0.5, t: 0, r: 0, b: 0 } },
        ],
      },
      { w: 960, h: 540, items: [{ kind: 'image', src: 'data:image/png;base64,AAAA', x: 0, y: 0, w: 10, h: 10 }, { kind: 'image', src: 'data:image/x-emf;base64,AAAA', x: 50, y: 50, w: 10, h: 10 }] },
    ];
    let asked = 0;
    const pdf = await writePdf(pages, {
      title: 'Strychnine – talk',
      async image(src) {
        asked++;
        if (src.includes('emf')) return null;
        return { kind: 'raw', w: 2, h: 1, rgb: new Uint8Array([255, 0, 0, 0, 0, 255]), alpha: new Uint8Array([255, 128]) };
      },
    });
    expect(latin1(pdf.subarray(0, 8))).toBe('%PDF-1.7');
    const objs = objects(pdf);
    const all = [...objs.values()];
    const pageObjs = all.filter((o) => o.includes('/Type /Page '));
    expect(pageObjs.length).toBe(2);
    expect(pageObjs[0]).toContain('/MediaBox [0 0 960 540]');
    expect(all.some((o) => o.includes('/BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding'))).toBe(true);
    expect(all.some((o) => o.includes('/BaseFont /Symbol'))).toBe(true);
    // the picture is stored once (with its see-through mask) although it shows twice
    expect(asked).toBe(2);
    expect(all.filter((o) => o.includes('/Subtype /Image') && o.includes('/SMask')).length).toBe(1);
    expect(all.some((o) => o.includes('/Title <FEFF'))).toBe(true);
    const c1 = content(objs, pageObjs[0]);
    expect(c1.startsWith('1 0 0 -1 0 540 cm')).toBe(true);
    expect(c1).toContain('1 0 0 rg');
    expect(c1).toMatch(/\/G\d+ gs/); // the half-see-through line
    expect(c1).toContain('(Yield \\() Tj');
    expect(c1).toContain('(\\) 80%) Tj');
    expect(c1).toContain('(b) Tj');
    // cropped: clipped to the frame, the whole picture drawn twice as wide, starting further left
    expect(c1).toContain('500 100 200 100 re W n');
    expect(c1).toContain('400 0 0 -100 300 200 cm');
    // a picture that can't be read shows as a grey box
    expect(content(objs, pageObjs[1])).toContain('0.85 0.85 0.85 rg 50 50 10 10 re f');
  });
});
