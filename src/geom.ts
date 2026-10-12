// Small 2D vector helpers. Coordinates are in points (1/72 inch), y pointing down,
// the same convention as ChemDraw's CDXML files.

export interface Vec { x: number; y: number }

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const mul = (a: Vec, k: number): Vec => ({ x: a.x * k, y: a.y * k });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
export const perp = (a: Vec): Vec => ({ x: -a.y, y: a.x });
export const angleOf = (a: Vec): number => Math.atan2(a.y, a.x);
export const fromAngle = (ang: number, l = 1): Vec => ({ x: Math.cos(ang) * l, y: Math.sin(ang) * l });
export const lerp = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

export const DEG = Math.PI / 180;

/** Angle normalised to [0, 2π). */
export function normAngle(a: number): number {
  const t = a % (2 * Math.PI);
  return t < 0 ? t + 2 * Math.PI : t;
}

/** Snap an angle to the nearest multiple of `step` radians. */
export function snapAngle(a: number, step = 15 * DEG): number {
  return Math.round(a / step) * step;
}

/** Distance from point p to segment ab. */
export function distToSegment(p: Vec, a: Vec, b: Vec): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return dist(p, { x: a.x + ab.x * t, y: a.y + ab.y * t });
}

export interface Rect { x1: number; y1: number; x2: number; y2: number }

export function rectContains(r: Rect, p: Vec): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x1 <= b.x2 && a.x2 >= b.x1 && a.y1 <= b.y2 && a.y2 >= b.y1;
}

/**
 * Parameter t in [0,1] at which the segment a→b leaves rectangle r, when a is inside r.
 * Used to stop a bond at the edge of an atom label. Returns 0 if a is outside r.
 */
export function exitParam(a: Vec, b: Vec, r: Rect): number {
  if (!rectContains(r, a)) return 0;
  const d = sub(b, a);
  let t = 1;
  if (d.x > 0) t = Math.min(t, (r.x2 - a.x) / d.x);
  else if (d.x < 0) t = Math.min(t, (r.x1 - a.x) / d.x);
  if (d.y > 0) t = Math.min(t, (r.y2 - a.y) / d.y);
  else if (d.y < 0) t = Math.min(t, (r.y1 - a.y) / d.y);
  return Math.max(0, t);
}

/** Centre and radius of the circular arc from `tail` to `head` that turns through `sweep` radians. */
export function arcCenter(tail: Vec, head: Vec, sweep: number): { center: Vec; radius: number } {
  const chord = sub(head, tail);
  const c = len(chord);
  const radius = c / (2 * Math.sin(Math.abs(sweep) / 2));
  const mid = mul(add(tail, head), 0.5);
  const h = Math.sqrt(Math.max(0, radius * radius - (c / 2) * (c / 2)));
  const n = norm(perp(chord));
  const center = add(mid, mul(n, (sweep > 0 ? 1 : -1) * (Math.abs(sweep) > Math.PI ? -h : h)));
  return { center, radius };
}
