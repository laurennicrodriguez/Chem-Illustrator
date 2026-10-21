// Fusing a 3-D template (a chair, a boat, an envelope…) onto a bond of a ring drawn in
// perspective, so the two rings join the way real rings can.
//
// The drawing keeps no depth, so the ring's shape is read back from the picture: a ring drawn
// as a chair is the flat shadow (an orthographic projection) of a real chair, and its depths
// are what make every bond the same length and every ring angle close to tetrahedral. With the
// ring in 3-D, each of the two shared atoms has its free bonds (axial and equatorial on a
// chair). The template's ring is turned in 3-D so that its own ring bonds from the shared atoms
// lie along free bonds there, and the ways that fit (and don't run into the ring) are the
// fusions on offer: for two chairs, trans (both equatorial) and cis (one axial, one equatorial),
// the shapes of trans- and cis-decalin. The axial–axial way doesn't fit a six-membered ring and
// isn't offered.
//
// Chairs and the ring systems built from them (decalins, steroids) are drawn the textbook way,
// which is no true shadow: every ring bond the same length, along one of three directions, axial
// bonds upright. That is a picture of the diamond lattice, each of its four bond directions
// given its own direction on the page (scripts/make-conformers.py, "textbook drawings"). A ring
// drawn like that is read back onto the lattice exactly, and new rings are drawn the same way,
// so a chair fused onto a chair gives the textbook trans-decalin.

import type { Doc } from '../model';
import { Vec, dist } from '../geom';
import type { Template } from './templates';

export type V3 = [number, number, number];

const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a: V3): V3 => mul3(a, 1 / (len3(a) || 1));
const dist3 = (a: V3, b: V3): number => len3(sub3(a, b));

// ------------------------------------------------------------------ the textbook (lattice) picture

const S8 = Math.sqrt(8) / 3;
/** The lattice's bond directions (x right, y away from the viewer, z up), as in make-conformers.py. */
const LT: V3[] = [[S8 / 2, (S8 * Math.sqrt(3)) / 2, 1 / 3], [-S8, 0, 1 / 3], [S8 / 2, (-S8 * Math.sqrt(3)) / 2, 1 / 3], [0, 0, -1]];
/** Their directions on the page (degrees, anticlockwise from the right, y up). */
const LW_DEG = [56, 165, 12, 270];
const LW: Vec[] = LW_DEG.map((d) => ({ x: Math.cos((d * Math.PI) / 180), y: Math.sin((d * Math.PI) / 180) }));
/** The oblique projection nearest the page directions that keeps upright lines upright (rows x, y). */
const LA: V3[] = (() => {
  // least squares: x from the lattice directions' x and y; y from all three
  const fit = (cols: number[][], rhs: number[]) => {
    const m = cols[0].length;
    const N = Array.from({ length: m }, (_, a) => Array.from({ length: m }, (_, b) => cols.reduce((s, r) => s + r[a] * r[b], 0)));
    return solve(N, Array.from({ length: m }, (_, a) => cols.reduce((s, r, i) => s + r[a] * rhs[i], 0)))!;
  };
  const ax = fit(LT.map((t) => [t[0], t[1]]), LW.map((w) => w.x));
  const ay = fit(LT.map((t) => [...t]), LW.map((w) => w.y));
  return [[ax[0], ax[1], 0], [ay[0], ay[1], ay[2]]];
})();

/** The lattice and page directions, or their mirror images (a chair drawn the other way round). */
function vocab(mirror: boolean): { T: V3[]; W: Vec[]; A: V3[] } {
  if (!mirror) return { T: LT, W: LW, A: LA };
  return {
    T: LT.map(([x, y, z]): V3 => [-x, y, z]),
    W: LW.map((w) => ({ x: -w.x, y: w.y })),
    A: [[LA[0][0], -LA[0][1], -LA[0][2]], [-LA[1][0], LA[1][1], LA[1][2]]],
  };
}

/** How a ring is read back into 3-D, and how 3-D bonds are drawn on the page in the same style. */
export interface RingFrame {
  /** The ring's atoms in 3-D (drawing units). */
  P: V3[];
  /** The bond length in 3-D. */
  len: number;
  /** A bond (3-D, drawing units) as drawn on the page (y down, as in the drawing). */
  page: (v: V3) => Vec;
}

const SNAP = Math.cos((15 * Math.PI) / 180);

/**
 * How a bond in 3-D (lattice frame) is drawn: along its lattice direction's page direction if
 * within 15° of one, otherwise by the oblique projection; then turned on the page (cos, sin).
 */
function pageOf(mirror: boolean, cr: number, sr: number): (v: V3) => Vec {
  const { T, W, A } = vocab(mirror);
  return (v) => {
    const l = len3(v) || 1;
    let best = 0, bk = 0;
    T.forEach((t, k) => { const d = dot3(t, v) / l; if (Math.abs(d) > Math.abs(best)) { best = d; bk = k; } });
    const w = Math.abs(best) >= SNAP ? { x: Math.sign(best) * W[bk].x * l, y: Math.sign(best) * W[bk].y * l } : { x: dot3(A[0], v), y: dot3(A[1], v) };
    return { x: w.x * cr - w.y * sr, y: -(w.x * sr + w.y * cr) };
  };
}

/**
 * A ring drawn the textbook way (every bond along one of the lattice's page directions, in
 * any orientation on the page, either way round), read back onto the lattice; or null.
 */
export function latticeRing(pts: Vec[]): RingFrame | null {
  const n = pts.length;
  if (n < 6 || n % 2) return null;
  // bonds with y up
  const bv = pts.map((p, k) => ({ x: pts[(k + 1) % n].x - p.x, y: -(pts[(k + 1) % n].y - p.y) }));
  const ang = (v: Vec) => Math.atan2(v.y, v.x);
  const L = Math.hypot(bv[0].x, bv[0].y);
  if (L <= 0) return null;
  for (const mirror of [false, true]) {
    const { T, W } = vocab(mirror);
    for (let k0 = 0; k0 < 4; k0++) {
      for (const s0 of [1, -1]) {
        const th = ang(bv[0]) - ang({ x: s0 * W[k0].x, y: s0 * W[k0].y });
        const c = Math.cos(-th), s = Math.sin(-th);
        const kinds: [number, number][] = [];
        for (const b of bv) {
          const u = { x: (b.x * c - b.y * s) / L, y: (b.x * s + b.y * c) / L };
          const ul = Math.hypot(u.x, u.y);
          if (Math.abs(ul - 1) > 0.15) break;
          let hit: [number, number] | null = null;
          W.forEach((w, k) => {
            for (const sg of [1, -1]) if ((u.x * w.x + u.y * w.y) * sg / ul > Math.cos((8 * Math.PI) / 180)) hit = [k, sg];
          });
          if (!hit) break;
          kinds.push(hit);
        }
        if (kinds.length !== n) continue;
        // round a ring on the lattice, bonds go out from one sublattice and back from the other
        let ok = true;
        for (let k = 0; k < n; k++) {
          const [a, sa] = kinds[k], [b, sb] = kinds[(k + 1) % n];
          if (sa === sb || a === b) ok = false;
        }
        if (!ok) continue;
        const P: V3[] = [[0, 0, 0]];
        for (let k = 0; k < n - 1; k++) P.push(add3(P[k], mul3(T[kinds[k][0]], kinds[k][1] * L)));
        if (dist3(add3(P[n - 1], mul3(T[kinds[n - 1][0]], kinds[n - 1][1] * L)), P[0]) > 0.2 * L) continue;
        return { P, len: L, page: pageOf(mirror, Math.cos(th), Math.sin(th)) };
      }
    }
  }
  return null;
}

/** The angle a ring of this size has at an sp3 atom (degrees), as in its usual conformations. */
const RING_ANGLE: Record<number, number> = { 3: 60, 4: 88, 5: 104, 6: 111, 7: 115, 8: 117 };

export interface Lifted {
  /** Depth of each ring atom (towards the viewer), in drawing units. */
  z: number[];
  /** The ring's bond length in 3-D. */
  len: number;
}

/**
 * Read a ring drawn in perspective back into 3-D: the depth of each atom, with the ring's atoms
 * as drawn (or, drawn the textbook way, as readRing reads them). `pts` are the ring's atoms in
 * order; `flat[k]` is true for an atom with a double bond (an sp2 corner, 120°). Returns null
 * for a ring that is drawn flat (a regular polygon, as in ordinary skeletal drawings) or that
 * is no picture of any real ring.
 */
export function liftRing(pts: Vec[], flat: boolean[] = []): Lifted | null {
  const f = readRing(pts, flat);
  return f && { z: f.P.map((p) => p[2]), len: f.len };
}

/**
 * A ring of the drawing in 3-D: read onto the lattice if it is drawn the textbook way; else as
 * drawn by the textbook way's oblique projection (a boat, an envelope, a ring fused onto a
 * chair); else as the shadow of a real ring. Null for a ring drawn flat.
 */
export function readRing(pts: Vec[], flat: boolean[] = []): RingFrame | null {
  const n = pts.length;
  if (n < 4 || n > 8 || drawnFlat(pts)) return null;
  if (!flat.some(Boolean)) {
    const lat = latticeRing(pts);
    if (lat) return lat;
  }
  const obl = obliqueRing(pts, flat);
  if (obl) return obl;
  const lift = shadowLift(pts, flat);
  if (!lift) return null;
  return { P: pts.map((p, k): V3 => [p.x, p.y, lift.z[k]]), len: lift.len, page: (v) => ({ x: v[0], y: v[1] }) };
}

/** Drawn flat: every bond the same length and every angle that of a regular polygon. */
function drawnFlat(pts: Vec[]): boolean {
  const n = pts.length;
  const proj = pts.map((p, k) => dist(p, pts[(k + 1) % n]));
  const mean = proj.reduce((s, v) => s + v, 0) / n;
  if (mean <= 0) return true;
  const reg = 180 - 360 / n;
  let angDev = 0, lenDev = 0;
  for (let k = 0; k < n; k++) {
    angDev += (angle2(pts[(k + n - 1) % n], pts[k], pts[(k + 1) % n]) - reg) ** 2;
    lenDev += ((proj[k] - mean) / mean) ** 2;
  }
  return Math.sqrt(angDev / n) < 8 && Math.sqrt(lenDev / n) < 0.08;
}

/**
 * A ring drawn by the textbook way's oblique projection (turned on the page by the angle that
 * any of its bonds drawn along the lattice shows, or not at all), read back into 3-D: the
 * projection undone in the plane it keeps, the depths across it found as for a shadow.
 */
function obliqueRing(pts: Vec[], flat: boolean[]): RingFrame | null {
  const n = pts.length;
  const up = pts.map((p) => ({ x: p.x, y: -p.y }));
  for (const mirror of [false, true]) {
    const { W, A } = vocab(mirror);
    // turns on the page under which two or more of the ring's bonds lie along page directions
    // of the lattice (those of a ring fused onto a chair do), and no turn at all
    const bondAng = up.map((p, k) => Math.atan2(up[(k + 1) % n].y - p.y, up[(k + 1) % n].x - p.x));
    const wAng = W.flatMap((w) => [Math.atan2(w.y, w.x), Math.atan2(-w.y, -w.x)]);
    const near = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < (2 * Math.PI) / 180;
    const turns = [0];
    for (const ba of bondAng) for (const wa of wAng) {
      const th = ba - wa;
      if (turns.some((u) => near(u, th))) continue;
      if (bondAng.filter((b2) => wAng.some((w2) => near(b2 - w2, th))).length >= 2) turns.push(th);
    }
    // the projection's right inverse: page → the plane it keeps (orthonormal e1, e2), and the
    // direction it drops (towards the viewer)
    const a0 = A[0], a1 = A[1];
    const g = [[dot3(a0, a0), dot3(a0, a1)], [dot3(a1, a0), dot3(a1, a1)]];
    const det = g[0][0] * g[1][1] - g[0][1] * g[1][0];
    const gi = [[g[1][1] / det, -g[0][1] / det], [-g[1][0] / det, g[0][0] / det]];
    const inv = (x: number, y: number): V3 => add3(mul3(a0, gi[0][0] * x + gi[0][1] * y), mul3(a1, gi[1][0] * x + gi[1][1] * y));
    const e1 = norm3(a0);
    const e2 = norm3(sub3(a1, mul3(e1, dot3(a1, e1))));
    const kd = cross3(e1, e2);
    for (const th of turns) {
      const c = Math.cos(-th), s = Math.sin(-th);
      const Q = up.map((p) => inv(p.x * c - p.y * s, p.x * s + p.y * c));
      // (bonds drawn along the lattice are no exact oblique projection: a little more slack)
      const lift = shadowLift(Q.map((q) => ({ x: dot3(q, e1), y: dot3(q, e2) })), flat, 1.75);
      if (!lift) continue;
      const P = Q.map((q, k): V3 => add3(q, mul3(kd, lift.z[k])));
      const cr = Math.cos(th), sr = Math.sin(th);
      return { P, len: lift.len, page: pageOf(mirror, cr, sr) };
    }
  }
  return null;
}

/** The shadow of a real ring: depths that make every bond one length and every angle right. */
function shadowLift(pts: Vec[], flat: boolean[], slack = 1): Lifted | null {
  const n = pts.length;
  const proj = pts.map((p, k) => dist(p, pts[(k + 1) % n]));
  const target = pts.map((_, k) => (flat[k] ? 120 : RING_ANGLE[n]) * (Math.PI / 180));
  const maxProj = Math.max(...proj);
  let best: { cost: number; z: number[]; len: number } | null = null;
  // starting guesses: a bond length, and which way each bond runs in depth
  const starts: { cost: number; z: number[]; len: number }[] = [];
  for (const f of [1.0, 1.04, 1.1, 1.2, 1.35, 1.55]) {
    const L = maxProj * f;
    const dz = proj.map((p) => Math.sqrt(Math.max(0, L * L - p * p)));
    for (let signs = 0; signs < 1 << (n - 1); signs++) {
      const z = [0];
      let close = 0;
      for (let k = 0; k < n; k++) {
        const s = k === 0 ? 1 : signs & (1 << (k - 1)) ? -1 : 1;
        close += s * dz[k];
        if (k < n - 1) z.push(z[k] + s * dz[k]);
      }
      // spread the closing error round the ring
      for (let k = 0; k < n; k++) z[k] -= (close * k) / n;
      starts.push({ cost: Math.abs(close) / L, z, len: L });
    }
  }
  starts.sort((a, b) => a.cost - b.cost);
  for (const s of starts.slice(0, 16)) {
    const r = refine(pts, target, s.z, s.len);
    if (!best || r.cost < best.cost) best = r;
  }
  if (!best) return null;
  // a real ring: bonds within a few per cent of one length, angles within about 10°
  const res = residuals(pts, target, best.z, best.len);
  let bondErr = 0, angErr = 0;
  for (let k = 0; k < n; k++) { bondErr += res[k] ** 2; angErr += (res[n + k] / ANGLE_WEIGHT) ** 2; }
  if (Math.sqrt(bondErr / n) > 0.06 * slack || Math.sqrt(angErr / n) > 12 * slack * (Math.PI / 180)) return null;
  const zm = best.z.reduce((s, v) => s + v, 0) / n;
  return { z: best.z.map((v) => v - zm), len: best.len };
}

const ANGLE_WEIGHT = 0.5;

function angle2(a: Vec, b: Vec, c: Vec): number {
  const u = { x: a.x - b.x, y: a.y - b.y }, w = { x: c.x - b.x, y: c.y - b.y };
  const d = (u.x * w.x + u.y * w.y) / ((Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y)) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d))) * (180 / Math.PI);
}

function residuals(pts: Vec[], target: number[], z: number[], L: number): number[] {
  const n = pts.length;
  const P = pts.map((p, k): V3 => [p.x, p.y, z[k]]);
  const out: number[] = [];
  for (let k = 0; k < n; k++) out.push((dist3(P[k], P[(k + 1) % n]) - L) / L);
  for (let k = 0; k < n; k++) {
    const u = sub3(P[(k + n - 1) % n], P[k]), w = sub3(P[(k + 1) % n], P[k]);
    const c = dot3(u, w) / ((len3(u) * len3(w)) || 1);
    out.push((Math.acos(Math.max(-1, Math.min(1, c))) - target[k]) * ANGLE_WEIGHT);
  }
  return out;
}

/** Levenberg–Marquardt on the depths (the first stays 0) and the bond length. */
function refine(pts: Vec[], target: number[], z0: number[], L0: number): { cost: number; z: number[]; len: number } {
  const n = pts.length;
  let x = [...z0.slice(1), L0];
  const unpack = (v: number[]) => ({ z: [0, ...v.slice(0, n - 1)], len: v[n - 1] });
  const costOf = (v: number[]) => { const u = unpack(v); return residuals(pts, target, u.z, u.len).reduce((s, r) => s + r * r, 0); };
  let cost = costOf(x);
  let lambda = 1e-3;
  const m = x.length;
  const h = L0 * 1e-5;
  for (let it = 0; it < 60; it++) {
    const u = unpack(x);
    const r0 = residuals(pts, target, u.z, u.len);
    const J: number[][] = r0.map(() => new Array(m).fill(0));
    for (let j = 0; j < m; j++) {
      const xp = [...x];
      xp[j] += h;
      const up = unpack(xp);
      const rp = residuals(pts, target, up.z, up.len);
      for (let i = 0; i < r0.length; i++) J[i][j] = (rp[i] - r0[i]) / h;
    }
    const A: number[][] = Array.from({ length: m }, () => new Array(m).fill(0));
    const g = new Array(m).fill(0);
    for (let i = 0; i < r0.length; i++) {
      for (let a = 0; a < m; a++) {
        g[a] += J[i][a] * r0[i];
        for (let b = 0; b < m; b++) A[a][b] += J[i][a] * J[i][b];
      }
    }
    let improved = false;
    for (let tries = 0; tries < 8; tries++) {
      const M = A.map((row, a) => row.map((v, b) => (a === b ? v * (1 + lambda) + 1e-12 : v)));
      const step = solve(M, g.map((v) => -v));
      if (!step) { lambda *= 10; continue; }
      const xn = x.map((v, k) => v + step[k]);
      const cn = costOf(xn);
      if (cn < cost) { x = xn; cost = cn; lambda = Math.max(1e-7, lambda / 3); improved = true; break; }
      lambda *= 10;
    }
    if (!improved || cost < 1e-12) break;
  }
  const u = unpack(x);
  return { cost, z: u.z, len: Math.abs(u.len) };
}

/** Solve A x = b (small, dense) by Gaussian elimination; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-14) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * The best proper rotation and shift taking points `a` onto points `b` (Kabsch, by Horn's
 * quaternion method). Returns the rotation (rows), the shift and the root-mean-square miss.
 */
export function superpose(a: V3[], b: V3[]): { R: V3[]; t: V3; rms: number } {
  const n = a.length;
  const ca = mul3(a.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / n);
  const cb = mul3(b.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / n);
  let Sxx = 0, Sxy = 0, Sxz = 0, Syx = 0, Syy = 0, Syz = 0, Szx = 0, Szy = 0, Szz = 0;
  for (let i = 0; i < n; i++) {
    const p = sub3(a[i], ca), q = sub3(b[i], cb);
    Sxx += p[0] * q[0]; Sxy += p[0] * q[1]; Sxz += p[0] * q[2];
    Syx += p[1] * q[0]; Syy += p[1] * q[1]; Syz += p[1] * q[2];
    Szx += p[2] * q[0]; Szy += p[2] * q[1]; Szz += p[2] * q[2];
  }
  const N = [
    [Sxx + Syy + Szz, Syz - Szy, Szx - Sxz, Sxy - Syx],
    [Syz - Szy, Sxx - Syy - Szz, Sxy + Syx, Szx + Sxz],
    [Szx - Sxz, Sxy + Syx, -Sxx + Syy - Szz, Syz + Szy],
    [Sxy - Syx, Szx + Sxz, Syz + Szy, -Sxx - Syy + Szz],
  ];
  const q = topEigenvector(N);
  const [w, x, y, z] = q;
  const R: V3[] = [
    [w * w + x * x - y * y - z * z, 2 * (x * y - w * z), 2 * (x * z + w * y)],
    [2 * (x * y + w * z), w * w - x * x + y * y - z * z, 2 * (y * z - w * x)],
    [2 * (x * z - w * y), 2 * (y * z + w * x), w * w - x * x - y * y + z * z],
  ];
  const t = sub3(cb, apply(R, ca));
  let s = 0;
  for (let i = 0; i < n; i++) s += dist3(add3(apply(R, a[i]), t), b[i]) ** 2;
  return { R, t, rms: Math.sqrt(s / n) };
}

export const apply = (R: V3[], p: V3): V3 => [dot3(R[0], p), dot3(R[1], p), dot3(R[2], p)];

/** The eigenvector of a symmetric 4×4 matrix with the largest eigenvalue (Jacobi rotations). */
function topEigenvector(S: number[][]): number[] {
  const a = S.map((r) => [...r]);
  const v = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let p = 0; p < 4; p++) for (let q = p + 1; q < 4; q++) off += a[p][q] ** 2;
    if (off < 1e-20) break;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        if (Math.abs(a[p][q]) < 1e-15) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 4; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 4; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 4; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  let best = 0;
  for (let k = 1; k < 4; k++) if (a[k][k] > a[best][best]) best = k;
  return [v[0][best], v[1][best], v[2][best], v[3][best]];
}

/**
 * The directions of an sp3 atom's two free bonds, given the directions to two of its
 * neighbours: either side of the plane of those two, 109.5° apart (axial and equatorial on a
 * chair). An sp2 atom has one, in that plane.
 */
export function freeBonds(u1: V3, u2: V3, sp2: boolean): V3[] {
  const a = norm3(u1), b = norm3(u2);
  const bis = norm3(mul3(add3(a, b), -1));
  if (sp2) return [bis];
  const n = norm3(cross3(a, b));
  const h = (109.47 / 2) * (Math.PI / 180);
  return [add3(mul3(bis, Math.cos(h)), mul3(n, Math.sin(h))), add3(mul3(bis, Math.cos(h)), mul3(n, -Math.sin(h)))];
}

// ------------------------------------------------------------------ the fusions on offer

/** One way of putting a template on: where each of its atoms goes, and which are shared. */
export interface Fusion {
  pts: Vec[];
  /** Template atom → drawing atom it becomes. */
  existing: Map<number, number>;
  /** How well it fits (lower is better). */
  score: number;
  /** The bond length in 3-D, in drawing units. */
  len: number;
  /** How the rings are joined: 'trans' or 'cis' (by the faces of the two atoms' other bonds). */
  join?: 'trans' | 'cis';
  /** Template atoms whose drawn atom (a plain bond end) moves to its place in `pts`. */
  move?: Set<number>;
}

/**
 * The template's atoms in 3-D: its shape (`xyz`) for one drawn the textbook way, otherwise x, y
 * as drawn and z its depth; null for a flat template.
 */
export function template3d(t: Template): V3[] | null {
  if (t.xyz && t.xyz.length === t.atoms.length) return t.xyz.map(([x, y, z]): V3 => [x, y, z]);
  if (!t.z || t.z.length !== t.atoms.length) return null;
  return t.atoms.map(([x, y], i): V3 => [x, y, t.z![i]]);
}

/** The template's bonds that are in rings (by index). */
export function templateRingBonds(t: Template): Set<number> {
  const out = new Set<number>();
  t.bonds.forEach(([i, j], k) => {
    const seen = new Set([i]);
    const stack = [i];
    while (stack.length) {
      const x = stack.pop()!;
      t.bonds.forEach(([a, b], m) => {
        if (m === k) return;
        const y = a === x ? b : b === x ? a : -1;
        if (y >= 0 && !seen.has(y)) { seen.add(y); stack.push(y); }
      });
    }
    if (seen.has(j)) out.add(k);
  });
  return out;
}

/**
 * The geometrically sensible ways of fusing a 3-D template onto the bond `bondId`, best
 * first, or null when the bond's ring isn't drawn in perspective (then the flat ways apply).
 */
export function fusions3d(doc: Doc, t: Template, bondId: number): Fusion[] | null {
  const T3 = template3d(t);
  const b = doc.bonds.get(bondId);
  if (!T3 || !b) return null;
  const ring = doc.ringThroughBond(bondId);
  if (!ring) return null;
  // the ring in order, starting a1 … a2 (ringThroughBond gives a1 … a2 round the ring)
  const atoms = ring.map((id) => doc.atoms.get(id)!);
  const hasDouble = (id: number) => (doc.adj.get(id) ?? []).some((bid) => (doc.bonds.get(bid)?.order ?? 1) >= 1.5);
  const fr = readRing(atoms, ring.map(hasDouble));
  if (!fr) return null;
  const P = new Map<number, V3>(ring.map((id, k) => [id, fr.P[k]]));
  const L = fr.len;
  const n = ring.length;
  const p = b.a1, q = b.a2;
  // ring neighbours of the shared atoms, away from the shared bond
  const ringNb = (id: number) => { const k = ring.indexOf(id); const a = ring[(k + 1) % n], c = ring[(k + n - 1) % n]; return a === p || a === q ? c : a; };
  const slots = (id: number, other: number) => {
    const c = P.get(id)!;
    const dirs = freeBonds(sub3(P.get(ringNb(id))!, c), sub3(P.get(other)!, c), hasDoubleIn(doc, id, ring));
    // a free bond already used by something drawn (matched by its direction in the picture)
    const used = new Map<number, number>();
    const at = doc.atoms.get(id)!;
    for (const bid of doc.adj.get(id) ?? []) {
      const bb = doc.bonds.get(bid)!;
      const o = bb.a1 === id ? bb.a2 : bb.a1;
      if (o === other || o === ringNb(id)) continue;
      const oa = doc.atoms.get(o)!;
      const d2 = { x: oa.x - at.x, y: oa.y - at.y };
      let k = -1, bestCos = -2;
      dirs.forEach((d3, i) => {
        const d = fr.page(d3);
        const cos = (d.x * d2.x + d.y * d2.y) / ((Math.hypot(d.x, d.y) * Math.hypot(d2.x, d2.y)) || 1);
        if (cos > bestCos) { bestCos = cos; k = i; }
      });
      if (k >= 0) used.set(k, o);
    }
    return dirs.map((d, i) => ({ dir: d, atom: used.get(i) }));
  };
  const sp = slots(p, q), sq = slots(q, p);
  // the ring's mean plane: an equatorial bond lies near it, an axial one across it
  const normal = ringNormal(ring.map((id) => P.get(id)!));
  const axialness = (d: V3) => Math.abs(dot3(norm3(d), normal));
  const face = (slots: { dir: V3 }[], used: number) => {
    const rest = slots.filter((_, i) => i !== used);
    return rest.length === 1 ? Math.sign(dot3(rest[0].dir, normal)) : 0;
  };
  const tl = averageBond(t, T3);
  const k = L / tl;
  const rb = templateRingBonds(t);
  const tAdj = t.atoms.map(() => [] as number[]);
  t.bonds.forEach(([i, j], m) => { if (rb.has(m)) { tAdj[i].push(j); tAdj[j].push(i); } });
  const out: Fusion[] = [];
  const seen: Vec[][] = [];
  const usable = (s: { atom?: number }) => s.atom === undefined || isStub(doc, s.atom);
  for (const mirror of [false, true]) {
    const src = T3.map(([x, y, z]): V3 => [x * k, y * k, (mirror ? -z : z) * k]);
    t.bonds.forEach(([i, j], m) => {
      if (!rb.has(m) || tAdj[i].length !== 2 || tAdj[j].length !== 2) return;
      const ni = tAdj[i].find((x) => x !== j)!, nj = tAdj[j].find((x) => x !== i)!;
      for (const [ti, tj, tni, tnj] of [[i, j, ni, nj], [j, i, nj, ni]]) {
        for (const [ia, a] of sp.entries()) {
          if (!usable(a)) continue;
          for (const [ic, c] of sq.entries()) {
            if (!usable(c)) continue;
            const pp = P.get(p)!, qq = P.get(q)!;
            const dst: V3[] = [pp, qq, add3(pp, mul3(a.dir, L)), add3(qq, mul3(c.dir, L))];
            const fit = superpose([src[ti], src[tj], src[tni], src[tnj]], dst);
            if (fit.rms > 0.16 * L) continue;
            const X = src.map((s) => add3(apply(fit.R, s), fit.t));
            const existing = new Map<number, number>([[ti, p], [tj, q]]);
            if (a.atom !== undefined) existing.set(tni, a.atom);
            if (c.atom !== undefined) existing.set(tnj, c.atom);
            let clash = 0;
            X.forEach((x, idx) => {
              if (existing.has(idx)) return;
              for (const [id, y] of P) {
                const d = dist3(x, y);
                if (d < 0.45 * L && !existing.has(idx) && ![...existing.values()].includes(id) && isNeighbourOfShared(doc, id, p, q)) { existing.set(idx, id); return; }
                if (d < 0.8 * L) clash += 1;
              }
            });
            if (clash) continue;
            // drawn atoms stay where they are, apart from plain axial and equatorial bond ends,
            // which move out to the full bond length as they become ring atoms
            const move = new Set<number>();
            const fixed = new Map<number, Vec>();
            existing.forEach((id, idx) => {
              if (isStub(doc, id) && id !== p && id !== q) { move.add(idx); return; }
              const ea = doc.atoms.get(id)!;
              fixed.set(idx, { x: ea.x, y: ea.y });
            });
            const pts = onPage(t, X, fixed, fr.page);
            // new atoms on top of drawn ones in the picture would be unreadable
            let overlap = 0;
            pts.forEach((pt, idx) => {
              if (existing.has(idx)) return;
              for (const at of doc.atomsNear(pt, L * 0.3)) overlap += 1 - dist(at, pt) / (L * 0.3);
            });
            // the same picture reached another way (the template's symmetry) is offered once
            const fresh = pts.filter((_, idx) => !existing.has(idx));
            const same = (o: Vec[]) => o.length === fresh.length && fresh.every((pt) => o.some((q) => dist(pt, q) < 0.1 * L));
            if (seen.some(same)) continue;
            seen.push(fresh);
            // equatorial bonds first (trans-decalin before cis), then the better fit
            const axial = (sl: { dir: V3 }[], i: number) => (sl.length === 2 && axialness(sl[i].dir) > axialness(sl[1 - i].dir) ? 1 : 0);
            const fa = face(sp, ia), fc = face(sq, ic);
            const join = fa && fc ? (fa === fc ? 'cis' : 'trans') : undefined;
            out.push({ pts, existing, move, len: L, score: fit.rms / L + overlap * 0.5 + 0.03 * (axial(sp, ia) + axial(sq, ic)), ...(join ? { join } : {}) });
          }
        }
      }
    });
  }
  out.sort((x, y) => x.score - y.score);
  return out;
}

/**
 * Where the template's atoms go on the page: the `fixed` ones where they are, the rest placed
 * from them bond by bond, each bond drawn as `page` draws it, then evened out so that every
 * bond comes as close as it can to its drawn direction and length (exactly, on the lattice).
 */
function onPage(t: Template, X: V3[], fixed: Map<number, Vec>, page: (v: V3) => Vec): Vec[] {
  const pos: (Vec | null)[] = X.map((_, i) => fixed.get(i) ?? null);
  const nb = X.map(() => [] as number[]);
  for (const [i, j] of t.bonds) { nb[i].push(j); nb[j].push(i); }
  const from = (a: number, b: number): Vec => { const d = page(sub3(X[b], X[a])); return { x: pos[a]!.x + d.x, y: pos[a]!.y + d.y }; };
  for (let grew = true; grew;) {
    grew = false;
    X.forEach((_, i) => {
      if (pos[i]) return;
      const k = nb[i].find((j) => pos[j]);
      if (k !== undefined) { pos[i] = from(k, i); grew = true; }
    });
  }
  X.forEach((x, i) => { if (!pos[i]) pos[i] = { x: x[0], y: x[1] }; });
  for (let sweep = 0; sweep < 40; sweep++) {
    X.forEach((_, i) => {
      if (fixed.has(i) || !nb[i].length) return;
      let sx = 0, sy = 0;
      for (const j of nb[i]) { const v = from(j, i); sx += v.x; sy += v.y; }
      pos[i] = { x: sx / nb[i].length, y: sy / nb[i].length };
    });
  }
  return pos as Vec[];
}

function ringNormal(P: V3[]): V3 {
  const c = mul3(P.reduce((s, p) => add3(s, p), [0, 0, 0] as V3), 1 / P.length);
  let nrm: V3 = [0, 0, 0];
  for (let k = 0; k < P.length; k++) nrm = add3(nrm, cross3(sub3(P[k], c), sub3(P[(k + 1) % P.length], c)));
  return norm3(nrm);
}

function hasDoubleIn(doc: Doc, id: number, ring: number[]): boolean {
  return (doc.adj.get(id) ?? []).some((bid) => { const b = doc.bonds.get(bid)!; return b.order >= 1.5 && ring.includes(b.a1 === id ? b.a2 : b.a1); });
}

/** A plain end atom (an unlabelled carbon with one bond), as on a chair's axial and equatorial bonds. */
function isStub(doc: Doc, id: number): boolean {
  const a = doc.atoms.get(id);
  return !!a && a.z === 6 && !a.label && (doc.adj.get(id)?.length ?? 0) === 1;
}

function isNeighbourOfShared(doc: Doc, id: number, p: number, q: number): boolean {
  return !!doc.bondBetween(id, p) || !!doc.bondBetween(id, q);
}

/** The template's ring bond length in 3-D (its axial and equatorial bonds may be drawn shorter). */
function averageBond(t: Template, T3: V3[]): number {
  const rb = templateRingBonds(t);
  let s = 0, c = 0;
  t.bonds.forEach(([i, j], k) => { if (rb.has(k) || !rb.size) { s += dist3(T3[i], T3[j]); c++; } });
  return c ? s / c : 1;
}
