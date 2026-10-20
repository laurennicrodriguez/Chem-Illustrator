import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { TEMPLATES, templateById, placeTemplate, freePlacement, fusePlacements, atomPlacements, templatePoints, rematch, Template, Placement } from '../src/chem/templates';
import { freeRing, placeRing } from '../src/chem/chemgeom';
import { dist } from '../src/geom';

const L = 14.4;
const tpl = (id: string) => templateById(id)!;
const doubles = (doc: Doc) => [...doc.bonds.values()].filter((b) => b.order === 2).length;
const maxDoublesOnAnAtom = (doc: Doc) =>
  Math.max(...[...doc.atoms.keys()].map((id) => (doc.adj.get(id) ?? []).filter((b) => doc.bonds.get(b)!.order === 2).length));

describe('template data', () => {
  it('has the expected sets', () => {
    const count = (g: Template['group']) => TEMPLATES.filter((t) => t.group === g).length;
    expect(count('amino')).toBe(20);
    expect(count('rings')).toBeGreaterThan(10);
    expect(count('heterocycles')).toBeGreaterThan(30);
    expect(count('sugars')).toBeGreaterThan(4);
    expect(new Set(TEMPLATES.map((t) => t.id)).size).toBe(TEMPLATES.length);
  });
  for (const t of TEMPLATES) {
    it(`${t.name}: sensible shape`, () => {
      const n = t.atoms.length;
      // rings bonded side-on to a metal are seen in perspective too
      const persp = !!(t.z || t.hapto);
      // an η³-allyl's bonds are 1½, a metal–metal bond may be quadruple
      const metal = t.group === 'organometallic' || t.group === 'ligands';
      for (const [a, b, o] of t.bonds) {
        expect(a).toBeLessThan(n);
        expect(b).toBeLessThan(n);
        expect(metal ? [1, 1.5, 2, 3, 4] : [1, 2, 3]).toContain(o);
        const d = Math.hypot(t.atoms[a][0] - t.atoms[b][0], t.atoms[a][1] - t.atoms[b][1]);
        expect(d).toBeGreaterThan(persp ? 0.25 : 0.45);
        // Haworth rings are drawn wide
        expect(d).toBeLessThan(t.group === 'sugars' ? 2.2 : 1.6);
      }
      // no two atoms on top of each other (shapes seen in perspective may come closer; C60's
      // far side lies behind its near side)
      const apart = persp ? 0.12 : 0.3;
      if (t.id !== 'c60') for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        expect(Math.hypot(t.atoms[i][0] - t.atoms[j][0], t.atoms[i][1] - t.atoms[j][1])).toBeGreaterThan(apart);
      }
      expect(t.attach).toBeLessThan(n);
      if (t.fuse) expect(t.bonds.some(([a, b]) => (a === t.fuse![0] && b === t.fuse![1]) || (a === t.fuse![1] && b === t.fuse![0]))).toBe(true);
    });
  }
});

describe('placing templates', () => {
  it('places one on its own, a bond long', () => {
    const doc = new Doc();
    const t = tpl('naphthalene');
    doc.bulk(() => placeTemplate(doc, t, freePlacement({ x: 100, y: 100 }, L)));
    expect(doc.atoms.size).toBe(10);
    expect(doc.bonds.size).toBe(11);
    expect(doubles(doc)).toBe(5);
    for (const b of doc.bonds.values()) expect(dist(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!)).toBeCloseTo(L, 0);
  });

  const benzeneAnd = (id: string, edgeOrder: 1 | 2) => {
    const doc = new Doc();
    let ring: number[] = [];
    doc.bulk(() => { ring = placeRing(doc, freeRing({ x: 0, y: 0 }, 6, L), { aromatic: true }); });
    // a ring edge of the wanted order
    let edge = doc.bondBetween(ring[0], ring[1])!;
    if (edge.order !== edgeOrder) edge = doc.bondBetween(ring[1], ring[2])!;
    expect(edge.order).toBe(edgeOrder);
    const p = doc.atoms.get(edge.a1)!, q = doc.atoms.get(edge.a2)!;
    const t = tpl(id);
    // the placement that puts the new ring outside the benzene
    const pls = fusePlacements(t, p, q);
    const outside = pls.find((pl) => dist(templatePoints(t, pl).reduce((s, v) => ({ x: s.x + v.x, y: s.y + v.y }), { x: 0, y: 0 }), { x: 0, y: 0 }) > L * 2)!;
    const near = (pl: Placement, i: number) => (dist(templatePoints(t, pl)[i], p) < dist(templatePoints(t, pl)[i], q) ? p.id : q.id);
    doc.bulk(() => placeTemplate(doc, t, outside, { existing: new Map([[t.fuse![0], near(outside, t.fuse![0])], [t.fuse![1], near(outside, t.fuse![1])]]) }));
    return doc;
  };
  for (const order of [1, 2] as const) {
    it(`fuses pyridine onto a benzene ${order === 1 ? 'single' : 'double'} bond to make quinoline`, () => {
      const doc = benzeneAnd('pyridine', order);
      expect(doc.atoms.size).toBe(10);
      expect(doc.bonds.size).toBe(11);
      expect(doubles(doc)).toBe(5);
      expect(maxDoublesOnAnAtom(doc)).toBe(1);
      expect([...doc.atoms.values()].filter((a) => a.z === 7).length).toBe(1);
    });
  }

  it('shares an atom (spiro) or joins by a new bond', () => {
    const doc = new Doc();
    let a = 0;
    doc.bulk(() => { a = doc.addAtom(0, 0).id; doc.addBond(a, doc.addAtom(-L, 0).id); });
    const thf = tpl('thf');
    const pl = atomPlacements(thf, doc.atoms.get(a)!, { x: 1, y: 0 }, L, false)[0];
    doc.bulk(() => placeTemplate(doc, thf, pl, { existing: new Map([[thf.attach, a]]) }));
    expect(doc.atoms.size).toBe(2 + 5 - 1);
    const ala = tpl('ala');
    const pl2 = atomPlacements(ala, doc.atoms.get(a)!, { x: 0, y: -1 }, L, true)[0];
    const before = doc.bonds.size;
    doc.bulk(() => placeTemplate(doc, ala, pl2, { bondFrom: a }));
    expect(doc.bonds.size).toBe(before + ala.bonds.length + 1);
    // the joining bond is a bond long
    const n = [...doc.atoms.values()].find((x) => x.z === 7)!;
    expect(dist(n, doc.atoms.get(a)!)).toBeCloseTo(L, 6);
  });

  it('keeps the stereochemistry of a mirrored amino acid by swapping its wedges', () => {
    const ala = tpl('ala');
    const wedge = ala.bonds.find((b) => b[3] === 'wedge' || b[3] === 'hashWedge')!;
    const doc = new Doc();
    doc.bulk(() => placeTemplate(doc, ala, { origin: { x: 0, y: 0 }, scale: L, angle: 0, mirror: true }));
    const drawn = [...doc.bonds.values()].find((b) => b.display !== 'solid')!;
    expect(drawn.display).toBe(wedge[3] === 'wedge' ? 'hashWedge' : 'wedge');
  });

  it('finds new places for double bonds, or says there are none', () => {
    const benzene: Template = { id: 'b', name: 'b', group: 'rings', attach: 0, atoms: [[0, 0, 'C'], [1, 0, 'C'], [1.5, 0.8, 'C'], [1, 1.6, 'C'], [0, 1.6, 'C'], [-0.5, 0.8, 'C']], bonds: [[0, 1, 2], [1, 2, 1], [2, 3, 2], [3, 4, 1], [4, 5, 2], [5, 0, 1]] };
    // atoms 0 and 1 already have double bonds elsewhere, so the others pair up as 2=3 and 4=5
    expect([...rematch(benzene, (i) => i === 0 || i === 1)!].sort()).toEqual([2, 4]);
    // with only atom 0 satisfied, five atoms are left: no arrangement
    expect(rematch(benzene, (i) => i === 0)).toBeNull();
  });
});
