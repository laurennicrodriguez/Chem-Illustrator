// @vitest-environment jsdom
//
// Aromatic rings drawn with circles, and back to alternating double bonds.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { circleRings, isCircleRing, kekulize, ringBonds, ringCircle, ringsThroughBond } from '../src/chem/aromatic';

/** A ring of n atoms (elements as given) with bond orders as given, round (cx, cy). */
function ring(doc: Doc, zs: number[], orders: number[], cx = 0, cy = 0): number[] {
  const n = zs.length, r = 14.4 / (2 * Math.sin(Math.PI / n));
  const ids = zs.map((z, i) => doc.addAtom(cx + r * Math.cos((2 * Math.PI * i) / n), cy + r * Math.sin((2 * Math.PI * i) / n), z).id);
  ids.forEach((id, i) => doc.addBond(id, ids[(i + 1) % n], orders[i]));
  return ids;
}
const orders = (doc: Doc, ids: number[]) => ringBonds(doc, ids).map((b) => doc.bonds.get(b)!.order);

describe('aromatic circles', () => {
  it('draws benzene with a circle and puts the double bonds back', () => {
    const doc = new Doc();
    const ids = doc.edit('b', () => ring(doc, [6, 6, 6, 6, 6, 6], [2, 1, 2, 1, 2, 1]));
    expect(doc.edit('c', () => circleRings(doc, []))).toBe(1);
    expect(isCircleRing(doc, ids)).toBe(true);
    expect(orders(doc, ids)).toEqual([1.5, 1.5, 1.5, 1.5, 1.5, 1.5]);
    // the circle sits well inside the ring
    const { center, radius } = ringCircle(doc, ids);
    expect(Math.hypot(center.x, center.y)).toBeLessThan(1e-9);
    expect(radius).toBeGreaterThan(5);
    expect(radius).toBeLessThan(12.5 * 0.7);
    expect(doc.edit('k', () => kekulize(doc, []))).toBe(1);
    const back = orders(doc, ids);
    expect(back.filter((o) => o === 2)).toHaveLength(3);
    expect(back.every((o, i) => o + back[(i + 1) % 6] === 3)).toBe(true);
    expect(doc.bonds.get(ringBonds(doc, ids)[0])!.circle).toBeUndefined();
  });

  it('leaves rings that are not aromatic alone', () => {
    const doc = new Doc();
    doc.edit('b', () => { ring(doc, [6, 6, 6, 6, 6, 6], [2, 1, 1, 1, 2, 1]); ring(doc, [6, 6, 6, 6, 6, 6], [1, 1, 1, 1, 1, 1], 60); });
    expect(doc.edit('c', () => circleRings(doc, []))).toBe(0);
  });

  it('circles a pyrrole, and gives it back with the NH free', () => {
    const doc = new Doc();
    const ids = doc.edit('b', () => ring(doc, [7, 6, 6, 6, 6], [1, 2, 1, 2, 1]));
    expect(doc.edit('c', () => circleRings(doc, []))).toBe(1);
    // the N keeps its H, written out
    expect(doc.atoms.get(ids[0])!.label).toBe('NH');
    expect(doc.edit('k', () => kekulize(doc, []))).toBe(1);
    expect(doc.atoms.get(ids[0])!.label).toBeNull();
    const o = orders(doc, ids);
    // N–C bonds single, the carbons paired up
    expect(o[0]).toBe(1);
    expect(o[4]).toBe(1);
    expect(o.filter((x) => x === 2)).toHaveLength(2);
  });

  it('finds both rings either side of a shared bond, and does a fused system as one', () => {
    const doc = new Doc();
    // naphthalene: two hexagons sharing the bond between atoms a and b
    const { shared } = doc.edit('b', () => {
      const L = 14.4, h = L * Math.sqrt(3) / 2;
      const P = [[0, -L / 2], [0, L / 2], [-h, L], [-2 * h, L / 2], [-2 * h, -L / 2], [-h, -L], [h, L], [2 * h, L / 2], [2 * h, -L / 2], [h, -L]];
      const a = P.map(([x, y]) => doc.addAtom(x, y).id);
      const bond = (i: number, j: number, o: number) => doc.addBond(a[i], a[j], o).id;
      const shared = bond(0, 1, 2);
      bond(1, 2, 1); bond(2, 3, 2); bond(3, 4, 1); bond(4, 5, 2); bond(5, 0, 1);
      bond(1, 6, 1); bond(6, 7, 2); bond(7, 8, 1); bond(8, 9, 2); bond(9, 0, 1);
      return { shared };
    });
    expect(ringsThroughBond(doc, shared)).toHaveLength(2);
    expect(doc.edit('c', () => circleRings(doc, []))).toBe(2);
    expect(doc.edit('k', () => kekulize(doc, [shared]))).toBe(2);
    expect([...doc.bonds.values()].filter((b) => b.order === 2)).toHaveLength(5);
  });

  it('keeps the circle in a saved file', () => {
    const doc = new Doc();
    doc.edit('b', () => ring(doc, [6, 6, 6, 6, 6, 6], [2, 1, 2, 1, 2, 1]));
    doc.edit('c', () => circleRings(doc, []));
    const back = readCdxml(writeCdxml(doc)).doc;
    const bonds = [...back.bonds.values()];
    expect(bonds).toHaveLength(6);
    expect(bonds.every((b) => b.order === 1.5 && b.circle)).toBe(true);
  });

  it('saves the circle the way ChemDraw draws one: a circle kept with the structure', () => {
    const doc = new Doc();
    doc.edit('b', () => ring(doc, [6, 6, 6, 6, 6, 6], [2, 1, 2, 1, 2, 1], 100, 100));
    doc.edit('c', () => circleRings(doc, []));
    const xml = writeCdxml(doc);
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const g = [...dom.getElementsByTagName('graphic')];
    expect(g).toHaveLength(1);
    expect(g[0].parentElement!.nodeName).toBe('fragment');
    expect(g[0].getAttribute('GraphicType')).toBe('Orbital');
    expect(g[0].getAttribute('OvalType')).toBe('Circle');
    expect(g[0].getAttribute('Center3D')).toBe('100.00 100.00 0');
    // no marks of our own on the bonds
    expect(xml).not.toContain('ci-aromatic-circle');
  });

  it('reads a ring circle drawn in ChemDraw', () => {
    // ChemDraw: six aromatic bonds and an s orbital circle in the middle of the ring
    const n = [0, 1, 2, 3, 4, 5].map((i) => [100 + 10.8 * Math.cos((Math.PI / 3) * i), 100 + 10.8 * Math.sin((Math.PI / 3) * i)]);
    const xml = `<?xml version="1.0"?><CDXML BondLength="10.8"><page id="1"><fragment id="2">${
      n.map(([x, y], i) => `<n id="${10 + i}" p="${x} ${y}"/>`).join('')}${
      n.map((_, i) => `<b id="${20 + i}" B="${10 + i}" E="${10 + ((i + 1) % 6)}" Order="1.5"/>`).join('')
    }<graphic id="30" BoundingBox="106.48 100 100 100" GraphicType="Orbital" OvalType="Circle" OrbitalType="s" Center3D="100 100 0" MajorAxisEnd3D="106.48 100 0" MinorAxisEnd3D="100 106.48 0"/></fragment>`
      + `<graphic id="40" BoundingBox="0 0 10 10" GraphicType="Oval" OvalType="Circle" Center3D="300 300 0" MajorAxisEnd3D="310 300 0" MinorAxisEnd3D="300 310 0"/></page></CDXML>`;
    const doc = readCdxml(xml).doc;
    expect([...doc.bonds.values()].every((b) => b.circle)).toBe(true);
    // the ring's circle is not a separate shape; a circle elsewhere still is
    expect([...doc.shapes.values()].map((s) => s.kind)).toEqual(['oval']);
    // saved unchanged, the file is left as it was
    expect(writeCdxml(doc)).toBe(xml);
    // taking the circle off removes it from the file
    doc.edit('k', () => kekulize(doc, []));
    const out = writeCdxml(doc);
    expect(out).not.toContain('OrbitalType="s"');
    expect(out).toContain('id="40"');
    expect(readCdxml(out).doc.shapes.size).toBe(1);
  });

  it('moves the circle with its ring in a file from ChemDraw', () => {
    const doc = new Doc();
    doc.edit('b', () => ring(doc, [6, 6, 6, 6, 6, 6], [2, 1, 2, 1, 2, 1], 100, 100));
    doc.edit('c', () => circleRings(doc, []));
    const opened = readCdxml(writeCdxml(doc)).doc;
    opened.edit('m', () => { for (const a of [...opened.atoms.values()]) opened.updateAtom(a.id, { x: a.x + 50 }); });
    const dom = new DOMParser().parseFromString(writeCdxml(opened), 'text/xml');
    const g = [...dom.getElementsByTagName('graphic')];
    expect(g).toHaveLength(1);
    expect(g[0].getAttribute('Center3D')).toBe('150.00 100.00 0');
  });
});
