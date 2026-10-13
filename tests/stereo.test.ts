// @vitest-environment jsdom
// Live R/S and E/Z labels. The expected labels in "matches ChemDraw" are what ChemDraw 25 showed
// for the same drawings (opened on Nate's computer, 2026-10-13).
import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { Doc, BondDisplay } from '../src/model';
import { toMolfile } from '../src/chem/molfile';
import { stereoAnchor, stereoTags, mayHaveStereo, atomStereoText, bondStereoText, atomStereoPlace, bondStereoPlace, StereoPlacer, GenericRule } from '../src/chem/stereo';
import { LiveStereo, StereoJob } from '../src/chem/live-stereo';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { arialWidth } from '../src/text-metrics';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

const L = 14.4;
const runner = (calls: { n: number }, generic?: GenericRule) => async (jobs: StereoJob[]) => {
  calls.n += jobs.length;
  return jobs.map((j) => stereoTags(RDKit, j.molblock, j.skip, generic, j.generic));
};

/** A carbon with three drawn substituents (up, lower left, lower right); the third bond carries `disp`. */
function centre(doc: Doc, x: number, y: number, subs: [number, string | null][], disp: BondDisplay, startAtSub = false): number {
  const c = doc.addAtom(x, y, 6);
  const pos = [[0, -L], [-L * 0.866, L / 2], [L * 0.866, L / 2]];
  const ids = subs.map(([z, label], i) => doc.addAtom(x + pos[i][0], y + pos[i][1], z, label ? { label } : {}).id);
  doc.addBond(c.id, ids[0]);
  doc.addBond(c.id, ids[1]);
  if (startAtSub) doc.addBond(ids[2], c.id, 1, disp); else doc.addBond(c.id, ids[2], 1, disp);
  return c.id;
}

const FClBr: [number, string | null][] = [[9, null], [17, null], [35, null]];

async function labelsOf(doc: Doc, generic?: GenericRule): Promise<LiveStereo> {
  const live = new LiveStereo(doc, runner({ n: 0 }, generic));
  await live.update();
  return live;
}

describe('stereo bonds', () => {
  it('a wedge describes the atom at its narrow end; plain bonds describe the stereocentre end', () => {
    const doc = new Doc();
    let c1 = 0, c2 = 0, c3 = 0;
    doc.bulk(() => {
      c1 = centre(doc, 0, 0, FClBr, 'bold', true);
      c2 = centre(doc, 100, 0, FClBr, 'hash', false);
      c3 = centre(doc, 200, 0, FClBr, 'wedge', true); // drawn backwards: the narrow end is on Br
    });
    const bondTo = (c: number) => [...doc.bonds.values()].find((b) => (b.a1 === c || b.a2 === c) && b.display !== 'solid')!;
    expect(stereoAnchor(doc, bondTo(c1))).toBe(c1);
    expect(stereoAnchor(doc, bondTo(c2))).toBe(c2);
    expect(stereoAnchor(doc, bondTo(c3))).not.toBe(c3);
  });

  it('knows which structures could have a label', () => {
    const doc = new Doc();
    doc.bulk(() => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L, 0), c = doc.addAtom(2 * L, 0);
      doc.addBond(a.id, b.id); doc.addBond(b.id, c.id, 2);
    });
    expect(mayHaveStereo(doc, doc.atoms.keys())).toBe(false); // a terminal double bond
    doc.bulk(() => { const [, , c] = [...doc.atoms.keys()]; doc.addBond(c, doc.addAtom(3 * L, 0).id); });
    expect(mayHaveStereo(doc, doc.atoms.keys())).toBe(true);
  });
});

describe('follows the CIP rules (IUPAC 2013, P-92)', () => {
  // textbook descriptors, straight from the chemistry engine
  const cases: [string, string, Record<number, string>, Record<string, string>?][] = [
    ['L-alanine (rule 1a)', 'C[C@@H](C(=O)O)N', { 1: 'S' }],
    ['L-cysteine: S outranks O one sphere out', 'C([C@@H](C(=O)O)N)S', { 1: 'R' }],
    ['L-threonine (2S,3R)', 'C[C@H]([C@@H](C(=O)O)N)O', { 1: 'R', 2: 'S' }],
    ['D-glyceraldehyde: C=O counts O twice (duplicate atoms)', 'C([C@H](C=O)O)O', { 1: 'R' }],
    ['(S)-ethanol-1-d: deuterium outranks H (rule 2)', '[2H][C@@H](C)O', { 1: 'S' }],
    ['(2R,3s,4S)-pentane-2,3,4-triol: R outranks S (rule 5, pseudoasymmetric)', 'C[C@@H](O)[C@@H](O)[C@H](C)O', { 1: 'R', 3: 's', 5: 'S' }],
    ['cholesterol (3S,8S,9S,10R,13R,14S,17R,20R)', 'C[C@H](CCCC(C)C)[C@H]1CC[C@@H]2[C@@]1(CC[C@H]3[C@H]2CC=C4[C@@]3(CC[C@@H](C4)O)C)C',
      { 1: 'R', 8: 'R', 11: 'S', 12: 'R', 15: 'S', 16: 'S', 20: 'R', 23: 'S' }],
    ['(Z)-1-chloro-1,2-difluoroethene', 'F/C(Cl)=C/F', {}, { '1,3': 'Z' }],
  ];
  for (const [name, smiles, atoms, bonds = {}] of cases) {
    it(name, () => {
      const t = stereoTags(RDKit, smiles);
      expect(Object.fromEntries(t.atoms)).toEqual(atoms);
      expect(Object.fromEntries(t.bonds.map(([i, j, l]) => [`${i},${j}`, l]))).toEqual(bonds);
    });
  }
});

describe('undefined groups (R, Ar, labels that can\'t be read)', () => {
  /** A centre with O up, CH3 lower left and CH2-X lower right on a wedge; returns the centre and the X atom. */
  const branch = (doc: Doc, label: string | null, z = 0) => {
    let c = 0, x = 0;
    doc.bulk(() => {
      c = centre(doc, 50, 50, [[8, null], [6, null], [6, null]], 'wedge');
      const ch2 = doc.neighbors(c).find((n) => n.x > 50)!;
      x = doc.addAtom(ch2.x + L * 0.866, ch2.y - L / 2, z, label ? { label } : {}).id;
      doc.addBond(ch2.id, x);
    });
    return { c, x };
  };

  it('get no R/S where they decide the order of the neighbours', async () => {
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => { c = centre(doc, 50, 50, [[8, null], [7, null], [0, 'R']], 'wedge'); });
    const live = await labelsOf(doc);
    expect(live.atom(c)).toBeUndefined();
    expect(live.undecided('a', c)).toBe(true);
  });

  it('keep the R/S they cannot change', async () => {
    // O > CH2-R > CH3 > H whatever R is: the CH2 already beats CH3 one sphere out
    const doc = new Doc();
    const { c } = branch(doc, 'R');
    const withR = await labelsOf(doc);
    const doc2 = new Doc();
    const { c: c2 } = branch(doc2, null, 17);
    const withCl = await labelsOf(doc2);
    expect(withR.atom(c)).toMatch(/^[RS]$/);
    expect(withR.atom(c)).toBe(withCl.atom(c2));
    expect(withR.undecided('a', c)).toBe(false);
  });

  it('keep a label saved in the file when the rules cannot decide it', async () => {
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => {
      c = centre(doc, 50, 50, [[8, null], [7, null], [0, 'R']], 'wedge');
      doc.updateAtom(c, { showStereo: true, stereoLabel: { text: '(S)', dx: -12, dy: 0.5, size: 7.5, italic: true } });
    });
    const live = await labelsOf(doc);
    expect(atomStereoText(doc.atoms.get(c)!, live)).toBe('(S)');
  });

  it('(3,4)-MDP is read as 3,4-methylenedioxyphenyl, so it ranks as an aryl group (below N)', async () => {
    const make = (label: string) => {
      const doc = new Doc();
      let c = 0;
      doc.bulk(() => {
        c = centre(doc, 50, 50, [[7, null], [6, null], [0, label]], 'wedge');
        const v = doc.neighbors(c).find((n) => n.z === 6)!;
        doc.addBond(v.id, doc.addAtom(v.x - L, v.y, 6).id, 2); // a vinyl group
      });
      return { doc, c };
    };
    const mdp = make('(3,4)-MDP'), ph = make('Ph');
    const a = (await labelsOf(mdp.doc)).atom(mdp.c), b = (await labelsOf(ph.doc)).atom(ph.c);
    expect(a).toMatch(/^[RS]$/);
    expect(a).toBe(b);
    // ChemDraw, which can't read the label, ranks it above N and gets the opposite answer
    const chemdraw = await labelsOf(make('Aryl').doc, 'highest');
    expect(chemdraw.atom(make('Aryl').c)).not.toBe(a);
  });
});

describe('matches ChemDraw', () => {
  // ChemDraw ranks undefined groups above every real atom; available as the 'highest' rule
  const cases: [string, [number, string | null][], BondDisplay, boolean, string | null][] = [
    ['bold bond starting at the carbon', FClBr, 'bold', false, 'R'],
    ['bold bond starting at Br', FClBr, 'bold', true, 'R'],
    ['hashed bond starting at Br', FClBr, 'hash', true, 'S'],
    ['dashed bond starting at the carbon', FClBr, 'dash', false, 'S'],
    ['wedge', FClBr, 'wedge', false, 'R'],
    ['R outranks O and N', [[8, null], [7, null], [0, 'R']], 'wedge', false, 'S'],
    ['a label that cannot be read outranks O and N', [[8, null], [7, null], [0, 'Aryl']], 'wedge', false, 'S'],
    ['R outranks iodine', [[53, null], [9, null], [0, 'R']], 'wedge', false, 'S'],
    ['R1 and R2 tie (no label)', [[0, 'R1'], [9, null], [0, 'R2']], 'wedge', false, null],
    ['Ph against iodine', [[53, null], [9, null], [0, 'Ph']], 'wedge', false, 'S'],
  ];
  for (const [name, subs, disp, startAtSub, want] of cases) {
    it(name, async () => {
      const doc = new Doc();
      let c = 0;
      doc.bulk(() => { c = centre(doc, 50, 50, subs, disp, startAtSub); });
      const live = await labelsOf(doc, 'highest');
      expect(live.atom(c)).toBe(want);
    });
  }

  it('E alkene', async () => {
    const doc = new Doc();
    let bond = 0;
    doc.bulk(() => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L * 0.866, -L / 2);
      doc.addBond(doc.addAtom(-L * 0.866, -L / 2, 17).id, a.id);
      bond = doc.addBond(a.id, b.id, 2).id;
      doc.addBond(b.id, doc.addAtom(2 * L * 0.866, 0, 9).id);
    });
    const live = await labelsOf(doc);
    expect(live.bond(bond)).toBe('E');
  });
});

describe('labels the drawing does not decide', () => {
  it('no E/Z for a C=N whose N is a label such as NTs', async () => {
    const doc = new Doc();
    let bond = 0;
    doc.bulk(() => {
      const c = doc.addAtom(0, 0), n = doc.addAtom(L, 0, 7, { label: 'NTs' });
      bond = doc.addBond(c.id, n.id, 2).id;
      doc.addBond(c.id, doc.addAtom(-L / 2, -L * 0.866).id);
      doc.addBond(c.id, doc.addAtom(-L / 2, L * 0.866, 8, { label: 'OMe' }).id);
    });
    const live = await labelsOf(doc);
    expect(live.bond(bond)).toBeNull();
  });

  it('pseudo-asymmetric centres get lower-case r/s', async () => {
    // (2R,4S)-pentane-2,3,4-triol: C3 is r or s
    const mol = RDKit.get_mol('C[C@@H](O)[C@H](O)[C@H](C)O');
    mol.set_new_coords();
    const { addMolfile } = await import('../src/chem/molfile');
    const doc = new Doc();
    doc.bulk(() => addMolfile(doc, mol.get_molblock(), 100, 100));
    mol.delete();
    const live = await labelsOf(doc);
    const labels = [...live.atomEntries()].map(([, l]) => l).sort();
    expect(labels).toEqual(['R', 'S', 'r'].sort());
  });
});

describe('molfile for stereo', () => {
  it('is the same wherever the structure sits', () => {
    const doc = new Doc();
    let ids: number[] = [];
    doc.bulk(() => { centre(doc, 10, 10, FClBr, 'wedge'); ids = [...doc.atoms.keys()]; });
    const before = toMolfile(doc, ids, '', { stereo: true }).molblock;
    doc.begin('move');
    for (const id of ids) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: a.x + 123.4, y: a.y - 56.7 }); }
    doc.commit();
    expect(toMolfile(doc, ids, '', { stereo: true }).molblock).toBe(before);
  });

  it('writes R groups as a heavy stand-in only when working out stereo', () => {
    const doc = new Doc();
    doc.bulk(() => { centre(doc, 0, 0, [[8, null], [7, null], [0, 'R']], 'wedge'); });
    expect(toMolfile(doc, doc.atoms.keys()).molblock).toContain(' * ');
    expect(toMolfile(doc, doc.atoms.keys(), '', { stereo: true }).molblock).toContain(' Og ');
  });
});

describe('kept up to date', () => {
  it('works out only what changed, and reuses results for moved structures', async () => {
    const doc = new Doc();
    let c1 = 0, c2 = 0;
    doc.bulk(() => {
      c1 = centre(doc, 0, 0, FClBr, 'wedge');
      c2 = centre(doc, 100, 0, [[9, null], [17, null], [53, null]], 'wedge');
    });
    const calls = { n: 0 };
    const live = new LiveStereo(doc, runner(calls));
    const changes: number[][] = [];
    live.onChange = (atoms) => changes.push(atoms);
    await live.update();
    expect(calls.n).toBe(2);
    expect(live.atom(c1)).toBe('R');
    expect(live.atom(c2)).toBe('R');

    // turn the first wedge into a hashed wedge: only that structure is worked out again
    const w = [...doc.bonds.values()].find((b) => b.a1 === c1 && b.display === 'wedge')!;
    doc.begin('flip');
    doc.updateBond(w.id, { display: 'hashWedge' });
    doc.commit();
    await live.update();
    expect(calls.n).toBe(3);
    expect(live.atom(c1)).toBe('S');
    expect(changes.at(-1)).toContain(c1);

    // undo: the earlier result is reused
    doc.undo();
    await live.update();
    expect(calls.n).toBe(3);
    expect(live.atom(c1)).toBe('R');

    // move the second structure: same molfile, nothing to work out
    doc.begin('move');
    for (const id of doc.fragmentOf(c2)) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: a.x + 50 }); }
    doc.commit();
    await live.update();
    expect(calls.n).toBe(3);
    expect(live.atom(c2)).toBe('R');

    // delete the wedge: no longer a stereocentre
    doc.begin('delete');
    doc.removeBond([...doc.bonds.values()].find((b) => b.a1 === c2 && b.display === 'wedge')!.id);
    doc.commit();
    await live.update();
    expect(live.atom(c2)).toBeNull();
  });

  it('shows the saved text until the structure has been worked out, and hand-typed text always', async () => {
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => { c = centre(doc, 0, 0, FClBr, 'wedge'); });
    doc.bulk(() => doc.updateAtom(c, { stereoLabel: { text: '(S)', dx: -10, dy: 0, size: 7.5, italic: true } }));
    const a = () => doc.atoms.get(c)!;
    expect(atomStereoText(a(), null)).toBe('(S)');
    const live = await labelsOf(doc);
    expect(atomStereoText(a(), live)).toBe('(R)');
    doc.bulk(() => doc.updateAtom(c, { stereoLabel: { ...a().stereoLabel!, text: '(R*)', manual: true } }));
    expect(atomStereoText(a(), live)).toBe('(R*)');
    // a plain atom shows nothing unless asked to
    const other = [...doc.atoms.keys()].find((id) => id !== c)!;
    expect(atomStereoText(doc.atoms.get(other)!, live)).toBeNull();
  });

  it('E/Z text appears for bonds marked to show it', async () => {
    const doc = new Doc();
    let bond = 0;
    doc.bulk(() => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L * 0.866, -L / 2);
      doc.addBond(doc.addAtom(-L * 0.866, -L / 2, 17).id, a.id);
      bond = doc.addBond(a.id, b.id, 2, 'solid', { showStereo: true }).id;
      doc.addBond(b.id, doc.addAtom(L * 0.866, -1.5 * L, 9).id); // F straight up, on the same side as Cl
    });
    const live = await labelsOf(doc);
    expect(bondStereoText(doc.bonds.get(bond)!, live)).toBe('(Z)');
  });
});

describe('where labels go', () => {
  const W = (t: string, s: number) => arialWidth(t, s);
  const size = 7.5;
  /** Centre of a placed label's capitals, relative to an atom. */
  const centreOf = (p: { x: number; y: number }, text: string, at: { x: number; y: number }) =>
    ({ x: p.x + W(text, size) / 2 - at.x, y: p.y - 0.358 * size - at.y });
  const box = (p: { x: number; y: number }, text: string) => ({ x1: p.x, y1: p.y - 0.73 * size, x2: p.x + W(text, size), y2: p.y + 0.1 * size });
  const overlap = (a: { x1: number; y1: number; x2: number; y2: number }, b: typeof a) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;

  it('an atom label sits in the widest gap, half a bond out', () => {
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => {
      c = doc.addAtom(0, 0).id;
      for (const [x, y] of [[0, -L], [L, 0], [0, L]]) doc.addBond(c, doc.addAtom(x, y).id);
    });
    const a = doc.atoms.get(c)!;
    const m = centreOf(atomStereoPlace(doc, a, '(R)', W), '(R)', a);
    expect(Math.hypot(m.x, m.y)).toBeCloseTo(0.5 * L, 5);
    expect(m.x).toBeLessThan(-0.48 * L); // the open side is the left
    expect(Math.abs(m.y)).toBeLessThan(0.1 * L);
  });

  it('keeps clear of the labels of neighbouring atoms', () => {
    // alanine: three equal gaps, but NH2 hangs over the upper right and C=O sits to the left
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => {
      c = doc.addAtom(100, 100).id;
      const n = doc.addAtom(100, 100 - L, 7), co = doc.addAtom(100 - L * 0.866, 100 + L / 2), me = doc.addAtom(100 + L * 0.866, 100 + L / 2);
      doc.addBond(c, n.id); doc.addBond(c, co.id); doc.addBond(c, me.id, 1, 'wedge');
      doc.addBond(co.id, doc.addAtom(100 - 2 * L * 0.866, 100, 8).id, 2);
      doc.addBond(co.id, doc.addAtom(100 - L * 0.866, 100 + 1.5 * L, 8).id);
    });
    const a = doc.atoms.get(c)!;
    const p = atomStereoPlace(doc, a, '(S)', W);
    const mine = box(p, '(S)');
    for (const o of doc.atoms.values()) {
      if (o.z === 6) continue;
      // the label text of N, O and OH (NH2 runs to the right of the N)
      const w = o.z === 7 ? W('NH2', 10) : W('OH', 10);
      expect(overlap(mine, { x1: o.x - 3.6, y1: o.y - 3.6, x2: o.x - 3.6 + w, y2: o.y + 5 })).toBe(false);
    }
    // and of the bonds: the label's box is nowhere near the line to the N
    expect(mine.x1 > 100 || mine.x2 < 100 || mine.y1 > 100).toBe(true);
  });

  it('labels on neighbouring stereocentres keep clear of each other', () => {
    // a zigzag chain where both centres would choose the same open spot by themselves
    const doc = new Doc();
    const ids: number[] = [];
    doc.bulk(() => {
      const pts = [[0, 0], [L * 0.866, -L / 2], [2 * L * 0.866, 0], [3 * L * 0.866, -L / 2]];
      for (const [x, y] of pts) ids.push(doc.addAtom(x, y).id);
      for (let i = 0; i < 3; i++) doc.addBond(ids[i], ids[i + 1]);
      doc.addBond(ids[1], doc.addAtom(L * 0.866, -1.5 * L, 8).id, 1, 'wedge');
      doc.addBond(ids[2], doc.addAtom(2 * L * 0.866, L, 9).id, 1, 'hashWedge');
      for (const id of [ids[1], ids[2]]) doc.updateAtom(id, { showStereo: true });
    });
    doc.stereo = { atom: (id) => (id === ids[1] ? 'R' : id === ids[2] ? 'S' : null), bond: () => null };
    const placer = new StereoPlacer(doc, W);
    const b1 = box(placer.atom(doc.atoms.get(ids[1])!, '(R)'), '(R)');
    const b2 = box(placer.atom(doc.atoms.get(ids[2])!, '(S)'), '(S)');
    expect(overlap(b1, b2)).toBe(false);
  });

  it('an E/Z label goes to the open side of the double bond', () => {
    const doc = new Doc();
    let bond = 0;
    doc.bulk(() => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L, 0);
      bond = doc.addBond(a.id, b.id, 2).id;
      doc.addBond(a.id, doc.addAtom(-L / 2, L * 0.866).id);
      doc.addBond(b.id, doc.addAtom(1.5 * L, L * 0.866).id);
    });
    const p = bondStereoPlace(doc, doc.bonds.get(bond)!, '(Z)', W);
    expect(p.y).toBeLessThan(0); // the neighbours hang below, so the label goes above
    expect(centreOf(p, '(Z)', { x: L / 2, y: 0 }).x).toBeCloseTo(0, 5); // over the middle
  });
});

describe('saving and opening stereo labels', () => {
  const read = (xml: string) => readCdxml(xml).doc;

  it('writes the live label, its descriptor and E/Z labels as ChemDraw does, and reads them back', async () => {
    const doc = new Doc();
    let c = 0, dbl = 0;
    doc.bulk(() => {
      c = centre(doc, 50, 50, FClBr, 'wedge');
      doc.updateAtom(c, { showStereo: true, stereoLabel: { text: '(S)', dx: -12, dy: 0.5, size: 7.5, italic: true } }); // out of date
      const a = doc.addAtom(150, 50), b = doc.addAtom(150 + L * 0.866, 50 - L / 2);
      doc.addBond(doc.addAtom(150 - L * 0.866, 50 - L / 2, 17).id, a.id);
      dbl = doc.addBond(a.id, b.id, 2, 'solid', { showStereo: true }).id;
      doc.addBond(b.id, doc.addAtom(150 + 2 * L * 0.866, 50, 9).id);
    });
    const live = await labelsOf(doc);
    doc.stereo = live;
    const out = writeCdxml(doc);
    expect(out).toMatch(new RegExp(`<n id="${c}"[^>]*ShowAtomStereo="yes" AS="R"><objecttag TagType="Unknown" Name="stereo"><t p="38.00 50.50"[^>]*><s [^>]*face="2">\\(R\\)</s>`));
    expect(out).toMatch(new RegExp(`<b id="${dbl}"[^>]*ShowBondStereo="yes" BS="E"><objecttag TagType="Unknown" Name="stereo"><t [^>]*><s [^>]*>\\(E\\)</s>`));
    const back = read(out);
    expect(back.atoms.get(c)!.showStereo).toBe(true);
    expect(back.atoms.get(c)!.stereoLabel?.text).toBe('(R)');
    const bb = back.bonds.get(dbl)!;
    expect(bb.showStereo).toBe(true);
    expect(bb.stereoLabel?.text).toBe('(E)');
    // read back relative to the middle of the bond, so it lands where it was drawn
    const p = bondStereoPlace(doc, doc.bonds.get(dbl)!, '(E)', (t, s) => arialWidth(t, s));
    expect(bondStereoPlace(back, bb, '(E)', (t, s) => arialWidth(t, s)).x).toBeCloseTo(p.x, 1);
  });

  it('leaves an untouched file as it was when its labels are right, and fixes them when not', async () => {
    const doc = new Doc();
    let c = 0;
    doc.bulk(() => {
      c = centre(doc, 50, 50, FClBr, 'wedge');
      doc.updateAtom(c, { showStereo: true, stereoLabel: { text: '(R)', dx: -12, dy: 0.5, size: 7.5, italic: true } });
    });
    const saved = writeCdxml(doc);
    const opened = read(saved);
    opened.stereo = await labelsOf(opened);
    expect(writeCdxml(opened)).toBe(saved);
    // turn the wedge into a hashed wedge: the saved label follows the chemistry
    const w = [...opened.bonds.values()].find((b) => b.display === 'wedge')!;
    opened.begin('flip');
    opened.updateBond(w.id, { display: 'hashWedge' });
    opened.commit();
    await (opened.stereo as LiveStereo).update();
    const out = writeCdxml(opened);
    expect(out).toContain('>(S)</s>');
    expect(out).toMatch(/AS="S"/);
  });
});
