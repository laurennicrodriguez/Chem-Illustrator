// @vitest-environment jsdom
//
// Partial bonds (order 0.5, drawn dashed): the bonds forming and breaking in a transition state.
// They leave both atoms' hydrogens as they were, are kept in CDXML, and stay out of the molfile.

import { describe, expect, it } from 'vitest';
import { Doc, PARTIAL, outsideValence } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { atomWarnings } from '../src/chem/warnings';

/** HO···CH3···Br, the SN2 transition state, drawn with carbon's three H as implicit. */
function sn2() {
  const doc = new Doc();
  const ids = doc.edit('ts', () => {
    const o = doc.addAtom(0, 0, 8, { label: 'HO' });
    const c = doc.addAtom(30, 0);
    const br = doc.addAtom(60, 0, 35, { label: 'Br' });
    doc.addBond(o.id, c.id, PARTIAL, 'dash');
    doc.addBond(c.id, br.id, PARTIAL, 'dash');
    return { o: o.id, c: c.id, br: br.id };
  });
  return { doc, ...ids };
}

describe('partial bonds', () => {
  it('count toward neither atom\'s valence', () => {
    const { doc, c, br } = sn2();
    expect(outsideValence(doc.bonds.values().next().value!)).toBe(true);
    expect(doc.valenceSum(c)).toBe(0);
    expect(doc.bondOrderSum(br)).toBe(0);
  });

  it('are saved to CDXML as Order 0.5 and come back dashed', () => {
    const { doc } = sn2();
    const xml = writeCdxml(doc);
    expect(xml).toMatch(/Order="0.5"/);
    const back = readCdxml(xml).doc;
    const bonds = [...back.bonds.values()];
    expect(bonds.length).toBe(2);
    for (const b of bonds) {
      expect(b.order).toBe(PARTIAL);
      expect(b.display).toBe('dash');
    }
  });

  it('are left out of the molfile, so the chemistry engine sees the separate pieces', () => {
    const { doc, o, c, br } = sn2();
    const mb = toMolfile(doc, [o, c, br]).molblock;
    const counts = mb.split('\n')[3];
    expect(Number(counts.slice(3, 6))).toBe(0);
  });

  it('raise no valence warning: the atoms are part way between bonded and not', () => {
    const { doc, o, br } = sn2();
    expect(atomWarnings(doc, doc.atoms.get(br)!)).toEqual([]);
    expect(atomWarnings(doc, doc.atoms.get(o)!)).toEqual([]);
  });
});
