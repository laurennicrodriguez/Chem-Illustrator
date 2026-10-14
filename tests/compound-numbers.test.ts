// @vitest-environment jsdom
//
// Number Compounds: numbers under structures in the order a reader meets them.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { labelNumber, nextNumber, planNumbers } from '../src/chem/compound-numbers';

function bond(doc: Doc, x: number, y: number): number {
  const a = doc.addAtom(x - 6, y), b = doc.addAtom(x + 6, y);
  doc.addBond(a.id, b.id);
  return a.id;
}
function arrow(doc: Doc, x1: number, y1: number, x2: number, y2: number) {
  return doc.addArrow({ tail: { x: x1, y: y1 }, head: { x: x2, y: y2 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 }).id;
}

const order = (doc: Doc, opts = { start: 1 }) => planNumbers(doc, plainMeasure(doc), new Set(), opts).labels.map((l) => [l.item.ref, l.text]);

describe('numbering compounds', () => {
  it('follows the arrows, even when a product is drawn first', () => {
    const doc = new Doc();
    const { a, b, c } = doc.edit('build', () => {
      // C ← B on the top row (the arrow points left), A → B below... read as A, B, C
      const c = bond(doc, 0, 0), b = bond(doc, 80, 0);
      arrow(doc, 68, 0, 12, 0);
      const a = bond(doc, 80, 60);
      arrow(doc, 80, 52, 80, 8);
      return { a, b, c };
    });
    expect(order(doc)).toEqual([['a' + a, '1'], ['a' + b, '2'], ['a' + c, '3']]);
  });

  it('numbers loose structures left to right and row by row, skipping reagents over arrows', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const x = bond(doc, 0, 0), y = bond(doc, 100, 0);
      arrow(doc, 12, 0, 88, 0);
      const reagent = bond(doc, 50, -10);
      const z = bond(doc, 0, 80);
      return { x, y, z, reagent };
    });
    expect(order(doc).map((o) => o[0])).toEqual(['a' + ids.x, 'a' + ids.y, 'a' + ids.z]);
    expect(planNumbers(doc, plainMeasure(doc), new Set(), { start: 1, reagents: true }).labels).toHaveLength(4);
  });

  it('changes numbers already under structures, or keeps them, and finds the next free one', () => {
    const doc = new Doc();
    doc.edit('build', () => {
      bond(doc, 0, 0); bond(doc, 60, 0);
      doc.addCaption({ x: -3, y: 14, runs: [{ text: '7', bold: true }], justify: 'left' });
    });
    const m = plainMeasure(doc);
    const again = planNumbers(doc, m, new Set(), { start: 1 }).labels;
    expect(again.map((l) => l.text)).toEqual(['1', '2']);
    expect(again[0].caption).toBeDefined();
    expect(planNumbers(doc, m, new Set(), { start: 8, keep: true }).labels.map((l) => l.text)).toEqual(['8']);
    expect(nextNumber(doc, m)).toBe(8);
    expect(planNumbers(doc, m, new Set(), { start: 3, letters: true }).labels.map((l) => l.text)).toEqual(['3a', '3b']);
  });

  it('reads the number in a label', () => {
    expect(labelNumber('12')).toBe(12);
    expect(labelNumber('2a')).toBe(2);
    expect(labelNumber('(±)-5')).toBe(5);
    expect(labelNumber('Pd(0)')).toBeNull();
  });
});
