// Showing and hiding hydrogens: CH3 at chain ends, H atoms drawn or hidden.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { addExplicitHydrogens, chainEnds, methylState, removableHydrogens, setMethylStyle, toggleChainEndLabels, toggleExplicitHydrogens, writeTerminalMethyls } from '../src/chem/hydrogens';
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

describe('Terminal methyls as CH3 or Me', () => {
  it('writes methyl ends as Me, and other chain ends with C and H', () => {
    const { doc, c1, o } = ethanol();
    // ethanol's O end is not carbon, so only C1 is a chain end
    expect(doc.edit('s', () => toggleChainEndLabels(doc, [], 'Me'))).toEqual({ count: 1, shown: true });
    expect(doc.atoms.get(c1)!.label).toBe('Me');
    expect(methylState(doc, [])).toBe('Me');
    expect(doc.atoms.get(o)!.label).toBeNull();
    // hiding takes Me off too
    expect(doc.edit('h', () => toggleChainEndLabels(doc, [], 'Me')).shown).toBe(false);
    expect(doc.atoms.get(c1)!.label).toBeNull();
    expect(doc.atoms.get(c1)!.z).toBe(6);
    expect(methylState(doc, [])).toBe('hidden');
  });

  it('switches shown ends between CH3 and Me and leaves hidden ones alone', () => {
    const { doc, c1 } = ethanol();
    doc.edit('s', () => toggleChainEndLabels(doc, [], 'CH3'));
    expect(doc.edit('m', () => setMethylStyle(doc, [], 'Me'))).toBe(1);
    expect(doc.atoms.get(c1)!.label).toBe('Me');
    expect(doc.atoms.get(c1)!.showCarbon).toBeUndefined();
    expect(doc.edit('c', () => setMethylStyle(doc, [], 'CH3'))).toBe(1);
    expect(doc.atoms.get(c1)!.label).toBeNull();
    expect(doc.atoms.get(c1)!.showCarbon).toBe(true);
    doc.edit('h', () => writeTerminalMethyls(doc, [], 'hidden'));
    expect(doc.edit('m', () => setMethylStyle(doc, [], 'Me'))).toBe(0);
    expect(doc.atoms.get(c1)!.label).toBeNull();
  });

  it('keeps a CH2 end written with C and H in the Me style', () => {
    const doc = new Doc();
    let c2 = 0;
    doc.edit('d', () => {
      const a = doc.addAtom(0, 0);
      c2 = doc.addAtom(12, 0).id;
      doc.addBond(a.id, c2, 2);
    });
    doc.edit('s', () => writeTerminalMethyls(doc, [], 'Me'));
    // ethylene's ends are CH2, not methyls
    expect(doc.atoms.get(c2)!.label).toBeNull();
    expect(doc.atoms.get(c2)!.showCarbon).toBe(true);
    expect(methylState(doc, [])).toBe('CH3');
  });
});
