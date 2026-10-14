// Bonds that cross (a bridged ring drawn flat, say): the one in front is drawn whole and the one
// behind it gets a small gap either side, as in ChemDraw. Which is in front is the bond's layer:
// its own number when it has been brought forward or sent back, else the order it was drawn in.

import type { Bond, Doc } from '../model';
import type { Vec } from '../geom';

/** Drawing order of a bond: higher is in front. */
export const bondLayer = (b: Bond): number => b.z ?? b.id;

/** Where segments p→q and r→s cross, as fractions along each; null when they don't. */
function crossAt(p: Vec, q: Vec, r: Vec, s: Vec): { t: number; u: number; sin: number } | null {
  const d1 = { x: q.x - p.x, y: q.y - p.y }, d2 = { x: s.x - r.x, y: s.y - r.y };
  const den = d1.x * d2.y - d1.y * d2.x;
  const l1 = Math.hypot(d1.x, d1.y), l2 = Math.hypot(d2.x, d2.y);
  if (Math.abs(den) < 1e-9 * l1 * l2) return null;
  const t = ((r.x - p.x) * d2.y - (r.y - p.y) * d2.x) / den;
  const u = ((r.x - p.x) * d1.y - (r.y - p.y) * d1.x) / den;
  if (t <= 0.02 || t >= 0.98 || u <= 0.02 || u >= 0.98) return null;
  return { t, u, sin: Math.abs(den) / (l1 * l2) };
}

/** The bonds that cross this one (not counting bonds that share an atom with it). */
export function crossingBonds(doc: Doc, b: Bond): Bond[] {
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const out: Bond[] = [];
  for (const o of doc.bondsNear(mid, Math.hypot(q.x - p.x, q.y - p.y) / 2)) {
    if (o.id === b.id || o.a1 === b.a1 || o.a1 === b.a2 || o.a2 === b.a1 || o.a2 === b.a2) continue;
    if (crossAt(p, q, doc.atoms.get(o.a1)!, doc.atoms.get(o.a2)!)) out.push(o);
  }
  return out;
}

/**
 * Stretches of a bond to leave out where bonds in front of it cross: fractions along it, from
 * a1 to a2. `half` is how far the gap reaches either side of the bond in front.
 */
export function crossingGaps(doc: Doc, b: Bond, half: number): [number, number][] {
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  const l = Math.hypot(q.x - p.x, q.y - p.y);
  if (l < 1e-6) return [];
  const out: [number, number][] = [];
  const me = bondLayer(b);
  for (const o of crossingBonds(doc, b)) {
    if (bondLayer(o) <= me) continue;
    const c = crossAt(p, q, doc.atoms.get(o.a1)!, doc.atoms.get(o.a2)!);
    if (!c) continue;
    // a shallow crossing needs a longer gap to clear the other bond
    const h = half / Math.max(0.35, c.sin) / l;
    out.push([c.t - h, c.t + h]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}
