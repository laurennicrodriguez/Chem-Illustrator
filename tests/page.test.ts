// @vitest-environment jsdom
//
// A drawing's page (File > Page Setup): written to and read from the CDXML page, grown with the
// drawing, or the drawing kept on it.

import { describe, expect, it } from 'vitest';
import { Doc, keepOnPage } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

function drawing(x: number, y: number): Doc {
  const doc = new Doc();
  doc.edit('build', () => { const a = doc.addAtom(x, y, 6).id, b = doc.addAtom(x + 14, y, 6).id; doc.addBond(a, b, 1); });
  return doc;
}

describe('the page', () => {
  it('saves an A4 page and reads it back', () => {
    const doc = drawing(100, 100);
    doc.page = { w: 523, h: 770, grow: true, name: 'a4' };
    const back = readCdxml(writeCdxml(doc)).doc;
    expect(back.page?.w).toBeCloseTo(523, 0);
    expect(back.page?.h).toBeCloseTo(770, 0);
    expect(back.page?.name).toBe('a4');
  });

  it('adds pages when the drawing goes past the page', () => {
    const doc = drawing(700, 100);
    doc.page = { w: 540, h: 720, grow: true };
    expect(writeCdxml(doc)).toMatch(/WidthPages="2"/);
  });

  it('keeps the drawing on the page when asked', () => {
    const doc = drawing(700, 100);
    doc.page = { w: 540, h: 720, grow: false };
    expect(keepOnPage(doc)).toBe(true);
    const b = doc.bounds()!;
    expect(b.x2).toBeLessThanOrEqual(540);
    expect(b.x1).toBeGreaterThanOrEqual(0);
    // too big to fit: left as it is
    const big = drawing(0, 0);
    big.edit('wide', () => big.addAtom(900, 0, 6));
    big.page = { w: 540, h: 720, grow: false };
    expect(keepOnPage(big)).toBe(false);
  });

  it('leaves an untouched ChemDraw file exactly as it was', () => {
    const xml = writeCdxml(drawing(100, 100));
    const opened = readCdxml(xml).doc;
    expect(writeCdxml(opened)).toBe(xml);
  });
});
