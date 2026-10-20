// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// A whole animation: which structures it runs through (read off the scheme's arrows), each
// step's pairing, and the timeline of frames, held at the ends and paused between steps.

import type { Arrow, Doc, MorphStep } from '../model';
import type { Rect } from '../geom';
import type { Renderer } from '../render/renderer';
import { itemFinder, reactionSteps, schemeItems, plainMeasure } from '../chem/reaction';
import type { Measure } from '../editor/arrange';
import { sceneOf, type MScene } from './scene';
import { resolve, summary, type Mapping, type StepConfig, type StepSummary } from './mapping';
import { frame, type FrameData, type FrameOptions } from './frame';
import { planSwaps, paintFrame, framesBox, type Swaps } from './paint';
import { turnPlan, kekuleShift, kekuleTime, reflectionAxis } from './turn';

/** The structures an animation runs through, and the arrow (if any) behind each step between them. */
export interface Plan {
  /** Atom ids of each structure in turn: the starting materials, then each step's products. */
  groups: number[][];
  /** The arrow behind step i (groups[i] → groups[i + 1]), or null when read from left to right. */
  arrows: (number | null)[];
}

/**
 * What to animate. With an arrow, just that step. Otherwise the scheme is followed from its first
 * step along the structures each step shares with the next (a later step may bring in a new
 * starting material); with no reaction arrows, the structures are taken from left to right.
 * `atoms` keeps only the structures with a selected atom.
 */
export function planOf(doc: Doc, opts: { arrow?: number; atoms?: Set<number>; measure?: Measure } = {}): Plan {
  const m = opts.measure ?? plainMeasure(doc);
  const items = schemeItems(doc, m);
  const find = itemFinder(items);
  const side = (refs: string[]): number[] => {
    const seen = new Set<string>();
    const out: number[] = [];
    for (const ref of refs) {
      const it = find(ref);
      if (!it || !it.atoms.length || seen.has(it.ref)) continue;
      if (opts.atoms && !it.atoms.some((a) => opts.atoms!.has(a))) continue;
      seen.add(it.ref);
      out.push(...it.atoms);
    }
    return out;
  };
  const steps = reactionSteps(doc, items)
    .map(({ arrow, roles }) => ({ arrow: arrow.id, r: side(roles.reactants), p: side(roles.products) }))
    .filter((s) => s.r.length && s.p.length);

  if (opts.arrow !== undefined) {
    const s = steps.find((x) => x.arrow === opts.arrow);
    return s ? { groups: [s.r, s.p], arrows: [s.arrow] } : { groups: [], arrows: [] };
  }
  if (steps.length) {
    const shares = (x: number[], y: number[]) => { const ys = new Set(y); return x.some((a) => ys.has(a)); };
    const groups: number[][] = [];
    const arrows: (number | null)[] = [];
    const same = (x: number[], y: number[]) => x.length === y.length && shares(x, y) && x.every((a) => y.includes(a));
    const produced = steps.flatMap((s) => s.p);
    let cur: number | null = steps.findIndex((s) => !shares(s.r, produced));
    if (cur < 0) cur = 0;
    const seen = new Set<number>();
    let last: number | null = null;
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const s = steps[cur];
      if (!groups.length || !same(groups[groups.length - 1], s.r)) {
        if (groups.length) arrows.push(last);
        groups.push(s.r);
      }
      last = s.arrow;
      let nxt: number | null = null;
      for (let k = 0; k < steps.length; k++) if (!seen.has(k) && shares(steps[k].r, s.p)) { nxt = k; break; }
      if (nxt === null) { arrows.push(s.arrow); groups.push(s.p); }
      cur = nxt;
    }
    return { groups, arrows };
  }
  // no scheme: every structure, left to right
  const frags = doc.fragments()
    .map((f) => [...f])
    .filter((f) => !opts.atoms || f.some((a) => opts.atoms!.has(a)));
  const cx = (f: number[]) => f.reduce((s, a) => s + doc.atoms.get(a)!.x, 0) / f.length;
  frags.sort((x, y) => cx(x) - cx(y));
  return { groups: frags, arrows: frags.slice(1).map(() => null) };
}

/** A saved pairing (atom ids) as the matcher's settings (atom keys), leaving out atoms not in either structure. */
export function configOf(m: MorphStep | undefined, A: MScene, B: MScene): StepConfig {
  if (!m) return {};
  const inA = (id: number) => A.nodes.has(String(id));
  const inB = (id: number) => B.nodes.has(String(id));
  const cfg: StepConfig = {};
  const pairs = (m.pairs ?? []).filter(([a, b]) => inA(a) && inB(b)).map(([a, b]) => [String(a), String(b)] as [string, string]);
  if (pairs.length) cfg.pairs = pairs;
  if (m.exact && pairs.length) cfg.exact = true;
  const shifts = (m.shifts ?? []).filter((s) => s.every(inA)).map((s) => s.map(String) as [string, string, string]);
  if (shifts.length) cfg.shifts = shifts;
  const slides = (m.slides ?? []).filter(([s, t]) => [...s, ...t].every(inA))
    .map(([s, t]) => [s.map(String), t.map(String)] as [[string, string], [string, string]]);
  if (slides.length) cfg.slides = slides;
  return cfg;
}

export interface Timing {
  /** Seconds of movement over the whole clip (shared between the steps). */
  duration: number;
  fps: number;
  /** Seconds held still on the first and last structures. */
  hold: number;
  /** Seconds held on each structure in between. */
  pause: number;
  ease: 'smoothstep' | 'linear';
  /** Play forwards then backwards (a seamless loop). */
  bounce: boolean;
}

/** cdxmorph's defaults. */
export const DEFAULT_TIMING: Timing = { duration: 3.2, fps: 24, hold: 0.4, pause: 0, ease: 'smoothstep', bounce: false };

/** A GIF stores delays in hundredths of a second: the delay a rate really gets, in ms. */
export const gifDelayMs = (fps: number): number => Math.max(10, Math.round(100 / Math.max(1e-6, fps)) * 10);
/** The rate that delay plays at (25 for 24). */
export const gifRate = (fps: number): number => 1000 / gifDelayMs(fps);

const EASE = {
  smoothstep: (u: number) => u * u * (3 - 2 * u),
  linear: (u: number) => u,
};

/** Every frame's (step, t): holds, each step's eased movement, pauses, and the way back for a bounce. */
export function timeline(steps: number, tm: Timing, rate: number): [number, number][] {
  if (!steps) return [];
  const nHold = Math.round(tm.hold * rate);
  const nMid = Math.round(tm.pause * rate);
  const nCore = Math.max(2 * steps, Math.round(tm.duration * rate));
  const base = Math.floor(nCore / steps), rem = nCore % steps;
  const f = EASE[tm.ease];
  const out: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const per = Math.max(2, base + (i < rem ? 1 : 0));
    const head = i === 0 ? nHold : nMid;
    for (let k = 0; k < head; k++) out.push([i, 0]);
    for (let k = 0; k < per; k++) out.push([i, f(k / (per - 1))]);
    if (i === steps - 1) for (let k = 0; k < nHold; k++) out.push([i, 1]);
  }
  if (tm.bounce) out.push(...out.slice(1, -1).reverse());
  return out;
}

export interface Step {
  A: MScene;
  B: MScene;
  map: Mapping;
  opt: FrameOptions;
  swaps: Swaps;
  arrow: number | null;
  error?: string;
}

/** Each structure laid over the one before it, by the centre of the atoms they pair. */
function align(prev: MScene, next: MScene, map: Mapping): MScene {
  let dx: number, dy: number;
  const pairs = [...map.nmap].filter(([a, b]) => prev.nodes.has(a) && next.nodes.has(b));
  if (pairs.length) {
    dx = dy = 0;
    for (const [a, b] of pairs) {
      const p = prev.nodes.get(a)!.p, q = next.nodes.get(b)!.p;
      dx += p.x - q.x; dy += p.y - q.y;
    }
    dx /= pairs.length; dy /= pairs.length;
  } else {
    const p = prev.extent(), n = next.extent();
    dx = (p.x1 + p.x2 - n.x1 - n.x2) / 2;
    dy = (p.y1 + p.y2 - n.y1 - n.y2) / 2;
  }
  return next.translated(dx, dy);
}

/** Pairings for the structures of a plan, with the settings saved on each step's arrow (or those given). */
export function buildSteps(doc: Doc, plan: Plan, r: Renderer, morphs?: (MorphStep | undefined)[], probe = 25): Step[] {
  const scenes = plan.groups.map((g) => sceneOf(doc, g, r));
  const out: Step[] = [];
  let prev = scenes[0];
  for (let i = 0; i + 1 < scenes.length; i++) {
    const A = prev, Bdrawn = scenes[i + 1];
    const arrow = plan.arrows[i];
    const r_: Arrow | undefined = arrow !== null ? doc.arrows.get(arrow) : undefined;
    const cfg = configOf(morphs ? morphs[i] : r_?.morph, A, Bdrawn);
    let map: Mapping;
    let error: string | undefined;
    try {
      map = resolve(cfg, A, Bdrawn);
    } catch (e) {
      // a saved pairing that no longer fits the drawing: say so, and animate the automatic one
      error = (e as Error).message;
      map = resolve({}, A, Bdrawn);
    }
    const B = align(A, Bdrawn, map);
    const turn = turnPlan(A, B, map.nmap);
    const kek = kekuleShift(A, B, map.nmap, map.bmap);
    const opt: FrameOptions = {
      turn,
      kekule: kek.size ? [kek, kekuleTime(A, kek, turn)] : null,
      flip: reflectionAxis(A, B, map.nmap),
    };
    const ts = Array.from({ length: probe }, (_, k) => k / (probe - 1));
    out.push({ A, B, map, opt, swaps: planSwaps(A, B, map, ts, opt), arrow, error });
    prev = B;
  }
  return out;
}

/** What each step does (for the pairing editor and the tests). */
export const stepSummary = (s: Step): StepSummary => summary(s.A, s.B, s.map);

export class Clip {
  readonly frames: [number, number][];
  readonly box: Rect;
  readonly rate: number;

  constructor(readonly steps: Step[], readonly timing: Timing, gif = false, pad = 6) {
    this.rate = gif ? gifRate(timing.fps) : timing.fps;
    this.frames = timeline(steps.length, timing, this.rate);
    // the canvas holds every frame: sample each step through its movement
    const probes: FrameData[] = [];
    for (const s of steps) for (const t of [0, 0.25, 0.5, 0.75, 1]) probes.push(frame(s.A, s.B, s.map, t, s.opt));
    this.box = probes.length ? framesBox(probes, pad) : { x1: 0, y1: 0, x2: 1, y2: 1 };
  }

  get length(): number { return this.frames.length; }
  /** Seconds the clip plays for. */
  get seconds(): number { return this.frames.length / this.rate; }

  /** The picture at (step, t), in points (the caller sets the transform and clears the page). */
  paintAt(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, step: number, t: number): void {
    const s = this.steps[step];
    if (!s) return;
    paintFrame(ctx, frame(s.A, s.B, s.map, t, s.opt), s.A.style, t, s.swaps);
  }

  /** Frame i on a canvas `scale` pixels per point, on a white (or given) page. */
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, i: number, scale: number, paper = '#ffffff'): void {
    const [step, t] = this.frames[Math.max(0, Math.min(this.frames.length - 1, i))] ?? [0, 0];
    const w = Math.ceil((this.box.x2 - this.box.x1) * scale), h = Math.ceil((this.box.y2 - this.box.y1) * scale);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, w, h);
    ctx.setTransform(scale, 0, 0, scale, -this.box.x1 * scale, -this.box.y1 * scale);
    this.paintAt(ctx, step, t);
    ctx.restore();
  }

  /** Pixel size at a scale. */
  size(scale: number): { w: number; h: number } {
    return { w: Math.ceil((this.box.x2 - this.box.x1) * scale), h: Math.ceil((this.box.y2 - this.box.y1) * scale) };
  }
}
