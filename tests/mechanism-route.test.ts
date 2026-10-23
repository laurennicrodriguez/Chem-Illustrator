// @vitest-environment jsdom
//
// Mechanism arrows finding their own way: clear of other arrows (two heads never on one spot),
// and redrawn when a change leaves one running into the structure, unless it was bent by hand.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { arrowClash, arrowPath, pushArrow, pushPins, type PushArrow } from '../src/chem/mechanism';
import { dist } from '../src/geom';

const L = new Doc().style.bondLength;

function addPush(doc: Doc, p: PushArrow): number {
  return doc.edit('arrow', () => doc.addArrow({
    tail: p.tail, head: p.head, sweep: p.sweep, ...(p.bez ? { bez: p.bez } : {}), pin: pushPins(doc, p),
    headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5,
  }).id);
}

describe('mechanism arrows routing themselves', () => {
  it('puts a second arrow onto the same atom with its head clear of the first', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const c = doc.addAtom(200, 100, 6).id;
      const o1 = doc.addAtom(200 - 2 * L, 100 - 0.4 * L, 8, { charge: -1 }).id;
      const o2 = doc.addAtom(200 - 2 * L, 100 + 0.4 * L, 8, { charge: -1 }).id;
      return { c, o1, o2 };
    });
    const m = plainMeasure(doc);
    const a = pushArrow(doc, m, { kind: 'atom', id: ids.o1 }, { kind: 'atom', id: ids.c })!;
    // without the first arrow there, the second would end where it does
    const alone = pushArrow(doc, m, { kind: 'atom', id: ids.o2 }, { kind: 'atom', id: ids.c })!;
    addPush(doc, a);
    const b = pushArrow(doc, m, { kind: 'atom', id: ids.o2 }, { kind: 'atom', id: ids.c })!;
    expect(b).not.toBeNull();
    expect(dist(a.head, b.head)).toBeGreaterThanOrEqual(Math.min(dist(a.head, alone.head), 0.3 * L) - 1e-6);
    expect(dist(a.head, b.head)).toBeGreaterThan(0.2 * L);
  });

  it('scores an arrow running through a label as clashing, and a clear one as clear', () => {
    const doc = new Doc();
    const [o, c, br] = doc.edit('build', () => [doc.addAtom(100, 100, 8, { charge: -1 }).id, doc.addAtom(100 + 3 * L, 100, 6).id, doc.addAtom(100 + 1.5 * L, 100 - 2 * L, 35).id]);
    const m = plainMeasure(doc);
    const p = pushArrow(doc, m, { kind: 'atom', id: o }, { kind: 'atom', id: c })!;
    const id = addPush(doc, p);
    expect(arrowClash(doc, m, doc.arrows.get(id)!)).toBeLessThan(0.3);
    // the bromine moved onto the arrow's path
    const pts = arrowPath(doc.arrows.get(id)!);
    const on = pts[Math.floor(pts.length / 2)];
    doc.edit('move', () => doc.updateAtom(br, { x: on.x, y: on.y }));
    expect(arrowClash(doc, m, doc.arrows.get(id)!)).toBeGreaterThan(0.3);
  });
});
