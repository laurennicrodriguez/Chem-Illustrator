// @vitest-environment jsdom
//
// Bonds that cross: the one behind gets a gap, and which is in front is saved for ChemDraw.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { bondLayer, crossingBonds, crossingGaps } from '../src/chem/crossing';
import { templateById, placeTemplate, freePlacement } from '../src/chem/templates';
import { fusions3d } from '../src/chem/fuse3d';

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

describe('crossings in drawings seen in perspective', () => {
  /** For every crossing pair, whether the bond nearer the reader where they cross is the one in front. */
  const depthAt = (doc: Doc, id: number, at: { x: number; y: number }) => {
    const b = doc.bonds.get(id)!, p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
    const t = Math.hypot(at.x - p.x, at.y - p.y) / Math.hypot(q.x - p.x, q.y - p.y);
    return p.depth! + (q.depth! - p.depth!) * t;
  };
  const meet = (doc: Doc, b: { a1: number; a2: number }, o: { a1: number; a2: number }) => {
    const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!, r = doc.atoms.get(o.a1)!, s = doc.atoms.get(o.a2)!;
    const d1 = { x: q.x - p.x, y: q.y - p.y }, d2 = { x: s.x - r.x, y: s.y - r.y };
    const t = ((r.x - p.x) * d2.y - (r.y - p.y) * d2.x) / (d1.x * d2.y - d1.y * d2.x);
    return { x: p.x + d1.x * t, y: p.y + d1.y * t };
  };
  const checkAll = (doc: Doc) => {
    let pairs = 0;
    for (const b of doc.bonds.values()) for (const o of crossingBonds(doc, b)) {
      if (o.id < b.id) continue;
      const m = meet(doc, b, o);
      const bFront = depthAt(doc, b.id, m) > depthAt(doc, o.id, m);
      expect(bondLayer(b) > bondLayer(o), `bonds ${b.id} and ${o.id}`).toBe(bFront);
      pairs++;
    }
    return pairs;
  };

  for (const id of ['chair-ae', 'boat-ae', 'cubane', 'adamantane-3d', 'bicyclo221', 'envelope-ae']) {
    it(`${id}: the bond behind gets the gap`, () => {
      const doc = new Doc();
      doc.edit('t', () => placeTemplate(doc, templateById(id)!, freePlacement({ x: 0, y: 0 }, 14.4)));
      for (const a of doc.atoms.values()) expect(a.depth).toBeDefined();
      if (id === 'chair-ae' || id === 'cubane') expect(checkAll(doc)).toBeGreaterThan(0);
      else checkAll(doc);
    });
  }

  it('a chair fused onto a chair with all its bonds crosses them the right way', () => {
    for (let k = 0; k < 3; k++) {
      const doc = new Doc();
      let ids: number[] = [];
      doc.edit('t', () => { ids = placeTemplate(doc, templateById('chair-ae')!, freePlacement({ x: 0, y: 0 }, 14.4)); });
      const ring = new Set(ids.slice(0, 6));
      const b = [...doc.bonds.values()].find((x) => ring.has(x.a1) && ring.has(x.a2))!;
      const f = fusions3d(doc, templateById('chair')!, b.id)![k];
      doc.edit('f', () => placeTemplate(doc, templateById('chair')!, { origin: { x: 0, y: 0 }, scale: f.len, angle: 0, mirror: false, pts: f.pts }, { existing: f.existing, move: f.move, depth: f.depth, atomDepth: f.atomDepth, noMerge: true }));
      checkAll(doc);
    }
  });
});
