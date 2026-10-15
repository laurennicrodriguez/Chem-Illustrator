// @vitest-environment jsdom
//
// Table of contents page numbers: the page's own number, whether or not it is shown on the page.

import { describe, it, expect } from 'vitest';
import { DocLayouter } from '../src/document/doc-layout';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import type { ParaStyle, TextRun } from '../src/model';

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
describe('toc page labels', () => {
  it('shows the prefixed page number for headings on a first page whose number is hidden', () => {
    const d = sample(3);
    d.hf = { ...d.hf, prefix: 'S', onFirst: false };
    const lay = layouter().layout(d);
    const got = tocLinesOf(lay).map((l) => shown(l).replace(/[. ]+/g, ' '));
    // "General Information" is on the first page, which is page S1
    expect(got[0]).toMatch(/S1$/);
  });
  it('numbers from the starting number when page numbers are not shown', () => {
    const d = sample(3);
    d.hf = { ...d.hf, numbers: 'none', start: 5 };
    const got = tocLinesOf(layouter().layout(d)).map((l) => shown(l).replace(/[. ]+/g, ' '));
    expect(got[0]).toMatch(/5$/);
  });
});
