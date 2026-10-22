// @vitest-environment jsdom
//
// Templates for metal complexes: coordination geometries, sandwich and half-sandwich complexes
// (with hapto bonds to their rings) and ligands that go on a metal that is clicked.

import { beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { Doc } from '../src/model';
import { TEMPLATES, atomPlacements, freePlacement, placeTemplate, templateById, templateFromAtoms, templatePoints, parseOwnTemplates, type Template } from '../src/chem/templates';
import { countElectrons } from '../src/chem/electrons';
import { StructureChecks } from '../src/chem/warnings';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { templateIcon } from '../src/ui/template-icons';
import { expandLigand, expandWithMolblock, labelSmiles, miniSmiles } from '../src/chem/expand';
import { labelGraph } from '../src/chem/labels';
import { toMolfile } from '../src/chem/molfile';

const METAL = TEMPLATES.filter((t) => t.group === 'geometries' || t.group === 'organometallic' || t.group === 'metallocenes' || t.group === 'ligands');

function place(t: Template, doc = new Doc()) {
  const ids = doc.edit('Template', () => placeTemplate(doc, t, freePlacement({ x: 200, y: 200 }, doc.style.bondLength)));
  return { doc, ids };
}

const centres = (doc: Doc) => [...doc.atoms.values()].filter((a) => a.multi);

describe('metal complex templates', () => {
  it('cover the geometries, the sandwich complexes and the ligands asked for', () => {
    const ids = new Set(METAL.map((t) => t.id));
    for (const id of ['square-planar', 'tetrahedral', 'tbp', 'square-pyramidal', 'octahedral', 'ferrocene', 'bent-metallocene', 'cpml3',
      'pph3', 'dppf', 'binap', 'cpstar', 'cod', 'co', 'imes', 'bipy', 'acac']) expect(ids).toContain(id);
  });

  it('every one goes in without a chemistry warning', () => {
    for (const t of METAL) {
      const { doc } = place(t);
      const checks = new StructureChecks(doc);
      checks.update();
      expect(checks.list().map((w) => `${t.id}: ${w.text ?? JSON.stringify(w)}`)).toEqual([]);
    }
  });

  it('every one has a picture for its palette', () => {
    for (const t of METAL) expect(templateIcon(t, 56)).toMatch(/^<svg/);
  });

  it('ferrocene has a hapto bond from the iron to the middle of each ring', () => {
    const { doc } = place(templateById('ferrocene')!);
    const cs = centres(doc);
    expect(cs.length).toBe(2);
    for (const c of cs) {
      expect(c.multi!.length).toBe(5);
      expect(doc.neighbors(c.id).map((a) => a.z)).toEqual([26]);
    }
    // the rings are drawn with a circle
    expect([...doc.bonds.values()].filter((b) => b.circle).length).toBe(10);
  });

  it('saves to CDXML and reads back the same', () => {
    for (const id of ['ferrocene', 'cpstarml3', 'cod', 'dppf', 'allyl-complex']) {
      const { doc } = place(templateById(id)!);
      const text = writeCdxml(doc);
      const back = readCdxml(text).doc;
      expect(centres(back).length).toBe(centres(doc).length);
      expect(writeCdxml(back)).toBe(text);
    }
  });

  it('wedges a geometry\'s bonds towards the viewer and hashes those going away', () => {
    const oct = templateById('octahedral')!;
    const kinds = oct.bonds.map((b) => b[3] ?? 'solid').sort();
    expect(kinds).toEqual(['hashWedge', 'hashWedge', 'solid', 'solid', 'wedge', 'wedge']);
    const sq = templateById('square-planar')!;
    expect(sq.bonds.every((b) => !b[3])).toBe(true);
  });

  it('a ligand put on a metal shares it: both donors of a chelate bond to that metal', () => {
    const doc = new Doc();
    const pd = doc.edit('a', () => {
      const m = doc.addAtom(100, 100, 46);
      for (let i = 0; i < 3; i++) doc.addBond(m.id, doc.addAtom(100 + 14 * Math.cos(i * 2), 100 + 14 * Math.sin(i * 2), 17).id);
      return m.id;
    });
    const t = templateById('dppe')!;
    expect(t.onMetal).toBe(true);
    const L = doc.style.bondLength;
    const pl = freePlacement({ x: 100 - t.atoms[t.attach][0] * L, y: 100 - t.atoms[t.attach][1] * L }, L);
    doc.edit('Template', () => placeTemplate(doc, t, pl, { existing: new Map([[t.attach, pd]]) }));
    expect(doc.degree(pd)).toBe(5);
    expect([...doc.atoms.values()].some((a) => a.label === 'M')).toBe(false);
    const p = doc.neighbors(pd).filter((a) => a.z === 15);
    expect(p.length).toBe(2);
    // PPh2 on a metal is not P–H
    expect(p.every((a) => a.label === 'PPh2')).toBe(true);
  });

  it('a phosphine drawn out in full stays P on the metal', () => {
    const { doc, ids } = place(templateById('pph3')!);
    const p = ids.find((id) => doc.atoms.get(id)!.z === 15)!;
    expect(doc.valenceSum(p)).toBe(3);
  });

  it('a structure saved as the person\'s own template keeps its hapto bonds', () => {
    const { doc } = place(templateById('ferrocene')!);
    const own = templateFromAtoms(doc, doc.atoms.keys(), 'My ferrocene', 'own-1')!;
    expect(own.hapto?.length).toBe(2);
    const [back] = parseOwnTemplates(JSON.parse(JSON.stringify([own])));
    expect(back.hapto?.length).toBe(2);
    const { doc: again } = place(back);
    expect(centres(again).length).toBe(2);
  });
});

describe('Expand Label', () => {
  let RDKit: any;
  beforeAll(async () => { RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')(); });
  const canon = (smi: string) => { const m = RDKit.get_mol(smi); try { return m.get_smiles(); } finally { m.delete(); } };
  const layout = (smi: string) => { const m = RDKit.get_mol(smi); m.set_new_coords(true); try { return m.get_molblock(); } finally { m.delete(); } };

  it('writes a formula label as SMILES (from the atom where it joins, written H kept)', () => {
    const smi = (label: string) => canon('*' + miniSmiles(labelGraph(label, 1)!));
    expect(smi('CO2Et')).toBe(canon('*C(=O)OCC'));
    expect(smi('CH2OH')).toBe(canon('*CO'));
    expect(smi('NHBoc')).toBe(canon('*NC(=O)OC(C)(C)C'));
  });

  it('draws OMe out on the carbon it hung from, a bond long', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const { c, o } = doc.edit('a', () => {
      const c = doc.addAtom(0, 0), o = doc.addAtom(L, 0, 6, { label: 'OMe' });
      doc.addBond(c.id, o.id);
      return { c: c.id, o: o.id };
    });
    const smi = labelSmiles(doc.atoms.get(o)!, 1)!;
    const ids = doc.edit('Expand', () => expandWithMolblock(doc, o, layout('*' + smi)));
    expect(doc.atoms.has(o)).toBe(false);
    expect(ids.length).toBe(2);
    const ox = doc.atoms.get(ids.find((id) => doc.atoms.get(id)!.z === 8)!)!;
    expect(ox.x).toBeCloseTo(L, 3);
    expect(doc.bondBetween(c, ox.id)).toBeTruthy();
  });

  it('puts a chelating ligand on its metal: both phosphorus atoms bond to the palladium', () => {
    const doc = new Doc();
    const { pd, lab } = doc.edit('a', () => {
      const pd = doc.addAtom(0, 0, 46), lab = doc.addAtom(14, 0, 6, { label: 'dppe' });
      doc.addBond(pd.id, lab.id);
      doc.addBond(pd.id, doc.addAtom(-14, 0, 17).id);
      return { pd: pd.id, lab: lab.id };
    });
    doc.edit('Expand', () => expandLigand(doc, lab));
    expect(doc.atoms.has(lab)).toBe(false);
    expect(doc.neighbors(pd).filter((a) => a.z === 15).length).toBe(2);
  });

  it('a metal carbonyl is M←C⁻≡O⁺ to the chemistry engine: Ni(CO)4 is C4NiO4', () => {
    const doc = new Doc();
    doc.edit('a', () => {
      const ni = doc.addAtom(0, 0, 28);
      for (let i = 0; i < 4; i++) {
        const dx = Math.cos(i * Math.PI / 2), dy = Math.sin(i * Math.PI / 2);
        const c = doc.addAtom(14 * dx, 14 * dy), o = doc.addAtom(28 * dx, 28 * dy, 8);
        doc.addBond(ni.id, c.id); doc.addBond(c.id, o.id, 3);
      }
    });
    const checks = new StructureChecks(doc);
    checks.update();
    expect(checks.list()).toEqual([]);
    const m = RDKit.get_mol(toMolfile(doc, [...doc.atoms.keys()]).molblock);
    expect(m?.is_valid()).toBe(true);
    expect(JSON.parse(m.get_descriptors()).NumHeavyAtoms).toBe(9);
    expect(m.get_smiles()).not.toContain('H');
    m.delete();
  });

  it('every metal template reads as chemistry: ferrocene is Fe²⁺ and two Cp⁻, an allyl an anion, an NHC a carbene', () => {
    const smiles = (t: Template) => {
      const doc = new Doc();
      doc.edit('a', () => placeTemplate(doc, t, freePlacement({ x: 0, y: 0 }, doc.style.bondLength)));
      const m = RDKit.get_mol(toMolfile(doc, [...doc.atoms.keys()]).molblock);
      try { return m?.is_valid() ? m.get_smiles() : null; } finally { m?.delete(); }
    };
    for (const t of METAL) expect([t.id, smiles(t)]).not.toEqual([t.id, null]);
    expect(smiles(templateById('ferrocene')!)).toBe(canon('[Fe+2].c1cc[cH-]c1.c1cc[cH-]c1'));
    expect(smiles(templateById('allyl')!)).toContain('[CH2-]');
    expect(smiles(templateById('imes')!)).toContain('[C]');
    // dppf's phosphorus atoms give the metal their lone pairs: no P–H
    expect(smiles(templateById('dppf')!)).not.toContain('PH');
  });
});

describe('metallocene templates', () => {
  const META = TEMPLATES.filter((t) => t.group === 'metallocenes');

  it('cover sandwich, bent, ansa and half-sandwich complexes', () => {
    const ids = new Set(META.map((t) => t.id));
    for (const id of ['ferrocene', 'ferrocene-eclipsed', 'decamethylferrocene', 'cobaltocenium', 'bis-benzene-cr', 'uranocene', 'ferrocenyl',
      'ferrocene-11', 'ferrocene-12', 'bent-metallocene', 'cp2ticl2', 'cp2zrcl2', 'schwartz', 'petasis', 'tebbe', 'ansa-sime2', 'ebi-zrcl2',
      'cgc', 'cpml3', 'cpstarml3', 'arene-cr-co3', 'cpstar-rh-dimer', 'cymene-ru-dimer']) expect(ids).toContain(id);
  });

  it('electron counting works on every one with a real metal', () => {
    const count = (id: string) => {
      const { doc } = place(templateById(id)!);
      const m = [...doc.atoms.values()].find((a) => a.z !== 6 && a.z !== 1 && a.z !== 17 && a.z !== 7 && a.z !== 8 && a.z !== 14 && a.z !== 13 && !a.multi && !a.label)!;
      return countElectrons(doc, m.id).filter((c) => c.symbol !== 'Al').map((c) => [c.symbol, c.oxidation, c.dn, c.electrons]);
    };
    expect(count('ferrocene')).toEqual([['Fe', 2, 6, 18]]);
    expect(count('decamethylferrocene')).toEqual([['Fe', 2, 6, 18]]);
    expect(count('ferrocenium')).toEqual([['Fe', 3, 5, 17]]);
    expect(count('cobaltocenium')).toEqual([['Co', 3, 6, 18]]);
    expect(count('bis-benzene-cr')).toEqual([['Cr', 0, 6, 18]]);
    expect(count('cp2ticl2')).toEqual([['Ti', 4, 0, 16]]);
    expect(count('cp2zrcl2')).toEqual([['Zr', 4, 0, 16]]);
    expect(count('schwartz')).toEqual([['Zr', 4, 0, 16]]);
    expect(count('petasis')).toEqual([['Ti', 4, 0, 16]]);
    expect(count('tebbe')).toEqual([['Ti', 4, 0, 16]]);
    expect(count('cp2ticl')).toEqual([['Ti', 3, 1, 15]]);
    expect(count('ebi-zrcl2')).toEqual([['Zr', 4, 0, 16]]);
    expect(count('cgc')).toEqual([['Ti', 4, 0, 12]]);
    expect(count('arene-cr-co3')).toEqual([['Cr', 0, 6, 18]]);
    expect(count('cpmn-co3')).toEqual([['Mn', 1, 6, 18]]);
    expect(count('fp-r')).toEqual([['Fe', 2, 6, 18]]);
    expect(count('cpstar-rh-dimer')).toEqual([['Rh', 3, 6, 18], ['Rh', 3, 6, 18]]);
    expect(count('cymene-ru-dimer')).toEqual([['Ru', 2, 6, 18], ['Ru', 2, 6, 18]]);
  });

  it('the Tebbe reagent reads as chemistry: its Al–Cl–Ti bridge is written as an ate complex', () => {
    const { doc } = place(templateById('tebbe')!);
    const mb = toMolfile(doc, [...doc.atoms.keys()]).molblock;
    expect(mb).toMatch(/M {2}CHG/);
    expect(mb.split('\n').filter((l) => /^ *\d+ +\d+ +9 /.test(l))).toEqual([]);
  });

  it('a ferrocenyl group joins a clicked atom upright, flipped to face the other way rather than turned', () => {
    const t = templateById('ferrocenyl')!;
    expect(t.join).toBe('bond');
    expect(t.upright).toBe(true);
    for (const dir of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0.87, y: -0.5 }]) {
      const [best, other] = atomPlacements(t, { x: 0, y: 0 }, dir, 14.4, true);
      for (const pl of [best, other]) expect([0, Math.PI]).toContain(pl.angle);
      // the iron stays below the ring the group joins by
      const pts = templatePoints(t, best);
      const fe = t.atoms.findIndex((a) => a[2] === 'Fe');
      expect(pts[fe].y).toBeGreaterThan(pts[t.attach].y);
      // and the rest of the group lies the way the bond goes
      expect(Math.sign(pts[fe].x - pts[t.attach].x)).toBe(Math.sign(dir.x));
    }
  });
});
