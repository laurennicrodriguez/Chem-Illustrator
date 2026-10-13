import { describe, it, expect } from 'vitest';
import { TextEditing, wordStart, wordEnd, INDENT_STEP } from '../src/text/editing';
import { arialWidth } from '../src/text-metrics';
import type { ParaStyle, TextRun } from '../src/model';

const measure = (t: string, s: number, _f: string, style: string) => arialWidth(t, s, /bold/.test(style));
const make = (text: string, extra: { paras?: ParaStyle[]; wrap?: number; runs?: TextRun[] } = {}) => {
  const ed = new TextEditing({ runs: extra.runs ?? [{ text }], paras: extra.paras, justify: 'left', wrap: extra.wrap }, { size: 10 }, measure, 10);
  let clock = 0;
  ed.now = () => (clock += 2000); // every change its own undo step unless a test says otherwise
  return ed;
};

describe('typing', () => {
  it('types at the caret and replaces a selection', () => {
    const ed = make('hello world');
    ed.setCaret(5);
    ed.type(',');
    expect(ed.text).toBe('hello, world');
    ed.select(7, 12);
    ed.type('there');
    expect(ed.text).toBe('hello, there');
    expect(ed.focus).toBe(12);
  });
  it('types in the style of the text before the caret, or a style picked with nothing selected', () => {
    const ed = make('', { runs: [{ text: 'ab', bold: true }, { text: 'cd' }] });
    ed.setCaret(2);
    ed.type('X');
    expect(ed.t.runs).toEqual([{ text: 'abX', bold: true }, { text: 'cd' }]);
    ed.toggle('italic');
    ed.type('Y');
    expect(ed.t.runs[1]).toEqual({ text: 'Y', bold: true, italic: true });
  });
  it('undoes a burst of typing in one step, and other changes one at a time', () => {
    const ed = make('');
    let clock = 0;
    ed.now = () => (clock += 100);
    for (const ch of 'abc') ed.type(ch);
    ed.selectAll();
    ed.toggle('bold');
    ed.undo();
    expect(ed.t.runs).toEqual([{ text: 'abc', size: 10 }]);
    ed.undo();
    expect(ed.text).toBe('');
    ed.redo();
    expect(ed.text).toBe('abc');
  });
  it('deletes characters and words', () => {
    const ed = make('make the ester');
    ed.backspace();
    expect(ed.text).toBe('make the este');
    ed.backspace(true);
    expect(ed.text).toBe('make the ');
    ed.setCaret(0);
    ed.deleteForward(true);
    expect(ed.text).toBe('the ');
    ed.deleteForward();
    expect(ed.text).toBe('he ');
  });
  it('keeps a pair of UTF-16 halves together', () => {
    const ed = make('a𝛼b');
    ed.setCaret(3);
    ed.backspace();
    expect(ed.text).toBe('ab');
  });
  it('shows text from an input method at the caret before it is typed', () => {
    const ed = make('ab');
    ed.setCaret(1);
    ed.compositionStart();
    ed.compositionUpdate('xy');
    expect(ed.text).toBe('ab');
    expect(ed.frame().runs.map((r) => r.text).join('')).toBe('axyb');
    ed.compositionEnd('Z');
    expect(ed.text).toBe('aZb');
  });
});

describe('paragraphs and lists', () => {
  it('carries a list on with Enter and ends it with Enter on an empty item', () => {
    const ed = make('one', { paras: [{ list: 'bullet' }] });
    ed.enter(false);
    expect(ed.t.paras).toEqual([{ list: 'bullet' }, { list: 'bullet' }]);
    ed.enter(false);
    expect(ed.text).toBe('one\n');
    expect(ed.t.paras).toEqual([{ list: 'bullet' }, {}]);
  });
  it('goes on in the same item without a bullet with Shift+Enter', () => {
    const ed = make('one', { paras: [{ list: 'number' }] });
    ed.enter(true);
    expect(ed.t.paras).toEqual([{ list: 'number' }, { list: 'number', cont: true }]);
  });
  it('takes the bullet off with Backspace at the start of an item, then joins', () => {
    const ed = make('a\nb', { paras: [{}, { list: 'bullet' }] });
    ed.setCaret(2);
    ed.backspace();
    expect(ed.t.paras).toEqual([{}, {}]);
    expect(ed.text).toBe('a\nb');
    ed.backspace();
    expect(ed.text).toBe('ab');
  });
  it('switches a list on and off for the selected paragraphs', () => {
    const ed = make('a\nb\nc');
    ed.select(0, 3);
    ed.list('number');
    expect(ed.t.paras).toEqual([{ list: 'number' }, { list: 'number' }, {}]);
    ed.list('number');
    expect(ed.t.paras).toEqual([{}, {}, {}]);
  });
  it('indents list items a level and other paragraphs by a step', () => {
    const ed = make('a\nb', { paras: [{ list: 'bullet' }, {}] });
    ed.selectAll();
    ed.indent(1);
    expect(ed.t.paras).toEqual([{ list: 'bullet', level: 1 }, { indent: INDENT_STEP }]);
    ed.indent(-1);
    ed.indent(-1);
    expect(ed.t.paras).toEqual([{ list: 'bullet' }, {}]);
  });
  it('lines up the whole text, or only the selected paragraphs', () => {
    const ed = make('title\nbody');
    ed.setCaret(2);
    ed.align('center');
    expect(ed.t.justify).toBe('left');
    expect(ed.t.paras).toEqual([{ align: 'center' }, {}]);
    expect(ed.currentAlign()).toBe('center');
    ed.setCaret(8);
    ed.align('center');
    // both centred is the same as centring the whole text
    expect(ed.t.justify).toBe('center');
    expect(ed.t.paras).toEqual([{}, {}]);
  });
  it('sets spacing', () => {
    const ed = make('a\nb');
    ed.selectAll();
    ed.paraSpacing({ spaceAfter: 6 });
    ed.lineSpacing(1.5);
    expect(ed.t.paras).toEqual([{ spaceAfter: 6 }, { spaceAfter: 6 }]);
    expect(ed.t.lineSpacing).toBe(1.5);
    ed.lineSpacing(1);
    expect(ed.t.lineSpacing).toBeUndefined();
  });
  it('stores no paragraph styles for plain text', () => {
    expect(make('a\nb').result().paras).toBeUndefined();
  });
  it('pastes paragraphs with their own styles', () => {
    const ed = make('x');
    ed.setCaret(1);
    ed.replaceSelection([{ text: '\na\nb' }], [{}, { list: 'bullet' }, { list: 'bullet' }]);
    expect(ed.t.paras).toEqual([{}, { list: 'bullet' }, { list: 'bullet' }]);
  });
});

describe('moving the caret', () => {
  it('goes by words', () => {
    expect(wordStart('make the ester', 14)).toBe(9);
    expect(wordStart('make the ', 9)).toBe(5);
    expect(wordEnd('make the ester', 0)).toBe(5);
    expect(wordStart('a\nb', 2)).toBe(1);
  });
  it('goes up and down lines keeping its column, and to line ends', () => {
    const ed = make('alpha beta gamma delta epsilon', { wrap: 50 });
    const lay = ed.layout();
    expect(lay.lines.length).toBeGreaterThan(2);
    ed.setCaret(2);
    ed.move('down', false);
    expect(ed.focus).toBeGreaterThanOrEqual(lay.lines[1].start);
    expect(ed.focus).toBeLessThan(lay.lines[1].end);
    ed.move('down', false);
    ed.move('up', false);
    ed.move('up', false);
    expect(ed.focus).toBe(2);
    ed.move('lineEnd', false);
    expect(ed.focus).toBe(lay.lines[0].end - 1);
    ed.move('lineStart', true);
    expect([ed.anchor, ed.focus]).toEqual([lay.lines[0].end - 1, 0]);
    ed.move('right', false);
    expect(ed.focus).toBe(lay.lines[0].end - 1);
  });
  it('selects words and paragraphs', () => {
    const ed = make('one two\nthree');
    ed.selectWord(5);
    expect([ed.start, ed.end]).toEqual([4, 7]);
    ed.selectParagraph(10);
    expect([ed.start, ed.end]).toEqual([8, 13]);
    expect(ed.selected().runs).toEqual([{ text: 'three' }]);
  });
});

describe('text box width', () => {
  it('wraps to a width and can stop wrapping', () => {
    const ed = make('one two three four five six');
    ed.setWrap(40);
    expect(ed.layout().lines.length).toBeGreaterThan(1);
    ed.setWrap(undefined);
    expect(ed.layout().lines.length).toBe(1);
  });
});
