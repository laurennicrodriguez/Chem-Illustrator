// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// The small pieces of numerical work the matcher needs: the assignment problem (which pairing of
// rows to columns costs least, as scipy's linear_sum_assignment) and fitting one set of points
// onto another by a rotation (or a reflection) and a shift.

import type { Vec } from '../geom';

/**
 * Least-cost pairing of the rows of `C` with its columns, each used at most once; as many pairs
 * as the smaller side allows. Returns the paired row and column indices, rows in order.
 * (The Hungarian method, in the form that works on rectangular tables.)
 */
export function linearSumAssignment(C: number[][]): [number[], number[]] {
  const n0 = C.length, m0 = n0 ? C[0].length : 0;
  if (!n0 || !m0) return [[], []];
  const tr = n0 > m0;
  const n = tr ? m0 : n0, m = tr ? n0 : m0;
  const cost = tr ? (i: number, j: number) => C[j][i] : (i: number, j: number) => C[i][j];
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const p = new Int32Array(m + 1), way = new Int32Array(m + 1);
  const minv = new Float64Array(m + 1);
  const used = new Uint8Array(m + 1);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    minv.fill(Infinity);
    used.fill(0);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const pairs: [number, number][] = [];
  for (let j = 1; j <= m; j++) if (p[j]) pairs.push(tr ? [j - 1, p[j] - 1] : [p[j] - 1, j - 1]);
  pairs.sort((a, b) => a[0] - b[0]);
  return [pairs.map((q) => q[0]), pairs.map((q) => q[1])];
}

/** A rigid map x → R·x + t in the plane; R as [a, b, c, d] for the matrix [[a, b], [c, d]]. */
export interface Rigid { R: [number, number, number, number]; t: Vec }

export const apply = (f: Rigid, p: Vec): Vec => ({ x: f.R[0] * p.x + f.R[1] * p.y + f.t.x, y: f.R[2] * p.x + f.R[3] * p.y + f.t.y });

export function mean(P: Vec[]): Vec {
  let x = 0, y = 0;
  for (const p of P) { x += p.x; y += p.y; }
  return { x: x / (P.length || 1), y: y / (P.length || 1) };
}

/**
 * The rotation (or, with `reflect`, the reflection) and shift that best put points X onto Y in
 * the least-squares sense.
 */
export function procrustes(X: Vec[], Y: Vec[], reflect = false): Rigid {
  const xc = mean(X), yc = mean(Y);
  let sxx = 0, sxy = 0, syx = 0, syy = 0;
  for (let i = 0; i < X.length; i++) {
    const a = { x: X[i].x - xc.x, y: X[i].y - xc.y }, b = { x: Y[i].x - yc.x, y: Y[i].y - yc.y };
    sxx += a.x * b.x; sxy += a.x * b.y; syx += a.y * b.x; syy += a.y * b.y;
  }
  let R: [number, number, number, number];
  if (!reflect) {
    const th = Math.atan2(sxy - syx, sxx + syy);
    const c = Math.cos(th), s = Math.sin(th);
    R = [c, -s, s, c];
  } else {
    // a reflection: the matrix [[c, s], [s, −c]]
    const th = Math.atan2(sxy + syx, sxx - syy);
    const c = Math.cos(th), s = Math.sin(th);
    R = [c, s, s, -c];
  }
  return { R, t: { x: yc.x - (R[0] * xc.x + R[1] * xc.y), y: yc.y - (R[2] * xc.x + R[3] * xc.y) } };
}

export function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return 0;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
