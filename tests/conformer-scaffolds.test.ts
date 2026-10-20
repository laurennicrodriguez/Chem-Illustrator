// Ring systems from the conformational-analysis literature, built the way a person would: one
// conformer template at a time, each fused onto a bond of the drawing. Every step must offer
// the fusion the real molecule has (trans or cis), and every ring of the finished drawing must
// still read as a real ring in 3-D (so the next fusion can follow on from it).
import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { templateById, placeTemplate, freePlacement } from '../src/chem/templates';
import { fusions3d, liftRing, templateRingBonds } from '../src/chem/fuse3d';
import type { Template } from '../src/chem/templates';

/** The template's ring atoms (in the order they go round, as the templates list them). */
const ringOnly = (t: Template, ids: number[]) => { const rb = templateRingBonds(t); const inRing = new Set([...rb].flatMap((k) => [t.bonds[k][0], t.bonds[k][1]])); return ids.filter((_, i) => inRing.has(i)); };

const L = 14.4;

/** A ring of the drawing: its atoms in order round it, and which of them it shares with the ring it was fused onto. */
interface Ring { ids: number[]; shared: number[] }

class Builder {
  doc = new Doc();
  rings: Ring[] = [];
  joins: (string | undefined)[] = [];
  start(id: string) {
    let ids: number[] = [];
    this.doc.bulk(() => { ids = placeTemplate(this.doc, templateById(id)!, freePlacement({ x: 0, y: 0 }, L)); });
    this.rings.push({ ids: ringOnly(templateById(id)!, ids), shared: [] });
    return this;
  }
  /**
   * Fuse a template onto ring `r`: on the bond `offset` places round from the bond it shares
   * (1: the next bond along, an angular fusion; 2: across, a linear one), or, on the first ring,
   * on its bond `offset`. `join`: the fusion wanted. Returns this for chaining.
   */
  fuse(id: string, r: number, offset: number, join: 'trans' | 'cis', dir: 1 | -1 = 1) {
    const ring = this.rings[r];
    const n = ring.ids.length;
    let k = offset;
    if (ring.shared.length === 2) {
      const [s1, s2] = ring.shared.map((a) => ring.ids.indexOf(a));
      // the shared bond as k → k+1 round the ring
      const base = (s1 + 1) % n === s2 ? s1 : s2;
      k = dir > 0 ? base + 1 + offset : base - 1 - offset;
    }
    const a = ring.ids[((k % n) + n) % n], b = ring.ids[(((k + 1) % n) + n) % n];
    const bond = this.doc.bondBetween(a, b);
    expect(bond, `bond ${a}-${b}`).toBeTruthy();
    const t = templateById(id)!;
    const fs = fusions3d(this.doc, t, bond!.id);
    expect(fs?.length, `fusions of ${id} onto ring ${r}`).toBeGreaterThan(0);
    const f = fs!.find((x) => x.join === join);
    expect(f, `a ${join} fusion of ${id} onto ring ${r} (have ${fs!.map((x) => x.join).join(', ')})`).toBeTruthy();
    let ids: number[] = [];
    this.doc.bulk(() => { ids = placeTemplate(this.doc, t, { origin: { x: 0, y: 0 }, scale: f!.len, angle: 0, mirror: false, pts: f!.pts }, { existing: f!.existing, noMerge: true }); });
    this.rings.push({ ids: ringOnly(t, ids), shared: [a, b] });
    this.joins.push(f!.join);
    return this;
  }
  /** The atoms shared by two rings, and the bonds between them. */
  fusionChain(): { atoms: number; bonds: number; ends: number } {
    const d = this.doc;
    const fused = [...d.atoms.keys()].filter((id) => (d.adj.get(id)?.length ?? 0) === 3);
    const set = new Set(fused);
    const bonds = [...d.bonds.values()].filter((b) => set.has(b.a1) && set.has(b.a2));
    const deg = (id: number) => bonds.filter((b) => b.a1 === id || b.a2 === id).length;
    return { atoms: fused.length, bonds: bonds.length, ends: fused.filter((id) => deg(id) === 1).length };
  }
  /** Every ring still reads as a ring in 3-D, and no two atoms ended up on top of each other. */
  check(atoms: number, rings: number) {
    expect(this.doc.atoms.size).toBe(atoms);
    expect(this.doc.bonds.size - this.doc.atoms.size + 1).toBe(rings);
    for (const r of this.rings) expect(liftRing(r.ids.map((id) => this.doc.atoms.get(id)!)), `ring ${r.ids}`).not.toBeNull();
    const pts = [...this.doc.atoms.values()];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y)).toBeGreaterThan(L * 0.15);
  }
}

describe('scaffolds from fused conformers', () => {
  it('trans- and cis-decalin', () => {
    new Builder().start('chair').fuse('chair', 0, 0, 'trans').check(10, 2);
    new Builder().start('chair').fuse('chair', 0, 0, 'cis').check(10, 2);
  });
  it('trans- and cis-hydrindane (the C/D rings of steroids, vitamin D)', () => {
    new Builder().start('chair').fuse('envelope', 0, 0, 'trans').check(9, 2);
    new Builder().start('chair').fuse('envelope', 0, 0, 'cis').check(9, 2);
  });
  it('perhydroanthracene and perhydrophenanthrene, trans-anti-trans', () => {
    new Builder().start('chair').fuse('chair', 0, 0, 'trans').fuse('chair', 1, 2, 'trans').check(14, 3);
    new Builder().start('chair').fuse('chair', 0, 0, 'trans').fuse('chair', 1, 1, 'trans').check(14, 3);
  });
  it('the 5α-steroid nucleus (A/B trans, B/C trans, C/D trans) and 5β (A/B cis)', () => {
    for (const ab of ['trans', 'cis'] as const) {
      const s = new Builder().start('chair').fuse('chair', 0, 0, ab).fuse('chair', 1, 1, 'trans').fuse('envelope', 2, 1, 'trans', 1);
      s.check(17, 4);
      // C5, C10, C9, C8, C14, C13 in a row (ring D on the far side of ring C from ring A)
      expect(s.fusionChain()).toEqual({ atoms: 6, bonds: 5, ends: 2 });
    }
  });
  it('a pentacyclic triterpene skeleton (oleanane: five chairs, D/E cis)', () => {
    const s = new Builder().start('chair').fuse('chair', 0, 0, 'trans').fuse('chair', 1, 1, 'trans').fuse('chair', 2, 1, 'trans', 1).fuse('chair', 3, 1, 'cis', 1);
    s.check(22, 5);
    // C5, C10, C9, C8, C14, C13, C18, C17 in a row: each ring on the far side of the one before
    expect(s.fusionChain()).toEqual({ atoms: 8, bonds: 7, ends: 2 });
  });
  it('perhydroazulene (the 5–7 rings of guaiane sesquiterpenes)', () => {
    new Builder().start('c7-twist-chair').fuse('envelope', 0, 0, 'cis').check(10, 2);
  });
  it('a decalin with a cyclohexene ring (half-chair) and a cyclohexanone', () => {
    new Builder().start('half-chair').fuse('chair', 0, 3, 'trans').check(10, 2);
    new Builder().start('cyclohexanone').fuse('chair', 0, 3, 'trans').check(11, 2);
  });
});
