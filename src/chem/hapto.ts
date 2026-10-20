// Hapto (η) bonds: a metal bonded to a ring or a π-bond as a whole (η⁵-cyclopentadienyl,
// η⁶-arene, η³-allyl, η²-alkene, an agostic C–H). The bond runs from the metal to a
// multicentre point in the middle of the atoms it holds (Atom.multi, saved for ChemDraw as a
// MultiAttachment node), and n in ηⁿ is how many atoms that is (IUPAC Red Book IR-10.2.5.1).

import type { Atom, Bond, BondDisplay, Doc } from '../model';
import { isCentre, isMetalAtom } from '../model';
import { Vec, dist, distToSegment } from '../geom';
import { ringsThroughBond } from './aromatic';

const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** ηⁿ, as written before a ligand's name or formula. */
export function haptoText(n: number): string {
  return 'η' + String(n).split('').map((d) => SUP[Number(d)]).join('');
}

/** How many atoms a multicentre point stands for (its n in ηⁿ). */
export const hapticity = (c: Atom): number => c.multi?.length ?? 1;

/** Twice the signed area of a polygon (positive when its points run clockwise on screen). */
function area2(pts: Vec[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    s += p.x * q.y - q.x * p.y;
  }
  return s;
}

function inside(p: Vec, pts: Vec[]): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** The smallest ring drawn round a point (its atoms in order), or null. */
export function ringAround(doc: Doc, p: Vec): number[] | null {
  const L = doc.style.bondLength || 14.4;
  let best: number[] | null = null, bestArea = Infinity;
  const seen = new Set<number>();
  for (const a of doc.atomsNear(p, 2.2 * L)) {
    if (a.multi) continue;
    for (const bid of doc.adj.get(a.id) ?? []) {
      if (seen.has(bid)) continue;
      seen.add(bid);
      for (const ring of ringsThroughBond(doc, bid)) {
        if (ring.some((id) => doc.atoms.get(id)?.multi)) continue;
        const pts = ring.map((id) => doc.atoms.get(id)!);
        if (!inside(p, pts)) continue;
        const ar = Math.abs(area2(pts));
        if (ar < bestArea) { bestArea = ar; best = ring; }
      }
    }
  }
  return best;
}

/**
 * The π-system a hapto bond drawn to `p` would hold: the multicentre point already there, the
 * ring round the point, or the bond the point is on (η²). Atoms in `skip` (the metal itself)
 * are never part of it.
 */
export function haptoTarget(doc: Doc, p: Vec, skip?: number): { centre?: Atom; atoms: number[]; at: Vec } | null {
  const L = doc.style.bondLength || 14.4;
  for (const a of doc.atomsNear(p, 0.35 * L)) if (a.multi && a.id !== skip) return { centre: a, atoms: a.multi, at: a };
  // a bond under the pointer: η² (an alkene, an alkyne, an agostic C–H)
  let bb: Bond | null = null, bd = 0.22 * L;
  for (const b of doc.bondsNear(p, bd)) {
    if (b.a1 === skip || b.a2 === skip) continue;
    const q = doc.atoms.get(b.a1), r = doc.atoms.get(b.a2);
    if (!q || !r || q.multi || r.multi || isMetalAtom(q) || isMetalAtom(r)) continue;
    const d = distToSegment(p, q, r);
    if (d < bd) { bd = d; bb = b; }
  }
  if (bb) {
    const q = doc.atoms.get(bb.a1)!, r = doc.atoms.get(bb.a2)!;
    return { atoms: [bb.a1, bb.a2], at: { x: (q.x + r.x) / 2, y: (q.y + r.y) / 2 } };
  }
  const ring = ringAround(doc, p);
  if (ring && !ring.includes(skip ?? -1)) {
    const c = doc.centreOf({ multi: ring })!;
    // well inside the ring, not just near its edge
    const rim = Math.min(...ring.map((id) => dist(doc.atoms.get(id)!, c)));
    if (dist(p, c) <= rim * 0.8) return { atoms: ring, at: c };
  }
  return null;
}

/** The multicentre point standing for these atoms, made if there isn't one. Call inside an edit. */
export function centreFor(doc: Doc, atoms: number[], scale?: number): Atom {
  const want = [...new Set(atoms)].sort((a, b) => a - b);
  const key = want.join(' ');
  for (const id of doc.centresOf.get(want[0]) ?? []) {
    const c = doc.atoms.get(id);
    if (c?.multi && [...c.multi].sort((a, b) => a - b).join(' ') === key) return c;
  }
  const at = doc.centreOf({ multi: want })!;
  return doc.addAtom(at.x, at.y, 0, { multi: atoms.slice(), ...(scale && scale !== 1 ? { s: scale } : {}) });
}

/**
 * Bond an atom (the metal) to the middle of these atoms (a ring, a π-bond, an allyl), as one
 * hapto bond. With two or more atoms; one atom gets an ordinary bond. Call inside an edit.
 */
export function bondHapto(doc: Doc, metal: number, atoms: number[], display: BondDisplay = 'solid'): Bond | null {
  const list = [...new Set(atoms)].filter((id) => id !== metal && doc.atoms.has(id) && !doc.atoms.get(id)!.multi);
  if (!list.length) return null;
  const m = doc.atoms.get(metal)!;
  if (list.length === 1) return doc.bondBetween(metal, list[0]) ?? doc.addBond(metal, list[0], 1, display, m.s && m.s !== 1 ? { s: m.s } : {});
  const c = centreFor(doc, list, m.s);
  return doc.bondBetween(metal, c.id) ?? doc.addBond(metal, c.id, 1, display, m.s && m.s !== 1 ? { s: m.s } : {});
}

/** The hapto bonds of a metal: each with its multicentre point. */
export function haptoBonds(doc: Doc, metal: number): { bond: Bond; centre: Atom }[] {
  const out: { bond: Bond; centre: Atom }[] = [];
  for (const bid of doc.adj.get(metal) ?? []) {
    const b = doc.bonds.get(bid)!;
    const c = doc.atoms.get(b.a1 === metal ? b.a2 : b.a1);
    if (c && isCentre(c)) out.push({ bond: b, centre: c });
  }
  return out;
}

/** The bond's multicentre end, if it is a hapto bond. */
export function centreEnd(doc: Doc, b: Bond): Atom | null {
  const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
  return p?.multi ? p : q?.multi ? q : null;
}

/**
 * Turn a hapto bond into one bond to each of its atoms (some draw ferrocene that way), or
 * bonds from a metal to two or more of these atoms into one hapto bond. Call inside an edit.
 */
export function splitHapto(doc: Doc, bondId: number): number[] {
  const b = doc.bonds.get(bondId);
  if (!b) return [];
  const c = centreEnd(doc, b);
  if (!c) return [];
  const metal = c.id === b.a1 ? b.a2 : b.a1;
  const out: number[] = [];
  doc.removeBond(bondId);
  for (const id of c.multi!) if (!doc.bondBetween(metal, id)) out.push(doc.addBond(metal, id, 1, b.display === 'dative' ? 'solid' : b.display, b.s ? { s: b.s } : {}).id);
  return out;
}
