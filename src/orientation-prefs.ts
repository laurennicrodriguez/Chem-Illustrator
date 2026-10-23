// Finding your way round the endless drawing (Settings ▸ Navigation): a navigator map in a
// corner, arrows at the window's edge pointing to things scrolled out of sight, a faint dot grid
// behind the drawing, a faint tint outside what is drawn, and Fit and Go to Selection buttons
// in the status bar. Each can be switched off or changed. The sums the views use are here, apart
// from the screen, so they can be tested.

import type { Rect } from './geom';

export type Strength = 'faint' | 'light' | 'strong';

export interface OrientPrefs {
  /** A small map of the whole drawing in a corner, with a box for the part on screen. */
  navigator: boolean;
  navCorner: 'tl' | 'tr' | 'bl' | 'br';
  navSize: 'small' | 'medium' | 'large';
  /** Hide the navigator while the whole drawing is on screen. */
  navHideAll: boolean;
  /** Arrows at the window's edge toward things out of sight. */
  edgeArrows: boolean;
  /** What the arrows point to: structures only, or text, arrows and shapes too. */
  arrowsTo: 'structures' | 'everything';
  /** Faint dots behind the drawing (on screen only). */
  dotGrid: boolean;
  gridSpacing: 'fine' | 'normal' | 'wide';
  gridStrength: Strength;
  /** A faint tint on the empty space beyond everything drawn (on screen only). */
  tint: boolean;
  tintStrength: Strength;
  /** Fit and Go to Selection buttons in the status bar. */
  goButtons: boolean;
}

export const DEFAULT_ORIENT: OrientPrefs = {
  navigator: true, navCorner: 'br', navSize: 'medium', navHideAll: false,
  edgeArrows: true, arrowsTo: 'structures',
  dotGrid: false, gridSpacing: 'normal', gridStrength: 'light',
  tint: false, tintStrength: 'light',
  goButtons: true,
};

const CHOICES: { [K in keyof OrientPrefs]?: readonly string[] } = {
  navCorner: ['tl', 'tr', 'bl', 'br'], navSize: ['small', 'medium', 'large'], arrowsTo: ['structures', 'everything'],
  gridSpacing: ['fine', 'normal', 'wide'], gridStrength: ['faint', 'light', 'strong'], tintStrength: ['faint', 'light', 'strong'],
};

/** The settings as saved, with anything missing or not understood left at its default. */
export function parseOrient(raw: unknown): OrientPrefs {
  const out: OrientPrefs = { ...DEFAULT_ORIENT };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const o = out as unknown as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_ORIENT) as (keyof OrientPrefs)[]) {
    const v = r[k], allowed = CHOICES[k];
    if (allowed ? typeof v === 'string' && allowed.includes(v) : typeof v === 'boolean') o[k] = v;
  }
  return out;
}

/** Navigator sizes in CSS pixels. */
export const NAV_SIZES: Record<OrientPrefs['navSize'], { w: number; h: number }> = {
  small: { w: 150, h: 104 }, medium: { w: 210, h: 146 }, large: { w: 290, h: 200 },
};

/** Grid spacing in points before it is spread out for zooming out (a quarter, half and whole inch). */
export const GRID_SPACING: Record<OrientPrefs['gridSpacing'], number> = { fine: 18, normal: 36, wide: 72 };

/** How dark the grid's dots and the outside tint are. */
export const GRID_ALPHA: Record<Strength, number> = { faint: 0.16, light: 0.28, strong: 0.45 };
export const TINT_ALPHA: Record<Strength, number> = { faint: 0.025, light: 0.045, strong: 0.075 };

/** The grid's step in points at a zoom: the set spacing, doubled until the dots are at least `minPx` apart on screen. */
export function gridStep(base: number, scale: number, minPx = 12): number {
  let step = base;
  if (!(scale > 0) || !(base > 0)) return base;
  while (step * scale < minPx) step *= 2;
  return step;
}

/** The part of the drawing on screen, in points. */
export function seenRect(view: { ox: number; oy: number; scale: number }, w: number, h: number): Rect {
  return { x1: -view.ox / view.scale, y1: -view.oy / view.scale, x2: (w - view.ox) / view.scale, y2: (h - view.oy) / view.scale };
}

export function overlaps(a: Rect, b: Rect): boolean {
  return a.x1 <= b.x2 && b.x1 <= a.x2 && a.y1 <= b.y2 && b.y1 <= a.y2;
}

export function inside(a: Rect, b: Rect): boolean {
  return a.x1 >= b.x1 && a.y1 >= b.y1 && a.x2 <= b.x2 && a.y2 <= b.y2;
}

export function union(a: Rect, b: Rect): Rect {
  return { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) };
}

/**
 * Where on the window's edge an arrow to a point off screen goes: where the line from the
 * window's middle to the point leaves a box `inset` px in from the edges. Screen pixels; the
 * angle is the way the arrow points (radians, 0 = right, y down).
 */
export function edgeSpot(w: number, h: number, inset: number, to: { x: number; y: number }): { x: number; y: number; angle: number } {
  const cx = w / 2, cy = h / 2;
  const dx = to.x - cx, dy = to.y - cy;
  const angle = Math.atan2(dy, dx);
  const hw = Math.max(1, w / 2 - inset), hh = Math.max(1, h / 2 - inset);
  // how far along the line the box's edge is
  const t = Math.min(dx ? hw / Math.abs(dx) : Infinity, dy ? hh / Math.abs(dy) : Infinity);
  if (!isFinite(t)) return { x: cx, y: cy, angle };
  return { x: cx + dx * t, y: cy + dy * t, angle };
}

export interface EdgeMark<T> { x: number; y: number; angle: number; items: T[]; /** The item nearest the window. */ nearest: T }

/**
 * Arrows to the things off screen, those close together on the edge joined into one with a count.
 * `boxes` are in points; the arrows are in screen pixels.
 */
export function edgeMarks<T>(things: { box: Rect; item: T }[], view: { ox: number; oy: number; scale: number }, w: number, h: number, avoid: Rect | null = null, inset = 22, join = 26): EdgeMark<T>[] {
  const seen = seenRect(view, w, h);
  const cx = (seen.x1 + seen.x2) / 2, cy = (seen.y1 + seen.y2) / 2;
  const spots: { x: number; y: number; angle: number; item: T; dist: number }[] = [];
  for (const t of things) {
    if (overlaps(t.box, seen)) continue;
    // aim at the nearest point of its box, so a long structure just off screen points straight across
    const px = Math.max(t.box.x1, Math.min(cx, t.box.x2)), py = Math.max(t.box.y1, Math.min(cy, t.box.y2));
    const sx = px * view.scale + view.ox, sy = py * view.scale + view.oy;
    const s = edgeSpot(w, h, inset, { x: sx, y: sy });
    const at = avoid ? clearOf(s.x, s.y, avoid, w, h) : s;
    spots.push({ ...s, ...at, item: t.item, dist: Math.hypot(px - cx, py - cy) });
  }
  spots.sort((a, b) => a.dist - b.dist);
  const marks: (EdgeMark<T> & { n: number })[] = [];
  for (const s of spots) {
    const m = marks.find((k) => Math.hypot(k.x - s.x, k.y - s.y) < join);
    if (m) { m.items.push(s.item); continue; }
    marks.push({ x: s.x, y: s.y, angle: s.angle, items: [s.item], nearest: s.item, n: 1 });
  }
  return marks;
}

/** An arrow that would sit under `a` (the navigator) moves along its edge of the window to just clear it. */
export function clearOf(x: number, y: number, a: Rect, w: number, h: number, gap = 14): { x: number; y: number } {
  if (x < a.x1 - gap || x > a.x2 + gap || y < a.y1 - gap || y > a.y2 + gap) return { x, y };
  // on the left or right edge it moves up or down; on the top or bottom, sideways
  const side = Math.min(x, w - x) < Math.min(y, h - y);
  if (side) return { x, y: a.y1 > h / 2 ? a.y1 - gap : a.y2 + gap };
  return { x: a.x1 > w / 2 ? a.x1 - gap : a.x2 + gap, y };
}

/** Map a box of the drawing into a w × h space, whole and centred: the scale and offset (screen = p × k + o). */
export function fitInto(box: Rect, w: number, h: number, pad = 6): { k: number; ox: number; oy: number } {
  const bw = Math.max(1e-6, box.x2 - box.x1), bh = Math.max(1e-6, box.y2 - box.y1);
  const k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  return { k, ox: w / 2 - ((box.x1 + box.x2) / 2) * k, oy: h / 2 - ((box.y1 + box.y2) / 2) * k };
}
