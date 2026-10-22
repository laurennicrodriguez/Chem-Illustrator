// @vitest-environment jsdom
//
// A scheme wrapped onto a second row: the row's first arrow goes on from the last product of the
// row above, in the app's reading of it and in the CDXML written (one scheme).

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure, reactionSteps, schemeItems } from '../src/chem/reaction';
import { writeCdxml } from '../src/io/cdxml-write';

function chain(doc: Doc, x: number, y: number): number {
  const L = doc.style.bondLength;
  const a = doc.addAtom(x, y, 6).id, b = doc.addAtom(x + L, y, 6).id;
  doc.addBond(a, b, 1);
  return a;
}
const arrow = (doc: Doc, x1: number, x2: number, y: number) => doc.addArrow({ tail: { x: x1, y }, head: { x: x2, y }, sweep: 0, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 }).id;

describe('a two-row scheme', () => {
  it('reads the second row as going on from the end of the first', () => {
    const doc = new Doc();
    const L = doc.style.bondLength;
    const ids = doc.edit('build', () => {
      const a = chain(doc, 100, 100);
      arrow(doc, 100 + 1.6 * L, 100 + 4 * L, 100);
      const b = chain(doc, 100 + 4.6 * L, 100);
      // row 2 starts with an arrow at the left margin
      const r2 = arrow(doc, 100, 100 + 2.5 * L, 100 + 4 * L);
      const c = chain(doc, 100 + 3.1 * L, 100 + 4 * L);
      return { a, b, c, r2 };
    });
    const steps = reactionSteps(doc, schemeItems(doc, plainMeasure(doc)));
    const second = steps.find((s) => s.arrow.id === ids.r2)!;
    expect(second).toBeDefined();
    expect(second.roles.reactants).toEqual(['a' + ids.b]);
    expect(second.roles.products).toEqual(['a' + ids.c]);
    // one scheme in the file, with both steps
    const xml = writeCdxml(doc);
    expect(xml.match(/<scheme\b/g)?.length).toBe(1);
    expect(xml.match(/<step\b/g)?.length).toBe(2);
  });
});
