import { describe, it, expect } from 'vitest';
import { implicitHydrogens, valenceExceeded, elementNumber } from '../src/chem/elements';
import { tokenize, labelGraph, labelSpec, layoutLabel } from '../src/chem/labels';
import { formulaFromJson } from '../src/chem/formula';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { applyLineEnds, isAutoLabel } from '../src/io/cdxml';
import type { TextRun } from '../src/model';

describe('implicit hydrogens', () => {
  it('follows normal valences', () => {
    expect(implicitHydrogens(6, 1, 0)).toBe(3); // CH3–
    expect(implicitHydrogens(6, 4, 0)).toBe(0);
    expect(implicitHydrogens(7, 1, 0)).toBe(2); // –NH2
    expect(implicitHydrogens(8, 1, 0)).toBe(1); // –OH
    expect(implicitHydrogens(16, 2, 0)).toBe(0);
    expect(implicitHydrogens(16, 3, 0)).toBe(1); // next valence up (4)
  });
  it('adjusts for charge', () => {
    expect(implicitHydrogens(7, 4, 1)).toBe(0); // quaternary N+
    expect(implicitHydrogens(7, 1, 1)).toBe(3); // –NH3+
    expect(implicitHydrogens(8, 1, -1)).toBe(0); // –O−
    expect(implicitHydrogens(6, 2, 1)).toBe(1); // carbocation CH+
    expect(implicitHydrogens(5, 3, -1)).toBe(1); // borate BH−
    expect(implicitHydrogens(35, 0, -1)).toBe(0); // bromide
  });
  it('flags too many bonds', () => {
    expect(valenceExceeded(6, 5, 0)).toBe(true);
    expect(valenceExceeded(7, 4, 1)).toBe(false);
    expect(valenceExceeded(8, 3, 0)).toBe(true);
  });
  it('knows deuterium', () => {
    expect(elementNumber('D')).toBe(1);
    expect(elementNumber('Cl')).toBe(17);
  });
});

describe('labels', () => {
  it('splits labels into elements and abbreviations', () => {
    expect(tokenize('CO2Et').map((t) => t.text)).toEqual(['C', 'O', 'Et']);
    expect(tokenize('CO2Et')[1].count).toBe(2);
    expect(tokenize('NHBoc').map((t) => t.text)).toEqual(['N', 'H', 'Boc']);
    expect(tokenize('OTBS').map((t) => t.kind)).toEqual(['el', 'nick']);
    expect(tokenize('Ar1')[0]).toMatchObject({ text: 'Ar', count: 1, explicit: true });
  });
  it('expands labels into atoms for the chemistry', () => {
    expect(labelGraph('OMe')!.atoms.map((a) => a.z)).toEqual([8, 6]);
    expect(labelGraph('CO2Me')!.atoms.map((a) => a.z)).toEqual([6, 8, 8, 6]);
    expect(labelGraph('Ph')!.atoms.length).toBe(6);
    expect(labelGraph('NHBoc')!.atoms[0].z).toBe(7);
    expect(labelGraph('R')!.atoms[0].dummy).toBe(true);
  });
  it('runs labels away from their bonds (OH vs HO)', () => {
    const measure = (t: string, s: number) => t.length * s * 0.6;
    const spec = labelSpec(8, null, 0, 0, 1, 1)!;
    expect(spec.hCount).toBe(1);
    // bond to the left: O first, H to the right
    const right = layoutLabel(spec, [{ x: -1, y: 0 }], 10, measure);
    expect(right.runs.map((r) => r.text).join('')).toBe('OH');
    // bond to the right: reversed, H to the left of O
    const left = layoutLabel(spec, [{ x: 1, y: 0 }], 10, measure);
    expect(left.runs.map((r) => r.text).join('')).toBe('HO');
    expect(left.runs.find((r) => r.text === 'H')!.dx).toBeLessThan(0);
  });
  it('shows no label for plain carbon in a chain', () => {
    expect(labelSpec(6, null, 0, 0, 2, 2)).toBeNull();
  });
});

describe('formula', () => {
  const json = (atoms: object[]) => JSON.stringify({ defaults: { atom: { z: 6, impHs: 0, chg: 0 } }, molecules: [{ atoms }] });
  it('uses Hill order', () => {
    // ethanol: C, C, O with 3, 2, 1 H
    expect(formulaFromJson(json([{ impHs: 3 }, { impHs: 2 }, { z: 8, impHs: 1 }])).formula).toBe('C2H6O');
    // no carbon: alphabetical (H2O → H2O, NaCl → ClNa)
    expect(formulaFromJson(json([{ z: 8, impHs: 2 }])).formula).toBe('H2O');
    expect(formulaFromJson(json([{ z: 11 }, { z: 17 }])).formula).toBe('ClNa');
  });
  it('adds the charge and skips R groups', () => {
    const r = formulaFromJson(json([{ z: 7, impHs: 4, chg: 1 }]));
    expect(r.formula).toBe('H4N+');
    expect(formulaFromJson(json([{ impHs: 3 }, { z: 0 }])).formula).toBe('CH3');
  });
});

describe('molfile export', () => {
  it('expands labels and keeps wedges with the narrow end first', () => {
    const d = new Doc();
    d.bulk(() => {
      const a = d.addAtom(0, 0);
      const b = d.addAtom(14.4, 0, 6);
      const c = d.addAtom(21.6, -12.5, 8, { label: 'OMe' });
      d.addBond(a.id, b.id, 1, 'wedge');
      d.addBond(b.id, c.id);
    });
    const m = toMolfile(d, d.atoms.keys());
    const lines = m.molblock.split('\n');
    expect(lines[3].startsWith('  4  3')).toBe(true); // C, C, O, CH3
    expect(m.map.filter((x) => x >= 0).length).toBe(3);
    expect(lines.some((l) => /^ {2}1 {2}2 {2}1 {2}1$/.test(l))).toBe(true); // wedge stereo flag 1
    // y is flipped (molfiles have y up)
    expect(parseFloat(lines[6].slice(10, 20))).toBeGreaterThan(0);
  });
  it('writes charges', () => {
    const d = new Doc();
    d.bulk(() => { d.addAtom(0, 0, 7, { charge: 1 }); });
    expect(toMolfile(d, d.atoms.keys()).molblock).toContain('M  CHG  1   1   1');
  });
});

describe('CDXML helpers', () => {
  it('breaks wrapped lines at UTF-8 byte offsets', () => {
    const runs: TextRun[] = [{ text: 'industry’s demands for more' }];
    // "industry’s " is 11 characters but 13 UTF-8 bytes
    applyLineEnds(runs, [13]);
    expect(runs[0].text).toBe('industry’s\ndemands for more');
  });
  it('recognises plain element labels', () => {
    expect(isAutoLabel(8, 'OH', 1)).toBe(true);
    expect(isAutoLabel(8, 'HO', 1)).toBe(true);
    expect(isAutoLabel(7, 'H2N', 2)).toBe(true);
    expect(isAutoLabel(7, 'NHBoc', 1)).toBe(false);
  });
});
