// Undo and redo say what they put back, so the editor can select it (Ctrl+Z selects the
// structures the undone command acted on).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';

describe('undo and redo report what they changed', () => {
  it('lists the atoms, bonds and captions of the step', () => {
    const doc = new Doc();
    let a = 0, b = 0;
    doc.edit('draw', () => { a = doc.addAtom(0, 0, 6).id; b = doc.addAtom(14, 0, 6).id; doc.addBond(a, b, 1); });
    doc.edit('move', () => doc.moveAtoms([a], 5, 5));
    expect(doc.undo()).toBe(true);
    expect(doc.lastApplied).toEqual([`a${a}`]);
    expect(doc.redo()).toBe(true);
    expect(doc.lastApplied).toEqual([`a${a}`]);
    doc.undo();
    doc.undo();
    expect(doc.lastApplied).toContain(`a${b}`);
    expect(doc.atoms.has(b)).toBe(false);
  });
});
