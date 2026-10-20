// Ready-made structures (ring systems, heterocycles, amino acids, sugars) and how they are put
// into a drawing: on their own, fused onto a bond, or joined to an atom. The shapes are made by
// scripts/make-templates.mjs, with a bond length of 1 and the middle at (0, 0).

import data from './templates.json';
import conformerData from './conformers.json';
import type { Doc, BondDisplay } from '../model';
import { Vec, add, sub, mul, dist, angleOf, DEG } from '../geom';
import { elementNumber, SYMBOLS } from './elements';
import { atomAt, MERGE_FRACTION } from './chemgeom';
import { circleRing } from './aromatic';

/** x, y, element, then charge and a text label (such as CH2OH) when there is one. */
export type TemplateAtom = [number, number, string, number?, string?];
/** The two atoms, the bond order, and how it is drawn when not plain. */
export type TemplateBond = [number, number, number, BondDisplay?];

export interface Template {
  id: string;
  name: string;
  /** 'own': saved by the person (Structure > Save as Template). */
  group: TemplateGroup;
  atoms: TemplateAtom[];
  bonds: TemplateBond[];
  /** The atom put on (or joined to) an atom that is clicked. */
  attach: number;
  /** The bond laid along a bond that is clicked; none for templates without rings. */
  fuse?: [number, number];
  /** 'bond': joined to a clicked atom by a new bond rather than sharing it. */
  join?: 'bond';
  /**
   * Depth of each atom, towards the viewer, for shapes drawn in perspective (conformers): the
   * template is the flat shadow of a real 3-D shape, and fusing onto it works in 3-D (fuse3d.ts).
   */
  z?: number[];
  /** Rings (atom indexes in order) drawn aromatic with a circle. */
  circle?: number[][];
  /** Lines and circles that go with it (a Newman projection's circle and back bonds): kind, then x1, y1, x2, y2. */
  shapes?: TemplateShape[];
}

export type TemplateShape = ['line' | 'oval', number, number, number, number];

export type TemplateGroup = 'rings' | 'heterocycles' | 'amino' | 'sugars' | 'own'
  | 'conformers' | 'fused' | 'projections' | 'stereo' | 'bicyclics' | 'cycloalkanes' | 'aromatics' | 'perspective';

export const TEMPLATES = [...(data as Template[]), ...(conformerData as Template[])];
const BY_ID = new Map(TEMPLATES.map((t) => [t.id, t]));
export const templateById = (id: string): Template | undefined => BY_ID.get(id);

/** The person's own templates, in the order they were saved. */
let OWN: Template[] = [];
export const ownTemplates = (): Template[] => OWN;

/** Use these as the person's own templates (replacing any before). */
export function setOwnTemplates(list: Template[]): void {
  for (const t of OWN) BY_ID.delete(t.id);
  OWN = list.filter((t) => !TEMPLATES.some((b) => b.id === t.id));
  for (const t of OWN) BY_ID.set(t.id, t);
}

/** Own templates read from the settings file, keeping only ones that make sense. */
export function parseOwnTemplates(raw: unknown): Template[] {
  if (!Array.isArray(raw)) return [];
  const out: Template[] = [];
  for (const t of raw as Partial<Template>[]) {
    if (!t || typeof t.id !== 'string' || typeof t.name !== 'string' || !Array.isArray(t.atoms) || !Array.isArray(t.bonds)) continue;
    const n = t.atoms.length;
    const atomsOk = n > 0 && t.atoms.every((a) => Array.isArray(a) && Number.isFinite(a[0]) && Number.isFinite(a[1]) && typeof a[2] === 'string');
    const bondsOk = t.bonds.every((b) => Array.isArray(b) && Number.isInteger(b[0]) && Number.isInteger(b[1]) && b[0] >= 0 && b[1] >= 0 && b[0] < n && b[1] < n && Number.isFinite(b[2]));
    if (!atomsOk || !bondsOk) continue;
    const attach = Number.isInteger(t.attach) && t.attach! >= 0 && t.attach! < n ? t.attach! : 0;
    const fuse = Array.isArray(t.fuse) && t.fuse.length === 2 && t.fuse.every((i) => Number.isInteger(i) && i >= 0 && i < n) ? t.fuse : undefined;
    out.push({ id: t.id, name: t.name, group: 'own', atoms: t.atoms, bonds: t.bonds, attach, ...(fuse ? { fuse } : {}), ...(t.join === 'bond' ? { join: 'bond' as const } : {}) });
  }
  return out;
}

/**
 * A template made from drawn atoms (and the bonds between them): one bond long, centred on
 * (0, 0). It joins things at an end atom (the leftmost with fewest bonds) and fuses along a ring
 * bond when it has one.
 */
export function templateFromAtoms(doc: Doc, ids: Iterable<number>, name: string, id: string): Template | null {
  const list = [...ids].filter((i) => { const a = doc.atoms.get(i); return !!a && !a.attach; });
  if (!list.length) return null;
  const index = new Map(list.map((i, k) => [i, k]));
  const bonds = [...doc.bonds.values()].filter((b) => index.has(b.a1) && index.has(b.a2));
  const L = bonds.length ? bonds.reduce((s, b) => s + dist(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!), 0) / bonds.length : doc.style.bondLength;
  let cx = 0, cy = 0;
  for (const i of list) { const a = doc.atoms.get(i)!; cx += a.x; cy += a.y; }
  cx /= list.length; cy /= list.length;
  const r3 = (v: number) => Math.round(v * 1000) / 1000;
  const atoms: TemplateAtom[] = list.map((i) => {
    const a = doc.atoms.get(i)!;
    const t: TemplateAtom = [r3((a.x - cx) / L), r3((a.y - cy) / L), SYMBOLS[a.z] || 'C'];
    if (a.charge || a.label) t.push(a.charge);
    if (a.label) t.push(a.label);
    return t;
  });
  const tb: TemplateBond[] = bonds.map((b) => {
    const t: TemplateBond = [index.get(b.a1)!, index.get(b.a2)!, b.order];
    if (b.display !== 'solid') t.push(b.display);
    return t;
  });
  const degree = (k: number) => tb.filter((b) => b[0] === k || b[1] === k).length;
  let attach = 0;
  for (let k = 1; k < atoms.length; k++) {
    if (degree(k) < degree(attach) || (degree(k) === degree(attach) && atoms[k][0] < atoms[attach][0])) attach = k;
  }
  const ringBond = bonds.find((b) => doc.ringThroughBond(b.id) !== null);
  const out: Template = { id, name, group: 'own', atoms, bonds: tb, attach };
  if (ringBond) out.fuse = [index.get(ringBond.a1)!, index.get(ringBond.a2)!];
  else out.join = 'bond';
  return out;
}

/** Where a template goes: mirrored top to bottom (or not), turned, sized and moved. */
export interface Placement {
  origin: Vec;
  scale: number;
  angle: number;
  mirror: boolean;
  /** Where every atom goes, when worked out some other way (fused in 3-D: fuse3d.ts). */
  pts?: Vec[];
}

export function placePoint(pl: Placement, x: number, y: number): Vec {
  const yy = pl.mirror ? -y : y;
  const c = Math.cos(pl.angle), s = Math.sin(pl.angle);
  return { x: pl.origin.x + pl.scale * (x * c - yy * s), y: pl.origin.y + pl.scale * (x * s + yy * c) };
}

export const templatePoints = (t: Template, pl: Placement): Vec[] => pl.pts ?? t.atoms.map(([x, y]) => placePoint(pl, x, y));

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
  /** Only the atoms in `existing` are shared: others landing on drawn atoms stay separate (3-D fusions, where atoms may lie behind others). */
  noMerge?: boolean;
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
    if (id === undefined && !opts.noMerge) {
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
  for (const ring of t.circle ?? []) circleRing(doc, ring.map((i) => ids[i]));
  for (const [kind, x1, y1, x2, y2] of t.shapes ?? []) {
    const a = placePoint(pl, x1, y1), b = placePoint(pl, x2, y2);
    if (kind === 'oval') {
      // a circle stays a circle when turned: keep it square on its middle
      const r = Math.hypot(b.x - a.x, b.y - a.y) / 2 / Math.SQRT2;
      const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      doc.addShape({ kind: 'oval', x1: c.x - r, y1: c.y - r, x2: c.x + r, y2: c.y + r });
    } else {
      doc.addShape({ kind: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
  }
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

