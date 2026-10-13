import { describe, it, expect } from 'vitest';
import { Doc, Arrow } from '../src/model';
import { units, alignOffsets, distributeOffsets, moveUnit, snapshot, transform, rotation, mirrorX, POINTS, selectionBox, Selection } from '../src/editor/arrange';

const L = 14.4;
const sel = (s: Partial<Selection>): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set(), ...s });

function arrowAt(doc: Doc, x: number, y: number, extra: Partial<Arrow> = {}): Arrow {
  return doc.addArrow({
    tail: { x, y }, head: { x: x + 40, y }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
    noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 1.5, ...extra,
  });
}

/** Three two-atom structures at different heights and an arrow. */
function scene() {
  const doc = new Doc();
  const ids: number[] = [];
  doc.bulk(() => {
    for (const [x, y] of [[0, 0], [50, 20], [130, -10]]) {
      const a = doc.addAtom(x, y), b = doc.addAtom(x + L, y + 5);
      doc.addBond(a.id, b.id);
      ids.push(a.id, b.id);
    }
    arrowAt(doc, 200, 40);
  });
  return { doc, ids, all: sel({ atoms: new Set(ids), arrows: new Set(doc.arrows.keys()) }) };
}

describe('lining up', () => {
  it('treats each structure, arrow and shape as one object', () => {
    const { doc, all } = scene();
    const us = units(doc, all, POINTS);
    expect(us.length).toBe(4);
    expect(us[0].atoms.length).toBe(2);
    expect(us[3].arrows.length).toBe(1);
  });
  it('aligns top edges and centres', () => {
    const { doc, all } = scene();
    const us = units(doc, all, POINTS);
    const off = alignOffsets(us, 'top');
    doc.edit('Align', () => us.forEach((u, i) => moveUnit(doc, u, off[i])));
    const tops = units(doc, all, POINTS).map((u) => u.box.y1);
    for (const t of tops) expect(t).toBeCloseTo(-10, 9);
    const c = units(doc, all, POINTS);
    const off2 = alignOffsets(c, 'hcenter');
    doc.edit('Align', () => c.forEach((u, i) => moveUnit(doc, u, off2[i])));
    const mids = units(doc, all, POINTS).map((u) => (u.box.x1 + u.box.x2) / 2);
    for (const m of mids) expect(m).toBeCloseTo(mids[0], 9);
  });
  it('does nothing with a single object', () => {
    const { doc } = scene();
    const one = units(doc, sel({ atoms: new Set([1, 2]) }), POINTS);
    expect(alignOffsets(one, 'left')).toEqual([{ x: 0, y: 0 }]);
  });
  it('spaces objects with equal gaps, keeping the outer two in place', () => {
    const { doc, all } = scene();
    const us = units(doc, all, POINTS);
    const before = selectionBox(doc, all, POINTS)!;
    const off = distributeOffsets(us, 'h');
    doc.edit('Space', () => us.forEach((u, i) => moveUnit(doc, u, off[i])));
    const boxes = units(doc, all, POINTS).map((u) => u.box).sort((a, b) => a.x1 - b.x1);
    const gaps = boxes.slice(1).map((b, i) => b.x1 - boxes[i].x2);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0], 9);
    const after = selectionBox(doc, all, POINTS)!;
    expect(after.x1).toBeCloseTo(before.x1, 9);
    expect(after.x2).toBeCloseTo(before.x2, 9);
  });
  it('undoes in one step', () => {
    const { doc, ids, all } = scene();
    const us = units(doc, all, POINTS);
    const off = alignOffsets(us, 'left');
    doc.edit('Align', () => us.forEach((u, i) => moveUnit(doc, u, off[i])));
    expect(doc.atoms.get(ids[2])!.x).toBe(0);
    doc.undo();
    expect(doc.atoms.get(ids[2])!.x).toBe(50);
  });
});

describe('flip and rotate', () => {
  it('rotates about a centre', () => {
    const f = rotation({ x: 0, y: 0 }, Math.PI / 2);
    const p = f({ x: 10, y: 0 });
    expect(p.x).toBeCloseTo(0, 9);
    expect(p.y).toBeCloseTo(10, 9); // clockwise on screen, where y runs down
  });
  it('keeps a double bond’s second line on the same side when mirrored', () => {
    const doc = new Doc();
    let id = 0;
    doc.bulk(() => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L, 0);
      id = doc.addBond(a.id, b.id, 2, 'solid', { dpos: 'right' }).id;
    });
    const s = sel({ atoms: new Set([1, 2]) });
    doc.edit('Flip', () => transform(doc, snapshot(doc, s, POINTS), mirrorX(L / 2), true));
    expect(doc.atoms.get(1)!.x).toBeCloseTo(L, 9);
    expect(doc.bonds.get(id)!.dpos).toBe('left');
  });
  it('bends a mirrored curved arrow the other way and keeps a fishhook’s barb outside', () => {
    const doc = new Doc();
    doc.bulk(() => arrowAt(doc, 0, 0, { sweep: Math.PI / 2, headStyle: 'halfLeft' }));
    const s = sel({ arrows: new Set([1]) });
    doc.edit('Flip', () => transform(doc, snapshot(doc, s, POINTS), mirrorX(20), true));
    const r = doc.arrows.get(1)!;
    expect(r.sweep).toBeCloseTo(-Math.PI / 2, 9);
    expect(r.headStyle).toBe('halfRight');
    expect(r.head.x).toBeCloseTo(0, 9);
  });
  it('keeps brackets facing in when mirrored, and boxes the same size', () => {
    const doc = new Doc();
    doc.bulk(() => {
      doc.addShape({ kind: 'bracket', bracket: 'square', x1: 0, y1: 30, x2: 0, y2: 0 });
      doc.addShape({ kind: 'rect', x1: 10, y1: 0, x2: 20, y2: 10 });
    });
    const s = sel({ shapes: new Set([1, 2]) });
    doc.edit('Flip', () => transform(doc, snapshot(doc, s, POINTS), mirrorX(50), true));
    // now on the right, running downwards, so its lips point left (inwards)
    expect(doc.shapes.get(1)).toMatchObject({ x1: 100, y1: 0, x2: 100, y2: 30 });
    expect(doc.shapes.get(2)).toMatchObject({ x1: 80, y1: 0, x2: 90, y2: 10 });
  });
  it('moves a caption with its middle, keeping the text upright', () => {
    const doc = new Doc();
    doc.bulk(() => doc.addCaption({ x: 0, y: 0, runs: [{ text: 'x' }], justify: 'left' }));
    const m = { atomBoxes: () => [], captionBox: () => ({ x1: 0, y1: -8, x2: 20, y2: 2 }) };
    doc.edit('Turn', () => transform(doc, snapshot(doc, sel({ captions: new Set([1]) }), m), rotation({ x: 10, y: 50 }, Math.PI), false));
    const c = doc.captions.get(1)!;
    // the box's middle (10, −3) turns to (10, 103)
    expect(c.x).toBeCloseTo(0, 9);
    expect(c.y).toBeCloseTo(106, 9);
  });
});
