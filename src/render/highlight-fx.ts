// A highlight's effects: soft edges, gradients, a texture, an outline, a glow and a blurred
// shadow. A soft edge, a glow or a blur is a run of steps, each the highlight's outline at
// another size (shrunk toward its bonds, or grown past its edge), largest first, each showing
// inside it until the next one: so a step's colour and see-through amount hold in the ring
// between it and the next step. On screen each step is filled over the last after clearing
// what it covers (on a spare canvas), which is quick. In pictures, SVG, the Word and PowerPoint
// copies and PDFs, which have no gradients or clipping of their own, each ring is worked out
// as a plain filled area, its pieces joined into one (polygon-clipping).

import polygonClipping from 'polygon-clipping';
import type { Vec } from '../geom';
import type { HighlightStyle } from '../model';
import { piecePoints, type Piece } from './highlight';
import { clipHalf, dotCentres, hatchLines, mix, patternAngles } from './fills';

/** An area as outlines: outer edges one way round and holes the other, so a nonzero fill shows it. */
export type Region = Vec[][];

/** Part of a highlight filled in one colour (with its see-through amount, as rgba). */
export interface FxPaint { region: Region; colour: string }

/** A gradient across a highlight: its direction in degrees and two colours. */
export interface FxGradient { angle: number; from: string; to: string }

/**
 * One step: the highlight's outline at `t` times its size (shrunk toward its bonds) and widened
 * by `grow`, filled with `colour` (or a gradient) `alpha` solid, out to the next larger step.
 */
export interface FxStep { t: number; grow: number; colour: string | FxGradient; alpha: number }

/** Steps that go together (largest first), moved by `move` (a shadow); `cut` clears the highlight itself out of them at the end. */
export interface FxLayer { steps: FxStep[]; move?: Vec; cut?: boolean }

/** Everything a highlight with effects draws: its shadow, its glow and fill, its texture and outline. */
export interface HighlightFx {
  shadow: FxLayer | null;
  body: FxLayer | null;
  pattern: { kind: 'lines'; angles: number[]; gap: number; width: number; colour: string } | { kind: 'dots'; gap: number; r: number; colour: string } | null;
  outline: { colour: string; width: number; dash: number[]; round: boolean } | null;
}

export type MP = polygonClipping.MultiPolygon;

/** Does this look need its effects worked out (rather than its pieces just filled)? */
export function needsFx(s: Required<HighlightStyle>): boolean {
  return s.soft || s.glow || s.fill !== 'solid' || s.pattern !== 'none' || s.line !== 'none' || (s.shadow && (s.shadowBlur > 0 || s.transparency > 0));
}

/** A colour with a see-through amount (0 clear to 1 solid), as rgba. */
export function rgba(hex: string, a: number): string {
  if (a >= 1) return hex;
  const v = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(v >> 16) & 255},${(v >> 8) & 255},${v & 255},${Math.max(0, Math.round(a * 1000) / 1000)})`;
}

/** How solid a soft highlight is at `t` of the way out from its bonds (0) to its edge (1). */
export function softAlpha(t: number, amount: number, side: Required<HighlightStyle>['softSide']): number {
  const outer = (a: number) => (a <= 0 || t <= 1 - a ? 1 : 0.5 * (1 + Math.cos(Math.PI * Math.min(1, (t - (1 - a)) / a))));
  const inner = (a: number) => (a <= 0 || t >= a ? 1 : 0.5 * (1 - Math.cos((Math.PI * Math.max(0, t)) / a)));
  if (side === 'outer') return outer(amount);
  if (side === 'inner') return inner(amount);
  return Math.min(outer(amount / 2), inner(amount / 2));
}

/** Where a soft or edge-gradient fill steps (out from the bonds, 0 to 1; 1 is the edge). */
export function fillSteps(s: Required<HighlightStyle>): number[] {
  const n = 16;
  const at = new Set<number>([1]);
  const zone = (z0: number, z1: number) => { for (let i = 0; i <= n; i++) at.add(Math.round((z0 + ((z1 - z0) * i) / n) * 1e6) / 1e6); };
  if (s.fill === 'edge') zone(0, 1);
  if (s.soft) {
    const a = Math.max(0.01, Math.min(1, s.softAmount));
    if (s.softSide === 'outer') zone(1 - a, 1);
    else if (s.softSide === 'inner') zone(0, a);
    else { zone(0, a / 2); zone(1 - a / 2, 1); }
  }
  at.delete(0);
  return [...at].sort((x, y) => y - x);
}

/**
 * A highlight's effects, in `colour`. `L` is a bond length times the highlight's size (the
 * effects' sizes are parts of it).
 */
export function highlightFx(s: Required<HighlightStyle>, colour: string, L: number): HighlightFx {
  const solid = 1 - Math.max(0, Math.min(1, s.transparency));
  const fx: HighlightFx = { shadow: null, body: null, pattern: null, outline: null };

  if (s.shadow && s.shadowOpacity > 0) {
    const a = (s.shadowAngle * Math.PI) / 180, d = s.shadowDistance * L, B = s.shadowBlur * L;
    const steps: FxStep[] = [];
    if (B <= 0) steps.push({ t: 1, grow: 0, colour: s.shadowColour, alpha: s.shadowOpacity });
    else {
      // fading out from solid at half the blur inside the edge to clear at half the blur outside it
      const n = 12;
      for (let i = n; i >= 0; i--) steps.push({ t: 1, grow: -B / 2 + (B * i) / n, colour: s.shadowColour, alpha: s.shadowOpacity * (i ? 0.5 * (1 + Math.cos((Math.PI * (i - 0.5)) / n)) : 1) });
    }
    // a see-through highlight shows only the part of its shadow that sticks out
    fx.shadow = { steps, move: { x: Math.cos(a) * d, y: Math.sin(a) * d }, cut: s.fill === 'none' || s.transparency > 0 };
  }

  const steps: FxStep[] = [];
  if (s.glow && s.glowSize > 0 && s.glowTransparency < 1) {
    const n = 12, G = s.glowSize * L, c = s.glowColour || colour;
    for (let i = n; i >= 1; i--) steps.push({ t: 1, grow: (G * i) / n, colour: c, alpha: (1 - s.glowTransparency) * (1 - (i - 0.5) / n) ** 2 });
  }
  if (s.fill === 'none' || solid <= 0) {
    if (steps.length) steps.push({ t: 1, grow: 0, colour, alpha: 0 });
  } else {
    const c2 = s.colour2 || '#ffffff';
    const at = fillSteps(s);
    at.forEach((t, i) => {
      // each ring's look is taken at its middle
      const mid = (t + (at[i + 1] ?? 0)) / 2;
      const alpha = (s.soft ? softAlpha(mid, s.softAmount, s.softSide) : 1) * solid;
      const col: FxStep['colour'] = s.fill === 'linear' ? { angle: s.gradAngle, from: colour, to: c2 } : s.fill === 'edge' ? mix(colour, c2, mid) : colour;
      const last = steps[steps.length - 1];
      // a ring that looks like the one outside it is part of it
      if (last && last.grow === 0 && Math.abs(last.alpha - alpha) < 1e-3 && JSON.stringify(last.colour) === JSON.stringify(col)) return;
      steps.push({ t, grow: 0, colour: col, alpha });
    });
  }
  if (steps.length) fx.body = { steps };

  if (s.pattern !== 'none' && solid > 0) {
    const dots = s.pattern === 'dots' || s.pattern === 'dense-dots';
    const gap = s.patternSize > 0 ? s.patternSize : L * (s.pattern === 'dense-dots' ? 0.09 : dots ? 0.12 : 0.14);
    const ink = rgba(s.patternColour || mix(colour, '#000000', 0.45), solid);
    fx.pattern = dots
      ? { kind: 'dots', gap, r: Math.max(0.2, gap * (s.pattern === 'dense-dots' ? 0.24 : 0.2)), colour: ink }
      : { kind: 'lines', angles: patternAngles(s.pattern), gap, width: Math.max(0.2, Math.min(gap * 0.16, 0.7)), colour: ink };
  }
  if (s.line !== 'none') {
    const w = s.lineWidth;
    fx.outline = { colour: s.lineColour || mix(colour, '#000000', 0.35), width: w, dash: s.line === 'dashed' ? [w * 4, w * 2.5] : s.line === 'dotted' ? [0.01, w * 2] : [], round: s.line === 'dotted' };
  }
  return fx;
}

// ------------------------------------------------------------------ worked out as areas

export const ring = (pts: Vec[]): [number, number][] => {
  const r = pts.map((p): [number, number] => [p.x, p.y]);
  if (r.length) r.push(r[0]);
  return r;
};

/** The pieces joined into one area (with holes where they go round a ring). */
export function unionOf(pieces: Piece[]): MP {
  const polys = pieces.map((p) => piecePoints(p)).filter((p) => p.length > 2).map((p): polygonClipping.Polygon => [ring(p)]);
  if (!polys.length) return [];
  try {
    return polygonClipping.union(polys[0], ...polys.slice(1));
  } catch {
    // (very rarely the joining fails on awkward shapes: then each piece on its own)
    return polys;
  }
}

export function minus(a: MP, b: MP): MP {
  if (!a.length || !b.length) return a;
  try {
    return polygonClipping.difference(a, b);
  } catch {
    return a;
  }
}

/** An area as outlines to fill. */
export function regionOf(mp: MP): Region {
  return mp.flatMap((poly) => poly.map((r) => r.slice(0, -1).map(([x, y]) => ({ x, y }))));
}

export const moveMP = (mp: MP, d: Vec | undefined): MP => (d ? mp.map((poly) => poly.map((r) => r.map(([x, y]): [number, number] => [x + d.x, y + d.y]))) : mp);

/**
 * A layer's rings as plain filled areas (for pictures and copies). `level(t, grow)` is the
 * highlight's pieces joined at that size; `span` is the whole highlight (a gradient runs
 * across it).
 */
export function layerPaints(layer: FxLayer, level: (t: number, grow: number) => MP, span: Region): FxPaint[] {
  const out: FxPaint[] = [];
  const full = layer.cut ? level(1, 0) : [];
  layer.steps.forEach((st, i) => {
    if (st.alpha <= 0.002) return;
    const next = layer.steps[i + 1];
    let area = moveMP(level(st.t, st.grow), layer.move);
    if (next) area = minus(area, moveMP(level(next.t, next.grow), layer.move));
    if (layer.cut) area = minus(area, full);
    const region = regionOf(area);
    if (!region.length) return;
    if (typeof st.colour === 'string') out.push({ region, colour: rgba(st.colour, st.alpha) });
    else out.push(...bands(region, span, st.colour, st.alpha));
  });
  return out;
}

/** A pattern's lines or dots inside an area (for pictures and copies). */
export function patternMarks(p: NonNullable<HighlightFx['pattern']>, region: Region): { lines: [Vec, Vec][] } | { dots: Vec[] } {
  return p.kind === 'dots' ? { dots: dotCentres(region, p.gap) } : { lines: p.angles.flatMap((a) => hatchLines(region, a, p.gap)) };
}

/** An area cut into bands across it, coloured from one colour to the other across `span`. */
function bands(area: Region, span: Region, g: FxGradient, alpha: number, steps = 32): FxPaint[] {
  const a = (g.angle * Math.PI) / 180, d = { x: Math.cos(a), y: Math.sin(a) };
  const [lo, hi] = extent(span, d);
  if (!(hi > lo)) return [{ region: area, colour: rgba(g.from, alpha) }];
  const out: FxPaint[] = [];
  for (let i = 0; i < steps; i++) {
    const k1 = lo + ((hi - lo) * i) / steps, k2 = lo + ((hi - lo) * (i + 1)) / steps + (i < steps - 1 ? (hi - lo) * 0.002 : 0);
    // each outline cut on its own keeps its way round, so holes stay clear
    const region = area.map((r) => clipHalf(clipHalf(r, d, k1), { x: -d.x, y: -d.y }, -k2)).filter((r) => r.length > 2);
    if (region.length) out.push({ region, colour: rgba(mix(g.from, g.to, i / (steps - 1)), alpha) });
  }
  return out;
}

/** How far an area reaches along a direction, both ways. */
export function extent(r: Region, d: Vec): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const ring of r) for (const v of ring) { const k = v.x * d.x + v.y * d.y; lo = Math.min(lo, k); hi = Math.max(hi, k); }
  return [lo, hi];
}

// ------------------------------------------------------------------ shapes' shadows

/** How a ring fill's or design shape's shadow looks. */
export interface ShadowLook { colour: string; opacity: number; angle: number; distance: number; blur: number }

/** Polygons grown by about `g` all round (taken in when `g` is less than 0), each about its own middle. */
function grown(polys: Vec[][], g: number): Vec[][] {
  return polys.map((pts) => {
    const n = pts.length;
    const c = { x: pts.reduce((t, p) => t + p.x, 0) / n, y: pts.reduce((t, p) => t + p.y, 0) / n };
    let r = 0;
    for (let i = 0; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; r += Math.hypot((a.x + b.x) / 2 - c.x, (a.y + b.y) / 2 - c.y); }
    r /= n;
    const k = r > 0 ? Math.max(0, (r + g) / r) : 1;
    return pts.map((p) => ({ x: c.x + (p.x - c.x) * k, y: c.y + (p.y - c.y) * k }));
  });
}

export const polysMP = (polys: Vec[][]): MP => {
  const ps = polys.filter((p) => p.length > 2).map((p): polygonClipping.Polygon => [ring(p)]);
  if (!ps.length) return [];
  try { return polygonClipping.union(ps[0], ...ps.slice(1)); } catch { return ps; }
};

/**
 * A shape's drop shadow as filled areas: the shape's outline moved, blurred by fading out over
 * `blur` (half inside the edge, half outside), and, when `cut`, only where it sticks out past the
 * shape (so a see-through fill shows nothing under it).
 */
export function shapeShadow(polys: Vec[][], look: ShadowLook, cut: boolean): FxPaint[] {
  if (!polys.length || look.opacity <= 0) return [];
  const a = (look.angle * Math.PI) / 180, d = { x: Math.cos(a) * look.distance, y: Math.sin(a) * look.distance };
  const shape = cut ? polysMP(polys) : [];
  const at = (g: number) => moveMP(polysMP(g ? grown(polys, g) : polys), d);
  const out: FxPaint[] = [];
  const push = (mp: MP, alpha: number) => { const r = regionOf(cut ? minus(mp, shape) : mp); if (r.length) out.push({ region: r, colour: rgba(look.colour, alpha) }); };
  if (look.blur <= 0) { push(at(0), look.opacity); return out; }
  const n = 10, B = look.blur;
  for (let i = n; i >= 0; i--) {
    const here = at(-B / 2 + (B * i) / n);
    const k = i ? 0.5 * (1 + Math.cos((Math.PI * (i - 0.5)) / n)) : 1;
    push(i ? minus(here, at(-B / 2 + (B * (i - 1)) / n)) : here, look.opacity * k);
  }
  return out;
}
