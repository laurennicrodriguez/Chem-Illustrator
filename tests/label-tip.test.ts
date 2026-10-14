import { describe, it, expect } from 'vitest';
import { labelTip } from '../src/chem/label-tip';

describe('label tooltip', () => {
  it('writes out abbreviations with a * where they join', () => {
    const boc = labelTip('Boc')!;
    expect(boc.smiles).toBe('*C(=O)OC(C)(C)C');
    expect(boc.formula).toBe('C5H9O2');
    expect(boc.name).toBe('tert-butoxycarbonyl');
    expect(labelTip('Ph')!.formula).toBe('C6H5');
    expect(labelTip('OTBS')!.smiles).toBe('*O[Si](C)(C)C(C)(C)C');
    expect(labelTip('OTBS')!.formula).toBe('C6H15OSi');
  });
  it('reads condensed formulas', () => {
    expect(labelTip('CO2Me')!.formula).toBe('C2H3O2');
    expect(labelTip('CH2OH')!.formula).toBe('CH3O');
    expect(labelTip('NHBoc')!.formula).toBe('C5H10NO2');
    expect(labelTip('MeO')!.smiles).toBe('*OC');
  });
  it('shows nothing for single atoms, any-group labels and unreadable text', () => {
    expect(labelTip('OH')).toBeNull();
    expect(labelTip('NH2')).toBeNull();
    expect(labelTip('R')).toBeNull();
    expect(labelTip('Ar')).toBeNull();
    expect(labelTip('hello world')).toBeNull();
  });
  it('joins every bond to the structure at the first atom', () => {
    const t = labelTip('CH2', [1, 1]);
    expect(t).toBeNull(); // one carbon
    const s = labelTip('CO2', [1, 1])!;
    expect(s.smiles.split('*').length - 1).toBe(2);
  });
});

import { starAtoms } from '../src/chem/label-tip';
describe('star atoms', () => {
  it('finds * atoms in SMILES order', () => {
    expect(starAtoms('*C(=O)OC(C)(C)C')).toEqual([0]);
    expect(starAtoms('*OC(=O)*')).toEqual([0, 4]);
    expect(starAtoms('Clc1ccccc1[*]')).toEqual([7]);
    expect(starAtoms('*[Si](C)(C)Br')).toEqual([0]);
  });
});
