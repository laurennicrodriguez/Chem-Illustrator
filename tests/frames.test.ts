// @vitest-environment jsdom
//
// Frames (Structure > Add Frame): a box round what is selected, with a gap, that follows its
// contents through every change in the same undo step, stops following when placed by hand,
// and is saved for ChemDraw as an ordinary box with its settings in a hidden tag.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { POINTS, type Selection } from '../src/editor/arrange';
import { frameAround, refitFrames, frameMembers, thingsInside, frameTag, frameFromTag } from '../src/editor/frames';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { shapeBox } from '../src/objects';

function setup() {
  const doc = new Doc();
  doc.beforeCommit = (before) => refitFrames(doc, before, POINTS);
  let ids: number[] = [];
  doc.edit('Draw', () => {
    const a = doc.addAtom(0, 0), b = doc.addAtom(20, 0), c = doc.addAtom(20, 10);
    doc.addBond(a.id, b.id);
    doc.addBond(b.id, c.id);
    ids = [a.id, b.id, c.id];
  });
  const sel: Selection = { atoms: new Set([ids[0]]), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
  let frame = 0;
  doc.edit('Frame', () => { frame = doc.addShape(frameAround(doc, sel, POINTS, 5)!).id; });
  return { doc, ids, frame };
}

describe('frames', () => {
  it('surrounds the whole structure with the gap asked for', () => {
    const { doc, frame } = setup();
    expect(shapeBox(doc.shapes.get(frame)!)).toEqual({ x1: -5, y1: -5, x2: 25, y2: 15 });
  });

  it('grows with its structure and moves with it, in the same undo step', () => {
    const { doc, ids, frame } = setup();
    doc.edit('Grow', () => { const d = doc.addAtom(40, 30); doc.addBond(ids[2], d.id); });
    expect(shapeBox(doc.shapes.get(frame)!)).toEqual({ x1: -5, y1: -5, x2: 45, y2: 35 });
    doc.undo();
    expect(shapeBox(doc.shapes.get(frame)!)).toEqual({ x1: -5, y1: -5, x2: 25, y2: 15 });
    doc.edit('Move', () => doc.moveAtoms(new Set(ids), 100, 0));
    expect(shapeBox(doc.shapes.get(frame)!).x1).toBe(95);
  });

  it('follows a new gap', () => {
    const { doc, frame } = setup();
    doc.edit('Gap', () => doc.updateShape(frame, { frame: { ...doc.shapes.get(frame)!.frame!, padX: 10 } }));
    expect(shapeBox(doc.shapes.get(frame)!)).toEqual({ x1: -10, y1: -5, x2: 30, y2: 15 });
  });

  it('stops following when moved or resized by hand, but not for a change of colour', () => {
    const { doc, ids, frame } = setup();
    doc.edit('Colour', () => doc.updateShape(frame, { color: '#ff0000' }));
    expect(doc.shapes.get(frame)!.frame!.fit).toBe(true);
    doc.edit('Resize', () => doc.updateShape(frame, { x2: 60 }));
    expect(doc.shapes.get(frame)!.frame!.fit).toBe(false);
    doc.edit('Move', () => doc.moveAtoms(new Set(ids), 100, 0));
    expect(doc.shapes.get(frame)!.x2).toBe(60);
  });

  it('keeps its box when everything in it is deleted', () => {
    const { doc, ids, frame } = setup();
    doc.edit('Delete', () => { for (const id of ids) doc.removeAtom(id); });
    expect(shapeBox(doc.shapes.get(frame)!)).toEqual({ x1: -5, y1: -5, x2: 25, y2: 15 });
    expect(frameMembers(doc, doc.shapes.get(frame)!.frame!).atoms.size).toBe(0);
  });

  it('finds what lies wholly inside a box', () => {
    const { doc, ids, frame } = setup();
    let far = 0;
    doc.edit('More', () => { far = doc.addAtom(200, 200).id; });
    const inside = thingsInside(doc, { x1: -1, y1: -1, x2: 21, y2: 11 }, POINTS, frame);
    expect(inside.atoms).toHaveLength(1);
    expect(ids).toContain(inside.atoms[0]);
    expect(inside.atoms).not.toContain(far);
  });

  it('saves its settings for ChemDraw and finds its contents again on opening', () => {
    const { doc, frame } = setup();
    const back = readCdxml(writeCdxml(doc)).doc;
    const f = [...back.shapes.values()].find((s) => s.frame)!;
    expect(f.frame).toMatchObject({ padX: 5, padY: 5, fit: true });
    expect(f.frame!.atoms).toHaveLength(1);
    expect(shapeBox(f)).toEqual(shapeBox(doc.shapes.get(frame)!));
    expect(frameFromTag(frameTag({ ...f.frame!, fit: false }))!.fit).toBe(false);
    expect(frameFromTag('not json')).toBeUndefined();
  });
});
