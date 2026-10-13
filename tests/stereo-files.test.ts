// @vitest-environment jsdom
//
// Our R/S and E/Z labels against ChemDraw's, on real ChemDraw files: ChemDraw saves the
// descriptor it works out on each atom (AS) and double bond (BS), so the two can be compared.
// The files are private: point CHEM_TEST_FILES at a folder of .cdxml files to run this.
//
// Known, deliberate differences: no E/Z for a C=N whose N is an abbreviation (=NTs), where the
// drawing doesn't fix which way the group points (ChemDraw guesses from its hidden layout); and
// no R/S from bridged rings drawn in perspective with crossing bonds and no wedges. A few saved
// values are also out of date (atoms with no wedge left near them).

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCdxml } from '../src/io/cdxml';
import { LiveStereo } from '../src/chem/live-stereo';
import { stereoTags, StereoPlacer } from '../src/chem/stereo';
import { arialWidth } from '../src/text-metrics';

const dir = process.env.CHEM_TEST_FILES ?? '';
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let RDKit: any;
beforeAll(async () => {
  if (files.length) RDKit = await createRequire(import.meta.url)('@rdkit/rdkit')();
}, 30000);

describe.skipIf(!files.length)('R/S and E/Z match ChemDraw on real files', { timeout: 300000 }, () => {
  it('agrees with the labels ChemDraw saved', async () => {
    let agree = 0, theirsOnly = 0, oursOnly = 0, undecided = 0, bondUndecided = 0;
    const differ: string[] = [];
    let bondAgree = 0;
    const bondDiffer: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const AS = new Map<number, string>(), BS = new Map<number, string>();
      for (const m of text.matchAll(/<n\s+id="(\d+)"[^>]*?\sAS="([^"]*)"/g)) AS.set(Number(m[1]), m[2]);
      for (const m of text.matchAll(/<b\s+id="(\d+)"[^>]*?\sBS="([^"]*)"/g)) BS.set(Number(m[1]), m[2]);
      const { doc } = readCdxml(text);
      const live = new LiveStereo(doc, async (jobs) => jobs.map((j) => stereoTags(RDKit, j.molblock, j.skip, 'undecided', j.generic)));
      await live.update();
      for (const [id, cd] of AS) {
        if (!doc.atoms.has(id)) continue;
        const theirs = /^[RSrs]$/.test(cd) ? cd : null;
        const ours = live.atom(id) ?? null;
        if (theirs && ours === theirs) agree++;
        else if (theirs && ours) differ.push(`${f} atom ${id}: ChemDraw ${theirs}, us ${ours}`);
        else if (theirs && live.undecided('a', id)) undecided++;
        else if (theirs) theirsOnly++;
        else if (ours) oursOnly++;
      }
      for (const [id, cd] of BS) {
        if (!doc.bonds.has(id)) continue;
        const theirs = /^[EZ]$/.test(cd) ? cd : null;
        const ours = live.bond(id) ?? null;
        if (theirs && ours === theirs) bondAgree++;
        else if (theirs && ours) bondDiffer.push(`${f} bond ${id}: ChemDraw ${theirs}, us ${ours}`);
        else if (theirs && live.undecided('b', id)) bondUndecided++;
      }
    }
    console.log({ agree, theirsOnly, oursOnly, undecided, differ, bondAgree, bondUndecided, bondDiffer });
    // ChemDraw can't read "(3,4)-MDP" and ranks it above N; read as 3,4-methylenedioxyphenyl the
    // CIP rules give the other label
    const known = ['2,5 DiAryl.cdxml atom 122: ChemDraw S, us R'];
    expect(differ.filter((d) => !known.includes(d))).toEqual([]);
    expect(agree).toBeGreaterThan(300);
    expect(theirsOnly).toBeLessThan(agree / 10);
    expect(bondDiffer).toEqual([]);
  });

  it('puts labels on the same side of the atom as ChemDraw did', () => {
    let near = 0;
    const far: string[] = [];
    for (const f of files) {
      const { doc } = readCdxml(readFileSync(join(dir, f), 'utf8'));
      const saved = [...doc.atoms.values()].filter((a) => a.stereoLabel).map((a) => ({ a, l: a.stereoLabel! }));
      // forget ChemDraw's spots (as if the labels had just been shown) and work them out
      doc.bulk(() => { for (const { a } of saved) doc.updateAtom(a.id, { stereoLabel: undefined }); });
      const placer = new StereoPlacer(doc, arialWidth);
      for (const { a, l } of saved) {
        const w = arialWidth(l.text, l.size);
        const angle = (dx: number, dy: number) => Math.atan2(dy - 0.358 * l.size, dx + w / 2);
        const p = placer.atom(doc.atoms.get(a.id)!, l.text);
        const diff = angle(p.x - a.x, p.y - a.y) - angle(l.dx, l.dy);
        const d = Math.abs(Math.atan2(Math.sin(diff), Math.cos(diff))) * 180 / Math.PI;
        if (d < 20) near++; else far.push(`${f} atom ${a.id}: ${d.toFixed(0)} degrees off`);
      }
    }
    console.log({ near, far });
    expect(far.length).toBeLessThanOrEqual(near / 5);
  });
});
