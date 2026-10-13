// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { layoutText, caretPos, offsetAt, selectionRects, wordAt, lineOf, type TextFrame } from '../src/text/layout';
import { listMarkers, editParas, paraAt, paraRange, fitParas, storedParas, numberLabel } from '../src/text/paragraphs';
import { arialWidth } from '../src/text-metrics';
import { readCdxml } from '../src/io/cdxml';
import type { ParaStyle, TextRun } from '../src/model';

const measure = (t: string, s: number, _f: string, style: string) => arialWidth(t, s, /bold/.test(style));
const frame = (text: string, extra: Partial<TextFrame> = {}): TextFrame => ({ runs: [{ text }], justify: 'left', ...extra });
const lineTexts = (f: TextFrame) => {
  const text = f.runs.map((r) => r.text).join('');
  return layoutText(f, 10, measure).lines.map((l) => text.slice(l.start, l.end));
};

describe('wrapping lines in a text box', () => {
  it('breaks between words to fit the width', () => {
    const f = frame('The quick brown fox jumps over the lazy dog', { wrap: 80 });
    const lines = lineTexts(f);
    expect(lines.join('')).toBe('The quick brown fox jumps over the lazy dog');
    expect(lines.length).toBeGreaterThan(1);
    for (const l of layoutText(f, 10, measure).lines) expect(l.width).toBeLessThanOrEqual(80);
  });
  it('keeps the spaces at the end of a line with that line', () => {
    expect(lineTexts(frame('aaaa bbbb', { wrap: 30 }))).toEqual(['aaaa ', 'bbbb']);
  });
  it('lets a word wider than the box stick out, as ChemDraw does', () => {
    expect(lineTexts(frame('R4', { wrap: 7.33 }))).toEqual(['R4']);
  });
  it('can break after a hyphen inside a word', () => {
    const lines = lineTexts(frame('tert-butyldimethylsilyl', { wrap: 40 }));
    expect(lines[0]).toBe('tert-');
  });
  it('breaks only at line breaks without a width', () => {
    expect(lineTexts(frame('one two three\nfour'))).toEqual(['one two three', 'four']);
  });
  it('keeps an empty paragraph as an empty line', () => {
    const lay = layoutText(frame('a\n\nb'), 10, measure);
    expect(lay.lines.map((l) => [l.start, l.end])).toEqual([[0, 1], [2, 2], [3, 4]]);
    expect(lay.lines[1].y).toBeCloseTo(11.5);
  });
});

describe('lining up', () => {
  it('centres and right-aligns each line within the box', () => {
    const lay = layoutText(frame('ab\nabcd', { justify: 'center', wrap: 100 }), 10, measure);
    const [a, b] = lay.lines;
    expect(a.pieces[0].x + a.width / 2).toBeCloseTo(50);
    expect(b.pieces[0].x + b.width / 2).toBeCloseTo(50);
    const r = layoutText(frame('ab', { justify: 'right', wrap: 100 }), 10, measure).lines[0];
    expect(r.pieces[0].x + r.width).toBeCloseTo(100);
  });
  it('stretches every line but the last of a paragraph to both edges', () => {
    const lay = layoutText(frame('aaa bbb ccc ddd eee fff ggg hhh', { justify: 'justify', wrap: 60 }), 10, measure);
    const ls = lay.lines;
    expect(ls.length).toBeGreaterThan(2);
    for (const l of ls.slice(0, -1)) expect(l.width).toBeCloseTo(60, 5);
    expect(ls[ls.length - 1].width).toBeLessThan(60);
  });
  it('gives a paragraph its own alignment', () => {
    const lay = layoutText({ runs: [{ text: 'Title\nbody text' }], justify: 'left', wrap: 100, paras: [{ align: 'center' }, {}] }, 10, measure);
    expect(lay.lines[0].pieces[0].x).toBeGreaterThan(20);
    expect(lay.lines[1].pieces[0].x).toBe(0);
  });
  it('puts space between paragraphs and spreads lines out', () => {
    const plain = layoutText(frame('a\nb'), 10, measure).lines[1].y;
    const spaced = layoutText({ runs: [{ text: 'a\nb' }], justify: 'left', paras: [{ spaceAfter: 6 }, { spaceBefore: 2 }] }, 10, measure).lines[1].y;
    expect(spaced - plain).toBeCloseTo(8);
    const double = layoutText(frame('a\nb', { lineSpacing: 2 }), 10, measure).lines[1].y;
    expect(double).toBeCloseTo(2 * plain);
    const fixed = layoutText(frame('a\nb', { lineHeight: 20 }), 10, measure).lines[1].y;
    expect(fixed).toBe(20);
  });
});

describe('lists', () => {
  it('numbers items 1, 2, 3 and a deeper level a, b, then i, ii', () => {
    const p: ParaStyle[] = [
      { list: 'number' }, { list: 'number' }, { list: 'number', cont: true },
      { list: 'number', level: 1 }, { list: 'number', level: 1 }, { list: 'number', level: 2 }, { list: 'number', level: 2 },
      { list: 'number' }, {}, { list: 'number' },
    ];
    expect(listMarkers(p)).toEqual(['1.', '2.', null, 'a.', 'b.', 'i.', 'ii.', '3.', null, '1.']);
    expect(numberLabel(27, 1)).toBe('aa.');
    expect(numberLabel(14, 2)).toBe('xiv.');
  });
  it('gives each level its bullet', () => {
    expect(listMarkers([{ list: 'bullet' }, { list: 'bullet', level: 1 }, { list: 'bullet', level: 2 }])).toEqual(['•', '–', '•']);
  });
  it('hangs the bullet in front of the text, and wrapped lines line up with the text', () => {
    const lay = layoutText({ runs: [{ text: 'first item that is long enough to wrap\nsecond' }], justify: 'left', wrap: 90, paras: [{ list: 'bullet' }, { list: 'bullet', level: 1 }] }, 10, measure);
    const [l0, l1] = lay.lines;
    expect(l0.marker?.text).toBe('•');
    expect(l0.marker!.x).toBe(0);
    expect(l0.pieces[0].x).toBeCloseTo(11);
    expect(l1.marker).toBeUndefined();
    expect(l1.pieces[0].x).toBeCloseTo(l0.pieces[0].x);
    const sub = lay.lines[lay.lines.length - 1];
    expect(sub.marker?.text).toBe('–');
    expect(sub.marker!.x).toBeCloseTo(16);
  });
});

describe('paragraph styles while editing', () => {
  const text = 'one\ntwo\nthree';
  const paras: ParaStyle[] = [{ list: 'bullet' }, { list: 'number' }, {}];
  it('finds paragraphs', () => {
    expect(paraAt(text, 0)).toBe(0);
    expect(paraAt(text, 3)).toBe(0);
    expect(paraAt(text, 4)).toBe(1);
    expect(paraRange(text, 2)).toEqual({ start: 8, end: 13 });
  });
  it('carries a list on to a new paragraph made with Enter', () => {
    expect(editParas(paras, text, 2, 2, '\n')).toEqual([{ list: 'bullet' }, { list: 'bullet' }, { list: 'number' }, {}]);
  });
  it('joins paragraphs into the first one when the line break between them is deleted', () => {
    expect(editParas(paras, text, 3, 4, '')).toEqual([{ list: 'bullet' }, {}]);
  });
  it('takes the styles of pasted paragraphs', () => {
    expect(editParas(paras, text, 8, 8, 'x\ny', [{ align: 'center' }, { list: 'number', level: 1 }])).toEqual([{ list: 'bullet' }, { list: 'number' }, { align: 'center' }, { list: 'number', level: 1 }]);
  });
  it('stores nothing for plain paragraphs', () => {
    expect(storedParas(fitParas(undefined, 3))).toBeUndefined();
    expect(storedParas([{}, { list: 'bullet', level: 0 }])).toEqual([{}, { list: 'bullet' }]);
  });
});

describe('caret and selection', () => {
  const f = frame('alpha beta gamma delta', { wrap: 50 });
  const lay = layoutText(f, 10, measure);
  it('puts the caret at the start of the next line where a line wraps', () => {
    const l1 = lay.lines[1];
    expect(lineOf(lay, l1.start)).toBe(1);
    expect(caretPos(lay, l1.start).x).toBeCloseTo(0);
  });
  it('finds the place nearest a click, and back', () => {
    for (let o = 0; o <= 22; o++) {
      const c = caretPos(lay, o);
      const l = lay.lines[c.line];
      const back = offsetAt(lay, c.x, l.y);
      // the place after a wrapped line's last space is the start of the next line
      expect(back === o || (back === o - 1 && !l.last && o === l.end)).toBe(true);
    }
  });
  it('covers selected text line by line', () => {
    const rs = selectionRects(lay, 2, 14);
    expect(rs.length).toBe(lay.lines.filter((l) => l.end > 2 && l.start < 14).length);
    expect(rs[0].x1).toBeCloseTo(caretPos(lay, 2).x);
  });
  it('selects a word', () => {
    expect(wordAt('make tert-butyl ester', 7)).toEqual([5, 15]);
    expect(wordAt('a b', 1)).toEqual([0, 1]);
  });
});

// ------------------------------------------------------------------ against ChemDraw

const dir = process.env.CHEM_TEST_FILES ?? '';
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];

describe.skipIf(!files.length)('wrapping like ChemDraw', () => {
  it('breaks wrapped captions where ChemDraw did', { timeout: 120000 }, () => {
    let same = 0, total = 0;
    const misses: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const dom = new DOMParser().parseFromString(text, 'text/xml');
      const starts = new Map<string, number[]>();
      for (const t of dom.getElementsByTagName('t')) {
        const id = t.getAttribute('id');
        if (!id || !t.getAttribute('WordWrapWidth')) continue;
        const ls = t.getAttribute('LineStarts');
        starts.set(id, ls ? ls.trim().split(/\s+/).map(Number) : []);
      }
      const { doc } = readCdxml(text);
      for (const c of doc.captions.values()) {
        if (c.wrap === undefined) continue;
        const want = starts.get(String(c.id));
        if (!want) continue;
        const all = c.runs.map((r) => r.text).join('');
        // only text that isn't in the Symbol font (whose characters count differently)
        if (/[^\x00-\x7f]/.test(all)) continue;
        const lay = layoutText(c, 10, measure);
        // ChemDraw lists where each line after the first starts, then the length (in bytes: ASCII here)
        const got = lay.lines.slice(1).map((l) => l.start).concat(all.length);
        total++;
        const wantNoEnd = want.length ? want : [all.length];
        if (JSON.stringify(got) === JSON.stringify(wantNoEnd)) same++;
        else if (misses.length < 8) misses.push(`${f} ${c.id} (wrap ${c.wrap}): ChemDraw ${wantNoEnd.join(' ')}, here ${got.join(' ')}: ${JSON.stringify(all.slice(0, 80))}`);
      }
    }
    if (misses.length) writeFileSync(join(tmpdir(), 'wrap-misses.txt'), `${same}/${total}\n${misses.join('\n')}`);
    expect(total).toBeGreaterThan(10);
    expect(same / total).toBeGreaterThan(0.95);
  });
});
