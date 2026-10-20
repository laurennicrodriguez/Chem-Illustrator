// The shapes of a highlight. Square and diamond highlights, and round ones made smooth, are one
// even band along the bonds (mitred or round where bonds meet), swelling smoothly round a label
// too big for it; an atom with no highlighted bond gets a disc, diamond or square. Round
// highlights that aren't smooth have a disc under each atom and a round-ended band under each
// bond. Every outline goes round the same way, so all of one highlight can be filled at once
// and overlaps don't show darker. Soft edges are rings of the same shapes, grown a little each
// time and faint.

import type { Rect, Vec } from '../geom';
import { HIGHLIGHT_DEFAULTS, type HighlightStyle } from '../model';

export type Piece =
  | { kind: 'disc'; c: Vec; r: number }
  /** A band from p to q with round ends of radius r (a pill when p and q are close). */
  | { kind: 'band'; p: Vec; q: Vec; r: number }
  | { kind: 'poly'; pts: Vec[] };

/** The usual sizes for a bond length: the disc's radius and half the band's width. */
export function highlightSizes(bondLength: number, size = 1): { disc: number; band: number } {
  return { disc: 0.27 * bondLength * size, band: 0.21 * bondLength * size };
}

/** A highlight's style with the usual look filled in. */
export function fullStyle(s: HighlightStyle | undefined): Required<HighlightStyle> {
  return { ...HIGHLIGHT_DEFAULTS, ...s };
}

/** A highlight style with the usual values left out (none at all when it is the usual look). */
export function tidyStyle(s: HighlightStyle): HighlightStyle | undefined {
  const d = fullStyle(undefined);
  const out: HighlightStyle = {};
  for (const k of Object.keys(s) as (keyof HighlightStyle)[]) if (s[k] !== undefined && s[k] !== d[k]) (out as Record<string, unknown>)[k] = s[k];
  return Object.keys(out).length ? out : undefined;
}

/** Points turned to go round clockwise on the page (positive area with y down), as arcs do. */
export function clockwise(pts: Vec[]): Vec[] {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a < 0 ? [...pts].reverse() : pts;
}

const diamond = (c: Vec, hx: number, hy: number): Vec[] => clockwise([{ x: c.x, y: c.y - hy }, { x: c.x + hx, y: c.y }, { x: c.x, y: c.y + hy }, { x: c.x - hx, y: c.y }]);
const rect = (c: Vec, hx: number, hy: number): Vec[] => clockwise([{ x: c.x - hx, y: c.y - hy }, { x: c.x + hx, y: c.y - hy }, { x: c.x + hx, y: c.y + hy }, { x: c.x - hx, y: c.y + hy }]);

/**
 * The piece under an atom at `a`: radius `r` for a plain one; with `label` (its label's box)
 * and fitting on, big enough to hold the label with `pad` round it. `grow` widens it all round
 * (for soft edges).
 */
export function atomPiece(a: Vec, r: number, shape: Required<HighlightStyle>['shape'], label: Rect | null, pad: number, grow = 0): Piece {
  if (label) {
    const c = { x: (label.x1 + label.x2) / 2, y: (label.y1 + label.y2) / 2 };
    const hx = Math.max(r, (label.x2 - label.x1) / 2 + pad), hy = Math.max(r, (label.y2 - label.y1) / 2 + pad);
    if (shape === 'square') return { kind: 'poly', pts: rect(c, hx + grow, hy + grow) };
    // a diamond round the label: the letters reach well into its corners' box, so a little
    // over the label's half sizes holds them without the diamond getting huge
    if (shape === 'diamond') {
      const dx = Math.max(1.3 * r, 1.5 * ((label.x2 - label.x1) / 2 + pad)), dy = Math.max(1.3 * r, 1.5 * ((label.y2 - label.y1) / 2 + pad));
      return { kind: 'poly', pts: diamond(c, dx + grow * Math.SQRT2, dy + grow * Math.SQRT2) };
    }
    // round: a pill along the longer side
    const rr = Math.min(hx, hy) + grow;
    return hx >= hy
      ? { kind: 'band', p: { x: c.x - (hx - hy), y: c.y }, q: { x: c.x + (hx - hy), y: c.y }, r: rr }
      : { kind: 'band', p: { x: c.x, y: c.y - (hy - hx) }, q: { x: c.x, y: c.y + (hy - hx) }, r: rr };
  }
  if (shape === 'square') return { kind: 'poly', pts: rect(a, 0.9 * r + grow, 0.9 * r + grow) };
  if (shape === 'diamond') return { kind: 'poly', pts: diamond(a, 1.3 * r + grow * Math.SQRT2, 1.3 * r + grow * Math.SQRT2) };
  return { kind: 'disc', c: a, r: r + grow };
}

/** The piece under a bond from p to q, `half` either side of it, its ends matching the shape. */
export function bondPiece(p: Vec, q: Vec, half: number, shape: Required<HighlightStyle>['shape'], grow = 0): Piece {
  const h = half + grow;
  if (shape === 'round') return { kind: 'band', p, q, r: h };
  const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / d, y: (q.y - p.y) / d }, n = { x: -u.y, y: u.x };
  const at = (o: Vec, t: number, s: number) => ({ x: o.x + u.x * t + n.x * s, y: o.y + u.y * t + n.y * s });
  // square ends reach as far past the atoms as round ones; with diamonds the band stops at the
  // atoms (their diamonds make the ends)
  const e = shape === 'square' ? h : 0;
  return { kind: 'poly', pts: clockwise([at(p, -e, -h), at(q, e, -h), at(q, e, h), at(p, -e, h)]) };
}

/**
 * All the pieces of one highlight (one colour and look). Square and diamond highlights, and
 * round ones made smooth, are one even band along the bonds: mitred corners (square, diamond)
 * or round ones where bonds meet, square, pointed or round ends, and an atom's own shape only
 * on an atom with no highlighted bond. Where a label is too big for the band, the band swells
 * smoothly round it. Round highlights that aren't smooth are a disc on each atom and a band on
 * each bond. Atoms are matched to bond ends by identity, so pass the same objects in both.
 */
export function highlightPieces(bonds: [Vec, Vec][], atoms: { at: Vec; label: Rect | null }[], sizes: { disc: number; band: number }, style: Required<HighlightStyle>, pad: number, grow = 0): Piece[] {
  const { shape } = style;
  const out: Piece[] = [];
  if (shape === 'round' && !style.smooth) {
    for (const [p, q] of bonds) out.push(bondPiece(p, q, sizes.band, shape, grow));
    for (const a of atoms) out.push(atomPiece(a.at, sizes.disc, shape, a.label, pad, grow));
    return out;
  }
  const h = sizes.band + grow;
  // where each atom's highlighted bonds go, and how far along them a swelling tapers back
  const ends = new Map<Vec, Way[]>();
  for (const [p, q] of bonds) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 1e-9) continue;
    const u = { x: (q.x - p.x) / d, y: (q.y - p.y) / d }, s = Math.min(2.2 * sizes.band, d / 2);
    (ends.get(p) ?? ends.set(p, []).get(p)!).push({ u, s });
    (ends.get(q) ?? ends.set(q, []).get(q)!).push({ u: { x: -u.x, y: -u.y }, s });
    // round ends make round corners too; mitred corners and ends are added at the atoms
    out.push(shape === 'round' ? { kind: 'band', p, q, r: h } : bondPiece(p, q, sizes.band, 'diamond', grow));
  }
  const labelOf = new Map<Vec, Rect>();
  for (const a of atoms) {
    // an atom on its own keeps its shape
    if (!ends.has(a.at)) out.push(atomPiece(a.at, sizes.disc, shape, a.label, pad, grow));
    else if (a.label) labelOf.set(a.at, a.label);
  }
  for (const [a, ways] of ends) {
    const label = labelOf.get(a);
    if (shape === 'round') {
      if (!label) continue;
      // a pill just round the label, joined to each bond by a taper
      const pill = piecePoints(atomPiece(a, sizes.band, 'round', label, pad, grow));
      for (const { u, s } of ways) {
        const n = { x: -u.y, y: u.x };
        const pts = [...pill];
        for (const t of [0, s]) for (const k of [-h, h]) pts.push({ x: a.x + u.x * t + n.x * k, y: a.y + u.y * t + n.y * k });
        out.push({ kind: 'poly', pts: clockwise(hull(pts)) });
      }
      continue;
    }
    // without a label, an even band; with one, the band widens at the atom just enough to hold
    // it (each side on its own) and tapers back to its width along each bond. The letters
    // don't reach their box's corners, so its corners are taken a little in.
    let need: Vec[] = [];
    if (label) {
      const c = { x: (label.x1 + label.x2) / 2, y: (label.y1 + label.y2) / 2 };
      const hx = (label.x2 - label.x1) / 2 + pad + grow, hy = (label.y2 - label.y1) / 2 + pad + grow;
      need = [[1, 0], [0.75, 0.75], [0, 1], [-0.75, 0.75], [-1, 0], [-0.75, -0.75], [0, -1], [0.75, -0.75]].map(([x, y]) => ({ x: c.x + x * hx, y: c.y + y * hy }));
    }
    out.push(...joint(a, ways, shape, h, need));
  }
  return out;
}

type Way = { u: Vec; s: number };

/**
 * The band round an atom: in each gap between neighbouring bonds, the bands' edges carried on
 * till they meet (mitred, or cut off flat when the bonds are so close together that the point
 * would reach far out); at the end of a line, a square end or a point (diamonds). Where the
 * points `need` lie in a gap, the band there widens at the atom till it holds them, narrowing
 * back to `h` at each bond's `s`.
 */
function joint(a: Vec, ways: Way[], shape: 'diamond' | 'square', h: number, need: Vec[]): Piece[] {
  const sorted = ways.map((w) => ({ ...w, t: Math.atan2(w.u.y, w.u.x) })).sort((p, q) => p.t - q.t);
  const at = (u: Vec, t: number, k: number) => ({ x: a.x + u.x * t - u.y * k, y: a.y + u.y * t + u.x * k });
  const stubs = ways.map(({ u, s }) => [at(u, 0, -h), at(u, s, -h), at(u, s, h), at(u, 0, h)]);
  const out: Piece[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i], nx = sorted[(i + 1) % sorted.length];
    let gap = nx.t - w.t;
    if (gap <= 1e-9) gap += Math.PI * 2;
    const m = { x: Math.cos(w.t + gap / 2), y: Math.sin(w.t + gap / 2) };
    const piece = (wide: number): Vec[] => {
      // each band's edge on this side of the atom: where its taper starts, and at the atom
      const P = at(w.u, w.s, h), Q = at(w.u, 0, wide), P2 = at(nx.u, nx.s, -h), Q2 = at(nx.u, 0, -wide);
      const far = wide / Math.sin(gap / 2), tip = { x: a.x + m.x * far, y: a.y + m.y * far };
      if (sorted.length === 1) return shape === 'square' ? [a, P, Q, at(w.u, -wide, wide), at(w.u, -wide, -wide), Q2, P2] : [a, P, Q, at(w.u, -wide, 0), Q2, P2];
      if (gap < Math.PI) return wide > h ? [a, P, tip, P2] : [];
      return far > 3 * wide ? [a, P, Q, Q2, P2] : [a, P, Q, tip, Q2, P2];
    };
    // the points to hold that lie in this gap
    const mine = need.filter((v) => {
      let t = Math.atan2(v.y - a.y, v.x - a.x) - w.t;
      while (t < 0) t += Math.PI * 2;
      return t <= gap;
    });
    const holds = (pts: Vec[]) => mine.every((v) => (pts.length && inside(v, pts)) || stubs.some((st) => inside(v, st)));
    let wide = h, pts = piece(wide);
    while (wide < 2.5 * h && !holds(pts)) pts = piece((wide *= 1.05));
    // a label well off to one side (NH with its H below): the band's outline stretched round it
    if (!holds(pts)) pts = hull([...pts, ...mine, a, at(w.u, w.s, h), at(nx.u, nx.s, -h)]);
    if (pts.length) out.push({ kind: 'poly', pts: clockwise(pts) });
  }
  return out;
}

/** Whether a point is inside an outline. */
function inside(v: Vec, pts: Vec[]): boolean {
  let n = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const p = pts[i], q = pts[j];
    if ((p.y > v.y) !== (q.y > v.y) && v.x < ((q.x - p.x) * (v.y - p.y)) / (q.y - p.y) + p.x) n = !n;
  }
  return n;
}

/** A piece's outline as points (arcs in short steps). */
function piecePoints(pc: Piece): Vec[] {
  const arc = (c: Vec, r: number, a0: number, a1: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => { const t = a0 + ((a1 - a0) * i) / n; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }; });
  if (pc.kind === 'poly') return pc.pts;
  if (pc.kind === 'disc') return arc(pc.c, pc.r, 0, Math.PI * 2, 32).slice(1);
  const a = Math.atan2(pc.q.y - pc.p.y, pc.q.x - pc.p.x);
  return [...arc(pc.q, pc.r, a - Math.PI / 2, a + Math.PI / 2, 16), ...arc(pc.p, pc.r, a + Math.PI / 2, a + (3 * Math.PI) / 2, 16)];
}

/** The convex hull of some points (Andrew's monotone chain). */
function hull(pts: Vec[]): Vec[] {
  const p = [...pts].sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cross = (o: Vec, a: Vec, b: Vec) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: Vec[] = [], upper: Vec[] = [];
  for (const v of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], v) <= 0) lower.pop(); lower.push(v); }
  for (let i = p.length - 1; i >= 0; i--) { const v = p[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], v) <= 0) upper.pop(); upper.push(v); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Pieces moved by (dx, dy) (for a shadow). */
export function movePieces(ps: Piece[], dx: number, dy: number): Piece[] {
  const mv = (v: Vec) => ({ x: v.x + dx, y: v.y + dy });
  return ps.map((pc) => pc.kind === 'disc' ? { ...pc, c: mv(pc.c) } : pc.kind === 'band' ? { ...pc, p: mv(pc.p), q: mv(pc.q) } : { kind: 'poly', pts: pc.pts.map(mv) });
}

/** How far each soft ring reaches past the last, and how many there are. */
export function softRings(half: number): { step: number; count: number } {
  return { step: 0.22 * half, count: 4 };
}

/** Trace pieces into a path (each going round the same way). */
export function tracePieces(ctx: { moveTo(x: number, y: number): void; lineTo(x: number, y: number): void; arc(x: number, y: number, r: number, a0: number, a1: number): void; closePath(): void }, pieces: Piece[]): void {
  for (const pc of pieces) {
    if (pc.kind === 'disc') {
      ctx.moveTo(pc.c.x + pc.r, pc.c.y);
      ctx.arc(pc.c.x, pc.c.y, pc.r, 0, Math.PI * 2);
      ctx.closePath();
    } else if (pc.kind === 'band') {
      const a = Math.atan2(pc.q.y - pc.p.y, pc.q.x - pc.p.x);
      ctx.moveTo(pc.q.x + pc.r * Math.cos(a - Math.PI / 2), pc.q.y + pc.r * Math.sin(a - Math.PI / 2));
      ctx.arc(pc.q.x, pc.q.y, pc.r, a - Math.PI / 2, a + Math.PI / 2);
      ctx.arc(pc.p.x, pc.p.y, pc.r, a + Math.PI / 2, a + (3 * Math.PI) / 2);
      ctx.closePath();
    } else {
      ctx.moveTo(pc.pts[0].x, pc.pts[0].y);
      for (const v of pc.pts.slice(1)) ctx.lineTo(v.x, v.y);
      ctx.closePath();
    }
  }
}

/** A highlight's look as saved in a file, read back (anything unknown left out). */
export function highlightStyleFromTag(text: string | null | undefined): HighlightStyle | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Record<string, unknown>;
    const out: HighlightStyle = {};
    if (v.shape === 'round' || v.shape === 'diamond' || v.shape === 'square') out.shape = v.shape;
    if (typeof v.size === 'number' && v.size > 0 && v.size <= 10) out.size = v.size;
    for (const k of ['fit', 'shadow', 'soft', 'smooth'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}
