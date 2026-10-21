// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Turning one drawing of a molecule into another drawing of the same molecule in another
// orientation (an equivalency sign between them). A structure ChemDraw builds from a crystal
// file keeps a real 3-D coordinate per atom (its `xyz`), whose first two components are where
// the atom is drawn: the picture is a projection with depth in the third. Two such poses of one
// molecule differ by a rotation, which is measured from them exactly; a hand-drawn structure
// under each pose then turns as its pose turns, borrowing depth from it, and whatever the rigid
// turn misses (a drawing is not a faithful projection) is closed over the same interval, so both
// ends are exactly the drawings as drawn. Nothing here interprets chemistry.

import type { Vec } from '../geom';
import { median, procrustes, mean } from './assign';
import { matchNodes, matchConnectivity, matchBonds, type NodeMap } from './match';
import { ringsOf } from './turn';
import type { MScene } from './scene';

export type V3 = [number, number, number];
type M3 = [number, number, number, number, number, number, number, number, number];

/** Which end of the depth axis faces the reader (checked against ChemDraw's own 3-D exports). */
const FRONT = -1;
/** Atoms a structure needs with 3-D coordinates before it counts as a pose. */
export const MIN_POSE_ATOMS = 3;

export const count3d = (sc: MScene): number => [...sc.nodes.values()].filter((n) => n.xyz).length;

// ------------------------------------------------------------------ 3-D rotations

/** Rodrigues' rotation matrix, row-major. */
export function rotation(axis: V3, ang: number): M3 {
  const [x, y, z] = axis;
  const c = Math.cos(ang), s = Math.sin(ang), k = 1 - c;
  return [
    c + x * x * k, x * y * k - z * s, x * z * k + y * s,
    y * x * k + z * s, c + y * y * k, y * z * k - x * s,
    z * x * k - y * s, z * y * k + x * s, c + z * z * k,
  ];
}

const mul = (R: M3, v: V3): V3 => [R[0] * v[0] + R[1] * v[1] + R[2] * v[2], R[3] * v[0] + R[4] * v[1] + R[5] * v[2], R[6] * v[0] + R[7] * v[1] + R[8] * v[2]];

/** Eigenvector of the largest eigenvalue of a symmetric 4×4 matrix (cyclic Jacobi). */
function topEigen4(A: number[][]): number[] {
  const a = A.map((r) => [...r]);
  const V: number[][] = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] * a[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) {
      if (Math.abs(a[p][q]) < 1e-300) continue;
      const th = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 4; k++) {
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = c * akp - s * akq; a[k][q] = s * akp + c * akq;
      }
      for (let k = 0; k < 4; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = c * apk - s * aqk; a[q][k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 4; k++) {
        const vkp = V[k][p], vkq = V[k][q];
        V[k][p] = c * vkp - s * vkq; V[k][q] = s * vkp + c * vkq;
      }
    }
  }
  let best = 0;
  for (let i = 1; i < 4; i++) if (a[i][i] > a[best][best]) best = i;
  return [0, 1, 2, 3].map((k) => V[k][best]);
}

export interface Fit {
  axis: V3;
  /** Radians, 0…π. */
  angle: number;
  /** How far the rotated first pose sits from the second, on average (points). */
  rmsd: number;
  /** The best fit would be a mirror image: the two poses are not one molecule turned. */
  reflected: boolean;
  /** Atoms it was measured over. */
  n: number;
}

/** The rotation carrying pose SA onto pose SB over a pairing (Horn's quaternion fit). */
export function fitFrom(SA: MScene, SB: MScene, pairs: NodeMap): Fit {
  const ks = [...pairs].filter(([a, b]) => SA.nodes.get(a)?.xyz && SB.nodes.get(b)?.xyz);
  const P = ks.map(([a]) => SA.nodes.get(a)!.xyz!), Q = ks.map(([, b]) => SB.nodes.get(b)!.xyz!);
  const n = P.length;
  if (n < 3) return { axis: [0, 0, 1], angle: 0, rmsd: 0, reflected: false, n };
  const c3 = (L: V3[]): V3 => [0, 1, 2].map((i) => L.reduce((s, v) => s + v[i], 0) / L.length) as V3;
  const pc = c3(P), qc = c3(Q);
  const S = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (let i = 0; i < n; i++) for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) S[r][c] += (P[i][r] - pc[r]) * (Q[i][c] - qc[c]);
  const [[xx, xy, xz], [yx, yy, yz], [zx, zy, zz]] = S;
  const N = [
    [xx + yy + zz, yz - zy, zx - xz, xy - yx],
    [yz - zy, xx - yy - zz, xy + yx, zx + xz],
    [zx - xz, xy + yx, -xx + yy - zz, yz + zy],
    [xy - yx, zx + xz, yz + zy, -xx - yy + zz],
  ];
  let [w, x, y, z] = topEigen4(N);
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const sn = Math.hypot(x, y, z);
  const angle = 2 * Math.atan2(sn, w);
  const axis: V3 = sn > 1e-12 ? [x / sn, y / sn, z / sn] : [0, 0, 1];
  const R = rotation(axis, angle);
  let e = 0;
  for (let i = 0; i < n; i++) {
    const v = mul(R, [P[i][0] - pc[0], P[i][1] - pc[1], P[i][2] - pc[2]]);
    e += (v[0] - Q[i][0] + qc[0]) ** 2 + (v[1] - Q[i][1] + qc[1]) ** 2 + (v[2] - Q[i][2] + qc[2]) ** 2;
  }
  const det = xx * (yy * zz - yz * zy) - xy * (yx * zz - yz * zx) + xz * (yx * zy - yy * zx);
  return { axis, angle, rmsd: Math.sqrt(e / n), reflected: det < 0, n };
}

// ------------------------------------------------------------------ pairing

const elementOf = (sc: MScene, k: string): string => {
  const n = sc.nodes.get(k)!;
  return n.label?.shown || n.el;
};

/**
 * Extend a partial pairing by connectivity alone: an atom whose paired neighbours point at a
 * single candidate of the same element and degree pairs with it. Never guesses between two.
 */
export function complete(A: MScene, B: MScene, nm: NodeMap, passes = 8): NodeMap {
  const out: NodeMap = new Map(nm);
  const nA = A.nbr, nB = B.nbr;
  for (let it = 0; it < passes; it++) {
    const used = new Set(out.values());
    let added = 0;
    for (const a of A.nodes.keys()) {
      if (out.has(a)) continue;
      const imgs = nA.get(a)!.filter((x) => out.has(x)).map((x) => out.get(x)!);
      if (!imgs.length) continue;
      let cand = new Set(nB.get(imgs[0])!);
      for (const y of imgs.slice(1)) cand = new Set([...cand].filter((c) => nB.get(y)!.includes(c)));
      const ok = [...cand].filter((c) => !used.has(c) && B.nodes.get(c)!.el === A.nodes.get(a)!.el && nB.get(c)!.length === nA.get(a)!.length);
      if (ok.length === 1) { out.set(a, ok[0]); used.add(ok[0]); added++; }
    }
    if (!added) break;
  }
  return out;
}

/** A starting pair for connectivity: the rarest (element, degree) found exactly once in each. */
function seedByElement(A: MScene, B: MScene): NodeMap {
  const key = (sc: MScene, k: string) => sc.nodes.get(k)!.el + '/' + sc.nbr.get(k)!.length;
  const count = (sc: MScene) => {
    const m = new Map<string, string[]>();
    for (const k of sc.nodes.keys()) { const kk = key(sc, k); const l = m.get(kk); if (l) l.push(k); else m.set(kk, [k]); }
    return m;
  };
  const ca = count(A), cb = count(B);
  const order = [...ca].sort((x, y) => x[1].length - y[1].length);
  for (const [k, list] of order) if (list.length === 1 && cb.get(k)?.length === 1) return new Map([[list[0], cb.get(k)![0]]]);
  return new Map();
}

/**
 * Pair two 3-D poses: ChemDraw's own atom numbers first (exact, and they survive a change of
 * pose), then document order checked element by element, then connectivity. Never position:
 * poses turned far apart can't be paired by where atoms sit.
 */
export function pairSolid(SA: MScene, SB: MScene): [NodeMap, string] {
  const small = 0.8 * Math.min(SA.nodes.size, SB.nodes.size);
  const na = [...SA.nodes].filter(([, n]) => n.anum), nb = [...SB.nodes].filter(([, n]) => n.anum);
  if (na.length && nb.length) {
    const inv = new Map(nb.map(([k, n]) => [n.anum!, k]));
    const nm: NodeMap = new Map();
    for (const [k, n] of na) { const b = inv.get(n.anum!); if (b !== undefined) nm.set(k, b); }
    if (nm.size >= small) return [nm, 'ChemDraw atom numbering'];
  }
  const ka = [...SA.nodes.keys()].filter((k) => SA.nodes.get(k)!.xyz), kb = [...SB.nodes.keys()].filter((k) => SB.nodes.get(k)!.xyz);
  if (ka.length === kb.length && ka.every((k, i) => SA.nodes.get(k)!.el === SB.nodes.get(kb[i])!.el)) {
    return [new Map(ka.map((k, i) => [k, kb[i]])), 'document order'];
  }
  const nm = complete(SA, SB, seedByElement(SA, SB));
  if (nm.size < small) throw new TurnError('The two 3-D poses can\'t be paired: they carry no atom numbers and list their atoms in a different order. Pair them by hand.');
  return [nm, 'connectivity'];
}

export class TurnError extends Error {}

export function medianBond(sc: MScene): number {
  const L: number[] = [];
  for (const b of sc.bonds.values()) {
    const p = sc.nodes.get(b.b)?.p, q = sc.nodes.get(b.e)?.p;
    if (p && q) L.push(Math.hypot(q.x - p.x, q.y - p.y));
  }
  return L.length ? median(L) : 1;
}

/** (drawn bonds that land on bonds of the pose, drawn bonds tested, atoms paired). */
function pairingQuality(D: MScene, S: MScene, nm: NodeMap): [number, number, number] {
  const joined = new Set([...S.bonds.values()].map((b) => [b.b, b.e].sort().join('|')));
  let ok = 0, tot = 0;
  for (const b of D.bonds.values()) {
    const u = nm.get(b.b), v = nm.get(b.e);
    if (u === undefined || v === undefined) continue;
    tot++;
    if (joined.has([u, v].sort().join('|'))) ok++;
  }
  return [ok, tot, nm.size];
}

/**
 * A drawn-to-pose pairing grown along bonds: keep the part of `seed` whose bonds survive into
 * the pose, then pair outwards, each atom only with a neighbour of its neighbour's partner, chosen
 * by where it sits. On a bridged skeleton a purely positional match can pick an atom on the far
 * side of the molecule; this can't.
 */
export function walkMatch(D: MScene, S: MScene, seed: NodeMap, tol = 0.8): NodeMap {
  const nD = D.nbr, nS = S.nbr;
  const joined = new Set([...S.bonds.values()].map((b) => [b.b, b.e].sort().join('|')));
  const bond = medianBond(D);
  const scale = bond / Math.max(medianBond(S), 1e-6);
  let core: NodeMap = new Map();
  for (const b of D.bonds.values()) {
    const u = seed.get(b.b), v = seed.get(b.e);
    if (u !== undefined && v !== undefined && joined.has([u, v].sort().join('|'))) { core.set(b.b, u); core.set(b.e, v); }
  }
  if (core.size < 3) core = new Map([...seed].filter(([, v]) => S.nodes.get(v)?.xyz));
  if (core.size < 3) return new Map(seed);
  const ks = [...core.keys()];
  const xy = (s: string): Vec => { const v = S.nodes.get(s)!.xyz!; return { x: v[0], y: v[1] }; };
  const src = ks.map((k) => xy(core.get(k)!)), dst = ks.map((k) => D.nodes.get(k)!.p);
  const cs = mean(src), cd = mean(dst);
  const { R } = procrustes(src, dst);
  const place = (s: string): Vec => {
    const v = xy(s), dx = v.x - cs.x, dy = v.y - cs.y;
    return { x: scale * (R[0] * dx + R[1] * dy) + cd.x, y: scale * (R[2] * dx + R[3] * dy) + cd.y };
  };
  const nm: NodeMap = new Map(core);
  const used = new Set(core.values());
  const queue = [...core.keys()];
  while (queue.length) {
    const d = queue.shift()!;
    for (const d2 of nD.get(d) ?? []) {
      if (nm.has(d2)) continue;
      const cands = (nS.get(nm.get(d)!) ?? []).filter((s2) => !used.has(s2) && S.nodes.get(s2)!.xyz);
      if (!cands.length) continue;
      const want = D.nodes.get(d2)!.p;
      const dist = (c: string) => { const q = place(c); return Math.hypot(q.x - want.x, q.y - want.y); };
      const s2 = cands.reduce((a, b) => (dist(b) < dist(a) ? b : a));
      if (dist(s2) <= tol * bond) { nm.set(d2, s2); used.add(s2); queue.push(d2); }
    }
  }
  return nm;
}

const carriesH = (sc: MScene, k: string) => sc.nbr.get(k)!.some((x) => elementOf(sc, x) === 'H');

/**
 * Atoms the drawing names a hydrogen on, matched to the pose by that alone where only one atom
 * of the pose fits: one drawn N–H tells the two halves of a near-symmetric molecule apart.
 */
function hAnchors(D: MScene, S: MScene): NodeMap {
  const out: NodeMap = new Map();
  for (const k of D.nodes.keys()) {
    if (elementOf(D, k) === 'H' || !carriesH(D, k)) continue;
    const hits = [...S.nodes.keys()].filter((v) => elementOf(S, v) === elementOf(D, k) && carriesH(S, v));
    if (hits.length === 1) out.set(k, hits[0]);
  }
  return out;
}

const hMismatches = (D: MScene, S: MScene, nm: NodeMap) => [...nm].filter(([k, v]) => carriesH(D, k) && !carriesH(S, v)).length;

/** The better of the positional pairing of a drawing to its pose and the one grown along bonds. */
function bestToPose(D: MScene, S: MScene): NodeMap {
  const pos = matchNodes(D, S);
  const cands = [complete(D, S, pos), complete(D, S, walkMatch(D, S, pos))];
  const anchors = hAnchors(D, S);
  if (anchors.size) {
    try { cands.push(complete(D, S, matchConnectivity(D, S, anchors))); } catch { /* no pairing from the anchors */ }
  }
  const rank = (nm: NodeMap) => { const [ok, , n] = pairingQuality(D, S, nm); return [-hMismatches(D, S, nm), ok, n]; };
  const better = (x: number[], y: number[]) => { for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
  let best = cands[0];
  for (const c of cands.slice(1)) if (c.size && better(rank(c), rank(best))) best = c;
  return best;
}

/**
 * Pair the two drawings through their poses: each drawing sits roughly in the pose above it, so
 * it pairs with that geometrically, and the poses are paired exactly. Falls back to pairing the
 * drawings directly when that carries more bonds.
 */
export function pairDrawn(DA: MScene, DB: MScene, SA: MScene, SB: MScene, solid: NodeMap): { pairs: NodeMap; toPose: NodeMap; how: string } {
  const ma = bestToPose(DA, SA), mb = bestToPose(DB, SB);
  const invB = new Map([...mb].map(([k, v]) => [v, k]));
  let nm: NodeMap = new Map();
  for (const [a, s] of ma) { const t = solid.get(s); const b = t !== undefined ? invB.get(t) : undefined; if (b !== undefined) nm.set(a, b); }
  nm = complete(DA, DB, nm);
  const direct = complete(DA, DB, matchNodes(DA, DB));
  if (matchBonds(DA, DB, direct).size > matchBonds(DA, DB, nm).size) return { pairs: direct, toPose: ma, how: 'direct' };
  return { pairs: nm, toPose: ma, how: 'through the poses' };
}

// ------------------------------------------------------------------ depth

/** Depth for a hand drawing, taken from the pose it copies and scaled to the drawing's bond length. */
export function borrowDepth(drawn: MScene, solid: MScene, pairs: NodeMap): Map<string, number> {
  const k = medianBond(drawn) / Math.max(medianBond(solid), 1e-6);
  const out = new Map<string, number>();
  for (const [a, s] of pairs) { const v = solid.nodes.get(s)?.xyz; if (v) out.set(a, k * v[2]); }
  return out;
}

/** A lone hydrogen takes its neighbour's depth, so its bond can only foreshorten, never grow. */
export function flattenHydrogens(sc: MScene, depth: Map<string, number>): Map<string, number> {
  const out = new Map(depth);
  for (const [k, n] of sc.nodes) {
    if (n.label?.shown !== 'H' || sc.nbr.get(k)!.length !== 1) continue;
    const o = sc.nbr.get(k)![0];
    if (depth.has(o)) out.set(k, depth.get(o)!);
  }
  return out;
}

/** Fill in values for atoms that have none from the mean of their bonded neighbours, outwards. */
function spread<T>(sc: MScene, vals: Map<string, T>, keys: Iterable<string>, avg: (xs: T[]) => T, passes = 12): Map<string, T> {
  const out = new Map(vals);
  const want = [...keys];
  for (let it = 0; it < passes; it++) {
    const missing = want.filter((k) => !out.has(k));
    if (!missing.length) break;
    let grew = false;
    for (const k of missing) {
      const vs = sc.nbr.get(k)!.filter((j) => out.has(j)).map((j) => out.get(j)!);
      if (vs.length) { out.set(k, avg(vs)); grew = true; }
    }
    if (!grew) break;
  }
  return out;
}

// ------------------------------------------------------------------ the turn

export interface Guide {
  /** Each atom of A: drawn position with its (borrowed) depth, centred on the core atoms. */
  X: Map<string, V3>;
  /** Where the core atoms' centre sits on the page. */
  centre: Vec;
  axis: V3;
  angle: number;
  /** What the rigid turn misses at the end, per atom (closed over the turn). */
  resid: Map<string, Vec>;
  /** Atoms the next drawing leaves out: they hang off `host` at the angle they were drawn. */
  kept: Map<string, [string, Vec]>;
}

export interface Placement { pos: Map<string, Vec>; depth: Map<string, number> }

/**
 * The turn of drawing A (depth given for some of its atoms) through `fit`, landing on drawing B
 * (already moved so the core atoms' images centre where A's core does).
 */
export function guide(A: MScene, B: MScene, pairs: NodeMap, depth0: Map<string, number>, fit: Fit): Guide {
  const core = [...A.nodes.keys()].filter((k) => depth0.has(k));
  const depth = spread(A, depth0, A.nodes.keys(), (xs) => xs.reduce((s, x) => s + x, 0) / xs.length);
  for (const k of A.nodes.keys()) if (!depth.has(k)) depth.set(k, 0);
  const pool = core.length ? core : [...A.nodes.keys()];
  const cA: V3 = [0, 0, 0];
  for (const k of pool) { const p = A.nodes.get(k)!.p; cA[0] += p.x; cA[1] += p.y; cA[2] += depth.get(k)!; }
  for (let i = 0; i < 3; i++) cA[i] /= pool.length || 1;
  const X = new Map<string, V3>();
  for (const [k, n] of A.nodes) X.set(k, [n.p.x - cA[0], n.p.y - cA[1], depth.get(k)! - cA[2]]);
  const centre = { x: cA[0], y: cA[1] };
  const R1 = rotation(fit.axis, fit.angle);
  const resid = new Map<string, Vec>();
  for (const [k, x] of X) {
    const b = pairs.get(k);
    const nb = b !== undefined ? B.nodes.get(b) : undefined;
    if (!nb) continue;
    const land = mul(R1, x);
    resid.set(k, { x: nb.p.x - centre.x - land[0], y: nb.p.y - centre.y - land[1] });
  }
  const full = spread(A, resid, A.nodes.keys(), (vs) => ({ x: vs.reduce((s, v) => s + v.x, 0) / vs.length, y: vs.reduce((s, v) => s + v.y, 0) / vs.length }));
  const kept = new Map<string, [string, Vec]>();
  for (const [k, n] of A.nodes) {
    if (pairs.has(k)) continue;
    const host = A.nbr.get(k)!.find((x) => pairs.has(x));
    if (host === undefined) continue;
    const h = A.nodes.get(host)!.p;
    kept.set(k, [host, { x: n.p.x - h.x, y: n.p.y - h.y }]);
  }
  return { X, centre, axis: fit.axis, angle: fit.angle, resid: full, kept };
}

/** Where every atom of A is at time t of the turn, and how near the reader it is. */
export function guideAt(G: Guide, t: number): Placement {
  const Rt = rotation(G.axis, G.angle * t);
  const pos = new Map<string, Vec>(), depth = new Map<string, number>();
  for (const [k, x] of G.X) {
    const h = mul(Rt, x);
    const r = G.resid.get(k) ?? { x: 0, y: 0 };
    pos.set(k, { x: h[0] + G.centre.x + t * r.x, y: h[1] + G.centre.y + t * r.y });
    depth.set(k, FRONT * h[2]);
  }
  for (const [k, [host, off]] of G.kept) {
    const h = pos.get(host);
    if (!h) continue;
    pos.set(k, { x: h.x + off.x, y: h.y + off.y });
    depth.set(k, depth.get(host)!);
  }
  return { pos, depth };
}

/**
 * Ring double bonds whose inner line should close up as the ring turns edge-on: bond → (ring
 * atoms, area drawn in A, area drawn in B). The line meets its bond when the ring is a stick and
 * opens on the other side after, instead of jumping.
 */
export function ringOpenness(A: MScene, B: MScene, pairs: NodeMap): Map<string, [string[], number, number]> {
  const area = (P: Vec[]) => Math.abs(P.reduce((s, p, i) => { const q = P[(i + 1) % P.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  const out = new Map<string, [string[], number, number]>();
  for (const n of [5, 6, 7]) for (const ring of ringsOf(A, n)) {
    if (!ring.every((k) => pairs.has(k) && B.nodes.has(pairs.get(k)!))) continue;
    const a0 = area(ring.map((k) => A.nodes.get(k)!.p)), a1 = area(ring.map((k) => B.nodes.get(pairs.get(k)!)!.p));
    if (a0 <= 1e-6 || a1 <= 1e-6) continue;
    for (const [bid, b] of A.bonds) if (b.order === 2 && ring.includes(b.b) && ring.includes(b.e)) out.set(bid, [ring, a0, a1]);
  }
  return out;
}

/** What a turn did, for the dialog and the tests. */
export interface TurnNote {
  mode: 'guided' | '3d';
  /** Degrees. */
  degrees: number;
  axis: V3;
  rmsd: number;
  reflected: boolean;
  /** How the two poses were paired, and over how many atoms. */
  measured: string;
  /** Atoms of the drawing with no depth from the pose (they ride with their neighbours). */
  notTurning: number;
}

export interface TurnSetup {
  /** The drawn pairing (keys of A → keys of B). */
  pairs: NodeMap;
  guide: Guide;
  note: TurnNote;
}

/**
 * Everything a turn needs. Guided: A and B are drawings with poses SA and SB above them. Without
 * poses (`SA`/`SB` null), A and B are themselves the poses.
 */
export function setupTurn(A: MScene, Bdrawn: MScene, SA: MScene | null, SB: MScene | null, given?: NodeMap): { setup: TurnSetup; B: MScene } {
  const guided = !!(SA && SB);
  const sa = SA ?? A, sb = SB ?? Bdrawn;
  const [solid, how] = given && !guided ? [given, 'your pairing'] : pairSolid(sa, sb);
  const fit = fitFrom(sa, sb, solid);
  let pairs: NodeMap, toPose: NodeMap;
  if (guided) {
    const d = pairDrawn(A, Bdrawn, sa, sb, solid);
    pairs = given ?? d.pairs;
    toPose = d.toPose;
  } else {
    pairs = solid;
    toPose = new Map([...A.nodes.keys()].filter((k) => A.nodes.get(k)!.xyz).map((k) => [k, k]));
  }
  let depth = guided ? borrowDepth(A, sa, toPose) : new Map([...toPose.keys()].map((k) => [k, A.nodes.get(k)!.xyz![2]]));
  const notTurning = A.nodes.size - depth.size;
  depth = flattenHydrogens(A, depth);
  // B moves so the images of A's core atoms centre where A's core does: the turn happens in place
  const coreA = [...A.nodes.keys()].filter((k) => depth.has(k));
  const imaged = coreA.filter((k) => Bdrawn.nodes.has(pairs.get(k) ?? ''));
  const pool = imaged.length ? imaged : [...pairs.keys()].filter((k) => Bdrawn.nodes.has(pairs.get(k)!));
  let B = Bdrawn;
  if (pool.length) {
    const cA = mean((coreA.length ? coreA : [...A.nodes.keys()]).map((k) => A.nodes.get(k)!.p));
    const cb = mean(pool.map((k) => Bdrawn.nodes.get(pairs.get(k)!)!.p));
    B = Bdrawn.translated(cA.x - cb.x, cA.y - cb.y);
  }
  const g = guide(A, B, pairs, depth, fit);
  const note: TurnNote = {
    mode: guided ? 'guided' : '3d',
    degrees: (fit.angle * 180) / Math.PI,
    axis: fit.axis,
    rmsd: fit.rmsd,
    reflected: fit.reflected,
    measured: `${solid.size} atoms paired by ${how}`,
    notTurning,
  };
  return { setup: { pairs, guide: g, note }, B };
}
