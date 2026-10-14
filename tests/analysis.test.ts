// The Analysis panel's extra numbers: isotope patterns, elemental analysis, Joback estimates,
// and mass fragmentation pieces.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { isotopePattern, elementalAnalysis, ionCounts, formulaCounts, joback } from '../src/chem/analysis';
import { parseAdduct } from '../src/chem/hrms';
import { panelProps, massFragments, atomicWeight } from '../src/chem/props';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const jsonOf = (smiles: string) => { const m = RDKit.get_mol(smiles); try { return m.get_json(); } finally { m.delete(); } };
const counts = (f: string) => formulaCounts(f)!;

describe('isotope pattern', () => {
  it('gives the M, M+1 and M+2 of a small organic ion', () => {
    // caffeine [M+H]+ C8H11N4O2+
    const ion = ionCounts(counts('C8H10N4O2'), parseAdduct('[M+H]+'))!;
    expect(Object.fromEntries(ion)).toEqual({ C: 8, H: 11, N: 4, O: 2 });
    const p = isotopePattern(ion, 1)!;
    expect(p[0].mz).toBeCloseTo(195.0877, 4);
    expect(p[0].rel).toBeCloseTo(100, 5);
    // M+1 ≈ 8 × 1.08 % (C) + 4 × 0.37 % (N) + … ≈ 10.4 %
    expect(p[1].rel).toBeGreaterThan(9.8);
    expect(p[1].rel).toBeLessThan(10.8);
  });

  it('shows chlorine and bromine patterns', () => {
    const cl = isotopePattern(counts('CH3Cl'), 1)!;
    expect(cl[2].rel).toBeCloseTo(32.4, 0); // 24.24 / 75.76
    const br2 = isotopePattern(counts('CH2Br2'), 1)!;
    // 1 : 2 : 1, the middle peak tallest
    expect(br2[0].rel).toBeCloseTo(51.4, 0);
    expect(br2[2].rel).toBeCloseTo(100, 0);
    expect(br2[4].rel).toBeCloseTo(48.9, 0);
  });

  it('divides by the charge and knows when it can not help', () => {
    const p = isotopePattern(counts('C2H6'), 2)!;
    expect(p[0].mz).toBeCloseTo((30.04695 - 2 * 0.000548579909065) / 2, 4);
    expect(isotopePattern(counts('C2H6Pt'), 1)).toBeNull();
  });

  it('builds adduct ions and refuses losses that are not there', () => {
    expect(Object.fromEntries(ionCounts(counts('C2H6O'), parseAdduct('[M+HCOO]-'))!)).toEqual({ C: 3, H: 7, O: 3 });
    expect(ionCounts(counts('CH4'), parseAdduct('[M+H-H2O]+'))).toBeNull();
  });
});

describe('elemental analysis', () => {
  it('matches the textbook values for caffeine', () => {
    const c = counts('C8H10N4O2');
    const w: Record<string, number> = {};
    for (const el of c.keys()) w[el] = atomicWeight(RDKit, el)!;
    const ea = elementalAnalysis(c, w)!;
    expect(ea.map((x) => x.el)).toEqual(['C', 'H', 'N', 'O']);
    expect(ea[0].pct).toBeCloseTo(49.48, 2);
    expect(ea[1].pct).toBeCloseTo(5.19, 2);
    expect(ea[2].pct).toBeCloseTo(28.85, 2);
  });
});

describe('Joback estimates', () => {
  it('counts the groups of ethanol and benzoic acid', () => {
    const e = joback(jsonOf('CCO'));
    expect(e.groups).toEqual({ '-CH3': 1, '-CH2-': 1, '-OH (alcohol)': 1 });
    expect(e.tb).toBeCloseTo(198 + 23.58 + 22.88 + 92.88, 6);
    const b = joback(jsonOf('OC(=O)c1ccccc1'));
    expect(b.groups).toEqual({ '-COOH': 1, '=CH- (ring)': 5, '=C< (ring)': 1 });
    expect(b.tb! - 273.15).toBeCloseTo(258.6, 1);
  });

  it('knows esters, aldehydes, ketones, nitriles, nitro groups, amines and halides', () => {
    expect(joback(jsonOf('CC(=O)OC')).groups).toEqual({ '-CH3': 2, '-COO- (ester)': 1 });
    expect(joback(jsonOf('CC=O')).groups).toEqual({ '-CH3': 1, 'O=CH- (aldehyde)': 1 });
    expect(joback(jsonOf('O=C1CCCCC1')).groups).toEqual({ '>C=O (ring)': 1, '-CH2- (ring)': 5 });
    expect(joback(jsonOf('CC#N')).groups).toEqual({ '-CH3': 1, '-CN': 1 });
    expect(joback(jsonOf('C[N+](=O)[O-]')).groups).toEqual({ '-CH3': 1, '-NO2': 1 });
    expect(joback(jsonOf('CCN(C)C')).groups).toEqual({ '-CH3': 3, '-CH2-': 1, '>N-': 1 });
    expect(joback(jsonOf('c1ccncc1')).groups).toEqual({ '=CH- (ring)': 5, '-N= (ring)': 1 });
    expect(joback(jsonOf('Oc1ccccc1Br')).groups).toEqual({ '-OH (phenol)': 1, '=CH- (ring)': 4, '=C< (ring)': 2, '-Br': 1 });
  });

  it('gives no estimate where no group fits, and says why', () => {
    const s = joback(jsonOf('CS(C)(=O)=O'));
    expect(s.tb).toBeNull();
    expect(s.missing).toMatch(/S with more than two bonds/);
    expect(joback(jsonOf('C[Si](C)(C)C')).missing).toMatch(/silicon/);
    expect(joback(jsonOf('CC=NC')).tm).toBeNull();
  });
});

describe('panel properties', () => {
  it('gathers counts, weights and the drug-likeness numbers', () => {
    const m = RDKit.get_mol('CC(=O)Oc1ccccc1C(=O)O');
    const p = panelProps(RDKit, m);
    m.delete();
    expect(p.counts).toEqual({ C: 9, H: 8, O: 4 });
    expect(p.weights.C).toBeCloseTo(12.011, 3);
    expect(p.tpsa).toBeCloseTo(63.6, 1);
    expect(p.mr).toBeGreaterThan(40);
    expect(p.joback.tb).not.toBeNull();
  });
});

describe('mass fragments', () => {
  it('splits acetophenone at the C–C bond into benzoyl and methyl radicals', () => {
    // atoms: 0 C(methyl) 1 C(=O) 2 O 3..8 ring
    const m = RDKit.get_mol('CC(=O)c1ccccc1');
    const mb = m.get_molblock();
    m.delete();
    const f = massFragments(RDKit, mb, [[0, 1]]);
    if ('error' in f) throw new Error(f.error);
    expect(f.map((x) => x.formula)).toEqual(['CH3', 'C7H5O']);
    expect(f[0].exact).toBeCloseTo(15.0235, 4);
    expect(f[1].exact).toBeCloseTo(105.0340, 4);
    expect(f[1].mw).toBeCloseTo(105.12, 2);
  });

  it('gives one piece when the broken bond is in a ring', () => {
    const m = RDKit.get_mol('C1CCCCC1');
    const mb = m.get_molblock();
    m.delete();
    const f = massFragments(RDKit, mb, [[0, 1]]);
    if ('error' in f) throw new Error(f.error);
    expect(f).toHaveLength(1);
    expect(f[0].formula).toBe('C6H12');
  });
});

describe('journal text from the Analysis panel', () => {
  it('writes HRMS and elemental analysis lines in ACS style', async () => {
    const { analysisRuns } = await import('../src/ui/analysis-panel');
    const m = RDKit.get_mol('Cn1c(=O)c2c(ncn2C)n(C)c1=O');
    const props = panelProps(RDKit, m);
    const d = JSON.parse(m.get_descriptors());
    m.delete();
    const r = { formula: 'C8H10N4O2', exact: d.exactmw, mw: d.amw, charge: 0, smiles: '', props };
    const text = (runs: { text: string }[] | null) => runs!.map((x) => x.text).join('');
    expect(text(analysisRuns('hrms', r, '[M+H]+'))).toBe('HRMS (ESI) m/z: [M + H]+ Calcd for C8H11N4O2 195.0877; Found 000.0000.');
    expect(text(analysisRuns('hrms', r, '[M-H]-'))).toBe('HRMS (ESI) m/z: [M − H]− Calcd for C8H9N4O2 193.0731; Found 000.0000.');
    expect(text(analysisRuns('ea', r, '[M+H]+'))).toBe('Anal. Calcd for C8H10N4O2: C, 49.48; H, 5.19; N, 28.85. Found: C, 00.00; H, 00.00; N, 00.00.');
  });
});
