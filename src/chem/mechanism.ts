// Electron-pushing arrows for mechanisms. Drawn with the curved-arrow tools from an atom (its
// lone pair) or a bond (its electrons) to an atom or a bond, the arrow snaps the way chemists
// draw them: it starts just outside the lone pair or on the middle of the bond, bends away from
// the structure, and stops short of the atom it points at. The result is an ordinary curved
// arrow, so its ends and bend can still be changed by hand.

import type { Doc } from '../model';
import type { Rect, Vec } from '../geom';
import { add, angleOf, arcCenter, DEG, dist, dot, fromAngle, mul, norm, normAngle, perp, sub } from '../geom';
import type { Measure } from '../editor/arrange';

/** Where an electron-pushing arrow starts or ends. */
export type PushEnd = { kind: 'atom'; id: number } | { kind: 'bond'; id: number } | { kind: 'point'; p: Vec };

/** Heads on a tight loop are smaller (in line widths), so they fit the curl. */
export const SMALL_HEAD = { length: 7, width: 2 };

export interface PushArrow {
  tail: Vec; head: Vec; sweep: number;
  /** A tight loop, drawn with a smaller head. */
  small?: boolean;
}

/** How far past an atom's label (or from a bare carbon) an arrow stops, in bond lengths. */
const CLEAR = 0.14;
const BARE = 0.24;

/** How far from an atom's centre its label reaches in direction d (0 for a bare carbon). */
function labelReach(c: Vec, boxes: Rect[], d: Vec): number {
  let reach = 0;
  for (const b of boxes) {
    // walk out along d until leaving the box
    for (let t = 0; t < 200; t += 0.5) {
      const p = add(c, mul(d, t));
      if (p.x < b.x1 || p.x > b.x2 || p.y < b.y1 || p.y > b.y2) { reach = Math.max(reach, t); break; }
    }
  }
  return reach;
}

/** How far from an atom an arrow should stop when it leaves or reaches it along d. */
function stopAt(doc: Doc, m: Measure, id: number, d: Vec): number {
  const a = doc.atoms.get(id)!;
  const L = doc.style.bondLength;
  const boxes = m.atomBoxes(a);
  return boxes.length ? labelReach(a, boxes, d) + CLEAR * L : BARE * L;
}

const centreOf = (doc: Doc, e: PushEnd): Vec => {
  if (e.kind === 'point') return e.p;
  if (e.kind === 'atom') return doc.atoms.get(e.id)!;
  const b = doc.bonds.get(e.id)!;
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
};

/** Directions of the bonds round an atom. */
const bondDirs = (doc: Doc, id: number): Vec[] => doc.neighbors(id).map((n) => norm(sub(n, doc.atoms.get(id)!)));

const angleBetween = (a: Vec, b: Vec) => Math.abs(normAngle(angleOf(a) - angleOf(b)));

/**
 * Which way a lone pair on this atom points: into the widest open space between its bonds,
 * leaning towards where the arrow is going.
 */
export function lonePairDir(doc: Doc, id: number, toward: Vec): Vec {
  const a = doc.atoms.get(id)!;
  const dirs = bondDirs(doc, id);
  const want = norm(sub(toward, a));
  let best = want, bestScore = -Infinity;
  for (let k = 0; k < 24; k++) {
    const d = fromAngle(k * 15 * DEG);
    const open = dirs.length ? Math.min(...dirs.map((b) => angleBetween(d, b))) : Math.PI;
    const score = Math.min(open, 80 * DEG) - 0.45 * angleBetween(d, want);
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** The middle of the atoms near a point (the structure an arrow should bend away from). */
function localCentre(doc: Doc, around: Vec, reach: number, skip: Set<number>): Vec | null {
  let x = 0, y = 0, n = 0;
  for (const a of doc.atoms.values()) {
    if (skip.has(a.id) || dist(a, around) > reach) continue;
    x += a.x; y += a.y; n++;
  }
  return n ? { x: x / n, y: y / n } : null;
}

/** The middle of an arc's span (to see which side it bends to). */
function arcMid(tail: Vec, head: Vec, sweep: number): Vec {
  const { center, radius } = arcCenter(tail, head, sweep);
  return add(center, fromAngle(angleOf(sub(tail, center)) + sweep / 2, radius));
}

/**
 * The electron-pushing arrow from one end to the other. `side` (+1 or −1) bends it towards the
 * left or right of the line from start to end; leave it out to bend it away from the structure.
 */
export function pushArrow(doc: Doc, m: Measure, from: PushEnd, to: PushEnd, side?: number): PushArrow | null {
  const L = doc.style.bondLength;
  const c0 = centreOf(doc, from), c1 = centreOf(doc, to);
  if (dist(c0, c1) < 1e-6 && from.kind !== 'atom') return null;

  // where the arrow starts: outside the lone pair, or on the middle of the bond
  let tail = c0;
  let lean: Vec | null = null;
  if (from.kind === 'atom') {
    const d = lonePairDir(doc, from.id, c1);
    tail = add(c0, mul(d, stopAt(doc, m, from.id, d)));
    lean = d;
  }
  const chord = dist(tail, c1);
  if (chord < 1e-6) return null;
  const u = norm(sub(c1, tail));
  const left = perp(u);

  // which way it bends: as asked; else the way the lone pair points; else away from the structure
  let bend = side;
  if (bend === undefined && lean && Math.abs(dot(lean, left)) > 0.2) bend = Math.sign(dot(lean, left));
  if (bend === undefined) {
    const skip = new Set<number>();
    if (from.kind === 'bond') { const b = doc.bonds.get(from.id)!; skip.add(b.a1).add(b.a2); }
    const mid = { x: (tail.x + c1.x) / 2, y: (tail.y + c1.y) / 2 };
    const centre = localCentre(doc, mid, 1.6 * L, skip);
    bend = centre && Math.abs(dot(sub(centre, mid), left)) > 0.05 * L ? -Math.sign(dot(sub(centre, mid), left)) : 1;
  }
  // two bonds of one atom (C–H to C–C in an elimination): bend into the open angle between them
  if (side === undefined && from.kind === 'bond' && to.kind === 'bond') {
    const b0 = doc.bonds.get(from.id)!, b1 = doc.bonds.get(to.id)!;
    const shared = [b0.a1, b0.a2].find((x) => x === b1.a1 || x === b1.a2);
    if (shared !== undefined) {
      const v = doc.atoms.get(shared)!;
      bend = dot(sub(v, tail), left) > 0 ? -1 : 1;
    }
  }
  const out = mul(left, bend ?? 1);

  // a bond's electrons moving onto one of its own atoms (C=O to O, C–Br to Br): a short loop
  // from beside the bond's middle round to beside the atom
  if (to.kind === 'atom' && chord < 0.9 * L) {
    const t2 = add(tail, mul(out, 0.1 * L));
    // try heads round the atom's outer side and loops of a few sizes; keep the one whose head
    // points most nearly at the atom
    let best: PushArrow | null = null, bestScore = Infinity;
    const hl = doc.style.lineWidth * SMALL_HEAD.length;
    for (const phi of [-20, 0, 20, 40, 60, 80, 100]) {
      const d = add(mul(out, Math.cos(phi * DEG)), mul(u, Math.sin(phi * DEG)));
      for (const extra of [0, 0.12 * L, 0.24 * L]) {
        const h2 = add(c1, mul(d, stopAt(doc, m, to.id, d) + extra));
        for (const size of [150, 180, 210, 240]) {
          for (const sgn of [1, -1]) {
            const sw = sgn * size * DEG;
            if (dot(sub(arcMid(t2, h2, sw), t2), out) <= 0) continue;
            const { center, radius } = arcCenter(t2, h2, sw);
            // the head points from where its base meets the arc to its tip (as it is drawn)
            const back = Math.min(Math.abs(sw) / 2, (hl * 0.8) / radius);
            const base = add(center, fromAngle(angleOf(sub(h2, center)) - sgn * back, radius));
            const score = angleBetween(sub(h2, base), sub(c1, h2)) + 0.002 * size + 0.8 * extra / L;
            if (score < bestScore) { bestScore = score; best = { tail: t2, head: h2, sweep: sw, small: true }; }
          }
        }
      }
    }
    if (best) return best;
  }

  // off the bond lines: a bond's electrons leave from beside it, and a new bond is pointed at
  // from the side the arrow comes from
  if (from.kind === 'bond') tail = add(tail, mul(out, 0.08 * L));
  let end = c1;
  if (to.kind === 'bond') {
    const b = doc.bonds.get(to.id)!;
    let n = perp(norm(sub(doc.atoms.get(b.a2)!, doc.atoms.get(b.a1)!)));
    if (dot(sub(tail, c1), n) < 0) n = mul(n, -1);
    end = add(c1, mul(n, 0.12 * L));
  }

  // a short hop curls more than a long one
  const sweepSize = chord < 1.6 * L ? 120 * DEG : 90 * DEG;
  // the sign of the sweep that bends towards `bend`
  const sMid = arcMid(tail, end, sweepSize);
  let sweep = dot(sub(sMid, tail), out) > 0 ? sweepSize : -sweepSize;

  // stop short of an atom at the end, staying on the same circle
  let head = end;
  if (to.kind === 'atom') {
    const { center, radius } = arcCenter(tail, c1, sweep);
    // the arrow arrives along the circle; step back from the atom until clear of its label
    const a1 = angleOf(sub(tail, center)) + sweep;
    let trim = 0;
    for (let i = 0; i < 60; i++) {
      const p = add(center, fromAngle(a1 - Math.sign(sweep) * trim, radius));
      const d = norm(sub(p, c1));
      if (dist(p, c1) >= stopAt(doc, m, to.id, d)) break;
      trim += 1.5 * DEG;
    }
    if (trim < Math.abs(sweep) - 10 * DEG) {
      sweep -= Math.sign(sweep) * trim;
      head = add(center, fromAngle(a1 - Math.sign(sweep) * trim, radius));
    }
  }
  return { tail, head, sweep };
}
