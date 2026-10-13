// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import * as rt from '../src/richtext';
import { renderRuns, readRuns, offsetOf, pointAt } from '../src/ui/caption-editor';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Doc } from '../src/model';

const runs = (...rs: [string, rt.RunStyle?][]) => rs.map(([text, s]) => ({ ...s, text }));

describe('styled text', () => {
  it('joins runs that look the same and drops empty ones', () => {
    expect(rt.normalizeRuns(runs(['a', { bold: true }], ['', {}], ['b', { bold: true, italic: false }], ['c']))).toEqual(runs(['ab', { bold: true }], ['c']));
  });
  it('makes part of the text bold, and back again', () => {
    let r = runs(['Hello world']);
    r = rt.toggleStyle(r, 6, 11, 'bold');
    expect(r).toEqual(runs(['Hello '], ['world', { bold: true }]));
    r = rt.toggleStyle(r, 0, 11, 'bold'); // not all bold yet, so all become bold
    expect(r).toEqual(runs(['Hello world', { bold: true }]));
    r = rt.toggleStyle(r, 0, 5, 'bold');
    expect(r).toEqual(runs(['Hello'], [' world', { bold: true }]));
  });
  it('keeps only one of subscript, superscript and formula', () => {
    let r = runs(['CH3', { formula: true }]);
    r = rt.toggleStyle(r, 0, 3, 'sup');
    expect(r).toEqual(runs(['CH3', { sup: true }]));
    r = rt.toggleStyle(r, 2, 3, 'sub');
    expect(r).toEqual(runs(['CH', { sup: true }], ['3', { sub: true }]));
  });
  it('types in the style of the character before the caret', () => {
    const r = runs(['a', { italic: true }], ['b']);
    expect(rt.typingStyle(r, 1, 1, {})).toEqual({ italic: true });
    expect(rt.typingStyle(r, 0, 0, {})).toEqual({ italic: true });
    expect(rt.typingStyle(r, 2, 2, {})).toEqual({});
    expect(rt.typingStyle([], 0, 0, { size: 6, formula: true })).toEqual({ size: 6, formula: true });
    // at the start of a new line, take the style of what follows
    expect(rt.typingStyle(runs(['x\n'], ['y', { bold: true }]), 2, 2, {})).toEqual({ bold: true });
  });
  it('inserts and deletes text', () => {
    let r = runs(['ab', { bold: true }], ['cd']);
    r = rt.insertText(r, 2, 'X', { bold: true });
    expect(r).toEqual(runs(['abX', { bold: true }], ['cd']));
    r = rt.deleteRange(r, 1, 4);
    expect(r).toEqual(runs(['a', { bold: true }], ['d']));
    expect(rt.plainText(rt.replaceRange(r, 0, 2, runs(['new'])))).toBe('new');
  });
  it('reports the style a whole selection shares', () => {
    const r = runs(['ab', { bold: true, size: 10 }], ['cd', { bold: true, size: 12 }]);
    expect(rt.commonStyle(r, 0, 4)).toEqual({ bold: true });
    expect(rt.commonStyle(r, 2, 4)).toEqual({ bold: true, size: 12 });
  });
  it('sets size and colour on part of the text', () => {
    const r = rt.applyStyle(runs(['abc', { size: 10 }]), 1, 2, { size: 14, color: '#ff0000' });
    expect(r).toEqual(runs(['a', { size: 10 }], ['b', { size: 14, color: '#ff0000' }], ['c', { size: 10 }]));
  });
  it('converts ChemDraw face numbers', () => {
    expect(rt.styleFromFace(96)).toEqual({ formula: true });
    expect(rt.styleFromFace(99)).toEqual({ bold: true, italic: true, formula: true });
    expect(rt.styleFromFace(32)).toEqual({ sub: true });
    expect(rt.faceFromStyle({ italic: true, formula: true })).toBe(98);
  });
});

describe('formula style', () => {
  const show = (t: string) => rt.formulaParts(t).map((p) => (p.pos === 'sub' ? `_${p.text}` : p.pos === 'sup' ? `^${p.text}` : p.text)).join('');
  it('puts numbers after letters and brackets down', () => {
    expect(show('CH3CH2OH')).toBe('CH_3CH_2OH');
    expect(show('Pd(PPh3)4')).toBe('Pd(PPh_3)_4');
    expect(show('Cs2CO3, DMF')).toBe('Cs_2CO_3, DMF');
  });
  it('leaves numbers with a space before them alone', () => {
    expect(show('Acetone, 50 °C, 24 h')).toBe('Acetone, 50 °C, 24 h');
    expect(show('THF, -78 °C')).toBe('THF, -78 °C');
    expect(show('4Å MS')).toBe('4Å MS');
  });
  it('puts charges up and the atom counts before them down', () => {
    expect(show('Cl-')).toBe('Cl^-');
    expect(show('NH4+')).toBe('NH_4^+');
    expect(show('PhSO3-')).toBe('PhSO_3^-');
    expect(show('B(OR)3-')).toBe('B(OR)_3^-');
    expect(show('BF4−, PF6−')).toBe('BF_4^−, PF_6^−');
    expect(show('[Fe(CN)6]3-, K+ salt')).toBe('[Fe(CN)_6]^3-, K^+ salt');
    // an ion's charge number has to be put up by hand
    expect(show('Fe3+')).toBe('Fe_3^+');
  });
  it('keeps hyphens inside names', () => {
    expect(show('n-BuLi')).toBe('n-BuLi');
    expect(show('CH2-CH2')).toBe('CH_2-CH_2');
  });
});

describe('Symbol font', () => {
  it('reads Greek letters and arrows', () => {
    expect(rt.fromSymbolFont('abgD')).toBe('αβγΔ');
    expect(rt.fromSymbolFont('®')).toBe('→');
  });
  it('writes characters an ordinary font cannot hold in the Symbol font', () => {
    expect(rt.toSymbolPieces('α-pinene, 25 °C → rt')).toEqual([
      { text: 'a', symbol: true }, { text: '-pinene, 25 °C ', symbol: false }, { text: '®', symbol: true }, { text: ' rt', symbol: false },
    ]);
    expect(rt.toSymbolPieces('–—•')).toEqual([{ text: '–—•', symbol: false }]);
  });
  it('round-trips a Greek caption through a saved file', () => {
    const doc = new Doc();
    doc.bulk(() => doc.addCaption({ x: 10, y: 10, runs: [{ text: 'β-lactam, Δ', italic: true }], justify: 'left' }));
    const xml = writeCdxml(doc);
    expect(xml).toMatch(/name="Symbol"/);
    expect(xml).toMatch(/charset="Unknown"/);
    const back = readCdxml(xml).doc;
    expect(rt.plainText([...back.captions.values()][0].runs)).toBe('β-lactam, Δ');
  });
  it('counts line ends in the text as stored, with arrows written in the Symbol font', () => {
    const doc = new Doc();
    doc.bulk(() => doc.addCaption({ x: 0, y: 0, runs: [{ text: '0 °C → rt\n81%' }], justify: 'left' }));
    const xml = writeCdxml(doc);
    // "0 °C ® rt\n" is 12 bytes as UTF-8 (° and ® take two each)
    expect(xml).toMatch(/LineStarts="12 15"/);
    expect(rt.plainText([...readCdxml(xml).doc.captions.values()][0].runs)).toBe('0 °C → rt\n81%');
  });
  it('keeps the document’s caption style', () => {
    const doc = new Doc();
    doc.style.captionFace = 1;
    doc.bulk(() => doc.addCaption({ x: 0, y: 0, runs: [{ text: 'x' }], justify: 'left' }));
    expect(readCdxml(writeCdxml(doc)).doc.style.captionFace).toBe(1);
  });
});

describe('caption text box', () => {
  const box = () => document.createElement('div');
  it('shows runs and reads them back unchanged', () => {
    const r = runs(['CH3', { formula: true, size: 10 }], [' then\n', {}], ['x', { sup: true, bold: true }], ['\n']);
    const b = box();
    renderRuns(b, r, 2, 10);
    expect(readRuns(b, {})).toEqual(rt.normalizeRuns(r));
    // the formula's 3 is shown smaller
    const three = [...b.querySelectorAll('span')].find((s) => s.textContent === '3')!;
    expect(three.style.fontSize).toBe('15px');
  });
  it('counts places in the text the same both ways', () => {
    const r = runs(['ab', { bold: true }], ['c\nd'], ['\n']);
    const b = box();
    renderRuns(b, r, 1, 10);
    for (let i = 0; i <= 6; i++) {
      const p = pointAt(b, i);
      expect(offsetOf(b, p.node, p.offset)).toBe(i);
    }
  });
  it('picks up text the browser typed outside the styled pieces', () => {
    const b = box();
    renderRuns(b, runs(['ab', { italic: true }]), 1, 10);
    b.appendChild(document.createTextNode('c'));
    expect(readRuns(b, {})).toEqual(runs(['abc', { italic: true }]));
  });
});
