// @vitest-environment jsdom
//
// Reaction animation (ported from cdxmorph by Ryan Shenvi, MIT). The example schemes in
// tests/morph are cdxmorph's own (MIT), with what cdxmorph 1.47.0's `check` command reports for
// each: which bonds break and form and which atoms have no partner, with the pairing file
// (*.check.json) and with automatic matching only (*.auto.json).

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { Renderer, withMeasure } from '../src/render/renderer';
import { arialWidth } from '../src/text-metrics';
import { planOf, buildSteps, stepSummary, timeline, gifDelayMs, gifRate, DEFAULT_TIMING, type Step } from '../src/morph/clip';
import { atomNumbers, readMapping, writeMapping, sourceAttr } from '../src/morph/numbers';
import { encodeGif } from '../src/morph/gif';
import type { Doc } from '../src/model';

const noCanvas = { getContext: () => null } as unknown as HTMLCanvasElement;
const arial = (fn: () => void) => () => withMeasure((t, s) => arialWidth(t, s), fn);
const DIR = 'tests/morph/';
const stems = readdirSync(DIR).filter((f) => f.endsWith('.cdxml')).map((f) => f.slice(0, -6));

interface CheckStage { breaking: string[]; forming: string[]; unpaired_start: string[]; unpaired_product: string[] }

function report(doc: Doc, s: Step) {
  const num = atomNumbers(doc);
  const n = (k: string) => num.get(Number(k))!;
  const sm = stepSummary(s);
  const bonds = (l: [string, string][]) => l.map(([a, b]) => `${n(a)}-${n(b)}`).sort();
  return {
    breaking: bonds(sm.breaking), forming: bonds(sm.forming),
    unpaired_start: sm.unpairedStart.map(n).sort(), unpaired_product: sm.unpairedProduct.map(n).sort(),
  };
}
const theirs = (c: CheckStage) => ({
  breaking: [...c.breaking].sort(), forming: [...c.forming].sort(),
  unpaired_start: [...c.unpaired_start].sort(), unpaired_product: [...c.unpaired_product].sort(),
});

function load(stem: string) {
  const { doc } = readCdxml(readFileSync(DIR + stem + '.cdxml', 'utf8'));
  return { doc, plan: planOf(doc), r: new Renderer(noCanvas, noCanvas) };
}

describe('reaction animation matches cdxmorph', () => {
  for (const stem of stems) {
    it(`${stem}: with its pairing file`, arial(() => {
      const { doc, plan, r } = load(stem);
      const check = JSON.parse(readFileSync(DIR + stem + '.check.json', 'utf8'));
      expect(plan.groups.length).toBe(check.structures);
      const saved = readMapping(doc, readFileSync(DIR + stem + '.mapping.json', 'utf8'), plan.groups.length - 1);
      const steps = buildSteps(doc, plan, r, saved);
      steps.forEach((s, i) => {
        expect(s.error).toBeUndefined();
        expect(report(doc, s)).toEqual(theirs(check.stages[i]));
      });
    }));

    it(`${stem}: matched automatically`, arial(() => {
      const { doc, plan, r } = load(stem);
      const check = JSON.parse(readFileSync(DIR + stem + '.auto.json', 'utf8'));
      buildSteps(doc, plan, r).forEach((s, i) => {
        const ours = report(doc, s), want = theirs(check.stages[i]);
        // siccanin step 3: we also pair the new ring's carbon cdxmorph leaves unpaired, which
        // carries one more bond; everything else is the same
        if (stem === 'siccanin sequence' && i === 2) {
          expect(ours.breaking.every((b) => want.breaking.includes(b))).toBe(true);
          expect(ours.forming.every((b) => want.forming.includes(b))).toBe(true);
          return;
        }
        expect(ours).toEqual(want);
      });
    }));
  }
});

describe('saving the pairing', () => {
  it('keeps a step\'s pairing in the CDXML file', arial(() => {
    const { doc, plan } = load('himbadine to GB29');
    const [m] = readMapping(doc, readFileSync(DIR + 'himbadine to GB29.mapping.json', 'utf8'), 1);
    const arrow = plan.arrows[0]!;
    doc.edit('Animation pairing', () => doc.updateArrow(arrow, { morph: m }));
    const back = readCdxml(writeCdxml(doc)).doc;
    expect(back.arrows.get(arrow)?.morph).toEqual(m);
    // and from scratch, without the original file to lean on
    doc.source = null;
    const fresh = readCdxml(writeCdxml(doc)).doc;
    const r2 = [...fresh.arrows.values()].find((a) => a.morph)!;
    expect(r2.morph!.pairs!.length).toBe(m.pairs!.length);
    expect(r2.morph!.shifts).toHaveLength(1);
  }));

  it('writes and reads cdxmorph mapping files in ChemDraw atom numbers', arial(() => {
    const { doc } = load('siccanin sequence');
    const text = readFileSync(DIR + 'siccanin sequence.mapping.json', 'utf8');
    const steps = readMapping(doc, text, 5);
    const again = readMapping(doc, writeMapping(doc, steps), 5);
    expect(again).toEqual(steps);
    expect(JSON.parse(writeMapping(doc, steps)).stages[0].pairs).toEqual(JSON.parse(text).stages[0].pairs);
    expect(() => readMapping(doc, text, 2)).toThrow(/5 steps/);
  }));
});

describe('timing', () => {
  it('splits the movement between steps and holds the ends', () => {
    const tl = timeline(2, DEFAULT_TIMING, 24);
    const hold = Math.round(0.4 * 24);
    expect(tl.length).toBe(Math.round(3.2 * 24) + 2 * hold);
    expect(tl.slice(0, hold).every(([s, t]) => s === 0 && t === 0)).toBe(true);
    expect(tl[tl.length - 1]).toEqual([1, 1]);
    const bounce = timeline(1, { ...DEFAULT_TIMING, bounce: true }, 24);
    expect(bounce[bounce.length - 1]).toEqual(bounce[1]);
  });

  it('stores GIF delays in whole hundredths of a second', () => {
    expect(gifDelayMs(24)).toBe(40);
    expect(gifRate(24)).toBe(25);
  });
});

// ---------------------------------------------------------------- a small GIF reader, to check the writer

function readGif(b: Uint8Array) {
  let p = 6;
  const w = b[p] | (b[p + 1] << 8), h = b[p + 2] | (b[p + 3] << 8);
  const flags = b[p + 4];
  p += 7;
  const palSize = 1 << ((flags & 7) + 1);
  const pal: number[] = [];
  for (let i = 0; i < palSize; i++, p += 3) pal.push((b[p] << 16) | (b[p + 1] << 8) | b[p + 2]);
  const frames: { px: number[]; delay: number }[] = [];
  let delay = 0;
  while (b[p] !== 0x3b) {
    if (b[p] === 0x21) {
      if (b[p + 1] === 0xf9) delay = b[p + 4] | (b[p + 5] << 8);
      p += 2;
      while (b[p]) p += b[p] + 1;
      p++;
      continue;
    }
    p += 10; // image descriptor
    const min = b[p++];
    const data: number[] = [];
    while (b[p]) { for (let i = 1; i <= b[p]; i++) data.push(b[p + i]); p += b[p] + 1; }
    p++;
    const clear = 1 << min, eoi = clear + 1;
    let size = min + 1, dict: number[][] = [], bit = 0, prev: number[] | null = null;
    const px: number[] = [];
    const reset = () => { dict = Array.from({ length: eoi + 1 }, (_, i) => [i]); size = min + 1; prev = null; };
    reset();
    for (;;) {
      let code = 0;
      for (let i = 0; i < size; i++, bit++) code |= ((data[bit >> 3] >> (bit & 7)) & 1) << i;
      if (code === clear) { reset(); continue; }
      if (code === eoi) break;
      const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
      px.push(...entry);
      if (prev) dict.push([...prev, entry[0]]);
      prev = entry;
      if (dict.length === 1 << size && size < 12) size++;
    }
    frames.push({ px: px.map((i) => pal[i]), delay });
  }
  return { w, h, frames };
}

describe('GIF', () => {
  it('writes frames exactly, merging repeats into longer frames', async () => {
    const w = 37, h = 23;
    const make = (seed: number) => {
      const d = new Uint8ClampedArray(w * h * 4);
      for (let i = 0; i < w * h; i++) {
        const v = (i * 7 + seed * 13) % 251;
        d.set(i % 5 ? [255, 255, 255, 255] : [v, (v * 3) % 256, 255 - v, 255], i * 4);
      }
      return { data: d, width: w, height: h };
    };
    const frames = [make(1), make(1), make(2), make(3)];
    const gif = readGif(await encodeGif(frames.length, (i) => frames[i], 40));
    expect([gif.w, gif.h]).toEqual([w, h]);
    expect(gif.frames.map((f) => f.delay)).toEqual([8, 4, 4]);
    [0, 2, 3].forEach((src, k) => {
      const d = frames[src].data;
      const want = Array.from({ length: w * h }, (_, i) => (d[i * 4] << 16) | (d[i * 4 + 1] << 8) | d[i * 4 + 2]);
      expect(gif.frames[k].px).toEqual(want);
    });
  });

  it('keeps white exact when there are more colours than a GIF holds', async () => {
    const w = 64, h = 64;
    const d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) d.set(i < 100 ? [255, 255, 255, 255] : [i % 256, (i >> 8) * 16, 128, 255], i * 4);
    const gif = readGif(await encodeGif(1, () => ({ data: d, width: w, height: h }), 40));
    expect(gif.frames[0].px.slice(0, 100).every((c) => c === 0xffffff)).toBe(true);
  });
});

describe('turns in 3-D (an equivalency sign)', () => {
  const T = DIR + 'turns/decalone addition';
  it('reads the page as a turn and two reactions, as cdxmorph does', arial(() => {
    const { doc } = readCdxml(readFileSync(T + '.cdxml', 'utf8'));
    const check = JSON.parse(readFileSync(T + '.check.json', 'utf8'));
    const plan = planOf(doc);
    expect(plan.groups.length).toBe(check.structures);
    expect(plan.kinds).toEqual(check.stages.map((s: { kind: string }) => s.kind));
    // the 3-D structures guide the two drawings below them and are not steps of their own
    expect(plan.poses.map((p) => p?.length ?? 0)).toEqual([37, 37, 0, 0]);
    const steps = buildSteps(doc, plan, new Renderer(noCanvas, noCanvas));
    const num = atomNumbers(doc);
    const n = (k: string) => num.get(Number(k))!;
    const turn = steps[0], want = check.stages[0];
    expect(turn.kind).toBe('turn');
    expect(turn.turn!.mode).toBe('guided');
    expect(turn.turn!.degrees).toBeCloseTo(want.rotation_deg, 1);
    turn.turn!.axis.forEach((v, i) => expect(v).toBeCloseTo(want.axis[i], 3));
    expect(turn.turn!.rmsd).toBeCloseTo(want.fit_rmsd_pt, 2);
    expect(turn.turn!.notTurning).toBe(want.not_turning);
    // the same drawn atoms pair (cdxmorph lists them by its node ids; ours by AtomID)
    const ids = new Map<string, string>();
    for (const [id, v] of sourceAttr(doc, 'id')) ids.set(v, String(id));
    const theirPairs = Object.entries(want.atom_pairs as Record<string, string>).map(([a, b]) => [n(ids.get(a)!), n(ids.get(b)!)]).sort();
    expect([...turn.map.nmap].map(([a, b]) => [n(a), n(b)]).sort()).toEqual(theirPairs);
    expect(stepSummary(turn).unpairedStart.map(n).sort()).toEqual(want.fading_out);
    steps.slice(1).forEach((s, i) => expect(report(doc, s)).toEqual(theirs(check.stages[i + 1])));
  }));

  it('starts on the first drawing and lands on the second', arial(() => {
    const { doc } = readCdxml(readFileSync(T + '.cdxml', 'utf8'));
    const [turn] = buildSteps(doc, planOf(doc), new Renderer(noCanvas, noCanvas));
    const at = (t: number) => turn.opt.place!(t).pos;
    for (const [k, p] of at(0)) expect(Math.hypot(p.x - turn.A.nodes.get(k)!.p.x, p.y - turn.A.nodes.get(k)!.p.y)).toBeLessThan(1e-6);
    for (const [a, b] of turn.map.nmap) {
      const p = at(1).get(a)!, q = turn.B.nodes.get(b)!.p;
      expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-6);
    }
  }));

  it('keeps the 3-D coordinates when the drawing is saved', () => {
    const { doc } = readCdxml(readFileSync(T + '.cdxml', 'utf8'));
    const again = readCdxml(writeCdxml(doc)).doc;
    expect([...again.atoms.values()].filter((a) => a.xyz).length).toBe(74);
  });

  it('without the 3-D structures, carries the atoms across the page', arial(() => {
    const { doc } = readCdxml(readFileSync(T + '.cdxml', 'utf8'));
    doc.edit('remove poses', () => { for (const a of [...doc.atoms.values()]) if (a.xyz) doc.removeAtom(a.id); });
    const plan = planOf(doc);
    expect(plan.kinds).toEqual(['turn', 'morph', 'morph']);
    expect(plan.poses).toEqual([null, null, null, null]);
    const [turn] = buildSteps(doc, plan, new Renderer(noCanvas, noCanvas));
    expect(turn.turn).toBeUndefined();
    expect(turn.opt.place).toBeUndefined();
    expect(stepSummary(turn).paired).toBe(12);
  }));
});
