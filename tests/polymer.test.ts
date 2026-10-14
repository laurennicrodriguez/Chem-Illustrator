// @vitest-environment jsdom
//
// Polymer and repeat brackets: which atoms are the unit, how the numbers count it, and the file
// form ChemDraw 25 uses (checked by re-saving a test file in ChemDraw).

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { bracketsAround } from '../src/objects';
import { repeatGroups, repeatCount } from '../src/chem/polymer';
import { withRepeats } from '../src/ui/analysis-panel';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

/** CH3–[CH2–CH2]–CH3 with brackets round the middle two carbons. */
function butane(label: string): { doc: Doc; inner: number[] } {
  const doc = new Doc();
  const inner: number[] = [];
  doc.edit('d', () => {
    const a = [0, 1, 2, 3].map((i) => doc.addAtom(312 + i * 12.47, i % 2 ? 92.8 : 100));
    for (let i = 0; i < 3; i++) doc.addBond(a[i].id, a[i + 1].id, 1);
    const [l, r] = bracketsAround({ x1: 318, y1: 84, x2: 343, y2: 108 }, 'square');
    doc.addShape(l);
    doc.addShape({ ...r, repeat: label });
    inner.push(a[1].id, a[2].id);
  });
  return { doc, inner };
}

describe('repeat groups', () => {
  it('finds the atoms between the brackets and the bonds crossing them', () => {
    const { doc, inner } = butane('n');
    const [g] = repeatGroups(doc);
    expect(g.inner.sort()).toEqual(inner.sort());
    expect(g.crossing).toHaveLength(2);
    expect(new Set(g.crossing.map((c) => c.spine))).toEqual(new Set([0, 1]));
    expect(g.count).toBeNull();
    expect(repeatCount('3')).toBe(3);
    expect(repeatCount('x')).toBeNull();
  });

  it('counts a numbered group that many times, and writes a polymer as (unit)n', () => {
    const unit = { counts: { C: 2, H: 4 }, exact: 28.0313, mw: 28.054 };
    const whole = { formula: 'C4H10', exact: 58.0783, mw: 58.123, charge: 0, smiles: 'CCCC', props: { counts: { C: 4, H: 10 } } } as never;
    const three = withRepeats(whole, [{ text: '3', count: 3, ...unit }]);
    expect(three.r.formula).toBe('C8H18');
    expect(three.r.exact).toBeCloseTo(58.0783 + 2 * 28.0313, 4);
    const poly = withRepeats(whole, [{ text: 'n', count: null, ...unit }]);
    expect(poly.r.formula).toBe('C2H6(C2H4)n');
    expect(poly.polymer!.endExact).toBeCloseTo(30.047, 3);
  });

  it('saves the group as ChemDraw does and reads it back', () => {
    const { doc } = butane('n');
    const xml = writeCdxml(doc);
    const dom = new DOMParser().parseFromString(xml, 'text/xml');
    const grp = dom.getElementsByTagName('bracketedgroup')[0];
    expect(grp.getAttribute('BracketUsage')).toBe('SRU');
    expect(grp.getAttribute('SRULabel')).toBe('n');
    expect(grp.getAttribute('BracketedObjectIDs')!.split(' ')).toHaveLength(2);
    expect(grp.getElementsByTagName('bracketattachment')).toHaveLength(2);
    expect(grp.getElementsByTagName('crossingbond')).toHaveLength(2);
    const labelled = [...dom.getElementsByTagName('graphic')].find((g) => g.getAttribute('BracketUsage') === 'SRU')!;
    expect(labelled.textContent).toBe('n');
    const back = readCdxml(xml).doc;
    expect([...back.shapes.values()].map((s) => s.repeat).filter(Boolean)).toEqual(['n']);
    expect(repeatGroups(back)[0].inner).toHaveLength(2);
    // an untouched file is written back exactly as it was
    expect(writeCdxml(back)).toBe(xml);
  });

  it('saves a numbered group as a Multiple Group with its count', () => {
    const xml = writeCdxml(butane('3').doc);
    const grp = new DOMParser().parseFromString(xml, 'text/xml').getElementsByTagName('bracketedgroup')[0];
    expect(grp.getAttribute('BracketUsage')).toBe('MultipleGroup');
    expect(grp.getAttribute('RepeatCount')).toBe('3');
    expect([...readCdxml(xml).doc.shapes.values()].map((s) => s.repeat).filter(Boolean)).toEqual(['3']);
  });
});
