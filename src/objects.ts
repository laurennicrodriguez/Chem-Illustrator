// Geometry of arrows and shapes: where they are (bounding boxes, hit testing), the handles a
// selected arrow or shape shows, and what dragging one of those handles does. Shared by the
// editor and the renderer.

import type { Arrow, Shape, Glue } from './model';
import { Vec, Rect, add, sub, mul, perp, dist, dot, len, angleOf, fromAngle, normAngle, snapAngle, distToSegment, arcCenter, DEG } from './geom';
import { geoDef, flatten, moveSteps, insideOutline, distToOutline, ports } from './design/geo';

// ------------------------------------------------------------------ arrows

type Curve = Pick<Arrow, 'tail' | 'head' | 'sweep'> & Partial<Pick<Arrow, 'elbow' | 'from' | 'to'>>;

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

export type HandleId = 'tail' | 'head' | 'mid' | 'p1' | 'p2' | 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Handle {
  kind: 'arrow' | 'shape';
  id: number;
  which: HandleId;
  at: Vec;
}

export function arrowHandles(r: Arrow): Handle[] {
  const h = (which: HandleId, at: Vec): Handle => ({ kind: 'arrow', id: r.id, which, at });
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
function dragPictureHandle(s: Shape, which: HandleId, p: Vec, free: boolean): Partial<Shape> {
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  if (free || which.length === 1) return stretch(x1, y1, x2, y2, which, p);
  const ox = which.includes('w') ? x2 : x1, oy = which.includes('n') ? y2 : y1;
  const w0 = x2 - x1, h0 = y2 - y1;
  // the larger of the two stretches decides the new size
  const k = Math.max(0.01, Math.max(Math.abs(p.x - ox) / w0, Math.abs(p.y - oy) / h0));
  const w = w0 * k, h = h0 * k;
  const nx1 = which.includes('w') ? ox - w : ox, ny1 = which.includes('n') ? oy - h : oy;
  return { x1: nx1, y1: ny1, x2: nx1 + w, y2: ny1 + h };
}

function stretch(x1: number, y1: number, x2: number, y2: number, which: HandleId, p: Vec): Partial<Shape> {
  if (which.includes('w')) x1 = p.x;
  if (which.includes('e')) x2 = p.x;
  if (which.includes('n')) y1 = p.y;
  if (which.includes('s')) y2 = p.y;
  return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2) };
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
export function dragShapeHandle(s: Shape, which: HandleId, p: Vec, free: boolean): Partial<Shape> {
  if (which === 'p1') { const q = snapEnd({ x: s.x2, y: s.y2 }, p, free); return { x1: q.x, y1: q.y }; }
  if (which === 'p2') { const q = snapEnd({ x: s.x1, y: s.y1 }, p, free); return { x2: q.x, y2: q.y }; }
  if (s.kind === 'picture') return dragPictureHandle(s, which, p, free);
  let x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  if (isCircle(s)) {
    // resize about the opposite corner, keeping it round
    const ox = which.includes('w') ? x2 : x1, oy = which.includes('n') ? y2 : y1;
    const d = Math.max(1, Math.max(Math.abs(p.x - ox), Math.abs(p.y - oy)));
    const sx = p.x < ox ? -1 : 1, sy = p.y < oy ? -1 : 1;
    return { x1: Math.min(ox, ox + sx * d), x2: Math.max(ox, ox + sx * d), y1: Math.min(oy, oy + sy * d), y2: Math.max(oy, oy + sy * d) };
  }
  if (which.includes('w')) x1 = p.x;
  if (which.includes('e')) x2 = p.x;
  if (which.includes('n')) y1 = p.y;
  if (which.includes('s')) y2 = p.y;
  return { x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2) };
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
