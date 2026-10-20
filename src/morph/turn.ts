// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Motions read off the two drawings with nothing marked: a group turning about a single bond (or
// a ring turning over about a diagonal), and a benzene whose double bonds are only drawn in the
// other three places (which should switch in one frame, not pulse round the ring).

import type { Vec } from '../geom';
import { median, procrustes, apply } from './assign';
import { doubleRing, alternating, type MScene } from './scene';
import { matchBonds, type NodeMap } from './match';

export interface TurnPlan {
  bond: string | null;
  theta: number;
  origin: Vec;
  axis: Vec;
  along: number;
  swing: number;
  degrees: number;
  /** The two drawings' common offset, removed while measuring and put back on the way out. */
  shift: Vec;
  group: string[];
  /** Per turning atom: offset across the axis, its out-of-page part, and along the axis at each end. */
  solved: Map<string, [number, number, number, number]>;
  mirror?: boolean;
  /** Further groups turning about their own axes in the same step. */
  more?: TurnPlan[];
}

const dotv = (a: Vec, b: Vec) => a.x * b.x + a.y * b.y;
const subv = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });

function common(A: MScene, B: MScene, nmap: NodeMap, fixedTol: number) {
  const pa = new Map<string, Vec>(), pb = new Map<string, Vec>();
  for (const [k, v] of nmap) { pa.set(k, A.nodes.get(k)!.p); pb.set(k, B.nodes.get(v)!.p); }
  const ks = [...nmap.keys()];
  const med = { x: median(ks.map((k) => pb.get(k)!.x - pa.get(k)!.x)), y: median(ks.map((k) => pb.get(k)!.y - pa.get(k)!.y)) };
  const res = new Map<string, number>();
  for (const k of ks) res.set(k, Math.hypot(pb.get(k)!.x - pa.get(k)!.x - med.x, pb.get(k)!.y - pa.get(k)!.y - med.y));
  const movers = new Set(ks.filter((k) => res.get(k)! > fixedTol));
  return { pa, pb, med, res, movers };
}

/**
 * A fragment turned over about a line through two atoms (a ring flipping: two atoms stay put
 * while the rest swap sides), or null. Every moving atom keeps its coordinate along the axis and
 * has its coordinate across it negated: a half turn.
 */
export function mirrorTurn(A: MScene, B: MScene, nmap: NodeMap, fixedTol = 0.5, alongTol = 0.5, minAcross = 1): TurnPlan | null {
  if (nmap.size < 4) return null;
  const { pa, pb, med, res, movers } = common(A, B, nmap, fixedTol);
  if (!movers.size) return null;
  const nb = A.nbr;
  const seen = new Set<string>();
  let best: { rank: [number, number]; o: Vec; ax: Vec; nr: Vec; grp: string[]; worst: number } | null = null;
  for (const bid of A.bonds.keys()) {
    const ring = doubleRing(A, bid);
    if (!ring) continue;
    const key = [...ring].sort().join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    const still = ring.filter((k) => res.has(k) && res.get(k)! <= fixedTol);
    if (still.length !== 2 || !ring.some((k) => movers.has(k))) continue;
    const o = pa.get(still[0])!;
    const d = subv(pa.get(still[1])!, o);
    const n = Math.hypot(d.x, d.y);
    if (n < 1e-9) continue;
    const ax = { x: d.x / n, y: d.y / n };
    const nr = { x: -ax.y, y: ax.x };
    const grp: string[] = [];
    let worst = 0;
    for (const k of nmap.keys()) {
      const q = subv(subv(pb.get(k)!, med), o), r = subv(pa.get(k)!, o);
      const a0 = dotv(r, nr), a1 = dotv(q, nr), l0 = dotv(r, ax), l1 = dotv(q, ax);
      if (Math.abs(a0) > minAcross && Math.abs(a1 + a0) < alongTol && Math.abs(l1 - l0) < alongTol) {
        grp.push(k);
        worst = Math.max(worst, Math.abs(a1 + a0), Math.abs(l1 - l0));
      }
    }
    if (grp.length < 3 || !grp.some((k) => movers.has(k))) continue;
    // carry along what hangs off the fragment that the next drawing leaves out
    const extra = [...A.nodes.keys()].filter((k) => !nmap.has(k) && nb.get(k)!.some((x) => grp.includes(x)));
    const rank: [number, number] = [-grp.length, worst];
    if (!best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && rank[1] < best.rank[1])) best = { rank, o, ax, nr, grp: [...grp, ...extra], worst };
  }
  if (!best) return null;
  const { o, ax, nr, grp, worst } = best;
  const solved = new Map<string, [number, number, number, number]>();
  for (const k of grp) {
    const r = subv(A.nodes.get(k)!.p, o);
    const a0 = dotv(r, nr), l0 = dotv(r, ax);
    const l1 = pb.has(k) ? dotv(subv(subv(pb.get(k)!, med), o), ax) : l0;
    solved.set(k, [a0, 0, l0, l1]);
  }
  return { bond: null, theta: Math.PI, origin: o, axis: ax, along: worst, swing: 0, degrees: 180, shift: med, group: [...grp].sort(), solved, mirror: true };
}

/**
 * How a group turns about a single bond, or null. A group turning about a bond in 3-D keeps
 * every atom's coordinate along the bond while its coordinate across the bond changes; that
 * names the bond, and the bond lengths pin the angle (only its size: a flat drawing can't tell
 * towards the viewer from away).
 */
export function turnPlan(A: MScene, B: MScene, nmap: NodeMap, fixedTol = 0.5, alongTol = 0.5, minAcross = 1, minTurn = 15, depth = 0): TurnPlan | null {
  if (nmap.size < 4) return null;
  const { pa, pb, med, res, movers } = common(A, B, nmap, fixedTol);
  if (!movers.size || nmap.size - movers.size < 3) return null;
  const nb = A.nbr;
  const all = A.nodes.size;
  let big = '';
  for (const k of movers) if (!big || res.get(k)! > res.get(big)!) big = k;
  let best: { rank: [number, number, number]; bid: string; grp: Set<string>; along: number; o: Vec; ax: Vec; nr: Vec; swing: number } | null = null;
  for (const [bid, bd] of A.bonds) {
    const u = bd.b, v = bd.e;
    if (bd.order !== 1 || movers.has(u) || movers.has(v) || !pa.has(u) || !pa.has(v)) continue;
    const sides: Set<string>[] = [];
    for (const [seed, block] of [[u, v], [v, u]]) {
      const seen = new Set([seed]);
      const stack = [seed];
      while (stack.length) {
        const x = stack.pop()!;
        for (const y of nb.get(x)!) {
          if (x === seed && y === block) continue;
          if (!seen.has(y)) { seen.add(y); stack.push(y); }
        }
      }
      sides.push(seen);
    }
    if (sides[0].size + sides[1].size !== all) continue; // a ring bond is not free to turn
    const side = sides.find((s) => s.has(big));
    if (!side) continue;
    const grp = new Set([...side].filter((k) => k !== u && k !== v));
    if (!grp.size) continue;
    const inside = [...grp].filter((k) => movers.has(k));
    if (inside.length < 2) continue;
    const o = pa.get(u)!;
    const d = subv(pa.get(v)!, o);
    const n = Math.hypot(d.x, d.y);
    if (n < 1e-9) continue;
    const ax = { x: d.x / n, y: d.y / n }, nr = { x: -ax.y, y: ax.x };
    let along = 0, swing = 0;
    for (const k of inside) {
      const q = subv(subv(pb.get(k)!, med), o), r = subv(pa.get(k)!, o);
      along = Math.max(along, Math.abs(dotv(q, ax) - dotv(r, ax)));
      swing = Math.max(swing, Math.abs(dotv(q, nr) - dotv(r, nr)));
    }
    if (along > alongTol || swing < minAcross) continue;
    const rank: [number, number, number] = [-inside.length, grp.size, along];
    const better = !best || rank[0] < best.rank[0] || (rank[0] === best.rank[0] && (rank[1] < best.rank[1] || (rank[1] === best.rank[1] && rank[2] < best.rank[2])));
    if (better) best = { rank, bid, grp, along, o, ax, nr, swing };
  }
  if (!best) return mirrorTurn(A, B, nmap, fixedTol, alongTol, minAcross);
  const { bid, grp, along, o, ax, nr, swing } = best;
  const ends = [A.bonds.get(bid)!.b, A.bonds.get(bid)!.e];
  const angles: number[] = [];
  for (const k of grp) {
    const host = nb.get(k)!.filter((x) => ends.includes(x));
    if (!host.length || !pa.has(k)) continue;
    const h = pa.get(host[0])!, p = pa.get(k)!;
    const L = Math.hypot(p.x - h.x, p.y - h.y);
    const da = dotv(subv(p, o), ax) - dotv(subv(h, o), ax);
    const r = Math.sqrt(Math.max(L * L - da * da, 0));
    const a0 = dotv(subv(p, o), nr), a1 = dotv(subv(subv(pb.get(k)!, med), o), nr);
    if (r < 1e-6 || Math.max(Math.abs(a0), Math.abs(a1)) > r * 1.05) continue;
    const clip = (x: number) => Math.max(-1, Math.min(1, x));
    angles.push(Math.abs(Math.acos(clip(a1 / r)) - Math.acos(clip(a0 / r))));
  }
  if (!angles.length) return null;
  const theta = median(angles);
  if (Math.abs(theta * 180 / Math.PI) < minTurn) return null;
  const solved = new Map<string, [number, number, number, number]>();
  for (const k of grp) {
    const r = subv(A.nodes.get(k)!.p, o);
    const a0 = dotv(r, nr);
    if (pb.has(k)) {
      const q = subv(subv(pb.get(k)!, med), o);
      const a1 = dotv(q, nr);
      const s = Math.abs(Math.sin(theta)) > 1e-6 ? (a0 * Math.cos(theta) - a1) / Math.sin(theta) : 0;
      solved.set(k, [a0, s, dotv(r, ax), dotv(q, ax)]);
    } else {
      // nothing to land on: carried round with the group as if drawn in the plane
      const l0 = dotv(r, ax);
      solved.set(k, [a0, 0, l0, l0]);
    }
  }
  const plan: TurnPlan = { bond: bid, theta, origin: o, axis: ax, along, swing, degrees: theta * 180 / Math.PI, shift: med, group: [...grp].sort(), solved };
  // one axis explains one group; whatever it didn't explain is searched again
  const rest: NodeMap = new Map([...nmap].filter(([k]) => !solved.has(k)));
  if (depth < 3 && rest.size >= 4) {
    const more = turnPlan(A, B, rest, fixedTol, alongTol, minAcross, minTurn, depth + 1);
    if (more) {
      plan.more = [more, ...(more.more ?? [])];
      delete more.more;
      plan.group = [...new Set([...plan.group, ...plan.more.flatMap((m) => m.group)])].sort();
    }
  }
  return plan;
}

/** Where each turning atom sits at `t` (and how far out of the page). */
export function turnAt(plan: TurnPlan, t: number): Map<string, [Vec, number]> {
  const o = plan.origin, ax = plan.axis;
  const nr = { x: -ax.y, y: ax.x };
  const th = plan.theta * t;
  const shift = { x: plan.shift.x * t, y: plan.shift.y * t };
  const out = new Map<string, [Vec, number]>();
  for (const [k, [a0, s, l0, l1]] of plan.solved) {
    const ac = a0 * Math.cos(th) - s * Math.sin(th);
    const l = l0 * (1 - t) + l1 * t;
    out.set(k, [{ x: o.x + l * ax.x + ac * nr.x + shift.x, y: o.y + l * ax.y + ac * nr.y + shift.y }, a0 * Math.sin(th) + s * Math.cos(th)]);
  }
  for (const sub of plan.more ?? []) for (const [k, v] of turnAt(sub, t)) out.set(k, v);
  return out;
}

/**
 * Extra pairs only the turn can see: a substituent that swapped sides as its group turned sits
 * nowhere near its partner on the page, but once the turn is known it has a landing place.
 * `tol` is a fraction of a bond length.
 */
export function turnPairs(A: MScene, B: MScene, nmap: NodeMap, tol = 0.45): NodeMap {
  const plan = turnPlan(A, B, nmap);
  if (!plan) return new Map();
  const taken = new Set(nmap.values());
  const freeB = [...B.nodes.keys()].filter((k) => !taken.has(k));
  const freeA = plan.group.filter((k) => !nmap.has(k));
  if (!freeA.length || !freeB.length) return new Map();
  const lengths = [...A.bonds.values()].map((b) => { const p = A.nodes.get(b.b)!.p, q = A.nodes.get(b.e)!.p; return Math.hypot(q.x - p.x, q.y - p.y); });
  const near = lengths.length ? tol * median(lengths) : 6;
  const landed = turnAt(plan, 1);
  const out: NodeMap = new Map();
  const used = new Set<string>();
  for (const k of freeA) {
    const l = landed.get(k);
    if (!l) continue;
    const want = l[0];
    let bj = '', bd = Infinity;
    for (const j of freeB) {
      if (used.has(j)) continue;
      const p = B.nodes.get(j)!.p;
      const d = Math.hypot(p.x - want.x, p.y - want.y);
      if (d < bd) { bd = d; bj = j; }
    }
    if (!bj || bd > near) continue;
    if ((A.nodes.get(k)!.label?.shown ?? '') !== (B.nodes.get(bj)!.label?.shown ?? '')) continue;
    out.set(k, bj);
    used.add(bj);
  }
  return out;
}

/** Rings of `size` atoms, each as atom keys in order round it. */
export function ringsOf(sc: MScene, size = 6): string[][] {
  const nb = sc.nbr;
  const seen = new Set<string>();
  const out: string[][] = [];
  for (const start of sc.nodes.keys()) {
    const stack: [string, string[]][] = [[start, [start]]];
    while (stack.length) {
      const [node, path] = stack.pop()!;
      if (path.length === size) {
        if (nb.get(node)!.includes(path[0])) {
          const key = [...path].sort().join(',');
          if (!seen.has(key)) { seen.add(key); out.push(path); }
        }
        continue;
      }
      for (const nxt of nb.get(node)!) {
        if (path.includes(nxt) || nxt < start) continue;
        stack.push([nxt, [...path, nxt]]);
      }
    }
  }
  return out;
}

/**
 * Aromatic rings a pairing turns inside out (atom keys of A): the ring lands on its own mirror
 * image, so its double bonds swap places. Reported so a pairing that does this can be seen.
 */
export function mirroredRings(A: MScene, B: MScene, nmap: NodeMap): string[][] {
  const area = (pts: Vec[]) => { let s = 0; pts.forEach((p, i) => { const q = pts[(i + 1) % pts.length]; s += p.x * q.y - q.x * p.y; }); return s / 2; };
  const out: string[][] = [];
  const seen = new Set<string>();
  for (const bid of A.bonds.keys()) {
    const ring = doubleRing(A, bid);
    if (!ring || !alternating(A, ring)) continue;
    const key = [...ring].sort().join(',');
    if (seen.has(key) || !ring.every((k) => nmap.has(k))) continue;
    seen.add(key);
    if (area(ring.map((k) => A.nodes.get(k)!.p)) * area(ring.map((k) => B.nodes.get(nmap.get(k)!)!.p)) < 0) out.push(ring);
  }
  return out;
}

/**
 * Ring bonds whose double bonds only move round the ring (the other Kekulé form of the same
 * benzene): every ring bond carried through, alternating in both drawings, and every one swapped.
 */
export function kekuleShift(A: MScene, B: MScene, nmap: NodeMap, bmap: Map<string, string>): Set<string> {
  const out = new Set<string>();
  for (const ring of ringsOf(A, 6)) {
    const ids: string[] = [], oa: number[] = [], ob: number[] = [];
    let ok = true;
    for (let i = 0; i < 6; i++) {
      const bid = A.bondBetween(ring[i], ring[(i + 1) % 6]);
      if (bid === undefined || !bmap.has(bid)) { ok = false; break; }
      ids.push(bid);
      oa.push(A.bonds.get(bid)!.order);
      ob.push(B.bonds.get(bmap.get(bid)!)!.order);
    }
    const isAlt = (o: number[]) => [...o].sort().join() === '1,1,1,2,2,2' && !o.some((x, i) => x === o[(i + 1) % 6]);
    if (!ok || !isAlt(oa) || oa.some((x, i) => x === ob[i]) || [...ob].sort().join() !== '1,1,1,2,2,2') continue;
    for (const id of ids) out.add(id);
  }
  void nmap;
  return out;
}

/** When to switch a ring to its other Kekulé form: where it passes edge-on if it turns, else halfway. */
export function kekuleTime(A: MScene, bids: Set<string>, plan: TurnPlan | null): number {
  if (!plan || !bids.size) return 0.5;
  const ring = new Set<string>();
  for (const b of bids) { const bd = A.bonds.get(b)!; ring.add(bd.b); ring.add(bd.e); }
  const grp = new Set(plan.group);
  if (![...ring].every((k) => grp.has(k))) return 0.5;
  const th = Math.abs(plan.theta);
  if (th < 1e-6) return 0.5;
  return Math.min(1, Math.max(0, (Math.PI / 2) / th));
}

/**
 * The axis to turn about when the two drawings are mirror images (only when the person turns
 * this on: it passes through an edge-on view). Null when a plain rotation fits as well.
 */
export function reflectionAxis(A: MScene, B: MScene, nmap: NodeMap, margin = 1.25): [Vec, Vec] | null {
  if (nmap.size < 3) return null;
  const X = [...nmap.keys()].map((k) => A.nodes.get(k)!.p), Y = [...nmap.values()].map((k) => B.nodes.get(k)!.p);
  const rms = (reflect: boolean) => {
    const f = procrustes(X, Y, reflect);
    let e = 0;
    X.forEach((x, i) => { const q = apply(f, x); e += (q.x - Y[i].x) ** 2 + (q.y - Y[i].y) ** 2; });
    return [Math.sqrt(e / X.length), f] as const;
  };
  const [proper] = rms(false);
  const [improper, f] = rms(true);
  if (improper * margin >= proper) return null;
  // the mirror line of [[c, s], [s, −c]] runs at half its angle
  const half = Math.atan2(f.R[2], f.R[0]) / 2;
  let x = 0, y = 0;
  for (const p of X) { x += p.x; y += p.y; }
  return [{ x: x / X.length, y: y / X.length }, { x: Math.cos(half), y: Math.sin(half) }];
}

export { matchBonds };
