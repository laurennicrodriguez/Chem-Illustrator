// @vitest-environment jsdom
//
// Ring fills, highlights, and hatched, stippled and gradient fills (feature list item 7): the
// pattern and gradient geometry, ring fills that follow their atoms, and saving for ChemDraw.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { cutCorners, dotCentres, gradientBands, hatchLines, insetPolygon, mix, patternAngles, patternInk, patternSpacing, radialBands, RING_PATTERN_COLOUR } from '../src/render/fills';
import { fillRings, refitRingFills, ringsIn } from '../src/chem/ring-fill';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const square = [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]];
const area = (p: { x: number; y: number }[]) => Math.abs(p.reduce((t, a, i) => { const b = p[(i + 1) % p.length]; return t + a.x * b.y - b.x * a.y; }, 0)) / 2;

describe('pattern geometry', () => {
  it('cuts hatching to the inside of the shape', () => {
    const lines = hatchLines(square, 0, 2);
    // horizontal lines at y = 0, 2, … 10, each running the width of the square
    expect(lines.length).toBeGreaterThanOrEqual(5);
    for (const [a, b] of lines) {
      expect(Math.abs(Math.abs(b.x - a.x) - 10)).toBeLessThan(1e-6);
      expect(a.y).toBeCloseTo(b.y);
    }
    // diagonal lines stay inside too
    for (const [a, b] of hatchLines(square, -45, 1.5)) for (const p of [a, b]) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
      expect(p.y).toBeGreaterThanOrEqual(-1e-6); expect(p.y).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it('leaves a hole clear (even-odd)', () => {
    const ring = [square[0], [{ x: 3, y: 3 }, { x: 7, y: 3 }, { x: 7, y: 7 }, { x: 3, y: 7 }]];
    const across = hatchLines(ring, 0, 5).filter(([a]) => Math.abs(a.y - 5) < 1e-6);
    expect(across).toHaveLength(2);
  });

  it('puts stippling dots only inside', () => {
    const dots = dotCentres(square, 2);
    expect(dots.length).toBeGreaterThan(20);
    for (const d of dots) { expect(d.x).toBeGreaterThanOrEqual(0); expect(d.x).toBeLessThanOrEqual(10); }
  });

  it('knows each pattern’s line directions', () => {
    expect(patternAngles('crosshatch')).toHaveLength(2);
    expect(patternAngles('dots')).toEqual([]);
  });

  it('cuts a gradient into bands that cover the shape', () => {
    const bands = gradientBands(square, 0, '#000000', '#ffffff', 10);
    expect(bands).toHaveLength(10);
    // the bands overlap a hair so no gap shows; together they cover the square
    expect(bands.reduce((t, b) => t + area(b.poly), 0)).toBeGreaterThanOrEqual(100 - 1e-6);
    expect(bands[0].color).toBe('#000000');
    expect(bands[9].color).toBe('#ffffff');
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
  });

  it('keeps a radial gradient inside the shape', () => {
    for (const b of radialBands(square, '#ff0000', '#0000ff', 6)) for (const p of b.poly) {
      expect(p.x).toBeGreaterThanOrEqual(-1e-6); expect(p.x).toBeLessThanOrEqual(10 + 1e-6);
    }
  });

  it('draws a ring’s pattern in from its bonds', () => {
    const hex = Array.from({ length: 6 }, (_, i) => ({ x: 10 * Math.cos((i * Math.PI) / 3), y: 10 * Math.sin((i * Math.PI) / 3) }));
    const inner = insetPolygon(hex, 2);
    // a regular hexagon's edges are 8.66 from the middle; moved in by 2
    expect(Math.hypot((inner[0].x + inner[1].x) / 2, (inner[0].y + inner[1].y) / 2)).toBeCloseTo(8.66 - 2, 1);
  });
});

/** Benzene with a methyl, drawn as a hexagon. */
function toluene() {
  const doc = new Doc();
  doc.beforeCommit = (before) => refitRingFills(doc, before);
  const ids = doc.edit('Draw', () => {
    const r = Array.from({ length: 6 }, (_, i) => doc.addAtom(14 * Math.cos((i * Math.PI) / 3), 14 * Math.sin((i * Math.PI) / 3)).id);
    for (let i = 0; i < 6; i++) doc.addBond(r[i], r[(i + 1) % 6], i % 2 ? 2 : 1);
    const me = doc.addAtom(28, 0).id;
    doc.addBond(r[0], me);
    return r;
  });
  return { doc, ids };
}

describe('ring fills', () => {
  it('fills the rings wholly in the selection, once', () => {
    const { doc } = toluene();
    expect(ringsIn(doc, [])).toHaveLength(1);
    const made = doc.edit('Fill', () => fillRings(doc, []));
    expect(made).toHaveLength(1);
    expect(doc.edit('Fill again', () => fillRings(doc, []))).toEqual(made);
    expect([...doc.shapes.values()].filter((s) => s.kind === 'ring')).toHaveLength(1);
    // a selection of only some of the ring's bonds fills nothing
    expect(doc.edit('Part', () => fillRings(doc, [...doc.bonds.keys()].slice(0, 2)))).toEqual([]);
  });

  it('follows its atoms, and goes when one is deleted', () => {
    const { doc, ids } = toluene();
    const [id] = doc.edit('Fill', () => fillRings(doc, []));
    doc.edit('Move', () => doc.moveAtoms(doc.atoms.keys(), 5, 7));
    const s = doc.shapes.get(id)!;
    const first = doc.atoms.get(s.ring![0])!;
    expect(s.poly![0]).toEqual({ x: first.x, y: first.y });
    expect(s.x1).toBeCloseTo(-14 + 5);
    doc.edit('Delete', () => doc.removeAtom(ids[3]));
    expect(doc.shapes.has(id)).toBe(false);
    doc.undo();
    expect(doc.shapes.has(id)).toBe(true);
  });

  it('is saved for ChemDraw and finds its ring again on opening', () => {
    const { doc } = toluene();
    const [id] = doc.edit('Fill', () => fillRings(doc, [], { pattern: 'hatch', fill: 'gradient', fill2: '#ff0000' }));
    doc.edit('Highlight', () => { for (const a of doc.atoms.values()) if (a.x > 20) doc.updateAtom(a.id, { highlight: '#ffe680' }); for (const b of doc.bonds.values()) doc.updateBond(b.id, { highlight: '#ffe680' }); });
    const text = writeCdxml(doc);
    expect(text).toContain('Chem Illustrator shape');
    const back = readCdxml(text).doc;
    const ring = [...back.shapes.values()].find((s) => s.kind === 'ring')!;
    expect(ring).toBeTruthy();
    expect(ring.pattern).toBe('hatch');
    expect(ring.fill2).toBe('#ff0000');
    expect(ring.ring).toHaveLength(6);
    expect(ring.ring!.every((a) => back.atoms.has(a))).toBe(true);
    expect([...back.atoms.values()].filter((a) => a.highlight === '#ffe680')).toHaveLength(1);
    expect([...back.bonds.values()].every((b) => b.highlight === '#ffe680')).toBe(true);
    void id;
  });

  it('keeps a box’s pattern and gradient through a ChemDraw file', () => {
    const doc = new Doc();
    doc.edit('Box', () => {
      doc.addShape({ kind: 'rect', x1: 0, y1: 0, x2: 50, y2: 30, filled: true, fill: 'gradient', fillColor: '#1f5fbf', fill2: '#ffffff', gradAngle: 0, pattern: 'dots', patternSize: 2 });
      doc.addShape({ kind: 'oval', x1: 60, y1: 0, x2: 90, y2: 30, pattern: 'crosshatch' });
    });
    const back = readCdxml(writeCdxml(doc)).doc;
    const [box, oval] = [...back.shapes.values()].sort((a, b) => a.x1 - b.x1);
    expect(box).toMatchObject({ fill: 'gradient', fill2: '#ffffff', gradAngle: 0, pattern: 'dots', patternSize: 2 });
    expect(oval.pattern).toBe('crosshatch');
    expect(oval.filled).toBeFalsy();
  });
});

describe('fills in pictures', () => {
  it('draws gradients, patterns and highlights as plain shapes for Word, PowerPoint and SVG', async () => {
    const { recordPicture, pictureSvg, pictureEmf } = await import('../src/render/picture');
    const { doc } = toluene();
    doc.edit('Fill', () => fillRings(doc, [], { fill: 'gradient', fill2: '#ffffff', pattern: 'crosshatch' }));
    doc.edit('Box', () => { doc.addShape({ kind: 'oval', x1: 40, y1: 0, x2: 70, y2: 30, filled: true, fill: 'gradient', gradRadial: true, fillColor: '#ff0000', pattern: 'dots' }); });
    doc.edit('Highlight', () => { for (const b of doc.bonds.values()) doc.updateBond(b.id, { highlight: '#ffe680' }); });
    const p = recordPicture(doc)!;
    const fills = new Set(p.items.filter((i) => i.kind === 'path' && i.fill).map((i) => (i as { fill: string }).fill));
    // the gradient's bands are many colours
    expect(fills.size).toBeGreaterThan(10);
    // highlights are filled outlines, so they come out in Word and PowerPoint as shapes
    expect(fills.has('#ffe680')).toBe(true);
    expect(pictureSvg(p)).toContain('<path');
    expect(pictureEmf(p).length).toBeGreaterThan(1000);
  });
});

describe('ring fill patterns', () => {
  it('cuts off only the marked corners', () => {
    const sq = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }];
    const out = cutCorners(sq, [true, false, false, false], 0.4);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ x: 0, y: 4 });
    expect(out[1]).toEqual({ x: 4, y: 0 });
    expect(out.slice(2)).toEqual(sq.slice(1));
  });
  it('gives rings a finer pattern in light grey unless chosen', () => {
    expect(patternSpacing({ kind: 'ring', pattern: 'hatch' })).toBeLessThan(patternSpacing({ kind: 'rect', pattern: 'hatch' }));
    expect(patternSpacing({ kind: 'ring', pattern: 'dots', patternSize: 5 })).toBe(5);
    expect(patternInk({ kind: 'ring' })).toBe(RING_PATTERN_COLOUR);
    expect(patternInk({ kind: 'ring', patternColor: '#ff0000' })).toBe('#ff0000');
    expect(patternInk({ kind: 'rect', color: '#00ff00' })).toBe('#00ff00');
  });
});
