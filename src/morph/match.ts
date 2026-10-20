// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Which atom of one structure becomes which atom of the next. Purely geometric and topological:
// atoms pair by where they sit (after fitting one drawing onto the other), by their label, and
// by whether their neighbours pair too; or by growing a correspondence along the bonds.

import type { Vec } from '../geom';
import { linearSumAssignment, procrustes, apply } from './assign';
import type { MNode, MScene } from './scene';

export type NodeMap = Map<string, string>;

/** Label in a form that ignores which way round it is drawn ("" for a plain carbon). */
const lab = (n: MNode): string => n.label?.canon ?? '';
/** The element a label's bonds meet ("" for a plain carbon). */
const attachOf = (n: MNode): string => (n.label ? n.label.attach : '');

/**
 * Hungarian assignment on aligned position + label + degree, refined by neighbour consistency
 * (pairs whose neighbours also pair get cheaper). `forced` pins pairs the person chose.
 */
export function matchNodes(A: MScene, B: MScene, forced: NodeMap = new Map(), maxCost = 22, iters = 6, consistency = 3): NodeMap {
  const ka = [...A.nodes.keys()], kb = [...B.nodes.keys()];
  if (!ka.length || !kb.length) return new Map();
  const ia = new Map(ka.map((k, i) => [k, i])), ib = new Map(kb.map((k, j) => [k, j]));
  const na = A.nbr, nb = B.nbr;
  const PB = kb.map((k) => B.nodes.get(k)!.p);
  const pen: number[][] = ka.map((a) => kb.map((b) => {
    const A_ = A.nodes.get(a)!, B_ = B.nodes.get(b)!;
    const la = lab(A_), lb = lab(B_);
    let c = 0;
    if (la !== lb) {
      const ea = attachOf(A_), eb = attachOf(B_);
      if (ea && ea === eb) c += 6 + 1.5 * Math.abs(la.length - lb.length);
      else c += la && lb ? 1e3 : 16;
    }
    return c + 2.5 * Math.abs(na.get(a)!.length - nb.get(b)!.length);
  }));

  const fit = (P: Vec[]): [NodeMap, number] => {
    let R: [number, number, number, number] = [1, 0, 0, 1];
    const pm = mean(P), bm = mean(PB);
    let t = { x: bm.x - pm.x, y: bm.y - pm.y };
    let m: NodeMap = new Map();
    let bonus: number[][] | null = null;
    for (let it = 0; it < iters; it++) {
      const C = ka.map((_, i) => {
        const q = apply({ R, t }, P[i]);
        return kb.map((_, j) => Math.hypot(q.x - PB[j].x, q.y - PB[j].y) + pen[i][j] - (bonus ? bonus[i][j] : 0));
      });
      for (const [a, b] of forced) {
        const i = ia.get(a), j = ib.get(b);
        if (i === undefined || j === undefined) continue;
        for (let jj = 0; jj < kb.length; jj++) C[i][jj] += 1e6;
        for (let ii = 0; ii < ka.length; ii++) C[ii][j] += 1e6;
        C[i][j] = -1e6;
      }
      const [ri, ci] = linearSumAssignment(C);
      m = new Map();
      ri.forEach((i, k) => { const j = ci[k]; if (C[i][j] <= maxCost || forced.has(ka[i])) m.set(ka[i], kb[j]); });
      if (m.size < 3) break;
      const X = [...m.keys()].map((a) => P[ia.get(a)!]);
      const Y = [...m.values()].map((b) => PB[ib.get(b)!]);
      ({ R, t } = procrustes(X, Y));
      bonus = ka.map(() => kb.map(() => 0));
      for (const [a, b] of m) for (const x of na.get(a)!) for (const y of nb.get(b)!) bonus[ia.get(x)!][ib.get(y)!] += consistency;
    }
    let resid = 0;
    for (const [a, b] of m) { const q = apply({ R, t }, P[ia.get(a)!]); const r = PB[ib.get(b)!]; resid += Math.hypot(q.x - r.x, q.y - r.y); }
    return [m, resid];
  };

  // Try the drawing both ways round: the refit is a proper rotation, so it can never fit two
  // drawings that are mirror images, which is how a structure redrawn after a turn in three
  // dimensions arrives. More pairs wins; ties go to the smaller residual.
  let best: [number, number, NodeMap] | null = null;
  for (const flip of [1, -1]) {
    const [m, resid] = fit(ka.map((k) => { const p = A.nodes.get(k)!.p; return { x: p.x * flip, y: p.y }; }));
    if (!best || m.size > best[0] || (m.size === best[0] && -resid > best[1])) best = [m.size, -resid, m];
  }
  return best![2];
}

const mean = (P: Vec[]): Vec => {
  let x = 0, y = 0;
  for (const p of P) { x += p.x; y += p.y; }
  return { x: x / (P.length || 1), y: y / (P.length || 1) };
};

/** Neighbours of `k` in the order they are drawn around it. */
function ringOrder(sc: MScene, k: string): string[] {
  const p = sc.nodes.get(k)!.p;
  return sc.nbr.get(k)!
    .map((q) => { const r = sc.nodes.get(q)!.p; return [Math.atan2(r.y - p.y, r.x - p.x), q] as const; })
    .sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : 1))
    .map((x) => x[1]);
}

/**
 * Grow a correspondence outward from one paired atom. Moving or turning a drawing keeps the
 * order bonds leave an atom in, and reflecting it reverses that order, so the cyclic order of
 * neighbours is the part of a drawing worth trusting when the two sit anywhere on the page.
 */
function growEmbedding(A: MScene, B: MScene, a0: string, b0: string, flip: boolean, compat: (x: string, y: string) => boolean): NodeMap {
  const m: NodeMap = new Map([[a0, b0]]);
  const inv = new Map([[b0, a0]]);
  const dq: [string, string][] = [[a0, b0]];
  while (dq.length) {
    const [a, b] = dq.shift()!;
    const oa = ringOrder(A, a);
    let ob = ringOrder(B, b);
    if (flip) ob = [...ob].reverse();
    if (!oa.length || !ob.length) continue;
    let best = -1, bestOff = 0;
    for (let off = 0; off < ob.length; off++) {
      let s = 0;
      oa.forEach((x, i) => {
        const y = ob[(i + off) % ob.length];
        if (m.has(x)) s += m.get(x) === y ? 3 : -3;
        else if (inv.has(y)) s -= 1;
        else if (compat(x, y)) s += 1;
      });
      if (s > best) { best = s; bestOff = off; }
    }
    oa.forEach((x, i) => {
      const y = ob[(i + bestOff) % ob.length];
      if (m.has(x) || inv.has(y) || !compat(x, y)) return;
      m.set(x, y);
      inv.set(y, x);
      dq.push([x, y]);
    });
  }
  return m;
}

/**
 * Pair two drawings by their connectivity, not their positions: seeded at every compatible
 * pair of atoms and grown along the bonds both ways round; the pairing carrying the most bonds
 * wins. It finds a shared skeleton wherever it sits on the page.
 */
export function matchConnectivity(A: MScene, B: MScene, forced: NodeMap = new Map()): NodeMap {
  const nA = A.nbr, nB = B.nbr;
  const compat = (x: string, y: string) => {
    const X = A.nodes.get(x)!, Y = B.nodes.get(y)!;
    const ea = attachOf(X), eb = attachOf(Y);
    const same = lab(X) === lab(Y) || (!!ea && ea === eb);
    return same && Math.abs(nA.get(x)!.length - nB.get(y)!.length) <= 1;
  };
  const cands: [string, string][] = [];
  for (const a of A.nodes.keys()) for (const b of B.nodes.keys()) if (compat(a, b)) cands.push([a, b]);
  let best: NodeMap = new Map(), bestN = -1;
  for (const [a0, b0] of [...forced, ...cands]) {
    if (!compat(a0, b0)) continue;
    for (const flip of [false, true]) {
      let m = growEmbedding(A, B, a0, b0, flip, compat);
      if (forced.size && [...forced].some(([k, v]) => (m.get(k) ?? v) !== v)) {
        const taken = new Set(forced.values());
        const keep: NodeMap = new Map();
        for (const [k, v] of m) if ((forced.get(k) ?? v) === v && !forced.has(k) && !taken.has(v)) keep.set(k, v);
        for (const [k, v] of forced) keep.set(k, v);
        m = keep;
      }
      const n = matchBonds(A, B, m).size;
      if (n > bestN) { best = m; bestN = n; }
    }
  }
  return best;
}

/**
 * Pair A onto B one drawn fragment at a time: two molecules drawn apart that the next structure
 * joins (a reagent coming in) can't both be fitted by one rigid move. Larger fragment first.
 */
export function matchFragments(A: MScene, B: MScene, forced: NodeMap = new Map(), matcher: (A: MScene, B: MScene, forced: NodeMap) => NodeMap = matchNodes): NodeMap {
  const count = new Map<string, number>();
  for (const n of A.nodes.values()) count.set(n.frag, (count.get(n.frag) ?? 0) + 1);
  const frags = [...count.keys()].sort((a, b) => count.get(b)! - count.get(a)!);
  if (frags.length < 2) return new Map();
  const out: NodeMap = new Map(forced);
  const taken = new Set(forced.values());
  for (const f of frags) {
    const sub = A.fragment(f);
    if (sub.nodes.size < 2) continue;
    const keep: NodeMap = new Map([...forced].filter(([k]) => sub.nodes.has(k)));
    for (const [k, v] of matcher(sub, B, keep)) {
      if (out.has(k) || taken.has(v)) continue;
      out.set(k, v);
      taken.add(v);
    }
  }
  return out;
}

/**
 * Atoms of two drawings of the SAME molecule (an equivalency sign between them), paired by
 * connectivity: an isomorphism of the drawn bonds with labels and degrees as constraints. Where
 * the molecule has symmetry, the solution that moves the atoms least wins.
 */
export function matchEquivalent(A: MScene, B: MScene, limit = 400): NodeMap {
  const nA = A.nbr, nB = B.nbr;
  const ka = [...A.nodes.keys()].sort((x, y) => nA.get(y)!.length - nA.get(x)!.length);
  const compat = new Map<string, string[]>();
  for (const u of A.nodes.keys()) {
    const c = [...B.nodes.keys()].filter((v) => nB.get(v)!.length === nA.get(u)!.length && lab(B.nodes.get(v)!) === lab(A.nodes.get(u)!));
    if (!c.length) return new Map();
    compat.set(u, c);
  }
  const sols: NodeMap[] = [];
  const m: NodeMap = new Map(), inv = new Map<string, string>();
  const walk = (i: number) => {
    if (sols.length >= limit) return;
    if (i === ka.length) { sols.push(new Map(m)); return; }
    const u = ka[i];
    for (const v of compat.get(u)!) {
      if (inv.has(v)) continue;
      if (nA.get(u)!.some((w) => m.has(w) && !nB.get(v)!.includes(m.get(w)!))) continue;
      if (nB.get(v)!.some((x) => inv.has(x) && !nA.get(u)!.includes(inv.get(x)!))) continue;
      m.set(u, v); inv.set(v, u);
      walk(i + 1);
      m.delete(u); inv.delete(v);
    }
  };
  walk(0);
  if (!sols.length) return new Map();
  if (sols.length === 1) return sols[0];
  const cost = (s: NodeMap) => {
    const X = [...s.keys()].map((u) => A.nodes.get(u)!.p), Y = [...s.values()].map((v) => B.nodes.get(v)!.p);
    let best = Infinity;
    for (const reflect of [false, true]) {
      const f = procrustes(X, Y, reflect);
      let e = 0;
      X.forEach((x, i) => { const q = apply(f, x); e += (q.x - Y[i].x) ** 2 + (q.y - Y[i].y) ** 2; });
      best = Math.min(best, e);
    }
    return best;
  };
  return sols.reduce((a, b) => (cost(b) < cost(a) ? b : a));
}

/** A bond of A → the bond of B joining the partners of its atoms. */
export function matchBonds(A: MScene, B: MScene, nmap: NodeMap): Map<string, string> {
  const inv = new Map<string, string>();
  for (const [k, v] of nmap) inv.set(v, k);
  const key = (u: string, v: string) => (u < v ? u + '|' + v : v + '|' + u);
  const bkey = new Map<string, string>();
  for (const [bid, b] of B.bonds) {
    const u = inv.get(b.b), v = inv.get(b.e);
    if (u !== undefined && v !== undefined) bkey.set(key(u, v), bid);
  }
  const out = new Map<string, string>();
  for (const [aid, a] of A.bonds) { const t = bkey.get(key(a.b, a.e)); if (t !== undefined) out.set(aid, t); }
  return out;
}
