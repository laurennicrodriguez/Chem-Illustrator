// Things stuck to a structure: the ends of electron-pushing arrows, and the lone pairs, radical
// dots and circled charges drawn on atoms. Each holds its place in the frame of a few atoms (see
// Pin in model.ts), so when the structure is moved, turned, flipped or cleaned up they go with it.
// They are put back in place as each change finishes, inside the same undo step (and during a
// drag, so they move with the pointer). Moving one by hand keeps the new place if it is still on
// what it was stuck to, and frees it if it was taken away.

import type { Arrow, Doc, Entity, Pin, Shape } from '../model';
import type { Vec } from '../geom';
import { add, dist, dot, len, mul, perp, sub } from '../geom';

/** How far (in bond lengths) from what it is stuck to a pinned point may be moved by hand and stay stuck. */
const REACH = 0.9;
const EPS = 1e-3;

interface Frame { o: Vec; u: Vec; v: Vec; s: number; hand: number }

const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;

/** The frame a pin's atoms make now; null if one of them is gone. */
function frameOf(doc: Doc, ref: number[]): Frame | null {
  const [a0, a1, a2] = ref.map((id) => doc.atoms.get(id));
  if (!a0 || ref.slice(1).some((id) => !doc.atoms.has(id))) return null;
  let u = { x: 1, y: 0 }, s = 1;
  if (a1) {
    const d = sub(a1, a0);
    s = len(d);
    if (s < 1e-6) return null;
    u = mul(d, 1 / s);
  }
  const hand = a2 && cross(u, sub(a2, a0)) < 0 ? -1 : 1;
  return { o: a0, u, v: mul(perp(u), hand), s, hand };
}

/** The atoms that frame a point on an atom, a bond or a gap: its own, then one for direction and one for handedness. */
function refsFor(doc: Doc, on: Pin['on'], atoms: number[]): number[] {
  const nbrs = (id: number, not: number[]) => doc.neighbors(id).map((n) => n.id).filter((x) => !not.includes(x)).sort((a, b) => a - b);
  if (on === 'atom') {
    const [id] = atoms;
    const ns = nbrs(id, []);
    if (!ns.length) return [id];
    // an end atom (the O of C=O): its neighbour's other neighbour tells a mirror image apart
    const third = ns[1] ?? nbrs(ns[0], [id])[0];
    return third === undefined ? [id, ns[0]] : [id, ns[0], third];
  }
  const [a1, a2] = atoms;
  const third = nbrs(a1, [a2])[0] ?? nbrs(a2, [a1])[0];
  return third === undefined ? [a1, a2] : [a1, a2, third];
}

/** A pin holding point `p` to an atom, a bond's two atoms or the two atoms a new bond will join. */
export function makePin(doc: Doc, on: Pin['on'], atoms: number[], p: Vec): Pin | null {
  if (!atoms.every((id) => doc.atoms.has(id))) return null;
  const ref = refsFor(doc, on, atoms);
  const f = frameOf(doc, ref);
  if (!f) return null;
  const d = sub(p, f.o);
  return { on, ref, at: { x: dot(d, f.u) / f.s, y: dot(d, f.v) / f.s }, hand: f.hand, was: { x: p.x, y: p.y } };
}

/** Where a pin holds its point now (null when its atoms are gone). */
export function pinPoint(doc: Doc, pin: Pin): Vec | null {
  const f = frameOf(doc, pin.ref);
  return f && add(f.o, add(mul(f.u, pin.at.x * f.s), mul(f.v, pin.at.y * f.s)));
}

/** The middle of what a pin is on: its atom, or the middle of its bond or gap. */
function pinCentre(doc: Doc, pin: Pin): Vec | null {
  const a = doc.atoms.get(pin.ref[0]);
  if (!a) return null;
  if (pin.on === 'atom') return a;
  const b = doc.atoms.get(pin.ref[1]);
  return b ? { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } : null;
}

/** The atoms a pin is on (one, or a bond's or gap's two). */
const pinAtoms = (pin: Pin) => (pin.on === 'atom' ? pin.ref.slice(0, 1) : pin.ref.slice(0, 2));

type Outcome = { pin: Pin | undefined; at?: Vec; flipped?: boolean };

/** What becomes of a pin whose point is now at `now`: kept, moved with its atoms, held anew, or dropped. */
function settle(doc: Doc, pin: Pin, now: Vec): Outcome {
  const L = doc.style.bondLength;
  const centre = pinCentre(doc, pin);
  if (!centre) return { pin: undefined };
  // moved by hand: still on what it was stuck to, it holds there; taken away, it comes loose
  if (dist(now, pin.was) > EPS) return { pin: dist(now, centre) <= REACH * L ? makePin(doc, pin.on, pinAtoms(pin), now) ?? undefined : undefined };
  const f = frameOf(doc, pin.ref);
  // an atom that framed it is gone (but not the ones it is on): framed afresh where it is
  if (!f) return { pin: makePin(doc, pin.on, pinAtoms(pin), now) ?? undefined };
  const at = add(f.o, add(mul(f.u, pin.at.x * f.s), mul(f.v, pin.at.y * f.s)));
  if (dist(at, now) <= EPS && f.hand === pin.hand) return { pin };
  return { pin: { ...pin, was: at, hand: f.hand }, at, flipped: f.hand !== pin.hand };
}

const swapHalf = (h: Arrow['headStyle']): Arrow['headStyle'] => (h === 'halfLeft' ? 'halfRight' : h === 'halfRight' ? 'halfLeft' : h);

/** An arrow's line seen in a mirror (the same ends): its bend and half heads on the other side. */
export function mirrorBend(r: Arrow): Partial<Arrow> {
  return {
    sweep: -r.sweep || 0,
    ...(r.bez ? { bez: r.bez.map((p) => ({ x: p.x, y: -p.y })) } : {}),
    ...(r.equilibrium ? {} : { headStyle: swapHalf(r.headStyle), tailStyle: swapHalf(r.tailStyle) }),
  };
}

/** Symbols that sit on an atom and go with it. */
const ON_ATOM = new Set(['LonePair', 'Electron', 'CirclePlus', 'CircleMinus']);

/** A lone pair, radical dot or circled charge, pinned to the atom it sits on (the nearest, within most of a bond length). */
export function pinSymbol(doc: Doc, s: Shape): Pin | undefined {
  if (s.kind !== 'symbol' || !ON_ATOM.has(s.symbol ?? '')) return undefined;
  const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  let best: number | null = null, bestD = 0.7 * doc.style.bondLength;
  for (const a of doc.atomsNear(c, bestD)) { const d = dist(a, c); if (d < bestD && !a.multi) { bestD = d; best = a.id; } }
  return best === null ? undefined : makePin(doc, 'atom', [best], c) ?? undefined;
}

/** Pin every lone pair, radical dot and circled charge to its atom (a drawing just read from a file). */
export function pinSymbols(doc: Doc): void {
  for (const s of doc.shapes.values()) if (!s.pin) { const p = pinSymbol(doc, s); if (p) s.pin = p; }
}

/**
 * Put everything stuck to a structure back in place after its atoms moved (part of the change
 * going on). With the change's list of what it touched, lone pairs and charges it added are
 * stuck to their atoms first.
 */
export function followPins(doc: Doc, before?: ReadonlyMap<string, Entity | null>): void {
  if (before) for (const [key, was] of before) {
    if (key[0] !== 's' || was) continue;
    const s = doc.shapes.get(Number(key.slice(1)));
    const p = s && !s.pin ? pinSymbol(doc, s) : undefined;
    if (p) doc.updateShape(s!.id, { pin: p });
  }
  if (!hasPins(doc)) return;
  for (const r of doc.arrows.values()) {
    if (!r.pin) continue;
    const patch: Partial<Arrow> = {};
    const pin: Arrow['pin'] = {};
    let flips = 0, pinned = 0, changed = false;
    for (const end of ['tail', 'head'] as const) {
      const p = r.pin[end];
      if (!p) continue;
      const o = settle(doc, p, r[end]);
      if (o.pin) pin[end] = o.pin;
      if (o.pin !== p) changed = true;
      if (o.at) patch[end] = o.at;
      if (o.pin) pinned++;
      if (o.flipped) flips++;
    }
    if (!changed) continue;
    patch.pin = pin.tail || pin.head ? pin : undefined;
    // the structure was flipped under the arrow: its curve flips too
    if (flips && flips === pinned) Object.assign(patch, mirrorBend(r));
    doc.updateArrow(r.id, patch);
  }
  for (const s of doc.shapes.values()) {
    if (!s.pin) continue;
    const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    const o = settle(doc, s.pin, c);
    if (o.pin === s.pin) continue;
    const patch: Partial<Shape> = { pin: o.pin };
    if (o.at) {
      const dx = o.at.x - c.x, dy = o.at.y - c.y;
      Object.assign(patch, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy });
    }
    doc.updateShape(s.id, patch);
  }
}

/** Whether anything in the drawing is stuck to a structure (nothing to do otherwise). */
export function hasPins(doc: Doc): boolean {
  for (const r of doc.arrows.values()) if (r.pin) return true;
  for (const s of doc.shapes.values()) if (s.pin) return true;
  return false;
}

/** Ids of atoms in pins, renamed (for a copy pasted with new ids); a pin naming an atom not copied is dropped. */
export function renamePin(pin: Pin | undefined, ids: Map<number, number>): Pin | undefined {
  if (!pin) return undefined;
  const ref = pin.ref.map((id) => ids.get(id));
  return ref.every((x) => x !== undefined) ? { ...pin, ref: ref as number[] } : undefined;
}
