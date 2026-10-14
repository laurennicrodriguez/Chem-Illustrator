// @vitest-environment jsdom
//
// Bonds that cross: the one behind gets a gap, and which is in front is saved for ChemDraw.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { bondLayer, crossingBonds, crossingGaps } from '../src/chem/crossing';

/** Two bonds crossing in an X, and a third bond off to the side. */
function cross(doc: Doc) {
  return doc.edit('x', () => {
    const a = doc.addAtom(0, 0), b = doc.addAtom(20, 20), c = doc.addAtom(0, 20), d = doc.addAtom(20, 0);
    const e = doc.addAtom(60, 0), f = doc.addAtom(80, 0);
    return { first: doc.addBond(a.id, b.id, 1), second: doc.addBond(c.id, d.id, 1), apart: doc.addBond(e.id, f.id, 1) };
  });
}

describe('crossing bonds', () => {
  it('finds crossings and gaps the bond behind', () => {
    const doc = new Doc();
    const { first, second, apart } = cross(doc);
    expect(crossingBonds(doc, first).map((b) => b.id)).toEqual([second.id]);
    expect(crossingBonds(doc, apart)).toEqual([]);
    // the later bond is in front: the first one has a gap in its middle, the second none
    const g = crossingGaps(doc, doc.bonds.get(first.id)!, 2);
    expect(g).toHaveLength(1);
    expect(g[0][0]).toBeLessThan(0.5);
    expect(g[0][1]).toBeGreaterThan(0.5);
    expect(crossingGaps(doc, doc.bonds.get(second.id)!, 2)).toEqual([]);
    // bring the first to the front: the gap moves to the second
    doc.edit('f', () => doc.updateBond(first.id, { z: bondLayer(second) + 1 }));
    expect(crossingGaps(doc, doc.bonds.get(first.id)!, 2)).toEqual([]);
    expect(crossingGaps(doc, doc.bonds.get(second.id)!, 2)).toHaveLength(1);
  });

  it('saves which bond is in front and reads it back', () => {
    const doc = new Doc();
    const { first } = cross(doc);
    doc.edit('f', () => doc.updateBond(first.id, { z: 100 }));
    const text = writeCdxml(doc);
    const x = new DOMParser().parseFromString(text, 'application/xml');
    const bonds = [...x.querySelectorAll('b')];
    const crossing = bonds.filter((b) => b.hasAttribute('CrossingBonds'));
    expect(crossing).toHaveLength(2);
    // each lists the other, and the front one has the higher Z
    const [p, q] = crossing;
    expect(p.getAttribute('CrossingBonds')).toBe(q.getAttribute('id'));
    expect(q.getAttribute('CrossingBonds')).toBe(p.getAttribute('id'));
    const back = readCdxml(text).doc;
    const bs = [...back.bonds.values()].filter((b) => crossingBonds(back, b).length);
    expect(bs).toHaveLength(2);
    // the bond that was first (from 0,0) is still in front
    const front = bs.find((b) => crossingGaps(back, b, 2).length === 0)!;
    const a = back.atoms.get(front.a1)!, c = back.atoms.get(front.a2)!;
    // first bond goes down-right: its ends differ in y the same way as in x
    expect(Math.sign(c.x - a.x)).toBe(Math.sign(c.y - a.y));
    // saving the file again as read leaves it untouched
    expect(writeCdxml(back)).toBe(text);
  });
});
