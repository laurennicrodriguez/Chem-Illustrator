import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';

describe('deck undo with amend', () => {
  it('undoes across slides in the order the edits were made, when a step was amended', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide(); // slide 1 (B), now current
    const atomsOn = (i: number) => d.docOf(i).atoms.size;
    host.edit('Eb0', () => host.addAtom(0, 0)); // B: 1 atom
    d.go(0);
    host.edit('Ea0', () => host.addAtom(5, 5)); // A: 1 atom
    d.go(1);
    host.edit('Eb1', () => host.addAtom(10, 0)); // B: 2 atoms
    // the chemistry engine's descriptors join the last step (as refreshDescriptors does)
    host.amend('Descriptors', () => host.addAtom(20, 0)); // B: 3 atoms, same undo step
    expect(atomsOn(1)).toBe(3);
    d.undo(); // takes back Eb1 + descriptors
    expect(atomsOn(1)).toBe(1);
    expect(atomsOn(0)).toBe(1);
    d.undo(); // should take back Ea0 on slide A
    expect(atomsOn(0)).toBe(0);
    expect(atomsOn(1)).toBe(1);
  });
});
