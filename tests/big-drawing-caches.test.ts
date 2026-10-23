// @vitest-environment jsdom
//
// The shortcuts that keep big drawings quick must give the same answers as working everything
// out again: crossing gaps kept across edits, the longest bond during a drag, the drawing's box,
// and a save that passes by the parts of a file nobody changed.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { bondLayer, crossingBonds, crossingBondsCached, crossingGaps, crossingGapsCached } from '../src/chem/crossing';
import { freeRing, placeRing } from '../src/chem/chemgeom';

const L = 14.4;

/** Rows of rings, with some bonds laid across their neighbours so there are crossings. */
function rings(doc: Doc, n: number): number[][] {
  const out: number[][] = [];
  doc.edit('rings', () => {
    for (let i = 0; i < n; i++) {
      const r = placeRing(doc, freeRing({ x: (i % 5) * 2.2 * L, y: Math.floor(i / 5) * 2.2 * L }, 6, L), {});
      out.push(r);
    }
    // long bonds across the rows
    for (let i = 0; i + 1 < n; i += 2) doc.addBond(out[i][0], out[i + 1][3], 1);
  });
  return out;
}

function sameAsFresh(doc: Doc, half = 2): void {
  for (const b of doc.bonds.values()) {
    expect(crossingBondsCached(doc, b).map((o) => o.id).sort()).toEqual(crossingBonds(doc, b).map((o) => o.id).sort());
    expect(crossingGapsCached(doc, b, half)).toEqual(crossingGaps(doc, b, half));
  }
}

describe('crossing gaps kept across edits', () => {
  it('stay right through moves, new and removed bonds, layers, undo and redo', () => {
    const doc = new Doc();
    const rs = rings(doc, 12);
    sameAsFresh(doc);
    // drag a ring across others, a step at a time, as the select tool does
    doc.begin('Move');
    for (let i = 0; i < 6; i++) { doc.moveAtoms(rs[4], 3.1, 2.3); sameAsFresh(doc); }
    doc.commit();
    // a new bond across a ring, then one taken away
    const b = doc.edit('bond', () => doc.addBond(rs[0][1], rs[6][4], 1));
    sameAsFresh(doc);
    const victim = [...doc.bonds.values()].find((x) => crossingBonds(doc, x).length)!;
    doc.edit('erase', () => doc.removeBond(victim.id));
    sameAsFresh(doc);
    // bring a bond to the front
    const crossed = [...doc.bonds.values()].find((x) => crossingBonds(doc, x).length)!;
    const top = Math.max(...crossingBonds(doc, crossed).map(bondLayer)) + 1;
    doc.edit('front', () => doc.updateBond(crossed.id, { z: top }));
    sameAsFresh(doc);
    // a different gap size (another drawing style)
    sameAsFresh(doc, 3.5);
    while (doc.undo()) sameAsFresh(doc);
    while (doc.redo()) sameAsFresh(doc);
    expect(doc.bonds.has(b.id)).toBe(true);
  });
});

describe('longest bond', () => {
  it('may run long during a drag, and is exact once the drag is done', () => {
    const doc = new Doc();
    const rs = rings(doc, 6);
    const exact = () => Math.max(...[...doc.bonds.values()].map((b) => { const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!; return Math.hypot(p.x - q.x, p.y - q.y); }));
    expect(doc.maxBondLength).toBeCloseTo(exact(), 6);
    // pull a ring so its long bond shortens
    doc.begin('Move');
    doc.moveAtoms([rs[1][3]], -20, 0);
    expect(doc.maxBondLength).toBeGreaterThanOrEqual(exact() - 1e-9);
    doc.commit();
    expect(doc.maxBondLength).toBeCloseTo(exact(), 6);
    doc.undo();
    expect(doc.maxBondLength).toBeCloseTo(exact(), 6);
  });
});

describe("the drawing's box", () => {
  it('follows every change', () => {
    const doc = new Doc();
    const rs = rings(doc, 3);
    const b0 = doc.bounds()!;
    doc.edit('move', () => doc.moveAtoms(rs[2], 100, 50));
    const b1 = doc.bounds()!;
    expect(b1.x2).toBeCloseTo(b0.x2 + 100, 6);
    // a caller changing the box it was given doesn't change the next answer
    b1.x1 = -999;
    expect(doc.bounds()!.x1).not.toBe(-999);
    doc.undo();
    expect(doc.bounds()).toEqual(b0);
  });
});

describe('saving a file after a small edit', () => {
  /** Save as the app does, and again without the shortcut for unchanged atoms and bonds. */
  function bothWays(doc: Doc): [string, string] {
    const fast = writeCdxml(doc);
    const loaded = doc.source!.loaded;
    doc.source!.loaded = undefined;
    const slow = writeCdxml(doc);
    doc.source!.loaded = loaded;
    return [fast, slow];
  }

  it('writes the same file as comparing everything would', () => {
    const made = new Doc();
    const rs = rings(made, 10);
    made.edit('labels', () => { made.updateAtom(rs[2][0], { z: 7 }); made.updateAtom(rs[3][1], { label: 'OMe' }); });
    const text = writeCdxml(made);

    const { doc } = readCdxml(text);
    // nothing changed: the file as it was
    expect(writeCdxml(doc)).toBe(text);
    const ids = [...doc.atoms.keys()];
    const near = (id: number) => doc.neighbors(id).map((a) => a.id);
    doc.edit('move', () => doc.moveAtoms([ids[0], ...near(ids[0])], 4, 2));
    let [fast, slow] = bothWays(doc);
    expect(fast).toBe(slow);
    expect(fast).not.toBe(text);
    const bond = [...doc.bonds.values()][7];
    doc.edit('order', () => doc.updateBond(bond.id, { order: 2 }));
    [fast, slow] = bothWays(doc);
    expect(fast).toBe(slow);
    doc.edit('erase', () => doc.removeAtom(ids[30]));
    [fast, slow] = bothWays(doc);
    expect(fast).toBe(slow);
    doc.edit('join', () => doc.addBond(ids[12], ids[40], 1));
    [fast, slow] = bothWays(doc);
    expect(fast).toBe(slow);
    // undone back to the start: an entity restored by undo is a copy, so it is compared in full
    while (doc.undo());
    [fast, slow] = bothWays(doc);
    expect(fast).toBe(slow);
    // and it reads back the same as the drawing
    const back = readCdxml(fast).doc;
    expect(back.atoms.size).toBe(doc.atoms.size);
    expect(back.bonds.size).toBe(doc.bonds.size);
  });

  it('saves twice the same way (each save starts from a fresh copy of the file)', () => {
    const made = new Doc();
    rings(made, 4);
    const { doc } = readCdxml(writeCdxml(made));
    const id = [...doc.atoms.keys()][3];
    doc.edit('move', () => doc.moveAtoms([id], 2, 2));
    expect(writeCdxml(doc)).toBe(writeCdxml(doc));
  });
});
