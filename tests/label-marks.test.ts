// @vitest-environment jsdom
// Atom labels with characters raised or lowered by hand, and R numbers raised by themselves:
// how they are laid out, and how they go to and come back from CDXML.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { labelPieces, labelLook, labelPrefs, markPieces } from '../src/chem/labels';
import { writeCdxml, labelRuns } from '../src/io/cdxml-write';
import { readCdxml, labelLookOf } from '../src/io/cdxml';

const shown = (label: string, supDigits = false, marks?: string) =>
  labelPieces(label, supDigits, marks).map((p) => (p.sup ? `^${p.text}` : p.sub ? `_${p.text}` : p.text)).join('|');

function labelled(label: string, extra = {}): { doc: Doc; id: number } {
  const doc = new Doc();
  let id = 0;
  doc.edit('build', () => { const a = doc.addAtom(100, 100, 6, { label, ...extra }); id = a.id; doc.addBond(id, doc.addAtom(114, 100, 6).id, 1); });
  return { doc, id };
}

describe('label marks', () => {
  it('lowers counts and raises charges by themselves', () => {
    expect(shown('CH2CO2R1')).toBe('C|H|_2|C|O|_2|R|_1');
  });

  it('raises, lowers or keeps on the line the marked characters', () => {
    expect(shown('CH2CO2R1', false, '...^^...')).toBe('C|H|_2|^C|^O|_2|R|_1');
    expect(shown('CH2', false, '..=')).toBe('C|H|2');
    expect(shown('Rx', false, '._')).toBe('R|_x');
  });

  it('joins neighbouring characters that sit the same way', () => {
    expect(markPieces([{ text: 'abc', at: 0 }], '^^.')).toEqual([{ text: 'ab', at: 0, sup: true }, { text: 'c', at: 2 }]);
  });

  it('raises the number of R1 and R12 only, unless the preference is off or the file says otherwise', () => {
    expect(labelLook({ label: 'R1' }).supDigits).toBe(true);
    expect(labelLook({ label: 'R12' }).supDigits).toBe(true);
    expect(labelLook({ label: 'OR1' }).supDigits).toBe(false);
    expect(labelLook({ label: 'CO2R1' }).supDigits).toBe(false);
    expect(labelLook({ label: 'R1', supDigits: false }).supDigits).toBe(false);
    labelPrefs.superscriptR = false;
    try { expect(labelLook({ label: 'R1' }).supDigits).toBe(false); } finally { labelPrefs.superscriptR = true; }
  });
});

describe('label marks in CDXML', () => {
  it('writes marked characters as raised or lowered runs and reads them back', () => {
    expect(labelRuns('CH2CO2R1', { supDigits: false, marks: '...^^...' })).toEqual([{ text: 'CH2', formula: true }, { text: 'CO', sup: true }, { text: '2R1', formula: true }]);
    const { doc, id } = labelled('CH2CO2R1', { labelMarks: '...^^...' });
    const xml = writeCdxml(doc);
    expect(xml).toContain('face="64">CO</s>');
    const back = readCdxml(xml).doc;
    const a = [...back.atoms.values()].find((x) => x.label === 'CH2CO2R1')!;
    expect(a.labelMarks).toBe('...^^...');
    expect(id).toBeGreaterThan(0);
  });

  it('writes R1 with its number raised, and keeps a file\'s lowered R1 lowered', () => {
    const xml = writeCdxml(labelled('R1').doc);
    expect(xml).toMatch(/face="96">R<\/s><s [^>]*face="64">1<\/s>/);
    expect(readCdxml(xml).doc.atoms.values().next().value!.supDigits).toBe(true);
    expect(labelLookOf([{ text: 'R1', formula: true }], 'R1')).toEqual({ supDigits: false });
    expect(labelLookOf([{ text: 'R' }, { text: '1', sup: true }], 'R1')).toEqual({ supDigits: true });
  });
});
