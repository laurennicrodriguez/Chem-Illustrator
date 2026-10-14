// Groups written as SMILES, for nicknames of one's own and contracted labels.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { graphSmiles, selectedGroup } from '../src/chem/group-smiles';
import { addNicknames, isBuiltInNickname, labelGraph, parseSmiles, removeNickname } from '../src/chem/labels';

/** Elements in a graph, as a sorted string (enough to compare formulas without hydrogens). */
const heavy = (smi: string) => parseSmiles(smi).atoms.map((a) => a.z).sort((a, b) => a - b).join(',');

describe('group SMILES', () => {
  it('writes chains, branches and rings that read back the same', () => {
    for (const smi of ['CC(C)(C)OC(=O)', 'C1=CC=CC=C1', 'C(F)(F)F', 'OC1CCC(N)CC1', 'C1CC2CCC1CC2', '[N+](=O)[O-]']) {
      const out = graphSmiles(parseSmiles(smi));
      expect(heavy(out)).toBe(heavy(smi));
      expect(parseSmiles(out).bonds.length).toBe(parseSmiles(smi).bonds.length);
    }
  });

  it('starts at the atom where a selected group joins the structure', () => {
    // propyl-O-methyl: select O and the methyl (joined to the chain by one bond)
    const doc = new Doc();
    const ids = doc.edit('d', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(12, -7), o = doc.addAtom(24, 0, 8), m = doc.addAtom(36, -7, 6, { label: 'Ph' });
      doc.addBond(a.id, b.id, 1); doc.addBond(b.id, o.id, 1); doc.addBond(o.id, m.id, 1);
      return { a: a.id, b: b.id, o: o.id, m: m.id };
    });
    const g = selectedGroup(doc, [ids.o, ids.m]);
    expect('smiles' in g && g.smiles.startsWith('O')).toBe(true);
    // the Ph label is opened up into its ring
    if ('smiles' in g) expect(heavy(g.smiles)).toBe([6, 6, 6, 6, 6, 6, 8].join(','));
    // two bonds out of the selection: not one group
    expect('error' in selectedGroup(doc, [ids.b])).toBe(true);
  });
});

describe('nicknames of one\'s own', () => {
  it('can be added, read as chemistry, and taken away, but never replace a built-in one', () => {
    expect(labelGraph('Xyz')).toBeNull();
    expect(addNicknames({ Xyz: 'CC(C)O', Boc: 'C' })).toEqual(['Xyz']);
    expect(isBuiltInNickname('Boc')).toBe(true);
    expect(labelGraph('Xyz')!.atoms.length).toBe(4);
    expect(labelGraph('OXyz')!.atoms.length).toBe(5);
    removeNickname('Xyz');
    expect(labelGraph('Xyz')).toBeNull();
  });
});
