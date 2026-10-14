// Documents: named styles, caption numbers and references, published font widths, and
// laying the text out on pages.

import { describe, it, expect } from 'vitest';
import {
  newDocument, setParaStyle, modifyStyle, fieldTexts, captionRuns, objectRun, runStyleOf, styleOf, pruneObjects, documentPlainText,
  type DocText,
} from '../src/document/document';
import { DocLayouter, pageLabel, shownSize, PAGE_GAP } from '../src/document/doc-layout';
import { documentMeasure, fontKind, publishedWidth } from '../src/text/font-measure';
import { arialWidth } from '../src/text-metrics';
import { caretPos, offsetAt } from '../src/text/layout';
import { TextEditing } from '../src/text/editing';
import { paraFromStyle } from '../src/document/document';
import type { ParaStyle, TextRun } from '../src/model';

const screen = (t: string, size: number) => t.length * size * 0.5;
const measure = documentMeasure(screen);

/** A document with these paragraphs, each in Normal unless given a style. */
function docOf(paras: (string | { text: string; style?: string; para?: ParaStyle })[]): DocText {
  const d = newDocument();
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  paras.forEach((p, i) => {
    const o = typeof p === 'string' ? { text: p } : p;
    const s = d.styles[o.style ?? 'Normal'];
    runs.push({ ...runStyleOf(s), text: o.text + (i < paras.length - 1 ? '\n' : '') });
    ps.push({ ...paraFromStyle(s, {}), ...o.para });
  });
  return { ...d, runs, paras: ps };
}

const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });

describe('published font widths', () => {
  it('knows Times New Roman, Arial and Courier New and the fonts made to match them', () => {
    expect(fontKind("'Times New Roman', Arial, sans-serif")).toBe('serif');
    expect(fontKind('Liberation Serif')).toBe('serif');
    expect(fontKind('Arial')).toBe('sans');
    expect(fontKind('Helvetica')).toBe('sans');
    expect(fontKind('Courier New')).toBe('mono');
    expect(fontKind('Calibri')).toBeNull();
  });
  it('measures Times New Roman from its widths', () => {
    // H 1479, e 909, l 569, l 569, o 1024 (units of 2048 to the em)
    expect(publishedWidth('Hello', 12, 'serif', false, false)).toBeCloseTo((4550 / 2048) * 12, 6);
    expect(publishedWidth('Hello', 12, 'serif', true, false)!).toBeGreaterThan(publishedWidth('Hello', 12, 'serif', false, false)!);
  });
  it('gives Arial the same widths the drawings use', () => {
    for (const t of ['CH2Cl2 (10 mL)', 'Yield: 85%', 'The quick brown fox']) {
      expect(measure(t, 10, 'Arial', '')).toBeCloseTo(arialWidth(t, 10), 1);
    }
  });
  it('measures Courier New as fixed width', () => {
    expect(measure('iiii', 10, 'Courier New', '')).toBeCloseTo(measure('WWWW', 10, 'Courier New', ''), 6);
  });
  it('measures other fonts, and characters not in the tables, on screen', () => {
    expect(measure('abc', 10, 'Calibri', '')).toBe(15);
    // 你 isn't in Times New Roman's table: measured on screen, the rest from the table
    const w = measure('a你', 10, 'Times New Roman', '');
    expect(w).toBeCloseTo((909 / 2048) * 10 + 5, 6);
  });
  it('has Greek letters and the signs chemists use', () => {
    for (const ch of 'αβγδΔµ°±×→Å′″–—') expect(publishedWidth(ch, 10, 'serif', false, false), ch).not.toBeNull();
  });
});

describe('named styles', () => {
  it('starts with Normal, Title, three headings and Caption, in Times New Roman', () => {
    const d = newDocument();
    expect(Object.keys(d.styles)).toEqual(['Normal', 'Title', 'Heading1', 'Heading2', 'Heading3', 'Caption']);
    expect(d.styles.Normal.font).toBe('Times New Roman');
    expect(d.paras).toEqual([{ align: 'justify', spaceAfter: 8 }]);
  });
  it('gives a paragraph a style: its text and spacing change, its own italics stay', () => {
    const d = docOf(['Introduction', 'Body text.']);
    const withItalic: DocText = { ...d, runs: [{ ...d.runs[0], text: 'Intro' }, { ...d.runs[0], italic: true, text: 'duction\n' }, d.runs[1]] };
    const h = setParaStyle(withItalic, 0, 0, 'Heading1');
    expect(h.paras[0]).toMatchObject({ style: 'Heading1', spaceBefore: 18, spaceAfter: 8, keepNext: true });
    expect(h.paras[0].align).toBeUndefined();
    expect(h.runs[0]).toMatchObject({ text: 'Intro', bold: true, size: 13 });
    expect(h.runs[1]).toMatchObject({ text: 'duction\n', bold: true, italic: true, size: 13 });
    // the second paragraph is untouched
    expect(h.runs[2]).toMatchObject({ text: 'Body text.', size: 11 });
    expect(h.runs[2].bold).toBeUndefined();
    // and back to Normal
    const n = setParaStyle(h, 0, 0, 'Normal');
    expect(n.paras[0]).toEqual({ align: 'justify', spaceAfter: 8 });
    expect(n.runs[0]).toMatchObject({ text: 'Intro', size: 11 });
    expect(n.runs[0].bold).toBeUndefined();
  });
  it('keeps a list and a page break when the style changes', () => {
    const d = docOf([{ text: 'Item', para: { list: 'number', pageBreak: true } }]);
    const h = setParaStyle(d, 0, 0, 'Heading2');
    expect(h.paras[0]).toMatchObject({ list: 'number', pageBreak: true, style: 'Heading2' });
  });
  it('changes every paragraph in a style when the style changes, except what was formatted by hand', () => {
    let d = docOf([{ text: 'One', style: 'Heading1' }, 'Body', { text: 'Two', style: 'Heading1', para: { align: 'center' } }]);
    d = { ...d, runs: [...d.runs.slice(0, 2), { ...d.runs[2], size: 20 }] };
    const h1 = { ...d.styles.Heading1, size: 16, spaceBefore: 24, color: '#1f3864' };
    const m = modifyStyle(d, h1);
    expect(m.styles.Heading1.size).toBe(16);
    expect(m.runs[0]).toMatchObject({ text: 'One\n', size: 16, color: '#1f3864' });
    expect(m.runs[1]).toMatchObject({ text: 'Body\n', size: 11 });
    expect(m.runs[1].color).toBeUndefined();
    // the third paragraph's text was made 20 pt by hand, and it was centred by hand
    expect(m.runs[2]).toMatchObject({ text: 'Two', size: 20, color: '#1f3864' });
    expect(m.paras[0].spaceBefore).toBe(24);
    expect(m.paras[2]).toMatchObject({ spaceBefore: 24, align: 'center' });
  });
  it('finds a paragraph\'s style, and Normal for one it doesn\'t know', () => {
    const d = newDocument();
    expect(styleOf(d, { style: 'Heading2' }).name).toBe('Heading 2');
    expect(styleOf(d, { style: 'Nonsense' }).id).toBe('Normal');
    expect(styleOf(d, undefined).id).toBe('Normal');
  });
});

describe('caption numbers and references', () => {
  /** Figure captions with seq ids, and a reference to one of them. */
  function captioned(): DocText {
    const d = newDocument();
    const st = runStyleOf(d.styles.Caption);
    const runs: TextRun[] = [
      ...captionRuns('Figure', 'S', 1, st), { ...st, text: 'First.\n' },
      ...captionRuns('Scheme', '', 2, st), { ...st, text: 'A scheme.\n' },
      ...captionRuns('Figure', 'S', 3, st), { ...st, text: 'Second.\n' },
      { ...st, text: 'See ' }, objectRun(4, st), { ...st, text: ' and ' }, objectRun(5, st), { ...st, text: '.' },
    ];
    return {
      ...d, runs, paras: [{}, {}, {}, {}],
      objects: { 1: { kind: 'seq', name: 'Figure' }, 2: { kind: 'seq', name: 'Scheme' }, 3: { kind: 'seq', name: 'Figure' }, 4: { kind: 'ref', target: 3 }, 5: { kind: 'ref', target: 2 } },
    };
  }
  it('numbers each kind of caption on its own', () => {
    const f = fieldTexts(captioned());
    expect(f.get(1)).toBe('1');
    expect(f.get(2)).toBe('1');
    expect(f.get(3)).toBe('2');
  });
  it('shows a reference as its caption\'s label and number', () => {
    const f = fieldTexts(captioned());
    expect(f.get(4)).toBe('Figure S2');
    expect(f.get(5)).toBe('Scheme 1');
  });
  it('follows the captions when they are put in another order', () => {
    const d = captioned();
    // move "Figure S2" (paragraph 3: five runs from 10) to the top
    const lines = d.runs;
    const reordered = { ...d, runs: [...lines.slice(10, 15), ...lines.slice(0, 10), ...lines.slice(15)] };
    const f = fieldTexts(reordered);
    expect(f.get(3)).toBe('1');
    expect(f.get(1)).toBe('2');
    expect(f.get(4)).toBe('Figure S1');
  });
  it('says so when a reference\'s caption has gone', () => {
    const d = captioned();
    const gone = { ...d, runs: d.runs.slice(15) };
    expect(fieldTexts(gone).get(4)).toMatch(/not found/);
  });
  it('writes the plain text with the numbers in it, and drops objects nothing uses', () => {
    const d = captioned();
    expect(documentPlainText(d).split('\n')[0]).toBe('Figure S1. First.');
    const extra = { ...d, objects: { ...d.objects, 9: { kind: 'seq' as const, name: 'Table' } } };
    expect(Object.keys(pruneObjects(extra).objects)).toEqual(['1', '2', '3', '4', '5']);
  });
});

describe('pages', () => {
  it('numbers pages, with a prefix and a first number, and none on a cover', () => {
    const hf = newDocument().hf;
    expect(pageLabel(hf, 0)).toBe('1');
    expect(pageLabel({ ...hf, prefix: 'S', start: 2 }, 1)).toBe('S3');
    expect(pageLabel({ ...hf, onFirst: false }, 0)).toBe('');
    expect(pageLabel({ ...hf, onFirst: false }, 1)).toBe('2');
    expect(pageLabel({ ...hf, numbers: 'none' }, 3)).toBe('');
  });
  it('shrinks a figure wider than the page to fit, keeping its shape', () => {
    expect(shownSize({ w: 200, h: 100 }, 1, 468)).toEqual({ w: 200, h: 100 });
    expect(shownSize({ w: 200, h: 100 }, 1.5, 468)).toEqual({ w: 300, h: 150 });
    const s = shownSize({ w: 936, h: 300 }, 1, 468);
    expect(s.w).toBe(468);
    expect(s.h).toBe(150);
  });
  it('fills a page and runs on to the next', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    const d = docOf(Array.from({ length: 60 }, () => text));
    const lay = layouter().layout(d);
    expect(lay.pages.length).toBeGreaterThan(1);
    // every line is inside its page's margins
    for (const p of lay.pages) {
      for (const l of lay.text.lines.slice(p.first, p.end)) {
        expect(l.y - (l.above ?? 0)).toBeGreaterThanOrEqual(p.top + d.page.top - 0.01);
        expect(l.y + (l.below ?? 0)).toBeLessThanOrEqual(p.top + d.page.h - d.page.bottom + 0.01);
      }
    }
    // pages follow one another, and each line belongs to one page
    expect(lay.pages[1].top).toBe(d.page.h + PAGE_GAP);
    expect(lay.pages[lay.pages.length - 1].end).toBe(lay.text.lines.length);
    // the lines cover the whole text in order
    let at = 0;
    for (const l of lay.text.lines) {
      expect(l.start).toBeGreaterThanOrEqual(at);
      at = l.end;
    }
    expect(lay.text.length).toBe(d.runs.reduce((a, r) => a + r.text.length, 0));
  });
  it('starts a new page at a page break', () => {
    const d = docOf(['First page', { text: 'Second page', para: { pageBreak: true } }]);
    const lay = layouter().layout(d);
    expect(lay.pages.length).toBe(2);
    expect(lay.pages[1].first).toBe(1);
  });
  it('keeps a heading with the paragraph after it', () => {
    // fill the first page almost to the bottom, then a heading and its paragraph
    const filler = Array.from({ length: 200 }, () => 'x').join('');
    const d0 = docOf(['a']);
    const lineH = layouter().layout(d0).text.lines[0];
    const per = (lineH.above ?? 0) + (lineH.below ?? 0);
    const room = d0.page.h - d0.page.top - d0.page.bottom;
    const fill = Math.floor(room / (per + 8)) - 1;
    const d = docOf([...Array.from({ length: fill }, () => filler.slice(0, 5)), { text: 'Heading', style: 'Heading1' }, 'Body text after the heading.']);
    const lay = layouter().layout(d);
    const headingLine = lay.text.lines.findIndex((l) => l.para === fill);
    const bodyLine = lay.text.lines.findIndex((l) => l.para === fill + 1);
    const pageOf = (li: number) => lay.pages.findIndex((p) => li >= p.first && li < p.end);
    expect(pageOf(headingLine)).toBe(pageOf(bodyLine));
  });
  it('lets the caret and clicks work across pages', () => {
    const text = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit, sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.';
    const d = docOf(Array.from({ length: 60 }, () => text));
    const lay = layouter().layout(d);
    const p2 = lay.pages[1];
    const line = lay.text.lines[p2.first];
    const c = caretPos(lay.text, line.start);
    expect(c.line).toBe(p2.first);
    expect(offsetAt(lay.text, c.x + 0.1, line.y - 2)).toBe(line.start);
  });
  it('lays out only the paragraphs that changed', () => {
    const d = docOf(['One', 'Two', 'Three']);
    const lr = layouter();
    const a = lr.layout(d);
    const b = lr.layout({ ...d, runs: [d.runs[0], d.runs[1], { ...d.runs[2], text: 'Three!' }] });
    expect(b.text.lines[0].pieces[0]).not.toBe(a.text.lines[0].pieces[0]);
    expect(b.text.lines[2].pieces[0].text).toBe('Three!');
  });
  it('puts a figure on its line, sitting on the baseline, and makes the line tall enough', () => {
    const d = newDocument();
    const st = runStyleOf(d.styles.Normal);
    const doc: DocText = {
      ...d, runs: [{ ...st, text: 'Before ' }, objectRun(1, st), { ...st, text: ' after' }],
      objects: { 1: { kind: 'drawing', contents: { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] } } },
    };
    const lay = layouter().layout(doc);
    expect(lay.objects).toHaveLength(1);
    const o = lay.objects[0];
    const l = lay.text.lines[0];
    expect(o.w).toBe(200);
    expect(o.y + o.h).toBeCloseTo(l.y, 6);
    expect(l.above).toBeGreaterThanOrEqual(100);
    expect(o.x).toBeGreaterThan(d.page.left);
  });
  it('lets the text editing type into a document laid out on pages', () => {
    const d = docOf(['Hello']);
    const lr = layouter();
    const ed = new TextEditing(d, runStyleOf(d.styles.Normal), measure, 11);
    ed.layoutWith = () => lr.layout(ed.t as DocText).text;
    ed.setCaret(5);
    ed.type(' world');
    expect(ed.text).toBe('Hello world');
    // the extra fields of a document survive every change
    expect((ed.t as DocText).styles.Normal.font).toBe('Times New Roman');
    const c = ed.caret();
    expect(c.x).toBeGreaterThan(d.page.left);
    ed.enter(false);
    expect(ed.t.paras).toHaveLength(2);
    expect(ed.t.paras[1]).toEqual({ align: 'justify', spaceAfter: 8 });
  });
});
