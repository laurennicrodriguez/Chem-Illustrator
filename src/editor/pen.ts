// The pen tool's geometry: anchors with handles, turned into an arrow's `bez` (and back), and
// the edits made to those anchors afterwards (move, add, delete, corner or smooth). Nothing
// here touches the document; the editor applies the patches these return.

import type { Arrow } from '../model';
import { add, dist, dot, mul, sub, type Vec } from '../geom';
import { bezAt, bezPoints, chordLocal, splitBez } from '../objects';

/** A point of a pen path with the handles that shape the curve either side of it. A handle at the anchor itself is no handle. */
export interface Anchor { p: Vec; in: Vec; out: Vec }

/** The shortest line from first anchor to last that a pen arrow can have (its curve is held in the frame of that line). */
export const MIN_CHORD = 4;

/** A handle this close to its anchor is no handle at all. */
const FLAT = 0.01;

/** Whether a handle is pulled out from its anchor. */
const pulled = (a: Anchor, h: 'in' | 'out') => dist(a[h], a.p) > FLAT;

export const corner = (p: Vec): Anchor => ({ p, in: p, out: p });

/** An anchor with handles pulled out evenly both ways: `out` is where the forward handle is, the other mirrors it. */
export const smooth = (p: Vec, out: Vec): Anchor => ({ p, in: sub(mul(p, 2), out), out });

/** An arrow's line from anchors: tail, head and `bez`. Null when there are fewer than two or the ends are too close. */
export function anchorsToArrow(anchors: Anchor[]): Pick<Arrow, 'tail' | 'head' | 'bez'> | null {
  if (anchors.length < 2) return null;
  const tail = anchors[0].p, head = anchors[anchors.length - 1].p;
  if (dist(tail, head) < MIN_CHORD) return null;
  const pts: Vec[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    pts.push(anchors[i].out, anchors[i + 1].in);
    if (i < anchors.length - 2) pts.push(anchors[i + 1].p);
  }
  return { tail, head, bez: pts.map((q) => chordLocal(tail, head, q)) };
}

/** An arrow's anchors (null when it isn't a chain of Bézier curves). */
export function arrowAnchors(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>): Anchor[] | null {
  const pts = bezPoints(r);
  if (!pts) return null;
  const out: Anchor[] = [{ p: pts[0], in: pts[0], out: pts[1] }];
  for (let i = 3; i < pts.length - 1; i += 3) out.push({ p: pts[i], in: pts[i - 1], out: pts[i + 1] });
  const last = pts[pts.length - 1];
  out.push({ p: last, in: pts[pts.length - 2], out: last });
  return out;
}

/** The arrow's line from anchors, in the frame of the arrow's own ends (which stay where they are). */
function withAnchors(r: Pick<Arrow, 'tail' | 'head'>, anchors: Anchor[]): Partial<Arrow> {
  const pts: Vec[] = [];
  for (let i = 0; i < anchors.length - 1; i++) {
    pts.push(anchors[i].out, anchors[i + 1].in);
    if (i < anchors.length - 2) pts.push(anchors[i + 1].p);
  }
  return { bez: pts.map((q) => chordLocal(r.tail, r.head, q)) };
}

/** Is the anchor smooth: both handles pulled out, on opposite sides of it along one line? */
export function isSmooth(a: Anchor): boolean {
  if (!pulled(a, 'in') || !pulled(a, 'out')) return false;
  const u = sub(a.in, a.p), v = sub(a.out, a.p);
  const cross = u.x * v.y - u.y * v.x;
  return dot(u, v) < 0 && Math.abs(cross) <= 0.02 * Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y);
}

/**
 * Which anchor a `bez` index belongs to, and as what. Index k in bez is point k + 1 of the
 * chain: 1 is the first curve's out handle, 2 the next anchor's in handle, 3 the anchor.
 */
function roleOf(k: number): { anchor: number; role: 'in' | 'out' | 'join' } {
  const i = k + 1;
  return i % 3 === 0 ? { anchor: i / 3, role: 'join' } : i % 3 === 1 ? { anchor: (i - 1) / 3, role: 'out' } : { anchor: (i + 1) / 3, role: 'in' };
}

/** Is bez point k a join between two curves (an anchor you can add to or delete)? */
export const isJoin = (k: number): boolean => roleOf(k).role === 'join';

/**
 * What dragging bez point k to `p` changes. A join takes its two handles along; a handle of a
 * smooth anchor swings the other one round to stay in line (keeping its length). `free` (Alt)
 * moves a handle alone, which makes the anchor a corner.
 */
export function dragAnchorPoint(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>, k: number, p: Vec, free: boolean): Partial<Arrow> | null {
  const as = arrowAnchors(r);
  if (!as) return null;
  const { anchor: i, role } = roleOf(k);
  const a = as[i];
  const next = as.map((x) => ({ ...x }));
  if (role === 'join') {
    const d = sub(p, a.p);
    next[i] = { p, in: add(a.in, d), out: add(a.out, d) };
  } else {
    const other = role === 'in' ? 'out' : 'in';
    const keep = isSmooth(a);
    next[i] = { ...a, [role]: p };
    if (keep && !free) {
      const dir = sub(a.p, p);
      const len = dist(a[other], a.p), l = Math.hypot(dir.x, dir.y);
      if (l > FLAT) next[i][other] = add(a.p, mul(dir, len / l));
    }
  }
  return withAnchors(r, next);
}

/** Pulling handles out of anchor `i` (or pulling them in, to make it a corner): `to` is where the outgoing handle goes. */
export function convertAnchor(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>, i: number, to: Vec | null): Partial<Arrow> | null {
  const as = arrowAnchors(r);
  if (!as || i <= 0 || i >= as.length - 1) return null;
  const next = as.slice();
  next[i] = to ? smooth(as[i].p, to) : corner(as[i].p);
  return withAnchors(r, next);
}

/** The curve index, parameter and point nearest `p` on the arrow's curves. */
export function nearestOnCurve(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>, p: Vec): { curve: number; t: number; at: Vec; d: number } | null {
  const pts = bezPoints(r);
  if (!pts) return null;
  let best: { curve: number; t: number; at: Vec; d: number } | null = null;
  const n = (pts.length - 1) / 3, N = 48;
  for (let c = 0; c < n; c++) {
    for (let s = 0; s <= N; s++) {
      const t = s / N, at = bezAt(pts, t, c * 3), d = dist(at, p);
      if (!best || d < best.d) best = { curve: c, t, at, d };
    }
  }
  return best;
}

/** Adding an anchor on the curve nearest `p`: the curve is cut there, so its shape doesn't change. */
export function addAnchor(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>, p: Vec): Partial<Arrow> | null {
  const pts = bezPoints(r), hit = nearestOnCurve(r, p);
  if (!pts || !hit) return null;
  // not on top of an anchor already there
  if (hit.t < 0.03 || hit.t > 0.97) return null;
  const [a, b] = splitBez(pts.slice(hit.curve * 3, hit.curve * 3 + 4), hit.t);
  const next = [...pts.slice(0, hit.curve * 3), ...a, ...b.slice(1), ...pts.slice(hit.curve * 3 + 4)];
  return { bez: next.slice(1, -1).map((q) => chordLocal(r.tail, r.head, q)) };
}

/** Deleting the join at anchor `i`: its neighbours' curves join up into one, through the handles they had. */
export function deleteAnchor(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>, i: number): Partial<Arrow> | null {
  const as = arrowAnchors(r);
  if (!as || i <= 0 || i >= as.length - 1) return null;
  return withAnchors(r, as.filter((_, j) => j !== i));
}
