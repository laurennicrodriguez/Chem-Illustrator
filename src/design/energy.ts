// Reaction energy diagrams (Insert ▸ Energy Diagram): a level for each species at its energy,
// joined by dashed lines or a smooth curve over the transition states, with the energies, the
// names, an axis and the largest barrier marked. One or more pathways share the columns, so
// two routes can be drawn on one diagram. Everything is drawn as ordinary lines, curves and
// text inside an invisible frame that keeps the numbers; editing the numbers draws it again.

import type { Arrow, Caption, Doc, Entity, Frame, Shape } from '../model';
import type { Rect, Vec } from '../geom';
import { sweepThrough } from '../objects';
import { chemRuns } from '../text/chemtext';
import type { Measure } from '../editor/arrange';
import { frameBox, frameMembers } from '../editor/frames';
import { shapeBox } from '../objects';

/** A species at one column: its name and energy (null: this pathway has nothing in that column). */
export interface EnergyPoint { label: string; g: number | null }

export interface EnergyPath {
  name: string;
  color: string;
  points: EnergyPoint[];
}

export interface EnergyData {
  paths: EnergyPath[];
  /** What the axis measures (ΔG, ΔH, E) and its unit. */
  quantity: string;
  unit: string;
  /** Flat levels joined by dashed lines, or a smooth curve through them (humps at transition states). */
  style: 'levels' | 'curve';
  /** Show each energy above its level. */
  values: boolean;
  /** Decimal places for the energies shown. */
  digits: number;
  /** A vertical axis with its title, and "Reaction coordinate" along the bottom. */
  axis: boolean;
  /** Mark the largest barrier on each pathway (from the lowest point before it to the highest after). */
  barrier: boolean;
  /** The plot's size in points. */
  w: number;
  h: number;
  /** How far the plot sits inside its frame on each side, as last drawn (so it is drawn again in the same place). */
  margins?: { l: number; t: number; r: number; b: number };
}

/** The colours pathways take in turn. */
export const PATH_COLOURS = ['#000000', '#c00000', '#2f5597', '#548235'];

export interface EnergyPreset { id: string; name: string; blurb: string; data: Omit<EnergyData, 'w' | 'h' | 'values' | 'digits' | 'axis' | 'barrier' | 'style'> }

const pts = (list: [string, number | null][]): EnergyPoint[] => list.map(([label, g]) => ({ label, g }));

/** Starting points, with made-up numbers to be typed over. */
export const ENERGY_PRESETS: EnergyPreset[] = [
  {
    id: 'one-step', name: 'One step (SN2, E2, Diels–Alder)', blurb: 'Starting materials, one transition state, products.',
    data: { quantity: 'ΔG', unit: 'kcal/mol', paths: [{ name: '', color: '#000000', points: pts([['SM', 0], ['TS‡', 22], ['P', -8]]) }] },
  },
  {
    id: 'two-step', name: 'Two steps through an intermediate (SN1, E1)', blurb: 'An intermediate between two transition states; the first is rate-limiting.',
    data: { quantity: 'ΔG', unit: 'kcal/mol', paths: [{ name: '', color: '#000000', points: pts([['SM', 0], ['TS1‡', 24], ['Int', 12], ['TS2‡', 16], ['P', -6]]) }] },
  },
  {
    id: 'catalysed', name: 'Catalysed vs uncatalysed', blurb: 'The same overall change by two routes: one high barrier, or two lower ones.',
    data: {
      quantity: 'ΔG', unit: 'kcal/mol', paths: [
        { name: 'uncatalysed', color: '#c00000', points: pts([['SM', 0], ['', null], ['TS‡', 32], ['', null], ['P', -10]]) },
        { name: 'catalysed', color: '#000000', points: pts([['SM', 0], ['TS1‡', 17], ['Int', 4], ['TS2‡', 14], ['P', -10]]) },
      ],
    },
  },
  {
    id: 'cycle', name: 'Catalytic cycle profile', blurb: 'A cycle as a profile from resting state to product and back: oxidative addition, transmetalation, reductive elimination.',
    data: { quantity: 'ΔG', unit: 'kcal/mol', paths: [{ name: '', color: '#000000', points: pts([['Pd(0)', 0], ['TS-OA‡', 14], ['OA', -6], ['TS-TM‡', 18], ['TM', -2], ['TS-RE‡', 12], ['Pd(0) + P', -20]]) }] },
  },
  {
    id: 'blank', name: 'Blank', blurb: 'Three species to fill in.',
    data: { quantity: 'ΔG', unit: 'kcal/mol', paths: [{ name: '', color: '#000000', points: pts([['A', 0], ['TS‡', 10], ['B', -5]]) }] },
  },
];

export const ENERGY_DEFAULTS = { style: 'levels' as const, values: true, digits: 1, axis: true, barrier: false };

/** The members of a drawn diagram (to put in its frame). */
export interface EnergyParts { captions: number[]; arrows: number[]; shapes: number[] }

/**
 * Draw the diagram with its plot's top left corner at `at`. Returns what was made (the caller
 * puts it in a frame). Call inside an edit.
 */
export function drawEnergy(doc: Doc, m: Measure, d: EnergyData, at: Vec): EnergyParts {
  const out: EnergyParts = { captions: [], arrows: [], shapes: [] };
  const lw = doc.style.lineWidth, L = doc.style.bondLength;
  const n = Math.max(1, ...d.paths.map((p) => p.points.length));
  const all = d.paths.flatMap((p) => p.points.map((q) => q.g).filter((g): g is number => g !== null && isFinite(g)));
  if (!all.length) return out;
  const hi = Math.max(...all), lo = Math.min(...all);
  const colW = d.w / n, bar = Math.min(colW * 0.55, 4 * L);
  const y = (g: number) => (hi === lo ? at.y + d.h / 2 : at.y + ((hi - g) / (hi - lo)) * d.h);
  const x = (k: number) => at.x + (k + 0.5) * colW;

  const caption = (text: string, target: Vec, anchor: 'above' | 'below' | 'left' | 'right' | 'centre', color?: string, extra: Partial<Caption> = {}): Caption => {
    const runs = chemRuns(text).map((r) => (color && color !== '#000000' ? { ...r, color } : r));
    const c = doc.addCaption({ x: 0, y: 0, runs, justify: 'left', ...extra });
    const b = m.captionBox(c);
    const w = b.x2 - b.x1, h = b.y2 - b.y1;
    const want = anchor === 'above' ? { x: target.x - w / 2, y: target.y - h } : anchor === 'below' ? { x: target.x - w / 2, y: target.y }
      : anchor === 'left' ? { x: target.x - w, y: target.y - h / 2 } : anchor === 'right' ? { x: target.x, y: target.y - h / 2 } : { x: target.x - w / 2, y: target.y - h / 2 };
    doc.updateCaption(c.id, { x: want.x - b.x1, y: want.y - b.y1 });
    out.captions.push(c.id);
    return doc.captions.get(c.id)!;
  };
  // points along every line and curve drawn, so a label can be kept off them
  const ink: Vec[] = [];
  const trace = (a: Vec, b: Vec) => {
    const k = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2));
    for (let i = 0; i <= k; i++) ink.push({ x: a.x + ((b.x - a.x) * i) / k, y: a.y + ((b.y - a.y) * i) / k });
  };
  const line = (x1: number, y1: number, x2: number, y2: number, more: Partial<Shape> = {}) => {
    trace({ x: x1, y: y1 }, { x: x2, y: y2 });
    out.shapes.push(doc.addShape({ kind: 'line', x1, y1, x2, y2, color: '#000000', ...more }).id);
  };
  const arrow = (tail: Vec, head: Vec, more: Partial<Arrow> = {}) =>
    out.arrows.push(doc.addArrow({
      tail, head, headStyle: 'none', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0,
      headLength: lw * 8, headWidth: lw * 2.2, ...more,
    }).id);

  const gap = 0.25 * L;
  const fmt = (g: number) => (g < 0 ? '−' : '') + Math.abs(g).toFixed(d.digits);
  // the column's name goes under the lowest level drawn in it, so pathways share it
  const labelled = new Set<string>();
  d.paths.forEach((p, pi) => {
    const color = p.color || '#000000';
    const tint = color !== '#000000' ? { color } : {};
    const shown = p.points.map((q, k) => ({ q, k })).filter(({ q }) => q.g !== null && isFinite(q.g));
    shown.forEach(({ q, k }, i) => {
      const yy = y(q.g!);
      // a species pathways share (same column, same energy) is drawn once, by the first, in black
      if (d.paths.slice(0, pi).some((o) => o.points[k]?.g === q.g)) return;
      const both = d.paths.slice(pi + 1).some((o) => o.points[k]?.g === q.g);
      const own = both ? '#000000' : color;
      if (d.style === 'levels') line(x(k) - bar / 2, yy, x(k) + bar / 2, yy, { bold: true, ...(own !== '#000000' ? { color: own } : {}) });
      // on a curve, a peak's name goes over it (the curve falls away beneath)
      const prev = shown[i - 1]?.q.g ?? -Infinity, next = shown[i + 1]?.q.g ?? -Infinity;
      const peak = d.style === 'curve' && q.g! > prev && q.g! > next;
      // on a curve, a trough's energy goes under it too (the curve rises on either side)
      const under = d.style === 'curve' && !peak;
      let top = yy - gap - (d.style === 'levels' ? lw : 0), bottom = yy + gap + lw;
      if (d.values && under) bottom = m.captionBox(caption(fmt(q.g!), { x: x(k), y: bottom }, 'below', own)).y2;
      else if (d.values) top = m.captionBox(caption(fmt(q.g!), { x: x(k), y: top }, 'above', own)).y1 - gap / 2;
      const key = `${k}|${q.label}`;
      if (q.label && !labelled.has(key)) {
        labelled.add(key);
        const ink2 = pi && d.paths.length > 1 && !both ? color : undefined;
        if (peak) caption(q.label, { x: x(k), y: top }, 'above', ink2);
        else caption(q.label, { x: x(k), y: bottom }, 'below', ink2);
      }
    });
    // joined: dashed between the ends of the levels, or a smooth S from middle to middle
    for (let i = 0; i + 1 < shown.length; i++) {
      const a = shown[i], b = shown[i + 1];
      const ya = y(a.q.g!), yb = y(b.q.g!);
      if (d.style === 'levels') {
        line(x(a.k) + bar / 2, ya, x(b.k) - bar / 2, yb, { dashed: true, ...tint });
        continue;
      }
      const p0 = { x: x(a.k), y: ya }, p1 = { x: x(b.k), y: yb };
      for (let t = 0; t < 1; t += 1 / 24) trace(cosineAt(p0, p1, t), cosineAt(p0, p1, t + 1 / 24));
      for (const piece of sCurve(p0, p1)) arrow(piece.tail, piece.head, { sweep: piece.sweep, ...tint });
    }
  });

  if (d.axis) {
    const ax = at.x - 0.6 * L, top = at.y - 1.6 * L, bottom = at.y + d.h + 2.4 * L;
    arrow({ x: ax, y: bottom }, { x: ax, y: top }, { headStyle: 'full' });
    caption(`${d.quantity} (${d.unit.replace('/mol', ' mol^{−1}')})`, { x: ax - gap, y: (top + bottom) / 2 }, 'left', undefined);
    // the axis title reads up the page
    const t = doc.captions.get(out.captions[out.captions.length - 1])!;
    turnUp(doc, m, t, { x: ax - gap, y: (top + bottom) / 2 });
    caption('Reaction coordinate', { x: at.x + d.w / 2, y: bottom + gap }, 'below');
    line(ax, bottom, at.x + d.w, bottom);
  }

  if (d.barrier) {
    // what is drawn so far, to keep the barrier's label clear of
    const taken = (): Rect[] => out.captions.map((id) => m.captionBox(doc.captions.get(id)!));
    // how badly a label at r would sit: text it covers counts most, then lines it crosses
    const clash = (r: Rect, others: Rect[]) =>
      others.reduce((n, o) => n + Math.max(0, Math.min(r.x2, o.x2) - Math.max(r.x1, o.x1)) * Math.max(0, Math.min(r.y2, o.y2) - Math.max(r.y1, o.y1)), 0)
      + ink.filter((q) => q.x > r.x1 - lw && q.x < r.x2 + lw && q.y > r.y1 - lw && q.y < r.y2 + lw).length;
    d.paths.forEach((p) => {
      const b = largestBarrier(p);
      if (!b) return;
      const color = p.color || '#000000';
      const text = `${d.quantity}^‡ = ${fmt(b.high - b.low)}`;
      const others = taken();
      // beside the transition state on its right, else on its left, as near halfway up as is clear
      let side: 1 | -1 = 1, f = 0.5, worst = Infinity;
      search: for (const t of [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9]) {
        for (const s of [1, -1] as const) {
          const xx = x(b.top) + s * (bar / 2 + 0.4 * L);
          const c = caption(text, { x: xx + s * gap, y: y(b.low) + (y(b.high) - y(b.low)) * t }, s > 0 ? 'right' : 'left', color);
          const bad = clash(m.captionBox(c), others);
          doc.removeCaption(c.id);
          out.captions.pop();
          if (bad < worst) { worst = bad; side = s; f = t; }
          if (!bad) break search;
        }
      }
      const xx = x(b.top) + side * (bar / 2 + 0.4 * L);
      trace({ x: xx, y: y(b.low) }, { x: xx, y: y(b.high) });
      const from = { x: xx, y: y(b.low) }, to = { x: xx, y: y(b.high) };
      arrow(from, to, { headStyle: 'full', tailStyle: 'full', ...(color !== '#000000' ? { color } : {}) });
      line(x(b.from) + bar / 2, y(b.low), xx + side * 0.3 * L, y(b.low), { dashed: true, color });
      caption(text, { x: xx + side * gap, y: from.y + (to.y - from.y) * f }, side > 0 ? 'right' : 'left', color);
    });
  }

  if (d.paths.length > 1) {
    // a key at the top right
    let ky = at.y - 1.2 * L;
    for (const p of d.paths) {
      const x2 = at.x + d.w, x1 = x2 - 1.6 * L;
      const k = caption(p.name || 'pathway', { x: x1 - gap, y: ky }, 'left', p.color);
      line(x1, ky, x2, ky, { bold: d.style === 'levels', ...(p.color !== '#000000' ? { color: p.color } : {}) });
      const b = m.captionBox(k);
      ky += Math.max(b.y2 - b.y1, 0.8 * L);
    }
  }
  return out;
}

/** Turn a caption to read up the page, its middle at `p` (it lies to the left of p). */
function turnUp(doc: Doc, m: Measure, c: Caption, p: Vec): void {
  const b = m.captionBox({ ...c, rot: undefined });
  const w = b.x2 - b.x1;
  // turned −90° about (x, y): the text runs up from there, its top towards the left
  const descent = b.y2 - c.y;
  doc.updateCaption(c.id, { x: p.x - descent, y: p.y + w / 2, rot: -90 });
}

/**
 * A smooth climb or fall from p0 to p1, flat at both ends (half a cosine wave), as short arcs:
 * each runs through three points of the wave, so the pieces meet smoothly.
 */
/** A point `t` of the way along the cosine S from p0 to p1 (flat at both ends). */
function cosineAt(p0: Vec, p1: Vec, t: number): Vec {
  return { x: p0.x + (p1.x - p0.x) * t, y: p0.y + ((p1.y - p0.y) * (1 - Math.cos(Math.PI * t))) / 2 };
}

export function sCurve(p0: Vec, p1: Vec, pieces = 6): { tail: Vec; head: Vec; sweep: number }[] {
  if (Math.abs(p1.y - p0.y) < 1e-6) return [{ tail: p0, head: p1, sweep: 0 }];
  const at = (t: number) => cosineAt(p0, p1, t);
  const out: { tail: Vec; head: Vec; sweep: number }[] = [];
  for (let i = 0; i < pieces; i++) {
    const tail = at(i / pieces), head = at((i + 1) / pieces);
    out.push({ tail, head, sweep: sweepThrough(tail, head, at((i + 0.5) / pieces)) });
  }
  return out;
}

/**
 * The largest climb on a pathway: from the lowest point up to the highest point after it
 * (the energetic span read simply). Columns of the low and high points, and their energies.
 */
export function largestBarrier(p: EnergyPath): { from: number; top: number; low: number; high: number } | null {
  let best: { from: number; top: number; low: number; high: number } | null = null;
  let lowK = -1, low = Infinity;
  p.points.forEach((q, k) => {
    if (q.g === null || !isFinite(q.g)) return;
    if (lowK >= 0 && q.g - low > (best ? best.high - best.low : 0)) best = { from: lowK, top: k, low, high: q.g };
    if (q.g < low) { low = q.g; lowK = k; }
  });
  return best;
}

/** Where the plot goes in a diagram's frame box, and its size (when it is drawn again, or resized by hand). */
export function plotFromBox(b: Rect, d: EnergyData, L: number): { at: Vec; w: number; h: number } {
  const g = d.margins ?? { l: d.axis ? 2.6 * L : 0.3 * L, t: 2.2 * L, r: 0.3 * L, b: d.axis ? 4.6 * L : 1.6 * L };
  return { at: { x: b.x1 + g.l, y: b.y1 + g.t }, w: Math.max(4 * L, b.x2 - b.x1 - g.l - g.r), h: Math.max(3 * L, b.y2 - b.y1 - g.t - g.b) };
}

/**
 * Draw a diagram in a frame of its own, with the plot's top left at `at`, or draw the diagram
 * in frame `id` again with new numbers (what it drew before goes; structures and pictures put
 * on it stay). Returns the frame's id. Call inside an edit.
 */
export function putEnergy(doc: Doc, m: Measure, d: EnergyData, at: Vec, id?: number): number {
  const old = id !== undefined ? doc.shapes.get(id) : undefined;
  const kept: Pick<Frame, 'atoms' | 'shapes'> = { atoms: [], shapes: [] };
  if (old?.frame) {
    const f = old.frame;
    for (const c of f.captions) doc.removeCaption(c);
    for (const r of f.arrows) doc.removeArrow(r);
    for (const s of f.shapes) { if (doc.shapes.get(s)?.kind === 'line') doc.removeShape(s); else if (doc.shapes.has(s)) kept.shapes.push(s); }
    kept.atoms = f.atoms.filter((a) => doc.atoms.has(a));
  }
  const parts = drawEnergy(doc, m, d, at);
  const pad = 0.3 * doc.style.bondLength;
  const frame: Frame = { atoms: kept.atoms, captions: parts.captions, arrows: parts.arrows, shapes: [...parts.shapes, ...kept.shapes], padX: pad, padY: pad, fit: true };
  const b = frameBox(doc, frame, m) ?? { x1: at.x, y1: at.y, x2: at.x + d.w, y2: at.y + d.h };
  const r = (v: number) => Math.round(v * 100) / 100;
  const energy: EnergyData = { ...d, margins: { l: r(at.x - b.x1), t: r(at.y - b.y1), r: r(b.x2 - at.x - d.w), b: r(b.y2 - at.y - d.h) } };
  if (old) { doc.updateShape(old.id, { ...b, frame, energy }); return old.id; }
  return doc.addShape({ kind: 'geo', geo: 'rect', ...b, filled: false, lineWidth: 0, color: '#000000', frame, energy, name: 'Energy diagram' }).id;
}

/** The energy diagram a thing belongs to (its frame's id), if any. */
export function energyFrameOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | null {
  if (kind === 'shape' && doc.shapes.get(id)?.energy) return id;
  for (const s of doc.shapes.values()) {
    if (!s.energy || !s.frame) continue;
    const f = s.frame;
    if (kind === 'caption' && f.captions.includes(id)) return s.id;
    if (kind === 'arrow' && f.arrows.includes(id)) return s.id;
    if (kind === 'shape' && f.shapes.includes(id)) return s.id;
    if (kind === 'atom' || kind === 'bond') {
      const atom = kind === 'atom' ? id : doc.bonds.get(id)?.a1;
      if (atom !== undefined && frameMembers(doc, f).atoms.has(atom)) return s.id;
    }
  }
  return null;
}

/**
 * At the end of a change: a diagram whose frame was resized by hand (nothing inside it moved)
 * is drawn again to fill its new box.
 */
export function refitEnergy(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  for (const s of [...doc.shapes.values()]) {
    if (!s.energy || !s.frame) continue;
    const old = before.get('s' + s.id) as Shape | null | undefined;
    if (!old) continue;
    const a = shapeBox(old), b = shapeBox(s);
    if (Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) + Math.abs(a.x2 - b.x2) + Math.abs(a.y2 - b.y2) < 1e-6) continue;
    const f = s.frame;
    const touched = f.captions.some((id) => before.has('c' + id)) || f.arrows.some((id) => before.has('r' + id)) || f.shapes.some((id) => before.has('s' + id));
    if (touched) continue;
    const p = plotFromBox(b, s.energy, doc.style.bondLength);
    putEnergy(doc, m, { ...s.energy, w: p.w, h: p.h }, p.at, s.id);
  }
}
