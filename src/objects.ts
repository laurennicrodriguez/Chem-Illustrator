// Geometry of arrows and shapes: where they are (bounding boxes, hit testing), the handles a
// selected arrow or shape shows, and what dragging one of those handles does. Shared by the
// editor and the renderer.

import type { Arrow, Shape } from './model';
import { Vec, Rect, add, sub, mul, perp, dist, dot, len, angleOf, fromAngle, normAngle, snapAngle, distToSegment, arcCenter, DEG } from './geom';

// ------------------------------------------------------------------ arrows

type Curve = Pick<Arrow, 'tail' | 'head' | 'sweep'>;

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
  if (!r.sweep) return distToSegment(p, r.tail, r.head) <= tol + shaftOffset(r);
  const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
  if (Math.abs(dist(p, center) - radius) > tol) return false;
  const a0 = angleOf(sub(r.tail, center)), a = angleOf(sub(p, center));
  const along = r.sweep > 0 ? normAngle(a - a0) : normAngle(a0 - a);
  const slack = tol / Math.max(radius, 1e-6);
  return along <= Math.abs(r.sweep) + slack || along >= 2 * Math.PI - slack;
}

// ------------------------------------------------------------------ shapes

/** Length of a bracket's lips (the short ends), from the length of its spine. */
export function bracketLip(spine: number): number {
  return Math.max(1.5, Math.min(spine * 0.12, 4));
}

/** Is this oval a circle? */
export const isCircle = (s: Shape): boolean => s.kind === 'oval' && Math.abs(Math.abs(s.x2 - s.x1) - Math.abs(s.y2 - s.y1)) < 0.01;

export function shapeBox(s: Shape): Rect {
  const r = { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) };
  if (s.kind === 'bracket') return padRect(r, bracketLip(Math.hypot(s.x2 - s.x1, s.y2 - s.y1)));
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
      return distToSegment(p, a, b) <= tol + bracketLip(dist(a, b)) / 2;
    case 'symbol':
      return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
    case 'rect': {
      const inside = p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
      if (s.filled || s.picture) return p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      const edge = Math.min(Math.abs(p.x - x1), Math.abs(p.x - x2), Math.abs(p.y - y1), Math.abs(p.y - y2));
      const near = p.x >= x1 - tol && p.x <= x2 + tol && p.y >= y1 - tol && p.y <= y2 + tol;
      return near && (!inside || edge <= tol);
    }
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
  return [h('tail', r.tail), h('head', r.head), h('mid', arrowMid(r))];
}

export function shapeHandles(s: Shape): Handle[] {
  const h = (which: HandleId, x: number, y: number): Handle => ({ kind: 'shape', id: s.id, which, at: { x, y } });
  if (s.kind === 'line' || s.kind === 'bracket') return [h('p1', s.x1, s.y1), h('p2', s.x2, s.y2)];
  if (s.kind === 'symbol' || s.picture) return [];
  const x1 = Math.min(s.x1, s.x2), x2 = Math.max(s.x1, s.x2), y1 = Math.min(s.y1, s.y2), y2 = Math.max(s.y1, s.y2);
  const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  const corners = [h('nw', x1, y1), h('ne', x2, y1), h('se', x2, y2), h('sw', x1, y2)];
  // a circle stays a circle, so it only gets corners
  return isCircle(s) ? corners : [...corners, h('n', mx, y1), h('e', x2, my), h('s', mx, y2), h('w', x1, my)];
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
