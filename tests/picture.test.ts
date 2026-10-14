// @vitest-environment jsdom
//
// Pictures for Word and PowerPoint: the drawing is recorded as shapes and text and written
// as an Enhanced Metafile (EMF) or SVG.

import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { Doc } from '../src/model';
import { recordPicture, pictureEmf, pictureSvg, bitmapScale } from '../src/render/picture';
import { dashed, flatten, VecPath } from '../src/render/vector';
import { arialWidth } from '../src/text-metrics';

function sample(): Doc {
  const doc = new Doc();
  doc.bulk(() => {
    const ring = [0, 1, 2, 3, 4, 5].map((i) => doc.addAtom(100 + 14.4 * Math.cos((Math.PI / 3) * i), 100 + 14.4 * Math.sin((Math.PI / 3) * i)));
    ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, i % 2 ? 2 : 1));
    const o = doc.addAtom(128.8, 100, 8);
    doc.addBond(ring[0].id, o.id);
    const n = doc.addAtom(78.4, 87.5, 7, { charge: 1 });
    doc.addBond(ring[3].id, n.id, 1, 'wedge');
    doc.addCaption({ x: 90, y: 140, runs: [{ text: 'Yield ' }, { text: '92%', bold: true }], justify: 'left' });
    doc.addArrow({ tail: { x: 140, y: 100 }, head: { x: 180, y: 100 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5 });
    doc.addShape({ kind: 'rect', x1: 60, y1: 70, x2: 190, y2: 150, rounded: true, dashed: true });
  });
  return doc;
}

/** Walk an EMF file's records: [type, size] pairs. */
function records(b: Uint8Array): [number, number][] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const out: [number, number][] = [];
  for (let at = 0; at < b.length;) {
    const type = v.getUint32(at, true), size = v.getUint32(at + 4, true);
    out.push([type, size]);
    if (size < 8 || size % 4) break;
    at += size;
  }
  return out;
}

describe('pictures', () => {
  it('records bonds, labels, captions, arrows and boxes', () => {
    const p = recordPicture(sample())!;
    const texts = p.items.filter((i) => i.kind === 'text').map((i) => (i.kind === 'text' ? i.text : ''));
    expect(texts).toEqual(expect.arrayContaining(['O', 'H', 'N', 'Yield ', '92%']));
    expect(p.items.filter((i) => i.kind === 'path').length).toBeGreaterThan(4);
    // the box surrounds everything, with a small margin
    expect(p.box.x1).toBeLessThan(60);
    expect(p.box.x2).toBeGreaterThan(190);
    // bold text is measured with bold widths
    const bold = p.items.find((i) => i.kind === 'text' && i.text === '92%')!;
    expect(bold.kind === 'text' && bold.widths.reduce((a, b) => a + b, 0)).toBeCloseTo(arialWidth('92%', 10, true));
  });

  it('writes a well-formed EMF', () => {
    const p = recordPicture(sample())!;
    const emf = pictureEmf(p);
    const v = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
    expect(v.getUint32(40, true)).toBe(0x464d4520); // " EMF"
    expect(v.getUint32(48, true)).toBe(emf.length);
    const recs = records(emf);
    expect(recs.reduce((a, r) => a + r[1], 0)).toBe(emf.length);
    expect(v.getUint32(52, true)).toBe(recs.length);
    expect(recs[0][0]).toBe(1);
    expect(recs[recs.length - 1]).toEqual([14, 20]);
    expect(recs.every(([, size]) => size % 4 === 0)).toBe(true);
    // paths, text and fonts are all there
    const types = new Set(recs.map((r) => r[0]));
    for (const t of [59, 60, 64, 62, 84, 82, 95, 39]) expect(types.has(t)).toBe(true);
    // the frame is the picture's real size: points to hundredths of a millimetre
    const frameW = v.getInt32(32, true) - v.getInt32(24, true);
    expect(frameW).toBe(Math.round(((p.box.x2 - p.box.x1) * 25.4 * 100) / 72));
    if (process.env.PICTURE_OUT) writeFileSync(process.env.PICTURE_OUT + '/sample.emf', emf);
  });

  it('writes SVG', () => {
    const p = recordPicture(sample())!;
    const svg = pictureSvg(p);
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('font-weight="bold"');
    expect(svg).toContain('>92%</text>');
    if (process.env.PICTURE_OUT) writeFileSync(process.env.PICTURE_OUT + '/sample.svg', svg);
  });

  it('cuts dashes and turns arcs into curves', () => {
    const p = new VecPath();
    p.moveTo(0, 0);
    p.lineTo(10, 0);
    const d = dashed(p.segs, [2, 2]);
    expect(d.filter((s) => s.k === 'M').length).toBe(3);
    const c = new VecPath();
    c.arc(0, 0, 5, 0, Math.PI * 2);
    expect(c.segs.filter((s) => s.k === 'C').length).toBe(4);
    // every point of the flattened circle is 5 from the centre
    const pts = flatten(c.segs, 0.01)[0].pts;
    expect(Math.max(...pts.map((q) => Math.abs(Math.hypot(q.x, q.y) - 5)))).toBeLessThan(0.01);
  });
});

describe('Export Picture resolution', () => {
  it('uses the dpi asked for on a journal-sized graphic', () => {
    // a 3.25 × 1.75 in TOC graphic at 1200 dpi is well within the limits
    expect(bitmapScale(234, 126, 1200, 16000, 64e6)).toBeCloseTo(1200 / 72);
  });
  it('turns the dpi down for a poster too big to hold in memory', () => {
    const k = bitmapScale(48 * 72, 36 * 72, 600, 16000, 64e6);
    expect(k).toBeLessThan(600 / 72);
    expect(48 * 72 * k).toBeLessThanOrEqual(16000);
    expect(48 * 72 * k * 36 * 72 * k).toBeLessThanOrEqual(64e6 + 1);
  });
});
