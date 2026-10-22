// @vitest-environment jsdom
// Review > Compare for slides: matching two versions of a deck, listing what differs, and
// accepting changes into this deck (each one undo step).

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { Deck } from '../src/deck/deck';
import { compareDecks, matchSlides, slideDifferences } from '../src/deck/compare';
import { SlideComparePane, viewsOf } from '../src/ui/slide-compare';

/** A deck of Title and Content slides with these titles (and body text, when given). */
function deckOf(slides: { title: string; body?: string; atoms?: number }[], attach = false): Deck {
  const d = Deck.blank(new Doc());
  if (attach) d.attach();
  for (let i = 1; i < slides.length; i++) d.addSlide('title-content');
  d.editSlides('Fill', slides.map((_, i) => i), (doc, i) => {
    for (const c of [...doc.captions.values()]) {
      if (c.ph === 'title') doc.updateCaption(c.id, { runs: [{ text: slides[i].title }] });
      else if (c.ph && slides[i].body) doc.updateCaption(c.id, { runs: [{ text: slides[i].body! }] });
    }
    let prev = 0;
    for (let k = 0; k < (slides[i].atoms ?? 0); k++) {
      const a = doc.addAtom(400 + k * 30, 300);
      if (k) doc.addBond(prev, a.id, 1);
      prev = a.id;
    }
  });
  return d;
}

const titles = (d: Deck) => viewsOf(d).map((v) => v.contents.captions.find((c) => c.ph === 'title')?.runs.map((r) => r.text).join('') ?? '');

describe('matching slides', () => {
  it('pairs slides by title, then by place, and finds inserted and deleted ones', () => {
    const a = viewsOf(deckOf([{ title: 'Intro' }, { title: 'Methods' }, { title: 'Old results' }, { title: 'Thanks' }]));
    const b = viewsOf(deckOf([{ title: 'Intro' }, { title: 'Scope' }, { title: 'Methods' }, { title: 'New results' }, { title: 'Thanks' }]));
    const m = matchSlides(a, b);
    expect(m.pairs).toEqual([[0, 0], [1, 2], [2, 3], [3, 4]]);
    expect(m.onlyTheirs).toEqual([{ theirs: 1, after: 0 }]);
    expect(m.onlyMine).toEqual([]);
  });
  it('lists text, structure and title changes, and nothing for the same slide', () => {
    const [x] = viewsOf(deckOf([{ title: 'Yields', body: '85% over two steps', atoms: 3 }]));
    const [y] = viewsOf(deckOf([{ title: 'Yields', body: '91% over two steps', atoms: 4 }]));
    const [z] = viewsOf(deckOf([{ title: 'Yields', body: '85% over two steps', atoms: 3 }]));
    expect(slideDifferences(x, z)).toEqual([]);
    const diff = slideDifferences(x, y);
    expect(diff.some((l) => l.startsWith('Text changed'))).toBe(true);
    expect(diff).toContain('Structure changed');
    const [t] = viewsOf(deckOf([{ title: 'Yield table', body: '85% over two steps', atoms: 3 }]));
    expect(slideDifferences(x, t)[0]).toMatch(/^Title changed: "Yields" → "Yield table"/);
  });
  it('compares decks in this deck\'s order', () => {
    const a = deckOf([{ title: 'A' }, { title: 'B', body: 'one' }, { title: 'C' }]);
    const b = deckOf([{ title: 'A' }, { title: 'B', body: 'two' }, { title: 'D' }]);
    const c = compareDecks(viewsOf(a), viewsOf(b));
    expect(c.map((x) => x.kind)).toEqual(['changed', 'changed']);
    expect(c[1].details[0]).toMatch(/Title changed/);
  });
  it('finds deleted slides', () => {
    const a = deckOf([{ title: 'A' }, { title: 'B' }, { title: 'C' }]);
    const b = deckOf([{ title: 'A' }, { title: 'C' }]);
    const c = compareDecks(viewsOf(a), viewsOf(b));
    expect(c).toEqual([expect.objectContaining({ kind: 'deleted', mine: 1, title: 'B' })]);
  });
});

describe('accepting changes', () => {
  it('replaces a slide as one undo step', () => {
    const a = deckOf([{ title: 'A' }, { title: 'B', body: 'one' }], true);
    const b = deckOf([{ title: 'A' }, { title: 'B', body: 'two' }]);
    expect(a.replaceSlide(1, b.copySlides([1]))).toBe(true);
    expect(viewsOf(a)[1].contents.captions.some((c) => c.runs.some((r) => r.text === 'two'))).toBe(true);
    a.undo();
    expect(viewsOf(a)[1].contents.captions.some((c) => c.runs.some((r) => r.text === 'one'))).toBe(true);
    a.redo();
    expect(viewsOf(a)[1].contents.captions.some((c) => c.runs.some((r) => r.text === 'two'))).toBe(true);
  });
  it('Accept All brings this deck in line with the other version', () => {
    const a = deckOf([{ title: 'Intro' }, { title: 'Methods', body: 'old' }, { title: 'Dropped' }, { title: 'Thanks' }], true);
    const b = deckOf([{ title: 'Intro' }, { title: 'Scope' }, { title: 'More scope' }, { title: 'Methods', body: 'new' }, { title: 'Thanks' }, { title: 'Backup' }]);
    const flashes: string[] = [];
    const pane = new SlideComparePane({ deck: () => a, flash: (m) => flashes.push(m), changed: () => {} });
    expect(pane.start(a, b, 'Reviewer.pptx')).toBe(5);
    (document.querySelector('.sc-bar button') as HTMLButtonElement).click();
    expect(titles(a)).toEqual(titles(b));
    expect(viewsOf(a)[3].contents.captions.some((c) => c.runs.some((r) => r.text === 'new'))).toBe(true);
    expect(flashes.at(-1)).toBe('Accepted 5 changes.');
    pane.close();
  });
  it('Reject leaves the deck alone and Accept one change at a time', () => {
    const a = deckOf([{ title: 'A' }, { title: 'B' }], true);
    const b = deckOf([{ title: 'A' }, { title: 'New' }, { title: 'B' }]);
    const pane = new SlideComparePane({ deck: () => a, flash: () => {}, changed: () => {} });
    pane.start(a, b, 'b.pptx');
    const box = document.querySelector('.sc-pane:not([hidden])')!;
    const reject = [...box.querySelectorAll('.sc-act button')].find((x) => x.textContent === 'Reject') as HTMLButtonElement;
    reject.click();
    expect(titles(a)).toEqual(['A', 'B']);
    expect(box.querySelector('.sc-summary')!.textContent).toMatch(/All 1 change reviewed/);
    pane.close();
    pane.start(a, b, 'b.pptx');
    const accept = [...box.querySelectorAll('.sc-act button')].find((x) => x.textContent === 'Accept') as HTMLButtonElement;
    accept.click();
    expect(titles(a)).toEqual(['A', 'New', 'B']);
    pane.close();
  });
});
