// Mechanism arrows, round 3 (item 6): starting from a drawn lone pair, keeping clear of the
// structure, and Clean Up Arrow.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { arcClash, bendSide, cleanUpArrow, pushArrow, pushEndAt } from '../src/chem/mechanism';
import { dist } from '../src/geom';

/** Acetone with hydroxide up and to the left, and a lone pair drawn on the hydroxide. */
function scene() {
  const doc = new Doc();
  const ids = doc.edit('build', () => {
    const c = doc.addAtom(150, 100), o = doc.addAtom(150, 85.6, 8);
    const co = doc.addBond(c.id, o.id, 2);
    const m1 = doc.addAtom(137.5, 107.2), m2 = doc.addAtom(162.5, 107.2);
    doc.addBond(c.id, m1.id);
    doc.addBond(c.id, m2.id);
    const oh = doc.addAtom(110, 80, 8, { charge: -1 });
    // a lone pair to the lower right of the O⁻, facing the carbonyl
    const pair = doc.addShape({ kind: 'symbol', symbol: 'LonePair', x1: 115.5, y1: 84, x2: 117.5, y2: 86 });
    return { c: c.id, o: o.id, co: co.id, oh: oh.id, pair: pair.id, m1: m1.id };
  });
  return { doc, ...ids };
}

describe('mechanism arrows from drawn lone pairs', () => {
  it('starts at the lone pair drawn on the atom', () => {
    const { doc, oh, c } = scene();
    const r = pushArrow(doc, plainMeasure(doc), { kind: 'atom', id: oh }, { kind: 'atom', id: c })!;
    expect(dist(r.tail, { x: 116.5, y: 85 })).toBeLessThan(0.15 * doc.style.bondLength);
  });

  it('starts at a lone pair it is dragged from', () => {
    const { doc, pair, c } = scene();
    const r = pushArrow(doc, plainMeasure(doc), { kind: 'pair', id: pair }, { kind: 'atom', id: c })!;
    expect(dist(r.tail, { x: 116.5, y: 85 })).toBeLessThan(0.15 * doc.style.bondLength);
  });

  it('works out what an arrow end sits on', () => {
    const { doc, pair, co, c } = scene();
    const m = plainMeasure(doc);
    expect(pushEndAt(doc, m, { x: 117, y: 86 })).toEqual({ kind: 'pair', id: pair });
    expect(pushEndAt(doc, m, { x: 151, y: 93 })).toEqual({ kind: 'bond', id: co });
    expect(pushEndAt(doc, m, { x: 150, y: 101.5 })).toEqual({ kind: 'atom', id: c });
    expect(pushEndAt(doc, m, { x: 300, y: 300 }).kind).toBe('point');
  });
});

describe('keeping arrows clear', () => {
  it('scores an arc through the structure worse than one round it', () => {
    const { doc, c, m1 } = scene();
    const m = plainMeasure(doc);
    const L = doc.style.bondLength;
    void c; void m1;
    // from left of the molecule to right of it: straight through the middle, or bowed far round
    const tail = { x: 125, y: 100 }, head = { x: 175, y: 100 };
    const through = arcClash(doc, m, tail, head, 0.2);
    const round = arcClash(doc, m, tail, head, -2.6);
    expect(through).toBeGreaterThan(round);
    expect(round).toBeLessThan(0.5);
    expect(L).toBeGreaterThan(0);
  });

  it('cleans up a badly drawn arrow from the lone pair to the carbonyl carbon', () => {
    const { doc, c } = scene();
    const m = plainMeasure(doc);
    // drawn roughly: from near the lone pair, bending the wrong way, ending on top of the carbon
    const messy = { tail: { x: 117, y: 86 }, head: { x: 150, y: 100 }, sweep: -0.3 };
    const r = cleanUpArrow(doc, m, messy)!;
    expect(r).not.toBeNull();
    expect(dist(r.tail, { x: 116.5, y: 85 })).toBeLessThan(0.15 * doc.style.bondLength);
    // it stops short of the carbon instead of sitting on it
    expect(dist(r.head, doc.atoms.get(c)!)).toBeGreaterThan(0.15 * doc.style.bondLength);
    expect(arcClash(doc, m, r.tail, r.head, r.sweep)).toBeLessThanOrEqual(arcClash(doc, m, messy.tail, messy.head, messy.sweep));
  });

  it('keeps the side an arrow bends to when asked', () => {
    const { doc, oh, c } = scene();
    const m = plainMeasure(doc);
    for (const side of [1, -1]) {
      const r = pushArrow(doc, m, { kind: 'atom', id: oh }, { kind: 'atom', id: c }, side)!;
      expect(bendSide(r)).toBe(side);
    }
  });
});
