// @vitest-environment jsdom
//
// Our chemistry warnings against ChemDraw's own, on real ChemDraw files: ChemDraw saves the
// warning it shows on each atom and bond (the Warning attribute), so the two can be compared.
// The files are private: point CHEM_TEST_FILES at a folder of .cdxml files to run this.
//
// Known, deliberate differences: we read E, EWG, LG and Ar1 as "any group" like R; NR2 and BR2
// as two R groups (ChemDraw reads R2 as one numbered group); NaBH4 as a salt; and B(OR)3− as a
// borate. We also flag reagent text typed as an atom label that ChemDraw left unflagged.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCdxml } from '../src/io/cdxml';
import { StructureChecks } from '../src/chem/warnings';

const dir = process.env.CHEM_TEST_FILES ?? '';
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];

describe.skipIf(!files.length)('warnings match ChemDraw on real files', { timeout: 120000 }, () => {
  it('flags what ChemDraw flags, and little else', () => {
    let both = 0, onlyChemDraw = 0;
    const onlyUs: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(dir, f), 'utf8');
      const theirs = new Set<string>();
      for (const m of text.matchAll(/<(n|b)\s+id="(\d+)"([^>]*?)>/g)) if (/Warning="/.test(m[3])) theirs.add(m[1] + m[2]);
      const { doc } = readCdxml(text);
      const checks = new StructureChecks(doc);
      checks.update();
      const ours = new Set([...[...checks.atoms.keys()].map((id) => 'n' + id), ...[...checks.bonds.keys()].map((id) => 'b' + id)]);
      for (const k of theirs) {
        if (k[0] === 'n' && !doc.atoms.has(Number(k.slice(1)))) continue; // atoms inside abbreviations
        if (ours.has(k)) both++;
        else onlyChemDraw++;
      }
      for (const k of ours) {
        if (theirs.has(k)) continue;
        const a = doc.atoms.get(Number(k.slice(1)));
        onlyUs.push(`${f} ${k} ${a?.label ?? ''} (${a ? doc.degree(a.id) : '?'} bonds)`);
      }
    }
    // most of ChemDraw's warnings are ours too
    expect(both).toBeGreaterThan(3 * onlyChemDraw);
    // anything extra is text typed as a label on its own, not part of a structure
    for (const x of onlyUs) expect(x).toMatch(/\(0 bonds\)$/);
  });
});
