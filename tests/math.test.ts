// @vitest-environment jsdom
//
// Equations: LaTeX read into a tree, laid out as maths (fractions stacked, scripts raised and
// lowered, letters italic and numbers upright), placed in the text on the baseline, saved to Word
// as Office Math and read back as the same LaTeX.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { layoutMath, mathText, ommlToTex, parseMath, toOmml, type MathBox } from '../src/document/math';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { newDocument, objectRun, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { EXAMPLES } from '../src/ui/equation-dialog';

const measure = (t: string, s: number) => [...t].length * s * 0.5;
const lay = (tex: string, size = 12) => layoutMath(tex, size, 'serif', measure);
const texts = (b: MathBox) => b.items.filter((i) => i.k === 'text').map((i) => (i.k === 'text' ? i : null)!);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const M_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/math';
const ommlEl = (inner: string) => new DOMParser().parseFromString(`<m:oMath xmlns:m="${M_NS}">${inner}</m:oMath>`, 'application/xml').documentElement;
/** LaTeX → Word's equation → LaTeX. */
const roundTrip = (tex: string) => ommlToTex(ommlEl(toOmml(tex)));

describe('reading LaTeX', () => {
  it('reads fractions, scripts, roots and brackets', () => {
    expect(parseMath('\\frac{a}{b}')).toEqual({ t: 'frac', num: { t: 'sym', s: 'a', style: 'it' }, den: { t: 'sym', s: 'b', style: 'it' } });
    expect(parseMath('x_1^2')).toMatchObject({ t: 'scr', base: { s: 'x' }, sub: { s: '1' }, sup: { s: '2' } });
    expect(parseMath('k_{obs}')).toMatchObject({ t: 'scr', sub: { t: 'row' } });
    expect(parseMath('\\sqrt[3]{x}')).toMatchObject({ t: 'sqrt', index: { s: '3' }, body: { s: 'x' } });
    expect(parseMath('\\left[ A \\right]')).toMatchObject({ t: 'delim', open: '[', close: ']' });
  });

  it('sets letters in italic, and numbers, functions, Greek capitals and \\mathrm upright', () => {
    const syms = (tex: string) => {
      const n = parseMath(tex);
      return (n.t === 'row' ? n.kids : [n]).map((k) => (k.t === 'sym' ? `${k.s}:${k.style}` : k.t));
    };
    expect(syms('2x + 1.25')).toEqual(['2:up', 'x:it', '+:op', '1.25:up']);
    expect(syms('\\ln K')).toEqual(['ln:up', 'K:it']);
    expect(syms('\\Delta G')).toEqual(['Δ:up', 'G:it']);
    expect(syms('\\alpha')).toEqual(['α:it']);
    expect(syms('\\mathrm{Pd}')).toEqual(['Pd:up']);
    expect(syms('\\text{yield (%)}')).toEqual(['yield (%):text']);
  });

  it('never fails: what it does not know is shown as typed', () => {
    expect(mathText('\\foo{x}')).toContain('\\foo');
    expect(() => parseMath('\\frac{a')).not.toThrow();
    expect(() => parseMath('}}^_')).not.toThrow();
    expect(mathText('a } b')).toBe('a}b');
  });

  it('reads every example the equation window offers', () => {
    for (const ex of EXAMPLES) expect(mathText(ex.tex)).not.toMatch(/\\[A-Za-z]/);
  });
});

describe('laying out', () => {
  it('stacks a fraction over its bar, centred on the axis', () => {
    const b = lay('\\frac{a}{b}');
    const [a, d] = texts(b);
    expect(a.y).toBeLessThan(0);
    expect(d.y).toBeGreaterThan(a.y);
    expect(b.ascent).toBeGreaterThan(12 * 0.72);
    expect(b.descent).toBeGreaterThan(12 * 0.22);
    const bar = b.items.find((i) => i.k === 'path');
    expect(bar).toBeDefined();
  });

  it('raises superscripts and lowers subscripts, smaller', () => {
    const [x, sup, sub] = texts(lay('x_1^2'));
    expect(sup.y).toBeLessThan(x.y);
    expect(sub.y).toBeGreaterThan(x.y);
    expect(sup.size).toBeLessThan(x.size);
    expect(sup.x).toBeGreaterThan(x.x);
    expect(sup.x).toBeCloseTo(sub.x, 5);
  });

  it('puts space round operators but not round a sign at the start', () => {
    const plus = lay('a+b').w, together = lay('ab').w;
    expect(plus - together).toBeGreaterThan(measure('+', 12) + 0.3 * 12);
    const minus = texts(lay('-a'));
    expect(minus[1].x - minus[0].x).toBeCloseTo(measure('−', 12), 5);
  });

  it('grows brackets and roots to fit what is in them', () => {
    const small = lay('\\left(x\\right)'), tall = lay('\\left(\\frac{a}{b}\\right)');
    expect(tall.ascent + tall.descent).toBeGreaterThan(small.ascent + small.descent);
    const root = lay('\\sqrt{\\frac{a}{b}}');
    expect(root.ascent).toBeGreaterThan(lay('\\frac{a}{b}').ascent);
  });

  it('makes an arrow long enough for the conditions over it', () => {
    expect(lay('\\xrightarrow{\\text{Pd(PPh3)4, K2CO3}}').w).toBeGreaterThan(lay('\\xrightarrow{}').w);
  });
});

describe('Word equations (Office Math)', () => {
  it('writes the parts as Word has them', () => {
    expect(toOmml('\\frac{a}{b}')).toBe('<m:f><m:num><m:r><m:t xml:space="preserve">a</m:t></m:r></m:num><m:den><m:r><m:t xml:space="preserve">b</m:t></m:r></m:den></m:f>');
    expect(toOmml('x^2')).toContain('<m:sSup><m:e>');
    expect(toOmml('\\sqrt{x}')).toContain('<m:degHide m:val="1"/>');
    expect(toOmml('\\sum_{i}^{n} x')).toMatch(/<m:nary><m:naryPr><m:chr m:val="∑"\/><m:limLoc m:val="undOvr"\/><\/m:naryPr><m:sub>.*<\/m:sub><m:sup>.*<\/m:sup><m:e>.*x.*<\/m:e><\/m:nary>/);
    expect(toOmml('\\mathrm{Pd}')).toBe('<m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t xml:space="preserve">Pd</m:t></m:r>');
    expect(toOmml('\\text{mol}')).toContain('<m:nor/>');
    expect(toOmml('a<b')).toContain('&lt;');
  });

  it('reads them back as the same LaTeX', () => {
    for (const tex of ['\\frac{a}{b}', 'x_{1}^{2}', '\\sqrt{x}', '\\sqrt[3]{x}', '\\left(a+b\\right)', '\\Delta G=\\Delta H-T\\Delta S', '\\mathrm{Pd}', '\\bar{x}', '\\hat{H}', '\\xrightarrow{h\\nu}', '\\xrightarrow[\\text{rt}]{\\text{cat.}}']) {
      expect(mathText(roundTrip(tex))).toBe(mathText(tex));
    }
    for (const ex of EXAMPLES) expect(mathText(roundTrip(ex.tex))).toBe(mathText(ex.tex));
  });

  it('reads Word\'s own equations', () => {
    // as Word writes E = mc² and a function
    const word = '<m:r><w:rPr xmlns:w="w"/><m:t>E</m:t></m:r><m:r><m:t>=</m:t></m:r><m:sSup><m:sSupPr><m:ctrlPr/></m:sSupPr><m:e><m:r><m:t>mc</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>';
    // Word keeps mc together in one run: squared as a pair
    expect(ommlToTex(ommlEl(word))).toBe('E={mc}^2');
    const fn = '<m:func><m:fName><m:r><m:rPr><m:sty m:val="p"/></m:rPr><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>θ</m:t></m:r></m:e></m:func>';
    expect(ommlToTex(ommlEl(fn))).toBe('\\sin \\theta');
  });
});

describe('equations in documents', () => {
  function sample(display: boolean): DocText {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    d.objects = { 1: { kind: 'math', tex: 'k = A\\exp\\left(-\\frac{E_{a}}{RT}\\right)' } };
    d.runs = display ? [{ ...n, text: 'The rate follows\n' }, objectRun(1, n), { ...n, text: '\nas expected.' }] : [{ ...n, text: 'where ' }, objectRun(1, n), { ...n, text: ' is the rate.' }];
    d.paras = display ? [paraFromStyle(d.styles.Normal, {}), { ...paraFromStyle(d.styles.Normal, {}), align: 'center' as const }, paraFromStyle(d.styles.Normal, {})] : [paraFromStyle(d.styles.Normal, {})];
    return d;
  }

  it('sits in the line on the baseline, taller than the text round it', () => {
    const layout = new DocLayouter({ measure: (t, s) => t.length * s * 0.5, drawingSize: () => ({ w: 10, h: 10 }) }).layout(sample(false));
    const m = layout.maths.get(1)!;
    expect(m).toBeDefined();
    const o = layout.objects.find((x) => x.id === 1)!;
    const line = layout.text.lines[o.line];
    // its baseline is the line's
    expect(o.y + m.ascent).toBeCloseTo(line.y, 5);
    expect(o.h).toBeCloseTo(m.ascent + m.descent, 5);
    expect(line.ascent).toBeGreaterThanOrEqual(m.ascent - 1e-6);
  });

  it('saves as a Word equation (an equation paragraph when on its own line) and opens again', async () => {
    for (const display of [false, true]) {
      const d = sample(display);
      const bytes = await writeDocx(d, deps);
      const body = strFromU8(unzipSync(bytes)['word/document.xml']);
      expect(body).toContain(`xmlns:m="${M_NS}"`);
      expect(body).toContain('<m:oMath><m:sSub>'.slice(0, 10));
      expect(body.includes('<m:oMathPara>')).toBe(display);
      const back = await readDocx(bytes);
      const maths = Object.values(back.doc.objects).filter((o) => o.kind === 'math');
      expect(maths).toHaveLength(1);
      expect(mathText((maths[0] as { tex: string }).tex)).toBe(mathText(d.objects[1].kind === 'math' ? d.objects[1].tex : ''));
      expect(back.warnings.join(' ')).not.toMatch(/quation/);
      if (display) expect(back.doc.paras[1].align).toBe('center');
    }
  });
});
