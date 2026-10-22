// @vitest-environment jsdom
//
// Document views (View > Views): Web Layout, Draft and Outline lay the same text out for the
// screen, Outline folds headings and moves and promotes them as blocks, and New Window shows a
// document in a second tab that saves the one file.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { DocLayouter, PAGE_GAP } from '../src/document/doc-layout';
import { DocFile } from '../src/document/doc-file';
import {
  ENDLESS, OUTLINE_STEP, breaksIn, changeLevel, foldHeadings, hiddenParas, moveParas, newOutline, outlineMarks, screenText, shiftFolds, toggleFold, outlineLevel,
} from '../src/document/doc-views';
import { documentMeasure } from '../src/text/font-measure';
import { fitParas, paraCount, splitParagraphs } from '../src/text/paragraphs';
import * as rt from '../src/richtext';
import type { ParaStyle, TextRun } from '../src/model';
import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks } from '../src/workspace';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });

/** A document with these paragraphs: [style, text]. */
function docOf(paras: [string, string, Partial<ParaStyle>?][]): DocText {
  const d = newDocument();
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  paras.forEach(([style, text, extra], i) => {
    const s = d.styles[style];
    runs.push({ ...runStyleOf(s), text: text + (i < paras.length - 1 ? '\n' : '') });
    ps.push({ ...paraFromStyle(s, {}), ...extra });
  });
  return { ...d, runs, paras: ps };
}

const texts = (t: DocText) => splitParagraphs(t.runs).map((rs) => rs.map((r) => r.text).join(''));
const levels = (t: DocText) => fitParas(t.paras, paraCount(rt.plainText(t.runs))).map((p) => outlineLevel(t, p));

const PAPER = docOf([
  ['Heading1', 'Introduction'],
  ['Normal', 'Some text about it.'],
  ['Heading2', 'Background'],
  ['Normal', 'More text.'],
  ['Heading1', 'Results', { pageBreak: true }],
  ['Normal', 'What we found.'],
  ['Heading2', 'Yields'],
  ['Normal', 'Good ones.'],
]);

describe('the views lay out the same text for the screen', () => {
  it('Web Layout wraps to the window on one endless page, without page breaks or headers', () => {
    const t = screenText(PAPER, { kind: 'web', width: 300 });
    expect(t.page.w).toBe(300);
    expect(t.page.h).toBe(ENDLESS);
    expect(t.paras.some((p) => p.pageBreak)).toBe(false);
    expect(t.hf.numbers).toBe('none');
    expect(rt.plainText(t.runs)).toBe(rt.plainText(PAPER.runs));
    const lay = layouter().layout(t);
    expect(lay.pages).toHaveLength(1);
    // the page break made a second page in print
    expect(layouter().layout(PAPER).pages).toHaveLength(2);
  });

  it('Draft keeps the printed width and shows where the page breaks are', () => {
    const t = screenText(PAPER, { kind: 'draft' });
    const textW = PAPER.page.w - PAPER.page.left - PAPER.page.right;
    expect(t.page.w - t.page.left - t.page.right).toBeCloseTo(textW, 6);
    expect(breaksIn(PAPER)).toEqual([{ para: 4, kind: 'page' }]);
  });

  it('Print Layout and Read Mode are the document itself', () => {
    expect(screenText(PAPER, { kind: 'print' })).toBe(PAPER);
    expect(screenText(PAPER, { kind: 'read' })).toBe(PAPER);
  });

  it('Outline indents each heading by its level, and body text under its heading', () => {
    const t = screenText(PAPER, { kind: 'outline', width: 400, outline: newOutline() });
    expect(t.paras.map((p) => p.indent ?? 0)).toEqual([0, 1, 1, 2, 0, 1, 1, 2].map((n) => n * OUTLINE_STEP));
    expect(t.paras.every((p) => (p.align ?? 'left') === 'left')).toBe(true);
    // without text formatting, everything is in Normal's look
    const plain = screenText(PAPER, { kind: 'outline', width: 400, outline: { ...newOutline(), formatting: false } });
    expect(plain.runs.every((r) => !r.bold && !r.size)).toBe(true);
    expect(rt.plainText(plain.runs)).toBe(rt.plainText(PAPER.runs));
  });
});

describe('Outline: folding and levels', () => {
  it('folds a heading with everything under it, and shows down to a level', () => {
    expect([...hiddenParas(PAPER, { ...newOutline(), collapsed: [0] })]).toEqual([1, 2, 3]);
    expect([...hiddenParas(PAPER, { ...newOutline(), collapsed: [2] })]).toEqual([3]);
    expect([...hiddenParas(PAPER, { ...newOutline(), level: 1 })]).toEqual([1, 2, 3, 5, 6, 7]);
    expect([...hiddenParas(PAPER, { ...newOutline(), level: 2 })]).toEqual([1, 3, 5, 7]);
  });

  it('leaves folded paragraphs out of the layout, and the text still runs on', () => {
    const o = { ...newOutline(), collapsed: [0] };
    const lay = layouter().layout(screenText(PAPER, { kind: 'outline', width: 400, outline: o }), { hidden: hiddenParas(PAPER, o) });
    expect(new Set(lay.text.lines.map((l) => l.para))).toEqual(new Set([0, 4, 5, 6, 7]));
    // each line's offsets are those of the whole text
    const text = rt.plainText(PAPER.runs);
    const results = lay.text.lines.find((l) => l.para === 4)!;
    expect(text.slice(results.start, results.end)).toBe('Results');
    expect(lay.paraTops).toHaveLength(8);
  });

  it('Collapse folds the deepest open headings first; Expand opens them again', () => {
    let o = foldHeadings(PAPER, newOutline(), 0, 0, true);
    expect(o.collapsed).toEqual([2]);
    o = foldHeadings(PAPER, o, 0, 0, true);
    expect(o.collapsed).toEqual([0, 2]);
    o = foldHeadings(PAPER, o, 0, 0, false);
    expect(o.collapsed).toEqual([2]);
    o = foldHeadings(PAPER, o, 0, 0, false);
    expect(o.collapsed).toEqual([]);
    // on body text: its heading
    expect(foldHeadings(PAPER, newOutline(), 5, 5, true).collapsed).toEqual([4]);
    expect(toggleFold(newOutline(), 4).collapsed).toEqual([4]);
  });

  it('marks each heading shown: open, folded, or with nothing under it', () => {
    const doc = docOf([['Heading1', 'A'], ['Normal', 'a'], ['Heading1', 'B']]);
    expect(outlineMarks(doc, { ...newOutline(), collapsed: [0] })).toEqual([{ para: 0, kind: 'folded' }, { para: 2, kind: 'empty' }]);
    expect(outlineMarks(doc, newOutline()).map((m) => m.kind)).toEqual(['open', 'body', 'empty']);
  });

  it('keeps folds on their headings when paragraphs are added or taken away before them', () => {
    const o = { ...newOutline(), collapsed: [2, 6] };
    expect(shiftFolds(o, 3, 1).collapsed).toEqual([2, 7]);
    expect(shiftFolds(o, 0, -1).collapsed).toEqual([1, 5]);
  });
});

describe('Outline: promote, demote and move', () => {
  it('promotes and demotes headings; promoted body text takes the level of the heading above', () => {
    expect(levels(changeLevel(PAPER, newOutline(), 2, 2, 'promote'))[2]).toBe(1);
    expect(levels(changeLevel(PAPER, newOutline(), 0, 0, 'demote'))[0]).toBe(2);
    expect(levels(changeLevel(PAPER, newOutline(), 3, 3, 'promote'))[3]).toBe(2);
    expect(levels(changeLevel(PAPER, newOutline(), 2, 2, 'body'))[2]).toBe(0);
    expect(levels(changeLevel(PAPER, newOutline(), 6, 6, 'heading1'))[6]).toBe(1);
    // the text is the same
    expect(texts(changeLevel(PAPER, newOutline(), 2, 2, 'promote'))).toEqual(texts(PAPER));
  });

  it('demotes a folded heading with the headings folded under it', () => {
    const t = changeLevel(PAPER, { ...newOutline(), collapsed: [0] }, 0, 0, 'demote');
    expect(levels(t).slice(0, 4)).toEqual([2, 0, 3, 0]);
  });

  it('moves a paragraph up and down past the one beside it', () => {
    const r = moveParas(PAPER, newOutline(), 3, 3, -1)!;
    expect(texts(r.t).slice(0, 4)).toEqual(['Introduction', 'Some text about it.', 'More text.', 'Background']);
    expect(r.first).toBe(2);
    expect(levels(r.t).slice(0, 4)).toEqual([1, 0, 0, 2]);
    const d = moveParas(PAPER, newOutline(), 0, 0, 1)!;
    expect(texts(d.t).slice(0, 2)).toEqual(['Some text about it.', 'Introduction']);
    expect(moveParas(PAPER, newOutline(), 0, 0, -1)).toBeNull();
    expect(moveParas(PAPER, newOutline(), 7, 7, 1)).toBeNull();
  });

  it('moves a folded heading with everything under it, past a folded heading', () => {
    const o = { ...newOutline(), collapsed: [0, 4] };
    const r = moveParas(PAPER, o, 4, 4, -1)!;
    expect(texts(r.t)).toEqual(['Results', 'What we found.', 'Yields', 'Good ones.', 'Introduction', 'Some text about it.', 'Background', 'More text.']);
    expect(r.first).toBe(0);
    // the folds go with their headings
    expect(o.collapsed.map(r.moved).sort()).toEqual([0, 4]);
    expect(paraCount(rt.plainText(r.t.runs))).toBe(8);
  });
});

describe('a document in another view', () => {
  it('lays out for the view chosen, and prints from Print Layout', () => {
    const f = new DocFile(PAPER);
    expect(f.layout().pages).toHaveLength(2);
    f.view = { kind: 'web', width: 320 };
    expect(f.layout().pages).toHaveLength(1);
    expect(f.layout().pageW).toBe(320);
    // printing and PDFs use the pages
    const print = f.printLayout();
    expect(print.pages).toHaveLength(2);
    expect(print.pages[1].top).toBeCloseTo(PAPER.page.h + PAGE_GAP, 6);
    f.view = { kind: 'outline', width: 320, outline: { ...newOutline(), collapsed: [4] } };
    expect(f.layout().text.lines.some((l) => l.para === 5)).toBe(false);
    f.view = { kind: 'print' };
    expect(f.layout().pages).toHaveLength(2);
  });
});

describe('View > New Window', () => {
  function workspace() {
    const hooks: WorkspaceHooks = {
      leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
      pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
      measure: (t: string, s: number) => t.length * s * 0.5,
      sheets: { read: async () => { throw new Error('no'); }, write: async () => '' },
      documents: { read: async () => { throw new Error('no'); }, write: async () => new Uint8Array() },
    };
    return new Workspace(new Doc(), hooks);
  }

  it('shows the document in a second tab named as Word names windows', () => {
    const ws = workspace();
    const main = ws.newDocument();
    const w = ws.newWindow()!;
    expect(w.document).toBe(main.document);
    expect(w.windowOf).toBe(main);
    expect(ws.label(main)).toBe(`${main.name}:1`);
    expect(ws.label(w)).toBe(`${main.name}:2`);
    // only the tab owning the file is saved, AutoSaved and kept for recovery
    expect(ws.fileTabs).not.toContain(w);
  });

  it('marks both windows as changed, and closing one leaves the document open in the other', async () => {
    const ws = workspace();
    const main = ws.newDocument();
    const w = ws.newWindow()!;
    main.document!.ed.type('Hello');
    ws.noteChange();
    expect(w.dirty).toBe(true);
    expect(main.dirty).toBe(true);
    // closing the tab owning the file hands the file to the other window, without asking to save
    expect(await ws.close(main)).toBe(true);
    expect(ws.tabs).toContain(w);
    expect(w.windowOf).toBeNull();
    expect(w.dirty).toBe(true);
    expect(ws.label(w)).toBe(w.name);
  });
});
