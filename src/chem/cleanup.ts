// Clean Up Structure: redraw a structure with even bond lengths and angles while keeping its
// overall shape and which way round everything is.
//
// Rings become regular polygons, fused on the same sides as drawn. Chains zig-zag at 120°,
// turning the same way as drawn. Around every atom the neighbours keep their order, so wedged
// stereocentres and cis/trans double bonds mean the same after the clean-up. The result is
// turned to match the original as closely as possible, squared to the 30° grid, and put back
// where the structure was. Ring systems that can't be made of regular polygons (bridged
// rings such as norbornane) keep their drawn shape, resized.

import { Vec, add, sub, mul, dist, cross, angleOf, fromAngle, normAngle, DEG } from '../geom';
import type { Doc } from '../model';
import { bondLength } from './chemgeom';

export interface CleanAtom {
  x: number;
  y: number;
  /** Keep the neighbours in their drawn order round this atom even when that looks odd (a stereocentre). */
  keepOrder?: boolean;
  /** Drawn with a label (N, OH, CO2Me…), so it needs more room. */
  labelled?: boolean;
}
/** The two atoms (indexes into the atom list) and the bond order. */
export type CleanBond = [number, number, number];

/** New positions for the atoms (same order), with bonds `L` long. */
export function cleanUp(atoms: CleanAtom[], bonds: CleanBond[], L: number): Vec[] {
  const n = atoms.length;
  if (n === 0) return [];
  const orig = atoms.map((a) => ({ x: a.x, y: a.y }));
  if (n === 1) return orig;
  const g = new Graph(n, bonds);
  const keep = atoms.map((a) => !!a.keepOrder);
  const labelled = atoms.map((a) => !!a.labelled);
  const out: Vec[] = new Array(n);
  for (const comp of g.components()) {
    const pos = layoutComponent(g, orig, keep, labelled, comp, L);
    for (const i of comp) out[i] = pos.get(i)!;
  }
  return out;
}

/** New places for the atoms of some structures in a drawing (only the atoms that move). */
export function cleanUpMoves(doc: Doc, structures: Iterable<Set<number>>): [number, Vec][] {
  const moves: [number, Vec][] = [];
  for (const f of structures) {
    if (f.size < 2) continue;
    const ids = [...f];
    const index = new Map(ids.map((id, i) => [id, i]));
    const bonds: CleanBond[] = [];
    const stereo = new Set<number>();
    for (const id of ids) for (const bid of doc.adj.get(id) ?? []) {
      const b = doc.bonds.get(bid)!;
      if (b.a1 !== id || !index.has(b.a2)) continue;
      bonds.push([index.get(b.a1)!, index.get(b.a2)!, b.order]);
      if (b.display === 'wedge' || b.display === 'hashWedge') stereo.add(b.a1); // the stereocentre is at the narrow end
    }
    const atoms = ids.map((id) => { const a = doc.atoms.get(id)!; return { x: a.x, y: a.y, keepOrder: stereo.has(id), labelled: a.z !== 6 || !!a.label }; });
    // the bond length the structure is drawn at (structures drawn smaller or larger keep their size)
    const out = cleanUp(atoms, bonds, bondLength(doc, doc.atoms.get(ids[0])));
    out.forEach((p, i) => { if (dist(p, atoms[i]) > 1e-3) moves.push([ids[i], p]); });
  }
  return moves;
}

// ------------------------------------------------------------------ the graph

class Graph {
  nbr: number[][];
  private orders = new Map<string, number>();
  constructor(public n: number, bonds: CleanBond[]) {
    this.nbr = Array.from({ length: n }, () => []);
    for (const [a, b, o] of bonds) {
      if (a === b || this.orders.has(key(a, b))) continue;
      this.nbr[a].push(b);
      this.nbr[b].push(a);
      this.orders.set(key(a, b), o);
    }
  }
  order(a: number, b: number): number {
    return this.orders.get(key(a, b)) ?? 1;
  }
  components(): number[][] {
    const seen = new Uint8Array(this.n);
    const out: number[][] = [];
    for (let s = 0; s < this.n; s++) {
      if (seen[s]) continue;
      const comp = [s];
      seen[s] = 1;
      for (let k = 0; k < comp.length; k++) for (const j of this.nbr[comp[k]]) if (!seen[j]) { seen[j] = 1; comp.push(j); }
      out.push(comp);
    }
    return out;
  }
  /** Bonds in rings: everything except bridges (Tarjan). */
  ringBonds(): Set<string> {
    const disc = new Int32Array(this.n).fill(-1), low = new Int32Array(this.n);
    const bridges = new Set<string>();
    let t = 0;
    for (let s = 0; s < this.n; s++) {
      if (disc[s] >= 0) continue;
      // iterative DFS: [node, parent, next neighbour index]
      const stack: [number, number, number][] = [[s, -1, 0]];
      disc[s] = low[s] = t++;
      while (stack.length) {
        const top = stack[stack.length - 1];
        const [u, p] = top;
        if (top[2] < this.nbr[u].length) {
          const w = this.nbr[u][top[2]++];
          if (w === p) continue;
          if (disc[w] < 0) { disc[w] = low[w] = t++; stack.push([w, u, 0]); }
          else low[u] = Math.min(low[u], disc[w]);
        } else {
          stack.pop();
          if (p >= 0) {
            low[p] = Math.min(low[p], low[u]);
            if (low[u] > disc[p]) bridges.add(key(u, p));
          }
        }
      }
    }
    const out = new Set<string>();
    for (let a = 0; a < this.n; a++) for (const b of this.nbr[a]) if (a < b && !bridges.has(key(a, b))) out.add(key(a, b));
    return out;
  }
}

const key = (a: number, b: number) => (a < b ? `${a}-${b}` : `${b}-${a}`);

// ------------------------------------------------------------------ ring systems

interface RingSystem {
  atoms: Set<number>;
  /** Positions in the system's own frame, drawn the same way round as the original. */
  local: Map<number, Vec>;
}

/** Ring systems: groups of atoms joined by ring bonds. */
function ringSystems(g: Graph, comp: number[], ringBonds: Set<string>): Set<number>[] {
  const seen = new Set<number>();
  const out: Set<number>[] = [];
  for (const s of comp) {
    if (seen.has(s) || !g.nbr[s].some((j) => ringBonds.has(key(s, j)))) continue;
    const sys = new Set([s]);
    seen.add(s);
    const stack = [s];
    while (stack.length) {
      const u = stack.pop()!;
      for (const w of g.nbr[u]) if (ringBonds.has(key(u, w)) && !seen.has(w)) { seen.add(w); sys.add(w); stack.push(w); }
    }
    out.push(sys);
  }
  return out;
}

/** The smallest ring through a bond, within a ring system (atoms in order, from a round to b). */
function smallestRing(g: Graph, sys: Set<number>, ringBonds: Set<string>, a: number, b: number): number[] | null {
  const prev = new Map<number, number>([[b, -1]]);
  let frontier = [b];
  while (frontier.length) {
    const next: number[] = [];
    for (const u of frontier) {
      for (const w of g.nbr[u]) {
        if ((u === b && w === a) || !sys.has(w) || !ringBonds.has(key(u, w)) || prev.has(w)) continue;
        prev.set(w, u);
        if (w === a) {
          const path = [a];
          for (let c = u; c !== -1; c = prev.get(c)!) path.push(c);
          return path;
        }
        next.push(w);
      }
    }
    frontier = next;
  }
  return null;
}

/** A set of smallest rings that together cover the system (a cycle basis), smallest first. */
function ringsOf(g: Graph, sys: Set<number>, ringBonds: Set<string>): number[][] | null {
  const edges: string[] = [];
  for (const a of sys) for (const b of g.nbr[a]) if (a < b && sys.has(b) && ringBonds.has(key(a, b))) edges.push(key(a, b));
  const need = edges.length - sys.size + 1;
  const cands = new Map<string, number[]>();
  for (const e of edges) {
    const [a, b] = e.split('-').map(Number);
    const r = smallestRing(g, sys, ringBonds, a, b);
    if (r) cands.set([...r].sort((x, y) => x - y).join(','), r);
  }
  const rings = [...cands.values()].sort((p, q) => p.length - q.length);
  // keep rings whose edge sets are independent (Gaussian elimination over GF(2))
  const index = new Map(edges.map((e, i) => [e, i]));
  const basis: { pivot: number; bits: Uint8Array }[] = [];
  const chosen: number[][] = [];
  for (const r of rings) {
    const bits = new Uint8Array(edges.length);
    for (let i = 0; i < r.length; i++) bits[index.get(key(r[i], r[(i + 1) % r.length]))!] ^= 1;
    for (const bv of basis) if (bits[bv.pivot]) for (let i = 0; i < bits.length; i++) bits[i] ^= bv.bits[i];
    const pivot = bits.indexOf(1);
    if (pivot < 0) continue;
    basis.push({ pivot, bits });
    chosen.push(r);
    if (chosen.length === need) break;
  }
  return chosen.length === need ? chosen : null;
}

/** Signed area: which way round a polygon goes. */
const turning = (pts: Vec[]) => pts.reduce((s, p, i) => s + cross(p, pts[(i + 1) % pts.length]), 0);

/** Regular polygon with side L on edge p→q, centre on the given side (+1 / −1). Starts p, q. */
function polygonOn(p: Vec, q: Vec, n: number, side: number): Vec[] {
  const L = dist(p, q);
  const R = L / (2 * Math.sin(Math.PI / n));
  const mid = mul(add(p, q), 0.5);
  const apo = Math.sqrt(Math.max(0, R * R - (L * L) / 4));
  const d = sub(q, p);
  const c = add(mid, mul({ x: -d.y / L, y: d.x / L }, side * apo));
  const a0 = angleOf(sub(p, c));
  let step = normAngle(angleOf(sub(q, c)) - a0);
  if (step > Math.PI) step -= 2 * Math.PI;
  return Array.from({ length: n }, (_, i) => (i === 0 ? p : i === 1 ? q : add(c, fromAngle(a0 + i * step, R))));
}

/** Lay out a ring system from regular polygons, or null if it can't be done (bridged rings). */
function regularRings(g: Graph, orig: Vec[], sys: Set<number>, ringBonds: Set<string>, L: number): Map<number, Vec> | null {
  const rings = ringsOf(g, sys, ringBonds);
  if (!rings || rings.some((r) => r.length > 12)) return null;
  const pos = new Map<number, Vec>();
  const done = new Set<number>();
  // start with the ring fused to the most others
  const shares = (r: number[], s: number[]) => r.filter((x) => s.includes(x)).length;
  let first = 0, most = -1;
  rings.forEach((r, i) => {
    const k = rings.filter((s, j) => j !== i && shares(r, s) >= 2).length;
    if (k > most) { most = k; first = i; }
  });
  {
    const r = rings[first];
    const sense = Math.sign(turning(r.map((i) => orig[i]))) || 1;
    const R = L / (2 * Math.sin(Math.PI / r.length));
    r.forEach((a, k) => pos.set(a, fromAngle((sense * 2 * Math.PI * k) / r.length, R)));
    done.add(first);
  }
  while (done.size < rings.length) {
    // next: the ring sharing most atoms with what is placed
    let next = -1, best = 0;
    rings.forEach((r, i) => {
      if (done.has(i)) return;
      const k = r.filter((a) => pos.has(a)).length;
      if (k > best) { best = k; next = i; }
    });
    if (next < 0) return null;
    const r = rings[next];
    const m = r.length;
    const placed = r.map((a) => pos.has(a));
    if (best === 1) {
      // spiro: the ring sits on the shared atom, away from what is there, the same way round as drawn
      const k = placed.indexOf(true);
      const a = r[k];
      // straight out from the rings already there, or as drawn if that is unclear
      const around = g.nbr[a].filter((x) => pos.has(x)).map((x) => pos.get(x)!);
      let dir = around.length ? sub(pos.get(a)!, centroid(around)) : { x: 0, y: 0 };
      if (Math.hypot(dir.x, dir.y) < L * 1e-3) dir = fromAngle(angleOf(sub(centroid(r.map((i) => orig[i])), orig[a])) - fitAngle(orig, pos));
      dir = fromAngle(angleOf(dir));
      const R = L / (2 * Math.sin(Math.PI / m));
      const c = add(pos.get(a)!, mul(dir, R));
      const sense = Math.sign(turning(r.map((i) => orig[i]))) || 1;
      const a0 = angleOf(sub(pos.get(a)!, c));
      for (let j = 1; j < m; j++) pos.set(r[(k + j) % m], add(c, fromAngle(a0 + (sense * 2 * Math.PI * j) / m, R)));
    } else {
      // fused: build the polygon on a shared edge, on the side the ring was drawn
      let k = -1;
      for (let j = 0; j < m; j++) if (placed[j] && placed[(j + 1) % m] && (!placed[(j + 2) % m] || !placed[(j + m - 1) % m])) { k = j; break; }
      if (k < 0) for (let j = 0; j < m; j++) if (placed[j] && placed[(j + 1) % m]) { k = j; break; }
      if (k < 0) return null; // shared atoms not next to each other: bridged
      const u = r[k], w = r[(k + 1) % m];
      const oc = centroid(r.map((i) => orig[i]));
      const want = Math.sign(cross(sub(orig[w], orig[u]), sub(oc, orig[u]))) || 1;
      const pu = pos.get(u)!, pw = pos.get(w)!;
      let poly = polygonOn(pu, pw, m, 1);
      const pc = centroid(poly);
      if (Math.sign(cross(sub(pw, pu), sub(pc, pu))) !== want) poly = polygonOn(pu, pw, m, -1);
      // poly[j] belongs to ring atom r[k + j]
      for (let j = 0; j < m; j++) {
        const a = r[(k + j) % m];
        const p = poly[j];
        const had = pos.get(a);
        if (had) { if (dist(had, p) > L * 0.3) return null; }
        else {
          // a new atom must not land on one already placed
          for (const q of pos.values()) if (dist(q, p) < L * 0.3) return null;
          pos.set(a, p);
        }
      }
    }
    done.add(next);
  }
  return pos.size === sys.size ? pos : null;
}

const centroid = (pts: Vec[]): Vec => mul(pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }), 1 / Math.max(1, pts.length));

/** The turn that best lays the new positions over the original ones (no mirror image). */
function fitAngle(orig: Vec[], pos: Map<number, Vec>): number {
  const ids = [...pos.keys()];
  const co = centroid(ids.map((i) => orig[i])), cn = centroid(ids.map((i) => pos.get(i)!));
  let sxx = 0, sxy = 0;
  for (const i of ids) {
    const a = sub(pos.get(i)!, cn), b = sub(orig[i], co);
    sxx += a.x * b.x + a.y * b.y;
    sxy += a.x * b.y - a.y * b.x;
  }
  return Math.atan2(sxy, sxx);
}

function layoutSystem(g: Graph, orig: Vec[], sys: Set<number>, ringBonds: Set<string>, L: number): RingSystem {
  // the drawn shape, resized so the average bond is L long
  let sum = 0, count = 0;
  for (const a of sys) for (const b of g.nbr[a]) if (a < b && sys.has(b)) { sum += dist(orig[a], orig[b]); count++; }
  const k = count && sum > 0 ? L / (sum / count) : 1;
  const c = centroid([...sys].map((i) => orig[i]));
  const drawn = new Map([...sys].map((i) => [i, mul(sub(orig[i], c), k)]));
  const regular = regularRings(g, orig, sys, ringBonds, L);
  // Regular polygons, unless they run into each other where the drawing didn't (rings that are
  // really twisted out of the page, such as the binaphthyl in BINOL)
  const local = regular && closestPair(g, regular) >= Math.min(L * 0.5, closestPair(g, drawn) * 0.9) ? regular : drawn;
  return { atoms: sys, local };
}

/** The shortest distance between two atoms that aren't bonded. */
function closestPair(g: Graph, pos: Map<number, Vec>): number {
  const ids = [...pos.keys()];
  let best = Infinity;
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    if (g.nbr[ids[i]].includes(ids[j])) continue;
    best = Math.min(best, dist(pos.get(ids[i])!, pos.get(ids[j])!));
  }
  return best;
}

// ------------------------------------------------------------------ the whole structure

/** Is the atom straight (a triple bond, or two double bonds)? */
function linear(g: Graph, a: number): boolean {
  if (g.nbr[a].length !== 2) return false;
  const [p, q] = g.nbr[a].map((b) => g.order(a, b));
  return p === 3 || q === 3 || (p === 2 && q === 2);
}

function layoutComponent(g: Graph, orig: Vec[], keep: boolean[], labelled: boolean[], comp: number[], L: number): Map<number, Vec> {
  const pos = new Map<number, Vec>();
  if (comp.length === 1) { pos.set(comp[0], orig[comp[0]]); return pos; }
  const ringBonds = g.ringBonds();
  const systems = ringSystems(g, comp, ringBonds).map((s) => layoutSystem(g, orig, s, ringBonds, L));
  const sysOf = new Map<number, RingSystem>();
  for (const s of systems) for (const a of s.atoms) sysOf.set(a, s);

  const queue: number[] = [];
  const placeSystem = (s: RingSystem, angle: number, shift: Vec) => {
    for (const [a, p] of s.local) {
      const c = Math.cos(angle), sn = Math.sin(angle);
      pos.set(a, add({ x: p.x * c - p.y * sn, y: p.x * sn + p.y * c }, shift));
      queue.push(a);
    }
  };

  // start from the biggest ring system, or the most connected atom
  if (systems.length) {
    const big = systems.reduce((m, s) => (s.atoms.size > m.atoms.size ? s : m));
    placeSystem(big, 0, { x: 0, y: 0 });
  } else {
    const root = comp.reduce((m, a) => (g.nbr[a].length > g.nbr[m].length ? a : m));
    pos.set(root, { x: 0, y: 0 });
    queue.push(root);
  }

  // original angle of each neighbour round an atom, for keeping their order
  const oang = (a: number, b: number) => angleOf(sub(orig[b], orig[a]));
  // which way the path p → a → b turned as drawn (+1 / −1), +1 when drawn straight
  const drawnTurn = (a: number, p: number, b: number) => {
    const u = sub(orig[p], orig[a]), w = sub(orig[b], orig[a]);
    const c = cross(u, w);
    return Math.abs(c) > 0.02 * Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y) ? Math.sign(c) : 1;
  };
  while (queue.length) {
    const a = queue.shift()!;
    const all = g.nbr[a];
    const todo = all.filter((b) => !pos.has(b));
    if (!todo.length) continue;
    const pa = pos.get(a)!;
    // neighbours in their drawn order round the atom
    const order = [...all].sort((p, q) => normAngle(oang(a, p) - oang(a, all[0])) - normAngle(oang(a, q) - oang(a, all[0])));
    const dirs = new Map<number, number>();
    const done = order.filter((b) => pos.has(b));
    const nang = (b: number) => angleOf(sub(pos.get(b)!, pa));
    if (done.length === 0) {
      // the lone starting atom: first neighbour as drawn (squared to 30°), the rest spread round
      const a0 = Math.round(oang(a, order[0]) / (30 * DEG)) * 30 * DEG;
      if (all.length === 2 && !linear(g, a)) {
        dirs.set(order[0], a0);
        dirs.set(order[1], a0 + drawnTurn(a, order[0], order[1]) * 120 * DEG);
      } else {
        order.forEach((b, k) => dirs.set(b, a0 + (k * 2 * Math.PI) / all.length));
      }
    } else if (done.length === 1) {
      const p = done[0];
      const base = nang(p);
      if (all.length === 2) {
        const b = todo[0];
        if (linear(g, a)) dirs.set(b, base + Math.PI);
        else {
          // Next to a double bond, turn the way it was drawn (keeps cis/trans). Elsewhere zig-zag:
          // turn against the turn before, or the way it was drawn after a branch or a ring.
          const before = g.nbr[p].length === 2 ? g.nbr[p].find((q) => q !== a && pos.has(q)) : undefined;
          const s = g.order(p, a) === 2 || g.order(a, b) === 2 || before === undefined
            ? drawnTurn(a, p, b)
            : -(Math.sign(cross(sub(pos.get(before)!, pos.get(p)!), sub(pa, pos.get(p)!))) || 1);
          dirs.set(b, base + s * 120 * DEG);
        }
      } else {
        // spread evenly, in the drawn order going round from the placed neighbour
        const k0 = order.indexOf(p);
        const step = (2 * Math.PI) / all.length;
        for (let k = 1; k < all.length; k++) dirs.set(order[(k0 + k) % all.length], base + k * step);
      }
    } else {
      // between placed neighbours: each run of new ones goes in the gap where it was drawn
      const m = order.length;
      const runs: { from: number; gap: number; run: number[] }[] = [];
      for (let k = 0; k < m; k++) {
        if (!pos.has(order[k])) continue;
        const run: number[] = [];
        let j = (k + 1) % m;
        while (!pos.has(order[j])) { run.push(order[j]); j = (j + 1) % m; }
        const from = nang(order[k]);
        let gap = normAngle(nang(order[j]) - from);
        if (gap < 1e-9) gap = 2 * Math.PI;
        runs.push({ from, gap, run });
      }
      // A substituent drawn inside a ring goes outside, in the widest gap, unless the order of the
      // bonds round this atom matters (a stereocentre).
      const filled = runs.filter((r) => r.run.length);
      if (!keep[a] && filled.length === 1) {
        const wide = runs.reduce((w, r) => (r.gap > w.gap + 1e-6 ? r : w));
        if (wide !== filled[0]) { wide.run = filled[0].run; filled[0].run = []; }
      }
      for (const { from, gap, run } of runs) run.forEach((b, i) => dirs.set(b, from + (gap * (i + 1)) / (run.length + 1)));
    }
    for (const b of todo) {
      const ang = dirs.get(b)!;
      const s = sysOf.get(b);
      if (!s) {
        pos.set(b, add(pa, fromAngle(ang, L)));
        queue.push(b);
        continue;
      }
      // a ring system hangs off this atom: turn it so its atom points back along the bond
      const lb = s.local.get(b)!;
      const ringNbrs = g.nbr[b].filter((x) => s.atoms.has(x)).map((x) => s.local.get(x)!);
      const out = ringNbrs.length ? sub(lb, centroid(ringNbrs)) : mul(lb, -1);
      const angle = ang + Math.PI - angleOf(out);
      const c = Math.cos(angle), sn = Math.sin(angle);
      const rb = { x: lb.x * c - lb.y * sn, y: lb.x * sn + lb.y * c };
      placeSystem(s, angle, sub(add(pa, fromAngle(ang, L)), rb));
    }
  }

  untangle(g, pos, keep, labelled, ringBonds, L);

  // lay the result over the original, square it to the 30° grid, and put it back in place
  const rot = fitAngle(orig, pos);
  const ids = [...pos.keys()];
  let sx = 0, sy = 0, count = 0;
  for (const a of ids) for (const b of g.nbr[a]) {
    if (a > b) continue;
    const t = 6 * (angleOf(sub(pos.get(b)!, pos.get(a)!)) + rot);
    sx += Math.cos(t); sy += Math.sin(t); count++;
  }
  // bonds at 30°, 90°, 150°…: six times the angle is 180°. Only when most bonds agree (not for
  // five-membered rings or bridged shapes kept as drawn).
  let snap = 0;
  if (count && Math.hypot(sx, sy) > 0.5 * count) {
    snap = (Math.PI - Math.atan2(sy, sx)) / 6;
    snap = Math.atan2(Math.sin(6 * snap), Math.cos(6 * snap)) / 6;
  }
  const total = rot + snap;
  const cn = centroid(ids.map((i) => pos.get(i)!)), co = centroid(ids.map((i) => orig[i]));
  const c = Math.cos(total), sn = Math.sin(total);
  for (const i of ids) {
    const p = sub(pos.get(i)!, cn);
    pos.set(i, add(co, { x: p.x * c - p.y * sn, y: p.x * sn + p.y * c }));
  }
  return pos;
}

// ------------------------------------------------------------------ crowding

/**
 * How badly atoms that aren't bonded sit on top of each other (0 when none are too close). Two
 * labels need more room than two bare carbons.
 */
function crowding(g: Graph, pos: Map<number, Vec>, ids: number[], labelled: boolean[], L: number): { score: number; pairs: [number, number][] } {
  const reach = L * 1.15;
  let score = 0;
  const pairs: [number, number][] = [];
  for (let i = 0; i < ids.length; i++) {
    const p = pos.get(ids[i])!;
    for (let j = i + 1; j < ids.length; j++) {
      const q = pos.get(ids[j])!;
      if (Math.abs(p.x - q.x) >= reach || Math.abs(p.y - q.y) >= reach) continue;
      const near = labelled[ids[i]] && labelled[ids[j]] ? reach : L * 0.8;
      const d = dist(p, q);
      if (d < near && !g.nbr[ids[i]].includes(ids[j])) { score += near - d; pairs.push([ids[i], ids[j]]); }
    }
  }
  return { score, pairs };
}

/**
 * Where atoms land on top of each other (crowded branches, chains that curl round), swing or
 * mirror a branch out of the way: turn it by 30° about the atom it hangs from, or mirror it
 * across its bond when that can't change any stereochemistry.
 */
function untangle(g: Graph, pos: Map<number, Vec>, keep: boolean[], labelled: boolean[], ringBonds: Set<string>, L: number): void {
  const ids = [...pos.keys()];
  if (ids.length > 600) return;
  for (let round = 0; round < 6; round++) {
    const now = crowding(g, pos, ids, labelled, L);
    if (!now.pairs.length) return;
    let best: Map<number, Vec> | null = null, bestScore = now.score - 1e-6;
    for (const [u, v] of now.pairs.slice(0, 4)) {
      for (const [x, y] of pathBonds(g, u, v)) {
        if (ringBonds.has(key(x, y))) continue;
        for (const [from, to] of [[x, y], [y, x]]) {
          const side = sideOf(g, from, to);
          if (side.length > ids.length / 2 + 1) continue;
          const pf = pos.get(from)!;
          // a turn bends a bond angle away from 120°, so a mirror image is better when both work
          const tries: [(p: Vec) => Vec, number][] = [30, -30].map((deg) => {
            const c = Math.cos(deg * DEG), sn = Math.sin(deg * DEG);
            return [(p: Vec) => { const d = sub(p, pf); return add(pf, { x: d.x * c - d.y * sn, y: d.x * sn + d.y * c }); }, L * 0.1];
          });
          // mirroring a branch turns its stereocentres over and, for a double bond, swaps cis/trans
          if (g.order(from, to) !== 2 && !side.some((a) => keep[a])) {
            const axis = sub(pos.get(to)!, pf);
            const k = 1 / (axis.x * axis.x + axis.y * axis.y);
            tries.push([(p: Vec) => {
              const d = sub(p, pf);
              const t = (d.x * axis.x + d.y * axis.y) * k;
              return add(pf, sub(mul(axis, 2 * t), d));
            }, 0]);
          }
          for (const [f, cost] of tries) {
            const moved = new Map(pos);
            for (const a of side) moved.set(a, f(pos.get(a)!));
            const sc = crowding(g, moved, ids, labelled, L).score + cost;
            if (sc < bestScore) { bestScore = sc; best = moved; }
          }
        }
      }
    }
    if (!best) return;
    for (const [a, p] of best) pos.set(a, p);
  }
}

/** The bonds on the path between two atoms. */
function pathBonds(g: Graph, u: number, v: number): [number, number][] {
  const prev = new Map<number, number>([[u, -1]]);
  const queue = [u];
  for (let k = 0; k < queue.length && !prev.has(v); k++) {
    for (const w of g.nbr[queue[k]]) if (!prev.has(w)) { prev.set(w, queue[k]); queue.push(w); }
  }
  const out: [number, number][] = [];
  for (let c = v; prev.get(c)! >= 0 && prev.has(c); c = prev.get(c)!) out.push([prev.get(c)!, c]);
  return out;
}

/** The atoms on `to`'s side of the bond from–to (which is not in a ring). */
function sideOf(g: Graph, from: number, to: number): number[] {
  const seen = new Set([from, to]);
  const out = [to];
  for (let k = 0; k < out.length; k++) for (const w of g.nbr[out[k]]) if (!seen.has(w)) { seen.add(w); out.push(w); }
  return out;
}
