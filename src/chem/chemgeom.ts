// Where new atoms go: the direction of a sprouted bond, ring placement (free, fused to a
// bond, or on an atom), chains, and merging new atoms into existing ones that land on
// the same spot. All positions are in points with y running down.

import { Doc, Atom, Bond, BondDisplay } from '../model';
import { ringsThroughBond } from './aromatic';
import { Vec, add, sub, mul, norm, perp, dot, angleOf, fromAngle, dist, normAngle, DEG } from '../geom';

/** New atoms closer than this fraction of a bond length to an existing atom join it. */
export const MERGE_FRACTION = 0.25;

export function bondLength(doc: Doc, near?: Atom): number {
  return doc.style.bondLength * (near?.s ?? 1);
}

/** An existing atom at p (within the merge distance), ignoring `except`. */
export function atomAt(doc: Doc, p: Vec, tol: number, except?: Set<number>): Atom | undefined {
  let best: Atom | undefined;
  let bd = tol;
  for (const a of doc.atomsNear(p, tol)) {
    // (a ring's middle, where a metal's hapto bond ends, is not an atom to join)
    if (except?.has(a.id) || a.multi) continue;
    const d = dist(a, p);
    if (d <= bd) { bd = d; best = a; }
  }
  return best;
}

/** How crowded a spot is: larger when existing atoms sit close to it. */
function crowding(doc: Doc, p: Vec, L: number, ignore: Set<number>): number {
  let c = 0;
  for (const a of doc.atomsNear(p, L * 0.9)) {
    if (ignore.has(a.id)) continue;
    c += 1 - dist(a, p) / (L * 0.9);
  }
  return c;
}

/**
 * Direction for a new bond from an atom, the way ChemDraw picks it: up-right for a lone
 * atom, a zig-zag continuation for a chain end, and the middle of the widest gap otherwise.
 */
export function sproutDir(doc: Doc, atomId: number): Vec {
  const a = doc.atoms.get(atomId)!;
  const nb = doc.neighbors(atomId);
  const L = bondLength(doc, a);
  const ignore = new Set([atomId, ...nb.map((n) => n.id)]);
  if (nb.length === 0) return fromAngle(-30 * DEG);
  if (nb.length === 1) {
    const n = nb[0];
    const back = angleOf(sub(n, a));
    const cands = [fromAngle(back + 120 * DEG), fromAngle(back - 120 * DEG)];
    // Zig-zag: the new bond runs parallel to the bond before the neighbour (trans). A C=O or
    // =CH2 on the neighbour, or a wedged methyl, is not part of the chain, so it doesn't steer
    // (acetyl, then 1, carries on; so does the chain past an alanine's methyl)
    const all = doc.neighbors(n.id).filter((x) => x.id !== a.id);
    const chainLike = all.filter((pp) => {
      if (doc.degree(pp.id) > 1) return true;
      const b = doc.bondBetween(n.id, pp.id);
      return !b || b.order < 2 && b.display !== 'wedge' && b.display !== 'hashWedge';
    });
    const prev = chainLike.length ? chainLike : all;
    const score = (d: Vec) => {
      let s = -3 * crowding(doc, add(a, mul(d, L)), L, ignore);
      for (const pp of prev) s += dot(d, norm(sub(n, pp)));
      if (prev.length === 0) s += 0.01 * d.x - 0.001 * d.y; // keep growing to the right, then upward
      return s;
    };
    return score(cands[0]) >= score(cands[1]) ? cands[0] : cands[1];
  }
  // Widest angular gap between existing bonds, never one inside a ring the atom is in (the
  // angular methyl of a decalin or steroid goes outside, though all three gaps are equal)
  const byAngle = nb.map((n) => ({ id: n.id, ang: normAngle(angleOf(sub(n, a))) })).sort((x, y) => x.ang - y.ang);
  const inRing = ringGaps(doc, atomId);
  let best = -1, bestGap = -1, bestMid = 0;
  for (const skipRings of [true, false]) {
    for (let i = 0; i < byAngle.length; i++) {
      const next = byAngle[(i + 1) % byAngle.length];
      if (skipRings && inRing.has(gapKey(byAngle[i].id, next.id))) continue;
      const a0 = byAngle[i].ang;
      const a1 = i + 1 < byAngle.length ? next.ang : byAngle[0].ang + 2 * Math.PI;
      const gap = a1 - a0;
      const mid = a0 + gap / 2;
      // Prefer the emptier side when two gaps are nearly equal (e.g. a straight chain).
      const tieBreak = -0.05 * crowding(doc, add(a, fromAngle(mid, L)), L, ignore);
      if (gap + tieBreak > bestGap + 1e-6) { bestGap = gap + tieBreak; best = i; bestMid = mid; }
    }
    if (best >= 0) break;
  }
  return best >= 0 ? fromAngle(bestMid) : fromAngle(-30 * DEG);
}

const gapKey = (p: number, q: number) => (p < q ? `${p},${q}` : `${q},${p}`);

/** The pairs of an atom's neighbours that sit either side of it in one of its rings (the gaps inside rings). */
function ringGaps(doc: Doc, atomId: number): Set<string> {
  const out = new Set<string>();
  for (const bid of doc.adj.get(atomId) ?? []) {
    for (const ring of ringsThroughBond(doc, bid)) {
      const i = ring.indexOf(atomId);
      if (i < 0) continue;
      out.add(gapKey(ring[(i + ring.length - 1) % ring.length], ring[(i + 1) % ring.length]));
    }
  }
  return out;
}

/**
 * Which way a ring grows from an atom it is drawn on. On a chain end the ring carries straight
 * on from the bond, so both ring bonds sit at 120° to it; otherwise it fills the widest gap
 * (a spiro ring on an atom with two bonds).
 */
export function ringDir(doc: Doc, atomId: number): Vec {
  const nb = doc.neighbors(atomId);
  if (nb.length === 1) return norm(sub(doc.atoms.get(atomId)!, nb[0]));
  return sproutDir(doc, atomId);
}

/** Two directions splitting the widest gap at an atom into thirds (gem-dimethyl, =O pairs). */
export function sproutPair(doc: Doc, atomId: number): [Vec, Vec] {
  const a = doc.atoms.get(atomId)!;
  const nb = doc.neighbors(atomId);
  if (nb.length === 0) return [fromAngle(-30 * DEG), fromAngle(30 * DEG)];
  if (nb.length === 1) {
    const back = angleOf(sub(nb[0], a));
    return [fromAngle(back + 120 * DEG), fromAngle(back - 120 * DEG)];
  }
  const mid = angleOf(sproutDir(doc, atomId));
  // width of the gap the bisector sits in
  let minDiff = Math.PI;
  for (const n of nb) {
    let d = Math.abs(normAngle(angleOf(sub(n, a)) - mid));
    if (d > Math.PI) d = 2 * Math.PI - d;
    minDiff = Math.min(minDiff, d);
  }
  const half = (2 * minDiff) / 3 / 2;
  return [fromAngle(mid - half), fromAngle(mid + half)];
}

/** Radius of a regular ring with side L. */
export function ringRadius(n: number, L: number): number {
  return L / (2 * Math.sin(Math.PI / n));
}

/** Vertices of a free-standing ring centred at c, oriented as ChemDraw draws them. */
export function freeRing(c: Vec, n: number, L: number, towards?: Vec): Vec[] {
  const R = ringRadius(n, L);
  // Hexagons and odd rings have a vertex at the top; 4- and 8-rings have flat tops.
  let start = n === 4 || n === 8 ? -90 * DEG + Math.PI / n : -90 * DEG;
  if (towards && dist(towards, c) > L * 0.3) start = Math.round(angleOf(sub(towards, c)) / (15 * DEG)) * 15 * DEG;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(add(c, fromAngle(start + (i * 2 * Math.PI) / n, R)));
  return out;
}

/** Ring vertices sharing the edge p→q, on side ±1 (perp side of p→q). First two are p, q. */
export function fusedRing(p: Vec, q: Vec, n: number, side: number): Vec[] {
  const L = dist(p, q);
  const R = ringRadius(n, L);
  const mid = mul(add(p, q), 0.5);
  const apothem = Math.sqrt(Math.max(0, R * R - (L / 2) * (L / 2)));
  const c = add(mid, mul(norm(perp(sub(q, p))), side * apothem));
  // Walk round the centre from p through q.
  const a0 = angleOf(sub(p, c));
  const a1 = angleOf(sub(q, c));
  let step = normAngle(a1 - a0);
  if (step > Math.PI) step = step - 2 * Math.PI;
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(add(c, fromAngle(a0 + i * step, R)));
  out[0] = { x: p.x, y: p.y };
  out[1] = { x: q.x, y: q.y };
  return out;
}

/** Which side of a bond to fuse a new ring on: the emptier side, or the cursor's side on a tie. */
export function fuseSide(doc: Doc, b: Bond, n: number, cursor?: Vec): number {
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  const L = dist(p, q);
  const ignore = new Set([p.id, q.id]);
  const score = (side: number) => {
    const pts = fusedRing(p, q, n, side);
    let c = 0;
    for (let i = 2; i < pts.length; i++) c += crowding(doc, pts[i], L, ignore);
    // ring centre occupied by other atoms is a strong signal (the existing ring)
    const cen = pts.reduce((s, v) => add(s, v), { x: 0, y: 0 });
    c += 2 * crowding(doc, mul(cen, 1 / n), L, ignore);
    return c;
  };
  const s1 = score(1), s2 = score(-1);
  if (Math.abs(s1 - s2) < 0.05 && cursor) {
    return dot(sub(cursor, p), perp(sub(q, p))) >= 0 ? 1 : -1;
  }
  return s1 <= s2 ? 1 : -1;
}

/** Ring that has `a` as one vertex, centred along `dir` (spiro or ring-on-a-chain-end). */
export function ringOnAtom(a: Vec, dir: Vec, n: number, L: number): Vec[] {
  const R = ringRadius(n, L);
  const c = add(a, mul(dir, R));
  const a0 = angleOf(sub(a, c));
  const out: Vec[] = [];
  for (let i = 0; i < n; i++) out.push(add(c, fromAngle(a0 + (i * 2 * Math.PI) / n, R)));
  out[0] = { x: a.x, y: a.y };
  return out;
}

export interface PlaceOptions {
  /** Alternate double bonds (benzene, cyclopentadiene). */
  aromatic?: boolean;
  /** Start the alternation with a single bond instead of a double. */
  shiftPhase?: boolean;
  /** Atom ids already standing at some of the positions (same index as the points). */
  existing?: (number | undefined)[];
  scale?: number;
}

/**
 * Add a ring at the given points, reusing atoms already there, and return its atom ids.
 * For benzene-type rings, double bonds alternate and avoid atoms that already carry one.
 */
export function placeRing(doc: Doc, pts: Vec[], opts: PlaceOptions = {}): number[] {
  const n = pts.length;
  const L = dist(pts[0], pts[1]);
  const tol = L * MERGE_FRACTION;
  const ids: number[] = [];
  const used = new Set<number>();
  for (let i = 0; i < n; i++) {
    let id = opts.existing?.[i];
    if (id === undefined) {
      const hit = atomAt(doc, pts[i], tol, used);
      id = hit ? hit.id : doc.addAtom(pts[i].x, pts[i].y, 6, opts.scale && opts.scale !== 1 ? { s: opts.scale } : {}).id;
    }
    used.add(id);
    ids.push(id);
  }
  // Which edges get double bonds.
  const dbl = new Array(n).fill(false);
  if (opts.aromatic) {
    const hasDouble = (id: number, skip: Bond | undefined) =>
      (doc.adj.get(id) ?? []).some((bid) => { const bb = doc.bonds.get(bid)!; return bb !== skip && bb.order >= 2; });
    const tryPhase = (ph: number) => {
      let bad = 0;
      const d = new Array(n).fill(false);
      for (let i = 0; i < n; i++) {
        const want = i % 2 === ph && !(n % 2 === 1 && i === n - 1);
        d[i] = want;
        if (!want) continue;
        const a1 = ids[i], a2 = ids[(i + 1) % n];
        const ex = doc.bondBetween(a1, a2);
        if (ex && ex.order >= 2) continue;
        if (hasDouble(a1, ex) || hasDouble(a2, ex)) bad++;
      }
      return { bad, d };
    };
    const first = opts.shiftPhase ? 1 : 0;
    const p0 = tryPhase(first), p1 = tryPhase(1 - first);
    const pick = p1.bad < p0.bad ? p1 : p0;
    // Drop doubles that would still give an atom two double bonds.
    for (let i = 0; i < n; i++) {
      if (!pick.d[i]) continue;
      const a1 = ids[i], a2 = ids[(i + 1) % n];
      const ex = doc.bondBetween(a1, a2);
      if (ex && ex.order >= 2) continue;
      if (hasDouble(a1, ex) || hasDouble(a2, ex)) pick.d[i] = false;
    }
    for (let i = 0; i < n; i++) dbl[i] = pick.d[i];
  }
  for (let i = 0; i < n; i++) {
    const a1 = ids[i], a2 = ids[(i + 1) % n];
    const ex = doc.bondBetween(a1, a2);
    if (ex) {
      if (dbl[i] && ex.order === 1 && ex.display === 'solid') doc.updateBond(ex.id, { order: 2, dpos: 'auto' });
      continue;
    }
    doc.addBond(a1, a2, dbl[i] ? 2 : 1, 'solid', opts.scale && opts.scale !== 1 ? { s: opts.scale } : {});
  }
  return ids;
}

/**
 * Add a bond from an atom to a point, joining an existing atom there if one is close.
 * Returns the new or joined atom.
 */
export function bondTo(doc: Doc, from: Atom, p: Vec, order = 1, display: BondDisplay = 'solid', z = 6): Atom {
  const L = bondLength(doc, from);
  const hit = atomAt(doc, p, L * MERGE_FRACTION, new Set([from.id]));
  const extra = from.s && from.s !== 1 ? { s: from.s } : {};
  const to = hit ?? doc.addAtom(p.x, p.y, z, extra);
  const ex = doc.bondBetween(from.id, to.id);
  if (ex) doc.updateBond(ex.id, { order, display });
  else doc.addBond(from.id, to.id, order, display, extra);
  return to;
}

/** Sprout a bond from an atom in the automatic direction. */
export function sprout(doc: Doc, atomId: number, order = 1, display: BondDisplay = 'solid', z = 6, dir?: Vec): Atom {
  const a = doc.atoms.get(atomId)!;
  const d = dir ?? sproutDir(doc, atomId);
  return bondTo(doc, a, add(a, mul(d, bondLength(doc, a))), order, display, z);
}

/**
 * A zig-zag chain of `n` bonds from an atom (or from a point, when `atomId` is null), for the
 * chain tool's "how many atoms" click. The first bond goes where a new bond normally would, and
 * the chain turns to whichever side carries on the zig-zag and stays clear of other atoms.
 */
export function chainFrom(doc: Doc, atomId: number | null, at: Vec, n: number, chainAngle = 120): Vec[] {
  const a = atomId === null ? null : doc.atoms.get(atomId)!;
  const start = a ?? at;
  const L = a ? bondLength(doc, a) : doc.style.bondLength;
  const d0 = a ? sproutDir(doc, a.id) : fromAngle(-30 * DEG);
  const turn = (180 - chainAngle) * DEG;
  const build = (s: number) => {
    const pts: Vec[] = [start];
    let cur = start;
    for (let i = 0; i < n; i++) {
      cur = add(cur, fromAngle(angleOf(d0) + (i % 2 ? s * turn : 0), L));
      pts.push(cur);
    }
    return pts;
  };
  const prev = a ? doc.neighbors(a.id) : [];
  const ignore = new Set(a ? [a.id, ...prev.map((x) => x.id)] : []);
  const score = (pts: Vec[]) => {
    let sc = 0;
    for (const p of pts.slice(1)) sc -= crowding(doc, p, L, ignore);
    // the second bond runs parallel to the bond before the chain (a zig-zag carries on)
    if (prev.length === 1 && pts.length > 2) sc += 0.5 * dot(norm(sub(pts[2], pts[1])), norm(sub(a!, prev[0])));
    // otherwise lean right, then up, like a chain drawn by hand
    if (pts.length > 2) sc += 0.01 * (pts[2].x - pts[1].x) - 0.001 * (pts[2].y - pts[1].y);
    return sc;
  };
  const up = build(1), down = build(-1);
  return score(up) >= score(down) ? up : down;
}

/**
 * Zig-zag chain points from `start` towards `end` (ChemDraw's acyclic chain tool).
 * `firstUp` picks which side the first bond leans to.
 */
export function chainPoints(start: Vec, end: Vec, L: number, chainAngle = 120, firstUp?: boolean): Vec[] {
  const axis = sub(end, start);
  const l = Math.hypot(axis.x, axis.y);
  if (l < L * 0.3) return [start];
  const ang = Math.round(angleOf(axis) / (15 * DEG)) * 15 * DEG;
  const half = (180 - chainAngle) / 2 * DEG;
  const stepLen = L * Math.cos(half);
  const n = Math.max(1, Math.round(l / stepLen));
  const up = firstUp ?? true;
  const pts: Vec[] = [start];
  let cur = start;
  for (let i = 0; i < n; i++) {
    const s = (i % 2 === 0) === up ? -1 : 1;
    cur = add(cur, fromAngle(ang + s * half, L));
    pts.push(cur);
  }
  return pts;
}
