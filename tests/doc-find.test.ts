// Find and replace in a document: finding by the letters alone, whole words and capitals,
// and replacements that change the words, how they look, or both.

import { describe, expect, it } from 'vitest';
import type { TextRun } from '../src/model';
import * as rt from '../src/richtext';
import { OBJECT_CHAR } from '../src/document/document';
import { findAll, lookPatch, plainQuery, replaceRanges } from '../src/document/find';

const text = (runs: TextRun[]) => rt.plainText(runs);

describe('finding', () => {
  it('finds every place, without capitals mattering unless asked', () => {
    expect(findAll('Dry the CH2Cl2; wash with ch2cl2.', 'CH2Cl2')).toEqual([[8, 14], [26, 32]]);
    expect(findAll('Dry the CH2Cl2; wash with ch2cl2.', 'CH2Cl2', { matchCase: true })).toEqual([[8, 14]]);
  });

  it('finds whole words only when asked', () => {
    const t = 'Me ester; method; MeOH; Me.';
    expect(findAll(t, 'Me').length).toBe(4);
    expect(findAll(t, 'Me', { wholeWord: true })).toEqual([[0, 2], [24, 26]]);
  });

  it('reads subscript and superscript characters typed in the box as the plain ones the text keeps', () => {
    expect(plainQuery('CH₂Cl₂')).toBe('CH2Cl2');
    expect(plainQuery('Fe³⁺ SO₄²⁻')).toBe('Fe3+ SO42-');
    expect(findAll('in CH2Cl2', 'CH₂Cl₂')).toEqual([[3, 9]]);
  });

  it('never finds across a paragraph end or a figure, and treats the words literally', () => {
    expect(findAll('a b\nc', 'b\nc')).toEqual([]);
    expect(findAll(`see${OBJECT_CHAR}here`, `e${OBJECT_CHAR}h`)).toEqual([]);
    expect(findAll('1.5 h, 105 h', '1.5')).toEqual([[0, 3]]);
    expect(findAll('[M+H]+ and [M+Na]+', '[M+H]+')).toEqual([[0, 6]]);
    expect(findAll('anything', '')).toEqual([]);
  });

  it('doesn\'t count places that overlap twice', () => {
    expect(findAll('aaaa', 'aa')).toEqual([[0, 2], [2, 4]]);
  });
});

describe('replacing', () => {
  const runs: TextRun[] = [
    { text: 'Wash with ' },
    { text: 'CH2Cl2', italic: true },
    { text: ' and dry over ' },
    { text: 'MgSO4' },
    { text: '. Then CH2Cl2 again.' },
  ];

  it('replaces the words, keeping the look of the first letter found', () => {
    const t = text(runs);
    const out = replaceRanges(runs, findAll(t, 'CH2Cl2'), 'DCM');
    expect(text(out)).toBe('Wash with DCM and dry over MgSO4. Then DCM again.');
    expect(out.find((r) => r.text.startsWith('DCM'))?.italic).toBe(true);
  });

  it('with nothing to replace with but a look, changes only how the found words look', () => {
    const t = text(runs);
    const out = replaceRanges(runs, findAll(t, 'CH2Cl2'), '', { formula: true });
    expect(text(out)).toBe(t);
    const formula = out.filter((r) => r.formula).map((r) => r.text);
    expect(formula).toEqual(['CH2Cl2', 'CH2Cl2']);
    // the first one keeps its italics; formula style takes the place of sub- and superscripts
    expect(out.find((r) => r.formula)?.italic).toBe(true);
  });

  it('replaces and changes the look in one go', () => {
    const t = text(runs);
    const out = replaceRanges(runs, findAll(t, 'MgSO4'), 'Na2SO4', { formula: true, bold: true });
    expect(text(out)).toBe('Wash with CH2Cl2 and dry over Na2SO4. Then CH2Cl2 again.');
    expect(out.find((r) => r.text === 'Na2SO4')).toMatchObject({ formula: true, bold: true });
  });

  it('with neither, deletes the found words', () => {
    const t = text(runs);
    expect(text(replaceRanges(runs, findAll(t, ' again'), ''))).toBe('Wash with CH2Cl2 and dry over MgSO4. Then CH2Cl2.');
  });

  it('plain takes off formatting first, then adds what is chosen', () => {
    const r: TextRun[] = [{ text: 'in vacuo', bold: true, sub: true, underline: true }];
    const out = replaceRanges(r, [[0, 8]], '', { plain: true, italic: true });
    expect(out).toEqual([{ text: 'in vacuo', italic: true }]);
  });

  it('subscript, superscript and formula style exclude one another', () => {
    expect(lookPatch({ formula: true })).toEqual({ formula: true, sub: undefined, sup: undefined });
    expect(lookPatch({ sup: true })).toEqual({ sup: true, sub: undefined, formula: undefined });
    expect(lookPatch({})).toBeNull();
    const r: TextRun[] = [{ text: 'x2', formula: true }];
    expect(replaceRanges(r, [[1, 2]], '', { sup: true })).toEqual([{ text: 'x', formula: true }, { text: '2', sup: true }]);
  });

  it('keeps figures and fields in the text where they are', () => {
    const r: TextRun[] = [{ text: 'rt then ' }, { text: OBJECT_CHAR, obj: 3 }, { text: ' at rt' }];
    const out = replaceRanges(r, findAll(text(r), 'rt', { wholeWord: true }), 'room temperature');
    expect(text(out)).toBe(`room temperature then ${OBJECT_CHAR} at room temperature`);
    expect(out.find((x) => x.obj === 3)).toBeDefined();
    expect(out.filter((x) => x.text.includes('room')).every((x) => x.obj === undefined)).toBe(true);
  });
});
