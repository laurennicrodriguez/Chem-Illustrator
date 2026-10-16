// Electron-pushing arrows for mechanisms. Drawn with the curved-arrow tools from an atom (its
// lone pair) or a bond (its electrons) to an atom or a bond, the arrow snaps the way chemists
// draw them: it starts just outside the lone pair or on the middle of the bond, bends away from
// the structure, and stops short of the atom it points at. The result is an ordinary curved
// arrow, so its ends and bend can still be changed by hand.

import type { Arrow, Doc, Shape } from '../model';
import type { Rect, Vec } from '../geom';
import { add, angleOf, arcCenter, DEG, dist, distToSegment, dot, fromAngle, mul, norm, normAngle, perp, sub } from '../geom';
import type { Measure } from '../editor/arrange';

/** Where an electron-pushing arrow starts or ends: an atom, a bond, a drawn lone pair (a symbol shape) or a free point. */
export type PushEnd = { kind: 'atom'; id: number } | { kind: 'bond'; id: number } | { kind: 'pair'; id: number } | { kind: 'point'; p: Vec };

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
  // the last point along d that is still inside any part of the label (O, H, charge...)
  let reach = 0;
  for (let t = 0; t < 60; t += 0.5) {
    const p = add(c, mul(d, t));
    if (boxes.some((b) => p.x >= b.x1 && p.x <= b.x2 && p.y >= b.y1 && p.y <= b.y2)) reach = t + 0.5;
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

const shapeCentre = (s: Shape): Vec => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

/** Is this shape a drawn lone pair? */
export const isLonePair = (s: Shape | undefined): s is Shape => !!s && s.kind === 'symbol' && s.symbol === 'LonePair';

/** The atom a drawn lone pair belongs to: the nearest within most of a bond length. */
export function pairOwner(doc: Doc, pair: Shape): number | null {
  const c = shapeCentre(pair);
  let best: number | null = null, bestD = 0.7 * doc.style.bondLength;
  for (const a of doc.atoms.values()) { const d = dist(a, c); if (d < bestD) { bestD = d; best = a.id; } }
  return best;
}

/** The lone pairs drawn on an atom. */
export function pairsOn(doc: Doc, id: number): Shape[] {
  const a = doc.atoms.get(id);
  if (!a) return [];
  const L = doc.style.bondLength;
  return [...doc.shapes.values()].filter((s) => isLonePair(s) && dist(shapeCentre(s), a) < 0.7 * L && pairOwner(doc, s) === id);
}

const centreOf = (doc: Doc, e: PushEnd): Vec => {
  if (e.kind === 'point') return e.p;
  if (e.kind === 'pair') return shapeCentre(doc.shapes.get(e.id)!);
  if (e.kind === 'atom') return doc.atoms.get(e.id)!;
  const b = doc.bonds.get(e.id)!;
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
};

/** Directions of the bonds round an atom. */
const bondDirs = (doc: Doc, id: number): Vec[] => doc.neighbors(id).map((n) => norm(sub(n, doc.atoms.get(id)!)));

/** The angle between two directions, 0 to π. */
const angleBetween = (a: Vec, b: Vec) => { const d = normAngle(angleOf(a) - angleOf(b)); return Math.min(d, 2 * Math.PI - d); };

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

/** Which side of the line from tail to head an arrow bends to, as pushArrow's `side` counts it. */
export function bendSide(r: Pick<Arrow, 'tail' | 'head' | 'sweep'>): number {
  const u = norm(sub(r.head, r.tail));
  const mid = { x: (r.tail.x + r.head.x) / 2, y: (r.tail.y + r.head.y) / 2 };
  return dot(sub(arcMid(r.tail, r.head, r.sweep), mid), perp(u)) >= 0 ? 1 : -1;
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
  let c0 = centreOf(doc, from);
  const c1 = centreOf(doc, to);
  if (dist(c0, c1) < 1e-6 && from.kind !== 'atom') return null;

  // an atom with lone pairs drawn on it: the arrow starts from the one facing where it goes
  if (from.kind === 'atom') {
    const a = doc.atoms.get(from.id)!;
    const want = norm(sub(c1, a));
    const pairs = pairsOn(doc, from.id).map((s) => ({ s, d: norm(sub(shapeCentre(s), a)) })).filter((x) => dot(x.d, want) > Math.cos(110 * DEG));
    pairs.sort((x, y) => dot(y.d, want) - dot(x.d, want));
    if (pairs.length) { from = { kind: 'pair', id: pairs[0].s.id }; c0 = centreOf(doc, from); }
  }

  // where the arrow starts: at a drawn lone pair, outside the lone pair, or on the middle of the bond
  let tail = c0;
  let lean: Vec | null = null;
  if (from.kind === 'atom') {
    const d = lonePairDir(doc, from.id, c1);
    tail = add(c0, mul(d, stopAt(doc, m, from.id, d)));
    lean = d;
  } else if (from.kind === 'pair') {
    const pair = doc.shapes.get(from.id)!;
    const owner = pairOwner(doc, pair);
    const pc = shapeCentre(pair);
    const d = owner !== null ? norm(sub(pc, doc.atoms.get(owner)!)) : norm(sub(c1, pc));
    // just outside the two dots
    tail = add(pc, mul(d, 0.09 * L));
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

  // try both sides (or the one asked for) and a range of curls; keep the arc that stays clear of
  // the structure, preferring the usual bend and curl
  const prefer = chord < 1.6 * L ? 120 * DEG : 90 * DEG;
  const usual = bend ?? 1;
  const sides = side !== undefined ? [side] : [usual, -usual];
  const skip = endAtoms(doc, from, to);
  let best: PushArrow | null = null, bestScore = Infinity;
  for (const sd of sides) {
    const o = mul(left, sd);
    // a bond's electrons leave from beside it, on the side the arrow bends to
    const t0 = from.kind === 'bond' ? add(c0, mul(o, 0.08 * L)) : tail;
    let end = c1;
    if (to.kind === 'bond') {
      // a new bond is pointed at from the side the arrow comes from
      const b = doc.bonds.get(to.id)!;
      let n = perp(norm(sub(doc.atoms.get(b.a2)!, doc.atoms.get(b.a1)!)));
      if (dot(sub(t0, c1), n) < 0) n = mul(n, -1);
      end = add(c1, mul(n, 0.12 * L));
    }
    for (const deg of [60, 75, 90, 105, 120, 135, 150]) {
      const size = deg * DEG;
      const sweep0 = dot(sub(arcMid(t0, end, size), t0), o) > 0 ? size : -size;
      const arc = to.kind === 'atom' ? trimHead(doc, m, t0, c1, sweep0, to.id) : { head: end, sweep: sweep0 };
      if (!arc) continue;
      const score = arcClash(doc, m, t0, arc.head, arc.sweep, skip) + 0.35 * Math.abs(size - prefer) / (90 * DEG) + (sd !== usual ? 0.25 : 0);
      if (score < bestScore) { bestScore = score; best = { tail: t0, head: arc.head, sweep: arc.sweep }; }
    }
  }
  return best;
}

/** Stop an arc short of the atom at its end, staying on the same circle, clear of its label. */
function trimHead(doc: Doc, m: Measure, tail: Vec, c1: Vec, sweep: number, id: number): { head: Vec; sweep: number } | null {
  const { center, radius } = arcCenter(tail, c1, sweep);
  // the arrow arrives along the circle; step back from the atom until clear of its label
  const a1 = angleOf(sub(tail, center)) + sweep;
  let trim = 0;
  for (let i = 0; i < 60; i++) {
    const p = add(center, fromAngle(a1 - Math.sign(sweep) * trim, radius));
    const d = norm(sub(p, c1));
    if (dist(p, c1) >= stopAt(doc, m, id, d)) break;
    trim += 1.5 * DEG;
  }
  if (trim >= Math.abs(sweep) - 10 * DEG) return null;
  return { head: add(center, fromAngle(a1 - Math.sign(sweep) * trim, radius)), sweep: sweep - Math.sign(sweep) * trim };
}

/** The atoms an arrow starts or ends on (it is meant to be near those). */
function endAtoms(doc: Doc, ...ends: PushEnd[]): Set<number> {
  const out = new Set<number>();
  for (const e of ends) {
    if (e.kind === 'atom') out.add(e.id);
    else if (e.kind === 'bond') { const b = doc.bonds.get(e.id); if (b) out.add(b.a1).add(b.a2); }
    else if (e.kind === 'pair') { const s = doc.shapes.get(e.id); const o = s && pairOwner(doc, s); if (o != null) out.add(o); }
  }
  return out;
}

/**
 * How badly an arc runs into things: atoms (and their labels), bonds and lone pairs and other
 * symbols it passes too close to, away from its own two ends. 0 when it is clear of everything.
 */
export function arcClash(doc: Doc, m: Measure, tail: Vec, head: Vec, sweep: number, own: Set<number> = new Set()): number {
  const L = doc.style.bondLength;
  const { center, radius } = arcCenter(tail, head, sweep);
  const a0 = angleOf(sub(tail, center));
  const span = dist(tail, head) + radius;
  const mid = { x: (tail.x + head.x) / 2, y: (tail.y + head.y) / 2 };
  const near = (p: Vec) => dist(p, mid) < span + L;
  const atoms = [...doc.atoms.values()].filter(near);
  const labelled = new Map(atoms.map((a) => [a.id, m.atomBoxes(a)]));
  const bonds = [...doc.bonds.values()].map((b) => [doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, b] as const).filter(([p, q]) => near(p) || near(q));
  const symbols = [...doc.shapes.values()].filter((s) => s.kind === 'symbol').map(shapeCentre).filter(near);
  let bad = 0;
  const N = 28;
  for (let i = 1; i < N; i++) {
    const p = add(center, fromAngle(a0 + (sweep * i) / N, radius));
    // right by its ends, an arrow is meant to touch what it starts and ends on
    const endGap = Math.min(dist(p, tail), dist(p, head));
    if (endGap < 0.16 * L) continue;
    const hurt = (gap: number, want: number) => { if (gap < want) bad += ((want - gap) / want) ** 2; };
    for (const a of atoms) {
      const boxes = labelled.get(a.id)!;
      if (boxes.length) {
        // inside or close to a label
        const g = Math.min(...boxes.map((b) => Math.hypot(Math.max(b.x1 - p.x, 0, p.x - b.x2), Math.max(b.y1 - p.y, 0, p.y - b.y2))));
        hurt(g, own.has(a.id) && endGap < 0.4 * L ? 0.04 * L : 0.12 * L);
      } else if (!own.has(a.id) || endGap > 0.4 * L) hurt(dist(p, a), 0.14 * L);
    }
    for (const [p1, p2, b] of bonds) {
      const mine = own.has(b.a1) || own.has(b.a2);
      if (mine && endGap < 0.4 * L) continue;
      hurt(distToSegment(p, p1, p2), 0.1 * L);
    }
    for (const c of symbols) hurt(dist(p, c), 0.1 * L);
  }
  return bad;
}

/**
 * What an arrow end sits on: a drawn lone pair, a bond or an atom near the point, else the
 * point itself (Clean Up Arrow works out what an arrow was drawn from and to this way).
 */
export function pushEndAt(doc: Doc, m: Measure, p: Vec): PushEnd {
  const L = doc.style.bondLength;
  let best: PushEnd = { kind: 'point', p }, bestD = Infinity;
  for (const s of doc.shapes.values()) {
    if (!isLonePair(s)) continue;
    const d = dist(shapeCentre(s), p);
    if (d < 0.3 * L && d < bestD) { bestD = d; best = { kind: 'pair', id: s.id }; }
  }
  if (best.kind === 'pair') return best;
  for (const a of doc.atoms.values()) {
    const boxes = m.atomBoxes(a);
    const reach = (boxes.length ? 0.35 : 0.3) * L + (boxes.length ? Math.max(...boxes.map((b) => Math.max(dist(a, { x: b.x1, y: b.y1 }), dist(a, { x: b.x2, y: b.y2 })))) : 0);
    const d = dist(a, p);
    if (d < reach && d < bestD) { bestD = d; best = { kind: 'atom', id: a.id }; }
  }
  // a point near the middle of a bond is on the bond, even when an end atom is also near
  for (const b of doc.bonds.values()) {
    const p1 = doc.atoms.get(b.a1)!, p2 = doc.atoms.get(b.a2)!;
    const midB = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const d = dist(midB, p);
    if (d < 0.3 * L && (best.kind !== 'atom' || d < bestD)) { bestD = d; best = { kind: 'bond', id: b.id }; }
  }
  return best;
}

/**
 * Clean Up Arrow: a curved arrow redrawn from what its tail sits on (a lone pair, a bond, an
 * atom) to what its head points at, at a curl and on a side where it doesn't run into the
 * structure. Null when it can't tell what the arrow is drawn between.
 */
export function cleanUpArrow(doc: Doc, m: Measure, r: Pick<Arrow, 'tail' | 'head' | 'sweep'>): PushArrow | null {
  const from = pushEndAt(doc, m, r.tail);
  let to = pushEndAt(doc, m, r.head);
  if (to.kind !== 'point' && to.kind === from.kind && (to as { id: number }).id === (from as { id: number }).id) to = { kind: 'point', p: r.head };
  if (to.kind === 'pair') { const o = pairOwner(doc, doc.shapes.get(to.id)!); to = o !== null ? { kind: 'atom', id: o } : { kind: 'point', p: r.head }; }
  if (from.kind === 'point' && to.kind === 'point') return freeArc(doc, m, r);
  return pushArrow(doc, m, from, to);
}

/** An arrow between two free points: the same ends, on the side and curl that keep it clear. */
function freeArc(doc: Doc, m: Measure, r: Pick<Arrow, 'tail' | 'head' | 'sweep'>): PushArrow | null {
  if (dist(r.tail, r.head) < 1e-6) return null;
  let best: PushArrow | null = null, bestScore = Infinity;
  const usual = Math.sign(r.sweep) || 1;
  for (const sd of [usual, -usual]) {
    for (const deg of [45, 60, 75, 90, 105, 120, 135]) {
      const sweep = sd * deg * DEG;
      const score = arcClash(doc, m, r.tail, r.head, sweep) + 0.35 * Math.abs(deg - 90) / 90 + (sd !== usual ? 0.25 : 0);
      if (score < bestScore) { bestScore = score; best = { tail: r.tail, head: r.head, sweep }; }
    }
  }
  return best;
}

/**
 * Where a lone pair, radical dot or charge goes on an atom: in the widest open space between its
 * bonds and anything already sitting round it (`taken`), just clear of its label. Gives the
 * direction from the atom and the symbol's centre, `size` across.
 */
export function symbolSpot(doc: Doc, m: Measure, id: number, taken: Vec[], size: number): { dir: Vec; at: Vec } {
  const a = doc.atoms.get(id)!;
  const L = doc.style.bondLength;
  const avoid = [...bondDirs(doc, id), ...taken.map((p) => norm(sub(p, a)))];
  // with nothing round it, the first goes above (where people look for a charge or lone pair)
  let best = { x: 0, y: -1 }, bestOpen = -Infinity;
  for (let k = 0; k < 24; k++) {
    const d = fromAngle(-90 * DEG + k * 15 * DEG);
    // anything 100° clear is open enough (so a lone pair on an end atom sits off to the side,
    // not straight on from its bond); ties go to the direction nearest straight up, then right
    const open = Math.min(100 * DEG, avoid.length ? Math.min(...avoid.map((b) => angleBetween(d, b))) : Math.PI);
    if (open > bestOpen + 1e-6) { bestOpen = open; best = d; }
  }
  const boxes = m.atomBoxes(a);
  const reach = boxes.length ? labelReach(a, boxes, best) + 0.06 * L : 0.18 * L;
  return { dir: best, at: add(a, mul(best, reach + size / 2)) };
}
