// @vitest-environment jsdom
//
// Mechanism drawing, round 4: S-shaped arrows, arrows into the gap where a bond forms, radicals
// and charges as starting points, ends that stay stuck to the structure when it moves, and the
// mechanism test set (undergraduate and organometallic steps).

import { describe, expect, it } from 'vitest';
import { Doc, type Arrow } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { cleanUpArrow, gapAt, pathClash, pushArrow, pushEndAt, pushPins, type PushArrow, type PushEnd } from '../src/chem/mechanism';
import { followPins, makePin, pinPoint } from '../src/chem/pins';
import { arrowHit, arrowPoints, bezPoints, chordLocal, chordPoint, headBend, arrowHandles, dragArrowHandle } from '../src/objects';
import { snapshot, transform, rotation, mirrorY } from '../src/editor/arrange';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { cdxToCdxml, cdxmlToCdx } from '../src/io/cdx';
import { dist, type Vec } from '../src/geom';

const L = new Doc().style.bondLength;
type AtomSpec = [number, number, number?, Record<string, unknown>?];

/** A structure from atoms (in bond lengths) and bonds, with its atom ids in order. */
function build(doc: Doc, atoms: AtomSpec[], bonds: [number, number, number?][], ox = 100, oy = 100): number[] {
  return doc.edit('build', () => {
    const ids = atoms.map(([x, y, z, extra]) => doc.addAtom(ox + x * L, oy + y * L, z ?? 6, extra ?? {}).id);
    for (const [i, j, o] of bonds) doc.addBond(ids[i], ids[j], o ?? 1);
    return ids;
  });
}

/** Add an arrow as the curved-arrow tool does: its look, and its ends pinned. */
function add(doc: Doc, p: PushArrow, half = false): Arrow {
  return doc.edit('arrow', () => doc.addArrow({
    tail: p.tail, head: p.head, sweep: p.sweep, ...(p.bez ? { bez: p.bez } : {}), pin: pushPins(doc, p),
    headStyle: half ? (headBend(p) > 0 ? 'halfLeft' : 'halfRight') : 'full', tailStyle: 'none', headType: 'solid', line: 'solid',
    noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5,
  }));
}

const own = (doc: Doc, ...ends: PushEnd[]) => {
  const s = new Set<number>();
  for (const e of ends) {
    if (e.kind === 'atom') s.add(e.id);
    if (e.kind === 'bond') { const b = doc.bonds.get(e.id)!; s.add(b.a1).add(b.a2); }
    if (e.kind === 'gap') s.add(e.a1).add(e.a2);
  }
  return s;
};
/** How badly an arrow runs into the structure (as Clean Up Arrow scores it). */
const clash = (doc: Doc, r: PushArrow, from: PushEnd, to: PushEnd) => pathClash(doc, plainMeasure(doc), arrowPoints(r, 28).slice(1, -1), r.tail, r.head, own(doc, from, to));
const bondId = (doc: Doc, a: number, b: number) => doc.bondBetween(a, b)!.id;

describe('S-shaped arrows (Bézier curves)', () => {
  const r = { tail: { x: 0, y: 0 }, head: { x: 100, y: 0 }, sweep: 0, bez: [{ x: 0.25, y: 0.8 }, { x: 0.75, y: -0.8 }] };

  it('runs from tail to head, bending one way and then the other', () => {
    const pts = arrowPoints(r, 24);
    expect(dist(pts[0], r.tail)).toBeLessThan(1e-9);
    expect(dist(pts[24], r.head)).toBeLessThan(1e-9);
    // perp of (1, 0) is (0, 1): the first bend goes to +y, the second to −y
    expect(pts[6].y).toBeGreaterThan(5);
    expect(pts[18].y).toBeLessThan(-5);
    expect(arrowHit({ ...r, id: 1 } as Arrow, pts[6], 1)).toBe(true);
    expect(arrowHit({ ...r, id: 1 } as Arrow, { x: 50, y: 40 }, 1)).toBe(false);
  });

  it('keeps its shape in the frame of its ends (so it moves, turns and stretches with them)', () => {
    const p = { x: 30, y: -12 };
    expect(dist(chordPoint(r.tail, r.head, chordLocal(r.tail, r.head, p)), p)).toBeLessThan(1e-9);
    const turned = { ...r, tail: { x: 10, y: 10 }, head: { x: 10, y: 210 } };
    const pts = bezPoints(turned)!;
    expect(dist(pts[1], { x: 10 - 0.8 * 200, y: 10 + 0.25 * 200 })).toBeLessThan(1e-9);
  });

  it('has a handle on each control point that bends it', () => {
    const a = { ...r, id: 7 } as Arrow;
    const hs = arrowHandles(a);
    expect(hs.map((h) => h.which)).toEqual(['tail', 'head', 'b0', 'b1']);
    const patch = dragArrowHandle(a, 'b1', { x: 80, y: -40 }, false);
    expect(patch.bez![1]).toEqual({ x: 0.8, y: -0.4 });
    expect(patch.bez![0]).toEqual(r.bez[0]);
  });

  it('puts a fishhook barb on the outside of the last bend', () => {
    expect(headBend(r)).toBe(1);
    expect(headBend({ ...r, bez: [{ x: 0.25, y: -0.8 }, { x: 0.75, y: 0.8 }] })).toBe(-1);
  });

  it('snaps from a lone pair round to the atom when asked for an S', () => {
    const doc = new Doc();
    const [c, , , , n] = build(doc, [[0, 0], [0, -1, 8], [-0.87, 0.5], [0.87, 0.5], [2.6, -0.4, 7], [3.3, 0.3], [3.3, -1.1]], [[0, 1, 2], [0, 2], [0, 3], [4, 5], [4, 6]]);
    const p = pushArrow(doc, plainMeasure(doc), { kind: 'atom', id: n }, { kind: 'atom', id: c }, { s: true })!;
    expect(p.bez).toHaveLength(2);
    expect(Math.sign(p.bez![0].y)).toBe(-Math.sign(p.bez![1].y));
    // it stops short of the carbon, and starts clear of the N
    expect(dist(p.head, doc.atoms.get(c)!)).toBeGreaterThan(0.15 * L);
    expect(dist(p.tail, doc.atoms.get(n)!)).toBeGreaterThan(0.15 * L);
    expect(dist(p.head, doc.atoms.get(c)!)).toBeLessThan(0.6 * L);
  });

  it('Clean Up Arrow uses an S where every single curve runs into something', () => {
    const doc = new Doc();
    // atoms right where any arc between the two ends would bulge, on both sides; the middle is free
    build(doc, [[3.5, 0.7], [3.5, 1.3], [3.5, 2.0], [3.5, -0.7], [3.5, -1.3], [3.5, -2.0]], [], 100, 100);
    const tail = { x: 100, y: 100 }, head = { x: 100 + 7 * L, y: 100 };
    const r = cleanUpArrow(doc, plainMeasure(doc), { tail, head, sweep: 1.5 })!;
    expect(r.bez).toBeDefined();
    expect(r.tail).toEqual(tail);
    expect(r.head).toEqual(head);
  });

  it('an S-shaped arrow stays S-shaped when cleaned up', () => {
    const doc = new Doc();
    const [c] = build(doc, [[0, 0], [1, 0, 35]], [[0, 1]]);
    const hit = doc.atoms.get(c)!;
    const r = cleanUpArrow(doc, plainMeasure(doc), { tail: { x: hit.x - 3 * L, y: hit.y }, head: { x: hit.x + 0.2, y: hit.y }, sweep: 0, bez: [{ x: 0.3, y: 0.5 }, { x: 0.7, y: -0.5 }] })!;
    expect(r.bez).toBeDefined();
  });
});

describe('where mechanism arrows start and end', () => {
  it('finds the gap where a new bond will form, but not across a structure', () => {
    const doc = new Doc();
    // (each with a neighbour, so neither is drawn as CH4)
    const [a, b] = build(doc, [[0, 0], [2, 0], [5, 0], [6, 0], [7, 0], [-0.87, 0.5], [2.87, 0.5]], [[2, 3], [3, 4], [0, 5], [1, 6]]);
    const mid = { x: 100 + L, y: 100 };
    expect(pushEndAt(doc, plainMeasure(doc), mid)).toEqual({ kind: 'gap', a1: a, a2: b });
    // the ends of a chain have its middle atom between them
    expect(gapAt(doc, { x: 100 + 6 * L, y: 100 })).toBeNull();
  });

  it('starts from a radical dot or a circled minus as from a lone pair', () => {
    const doc = new Doc();
    const [, o, , c] = build(doc, [[0, 0], [1, 0, 8], [-1.5, 0.3], [3, -0.6], [3.87, -1.1]], [[0, 1], [3, 4]]);
    const dot = doc.edit('dot', () => doc.addShape({ kind: 'symbol', symbol: 'Electron', x1: 100 + 1.35 * L, y1: 100 - 0.2 * L, x2: 100 + 1.35 * L, y2: 100 - 0.2 * L }));
    const m = plainMeasure(doc);
    expect(pushEndAt(doc, m, { x: 100 + 1.35 * L, y: 100 - 0.2 * L })).toEqual({ kind: 'pair', id: dot.id });
    const p = pushArrow(doc, m, { kind: 'atom', id: o }, { kind: 'atom', id: c }, { side: 1 })!;
    // it starts at the dot, not on the far side of the O
    expect(dist(p.tail, { x: 100 + 1.35 * L, y: 100 - 0.2 * L })).toBeLessThan(0.25 * L);
  });
});

describe('arrows and lone pairs stuck to the structure', () => {
  /** Hydroxide and methyl bromide, with the two SN2 arrows drawn. */
  function sn2() {
    const doc = new Doc();
    const ids = build(doc, [[0, 0, 8, { charge: -1 }], [2.2, 0], [2.2, -1], [1.6, 0.8], [2.8, 0.8], [3.2, 0, 35]], [[1, 2], [1, 3], [1, 4], [1, 5]]);
    const m = plainMeasure(doc);
    const a1 = add(doc, pushArrow(doc, m, { kind: 'atom', id: ids[0] }, { kind: 'atom', id: ids[1] })!);
    const a2 = add(doc, pushArrow(doc, m, { kind: 'bond', id: bondId(doc, ids[1], ids[5]) }, { kind: 'atom', id: ids[5] })!);
    return { doc, ids, a1: a1.id, a2: a2.id };
  }

  it('pins both ends of a snapped arrow', () => {
    const { doc, a1, a2 } = sn2();
    expect(doc.arrows.get(a1)!.pin?.tail?.on).toBe('atom');
    expect(doc.arrows.get(a1)!.pin?.head?.on).toBe('atom');
    expect(doc.arrows.get(a2)!.pin?.tail?.on).toBe('bond');
  });

  it('moves an arrow with the structure it is stuck to, and stretches one stuck to two', () => {
    const { doc, ids, a1, a2 } = sn2();
    const before1 = structuredClone(doc.arrows.get(a1)!), before2 = structuredClone(doc.arrows.get(a2)!);
    doc.edit('move', () => doc.moveAtoms(ids.slice(1), 20, 10));
    const r2 = doc.arrows.get(a2)!, r1 = doc.arrows.get(a1)!;
    expect(dist(r2.tail, { x: before2.tail.x + 20, y: before2.tail.y + 10 })).toBeLessThan(1e-6);
    expect(dist(r2.head, { x: before2.head.x + 20, y: before2.head.y + 10 })).toBeLessThan(1e-6);
    expect(r2.sweep).toBeCloseTo(before2.sweep);
    // the hydroxide stayed: its end stayed, the head went with the carbon
    expect(dist(r1.tail, before1.tail)).toBeLessThan(1e-6);
    expect(dist(r1.head, { x: before1.head.x + 20, y: before1.head.y + 10 })).toBeLessThan(1e-6);
    // and one undo puts it all back
    doc.undo();
    expect(dist(doc.arrows.get(a2)!.tail, before2.tail)).toBeLessThan(1e-6);
  });

  it('turns and flips with the structure', () => {
    const { doc, ids, a2 } = sn2();
    const sel = { atoms: new Set(ids.slice(1)), bonds: new Set([...doc.bonds.keys()]), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
    const m = plainMeasure(doc);
    const c = doc.atoms.get(ids[1])!;
    const before = structuredClone(doc.arrows.get(a2)!);
    const turn = rotation({ x: c.x, y: c.y }, Math.PI / 2);
    doc.edit('turn', () => transform(doc, snapshot(doc, sel, m), turn, false));
    const r = doc.arrows.get(a2)!;
    expect(dist(r.tail, turn(before.tail))).toBeLessThan(1e-6);
    expect(dist(r.head, turn(before.head))).toBeLessThan(1e-6);
    expect(r.sweep).toBeCloseTo(before.sweep);
    // a mirror image: the curve bends the other way
    const flip = mirrorY(c.y);
    const mid = structuredClone(r);
    doc.edit('flip', () => transform(doc, snapshot(doc, sel, m), flip, true));
    const f = doc.arrows.get(a2)!;
    expect(dist(f.tail, flip(mid.tail))).toBeLessThan(1e-6);
    expect(f.sweep).toBeCloseTo(-mid.sweep);
  });

  it('comes loose when it is dragged away, and holds a new place nearby', () => {
    const { doc, a2 } = sn2();
    const r = doc.arrows.get(a2)!;
    doc.edit('nudge', () => doc.updateArrow(a2, { tail: { x: r.tail.x + 1, y: r.tail.y }, head: { x: r.head.x + 1, y: r.head.y } }));
    expect(doc.arrows.get(a2)!.pin?.tail).toBeDefined();
    const r2 = doc.arrows.get(a2)!;
    doc.edit('away', () => doc.updateArrow(a2, { tail: { x: r2.tail.x + 5 * L, y: r2.tail.y }, head: { x: r2.head.x + 5 * L, y: r2.head.y } }));
    expect(doc.arrows.get(a2)!.pin).toBeUndefined();
  });

  it('sticks a lone pair to its atom as it is drawn, and takes it along', () => {
    const doc = new Doc();
    const [o] = build(doc, [[0, 0, 8], [1, 0]], [[0, 1]]);
    const lp = doc.edit('pair', () => doc.addShape({ kind: 'symbol', symbol: 'LonePair', x1: 99, y1: 95, x2: 101, y2: 95 }));
    expect(doc.shapes.get(lp.id)!.pin?.ref[0]).toBe(o);
    doc.edit('move', () => doc.moveAtoms([...doc.atoms.keys()], 10, 5));
    const s = doc.shapes.get(lp.id)!;
    expect(s.x1).toBeCloseTo(109);
    expect(s.y1).toBeCloseTo(100);
  });

  it('frames a pin so it survives a neighbour being erased', () => {
    const doc = new Doc();
    const [a, b, c] = build(doc, [[0, 0], [1, 0], [1.5, 0.87]], [[0, 1], [1, 2]]);
    const pin = doc.edit('pin', () => makePin(doc, 'atom', [b], { x: 100 + L, y: 100 - 5 }))!;
    expect(pin.ref).toEqual([b, a, c]);
    expect(dist(pinPoint(doc, pin)!, { x: 100 + L, y: 95 })).toBeLessThan(1e-9);
    doc.edit('arrow', () => doc.addArrow({ tail: { x: 100 + L, y: 95 }, head: { x: 140, y: 60 }, sweep: 1, pin: { tail: pin }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 }));
    doc.edit('erase', () => doc.removeAtom(c));
    const r = [...doc.arrows.values()][0];
    expect(r.pin?.tail?.ref[0]).toBe(b);
    expect(r.pin?.tail?.ref).not.toContain(c);
    followPins(doc);
  });
});

describe('saving S-shaped and stuck arrows', () => {
  it('saves an S as a ChemDraw curve with arrowheads, and reads it back the same', () => {
    const doc = new Doc();
    const ids = build(doc, [[0, 0, 8, { charge: -1 }], [2.2, 0], [2.2, -1]], [[1, 2]]);
    const p = pushArrow(doc, plainMeasure(doc), { kind: 'atom', id: ids[0] }, { kind: 'atom', id: ids[1] }, { s: true })!;
    const r = add(doc, p, true);
    const xml = writeCdxml(doc);
    expect(xml).toContain('<curve');
    expect(xml).toMatch(/CurveType="(32|36|34)"/);
    const back = readCdxml(xml).doc;
    const got = [...back.arrows.values()][0];
    expect(got.bez).toHaveLength(2);
    for (let i = 0; i < 2; i++) { expect(got.bez![i].x).toBeCloseTo(r.bez![i].x, 2); expect(got.bez![i].y).toBeCloseTo(r.bez![i].y, 2); }
    expect(got.headStyle).toBe(r.headStyle);
    // and its ends are still stuck to the atoms (named afresh in the opened file)
    expect(got.pin?.tail?.ref.length).toBeGreaterThan(0);
    const moved = [...back.atoms.values()].find((a) => a.z === 6)!;
    back.edit('move', () => back.moveAtoms(back.fragmentOf(moved.id), 10, 0));
    expect([...back.arrows.values()][0].head.x).toBeCloseTo(got.head.x + 10, 2);
  });

  it('keeps a curve arrow through CDX', () => {
    const doc = new Doc();
    doc.edit('arrow', () => doc.addArrow({ tail: { x: 10, y: 10 }, head: { x: 60, y: 10 }, sweep: 0, bez: [{ x: 0.25, y: 0.8 }, { x: 0.75, y: -0.8 }], headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, headLength: 6, headWidth: 1.5 }));
    const back = readCdxml(cdxToCdxml(cdxmlToCdx(writeCdxml(doc)))).doc;
    const got = [...back.arrows.values()][0];
    expect(got.bez?.[0].y).toBeCloseTo(0.8, 2);
    expect(got.head.x).toBeCloseTo(60, 2);
  });

  it('reads a freehand ChemDraw curve with an arrowhead as an arrow', () => {
    const xml = `<?xml version="1.0"?><CDXML><page id="1"><curve id="5" CurvePoints="10 10 10 10 20 30 40 -10 50 10 50 10" CurveType="8"/></page></CDXML>`;
    const doc = readCdxml(xml).doc;
    const r = [...doc.arrows.values()][0];
    expect(r.headStyle).toBe('full');
    expect(r.tail).toEqual({ x: 10, y: 10 });
    expect(r.head).toEqual({ x: 50, y: 10 });
    expect(r.bez).toHaveLength(2);
  });
});

describe('the mechanism test set', () => {
  const m = (doc: Doc) => plainMeasure(doc);
  /** Every arrow in a step: drawn clear of the structure, its head near what it points at. */
  function check(doc: Doc, steps: [PushEnd, PushEnd, Vec][]) {
    for (const [from, to, target] of steps) {
      const p = pushArrow(doc, m(doc), from, to)!;
      expect(p, JSON.stringify([from, to])).not.toBeNull();
      expect(clash(doc, p, from, to), JSON.stringify([from, to])).toBeLessThan(0.6);
      expect(dist(p.head, target), JSON.stringify([from, to])).toBeLessThan(0.75 * L);
      expect(pushPins(doc, p)).toBeDefined();
    }
  }
  const at = (doc: Doc, id: number) => doc.atoms.get(id)!;
  const mid = (doc: Doc, a: number, b: number) => ({ x: (at(doc, a).x + at(doc, b).x) / 2, y: (at(doc, a).y + at(doc, b).y) / 2 });

  it('SN2: hydroxide onto carbon, C–Br onto bromine', () => {
    const doc = new Doc();
    const [o, c, , , , br] = build(doc, [[0, 0, 8, { charge: -1 }], [2.2, 0], [2.2, -1], [1.6, 0.8], [2.8, 0.8], [3.2, 0, 35]], [[1, 2], [1, 3], [1, 4], [1, 5]]);
    check(doc, [[{ kind: 'atom', id: o }, { kind: 'atom', id: c }, at(doc, c)], [{ kind: 'bond', id: bondId(doc, c, br) }, { kind: 'atom', id: br }, at(doc, br)]]);
  });

  it('E2: base onto H, C–H into C=C, C–Br onto bromine', () => {
    const doc = new Doc();
    const [h, cb, ca, br, , , o] = build(doc, [[1, -1, 1], [1, 0], [2, 0], [2, 1, 35], [0.13, 0.5], [2.87, -0.5], [-0.3, -2.4, 8, { charge: -1 }]], [[0, 1], [1, 2], [2, 3], [1, 4], [2, 5]]);
    check(doc, [
      [{ kind: 'atom', id: o }, { kind: 'atom', id: h }, at(doc, h)],
      [{ kind: 'bond', id: bondId(doc, h, cb) }, { kind: 'bond', id: bondId(doc, cb, ca) }, mid(doc, cb, ca)],
      [{ kind: 'bond', id: bondId(doc, ca, br) }, { kind: 'atom', id: br }, at(doc, br)],
    ]);
  });

  it('Diels–Alder: three arrows round the ring, two into forming bonds', () => {
    const doc = new Doc();
    const v = (k: number, out = 0): AtomSpec => [Math.cos(k * Math.PI / 3) + out * 0.87, Math.sin(k * Math.PI / 3) + out * 0.5];
    const [c1, c2, c3, c4, c5, c6] = build(doc, [v(2), v(3), v(4), v(5), v(0, 0.8), v(1, 0.8)], [[0, 1, 2], [1, 2], [2, 3, 2], [4, 5, 2]]);
    check(doc, [
      [{ kind: 'bond', id: bondId(doc, c1, c2) }, { kind: 'bond', id: bondId(doc, c2, c3) }, mid(doc, c2, c3)],
      [{ kind: 'bond', id: bondId(doc, c3, c4) }, { kind: 'gap', a1: c4, a2: c5 }, mid(doc, c4, c5)],
      [{ kind: 'bond', id: bondId(doc, c5, c6) }, { kind: 'gap', a1: c6, a2: c1 }, mid(doc, c6, c1)],
    ]);
  });

  it('aldol addition: enolate C=C onto the carbonyl carbon, C=O onto oxygen', () => {
    const doc = new Doc();
    const [o1, c1, c2, , c3, o2] = build(doc, [[0, 0, 8, { charge: -1 }], [0.87, 0.5], [1.73, 0], [0.87, 1.5], [3.4, 0.6], [3.4, -0.4, 8], [4.27, 1.1], [2.9, 1.5]], [[0, 1], [1, 2, 2], [1, 3], [4, 5, 2], [4, 6], [4, 7]]);
    check(doc, [
      [{ kind: 'atom', id: o1 }, { kind: 'bond', id: bondId(doc, o1, c1) }, mid(doc, o1, c1)],
      [{ kind: 'bond', id: bondId(doc, c1, c2) }, { kind: 'gap', a1: c2, a2: c3 }, mid(doc, c2, c3)],
      [{ kind: 'bond', id: bondId(doc, c3, o2) }, { kind: 'atom', id: o2 }, at(doc, o2)],
    ]);
  });

  it('Grignard addition: C–Mg onto the carbonyl carbon', () => {
    const doc = new Doc();
    const [mg, c, co, o] = build(doc, [[0, 0, 12, { label: 'MgBr' }], [1, 0], [2.6, 0.9], [2.6, -0.1, 8], [3.47, 1.4], [1.73, 1.4]], [[0, 1], [2, 3, 2], [2, 4], [2, 5]]);
    check(doc, [
      [{ kind: 'bond', id: bondId(doc, mg, c) }, { kind: 'atom', id: co }, at(doc, co)],
      [{ kind: 'bond', id: bondId(doc, co, o) }, { kind: 'atom', id: o }, at(doc, o)],
    ]);
  });

  it('oxidative addition: Pd onto the ipso carbon, C–Br onto Pd', () => {
    const doc = new Doc();
    const ring = Array.from({ length: 6 }, (_, k): AtomSpec => [3.2 + Math.cos(Math.PI + k * Math.PI / 3), 0.2 + Math.sin(Math.PI + k * Math.PI / 3)]);
    const [pd, ipso, , , , , , br] = build(doc, [[-0.3, 0.6, 46, { label: 'PdL2' }], ...ring, [2.2, -0.8, 35]], [[1, 2, 2], [2, 3], [3, 4, 2], [4, 5], [5, 6, 2], [6, 1], [1, 7]]);
    check(doc, [
      [{ kind: 'atom', id: pd }, { kind: 'atom', id: ipso }, at(doc, ipso)],
      [{ kind: 'bond', id: bondId(doc, ipso, br) }, { kind: 'atom', id: pd }, at(doc, pd)],
    ]);
  });

  it('β-hydride elimination: C–H into the forming Pd–H bond, Pd–C into C=C', () => {
    const doc = new Doc();
    const [pd, ca, cb, h] = build(doc, [[0, 0, 46, { label: 'PdLn' }], [1, 0], [1.5, 0.87], [0.4, 1.5, 1], [2.5, 0.87]], [[0, 1], [1, 2], [2, 3], [2, 4]]);
    check(doc, [
      [{ kind: 'bond', id: bondId(doc, cb, h) }, { kind: 'gap', a1: pd, a2: h }, mid(doc, pd, h)],
      [{ kind: 'bond', id: bondId(doc, pd, ca) }, { kind: 'bond', id: bondId(doc, ca, cb) }, mid(doc, ca, cb)],
    ]);
  });

  it('migratory insertion: Pd–C onto the alkene carbon, the π bond into the forming Pd–C', () => {
    const doc = new Doc();
    const [pd, me, c1, c2] = build(doc, [[0, 0, 46, { label: 'PdL' }], [-0.9, 0.9], [1.9, 0.3], [2.2, 1.25]], [[0, 1], [2, 3, 2]]);
    check(doc, [
      [{ kind: 'bond', id: bondId(doc, pd, me) }, { kind: 'atom', id: c2 }, at(doc, c2)],
      [{ kind: 'bond', id: bondId(doc, c1, c2) }, { kind: 'gap', a1: pd, a2: c1 }, mid(doc, pd, c1)],
    ]);
  });

  it('homolysis: a fishhook pair from one bond, one to each atom', () => {
    const doc = new Doc();
    const [a, b] = build(doc, [[0, 0, 8], [1, 0, 8], [-0.5, 0.87], [1.5, 0.87]], [[0, 1], [0, 2], [1, 3]]);
    const bond = { kind: 'bond', id: bondId(doc, a, b) } as const;
    for (const atom of [a, b]) {
      const p = pushArrow(doc, m(doc), bond, { kind: 'atom', id: atom }, { side: atom === a ? 1 : -1 })!;
      expect(p.small).toBe(true);
      expect(dist(p.head, at(doc, atom))).toBeLessThan(0.75 * L);
    }
  });
});
