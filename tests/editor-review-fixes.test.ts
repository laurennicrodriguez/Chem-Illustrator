// Editor fixes from the code review: no Undo while a drag's step is open, shortcuts by the letter
// on the key (German and French keyboards), and frames that follow their contents keep them
// when lined up.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { chordOf } from '../src/editor/keymap';
import { units, alignOffsets, moveUnit, POINTS } from '../src/editor/arrange';
import { frameAround, refitFrames } from '../src/editor/frames';

describe('a step still being made', () => {
  it('is not undone half-way', () => {
    const doc = new Doc();
    let id = 0;
    doc.edit('draw', () => { const a = doc.addAtom(0, 0); const b = doc.addAtom(14, 0); doc.addBond(a.id, b.id); id = a.id; });
    doc.begin('Move');
    doc.updateAtom(id, { x: 5 });
    expect(doc.undo()).toBe(false);
    doc.commit();
    expect(doc.bonds.size).toBe(1);
    expect(doc.undo()).toBe(true);
    expect(doc.atoms.get(id)!.x).toBe(0);
    expect(doc.bonds.size).toBe(1);
  });

  it('stays open through a change made without undo', () => {
    const doc = new Doc();
    doc.begin('Move');
    doc.bulk(() => doc.addAtom(0, 0));
    // the drag goes on recording
    expect(() => doc.addAtom(10, 0)).not.toThrow();
    doc.commit();
  });
});

describe('shortcuts', () => {
  const press = (key: string, code: string) => ({ key, code, ctrlKey: true, altKey: false, shiftKey: false, metaKey: false, getModifierState: () => false });
  it('go by the letter on the key, whatever the keyboard', () => {
    // German: Z is where Y is on a US keyboard; French: Z where W is, A where Q is
    expect(chordOf(press('z', 'KeyY'))).toBe('Ctrl+Z');
    expect(chordOf(press('z', 'KeyW'))).toBe('Ctrl+Z');
    expect(chordOf(press('a', 'KeyQ'))).toBe('Ctrl+A');
    // other alphabets fall back to the key's place
    expect(chordOf(press('я', 'KeyZ'))).toBe('Ctrl+Z');
  });
});

describe('lining up frames', () => {
  it('moves a frame that follows its contents together with them', () => {
    const doc = new Doc();
    doc.beforeCommit = (before) => refitFrames(doc, before, POINTS);
    const frames: number[] = [], first: number[] = [];
    doc.edit('draw', () => {
      for (const [x, y] of [[0, 0], [100, 50]]) {
        const a = doc.addAtom(x, y), b = doc.addAtom(x + 14, y + 8);
        doc.addBond(a.id, b.id);
        first.push(a.id);
        const sel = { atoms: new Set([a.id, b.id]), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
        frames.push(doc.addShape(frameAround(doc, sel, POINTS)!).id);
      }
    });
    const sel = { atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set(frames) };
    const us = units(doc, sel, POINTS);
    const off = alignOffsets(us, 'left');
    doc.edit('Align', () => us.forEach((u, i) => moveUnit(doc, u, off[i])));
    const f1 = doc.shapes.get(frames[0])!, f2 = doc.shapes.get(frames[1])!;
    expect(f2.x1).toBeCloseTo(f1.x1, 6);
    expect(doc.atoms.get(first[1])!.x).toBeCloseTo(doc.atoms.get(first[0])!.x, 6);
    expect(f2.frame!.fit).toBe(true);
  });
});
