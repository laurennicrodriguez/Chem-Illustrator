// @vitest-environment jsdom
// Clean Up Structure must not change what a drawing means: the chemistry engine reads the same
// structure, stereocentres and cis/trans double bonds included, before and after. Set
// CHEM_TEST_FILES to a folder of .cdxml files to check every structure in them too.
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { addMolfile, toMolfile } from '../src/chem/molfile';
import { cleanUpMoves } from '../src/chem/cleanup';
import { dist } from '../src/geom';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const smilesOf = (molblock: string): string => {
  const m = RDKit.get_mol(molblock);
  try { return m.get_smiles(); } finally { m.delete(); }
};
const smilesOfDoc = (doc: Doc, atoms: Iterable<number> = doc.atoms.keys()) => smilesOf(toMolfile(doc, atoms).molblock);
const closestIn = (doc: Doc, ids: Iterable<number>) => {
  const atoms = [...ids].map((id) => doc.atoms.get(id)!);
  let c = Infinity;
  for (let a = 0; a < atoms.length; a++) for (let b = a + 1; b < atoms.length; b++) c = Math.min(c, dist(atoms[a], atoms[b]));
  return c;
};

const CASES: [string, string][] = [
  ['L-alanine', 'C[C@H](N)C(=O)O'],
  ['cis-pent-2-ene', 'C/C=C\\CC'],
  ['methyl (E)-crotonate', 'C/C=C/C(=O)OC'],
  ['(−)-menthol', 'CC(C)[C@@H]1CC[C@@H](C)C[C@H]1O'],
  ['(S)-ibuprofen', 'CC(C)Cc1ccc(cc1)[C@H](C)C(=O)O'],
  ['β-D-glucose', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O'],
  ['oseltamivir', 'CCC(CC)O[C@@H]1C=C(C[C@@H]([C@H]1NC(C)=O)N)C(=O)OCC'],
  ['all-trans-retinal', 'CC1=C(C(C)(C)CCC1)/C=C/C(C)=C/C=C/C(C)=C/C=O'],
  ['cholesterol', 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C'],
  ['camphor (bridged)', 'CC1(C)[C@@H]2CC[C@@]1(C)C(=O)C2'],
  ['penicillin G', 'CC1([C@@H](N2[C@H](S1)[C@@H](C2=O)NC(=O)CC3=CC=CC=C3)C(=O)O)C'],
  ['morphine (bridged)', 'CN1CC[C@]23[C@@H]4[C@H]1CC5=C2C(=C(C=C5)O)O[C@H]3[C@H](C=C4)O'],
  ['spiro[4.5]decan-6-one', 'O=C1CCCCC12CCCC2'],
  ['18-crown-6 (large ring)', 'C1COCCOCCOCCOCCOCCO1'],
  ['arachidonic acid (four cis double bonds)', 'CCCCC/C=C\\C/C=C\\C/C=C\\C/C=C\\CCCC(=O)O'],
  ['tri-tert-butylmethanol (crowded)', 'CC(C)(C)C(C(C)(C)C)(C(C)(C)C)O'],
];

describe('Clean Up Structure keeps the chemistry', () => {
  for (const [name, smi] of CASES) {
    it(name, () => {
      const m = RDKit.get_mol(smi);
      const want = m.get_smiles();
      const doc = new Doc();
      doc.bulk(() => addMolfile(doc, m.get_molblock(), 200, 200));
      m.delete();
      expect(smilesOfDoc(doc)).toBe(want);
      // make it messy: every atom nudged a little, the same way each run
      const L = doc.style.bondLength;
      let i = 0;
      doc.bulk(() => {
        for (const a of [...doc.atoms.values()]) {
          i++;
          doc.updateAtom(a.id, { x: a.x * 1.1 + Math.sin(i * 12.9898) * L * 0.15, y: a.y * 0.95 + Math.cos(i * 78.233) * L * 0.15 });
        }
      });
      expect(smilesOfDoc(doc)).toBe(want);
      const closest = () => closestIn(doc, doc.atoms.keys());
      const before = closest();
      const moves = cleanUpMoves(doc, doc.fragments());
      doc.bulk(() => { for (const [id, p] of moves) doc.updateAtom(id, { x: p.x, y: p.y }); });
      expect(smilesOfDoc(doc)).toBe(want);
      // nothing lands on top of anything else (bridged ring systems keep their drawn shape, so
      // they can't be better than they were drawn)
      expect(closest()).toBeGreaterThan(Math.min(L * 0.5, before * 0.9));
    });
  }
});

const dir = process.env.CHEM_TEST_FILES ?? '';
describe.skipIf(!dir || !existsSync(dir))('Clean Up Structure on real ChemDraw files', () => {
  const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.cdxml')) : [];
  for (const f of files) {
    it(f, () => {
      const doc = readCdxml(readFileSync(join(dir, f), 'utf8')).doc;
      const L = doc.style.bondLength;
      const frags = doc.fragments().filter((x) => x.size > 1);
      // structures the chemistry engine can't read (unknown labels) are left out of the comparison
      const before = frags.map((s) => { try { return smilesOfDoc(doc, s); } catch { return null; } });
      const crowd = frags.map((s) => closestIn(doc, s));
      const moves = cleanUpMoves(doc, frags);
      doc.bulk(() => { for (const [id, p] of moves) doc.updateAtom(id, { x: p.x, y: p.y }); });
      frags.forEach((s, i) => {
        if (before[i]) expect(smilesOfDoc(doc, s)).toBe(before[i]);
        expect(closestIn(doc, s)).toBeGreaterThan(Math.min(L * 0.5, crowd[i] * 0.9));
      });
    });
  }
});
