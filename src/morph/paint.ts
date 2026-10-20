// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Painting one frame: strokes are cut back at the labels, double bonds' second lines are placed
// off the trimmed bond, bonds passing behind others get their gaps from the live geometry (so a
// crossing that exists only mid-step is drawn right), and wedges, hashes and labels are drawn
// the way the still drawing draws them.

import type { Rect, Vec } from '../geom';
import { exitParam } from '../geom';
import { circleIn } from '../chem/aromatic';
import { frame, type FrameData, type FrameOptions, type Stroke } from './frame';
import type { MScene, MStyle, RGB } from './scene';
import type { Mapping } from './mapping';

/** Pairs of bonds whose front-to-back order changes, and when to swap them (out of any crossing). */
export type Swaps = Map<string, [number, string, string]>;

const pairKey = (a: string, b: string) => (a < b ? a + '\u0000' + b : b + '\u0000' + a);

/** Where segments p→q and r→s cross (fractions along each, and the sine of the angle), or null. */
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

/** Does segment a come within `th` of segment b anywhere (sampled)? */
function overlaps(a0: Vec, a1: Vec, b0: Vec, b1: Vec, th: number): boolean {
  const ex = b1.x - b0.x, ey = b1.y - b0.y, L2 = ex * ex + ey * ey;
  const L = Math.hypot(a1.x - a0.x, a1.y - a0.y);
  if (L < 1e-9 || L2 < 1e-12) return false;
  if (Math.min(a0.x, a1.x) - th > Math.max(b0.x, b1.x) || Math.max(a0.x, a1.x) + th < Math.min(b0.x, b1.x)) return false;
  if (Math.min(a0.y, a1.y) - th > Math.max(b0.y, b1.y) || Math.max(a0.y, a1.y) + th < Math.min(b0.y, b1.y)) return false;
  const n = Math.max(24, Math.ceil(L / 0.25));
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const px = a0.x + f * (a1.x - a0.x), py = a0.y + f * (a1.y - a0.y);
    const u = Math.max(0, Math.min(1, ((px - b0.x) * ex + (py - b0.y) * ey) / L2));
    if (Math.hypot(px - (b0.x + u * ex), py - (b0.y + u * ey)) <= th) return true;
  }
  return false;
}

/**
 * Depth is discrete, so when two bonds change places the swap would land wherever the numbers
 * happen to cross, often mid-crossing, and the gap would flicker between them. Each swap is
 * moved to the first moment the two are clear of each other.
 */
export function planSwaps(A: MScene, B: MScene, M: Mapping, ts: number[], opt: FrameOptions): Swaps {
  const margin = A.style.marginWidth;
  const frames = ts.map((t) => {
    const vis = new Map<string, Stroke[]>();
    for (const l of frame(A, B, M, t, opt).lines) if (l.alpha > 0.5) { const g = vis.get(l.grp); if (g) g.push(l); else vis.set(l.grp, [l]); }
    return [t, vis] as const;
  });
  const signs = new Map<string, [string, string, boolean[]]>();
  for (const [, vis] of frames) {
    const gs = [...vis.keys()].sort();
    for (let i = 0; i < gs.length; i++) for (let j = i + 1; j < gs.length; j++) {
      const k = gs[i] + '\u0000' + gs[j];
      let s = signs.get(k);
      if (!s) signs.set(k, (s = [gs[i], gs[j], []]));
      s[2].push(vis.get(gs[i])![0].z > vis.get(gs[j])![0].z);
    }
  }
  const out: Swaps = new Map();
  for (const [g1, g2, s] of signs.values()) {
    if (!s.some((x) => x !== s[0])) continue;
    const s0 = s[0], s1 = s[s.length - 1];
    const seq = frames.map(([t, vis]) => {
      const a = vis.get(g1), b = vis.get(g2);
      if (!a || !b) return [t, null, false] as const;
      let over = false;
      if (!a[0].ends.some((e) => b[0].ends.includes(e))) {
        outer: for (const x of a) for (const y of b) if (overlaps(x.p0, x.p1, y.p0, y.p1, x.w / 2 + y.w / 2 + margin)) { over = true; break outer; }
      }
      return [t, a[0].z > b[0].z, over] as const;
    });
    const nat = seq.findIndex(([, sg]) => sg !== null && sg !== s0);
    if (nat < 0 || !seq[nat][2]) continue;
    let k = nat;
    while (k + 1 < seq.length && seq[k + 1][2]) k++;
    let tFlip: number;
    if (k + 1 < seq.length) tFlip = seq[k + 1][0];
    else {
      k = nat;
      while (k - 1 >= 0 && seq[k - 1][2]) k--;
      tFlip = seq[k][0];
    }
    out.set(pairKey(g1, g2), [tFlip, s0 ? g1 : g2, s1 ? g1 : g2]);
  }
  return out;
}

// Least share of a bond that must survive its crossing gaps; shortest piece a gap may leave; most
// pieces one bond may be cut into and still read as one bond.
const MIN_SURVIVING = 0.2;
const MIN_PIECE = 2.5;
const MAX_PIECES = 2;
const MIN_FRAGMENT = 1.5;

type Piece = [Vec, Vec, number];

/** Cut arc-length intervals out of p0→p1; the pieces left. */
function punch(p0: Vec, p1: Vec, cuts: [number, number][]): [Vec, Vec][] {
  const L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (L < 1e-9) return [];
  let keep: [number, number][] = [[0, L]];
  for (const [lo, hi] of cuts) {
    const nxt: [number, number][] = [];
    for (const [a, b] of keep) {
      if (lo <= a && hi >= b) continue;
      if (hi <= a || lo >= b) { nxt.push([a, b]); continue; }
      if (lo > a) nxt.push([a, lo]);
      if (hi < b) nxt.push([hi, b]);
    }
    keep = nxt;
  }
  const ux = (p1.x - p0.x) / L, uy = (p1.y - p0.y) / L;
  return keep.filter(([a, b]) => b - a > 1e-6).map(([a, b]) => [{ x: p0.x + a * ux, y: p0.y + a * uy }, { x: p0.x + b * ux, y: p0.y + b * uy }]);
}

/**
 * Cut the crossing gaps, giving a gap up only where the bond would stop reading as one bond (too
 * little left, or diced into too many pieces); the narrowest gap goes first. A piece near the
 * length that stops reading as a bond fades rather than blinking off between frames.
 */
function punchSurviving(p0: Vec, p1: Vec, cuts: [number, number][], w: number, labelled: [boolean, boolean], whole: boolean): Piece[] {
  const full = Math.hypot(p1.x - p0.x, p1.y - p0.y);
  if (!cuts.length || full < 1e-9) return [[p0, p1, 1]];
  const pieces = (cs: [number, number][]): Piece[] => {
    const thr = whole ? Math.max(MIN_PIECE, MIN_FRAGMENT * w) : Math.max(MIN_FRAGMENT * w, 0.4);
    const kept: Piece[] = [];
    for (const [a, b] of punch(p0, p1, cs)) {
      const L = Math.hypot(b.x - a.x, b.y - a.y);
      const atLabel = (labelled[0] && Math.hypot(a.x - p0.x, a.y - p0.y) < 1e-6) || (labelled[1] && Math.abs(Math.hypot(b.x - p0.x, b.y - p0.y) - full) < 1e-6);
      if (atLabel || L >= thr) kept.push([a, b, 1]);
      else if (L > 0.1 * thr) kept.push([a, b, L / thr]);
    }
    return kept;
  };
  let cs = [...cuts].sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
  while (cs.length) {
    const sg = pieces(cs);
    const tot = sg.reduce((s, [a, b, wt]) => s + Math.hypot(b.x - a.x, b.y - a.y) * wt, 0);
    if (sg.length && (!whole || sg.length <= MAX_PIECES) && tot >= MIN_SURVIVING * full) return sg;
    cs = cs.slice(0, -1);
  }
  return [[p0, p1, 1]];
}

/** How far the second line of a double bond stops short at `at` (the still drawing's rule). */
function insetAt(at: Vec, other: Vec, side: number, nbrs: Vec[]): number {
  const dx = other.x - at.x, dy = other.y - at.y;
  const L = Math.hypot(dx, dy) || 1;
  const dir = { x: dx / L, y: dy / L };
  const nrm = { x: -dir.y * side, y: dir.x * side };
  let best = 0;
  for (const n of nbrs) {
    const ex = n.x - at.x, ey = n.y - at.y;
    const el = Math.hypot(ex, ey);
    if (el < 1e-9) continue;
    const d = { x: ex / el, y: ey / el };
    if (d.x * nrm.x + d.y * nrm.y <= 0) continue;
    const ang = Math.acos(Math.max(-1, Math.min(1, d.x * dir.x + d.y * dir.y)));
    const t = 1 / Math.tan(ang / 2);
    if (t > best) best = t;
  }
  return best;
}

const rgba = (c: RGB, a: number) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${Math.max(0, Math.min(1, a)).toFixed(3)})`;

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Paint frame data (in document points, with the context's transform). */
export function paintFrame(ctx: Ctx, F: FrameData, style: MStyle, t: number, swaps?: Swaps): void {
  const margin = style.marginWidth;
  const gap = style.gap;
  // ---- trim at the labels
  interface Raw extends Stroke { trimmed: [Vec, Vec]; labelled: [boolean, boolean] }
  const raw: Raw[] = [];
  for (const ln of F.lines) {
    let [p0, p1] = ln.base ?? [ln.p0, ln.p1];
    const at0 = p0, at1 = p1;
    let t0 = 0, t1 = 0;
    ln.ends.slice(0, 2).forEach((k, i) => {
      const bx = F.boxes.get(k);
      if (!bx || bx.alpha <= 0.01) return;
      // the box grows out of the atom with the label's opacity, so the bond end travels smoothly
      const la = Math.min(1, Math.max(0, bx.alpha));
      const anchor = i === 0 ? at0 : at1, far = i === 0 ? at1 : at0;
      for (const r of bx.rects) {
        const g: Rect = { x1: anchor.x + la * (r.x1 - anchor.x), y1: anchor.y + la * (r.y1 - anchor.y), x2: anchor.x + la * (r.x2 - anchor.x), y2: anchor.y + la * (r.y2 - anchor.y) };
        const e = exitParam(anchor, far, g);
        if (i === 0) t0 = Math.max(t0, e); else t1 = Math.max(t1, e);
      }
    });
    if (t0 + t1 >= 0.95) { t0 = Math.min(t0, 0.45); t1 = Math.min(t1, 0.45); }
    const d = { x: p1.x - p0.x, y: p1.y - p0.y };
    [p0, p1] = [{ x: p0.x + d.x * t0, y: p0.y + d.y * t0 }, { x: p1.x - d.x * t1, y: p1.y - d.y * t1 }];
    const labelled: [boolean, boolean] = [ln.ends[0] !== undefined && (F.boxes.get(ln.ends[0])?.alpha ?? 0) > 0.45, ln.ends[1] !== undefined && (F.boxes.get(ln.ends[1])?.alpha ?? 0) > 0.45];
    let q0 = p0, q1 = p1;
    if (ln.inner) {
      // the second line, off the trimmed bond, stopping short of the bonds at each end
      const L = Math.hypot(p1.x - p0.x, p1.y - p0.y);
      if (L < 1e-9) continue;
      const n = { x: -(p1.y - p0.y) / L, y: (p1.x - p0.x) / L };
      const off = ln.inner.off;
      q0 = { x: p0.x + off * n.x, y: p0.y + off * n.y };
      q1 = { x: p1.x + off * n.x, y: p1.y + off * n.y };
      if (!ln.inner.full && ln.inner.nbrs) {
        const side = Math.sign(off) || 1;
        const g = Math.abs(off) || gap;
        let u = labelled[0] ? 0 : Math.min(g * insetAt(at0, at1, side, ln.inner.nbrs[0]) + g * 0.15, L * 0.3);
        let v = labelled[1] ? 0 : Math.min(g * insetAt(at1, at0, -side, ln.inner.nbrs[1]) + g * 0.15, L * 0.3);
        const k = ln.inner.trim ?? 1;
        u *= k; v *= k;
        const ux = (p1.x - p0.x) / L, uy = (p1.y - p0.y) / L;
        q0 = { x: q0.x + ux * u, y: q0.y + uy * u };
        q1 = { x: q1.x - ux * v, y: q1.y - uy * v };
      }
    }
    if (Math.hypot(q1.x - q0.x, q1.y - q0.y) < 1e-6) continue;
    raw.push({ ...ln, p0: q0, p1: q1, trimmed: [p0, p1], labelled });
  }

  // ---- crossing gaps: the bond in front cuts the one behind
  const half = margin + style.lineWidth;
  const cuts: [number, number][][] = raw.map(() => []);
  for (let i = 0; i < raw.length; i++) for (let j = i + 1; j < raw.length; j++) {
    const r = raw[i], s = raw[j];
    if (r.grp === s.grp || r.ends.some((e) => s.ends.includes(e))) continue;
    const sched = swaps?.get(pairKey(r.grp, s.grp));
    let bi: number, fi: number;
    if (sched) { const front = t < sched[0] ? sched[1] : sched[2]; [bi, fi] = r.grp === front ? [j, i] : [i, j]; } else if (r.z < s.z) [bi, fi] = [i, j];
    else [bi, fi] = [j, i];
    if (raw[fi].alpha <= 0.5) continue;
    const back = raw[bi], front = raw[fi];
    const c = crossAt(back.p0, back.p1, front.p0, front.p1);
    if (!c) continue;
    const L = Math.hypot(back.p1.x - back.p0.x, back.p1.y - back.p0.y);
    const h = half / Math.max(0.35, c.sin);
    cuts[bi].push([c.t * L - h, c.t * L + h]);
  }

  // ---- draw, back to front
  const order = raw.map((_, i) => i).sort((a, b) => raw[a].z - raw[b].z);
  ctx.lineJoin = 'round';
  for (const i of order) {
    const r = raw[i];
    const st = r.stereo;
    const whole = !st || st.display !== 'dash';
    const segs = punchSurviving(r.p0, r.p1, cuts[i], r.w, r.labelled, whole);
    if (!segs.length) continue;
    if (st && st.display !== 'bold') { drawStereo(ctx, r, segs, style); continue; }
    ctx.lineCap = st?.display === 'bold' ? 'butt' : 'round';
    ctx.lineWidth = r.w;
    ctx.setLineDash(r.dashed ? [style.lineWidth * 2.2, style.lineWidth * 2.2] : []);
    for (const [a, b, wt] of segs) {
      ctx.strokeStyle = rgba(r.color, r.alpha * wt);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---- aromatic circles
  for (const ring of F.rings) {
    const c = circleIn(ring.pts);
    ctx.strokeStyle = rgba(ring.color, ring.alpha);
    ctx.lineWidth = ring.w;
    ctx.beginPath();
    if (c.ellipse) {
      const n = 48;
      for (let k = 0; k <= n; k++) {
        const ph = (2 * Math.PI * k) / n, [a, b, cc, d] = c.ellipse.m, rr = c.ellipse.r;
        const x = c.center.x + rr * (a * Math.cos(ph) + b * Math.sin(ph)), y = c.center.y + rr * (cc * Math.cos(ph) + d * Math.sin(ph));
        if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      }
    } else ctx.arc(c.center.x, c.center.y, c.radius, 0, 2 * Math.PI);
    ctx.stroke();
  }

  // ---- labels and charges, over the bonds
  ctx.textBaseline = 'alphabetic';
  let font = '';
  for (const tx of F.texts) {
    if (tx.alpha <= 0.004) continue;
    const f = `${tx.size}px ${style.font}`;
    if (f !== font) { ctx.font = f; font = f; }
    ctx.fillStyle = rgba(tx.color, tx.alpha);
    ctx.fillText(tx.text, tx.x, tx.y);
  }
}

/** A wedge, hashed wedge, hash, dashed, wavy or dative bond, along its surviving pieces. */
function drawStereo(ctx: Ctx, r: Stroke & { trimmed: [Vec, Vec] }, segs: Piece[], style: MStyle): void {
  const st = r.stereo!;
  // the bond runs from the end nearest its narrow atom to the far end
  const pts = segs.flatMap(([a, b]) => [a, b]);
  let j0 = 0;
  pts.forEach((p, i) => { if (Math.hypot(p.x - st.begin.x, p.y - st.begin.y) < Math.hypot(pts[j0].x - st.begin.x, pts[j0].y - st.begin.y)) j0 = i; });
  let j1 = 0;
  pts.forEach((p, i) => { if (Math.hypot(p.x - pts[j0].x, p.y - pts[j0].y) > Math.hypot(pts[j1].x - pts[j0].x, pts[j1].y - pts[j0].y)) j1 = i; });
  const s = pts[j0], e = pts[j1];
  const L = Math.hypot(e.x - s.x, e.y - s.y);
  if (L < 1e-9) return;
  const dir = { x: (e.x - s.x) / L, y: (e.y - s.y) / L }, n = { x: -dir.y, y: dir.x };
  const k = r.w / style.lineWidth || 1;
  const lw = style.lineWidth * k;
  const colour = rgba(r.color, r.alpha);
  ctx.strokeStyle = ctx.fillStyle = colour;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  // a piece left out by a crossing leaves out the rungs that fall in it
  const kept = (f: number) => segs.some(([a, b]) => {
    const fa = ((a.x - s.x) * dir.x + (a.y - s.y) * dir.y) / L, fb = ((b.x - s.x) * dir.x + (b.y - s.y) * dir.y) / L;
    return f >= Math.min(fa, fb) - 1e-6 && f <= Math.max(fa, fb) + 1e-6;
  });
  switch (st.display) {
    case 'wedge': {
      const w = (style.wedge * k) / 2, ww = lw / 2;
      ctx.beginPath();
      ctx.moveTo(s.x + n.x * ww, s.y + n.y * ww);
      ctx.lineTo(e.x + n.x * w, e.y + n.y * w);
      ctx.lineTo(e.x - n.x * w, e.y - n.y * w);
      ctx.lineTo(s.x - n.x * ww, s.y - n.y * ww);
      ctx.closePath();
      ctx.fill();
      return;
    }
    case 'hashWedge':
    case 'hash': {
      const count = Math.max(2, st.rungs || Math.floor(L / (style.hashSpacing * k)));
      const wide = st.display === 'hash' ? (style.boldWidth * k) / 2 : (style.wedge * k) / 2;
      ctx.beginPath();
      for (let i = 0; i <= count; i++) {
        const f = i / count;
        if (!kept(f)) continue;
        const c = { x: s.x + dir.x * L * f, y: s.y + dir.y * L * f };
        const hw = st.display === 'hash' ? wide : lw / 2 + (wide - lw / 2) * f;
        ctx.moveTo(c.x + n.x * hw, c.y + n.y * hw);
        ctx.lineTo(c.x - n.x * hw, c.y - n.y * hw);
      }
      ctx.stroke();
      return;
    }
    case 'dash': {
      ctx.setLineDash([lw * 2.2, lw * 2.2]);
      ctx.beginPath();
      for (const [a, b] of segs) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
      ctx.stroke();
      ctx.setLineDash([]);
      return;
    }
    case 'wavy': {
      const waves = Math.max(2, Math.round(L / (style.bondLength * k * 0.17)));
      const step = L / waves, amp = style.bondLength * k * 0.09;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      for (let i = 0; i < waves; i++) {
        const a = { x: s.x + dir.x * step * i, y: s.y + dir.y * step * i };
        const c = { x: s.x + dir.x * step * (i + 1), y: s.y + dir.y * step * (i + 1) };
        const sg = i % 2 ? -1 : 1;
        ctx.quadraticCurveTo(a.x + dir.x * step / 2 + n.x * sg * amp * 2, a.y + dir.y * step / 2 + n.y * sg * amp * 2, c.x, c.y);
      }
      ctx.stroke();
      return;
    }
    case 'dative': {
      // a line with a filled head at the far atom
      const hl = Math.min(L * 0.45, lw * 8), hw = lw * 2.2;
      const base = { x: e.x - dir.x * hl, y: e.y - dir.y * hl };
      ctx.beginPath();
      for (const [a, b] of segs) {
        const fb = Math.min(1, ((b.x - s.x) * dir.x + (b.y - s.y) * dir.y) / L);
        const stop = Math.min(fb, (L - hl * 0.7) / L);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(s.x + dir.x * L * stop, s.y + dir.y * L * stop);
      }
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(e.x, e.y);
      ctx.lineTo(base.x + n.x * hw, base.y + n.y * hw);
      ctx.lineTo(base.x - n.x * hw, base.y - n.y * hw);
      ctx.closePath();
      ctx.fill();
      return;
    }
  }
}

/** The box (document points) that every frame of a step fits in, labels included. */
export function framesBox(datas: FrameData[], pad: number): Rect {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  const take = (p: Vec) => { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); };
  for (const F of datas) {
    for (const l of F.lines) { take(l.p0); take(l.p1); }
    for (const b of F.boxes.values()) for (const r of b.rects) { take({ x: r.x1, y: r.y1 }); take({ x: r.x2, y: r.y2 }); }
    for (const tx of F.texts) { take({ x: tx.x, y: tx.y - tx.size }); take({ x: tx.x + tx.size * tx.text.length * 0.7, y: tx.y + tx.size * 0.3 }); }
  }
  return { x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad };
}
