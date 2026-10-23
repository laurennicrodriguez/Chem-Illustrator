// Bonds that cross (a bridged ring drawn flat, say): the one in front is drawn whole and the one
// behind it gets a small gap either side, as in ChemDraw. Which is in front is the bond's layer:
// its own number when it has been brought forward or sent back, else the order it was drawn in.

import type { AtomWatch, Bond, Doc } from '../model';
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
  // the bonds doc.bondsNear finds, without its lists (this runs for every bond on a first paint)
  const reach = Math.min(doc.maxBondLength, 200) / 2 + Math.hypot(q.x - p.x, q.y - p.y) / 2, r2 = reach * reach;
  const x1 = Math.min(p.x, q.x), x2 = Math.max(p.x, q.x), y1 = Math.min(p.y, q.y), y2 = Math.max(p.y, q.y);
  for (const a of doc.atomsNear(mid, reach)) {
    for (const bid of doc.adj.get(a.id) ?? []) {
      const o = doc.bonds.get(bid)!;
      if (o.id === b.id || o.a1 === b.a1 || o.a1 === b.a2 || o.a2 === b.a1 || o.a2 === b.a2) continue;
      const r = doc.atoms.get(o.a1)!, s = doc.atoms.get(o.a2)!;
      // each bond once: through its first atom, or its second when the first is out of reach
      if (r !== a && (r.x - mid.x) ** 2 + (r.y - mid.y) ** 2 <= r2) continue;
      if (Math.max(r.x, s.x) < x1 || Math.min(r.x, s.x) > x2 || Math.max(r.y, s.y) < y1 || Math.min(r.y, s.y) > y2) continue;
      if (crossAt(p, q, r, s)) out.push(o);
    }
  }
  return out;
}

/**
 * Stretches of a bond to leave out where bonds in front of it cross: fractions along it, from
 * a1 to a2. `half` is how far the gap reaches either side of the bond in front.
 */
export function crossingGaps(doc: Doc, b: Bond, half: number, crossing = crossingBonds(doc, b)): [number, number][] {
  const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
  const l = Math.hypot(q.x - p.x, q.y - p.y);
  if (l < 1e-6) return [];
  const out: [number, number][] = [];
  const me = bondLayer(b);
  for (const o of crossing) {
    if (bondLayer(o) <= me) continue;
    const c = crossAt(p, q, doc.atoms.get(o.a1)!, doc.atoms.get(o.a2)!);
    if (!c) continue;
    // a shallow crossing needs a longer gap to clear the other bond
    const h = half / Math.max(0.35, c.sin) / l;
    out.push([c.t - h, c.t + h]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/**
 * Crossings and gaps already worked out, kept across edits (a repaint asks for every bond in every tile, and a
 * drag repaints on every move). An edit drops only the entries it could change: those of bonds
 * at or near the atoms it touched, and those that looked at a bond of one of those atoms.
 */
interface GapCache {
  watch: AtomWatch;
  /** Each bond's crossing bonds (ids), and its gaps for the last gap size asked for. */
  bonds: Map<number, { crossing: number[]; half?: number; gaps?: [number, number][] }>;
  /** Atom → bonds whose entry depends on a bond at that atom (one crossing them). */
  users: Map<number, Set<number>>;
}
const gapCache = new WeakMap<Doc, GapCache>();

function freshCache(doc: Doc): GapCache {
  let c = gapCache.get(doc);
  if (!c) gapCache.set(doc, (c = { watch: doc.watchAtoms(), bonds: new Map(), users: new Map() }));
  const w = c.watch;
  if (w.all) {
    w.all = false;
    w.ids.clear();
    c.bonds.clear();
    c.users.clear();
  } else if (w.ids.size) {
    const reach = Math.min(doc.maxBondLength, 200);
    for (const id of w.ids) {
      for (const bid of doc.adj.get(id) ?? []) c.bonds.delete(bid);
      for (const bid of c.users.get(id) ?? []) c.bonds.delete(bid);
      c.users.delete(id);
      // bonds that a bond at this atom may now cross
      const a = doc.atoms.get(id);
      if (a) for (const o of doc.bondsNear(a, reach)) c.bonds.delete(o.id);
    }
    w.ids.clear();
  }
  return c;
}

function entryOf(doc: Doc, b: Bond): { crossing: number[]; half?: number; gaps?: [number, number][] } {
  const c = freshCache(doc);
  let e = c.bonds.get(b.id);
  if (e) return e;
  const crossing = crossingBonds(doc, b);
  c.bonds.set(b.id, (e = { crossing: crossing.map((o) => o.id) }));
  // (the bond's own atoms are found through their bonds when they change)
  const use = (atom: number) => { let s = c.users.get(atom); if (!s) c.users.set(atom, (s = new Set())); s.add(b.id); };
  for (const o of crossing) { use(o.a1); use(o.a2); }
  return e;
}

/** crossingBonds, kept until the drawing changes near the bond. */
export function crossingBondsCached(doc: Doc, b: Bond): Bond[] {
  return entryOf(doc, b).crossing.map((id) => doc.bonds.get(id)!);
}

/** crossingGaps, kept until the drawing changes near the bond. */
export function crossingGapsCached(doc: Doc, b: Bond, half: number): [number, number][] {
  const e = entryOf(doc, b);
  if (e.half !== half || !e.gaps) {
    e.half = half;
    e.gaps = e.crossing.length ? crossingGaps(doc, b, half, e.crossing.map((id) => doc.bonds.get(id)!)) : [];
  }
  return e.gaps;
}

/**
 * Put the bonds at these atoms in front of or behind the bonds they cross by where they lie in
 * 3-D: of two bonds that cross, the one nearer the reader at the crossing is in front (and the
 * other gets the gaps). Only bonds whose atoms both have a depth (drawn in perspective) take
 * part; their layers are renumbered among the layers they had. Call inside an edit.
 */
export function layerByDepth(doc: Doc, atomIds: Iterable<number>): void {
  const deep = (b: Bond) => doc.atoms.get(b.a1)?.depth !== undefined && doc.atoms.get(b.a2)?.depth !== undefined;
  const near = new Map<number, Bond>();
  for (const id of atomIds) for (const bid of doc.adj.get(id) ?? []) {
    const b = doc.bonds.get(bid);
    if (b && deep(b)) near.set(b.id, b);
  }
  // behind → the bonds in front of it
  const inFront = new Map<number, Set<number>>();
  const all = new Map<number, Bond>();
  const depthAt = (b: Bond, t: number) => { const d1 = doc.atoms.get(b.a1)!.depth!, d2 = doc.atoms.get(b.a2)!.depth!; return d1 + (d2 - d1) * t; };
  for (const b of near.values()) {
    const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
    for (const o of crossingBonds(doc, b)) {
      if (!deep(o)) continue;
      const c = crossAt(p, q, doc.atoms.get(o.a1)!, doc.atoms.get(o.a2)!);
      if (!c) continue;
      const db = depthAt(b, c.t), dOther = depthAt(o, c.u);
      if (Math.abs(db - dOther) < 1e-6) continue;
      const [back, front] = db < dOther ? [b, o] : [o, b];
      if (!inFront.has(back.id)) inFront.set(back.id, new Set());
      inFront.get(back.id)!.add(front.id);
      all.set(b.id, b);
      all.set(o.id, o);
    }
  }
  if (!all.size) return;
  // back to front (a bond only after everything behind it); a cycle, which a drawing that is no
  // true projection can have, is broken by the layers the bonds had
  const behind = new Map<number, number>([...all.keys()].map((id) => [id, 0]));
  for (const fronts of inFront.values()) for (const f of fronts) behind.set(f, behind.get(f)! + 1);
  const layers = [...all.values()].map(bondLayer).sort((a, b) => a - b);
  const left = new Set(all.keys());
  const order: number[] = [];
  while (left.size) {
    const ready = [...left].filter((id) => behind.get(id) === 0);
    const pool = ready.length ? ready : [...left];
    const next = pool.reduce((a, b) => (bondLayer(all.get(a)!) <= bondLayer(all.get(b)!) ? a : b));
    left.delete(next);
    order.push(next);
    for (const f of inFront.get(next) ?? []) if (left.has(f)) behind.set(f, behind.get(f)! - 1);
  }
  // the same layers, handed out again in this order (kept distinct, so no two tie)
  let last = -Infinity;
  order.forEach((id, i) => {
    const z = Math.max(layers[i], last + 1);
    last = z;
    if (bondLayer(all.get(id)!) !== z) doc.updateBond(id, { z });
  });
}
