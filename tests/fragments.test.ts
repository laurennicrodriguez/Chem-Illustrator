// The mass fragmentation tool's geometry: which bonds a line breaks, and where the captions go.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { crossedBonds, lineAcross, captionPlaces } from '../src/chem/fragments';

function chain(): { doc: Doc; bonds: number[] } {
  const doc = new Doc();
  const bonds: number[] = [];
  doc.edit('t', () => {
    const a = [0, 1, 2, 3].map((i) => doc.addAtom(i * 14.4, i % 2 ? -7 : 0));
    for (let i = 0; i < 3; i++) bonds.push(doc.addBond(a[i].id, a[i + 1].id, 1, 'solid').id);
  });
  return { doc, bonds };
}

describe('mass fragmentation lines', () => {
  it('breaks the bonds a line crosses and no others', () => {
    const { doc, bonds } = chain();
    expect(crossedBonds(doc, { x: 7, y: -20 }, { x: 7, y: 20 })).toEqual([bonds[0]]);
    expect(crossedBonds(doc, { x: 0, y: -3 }, { x: 50, y: -3 })).toEqual(bonds);
    expect(crossedBonds(doc, { x: -10, y: -20 }, { x: -10, y: 20 })).toEqual([]);
  });

  it('draws a line across a clicked bond that crosses only it', () => {
    const { doc, bonds } = chain();
    const l = lineAcross(doc, bonds[1])!;
    expect(crossedBonds(doc, l.p, l.q)).toEqual([bonds[1]]);
    expect(l.p.y).toBeLessThan(l.q.y);
  });

  it('puts the captions either side of the line, clear of the structure', () => {
    const box = { x1: -5, y1: -12, x2: 48, y2: 5 };
    const [left, right] = captionPlaces({ x: 7, y: -20 }, { x: 7, y: 20 }, [{ x: 0, y: 0 }, { x: 30, y: 0 }], [20, 20], 10, box);
    expect(left.x + 20).toBeLessThanOrEqual(7);
    expect(right.x).toBeGreaterThanOrEqual(7);
    expect(left.y - 10).toBeGreaterThan(box.y2);
  });
});
