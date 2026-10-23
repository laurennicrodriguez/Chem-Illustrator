import { describe, expect, it } from 'vitest';
import { DEFAULT_ORIENT, edgeMarks, edgeSpot, fitInto, gridStep, parseOrient, seenRect } from '../src/orientation-prefs';
import { parseSettings } from '../src/settings';

describe('navigation settings', () => {
  it('reads what it understands and keeps defaults for the rest', () => {
    expect(parseOrient(undefined)).toEqual(DEFAULT_ORIENT);
    const o = parseOrient({ navigator: false, navCorner: 'tl', navSize: 'huge', dotGrid: 'yes', tint: true, tintStrength: 'strong' });
    expect(o.navigator).toBe(false);
    expect(o.navCorner).toBe('tl');
    expect(o.navSize).toBe(DEFAULT_ORIENT.navSize);
    expect(o.dotGrid).toBe(DEFAULT_ORIENT.dotGrid);
    expect(o.tint).toBe(true);
    expect(o.tintStrength).toBe('strong');
  });

  it('round-trips through the settings file', () => {
    const s = parseSettings(JSON.stringify({ orient: { edgeArrows: false, arrowsTo: 'everything' } }));
    expect(s.orient.edgeArrows).toBe(false);
    expect(s.orient.arrowsTo).toBe('everything');
    expect(parseSettings('{}').orient).toEqual(DEFAULT_ORIENT);
  });
});

describe('dot grid', () => {
  it('keeps the set spacing when zoomed in and spreads out when zoomed out', () => {
    expect(gridStep(36, 2)).toBe(36);
    // 36 pt at 0.1 px/pt is 3.6 px: doubled twice, to 14.4 px
    expect(gridStep(36, 0.1)).toBe(144);
    expect(gridStep(36, 0.1) * 0.1).toBeGreaterThanOrEqual(12);
  });
});

describe('edge arrows', () => {
  const view = { ox: 0, oy: 0, scale: 1 };

  it('sit where the line from the middle leaves the window', () => {
    const s = edgeSpot(400, 300, 20, { x: 1000, y: 150 });
    expect(s.x).toBeCloseTo(380);
    expect(s.y).toBeCloseTo(150);
    expect(s.angle).toBeCloseTo(0);
    const up = edgeSpot(400, 300, 20, { x: 200, y: -500 });
    expect(up.y).toBeCloseTo(20);
    expect(up.angle).toBeCloseTo(-Math.PI / 2);
  });

  it('point only to things out of sight, joining those close together', () => {
    const things = [
      { box: { x1: 100, y1: 100, x2: 120, y2: 120 }, item: 'on screen' },
      { box: { x1: 900, y1: 140, x2: 950, y2: 160 }, item: 'right near' },
      { box: { x1: 2000, y1: 145, x2: 2050, y2: 155 }, item: 'right far' },
      { box: { x1: 180, y1: -900, x2: 220, y2: -850 }, item: 'above' },
    ];
    const marks = edgeMarks(things, view, 400, 300);
    expect(marks).toHaveLength(2);
    const right = marks.find((m) => m.items.includes('right near'))!;
    expect(right.items).toEqual(['right near', 'right far']);
    expect(right.nearest).toBe('right near');
    expect(marks.find((m) => m.items.includes('above'))).toBeTruthy();
  });
});

describe('navigator', () => {
  it('fits a box whole and centred', () => {
    const f = fitInto({ x1: 0, y1: 0, x2: 200, y2: 100 }, 100, 100, 0);
    expect(f.k).toBeCloseTo(0.5);
    expect(0 * f.k + f.ox).toBeCloseTo(0);
    expect(50 * f.k + f.oy).toBeCloseTo(50);
  });

  it('knows the part of the drawing on screen', () => {
    expect(seenRect({ ox: -100, oy: 50, scale: 2 }, 400, 300)).toEqual({ x1: 50, y1: -25, x2: 250, y2: 125 });
  });
});
