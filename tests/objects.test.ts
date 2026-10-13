import { describe, it, expect } from 'vitest';
import { Arrow, Shape } from '../src/model';
import {
  arrowMid, sweepThrough, arrowHit, arrowPoints, arrowBox, shapeHit, shapeBox, dragArrowHandle, dragShapeHandle,
  shapeHandles, arrowHandles, bracketsAround, bracketLip,
} from '../src/objects';
import { arcCenter, dist, DEG } from '../src/geom';

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function arrow(extra: Partial<Arrow> = {}): Arrow {
  return {
    id: 1, tail: { x: 0, y: 0 }, head: { x: 40, y: 0 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
    noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, ...extra,
  };
}

function shape(extra: Partial<Shape> & { kind: Shape['kind'] }): Shape {
  return { id: 2, x1: 0, y1: 0, x2: 40, y2: 20, ...extra };
}

describe('curved arrows', () => {
  it('puts the middle of a straight arrow halfway along', () => {
    expect(arrowMid(arrow())).toEqual({ x: 20, y: 0 });
  });
  it('puts the middle of a half-circle arrow at the top of the arc', () => {
    // a left-to-right arrow with a positive sweep bulges upwards on screen (y runs down)
    const m = arrowMid(arrow({ sweep: Math.PI }));
    expect(close(m.x, 20)).toBe(true);
    expect(close(m.y, -20)).toBe(true);
  });
  it('finds the sweep of the arc through a point, and the arc goes back through it', () => {
    for (const deg of [30, 90, 120, 180, 240, -60, -150]) {
      const r = arrow({ sweep: deg * DEG });
      const m = arrowMid(r);
      expect(close(sweepThrough(r.tail, r.head, m), deg * DEG, 1e-9)).toBe(true);
    }
    expect(sweepThrough({ x: 0, y: 0 }, { x: 40, y: 0 }, { x: 13, y: 0 })).toBe(0);
  });
  it('picks an arrow up along its arc, not along the straight line', () => {
    const r = arrow({ sweep: Math.PI });
    expect(arrowHit(r, { x: 20, y: -20 }, 2)).toBe(true);
    expect(arrowHit(r, { x: 20, y: 0 }, 2)).toBe(false);
    // the other half of the circle is not part of the arrow
    expect(arrowHit(r, { x: 20, y: 20 }, 2)).toBe(false);
    expect(arrowHit(arrow(), { x: 20, y: 1 }, 2)).toBe(true);
  });
  it('includes the bulge of an arc in its box', () => {
    const b = arrowBox(arrow({ sweep: Math.PI }));
    expect(b.y1).toBeLessThan(-20);
    const pts = arrowPoints(arrow({ sweep: 90 * DEG }), 8);
    expect(pts.length).toBe(9);
    const { center, radius } = arcCenter({ x: 0, y: 0 }, { x: 40, y: 0 }, 90 * DEG);
    for (const p of pts) expect(close(dist(p, center), radius, 1e-9)).toBe(true);
  });
});

describe('arrow handles', () => {
  it('has handles at both ends and in the middle', () => {
    const hs = arrowHandles(arrow());
    expect(hs.map((h) => h.which)).toEqual(['tail', 'head', 'mid']);
  });
  it('moves an end in 15° steps, keeping the other end where it is', () => {
    const p = dragArrowHandle(arrow(), 'head', { x: 40, y: 3 }, false);
    expect(close(p.head!.y, 0, 1e-9)).toBe(true);
    expect(close(p.head!.x, Math.hypot(40, 3), 1e-9)).toBe(true);
    const free = dragArrowHandle(arrow(), 'head', { x: 40, y: 3 }, true);
    expect(free.head).toEqual({ x: 40, y: 3 });
  });
  it('bends the arrow in 15° steps when the middle is dragged, and straightens it near the line', () => {
    const r = arrow();
    const up = dragArrowHandle(r, 'mid', arrowMid(arrow({ sweep: 118 * DEG })), false);
    expect(close(up.sweep!, 120 * DEG, 1e-9)).toBe(true);
    expect(dragArrowHandle(r, 'mid', { x: 20, y: 0.5 }, false).sweep).toBe(0);
    const free = dragArrowHandle(r, 'mid', arrowMid(arrow({ sweep: 118 * DEG })), true);
    expect(close(free.sweep!, 118 * DEG, 1e-9)).toBe(true);
  });
  it('keeps a fishhook’s barb on the outside when the curve flips over', () => {
    const r = arrow({ sweep: 90 * DEG, headStyle: 'halfLeft' });
    const p = dragArrowHandle(r, 'mid', { x: 20, y: 15 }, false);
    expect(p.sweep!).toBeLessThan(0);
    expect(p.headStyle).toBe('halfRight');
  });
});

describe('shapes', () => {
  it('picks up an open box by its edge only, and a filled one anywhere', () => {
    const b = shape({ kind: 'rect' });
    expect(shapeHit(b, { x: 20, y: 0.5 }, 1)).toBe(true);
    expect(shapeHit(b, { x: 20, y: 10 }, 1)).toBe(false);
    expect(shapeHit(b, { x: 20, y: 25 }, 1)).toBe(false);
    expect(shapeHit({ ...b, filled: true }, { x: 20, y: 10 }, 1)).toBe(true);
  });
  it('picks up an oval by its outline', () => {
    const o = shape({ kind: 'oval' });
    expect(shapeHit(o, { x: 40, y: 10 }, 1)).toBe(true);
    expect(shapeHit(o, { x: 20, y: 0 }, 1)).toBe(true);
    expect(shapeHit(o, { x: 20, y: 10 }, 1)).toBe(false);
    expect(shapeHit({ ...o, filled: true }, { x: 20, y: 10 }, 1)).toBe(true);
  });
  it('picks up lines and brackets near their line', () => {
    expect(shapeHit(shape({ kind: 'line' }), { x: 20, y: 10 }, 1)).toBe(true);
    expect(shapeHit(shape({ kind: 'line' }), { x: 20, y: 14 }, 1)).toBe(false);
    expect(shapeHit(shape({ kind: 'bracket', x2: 0, y2: 40 }), { x: 1, y: 20 }, 1)).toBe(true);
  });
  it('resizes a box from a corner and an edge', () => {
    const b = shape({ kind: 'rect' });
    expect(dragShapeHandle(b, 'se', { x: 50, y: 30 }, false)).toEqual({ x1: 0, y1: 0, x2: 50, y2: 30 });
    expect(dragShapeHandle(b, 'n', { x: 99, y: -5 }, false)).toEqual({ x1: 0, y1: -5, x2: 40, y2: 20 });
    // dragging past the opposite side turns it inside out rather than giving a negative size
    expect(dragShapeHandle(b, 'w', { x: 60, y: 0 }, false)).toEqual({ x1: 40, y1: 0, x2: 60, y2: 20 });
  });
  it('keeps a circle round, with handles only on its corners', () => {
    const c = shape({ kind: 'oval', x2: 20, y2: 20 });
    expect(shapeHandles(c).length).toBe(4);
    expect(shapeHandles(shape({ kind: 'oval' })).length).toBe(8);
    const p = dragShapeHandle(c, 'se', { x: 30, y: 25 }, false);
    expect(p.x2! - p.x1!).toBe(30);
    expect(p.y2! - p.y1!).toBe(30);
  });
  it('snaps a line end to 15° steps', () => {
    const p = dragShapeHandle(shape({ kind: 'line', x2: 40, y2: 0 }), 'p2', { x: 40, y: 2 }, false);
    expect(close(p.y2!, 0, 1e-9)).toBe(true);
  });
  it('puts brackets on both sides of a box, lips facing in', () => {
    const [l, r] = bracketsAround({ x1: 0, y1: 0, x2: 50, y2: 30 }, 'square');
    // lips sit on the right of the direction (x1,y1)→(x2,y2): left bracket runs up, right one down
    expect([l.x1, l.y1, l.x2, l.y2]).toEqual([0, 30, 0, 0]);
    expect([r.x1, r.y1, r.x2, r.y2]).toEqual([50, 0, 50, 30]);
    expect(shapeBox({ id: 1, ...l }).x1).toBeCloseTo(-bracketLip(30));
  });
});
