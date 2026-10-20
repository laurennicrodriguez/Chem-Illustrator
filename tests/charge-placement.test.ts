// @vitest-environment jsdom
//
// Charges beside atom labels keep clear of bonds (a bond under the sign starts past it, and a
// charge that would leave almost nothing of a short bond moves), and lone pairs dragged round
// an atom keep the way they were aimed through a CDXML save.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { labelBonds, labelSpec, layoutLabel, type LabelBond } from '../src/chem/labels';
import { plainMeasure } from '../src/chem/reaction';
import { symbolAt } from '../src/chem/mechanism';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { exitParam, fromAngle, passParam, DEG } from '../src/geom';
import { arialWidth } from '../src/text-metrics';

const measure = (t: string, s: number) => arialWidth(t, s);
const bond = (deg: number, extra: Partial<LabelBond> = {}): LabelBond => ({ ...fromAngle(deg * DEG), len: 14.4, spread: 0.3, ...extra });
const chargeRun = (bonds: LabelBond[], charge = 1, h = 0) => {
  const spec = labelSpec(7, null, charge, 0, bonds.length + h, bonds.length)!;
  const lay = layoutLabel(spec, bonds, 10, measure);
  return lay.runs[lay.charge!];
};

describe('passParam', () => {
  const r = { x1: 2, y1: -2, x2: 6, y2: 2 };
  it('gives where a segment comes out of a box it passes through', () => {
    expect(passParam({ x: 0, y: 0 }, { x: 10, y: 0 }, r)).toBeCloseTo(0.6);
  });
  it('is 0 for a segment that misses the box', () => {
    expect(passParam({ x: 0, y: 5 }, { x: 10, y: 5 }, r)).toBe(0);
  });
  it('matches exitParam when the segment starts inside', () => {
    const a = { x: 3, y: 0 }, b = { x: 13, y: 4 };
    expect(passParam(a, b, r)).toBeCloseTo(exitParam(a, b, r));
  });
});

describe('where a charge goes by its label', () => {
  it('stays raised after the label in a pyridinium ring, as in ChemDraw (the bond is cut short instead)', () => {
    // N at the bottom of the ring: ring bonds up and to each side, a methyl straight down
    const run = chargeRun([bond(-30, { spread: 2.9 }), bond(-150), bond(90)]);
    expect(run.dx).toBeGreaterThan(0);
    expect(run.dy).toBeLessThan(0);
  });

  it('moves off a short bond to another label (a bent C=N⁺=N⁻)', () => {
    const run = chargeRun([bond(-30, { spread: 2.9, far: true }), bond(150, { spread: 2.9 })], 1);
    const home = chargeRun([bond(-30, { spread: 2.9 }), bond(150, { spread: 2.9 })], 1);
    expect(run.dx !== home.dx || run.dy !== home.dy).toBe(true);
    // and the new place is clear of both bonds
    for (const deg of [-30, 150]) {
      const d = fromAngle(deg * DEG);
      const q = { x: d.x * 14.4, y: d.y * 14.4 };
      const box = { x1: run.dx, y1: run.dy - 0.6 * run.size, x2: run.dx + arialWidth(run.text, run.size), y2: run.dy - 0.1 * run.size };
      expect(passParam({ x: 0, y: 0 }, q, box)).toBe(0);
    }
  });

  it('stays put when bond lengths are not given', () => {
    const run = chargeRun([{ ...fromAngle(-30 * DEG), far: true }, fromAngle(150 * DEG)]);
    const home = chargeRun([fromAngle(-30 * DEG), fromAngle(150 * DEG)]);
    expect([run.dx, run.dy]).toEqual([home.dx, home.dy]);
  });

  it('reads bond lengths, widths and labelled ends from the drawing', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const c = doc.addAtom(100, 100), n = doc.addAtom(112.5, 92.8, 7, { charge: 1 }), n2 = doc.addAtom(125, 100, 7, { charge: -1 });
      doc.addBond(c.id, n.id, 2);
      doc.addBond(n.id, n2.id, 2);
      return { n: n.id };
    });
    const b = labelBonds(doc, doc.atoms.get(ids.n)!);
    expect(b.map((x) => x.far).sort()).toEqual([false, true]);
    expect(b[0].len).toBeCloseTo(14.43, 1);
    expect(b[0].spread).toBeGreaterThan(doc.style.lineWidth);
  });
});

describe('lone pairs aimed by dragging', () => {
  function pyridine() {
    const doc = new Doc();
    const n = doc.edit('build', () => {
      const n = doc.addAtom(100, 100, 7);
      const a = doc.addAtom(87.5, 92.8), b = doc.addAtom(112.5, 92.8);
      doc.addBond(n.id, a.id);
      doc.addBond(n.id, b.id, 2);
      return n.id;
    });
    return { doc, n };
  }

  it('puts the pair just clear of the label, the way it was aimed', () => {
    const { doc, n } = pyridine();
    const d = fromAngle(37 * DEG);
    const at = symbolAt(doc, plainMeasure(doc), n, d, 2.6);
    const v = { x: at.x - 100, y: at.y - 100 };
    expect(Math.atan2(v.y, v.x) / DEG).toBeCloseTo(37, 5);
    expect(Math.hypot(v.x, v.y)).toBeGreaterThan(5);
    expect(Math.hypot(v.x, v.y)).toBeLessThan(12);
  });

  it('keeps a pair at any angle through a CDXML save and open', () => {
    const { doc } = pyridine();
    // dots across the direction 37° below the right-hand side
    const c = { x: 106, y: 105 }, n = fromAngle((37 + 90) * DEG);
    doc.edit('pair', () => doc.addShape({ kind: 'symbol', symbol: 'LonePair', x1: c.x - n.x * 1.12, y1: c.y - n.y * 1.12, x2: c.x + n.x * 1.12, y2: c.y + n.y * 1.12 }));
    const back = readCdxml(writeCdxml(doc)).doc;
    const s = [...back.shapes.values()].find((x) => x.symbol === 'LonePair')!;
    expect(Math.atan2(s.y2 - s.y1, s.x2 - s.x1) / DEG).toBeCloseTo(127, 0);
    expect((s.x1 + s.x2) / 2).toBeCloseTo(106, 1);
    expect((s.y1 + s.y2) / 2).toBeCloseTo(105, 1);
  });
});
