// Ring fills (Structure > Fill Rings): a ring coloured in, shaded, hatched or stippled behind its
// bonds. The fill is a shape tied to the ring's atoms: it follows them when they move, and goes
// when one of them is deleted.

import type { Doc, Entity, Shape } from '../model';
import { ringsAmong, ringBonds } from './aromatic';

/** A soft blue that shows the ring without hiding the bonds. Change it in the Style panel. */
export const RING_FILL_COLOUR = '#cfe0ff';

const sameRing = (a: number[], b: number[]) => a.length === b.length && a.every((id) => b.includes(id));

/** The ring fill shapes already on this ring, if any. */
export function ringFillOf(doc: Doc, ring: number[]): Shape | undefined {
  for (const s of doc.shapes.values()) if (s.kind === 'ring' && s.ring && sameRing(s.ring, ring)) return s;
  return undefined;
}

/** Where a ring's corners are, and the box round them. */
export function ringGeometry(doc: Doc, ring: number[]): Pick<Shape, 'poly' | 'x1' | 'y1' | 'x2' | 'y2'> {
  const poly = ring.map((id) => { const a = doc.atoms.get(id)!; return { x: a.x, y: a.y }; });
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  return { poly, x1: Math.min(...xs), y1: Math.min(...ys), x2: Math.max(...xs), y2: Math.max(...ys) };
}

/** The rings wholly among these bonds (every ring in the drawing when none are given). */
export function ringsIn(doc: Doc, bonds: Iterable<number>): number[][] {
  const set = new Set(bonds);
  return ringsAmong(doc, set).filter((r) => !set.size || ringBonds(doc, r).every((b) => set.has(b)));
}

/**
 * Fill the rings wholly among these bonds (inside an edit). Rings that are filled already keep
 * their fill. Returns the ids of the fill shapes, new and old.
 */
export function fillRings(doc: Doc, bonds: Iterable<number>, look: Partial<Shape> = {}): number[] {
  const out: number[] = [];
  for (const ring of ringsIn(doc, bonds)) {
    const had = ringFillOf(doc, ring);
    if (had) { out.push(had.id); continue; }
    const s = doc.addShape({ kind: 'ring', ring, ...ringGeometry(doc, ring), filled: true, fillColor: RING_FILL_COLOUR, z: -1000, ...look });
    out.push(s.id);
  }
  return out;
}

/**
 * At the end of a change (`before` holds how the changed things were): ring fills whose atoms
 * moved take their new places, and fills that lost an atom go.
 */
export function refitRingFills(doc: Doc, before: ReadonlyMap<string, Entity | null>): void {
  for (const s of [...doc.shapes.values()]) {
    if (s.kind !== 'ring' || !s.ring) continue;
    if (!s.ring.every((id) => doc.atoms.has(id))) { doc.removeShape(s.id); continue; }
    if (!before.has('s' + s.id) && !s.ring.some((id) => before.has('a' + id))) continue;
    const g = ringGeometry(doc, s.ring);
    const moved = !s.poly || s.poly.length !== g.poly!.length || s.poly.some((p, i) => Math.abs(p.x - g.poly![i].x) + Math.abs(p.y - g.poly![i].y) > 1e-6);
    if (moved || s.x1 !== g.x1 || s.y1 !== g.y1 || s.x2 !== g.x2 || s.y2 !== g.y2) doc.updateShape(s.id, g);
  }
}

/** Ring fills that sit on any of these atoms (they move with their structure). */
export function ringFillsOn(doc: Doc, atoms: ReadonlySet<number>): number[] {
  const out: number[] = [];
  for (const s of doc.shapes.values()) if (s.kind === 'ring' && s.ring?.some((id) => atoms.has(id))) out.push(s.id);
  return out;
}

/**
 * Find the ring under each saved ring fill (a file keeps only the corner points): the ring in
 * the drawing whose atoms sit on those corners. Fills with no ring there stay as saved.
 */
export function attachRingFills(doc: Doc, tol = 0.5): void {
  for (const s of [...doc.shapes.values()]) {
    if (s.kind !== 'ring' || s.ring?.length || !s.poly || s.poly.length < 3) continue;
    const ids: number[] = [];
    for (const p of s.poly) {
      let best: number | undefined, bd = tol;
      for (const a of doc.atomsIn({ x1: p.x - tol, y1: p.y - tol, x2: p.x + tol, y2: p.y + tol })) {
        const d = Math.hypot(a.x - p.x, a.y - p.y);
        if (d <= bd) { bd = d; best = a.id; }
      }
      if (best === undefined) break;
      ids.push(best);
    }
    if (ids.length === s.poly.length && new Set(ids).size === ids.length) doc.updateShape(s.id, { ring: ids });
  }
}
