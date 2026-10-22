// Orient Like: turning (and if need be turning over) a structure so the part it shares with
// another lies the same way round. The best turn is found by least squares (the 2-D case of the
// Kabsch method); turning over is tried too, and taken only when it fits clearly better. A
// structure turned over has its wedges and hashes swapped, so its configuration is kept.

import type { Vec } from '../geom';

export interface Fit {
  /** Turn over (left to right) before turning. */
  mirror: boolean;
  /** Turn, in radians, anticlockwise on the page's numbers (x right, y down). */
  angle: number;
  /** How far the shared atoms then are from where the reference has them, on average (root mean square). */
  rms: number;
}

const centre = (ps: Vec[]): Vec => {
  let x = 0, y = 0;
  for (const p of ps) { x += p.x; y += p.y; }
  return { x: x / ps.length, y: y / ps.length };
};

/** The best turn taking `from` onto `to` (pairs of points, each set about its own middle), with or without turning over. */
export function bestFit(from: Vec[], to: Vec[]): Fit | null {
  if (from.length < 2 || from.length !== to.length) return null;
  const cf = centre(from), ct = centre(to);
  const a = from.map((p) => ({ x: p.x - cf.x, y: p.y - cf.y }));
  const b = to.map((p) => ({ x: p.x - ct.x, y: p.y - ct.y }));
  const scaleOf = (ps: Vec[]) => Math.sqrt(ps.reduce((s, p) => s + p.x * p.x + p.y * p.y, 0) / ps.length) || 1;
  // compare shapes, not sizes (a structure drawn at another bond length still fits)
  const k = scaleOf(b) / scaleOf(a);
  const fit = (mirror: boolean): Fit => {
    const src = a.map((p) => ({ x: (mirror ? -p.x : p.x) * k, y: p.y * k }));
    let sxx = 0, sxy = 0;
    src.forEach((p, i) => { sxx += p.x * b[i].x + p.y * b[i].y; sxy += p.x * b[i].y - p.y * b[i].x; });
    const angle = Math.atan2(sxy, sxx);
    const c = Math.cos(angle), s = Math.sin(angle);
    let err = 0;
    src.forEach((p, i) => { const x = c * p.x - s * p.y, y = s * p.x + c * p.y; err += (x - b[i].x) ** 2 + (y - b[i].y) ** 2; });
    return { mirror, angle, rms: Math.sqrt(err / src.length) };
  };
  const plain = fit(false), over = fit(true);
  // two or three atoms in a line fit either way: keep the structure the way round it is unless turning over is clearly better
  return over.rms < plain.rms * 0.8 - 1e-6 ? over : plain;
}

/** Where a point goes under a fit, about `about` (the structure stays where it is). */
export function fitMove(f: Fit, about: Vec): (p: Vec) => Vec {
  const c = Math.cos(f.angle), s = Math.sin(f.angle);
  return (p) => {
    const x = (f.mirror ? -(p.x - about.x) : p.x - about.x), y = p.y - about.y;
    return { x: about.x + c * x - s * y, y: about.y + s * x + c * y };
  };
}

/** Is a fit worth doing: a turn of more than a few degrees, or a turn over. */
export const fitMatters = (f: Fit): boolean => f.mirror || Math.abs(f.angle) > (3 * Math.PI) / 180;
