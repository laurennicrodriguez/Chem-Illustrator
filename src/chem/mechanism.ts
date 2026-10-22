// Electron-pushing arrows for mechanisms. Drawn with the curved-arrow tools from an atom (its
// lone pair) or a bond (its electrons) to an atom or a bond, the arrow snaps the way chemists
// draw them: it starts just outside the lone pair or on the middle of the bond, bends away from
// the structure, and stops short of the atom it points at. The result is an ordinary curved
// arrow, so its ends and bend can still be changed by hand. Where one curve can't get round the
// structure (or an S-shaped arrow is asked for) it is drawn as an S: one Bézier curve that bends
// one way and then the other. The ends are pinned to what they start and end on (pins.ts), so
// the arrow goes with the structure when it is moved.

import type { Arrow, Doc, Pin, Shape } from '../model';
import type { Rect, Vec } from '../geom';
import { add, angleOf, arcCenter, DEG, dist, distToSegment, dot, fromAngle, mul, norm, normAngle, perp, sub } from '../geom';
import type { Measure } from '../editor/arrange';
import { bezPathAt, bezPoints, chordLocal, chordPoint } from '../objects';
import { makePin } from './pins';

/**
 * Where an electron-pushing arrow starts or ends: an atom, a bond, a drawn lone pair, radical
 * dot or negative charge (a symbol shape), the gap between two atoms where a new bond will form,
 * or a free point.
 */
export type PushEnd =
  | { kind: 'atom'; id: number } | { kind: 'bond'; id: number } | { kind: 'pair'; id: number }
  | { kind: 'gap'; a1: number; a2: number } | { kind: 'point'; p: Vec };

/** Heads on a tight loop are smaller (in line widths), so they fit the curl. */
export const SMALL_HEAD = { length: 7, width: 2 };

export interface PushArrow {
  tail: Vec; head: Vec; sweep: number;
  /** An S-shaped arrow's control points (as Arrow.bez); sweep is 0 then. */
  bez?: Vec[];
  /** A tight loop, drawn with a smaller head. */
  small?: boolean;
  /** What it was drawn from and to, as worked out (to pin its ends there). */
  start?: PushEnd;
  end?: PushEnd;
}

/** Choices for pushArrow: which side it bends to, and whether it is S-shaped. */
export interface PushOpts {
  /** +1 or −1: bend (the first bend, for an S) to the left or right of the line from start to end. */
  side?: number;
  /** Draw it as an S (two bends); otherwise an S only where one curve can't keep clear. */
  s?: boolean;
  /** Never an S (a single curve, even through the structure). */
  arcOnly?: boolean;
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

/** Is this shape drawn electrons an arrow can start from: a lone pair, a radical's dot or a circled minus? */
export const isElectrons = (s: Shape | undefined): s is Shape =>
  !!s && s.kind === 'symbol' && (s.symbol === 'LonePair' || s.symbol === 'Electron' || s.symbol === 'CircleMinus');

/** Is this shape a symbol that sits on an atom (lone pair, radical dot, circled charge)? */
export const isAtomSymbol = (s: Shape | undefined): s is Shape =>
  !!s && s.kind === 'symbol' && (s.symbol === 'CirclePlus' || isElectrons(s));

/** The atom a drawn lone pair belongs to: the nearest within most of a bond length. */
export function pairOwner(doc: Doc, pair: Shape): number | null {
  const c = shapeCentre(pair);
  let best: number | null = null, bestD = 0.7 * doc.style.bondLength;
  for (const a of doc.atoms.values()) { const d = dist(a, c); if (d < bestD) { bestD = d; best = a.id; } }
  return best;
}

/** The lone pairs (and radical dots and circled minus signs) drawn on an atom. */
export function pairsOn(doc: Doc, id: number): Shape[] {
  const a = doc.atoms.get(id);
  if (!a) return [];
  const L = doc.style.bondLength;
  return [...doc.shapes.values()].filter((s) => isElectrons(s) && dist(shapeCentre(s), a) < 0.7 * L && pairOwner(doc, s) === id);
}

const centreOf = (doc: Doc, e: PushEnd): Vec => {
  if (e.kind === 'point') return e.p;
  if (e.kind === 'pair') return shapeCentre(doc.shapes.get(e.id)!);
  if (e.kind === 'atom') return doc.atoms.get(e.id)!;
  const [p, q] = endPair(doc, e)!.map((id) => doc.atoms.get(id)!);
  return { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
};

/** The two atoms of a bond end or a gap end. */
function endPair(doc: Doc, e: PushEnd): [number, number] | null {
  if (e.kind === 'gap') return [e.a1, e.a2];
  if (e.kind !== 'bond') return null;
  const b = doc.bonds.get(e.id)!;
  return [b.a1, b.a2];
}

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

/** Which side of the line from tail to head an arrow bends to (an S: its first bend), as pushArrow's `side` counts it. */
export function bendSide(r: Pick<Arrow, 'tail' | 'head' | 'sweep'> & Partial<Pick<Arrow, 'bez'>>): number {
  // an S: the way its first bend goes
  if (r.bez?.length) return r.bez[0].y >= 0 ? 1 : -1;
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
 * The electron-pushing arrow from one end to the other. `opts.side` (+1 or −1) bends it towards
 * the left or right of the line from start to end; leave it out to bend it away from the
 * structure. (A number for `opts` is the side.)
 */
export function pushArrow(doc: Doc, m: Measure, from: PushEnd, to: PushEnd, opts: number | PushOpts = {}): PushArrow | null {
  const o: PushOpts = typeof opts === 'number' ? { side: opts } : opts;
  const r = pushArrowAt(doc, m, from, to, o);
  return r && { ...r, start: r.start ?? from, end: to };
}

function pushArrowAt(doc: Doc, m: Measure, from: PushEnd, to: PushEnd, o: PushOpts): PushArrow | null {
  const side = o.side;
  const L = doc.style.bondLength;
  let c0 = centreOf(doc, from);
  const c1 = centreOf(doc, to);
  if (dist(c0, c1) < 1e-6 && from.kind !== 'atom') return null;

  // an atom with lone pairs (or a radical's dot, or a circled minus) drawn on it: the arrow
  // starts from the one facing where it goes
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
    // just outside the dots (or the circled charge)
    const size = Math.max(pair.x2 - pair.x1, pair.y2 - pair.y1);
    tail = add(pc, mul(d, Math.max(0.09 * L, size / 2 + 0.05 * L)));
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
    const pr = endPair(doc, from);
    if (pr) skip.add(pr[0]).add(pr[1]);
    const mid = { x: (tail.x + c1.x) / 2, y: (tail.y + c1.y) / 2 };
    const centre = localCentre(doc, mid, 1.6 * L, skip);
    bend = centre && Math.abs(dot(sub(centre, mid), left)) > 0.05 * L ? -Math.sign(dot(sub(centre, mid), left)) : 1;
  }
  // two bonds of one atom (C–H to C–C in an elimination, a π bond to the gap beside it in a
  // Diels–Alder): bend into the open angle between them
  const p0 = endPair(doc, from), p1 = endPair(doc, to);
  if (side === undefined && p0 && p1) {
    const shared = p0.find((x) => x === p1[0] || x === p1[1]);
    if (shared !== undefined) {
      const v = doc.atoms.get(shared)!;
      bend = dot(sub(v, tail), left) > 0 ? -1 : 1;
    }
  }
  const out = mul(left, bend ?? 1);

  // a bond's electrons moving onto one of its own atoms (C=O to O, C–Br to Br): a short loop
  // from beside the bond's middle round to beside the atom
  if (to.kind === 'atom' && from.kind === 'bond' && p0?.includes(to.id) && chord < 0.9 * L && !o.s) {
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
            if (score < bestScore) { bestScore = score; best = { tail: t2, head: h2, sweep: sw, small: true, start: from }; }
          }
        }
      }
    }
    if (best) return best;
  }

  // try both sides (or the one asked for) and a range of curls; keep the arc that stays clear of
  // the structure, preferring the usual bend and curl. Where none does, try S shapes.
  const prefer = chord < 1.6 * L ? 120 * DEG : 90 * DEG;
  const usual = bend ?? 1;
  const sides = side !== undefined ? [side] : [usual, -usual];
  const skip = endAtoms(doc, from, to);
  /** Where a side's arrow starts and what it points at (a new bond from the side it comes from). */
  const ends = (sd: number) => {
    const ob = mul(left, sd);
    // a bond's electrons leave from beside it, on the side the arrow bends to
    const t0 = from.kind === 'bond' ? add(c0, mul(ob, 0.08 * L)) : tail;
    let end = c1;
    if (p1) {
      const [q1, q2] = p1.map((id) => doc.atoms.get(id)!);
      let n = perp(norm(sub(q2, q1)));
      if (dot(sub(t0, c1), n) < 0) n = mul(n, -1);
      end = add(c1, mul(n, (to.kind === 'gap' ? 0.06 : 0.12) * L));
      // a new bond to a labelled atom (PdLn…): point at the open part of the gap, clear of the label
      if (to.kind === 'gap') end = clearOfLabels(doc, m, end, q1, q2, p1);
    }
    return { t0, end };
  };
  let best: PushArrow | null = null, bestScore = Infinity, bestClash = Infinity;
  if (!o.s) {
    for (const sd of sides) {
      const ob = mul(left, sd);
      const { t0, end } = ends(sd);
      for (const deg of [60, 75, 90, 105, 120, 135, 150]) {
        const size = deg * DEG;
        const sweep0 = dot(sub(arcMid(t0, end, size), t0), ob) > 0 ? size : -size;
        const arc = to.kind === 'atom' ? trimHead(doc, m, t0, c1, sweep0, to.id) : { head: end, sweep: sweep0 };
        if (!arc) continue;
        const clash = arcClash(doc, m, t0, arc.head, arc.sweep, skip);
        const score = clash + 0.35 * Math.abs(size - prefer) / (90 * DEG) + (sd !== usual ? 0.25 : 0);
        if (score < bestScore) { bestScore = score; bestClash = clash; best = { tail: t0, head: arc.head, sweep: arc.sweep, start: from }; }
      }
    }
  }
  // an S: asked for, or the only way round (one curve would run into the structure)
  if ((o.s || bestClash > 0.3) && !o.arcOnly) {
    let bestS: PushArrow | null = null, sScore = Infinity, sClash = Infinity;
    for (const sd of sides) {
      const { t0, end } = ends(sd);
      for (const c of sCandidates(t0, end, sd, from.kind === 'atom' || from.kind === 'pair' ? lean : null)) {
        const shaped = to.kind === 'atom' ? sToAtom(doc, m, t0, c1, c, to.id) : { head: end, bez: c };
        if (!shaped) continue;
        const pts = bezPoints({ tail: t0, head: shaped.head, bez: shaped.bez })!;
        const clash = pathClash(doc, m, sampleBez(pts), t0, shaped.head, skip);
        // coming in along one of the atom's bonds hides the head in the bond
        const along = to.kind === 'atom' ? bondDirs(doc, to.id).reduce((t, b) => t + Math.max(0, dot(norm(sub(shaped.head, c1)), b) - Math.cos(55 * DEG)), 0) : 0;
        const score = clash + 3 * along + (sd !== usual ? 0.25 : 0) + 0.1 * Math.abs(Math.abs(shaped.bez[0].y) - 0.8);
        if (score < sScore) { sScore = score; sClash = clash; bestS = { tail: t0, head: shaped.head, sweep: 0, bez: shaped.bez, start: from }; }
      }
    }
    // an S when asked for; otherwise only when it is clearly clearer than the best curve
    if (bestS && (o.s || !best || sClash < bestClash - 0.25)) return bestS;
  }
  return best;
}

/**
 * S shapes to try between two points: the first control point off to side `sd` (or along the way
 * a lone pair points), the second off to the other side, at a few sizes.
 */
function sCandidates(t0: Vec, end: Vec, sd: number, lean: Vec | null): Vec[][] {
  const out: Vec[][] = [];
  // (a cubic bends out about a third as far as its control points)
  for (const k of [0.6, 0.85, 1.1]) {
    for (const a of [0.2, 0.35]) {
      out.push([{ x: a, y: sd * k }, { x: 1 - a, y: -sd * k }]);
    }
  }
  // leaving the way the lone pair points
  if (lean) {
    const chord = dist(t0, end);
    for (const k of [0.6, 0.9]) {
      const c1 = chordLocal(t0, end, add(t0, mul(lean, k * chord)));
      // (only where that makes a real bend, to the side asked for)
      if (Math.sign(c1.y) !== sd || Math.abs(c1.y) < 0.45) continue;
      out.push([c1, { x: 1 - Math.max(0.2, c1.x), y: -c1.y }]);
    }
  }
  return out;
}

/**
 * An S ending on an atom: the head stops short of the atom (clear of its label) where the curve
 * comes in, with its control points kept where they are on the page.
 */
function sToAtom(doc: Doc, m: Measure, t0: Vec, c1: Vec, bez: Vec[], id: number): { head: Vec; bez: Vec[] } | null {
  const ctrl = bez.map((q) => chordPoint(t0, c1, q));
  const last = ctrl[ctrl.length - 1];
  // it comes in through open space round the atom (not along one of its bonds), from about
  // where its last bend is, and points straight at the atom
  const d = lonePairDir(doc, id, last);
  const head = add(c1, mul(d, stopAt(doc, m, id, d)));
  if (dist(head, t0) < 1e-6) return null;
  ctrl[ctrl.length - 1] = add(head, mul(d, Math.max(0.25 * dist(t0, head), dist(last, c1) * 0.8)));
  return { head, bez: ctrl.map((p) => chordLocal(t0, head, p)) };
}

/** A point on the way from q1 to q2 moved along it, out of the labels of the atoms `ids` (no further than the last fifth of the way). */
function clearOfLabels(doc: Doc, m: Measure, p: Vec, q1: Vec, q2: Vec, ids: number[]): Vec {
  const L = doc.style.bondLength;
  const boxes = ids.map((id) => ({ a: doc.atoms.get(id)!, b: m.atomBoxes(doc.atoms.get(id)!) }));
  const inside = (x: Vec) => boxes.some(({ b }) => b.some((r) => x.x >= r.x1 - 0.06 * L && x.x <= r.x2 + 0.06 * L && x.y >= r.y1 - 0.06 * L && x.y <= r.y2 + 0.06 * L));
  if (!inside(p)) return p;
  const u = norm(sub(q2, q1)), span = dist(q1, q2);
  // try either way along the gap, a step at a time
  for (let t = 0.05 * L; t < 0.4 * span; t += 0.05 * L) {
    for (const s of [1, -1]) {
      const x = add(p, mul(u, s * t));
      if (!inside(x)) return x;
    }
  }
  return p;
}

/** Points along a run of Bézier curves, without its two ends. */
function sampleBez(pts: Vec[], n = 28): Vec[] {
  const k = (pts.length - 1) / 3;
  return Array.from({ length: n - 1 }, (_, i) => bezPathAt(pts, (k * (i + 1)) / n));
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
  const { center, radius } = arcCenter(tail, head, sweep);
  const a0 = angleOf(sub(tail, center));
  const N = 28;
  const pts = Array.from({ length: N - 1 }, (_, i) => add(center, fromAngle(a0 + (sweep * (i + 1)) / N, radius)));
  return pathClash(doc, m, pts, tail, head, own);
}

/** How badly a line through `pts` (from tail to head) runs into things, as arcClash counts it. */
export function pathClash(doc: Doc, m: Measure, pts: Vec[], tail: Vec, head: Vec, own: Set<number> = new Set()): number {
  const L = doc.style.bondLength;
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of [tail, head, ...pts]) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  const near = (p: Vec) => p.x > x1 - 1.5 * L && p.x < x2 + 1.5 * L && p.y > y1 - 1.5 * L && p.y < y2 + 1.5 * L;
  const atoms = [...doc.atoms.values()].filter(near);
  const labelled = new Map(atoms.map((a) => [a.id, m.atomBoxes(a)]));
  const bonds = [...doc.bonds.values()].map((b) => [doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, b] as const).filter(([p, q]) => near(p) || near(q));
  const symbols = [...doc.shapes.values()].filter((s) => s.kind === 'symbol').map(shapeCentre).filter(near);
  let bad = 0;
  for (const p of pts) {
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
 * What an arrow end sits on: a drawn lone pair (or radical dot or circled charge), a bond or an
 * atom near the point, the gap between two atoms where a new bond would go, else the point
 * itself (Clean Up Arrow works out what an arrow was drawn from and to this way).
 */
export function pushEndAt(doc: Doc, m: Measure, p: Vec): PushEnd {
  const L = doc.style.bondLength;
  let best: PushEnd = { kind: 'point', p }, bestD = Infinity;
  for (const s of doc.shapes.values()) {
    if (!isAtomSymbol(s)) continue;
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
  return best.kind === 'point' ? gapAt(doc, p) ?? best : best;
}

/**
 * The gap between two atoms that aren't bonded whose middle is near `p` (where an arrow points
 * at a bond about to form: a nucleophile's new bond, the new σ bonds of a Diels–Alder), if the
 * space there is open.
 */
export function gapAt(doc: Doc, p: Vec): PushEnd | null {
  const L = doc.style.bondLength;
  const near = [...doc.atomsNear(p, 2 * L)].filter((a) => !a.multi);
  let best: PushEnd | null = null, bestD = 0.35 * L;
  for (let i = 0; i < near.length; i++) {
    for (let j = i + 1; j < near.length; j++) {
      const a = near[i], b = near[j];
      const span = dist(a, b);
      if (span < 1.1 * L || span > 3.6 * L || doc.bondBetween(a.id, b.id)) continue;
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const d = dist(mid, p);
      if (d >= bestD) continue;
      // open space: nothing else on the way from one to the other
      const blocked = [...doc.atomsNear(mid, span / 2)].some((c) => c.id !== a.id && c.id !== b.id && !c.multi && distToSegment(c, a, b) < 0.35 * L);
      if (blocked) continue;
      bestD = d;
      best = { kind: 'gap', a1: a.id, a2: b.id };
    }
  }
  return best;
}

/** An end an arrow points at: a lone pair or charge there stands for its atom. */
export function headEnd(doc: Doc, e: PushEnd, at: Vec): PushEnd {
  if (e.kind !== 'pair') return e;
  const o = pairOwner(doc, doc.shapes.get(e.id)!);
  return o !== null ? { kind: 'atom', id: o } : { kind: 'point', p: at };
}

/** An end an arrow starts from: electrons drawn there, or else the atom a circled plus is on. */
export function tailEnd(doc: Doc, e: PushEnd, at: Vec): PushEnd {
  return e.kind === 'pair' && !isElectrons(doc.shapes.get(e.id)) ? headEnd(doc, e, at) : e;
}

/** Are two ends the same thing (an arrow can't run from a thing to itself)? */
export function sameEnd(a: PushEnd, b: PushEnd): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'point' || b.kind === 'point') return false;
  if (a.kind === 'gap' && b.kind === 'gap') return (a.a1 === b.a1 && a.a2 === b.a2) || (a.a1 === b.a2 && a.a2 === b.a1);
  return (a as { id: number }).id === (b as { id: number }).id;
}

/**
 * Clean Up Arrow: a curved arrow redrawn from what its tail sits on (a lone pair, a bond, an
 * atom) to what its head points at, at a curl and on a side where it doesn't run into the
 * structure (as an S where one curve can't; an S-shaped arrow stays one). Null when it can't
 * tell what the arrow is drawn between.
 */
export function cleanUpArrow(doc: Doc, m: Measure, r: Pick<Arrow, 'tail' | 'head' | 'sweep'> & Partial<Pick<Arrow, 'bez'>>): PushArrow | null {
  const from = tailEnd(doc, pushEndAt(doc, m, r.tail), r.tail);
  let to = headEnd(doc, pushEndAt(doc, m, r.head), r.head);
  if (sameEnd(from, to)) to = { kind: 'point', p: r.head };
  if (from.kind === 'point' && to.kind === 'point') return freeArc(doc, m, r);
  return pushArrow(doc, m, from, to, { s: !!r.bez?.length });
}

/** An arrow between two free points: the same ends, on the side and curl that keep it clear (an S if that's the only way). */
function freeArc(doc: Doc, m: Measure, r: Pick<Arrow, 'tail' | 'head' | 'sweep'> & Partial<Pick<Arrow, 'bez'>>): PushArrow | null {
  if (dist(r.tail, r.head) < 1e-6) return null;
  let best: PushArrow | null = null, bestScore = Infinity, bestClash = Infinity;
  const usual = r.bez?.length ? Math.sign(r.bez[0].y) || 1 : -Math.sign(r.sweep) || 1;
  if (!r.bez?.length) {
    for (const sd of [usual, -usual]) {
      for (const deg of [45, 60, 75, 90, 105, 120, 135]) {
        // (a sweep the other way round bends to side sd)
        const sweep = -sd * deg * DEG;
        const clash = arcClash(doc, m, r.tail, r.head, sweep);
        const score = clash + 0.35 * Math.abs(deg - 90) / 90 + (sd !== usual ? 0.25 : 0);
        if (score < bestScore) { bestScore = score; bestClash = clash; best = { tail: r.tail, head: r.head, sweep }; }
      }
    }
  }
  if (r.bez?.length || bestClash > 0.3) {
    let bestS: PushArrow | null = null, sScore = Infinity, sClash = Infinity;
    for (const sd of [usual, -usual]) {
      for (const bez of sCandidates(r.tail, r.head, sd, null)) {
        const clash = pathClash(doc, m, sampleBez(bezPoints({ tail: r.tail, head: r.head, bez })!), r.tail, r.head);
        const score = clash + (sd !== usual ? 0.25 : 0) + 0.1 * Math.abs(Math.abs(bez[0].y) - 0.8);
        if (score < sScore) { sScore = score; sClash = clash; bestS = { tail: r.tail, head: r.head, sweep: 0, bez }; }
      }
    }
    if (bestS && (r.bez?.length || !best || sClash < bestClash - 0.25)) return bestS;
  }
  return best;
}

/**
 * The pins that hold an electron-pushing arrow's ends to what it was drawn from and to (a lone
 * pair's or charge's atom, a bond, the gap of a new bond); none for an end on empty paper.
 */
export function pushPins(doc: Doc, push: Pick<PushArrow, 'tail' | 'head' | 'start' | 'end'>): Arrow['pin'] | undefined {
  const pinOf = (e: PushEnd | undefined, p: Vec): Pin | undefined => {
    if (!e || e.kind === 'point') return undefined;
    if (e.kind === 'atom') return makePin(doc, 'atom', [e.id], p) ?? undefined;
    if (e.kind === 'pair') { const o = pairOwner(doc, doc.shapes.get(e.id)!); return o !== null ? makePin(doc, 'atom', [o], p) ?? undefined : undefined; }
    const pr = endPair(doc, e);
    return pr ? makePin(doc, e.kind === 'gap' ? 'gap' : 'bond', pr, p) ?? undefined : undefined;
  };
  const tail = pinOf(push.start, push.tail), head = pinOf(push.end, push.head);
  return tail || head ? { ...(tail ? { tail } : {}), ...(head ? { head } : {}) } : undefined;
}

/** Pin a lone pair, radical dot or circled charge to the atom it sits on (when it sits on one). */
export function symbolPin(doc: Doc, s: Shape): Pin | undefined {
  if (!isAtomSymbol(s)) return undefined;
  const o = pairOwner(doc, s);
  return o !== null ? makePin(doc, 'atom', [o], shapeCentre(s)) ?? undefined : undefined;
}

/**
 * Where a lone pair, radical dot or charge goes on an atom: in the widest open space between its
 * bonds and anything already sitting round it (`taken`), just clear of its label. Gives the
 * direction from the atom and the symbol's centre, `size` across.
 */
export function symbolSpot(doc: Doc, m: Measure, id: number, taken: Vec[], size: number): { dir: Vec; at: Vec } {
  const a = doc.atoms.get(id)!;
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
  return { dir: best, at: symbolAt(doc, m, id, best, size) };
}

/** The centre of a symbol `size` across on an atom, in direction `dir` from it, just clear of its label. */
export function symbolAt(doc: Doc, m: Measure, id: number, dir: Vec, size: number): Vec {
  const a = doc.atoms.get(id)!;
  const L = doc.style.bondLength;
  const boxes = m.atomBoxes(a);
  const reach = boxes.length ? labelReach(a, boxes, dir) + 0.06 * L : 0.18 * L;
  return add(a, mul(dir, reach + size / 2));
}
