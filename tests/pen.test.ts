// The pen tool's geometry: anchors to an arrow's curve and back, and editing anchors after.

import { describe, expect, it } from 'vitest';
import type { Arrow } from '../src/model';
import { bezAt, bezPoints } from '../src/objects';
import { dist, type Vec } from '../src/geom';
import {
  addAnchor, anchorsToArrow, arrowAnchors, convertAnchor, corner, deleteAnchor, dragAnchorPoint, isJoin, isSmooth, smooth, MIN_CHORD,
} from '../src/editor/pen';

const near = (a: Vec, b: Vec, eps = 1e-6) => expect(dist(a, b)).toBeLessThan(eps);

/** Three anchors: a corner at each end and a smooth one in the middle. */
const three = () => anchorsToArrow([corner({ x: 0, y: 0 }), smooth({ x: 50, y: -20 }, { x: 70, y: -20 }), corner({ x: 100, y: 0 })])!;
const asArrow = (a: ReturnType<typeof anchorsToArrow>) => a as Pick<Arrow, 'tail' | 'head' | 'bez'>;

describe('anchors to an arrow', () => {
  it('needs two anchors that are apart', () => {
    expect(anchorsToArrow([corner({ x: 0, y: 0 })])).toBeNull();
    expect(anchorsToArrow([corner({ x: 0, y: 0 }), corner({ x: MIN_CHORD / 2, y: 0 })])).toBeNull();
    expect(anchorsToArrow([corner({ x: 0, y: 0 }), corner({ x: 40, y: 0 })])).not.toBeNull();
  });

  it('keeps the bez count at 3n − 1 for n curves', () => {
    expect(asArrow(anchorsToArrow([corner({ x: 0, y: 0 }), corner({ x: 40, y: 0 })])).bez).toHaveLength(2);
    expect(asArrow(three()).bez).toHaveLength(5);
    const four = anchorsToArrow([0, 1, 2, 3].map((i) => corner({ x: i * 30, y: i % 2 * 10 })))!;
    expect(four.bez).toHaveLength(8);
    expect(bezPoints(four)).toHaveLength(10);
  });

  it('round-trips through the arrow', () => {
    const as = [corner({ x: 0, y: 0 }), smooth({ x: 50, y: -20 }, { x: 70, y: -25 }), corner({ x: 100, y: 0 })];
    const back = arrowAnchors(asArrow(anchorsToArrow(as)))!;
    expect(back).toHaveLength(3);
    for (let i = 0; i < 3; i++) { near(back[i].p, as[i].p); near(back[i].in, as[i].in); near(back[i].out, as[i].out); }
  });

  it('puts the curve through the anchors', () => {
    const pts = bezPoints(three())!;
    near(bezAt(pts, 1, 0), { x: 50, y: -20 });
    near(bezAt(pts, 0, 3), { x: 50, y: -20 });
    near(pts[pts.length - 1], { x: 100, y: 0 });
  });

  it('follows its ends when they move, as other arrows do', () => {
    const a = three();
    const moved = { ...a, head: { x: 200, y: 0 } };
    const back = arrowAnchors(moved)!;
    near(back[0].p, { x: 0, y: 0 });
    near(back[2].p, { x: 200, y: 0 });
    near(back[1].p, { x: 100, y: -40 });
  });
});

describe('smooth or corner', () => {
  it('knows a smooth anchor from a corner', () => {
    expect(isSmooth(smooth({ x: 0, y: 0 }, { x: 10, y: 5 }))).toBe(true);
    expect(isSmooth(corner({ x: 0, y: 0 }))).toBe(false);
    expect(isSmooth({ p: { x: 0, y: 0 }, in: { x: -10, y: 0 }, out: { x: 0, y: 10 } })).toBe(false);
    // a handle one way only
    expect(isSmooth({ p: { x: 0, y: 0 }, in: { x: 0, y: 0 }, out: { x: 10, y: 0 } })).toBe(false);
  });

  it('pulls handles out of a corner, or back in', () => {
    const a = three();
    const made = convertAnchor(a, 1, { x: 60, y: 10 })!;
    const as = arrowAnchors({ ...a, ...made })!;
    expect(isSmooth(as[1])).toBe(true);
    near(as[1].out, { x: 60, y: 10 });
    near(as[1].in, { x: 40, y: -50 });
    const flat = arrowAnchors({ ...a, ...convertAnchor(a, 1, null)! })!;
    near(flat[1].in, flat[1].p);
    near(flat[1].out, flat[1].p);
  });

  it('does not convert an end', () => {
    expect(convertAnchor(three(), 0, { x: 5, y: 5 })).toBeNull();
    expect(convertAnchor(three(), 2, null)).toBeNull();
  });
});

describe('dragging anchor points', () => {
  // bez indices for three anchors: 0 out of the first, 1 into the middle, 2 the middle, 3 out of the middle, 4 into the last
  it('knows which are joins', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(isJoin)).toEqual([false, false, true, false, false, true, false, false]);
  });

  it('takes the handles along with a join', () => {
    const a = three();
    const before = arrowAnchors(a)![1];
    const patch = dragAnchorPoint(a, 2, { x: 60, y: 0 }, false)!;
    const now = arrowAnchors({ ...a, ...patch })![1];
    near(now.p, { x: 60, y: 0 });
    near(now.out, { x: before.out.x + 10, y: before.out.y + 20 });
    near(now.in, { x: before.in.x + 10, y: before.in.y + 20 });
  });

  it('swings the opposite handle round to keep a smooth anchor smooth, at its own length', () => {
    const a = three();
    const patch = dragAnchorPoint(a, 3, { x: 50, y: 10 }, false)!;
    const now = arrowAnchors({ ...a, ...patch })![1];
    near(now.out, { x: 50, y: 10 });
    expect(isSmooth(now)).toBe(true);
    expect(dist(now.in, now.p)).toBeCloseTo(20, 6);
    near(now.in, { x: 50, y: -40 });
  });

  it('moves a handle alone with Alt, leaving a corner', () => {
    const a = three();
    const patch = dragAnchorPoint(a, 3, { x: 50, y: 10 }, true)!;
    const now = arrowAnchors({ ...a, ...patch })![1];
    near(now.in, { x: 30, y: -20 });
    expect(isSmooth(now)).toBe(false);
  });

  it('leaves the other handle of a corner where it is', () => {
    const a = asArrow(anchorsToArrow([corner({ x: 0, y: 0 }), { p: { x: 50, y: 0 }, in: { x: 40, y: 10 }, out: { x: 60, y: 10 } }, corner({ x: 100, y: 0 })]));
    const now = arrowAnchors({ ...a, ...dragAnchorPoint(a, 3, { x: 70, y: 30 }, false)! })![1];
    near(now.in, { x: 40, y: 10 });
    near(now.out, { x: 70, y: 30 });
  });

  it('does nothing to a plain S-shaped arrow but move the point', () => {
    const s = { tail: { x: 0, y: 0 }, head: { x: 100, y: 0 }, bez: [{ x: 0.25, y: -0.8 }, { x: 0.75, y: 0.8 }] };
    const now = arrowAnchors({ ...s, ...dragAnchorPoint(s, 0, { x: 20, y: -50 }, false)! })!;
    near(now[0].out, { x: 20, y: -50 });
    near(now[1].in, { x: 75, y: 80 });
  });
});

describe('adding and deleting anchors', () => {
  it('cuts a curve where it is clicked without changing its shape', () => {
    const a = asArrow(anchorsToArrow([corner({ x: 0, y: 0 }), smooth({ x: 100, y: 0 }, { x: 130, y: 20 })]));
    const before = bezPoints(a)!;
    const click = bezAt(before, 0.5);
    const patch = addAnchor(a, { x: click.x + 1, y: click.y - 1 })!;
    const after = bezPoints({ ...a, ...patch })!;
    expect(after).toHaveLength(7);
    for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      // the same line, whichever half
      const q = bezAt(before, t);
      const near1 = [0, 1].map((c) => Math.min(...Array.from({ length: 201 }, (_, s) => dist(bezAt(after, s / 200, c * 3), q))));
      expect(Math.min(...near1)).toBeLessThan(0.2);
    }
  });

  it('adds a smooth anchor', () => {
    const a = asArrow(anchorsToArrow([corner({ x: 0, y: 0 }), smooth({ x: 100, y: 0 }, { x: 130, y: 20 })]));
    const as = arrowAnchors({ ...a, ...addAnchor(a, bezAt(bezPoints(a)!, 0.5))! })!;
    expect(as).toHaveLength(3);
    expect(isSmooth(as[1])).toBe(true);
  });

  it('does not add one on top of an end', () => {
    const a = three();
    expect(addAnchor(a, { x: 0, y: 0 })).toBeNull();
    expect(addAnchor(a, { x: 100, y: 0 })).toBeNull();
  });

  it('joins the curves either side of a deleted anchor', () => {
    const a = three();
    const before = arrowAnchors(a)!;
    const patch = deleteAnchor(a, 1)!;
    const as = arrowAnchors({ ...a, ...patch })!;
    expect(as).toHaveLength(2);
    near(as[0].out, before[0].out);
    near(as[1].in, before[2].in);
    expect(patch.bez).toHaveLength(2);
  });

  it('does not delete an end', () => {
    expect(deleteAnchor(three(), 0)).toBeNull();
    expect(deleteAnchor(three(), 2)).toBeNull();
  });
});
