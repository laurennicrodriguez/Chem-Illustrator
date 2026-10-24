import { describe, expect, it } from 'vitest';
import { pinchView } from '../src/editor/touch';

describe('pinch zoom', () => {
  const v0 = { ox: 10, oy: 20, scale: 2 };
  it('keeps the point under the fingers under them as they spread', () => {
    const v = pinchView(v0, { x: 100, y: 100 }, { x: 200, y: 100 }, { x: 50, y: 100 }, { x: 250, y: 100 });
    expect(v.scale).toBeCloseTo(4);
    // the drawing point under the midpoint (150,100) before is still there after
    const before = { x: (150 - v0.ox) / v0.scale, y: (100 - v0.oy) / v0.scale };
    expect(before.x * v.scale + v.ox).toBeCloseTo(150);
    expect(before.y * v.scale + v.oy).toBeCloseTo(100);
  });
  it('pans when the fingers move together', () => {
    const v = pinchView(v0, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 30, y: 40 }, { x: 130, y: 40 });
    expect(v).toEqual({ ox: 40, oy: 60, scale: 2 });
  });
  it('stays within the zoom limits', () => {
    expect(pinchView(v0, { x: 0, y: 0 }, { x: 100, y: 0 }, { x: 0, y: 0 }, { x: 1e6, y: 0 }).scale).toBe(64);
  });
});
