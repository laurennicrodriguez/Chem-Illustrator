// @vitest-environment jsdom
//
// Electron counting (Analysis panel): L, X and Z ligands, oxidation state, dⁿ and the electron
// count, for complexes drawn with ligand labels, with drawn ligands and through hapto bonds.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { countElectrons, roman } from '../src/chem/electrons';
import { bondHapto } from '../src/chem/hapto';

/** A metal of atomic number z with labelled ligands round it; returns the doc and the metal's id. */
function complex(z: number, ligands: (string | [string, number])[], charge = 0) {
  const doc = new Doc();
  const m = doc.edit('m', () => {
    const metal = doc.addAtom(0, 0, z, { charge });
    ligands.forEach((l, i) => {
      const [label, order] = typeof l === 'string' ? [l, 1] : l;
      const ang = (i / ligands.length) * 2 * Math.PI;
      const a = doc.addAtom(20 * Math.cos(ang), 20 * Math.sin(ang), 6, { label });
      doc.addBond(metal.id, a.id, order);
    });
    return metal.id;
  });
  return { doc, m };
}

const one = (doc: Doc, m: number) => countElectrons(doc, m)[0];

/** A ring of n carbons about (cx, cy), alternating double bonds left to the caller (all 1.5 here). */
function ring(doc: Doc, n: number, cx: number, cy: number): number[] {
  const ids = Array.from({ length: n }, (_, k) => doc.addAtom(cx + 14 * Math.cos((2 * Math.PI * k) / n), cy + 14 * Math.sin((2 * Math.PI * k) / n)).id);
  ids.forEach((id, k) => doc.addBond(id, ids[(k + 1) % n], 1.5));
  return ids;
}

describe('electron counting', () => {
  it("Wilkinson's catalyst, RhCl(PPh3)3: ML3X, Rh(I), d8, 16 electrons", () => {
    const { doc, m } = complex(45, ['PPh3', 'PPh3', 'PPh3', 'Cl']);
    const c = one(doc, m);
    expect([c.l, c.x, c.oxidation, c.dn, c.electrons]).toEqual([3, 1, 1, 8, 16]);
    expect(c.classification).toBe('ML₃X');
    expect(c.ligands.find((r) => r.name === 'PPh3')!.count).toBe(3);
  });

  it('Pd(PPh3)4 is Pd(0), d10, 18 electrons', () => {
    const { doc, m } = complex(46, ['PPh3', 'PPh3', 'PPh3', 'PPh3']);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons]).toEqual([0, 10, 18]);
  });

  it("Vaska's complex, IrCl(CO)(PPh3)2: Ir(I), 16 electrons; CO is an L ligand", () => {
    const { doc, m } = complex(77, ['Cl', 'CO', 'PPh3', 'PPh3']);
    const c = one(doc, m);
    expect([c.l, c.x, c.oxidation, c.electrons]).toEqual([3, 1, 1, 16]);
  });

  it('Cp2ZrCl2 written with Cp labels: ML4X4, Zr(IV), d0, 16 electrons', () => {
    const { doc, m } = complex(40, ['Cp', 'Cp', 'Cl', 'Cl']);
    const c = one(doc, m);
    expect([c.l, c.x, c.oxidation, c.dn, c.electrons]).toEqual([4, 4, 4, 0, 16]);
  });

  it('ferrocene through two η5 bonds: Fe(II), d6, 18 electrons', () => {
    const doc = new Doc();
    const fe = doc.edit('fc', () => {
      const fe = doc.addAtom(0, 0, 26);
      bondHapto(doc, fe.id, ring(doc, 5, 0, -30));
      bondHapto(doc, fe.id, ring(doc, 5, 0, 30));
      return fe.id;
    });
    const c = one(doc, fe);
    expect([c.l, c.x, c.oxidation, c.dn, c.electrons]).toEqual([4, 2, 2, 6, 18]);
    expect(c.ligands[0].hapto).toBe(5);
    expect(c.ligands[0].count).toBe(2);
  });

  it('(η6-benzene)Cr(CO)3 with drawn C≡O: Cr(0), 18 electrons', () => {
    const doc = new Doc();
    const cr = doc.edit('cr', () => {
      const cr = doc.addAtom(0, 0, 24);
      bondHapto(doc, cr.id, ring(doc, 6, 0, -30));
      for (let k = 0; k < 3; k++) {
        const c = doc.addAtom(-14 + 14 * k, 20), o = doc.addAtom(-14 + 14 * k, 34, 8);
        doc.addBond(cr.id, c.id);
        doc.addBond(c.id, o.id, 3);
      }
      return cr.id;
    });
    const c = one(doc, cr);
    expect([c.l, c.x, c.oxidation, c.electrons]).toEqual([6, 0, 0, 18]);
  });

  it('a cation, [Mn(CO)6]+: Mn(I), d6, 18 electrons', () => {
    const { doc, m } = complex(25, ['CO', 'CO', 'CO', 'CO', 'CO', 'CO'], 1);
    const c = one(doc, m);
    expect([c.oxidation, c.dn, c.electrons]).toEqual([1, 6, 18]);
    expect(c.classification).toBe('[ML₆]⁺');
  });

  it('a chloride-bridged dimer, [Rh(CO)2Cl]2: each Cl is X to one Rh and L to the other, 16 electrons each', () => {
    const doc = new Doc();
    const [r1, r2] = doc.edit('d', () => {
      const r1 = doc.addAtom(0, 0, 45), r2 = doc.addAtom(40, 0, 45);
      const c1 = doc.addAtom(20, -15, 17, { label: 'Cl' }), c2 = doc.addAtom(20, 15, 17, { label: 'Cl' });
      for (const r of [r1, r2]) for (const c of [c1, c2]) doc.addBond(r.id, c.id);
      for (const [r, dx] of [[r1, -1], [r2, 1]] as const) for (const dy of [-1, 1]) {
        const co = doc.addAtom(r.x + 15 * dx, 15 * dy, 6, { label: 'CO' });
        doc.addBond(r.id, co.id);
      }
      return [r1.id, r2.id];
    });
    for (const c of countElectrons(doc, r1)) expect([c.oxidation, c.electrons]).toEqual([1, 16]);
    expect(countElectrons(doc, r2).length).toBe(2);
  });

  it('a metal–metal bond gives each metal one electron: Mn2(CO)10, 18 each', () => {
    const doc = new Doc();
    const m1 = doc.edit('mm', () => {
      const a = doc.addAtom(0, 0, 25), b = doc.addAtom(30, 0, 25);
      doc.addBond(a.id, b.id);
      for (const m of [a, b]) for (let k = 0; k < 5; k++) doc.addBond(m.id, doc.addAtom(m.x, 15 + 5 * k, 6, { label: 'CO' }).id);
      return a.id;
    });
    for (const c of countElectrons(doc, m1)) expect([c.oxidation, c.electrons]).toEqual([0, 18]);
  });

  it('an alkylidene drawn M=C counts X2 (Grubbs I: 16 electrons)', () => {
    const doc = new Doc();
    const ru = doc.edit('g', () => {
      const ru = doc.addAtom(0, 0, 44);
      const c = doc.addAtom(20, 0);
      doc.addBond(ru.id, c.id, 2);
      doc.addBond(c.id, doc.addAtom(34, 0, 6, { label: 'Ph' }).id);
      for (const l of ['Cl', 'Cl', 'PCy3', 'PCy3']) doc.addBond(ru.id, doc.addAtom(0, 20, 6, { label: l }).id);
      return ru.id;
    });
    const c = one(doc, ru);
    expect([c.l, c.x, c.oxidation, c.electrons]).toEqual([2, 4, 4, 16]);
  });

  it('a metal label with its ligands written in: PdCl2 and Pd(PPh3)4', () => {
    const lone = (label: string) => {
      const doc = new Doc();
      const id = doc.edit('p', () => doc.addAtom(0, 0, 46, { label }).id);
      return one(doc, id);
    };
    expect([lone('PdCl2').oxidation, lone('PdCl2').electrons]).toEqual([2, 12]);
    expect([lone('Pd(PPh3)4').oxidation, lone('Pd(PPh3)4').electrons]).toEqual([0, 18]);
  });

  it('a donor drawn with a dative arrow is L; a Lewis acid taking the metal\'s pair is Z', () => {
    const doc = new Doc();
    const pt = doc.edit('z', () => {
      const pt = doc.addAtom(0, 0, 78);
      const n = doc.addAtom(20, 0, 7, { label: 'NH3' });
      doc.addBond(n.id, pt.id, 1, 'dative');
      const b = doc.addAtom(-20, 0, 5, { label: 'BF3' });
      doc.addBond(pt.id, b.id, 1, 'dative');
      return pt.id;
    });
    const c = one(doc, pt);
    expect([c.l, c.z]).toEqual([1, 1]);
    expect(c.classification).toBe('MLZ');
  });

  it('writes oxidation states as Roman numerals', () => {
    expect([roman(0), roman(1), roman(2), roman(4), roman(-1), roman(9)]).toEqual(['0', 'I', 'II', 'IV', '−I', 'IX']);
  });
});
