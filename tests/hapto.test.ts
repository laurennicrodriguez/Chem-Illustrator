// @vitest-environment jsdom
//
// Hapto (η) bonds: a metal bonded to the middle of a ring or π-bond through a multicentre
// point, which follows its atoms, goes with them, and is saved as ChemDraw's MultiAttachment.

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { toMolfile } from '../src/chem/molfile';
import { bondHapto, haptoTarget, haptoText, splitHapto } from '../src/chem/hapto';
import { extractDrawing, insertDrawing } from '../src/io/clipboard';
import { StructureChecks } from '../src/chem/warnings';

/** A cyclopentadienyl ring (drawn with a circle) above an iron atom, bonded η⁵. */
function cpFe() {
  const doc = new Doc();
  const L = doc.style.bondLength;
  const ids = doc.edit('a', () => {
    const ring: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t = (-90 + i * 72) * Math.PI / 180;
      ring.push(doc.addAtom(Math.cos(t) * L * 0.85, Math.sin(t) * L * 0.85 - 30).id);
    }
    for (let i = 0; i < 5; i++) doc.addBond(ring[i], ring[(i + 1) % 5], 1.5, 'solid', { circle: true });
    const fe = doc.addAtom(0, 0, 26).id;
    const b = bondHapto(doc, fe, ring)!;
    return { ring, fe, bond: b.id };
  });
  return { doc, ...ids };
}

const centreOf = (doc: Doc) => [...doc.atoms.values()].find((a) => a.multi)!;

describe('hapto bonds', () => {
  it('end at a multicentre point in the middle of the ring', () => {
    const { doc, ring } = cpFe();
    const c = centreOf(doc);
    expect(c.multi).toEqual(ring);
    expect(c.x).toBeCloseTo(0, 6);
    expect(c.y).toBeCloseTo(-30, 6);
    expect(haptoText(c.multi!.length)).toBe('η⁵');
  });

  it('follow the ring when it moves, in one undo step', () => {
    const { doc, ring } = cpFe();
    const before = { ...centreOf(doc) };
    doc.edit('Move', () => doc.moveAtoms(ring, 10, 5));
    expect(centreOf(doc).x).toBeCloseTo(before.x + 10, 6);
    expect(centreOf(doc).y).toBeCloseTo(before.y + 5, 6);
    doc.undo();
    expect(centreOf(doc).x).toBeCloseTo(before.x, 6);
  });

  it('stay in the middle when moved with the ring and the metal together', () => {
    const { doc, ring, fe } = cpFe();
    const c = centreOf(doc);
    const x0 = c.x;
    doc.edit('Move', () => doc.moveAtoms([c.id, ...ring, fe], 7, 0));
    expect(centreOf(doc).x).toBeCloseTo(x0 + 7, 6);
  });

  it('go when the ring goes, or when the metal does', () => {
    let { doc, ring } = cpFe();
    doc.edit('Erase', () => { for (const id of ring.slice(0, 4)) doc.removeAtom(id); });
    expect(centreOf(doc)).toBeUndefined();
    ({ doc } = cpFe());
    const fe = [...doc.atoms.values()].find((a) => a.z === 26)!.id;
    doc.edit('Erase', () => doc.removeAtom(fe));
    expect(centreOf(doc)).toBeUndefined();
  });

  it('lose an atom of the ring, becoming η⁴', () => {
    const { doc, ring } = cpFe();
    doc.edit('Erase', () => doc.removeAtom(ring[0]));
    expect(centreOf(doc).multi).toEqual(ring.slice(1));
  });

  it('make the metal and the ring one structure', () => {
    const { doc, ring, fe } = cpFe();
    expect(doc.fragmentOf(fe).has(ring[2])).toBe(true);
    expect(doc.fragmentOf(ring[2]).has(fe)).toBe(true);
  });

  it('are left out of the molfile, as is the ring\'s middle', () => {
    const { doc } = cpFe();
    const mol = toMolfile(doc, doc.fragmentOf(doc.atoms.keys().next().value!)).molblock;
    const counts = mol.split('\n')[3];
    expect(Number(counts.slice(0, 3))).toBe(6);
    expect(Number(counts.slice(3, 6))).toBe(5);
    expect(mol).not.toMatch(/ \* /);
  });

  it('give no warnings on the ring\'s middle or the metal', () => {
    const { doc } = cpFe();
    const checks = new StructureChecks(doc);
    checks.update();
    expect(checks.list()).toEqual([]);
  });

  it('are saved as a MultiAttachment node and read back', () => {
    const { doc, ring } = cpFe();
    const text = writeCdxml(doc);
    expect(text).toMatch(/NodeType="MultiAttachment"/);
    expect(text).toMatch(new RegExp(`Attachments="${ring.join(' ')}"`));
    const back = readCdxml(text).doc;
    const c = centreOf(back);
    expect(c.multi!.length).toBe(5);
    expect(back.degree(c.id)).toBe(1);
    const fe = back.neighbors(c.id)[0];
    expect(fe.z).toBe(26);
    // and saved again unchanged
    expect(writeCdxml(back)).toBe(text);
  });

  it('read ChemDraw\'s MultiAttachment, whichever order the nodes come in', () => {
    const cdxml = `<?xml version="1.0"?><CDXML><page id="1"><fragment id="2">
      <n id="30" p="100 100" NodeType="MultiAttachment" Attachments="10 11"/>
      <n id="10" p="90 100"/><n id="11" p="110 100"/><n id="12" p="100 120" Element="46"/>
      <b id="20" B="10" E="11" Order="2"/><b id="21" B="12" E="30"/></fragment></page></CDXML>`;
    const doc = readCdxml(cdxml).doc;
    const c = doc.atoms.get(30)!;
    expect(c.multi).toEqual([10, 11]);
    expect(doc.bondBetween(12, 30)).toBeTruthy();
  });

  it('can be drawn to each atom instead, and that is kept in the file', () => {
    const { doc, bond } = cpFe();
    doc.edit('s', () => doc.updateBond(bond, { spokes: true }));
    const back = readCdxml(writeCdxml(doc)).doc;
    expect([...back.bonds.values()].some((b) => b.spokes)).toBe(true);
  });

  it('split into a bond to each atom', () => {
    const { doc, bond, fe } = cpFe();
    doc.edit('Split', () => splitHapto(doc, bond));
    expect(centreOf(doc)).toBeUndefined();
    expect(doc.degree(fe)).toBe(5);
  });

  it('are copied with their ring and metal', () => {
    const { doc, fe } = cpFe();
    const sel = { atoms: new Set(doc.fragmentOf(fe)), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const part = extractDrawing(doc, sel);
    const got = insertDrawing(doc, part, { x: 100, y: 100 });
    const centres = [...doc.atoms.values()].filter((a) => a.multi);
    expect(centres.length).toBe(2);
    const copy = centres.find((c) => got.atoms.has(c.id))!;
    expect(copy.multi!.every((m) => got.atoms.has(m))).toBe(true);
  });

  it('a copied metal brings the ring it is bonded to', () => {
    const { doc, fe, bond } = cpFe();
    const sel = { atoms: new Set([fe]), bonds: new Set([bond]), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const part = extractDrawing(doc, sel);
    expect(part.atoms.size).toBe(7);
  });
});

describe('finding what a hapto bond goes to', () => {
  it('finds the ring round a point, a bond under it, or a point already there', () => {
    const { doc, ring } = cpFe();
    const c = centreOf(doc);
    expect(haptoTarget(doc, { x: c.x, y: c.y })?.centre?.id).toBe(c.id);
    expect(haptoTarget(doc, { x: c.x + 2, y: c.y + 3 })?.atoms).toEqual(ring);
    const p = doc.atoms.get(ring[1])!, q = doc.atoms.get(ring[2])!;
    expect(haptoTarget(doc, { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 })?.atoms.sort()).toEqual([ring[1], ring[2]].sort());
    expect(haptoTarget(doc, { x: 200, y: 200 })).toBeNull();
  });
});

describe('atoms bonded to metals', () => {
  const metalWith = (build: (doc: Doc, m: number) => number) => {
    const doc = new Doc();
    const id = doc.edit('a', () => build(doc, doc.addAtom(0, 0, 46).id));
    return { doc, id };
  };

  it('a phosphine stays P (no PH), and a bridging chloride Cl', () => {
    const { doc, id } = metalWith((d, m) => {
      const p = d.addAtom(14, 0, 15);
      for (let i = 0; i < 3; i++) d.addBond(p.id, d.addAtom(28, i * 10, 6).id);
      d.addBond(m, p.id);
      return p.id;
    });
    expect(doc.valenceSum(id)).toBe(3);
    const { doc: d2, id: cl } = metalWith((d, m) => {
      const c = d.addAtom(14, 10, 17);
      const m2 = d.addAtom(28, 0, 46);
      d.addBond(m, c.id); d.addBond(m2.id, c.id);
      return c.id;
    });
    expect(d2.valenceSum(cl)).toBe(1);
    const checks = new StructureChecks(d2);
    checks.update();
    expect(checks.list()).toEqual([]);
  });

  it('a methyl on a metal is still CH3, and a hydroxide OH', () => {
    const { doc, id } = metalWith((d, m) => { const c = d.addAtom(14, 0); d.addBond(m, c.id); return c.id; });
    expect(doc.valenceSum(id)).toBe(1);
    const { doc: d2, id: o } = metalWith((d, m) => { const c = d.addAtom(14, 0, 8); d.addBond(m, c.id); return c.id; });
    expect(d2.valenceSum(o)).toBe(1);
  });

  it('a metal with many bonds gets no valence warning', () => {
    const { doc } = metalWith((d, m) => { for (let i = 0; i < 6; i++) d.addBond(m, d.addAtom(14 * Math.cos(i), 14 * Math.sin(i), 17).id); return m; });
    const checks = new StructureChecks(doc);
    checks.update();
    expect(checks.list()).toEqual([]);
  });

  it('a magnesium holding two THF and a bromide gets no warning either', () => {
    const doc = new Doc();
    doc.edit('a', () => {
      const mg = doc.addAtom(0, 0, 12);
      doc.addBond(mg.id, doc.addAtom(14, 0, 35).id);
      doc.addBond(mg.id, doc.addAtom(-14, 0).id);
      for (const y of [14, -14]) doc.addBond(mg.id, doc.addAtom(0, y, 6, { label: 'THF' }).id);
    });
    const checks = new StructureChecks(doc);
    checks.update();
    expect(checks.list()).toEqual([]);
  });
});

describe('formulas of metal complexes (the chemistry engine)', () => {
  let RDKit: any;
  beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
  const formula = (doc: Doc) => {
    const m = RDKit.get_mol(toMolfile(doc, [...doc.atoms.keys()]).molblock);
    try { return JSON.parse(m.get_descriptors()).NumHeavyAtoms !== undefined ? RDKit.get_mol(m.get_smiles()).get_smiles() : ''; } finally { m.delete(); }
  };
  const hCount = (doc: Doc) => {
    const m = RDKit.get_mol(toMolfile(doc, [...doc.atoms.keys()]).molblock);
    try { const mh = RDKit.get_mol(m.get_molblock()); const n = JSON.parse(mh.get_json()).molecules[0].atoms.reduce((s: number, a: any) => s + (a.impHs ?? 0), 0); mh.delete(); return n; } finally { m.delete(); }
  };

  it('labels on a metal keep their hydrogens: Pd(PPh3)(THF)(NH3)Cl(Me)', () => {
    const doc = new Doc();
    doc.edit('a', () => {
      const pd = doc.addAtom(0, 0, 46);
      for (const [i, label] of ['PPh3', 'THF', 'NH3', 'Cl', 'Me', 'COD'].entries()) doc.addBond(pd.id, doc.addAtom(14 * Math.cos(i), 14 * Math.sin(i), 6, { label }).id);
    });
    const smi = formula(doc);
    expect(smi).toContain('Pd');
    // PPh3 15 H, THF 8, NH3 3, Me 3, COD 12
    expect(hCount(doc)).toBe(15 + 8 + 3 + 3 + 12);
  });

  it('CO labels on a metal are carbon monoxide, not formyl: (benzene)Cr(CO)3', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    doc.edit('a', () => {
      const ring: number[] = [];
      for (let i = 0; i < 6; i++) ring.push(doc.addAtom(Math.cos(i * Math.PI / 3) * L, Math.sin(i * Math.PI / 3) * L - 30).id);
      for (let i = 0; i < 6; i++) doc.addBond(ring[i], ring[(i + 1) % 6], i % 2 ? 1 : 2);
      const cr = doc.addAtom(0, 0, 24).id;
      bondHapto(doc, cr, ring);
      for (const [i, label] of ['CO', 'OC', 'CO'].entries()) doc.addBond(cr, doc.addAtom(14 * Math.cos(i + 1), 14 * Math.sin(i + 1), 6, { label }).id, 1, i === 2 ? 'dative' : 'solid');
    });
    // six ring hydrogens and none on the carbonyls
    expect(hCount(doc)).toBe(6);
    expect(formula(doc)).toContain('[O+]');
  });

  it('a drawn phosphine and a bridging chloride keep theirs too', () => {
    const doc = new Doc();
    doc.edit('a', () => {
      const pd = doc.addAtom(0, 0, 46), pd2 = doc.addAtom(28, 0, 46);
      const p = doc.addAtom(-14, 0, 15);
      for (let i = 0; i < 3; i++) doc.addBond(p.id, doc.addAtom(-28, i * 10).id);
      doc.addBond(pd.id, p.id);
      const cl = doc.addAtom(14, 10, 17);
      doc.addBond(pd.id, cl.id); doc.addBond(pd2.id, cl.id);
    });
    // three methyls on P: 9 H, and none on P or Cl
    expect(hCount(doc)).toBe(9);
  });
});
