// Bold bonds and wedges' wide ends meeting at an atom are mitred into one another, so they join
// with no notch on the outside of the turn and no step where a wedge is wider than the bond.

import { describe, it, expect } from 'vitest';
import { joinWideEnds, type WideEnd } from '../src/render/bond-joins';
import { openHalfNotch, shaftInto } from '../src/render/renderer';
import type { Vec } from '../src/geom';

/** A band from `at` towards `to`, half width h at `at` and hf at `to`. */
function end(id: number, at: Vec, to: Vec, h: number, hf = h): WideEnd {
  const l = Math.hypot(to.x - at.x, to.y - at.y), u = { x: (to.x - at.x) / l, y: (to.y - at.y) / l };
  const n = { x: -u.y, y: u.x };
  return { id, at, u, h, farPlus: { x: to.x + n.x * hf, y: to.y + n.y * hf }, farMinus: { x: to.x - n.x * hf, y: to.y - n.y * hf } };
}

const O = { x: 0, y: 0 };
const dirAt = (deg: number, l = 15): Vec => ({ x: Math.cos((deg * Math.PI) / 180) * l, y: Math.sin((deg * Math.PI) / 180) * l });

describe('bold bond joins', () => {
  it('mitres two equal bold bonds at 120° like a stroked polyline', () => {
    const j = joinWideEnds([end(1, O, dirAt(30), 1), end(2, O, dirAt(150), 1)]);
    const a = j.get(1)!, b = j.get(2)!;
    // the two bands share both corners: no notch outside, no step inside
    expect(a.plus).toEqual(b.minus);
    expect(a.minus).toEqual(b.plus);
    // both corners lie on the bisector (straight up and down), at h / sin(60°)
    for (const p of [a.plus, a.minus]) {
      expect(p.x).toBeCloseTo(0);
      expect(Math.abs(p.y)).toBeCloseTo(1 / Math.sin(Math.PI / 3));
    }
    expect(a.fill.length + b.fill.length).toBe(0);
  });

  it('joins a wedge to a narrower bold bond with no step', () => {
    const j = joinWideEnds([end(1, O, dirAt(-36), 1.5, 0.3), end(2, O, dirAt(180), 1)]);
    const w = j.get(1)!, b = j.get(2)!;
    expect(w.plus).toEqual(b.minus);
    expect(w.minus).toEqual(b.plus);
    // each shared corner lies on the bold bond's edges (y = ±1)
    expect(Math.abs(b.plus.y)).toBeCloseTo(1);
    expect(Math.abs(b.minus.y)).toBeCloseTo(1);
  });

  it('falls back to a bevel on a very sharp turn', () => {
    const j = joinWideEnds([end(1, O, dirAt(0), 1), end(2, O, dirAt(10), 1)]);
    const fills = [...j.values()].flatMap((x) => x.fill);
    expect(fills.length).toBe(1);
    for (const x of j.values()) for (const p of [x.plus, x.minus]) expect(Math.hypot(p.x, p.y)).toBeLessThan(4.01);
  });

  it('leaves a lone band square', () => {
    expect(joinWideEnds([end(1, O, dirAt(0), 1)]).size).toBe(0);
  });
});

describe('open half arrowheads', () => {
  it('stop the line where the barb meets it', () => {
    const n = openHalfNotch(6, 1.6, 0.6);
    expect(n).toBeCloseTo(0.6 / Math.tan(Math.atan2(1.6, 6) / 2));
    expect(shaftInto(6, 'angle', 0.6, 1.6)).toBeCloseTo(n);
    // a full open head is unchanged
    expect(shaftInto(6, 'angle', 0.6)).toBe(0.6);
  });
});
