// @vitest-environment jsdom
//
// Reaction energy diagrams (Insert ▸ Energy Diagram): levels or a smooth curve drawn from a table
// of energies, inside an invisible frame that keeps the numbers so the diagram can be redrawn,
// resized and saved.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { plainText } from '../src/richtext';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { shapeBox } from '../src/objects';
import { ENERGY_DEFAULTS, ENERGY_PRESETS, energyFrameOf, largestBarrier, putEnergy, refitEnergy, sCurve, type EnergyData } from '../src/design/energy';

const data = (id: string, more: Partial<EnergyData> = {}): EnergyData =>
  ({ ...ENERGY_DEFAULTS, ...ENERGY_PRESETS.find((p) => p.id === id)!.data, w: 200, h: 140, ...more });

function put(id: string, more: Partial<EnergyData> = {}) {
  const doc = new Doc();
  const m = plainMeasure(doc);
  const frame = doc.edit('e', () => putEnergy(doc, m, data(id, more), { x: 100, y: 100 }));
  return { doc, m, frame };
}

const texts = (doc: Doc) => [...doc.captions.values()].map((c) => plainText(c.runs));

describe('energy diagrams', () => {
  it('every preset draws, in both styles, inside a frame that keeps the numbers', () => {
    for (const p of ENERGY_PRESETS) {
      for (const style of ['levels', 'curve'] as const) {
        const { doc, frame } = put(p.id, { style, barrier: true });
        const s = doc.shapes.get(frame)!;
        expect(s.energy?.paths.length, p.id).toBe(p.data.paths.length);
        expect(s.frame?.captions.length, p.id).toBeGreaterThan(0);
        expect(s.lineWidth).toBe(0);
      }
    }
  });

  it('levels: a bold line per species, energies above and names below', () => {
    const { doc } = put('two-step');
    const levels = [...doc.shapes.values()].filter((s) => s.kind === 'line' && s.bold);
    expect(levels.length).toBe(5);
    const at = (t: string) => [...doc.captions.values()].find((c) => plainText(c.runs) === t)!;
    const int = levels.find((l) => Math.abs((l.x1 + l.x2) / 2 - 200) < 1)!;
    expect(at('12.0').y).toBeLessThan(int.y1);
    expect(at('Int').y).toBeGreaterThan(int.y1);
    expect(texts(doc)).toContain('Reaction coordinate');
  });

  it('a species both pathways share is drawn once, in black', () => {
    const { doc } = put('catalysed');
    expect(texts(doc).filter((t) => t === 'SM').length).toBe(1);
    expect(texts(doc).filter((t) => t === '0.0').length).toBe(1);
    const sm = [...doc.captions.values()].find((c) => plainText(c.runs) === 'SM')!;
    expect(sm.runs.every((r) => !r.color)).toBe(true);
    // its own transition state is in the pathway's colour
    const ts = [...doc.captions.values()].find((c) => plainText(c.runs) === '32.0')!;
    expect(ts.runs[0].color).toBe('#c00000');
  });

  it('marks the largest barrier, from the lowest point before it', () => {
    expect(largestBarrier(data('two-step').paths[0])).toEqual({ from: 0, top: 1, low: 0, high: 24 });
    const cyc = largestBarrier(data('cycle').paths[0])!;
    // OA at −6 up to TS-TM at 18: 24, more than the 14 to TS-OA
    expect(cyc.high - cyc.low).toBe(24);
    const { doc } = put('two-step', { barrier: true });
    expect(texts(doc)).toContain('ΔG‡ = 24.0');
  });

  it('the smooth curve leaves and reaches each level flat, and ends where it should', () => {
    const p0 = { x: 0, y: 100 }, p1 = { x: 60, y: 20 };
    const pieces = sCurve(p0, p1);
    expect(pieces[0].tail).toEqual(p0);
    expect(pieces[pieces.length - 1].head).toEqual(p1);
    // the first piece is nearly flat: it climbs much less than the middle ones
    const climb = (i: number) => Math.abs(pieces[i].head.y - pieces[i].tail.y);
    expect(climb(0)).toBeLessThan(climb(2) / 2);
    expect(sCurve(p0, { x: 60, y: 100 })).toHaveLength(1);
  });

  it('drawing again with new numbers keeps the same frame in the same place, and what was put on it', () => {
    const { doc, m, frame } = put('one-step');
    const before = shapeBox(doc.shapes.get(frame)!);
    const atom = doc.edit('a', () => doc.addAtom(150, 150).id);
    doc.edit('in', () => {
      const f = doc.shapes.get(frame)!.frame!;
      doc.updateShape(frame, { frame: { ...f, atoms: [...f.atoms, atom] } });
    });
    const d = doc.shapes.get(frame)!.energy!;
    const id = doc.edit('re', () => putEnergy(doc, m, { ...d, paths: [{ ...d.paths[0], points: d.paths[0].points.map((q) => ({ ...q, g: q.g === null ? null : q.g * 2 })) }] }, { x: 100, y: 100 }, frame));
    expect(id).toBe(frame);
    const after = shapeBox(doc.shapes.get(frame)!);
    expect(Math.abs(after.x1 - before.x1)).toBeLessThan(1);
    expect(texts(doc)).toContain('44.0');
    expect(texts(doc)).not.toContain('22.0');
    expect(doc.atoms.has(atom)).toBe(true);
    expect(doc.shapes.get(frame)!.frame!.atoms).toContain(atom);
  });

  it('a frame resized by hand draws the diagram again to fill it', () => {
    const { doc, m, frame } = put('one-step');
    doc.beforeCommit = (before) => refitEnergy(doc, before, m);
    const b = shapeBox(doc.shapes.get(frame)!);
    doc.edit('resize', () => doc.updateShape(frame, { x2: b.x2 + 100 }));
    expect(doc.shapes.get(frame)!.energy!.w).toBeCloseTo(300, 0);
  });

  it('every part knows its diagram', () => {
    const { doc, frame } = put('one-step');
    const f = doc.shapes.get(frame)!.frame!;
    expect(energyFrameOf(doc, 'caption', f.captions[0])).toBe(frame);
    expect(energyFrameOf(doc, 'shape', f.shapes[0])).toBe(frame);
    expect(energyFrameOf(doc, 'shape', frame)).toBe(frame);
  });

  it('keeps its numbers when saved to CDXML, and its parts are in its frame again', () => {
    const { doc, frame } = put('catalysed', { style: 'curve' });
    const back = readCdxml(writeCdxml(doc)).doc;
    const s = [...back.shapes.values()].find((x) => x.energy)!;
    expect(s).toBeTruthy();
    expect(s.energy!.style).toBe('curve');
    expect(s.energy!.paths[0].points[2].g).toBe(32);
    expect(s.frame!.captions.length).toBe(doc.shapes.get(frame)!.frame!.captions.length);
  });
});
