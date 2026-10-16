// @vitest-environment jsdom
//
// A curved arrow's line stops inside its head (round 3, item 5): it used to run right to the
// head's point, so its square end showed past the point.

import { describe, it, expect } from 'vitest';
import { Renderer, shaftInto, arcHeadBack } from '../src/render/renderer';
import type { Arrow } from '../src/model';

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;

/** A pretend canvas that keeps the last point of every stroked line. */
function recorder() {
  const ends: { x: number; y: number }[] = [];
  let last = { x: 0, y: 0 };
  const ctx: Record<string, unknown> = {
    beginPath() {}, closePath() {}, fill() {}, setLineDash() {},
    moveTo(x: number, y: number) { last = { x, y }; },
    lineTo(x: number, y: number) { last = { x, y }; },
    arc(cx: number, cy: number, r: number, _a0: number, a1: number) { last = { x: cx + r * Math.cos(a1), y: cy + r * Math.sin(a1) }; },
    stroke() { ends.push(last); },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ends };
}

const arrow = (sweep: number, extra: Partial<Arrow> = {}): Arrow => ({
  id: 1, tail: { x: 0, y: 0 }, head: { x: 20, y: 0 }, sweep, headStyle: 'full', tailStyle: 'none', headType: 'solid',
  line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.6, ...extra,
});

describe('curved arrow line', () => {
  for (const sweep of [0.6, 1.5, 3, 4.5, -2]) {
    for (const headStyle of ['full', 'halfLeft', 'halfRight'] as const) {
      it(`stops inside a ${headStyle} head (sweep ${sweep})`, () => {
        const { ctx, ends } = recorder();
        new Renderer(noCanvas, noCanvas).drawArrow(ctx, arrow(sweep, { headStyle }), 0.6);
        const shaftEnd = ends[0];
        const gap = Math.hypot(shaftEnd.x - 20, shaftEnd.y);
        // well short of the point, but still within the head
        expect(gap).toBeGreaterThan(6 * 0.6);
        expect(gap).toBeLessThan(6);
      });
    }
  }

  it('runs nearly to the point of an open head, whose barbs meet there', () => {
    const { ctx, ends } = recorder();
    new Renderer(noCanvas, noCanvas).drawArrow(ctx, arrow(1.5, { headType: 'angle' }), 0.6);
    expect(Math.hypot(ends[0].x - 20, ends[0].y)).toBeLessThan(1);
  });

  it('runs to the end when there is no head', () => {
    const { ctx, ends } = recorder();
    new Renderer(noCanvas, noCanvas).drawArrow(ctx, arrow(1.5, { headStyle: 'none' }), 0.6);
    expect(Math.hypot(ends[0].x - 20, ends[0].y)).toBeLessThan(1e-6);
  });

  it('works out the stopping distances', () => {
    expect(shaftInto(10, 'solid', 1)).toBeCloseTo(7);
    expect(shaftInto(10, 'angle', 1)).toBe(1);
    expect(arcHeadBack(8, 10, 3)).toBeCloseTo(0.64);
    expect(arcHeadBack(8, 1, 0.5)).toBeCloseTo(0.25);
  });
});
