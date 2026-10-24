// The drawing's scroll bars: how long the thumbs are and where they sit.

import { describe, it, expect } from 'vitest';
import { thumbFor, scrollRange, clampPan, stopAtEdge } from '../src/ui/scrollbars';

describe('scroll bars', () => {
  it('make the thumb as long as the part on screen, and put it where that part is', () => {
    // a quarter of the range on screen, at its start, middle and end
    expect(thumbFor([0, 400], [0, 100], 200)).toEqual({ start: 0, size: 50 });
    expect(thumbFor([0, 400], [150, 250], 200)).toEqual({ start: 75, size: 50 });
    expect(thumbFor([0, 400], [300, 400], 200)).toEqual({ start: 150, size: 50 });
  });

  it('keep the thumb big enough to grab', () => {
    expect(thumbFor([0, 100000], [0, 10], 200).size).toBe(24);
  });

  it('cover the drawing with a quarter of a screen of room round it, and what is on screen', () => {
    const r = scrollRange({ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 500, y1: 0, x2: 700, y2: 100 });
    expect(r).toEqual({ x1: -50, y1: -25, x2: 700, y2: 100 });
  });

  it('give somewhere to go when nothing is drawn', () => {
    expect(scrollRange(null, { x1: 0, y1: 0, x2: 100, y2: 80 })).toEqual({ x1: -100, y1: -80, x2: 200, y2: 160 });
  });
});

describe('scrolling stops at the edge', () => {
  it('keeps a scroll inside the ends, but lets a view already past one come back', () => {
    expect(clampPan(0, 50, -10, 20)).toBe(20);
    expect(clampPan(0, -50, -10, 20)).toBe(-10);
    expect(clampPan(40, 60, -10, 20)).toBe(40);
    expect(clampPan(40, 30, -10, 20)).toBe(30);
  });

  it('stops the wheel a quarter of a screen past a big drawing, at any zoom', () => {
    // a 1000 × 600 point drawing in a 400 × 300 px window at 2× (200 × 150 points on screen)
    const big = { x1: 0, y1: 0, x2: 1000, y2: 600 };
    const r = { view: { ox: 0, oy: 0, scale: 2 }, width: 400, height: 300 };
    r.view.oy = -10000;
    stopAtEdge(r, big, { ox: 0, oy: 0 });
    // the top of the screen goes no lower than 600 + 37.5 − 150 points
    expect(r.view.oy).toBe(-975);
    r.view.ox = 10000;
    stopAtEdge(r, big, { ox: 0, oy: -975 });
    // nor further left than 50 points before the drawing
    expect(r.view.ox).toBe(100);
  });

  it('keeps a small drawing on screen', () => {
    const r = { view: { ox: 0, oy: 0, scale: 1 }, width: 400, height: 300 };
    r.view.oy = -10000;
    stopAtEdge(r, { x1: 100, y1: 100, x2: 150, y2: 150 }, { ox: 0, oy: 0 });
    // scrolling down stops with the drawing's top a quarter of the window (75 points) below the window's
    expect(r.view.oy).toBe(-25);
  });

  it('lets an empty drawing scroll freely', () => {
    const r = { view: { ox: -5000, oy: 0, scale: 1 }, width: 400, height: 300 };
    stopAtEdge(r, null, { ox: 0, oy: 0 });
    expect(r.view.ox).toBe(-5000);
  });
});
