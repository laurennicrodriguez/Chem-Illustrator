// The shapes of a highlight: under each atom a disc, diamond or square (grown round its label
// when asked), and under each bond a band with round, pointed or square ends. Every outline
// goes round the same way, so all of one highlight can be filled at once and overlaps don't
// show darker. Soft edges are rings of the same shapes, grown a little each time and faint.

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
    for (const k of ['fit', 'shadow', 'soft'] as const) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
    return Object.keys(out).length ? out : undefined;
  } catch {
    return undefined;
  }
}
