// @vitest-environment jsdom
//
// Templates and nicknames of one's own, and contracted labels in ChemDraw files.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { parseOwnTemplates, setOwnTemplates, templateById, templateFromAtoms } from '../src/chem/templates';
import { parseSettings, settingsText, DEFAULT_SETTINGS } from '../src/settings';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { labelGraph, removeNickname } from '../src/chem/labels';

/** Cyclohexanone with a methyl, drawn at bond length 14.4. */
function drawing() {
  const doc = new Doc();
  const L = doc.style.bondLength;
  doc.edit('d', () => {
    const ring = Array.from({ length: 6 }, (_, i) => doc.addAtom(100 + L * Math.cos((i * Math.PI) / 3), 50 + L * Math.sin((i * Math.PI) / 3)));
    ring.forEach((a, i) => doc.addBond(a.id, ring[(i + 1) % 6].id, 1));
    const o = doc.addAtom(100 + 2 * L, 50, 8);
    doc.addBond(ring[0].id, o.id, 2);
  });
  return doc;
}

describe('own templates', () => {
  it('are made one bond long, centred, joining at an end atom and fusing on a ring bond', () => {
    const doc = drawing();
    const t = templateFromAtoms(doc, doc.atoms.keys(), 'Cyclohexanone', 'own-1')!;
    expect(t.atoms).toHaveLength(7);
    expect(t.bonds).toHaveLength(7);
    const cx = t.atoms.reduce((s, a) => s + a[0], 0) / 7, cy = t.atoms.reduce((s, a) => s + a[1], 0) / 7;
    expect(Math.abs(cx)).toBeLessThan(1e-2);
    expect(Math.abs(cy)).toBeLessThan(1e-2);
    const [p, q] = [t.atoms[t.bonds[0][0]], t.atoms[t.bonds[0][1]]];
    expect(Math.hypot(p[0] - q[0], p[1] - q[1])).toBeCloseTo(1, 2);
    expect(t.atoms[t.attach][2]).toBe('O');
    expect(t.fuse).toBeDefined();
  });

  it('are kept in the settings file and come back', () => {
    const doc = drawing();
    const t = templateFromAtoms(doc, doc.atoms.keys(), 'Cyclohexanone', 'own-1')!;
    const text = settingsText({ ...DEFAULT_SETTINGS, templates: [t], nicknames: { Chx: 'C1CCCCC1' } });
    const back = parseSettings(text);
    expect(back.templates).toEqual([t]);
    expect(back.nicknames).toEqual({ Chx: 'C1CCCCC1' });
    setOwnTemplates(back.templates);
    expect(templateById('own-1')?.name).toBe('Cyclohexanone');
    // broken entries are dropped
    expect(parseOwnTemplates([{ id: 'x', name: 'x', atoms: [[0, 0, 'C']], bonds: [[0, 5, 1]] }, 'nonsense'])).toEqual([]);
  });
});

describe('contracted labels', () => {
  it('bring their group back from a ChemDraw file', () => {
    const doc = new Doc();
    doc.edit('d', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(14, 0, 6, { label: 'Qzx', group: 'c1ccc(OC)cc1' });
      doc.addBond(a.id, b.id, 1);
    });
    const text = writeCdxml(doc);
    removeNickname('Qzx');
    const back = readCdxml(text).doc;
    const atom = [...back.atoms.values()].find((a) => a.label === 'Qzx')!;
    expect(atom.group).toBe('c1ccc(OC)cc1');
    expect(labelGraph('Qzx')!.atoms.length).toBe(8);
  });
});
