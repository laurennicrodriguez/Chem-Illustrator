// @vitest-environment jsdom
//
// Captions tied to a structure (Attach Descriptors, ID labels): they keep their place beside the
// structure when it moves or grows, in the same undo step; one moved by hand keeps its new place;
// they go when the structure is deleted; and the tie is saved in CDXML and found again on opening.

import { describe, it, expect } from 'vitest';
import { Doc, type Attachment } from '../src/model';
import { POINTS } from '../src/editor/arrange';
import { anchorPoint, attachOffset, readPlace, sideOf, refitAttached, placeAttached, structureBox, attachTag, attachFromTag, structureSig, attachWhereItIs, nearestStructure } from '../src/editor/attached';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const box = { x1: 0, y1: 0, x2: 40, y2: 20 };
const place = (side: Attachment['side'], gap: number, shift: number) => ({ side, gap, shift });

describe('where a tied caption sits', () => {
  it('holds the middle of the facing edge a gap away from the structure', () => {
    expect(anchorPoint(box, place('below', 5, 0))).toEqual({ x: 20, y: 25 });
    expect(anchorPoint(box, place('above', 5, 3))).toEqual({ x: 23, y: -5 });
    expect(anchorPoint(box, place('left', 4, 0))).toEqual({ x: -4, y: 10 });
    expect(anchorPoint(box, place('right', 4, -2))).toEqual({ x: 44, y: 8 });
  });

  it('moves a caption so its top middle sits under the structure', () => {
    const cap = { x1: 100, y1: 100, x2: 110, y2: 106 };
    expect(attachOffset(box, cap, place('below', 5, 0))).toEqual({ x: -85, y: -75 });
  });

  it('reads back the gap and shift of a caption placed by hand', () => {
    const cap = { x1: 18, y1: 27, x2: 30, y2: 33 };
    expect(readPlace(box, cap, 'below')).toEqual({ gap: 7, shift: 4 });
    expect(readPlace(box, { x1: 50, y1: 5, x2: 60, y2: 11 }, 'right')).toEqual({ gap: 10, shift: -2 });
  });

  it('judges the side a loose caption is on', () => {
    expect(sideOf(box, { x1: 15, y1: 30, x2: 25, y2: 35 })).toBe('below');
    expect(sideOf(box, { x1: 15, y1: -15, x2: 25, y2: -10 })).toBe('above');
    expect(sideOf(box, { x1: 60, y1: 5, x2: 70, y2: 10 })).toBe('right');
    expect(sideOf(box, { x1: -40, y1: 5, x2: -30, y2: 10 })).toBe('left');
  });

  it('saves the tie without the atom numbers and reads it back, ignoring nonsense', () => {
    const a: Attachment = { atoms: [1, 2], side: 'left', gap: 3, shift: 1, role: 'descriptors', show: ['formula', 'mw'], adduct: '[M+Na]+', sig: 'x', keepText: true };
    const back = attachFromTag(attachTag(a))!;
    expect(back).toEqual({ atoms: [], side: 'left', gap: 3, shift: 1, role: 'descriptors', show: ['formula', 'mw'], adduct: '[M+Na]+', keepText: true });
    expect(attachFromTag('{"side":"sideways","gap":"far","role":"x","show":["formula","bogus"]}')).toEqual({ atoms: [], side: 'below', gap: 4, shift: 0, role: 'caption', show: ['formula'] });
    expect(attachFromTag('not json')).toBeUndefined();
  });
});

function setup() {
  const doc = new Doc();
  doc.beforeCommit = (before) => refitAttached(doc, before, POINTS);
  let ids: number[] = [];
  let cap = 0;
  doc.edit('Draw', () => {
    const a = doc.addAtom(0, 0), b = doc.addAtom(20, 0), c = doc.addAtom(20, 10);
    doc.addBond(a.id, b.id);
    doc.addBond(b.id, c.id);
    ids = [a.id, b.id, c.id];
  });
  doc.edit('Label', () => {
    const c = doc.addCaption({ x: 0, y: 0, runs: [{ text: '12' }], justify: 'center', attach: { atoms: [...ids], side: 'below', gap: 5, shift: 0, role: 'label' } });
    placeAttached(doc, c, POINTS);
    cap = c.id;
  });
  const capBox = () => POINTS.captionBox(doc.captions.get(cap)!);
  const sBox = () => structureBox(doc, new Set(doc.atoms.keys()), POINTS)!;
  return { doc, ids, cap, capBox, sBox };
}

describe('a tied caption follows its structure', () => {
  it('starts centred under the structure', () => {
    const { capBox, sBox } = setup();
    const c = capBox(), s = sBox();
    expect((c.x1 + c.x2) / 2).toBeCloseTo((s.x1 + s.x2) / 2, 6);
    expect(c.y1).toBeCloseTo(s.y2 + 5, 6);
  });

  it('moves with the structure in the same undo step', () => {
    const { doc, ids, capBox } = setup();
    const before = capBox();
    doc.edit('Move', () => { for (const id of ids) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: a.x + 30, y: a.y + 7 }); } });
    const after = capBox();
    expect(after.x1 - before.x1).toBeCloseTo(30, 6);
    expect(after.y1 - before.y1).toBeCloseTo(7, 6);
    doc.undo();
    expect(capBox().x1).toBeCloseTo(before.x1, 6);
  });

  it('stays below as the structure grows, and keeps track of new atoms', () => {
    const { doc, ids, cap, capBox, sBox } = setup();
    let d = 0;
    doc.edit('Grow', () => { d = doc.addAtom(20, 40).id; doc.addBond(ids[2], d); });
    expect(capBox().y1).toBeCloseTo(sBox().y2 + 5, 6);
    expect(doc.captions.get(cap)!.attach!.atoms).toContain(d);
  });

  it('keeps a place set by hand and follows from there', () => {
    const { doc, ids, cap, capBox, sBox } = setup();
    doc.edit('Move caption', () => { const c = doc.captions.get(cap)!; doc.updateCaption(cap, { x: c.x + 6, y: c.y + 3 }); });
    const a = doc.captions.get(cap)!.attach!;
    expect(a.gap).toBeCloseTo(8, 6);
    expect(a.shift).toBeCloseTo(6, 6);
    doc.edit('Move', () => { for (const id of ids) { const at = doc.atoms.get(id)!; doc.updateAtom(id, { x: at.x - 10 }); } });
    const c = capBox(), s = sBox();
    expect((c.x1 + c.x2) / 2 - (s.x1 + s.x2) / 2).toBeCloseTo(6, 6);
    expect(c.y1 - s.y2).toBeCloseTo(8, 6);
  });

  it('goes when its structure is deleted', () => {
    const { doc, ids, cap } = setup();
    doc.edit('Delete', () => { for (const id of ids) doc.removeAtom(id); });
    expect(doc.captions.has(cap)).toBe(false);
    doc.undo();
    expect(doc.captions.has(cap)).toBe(true);
  });

  it('notices when the structure changes, not when it only moves', () => {
    const { doc, ids } = setup();
    const atoms = new Set(ids);
    const sig = structureSig(doc, atoms);
    doc.edit('Move', () => doc.updateAtom(ids[0], { x: 5 }));
    expect(structureSig(doc, atoms)).toBe(sig);
    doc.edit('N', () => doc.updateAtom(ids[0], { z: 7 }));
    expect(structureSig(doc, atoms)).not.toBe(sig);
  });

  it('ties a loose caption where it sits to the nearest structure', () => {
    const { doc, ids } = setup();
    let id = 0;
    doc.edit('Text', () => { id = doc.addCaption({ x: 60, y: 8, runs: [{ text: 'note' }], justify: 'left' }).id; });
    const c = doc.captions.get(id)!;
    const f = nearestStructure(doc, POINTS.captionBox(c), POINTS)!;
    expect([...f].sort()).toEqual([...ids].sort());
    const a = attachWhereItIs(doc, c, f, POINTS, 'caption')!;
    expect(a.side).toBe('right');
    const before = POINTS.captionBox(c);
    doc.edit('Tie', () => doc.updateCaption(id, { attach: a }));
    expect(POINTS.captionBox(doc.captions.get(id)!).x1).toBeCloseTo(before.x1, 6);
  });
});

describe('Doc.amend', () => {
  it('folds a later change into the last undo step', () => {
    const { doc, cap } = setup();
    doc.edit('Move', () => doc.updateAtom([...doc.atoms.keys()][0], { x: 3 }));
    const steps = (doc as unknown as { undoStack: unknown[] }).undoStack.length;
    doc.amend('Descriptors', () => doc.updateCaption(cap, { runs: [{ text: '13' }] }));
    expect((doc as unknown as { undoStack: unknown[] }).undoStack.length).toBe(steps);
    doc.undo();
    expect(doc.captions.get(cap)!.runs[0].text).toBe('12');
  });
});

describe('saving tied captions', () => {
  it('keeps the tie through CDXML', () => {
    const { doc, ids } = setup();
    const back = readCdxml(writeCdxml(doc)).doc;
    const c = [...back.captions.values()][0];
    expect(c.attach?.role).toBe('label');
    expect(c.attach?.gap).toBe(5);
    expect(c.attach?.atoms.length).toBe(ids.length);
  });
});
