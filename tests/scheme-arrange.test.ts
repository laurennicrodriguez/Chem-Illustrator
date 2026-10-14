// @vitest-environment jsdom
//
// Arranging a scheme (Scheme > Arrange): the same steps laid out in a line, rows, a snake, down
// the page, round a catalytic cycle or as a branching tree.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { applyArrange, planArrange, readScheme, type Scope } from '../src/chem/scheme-arrange';

const all = (): Scope => ({ atoms: new Set(), captions: new Set(), shapes: new Set(), arrows: new Set() });

function bond(doc: Doc, x: number, y: number): number {
  const a = doc.addAtom(x - 6, y), b = doc.addAtom(x + 6, y);
  doc.addBond(a.id, b.id);
  return a.id;
}
function arrow(doc: Doc, x1: number, y1: number, x2: number, y2: number) {
  return doc.addArrow({ tail: { x: x1, y: y1 }, head: { x: x2, y: y2 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 }).id;
}
function caption(doc: Doc, text: string, x: number, y: number): number {
  return doc.addCaption({ x, y, runs: [{ text }], justify: 'left' }).id;
}

/** n structures in a row with no arrows yet. */
function loose(n: number) {
  const doc = new Doc();
  const atoms = doc.edit('build', () => Array.from({ length: n }, (_, i) => bond(doc, i * 60, 0)));
  return { doc, atoms };
}

/** A → B → C → D drawn as a line, with "cond" above each arrow. */
function line() {
  const doc = new Doc();
  doc.edit('build', () => {
    for (let i = 0; i < 4; i++) bond(doc, i * 80, 0);
    for (let i = 0; i < 3; i++) { arrow(doc, i * 80 + 12, 0, i * 80 + 68, 0); caption(doc, 'cond', i * 80 + 30, -6); }
  });
  return doc;
}

const centreOf = (doc: Doc, atom: number) => {
  const a = doc.atoms.get(atom)!;
  return { x: a.x + 6, y: a.y };
};

describe('arranging a scheme', () => {
  it('joins loose structures into a cycle with one curved arrow per step', () => {
    const { doc, atoms } = loose(4);
    const m = plainMeasure(doc);
    const plan = planArrange(doc, m, all(), { kind: 'cycle' })!;
    expect(plan).not.toBeNull();
    applyArrange(doc, m, plan);
    expect(doc.arrows.size).toBe(4);
    for (const r of doc.arrows.values()) {
      expect(r.sweep).not.toBe(0);
      expect(r.step?.reactants.length).toBe(1);
      expect(r.step?.products.length).toBe(1);
    }
    // the structures sit on a circle
    const pts = atoms.map((a) => centreOf(doc, a));
    const c = { x: pts.reduce((s, p) => s + p.x, 0) / 4, y: pts.reduce((s, p) => s + p.y, 0) / 4 };
    const radii = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    for (const r of radii) expect(r).toBeCloseTo(radii[0], 0);
    // and the cycle closes: every structure is a starting material once and a product once
    const reactants = [...doc.arrows.values()].map((r) => r.step!.reactants[0]).sort();
    const products = [...doc.arrows.values()].map((r) => r.step!.products[0]).sort();
    expect(reactants).toEqual(products);
  });

  it('reads the same steps back after a layout, so layouts can be switched back and forth', () => {
    const doc = line();
    const m = plainMeasure(doc);
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'down' })!);
    const arrowsAfterDown = [...doc.arrows.keys()];
    const shape = readScheme(doc, m, all());
    expect(shape.nodes.length).toBe(4);
    expect(shape.links.length).toBe(3);
    expect(shape.path).not.toBeNull();
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'line' })!);
    // no arrows made or lost, and the line is level again
    expect([...doc.arrows.keys()]).toEqual(arrowsAfterDown);
    for (const r of doc.arrows.values()) expect(r.tail.y).toBeCloseTo(r.head.y, 6);
    // each condition stays with its arrow
    for (const r of doc.arrows.values()) expect(r.step!.above.length).toBe(1);
  });

  it('breaks a line into rows of the chosen length', () => {
    const doc = line();
    const m = plainMeasure(doc);
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'rows', perRow: 2 })!);
    const ys = [...doc.arrows.values()].map((r) => Math.round((r.tail.y + r.head.y) / 2));
    // two arrows in the first row; the next row starts with an arrow lower down
    expect(new Set(ys).size).toBe(2);
  });

  it('lays a branching scheme out as a tree', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const a = bond(doc, 0, 0), b = bond(doc, 80, -40), c = bond(doc, 80, 40);
      arrow(doc, 12, -4, 68, -36);
      arrow(doc, 12, 4, 68, 36);
      return { a, b, c };
    });
    const m = plainMeasure(doc);
    // a branch is not a single line, so only the tree layout takes it
    expect(planArrange(doc, m, all(), { kind: 'line' })).toBeNull();
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'tree' })!);
    const a = centreOf(doc, ids.a), b = centreOf(doc, ids.b), c = centreOf(doc, ids.c);
    // both products to the right of the starting material, one above the other
    expect(b.x).toBeGreaterThan(a.x);
    expect(c.x).toBeCloseTo(b.x, 0);
    expect(Math.abs(b.y - c.y)).toBeGreaterThan(10);
  });

  it('takes away the reagent arrows of an earlier cycle when re-arranged', () => {
    const doc = line();
    const m = plainMeasure(doc);
    const steps = [...doc.arrows.values()];
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'cycle', reagentArrows: true })!);
    const reagent = [...doc.arrows.values()].filter((r) => r.reagentFor !== undefined);
    expect(reagent.length).toBeGreaterThan(0);
    for (const r of reagent) expect(steps.map((s) => s.id)).toContain(r.reagentFor);
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'line' })!);
    expect([...doc.arrows.values()].filter((r) => r.reagentFor !== undefined)).toEqual([]);
    expect(doc.arrows.size).toBe(4);
  });

  it('is one undoable step', () => {
    const { doc, atoms } = loose(3);
    const before = atoms.map((a) => ({ ...centreOf(doc, a) }));
    const m = plainMeasure(doc);
    applyArrange(doc, m, planArrange(doc, m, all(), { kind: 'cycle' })!);
    doc.undo();
    expect(doc.arrows.size).toBe(0);
    expect(atoms.map((a) => centreOf(doc, a))).toEqual(before);
  });
});
