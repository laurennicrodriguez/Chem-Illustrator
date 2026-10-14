// @vitest-environment jsdom
//
// Dative and quadruple bonds: hydrogens, ChemDraw files, and molfiles for the chemistry engine.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { implicitHydrogens } from '../src/chem/elements';
import { toMolfile } from '../src/chem/molfile';

function adduct() {
  const doc = new Doc();
  const ids = doc.edit('a', () => {
    const n = doc.addAtom(0, 0, 7), b = doc.addAtom(14, 0, 5);
    const fs = [doc.addAtom(28, 0, 9), doc.addAtom(14, 14, 9), doc.addAtom(14, -14, 9)];
    for (const f of fs) doc.addBond(b.id, f.id, 1);
    const d = doc.addBond(n.id, b.id, 1, 'dative');
    return { n: n.id, b: b.id, d: d.id };
  });
  return { doc, ...ids };
}

describe('dative bonds', () => {
  it('leave the hydrogens of both atoms alone (H3N→BF3)', () => {
    const { doc, n, b } = adduct();
    expect(implicitHydrogens(7, doc.valenceSum(n), 0)).toBe(3);
    expect(implicitHydrogens(5, doc.valenceSum(b), 0)).toBe(0);
  });

  it('are left out of the molfile, so the chemistry sees two whole molecules', () => {
    const { doc } = adduct();
    const mol = toMolfile(doc, [...doc.atoms.keys()]).molblock;
    const counts = mol.split('\n')[3];
    expect(Number(counts.slice(3, 6))).toBe(3);
  });

  it('keep their direction through a ChemDraw file', () => {
    const { doc } = adduct();
    const text = writeCdxml(doc);
    expect(text).toMatch(/Order="dative"/);
    const back = readCdxml(text).doc;
    const bond = [...back.bonds.values()].find((x) => x.display === 'dative')!;
    expect(back.atoms.get(bond.a1)!.z).toBe(7);
    expect(back.atoms.get(bond.a2)!.z).toBe(5);
  });
});

describe('quadruple bonds', () => {
  it('are read and written as order 4', () => {
    const doc = new Doc();
    doc.edit('q', () => { const a = doc.addAtom(0, 0, 42), b = doc.addAtom(14, 0, 42); doc.addBond(a.id, b.id, 4); });
    const text = writeCdxml(doc);
    expect(text).toMatch(/Order="4"/);
    expect([...readCdxml(text).doc.bonds.values()][0].order).toBe(4);
  });
});
