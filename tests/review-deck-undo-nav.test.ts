import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';

describe('deck undo of slide settings', () => {
  it('goes to the slide whose notes / transition / layout it changes back', () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide(); d.addSlide();
    d.go(0);
    d.setNotes('Mention the yield');
    d.setTransition({ kind: 'fade', dur: 0.5 });
    d.go(2);
    d.undo(); // takes back the transition on slide 1
    expect(d.index).toBe(0);
  });
});
