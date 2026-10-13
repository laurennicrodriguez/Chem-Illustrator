// Chemistry in text: the cases are those of SI Assistant's tests (test_text_checks.py).
import { describe, it, expect } from 'vitest';
import { findIssues, isFormula, formulaDigits, typingFormats, replacementAt, DEFAULT_REPLACEMENTS, type CharLook } from '../src/text/chemtext';
import { TextEditing } from '../src/text/editing';
import { afterTyping, DEFAULT_TYPING } from '../src/text/typing';
import { arialWidth } from '../src/text-metrics';

const plain = (): CharLook => ({ pos: 'base', italic: false });
const kinds = (text: string, look: (i: number) => CharLook = plain) => findIssues(text, look).map((i) => [i.kind, text.slice(i.start, i.end), i.fixed]);

describe('the chemistry formatting check', () => {
  it.each([
    ['with PdCl2 (5 mol %)', [['formula', 'PdCl2', 'PdCl₂']]],
    ['in CH2Cl2', [['formula', 'CH2Cl2', 'CH₂Cl₂']]],
    ['under N2', [['formula', 'N2', 'N₂']]],
    ['Pd(PPh3)4', [['formula', 'Pd(PPh3)4', 'Pd(PPh₃)₄']]],
    ['in CDCl3', [['solvent', 'CDCl3', 'CDCl₃']]],
    ['in DMSO-d6', [['solvent', 'DMSO-d6', 'DMSO-d₆']]],
    ['1.2mmol', [['unit', '1.2mmol', '1.2 mmol']]],
    ['J = 8.0Hz', [['unit', '8.0Hz', '8.0 Hz']]],
    ['at 25°C', [['unit', '25°C', '25 °C']]],
    ['5mol% catalyst', [['unit', '5mol%', '5 mol %']]],
    ['1.5g and 1M HCl', [['unit', '1.5g', '1.5 g'], ['unit', '1M', '1 M']]],
    ['δ 7.36-7.29 (m)', [['range', '7.36-7.29', '7.36–7.29']]],
    ['1H NMR and 13C NMR', [['nucleus', '1H', '¹H'], ['nucleus', '13C', '¹³C']]],
  ])('finds %s', (text, expected) => {
    expect(kinds(text)).toEqual(expected);
  });
  it.each([
    'Table S1 and Figure S2, C18 column, SN2 and E2 reactions, TS1, IC50',
    'compound 3a and 3g, 12h, (m, 2H), 2-methylfuran, 92% yield, THF, 25 °C, 1.2 mmol',
    'see https://doi.org/10.1021/acs.orglett.0c01234-5 for details',
    '7.36–7.29 (en dash already)',
  ])('leaves alone %s', (text) => {
    expect(kinds(text)).toEqual([]);
  });
  it('does not flag text already formatted', () => {
    const text = 'PdCl2 in DMSO-d6, 1H NMR';
    const looks: CharLook[] = [...text].map(plain);
    looks[4] = { pos: 'sub', italic: false };
    looks[text.indexOf('d6')] = { pos: 'base', italic: true };
    looks[text.indexOf('d6') + 1] = { pos: 'sub', italic: false };
    looks[text.indexOf('1H')] = { pos: 'sup', italic: false };
    expect(kinds(text, (i) => looks[i])).toEqual([]);
    looks[text.indexOf('d6')] = plain();
    expect(kinds(text, (i) => looks[i])).toEqual([['solvent', 'DMSO-d6', 'DMSO-d₆']]);
  });
  it('knows formulas and their exceptions', () => {
    for (const w of ['H2SO4', 'Et3N', 'NH4Cl', 'Cl2', 'CO2Me', 'Cs2CO3']) expect(isFormula(w), w).toBe(true);
    for (const w of ['SN2', 'SN1', 'S1', 'C18', 'E2', '3a', '12b', 'TS2', 'IC50', 'THF', 'B3LYP', 'N2', 'H2']) expect(isFormula(w), w).toBe(false);
    expect(formulaDigits('dried over Na2SO4', 17)).toEqual([13, 16]);
    expect(formulaDigits('Na2SO4 and', 10)).toEqual([]);
  });
  it.each([
    ['Pd2(dba)3', 'Pd₂(dba)₃'], ['Ni(cod)2', 'Ni(cod)₂'], ['Ru(bpy)3Cl2', 'Ru(bpy)₃Cl₂'], ['B2pin2', 'B₂pin₂'], ['Boc2O', 'Boc₂O'],
    ['Ti(OiPr)4', 'Ti(OiPr)₄'], ['iPr2NEt', 'iPr₂NEt'], ['nBu4NI', 'nBu₄NI'], ['tBu3P', 'tBu₃P'], ['(iPr)2NEt', '(iPr)₂NEt'],
    ['[Ir(cod)Cl]2', '[Ir(cod)Cl]₂'], ['Cp2ZrCl2', 'Cp₂ZrCl₂'], ['PdCl2(PPh3)2', 'PdCl₂(PPh₃)₂'], ['i-Pr2NEt', 'i-Pr₂NEt'],
  ])('reads %s with ligands and alkyl groups', (w, fixed) => {
    expect(isFormula(w)).toBe(true);
    expect(kinds(w)).toEqual([['formula', w, fixed]]);
  });
  it.each(['OD600', 'NIH3T3', 'COVID19', 'SI1', 'HCT116', 'PC3', 'PI3K', 'CDK2', 'CYP2D6', 'CB1', 'P2Y12', 'INT1', 'ID50', 'LD50', 'HSP90', 'NS3', 'HIV1', 'Spin2', 'Copy2'])('%s is not a formula', (w) => {
    expect(isFormula(w)).toBe(false);
    expect(kinds(`with ${w} cells`)).toEqual([]);
  });
  it('takes molecules of one element as formulas only in context', () => {
    expect(kinds('1H, H2), under N2 with H2 (balloon)').map((k) => k[1])).toEqual(['N2', 'H2']);
    expect(kinds('δ 8.12 (d, J = 2.0 Hz, 1H, H2), 7.9 (s, 1H, H3)')).toEqual([]);
    expect(kinds('an N2 atmosphere in an O2-free, N2-filled glovebox').map((k) => k[1])).toEqual(['N2', 'O2', 'N2']);
    expect(kinds('N1/N2 ratio; N2-alkylation, Pd1–Cl2 distance')).toEqual([]);
  });
  it('tells ranges from codes and dates', () => {
    for (const t of ['CAS 7647-01-0', 'B3LYP/6-31G(d) and 6-311+G(d,p)', 'dated 2023-10-04', 'notebook NPO-2-117', 'C2-3 bond']) {
      expect(kinds(t).filter((k) => k[0] === 'range'), t).toEqual([]);
    }
    expect(kinds('entries 1-3, 2-3 h, pages 123-130.')).toEqual([['range', '1-3', '1–3'], ['range', '2-3', '2–3'], ['range', '123-130', '123–130']]);
  });
});

describe('formatting chemistry as you type', () => {
  const at = (text: string) => typingFormats(text, text.length, plain);
  it('subscripts the formula just finished', () => {
    expect(at('dried over Na2SO4')).toEqual([{ start: 13, end: 14, pos: 'sub' }, { start: 16, end: 17, pos: 'sub' }]);
    expect(at('an SN2')).toEqual([]);
  });
  it('subscripts a gas once the next word shows it', () => {
    expect(at('an N2 atmosphere').map((e) => e.start)).toEqual([4]);
  });
  it('raises the nucleus before NMR and in decoupling braces', () => {
    expect(at('1H NMR')).toEqual([{ start: 0, end: 1, pos: 'sup' }]);
    expect(typingFormats('13C{1H}', 6, plain).map((e) => [e.start, e.pos])).toEqual([[0, 'sup'], [1, 'sup'], [4, 'sup']]);
    expect(at('(m, 2H')).toEqual([]);
  });
  it('makes the d of a deuterated solvent italic and its digits subscripts', () => {
    expect(at('in DMSO-d6')).toEqual([{ start: 8, end: 9, italic: true }, { start: 9, end: 10, pos: 'sub' }]);
    expect(at('in d6-DMSO')).toEqual([{ start: 3, end: 4, italic: true }, { start: 4, end: 5, pos: 'sub' }]);
  });
  it('replaces typed shortcuts only as whole words', () => {
    const list = DEFAULT_REPLACEMENTS;
    expect(replacementAt('at 65 oC', 8, list)).toEqual([6, '°C']);
    expect(replacementAt('at 65oC', 7, list)).toEqual([5, '°C']);
    expect(replacementAt('ZnoC', 4, list)).toBeNull();
    expect(replacementAt('A ->', 4, list)).toEqual([2, '→']);
    expect(replacementAt('A <->', 5, list)).toEqual([2, '↔']);
    expect(replacementAt('5 uL', 4, list)).toEqual([2, 'µL']);
  });
  it('does it in the editor as its own undo step', () => {
    const ed = new TextEditing({ runs: [], justify: 'left' }, { size: 10 }, (t, s) => arialWidth(t, s, false), 10);
    let clock = 0;
    ed.now = () => (clock += 100);
    ed.onTyped = (t) => afterTyping(ed, t, DEFAULT_TYPING);
    for (const ch of 'in CH2Cl2 at 0 oC ') ed.type(ch);
    expect(ed.text).toBe('in CH2Cl2 at 0 °C ');
    expect(ed.t.runs.filter((r) => r.sub).map((r) => r.text)).toEqual(['2', '2']);
    ed.undo(); // the °C
    expect(ed.text).toBe('in CH2Cl2 at 0 oC ');
    expect(ed.t.runs.filter((r) => r.sub).length).toBe(2);
    ed.undo(); // the typing after the formula
    expect(ed.text).toBe('in CH2Cl2 ');
    expect(ed.t.runs.filter((r) => r.sub).length).toBe(2);
    ed.undo(); // the subscripts, keeping the space typed
    expect(ed.text).toBe('in CH2Cl2 ');
    expect(ed.t.runs.filter((r) => r.sub).length).toBe(0);
  });
  it('leaves formula-style text alone (it already shows subscripts)', () => {
    const ed = new TextEditing({ runs: [], justify: 'left' }, { size: 10, formula: true }, (t, s) => arialWidth(t, s, false), 10);
    ed.onTyped = (t) => afterTyping(ed, t, DEFAULT_TYPING);
    for (const ch of 'CH2Cl2 ') ed.type(ch);
    expect(ed.t.runs).toEqual([{ text: 'CH2Cl2 ', size: 10, formula: true }]);
  });
});
