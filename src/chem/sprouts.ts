// What the number and letter keys grow on an atom or a bond, as ChemDraw does it (checked in
// ChemDraw 25: what each key adds on an end atom, a middle atom and a branch point, and which
// atom the highlight moves to afterwards).

import type { Doc, Atom, BondDisplay } from '../model';
import { Vec, add, sub, mul, norm, dist, angleOf, fromAngle, DEG } from '../geom';
import { sproutDir, sproutPair, sprout, bondTo, bondLength, ringOnAtom, placeRing } from './chemgeom';
import { templateById, fusePlacements, crowdingOf, placeTemplate } from './templates';

export type SproutKind =
  | 'bond' | 'ring-bond' | 'carbonyl' | 'phenyl' | 'wedge' | 'hash-wedge' | 'cyclohexyl' | 'cyclopentyl'
  | 'cyclobutyl' | 'cyclopropyl' | 'methylidene' | 'dimethyl' | 'tbu' | 'alkyne' | 'sulfonyl';

export const SPROUT_KINDS: readonly SproutKind[] = [
  'bond', 'ring-bond', 'carbonyl', 'phenyl', 'wedge', 'hash-wedge', 'cyclohexyl', 'cyclopentyl',
  'cyclobutyl', 'cyclopropyl', 'methylidene', 'dimethyl', 'tbu', 'alkyne', 'sulfonyl',
];

/**
 * The smallest number from 1 up that no other atom of the same structure uses, for a new atom
 * number or attachment point number.
 */
export function nextNumber(doc: Doc, id: number, numberOf: (a: Atom) => string | number | undefined): number {
  const used = new Set<number>();
  for (const aid of doc.fragmentOf(id)) {
    if (aid === id) continue;
    const a = doc.atoms.get(aid);
    const n = a ? Number(numberOf(a)) : NaN;
    if (Number.isInteger(n)) used.add(n);
  }
  let n = 1;
  while (used.has(n)) n++;
  return n;
}

/** An atom in a six-membered ring with a double or aromatic bond (a benzene-type carbon). */
export function isAromaticAtom(doc: Doc, id: number): boolean {
  for (const bid of doc.adj.get(id) ?? []) {
    const b = doc.bonds.get(bid)!;
    if ((b.order === 2 || b.order === 1.5) && doc.ringThroughBond(bid, 6)?.length === 6) return true;
  }
  return false;
}

/**
 * The direction for 0 ("ring mode"): on an end atom, the other of the two 120° directions from
 * the one 1 uses (so 1 zig-zags and 0 curls back, as for a ring); elsewhere the same widest gap.
 */
export function ringModeDir(doc: Doc, id: number): Vec {
  const a = doc.atoms.get(id)!;
  const nb = doc.neighbors(id);
  const zig = sproutDir(doc, id);
  if (nb.length !== 1) return zig;
  const back = angleOf(sub(nb[0], a));
  const c1 = fromAngle(back + 120 * DEG), c2 = fromAngle(back - 120 * DEG);
  return dist(c1, zig) < dist(c2, zig) ? c2 : c1;
}

/**
 * Grow a group from an atom (call inside an edit). Returns the atom the highlight moves to: the
 * new end of a bond, the =CH2 of 8 (so 1 or 0 next gives E or Z), the new methyl of 4, the far
 * side of a new ring.
 */
export function sproutGroup(doc: Doc, id: number, kind: SproutKind): number | null {
  const a = doc.atoms.get(id);
  if (!a) return null;
  const deg = doc.degree(id);
  const aromatic = isAromaticAtom(doc, id);
  const busy = deg >= 3 || aromatic;
  const L = bondLength(doc, a);
  const far = (ids: number[]) => ids[Math.floor(ids.length / 2)];
  switch (kind) {
    case 'bond': return sprout(doc, id).id;
    case 'ring-bond': {
      // on an atom that already has two bonds, 0 reaches across a hexagon (√3 bond lengths)
      const len = deg >= 2 ? Math.sqrt(3) * L : L;
      return bondTo(doc, a, add(a, mul(ringModeDir(doc, id), len))).id;
    }
    case 'carbonyl': {
      if (deg === 2 && !aromatic) { sprout(doc, id, 2, 'solid', 8); return id; }
      const c = busy ? sprout(doc, sprout(doc, id).id) : sprout(doc, id);
      const [d1, d2] = sproutPair(doc, c.id);
      bondTo(doc, c, add(c, mul(d1, L)), 2, 'solid', 8);
      bondTo(doc, c, add(c, mul(d2, L)));
      return c.id;
    }
    case 'phenyl': {
      const base = deg >= 2 ? sprout(doc, id) : a;
      return far(placeRing(doc, ringOnAtom(base, sproutDir(doc, base.id), 6, L), { aromatic: true, existing: [base.id], scale: a.s }));
    }
    case 'wedge':
    case 'hash-wedge': {
      const disp: BondDisplay = kind === 'wedge' ? 'wedge' : 'hashWedge';
      if (aromatic) return sprout(doc, sprout(doc, id).id, 1, disp).id;
      if (deg === 1) {
        // an end atom gets a methyl on the zig-zag side and the wedge in the gap left
        const me = sprout(doc, id);
        sprout(doc, id, 1, disp);
        return me.id;
      }
      return sprout(doc, id, 1, disp).id;
    }
    case 'cyclohexyl':
    case 'cyclopentyl':
    case 'cyclobutyl':
    case 'cyclopropyl': {
      const n = kind === 'cyclohexyl' ? 6 : kind === 'cyclopentyl' ? 5 : kind === 'cyclobutyl' ? 4 : 3;
      const base = busy || n <= 4 ? sprout(doc, id) : a;
      return far(placeRing(doc, ringOnAtom(base, sproutDir(doc, base.id), n, L), { existing: [base.id], scale: a.s }));
    }
    case 'methylidene': {
      const base = busy ? sprout(doc, id) : a;
      return sprout(doc, base.id, 2).id;
    }
    case 'dimethyl': {
      const base = deg >= 3 ? sprout(doc, id) : a;
      const [d1, d2] = sproutPair(doc, base.id);
      bondTo(doc, base, add(base, mul(d1, L)));
      return bondTo(doc, base, add(base, mul(d2, L))).id;
    }
    case 'tbu': {
      const c = sprout(doc, id);
      const dir = norm(sub(c, a));
      for (const ang of [0, 90, -90]) bondTo(doc, c, add(c, mul(fromAngle(angleOf(dir) + ang * DEG), L)));
      return c.id;
    }
    case 'alkyne': {
      const c1 = sprout(doc, id);
      return bondTo(doc, c1, add(c1, mul(norm(sub(c1, a)), L)), 3).id;
    }
    case 'sulfonyl': {
      // An end atom becomes S with a methyl beyond it (R–SO2–Me); a middle atom becomes SO2
      // in place; on a ring or branch point a new SO2Me is grown.
      let s: Atom = a;
      let next = id;
      if (busy || deg === 0) {
        s = sprout(doc, id, 1, 'solid', 16);
        next = sprout(doc, s.id).id;
      } else {
        doc.updateAtom(id, { z: 16, label: null, fileLabel: false, charge: 0 });
        if (deg === 1) next = sprout(doc, id).id;
      }
      const [d1, d2] = sproutPair(doc, s.id);
      bondTo(doc, s, add(s, mul(d1, L)), 2, 'solid', 8);
      bondTo(doc, s, add(s, mul(d2, L)), 2, 'solid', 8);
      return next;
    }
  }
}

/**
 * Fuse a chair cyclohexane onto a bond: `second` picks the other chair (ChemDraw's 9 and 0).
 * The chair goes on whichever way round is least crowded. Call inside an edit.
 */
export function fuseChair(doc: Doc, bondId: number, second: boolean): number[] | null {
  const t = templateById('chair');
  const b = doc.bonds.get(bondId);
  if (!t?.fuse || !b) return null;
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  const ends = [[b.a1, b.a2], [b.a2, b.a1]];
  let best: { pl: ReturnType<typeof fusePlacements>[number]; ends: number[]; crowd: number } | null = null;
  fusePlacements(t, p, q).forEach((pl, i) => {
    if (pl.mirror !== second) return;
    const e = ends[i % 2];
    const crowd = crowdingOf(doc, t, pl, new Set(e));
    if (!best || crowd < best.crowd - 1e-9) best = { pl, ends: e, crowd };
  });
  if (!best) return null;
  const { pl, ends: e } = best;
  return placeTemplate(doc, t, pl, { existing: new Map([[t.fuse[0], e[0]], [t.fuse[1], e[1]]]), scale: b.s });
}
