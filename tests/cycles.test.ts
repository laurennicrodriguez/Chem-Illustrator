// @vitest-environment jsdom
//
// Catalytic cycles drawn from scratch (Insert ▸ Catalytic Cycle): species round a loop, a curved
// arrow per step with its name inside, reagents in and by-products out on small arrows, and two
// loops that mesh, share a species or sit side by side.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { CYCLE_PRESETS, buildCycle, type CycleLook } from '../src/chem/cycles';
import { planArrange, applyArrange } from '../src/chem/scheme-arrange';
import { plainText } from '../src/richtext';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { chemRuns } from '../src/text/chemtext';

const LOOK: CycleLook = { names: 'short', reagentArrows: true };
const preset = (id: string) => CYCLE_PRESETS.find((p) => p.id === id)!.spec;

function build(id: string, look = LOOK) {
  const doc = new Doc();
  const m = plainMeasure(doc);
  const made = buildCycle(doc, m, preset(id), look, { x: 300, y: 300 });
  return { doc, m, made };
}

const textOf = (doc: Doc, id: number) => plainText(doc.captions.get(id)!.runs);
const captionAt = (doc: Doc, text: string) => [...doc.captions.values()].find((c) => plainText(c.runs) === text)!;
const mid = (doc: Doc, text: string) => { const c = captionAt(doc, text); return { x: c.x, y: c.y }; };

describe('catalytic cycles', () => {
  it('every preset draws without trouble, centred where asked', () => {
    for (const p of CYCLE_PRESETS) {
      const { made } = build(p.id);
      expect(made.box, p.id).not.toBeNull();
      const b = made.box!;
      expect(Math.abs((b.x1 + b.x2) / 2 - 300), p.id).toBeLessThan(1);
      expect(Math.abs((b.y1 + b.y2) / 2 - 300), p.id).toBeLessThan(1);
    }
  });

  it('a Suzuki cycle: four species round a circle, four curved steps with names inside, reagents on small arrows', () => {
    const { doc, made } = build('suzuki');
    const steps = [...doc.arrows.values()].filter((r) => r.step);
    expect(steps.length).toBe(4);
    for (const r of steps) expect(r.sweep).not.toBe(0);
    // Ar–X in, ⁻OR in, X⁻ out, Ar′B(OH)2 in, ROB(OH)2 out, Ar–Ar′ out: six small arrows
    expect([...doc.arrows.values()].filter((r) => r.reagentFor !== undefined).length).toBe(6);
    // the names sit nearer the middle than the species, and the reagents further out
    const c = mid(doc, 'Pd catalyst');
    const r = (t: string) => Math.hypot(mid(doc, t).x - c.x, mid(doc, t).y - c.y);
    expect(r('OA')).toBeLessThan(r('LnPd0'));
    expect(r('Ar–X')).toBeGreaterThan(r('LnPd0') * 0.9);
    expect(made.captions.map((id) => textOf(doc, id))).toContain('TM');
  });

  it('writes species in chemistry style: L_nPd^0 is Lₙ Pd⁰, ArB(OH)2 drops its 2', () => {
    expect(chemRuns('L_nPd^0')).toEqual([{ text: 'L' }, { text: 'n', sub: true }, { text: 'Pd' }, { text: '0', sup: true }]);
    expect(chemRuns('ArPd^{II}X')).toEqual([{ text: 'ArPd' }, { text: 'II', sup: true }, { text: 'X' }]);
    expect(chemRuns('ArB(OH)2')).toEqual([{ text: 'ArB(OH)' }, { text: '2', sub: true }]);
  });

  it('step names can be in full or left out', () => {
    const full = build('suzuki', { ...LOOK, names: 'full' }).doc;
    expect(captionAt(full, 'oxidative addition')).toBeTruthy();
    const none = build('suzuki', { ...LOOK, names: 'none' }).doc;
    expect([...none.captions.values()].some((c) => plainText(c.runs) === 'OA')).toBe(false);
  });

  it('runs anticlockwise when asked', () => {
    const turn = (anticlockwise: boolean) => {
      const { doc } = build('buchwald', { ...LOOK, anticlockwise });
      const a = mid(doc, 'LPd0'), b = mid(doc, 'LPdII(Ar)X');
      // the first species is at the top; the second is to its right going clockwise
      return Math.sign(b.x - a.x);
    };
    expect(turn(false)).toBe(1);
    expect(turn(true)).toBe(-1);
  });

  it('Sonogashira: the Pd and Cu loops sit side by side and turn opposite ways, meeting at transmetalation', () => {
    const { doc } = build('sonogashira');
    const pd = mid(doc, 'Pd'), cu = mid(doc, 'Cu');
    expect(cu.x).toBeGreaterThan(pd.x);
    expect(Math.abs(cu.y - pd.y)).toBeLessThan(doc.style.bondLength);
    // the two TM names face each other across the gap between the loops
    const tms = [...doc.captions.values()].filter((c) => plainText(c.runs) === 'TM').map((c) => c.x).sort((a, b) => a - b);
    expect(tms.length).toBe(2);
    expect(tms[0]).toBeGreaterThan(pd.x);
    expect(tms[1]).toBeLessThan(cu.x);
  });

  it('two pathways share their resting state: Pd(0) is drawn once, between the loops', () => {
    const { doc } = build('heck-two');
    const pd0 = [...doc.captions.values()].filter((c) => plainText(c.runs) === 'Pd0L2');
    expect(pd0.length).toBe(1);
    const n = mid(doc, 'neutral'), k = mid(doc, 'cationic');
    expect(pd0[0].x).toBeGreaterThan(n.x);
    expect(pd0[0].x).toBeLessThan(k.x);
    // four arrows touch it: into and out of each loop
    const id = 'c' + pd0[0].id;
    expect([...doc.arrows.values()].filter((r) => r.step?.reactants.includes(id) || r.step?.products.includes(id)).length).toBe(4);
  });

  it('can be arranged again: the step names stay inside', () => {
    const { doc, m } = build('suzuki');
    const scope = { atoms: new Set<number>(), captions: new Set(doc.captions.keys()), shapes: new Set<number>(), arrows: new Set([...doc.arrows.values()].filter((r) => r.step).map((r) => r.id)) };
    const plan = planArrange(doc, m, scope, { kind: 'cycle', reagentArrows: true })!;
    expect(plan).not.toBeNull();
    applyArrange(doc, m, plan);
    const c = mid(doc, 'Pd catalyst');
    const r = (t: string) => Math.hypot(mid(doc, t).x - c.x, mid(doc, t).y - c.y);
    expect(r('OA')).toBeLessThan(r('LnPd0'));
  });

  it('keeps which captions are step names when saved to CDXML', () => {
    const { doc } = build('suzuki');
    const back = readCdxml(writeCdxml(doc)).doc;
    const named = [...back.arrows.values()].filter((r) => r.step?.inside?.length);
    expect(named.length).toBe(4);
    for (const r of named) expect(r.step!.below.some((x) => r.step!.inside!.includes(x))).toBe(false);
  });

  it('uses selected structures as the species', () => {
    const doc = new Doc();
    const m = plainMeasure(doc);
    const frags = doc.edit('a', () => [0, 1, 2].map((i) => {
      const a = doc.addAtom(i * 50, 0), b = doc.addAtom(i * 50 + 14, 0);
      doc.addBond(a.id, b.id);
      return [a.id, b.id];
    }));
    buildCycle(doc, m, preset('buchwald'), LOOK, { x: 0, y: 0 }, frags.map((atoms) => ({ atoms })));
    // no text for the species; the steps run between the structures
    expect([...doc.captions.values()].some((c) => plainText(c.runs).startsWith('LPd'))).toBe(false);
    const steps = [...doc.arrows.values()].filter((r) => r.step);
    expect(steps.length).toBe(3);
    expect(steps.every((r) => r.step!.reactants[0].startsWith('a'))).toBe(true);
  });
});
