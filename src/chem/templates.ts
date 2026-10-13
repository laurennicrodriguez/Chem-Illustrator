// Ready-made structures (ring systems, heterocycles, amino acids, sugars) and how they are put
// into a drawing: on their own, fused onto a bond, or joined to an atom. The shapes are made by
// scripts/make-templates.mjs, with a bond length of 1 and the middle at (0, 0).

import data from './templates.json';
import type { Doc, BondDisplay } from '../model';
import { Vec, add, sub, mul, dist, angleOf, DEG } from '../geom';
import { elementNumber } from './elements';
import { atomAt, MERGE_FRACTION } from './chemgeom';

/** x, y, element, then charge and a text label (such as CH2OH) when there is one. */
export type TemplateAtom = [number, number, string, number?, string?];
/** The two atoms, the bond order, and how it is drawn when not plain. */
export type TemplateBond = [number, number, number, BondDisplay?];

export interface Template {
  id: string;
  name: string;
  group: 'rings' | 'heterocycles' | 'amino' | 'sugars';
  atoms: TemplateAtom[];
  bonds: TemplateBond[];
  /** The atom put on (or joined to) an atom that is clicked. */
  attach: number;
  /** The bond laid along a bond that is clicked; none for templates without rings. */
  fuse?: [number, number];
  /** 'bond': joined to a clicked atom by a new bond rather than sharing it. */
  join?: 'bond';
}

export const TEMPLATES = data as Template[];
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
export const templateById = (id: string): Template | undefined => BY_ID.get(id);

/** Where a template goes: mirrored top to bottom (or not), turned, sized and moved. */
export interface Placement {
  origin: Vec;
  scale: number;
  angle: number;
  mirror: boolean;
}

export function placePoint(pl: Placement, x: number, y: number): Vec {
  const yy = pl.mirror ? -y : y;
  const c = Math.cos(pl.angle), s = Math.sin(pl.angle);
  return { x: pl.origin.x + pl.scale * (x * c - yy * s), y: pl.origin.y + pl.scale * (x * s + yy * c) };
}

export const templatePoints = (t: Template, pl: Placement): Vec[] => t.atoms.map(([x, y]) => placePoint(pl, x, y));

/** The template with its middle at a point, turned by an angle (radians, clockwise on screen). */
export function freePlacement(at: Vec, L: number, angle = 0): Placement {
  return { origin: at, scale: L, angle, mirror: false };
}

/** The ways of laying the template's fuse bond along the bond p–q: either way round, either side. */
export function fusePlacements(t: Template, p: Vec, q: Vec): Placement[] {
  if (!t.fuse) return [];
  const out: Placement[] = [];
  for (const mirror of [false, true]) {
    for (const [a, b] of [[p, q], [q, p]]) {
      const f1 = placePoint({ origin: { x: 0, y: 0 }, scale: 1, angle: 0, mirror }, t.atoms[t.fuse[0]][0], t.atoms[t.fuse[0]][1]);
      const f2 = placePoint({ origin: { x: 0, y: 0 }, scale: 1, angle: 0, mirror }, t.atoms[t.fuse[1]][0], t.atoms[t.fuse[1]][1]);
      const scale = dist(a, b) / Math.max(1e-9, dist(f1, f2));
      const angle = angleOf(sub(b, a)) - angleOf(sub(f2, f1));
      const rotF1 = { x: f1.x * Math.cos(angle) - f1.y * Math.sin(angle), y: f1.x * Math.sin(angle) + f1.y * Math.cos(angle) };
      out.push({ origin: sub(a, mul(rotF1, scale)), scale, angle, mirror });
    }
  }
  return out;
}

/**
 * The ways of putting the template's attach atom on an atom at `a` (or a bond away from it,
 * for templates joined by a bond), with the rest of the template lying towards `dir`. The turn
 * is rounded to 30° so rings stay square to the page.
 */
export function atomPlacements(t: Template, a: Vec, dir: Vec, L: number, byBond: boolean): Placement[] {
  const [px, py] = t.atoms[t.attach];
  const at = byBond ? add(a, mul(dir, L)) : a;
  const out: Placement[] = [];
  for (const mirror of [false, true]) {
    const P = placePoint({ origin: { x: 0, y: 0 }, scale: 1, angle: 0, mirror }, px, py);
    // from the attach atom towards the middle of the template
    const v = { x: -P.x, y: -P.y };
    let angle = angleOf(dir) - angleOf(v);
    angle = Math.round(angle / (30 * DEG)) * 30 * DEG;
    const rp = { x: P.x * Math.cos(angle) - P.y * Math.sin(angle), y: P.x * Math.sin(angle) + P.y * Math.cos(angle) };
    out.push({ origin: sub(at, mul(rp, L)), scale: L, angle, mirror });
  }
  return out;
}

/** How crowded a placement would be: atoms of the drawing close to the new atoms. */
export function crowdingOf(doc: Doc, t: Template, pl: Placement, ignore: Set<number>): number {
  const L = pl.scale;
  let c = 0;
  for (const p of templatePoints(t, pl)) {
    for (const a of doc.atomsNear(p, L * 1.2)) {
      if (ignore.has(a.id)) continue;
      const d = dist(a, p);
      if (d < L * 0.3) continue; // lands on an atom: shared, not crowded
      c += (L * 1.2 - d) / L;
    }
  }
  return c;
}

export interface PlaceOptions {
  /** Template atom index → atom already in the drawing that it becomes. */
  existing?: Map<number, number>;
  /** Join the attach atom to this atom by a new bond. */
  bondFrom?: number;
  /** Size of the new atoms and bonds relative to the document style. */
  scale?: number;
}

/**
 * Add a template to the drawing. Atoms that land on atoms already there are shared. Returns
 * the drawing's atom for each template atom. Call inside an edit.
 */
export function placeTemplate(doc: Doc, t: Template, pl: Placement, opts: PlaceOptions = {}): number[] {
  const pts = templatePoints(t, pl);
  const tol = pl.scale * MERGE_FRACTION;
  const extra = opts.scale && opts.scale !== 1 ? { s: opts.scale } : {};
  const ids: number[] = [];
  const used = new Set<number>(opts.existing?.values() ?? []);
  const shared = new Set<number>();
  t.atoms.forEach(([, , el, charge, label], i) => {
    let id = opts.existing?.get(i);
    if (id === undefined) {
      const hit = atomAt(doc, pts[i], tol, used);
      if (hit) id = hit.id;
    }
    if (id !== undefined) {
      shared.add(id);
    } else {
      const z = elementNumber(el) ?? 6;
      id = doc.addAtom(pts[i].x, pts[i].y, z, { ...extra, ...(charge ? { charge } : {}), ...(label ? { label } : {}) }).id;
    }
    used.add(id);
    ids.push(id);
  });
  // A shared atom that already has a double bond keeps it, and the template's double bonds are
  // moved round so none lands next to it (benzene + pyridine gives quinoline, not a dihydro one).
  const hasDouble = (id: number) => (doc.adj.get(id) ?? []).some((bid) => (doc.bonds.get(bid)?.order ?? 0) >= 2);
  const satisfied = (i: number) => shared.has(ids[i]) && hasDouble(ids[i]);
  const doubles = t.atoms.some((_, i) => satisfied(i)) ? rematch(t, satisfied) : null;
  t.bonds.forEach(([i, j, order, display], k) => {
    const a = ids[i], b = ids[j];
    if (a === b || doc.bondBetween(a, b)) return;
    let o = order;
    if (doubles && (o === 1 || o === 2) && !display) o = doubles.has(k) ? 2 : 1;
    else if (o === 2 && ((shared.has(a) && hasDouble(a)) || (shared.has(b) && hasDouble(b)))) o = 1;
    // a mirror image needs its wedges swapped to keep the same stereochemistry
    let d: BondDisplay = display ?? 'solid';
    if (pl.mirror) d = d === 'wedge' ? 'hashWedge' : d === 'hashWedge' ? 'wedge' : d;
    doc.addBond(a, b, o, d, extra);
  });
  if (opts.bondFrom !== undefined && !doc.bondBetween(opts.bondFrom, ids[t.attach])) doc.addBond(opts.bondFrom, ids[t.attach], 1, 'solid', extra);
  return ids;
}

/**
 * Places for the template's double bonds when some of its atoms already have one in the
 * drawing: every other atom that had a double bond gets exactly one again. Returns the indexes
 * of the bonds to make double, or null when no arrangement works.
 */
export function rematch(t: Template, satisfied: (i: number) => boolean): Set<number> | null {
  const conj = new Set<number>();
  for (const [a, b, o] of t.bonds) if (o === 2) { conj.add(a); conj.add(b); }
  const need = [...conj].filter((i) => !satisfied(i));
  const needs = new Set(need);
  const cand = t.bonds.map(([a, b, o, d], k) => ({ a, b, o, d, k })).filter((c) => (c.o === 1 || c.o === 2) && !c.d && needs.has(c.a) && needs.has(c.b));
  const mate = new Map<number, number>();
  const solve = (): boolean => {
    // the atom with fewest choices first
    let pick = -1;
    let opts: typeof cand = [];
    for (const i of need) {
      if (mate.has(i)) continue;
      const o = cand.filter((c) => (c.a === i && !mate.has(c.b)) || (c.b === i && !mate.has(c.a)));
      if (pick < 0 || o.length < opts.length) { pick = i; opts = o; }
    }
    if (pick < 0) return true;
    for (const c of opts) {
      mate.set(c.a, c.k); mate.set(c.b, c.k);
      if (solve()) return true;
      mate.delete(c.a); mate.delete(c.b);
    }
    return false;
  };
  return solve() ? new Set(mate.values()) : null;
}

/** Turn an angle to the nearest 15° (for dragging a template round). */
export const snap15 = (a: number): number => Math.round(a / (15 * DEG)) * 15 * DEG;

