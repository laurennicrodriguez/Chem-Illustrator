// The drawing's scroll bars: how long the thumbs are and where they sit.

import { describe, it, expect } from 'vitest';
import { thumbFor, scrollRange } from '../src/ui/scrollbars';

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

  it('cover the drawing with half a screen of room round it, and what is on screen', () => {
    const r = scrollRange({ x1: 0, y1: 0, x2: 100, y2: 50 }, { x1: 500, y1: 0, x2: 700, y2: 100 });
    expect(r).toEqual({ x1: -100, y1: -50, x2: 700, y2: 100 });
  });

  it('give somewhere to go when nothing is drawn', () => {
    expect(scrollRange(null, { x1: 0, y1: 0, x2: 100, y2: 80 })).toEqual({ x1: -100, y1: -80, x2: 200, y2: 160 });
  });
});
