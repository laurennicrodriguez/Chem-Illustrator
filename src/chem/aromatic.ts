// Aromatic rings drawn with a circle. A circled ring's bonds are aromatic (order 1.5) and marked
// `circle`, so they draw as single lines round a circle; turning the circle off puts alternating
// single and double bonds back (a Kekulé structure).

import type { Doc } from '../model';
import { implicitHydrogens, SYMBOLS } from './elements';
import type { Vec } from '../geom';

const key = (ring: number[]) => [...ring].sort((a, b) => a - b).join(',');

/** A ring through the bond, avoiding some atoms: its atoms in order, a1 first and a2 last. */
function ringAvoiding(doc: Doc, bondId: number, avoid: Set<number>, maxSize = 8): number[] | null {
  const b = doc.bonds.get(bondId);
  if (!b) return null;
  const prev = new Map<number, number>([[b.a2, -1]]);
  let frontier = [b.a2];
  for (let depth = 1; depth < maxSize && frontier.length; depth++) {
    const next: number[] = [];
    for (const id of frontier) {
      for (const bid of doc.adj.get(id) ?? []) {
        if (bid === bondId) continue;
        const bb = doc.bonds.get(bid)!;
        const o = bb.a1 === id ? bb.a2 : bb.a1;
        if (prev.has(o) || avoid.has(o)) continue;
        prev.set(o, id);
        if (o === b.a1) {
          const path = [o];
          let cur = id;
          while (cur !== -1) { path.push(cur); cur = prev.get(cur)!; }
          return path;
        }
        next.push(o);
      }
    }
    frontier = next;
  }
  return null;
}

/** The smallest rings through a bond: one on each side of it (when it is shared by two). */
export function ringsThroughBond(doc: Doc, bondId: number): number[][] {
  const first = ringAvoiding(doc, bondId, new Set());
  if (!first) return [];
  const b = doc.bonds.get(bondId)!;
  const inner = new Set(first.filter((a) => a !== b.a1 && a !== b.a2));
  const second = ringAvoiding(doc, bondId, inner);
  return second && key(second) !== key(first) ? [first, second] : [first];
}

/** The bond between two atoms, if there is one. */
function bondBetween(doc: Doc, a: number, c: number): number | undefined {
  for (const bid of doc.adj.get(a) ?? []) { const b = doc.bonds.get(bid)!; if (b.a1 === c || b.a2 === c) return bid; }
  return undefined;
}

/** The bonds round a ring, in order. */
export function ringBonds(doc: Doc, ring: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < ring.length; i++) { const b = bondBetween(doc, ring[i], ring[(i + 1) % ring.length]); if (b !== undefined) out.push(b); }
  return out;
}

/** Is this ring drawn with a circle (every bond round it aromatic and circled)? */
export function isCircleRing(doc: Doc, ring: number[]): boolean {
  const bs = ringBonds(doc, ring);
  return bs.length === ring.length && bs.every((id) => { const b = doc.bonds.get(id)!; return b.order === 1.5 && !!b.circle; });
}

/** Centre of a ring and the radius its circle is drawn at (well inside the bonds). */
export function ringCircle(doc: Doc, ring: number[]): { center: Vec; radius: number } {
  let x = 0, y = 0;
  for (const id of ring) { const a = doc.atoms.get(id)!; x += a.x; y += a.y; }
  const center = { x: x / ring.length, y: y / ring.length };
  // distance from the centre to the nearest bond middle
  let apothem = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const p = doc.atoms.get(ring[i])!, q = doc.atoms.get(ring[(i + 1) % ring.length])!;
    apothem = Math.min(apothem, Math.hypot((p.x + q.x) / 2 - center.x, (p.y + q.y) / 2 - center.y));
  }
  return { center, radius: 0.62 * apothem };
}

/**
 * Is this ring aromatic as drawn? Every atom round it has a double bond within a ring (its own,
 * or a ring fused to it, as in naphthalene), except that a five-membered ring may have one N, O,
 * S or negatively charged atom without (pyrrole, furan, cyclopentadienide) and a seven-membered
 * ring one positive carbon (tropylium). A double bond out of the ring (a quinone's C=O) doesn't count.
 */
function kekuleAromatic(doc: Doc, ring: number[]): boolean {
  const n = ring.length;
  if (n < 5 || n > 7) return false;
  const bs = ringBonds(doc, ring).map((id) => doc.bonds.get(id)!);
  if (bs.length !== n || bs.some((b) => b.order !== 1 && b.order !== 2 && b.order !== 1.5)) return false;
  const ringDouble = (id: number) => [...(doc.adj.get(id) ?? [])].some((bid) => {
    const b = doc.bonds.get(bid)!;
    return (b.order === 2 || b.order === 1.5) && doc.ringThroughBond(bid) !== null;
  });
  const free = ring.filter((id) => !ringDouble(id));
  if (n === 6) return free.length === 0;
  if (free.length !== 1) return false;
  const a = doc.atoms.get(free[0])!;
  if (n === 5) return [7, 8, 15, 16, 34].includes(a.z) || a.charge < 0;
  return a.charge > 0;
}

/** Rings that use these bonds (every ring in the drawing when `bonds` is empty). */
function ringsAmong(doc: Doc, bonds: Iterable<number>): number[][] {
  const seen = new Map<string, number[]>();
  const ids = [...bonds];
  for (const id of ids.length ? ids : doc.bonds.keys()) for (const r of ringsThroughBond(doc, id)) seen.set(key(r), r);
  return [...seen.values()];
}

/** Draw the aromatic rings among these bonds (all, when empty) with circles. Returns how many. */
export function circleRings(doc: Doc, bonds: Iterable<number>): number {
  const rings = ringsAmong(doc, bonds).filter((r) => !isCircleRing(doc, r) && kekuleAromatic(doc, r));
  // an NH (pyrrole, indole) keeps its H as a written label, which aromatic bonds alone can't show
  const nh = new Set<number>();
  for (const r of rings) {
    for (const id of r) {
      const a = doc.atoms.get(id)!;
      if (a.label || a.charge || !(a.z === 7 || a.z === 15)) continue;
      if (implicitHydrogens(a.z, doc.valenceSum(id), 0) > 0 && ![...(doc.adj.get(id) ?? [])].some((b) => doc.bonds.get(b)!.order === 2)) nh.add(id);
    }
  }
  for (const r of rings) for (const id of ringBonds(doc, r)) doc.updateBond(id, { order: 1.5, circle: true });
  for (const id of nh) doc.updateAtom(id, { label: SYMBOLS[doc.atoms.get(id)!.z] + 'H' });
  return rings.length;
}

/** Make one ring's bonds circled aromatic bonds (a ring just drawn with Ctrl held). */
export function circleRing(doc: Doc, ring: number[]): void {
  for (const id of ringBonds(doc, ring)) doc.updateBond(id, { order: 1.5, circle: true });
}

/**
 * Put alternating single and double bonds back in circled rings among these bonds (all, when
 * empty). Every carbon gets one double bond; N, O, S and charged atoms may go without (pyrrole
 * NH, furan O). Returns how many rings changed, or −1 when no such pattern exists.
 */
export function kekulize(doc: Doc, bonds: Iterable<number>): number {
  const rings = ringsAmong(doc, bonds).filter((r) => isCircleRing(doc, r));
  if (!rings.length) return 0;
  // all circled bonds joined to these rings (a fused system has to be done as one)
  const todo = new Set<number>();
  const stack = rings.flatMap((r) => ringBonds(doc, r));
  while (stack.length) {
    const id = stack.pop()!;
    if (todo.has(id)) continue;
    todo.add(id);
    const b = doc.bonds.get(id)!;
    for (const a of [b.a1, b.a2]) for (const n of doc.adj.get(a) ?? []) { const o = doc.bonds.get(n)!; if (o.circle && o.order === 1.5 && !todo.has(n)) stack.push(n); }
  }
  const atoms = [...new Set([...todo].flatMap((id) => { const b = doc.bonds.get(id)!; return [b.a1, b.a2]; }))];
  // an atom already double-bonded outside the rings (a quinone's C=O) needs none inside
  const optional = (id: number) => {
    const a = doc.atoms.get(id)!;
    if (a.z !== 6 || a.charge !== 0) return true;
    return [...(doc.adj.get(id) ?? [])].some((bid) => !todo.has(bid) && doc.bonds.get(bid)!.order === 2);
  };
  const paired = new Map<number, number>();
  const chosen = new Set<number>();
  const solve = (i: number): boolean => {
    if (i === atoms.length) return true;
    const a = atoms[i];
    if (paired.has(a)) return solve(i + 1);
    for (const bid of doc.adj.get(a) ?? []) {
      if (!todo.has(bid)) continue;
      const b = doc.bonds.get(bid)!;
      const o = b.a1 === a ? b.a2 : b.a1;
      if (paired.has(o)) continue;
      paired.set(a, o); paired.set(o, a); chosen.add(bid);
      if (solve(i + 1)) return true;
      paired.delete(a); paired.delete(o); chosen.delete(bid);
    }
    return optional(a) && solve(i + 1);
  };
  if (!solve(0)) return -1;
  for (const id of todo) doc.updateBond(id, { order: chosen.has(id) ? 2 : 1, circle: undefined });
  // an NH label written when the ring was circled goes back to an automatic one
  for (const id of atoms) {
    const a = doc.atoms.get(id)!;
    if (a.label === SYMBOLS[a.z] + 'H' && !paired.has(id) && implicitHydrogens(a.z, doc.valenceSum(id), a.charge) === 1) doc.updateAtom(id, { label: null });
  }
  return rings.length;
}
