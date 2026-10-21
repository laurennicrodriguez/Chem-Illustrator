// The isotope pattern in sheets: ISOMZ and ISOABUND give each peak of an ion's pattern (M, M+1,
// M+2…) from a structure, SMILES or formula.

import { describe, it, expect } from 'vitest';
import { parseFormula } from '../src/sheet/formula';
import { cellName } from '../src/sheet/refs';
import { evaluate, type EvalHost } from '../src/sheet/evaluate';
import { CellError, type Value } from '../src/sheet/values';
import type { MolProps } from '../src/sheet/properties';
import { formulaWithCharge, ionPeaks, listedPeaks, peakName, readsAsFormula } from '../src/sheet/isotopes';
import { usesChemistry } from '../src/io/xlsx';

const aspirin: MolProps = {
  formula: 'C9H8O4', mw: 180.159, exact: 180.042258736, charge: 0, smiles: 'CC(=O)Oc1ccccc1C(=O)O',
  inchikey: 'BSYNRYMUTXBXSQ-UHFFFAOYSA-N', clogp: 1.3101, tpsa: 63.6, hbd: 1, hba: 4, rotb: 2,
};
const choline: MolProps = { ...aspirin, formula: 'C5H14NO+', charge: 1, exact: 104.1070, smiles: 'C[N+](C)(C)CCO' };
const mols: Record<string, MolProps | CellError> = { [aspirin.smiles]: aspirin, [choline.smiles]: choline, busy: new CellError('#BUSY!') };

function host(cells: Record<string, Value>): EvalHost {
  const at = (row: number, col: number) => cells[cellName(row, col)] ?? null;
  return {
    value: (_s, row, col) => at(row, col),
    block: () => [[null]],
    hasSheet: () => true,
    molecule: (src) => {
      const key = 'smiles' in src ? src.smiles : String(at(src.row, src.col) ?? '');
      if (!key) return null;
      return mols[key] ?? new CellError('#VALUE!', 'unreadable');
    },
  };
}
const calc = (f: string, cells: Record<string, Value> = {}) => {
  const v = evaluate(parseFormula(f), host(cells));
  return v instanceof CellError ? v.code : v;
};
const cells = { B2: aspirin.smiles, B3: 'C6H5Br', B4: choline.smiles, B5: 'busy', D1: '[M+Na]+' };

describe('isotope peaks in formulas', () => {
  it('gives the m/z and height of each peak of a structure\'s ion', () => {
    // [M+H]+ of aspirin, C9H9O4+: 181.0495 as HRMS gives it
    expect(calc('=ISOMZ(B2,"[M+H]+",0)', cells)).toBeCloseTo(181.0495, 4);
    expect(calc('=ISOMZ(B2)', cells)).toBeCloseTo(181.0495, 4);
    expect(calc('=ISOABUND(B2,"[M+H]+",0)', cells)).toBeCloseTo(100, 6);
    // nine carbons: M+1 is about 10 % of M
    const m1 = calc('=ISOABUND(B2,"[M+H]+",1)', cells) as number;
    expect(m1).toBeGreaterThan(9.5);
    expect(m1).toBeLessThan(10.6);
    expect(calc('=ISOMZ(B2,"[M+H]+",1)', cells)).toBeCloseTo(182.053, 2);
    // the ion from a cell
    expect(calc('=ISOMZ(B2,D1,0)', cells)).toBeCloseTo(203.0315, 4);
  });

  it('works from a formula, as typed or in a cell', () => {
    // bromine: M and M+2 nearly the same height
    expect(calc('=ISOABUND(B3,"[M]+",2)', cells)).toBeGreaterThan(95);
    expect(calc('=ISOABUND(B3,"[M]+",2)', cells)).toBeLessThan(100);
    expect(calc('=ISOMZ("C9H8O4","[M+H]+",0)')).toBeCloseTo(181.0495, 4);
  });

  it('takes a charged molecule as its own ion', () => {
    // choline is a cation: its m/z is that of [M]+, whatever ion is asked for
    // C5H14NO: 104.10754 for the atoms, less an electron
    expect(calc('=ISOMZ(B4,"[M+H]+",0)', cells)).toBeCloseTo(104.10699, 4);
    expect(calc('=ISOMZ("C5H14NO+","",0)')).toBeCloseTo(104.10699, 4);
  });

  it('is blank past the last peak, and says what is wrong', () => {
    expect(calc('=ISOMZ(B2,"[M+H]+",400)', cells)).toBe('');
    expect(calc('=ISOMZ(B9)', cells)).toBe('');
    expect(calc('=ISOMZ(B2,"[M+H]+",-1)', cells)).toBe('#VALUE!');
    expect(calc('=ISOMZ(B2,"[M+Xx]+",0)', cells)).toBe('#VALUE!');
    expect(calc('=ISOMZ(B5)', cells)).toBe('#BUSY!');
    expect(calc('=ISOMZ(12)', cells)).toBe('#VALUE!');
  });

  it('places peaks of a doubly charged ion half a unit apart', () => {
    const got = ionPeaks({ formula: 'C20H30N4' }, '[M+2H]2+');
    if ('code' in got) throw got;
    expect(got.peaks[1]!.mz - got.peaks[0]!.mz).toBeCloseTo(0.5, 2);
  });

  it('is saved for Excel as its value', () => {
    expect(usesChemistry('=ISOMZ(B2,"[M+H]+",1)')).toBe(true);
    expect(usesChemistry('=ISOABUND(B2)*2')).toBe(true);
  });
});

describe('telling formulas from SMILES', () => {
  it('reads formulas', () => {
    for (const f of ['C10H12N2O', 'CO2', 'CH2Cl2', 'C8H11N4O2+', 'C4H12N2 2+', 'H2O', 'C6H5Br', 'C54H45ClP3Rh', 'C43H72Cl2P2Ru']) expect(readsAsFormula(f)).toBe(true);
  });
  it('leaves SMILES as SMILES', () => {
    for (const s of ['CCO', 'C1CCCCC1', 'c1ccccc1', 'CN', 'CC(=O)O', 'O=C=O', 'C[N+](C)(C)C', 'Xx2']) expect(readsAsFormula(s)).toBe(false);
  });
  it('reads charges', () => {
    expect(formulaWithCharge('C8H11N4O2+')?.charge).toBe(1);
    expect(formulaWithCharge('C4H12N2 2+')?.charge).toBe(2);
    expect(formulaWithCharge('C2H3O2−')?.charge).toBe(-1);
    expect(formulaWithCharge('C9H8O4')?.counts.get('C')).toBe(9);
  });
});

describe('the peaks worth listing', () => {
  it('lists every peak from M to the last one above the cut-off', () => {
    expect(listedPeaks({ formula: 'C6H5Br' }, '[M]+', 0.5)).toEqual([0, 1, 2, 3]);
    // M+5 (from M+4 with a 13C) is just over 0.5 %
    expect(listedPeaks({ formula: 'CH2Br2' }, '[M]+', 0.5)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(peakName(0)).toBe('M');
    expect(peakName(2)).toBe('M+2');
  });
});

describe('charged structures', () => {
  it('keeps the last element\'s count when it takes off the charge', async () => {
    const { withoutCharge } = await import('../src/chem/formula');
    expect(withoutCharge('C8H11N4O2+', 1)).toBe('C8H11N4O2');
    expect(withoutCharge('BF4−', -1)).toBe('BF4');
    expect(withoutCharge('C4H12N2 2+', 2)).toBe('C4H12N2');
    expect(withoutCharge('C9H8O4', 0)).toBe('C9H8O4');
    // caffeine-H+ drawn gives the same peak as its formula typed
    const drawn = ionPeaks({ mol: { ...aspirin, formula: 'C8H11N4O2+', charge: 1 } }, '');
    const typed = ionPeaks({ formula: 'C8H11N4O2+' }, '');
    if ('code' in drawn || 'code' in typed) throw new Error('no pattern');
    expect(drawn.peaks[0]!.mz).toBeCloseTo(typed.peaks[0]!.mz, 6);
    expect(drawn.peaks[0]!.mz).toBeCloseTo(195.0877, 3);
  });

  it('gives a cation\'s own m/z for HRMS(), with its electron taken off once', async () => {
    const { propertyValue } = await import('../src/sheet/properties');
    const { ionInfo } = await import('../src/ui/analysis-panel');
    // NMe4+: RDKit's exact mass (74.096426) already has the electron taken off
    const nme4 = { ...aspirin, formula: 'C4H12N+', charge: 1, exact: 74.096426 };
    expect(propertyValue('HRMS', nme4, ['[M+H]+'])).toBeCloseTo(74.0964, 4);
    const props = { counts: { C: 4, H: 12, N: 1 } } as never;
    expect(ionInfo({ formula: 'C4H12N+', exact: 74.096426, mw: 74.15, charge: 1, smiles: '', props }, '[M+H]+')!.mz).toBeCloseTo(74.0964, 4);
  });
});
