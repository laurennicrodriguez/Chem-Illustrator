// @vitest-environment jsdom
//
// Document sections, as in Word: section breaks (Next Page, Continuous, Even Page, Odd Page),
// each section with its own paper, margins, columns, header and footer, page numbering and
// line numbers; laid out on pages, and saved in Word files and read back.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { newDocument, paraFromStyle, runStyleOf, INCH, type DocText, type SectionBreak } from '../src/document/document';
import { DocLayouter } from '../src/document/doc-layout';
import { changeSection, newBreak, pageNumText, sectionAt, sectionsOf } from '../src/document/sections';
import { documentMeasure } from '../src/text/font-measure';
import { editParas } from '../src/text/paragraphs';
import { TextEditing } from '../src/text/editing';
import { headerFooterText } from '../src/document/doc-paint';
import { screenText, breaksIn } from '../src/document/doc-views';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import type { ParaStyle, TextRun } from '../src/model';

const measure = documentMeasure((t: string, size: number) => t.length * size * 0.5);
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 200, h: 100 }) });
const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };

/** A document of these paragraphs; `section` starts a new section at a paragraph. */
function docOf(paras: (string | { text: string; para?: ParaStyle })[]): DocText {
  const d = newDocument();
  const s = d.styles.Normal;
  const runs: TextRun[] = [];
  const ps: ParaStyle[] = [];
  paras.forEach((p, i) => {
    const o = typeof p === 'string' ? { text: p } : p;
    runs.push({ ...runStyleOf(s), text: o.text + (i < paras.length - 1 ? '\n' : '') });
    ps.push({ ...paraFromStyle(s, {}), ...o.para });
  });
  return { ...d, runs, paras: ps };
}

const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const LAND = { w: 792, h: 612 };

describe('sections', () => {
  it('splits a document into sections at its section breaks, each taking what it leaves out from the one before', () => {
    const t = docOf(['one', { text: 'two', para: { section: { kind: 'continuous', page: { ...newDocument().page, cols: 2 } } } }, 'three', { text: 'four', para: { section: { kind: 'nextPage', restart: 1, format: 'lowerRoman' } } }]);
    const secs = sectionsOf(t);
    expect(secs.map((s) => [s.first, s.end, s.kind])).toEqual([[0, 1, 'nextPage'], [1, 3, 'continuous'], [3, 4, 'nextPage']]);
    expect(secs[1].page.cols).toBe(2);
    // the last section takes the page setup and the header of the one before
    expect(secs[2].page.cols).toBe(2);
    expect(secs[2].linked).toBe(true);
    expect(secs[2].restart).toBe(1);
    expect(sectionAt(secs, 2).index).toBe(1);
    // a section break on the first paragraph means nothing
    expect(sectionsOf(docOf([{ text: 'x', para: { section: { kind: 'nextPage' } } }]))).toHaveLength(1);
  });

  it('changes a section: the first section is the document\'s own page, header and footer', () => {
    let t = docOf(['one', { text: 'two', para: { section: { kind: 'nextPage' } } }]);
    t = changeSection(t, 0, { format: 'lowerRoman', lines: { start: 1, countBy: 1, restart: 'page' } });
    expect(t.numFormat).toBe('lowerRoman');
    expect(t.lineNumbers?.restart).toBe('page');
    t = changeSection(t, 1, { page: { ...t.page, ...LAND } });
    expect(t.page.w).toBe(612);
    expect(t.paras[1].section?.page?.w).toBe(792);
    // typing a header into a linked section gives it its own
    expect(sectionsOf(t)[1].linked).toBe(true);
    t = changeSection(t, 1, { hf: { ...t.hf, header: ['Appendix', '', ''] } });
    expect(sectionsOf(t)[1].linked).toBe(false);
    expect(sectionsOf(t)[0].hf.header[0]).toBe('');
    t = changeSection(t, 1, { linked: true });
    expect(t.paras[1].section?.hf).toBeUndefined();
  });

  it('copies a section\'s page setup, number format and line numbers into a new one, as Word does', () => {
    const t = changeSection(docOf(['one']), 0, { format: 'upperRoman', lines: { start: 1, countBy: 5, restart: 'section' }, page: { ...newDocument().page, cols: 2 } });
    const b = newBreak(sectionsOf(t)[0], 'continuous');
    expect(b).toEqual({ kind: 'continuous', page: t.page, format: 'upperRoman', lines: t.lineNumbers });
    expect(b.hf).toBeUndefined();
    expect(b.restart).toBeUndefined();
  });

  it('writes page numbers as 1, 2, 3; i, ii, iii; I, II; a, b; A, B', () => {
    expect([4, 9, 14].map((n) => pageNumText(n, 'lowerRoman'))).toEqual(['iv', 'ix', 'xiv']);
    expect(pageNumText(3, 'upperRoman')).toBe('III');
    expect(pageNumText(2, 'lowerLetter')).toBe('b');
    expect(pageNumText(27, 'upperLetter')).toBe('AA');
    expect(pageNumText(12, 'decimal')).toBe('12');
  });

  it('keeps a section break with the first part of a paragraph split in two, and Backspace takes it off', () => {
    const t = docOf(['one', { text: 'twothree', para: { section: { kind: 'nextPage' } } }]);
    const text = 'one\ntwothree';
    const ps = editParas(t.paras, text, 7, 7, '\n');
    expect(ps[1].section?.kind).toBe('nextPage');
    expect(ps[2].section).toBeUndefined();
    const ed = new TextEditing(t, {}, measure, 11);
    ed.anchor = ed.focus = 4;
    ed.backspace();
    expect(ed.t.paras[1].section).toBeUndefined();
    expect(ed.text).toBe(text);
  });
});

describe('laying out sections', () => {
  it('starts a Next Page section on a new page, in its own orientation, in the middle of the wider pages', () => {
    const t = docOf(['portrait', { text: 'a wide table', para: { section: { kind: 'nextPage', page: { ...newDocument().page, ...LAND } } } }, { text: 'portrait again', para: { section: { kind: 'nextPage', page: newDocument().page } } }]);
    const lay = layouter().layout(t);
    expect(lay.pages).toHaveLength(3);
    expect(lay.pages.map((p) => [p.w, p.h])).toEqual([[612, 792], [792, 612], [612, 792]]);
    expect(lay.pageW).toBe(792);
    // a portrait page sits in the middle of the landscape one's width, and its text with it
    expect(lay.pages[0].x).toBe(90);
    expect(lay.pages[1].x).toBe(0);
    expect(lay.text.lines[0].x).toBeCloseTo(90 + INCH);
    // the landscape page is shorter: the next page starts below it
    expect(lay.pages[2].top).toBeCloseTo(lay.pages[1].top + 612 + 18);
    expect(lay.paraTops[1].page).toBe(1);
    expect(lay.text.lines[1].x).toBeCloseTo(INCH);
  });

  it('numbers pages on from section to section, or from the start again, in each section\'s format', () => {
    const t0 = docOf(['title', 'abstract', { text: 'introduction', para: { section: { kind: 'nextPage', restart: 1 } } }, { text: 'results', para: { pageBreak: true } }]);
    const t = changeSection(t0, 0, { format: 'lowerRoman' });
    t.paras[1] = { ...t.paras[1], pageBreak: true };
    const lay = layouter().layout(t);
    expect(lay.pages.map((p) => p.number)).toEqual(['i', 'ii', '1', '2']);
    expect(lay.pages.map((p) => p.section)).toEqual([0, 0, 1, 1]);
    // carrying on instead
    const on = changeSection(t, 1, { restart: undefined });
    expect(layouter().layout(on).pages.map((p) => p.number)).toEqual(['i', 'ii', '3', '4']);
  });

  it('gives each section its header and footer, or the one before\'s when linked', () => {
    let t = docOf(['body', { text: 'appendix', para: { section: { kind: 'nextPage' } } }, { text: 'more', para: { pageBreak: true } }]);
    t = { ...t, hf: { ...t.hf, header: ['Paper', '', ''], onFirst: true } };
    let lay = layouter().layout(t);
    expect(lay.pages.map((p) => p.hf.header[0])).toEqual(['Paper', 'Paper', 'Paper']);
    t = changeSection(t, 1, { hf: { ...t.hf, header: ['Appendix', '', ''], onFirst: false } });
    lay = layouter().layout(t);
    expect(lay.pages.map((p) => p.hf.header[0])).toEqual(['Paper', 'Appendix', 'Appendix']);
    // "number the first page" off: no number on the section's first page only
    expect(lay.pages.map((p) => p.label)).toEqual(['1', '', '3']);
    expect(headerFooterText(t, lay.pages[1].label, lay.pages[1].hf).map((x) => x.text)).toEqual(['Appendix']);
  });

  it('starts a Continuous section on the same page: one column of title, then two columns below it', () => {
    const two = { ...newDocument().page, cols: 2 };
    const t = docOf(['A title across the page', { text: words(400), para: { section: { kind: 'continuous', page: two } } }]);
    const lay = layouter().layout(t);
    const title = lay.text.lines[0];
    const body = lay.text.lines.slice(0, lay.pages[0].end).filter((l) => l.para === 1);
    // the body's lines are a column wide, in both columns, all below the title
    expect(new Set(body.map((l) => Math.round(l.band![0])))).toEqual(new Set([72, 72 + (468 + 36) / 2]));
    for (const l of body) expect(l.y - l.ascent).toBeGreaterThan(title.y);
    // the second column starts as high as the first, under the title
    const tops = [72, 72 + 252].map((x) => Math.min(...body.filter((l) => Math.round(l.band![0]) === x).map((l) => l.y)));
    expect(tops[0]).toBeCloseTo(tops[1]);
  });

  it('evens up the columns before a Continuous break back to one column, and carries on below them', () => {
    const two = { ...newDocument().page, cols: 2 };
    const t = docOf(['title', { text: words(40), para: { section: { kind: 'continuous', page: two } } }, { text: 'After the columns', para: { section: { kind: 'continuous', page: newDocument().page } } }]);
    const lay = layouter().layout(t);
    const body = lay.text.lines.filter((l) => l.para === 1);
    const left = body.filter((l) => l.band![0] < 200), right = body.filter((l) => l.band![0] > 200);
    expect(left.length).toBeGreaterThan(0);
    expect(Math.abs(left.length - right.length)).toBeLessThanOrEqual(1);
    const after = lay.text.lines.find((l) => l.para === 2)!;
    expect(after.y).toBeGreaterThan(Math.max(...body.map((l) => l.y)));
    expect(after.x).toBeCloseTo(INCH);
    expect(lay.pages).toHaveLength(1);
  });

  it('leaves a blank page before an Odd Page section that would start on an even page', () => {
    const odd: SectionBreak = { kind: 'oddPage' };
    expect(layouter().layout(docOf(['one', { text: 'chapter', para: { section: odd } }])).pages.map((p) => p.number)).toEqual(['1', '2', '3']);
    expect(layouter().layout(docOf(['one', { text: 'chapter', para: { section: odd } }])).pages[1].end).toBe(layouter().layout(docOf(['one', { text: 'chapter', para: { section: odd } }])).pages[1].first);
    expect(layouter().layout(docOf(['one', { text: 'chapter', para: { section: { kind: 'evenPage' } } }])).pages).toHaveLength(2);
  });

  it('leaves sections out of the views without pages, and shows them in Draft as labelled breaks', () => {
    const t = docOf(['one', { text: 'two', para: { section: { kind: 'continuous', page: { ...newDocument().page, ...LAND } } } }]);
    const s = screenText(changeSection(t, 0, { lines: { start: 1, countBy: 1, restart: 'page' } }), { kind: 'draft' });
    expect(sectionsOf(s)).toHaveLength(1);
    expect(s.lineNumbers).toBeUndefined();
    expect(breaksIn(t)).toEqual([{ para: 1, kind: 'continuous' }]);
  });
});

describe('line numbers', () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `line ${i}`);

  it('numbers every line of text at the left of the margin, starting again on each page', () => {
    const t = changeSection(docOf(long(80)), 0, { lines: { start: 1, countBy: 1, restart: 'page' } });
    const lay = layouter().layout(t);
    expect(lay.pages.length).toBeGreaterThan(1);
    const first = lay.lineNums.filter((n) => n.page === 0), second = lay.lineNums.filter((n) => n.page === 1);
    expect(first[0].text).toBe('1');
    expect(first.map((n) => n.text)).toEqual(first.map((_, i) => String(i + 1)));
    expect(second[0].text).toBe('1');
    // right-aligned a quarter inch left of the text, on each line's baseline
    const w = measure('1', 11, 'Times New Roman', '');
    expect(first[0].x + w).toBeCloseTo(INCH - 18, 0);
    expect(first[0].y).toBeCloseTo(lay.text.lines[0].y);
  });

  it('counts on across pages, shows every nth, starts where asked and skips paragraphs that turn them off', () => {
    const paras: (string | { text: string; para?: ParaStyle })[] = long(70);
    paras[2] = { text: 'no number', para: { noLineNumbers: true } };
    const t = changeSection(docOf(paras), 0, { lines: { start: 1, countBy: 5, restart: 'continuous', distance: 9 } });
    const lay = layouter().layout(t);
    const shown = lay.lineNums.map((n) => Number(n.text));
    expect(shown.slice(0, 3)).toEqual([5, 10, 15]);
    expect(shown.every((n) => n % 5 === 0)).toBe(true);
    // 69 numbered lines (one paragraph left out), carried on over the page
    expect(shown[shown.length - 1]).toBe(65);
    // the fifth number is on the sixth line (the third is not counted)
    expect(lay.lineNums[0].y).toBeCloseTo(lay.text.lines[5].y);
    const from10 = layouter().layout(changeSection(docOf(long(3)), 0, { lines: { start: 10, countBy: 1, restart: 'page' } }));
    expect(from10.lineNums.map((n) => n.text)).toEqual(['10', '11', '12']);
  });

  it('numbers only the sections that have them, starting again in each section when asked', () => {
    const L = { start: 1, countBy: 1, restart: 'section' as const };
    const t = docOf(['front', 'matter', { text: 'a', para: { section: { kind: 'continuous', lines: L } } }, 'b', { text: 'c', para: { section: { kind: 'continuous', lines: L } } }]);
    const lay = layouter().layout(t);
    expect(lay.lineNums.map((n) => n.text)).toEqual(['1', '2', '1']);
    expect(lay.lineNums[0].y).toBeCloseTo(lay.text.lines[2].y);
  });
});

// ---------------------------------------------------------------- Word files

/** Text as bytes the zip library takes (its own kind of byte array). */
const u8 = (str: string): Uint8Array => { const b = strToU8(str); const out = new Uint8Array(b.length); out.set(b); return out; };

const parts = (bytes: Uint8Array): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(unzipSync(bytes))) if (/\.(xml|rels)$/.test(k)) out[k] = strFromU8(v);
  return out;
};

/** A thesis-like document: roman front matter, a landscape table section, a two-column continuous section, line numbers. */
function thesis(): DocText {
  let t = docOf(['Title page', 'Abstract', { text: 'Introduction', para: { section: { kind: 'nextPage', page: newDocument().page, restart: 1 } } }, { text: 'wide', para: { section: { kind: 'nextPage', page: { ...newDocument().page, ...LAND } } } }, { text: words(30), para: { section: { kind: 'continuous', page: { ...newDocument().page, ...LAND, cols: 2 }, lines: { start: 5, countBy: 2, restart: 'section', distance: 9 } } } }, { text: 'no number', para: { noLineNumbers: true } }]);
  t = { ...t, hf: { ...t.hf, footer: ['', '', ''], numbers: 'footer-center', onFirst: false } };
  t = changeSection(t, 0, { format: 'lowerRoman' });
  t = changeSection(t, 1, { hf: { ...t.hf, header: ['Chapter 1', '', ''], onFirst: true } });
  return t;
}

describe('sections in Word files', () => {
  it('writes each section\'s properties in its last paragraph, the last section\'s in the body', async () => {
    const p = parts(await writeDocx(thesis(), deps));
    const body = p['word/document.xml'];
    const sects = body.match(/<w:sectPr>.*?<\/w:sectPr>/g)!;
    expect(sects).toHaveLength(4);
    // the first: roman numbers from i, no number on its first page
    expect(sects[0]).toContain('<w:pgNumType w:fmt="lowerRoman" w:start="1"/>');
    expect(sects[0]).toContain('<w:titlePg/>');
    // the second: its own header, numbers from 1
    expect(sects[1]).toContain('<w:pgNumType w:start="1"/>');
    expect(sects[1]).toMatch(/<w:headerReference w:type="default" r:id="[^"]+"\/>/);
    expect(sects[1]).not.toContain('<w:titlePg/>');
    // the third: landscape, linked to the one before (no header or footer of its own), numbers carrying on
    expect(sects[2]).toContain('w:orient="landscape"');
    expect(sects[2]).not.toContain('Reference');
    expect(sects[2]).not.toContain('pgNumType');
    // the last: continuous, two columns, line numbers from 5 (Word counts from 0) by 2, a little from the text
    expect(sects[3]).toContain('<w:type w:val="continuous"/>');
    expect(sects[3]).toContain('<w:cols w:num="2"');
    expect(sects[3]).toContain('<w:lnNumType w:countBy="2" w:start="4" w:distance="180" w:restart="newSection"/>');
    expect(body).toContain('<w:suppressLineNumbers/>');
    // section properties end a paragraph's properties
    expect(body).toMatch(/<w:p><w:pPr>(<[^>]+>)*<w:sectPr>/);
    expect(body.indexOf('</w:sectPr></w:pPr>')).toBeGreaterThan(0);
    // header1 is the first section's (empty: none), the second has one of its own
    expect(Object.keys(p).filter((k) => /word\/header\d/.test(k))).toEqual(['word/header1.xml']);
    expect(p['word/header1.xml']).toContain('>Chapter 1</w:t>');
  });

  it('opens its own files with the same sections', async () => {
    const t = thesis();
    const { doc, warnings } = await readDocx(await writeDocx(t, deps));
    expect(warnings).toEqual([]);
    const a = sectionsOf(t), b = sectionsOf(doc);
    expect(b.map((s) => [s.first, s.kind, s.linked, s.restart, s.format])).toEqual(a.map((s) => [s.first, s.kind, s.linked, s.restart, s.format]));
    expect(b.map((s) => [s.page.w, s.page.h, s.page.cols ?? 1])).toEqual(a.map((s) => [s.page.w, s.page.h, s.page.cols ?? 1]));
    expect(b[1].hf.header[0]).toBe('Chapter 1');
    expect(b[2].hf.header[0]).toBe('Chapter 1');
    expect(b[0].hf.onFirst).toBe(false);
    expect(b[3].lines).toEqual(a[3].lines);
    expect(doc.paras[5].noLineNumbers).toBe(true);
    expect(layouter().layout(doc).pages.map((p) => p.number)).toEqual(layouter().layout(t).pages.map((p) => p.number));
  });

  it('keeps a section ending with a table: the empty paragraph Word needs after it holds the break', async () => {
    const t = docOf(['before', 'x', { text: 'after', para: { section: { kind: 'nextPage', page: { ...newDocument().page, ...LAND } } } }]);
    t.objects[1] = { kind: 'table', table: { cols: [100, 100], head: 0, lines: 'grid', rows: [[{ runs: [{ text: 'a' }] }, { runs: [{ text: 'b' }] }]] } };
    t.runs = [{ ...t.runs[0] }, { ...t.runs[1], text: '￼', obj: 1 }, { ...t.runs[1], text: '\n' }, t.runs[2]];
    const p = parts(await writeDocx(t, deps));
    expect(p['word/document.xml']).toMatch(/<\/w:tbl><w:p><w:pPr><w:sectPr>/);
    const { doc } = await readDocx(await writeDocx(t, deps));
    expect(sectionsOf(doc).map((s) => [s.first, s.page.w])).toEqual([[0, 612], [2, 792]]);
  });

  it('reads a Word file\'s sections: footer linked to the one before, header its own, line numbers', async () => {
    const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
    const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
    const hdr = (text: string) => `<?xml version="1.0"?><w:hdr ${W}><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:hdr>`;
    const ftr = `<?xml version="1.0"?><w:ftr ${W}><w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:ftr>`;
    const doc = `<?xml version="1.0"?><w:document ${W}><w:body>` +
      '<w:p><w:r><w:t>Front</w:t></w:r></w:p>' +
      '<w:p><w:pPr><w:sectPr><w:headerReference w:type="default" r:id="rH1"/><w:footerReference w:type="default" r:id="rF1"/><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:pgNumType w:fmt="lowerRoman"/></w:sectPr></w:pPr><w:r><w:t>Matter</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>Body</w:t></w:r></w:p>' +
      '<w:sectPr><w:headerReference w:type="default" r:id="rH2"/><w:type w:val="oddPage"/><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:lnNumType w:countBy="1"/><w:pgNumType w:start="1"/></w:sectPr>' +
      '</w:body></w:document>';
    const rels = [['rH1', 'header', 'header1.xml'], ['rH2', 'header', 'header2.xml'], ['rF1', 'footer', 'footer1.xml']];
    const files: Record<string, Uint8Array> = {
      '[Content_Types].xml': u8('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/></Types>'),
      '_rels/.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}officeDocument" Target="word/document.xml"/></Relationships>`),
      'word/_rels/document.xml.rels': u8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels.map(([id, type, target]) => `<Relationship Id="${id}" Type="${R}${type}" Target="${target}"/>`).join('')}</Relationships>`),
      'word/document.xml': u8(doc),
      'word/header1.xml': u8(hdr('Front matter')),
      'word/header2.xml': u8(hdr('Results')),
      'word/footer1.xml': u8(ftr),
    };
    const { doc: d, warnings } = await readDocx(zipSync(files));
    expect(warnings).toEqual([]);
    const secs = sectionsOf(d);
    expect(secs.map((s) => [s.first, s.kind])).toEqual([[0, 'nextPage'], [2, 'oddPage']]);
    expect(secs[0].format).toBe('lowerRoman');
    expect(secs[0].hf.header[0]).toBe('Front matter');
    expect(secs[0].hf.numbers).toBe('footer-center');
    expect(secs[1].hf.header[0]).toBe('Results');
    // the footer (with its page number) carries on from the section before
    expect(secs[1].hf.numbers).toBe('footer-center');
    expect(secs[1].page.w).toBe(792);
    expect(secs[1].restart).toBe(1);
    expect(secs[1].lines).toEqual({ start: 1, countBy: 1, restart: 'page' });
    // the Odd Page section starts again at 1, an odd page, so no blank page is put before it
    expect(layouter().layout(d).pages.map((p) => p.number)).toEqual(['i', '1']);
  });
});
