// Showing and hiding hydrogens: CH3 at chain ends, H atoms drawn or hidden.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { addExplicitHydrogens, chainEnds, removableHydrogens, toggleChainEndLabels, toggleExplicitHydrogens } from '../src/chem/hydrogens';
import { labelSpec } from '../src/chem/labels';

/** Ethanol drawn as C–C–O. */
function ethanol() {
  const doc = new Doc();
  const [c1, c2, o] = doc.edit('e', () => {
    const c1 = doc.addAtom(0, 0), c2 = doc.addAtom(12, -7), o = doc.addAtom(24, 0, 8);
    doc.addBond(c1.id, c2.id, 1); doc.addBond(c2.id, o.id, 1);
    return [c1.id, c2.id, o.id];
  });
  return { doc, c1, c2, o };
}

describe('CH3 at chain ends', () => {
  it('writes out the end carbon and takes it off again', () => {
    const { doc, c1 } = ethanol();
    expect(chainEnds(doc, [])).toEqual([c1]);
    const r = doc.edit('s', () => toggleChainEndLabels(doc, []));
    expect(r).toEqual({ count: 1, shown: true });
    const a = doc.atoms.get(c1)!;
    const spec = labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(c1), doc.degree(c1), true, !!a.showCarbon)!;
    expect(spec.tokens[0].text).toBe('C');
    expect(spec.hCount).toBe(3);
    expect(doc.edit('h', () => toggleChainEndLabels(doc, [])).shown).toBe(false);
    expect(doc.atoms.get(c1)!.showCarbon).toBeUndefined();
  });
});

describe('H atoms', () => {
  it('draws an atom\'s hydrogens as atoms and hides them again', () => {
    const { doc, c2, o } = ethanol();
    expect(doc.edit('a', () => addExplicitHydrogens(doc, [c2, o]))).toBe(3);
    expect(doc.atoms.size).toBe(6);
    // the O–H stays (on a heteroatom); the two on carbon go
    expect(removableHydrogens(doc, [])).toHaveLength(2);
    expect(doc.edit('r', () => toggleExplicitHydrogens(doc, []))).toEqual({ removed: 2, added: 0 });
    expect(doc.atoms.size).toBe(4);
  });

  it('keeps an H on a wedge, which shows the stereochemistry', () => {
    const { doc, c2 } = ethanol();
    doc.edit('w', () => { const h = doc.addAtom(12, -19, 1); doc.addBond(c2, h.id, 1, 'wedge'); });
    expect(removableHydrogens(doc, [])).toEqual([]);
  });
});
