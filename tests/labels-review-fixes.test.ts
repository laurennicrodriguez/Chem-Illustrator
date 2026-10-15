// Atom labels from the code review: C(O)Me and P(O)Ph2 (a bracketed O is C=O), CHCl2 and SiCl3
// (each halogen on the atom before), and NMe3+ (the charge on the N).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { formulaFromJson } from '../src/chem/formula';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

/** The formula of CH3 bonded to a label, as RDKit reads it ('INVALID' when it can't). */
function formulaOf(label: string): string {
  const doc = new Doc();
  doc.edit('e', () => { const c = doc.addAtom(0, 0, 6); const x = doc.addAtom(14, 0, 6, { label }); doc.addBond(c.id, x.id); });
  const m = RDKit.get_mol(toMolfile(doc, doc.atoms.keys()).molblock);
  try {
    return m && m.is_valid() ? formulaFromJson(m.get_json()).formula : 'INVALID';
  } finally {
    m?.delete();
  }
}

describe('labels', () => {
  it('reads a bracketed O as a C=O', () => {
    expect(formulaOf('C(O)Me')).toBe('C3H6O');
    expect(formulaOf('C(O)NH2')).toBe('C2H5NO');
    expect(formulaOf('C(O)OMe')).toBe('C3H6O2');
    expect(formulaOf('C(O)H')).toBe('C2H4O');
    expect(formulaOf('P(O)(OEt)2')).toBe('C5H13O3P');
    expect(formulaOf('P(O)Ph2')).toBe('C13H13OP');
    // (CH2)3 and (OH)2 are as before
    expect(formulaOf('C(OH)2')).toBe('C2H6O2');
  });

  it('puts each halogen on the atom before', () => {
    expect(formulaOf('CHCl2')).toBe('C2H4Cl2');
    expect(formulaOf('CBr3')).toBe('C2H3Br3');
    expect(formulaOf('CI3')).toBe('C2H3I3');
    expect(formulaOf('SiCl3')).toBe('CH3Cl3Si');
    expect(formulaOf('CF3')).toBe('C2H3F3');
  });

  it('puts a charge written after groups on the atom they hang from', () => {
    expect(formulaOf('NMe3+')).toBe('C4H12N+');
    expect(formulaOf('PPh3+')).toBe('C19H18P+');
  });
});

describe('molfiles read in (pasted SMILES, names, PubChem)', () => {
  it('keep isotope labels and radicals', async () => {
    const { addMolfile } = await import('../src/chem/molfile');
    const read = (smiles: string) => {
      const m = RDKit.get_mol(smiles);
      const mb = m.get_molblock();
      m.delete();
      const doc = new Doc();
      doc.edit('paste', () => addMolfile(doc, mb, 0, 0));
      return [...doc.atoms.values()];
    };
    expect(read('[13CH3]C(=O)O').map((a) => a.isotope)).toContain(13);
    expect(read('CC[CH2]').some((a) => a.radical === 'doublet')).toBe(true);
  });
});

describe('a selection as a group', () => {
  it('writes the hydrogens of atoms in brackets', async () => {
    const { selectedGroup } = await import('../src/chem/group-smiles');
    const doc = new Doc();
    let ids: number[] = [];
    doc.edit('e', () => {
      const c = doc.addAtom(0, 0, 6);
      const o = doc.addAtom(14, 0, 8);
      const me = doc.addAtom(28, 0, 6, { isotope: 13 });
      const n = doc.addAtom(42, 0, 7, { charge: 1 });
      doc.addBond(c.id, o.id); doc.addBond(o.id, me.id); doc.addBond(me.id, n.id);
      ids = [o.id, me.id, n.id];
    });
    const g = selectedGroup(doc, ids);
    expect('smiles' in g && g.smiles).toBe('O[13CH2][NH3+]');
  });
});
