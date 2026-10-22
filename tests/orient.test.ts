// Orient Like: the turn (and turn over) that lays one structure's shared atoms on another's.

import { describe, expect, it } from 'vitest';
import { bestFit, fitMove, fitMatters } from '../src/chem/orient';

const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 15, y: 8 }, { x: 25, y: 8 }];
const turn = (a: number) => (p: { x: number; y: number }) => ({ x: Math.cos(a) * p.x - Math.sin(a) * p.y + 100, y: Math.sin(a) * p.x + Math.cos(a) * p.y + 50 });

describe('orient like', () => {
  it('finds the turn that undoes a turn', () => {
    const moved = pts.map(turn(1.1));
    const f = bestFit(moved, pts)!;
    expect(f.mirror).toBe(false);
    expect(f.rms).toBeLessThan(1e-6);
    const back = moved.map(fitMove(f, { x: 0, y: 0 }));
    // the same shape, the same way round (offsets aside)
    const d = (i: number, j: number) => [back[i].x - back[j].x, back[i].y - back[j].y];
    for (const [i, j] of [[1, 0], [3, 2]]) {
      expect(d(i, j)[0]).toBeCloseTo(10, 6);
      expect(d(i, j)[1]).toBeCloseTo(0, 6);
    }
  });

  it('turns over a mirror image, and says it did', () => {
    const mirrored = pts.map((p) => ({ x: -p.x, y: p.y })).map(turn(0.4));
    const f = bestFit(mirrored, pts)!;
    expect(f.mirror).toBe(true);
    expect(f.rms).toBeLessThan(1e-6);
    expect(fitMatters(f)).toBe(true);
  });

  it('leaves alone what already matches, at another size', () => {
    const f = bestFit(pts.map((p) => ({ x: p.x * 2 + 5, y: p.y * 2 })), pts)!;
    expect(fitMatters(f)).toBe(false);
  });
});
