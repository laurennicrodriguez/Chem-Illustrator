// Chains of a typed length (the chain tool's click).

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { chainFrom } from '../src/chem/chemgeom';

const len = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);
const angleAt = (a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }) => {
  const u = { x: a.x - b.x, y: a.y - b.y }, v = { x: c.x - b.x, y: c.y - b.y };
  return (Math.acos((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))) * 180) / Math.PI;
};

describe('chain of a given length', () => {
  it('draws a zig-zag of n bonds in empty space', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const pts = chainFrom(doc, null, { x: 0, y: 0 }, 5);
    expect(pts).toHaveLength(6);
    for (let i = 1; i < pts.length; i++) expect(len(pts[i - 1], pts[i])).toBeCloseTo(L);
    for (let i = 1; i < pts.length - 1; i++) expect(angleAt(pts[i - 1], pts[i], pts[i + 1])).toBeCloseTo(120);
    // it heads to the right
    expect(pts[5].x).toBeGreaterThan(3 * L);
  });

  it('carries on the zig-zag from the end of a chain', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const [a, b] = doc.edit('e', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L * Math.cos(Math.PI / 6), -L / 2);
      doc.addBond(a.id, b.id, 1);
      return [a, b];
    });
    const pts = chainFrom(doc, b.id, b, 3);
    expect(pts).toHaveLength(4);
    expect(pts[0]).toEqual(b);
    // every atom of the chain makes 120° with its neighbours, starting from the old bond
    const all = [a, ...pts];
    for (let i = 1; i < all.length - 1; i++) expect(angleAt(all[i - 1], all[i], all[i + 1])).toBeCloseTo(120);
    // a zig-zag, not a ring: the chain moves steadily away from the first atom
    for (let i = 1; i < all.length; i++) expect(len(a, all[i])).toBeGreaterThan(len(a, all[i - 1]));
  });
});
