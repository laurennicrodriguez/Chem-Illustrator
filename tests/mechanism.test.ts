// Electron-pushing arrows: where they start and stop, and which way they bend.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { lonePairDir, pushArrow, symbolSpot } from '../src/chem/mechanism';
import { arcCenter, dist, dot, sub } from '../src/geom';

/** Acetone with hydroxide up and to the left of it. */
function acetone() {
  const doc = new Doc();
  const ids = doc.edit('build', () => {
    const c = doc.addAtom(150, 100), o = doc.addAtom(150, 85.6, 8);
    const co = doc.addBond(c.id, o.id, 2);
    const m1 = doc.addAtom(137.5, 107.2), m2 = doc.addAtom(162.5, 107.2);
    doc.addBond(c.id, m1.id);
    doc.addBond(c.id, m2.id);
    const oh = doc.addAtom(90, 60, 8, { charge: -1 });
    return { c: c.id, o: o.id, co: co.id, oh: oh.id, m2: m2.id };
  });
  return { doc, ...ids };
}

/** Is a point on the arc, between its ends? */
const onArc = (r: { tail: { x: number; y: number }; head: { x: number; y: number }; sweep: number }, p: { x: number; y: number }) => {
  const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
  return Math.abs(dist(p, center) - radius) < 1e-6;
};

describe('electron-pushing arrows', () => {
  it('runs from a lone pair to an atom, stopping clear of both labels', () => {
    const { doc, oh, c } = acetone();
    const m = plainMeasure(doc);
    const r = pushArrow(doc, m, { kind: 'atom', id: oh }, { kind: 'atom', id: c })!;
    const L = doc.style.bondLength;
    const O = doc.atoms.get(oh)!, C = doc.atoms.get(c)!;
    // starts outside the O⁻ label, ends just short of the carbon
    for (const b of m.atomBoxes(O)) expect(r.tail.x < b.x1 || r.tail.x > b.x2 || r.tail.y < b.y1 || r.tail.y > b.y2).toBe(true);
    expect(dist(r.head, C)).toBeGreaterThan(0.15 * L);
    expect(dist(r.head, C)).toBeLessThan(0.5 * L);
    expect(Math.abs(r.sweep)).toBeGreaterThan(0);
    expect(onArc(r, r.head)).toBe(true);
  });

  it('points a lone pair into open space, away from the bonds', () => {
    const { doc, o, oh } = acetone();
    // the carbonyl O's only bond points down, so its lone pairs point up-ish
    expect(lonePairDir(doc, o, doc.atoms.get(oh)!).y).toBeLessThan(0);
  });

  it('curls a bond\'s electrons onto its own atom in a small loop', () => {
    const { doc, co, o } = acetone();
    const L = doc.style.bondLength;
    const r = pushArrow(doc, plainMeasure(doc), { kind: 'bond', id: co }, { kind: 'atom', id: o })!;
    expect(r.small).toBe(true);
    expect(Math.abs(r.sweep)).toBeGreaterThan(Math.PI * 0.75);
    // beside the bond and beside the O, not on top of them
    expect(Math.abs(r.tail.x - 150)).toBeGreaterThan(0.05 * L);
    expect(dist(r.head, doc.atoms.get(o)!)).toBeGreaterThan(0.2 * L);
  });

  it('bends into the open angle between two bonds of one atom (an elimination)', () => {
    const doc = new Doc();
    const { ch, cc, c } = doc.edit('build', () => {
      const c = doc.addAtom(0, 0), c2 = doc.addAtom(-12.5, -7.2), h = doc.addAtom(12.5, -7.2, 1);
      return { cc: doc.addBond(c.id, c2.id).id, ch: doc.addBond(c.id, h.id).id, c: c.id };
    });
    const r = pushArrow(doc, plainMeasure(doc), { kind: 'bond', id: ch }, { kind: 'bond', id: cc })!;
    const { center } = arcCenter(r.tail, r.head, r.sweep);
    const mid = { x: (r.tail.x + r.head.x) / 2, y: (r.tail.y + r.head.y) / 2 };
    const bulge = sub(mid, center);
    // the arc bulges up, away from the shared carbon below
    expect(dot(bulge, sub(doc.atoms.get(c)!, mid))).toBeLessThan(0);
  });

  it('bends the way it is asked to', () => {
    const { doc, oh, c } = acetone();
    const m = plainMeasure(doc);
    const a = pushArrow(doc, m, { kind: 'atom', id: oh }, { kind: 'atom', id: c }, 1)!;
    const b = pushArrow(doc, m, { kind: 'atom', id: oh }, { kind: 'atom', id: c }, -1)!;
    expect(Math.sign(a.sweep)).not.toBe(Math.sign(b.sweep));
  });

  it('puts lone pairs and charges in the open space round an atom, one after another', () => {
    const { doc, o, m2 } = acetone();
    const m = plainMeasure(doc);
    const first = symbolSpot(doc, m, o, [], 2.6);
    // the C=O bond points down, so the first goes straight up, clear of the O
    expect(first.dir.y).toBeCloseTo(-1, 6);
    for (const b of m.atomBoxes(doc.atoms.get(o)!)) expect(first.at.y).toBeLessThan(b.y1);
    const second = symbolSpot(doc, m, o, [first.at], 2.6);
    expect(Math.abs(second.dir.x)).toBeGreaterThan(0.9);
    // on an end carbon, off to the side of its bond rather than straight on from it
    const end = symbolSpot(doc, m, m2, [], 1.4);
    const along = sub(doc.atoms.get(m2)!, { x: 150, y: 100 });
    const cos = dot(end.dir, along) / Math.hypot(along.x, along.y);
    expect(cos).toBeLessThan(0.9);
    expect(cos).toBeGreaterThan(-0.5);
  });
});
