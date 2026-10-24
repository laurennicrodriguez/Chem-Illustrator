import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import type { Vec } from '../src/geom';
import { classify, readSymbol, Sketcher, type SketchHost } from '../src/editor/sketch';

// a hand isn't steady: a little wobble on every point
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
const wobble = (pts: Vec[], k: number) => pts.map((p) => ({ x: p.x + rnd() * k, y: p.y + rnd() * k }));
const segs = (corners: Vec[], per = 10): Vec[] => {
  const out: Vec[] = [];
  for (let i = 1; i < corners.length; i++) for (let j = 0; j < per; j++) {
    const t = j / per;
    out.push({ x: corners[i - 1].x + (corners[i].x - corners[i - 1].x) * t, y: corners[i - 1].y + (corners[i].y - corners[i - 1].y) * t });
  }
  out.push(corners[corners.length - 1]);
  return out;
};
const polygon = (c: Vec, r: number, n: number, rot = -90): Vec[] =>
  segs(Array.from({ length: n + 1 }, (_, i) => ({ x: c.x + r * Math.cos((rot + (360 * i) / n) * Math.PI / 180), y: c.y + r * Math.sin((rot + (360 * i) / n) * Math.PI / 180) })), 8);
const circle = (c: Vec, r: number): Vec[] => Array.from({ length: 61 }, (_, i) => ({ x: c.x + r * Math.cos((i * 6) * Math.PI / 180), y: c.y + r * Math.sin((i * 6) * Math.PI / 180) }));
// a letter drawn in a box at (x, y), size s
const at = (strokes: Vec[][], x: number, y: number, s: number) => strokes.map((st) => wobble(st.map((p) => ({ x: x + p.x * s, y: y + p.y * s })), s * 0.04));
const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number): Vec[] =>
  Array.from({ length: 21 }, (_, i) => { const a = (from + ((to - from) * i) / 20) * Math.PI / 180; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
const ln = (...p: [number, number][]) => segs(p.map(([x, y]) => ({ x, y })), 6);

function host(doc: Doc) {
  const said: string[] = [];
  const h: SketchHost = {
    doc,
    label: (id, text) => doc.edit('Label', () => {
      const z = { C: 6, N: 7, O: 8, S: 16, P: 15, F: 9, Cl: 17, Br: 35, I: 53, H: 1, B: 5 }[text] ?? 6;
      doc.updateAtom(id, { z });
    }),
    atomKey: (id, act) => doc.edit('Charge', () => doc.updateAtom(id, { charge: doc.atoms.get(id)!.charge + (act === 'plus' ? 1 : -1) })),
    setHot: () => {}, done: () => {}, repaint: () => {}, say: (m) => said.push(m),
  };
  return { h, said };
}

describe('sketch strokes', () => {
  const L = new Doc().style.bondLength;
  it('reads shapes', () => {
    expect(classify(wobble(segs([{ x: 0, y: 0 }, { x: L, y: 0 }]), L * 0.03), L).kind).toBe('line');
    const zig = classify(wobble(segs([{ x: 0, y: 0 }, { x: L * 0.87, y: -L / 2 }, { x: L * 1.73, y: 0 }, { x: L * 2.6, y: -L / 2 }]), L * 0.03), L);
    expect(zig.kind === 'line' && zig.vertices.length).toBe(4);
    for (const n of [3, 4, 5, 6, 7]) {
      const k = classify(wobble(polygon({ x: 0, y: 0 }, L * 1.1, n), L * 0.03), L);
      expect(k.kind === 'loop' && k.corners, `${n}-gon`).toBe(n);
    }
    const c = classify(wobble(circle({ x: 0, y: 0 }, L), L * 0.03), L);
    expect(c.kind === 'loop' && c.corners).toBe(0);
    const scr = segs([{ x: 0, y: 0 }, { x: L, y: 0.1 * L }, { x: 0, y: 0.2 * L }, { x: L, y: 0.3 * L }, { x: 0, y: 0.4 * L }, { x: L, y: 0.5 * L }]);
    expect(classify(scr, L).kind).toBe('scribble');
    expect(classify(at([arc(0.5, 0.5, 0.4, 0.5, -40, -320)], 0, 0, L * 0.5)[0], L).kind).toBe('glyph');
  });

  it('reads letters', () => {
    const s = L * 0.5;
    const cases: [string, Vec[][]][] = [
      ['C', [arc(0.55, 0.5, 0.45, 0.5, -45, -315)]],
      ['O', [arc(0.5, 0.5, 0.42, 0.5, -100, 260)]],
      ['N', [ln([0, 1], [0, 0], [0.75, 1], [0.75, 0])]],
      ['S', [[...arc(0.45, 0.26, 0.33, 0.24, -25, -270), ...arc(0.45, 0.75, 0.33, 0.25, -90, 155)]]],
      ['F', [ln([0, 1], [0, 0], [0.7, 0]), ln([0, 0.5], [0.5, 0.5])]],
      ['H', [ln([0, 0], [0, 1]), ln([0.75, 0], [0.75, 1]), ln([0, 0.5], [0.75, 0.5])]],
      ['P', [[...ln([0, 1], [0, 0]), ...arc(0, 0.25, 0.5, 0.25, -90, 90)]]],
      ['Cl', [arc(0.45, 0.5, 0.4, 0.5, -45, -315), ln([1.15, 0], [1.15, 1])]],
      ['Br', [ln([0, 1], [0, 0]), [...arc(0, 0.25, 0.45, 0.25, -90, 90), ...arc(0, 0.75, 0.5, 0.25, -90, 90)], [...ln([0.9, 1], [0.9, 0.4]), ...arc(1.25, 0.5, 0.35, 0.3, 180, 290)]]],
      ['+', [ln([0.5, 0], [0.5, 1]), ln([0, 0.5], [1, 0.5])]],
      ['-', [ln([0, 0.5], [1, 0.5])]],
    ];
    for (const [want, strokes] of cases) expect(readSymbol(at(strokes, 0, 0, s)), want).toBe(want);
  });
});

describe('sketching chemistry', () => {
  it('draws a chain, fuses a ring, labels and erases', () => {
    const doc = new Doc(), L = doc.style.bondLength;
    const { h } = host(doc);
    const sk = new Sketcher(h);
    // a zig-zag of three bonds
    sk.stroke(wobble(segs([{ x: 0, y: 0 }, { x: L * 0.87, y: -L / 2 }, { x: L * 1.73, y: 0 }, { x: L * 2.6, y: -L / 2 }]), L * 0.03));
    expect(doc.atoms.size).toBe(4);
    expect(doc.bonds.size).toBe(3);
    // a line back along the first bond makes it double
    const [a0, a1] = [...doc.atoms.values()];
    sk.stroke(wobble(segs([{ x: a0.x, y: a0.y }, { x: a1.x, y: a1.y }]), L * 0.02));
    expect(doc.bondBetween(a0.id, a1.id)!.order).toBe(2);
    // an O written on the last atom
    const end = [...doc.atoms.values()][3];
    sk.stroke(at([arc(0.5, 0.5, 0.42, 0.5, -100, 260)], end.x - L * 0.2, end.y - L * 0.25, L * 0.45)[0]);
    sk.flush();
    expect(doc.atoms.get(end.id)!.z).toBe(8);
    // a circle away from it all: a benzene ring
    sk.stroke(wobble(circle({ x: 0, y: 5 * L }, L), L * 0.03));
    expect(doc.atoms.size).toBe(10);
    expect([...doc.bonds.values()].filter((b) => b.order === 2).length).toBe(4);
    // a scribble over the ring rubs it out
    const zz: Vec[] = [];
    for (let i = 0; i < 8; i++) zz.push({ x: -1.2 * L + (i % 2) * 2.4 * L, y: 4 * L + i * 0.3 * L });
    sk.stroke(segs(zz));
    expect(doc.atoms.size).toBe(4);
  });

  it('makes a drawn ring aromatic with a circle inside', () => {
    const doc = new Doc(), L = doc.style.bondLength;
    const sk = new Sketcher(host(doc).h);
    sk.stroke(wobble(polygon({ x: 0, y: 0 }, L * 1.1, 6), L * 0.03));
    expect(doc.atoms.size).toBe(6);
    expect([...doc.bonds.values()].every((b) => b.order === 1)).toBe(true);
    sk.stroke(wobble(circle({ x: 0, y: 0 }, L * 0.5), L * 0.02));
    expect([...doc.bonds.values()].filter((b) => b.order === 2).length).toBe(3);
  });
});
