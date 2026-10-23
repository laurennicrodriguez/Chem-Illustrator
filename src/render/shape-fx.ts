// A design shape's Shape Effects as PowerPoint draws them: a glow round the outside, soft
// edges (the fill fading out toward the edge), a bevel (a light edge at the top left and a dark
// one at the bottom right) and a reflection below. Each is worked out as plain filled areas,
// so the screen, pictures, PDFs and the Word and PowerPoint copies all show the same thing.

import polygonClipping from 'polygon-clipping';
import type { Vec } from '../geom';
import type { BevelKind, Shape } from '../model';
import { clipHalf } from './fills';
import { minus, moveMP, polysMP, regionOf, rgba, type FxPaint, type MP } from './highlight-fx';

/** Eight ways round, for growing and shrinking an outline. */
const AROUND: Vec[] = Array.from({ length: 8 }, (_, i) => ({ x: Math.cos((i * Math.PI) / 4), y: Math.sin((i * Math.PI) / 4) }));

/**
 * The area grown by `g` all round (or taken in, for `g` less than 0): the area moved eight ways
 * by that much, joined (or overlapped), which follows any outline, not only round ones.
 */
export function offsetArea(area: MP, g: number): MP {
  if (!area.length || Math.abs(g) < 1e-6) return area;
  const moved = AROUND.map((d) => moveMP(area, { x: d.x * Math.abs(g), y: d.y * Math.abs(g) }));
  try {
    return g > 0 ? polygonClipping.union(area, ...moved) : polygonClipping.intersection(area, ...moved);
  } catch {
    return area;
  }
}

/** How a bevel of each kind lights up: the light and dark edges' strength, and how gently they fade inward (steps). */
const BEVEL_LOOK: Record<BevelKind, { light: number; dark: number; steps: number; inset?: boolean }> = {
  circle: { light: 0.5, dark: 0.3, steps: 6 },
  relaxedInset: { light: 0.35, dark: 0.22, steps: 6, inset: true },
  cross: { light: 0.45, dark: 0.35, steps: 2 },
  coolSlant: { light: 0.55, dark: 0.4, steps: 1 },
  angle: { light: 0.5, dark: 0.35, steps: 1 },
  softRound: { light: 0.4, dark: 0.25, steps: 8 },
  convex: { light: 0.55, dark: 0.35, steps: 4 },
  slope: { light: 0.45, dark: 0.3, steps: 1, inset: true },
  divot: { light: 0.35, dark: 0.35, steps: 3, inset: true },
  riblet: { light: 0.4, dark: 0.3, steps: 2 },
  hardEdge: { light: 0.6, dark: 0.45, steps: 1 },
  artDeco: { light: 0.45, dark: 0.35, steps: 3 },
};

export const BEVELS: { id: BevelKind; name: string }[] = [
  { id: 'circle', name: 'Round' }, { id: 'relaxedInset', name: 'Relaxed Inset' }, { id: 'cross', name: 'Cross' }, { id: 'coolSlant', name: 'Cool Slant' },
  { id: 'angle', name: 'Angle' }, { id: 'softRound', name: 'Soft Round' }, { id: 'convex', name: 'Convex' }, { id: 'slope', name: 'Slope' },
  { id: 'divot', name: 'Divot' }, { id: 'riblet', name: 'Riblet' }, { id: 'hardEdge', name: 'Hard Edge' }, { id: 'artDeco', name: 'Art Deco' },
];

/** Does the shape have any effect worked out here? */
export const hasShapeFx = (s: Shape): boolean => !!(s.glow || s.softEdge || s.bevel || s.reflection);

/** The effects drawn under a shape's fill (its reflection and glow), and its fill when it has soft edges, and the bevel drawn over the fill. */
export interface ShapeFxPaints { under: FxPaint[]; fill: FxPaint[] | null; over: FxPaint[] }

/**
 * A shape's effects as filled areas. `polys` is its outline (unturned), `colour` its fill
 * colour (a soft edge fades it out, the reflection is drawn in it).
 */
export function shapeFx(s: Shape, polys: Vec[][], colour: string): ShapeFxPaints {
  const out: ShapeFxPaints = { under: [], fill: null, over: [] };
  const area = polysMP(polys);
  if (!area.length) return out;
  const solid = 1 - Math.max(0, Math.min(1, s.transparency ?? 0));

  if (s.reflection && s.reflection.opacity > 0 && s.reflection.size > 0) {
    const r = s.reflection;
    let y1 = Infinity, y2 = -Infinity;
    for (const p of polys) for (const v of p) { y1 = Math.min(y1, v.y); y2 = Math.max(y2, v.y); }
    const h = y2 - y1, base = y2 + (r.dist ?? 0);
    // the shape upside down below its bottom edge, fading out over `size` of its height
    const flipped = polysMP(polys.map((p) => p.map((v) => ({ x: v.x, y: base + (y2 - v.y) })).reverse()));
    const n = 16, reach = h * Math.min(1, r.size);
    for (let i = 0; i < n; i++) {
      const a = base + (reach * i) / n, b = base + (reach * (i + 1)) / n + (i < n - 1 ? reach * 0.002 : 0);
      const region = regionOf(flipped).map((ring) => clipHalf(clipHalf(ring, { x: 0, y: 1 }, a), { x: 0, y: -1 }, -b)).filter((ring) => ring.length > 2);
      const alpha = r.opacity * solid * (1 - (i + 0.5) / n);
      if (region.length && alpha > 0.002) out.under.push({ region, colour: rgba(colour, alpha) });
    }
  }

  if (s.glow && s.glow.size > 0 && s.glow.transparency < 1) {
    const g = s.glow, n = 10;
    let inner = area;
    const rings: { area: MP; alpha: number }[] = [];
    for (let i = 1; i <= n; i++) {
      const outer = offsetArea(area, (g.size * i) / n);
      rings.push({ area: minus(outer, inner), alpha: (1 - g.transparency) * (1 - (i - 0.5) / n) ** 1.6 });
      inner = outer;
    }
    for (const r of rings.reverse()) {
      const region = regionOf(r.area);
      if (region.length && r.alpha > 0.002) out.under.push({ region, colour: rgba(g.color, r.alpha) });
    }
  }

  if (s.softEdge && s.softEdge > 0 && (s.filled || s.picFill)) {
    const n = 10, R = s.softEdge;
    out.fill = [];
    let outer = area;
    for (let i = 1; i <= n; i++) {
      const inner = offsetArea(area, -(R * i) / n);
      const region = regionOf(minus(outer, inner));
      const alpha = solid * ((i - 0.5) / n);
      if (region.length) out.fill.push({ region, colour: rgba(colour, alpha) });
      outer = inner;
    }
    const core = regionOf(outer);
    if (core.length) out.fill.push({ region: core, colour: rgba(colour, solid) });
  }

  if (s.bevel && s.bevel.w > 0) {
    const look = BEVEL_LOOK[s.bevel.kind] ?? BEVEL_LOOK.circle;
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    for (const p of polys) for (const v of p) { x1 = Math.min(x1, v.x); x2 = Math.max(x2, v.x); y1 = Math.min(y1, v.y); y2 = Math.max(y2, v.y); }
    const w = Math.min(s.bevel.w, (x2 - x1) / 2, (y2 - y1) / 2);
    // the edge splits at the line from bottom left to top right through the middle: light above it, dark below
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 }, k = ((x1 + x2) / 2) * d.x + ((y1 + y2) / 2) * d.y;
    let outer = area;
    for (let i = 1; i <= look.steps; i++) {
      const inner = offsetArea(area, -(w * i) / look.steps);
      const band = regionOf(minus(outer, inner));
      // strongest at the edge (or, set in, at the inside of the edge), fading across the bevel
      const t = look.steps === 1 ? 1 : look.inset ? i / look.steps : 1 - (i - 1) / look.steps;
      const top = band.map((r) => clipHalf(r, { x: -d.x, y: -d.y }, -k)).filter((r) => r.length > 2);
      const bottom = band.map((r) => clipHalf(r, d, k)).filter((r) => r.length > 2);
      const light = look.inset ? bottom : top, dark = look.inset ? top : bottom;
      if (light.length) out.over.push({ region: light, colour: rgba('#ffffff', look.light * t * solid) });
      if (dark.length) out.over.push({ region: dark, colour: rgba('#000000', look.dark * t * solid) });
      outer = inner;
    }
  }
  return out;
}

/** Ready-made glows (PowerPoint's Glow Variations): sizes in points and how see-through. */
export const GLOW_SIZES = [5, 8, 11, 18];
export const GLOW_TRANSPARENCY = 0.4;
export const SOFT_EDGES = [1, 2.5, 5, 10, 25, 50];

/** Ready-made reflections (PowerPoint's Reflection Variations). */
export const REFLECTIONS: { name: string; size: number; opacity: number; dist: number }[] = [
  { name: 'Tight Reflection: Touching', size: 0.35, opacity: 0.5, dist: 0 },
  { name: 'Half Reflection: Touching', size: 0.55, opacity: 0.5, dist: 0 },
  { name: 'Full Reflection: Touching', size: 0.9, opacity: 0.5, dist: 0 },
  { name: 'Tight Reflection: 4 pt offset', size: 0.35, opacity: 0.5, dist: 4 },
  { name: 'Half Reflection: 4 pt offset', size: 0.55, opacity: 0.5, dist: 4 },
  { name: 'Full Reflection: 4 pt offset', size: 0.9, opacity: 0.5, dist: 4 },
];
