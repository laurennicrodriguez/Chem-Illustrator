// @vitest-environment jsdom
//
// Reaction schemes: reading which things round an arrow are its starting materials, products
// and conditions, tidying a scheme (Clean Up Reaction), and saving the roles for ChemDraw.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { interpretArrow, plainMeasure, schemeItems } from '../src/chem/reaction';
import { applySchemePlan, planCleanUp, SPACING, spacing } from '../src/chem/scheme-layout';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

/** A two-atom structure (a bond) centred at x, y. */
function bond(doc: Doc, x: number, y: number): number {
  const a = doc.addAtom(x - 6, y), b = doc.addAtom(x + 6, y);
  doc.addBond(a.id, b.id);
  return a.id;
}

function caption(doc: Doc, text: string, x: number, y: number): number {
  return doc.addCaption({ x, y, runs: [{ text }], justify: 'left' }).id;
}

function arrow(doc: Doc, x1: number, x2: number, y: number) {
  return doc.addArrow({ tail: { x: x1, y }, head: { x: x2, y }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 });
}

/** A + B → C, with "Pd(PPh3)4" above the arrow and "THF, 60 °C" below it, and "1" under C. */
function scheme() {
  const doc = new Doc();
  const ids = doc.edit('build', () => {
    const a = bond(doc, 0, 0);
    const plus = caption(doc, '+', 18, 3.5);
    const b = bond(doc, 40, 1);
    const r = arrow(doc, 60, 120, 0);
    const above = caption(doc, 'Pd(PPh3)4', 70, -4);
    const below = caption(doc, 'THF, 60 °C', 68, 12);
    const c = bond(doc, 140, 2);
    const num = caption(doc, '1', 138, 16);
    return { a, plus, b, r: r.id, above, below, c, num };
  });
  return { doc, ...ids };
}

describe('reading a scheme', () => {
  it('finds the starting materials, products and conditions round an arrow', () => {
    const { doc, a, plus, b, r, above, below, c } = scheme();
    const roles = interpretArrow(doc.arrows.get(r)!, schemeItems(doc, plainMeasure(doc)), doc.style.bondLength);
    expect(roles.reactants).toEqual(['a' + (b), 'a' + a]);
    expect(roles.plusses).toEqual(['c' + plus]);
    expect(roles.products).toEqual(['a' + c]);
    expect(roles.above).toEqual(['c' + above]);
    expect(roles.below).toEqual(['c' + below]);
  });

  it('reads a scheme the same whichever way its arrow points', () => {
    const doc = new Doc();
    const { a, c, r } = doc.edit('build', () => {
      const a = bond(doc, 0, 0);
      const r = doc.addArrow({ tail: { x: 0, y: 15 }, head: { x: 0, y: 70 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 });
      const c = bond(doc, 0, 85);
      return { a, c, r: r.id };
    });
    const roles = interpretArrow(doc.arrows.get(r)!, schemeItems(doc, plainMeasure(doc)), doc.style.bondLength);
    expect(roles.reactants).toEqual(['a' + a]);
    expect(roles.products).toEqual(['a' + c]);
  });

  it('leaves out things that are too far away, and curved and resonance arrows', () => {
    const doc = new Doc();
    const r = doc.edit('build', () => { bond(doc, -200, 0); bond(doc, 400, 0); return arrow(doc, 60, 120, 0).id; });
    const roles = interpretArrow(doc.arrows.get(r)!, schemeItems(doc, plainMeasure(doc)), doc.style.bondLength);
    expect(roles.reactants).toEqual([]);
    expect(roles.products).toEqual([]);
  });
});

describe('Clean Up Reaction', () => {
  it('spaces a step evenly and fits the arrow to its conditions', () => {
    const { doc, a, b, r, above, below, c, num } = scheme();
    const m = plainMeasure(doc);
    const numBefore = m.captionBox(doc.captions.get(num)!);
    const cBefore = doc.atoms.get(c)!.x;
    const plan = planCleanUp(doc, m)!;
    expect(plan).not.toBeNull();
    applySchemePlan(doc, m, plan);
    const bl = doc.style.bondLength;
    const items = schemeItems(doc, m);
    const box = (ref: string) => items.find((it) => it.ref === ref || it.atoms.includes(Number(ref.slice(1))))!.box;
    const arr = doc.arrows.get(r)!;
    // the arrow starts half a bond after the nearest starting material, which stays where it was
    expect(arr.tail.x).toBeCloseTo(box('a' + b).x2 + SPACING.gap * bl, 5);
    expect(arr.tail.y).toBeCloseTo((box('a' + b).y1 + box('a' + b).y2) / 2, 5);
    // the product sits half a bond after the head, centred on the arrow
    expect(box('a' + c).x1).toBeCloseTo(arr.head.x + SPACING.gap * bl, 5);
    expect((box('a' + c).y1 + box('a' + c).y2) / 2).toBeCloseTo(arr.tail.y, 5);
    // the other starting material lines up too, with the + sign between them
    expect((box('a' + a).y1 + box('a' + a).y2) / 2).toBeCloseTo(arr.tail.y, 5);
    // conditions are centred on each other, starting a lead-in after the tail, and the arrow is
    // fitted to them: the same gap again before its head
    const ab = box('c' + above), bb = box('c' + below);
    const widest = Math.max(ab.x2 - ab.x1, bb.x2 - bb.x1);
    const sp = spacing(bl);
    const mid = arr.tail.x + sp.lead + widest / 2;
    expect(arr.head.x - arr.tail.x).toBeCloseTo(Math.max(sp.minArrow, sp.lead + widest + sp.headGap + arr.headLength), 5);
    expect((ab.x1 + ab.x2) / 2).toBeCloseTo(mid, 5);
    expect((bb.x1 + bb.x2) / 2).toBeCloseTo(mid, 5);
    expect(ab.y2).toBeCloseTo(arr.tail.y - SPACING.conditions * bl, 5);
    expect(bb.y1).toBeCloseTo(arr.tail.y + SPACING.conditions * bl, 5);
    expect(arr.head.x - arr.tail.x).toBeGreaterThanOrEqual(Math.max(ab.x2 - ab.x1, bb.x2 - bb.x1));
    // the compound number under the product moved with it
    const numAfter = m.captionBox(doc.captions.get(num)!);
    expect(numAfter.x1 - numBefore.x1).toBeCloseTo(doc.atoms.get(c)!.x - cBefore, 5);
    // the roles are kept with the arrow, and doing it again changes nothing
    expect(arr.step?.products).toEqual(['a' + c]);
    expect(planCleanUp(doc, m)).toBeNull();
    // one step to undo
    doc.undo();
    expect(doc.atoms.get(c)!.x).toBe(cBefore);
  });

  it('adds a + sign between starting materials chosen by hand', () => {
    const doc = new Doc();
    const { a, b, r } = doc.edit('build', () => ({ a: bond(doc, 0, 0), b: bond(doc, 30, 0), r: arrow(doc, 60, 120, 0).id }));
    const c = doc.edit('more', () => bond(doc, 140, 0));
    doc.edit('roles', () => doc.updateArrow(r, { step: { reactants: ['a' + b, 'a' + a], products: ['a' + c], above: [], below: [], manual: true } }));
    const m = plainMeasure(doc);
    applySchemePlan(doc, m, planCleanUp(doc, m)!);
    const plusses = [...doc.captions.values()].filter((x) => x.runs[0].text === '+');
    expect(plusses.length).toBe(1);
    expect(doc.arrows.get(r)!.step!.plusses).toEqual(['c' + plusses[0].id]);
    expect(doc.arrows.get(r)!.step!.manual).toBe(true);
  });

  it('lays out steps that follow on from one another in turn', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => ({
      a: bond(doc, 0, 0), r1: arrow(doc, 20, 80, 0).id, b: bond(doc, 100, 6), r2: arrow(doc, 125, 190, 3).id, c: bond(doc, 215, -4),
    }));
    const m = plainMeasure(doc);
    applySchemePlan(doc, m, planCleanUp(doc, m)!);
    const y = (id: number) => doc.atoms.get(id)!.y;
    expect(y(ids.b)).toBeCloseTo(0, 5);
    expect(y(ids.c)).toBeCloseTo(0, 5);
    expect(doc.arrows.get(ids.r2)!.tail.y).toBeCloseTo(0, 5);
  });
});

describe('saving reaction steps for ChemDraw', () => {
  it('writes each step with its parts, and reads it back', () => {
    const { doc, a, b, c, above, below, plus, r } = scheme();
    const xml = writeCdxml(doc);
    const step = /<step[^>]*>/.exec(xml)![0];
    expect(step).toMatch(/ReactionStepArrows="\d+"/);
    expect(step).toContain(`ReactionStepObjectsAboveArrow="${above}"`);
    expect(step).toContain(`ReactionStepObjectsBelowArrow="${below}"`);
    expect(step).toContain(`ReactionStepPlusses="${plus}"`);
    const back = readCdxml(xml).doc;
    const roles = [...back.arrows.values()][0].step!;
    const items = schemeItems(back, plainMeasure(back));
    const atomsOf = (ref: string) => items.find((it) => it.atoms.includes(Number(ref.slice(1))))!.atoms.length;
    expect(roles.reactants.length).toBe(2);
    expect(roles.products.length).toBe(1);
    expect(roles.reactants.map(atomsOf)).toEqual([2, 2]);
    expect(roles.above).toEqual(['c' + above]);
    void a; void b; void c; void r;
  });

  it('keeps a step from a file as it was until its roles change', () => {
    const { doc } = scheme();
    const xml = writeCdxml(doc);
    const back = readCdxml(xml).doc;
    expect(writeCdxml(back)).toBe(xml);
    const r = [...back.arrows.values()][0];
    back.edit('roles', () => back.updateArrow(r.id, { step: { ...r.step!, below: [], manual: true } }));
    const out = writeCdxml(back);
    expect(/<step[^>]*>/.exec(out)![0]).not.toContain('ReactionStepObjectsBelowArrow');
  });
});
