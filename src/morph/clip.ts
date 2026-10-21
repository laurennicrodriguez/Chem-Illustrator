// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// A whole animation: which structures it runs through (read off the scheme's arrows), each
// step's pairing, and the timeline of frames, held at the ends and paused between steps.

import type { Arrow, Doc, MorphStep } from '../model';
import type { Rect, Vec } from '../geom';
import type { Renderer } from '../render/renderer';
import { itemFinder, reactionSteps, schemeItems, plainMeasure, type Item } from '../chem/reaction';
import type { Measure } from '../editor/arrange';
import { sceneOf, type MScene } from './scene';
import { resolve, summary, type Mapping, type StepConfig, type StepSummary } from './mapping';
import { frame, type FrameData, type FrameOptions } from './frame';
import { planSwaps, paintFrame, framesBox, type Swaps } from './paint';
import { turnPlan, kekuleShift, kekuleTime, reflectionAxis } from './turn';
import { matchBonds } from './match';
import { MIN_POSE_ATOMS, count3d, setupTurn, guideAt, ringOpenness, type TurnNote } from './rotate';
import { sourceAttr } from './numbers';

/** The structures an animation runs through, and the arrow (if any) behind each step between them. */
export interface Plan {
  /** Atom ids of each structure in turn: the starting materials, then each step's products. */
  groups: number[][];
  /** The arrow behind step i (groups[i] → groups[i + 1]), or null when read from left to right. */
  arrows: (number | null)[];
  /** Step i is a reaction ('morph') or the same molecule redrawn, an equivalency sign ('turn'). */
  kinds: StepKind[];
  /** The 3-D pose drawn above each structure, which says how it turns (atom ids), or null. */
  poses: (number[] | null)[];
}

export type StepKind = 'morph' | 'turn';

/** Longest line that still counts as one bar of an equivalency sign, and how close its bars sit. */
const SIGN_BAR = 25, SIGN_GAP = 8;

/**
 * Centres of equivalency signs: two or more short parallel bars stacked close together (lines, or
 * arrows with no heads, as ChemDraw writes them). There is no object for the sign itself.
 */
export function equivSigns(doc: Doc): Vec[] {
  const mids: Vec[] = [];
  const bar = (x1: number, y1: number, x2: number, y2: number) => {
    const L = Math.hypot(x2 - x1, y2 - y1);
    if (L > 1e-6 && L <= SIGN_BAR) mids.push({ x: (x1 + x2) / 2, y: (y1 + y2) / 2 });
  };
  for (const r of doc.arrows.values()) if (r.headStyle === 'none' && r.tailStyle === 'none' && !r.sweep) bar(r.tail.x, r.tail.y, r.head.x, r.head.y);
  for (const sh of doc.shapes.values()) if (sh.kind === 'line') bar(sh.x1, sh.y1, sh.x2, sh.y2);
  const out: Vec[] = [];
  const used = new Set<number>();
  mids.forEach((a, i) => {
    if (used.has(i)) return;
    const grp = [a], here = [i];
    mids.forEach((b, j) => {
      if (j === i || used.has(j)) return;
      if (Math.abs(a.x - b.x) < SIGN_GAP && Math.abs(a.y - b.y) < 2 * SIGN_GAP) { grp.push(b); here.push(j); }
    });
    if (grp.length >= 2) { here.forEach((j) => used.add(j)); out.push({ x: grp.reduce((s, p) => s + p.x, 0) / grp.length, y: grp.reduce((s, p) => s + p.y, 0) / grp.length }); }
  });
  return out;
}

/** Structures carrying 3-D coordinates, each matched to the drawing below it in the same column. */
function posesOf(doc: Doc, frags: Item[], overlap = 0.45): { guides: Map<string, number[]>; poses: Set<string> } {
  const is3d = (it: Item) => it.atoms.filter((a) => doc.atoms.get(a)?.xyz).length >= MIN_POSE_ATOMS;
  const guides = new Map<string, number[]>();
  const poses = new Set<string>();
  for (const p of frags) {
    if (!is3d(p)) continue;
    let best: Item | null = null;
    for (const d of frags) {
      if (d === p || is3d(d) || d.box.y1 <= p.box.y2 || guides.has(d.ref)) continue;
      const share = Math.min(p.box.x2, d.box.x2) - Math.max(p.box.x1, d.box.x1);
      const frac = share / Math.max(1e-6, Math.min(p.box.x2 - p.box.x1, d.box.x2 - d.box.x1));
      if (frac >= overlap && (!best || d.box.y1 < best.box.y1)) best = d;
    }
    if (best) { guides.set(best.ref, p.atoms); poses.add(p.ref); }
  }
  return { guides, poses };
}

/** Pairs of structures an equivalency sign joins, left to right along its row. */
function signLinks(doc: Doc, drawn: Item[]): Set<string> {
  const out = new Set<string>();
  for (const c of equivSigns(doc)) {
    const row = drawn.filter((it) => it.box.y1 - 12 <= c.y && c.y <= it.box.y2 + 12);
    const left = row.filter((it) => it.box.x2 <= c.x), right = row.filter((it) => it.box.x1 >= c.x);
    if (!left.length || !right.length) continue;
    const a = left.reduce((x, y) => (y.box.x2 > x.box.x2 ? y : x)), b = right.reduce((x, y) => (y.box.x1 < x.box.x1 ? y : x));
    out.add(a.ref + '>' + b.ref);
  }
  return out;
}

/**
 * What to animate. With an arrow, just that step. Otherwise the scheme is followed from its first
 * step along the structures each step shares with the next (a later step may bring in a new
 * starting material); with no reaction arrows, the structures are taken from left to right.
 * An equivalency sign between two structures makes a turn. A structure with 3-D coordinates drawn
 * above another is that one's pose, not a step of its own. `atoms` keeps only the structures with
 * a selected atom.
 */
export function planOf(doc: Doc, opts: { arrow?: number; atoms?: Set<number>; measure?: Measure } = {}): Plan {
  const m = opts.measure ?? plainMeasure(doc);
  const items = schemeItems(doc, m);
  const find = itemFinder(items);
  const frags = items.filter((it) => it.atoms.length && it.caption === undefined && it.shape === undefined);
  const { guides, poses } = posesOf(doc, frags);
  const drawn = frags.filter((it) => !poses.has(it.ref));
  const links = signLinks(doc, drawn);
  const linked = (a: Item, b: Item) => links.has(a.ref + '>' + b.ref) || links.has(b.ref + '>' + a.ref);
  const centre = (it: Item): Vec => ({ x: (it.box.x1 + it.box.x2) / 2, y: (it.box.y1 + it.box.y2) / 2 });
  const wanted = (it: Item) => !opts.atoms || it.atoms.some((a) => opts.atoms!.has(a));

  /** One side of an arrow: one structure, or several in a row joined by equivalency signs (each its own). */
  const side = (refs: string[], dir: Vec): Item[][] => {
    const seen = new Set<string>();
    const its: Item[] = [];
    for (const ref of refs) {
      const it = find(ref);
      if (!it || !it.atoms.length || seen.has(it.ref) || poses.has(it.ref) || !wanted(it)) continue;
      seen.add(it.ref);
      its.push(it);
    }
    if (!its.length) return [];
    if (!its.some((a) => its.some((b) => a !== b && linked(a, b)))) return [its];
    return [...its].sort((a, b) => { const p = centre(a), q = centre(b); return (p.x - q.x) * dir.x + (p.y - q.y) * dir.y; }).map((it) => [it]);
  };
  const steps = reactionSteps(doc, items)
    .map(({ arrow, roles }) => {
      const L = Math.hypot(arrow.head.x - arrow.tail.x, arrow.head.y - arrow.tail.y) || 1;
      const dir = { x: (arrow.head.x - arrow.tail.x) / L, y: (arrow.head.y - arrow.tail.y) / L };
      return { arrow: arrow.id, r: side(roles.reactants, dir), p: side(roles.products, dir) };
    })
    .filter((s) => s.r.length && s.p.length);

  const groups: Item[][] = [];
  const arrows: (number | null)[] = [];
  const kinds: StepKind[] = [];
  const add = (g: Item[], kind: StepKind, arrow: number | null) => {
    if (groups.length) { arrows.push(arrow); kinds.push(kind); }
    groups.push(g);
  };
  const atomsOf = (g: Item[]) => g.flatMap((it) => it.atoms);
  const shares = (x: number[], y: number[]) => { const ys = new Set(y); return x.some((a) => ys.has(a)); };
  const same = (x: Item[], y: Item[]) => { const a = atomsOf(x), b = atomsOf(y); return a.length === b.length && a.every((v) => b.includes(v)); };
  const done = () => {
    const out: Plan = { groups: groups.map(atomsOf), arrows, kinds, poses: groups.map((g) => (g.length === 1 ? guides.get(g[0].ref) ?? null : null)) };
    return out;
  };

  if (opts.arrow !== undefined) {
    const s = steps.find((x) => x.arrow === opts.arrow);
    if (!s) return { groups: [], arrows: [], kinds: [], poses: [] };
    s.r.forEach((g) => add(g, 'turn', null));
    s.p.forEach((g, i) => add(g, i ? 'turn' : 'morph', i ? null : s.arrow));
    return done();
  }
  if (steps.length) {
    const produced = steps.flatMap((s) => s.p.flatMap(atomsOf));
    let cur: number | null = steps.findIndex((s) => !s.r.some((g) => shares(atomsOf(g), produced)));
    if (cur < 0) cur = 0;
    const seen = new Set<number>();
    // the previous step's arrow while its product waits to be replaced by the next step's starting
    // materials (which may add a new one); null once the products are in
    let pending: number | null = null;
    while (cur !== null && !seen.has(cur)) {
      seen.add(cur);
      const s = steps[cur];
      if (!groups.length) s.r.forEach((g) => add(g, 'turn', null));
      else {
        const at = s.r.findIndex((g) => same(g, groups[groups.length - 1]));
        if (at < 0) add(s.r[0], 'morph', pending);
        s.r.slice(at < 0 ? 1 : at + 1).forEach((g) => add(g, 'turn', null));
      }
      pending = null;
      let nxt: number | null = null;
      const prod = s.p.flatMap(atomsOf);
      for (let k = 0; k < steps.length; k++) if (!seen.has(k) && steps[k].r.some((g) => shares(atomsOf(g), prod))) { nxt = k; break; }
      if (nxt === null || s.p.length > 1) s.p.forEach((g, i) => add(g, i ? 'turn' : 'morph', i ? null : s.arrow));
      else pending = s.arrow;
      cur = nxt;
    }
    // structures an equivalency sign joins to either end of the scheme
    const used = new Set(groups.flat().map((it) => it.ref));
    for (let more = true; more;) {
      more = false;
      const first = groups[0], last = groups[groups.length - 1];
      for (const it of drawn) {
        if (used.has(it.ref) || !wanted(it)) continue;
        if (first.length === 1 && links.has(it.ref + '>' + first[0].ref)) {
          groups.unshift([it]); arrows.unshift(null); kinds.unshift('turn'); used.add(it.ref); more = true; break;
        }
        if (last.length === 1 && links.has(last[0].ref + '>' + it.ref)) {
          add([it], 'turn', null); used.add(it.ref); more = true; break;
        }
      }
    }
    return done();
  }
  // no scheme: every structure, left to right
  const row = drawn.filter(wanted).sort((x, y) => centre(x).x - centre(y).x);
  row.forEach((it, i) => add([it], i && linked(row[i - 1], it) ? 'turn' : 'morph', null));
  return done();
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
  kind: StepKind;
  /** A turn measured in 3-D: by how much, and how it was paired. */
  turn?: TurnNote;
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
  const anums = plan.poses.some((p) => p) || plan.kinds.includes('turn') ? sourceAttr(doc, 'AtomNumber') : undefined;
  const scenes = plan.groups.map((g) => sceneOf(doc, g, r, undefined, anums));
  const poses = plan.poses.map((g) => (g ? sceneOf(doc, g, r, undefined, anums) : null));
  const out: Step[] = [];
  let prev = scenes[0];
  const ts = Array.from({ length: probe }, (_, k) => k / (probe - 1));
  for (let i = 0; i + 1 < scenes.length; i++) {
    const A = prev, Bdrawn = scenes[i + 1];
    const arrow = plan.arrows[i];
    const kind = plan.kinds[i] ?? 'morph';
    const r_: Arrow | undefined = arrow !== null ? doc.arrows.get(arrow) : undefined;
    const cfg = configOf(morphs ? morphs[i] : r_?.morph, A, Bdrawn);
    let error: string | undefined;
    if (kind === 'turn') {
      // the same molecule redrawn: turned in 3-D when poses say how (or the drawings carry their own
      // coordinates), else carried atom for atom from one drawing to the other
      const SA = poses[i], SB = poses[i + 1];
      const solid = (SA && SB) || (count3d(A) >= MIN_POSE_ATOMS && count3d(Bdrawn) >= MIN_POSE_ATOMS);
      if (solid) {
        try {
          const given = cfg.pairs?.length ? resolve(cfg, A, Bdrawn, true).nmap : undefined;
          const { setup, B } = setupTurn(A, Bdrawn, SA && SB ? SA : null, SA && SB ? SB : null, given);
          const map: Mapping = { nmap: setup.pairs, bmap: matchBonds(A, B, setup.pairs), shifts: new Map(), slides: [] };
          const G = setup.guide;
          const opt: FrameOptions = { place: (t) => guideAt(G, t), openness: ringOpenness(A, B, setup.pairs) };
          out.push({ A, B, map, opt, swaps: planSwaps(A, B, map, ts, opt), arrow, kind, turn: setup.note });
          prev = B;
          continue;
        } catch (e) {
          error = (e as Error).message;
        }
      }
    }
    let map: Mapping;
    try {
      map = resolve(cfg, A, Bdrawn, kind === 'turn');
    } catch (e) {
      // a saved pairing that no longer fits the drawing: say so, and animate the automatic one
      error = (e as Error).message;
      map = resolve({}, A, Bdrawn, kind === 'turn');
    }
    const B = align(A, Bdrawn, map);
    const turn = turnPlan(A, B, map.nmap);
    const kek = kekuleShift(A, B, map.nmap, map.bmap);
    const opt: FrameOptions = {
      turn,
      kekule: kek.size ? [kek, kekuleTime(A, kek, turn)] : null,
      flip: reflectionAxis(A, B, map.nmap),
    };
    out.push({ A, B, map, opt, swaps: planSwaps(A, B, map, ts, opt), arrow, kind, error });
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
