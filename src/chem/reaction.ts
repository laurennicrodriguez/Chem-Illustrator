// Reaction schemes: which objects round an arrow are its starting materials, products and
// conditions, worked out from where they sit the way a chemist reads a scheme. Starting
// materials sit in line before the arrow (joined by + signs), products in line after it, and
// conditions are stacked above and below it.
//
// A role is named by a reference: 'a12' is the structure holding atom 12, 'c5' caption 5 and
// 's7' shape 7 (a picture, say).

import type { Arrow, Atom, Caption, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { dot, norm, sub } from '../geom';
import { arrowBox } from '../objects';
import { atomsBox, type Measure } from '../editor/arrange';
import { labelBonds, labelSpec, layoutLabel } from './labels';
import { arialWidth } from '../text-metrics';
import { layoutText } from '../text/layout';
import { plainText } from '../richtext';

export type Role = 'reactants' | 'products' | 'above' | 'below';
export const ROLES: Role[] = ['reactants', 'products', 'above', 'below'];

/** One thing in a scheme: a whole structure, a caption, or a picture. */
export interface Item {
  ref: string;
  box: Rect;
  /** A "+" between starting materials or products. */
  plus: boolean;
  atoms: number[];
  caption?: number;
  shape?: number;
}

/** Every structure, caption and picture in the drawing, as scheme items. */
export function schemeItems(doc: Doc, m: Measure): Item[] {
  const out: Item[] = [];
  for (const f of doc.fragments()) {
    const atoms = [...f];
    out.push({ ref: 'a' + Math.min(...atoms), box: atomsBox(doc, atoms, m), plus: false, atoms });
  }
  for (const c of doc.captions.values()) {
    const text = plainText(c.runs).trim();
    if (!text || c.ph) continue;
    out.push({ ref: 'c' + c.id, box: m.captionBox(c), plus: isPlus(text), atoms: [], caption: c.id });
  }
  for (const s of doc.shapes.values()) {
    if (s.kind === 'picture' || s.kind === 'table') {
      out.push({ ref: 's' + s.id, box: { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) }, plus: false, atoms: [], shape: s.id });
    }
  }
  return out;
}

const isPlus = (t: string) => t === '+' || t === '＋';

/** The item a reference names (a structure is found by any of its atoms). */
export function itemFinder(items: Item[]): (ref: string) => Item | undefined {
  const byRef = new Map<string, Item>();
  for (const it of items) {
    byRef.set(it.ref, it);
    for (const a of it.atoms) byRef.set('a' + a, it);
  }
  return (ref) => byRef.get(ref);
}

/** Can this arrow be a reaction step? Straight, with a head, and not a resonance arrow. */
export function isReactionArrow(r: Arrow): boolean {
  if ((r.sweep || r.bez?.length) && !r.step) return false;
  const h = r.headStyle !== 'none', t = r.tailStyle !== 'none';
  if (!h && !t) return false;
  // heads at both ends: resonance (but two half-headed shafts are an equilibrium)
  if (h && t && !r.equilibrium) return false;
  return true;
}

/** Where along an arrow things are: t along it from the tail, s across it (positive above). */
export interface Frame { tail: Vec; u: Vec; n: Vec; length: number }

export function arrowFrame(r: Arrow): Frame {
  // an arrow drawn with only a tail head points backwards
  const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
  const tail = fwd ? r.tail : r.head, head = fwd ? r.head : r.tail;
  const d = sub(head, tail);
  const length = Math.hypot(d.x, d.y);
  const u = norm(d);
  // "above" is the side higher on the page (as ChemDraw reads it, whichever way the arrow
  // points); for an upright arrow, the side anticlockwise from it (right of ↓, left of ↑)
  let n = { x: u.y, y: -u.x };
  if (n.y > 1e-9) n = { x: -n.x, y: -n.y };
  return { tail, u, n, length };
}

/** A box seen from an arrow: its extent along (t) and across (s) the arrow. */
export function inFrame(f: Frame, b: Rect): { t1: number; t2: number; s1: number; s2: number } {
  let t1 = Infinity, t2 = -Infinity, s1 = Infinity, s2 = -Infinity;
  for (const p of [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x1, y: b.y2 }, { x: b.x2, y: b.y2 }]) {
    const d = sub(p, f.tail);
    const t = dot(d, f.u), s = dot(d, f.n);
    t1 = Math.min(t1, t); t2 = Math.max(t2, t);
    s1 = Math.min(s1, s); s2 = Math.max(s2, s);
  }
  return { t1, t2, s1, s2 };
}

/** Distance between two boxes given in an arrow's frame (0 when they touch). */
type Span = { t1: number; t2: number; s1: number; s2: number };
const gapBetween = (a: Span, b: Span) => Math.hypot(Math.max(0, a.t1 - b.t2, b.t1 - a.t2), Math.max(0, a.s1 - b.s2, b.s1 - a.s2));

/**
 * The roles round one arrow, from where things sit. Starting materials: the nearest thing past
 * the tail, then more beyond it, each after a + sign; products the same past the head; conditions:
 * what is stacked above and below the arrow. `bond` is the drawing's bond length, which sets how
 * close things must be to count.
 */
export function interpretArrow(r: Arrow, items: Item[], bond: number): StepRoles {
  const out: StepRoles = { reactants: [], products: [], above: [], below: [], plusses: [] };
  const f = arrowFrame(r);
  const L = f.length;
  if (L < 1) return out;
  const reach = 4.5 * bond, stack = 1.5 * bond, touch = 0.6 * bond;
  const seen = items.map((it) => ({ it, ...inFrame(f, it.box) }));
  type Seen = (typeof seen)[number];
  const used = new Set<Item>();
  const mid = (x: Seen) => (x.t1 + x.t2) / 2;

  // starting materials and products: a chain from the arrow's end, linked by + signs
  const chain = (cands: Seen[], end: Span, beyond: (x: Seen, from: Span) => boolean, into: string[]) => {
    let from: Span = end, plus: Seen | null = null;
    for (;;) {
      let best: Seen | null = null, bestD = reach;
      for (const x of cands) {
        if (used.has(x.it) || !beyond(x, from)) continue;
        const d = gapBetween(x, from);
        // after a structure a + sign leads on (or a structure right beside it: a salt's ions);
        // after a + sign, the next structure
        if (into.length && !plus && !x.it.plus && d > touch) continue;
        if ((!into.length || plus) && x.it.plus) continue;
        if (d < bestD) { best = x; bestD = d; }
      }
      if (!best) break;
      used.add(best.it);
      if (best.it.plus) { plus = best; from = best; continue; }
      into.push(best.it.ref);
      if (plus) { out.plusses!.push(plus.it.ref); plus = null; }
      from = best;
    }
    if (plus) used.delete(plus.it);
  };
  const tailEnd: Span = { t1: 0, t2: 0, s1: 0, s2: 0 }, headEnd: Span = { t1: L, t2: L, s1: 0, s2: 0 };
  // (starting materials and products are structures; text beside an arrow is a condition)
  const parts = seen.filter((x) => x.it.plus || x.it.atoms.length);
  chain(parts.filter((x) => mid(x) < 0 && x.t2 < 0.5 * L), tailEnd, (x, from) => mid(x) < (from.t1 + from.t2) / 2, out.reactants);
  chain(parts.filter((x) => mid(x) > L && x.t1 > 0.5 * L), headEnd, (x, from) => mid(x) > (from.t1 + from.t2) / 2, out.products);

  // conditions: stacked above and below the arrow, centred along it
  const free = seen.filter((x) => !used.has(x.it) && !x.it.plus && mid(x) >= -0.1 * L && mid(x) <= 1.1 * L);
  const stackUp = (cands: Seen[], near: (x: Seen) => number, far: (x: Seen) => number, into: string[]) => {
    let top = 0;
    for (const x of cands.sort((a, b) => near(a) - near(b))) {
      if (near(x) - top > stack) break;
      into.push(x.it.ref);
      used.add(x.it);
      top = Math.max(top, far(x));
    }
  };
  const side = (x: Seen) => (x.s1 + x.s2) / 2;
  stackUp(free.filter((x) => side(x) >= 0), (x) => Math.max(0, x.s1), (x) => x.s2, out.above);
  stackUp(free.filter((x) => side(x) < 0), (x) => Math.max(0, -x.s2), (x) => -x.s1, out.below);
  return out;
}

/** Is this a step with something on both sides of the arrow? */
export const isStep = (s: StepRoles | null | undefined): boolean => !!s && s.reactants.length > 0 && s.products.length > 0;

/** The roles an arrow has: those stored with it (from a file, Clean Up Reaction or set by hand), or worked out. */
export function rolesOf(r: Arrow, items: Item[], bond: number): StepRoles {
  return r.step ?? interpretArrow(r, items, bond);
}

/** Every reaction arrow in the drawing, with its roles. */
export function reactionSteps(doc: Doc, items: Item[]): { arrow: Arrow; roles: StepRoles }[] {
  const out: { arrow: Arrow; roles: StepRoles }[] = [];
  for (const r of doc.arrows.values()) {
    if (!isReactionArrow(r)) continue;
    const roles = rolesOf(r, items, doc.style.bondLength);
    if (isStep(roles) || r.step) out.push({ arrow: r, roles });
  }
  return out;
}

/** Text sizes from Arial's published widths: a measure that needs no screen (tests, files). */
export function plainMeasure(doc: Doc): Measure {
  return {
    atomBoxes(a: Atom): Rect[] {
      const spec = a.attach || a.multi ? null : labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), !a.hideCharge, !!a.showCarbon);
      if (!spec) return [];
      const k = a.s ?? 1;
      const lay = layoutLabel(spec, labelBonds(doc, a), doc.style.labelSize * k, (t, s) => arialWidth(t, s), a.just);
      const m = doc.style.marginWidth * k;
      return lay.boxes.map((b) => ({ x1: a.x + b.x1 - m, y1: a.y + b.y1 - m, x2: a.x + b.x2 + m, y2: a.y + b.y2 + m }));
    },
    captionBox(c: Caption): Rect {
      const b = layoutText(c, doc.style.captionSize, (t, s, _f, style) => arialWidth(t, s, style.includes('bold'))).box;
      return { x1: c.x + b.x1, y1: c.y + b.y1, x2: c.x + b.x2, y2: c.y + b.y2 };
    },
  };
}

/** Box round an arrow (for laying schemes out). */
export const arrowRect = (r: Arrow): Rect => arrowBox(r);
