// What the number and letter keys grow on an atom or bond (checked against ChemDraw 25), and
// Join (Ctrl+J).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { dist, angleOf, DEG } from '../src/geom';
import { freeRing, placeRing } from '../src/chem/chemgeom';
import { sproutGroup, fuseChair, nextNumber, ringModeDir, SPROUT_KINDS } from '../src/chem/sprouts';
import { joinAtoms, joinBonds, mergeAtom } from '../src/chem/join';

const L = 14.4;

/** A ring of n carbons centred on (x, y); returns its atom ids in order round the ring. */
const ring = (doc: Doc, x: number, y: number, n: number): number[] => doc.edit('ring', () => placeRing(doc, freeRing({ x, y }, n, L), {}));

/** A zig-zag chain of n carbons, left to right; returns the doc and the atom ids. */
function chain(n: number, x0 = 100, y0 = 100): { doc: Doc; ids: number[] } {
  const doc = new Doc();
  const ids: number[] = [];
  doc.edit('chain', () => {
    for (let i = 0; i < n; i++) {
      const a = doc.addAtom(x0 + i * L * Math.cos(30 * DEG), y0 + (i % 2 ? -L / 2 : 0));
      ids.push(a.id);
      if (i) doc.addBond(ids[i - 1], a.id);
    }
  });
  return { doc, ids };
}

const grow = (doc: Doc, id: number, kind: Parameters<typeof sproutGroup>[2]) => doc.edit('grow', () => sproutGroup(doc, id, kind));
const angleDeg = (doc: Doc, a: number, b: number, c: number) => {
  const A = doc.atoms.get(a)!, B = doc.atoms.get(b)!, C = doc.atoms.get(c)!;
  let d = Math.abs(angleOf({ x: A.x - B.x, y: A.y - B.y }) - angleOf({ x: C.x - B.x, y: C.y - B.y })) / DEG;
  if (d > 180) d = 360 - d;
  return d;
};

describe('keys on an atom', () => {
  it('1 grows a bond of standard length and the highlight goes to the new atom', () => {
    const { doc, ids } = chain(2);
    const next = grow(doc, ids[1], 'bond')!;
    expect(doc.atoms.size).toBe(3);
    expect(dist(doc.atoms.get(ids[1])!, doc.atoms.get(next)!)).toBeCloseTo(L, 6);
    expect(angleDeg(doc, ids[0], ids[1], next)).toBeCloseTo(120, 3);
  });

  it('0 on an end atom goes the other 120° way (ring mode)', () => {
    const { doc, ids } = chain(3);
    const zig = grow(doc, ids[2], 'bond')!;
    const { doc: doc2, ids: ids2 } = chain(3);
    const ring = grow(doc2, ids2[2], 'ring-bond')!;
    const pz = doc.atoms.get(zig)!, pr = doc2.atoms.get(ring)!;
    expect(dist(pz, pr)).toBeGreaterThan(L);
    expect(angleDeg(doc2, ids2[1], ids2[2], ring)).toBeCloseTo(120, 3);
    expect(ringModeDir(doc2, ids2[2])).toBeDefined();
  });

  it('0 on a middle atom reaches across a hexagon (√3 bond lengths)', () => {
    const { doc, ids } = chain(3);
    const next = grow(doc, ids[1], 'ring-bond')!;
    expect(dist(doc.atoms.get(ids[1])!, doc.atoms.get(next)!)).toBeCloseTo(Math.sqrt(3) * L, 6);
  });

  it('k on an end atom makes it a sulfonyl with a methyl beyond', () => {
    const { doc, ids } = chain(2);
    const next = grow(doc, ids[1], 'sulfonyl')!;
    const s = doc.atoms.get(ids[1])!;
    expect(s.z).toBe(16);
    const oxygens = doc.neighbors(s.id).filter((a) => a.z === 8);
    expect(oxygens).toHaveLength(2);
    for (const o of oxygens) expect(doc.bondBetween(s.id, o.id)!.order).toBe(2);
    expect(doc.atoms.get(next)!.z).toBe(6);
    expect(doc.degree(s.id)).toBe(4);
  });

  it('k on a middle atom makes it SO2 in place', () => {
    const { doc, ids } = chain(3);
    const next = grow(doc, ids[1], 'sulfonyl');
    expect(next).toBe(ids[1]);
    expect(doc.atoms.get(ids[1])!.z).toBe(16);
    expect(doc.atoms.size).toBe(5);
  });

  it('k on a branch point grows a new SO2Me', () => {
    const { doc, ids } = chain(3);
    grow(doc, ids[1], 'bond');
    const before = doc.atoms.size;
    grow(doc, ids[1], 'sulfonyl');
    expect(doc.atoms.get(ids[1])!.z).toBe(6);
    expect(doc.atoms.size).toBe(before + 4);
  });

  it('4 on an end atom adds a methyl and a wedge, and the highlight goes to the methyl', () => {
    const { doc, ids } = chain(2);
    const me = grow(doc, ids[1], 'wedge')!;
    expect(doc.atoms.size).toBe(4);
    const bonds = [...doc.adj.get(ids[1])!].map((b) => doc.bonds.get(b)!);
    expect(bonds.filter((b) => b.display === 'wedge')).toHaveLength(1);
    expect(doc.bondBetween(ids[1], me)!.display).toBe('solid');
  });

  it('5 on a middle atom adds one hashed wedge', () => {
    const { doc, ids } = chain(3);
    const n = grow(doc, ids[1], 'hash-wedge')!;
    expect(doc.atoms.size).toBe(4);
    const b = doc.bondBetween(ids[1], n)!;
    expect(b.display).toBe('hashWedge');
    expect(b.a1).toBe(ids[1]);
  });

  it('8 makes =CH2 and moves the highlight there, so 1 next makes the E isomer', () => {
    const { doc, ids } = chain(2);
    const ch2 = grow(doc, ids[1], 'methylidene')!;
    expect(doc.bondBetween(ids[1], ch2)!.order).toBe(2);
    const me = grow(doc, ch2, 'bond')!;
    // E: the two carbons on either end are on opposite sides (furthest apart)
    expect(dist(doc.atoms.get(ids[0])!, doc.atoms.get(me)!)).toBeGreaterThan(2.5 * L);
  });

  it('9 on an end atom makes two methyls', () => {
    const { doc, ids } = chain(2);
    grow(doc, ids[1], 'dimethyl');
    expect(doc.degree(ids[1])).toBe(3);
    expect(doc.atoms.size).toBe(4);
  });

  it('2 on a middle atom makes a ketone; an end atom becomes the C=O and the chain carries on', () => {
    const k = chain(3);
    grow(k.doc, k.ids[1], 'carbonyl');
    expect(k.doc.neighbors(k.ids[1]).filter((a) => a.z === 8)).toHaveLength(1);
    const ac = chain(2);
    const next = grow(ac.doc, ac.ids[1], 'carbonyl')!;
    // the end atom itself is the carbonyl carbon (as the cheat sheet draws it); the highlight goes past it
    expect(ac.doc.neighbors(ac.ids[1]).filter((a) => a.z === 8)).toHaveLength(1);
    expect(ac.doc.neighbors(ac.ids[1]).map((a) => a.id)).toContain(next);
    // the chain zig-zags on (anti to the first bond); the O takes the other side
    expect(angleDeg(ac.doc, ac.ids[0], ac.ids[1], next)).toBeCloseTo(120, 0);
    const c = ac.doc.atoms.get(ac.ids[1])!, n = ac.doc.atoms.get(next)!;
    const o = ac.doc.neighbors(ac.ids[1]).find((a) => a.z === 8)!;
    expect(n.x).toBeGreaterThan(c.x);
    expect(o.y).toBeLessThan(c.y);
  });

  it('3 makes a phenyl, 6 a cyclohexyl and v a cyclopropyl', () => {
    const ph = chain(2);
    // on an end atom the atom itself becomes the ring's first carbon, as for 6
    grow(ph.doc, ph.ids[1], 'phenyl');
    expect(ph.doc.atoms.size).toBe(7);
    expect([...ph.doc.bonds.values()].filter((b) => b.order === 2)).toHaveLength(3);
    const cy = chain(2);
    grow(cy.doc, cy.ids[1], 'cyclohexyl');
    expect(cy.doc.atoms.size).toBe(7);
    const cp = chain(2);
    grow(cp.doc, cp.ids[1], 'cyclopropyl');
    expect(cp.doc.atoms.size).toBe(5);
  });

  it('every kind works on a lone atom and on a branch point', () => {
    for (const kind of SPROUT_KINDS) {
      const doc = new Doc();
      const a = doc.edit('a', () => doc.addAtom(0, 0));
      expect(grow(doc, a.id, kind), kind).not.toBeNull();
      const { doc: d2, ids } = chain(3);
      grow(d2, ids[1], 'bond');
      expect(grow(d2, ids[1], kind), kind).not.toBeNull();
    }
  });
});

describe('numbering', () => {
  it('gives the smallest number not used in the same structure', () => {
    const { doc, ids } = chain(4);
    const num = (a: { atomNumber?: string }) => a.atomNumber;
    expect(nextNumber(doc, ids[0], num)).toBe(1);
    doc.edit('n', () => { doc.updateAtom(ids[1], { atomNumber: '1' }); doc.updateAtom(ids[2], { atomNumber: '3' }); });
    expect(nextNumber(doc, ids[0], num)).toBe(2);
    // another structure's numbers don't count
    const other = doc.edit('o', () => doc.addAtom(500, 500));
    expect(nextNumber(doc, other.id, num)).toBe(1);
  });
});

describe('keys on a bond', () => {
  it('9 and 0 fuse the two chairs', () => {
    const make = () => {
      const { doc, ids } = chain(2);
      return { doc, bond: doc.bondBetween(ids[0], ids[1])!.id };
    };
    const a = make(), b = make();
    a.doc.edit('chair', () => fuseChair(a.doc, a.bond, false));
    b.doc.edit('chair', () => fuseChair(b.doc, b.bond, true));
    expect(a.doc.atoms.size).toBe(6);
    expect(b.doc.atoms.size).toBe(6);
    expect(a.doc.bonds.size).toBe(6);
    const pos = (d: Doc) => [...d.atoms.values()].map((x) => `${x.x.toFixed(1)},${x.y.toFixed(1)}`).sort().join(' ');
    expect(pos(a.doc)).not.toBe(pos(b.doc));
  });
});

describe('Join (Ctrl+J)', () => {
  it('moves the smaller structure so two atoms become one', () => {
    const doc = new Doc();
    const ids = doc.edit('two', () => {
      const p = doc.addAtom(0, 0), q = doc.addAtom(L, 0), r = doc.addAtom(2 * L, 0);
      doc.addBond(p.id, q.id);
      doc.addBond(q.id, r.id);
      const s = doc.addAtom(200, 50), t = doc.addAtom(200 + L, 50);
      doc.addBond(s.id, t.id);
      return [p.id, q.id, r.id, s.id, t.id];
    });
    const kept = doc.edit('join', () => joinAtoms(doc, ids[3], ids[2]));
    expect(kept).toBe(ids[2]); // the three-atom chain stays put
    expect(doc.atoms.size).toBe(4);
    expect(doc.bonds.size).toBe(3);
    expect(doc.atoms.get(ids[2])!.x).toBeCloseTo(2 * L, 9);
    expect(doc.atoms.get(ids[4])!.x).toBeCloseTo(3 * L, 9);
    expect(doc.atoms.get(ids[4])!.y).toBeCloseTo(0, 9);
  });

  it('closes a ring when both atoms are in one structure', () => {
    const { doc, ids } = chain(7);
    doc.edit('join', () => joinAtoms(doc, ids[0], ids[6]));
    expect(doc.atoms.size).toBe(6);
    expect(doc.bonds.size).toBe(6);
    expect(doc.fragments()).toHaveLength(1);
  });

  it('lays one bond on another, fusing the rings on opposite sides', () => {
    const doc = new Doc();
    const r1 = ring(doc, 100, 100, 6);
    const r2 = ring(doc, 300, 140, 5);
    const b1 = doc.bondBetween(r1[0], r1[1])!.id, b2 = doc.bondBetween(r2[0], r2[1])!.id;
    expect(doc.edit('join', () => joinBonds(doc, b1, b2))).toBe(true);
    expect(doc.atoms.size).toBe(9);
    expect(doc.bonds.size).toBe(10);
    // no two atoms on top of each other
    const all = [...doc.atoms.values()];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) expect(dist(all[i], all[j])).toBeGreaterThan(0.5 * L);
    // the six-membered ring didn't move
    expect(doc.atoms.get(r1[0])).toBeDefined();
  });

  it("won't join bonds of the same structure", () => {
    const doc = new Doc();
    const r = ring(doc, 100, 100, 6);
    expect(joinBonds(doc, doc.bondBetween(r[0], r[1])!.id, doc.bondBetween(r[3], r[4])!.id)).toBe(false);
  });

  it('drops a bond that would double up when atoms merge', () => {
    const doc = new Doc();
    const [a, b, c] = doc.edit('t', () => {
      const p = doc.addAtom(0, 0), q = doc.addAtom(L, 0), r = doc.addAtom(L, 1);
      doc.addBond(p.id, q.id);
      doc.addBond(p.id, r.id, 2);
      return [p.id, q.id, r.id];
    });
    doc.edit('m', () => mergeAtom(doc, b, c));
    expect(doc.bonds.size).toBe(1);
    expect(doc.bondBetween(a, b)!.order).toBe(1);
  });
});
