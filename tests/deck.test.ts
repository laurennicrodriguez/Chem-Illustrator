// Slide decks: switching slides, layouts, the master, and one undo history across slides.

import { describe, it, expect } from 'vitest';
import { Doc, applyBase, stripBase } from '../src/model';
import { Deck, layoutFrames, WIDE, STANDARD, textStyles, defaultMaster, placeholderRect, slideDrawingStyle } from '../src/deck/deck';
import { ACS_1996 } from '../src/style';

/** A deck attached to the app's document, as when its tab is showing. */
function deck(): { host: Doc; d: Deck } {
  const host = new Doc();
  const d = Deck.blank(host);
  d.attach();
  return { host, d };
}

const texts = (doc: Doc) => [...doc.captions.values()].map((c) => `${c.ph ?? '-'}:${c.runs.map((r) => r.text).join('')}`).sort();

describe('swapping documents', () => {
  it('exchanges the drawings and their undo histories, and keeps ids apart', () => {
    const a = new Doc(), b = new Doc();
    a.edit('A', () => a.addAtom(0, 0));
    b.bulk(() => { for (let i = 0; i < 5; i++) b.addAtom(i, 0); });
    a.swap(b);
    expect(a.atoms.size).toBe(5);
    expect(b.atoms.size).toBe(1);
    expect(a.canUndo()).toBe(false);
    expect(b.canUndo()).toBe(true);
    // new things get ids neither document has used, so they can move between them
    let id = 0;
    a.bulk(() => { id = a.addAtom(9, 9).id; });
    expect(id).toBeGreaterThan(Math.max(...a.atoms.keys().filter((k) => k !== id), ...b.atoms.keys()));
    b.undo();
    expect(b.atoms.size).toBe(0);
  });
  it('keeps the spatial index with its atoms', () => {
    const a = new Doc(), b = new Doc();
    a.bulk(() => a.addAtom(100, 100));
    b.bulk(() => b.addAtom(5, 5));
    a.swap(b);
    expect(a.atomsNear({ x: 5, y: 5 }, 1).length).toBe(1);
    expect(a.atomsNear({ x: 100, y: 100 }, 1).length).toBe(0);
    expect(b.atomsNear({ x: 100, y: 100 }, 1).length).toBe(1);
  });
});

describe('placeholder text formatting', () => {
  it('fills in the master formatting and takes it off again', () => {
    const base = { size: 24, font: 'Arial', color: '#000000' };
    const runs = [{ text: 'Plain' }, { text: 'Big', size: 30 }];
    const full = applyBase(runs, base);
    expect(full).toEqual([{ text: 'Plain', size: 24, font: 'Arial', color: '#000000' }, { text: 'Big', size: 30, font: 'Arial', color: '#000000' }]);
    expect(stripBase(full, base)).toEqual([{ text: 'Plain' }, { text: 'Big', size: 30 }]);
  });
});

describe('slide decks', () => {
  it('starts with a title slide whose placeholders follow the master', () => {
    const { host, d } = deck();
    expect(d.slides.length).toBe(1);
    expect(texts(host)).toEqual(['subtitle:', 'title:']);
    expect(host.style.bondLength).toBeCloseTo(ACS_1996.bondLength * 2);
    expect(host.textStyles?.title?.size).toBe(36);
  });

  it('puts the placeholder text where the layout says, top of the box at the top of the first line', () => {
    const { host } = deck();
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    const f = layoutFrames('title', WIDE)[0];
    const r = placeholderRect(title, host.textStyles!.title);
    expect(r.x1).toBeCloseTo(f.x);
    expect(r.y1).toBeCloseTo(f.y);
    expect(r.x2 - r.x1).toBeCloseTo(f.w);
    expect(r.y2 - r.y1).toBeCloseTo(f.h);
  });

  it('adds slides after the current one, with Title and Content after a title slide', () => {
    const { host, d } = deck();
    d.addSlide();
    expect(d.index).toBe(1);
    expect(d.current!.layout).toBe('title-content');
    expect(texts(host)).toEqual(['body:', 'title:']);
    const body = [...host.captions.values()].find((c) => c.ph === 'body')!;
    expect(body.paras).toEqual([{ list: 'bullet' }]);
  });

  it('keeps each slide its own drawing when moving between slides', () => {
    const { host, d } = deck();
    host.edit('Atom', () => host.addAtom(10, 10));
    d.addSlide();
    expect(host.atoms.size).toBe(0);
    host.edit('Atom', () => { host.addAtom(1, 1); host.addAtom(2, 2); });
    d.go(0);
    expect(host.atoms.size).toBe(1);
    d.go(1);
    expect(host.atoms.size).toBe(2);
    expect(d.docOf(0).atoms.size).toBe(1);
  });

  it('undoes edits on the slide they were made on, and slide changes too, in order', () => {
    const { host, d } = deck();
    host.edit('Atom 1', () => host.addAtom(10, 10)); // slide 1
    d.addSlide(); // slide 2
    host.edit('Atom 2', () => host.addAtom(20, 20));
    d.go(0);
    // undo: the atom on slide 2 (going there), then the new slide, then the atom on slide 1
    d.undo();
    expect(d.index).toBe(1);
    expect(host.atoms.size).toBe(0);
    d.undo();
    expect(d.slides.length).toBe(1);
    expect(d.index).toBe(0);
    d.undo();
    expect(host.atoms.size).toBe(0);
    expect(d.canUndo()).toBe(false);
    // and redo puts it all back
    d.redo(); d.redo(); d.redo();
    expect(d.slides.length).toBe(2);
    expect(d.index).toBe(1);
    expect(host.atoms.size).toBe(1);
    expect(d.docOf(0).atoms.size).toBe(1);
  });

  it('a new edit clears what could be redone', () => {
    const { host, d } = deck();
    host.edit('A', () => host.addAtom(0, 0));
    d.undo();
    expect(d.canRedo()).toBe(true);
    host.edit('B', () => host.addAtom(1, 1));
    expect(d.canRedo()).toBe(false);
  });

  it('duplicates, deletes and moves slides, each undoable', () => {
    const { host, d } = deck();
    host.edit('A', () => host.addAtom(0, 0));
    d.duplicate();
    expect(d.slides.length).toBe(2);
    expect(d.index).toBe(1);
    expect(host.atoms.size).toBe(1);
    // the copy is separate from the original
    host.edit('B', () => host.addAtom(5, 5));
    expect(d.docOf(0).atoms.size).toBe(1);
    d.addSlide('blank');
    const ids = d.slides.map((s) => s.id);
    d.move([2], 0);
    expect(d.slides.map((s) => s.id)).toEqual([ids[2], ids[0], ids[1]]);
    expect(d.index).toBe(0);
    d.undo();
    expect(d.slides.map((s) => s.id)).toEqual(ids);
    expect(d.remove([0, 1])).toBe(true);
    expect(d.slides.length).toBe(1);
    expect(d.remove()).toBe(false); // the last slide stays
    d.undo();
    expect(d.slides.map((s) => s.id)).toEqual(ids);
    expect(d.docOf(1).atoms.size).toBe(2);
  });

  it('changes layout keeping the text, and undoes it', () => {
    const { host, d } = deck();
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    host.edit('Type', () => host.updateCaption(title.id, { runs: [{ text: 'Total synthesis' }] }));
    d.setLayout('two-content');
    expect(texts(host)).toEqual(['body:', 'body:', 'title:Total synthesis']);
    const t = host.captions.get(title.id)!;
    expect(t.x).toBeCloseTo(layoutFrames('two-content', WIDE)[0].x);
    d.setLayout('blank');
    // the title has text, so it stays (as in PowerPoint); the empty boxes go
    expect(texts(host)).toEqual(['title:Total synthesis']);
    d.undo();
    d.undo();
    expect(d.current!.layout).toBe('title');
    expect(texts(host)).toEqual(['subtitle:', 'title:Total synthesis']);
  });

  it('applies the master to every slide, and undoes it', () => {
    const { host, d } = deck();
    d.addSlide();
    const m = { ...defaultMaster(), titleSize: 44, titleFont: 'Calibri', drawing: slideDrawingStyle(1.5) };
    d.setMaster(m);
    expect(host.textStyles?.title).toEqual(textStyles(m).title);
    expect(d.docOf(0).textStyles?.title?.size).toBe(44);
    expect(d.docOf(0).style.bondLength).toBeCloseTo(21.6);
    d.undo();
    expect(d.docOf(0).textStyles?.title?.size).toBe(36);
    expect(host.style.bondLength).toBeCloseTo(28.8);
  });

  it('changes the slide size keeping everything centred', () => {
    const { host, d } = deck();
    host.edit('A', () => host.addAtom(480, 270));
    d.setSize(STANDARD);
    expect([...host.atoms.values()][0].x).toBeCloseTo(360);
    const title = [...host.captions.values()].find((c) => c.ph === 'title')!;
    expect(title.x).toBeCloseTo(layoutFrames('title', STANDARD)[0].x);
    d.undo();
    expect(d.size).toEqual(WIDE);
    expect([...host.atoms.values()][0].x).toBeCloseTo(480);
  });

  it('can be put away while another file is showing', () => {
    const { host, d } = deck();
    host.edit('A', () => host.addAtom(0, 0));
    d.detach();
    expect(host.atoms.size).toBe(0);
    expect(host.captions.size).toBe(0);
    host.bulk(() => host.addAtom(3, 3)); // another file's drawing
    const other = new Doc();
    host.swap(other); // that file goes back to its own document
    d.attach();
    expect(host.atoms.size).toBe(1);
    expect(texts(host)).toEqual(['subtitle:', 'title:']);
  });
});
