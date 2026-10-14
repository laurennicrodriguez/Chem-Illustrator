// Patterned and gradient fills: hatching and stippling (as in bar and pie charts printed in
// black and white), and gradients. Everything is worked out as plain lines, dots and bands
// inside the shape's outline, so pictures, SVG, the Word/PowerPoint copy and PDFs all show the
// same as the screen without needing patterns or clipping of their own.

import type { Pattern, Shape } from '../model';
import type { Vec } from '../geom';
import { flatten, geoDef, moveSteps } from '../design/geo';

export const PATTERNS: [Pattern, string][] = [
  ['hatch', 'Diagonal lines ////'], ['backhatch', 'Diagonal lines \\\\\\\\'], ['crosshatch', 'Cross-hatch'],
  ['horizontal', 'Horizontal lines'], ['vertical', 'Vertical lines'], ['grid', 'Grid'],
  ['dots', 'Dots (stippling)'], ['dense-dots', 'Dense dots'],
];

/** The pattern's line angles in degrees (0 across, 90 down the page; y points down). */
export function patternAngles(p: Pattern): number[] {
  switch (p) {
    case 'hatch': return [-45];
    case 'backhatch': return [45];
    case 'crosshatch': return [45, -45];
    case 'horizontal': return [0];
    case 'vertical': return [90];
    case 'grid': return [0, 90];
    default: return [];
  }
}

/** Line spacing (or dot spacing) in points, when the shape doesn't give its own. */
export function patternSpacing(s: Pick<Shape, 'pattern' | 'patternSize'>): number {
  if (s.patternSize && s.patternSize > 0) return s.patternSize;
  return s.pattern === 'dense-dots' ? 1.6 : s.pattern === 'dots' ? 2.6 : 3;
}

/** A shape's outline as closed polygons, for patterns and gradients (rings use their atoms' places). */
export function shapePolygons(s: Shape, ringPts?: Vec[]): Vec[][] {
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
  switch (s.kind) {
    case 'ring': {
      const pts = ringPts ?? s.poly ?? [];
      return pts.length > 2 ? [pts] : [];
    }
    case 'oval': {
      const n = 64;
      return [Array.from({ length: n }, (_, i) => ({ x: x + w / 2 + (w / 2) * Math.cos((2 * Math.PI * i) / n), y: y + h / 2 + (h / 2) * Math.sin((2 * Math.PI * i) / n) }))];
    }
    case 'geo':
      return flatten(moveSteps(geoDef(s.geo).draw(w, h).body, x, y)).filter((p) => p.length > 2);
    case 'rect': {
      const r = s.rounded ? Math.min(s.radius ?? 3, w / 2, h / 2) : 0;
      if (!r) return [[{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]];
      const pts: Vec[] = [];
      const corner = (cx: number, cy: number, a0: number) => { for (let i = 0; i <= 6; i++) { const a = a0 + (i / 6) * (Math.PI / 2); pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) }); } };
      corner(x + w - r, y + r, -Math.PI / 2);
      corner(x + w - r, y + h - r, 0);
      corner(x + r, y + h - r, Math.PI / 2);
      corner(x + r, y + r, Math.PI);
      return [pts];
    }
    default:
      return [];
  }
}

function bounds(polys: Vec[][]): { x1: number; y1: number; x2: number; y2: number } {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of polys) for (const v of p) { x1 = Math.min(x1, v.x); y1 = Math.min(y1, v.y); x2 = Math.max(x2, v.x); y2 = Math.max(y2, v.y); }
  return { x1, y1, x2, y2 };
}

/**
 * Parallel lines at `angle` degrees, `gap` apart, cut to the inside of the polygons (even-odd,
 * so holes stay clear). The lines are lined up on the page, not on the shape, so neighbouring
 * shapes with the same pattern match.
 */
export function hatchLines(polys: Vec[][], angle: number, gap: number): [Vec, Vec][] {
  if (!polys.length || gap <= 0) return [];
  const a = (angle * Math.PI) / 180;
  // d runs along the lines, n across them
  const d = { x: Math.cos(a), y: Math.sin(a) }, n = { x: -Math.sin(a), y: Math.cos(a) };
  let lo = Infinity, hi = -Infinity;
  for (const p of polys) for (const v of p) { const k = v.x * n.x + v.y * n.y; lo = Math.min(lo, k); hi = Math.max(hi, k); }
  const out: [Vec, Vec][] = [];
  if (hi - lo > gap * 4000) return out;
  for (let k = Math.ceil(lo / gap) * gap; k <= hi; k += gap) {
    // where the line n·p = k crosses each edge, as a distance along d
    const ts: number[] = [];
    for (const p of polys) {
      for (let i = 0; i < p.length; i++) {
        const u = p[i], v = p[(i + 1) % p.length];
        const ku = u.x * n.x + u.y * n.y - k, kv = v.x * n.x + v.y * n.y - k;
        if ((ku > 0) === (kv > 0)) continue;
        const t = ku / (ku - kv);
        const q = { x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t };
        ts.push(q.x * d.x + q.y * d.y);
      }
    }
    ts.sort((x, y) => x - y);
    for (let i = 0; i + 1 < ts.length; i += 2) {
      if (ts[i + 1] - ts[i] < 1e-6) continue;
      const at = (t: number) => ({ x: n.x * k + d.x * t, y: n.y * k + d.y * t });
      out.push([at(ts[i]), at(ts[i + 1])]);
    }
  }
  return out;
}

function inside(polys: Vec[][], p: Vec): boolean {
  let c = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
  }
  return c;
}

/** Dots on a staggered grid `gap` apart, inside the polygons (stippling). */
export function dotCentres(polys: Vec[][], gap: number): Vec[] {
  if (!polys.length || gap <= 0) return [];
  const b = bounds(polys);
  const out: Vec[] = [];
  const rowGap = gap * 0.866;
  if ((b.x2 - b.x1) * (b.y2 - b.y1) / (gap * rowGap) > 200000) return out;
  for (let row = Math.ceil(b.y1 / rowGap); row * rowGap <= b.y2; row++) {
    const y = row * rowGap;
    const shift = (row & 1) * gap / 2;
    for (let x = Math.ceil((b.x1 - shift) / gap) * gap + shift; x <= b.x2; x += gap) if (inside(polys, { x, y })) out.push({ x, y });
  }
  return out;
}

/** Cut a polygon to the side of a line where n·p ≥ k (Sutherland–Hodgman, one edge). */
function clipHalf(poly: Vec[], n: Vec, k: number): Vec[] {
  const out: Vec[] = [];
  for (let i = 0; i < poly.length; i++) {
    const u = poly[i], v = poly[(i + 1) % poly.length];
    const ku = u.x * n.x + u.y * n.y - k, kv = v.x * n.x + v.y * n.y - k;
    if (ku >= 0) out.push(u);
    if ((ku >= 0) !== (kv >= 0)) { const t = ku / (ku - kv); out.push({ x: u.x + (v.x - u.x) * t, y: u.y + (v.y - u.y) * t }); }
  }
  return out;
}

/** A colour part of the way from a to b (#rrggbb). */
export function mix(a: string, b: string, t: number): string {
  const p = (c: string) => { const v = parseInt(c.replace('#', ''), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const x = p(a), y = p(b);
  return '#' + x.map((c, i) => Math.round(c + (y[i] - c) * t).toString(16).padStart(2, '0')).join('');
}

/**
 * A linear gradient as `steps` bands across the polygons, each band a polygon with its colour
 * (for pictures and copies that can't hold a gradient of their own).
 */
export function gradientBands(polys: Vec[][], angle: number, from: string, to: string, steps = 48): { poly: Vec[]; color: string }[] {
  if (!polys.length) return [];
  const a = (angle * Math.PI) / 180;
  const d = { x: Math.cos(a), y: Math.sin(a) };
  let lo = Infinity, hi = -Infinity;
  for (const p of polys) for (const v of p) { const k = v.x * d.x + v.y * d.y; lo = Math.min(lo, k); hi = Math.max(hi, k); }
  const out: { poly: Vec[]; color: string }[] = [];
  const span = hi - lo;
  if (span <= 0) return out;
  for (let i = 0; i < steps; i++) {
    const k1 = lo + (span * i) / steps, k2 = lo + (span * (i + 1)) / steps;
    // each band overlaps the next a little, so no hairline shows between them
    const over = i < steps - 1 ? span * 0.002 : 0;
    const color = mix(from, to, steps > 1 ? i / (steps - 1) : 0);
    for (const p of polys) {
      const band = clipHalf(clipHalf(p, d, k1), { x: -d.x, y: -d.y }, -(k2 + over));
      if (band.length > 2) out.push({ poly: band, color });
    }
  }
  return out;
}

/** Cut a polygon to the inside of a convex polygon (each edge in turn). */
function clipConvex(poly: Vec[], convex: Vec[]): Vec[] {
  // which way round the convex polygon goes decides which side of each edge is inside
  let area = 0;
  for (let i = 0; i < convex.length; i++) { const u = convex[i], v = convex[(i + 1) % convex.length]; area += u.x * v.y - v.x * u.y; }
  const sgn = area > 0 ? 1 : -1;
  let out = poly;
  for (let i = 0; i < convex.length && out.length > 2; i++) {
    const u = convex[i], v = convex[(i + 1) % convex.length];
    const n = { x: -(v.y - u.y) * sgn, y: (v.x - u.x) * sgn };
    out = clipHalf(out, n, n.x * u.x + n.y * u.y);
  }
  return out;
}

/** A gradient out from the middle as rings of colour, the fill colour in the middle (`steps` of them, largest first). */
export function radialBands(polys: Vec[][], from: string, to: string, steps = 32): { poly: Vec[]; color: string }[] {
  if (!polys.length) return [];
  const b = bounds(polys);
  const cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, rx = ((b.x2 - b.x1) / 2) * Math.SQRT2, ry = ((b.y2 - b.y1) / 2) * Math.SQRT2;
  const out: { poly: Vec[]; color: string }[] = [];
  for (let i = steps - 1; i >= 0; i--) {
    const f = (i + 1) / steps;
    const ell = Array.from({ length: 48 }, (_, j) => ({ x: cx + rx * f * Math.cos((2 * Math.PI * j) / 48), y: cy + ry * f * Math.sin((2 * Math.PI * j) / 48) }));
    const color = mix(from, to, i / Math.max(1, steps - 1));
    for (const p of polys) {
      const piece = clipConvex(p, ell);
      if (piece.length > 2) out.push({ poly: piece, color });
    }
  }
  return out;
}

/**
 * A ring's corners drawn in towards its middle so its edges move in by about `d` (the space a
 * ring's pattern keeps from its bonds). A ring too small for that shrinks to a point.
 */
export function insetPolygon(pts: Vec[], d: number): Vec[] {
  const n = pts.length;
  if (n < 3) return pts;
  const c = { x: pts.reduce((t, p) => t + p.x, 0) / n, y: pts.reduce((t, p) => t + p.y, 0) / n };
  // how far the edges are from the middle, on average
  let r = 0;
  for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; r += Math.hypot((a.x + b.x) / 2 - c.x, (a.y + b.y) / 2 - c.y); }
  r /= n;
  const k = r > d ? (r - d) / r : 0;
  return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
}

/** Is this fill one of the patterns drawn as dots? */
export const isDotPattern = (p: Pattern | undefined) => p === 'dots' || p === 'dense-dots';
