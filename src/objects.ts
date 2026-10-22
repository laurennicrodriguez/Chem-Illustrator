// Geometry of arrows and shapes: where they are (bounding boxes, hit testing), the handles a
// selected arrow or shape shows, and what dragging one of those handles does. Shared by the
// editor and the renderer.

import type { Arrow, Shape, Glue } from './model';
import { PICTURE_SHADOWS } from './model';
import { Vec, Rect, add, sub, mul, perp, dist, dot, len, angleOf, fromAngle, normAngle, snapAngle, distToSegment, arcCenter, DEG } from './geom';
import { geoDef, flatten, moveSteps, insideOutline, distToOutline, ports } from './design/geo';

// ------------------------------------------------------------------ arrows

type Curve = Pick<Arrow, 'tail' | 'head' | 'sweep'> & Partial<Pick<Arrow, 'elbow' | 'from' | 'to' | 'bez'>>;

/** Is this a curved arrow: an arc, or Bézier curves (an S-shaped arrow)? */
export const isCurved = (r: Pick<Arrow, 'sweep'> & Partial<Pick<Arrow, 'bez'>>): boolean => !!r.sweep || !!r.bez?.length;

/**
 * Which way a curved arrow turns as it comes into its head: +1 as an arc with a positive sweep
 * does, −1 the other way. A half head (fishhook) has its barb on the outside of that turn:
 * halfLeft for +1.
 */
export function headBend(r: Pick<Arrow, 'sweep'> & Partial<Pick<Arrow, 'bez'>>): number {
  if (r.bez?.length) return r.bez[r.bez.length - 1].y > 0 ? -1 : 1;
  return r.sweep < 0 ? -1 : 1;
}

/** A half head on the other side. */
export const swapHalf = (h: Arrow['headStyle']): Arrow['headStyle'] => (h === 'halfLeft' ? 'halfRight' : h === 'halfRight' ? 'halfLeft' : h);

/** A point given in the frame of the line from tail to head (as an arrow's `bez` points are), on the page. */
export function chordPoint(tail: Vec, head: Vec, q: Vec): Vec {
  const u = sub(head, tail);
  return add(tail, add(mul(u, q.x), mul(perp(u), q.y)));
}

/** A point on the page in the frame of the line from tail to head (the inverse of chordPoint). */
export function chordLocal(tail: Vec, head: Vec, p: Vec): Vec {
  const u = sub(head, tail);
  const l2 = dot(u, u) || 1;
  const d = sub(p, tail);
  return { x: dot(d, u) / l2, y: dot(d, perp(u)) / l2 };
}

/** A Bézier arrow's control points on the page: the tail, then two controls and an end for each curve (3n + 1 points). */
export function bezPoints(r: Pick<Arrow, 'tail' | 'head'> & Partial<Pick<Arrow, 'bez'>>): Vec[] | null {
  if (!r.bez?.length || (r.bez.length + 1) % 3) return null;
  return [r.tail, ...r.bez.map((q) => chordPoint(r.tail, r.head, q)), r.head];
}

/** The point at t (0 to 1) on one cubic Bézier curve. */
export function bezAt(p: Vec[], t: number, i = 0): Vec {
  const [a, b, c, d] = [p[i], p[i + 1], p[i + 2], p[i + 3]];
  const u = 1 - t;
  return {
    x: u * u * u * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t * t * t * d.x,
    y: u * u * u * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t * t * t * d.y,
  };
}

/** One cubic curve (four points) cut at t: the part before and the part after. */
export function splitBez(p: Vec[], t: number): [Vec[], Vec[]] {
  const lerp = (a: Vec, b: Vec) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  const ab = lerp(p[0], p[1]), bc = lerp(p[1], p[2]), cd = lerp(p[2], p[3]);
  const abc = lerp(ab, bc), bcd = lerp(bc, cd), m = lerp(abc, bcd);
  return [[p[0], ab, abc, m], [m, bcd, cd, p[3]]];
}

/**
 * Where along a run of curves (as bezPathAt counts) an arrow head `reach` long has its base:
 * the last point (or, from the tail, the first) that far from the end, but no further in than
 * half way.
 */
export function bezHeadBack(pts: Vec[], reach: number, atTail: boolean): number {
  const n = (pts.length - 1) / 3;
  const tip = atTail ? pts[0] : pts[pts.length - 1];
  const at = (k: number) => (atTail ? k : n - k);
  const steps = 48 * n;
  let lo = 0, hi = n / 2;
  for (let i = 1; i <= steps / 2; i++) {
    const k = (n * i) / steps;
    if (dist(bezPathAt(pts, at(k)), tip) >= reach) { hi = k; lo = (n * (i - 1)) / steps; break; }
  }
  for (let j = 0; j < 20 && hi - lo > 1e-5; j++) {
    const mid = (lo + hi) / 2;
    if (dist(bezPathAt(pts, at(mid)), tip) >= reach) hi = mid; else lo = mid;
  }
  return at(hi);
}

/** The part of a run of cubic curves from t0 to t1 (as bezPathAt counts), as a run of curves. */
export function bezSlice(pts: Vec[], t0: number, t1: number): Vec[] {
  const n = (pts.length - 1) / 3;
  const out: Vec[] = [];
  for (let k = 0; k < n; k++) {
    const a = Math.max(0, t0 - k), b = Math.min(1, t1 - k);
    if (b <= a) continue;
    let seg = pts.slice(3 * k, 3 * k + 4);
    if (b < 1) seg = splitBez(seg, b)[0];
    if (a > 0) seg = splitBez(seg, a / b)[1];
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  return out;
}

/** The point at `t` along a run of cubic curves (0 at the start, the number of curves at the end). */
export function bezPathAt(pts: Vec[], t: number): Vec {
  const n = (pts.length - 1) / 3;
  const k = Math.min(n - 1, Math.max(0, Math.floor(t)));
  return bezAt(pts, Math.min(1, Math.max(0, t - k)), 3 * k);
}

// ------------------------------------------------------------------ connectors

/** Which way out of a shape each connection point faces (top, right, bottom, left). */
export const PORT_OUT: Vec[] = [{ x: 0, y: -1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: -1, y: 0 }];

/** A shape's connection points (the middles of its sides), or null for lines and brackets. */
export function shapePorts(s: Shape): Vec[] | null {
  if (s.kind === 'line' || s.kind === 'bracket' || s.kind === 'symbol') return null;
  const b = shapeBox(s);
  return ports(b.x1, b.y1, b.x2, b.y2);
}

export function gluePoint(s: Shape, port: number): Vec {
  const p = shapePorts(s);
  if (!p) return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  return p[Math.max(0, Math.min(p.length - 1, port))];
}

/** The connection point nearest `p` within `tol`, on any shape that has them (the top one first). */
export function portNear(shapes: Iterable<Shape>, p: Vec, tol: number, skip?: number): (Glue & { at: Vec }) | null {
  let best: (Glue & { at: Vec }) | null = null, bd = tol;
  for (const s of shapes) {
    if (s.id === skip) continue;
    const ps = shapePorts(s);
    if (!ps) continue;
    ps.forEach((q, i) => {
      const d = dist(q, p);
      if (d <= bd) { bd = d; best = { shape: s.id, port: i, at: q }; }
    });
  }
  return best;
}

/**
 * An elbow connector's corners, tail to head: out of each shape square to its side (a short
 * stub), then across and along, as Visio and PowerPoint route them.
 */
export function elbowRoute(r: Curve): Vec[] {
  const stub = 12;
  const outT = r.from ? PORT_OUT[r.from.port] : null, outH = r.to ? PORT_OUT[r.to.port] : null;
  const dx = r.head.x - r.tail.x, dy = r.head.y - r.tail.y;
  const horiz = (v: Vec | null, fallback: boolean) => (v ? v.x !== 0 : fallback);
  const across = Math.abs(dx) >= Math.abs(dy);
  const a = outT ? add(r.tail, mul(outT, stub)) : r.tail;
  const b = outH ? add(r.head, mul(outH, stub)) : r.head;
  const sh = horiz(outT, across), eh = horiz(outH, across);
  let mid: Vec[];
  if (sh && eh) { const mx = (a.x + b.x) / 2; mid = [{ x: mx, y: a.y }, { x: mx, y: b.y }]; }
  else if (!sh && !eh) { const my = (a.y + b.y) / 2; mid = [{ x: a.x, y: my }, { x: b.x, y: my }]; }
  else if (sh) mid = [{ x: b.x, y: a.y }];
  else mid = [{ x: a.x, y: b.y }];
  const pts = [r.tail, a, ...mid, b, r.head];
  // drop repeated points and the middle of three in a line
  const out: Vec[] = [];
  for (const p of pts) {
    if (out.length && dist(out[out.length - 1], p) < 0.01) continue;
    if (out.length >= 2) {
      const u = out[out.length - 2], v = out[out.length - 1];
      if (Math.abs((v.x - u.x) * (p.y - v.y) - (v.y - u.y) * (p.x - v.x)) < 0.01 && dot(sub(v, u), sub(p, v)) >= 0) out.pop();
    }
    out.push(p);
  }
  return out;
}

/** Point halfway along an arrow (on the arc, for curved arrows). */
export function arrowMid(r: Curve): Vec {
  const bz = bezPoints(r);
  if (bz) return bezPathAt(bz, (bz.length - 1) / 6);
  if (!r.sweep) return mul(add(r.tail, r.head), 0.5);
  const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
  return add(center, fromAngle(angleOf(sub(r.tail, center)) + r.sweep / 2, radius));
}

/**
 * Sweep (radians) of the arc from `tail` to `head` that passes through `p`: positive when it
 * bulges to the left of the tail→head direction as seen on screen, 0 for a point on the line.
 */
export function sweepThrough(tail: Vec, head: Vec, p: Vec): number {
  const c = sub(head, tail);
  const l = len(c);
  if (l < 1e-6) return 0;
  const n = perp(mul(c, 1 / l));
  // the arc's height above the middle of the chord (its sagitta) fixes the sweep
  const s = dot(sub(mul(add(tail, head), 0.5), p), n);
  return 4 * Math.atan((2 * s) / l);
}

/** Points along an arrow's line (two for a straight arrow), for highlighting and bounds. */
export function arrowPoints(r: Curve, steps = 24): Vec[] {
  if (r.elbow) return elbowRoute(r);
  const bz = bezPoints(r);
  if (bz) {
    const n = (bz.length - 1) / 3;
    return Array.from({ length: steps + 1 }, (_, i) => bezPathAt(bz, (n * i) / steps));
  }
  if (!r.sweep) return [r.tail, r.head];
  const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
  const a0 = angleOf(sub(r.tail, center));
  const out: Vec[] = [];
  for (let i = 0; i <= steps; i++) out.push(add(center, fromAngle(a0 + (r.sweep * i) / steps, radius)));
  return out;
}

/** Half the distance between the two shafts of an equilibrium or retrosynthetic arrow. */
export function shaftOffset(r: Pick<Arrow, 'equilibrium' | 'shaftSpacing'>): number {
  return r.equilibrium ? 1.5 : r.shaftSpacing ? r.shaftSpacing / 2 : 0;
}

export function arrowBox(r: Arrow): Rect {
  const pad = Math.max(r.headWidth, shaftOffset(r)) + 1;
  return padRect(boxOf(arrowPoints(r)), pad);
}

export function arrowHit(r: Arrow, p: Vec, tol: number): boolean {
  if (r.elbow) {
    const pts = elbowRoute(r);
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return true;
    return false;
  }
  if (r.bez?.length) {
    const pts = arrowPoints(r, 48);
    for (let i = 1; i < pts.length; i++) if (distToSegment(p, pts[i - 1], pts[i]) <= tol) return true;
    return false;
  }
  if (!r.sweep) return distToSegment(p, r.tail, r.head) <= tol + shaftOffset(r);
  const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
  if (Math.abs(dist(p, center) - radius) > tol) return false;
  const a0 = angleOf(sub(r.tail, center)), a = angleOf(sub(p, center));
  const along = r.sweep > 0 ? normAngle(a - a0) : normAngle(a0 - a);
  const slack = tol / Math.max(radius, 1e-6);
  return along <= Math.abs(r.sweep) + slack || along >= 2 * Math.PI - slack;
}

// ------------------------------------------------------------------ shapes

// Bracket proportions, measured from ChemDraw 25 drawing its own square, round and curly
// brackets at several heights: the lips (and the curly hooks) are 0.07 of the spine, a round
// bracket is a circular arc that bows out by 0.135 of it, and a curly bracket's point stands out by 0.08 of it.
const LIP = 0.07, BOW = 0.135, POINT = 0.08;

/** Length of a bracket's lips (the short ends), from the length of its spine. */
export function bracketLip(spine: number): number {
  return Math.max(1.5, spine * LIP);
}

/** How far a bracket reaches out sideways from its spine, on either side. */
export function bracketReach(s: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2' | 'bracket'>): number {
  const l = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
  if (s.bracket === 'round') return l * BOW;
  if (s.bracket === 'curly') return Math.max(bracketLip(l), Math.max(2, l * POINT));
  return bracketLip(l);
}

/** Path pieces: move, line, quadratic curve, and circular arc (centre, radius, start and end angle, anticlockwise). */
export type PathStep = ['M', Vec] | ['L', Vec] | ['Q', Vec, Vec] | ['A', Vec, number, number, number, boolean];

/**
 * Outline of one bracket from p to q, opening to the right of that direction (where a square
 * bracket's lips point). A round bracket is a shallow arc with its ends on the spine; a curly
 * one has rounded hooks, straight runs and a point in the middle.
 */
export function bracketPath(p: Vec, q: Vec, kind: Shape['bracket']): PathStep[] {
  const l = dist(p, q);
  const d = mul(sub(q, p), 1 / (l || 1)), n = perp(d);
  const at = (o: Vec, along: number, out: number): Vec => add(o, add(mul(d, along), mul(n, -out)));
  const m = mul(add(p, q), 0.5);
  if (kind === 'round') {
    // circular arc through both ends, its middle BOW × l out from the spine
    const sag = BOW * l, r = (l * l) / 4 / (2 * sag) + sag / 2;
    const c = at(m, 0, sag - r);
    const a0 = angleOf(sub(p, c)), a1 = angleOf(sub(q, c));
    const turn = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
    return [['M', p], ['A', c, r, a0, a1, turn < 0]];
  }
  const lip = bracketLip(l);
  if (kind === 'curly') {
    const r = Math.min(lip, l / 4), tip = Math.max(2, l * POINT), t = Math.min(0.8 * tip, l / 4);
    return [
      ['M', at(p, 0, -r)], ['Q', p, at(p, r, 0)], ['L', at(m, -t, 0)], ['Q', m, at(m, 0, tip)],
      ['Q', m, at(m, t, 0)], ['L', at(q, -r, 0)], ['Q', q, at(q, 0, -r)],
    ];
  }
  return [['M', at(p, 0, -lip)], ['L', p], ['L', q], ['L', at(q, 0, -lip)]];
}

/** Is this oval a circle? */
export const isCircle = (s: Shape): boolean => s.kind === 'oval' && Math.abs(Math.abs(s.x2 - s.x1) - Math.abs(s.y2 - s.y1)) < 0.01;

/**
 * The order shapes are drawn in, back to front: by their place in the order (set by Bring to
 * Front and Send to Back), and where that is the same, filled shapes behind outlines.
 */
export function shapeOrder(shapes: Shape[]): Shape[] {
  return shapes.slice().sort((a, b) => (a.z ?? 0) - (b.z ?? 0) || (b.filled ? 1 : 0) - (a.filled ? 1 : 0) || a.id - b.id);
}

export function shapeBox(s: Shape): Rect {
  const r = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  if (s.kind === 'bracket') return padRect(r, bracketReach(s));
  if (s.kind === 'rect' && s.shadow) return { ...r, x2: r.x2 + (s.shadowSize ?? 2.4), y2: r.y2 + (s.shadowSize ?? 2.4) };
  if (s.kind === 'picture' && s.look) {
    // half the frame's line sits outside the picture; the shadow reaches down and right
    const f = (s.look.line ?? 0) / 2, sh = s.look.shadow ? PICTURE_SHADOWS[s.look.shadow] : null;
    const d = Math.max(f, sh ? sh.off + sh.blur : 0);
    return { x1: r.x1 - f, y1: r.y1 - f, x2: r.x2 + d, y2: r.y2 + d };
  }
  return r;
}

/** Is p on the shape? Open shapes are picked up by their outline, filled ones anywhere inside. */
export function shapeHit(s: Shape, p: Vec, tol: number): boolean {
  const a = { x: s.x1, y: s.y1 }, b = { x: s.x2, y: s.y2 };
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  switch (s.kind) {
    case 'line':
      return distToSegment(p, a, b) <= tol;
    case 'bracket':
      return distToSegment(p, a, b) <= tol + bracketReach(s) / 2;
    case 'symbol':
    case 'picture':
    case 'table':
      return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
    case 'rect': {
      const inside = p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
      if (s.filled || s.picture) return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      const edge = Math.min(Math.abs(p.x - x1), Math.abs(p.x - x2), Math.abs(p.y - y1), Math.abs(p.y - y2));
      const near = p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      return near && (!inside || edge <= tol);
    }
    case 'geo': {
      // the outline itself, and inside it when filled (or when it has text)
      const out = geoDef(s.geo).draw(x2 - x1, y2 - y1);
      const polys = flatten(moveSteps(out.body, x1, y1));
      if ((s.filled || s.text) && insideOutline(polys, p)) return true;
      return distToOutline(polys, p) <= tol || (!!out.lines && distToOutline(flatten(moveSteps(out.lines, x1, y1)), p) <= tol);
    }
    case 'ring':
      // a ring's fill is picked up anywhere inside the ring
      return !!s.poly && s.poly.length > 2 && insideOutline([s.poly], p);
    case 'oval': {
      const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2, rx = Math.max((x2 - x1) / 2, 1e-6), ry = Math.max((y2 - y1) / 2, 1e-6);
      const k = Math.hypot((p.x - cx) / rx, (p.y - cy) / ry);
      if (s.filled) return k <= 1 + tol / Math.min(rx, ry);
      // distance from p to the outline, measured along the line from the centre
      const off = Math.hypot(p.x - cx, p.y - cy);
      return (k < 1e-9 ? Math.min(rx, ry) : off * Math.abs(1 - 1 / k)) <= tol;
    }
  }
}

// ------------------------------------------------------------------ handles

export type HandleId = 'tail' | 'head' | 'mid' | `b${number}` | 'p1' | 'p2' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Handle {
  kind: 'arrow' | 'shape';
  id: number;
  which: HandleId;
  at: Vec;
}

export function arrowHandles(r: Arrow): Handle[] {
  const h = (which: HandleId, at: Vec): Handle => ({ kind: 'arrow', id: r.id, which, at });
  // an S-shaped (Bézier) arrow: a handle on each control point (and join) instead of the middle
  const bz = bezPoints(r);
  if (bz) return [h('tail', r.tail), h('head', r.head), ...bz.slice(1, -1).map((p, i) => h(`b${i}`, p))];
  // an elbow connector's bends follow its ends, so it has no middle handle
  return r.elbow ? [h('tail', r.tail), h('head', r.head)] : [h('tail', r.tail), h('head', r.head), h('mid', arrowMid(r))];
}

export function shapeHandles(s: Shape): Handle[] {
  const h = (which: HandleId, x: number, y: number): Handle => ({ kind: 'shape', id: s.id, which, at: { x, y } });
  if (s.kind === 'line' || s.kind === 'bracket') return [h('p1', s.x1, s.y1), h('p2', s.x2, s.y2)];
  if (s.kind === 'symbol' || s.kind === 'table' || s.picture) return [];
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const corners = [h('nw', x1, y1), h('ne', x2, y1), h('se', x2, y2), h('sw', x1, y2)];
  // a circle stays a circle, so it only gets corners
  return isCircle(s) ? corners : [...corners, h('n', mx, y1), h('e', x2, my), h('s', mx, y2), h('w', x1, my)];
}

const NO_CROP = { l: 0, t: 0, r: 0, b: 0 };

/**
 * Cropping a picture by dragging a handle to `p`: the edge moves and the part of the picture
 * beyond it is cut off (or uncovered again), while the rest stays where it was.
 */
export function dragCropHandle(s: Shape, which: HandleId, p: Vec): Partial<Shape> {
  const c = { ...(s.crop ?? NO_CROP) };
  let x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  // size of the whole picture, uncropped
  const W = (x2 - x1) / Math.max(0.01, 1 - c.l - c.r), H = (y2 - y1) / Math.max(0.01, 1 - c.t - c.b);
  const MIN = 0.02;
  if (which.includes('w')) { const l = clamp(c.l + (p.x - x1) / W, 0, 1 - c.r - MIN); x1 += (l - c.l) * W; c.l = l; }
  if (which.includes('e')) { const r = clamp(c.r + (x2 - p.x) / W, 0, 1 - c.l - MIN); x2 -= (r - c.r) * W; c.r = r; }
  if (which.includes('n')) { const t = clamp(c.t + (p.y - y1) / H, 0, 1 - c.b - MIN); y1 += (t - c.t) * H; c.t = t; }
  if (which.includes('s')) { const b = clamp(c.b + (y2 - p.y) / H, 0, 1 - c.t - MIN); y2 -= (b - c.b) * H; c.b = b; }
  return { x1, y1, x2, y2, crop: c.l || c.t || c.r || c.b ? c : undefined };
}

/**
 * A picture with its edges cut to `crop` (fractions of the whole picture from each side): the
 * part still showing stays where it is, at the same scale. Crops that leave nothing are reduced.
 */
export function cropTo(s: Shape, crop: { l: number; t: number; r: number; b: number }): Partial<Shape> {
  const c = s.crop ?? NO_CROP;
  let x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  const W = (x2 - x1) / Math.max(0.01, 1 - c.l - c.r), H = (y2 - y1) / Math.max(0.01, 1 - c.t - c.b);
  const MIN = 0.02;
  const l = clamp(crop.l, 0, 1 - MIN), r = clamp(crop.r, 0, 1 - MIN - l);
  const t = clamp(crop.t, 0, 1 - MIN), b = clamp(crop.b, 0, 1 - MIN - t);
  x1 += (l - c.l) * W;
  x2 -= (r - c.r) * W;
  y1 += (t - c.t) * H;
  y2 -= (b - c.b) * H;
  return { x1, y1, x2, y2, crop: l || t || r || b ? { l, t, r, b } : undefined };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** A picture resized from a corner keeps its proportions (unless `free`); from an edge it stretches. */
function dragPictureHandle(s: Shape, which: HandleId, p: Vec, free: boolean, how: ResizeHow): Partial<Shape> {
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  // a picture keeps its proportions unless Alt is held (Shift keeps them even then)
  return resizeBox({ x1, y1, x2, y2 }, which, p, { keep: !free || !!how.keep, centre: how.centre });
}

/** How a resize handle drags: keeping the proportions (Shift), and about the middle (Ctrl). */
export interface ResizeHow {
  keep?: boolean;
  centre?: boolean;
}

/**
 * A box resized by dragging one of its handles to `p`. The opposite side stays put, or the
 * middle does with `centre`. With `keep`, a corner keeps the box's proportions (the larger
 * stretch decides the size). A side or corner dragged past the opposite one turns the box over.
 */
export function resizeBox(r: Rect, which: HandleId, p: Vec, how: ResizeHow = {}): Rect {
  const hx = which.includes('w') ? -1 : which.includes('e') ? 1 : 0;
  const hy = which.includes('n') ? -1 : which.includes('s') ? 1 : 0;
  const cx = (r.x1 + r.x2) / 2, cy = (r.y1 + r.y2) / 2;
  // where each moving side is measured from, and how much of the box that distance spans
  const ax = how.centre ? cx : hx < 0 ? r.x2 : r.x1, ay = how.centre ? cy : hy < 0 ? r.y2 : r.y1;
  const part = how.centre ? 0.5 : 1;
  let dx = p.x - ax, dy = p.y - ay;
  if (how.keep && hx && hy) {
    const w0 = Math.max(1e-6, (r.x2 - r.x1) * part), h0 = Math.max(1e-6, (r.y2 - r.y1) * part);
    const k = Math.max(0.01, Math.abs(dx) / w0, Math.abs(dy) / h0);
    dx = hx * w0 * k;
    dy = hy * h0 * k;
  }
  const span = (a: number, d: number, lo: number, hi: number, moving: number): [number, number] =>
    !moving ? [lo, hi] : how.centre ? [a - Math.abs(d), a + Math.abs(d)] : [Math.min(a, a + d), Math.max(a, a + d)];
  const [x1, x2] = span(ax, dx, r.x1, r.x2, hx);
  const [y1, y2] = span(ay, dy, r.y1, r.y2, hy);
  return { x1, y1, x2, y2 };
}

/** End point `p` seen from `from`, with the angle snapped to 15° unless `free`. */
function snapEnd(from: Vec, p: Vec, free: boolean): Vec {
  if (free) return p;
  return add(from, fromAngle(snapAngle(angleOf(sub(p, from))), dist(from, p)));
}

/** What dragging an arrow's handle to `p` changes. `free` (Alt) turns off snapping. */
export function dragArrowHandle(r: Arrow, which: HandleId, p: Vec, free: boolean): Partial<Arrow> {
  if (which === 'tail' || which === 'head') {
    const other = which === 'tail' ? r.head : r.tail;
    let q = snapEnd(other, p, free);
    if (dist(q, other) < 2) q = add(other, mul(sub(which === 'tail' ? r.tail : r.head, other), 2 / Math.max(dist(r.tail, r.head), 1e-6)));
    return which === 'tail' ? { tail: q } : { head: q };
  }
  // a control point of an S-shaped arrow goes where it is dragged
  if (which[0] === 'b' && r.bez) {
    const k = Number(which.slice(1));
    return { bez: r.bez.map((q, i) => (i === k ? chordLocal(r.tail, r.head, p) : q)) };
  }
  // dragging the middle bends the arrow into an arc through the pointer, in 15° steps
  let sweep = sweepThrough(r.tail, r.head, p);
  const max = 330 * DEG;
  sweep = Math.max(-max, Math.min(max, sweep));
  if (!free) sweep = Math.round(sweep / (15 * DEG)) * 15 * DEG;
  else if (Math.abs(sweep) < 1 * DEG) sweep = 0;
  const patch: Partial<Arrow> = { sweep: sweep || 0 };
  // a half head (fishhook) keeps its barb on the outside of the curve
  if (sweep && r.sweep && Math.sign(sweep) !== Math.sign(r.sweep)) {
    const swap = (h: Arrow['headStyle']) => (h === 'halfLeft' ? 'halfRight' : h === 'halfRight' ? 'halfLeft' : h);
    if (!r.equilibrium) { patch.headStyle = swap(r.headStyle); patch.tailStyle = swap(r.tailStyle); }
  }
  return patch;
}

/** What dragging a shape's handle to `p` changes. `free` (Alt) turns off angle snapping for lines. */
export function dragShapeHandle(s: Shape, which: HandleId, p: Vec, free: boolean, how: ResizeHow = {}): Partial<Shape> {
  if (which === 'p1') { const q = snapEnd({ x: s.x2, y: s.y2 }, p, free); return { x1: q.x, y1: q.y }; }
  if (which === 'p2') { const q = snapEnd({ x: s.x1, y: s.y1 }, p, free); return { x2: q.x, y2: q.y }; }
  if (s.kind === 'picture') return dragPictureHandle(s, which, p, free, how);
  const box = { x1: Math.min(s.x1, s.x2), x2: Math.max(s.x1, s.x2), y1: Math.min(s.y1, s.y2), y2: Math.max(s.y1, s.y2) };
  if (isCircle(s)) {
    // resize about the opposite corner (or the middle), keeping it round
    const ox = how.centre ? (box.x1 + box.x2) / 2 : which.includes('w') ? box.x2 : box.x1;
    const oy = how.centre ? (box.y1 + box.y2) / 2 : which.includes('n') ? box.y2 : box.y1;
    const d = Math.max(1, Math.max(Math.abs(p.x - ox), Math.abs(p.y - oy)));
    if (how.centre) return { x1: ox - d, x2: ox + d, y1: oy - d, y2: oy + d };
    const sx = p.x < ox ? -1 : 1, sy = p.y < oy ? -1 : 1;
    return { x1: Math.min(ox, ox + sx * d), x2: Math.max(ox, ox + sx * d), y1: Math.min(oy, oy + sy * d), y2: Math.max(oy, oy + sy * d) };
  }
  return resizeBox(box, which, p, how);
}

/** Two brackets, facing each other, on the left and right edges of a box. */
export function bracketsAround(r: Rect, bracket: NonNullable<Shape['bracket']>): Omit<Shape, 'id'>[] {
  // a bracket's lips point to the right of the direction from (x1,y1) to (x2,y2), as ChemDraw stores them
  return [
    { kind: 'bracket', bracket, x1: r.x1, y1: r.y2, x2: r.x1, y2: r.y1 },
    { kind: 'bracket', bracket, x1: r.x2, y1: r.y1, x2: r.x2, y2: r.y2 },
  ];
}

// ------------------------------------------------------------------ boxes

export function boxOf(pts: Vec[]): Rect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x1, y1, x2, y2 };
}

export function padRect(r: Rect, d: number): Rect {
  return { x1: r.x1 - d, y1: r.y1 - d, x2: r.x2 + d, y2: r.y2 + d };
}

export function unionRect(a: Rect | null, b: Rect): Rect {
  if (!a) return { ...b };
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}
