// Sketching with the pen (the Sketch tool, or any tool with View > Touch Mode > Pen Always
// Sketches): freehand ink becomes chemistry when the pen lifts.
//
// - A line becomes a bond; a line with corners (a zig-zag) a chain, one bond per straight
//   stretch. Bonds come out one bond length long at clean angles, joining atoms they start or
//   end on. A line drawn along a bond makes it double (again: triple).
// - A loop with corners becomes a ring with that many atoms; a smooth loop (a circle) a benzene
//   ring. Drawn over a bond, the ring is fused there. A circle inside a ring makes it aromatic.
// - A scribble (back and forth) erases the atoms and bonds under it.
// - Small strokes are letters: an element symbol (C N O S P F Cl Br I H B) puts that label on
//   the atom it is written on, or a new atom where there is none; + and − put a charge on the
//   nearest atom. Letters are read with the $P point-cloud recogniser (Vatavu, Anthony and
//   Wobbrock, 2012) against strokes made here; several strokes written together are read as one.

import type { Vec } from '../geom';
import { add, angleOf, dist, distToSegment, fromAngle, mul, normAngle, sub, DEG } from '../geom';
import type { Doc, Atom } from '../model';
import { atomAt, bondLength, bondTo, freeRing, fusedRing, placeRing, ringOnAtom, ringRadius, sproutDir } from '../chem/chemgeom';

// ------------------------------------------------------------------ stroke geometry

export function pathLength(pts: Vec[]): number {
  let s = 0;
  for (let i = 1; i < pts.length; i++) s += dist(pts[i - 1], pts[i]);
  return s;
}

export function boxOf(pts: Vec[]): { x1: number; y1: number; x2: number; y2: number; w: number; h: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x1, y1, x2, y2, w: x2 - x1, h: y2 - y1 };
}

const centroid = (pts: Vec[]): Vec => mul(pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / pts.length);

/** The stroke as points `step` apart along it. */
export function resample(pts: Vec[], step: number): Vec[] {
  if (pts.length < 2 || step <= 0) return pts.slice();
  const out = [pts[0]];
  let carry = 0;
  for (let i = 1; i < pts.length; i++) {
    let a = pts[i - 1];
    const b = pts[i];
    let d = dist(a, b);
    while (carry + d >= step) {
      const t = (step - carry) / d;
      a = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      out.push(a);
      d = dist(a, b);
      carry = 0;
    }
    carry += d;
  }
  if (dist(out[out.length - 1], pts[pts.length - 1]) > step * 0.3) out.push(pts[pts.length - 1]);
  return out;
}

/** Corners: the Ramer–Douglas–Peucker simplification of the stroke (its first and last points kept). */
export function simplify(pts: Vec[], eps: number): Vec[] {
  if (pts.length < 3) return pts.slice();
  let far = 0, fd = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = distToSegment(pts[i], pts[0], pts[pts.length - 1]);
    if (d > fd) { fd = d; far = i; }
  }
  if (fd <= eps) return [pts[0], pts[pts.length - 1]];
  const left = simplify(pts.slice(0, far + 1), eps), right = simplify(pts.slice(far), eps);
  return [...left.slice(0, -1), ...right];
}

/** How many times the stroke doubles back on itself (turns sharper than 130°). */
export function reversals(pts: Vec[], step: number): number {
  const r = resample(pts, step);
  let n = 0;
  for (let i = 2; i < r.length; i++) {
    const a = angleOf(sub(r[i - 1], r[i - 2])), b = angleOf(sub(r[i], r[i - 1]));
    let t = Math.abs(normAngle(b - a));
    if (t > Math.PI) t = 2 * Math.PI - t;
    if (t > 130 * DEG) { n++; i++; }
  }
  return n;
}

export type StrokeKind =
  | { kind: 'tap' }
  | { kind: 'scribble' }
  | { kind: 'glyph' }
  | { kind: 'loop'; corners: number; centre: Vec; radius: number }
  | { kind: 'line'; vertices: Vec[] };

/** What a stroke is, by its shape and size against the bond length L (and whether it starts on an atom). */
export function classify(pts: Vec[], L: number, startsOnAtom = false): StrokeKind {
  const P = pathLength(pts);
  if (P < 0.12 * L) return { kind: 'tap' };
  const b = boxOf(pts), D = Math.hypot(b.w, b.h);
  if (reversals(pts, 0.06 * L) >= 3 && P > 1.6 * D && D > 0.3 * L) return { kind: 'scribble' };
  const chord = dist(pts[0], pts[pts.length - 1]);
  let dev = 0;
  for (const p of pts) dev = Math.max(dev, distToSegment(p, pts[0], pts[pts.length - 1]));
  const straight = dev < Math.max(0.12 * chord, 0.06 * L);
  // small strokes are letters, unless a straight one starts on an atom (a short bond)
  if (Math.max(b.w, b.h) < 0.7 * L && !(straight && startsOnAtom)) return { kind: 'glyph' };
  const closed = chord < Math.max(0.22 * D, 0.2 * L) && P > 1.8 * L;
  if (closed) {
    const c = centroid(resample(pts, L / 10));
    const r = resample(pts, L / 10).reduce((s, p) => s + dist(p, c), 0) / resample(pts, L / 10).length;
    return { kind: 'loop', corners: loopCorners(pts, c, r), centre: c, radius: r };
  }
  const v = mergeShort(simplify(resample(pts, 0.05 * L), 0.18 * L), 0.4 * L);
  return { kind: 'line', vertices: v };
}

/** Corners round a closed stroke (0 for a smooth loop). */
export function loopCorners(pts: Vec[], c: Vec, r: number): number {
  const ring = resample(pts, (2 * Math.PI * r) / 72);
  if (ring.length < 8) return 0;
  // the turning at each point, over a short window: corners turn sharply, circles evenly
  const n = ring.length, w = Math.max(2, Math.round(n / 24));
  const turn = (i: number) => {
    const a = ring[(i - w + n) % n], p = ring[i], b = ring[(i + w) % n];
    let t = Math.abs(normAngle(angleOf(sub(b, p)) - angleOf(sub(p, a))));
    if (t > Math.PI) t = 2 * Math.PI - t;
    return t;
  };
  const turns = ring.map((_, i) => turn(i));
  const mean = turns.reduce((s, t) => s + t, 0) / n;
  const peaks: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = turns[i];
    if (t < Math.max(2.2 * mean, 25 * DEG)) continue;
    if (t >= turns[(i - 1 + n) % n] && t > turns[(i + 1) % n]) {
      // one corner per sharp bend (neighbouring peaks are the same corner)
      if (peaks.length && i - peaks[peaks.length - 1] < w) continue;
      peaks.push(i);
    }
  }
  if (peaks.length > 1 && peaks[0] + n - peaks[peaks.length - 1] < w) peaks.pop();
  return peaks.length;
}

/** Drop corners that leave a stretch shorter than `min` (a wobble, not a bond). */
function mergeShort(v: Vec[], min: number): Vec[] {
  const out = v.slice();
  let changed = true;
  while (changed && out.length > 2) {
    changed = false;
    for (let i = 1; i < out.length - 1; i++) {
      if (dist(out[i - 1], out[i]) < min || dist(out[i], out[i + 1]) < min) { out.splice(i, 1); changed = true; break; }
    }
  }
  return out;
}

// ------------------------------------------------------------------ letters ($P)

interface Pt { x: number; y: number; id: number }
const N_POINTS = 32;

function cloud(strokes: Vec[][]): Pt[] {
  const pts: Pt[] = [];
  strokes.forEach((st, id) => { for (const p of st) pts.push({ x: p.x, y: p.y, id }); });
  // resample to N points along the strokes (not across the gaps between them)
  let total = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i].id === pts[i - 1].id) total += dist(pts[i - 1], pts[i]);
  const I = total / (N_POINTS - 1);
  const out: Pt[] = [{ ...pts[0] }];
  let D = 0;
  for (let i = 1; i < pts.length && I > 0; i++) {
    if (pts[i].id !== pts[i - 1].id) continue;
    const d = dist(pts[i - 1], pts[i]);
    if (D + d >= I) {
      const t = (I - D) / d;
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y), id: pts[i].id };
      out.push(q);
      pts.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < N_POINTS) out.push({ ...pts[pts.length - 1] });
  out.length = N_POINTS;
  // scaled to a unit box (keeping its shape) about its centre
  const b = boxOf(out), k = Math.max(b.w, b.h) || 1, c = centroid(out);
  return out.map((p) => ({ x: (p.x - c.x) / k, y: (p.y - c.y) / k, id: p.id }));
}

function cloudDistance(a: Pt[], b: Pt[], start: number): number {
  const n = a.length, matched = new Array(n).fill(false);
  let sum = 0, i = start;
  do {
    let best = -1, bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = dist(a[i], b[j]);
      if (d < bd) { bd = d; best = j; }
    }
    matched[best] = true;
    sum += (1 - ((i - start + n) % n) / n) * bd;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function matchClouds(a: Pt[], b: Pt[]): number {
  const n = a.length, step = Math.floor(Math.pow(n, 0.5));
  let min = Infinity;
  for (let i = 0; i < n; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min;
}

// the letters, as strokes in a unit box (x right, y down), several ways each
const arc = (cx: number, cy: number, rx: number, ry: number, from: number, to: number, n = 16): Vec[] =>
  Array.from({ length: n + 1 }, (_, i) => { const a = (from + ((to - from) * i) / n) * DEG; return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) }; });
const line = (...p: [number, number][]): Vec[] => p.map(([x, y]) => ({ x, y }));

const LETTERS: [string, Vec[][]][] = [
  ['C', [arc(0.55, 0.5, 0.45, 0.5, -40, -320)]],
  ['C', [arc(0.5, 0.5, 0.4, 0.5, -60, -300)]],
  ['O', [arc(0.5, 0.5, 0.4, 0.5, -90, 270)]],
  ['O', [arc(0.5, 0.5, 0.4, 0.5, -90, -450)]],
  ['N', [line([0, 1], [0, 0], [0.8, 1], [0.8, 0])]],
  ['N', [line([0, 1], [0, 0]), line([0, 0], [0.8, 1], [0.8, 0])]],
  ['N', [line([0, 1], [0, 0]), line([0, 0], [0.8, 1]), line([0.8, 1], [0.8, 0])]],
  ['S', [[...arc(0.45, 0.26, 0.35, 0.25, -20, -270), ...arc(0.45, 0.75, 0.35, 0.25, -90, 160)]]],
  ['S', [[...arc(0.5, 0.25, 0.3, 0.25, 0, -270), ...arc(0.5, 0.75, 0.3, 0.25, -90, 180)]]],
  ['P', [[...line([0, 1], [0, 0]), ...arc(0, 0.27, 0.55, 0.27, -90, 90)]]],
  ['P', [line([0, 1], [0, 0]), arc(0, 0.27, 0.55, 0.27, -90, 90)]],
  ['B', [line([0, 1], [0, 0]), [...arc(0, 0.25, 0.45, 0.25, -90, 90), ...arc(0, 0.75, 0.55, 0.25, -90, 90)]]],
  ['B', [[...line([0, 1], [0, 0]), ...arc(0, 0.25, 0.45, 0.25, -90, 90), ...arc(0, 0.75, 0.55, 0.25, -90, 90)]]],
  ['F', [line([0, 1], [0, 0], [0.7, 0]), line([0, 0.45], [0.55, 0.45])]],
  ['F', [line([0, 0], [0, 1]), line([0, 0], [0.7, 0]), line([0, 0.45], [0.55, 0.45])]],
  ['F', [line([0.7, 0], [0, 0], [0, 1]), line([0, 0.45], [0.55, 0.45])]],
  ['H', [line([0, 0], [0, 1]), line([0.8, 0], [0.8, 1]), line([0, 0.5], [0.8, 0.5])]],
  ['H', [line([0, 0], [0, 1]), line([0, 0.5], [0.8, 0.5]), line([0.8, 0], [0.8, 1])]],
  ['H', [line([0, 0], [0, 1]), line([0, 0.5], [0.8, 0.5], [0.8, 0]), line([0.8, 0.5], [0.8, 1])]],
  ['I', [line([0.5, 0], [0.5, 1])]],
  ['I', [line([0.2, 0], [0.8, 0]), line([0.5, 0], [0.5, 1]), line([0.2, 1], [0.8, 1])]],
  ['r', [[...line([0, 1], [0, 0.35]), ...arc(0.4, 0.45, 0.4, 0.35, 180, 290, 8)]]],
  ['r', [line([0, 0.25], [0, 1]), arc(0.4, 0.45, 0.4, 0.35, 180, 290, 8)]],
  ['+', [line([0.5, 0], [0.5, 1]), line([0, 0.5], [1, 0.5])]],
  ['+', [line([0, 0.5], [1, 0.5]), line([0.5, 0], [0.5, 1])]],
  ['-', [line([0, 0.5], [1, 0.5])]],
];
let templates: { sym: string; pts: Pt[] }[] | null = null;

/** The letter a group of strokes looks most like, and how far off it is (lower is closer; null if nothing near). */
export function readLetter(strokes: Vec[][]): { sym: string; score: number } | null {
  if (!strokes.length || !strokes.some((s) => s.length > 1)) return null;
  const b = boxOf(strokes.flat());
  // a flat stroke is a minus (a cloud scaled to a box can't tell a line's length from another's)
  if (strokes.length === 1 && b.h < 0.25 * b.w) return { sym: '-', score: 0 };
  if (strokes.length === 1 && b.w < 0.25 * b.h) return { sym: 'I', score: 0 };
  templates ??= LETTERS.map(([sym, s]) => ({ sym, pts: cloud(s) }));
  const c = cloud(strokes.map((s) => s.length === 1 ? [s[0], s[0]] : s));
  let best: { sym: string; score: number } | null = null;
  for (const t of templates) {
    if (t.sym === '-' || t.sym === 'I' && strokes.length === 1) continue;
    const d = matchClouds(c, t.pts);
    if (!best || d < best.score) best = { sym: t.sym, score: d };
  }
  return best && best.score < 9 ? best : null;
}

/** What letters spell: one symbol, or two side by side (Cl, Br). */
export function readSymbol(strokes: Vec[][]): string | null {
  const whole = readLetter(strokes);
  // two letters: strokes split where there is a gap across
  let split: string | null = null, splitScore = Infinity;
  if (strokes.length >= 2) {
    const order = strokes.map((s, i) => ({ i, b: boxOf(s) })).sort((a, b) => a.b.x1 - b.b.x1);
    for (let k = 1; k < order.length; k++) {
      const left = order.slice(0, k), right = order.slice(k);
      const gap = Math.min(...right.map((r) => r.b.x1)) - Math.max(...left.map((l) => l.b.x2));
      if (gap < -0.05 * boxOf(strokes.flat()).w) continue;
      const a = readLetter(left.map((o) => strokes[o.i])), b = readLetter(right.map((o) => strokes[o.i]));
      if (!a || !b) continue;
      const word = twoLetters(a.sym, b.sym);
      if (word && a.score + b.score < splitScore) { split = word; splitScore = a.score + b.score; }
    }
  }
  if (split && (!whole || splitScore < whole.score * 2.2 || !SINGLE[whole.sym])) return split;
  return whole ? SINGLE[whole.sym] ?? null : split;
}

const SINGLE: Record<string, string> = { C: 'C', N: 'N', O: 'O', S: 'S', P: 'P', F: 'F', H: 'H', I: 'I', B: 'B', '+': '+', '-': '-' };

function twoLetters(a: string, b: string): string | null {
  if (a === 'C' && b === 'I') return 'Cl';
  if (a === 'B' && (b === 'r' || b === 'I')) return 'Br';
  return null;
}

// ------------------------------------------------------------------ turning strokes into chemistry

export interface SketchHost {
  doc: Doc;
  /** Put a label on an atom, as typing it would (the hotkey's way). */
  label(atomId: number, text: string): void;
  /** An atom hotkey (plus, minus). */
  atomKey(atomId: number, act: string): void;
  /** Where the keypad and hotkeys act next. */
  setHot(atomId: number): void;
  /** Something changed: redraw and tell the window. */
  done(): void;
  /** The ink waiting to be read changed: redraw the overlay. */
  repaint(): void;
  say(msg: string): void;
}

/** How long after the last small stroke a letter is read (another stroke may follow, as in H or Cl). */
const LETTER_WAIT = 650;

export class Sketcher {
  /** Small strokes waiting to be read as letters. */
  pending: Vec[][] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(private h: SketchHost) {}

  private get L(): number { return this.h.doc.style.bondLength; }

  /** A stroke has been drawn (in drawing units). */
  stroke(pts: Vec[]): void {
    if (pts.length < 2) { this.flush(); return; }
    const doc = this.h.doc, L = this.L;
    const startAtom = atomAt(doc, pts[0], 0.3 * L);
    const k = classify(pts, L, !!startAtom);
    if (k.kind === 'glyph') {
      // a letter far from the ones waiting is a new one: read those first
      if (this.pending.length) {
        const b = boxOf(this.pending.flat()), c = boxOf(pts);
        if (c.x1 > b.x2 + 0.6 * L || c.x2 < b.x1 - 0.6 * L || c.y1 > b.y2 + 0.6 * L || c.y2 < b.y1 - 0.6 * L) this.flush();
      }
      this.pending.push(pts);
      this.wait();
      this.h.repaint();
      return;
    }
    this.flush();
    if (k.kind === 'tap') return;
    if (k.kind === 'scribble') this.erase(pts);
    else if (k.kind === 'loop') this.ring(pts, k);
    else this.chain(k.vertices);
  }

  /** Read the letters waiting now. */
  flush(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    if (!this.pending.length) return;
    const strokes = this.pending;
    this.pending = [];
    this.letters(strokes);
    this.h.repaint();
  }

  /** Forget ink not yet read (another tool was picked). */
  clear(): void {
    if (this.timer !== null) { clearTimeout(this.timer); this.timer = null; }
    this.pending = [];
  }

  private wait(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, LETTER_WAIT);
  }

  private letters(strokes: Vec[][]): void {
    const doc = this.h.doc, L = this.L;
    const sym = readSymbol(strokes);
    if (!sym) { this.h.say('That letter wasn’t clear: write C, N, O, S, P, F, Cl, Br, I, H, + or − a little larger.'); return; }
    const b = boxOf(strokes.flat()), c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    if (sym === '+' || sym === '-') {
      const a = nearestAtom(doc, c, 1.2 * L);
      if (!a) { this.h.say('Write + or − beside an atom to charge it.'); return; }
      this.h.atomKey(a.id, sym === '+' ? 'plus' : 'minus');
      this.h.setHot(a.id);
      return;
    }
    let a = nearestAtom(doc, c, 0.75 * L);
    if (!a) doc.edit(`Sketch ${sym}`, () => { a = doc.addAtom(c.x, c.y, 6); });
    this.h.label(a!.id, sym);
    this.h.setHot(a!.id);
  }

  private erase(pts: Vec[]): void {
    const doc = this.h.doc, L = this.L;
    const r = resample(pts, 0.1 * L), reach = 0.3 * L;
    const near = (p: Vec) => r.some((q) => dist(p, q) < reach);
    const atoms = new Set<number>(), bonds = new Set<number>();
    for (const p of r) {
      for (const a of doc.atomsNear(p, reach)) atoms.add(a.id);
      for (const b of doc.bondsNear(p, reach)) {
        const p1 = doc.atoms.get(b.a1)!, p2 = doc.atoms.get(b.a2)!;
        if (near(mul(add(p1, p2), 0.5))) bonds.add(b.id);
      }
    }
    if (!atoms.size && !bonds.size) return;
    doc.edit('Erase', () => {
      const ends = new Set<number>();
      for (const id of bonds) { const b = doc.bonds.get(id)!; ends.add(b.a1); ends.add(b.a2); doc.removeBond(id); }
      for (const id of atoms) doc.removeAtom(id);
      // a plain carbon the erased bonds leave on its own goes too
      for (const id of ends) {
        const a = doc.atoms.get(id);
        if (a && !a.label && a.z === 6 && !doc.neighbors(id).length) doc.removeAtom(id);
      }
    });
    this.h.done();
  }

  private ring(pts: Vec[], k: Extract<StrokeKind, { kind: 'loop' }>): void {
    const doc = this.h.doc, L = this.L;
    // a circle inside a ring: the ring becomes aromatic
    const inside = k.corners < 3 ? ringAround(doc, k.centre, k.radius) : null;
    if (inside) {
      doc.edit('Aromatic ring', () => placeRing(doc, inside.map((id) => doc.atoms.get(id)!), { existing: inside, aromatic: true }));
      this.h.done();
      return;
    }
    const n = k.corners >= 3 && k.corners <= 8 ? k.corners : 6;
    const aromatic = k.corners < 3;
    const r = resample(pts, 0.1 * L);
    // drawn over a bond: fused there, on the side the loop is on
    let best: { a: Atom; b: Atom; d: number } | null = null;
    for (const bd of doc.bonds.values()) {
      const a = doc.atoms.get(bd.a1)!, b = doc.atoms.get(bd.a2)!;
      const da = Math.min(...r.map((p) => dist(p, a))), db = Math.min(...r.map((p) => dist(p, b)));
      if (da < 0.3 * L && db < 0.3 * L && (!best || da + db < best.d)) best = { a, b, d: da + db };
    }
    let verts: Vec[];
    if (best) {
      const side = (best.b.x - best.a.x) * (k.centre.y - best.a.y) - (best.b.y - best.a.y) * (k.centre.x - best.a.x) >= 0 ? 1 : -1;
      verts = fusedRing(best.a, best.b, n, side);
    } else {
      const on = nearestOnPath(doc, r, 0.3 * L);
      verts = on ? ringOnAtom(on, unit(sub(k.centre, on)), n, bondLength(doc, on)) : freeRing(k.centre, n, L);
    }
    let first: number | undefined;
    doc.edit(aromatic ? 'Sketch benzene' : `Sketch ${n}-ring`, () => { first = placeRing(doc, verts, { aromatic })[0]; });
    if (first !== undefined) this.h.setHot(first);
    this.h.done();
  }

  private chain(v: Vec[]): void {
    const doc = this.h.doc;
    let last: number | null = null;
    doc.edit('Sketch bonds', () => {
      const L0 = this.L;
      let cur: Atom = atomAt(doc, v[0], 0.35 * L0) ?? doc.addAtom(v[0].x, v[0].y, 6);
      for (let i = 1; i < v.length; i++) {
        const L = bondLength(doc, cur);
        // ending on an atom: join it (along a bond already there: one order higher)
        const end = atomAt(doc, v[i], 0.35 * L, new Set([cur.id]));
        if (end) {
          const ex = doc.bondBetween(cur.id, end.id);
          if (ex) doc.updateBond(ex.id, { order: Math.min(3, Math.floor(ex.order) + 1), display: 'solid' });
          else doc.addBond(cur.id, end.id);
          cur = end;
          continue;
        }
        let ang = angleOf(sub(v[i], v[i - 1]));
        // the first bond from an atom with bonds goes where a new bond would, if drawn about that way
        const nb = doc.neighbors(cur.id).length;
        if (i === 1 && nb) {
          const auto = angleOf(sproutDir(doc, cur.id));
          let diff = Math.abs(normAngle(ang - auto));
          if (diff > Math.PI) diff = 2 * Math.PI - diff;
          ang = diff < 35 * DEG ? auto : Math.round(ang / (15 * DEG)) * 15 * DEG;
        } else ang = Math.round(ang / (30 * DEG)) * 30 * DEG;
        cur = bondTo(doc, cur, add(cur, fromAngle(ang, L)));
      }
      last = cur.id;
    });
    if (last !== null) this.h.setHot(last);
    this.h.done();
  }
}

const unit = (p: Vec): Vec => { const l = Math.hypot(p.x, p.y) || 1; return { x: p.x / l, y: p.y / l }; };

function nearestAtom(doc: Doc, p: Vec, r: number): Atom | undefined {
  let best: Atom | undefined, bd = r;
  for (const a of doc.atomsNear(p, r)) { const d = dist(a, p); if (d < bd && !a.multi) { bd = d; best = a; } }
  return best;
}

function nearestOnPath(doc: Doc, path: Vec[], r: number): Atom | undefined {
  let best: Atom | undefined, bd = r;
  for (const p of path) for (const a of doc.atomsNear(p, r)) { const d = dist(a, p); if (d < bd && !a.multi) { bd = d; best = a; } }
  return best;
}

/** The ring of atoms round a point (a circle drawn inside it), in order round it; null if none. */
export function ringAround(doc: Doc, c: Vec, r: number): number[] | null {
  const L = doc.style.bondLength;
  const cand = doc.atomsNear(c, Math.max(r * 1.8, ringRadius(8, L) * 1.1))
    .filter((a) => !a.multi)
    .sort((a, b) => dist(a, c) - dist(b, c));
  for (let n = 3; n <= 8; n++) {
    const R = ringRadius(n, L);
    const ring = cand.filter((a) => Math.abs(dist(a, c) - R) < 0.3 * R);
    if (ring.length !== n || r > R * 1.25) continue;
    ring.sort((a, b) => angleOf(sub(a, c)) - angleOf(sub(b, c)));
    const ids = ring.map((a) => a.id);
    if (ids.every((id, i) => doc.bondBetween(id, ids[(i + 1) % n]))) return ids;
  }
  return null;
}
