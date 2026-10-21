// The shapes of a highlight. Round highlights have a disc under each atom and a round-ended
// band under each bond, or, made smooth, one even band with round corners. Straight
// highlights are one even band with sharp (mitred) corners where bonds meet, round, square or
// pointed ends, and a disc round each atom label. An atom with no highlighted bond gets a disc.
// Every outline goes round the same way, so all of one highlight can be filled at once and
// overlaps don't show darker. Soft edges, gradients, textures and the other effects are in
// highlight-fx.ts.

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

/**
 * The disc under an atom at `a`, radius `r`; with `label` (its label's box) and fitting on,
 * big enough to hold the label with `pad` round it (a pill along a long label). `grow` widens
 * it all round (for soft edges).
 */
export function atomPiece(a: Vec, r: number, label: Rect | null, pad: number, grow = 0): Piece {
  if (!label) return { kind: 'disc', c: a, r: r + grow };
  const c = { x: (label.x1 + label.x2) / 2, y: (label.y1 + label.y2) / 2 };
  const hx = Math.max(r, (label.x2 - label.x1) / 2 + pad), hy = Math.max(r, (label.y2 - label.y1) / 2 + pad);
  const rr = Math.min(hx, hy) + grow;
  return hx >= hy
    ? { kind: 'band', p: { x: c.x - (hx - hy), y: c.y }, q: { x: c.x + (hx - hy), y: c.y }, r: rr }
    : { kind: 'band', p: { x: c.x, y: c.y - (hy - hx) }, q: { x: c.x, y: c.y + (hy - hx) }, r: rr };
}

/** The piece under a bond from p to q, `half` either side of it: round-ended, or flat-ended at the atoms (straight). */
export function bondPiece(p: Vec, q: Vec, half: number, shape: Required<HighlightStyle>['shape'], grow = 0): Piece {
  const h = half + grow;
  if (shape === 'round') return { kind: 'band', p, q, r: h };
  const d = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / d, y: (q.y - p.y) / d }, n = { x: -u.y, y: u.x };
  const at = (o: Vec, s: number) => ({ x: o.x + n.x * s, y: o.y + n.y * s });
  return { kind: 'poly', pts: clockwise([at(p, -h), at(q, -h), at(q, h), at(p, h)]) };
}

/**
 * All the pieces of one highlight (one colour and look). Round highlights that aren't smooth
 * are a disc on each atom and a band on each bond. Smooth round ones are one even band with
 * round corners, swelling smoothly round a label too big for it. Straight ones are one even
 * band with mitred corners, the chosen ends, and a disc round each label. An atom with no
 * highlighted bond gets a disc. Atoms are matched to bond ends by identity, so pass the same
 * objects in both.
 */
export function highlightPieces(bonds: [Vec, Vec][], atoms: { at: Vec; label: Rect | null }[], sizes: { disc: number; band: number }, style: Required<HighlightStyle>, pad: number, grow = 0): Piece[] {
  const { shape } = style;
  const out: Piece[] = [];
  if (shape === 'round' && !style.smooth) {
    for (const [p, q] of bonds) out.push(bondPiece(p, q, sizes.band, shape, grow));
    for (const a of atoms) out.push(atomPiece(a.at, sizes.disc, a.label, pad, grow));
    return out;
  }
  const h = sizes.band + grow;
  // where each atom's highlighted bonds go, and how far along them a swelling tapers back
  const ends = new Map<Vec, { u: Vec; s: number }[]>();
  for (const [p, q] of bonds) {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d < 1e-9) continue;
    const u = { x: (q.x - p.x) / d, y: (q.y - p.y) / d }, s = Math.min(2.2 * sizes.band, d / 2);
    (ends.get(p) ?? ends.set(p, []).get(p)!).push({ u, s });
    (ends.get(q) ?? ends.set(q, []).get(q)!).push({ u: { x: -u.x, y: -u.y }, s });
    // round ends make round corners too; mitred corners and ends are added at the atoms
    out.push(bondPiece(p, q, sizes.band, shape, grow));
  }
  const labelOf = new Map<Vec, Rect>();
  for (const a of atoms) {
    // an atom on its own: a disc
    if (!ends.has(a.at)) out.push(atomPiece(a.at, sizes.disc, a.label, pad, grow));
    else if (a.label) labelOf.set(a.at, a.label);
  }
  for (const [a, ways] of ends) {
    const label = labelOf.get(a);
    if (shape === 'round') {
      if (!label) continue;
      // a pill just round the label, joined to each bond by a taper
      const pill = piecePoints(atomPiece(a, sizes.band, label, pad, grow));
      for (const { u, s } of ways) {
        const n = { x: -u.y, y: u.x };
        const pts = [...pill];
        for (const t of [0, s]) for (const k of [-h, h]) pts.push({ x: a.x + u.x * t + n.x * k, y: a.y + u.y * t + n.y * k });
        out.push({ kind: 'poly', pts: clockwise(hull(pts)) });
      }
      continue;
    }
    // straight: a disc round a label (it covers the bands' ends), else a corner or an end
    if (label) out.push(atomPiece(a, sizes.disc, label, pad, grow));
    else if (ways.length === 1) out.push(endPiece(a, ways[0].u, h, style.ends));
    else out.push(...corners(a, ways.map((w) => w.u), h));
  }
  return out;
}

/** The end of a straight band at `a`, going off along `u`: round, square past the atom, or a point. */
function endPiece(a: Vec, u: Vec, h: number, ends: Required<HighlightStyle>['ends']): Piece {
  if (ends === 'round') return { kind: 'disc', c: a, r: h };
  const at = (t: number, k: number) => ({ x: a.x + u.x * t - u.y * k, y: a.y + u.y * t + u.x * k });
  return { kind: 'poly', pts: clockwise(ends === 'square' ? [at(0, -h), at(0, h), at(-h, h), at(-h, -h)] : [at(0, -h), at(0, h), at(-h, 0)]) };
}

/**
 * The mitred corners where straight bands meet at `a`: in each gap between neighbouring bonds
 * wider than a straight line, the bands' outer edges carried on till they meet (cut off flat
 * when the bonds are so close together that the point would reach far out).
 */
function corners(a: Vec, ways: Vec[], h: number): Piece[] {
  const sorted = ways.map((u) => ({ u, t: Math.atan2(u.y, u.x) })).sort((p, q) => p.t - q.t);
  const at = (u: Vec, k: number) => ({ x: a.x - u.y * k, y: a.y + u.x * k });
  const out: Piece[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const w = sorted[i], nx = sorted[(i + 1) % sorted.length];
    let gap = nx.t - w.t;
    if (gap <= 1e-9) gap += Math.PI * 2;
    if (gap <= Math.PI + 1e-6) continue;
    const A = at(w.u, h), B = at(nx.u, -h), far = h / Math.sin(gap / 2);
    const tip = { x: a.x + Math.cos(w.t + gap / 2) * far, y: a.y + Math.sin(w.t + gap / 2) * far };
    out.push({ kind: 'poly', pts: clockwise(far > 3 * h ? [a, A, B] : [a, A, tip, B]) });
  }
  return out;
}

/**
 * Where a highlight centred on double bonds runs instead of through each atom. Each bond's band
 * runs along a line moved off the bond by `shift` (midway between a double bond's two lines;
 * round a ring drawn with its double bonds inside, midway between the ring and those lines;
 * nothing for a plain single bond), and each atom moves to where its bonds' lines meet (the
 * nearest point to all of them, when they don't meet in one point). So a single bond between
 * two double bonds keeps its own line and the band's corners keep the bonds' angles. Atoms
 * whose bonds all stay put are not listed.
 */
export function centredSpots(lines: { p: Vec; q: Vec; shift: Vec }[]): Map<Vec, Vec> {
  type Acc = { xx: number; xy: number; yy: number; bx: number; by: number; sx: number; sy: number; n: number; moved: boolean };
  const acc = new Map<Vec, Acc>();
  for (const { p, q, shift } of lines) {
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    if (l < 1e-9) continue;
    // the line's normal, and a point on it
    const n = { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
    const moved = Math.hypot(shift.x, shift.y) > 1e-9;
    for (const a of [p, q]) {
      const o = { x: a.x + shift.x, y: a.y + shift.y };
      const k = n.x * o.x + n.y * o.y;
      let m = acc.get(a);
      if (!m) acc.set(a, (m = { xx: 0, xy: 0, yy: 0, bx: 0, by: 0, sx: 0, sy: 0, n: 0, moved: false }));
      m.xx += n.x * n.x; m.xy += n.x * n.y; m.yy += n.y * n.y;
      m.bx += n.x * k; m.by += n.y * k;
      m.sx += shift.x; m.sy += shift.y; m.n++;
      m.moved ||= moved;
    }
  }
  const out = new Map<Vec, Vec>();
  for (const [a, m] of acc) {
    if (!m.moved) continue;
    // lines that are (nearly) parallel don't meet: then a pull toward the atom, moved by its
    // bonds' average shift, keeps the point nearby
    const t = { x: a.x + m.sx / m.n, y: a.y + m.sy / m.n };
    const lam = m.xx * m.yy - m.xy * m.xy > 1e-3 ? 0 : 0.05;
    const xx = m.xx + lam, yy = m.yy + lam, xy = m.xy;
    const bx = m.bx + lam * t.x, by = m.by + lam * t.y;
    const det = xx * yy - xy * xy;
    out.set(a, Math.abs(det) < 1e-12 ? t : { x: (bx * yy - by * xy) / det, y: (by * xx - bx * xy) / det });
  }
  return out;
}

/** A piece's outline as points (arcs in steps short enough to look round close up). */
export function piecePoints(pc: Piece): Vec[] {
  const arc = (c: Vec, r: number, a0: number, a1: number, n: number) =>
    Array.from({ length: n + 1 }, (_, i) => { const t = a0 + ((a1 - a0) * i) / n; return { x: c.x + r * Math.cos(t), y: c.y + r * Math.sin(t) }; });
  if (pc.kind === 'poly') return pc.pts;
  const n = Math.max(24, Math.min(128, Math.ceil((2 * Math.PI * pc.r) / 0.6)));
  if (pc.kind === 'disc') return arc(pc.c, pc.r, 0, Math.PI * 2, n).slice(1);
  const a = Math.atan2(pc.q.y - pc.p.y, pc.q.x - pc.p.x), h = Math.ceil(n / 2);
  return [...arc(pc.q, pc.r, a - Math.PI / 2, a + Math.PI / 2, h), ...arc(pc.p, pc.r, a + Math.PI / 2, a + (3 * Math.PI) / 2, h)];
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
    if (v.shape === 'round' || v.shape === 'straight') out.shape = v.shape;
    // diamonds and squares (before straight highlights): straight, with pointed or square ends
    else if (v.shape === 'diamond' || v.shape === 'square') { out.shape = 'straight'; out.ends = v.shape === 'diamond' ? 'pointed' : 'square'; }
    if (v.ends === 'round' || v.ends === 'square' || v.ends === 'pointed') out.ends = v.ends;
    if (typeof v.size === 'number' && v.size > 0 && v.size <= 10) out.size = v.size;
    for (const k of ['fit', 'shadow', 'soft', 'smooth', 'centre', 'glow'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
    const o = out as Record<string, unknown>;
    const pick = (k: keyof HighlightStyle, ok: readonly string[]) => { if (typeof v[k] === 'string' && ok.includes(v[k] as string)) o[k] = v[k]; };
    pick('softSide', ['outer', 'inner', 'both']);
    pick('fill', ['solid', 'linear', 'edge', 'none']);
    pick('pattern', ['none', 'hatch', 'backhatch', 'crosshatch', 'horizontal', 'vertical', 'grid', 'dots', 'dense-dots']);
    pick('line', ['none', 'solid', 'dashed', 'dotted']);
    for (const k of ['colour2', 'patternColour', 'lineColour', 'shadowColour', 'glowColour'] as const) {
      if (typeof v[k] === 'string' && (v[k] === '' || /^#[0-9a-f]{6}$/i.test(v[k] as string))) o[k] = (v[k] as string).toLowerCase();
    }
    const num = (k: keyof HighlightStyle, lo: number, hi: number) => { const x = v[k]; if (typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi) o[k] = x; };
    num('softAmount', 0.01, 1); num('transparency', 0, 1); num('gradAngle', -360, 360); num('patternSize', 0, 50); num('lineWidth', 0.05, 20);
    num('shadowOpacity', 0, 1); num('shadowAngle', -360, 360); num('shadowDistance', 0, 5); num('shadowBlur', 0, 5);
    num('glowSize', 0, 5); num('glowTransparency', 0, 1);
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}
