// @vitest-environment jsdom
//
// The table of contents: the headings listed with the pages they are on (worked out again when a
// heading moves to another page), dots up to each page number, saved to Word as Word's own TOC
// field, and opened here again live.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { EMPTY_TOC, tocEntries, tocText } from '../src/document/toc';
import type { ParaStyle, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) });

/** The contents, then sections (Heading 1 and 2) with `fill` paragraphs of text under each. */
function sample(fill = 1, levels = 3): DocText {
  const d = newDocument();
  const n = runStyleOf(d.styles.Normal), h1 = runStyleOf(d.styles.Heading1), h2 = runStyleOf(d.styles.Heading2);
  d.objects = { 1: { kind: 'toc', levels } };
  const runs: TextRun[] = [objectRun(1, n)];
  const paras: ParaStyle[] = [paraFromStyle(d.styles.Normal, {})];
  const add = (text: string, look: typeof n, style: 'Normal' | 'Heading1' | 'Heading2') => {
    runs.push({ ...look, text: '\n' + text });
    paras.push(paraFromStyle(d.styles[style], {}));
  };
  const body = 'The crude product was purified by flash chromatography on silica gel to give the title compound as a white solid. '.repeat(4);
  for (const [i, title] of ['General Information', 'Synthesis of Compounds', 'NMR Spectra'].entries()) {
    add(title, h1, 'Heading1');
    if (i === 1) add('Ketone 3', h2, 'Heading2');
    for (let k = 0; k < fill; k++) add(body, n, 'Normal');
  }
  d.runs = runs;
  d.paras = paras;
  return d;
}

const tocLinesOf = (lay: ReturnType<DocLayouter['layout']>) => lay.text.lines.filter((l) => l.block === 1);
const shown = (l: { pieces: { text: string; obj?: number }[] }) => l.pieces.filter((p) => p.obj === undefined).map((p) => p.text).join('');

describe('table of contents', () => {
  it('lists the headings down to the depth chosen', () => {
    expect(tocEntries(sample()).map((e) => [e.level, e.text])).toEqual([[1, 'General Information'], [1, 'Synthesis of Compounds'], [2, 'Ketone 3'], [1, 'NMR Spectra']]);
    expect(tocEntries(sample(), 1).map((e) => e.text)).toEqual(['General Information', 'Synthesis of Compounds', 'NMR Spectra']);
    expect(tocText(tocEntries(sample()).slice(0, 1), () => 'S2')).toBe('General Information\tS2');
  });

  it('shows each heading with dots up to its page number at the right', () => {
    const lay = layouter().layout(sample());
    const lines = tocLinesOf(lay);
    expect(lines).toHaveLength(4);
    expect(shown(lines[0])).toMatch(/^General Information\. \.( \.)* *1$/);
    // the numbers end at the right margin
    const right = lay.pageW - 72;
    for (const l of lines) {
      const last = l.pieces[l.pieces.length - 1];
      expect(last.x + last.w).toBeCloseTo(right, 3);
    }
    // the level 2 heading is indented
    expect(lines[2].x).toBeGreaterThan(lines[1].x);
  });

  it('follows headings onto later pages (laid out again until the numbers settle)', () => {
    const lay = layouter().layout(sample(12));
    expect(lay.pages.length).toBeGreaterThan(3);
    const pageOfPara = (p: number) => String(lay.paraTops[p].page + 1);
    const heads = tocEntries(sample(12));
    tocLinesOf(lay).forEach((l, i) => expect(shown(l).endsWith(pageOfPara(heads[i].para))).toBe(true));
    expect(shown(tocLinesOf(lay)[3])).not.toMatch(/ 1$/);
    // page numbers with a prefix (S1, S2…) as the footer shows them
    const d = sample(12);
    d.hf = { ...d.hf, prefix: 'S' };
    expect(shown(tocLinesOf(layouter().layout(d))[3])).toMatch(/S\d+$/);
  });

  it('says what to do when there are no headings', () => {
    const d = newDocument();
    d.objects = { 1: { kind: 'toc', levels: 3 } };
    d.runs = [objectRun(1, runStyleOf(d.styles.Normal))];
    const lay = layouter().layout(d);
    expect(tocLinesOf(lay).map(shown).join(' ')).toContain(EMPTY_TOC.slice(0, 30));
  });

  it('saves as Word\'s TOC field with the page numbers shown here, and opens as contents again', async () => {
    const d = sample(12, 2);
    const lay = layouter().layout(d);
    const pages = lay.paraTops.map((pt) => lay.pages[pt.page].label);
    const bytes = await writeDocx(d, { ...deps, pages: () => pages });
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    expect(body).toContain('<w:instrText xml:space="preserve"> TOC \\o "1-2" \\h \\z \\u </w:instrText>');
    expect(body).toContain('<w:tab w:val="right" w:leader="dot"');
    expect(body).not.toContain('w:dirty');
    const nmr = tocEntries(d).find((e) => e.text === 'NMR Spectra')!;
    expect(body).toContain(`NMR Spectra</w:t></w:r><w:r><w:tab/><w:t xml:space="preserve">${pages[nmr.para]}</w:t>`);
    expect(strFromU8(files['word/styles.xml'])).toContain('<w:name w:val="toc 1"/>');
    const back = await readDocx(bytes);
    const tocs = Object.values(back.doc.objects).filter((o) => o.kind === 'toc');
    expect(tocs).toEqual([{ kind: 'toc', levels: 2 }]);
    // Word's lines of the contents are not kept as text as well
    expect(back.doc.runs.map((r) => r.text).join('')).not.toContain('Ketone 3\t');
    expect(back.doc.runs.map((r) => r.text).join('').match(/NMR Spectra/g)).toHaveLength(1);
    expect(back.warnings.join(' ')).not.toMatch(/contents/i);
  });

  it('asks Word to fill in the numbers when it has none from here', async () => {
    const body = strFromU8(unzipSync(await writeDocx(sample(), deps))['word/document.xml']);
    expect(body).toContain('w:fldCharType="begin" w:dirty="true"');
  });
});
