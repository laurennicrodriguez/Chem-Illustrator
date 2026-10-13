// Join (Ctrl+J): two selected atoms, or two selected bonds, are put on top of each other and
// become one. The smaller structure moves onto the larger, as in ChemDraw.

import type { Doc } from '../model';
import { Vec, add, sub, mul, dot, perp, angleOf, len } from '../geom';

/**
 * Make `drop` part of `keep`: its bonds move over to `keep` (a bond that would double up an
 * existing one, or join `keep` to itself, is dropped) and `drop` is removed. Call inside an edit.
 */
export function mergeAtom(doc: Doc, keep: number, drop: number): void {
  if (keep === drop) return;
  for (const bid of [...(doc.adj.get(drop) ?? [])]) {
    const b = doc.bonds.get(bid)!;
    const other = b.a1 === drop ? b.a2 : b.a1;
    doc.removeBond(bid);
    if (other === keep || doc.bondBetween(keep, other)) continue;
    // keep the bond's direction, so a wedge still starts where it did
    const { id: _id, a1: _a1, a2: _a2, ...rest } = structuredClone(b);
    if (b.a1 === drop) doc.addBond(keep, other, b.order, b.display, rest);
    else doc.addBond(other, keep, b.order, b.display, rest);
  }
  doc.removeAtom(drop);
}

/** Move a set of atoms by a turn about `pivot` and then a shift. */
function moveRigid(doc: Doc, ids: Iterable<number>, pivot: Vec, turn: number, shift: Vec): void {
  const c = Math.cos(turn), s = Math.sin(turn);
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    const d = sub(a, pivot);
    doc.updateAtom(id, { x: pivot.x + d.x * c - d.y * s + shift.x, y: pivot.y + d.x * s + d.y * c + shift.y });
  }
}

function centroid(doc: Doc, ids: Set<number>): Vec {
  let x = 0, y = 0;
  for (const id of ids) { const a = doc.atoms.get(id)!; x += a.x; y += a.y; }
  return { x: x / ids.size, y: y / ids.size };
}

/**
 * Join two atoms: the smaller structure slides over so the atoms meet, then they become one.
 * Two atoms of the same structure close a ring where the first one is. Returns the atom kept.
 * Call inside an edit.
 */
export function joinAtoms(doc: Doc, a: number, b: number): number | null {
  if (a === b || !doc.atoms.has(a) || !doc.atoms.has(b)) return null;
  const fa = doc.fragmentOf(a), fb = doc.fragmentOf(b);
  let keep = a, drop = b;
  if (!fa.has(b)) {
    if (fb.size > fa.size) { keep = b; drop = a; }
    const k = doc.atoms.get(keep)!, d = doc.atoms.get(drop)!;
    moveRigid(doc, keep === a ? fb : fa, d, 0, sub(k, d));
  }
  mergeAtom(doc, keep, drop);
  return keep;
}

/**
 * Join two bonds: the smaller structure turns and slides so its bond lies on the other one,
 * on the far side from the larger structure (fusing the rings), then the atoms become one.
 * Bonds of the same structure, or sharing an atom, can't be joined. Call inside an edit.
 */
export function joinBonds(doc: Doc, b1: number, b2: number): boolean {
  const p = doc.bonds.get(b1), q = doc.bonds.get(b2);
  if (!p || !q || b1 === b2) return false;
  const f1 = doc.fragmentOf(p.a1), f2 = doc.fragmentOf(q.a1);
  if (f1.has(q.a1)) return false;
  // the larger structure stays
  let [keepB, moveB, keepF, moveF] = [p, q, f1, f2];
  if (f2.size > f1.size) [keepB, moveB, keepF, moveF] = [q, p, f2, f1];
  const k1 = doc.atoms.get(keepB.a1)!, k2 = doc.atoms.get(keepB.a2)!;
  const m1 = doc.atoms.get(moveB.a1)!, m2 = doc.atoms.get(moveB.a2)!;
  const kMid = mul(add(k1, k2), 0.5), mMid = mul(add(m1, m2), 0.5);
  // which side of the kept bond its own structure lies on
  const kNormal = perp(sub(k2, k1));
  const keepSide = Math.sign(dot(sub(centroid(doc, keepF), kMid), kNormal)) || 1;
  const mCentre = centroid(doc, moveF);
  // try both ways round; pick the one that puts the moved structure on the other side
  let best: { turn: number; pairs: [number, number][] } | null = null;
  let bestScore = Infinity;
  for (const flip of [false, true]) {
    const [from1, from2] = flip ? [m2, m1] : [m1, m2];
    const turn = angleOf(sub(k2, k1)) - angleOf(sub(from2, from1));
    const c = Math.cos(turn), s = Math.sin(turn);
    const d = sub(mCentre, mMid);
    const moved = add(kMid, { x: d.x * c - d.y * s, y: d.x * s + d.y * c });
    const side = dot(sub(moved, kMid), kNormal) / (len(kNormal) || 1);
    const score = side * keepSide; // negative is the far side
    if (score < bestScore) {
      bestScore = score;
      best = { turn, pairs: flip ? [[keepB.a1, moveB.a2], [keepB.a2, moveB.a1]] : [[keepB.a1, moveB.a1], [keepB.a2, moveB.a2]] };
    }
  }
  const { turn, pairs } = best!;
  moveRigid(doc, moveF, mMid, turn, sub(kMid, mMid));
  for (const [keep, drop] of pairs) mergeAtom(doc, keep, drop);
  return true;
}
