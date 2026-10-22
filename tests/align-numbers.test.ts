// @vitest-environment jsdom
//
// Number Compounds lines up the numbers under structures in one row of a scheme.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { placeAttached } from '../src/editor/attached';
import { alignNumbers } from '../src/editor/editor';

describe('compound numbers in a row', () => {
  it('sit on one line under a short and a tall structure', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const m = plainMeasure(doc);
    const ids = doc.edit('build', () => {
      // a short one (a single bond) and a tall one (a chain going down) side by side
      const a1 = doc.addAtom(100, 100, 6).id, a2 = doc.addAtom(100 + L, 100, 6).id;
      doc.addBond(a1, a2, 1);
      const b1 = doc.addAtom(200, 90, 6).id, b2 = doc.addAtom(200, 90 + L, 6).id, b3 = doc.addAtom(200, 90 + 2 * L, 6).id;
      doc.addBond(b1, b2, 1); doc.addBond(b2, b3, 1);
      const caps = [[a1, a2], [b1, b2, b3]].map((atoms, i) => {
        const c = doc.addCaption({ x: 0, y: 0, runs: [{ text: String(i + 1), bold: true }], justify: 'center', attach: { atoms, side: 'below', gap: 4, shift: 0, role: 'label' } });
        placeAttached(doc, c, m);
        return c.id;
      });
      return caps;
    });
    const y = () => ids.map((id) => m.captionBox(doc.captions.get(id)!).y1);
    expect(Math.abs(y()[0] - y()[1])).toBeGreaterThan(5);
    doc.edit('align', () => alignNumbers(doc, ids, m));
    expect(y()[0]).toBeCloseTo(y()[1], 3);
  });
});
