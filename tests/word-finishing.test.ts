// @vitest-environment jsdom
//
// Word's finishing touches in Document mode: paragraph borders and shading, Sort, fields (date,
// properties, file name, pages, cross-references to bookmarks), cover pages, Quick Parts, Go To and
// Select Similar Formatting, Word Count, the grammar checks of the Spelling and Grammar pane, and
// hyphenation; each laid out here and saved in Word files and read back.

import { describe, it, expect, afterEach } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { newDocument, paraFromStyle, runStyleOf, type DocObject, type DocText } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { documentMeasure } from '../src/text/font-measure';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { chooseBorder, hasChoice, borderRoom, DEFAULT_LINE } from '../src/document/para-borders';
import { sortParagraphs, sortTableRows, dateValue, firstNumber } from '../src/document/sort';
import { fieldEnv, fieldInstr, fieldText, formatDate, parseFieldInstr, type FieldObj } from '../src/document/fields';
import { COVER_PAGES, coverParas, insertCover, parseQuickParts, partFromSelection, removeCover } from '../src/document/quick-parts';
import { goToOffset, placesOf, similarRanges } from '../src/document/goto';
import { countDocument, countText } from '../src/document/word-count';
import { grammarIssues } from '../src/text/grammar';
import { proofProblems } from '../src/ui/doc-proofing-ui';
import { hyphenPoints } from '../src/text/hyphenate';
import { layoutText } from '../src/text/layout';
import * as rt from '../src/richtext';
import type { ParaStyle, TableData, TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };

/** A document of these paragraphs. */
function docOf(paras: (string | { text: string; para?: ParaStyle; runs?: TextRun[] })[], extra: Partial<DocText> = {}): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  paras.forEach((p, i) => {
    const o = typeof p === 'string' ? { text: p } : p;
    if (o.runs) runs.push(...o.runs);
    else runs.push({ ...runStyleOf(s), text: o.text });
    if (i < paras.length - 1) runs.push({ ...runStyleOf(s), text: '\n' });
    ps.push({ ...paraFromStyle(s, {}), ...o.para });
  });
  return { ...d, runs: rt.normalizeRuns(runs), paras: ps, ...extra };
}

const settingsXml = async (t: DocText) => strFromU8(unzipSync(await writeDocx(t, deps))['word/settings.xml']);
const documentXml = async (t: DocText) => strFromU8(unzipSync(await writeDocx(t, deps))['word/document.xml']);

afterEach(() => { fieldEnv.fileName = ''; fieldEnv.now = () => new Date(); });

describe('paragraph borders and shading', () => {
  it('chooses borders as Word\'s Borders menu does', () => {
    let b = chooseBorder(undefined, 'bottom');
    expect(b?.bottom).toEqual(DEFAULT_LINE);
    b = chooseBorder(b, 'top');
    expect(hasChoice(b, 'top') && hasChoice(b, 'bottom')).toBe(true);
    // the same choice again takes it off
    b = chooseBorder(b, 'bottom', DEFAULT_LINE, true);
    expect(b?.bottom).toBeUndefined();
    expect(chooseBorder(b, 'none')).toBeUndefined();
    const all = chooseBorder(undefined, 'all');
    expect(Object.keys(all ?? {}).sort()).toEqual(['between', 'bottom', 'left', 'right', 'top']);
  });

  it('leaves room for the lines and shares one box between paragraphs alike', () => {
    const line = { style: 'single' as const, w: 1, color: '#000000' };
    const box = { top: line, bottom: line };
    const t = docOf([{ text: 'one', para: { border: box } }, { text: 'two', para: { border: box } }, 'three']);
    const room = borderRoom(t.paras);
    // the box's top is above the first and its bottom below the second only
    expect(room.above[0]).toBeGreaterThan(0);
    expect(room.above[1]).toBe(0);
    expect(room.below[0]).toBe(0);
    expect(room.below[1]).toBeGreaterThan(0);
    const lay = layouter().layout(t);
    expect(lay.frames.length).toBe(1);
  });

  it('saves borders and shading in Word and reads them back', async () => {
    const line = { style: 'double' as const, w: 1.5, color: '#c00000' };
    const t = docOf([{ text: 'boxed', para: { border: { top: line, left: line }, shade: '#d9e2f3' } }, 'plain']);
    const xml = await documentXml(t);
    expect(xml).toContain('<w:pBdr>');
    expect(xml.toLowerCase()).toContain('w:fill="d9e2f3"');
    const { doc } = await readDocx(await writeDocx(t, deps));
    expect(doc.paras[0].border?.top?.style).toBe('double');
    expect(doc.paras[0].border?.left?.color.toLowerCase()).toBe('#c00000');
    expect(doc.paras[0].border?.bottom).toBeUndefined();
    expect(doc.paras[0].shade?.toLowerCase()).toBe('#d9e2f3');
    expect(doc.paras[1].border).toBeUndefined();
  });
});

describe('sort', () => {
  it('reads numbers and dates', () => {
    expect(firstNumber('Entry 12: 85%')).toBe(12);
    expect(firstNumber('−3.5 °C')).toBe(-3.5);
    expect(dateValue('2024-03-05')).toBeLessThan(dateValue('2024-03-06')!);
  });

  it('sorts paragraphs, each keeping its look, and leaves a heading and page breaks in place', () => {
    const t = docOf(['Reagents', { text: 'pyridine', para: { align: 'center' } }, { text: 'Acetone', para: { pageBreak: true } }, 'benzene']);
    const s = sortParagraphs(t, 0, 3, { keys: [{ type: 'text' }], header: true });
    expect(rt.plainText(s.runs).split('\n')).toEqual(['Reagents', 'Acetone', 'benzene', 'pyridine']);
    expect(s.paras[3].align).toBe('center');
    // the page break stays with the place
    expect(s.paras[2].pageBreak).toBe(true);
    const n = sortParagraphs(docOf(['10 g', '9 g', '100 g']), 0, 2, { keys: [{ type: 'number', descending: true }] });
    expect(rt.plainText(n.runs).split('\n')).toEqual(['100 g', '10 g', '9 g']);
    const f = sortParagraphs(docOf(['b\t2', 'a\t3', 'c\t1']), 0, 2, { keys: [{ field: 1, type: 'number' }], sep: '\t' });
    expect(rt.plainText(f.runs).split('\n')).toEqual(['c\t1', 'b\t2', 'a\t3']);
  });

  it('sorts a table\'s rows under its heading, and not a table with cells merged down', () => {
    const cell = (text: string, rowSpan?: number) => ({ runs: [{ text }], ...(rowSpan ? { rowSpan } : {}) });
    const tb = { cols: [60, 60], head: 1, rows: [[cell('Entry'), cell('Yield')], [cell('2'), cell('40')], [cell('1'), cell('90')]] } as unknown as TableData;
    const s = sortTableRows(tb, { keys: [{ field: 1, type: 'number', descending: true }] });
    expect(s.rows.map((r) => rt.plainText(r[0].runs))).toEqual(['Entry', '1', '2']);
    const merged = { ...tb, rows: [tb.rows[0], [cell('a', 2), cell('x')], [cell(''), cell('y')]] } as unknown as TableData;
    expect(sortTableRows(merged, { keys: [{ type: 'text' }] })).toBe(merged);
  });
});

describe('fields', () => {
  const fixed = new Date(2026, 9, 22, 14, 5, 9);

  it('formats dates in Word date pictures', () => {
    expect(formatDate(fixed, 'MMMM d, yyyy')).toBe('October 22, 2026');
    expect(formatDate(fixed, 'dddd, d MMM yy')).toBe('Thursday, 22 Oct 26');
    expect(formatDate(fixed, 'yyyy-MM-dd')).toBe('2026-10-22');
    expect(formatDate(fixed, 'h:mm am/pm')).toBe('2:05 pm');
    expect(formatDate(fixed, 'HH:mm:ss')).toBe('14:05:09');
    expect(formatDate(fixed, "'Day' d")).toBe('Day 22');
  });

  it('works out what each field shows', () => {
    fieldEnv.now = () => fixed;
    fieldEnv.fileName = 'Report.docx';
    const t = docOf([{ text: 'Results', para: { marks: ['Results'] } }, 'see below'], { props: { title: 'Thesis', author: 'Nate' } });
    const f = (o: Partial<FieldObj>) => fieldText({ kind: 'field', code: 'date', ...o } as FieldObj, t, 1, (p) => String(p + 3), 9);
    expect(f({ code: 'date', format: 'M/d/yyyy' })).toBe('10/22/2026');
    expect(f({ code: 'title' })).toBe('Thesis');
    expect(f({ code: 'author' })).toBe('Nate');
    expect(f({ code: 'filename' })).toBe('Report.docx');
    expect(f({ code: 'page' })).toBe('4');
    expect(f({ code: 'numpages' })).toBe('9');
    expect(f({ code: 'ref', target: 'Results' })).toBe('Results');
    expect(f({ code: 'pageref', target: 'results' })).toBe('3');
    expect(f({ code: 'abovebelow', target: 'Results' })).toBe('above');
    expect(f({ code: 'ref', target: 'Nowhere' })).toBe('Error! Bookmark not defined.');
  });

  it('writes Word\'s field instructions and reads them back', () => {
    const cases: FieldObj[] = [
      { kind: 'field', code: 'date', format: 'MMMM d, yyyy' }, { kind: 'field', code: 'author' }, { kind: 'field', code: 'company' },
      { kind: 'field', code: 'numpages' }, { kind: 'field', code: 'ref', target: 'Scheme1' }, { kind: 'field', code: 'pageref', target: 'Scheme1' },
      { kind: 'field', code: 'abovebelow', target: 'Scheme1' },
    ];
    for (const o of cases) expect(parseFieldInstr(fieldInstr(o))).toEqual(o);
    expect(parseFieldInstr(' HYPERLINK "x" ')).toBeNull();
  });

  it('saves fields and the document\'s properties in Word and reads them back', async () => {
    fieldEnv.now = () => fixed;
    const objects: Record<number, DocObject> = { 1: { kind: 'field', code: 'date', format: 'yyyy-MM-dd' }, 2: { kind: 'field', code: 'title' }, 3: { kind: 'field', code: 'ref', target: 'Intro' } };
    const base = runStyleOf(newDocument().styles.Normal);
    const t = docOf([
      { text: 'Intro', para: { marks: ['Intro'] } },
      { text: '', runs: [{ ...base, text: 'Made ' }, { ...base, obj: 1, text: '￼' }, { ...base, text: ' for ' }, { ...base, obj: 2, text: '￼' }, { ...base, text: ', see ' }, { ...base, obj: 3, text: '￼' }] },
    ], { objects, props: { title: 'My Thesis', author: 'Nate', company: 'Auburn University' } });
    const bytes = await writeDocx(t, deps);
    const parts = unzipSync(bytes);
    const xml = strFromU8(parts['word/document.xml']);
    expect(xml).toContain('DATE \\@ &quot;yyyy-MM-dd&quot;');
    expect(xml).toContain('2026-10-22');
    expect(xml).toContain('My Thesis');
    expect(strFromU8(parts['docProps/core.xml'])).toContain('<dc:title>My Thesis</dc:title>');
    expect(strFromU8(parts['docProps/app.xml'])).toContain('<Company>Auburn University</Company>');
    const { doc } = await readDocx(bytes);
    expect(doc.props?.title).toBe('My Thesis');
    expect(doc.props?.author).toBe('Nate');
    expect(doc.props?.company).toBe('Auburn University');
    const fields = Object.values(doc.objects).filter((o): o is FieldObj => o.kind === 'field');
    expect(fields.map((o) => o.code).sort()).toEqual(['date', 'ref', 'title']);
    expect(fields.find((o) => o.code === 'date')?.format).toBe('yyyy-MM-dd');
    expect(fields.find((o) => o.code === 'ref')?.target).toBe('Intro');
    // the bookmark the reference points at is kept
    expect(doc.paras[0].marks).toContain('Intro');
  });
});

describe('cover pages and Quick Parts', () => {
  it('puts a cover page in front, with no page number on it, and takes it out again', () => {
    const t = docOf(['Body text']);
    let id = 100;
    const c = insertCover(t, COVER_PAGES.find((d) => d.id === 'ruled')!, '#1f4e79', runStyleOf(t.styles.Normal), (code, format) => ({ id: id++, o: { kind: 'field', code, ...(format ? { format } : {}) } }));
    const range = coverParas(c);
    expect(range?.first).toBe(0);
    expect(c.paras[range!.end].pageBreak).toBe(true);
    expect(c.hf.onFirst).toBe(false);
    expect(c.paras[0].border?.top).toBeDefined();
    expect(Object.values(c.objects).some((o) => o.kind === 'field' && o.code === 'title')).toBe(true);
    const back = removeCover(c);
    expect(rt.plainText(back.runs)).toBe('Body text');
    expect(back.paras[0].pageBreak).toBeUndefined();
  });

  it('saves a selection as a Quick Part and reads Quick Parts from the settings', () => {
    const t = docOf(['Department of Chemistry', { text: 'Auburn University', para: { align: 'center' } }]);
    const part = partFromSelection(t, 0, rt.plainText(t.runs).length, ' Affiliation ');
    expect(part?.name).toBe('Affiliation');
    expect(part?.paras[1].align).toBe('center');
    const parsed = parseQuickParts([part, { name: '' }, 'junk', { name: 'x', runs: [{ text: 'hi', obj: 3 }] }]);
    expect(parsed.map((p) => p.name)).toEqual(['Affiliation', 'x']);
    expect(parsed[1].runs[0].obj).toBeUndefined();
  });
});

describe('Go To and Select', () => {
  it('goes to a page, a heading or a bookmark by number, step or name', () => {
    const t = docOf([{ text: 'Intro', para: { style: 'Heading1' } }, 'a', { text: 'Methods', para: { style: 'Heading1', marks: ['Methods'] } }, { text: 'b', para: { pageBreak: true } }]);
    const lay = layouter().layout(t);
    const text = rt.plainText(t.runs);
    expect(placesOf('page', t, lay).length).toBe(2);
    expect(goToOffset('page', '2', t, lay, 0)).toBe(text.lastIndexOf('b'));
    expect(goToOffset('page', '+', t, lay, 0)).toBe(text.lastIndexOf('b'));
    expect(goToOffset('bookmark', 'methods', t, lay, 0)).toBe(text.indexOf('Methods'));
    expect(goToOffset('page', '7', t, lay, 0)).toBeNull();
  });

  it('selects the text that looks like the text at the caret', () => {
    const runs: TextRun[] = [{ text: 'one ' }, { text: 'two', bold: true }, { text: ' three ' }, { text: 'four', bold: true }];
    expect(similarRanges(runs, 5, () => ({}))).toEqual([[4, 7], [14, 18]]);
  });
});

describe('Word Count and the grammar checks', () => {
  it('counts words, characters, paragraphs; text boxes and notes when asked', () => {
    expect(countText('The yield was 85%.\n\nCH2Cl2 was used')).toEqual({ words: 7, chars: 28, charsWithSpaces: 33, paras: 2 });
    const t = docOf(['two words'], { objects: { 1: { kind: 'note', runs: [{ text: 'a footnote here' }] } } });
    expect(countDocument(t, false).words).toBe(2);
    expect(countDocument(t, true).words).toBe(5);
    expect(countDocument(t, true, [0, 3]).words).toBe(1);
  });

  it('finds plain grammar slips but leaves chemistry alone', () => {
    const msgs = (s: string) => grammarIssues(s).map((g) => [s.slice(g.start, g.end), g.fix]);
    expect(msgs('It was the the best.')).toEqual([[' the', '']]);
    expect(msgs('We used an flask and a ester.')).toEqual([['an', 'a'], ['a', 'an']]);
    expect(msgs('a NMR spectrum and an HPLC trace')).toEqual([['a', 'an']]);
    expect(msgs('Stirred  for 2 h .')).toEqual([['  ', ' '], [' ', '']]);
    expect(msgs('It was dried. then it was filtered.')).toEqual([['t', 'T']]);
    // chemistry and abbreviations are not slips
    expect(msgs('A solution of n-BuLi in THF, e.g. for an hour. p-TsOH was then added; see Fig. 2 and ca. 5 mL.')).toEqual([]);
    expect(msgs('a one-pot reaction, a unique and a useful step, an X-ray structure')).toEqual([]);
  });

  it('lists spelling, chemistry and grammar problems in order for the pane', () => {
    const text = 'Teh the the yield';
    const ps = proofProblems(text, [[0, 3]], [], null);
    expect(ps.map((p) => [p.kind, text.slice(p.start, p.end)])).toEqual([['spelling', 'Teh'], ['grammar', ' the']]);
  });
});

describe('hyphenation', () => {
  it('finds where English words may be broken', () => {
    expect(hyphenPoints('chromatography')).toEqual([4, 9, 11]);
    expect(hyphenPoints('hydrogenation').length).toBeGreaterThan(1);
  });

  it('breaks a long word at the end of a line with a hyphen the caret passes by', () => {
    const runs: TextRun[] = [{ text: 'purified by chromatography on silica' }];
    const m = (t: string, size: number) => t.length * size * 0.5;
    const plain = layoutText({ runs, justify: 'left', wrap: 130 }, 10, m);
    expect(plain.lines[0].pieces.map((g) => g.text).join('')).toBe('purified by ');
    const hy = layoutText({ runs, justify: 'left', wrap: 130, hyphenate: { points: hyphenPoints, zone: 5, limit: 0, caps: true } }, 10, m);
    const first = hy.lines[0];
    expect(first.pieces.map((g) => g.text).join('')).toBe('purified by chromatogra-');
    expect(first.pieces[first.pieces.length - 1].decor).toBe(true);
    expect(hy.lines[1].start).toBe(first.end);
    // a wide hyphenation zone leaves the word whole
    const zoned = layoutText({ runs, justify: 'left', wrap: 130, hyphenate: { points: hyphenPoints, zone: 100, limit: 0, caps: true } }, 10, m);
    expect(zoned.lines[0].pieces.map((g) => g.text).join('')).toBe('purified by ');
  });

  it('hyphenates a document unless a paragraph says not to, and saves Word\'s settings', async () => {
    const long = 'The crude product was purified by chromatography and recrystallization from hexanes and characterization followed '.repeat(4);
    const on = docOf([long, { text: long, para: { noHyphen: true } }], { hyphen: { auto: true, zone: 9, limit: 2, caps: false } });
    const lay = layouter().layout(on);
    const hyphenated = (para: number) => lay.text.lines.filter((l) => l.para === para && l.pieces.some((g) => g.decor && g.text === '-')).length;
    expect(hyphenated(0)).toBeGreaterThan(0);
    expect(hyphenated(1)).toBe(0);
    const st = await settingsXml(on);
    expect(st).toContain('<w:autoHyphenation/><w:consecutiveHyphenLimit w:val="2"/><w:hyphenationZone w:val="180"/><w:doNotHyphenateCaps/>');
    expect(await documentXml(on)).toContain('<w:suppressAutoHyphens/>');
    const { doc } = await readDocx(await writeDocx(on, deps));
    expect(doc.hyphen).toEqual({ auto: true, limit: 2, zone: 9, caps: false });
    expect(doc.paras[1].noHyphen).toBe(true);
    expect(doc.paras[0].noHyphen).toBeUndefined();
  });
});
