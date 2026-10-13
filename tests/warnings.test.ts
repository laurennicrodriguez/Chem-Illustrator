// @vitest-environment jsdom
// Chemistry warnings and how labels are read: the formula a label gives (checked with the
// chemistry engine), and which drawings get a red box. The expected warnings follow what
// ChemDraw itself flagged in real drawings, except where noted.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc, Atom } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { formulaFromJson } from '../src/chem/formula';
import { labelGraph, isElementList } from '../src/chem/labels';
import { valenceOfBonds } from '../src/chem/elements';
import { StructureChecks, atomWarnings, isotopeOk } from '../src/chem/warnings';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const L = 14.4;

function formulaOf(doc: Doc): string {
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try { return formulaFromJson(m.get_json()).formula; } finally { m.delete(); }
}

/** CH3 bonded to an atom with this label. */
function methylWith(label: string): Doc {
  const d = new Doc();
  d.bulk(() => {
    const c = d.addAtom(0, 0);
    const x = d.addAtom(L, 0, 6, { label });
    d.addBond(c.id, x.id);
  });
  return d;
}

/** One unbonded atom with this label (reagents written as text). */
function alone(label: string): Doc {
  const d = new Doc();
  d.bulk(() => { d.addAtom(0, 0, 6, { label }); });
  return d;
}

describe('reading labels', () => {
  it('gives the right formula for condensed formulas', () => {
    const cases: [string, string][] = [
      ['B(OH)2', 'CH5BO2'], // methylboronic acid
      ['CONH2', 'C2H5NO'], // acetamide: C(=O)NH2, not C–O–N
      ['SO3H', 'CH4O3S'], // methanesulfonic acid
      ['SO2Cl', 'CH3ClO2S'],
      ['CO2Me', 'C3H6O2'],
      ['(CH2)3OH', 'C4H10O'], // butanol: a chain of three CH2
      ['CH(CH3)2', 'C4H10'], // isobutane: two methyls on one carbon
      ['C2H5', 'C3H8'],
      ['NHBoc', 'C6H13NO2'],
      ['NH3+', 'CH6N+'],
      ['N(CH2CH3)2', 'C5H13N'],
      ['PO(OEt)2', 'C5H13O3P'],
    ];
    for (const [label, want] of cases) expect([label, formulaOf(methylWith(label))]).toEqual([label, want]);
  });
  it('reads labels written backwards, as on the left of a structure', () => {
    const cases: [string, string][] = [
      ['MeO', 'C2H6O'], // dimethyl ether, bonded through O
      ['O2N', 'CH3NO2'], // nitromethane
      ['F3C', 'C2H3F3'],
      ['BocHN', 'C6H13NO2'],
      ['HO2C', 'C2H4O2'], // acetic acid
      ['(HO)2B', 'CH5BO2'],
    ];
    for (const [label, want] of cases) expect([label, formulaOf(methylWith(label))]).toEqual([label, want]);
    expect(labelGraph('MeO')!.atoms[0].z).toBe(8);
  });
  it('reads salts and anions written as one label', () => {
    expect(formulaOf(alone('NaBH4'))).toBe('BH4Na');
    expect(formulaOf(alone('KOtBu'))).toBe('C4H9KO');
    expect(formulaOf(alone('PhSO3-'))).toBe('C6H5O3S−');
  });
  it('treats R groups and element lists as "any group"', () => {
    expect(labelGraph('NR2')!.atoms.filter((a) => a.dummy).length).toBe(2); // N(R)2, not N–R2
    expect(isElementList('[Cl, Br, I]')).toBe(true);
    expect(isElementList('[Rh]')).toBe(true);
    expect(isElementList('[Rh]*')).toBe(false);
    expect(labelGraph('[Cl, Br, I]')!.atoms[0].dummy).toBe(true);
  });
  it('counts aromatic bonds as a chemist would', () => {
    // benzene carbon with a substituent: 4; N-methylpyrrole N: 3 (its lone pair is in the ring)
    expect(valenceOfBonds([1.5, 1.5, 1], 6)).toBe(4);
    expect(valenceOfBonds([1.5, 1.5, 1], 7)).toBe(3);
    expect(valenceOfBonds([1.5, 1.5, 1.5], 6)).toBe(4); // ring fusion
  });
});

/** Atoms in a row with bonds between neighbours; returns the doc and the atoms. */
function build(fn: (d: Doc) => void): Doc {
  const d = new Doc();
  d.bulk(() => fn(d));
  return d;
}

/** An atom with `n` single bonds to plain carbons. */
function star(z: number, n: number, extra: Partial<Atom> = {}): { d: Doc; c: Atom } {
  let c!: Atom;
  const d = build((d) => {
    c = d.addAtom(0, 0, z, extra);
    for (let i = 0; i < n; i++) {
      const t = (i / n) * 2 * Math.PI;
      d.addBond(c.id, d.addAtom(L * Math.cos(t), L * Math.sin(t)).id);
    }
  });
  return { d, c };
}

describe('warnings', () => {
  it('flags too many bonds, allowing for charge', () => {
    const c5 = star(6, 5);
    expect(atomWarnings(c5.d, c5.c)[0]).toMatch(/Too many bonds: this carbon has 5; it makes at most 4/);
    expect(atomWarnings(star(6, 4).d, star(6, 4).c)).toEqual([]);
    const n4 = star(7, 4);
    expect(atomWarnings(n4.d, n4.c)[0]).toMatch(/nitrogen has 4/);
    const n4plus = star(7, 4, { charge: 1 });
    expect(atomWarnings(n4plus.d, n4plus.c)).toEqual([]);
  });
  it('flags labels that cannot be read, or whose atoms have too many or too few bonds', () => {
    expect(atomWarnings(methylWith('Aryl'), methylWith('Aryl').atoms.get(2)!)[0]).toMatch(/can't be read/);
    for (const ok of ['R', 'EWG', 'Ar1', '[Cl, Br, I]', 'NR2', 'CO2Et', 'B(OH)2', 'MeO']) {
      const d = methylWith(ok);
      expect([ok, atomWarnings(d, d.atoms.get(2)!)]).toEqual([ok, []]);
    }
    const br = methylWith('CH(CH3');
    expect(atomWarnings(br, br.atoms.get(2)!)[0]).toMatch(/brackets/);
    // NH2 with two bonds: N would have 4
    const nh2 = star(6, 2, { label: 'NH2' });
    expect(atomWarnings(nh2.d, nh2.c)[0]).toMatch(/the N in “NH2” has 4, counting its 2 H/);
    // Ph with two bonds
    const ph = star(6, 2, { label: 'Ph' });
    expect(atomWarnings(ph.d, ph.c)[0]).toMatch(/Too many bonds: the C in “Ph”/);
    // a "P" label fixes the hydrogens at none, so one bond is too few (ChemDraw flags this too)
    const p = methylWith('P');
    expect(atomWarnings(p, p.atoms.get(2)!)[0]).toMatch(/Too few bonds: “P” shows no H/);
    expect(atomWarnings(alone('C'), alone('C').atoms.get(1)!)[0]).toMatch(/Too few bonds/);
    // a carbene label with its radical is fine
    const bh = build((d) => { d.addAtom(0, 0, 6, { label: 'BH', radical: 'singlet' }); });
    expect(atomWarnings(bh, bh.atoms.get(1)!)).toEqual([]);
  });
  it('checks isotopes', () => {
    expect(isotopeOk(6, 13)).toBe(true);
    expect(isotopeOk(1, 2)).toBe(true);
    expect(isotopeOk(6, 3)).toBe(false);
    expect(isotopeOk(6, 130)).toBe(false);
    const d = build((d) => { d.addAtom(0, 0, 6, { isotope: 3 }); });
    expect(atomWarnings(d, d.atoms.get(1)!)[0]).toMatch(/no isotope 3C/);
  });
  it('finds atoms on top of each other and clears the warning when they are moved apart', () => {
    let a!: Atom, b!: Atom;
    const d = build((d) => {
      a = d.addAtom(0, 0);
      b = d.addAtom(1, 0);
      d.addBond(a.id, d.addAtom(-L, 0).id);
      d.addBond(b.id, d.addAtom(L + 1, 0).id);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.atoms.get(a.id)![0]).toMatch(/on top of another/);
    expect(ch.atoms.get(b.id)![0]).toMatch(/on top of another/);
    // moving b away must clear a's warning too, though a itself did not change
    d.edit('move', () => d.updateAtom(b.id, { x: 0, y: L }));
    expect(ch.update()).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(ch.atoms.has(a.id)).toBe(false);
    expect(ch.atoms.has(b.id)).toBe(false);
  });
  it('finds an atom sitting on a bond, and notices when the bond moves away', () => {
    let lone!: Atom, p!: Atom;
    const d = build((d) => {
      p = d.addAtom(-L / 2, 0);
      d.addBond(p.id, d.addAtom(L / 2, 0).id);
      lone = d.addAtom(0, 0.5, 8);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.atoms.get(lone.id)![0]).toMatch(/sits on a bond/);
    d.edit('move', () => d.updateAtom(p.id, { y: L }));
    ch.update();
    expect(ch.atoms.has(lone.id)).toBe(false);
    // and a bond moved onto an atom that did not change
    d.edit('move back', () => d.updateAtom(p.id, { y: 0 }));
    ch.update();
    expect(ch.atoms.get(lone.id)![0]).toMatch(/sits on a bond/);
  });
  it('flags a lone single bond (ChemDraw: "probably not intended")', () => {
    let a!: Atom, b!: Atom;
    const d = build((d) => { a = d.addAtom(0, 0); b = d.addAtom(L, 0); d.addBond(a.id, b.id, 1, 'hash'); });
    const ch = new StructureChecks(d);
    ch.update();
    expect([...ch.bonds.values()][0][0]).toMatch(/single bond on its own/);
    d.edit('grow', () => { d.addBond(b.id, d.addAtom(2 * L, L / 2).id); });
    ch.update();
    expect(ch.bonds.size).toBe(0);
  });
  it('leaves out warnings the person chose to ignore', () => {
    const { d, c } = star(6, 5);
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.list().length).toBe(1);
    d.edit('ignore', () => d.updateAtom(c.id, { ignoreWarnings: true }));
    ch.update();
    expect(ch.forAtom(d.atoms.get(c.id)!)).toBeUndefined();
    expect(ch.list().length).toBe(0);
    expect(ch.ignoredCount()).toBe(1);
  });
  it('counts a point of attachment as a bond', () => {
    // N in a ring, bonded to a wavy attachment point: three bonds, no H, nothing wrong
    const d = build((d) => {
      const n = d.addAtom(0, 0, 7);
      d.addBond(n.id, d.addAtom(-L, 0).id);
      d.addBond(n.id, d.addAtom(L, 0).id);
      d.addBond(n.id, d.addAtom(0, L, 0, { attach: 'Wavy' }).id);
    });
    const ch = new StructureChecks(d);
    ch.update();
    expect(ch.list()).toEqual([]);
  });
});

describe('saving warning settings', () => {
  it('keeps ignored warnings, radicals and attachment points in CDXML', () => {
    const d = build((d) => {
      const c = d.addAtom(100, 100, 6, { ignoreWarnings: true });
      for (let i = 0; i < 5; i++) d.addBond(c.id, d.addAtom(100 + L * Math.cos(i), 100 + L * Math.sin(i)).id);
      const r = d.addAtom(200, 100, 6, { radical: 'doublet' });
      const n = d.addAtom(300, 100, 7);
      d.addBond(r.id, n.id);
      d.addBond(n.id, d.addAtom(300, 100 + L, 0, { attach: 'Wavy' }).id);
    });
    const xml = writeCdxml(d);
    expect(xml).toContain('IgnoreWarnings="yes"');
    expect(xml).toContain('Radical="Doublet"');
    expect(xml).toMatch(/NodeType="ExternalConnectionPoint"[^>]*ExternalConnectionType="Wavy"/);
    const back = readCdxml(xml).doc;
    const atoms = [...back.atoms.values()];
    expect(atoms.filter((a) => a.ignoreWarnings).length).toBe(1);
    expect(atoms.filter((a) => a.radical === 'doublet').length).toBe(1);
    expect(atoms.filter((a) => a.attach === 'Wavy').length).toBe(1);
  });
});
