// @vitest-environment jsdom
//
// Reading reaction schemes in real ChemDraw files: the roles worked out from where things sit
// should match the reaction steps ChemDraw saved. The files are private, so they are not in the
// repository: point CHEM_TEST_FILES at a folder of .cdxml files to run these locally.

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { readCdxml } from '../src/io/cdxml';
import type { Arrow, StepRoles } from '../src/model';
import { arrowFrame, inFrame, type Item, interpretArrow, isReactionArrow, isStep, itemFinder, plainMeasure, ROLES, schemeItems } from '../src/chem/reaction';

const dir = process.env.CHEM_TEST_FILES ?? '';
const files = dir && existsSync(dir) ? readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.cdxml')) : [];

describe.skipIf(!files.length)('reaction steps in real ChemDraw files', { timeout: 120000 }, () => {
  it('worked-out roles match the steps ChemDraw saved', () => {
    let steps = 0, same = 0, extra = 0, arrows = 0, grouped = 0, stale = 0;
    const misses: string[] = [];
    for (const f of files) {
      const { doc } = readCdxml(readFileSync(join(dir, f), 'utf8'));
      const items = schemeItems(doc, plainMeasure(doc));
      const find = itemFinder(items);
      const canon = (refs: string[]) => refs.map((r) => find(r)?.ref ?? '?' + r).sort().join(' ');
      for (const r of doc.arrows.values()) {
        if (!isReactionArrow(r)) continue;
        arrows++;
        const got = interpretArrow(r, items, doc.style.bondLength);
        if (!r.step) { if (isStep(got)) extra++; continue; }
        // ChemDraw's groups count as one thing; this program keeps their parts separate
        if (ROLES.some((k) => r.step![k].length > 3 || r.step![k].some((x) => !find(x)))) { grouped++; continue; }
        // steps ChemDraw left behind after edits, with nothing on one side
        if (!isStep(r.step) || leftBehind(r, r.step!, find, doc.style.bondLength)) { stale++; continue; }
        steps++;
        const bad = ROLES.filter((k) => canon(r.step![k]) !== canon(got[k]));
        if (!bad.length) same++;
        else if (misses.length < 40) misses.push(`${f} arrow ${r.id}: ` + bad.map((k) => `${k} want [${canon(r.step![k])}] got [${canon(got[k])}]`).join('; '));
      }
    }
    console.log(`${arrows} reaction arrows, ${grouped} steps with groups, ${stale} stale, ${steps} ChemDraw steps, ${same} matched, ${extra} arrows without a step that look like one`);
    if (process.env.SHOW_MISSES) console.log(misses.join('\n'));
    expect(same / Math.max(1, steps)).toBeGreaterThan(0.7);
  });
});

/** A step ChemDraw saved before things were moved: a starting material or product far from its end of the arrow. */
function leftBehind(r: Arrow, st: StepRoles, find: (ref: string) => Item | undefined, bond: number): boolean {
  const f = arrowFrame(r);
  const far = (ref: string, at: number) => {
    const q = inFrame(f, find(ref)!.box);
    return Math.hypot(Math.max(0, q.t1 - at, at - q.t2), Math.max(0, q.s1, -q.s2)) > 6 * bond;
  };
  return st.reactants.some((x) => far(x, 0)) || st.products.some((x) => far(x, f.length));
}
