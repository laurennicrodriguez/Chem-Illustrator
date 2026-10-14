// @vitest-environment jsdom
//
// The drawing's colour palette, faded fills, and fills saved for ChemDraw and PowerPoint.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { documentColours, PALETTE_SIZE, STANDARD_COLOURS, tint, usedColours } from '../src/colours';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

describe('colour palette', () => {
  it('starts with the standard colours and adds the drawing\'s own, up to twenty', () => {
    const doc = new Doc();
    expect(documentColours(doc)).toEqual(STANDARD_COLOURS);
    doc.edit('c', () => {
      const a = doc.addAtom(0, 0, 8, { color: '#123456' });
      const b = doc.addAtom(10, 0, 6, { color: '#E3001B' });
      doc.addBond(a.id, b.id, 1, 'solid', { color: '#abcdef' });
    });
    expect(usedColours(doc)).toEqual(['#123456', '#e3001b', '#abcdef']);
    // a standard colour already in use is not listed twice
    expect(documentColours(doc)).toEqual([...STANDARD_COLOURS, '#123456', '#abcdef']);
    doc.edit('many', () => { for (let i = 0; i < 30; i++) doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 1, y2: 1, color: '#' + (0x100000 + i).toString(16) }); });
    expect(documentColours(doc)).toHaveLength(PALETTE_SIZE);
  });

  it('mixes colours with white', () => {
    expect(tint('#000000', 0.5)).toBe('#808080');
    expect(tint('#ff0000', 0)).toBe('#ff0000');
    expect(tint('#ff0000', 1)).toBe('#ffffff');
  });
});

describe('fills', () => {
  it('keeps the fill style and both colours through a ChemDraw file', () => {
    const doc = new Doc();
    doc.edit('s', () => {
      doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 40, y2: 20, filled: true, fill: 'faded', fillColor: '#1f5fbf', color: '#e3001b' });
      doc.addShape({ kind: 'oval', x1: 60, y1: 0, x2: 80, y2: 20, filled: true, fill: 'shaded', color: '#2e8b57' });
    });
    const text = writeCdxml(doc);
    // ChemDraw sees a light blue filled box and a shaded green circle
    expect(text).toMatch(/RectangleType="Filled"/);
    expect(text).toMatch(/OvalType="Circle Shaded"/);
    const back = [...readCdxml(text).doc.shapes.values()];
    const box = back.find((s) => s.kind === 'rect')!, oval = back.find((s) => s.kind === 'oval')!;
    expect(box).toMatchObject({ filled: true, fill: 'faded', fillColor: '#1f5fbf', color: '#e3001b' });
    expect(oval).toMatchObject({ filled: true, fill: 'shaded', color: '#2e8b57' });
  });
});
