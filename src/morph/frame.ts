// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// Everything drawn at one moment of a step: where each atom is, every stroke with its opacity,
// and the label glyphs. Paired atoms travel to their partners; unpaired ones ride along with
// their neighbours; bonds and labels with no partner dissolve. Only continuous things (places,
// sizes, colours, opacity) are interpolated; anything discrete (a wedge, a Kekulé form, which
// side a double bond's line is on) changes in a single frame where it can't be seen.

import type { BondDisplay } from '../model';
import type { Rect, Vec } from '../geom';
import { doubleSide, doubleRing, alternating, type MScene, type RGB, type MNode, type Glyph } from './scene';
import { turnAt, type TurnPlan } from './turn';
import type { Mapping } from './mapping';
import type { NodeMap } from './match';
import type { Placement } from './rotate';

export interface Inner {
  /** Offset from the bond, along its left normal, in points. */
  off: number;
  /** Positions of the other bonds at each end, which the line stops short of. */
  nbrs: [Vec[], Vec[]] | null;
  /** Runs the whole length (a pair centred on the bond). */
  full?: boolean;
  /** Fraction of the usual shortening (a line that is a triple's flank at one end and a double's inner line at the other). */
  trim?: number;
}

export interface Stereo { display: BondDisplay; begin: Vec; rungs: number }

export interface Stroke {
  p0: Vec;
  p1: Vec;
  color: RGB;
  z: number;
  alpha: number;
  w: number;
  /** Keys of the atoms it runs between (and a 1,2-shift's destination): bonds meeting there don't gap it. */
  ends: string[];
  /** The bond it belongs to: lines of one bond never gap each other. */
  grp: string;
  stereo?: Stereo | null;
  /** The bond itself, for an offset line: trimmed at the labels, then offset. */
  base?: [Vec, Vec];
  inner?: Inner;
  dashed?: boolean;
}

export interface TextPiece { text: string; x: number; y: number; size: number; color: RGB; alpha: number }
export interface LabelBox { rects: Rect[]; alpha: number; at: Vec }
export interface RingPiece { pts: Vec[]; color: RGB; alpha: number; w: number }

export interface FrameData {
  lines: Stroke[];
  texts: TextPiece[];
  boxes: Map<string, LabelBox>;
  rings: RingPiece[];
}

export interface FrameOptions {
  /** A group turning about a bond, found by turnPlan. */
  turn?: TurnPlan | null;
  /** Ring bonds that only change Kekulé form, and when they switch. */
  kekule?: [Set<string>, number] | null;
  /** Turn the whole structure over about this axis (point, direction). */
  flip?: [Vec, Vec] | null;
  /** How much of the step a bond takes to dissolve (1 = the whole step). */
  dissolve?: number;
  /**
   * A 3-D turn: where every atom of the start is at time t, and its depth. Bonds stack by depth
   * while turning and by the drawings' own order at the two ends; wedges cross-dissolve.
   */
  place?: ((t: number) => Placement) | null;
  /** Ring double bonds whose inner line closes up as the ring turns edge-on (rotate.ts ringOpenness). */
  openness?: Map<string, [string[], number, number]> | null;
}

const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const lerpV = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x * (1 - t) + b.x * t, y: a.y * (1 - t) + b.y * t });
const lerpC = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** 0 below lo, 1 above hi, eased (smoothstep) so a fade starts and ends without a corner. */
export function ramp(t: number, lo: number, hi: number, smooth = true): number {
  const u = Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
  return smooth ? u * u * (3 - 2 * u) : u;
}

/** Depth of every atom and bond as a rank from 0 (back) to 1 (front). */
function znorm(sc: MScene): Map<number, number> {
  const zs = [...new Set([...sc.bonds.values()].map((b) => b.z))].sort((a, b) => a - b);
  return new Map(zs.map((z, i) => [z, i / Math.max(zs.length - 1, 1)]));
}

function turnEnd(p: Vec, o: Vec, u: Vec): Vec {
  const d = { x: p.x - o.x, y: p.y - o.y };
  const k = d.x * u.x + d.y * u.y;
  const par = { x: k * u.x, y: k * u.y };
  return { x: o.x + par.x - (d.x - par.x), y: o.y + par.y - (d.y - par.y) };
}

/**
 * Atom positions of `sc` at time t: paired atoms move towards their partners, unpaired ones ride
 * along with their paired neighbours. `pinned` holds atoms a turn places.
 */
export function flow(sc: MScene, other: MScene, nmap: NodeMap, t: number, flip: [Vec, Vec] | null = null, pinned: Map<string, Vec> | null = null): Map<string, Vec> {
  const P = new Map<string, Vec>(), disp = new Map<string, Vec>();
  const c = Math.cos(Math.PI * t);
  const turn = (p: Vec) => {
    const [o, u] = flip!;
    const d = { x: p.x - o.x, y: p.y - o.y };
    const k = d.x * u.x + d.y * u.y;
    return { x: o.x + k * u.x + c * (d.x - k * u.x), y: o.y + k * u.y + c * (d.y - k * u.y) };
  };
  for (const [a, n] of sc.nodes) {
    const pa = n.p;
    const partner = nmap.get(a);
    if (partner === undefined) continue;
    const pb = other.nodes.get(partner)!.p;
    let q: Vec;
    if (pinned?.has(a)) q = pinned.get(a)!;
    else if (!flip) q = lerpV(pa, pb, t);
    else {
      const tp = turn(pa), te = turnEnd(pa, flip[0], flip[1]);
      q = { x: tp.x + t * (pb.x - te.x), y: tp.y + t * (pb.y - te.y) };
    }
    P.set(a, q);
    disp.set(a, { x: q.x - pa.x, y: q.y - pa.y });
  }
  const nbr = sc.nbr;
  for (let it = 0; it < 8; it++) {
    for (const a of sc.nodes.keys()) {
      if (disp.has(a)) continue;
      const d = nbr.get(a)!.filter((n) => disp.has(n)).map((n) => disp.get(n)!);
      if (d.length) disp.set(a, { x: d.reduce((s, v) => s + v.x, 0) / d.length, y: d.reduce((s, v) => s + v.y, 0) / d.length });
    }
  }
  for (const [a, n] of sc.nodes) {
    if (P.has(a)) continue;
    if (pinned?.has(a)) { P.set(a, pinned.get(a)!); continue; }
    const d = disp.get(a) ?? { x: 0, y: 0 };
    P.set(a, { x: n.p.x + d.x, y: n.p.y + d.y });
  }
  return P;
}

/** Positions of the other bonds at each end of a bond. */
function neighbours(sc: MScene, bid: string, P: Map<string, Vec>): [Vec[], Vec[]] {
  const b = sc.bonds.get(bid)!;
  const nb = sc.nbr;
  return [nb.get(b.b)!.filter((m) => m !== b.e).map((m) => P.get(m)!), nb.get(b.e)!.filter((m) => m !== b.b).map((m) => P.get(m)!)];
}

const STEREO: ReadonlySet<BondDisplay> = new Set(['wedge', 'hashWedge', 'hash', 'bold', 'dash', 'wavy', 'dative']);

function stereoOf(sc: MScene, bid: string, P: Map<string, Vec>, narrow?: string): Stereo | null {
  const bd = sc.bonds.get(bid)!;
  if (!STEREO.has(bd.display) || bd.order !== 1) return null;
  return { display: bd.display, begin: P.get(narrow ?? bd.b)!, rungs: bd.rungs };
}

/** `doubleSide` of a product bond, put in terms of the start bond's direction. */
function sideFor(B: MScene, bidB: string, PB: Map<string, Vec>, aBegin: string, nmap: NodeMap): number {
  const s = doubleSide(B, bidB, PB);
  return nmap.get(aBegin) !== B.bonds.get(bidB)!.b ? -s : s;
}

/**
 * The parallel lines of a bond whose ORDER changes through a triple (centre, near flank, far
 * flank), so the lines both drawings share stay put and only the others fade. Each track is
 * (offset in units of the line spacing, opacity, inner-line details).
 */
function orderTracks(oa: number, ob: number, t: number, sideA: number, sideB: number, gap: number, nbrs: [Vec[], Vec[]] | null): [number, number, Inner | null][] {
  const ref = sideB || sideA || 1;
  const sideOf = (order: number, s: number): [number, number][] => {
    if (order >= 3) return [[0, 1], [1, 1], [-1, 1]];
    if (order === 2) {
      if (s) { const near = s * ref > 0 ? 1 : -1; return [[0, 1], [near, 1], [-near, 0]]; }
      return [[0, 0], [0.5, 1], [-0.5, 1]];
    }
    return [[0, 1], [1, 0], [-1, 0]];
  };
  const fa = sideOf(oa, sideA), fb = sideOf(ob, sideB);
  let innerAt = -1, trim = 1;
  if (ob === 2 && sideB) { innerAt = 1; trim = t; } else if (oa === 2 && sideA) { innerAt = 1; trim = 1 - t; }
  return fa.map(([ma, aa], i) => {
    const [mb, ab] = fb[i];
    const m = lerp(ma, mb, t), al = lerp(aa, ab, t);
    const inner = i === innerAt && nbrs ? { off: m * ref * gap, trim, nbrs } : null;
    return [m * ref, al, inner];
  });
}

interface EmitArgs {
  p0: Vec; p1: Vec; side: number; color: RGB; z: number; alpha: number; w: number; ends: string[]; grp: string;
  second: number; nbrs: [Vec[], Vec[]] | null; stereo: Stereo | null; triple: boolean;
  flanks: [number, number, Inner | null][] | null; aromatic: boolean;
}

/** The strokes of one bond: one line, a double's two, or a triple's three. */
function emit(lines: Stroke[], gap: number, a: EmitArgs): void {
  const { p0, p1, side, color, z, alpha, w, ends, grp, second, nbrs, stereo } = a;
  const d = { x: p1.x - p0.x, y: p1.y - p0.y };
  const L = Math.hypot(d.x, d.y) || 1;
  const n = { x: -d.y / L, y: d.x / L };
  const at = (k: number): [Vec, Vec] => [{ x: p0.x + k * n.x, y: p0.y + k * n.y }, { x: p1.x + k * n.x, y: p1.y + k * n.y }];
  // how "double" the bond is now: the spacing grows with it, so a forming line opens out of the bond
  const frac = alpha > 1e-6 ? Math.min(1, second / alpha) : 1;
  if (a.triple) {
    const tracks = a.flanks ?? [[0, alpha, null], [1, second, null], [-1, second, null]];
    for (const [sgn, al, inner] of tracks) {
      if (al <= 0.004) continue;
      const [q0, q1] = at(sgn * frac * gap);
      const row: Stroke = { p0: q0, p1: q1, color, z, alpha: al, w, ends, grp, stereo: sgn === 0 ? stereo : null };
      if (inner) { row.base = [p0, p1]; row.inner = inner; }
      lines.push(row);
    }
    return;
  }
  if (second <= 0.01) {
    lines.push({ p0, p1, color, z, alpha, w, ends, grp, stereo });
    return;
  }
  if (Math.abs(side) < 1e-9) {
    // a pair centred on the bond (C=O): both lines run the whole length
    for (const sgn of [1, -1]) {
      const off = (sgn * frac * gap) / 2;
      const [q0, q1] = at(off);
      lines.push({ p0: q0, p1: q1, color, z, alpha: sgn > 0 ? alpha : second, w, ends, grp, stereo: sgn > 0 ? stereo : null, base: [p0, p1], inner: { off, nbrs: null, full: true }, dashed: sgn < 0 && a.aromatic });
    }
    return;
  }
  lines.push({ p0, p1, color, z, alpha, w, ends, grp, stereo });
  const off = side * frac * gap;
  const [q0, q1] = at(off);
  // the inner line is rebuilt once the main line has been trimmed at its labels
  lines.push({ p0: q0, p1: q1, color, z, alpha: second, w, ends, grp, base: [p0, p1], inner: { off, nbrs }, dashed: a.aromatic });
}

/** The glyphs of a label, placed at an atom now at `at` with offsets interpolated towards `to`. */
function placeGlyphs(texts: TextPiece[], gs: Glyph[], at: Vec, color: RGB, alpha: number, to?: Glyph[], t = 0): void {
  if (alpha <= 0.01) return;
  gs.forEach((g, i) => {
    const h = to?.[i];
    texts.push({
      text: g.text,
      x: at.x + (h ? lerp(g.dx, h.dx, t) : g.dx),
      y: at.y + (h ? lerp(g.dy, h.dy, t) : g.dy),
      size: h ? lerp(g.size, h.size, t) : g.size,
      color, alpha,
    });
  });
}

function unionRel(rs: Rect[]): Rect {
  return rs.reduce((u, r) => ({ x1: Math.min(u.x1, r.x1), y1: Math.min(u.y1, r.y1), x2: Math.max(u.x2, r.x2), y2: Math.max(u.y2, r.y2) }), { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity });
}

const lerpR = (a: Rect, b: Rect, t: number): Rect => ({ x1: lerp(a.x1, b.x1, t), y1: lerp(a.y1, b.y1, t), x2: lerp(a.x2, b.x2, t), y2: lerp(a.y2, b.y2, t) });
const shiftR = (r: Rect, p: Vec): Rect => ({ x1: r.x1 + p.x, y1: r.y1 + p.y, x2: r.x2 + p.x, y2: r.y2 + p.y });

/** Everything drawn at time t of a step from A to B. */
export function frame(A: MScene, B: MScene, M: Mapping, t: number, opt: FrameOptions = {}): FrameData {
  const { nmap, bmap, shifts, slides } = M;
  const dissolve = opt.dissolve ?? 1;
  const inv: NodeMap = new Map([...nmap].map(([k, v]) => [v, k]));
  const binv = new Map<string, string>([...bmap].map(([k, v]) => [v, k]));
  for (const [k, s] of shifts) binv.set(s.tgt, k);
  const turn = opt.turn ?? null;
  let pinA: Map<string, Vec> | null = null, pinB: Map<string, Vec> | null = null;
  if (turn) {
    pinA = new Map([...turnAt(turn, t)].map(([k, v]) => [k, v[0]]));
    pinB = new Map([...pinA].filter(([k]) => nmap.has(k)).map(([k, v]) => [nmap.get(k)!, v]));
  }
  let depth: Map<string, number> | null = null;
  if (opt.place) {
    const pl = opt.place(t);
    pinA = pl.pos;
    pinB = new Map([...pinA].filter(([k]) => nmap.has(k)).map(([k, v]) => [nmap.get(k)!, v]));
    depth = pl.depth;
  }
  const flip = opt.flip ?? null;
  const PA = flow(A, B, nmap, t, flip, pinA);
  const PB = flow(B, A, inv, 1 - t, flip, pinB);
  const zA = znorm(A), zB = znorm(B);
  // a turn stacks bonds by depth, except at its two ends, which must be the drawings themselves
  const END = 1e-3;
  const atStart = t <= END, atEnd = t >= 1 - END;
  let depthB: Map<string, number> | null = null;
  if (depth) {
    depthB = new Map();
    for (const k of B.nodes.keys()) { const a = inv.get(k); if (a !== undefined && depth.has(a)) depthB.set(k, depth.get(a)!); }
    for (const k of B.nodes.keys()) {
      if (depthB.has(k)) continue;
      const d = B.nbr.get(k)!.filter((n) => depthB!.has(n)).map((n) => depthB!.get(n)!);
      depthB.set(k, d.length ? d.reduce((s, x) => s + x, 0) / d.length : 0);
    }
  }
  const zTurnA = (aid: string, rankB?: number): number => {
    const a = A.bonds.get(aid)!;
    if (atStart || (atEnd && rankB === undefined)) return zA.get(a.z)!;
    if (atEnd) return rankB!;
    return (depth!.get(a.b)! + depth!.get(a.e)!) / 2;
  };
  const area = (ks: string[]) => Math.abs(ks.reduce((s, k, i) => { const p = PA.get(k)!, q = PA.get(ks[(i + 1) % ks.length])!; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
  const gap = A.style.gap;
  const fadeOut = 1 - ramp(t, 0, dissolve);
  const fadeIn = ramp(t, 1 - dissolve, 1);

  // a line that slides is drawn once, travelling; the bonds it leaves and joins don't also fade one
  const hushSecond = new Set<string>();
  const hushArrive = new Set<string>();
  for (const s of slides) { hushSecond.add(s.src); if (s.tgtA !== null) hushSecond.add(s.tgtA); else hushArrive.add(s.tgtB); }

  const ka = (a: string) => (nmap.has(a) ? 'M:' + a : 'A:' + a);
  const kb = (b: string) => (inv.has(b) ? 'M:' + inv.get(b)! : 'B:' + b);
  const lines: Stroke[] = [], texts: TextPiece[] = [], rings: RingPiece[] = [];
  const boxes = new Map<string, LabelBox>();

  for (const [aid, a] of A.bonds) {
    let p0 = PA.get(a.b)!, p1 = PA.get(a.e)!;
    let col = a.color;
    let wid = a.w;
    let z = zA.get(a.z)!, alpha = 1;
    let second = a.order >= 2 ? 1 : 0;
    let side = a.order === 2 ? doubleSide(A, aid, PA) : 0;
    let triple = a.order >= 3;
    let flanks: [number, number, Inner | null][] | null = null;
    let ends = [ka(a.b), ka(a.e)];
    let aromatic = a.aromatic;
    if (bmap.has(aid)) {
      const bb = B.bonds.get(bmap.get(aid)!)!;
      col = lerpC(col, bb.color, t);
      wid = lerp(wid, bb.w, t);
      z = depth ? zTurnA(aid, zB.get(bb.z)!) : lerp(z, zB.get(bb.z)!, t);
      triple = a.order >= 3 || bb.order >= 3;
      aromatic = t < 0.5 ? a.aromatic : bb.aromatic;
      const kek = opt.kekule && opt.kekule[0].has(aid);
      if (kek) {
        // the ring's double bonds hold where drawn and change in one frame
        const useB = t >= opt.kekule![1];
        const src = useB ? bb : a;
        second = src.order >= 2 ? 1 : 0;
        side = src.order === 2 ? (useB ? sideFor(B, bmap.get(aid)!, PB, a.b, nmap) : doubleSide(A, aid, PA)) : 0;
      } else if (bb.order >= 2 && a.order < 2) {
        second = t;
        side = sideFor(B, bmap.get(aid)!, PB, a.b, nmap);
      } else if (a.order >= 2 && bb.order < 2) {
        second = 1 - t;
      }
      if (kek) { /* settled above */ } else if (Math.max(a.order, bb.order) >= 3 && a.order !== bb.order) {
        flanks = orderTracks(a.order, bb.order, t, a.order === 2 ? doubleSide(A, aid, PA) : 0, bb.order === 2 ? sideFor(B, bmap.get(aid)!, PB, a.b, nmap) : 0, gap, neighbours(A, aid, PA));
        second = 1;
      } else if (a.order === 2 && bb.order === 2) {
        // which side the line is on is a choice, not a quantity: in a ring it is inside at every
        // frame (the frame's own geometry says where); elsewhere it closes onto the bond and opens
        // on the other side around the midpoint
        const sideB = sideFor(B, bmap.get(aid)!, PB, a.b, nmap);
        const ring = doubleRing(A, aid);
        if (side === 0 && sideB === 0) { /* a centred pair at both ends */ } else if (!(ring && alternating(A, ring))) {
          const w = Math.min(Math.max((t - 0.35) / 0.3, 0), 1);
          side = side * (1 - w) + sideB * w;
          if (Math.abs(side) < 0.02) side = 0.02 * (sideB > 0 ? 1 : -1);
        }
      }
      if (opt.openness?.has(aid) && a.order === 2 && bb.order === 2) {
        // the inner line closes onto its bond as the ring turns edge-on, and opens on the other side
        const [ring, a0, a1] = opt.openness.get(aid)!;
        const want = lerp(a0, a1, t);
        const f = want > 1e-6 ? Math.min(1, area(ring) / want) : 1;
        side = (side < 0 ? -1 : 1) * Math.max(f, 0.02);
      }
      if (hushSecond.has(aid)) second = 0;
    } else if (shifts.has(aid)) {
      const { tgt, mover, dest } = shifts.get(aid)!;
      const bb = B.bonds.get(tgt)!;
      // the moving end rides the line between the two atoms' own paths
      const walk = lerpV(PA.get(mover)!, PA.get(dest)!, t);
      if (a.b === mover) p0 = walk; else p1 = walk;
      col = lerpC(col, bb.color, t);
      z = lerp(z, zB.get(bb.z)!, t);
      triple = a.order >= 3 || bb.order >= 3;
      if (bb.order >= 2 && a.order < 2) { second = t; side = sideFor(B, tgt, PB, a.b, nmap); } else if (a.order >= 2 && bb.order < 2) second = 1 - t;
      ends = [ka(a.b), ka(a.e), ka(dest)];
    } else {
      alpha = fadeOut;
      if (depth) z = zTurnA(aid);
    }
    if (alpha <= 0.01) continue;
    const stA = stereoOf(A, aid, PA);
    const tgtB = bmap.get(aid) ?? shifts.get(aid)?.tgt;
    let stB: Stereo | null = null, narrowB = a.b;
    if (tgtB !== undefined) {
      const bb = B.bonds.get(tgtB)!;
      const s = stereoOf(B, tgtB, PB);
      // a wedge narrows at its bond's first atom; the product may store the bond the other way round
      narrowB = nmap.get(a.b) === bb.b ? a.b : a.e;
      if (s) stB = { ...s, begin: PA.get(narrowB)! };
    }
    let stereo = stA;
    const differs = (stA?.display ?? 'solid') !== (stB?.display ?? 'solid') || (stA && stB && narrowB !== a.b);
    if (differs && depth) {
      // turning, a wedge becomes a plain line (or the reverse) by cross-dissolving: both shapes,
      // one fading as the other comes
      const f = ramp(t, 0, 1);
      const base = { p0, p1, side, color: col, z, w: wid, ends, grp: 'A' + aid, nbrs: neighbours(A, aid, PA), triple, aromatic };
      if (1 - f > 0.004) emit(lines, gap, { ...base, alpha: alpha * (1 - f), second: second * alpha * (1 - f), stereo: stA, flanks: null });
      if (f > 0.004) emit(lines, gap, { ...base, alpha: alpha * f, second: second * alpha * f, stereo: stB, flanks: null });
      continue;
    }
    if (differs) {
      // a wedge has no halfway shape: change it in one frame, at the midpoint, or where its
      // group passes edge-on if it turns
      let tSw = 0.5;
      if (turn && Math.abs(turn.theta) > 1e-6 && turn.group.includes(a.b) && turn.group.includes(a.e)) tSw = Math.min(1, Math.max(0, (Math.PI / 2) / Math.abs(turn.theta)));
      if (t >= tSw) stereo = stB;
    }
    emit(lines, gap, {
      p0, p1, side, color: col, z, alpha, w: wid, ends, grp: 'A' + aid, second: second * alpha,
      nbrs: neighbours(A, aid, PA), stereo, triple, flanks: flanks ? flanks.map(([m, al, inn]) => [m, al * alpha, inn]) : null, aromatic,
    });
  }

  for (const [bid, b] of B.bonds) {
    if (binv.has(bid) || fadeIn <= 0.01 || hushArrive.has(bid)) continue;
    const zb = depthB && !atStart && !atEnd ? (depthB.get(b.b)! + depthB.get(b.e)!) / 2 : zB.get(b.z)!;
    emit(lines, gap, {
      p0: PB.get(b.b)!, p1: PB.get(b.e)!, side: b.order === 2 ? doubleSide(B, bid, PB) : 0, color: b.color, z: zb,
      alpha: fadeIn, w: b.w, ends: [kb(b.b), kb(b.e)], grp: 'B' + bid, second: b.order >= 2 ? fadeIn : 0,
      nbrs: neighbours(B, bid, PB), stereo: stereoOf(B, bid, PB), triple: b.order >= 3, flanks: null, aromatic: b.aromatic,
    });
  }

  // ---- lines that travel from one bond to another (a drawing choice; nothing models electrons)
  const offsetLine = (sc: MScene, bid: string, P: Map<string, Vec>, sSide: number): [Vec, Vec] => {
    const bd = sc.bonds.get(bid)!;
    const q0 = P.get(bd.b)!, q1 = P.get(bd.e)!;
    const L = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1e-9;
    const n = { x: -(q1.y - q0.y) / L, y: (q1.x - q0.x) / L };
    const s = sSide || 1;
    const r0 = { x: q0.x + s * gap * n.x, y: q0.y + s * gap * n.y }, r1 = { x: q1.x + s * gap * n.x, y: q1.y + s * gap * n.y };
    const inset = 0.15;
    return [lerpV(r0, r1, inset), lerpV(r0, r1, 1 - inset)];
  };
  for (const s of slides) {
    let [a0, a1] = offsetLine(A, s.src, PA, doubleSide(A, s.src, PA));
    let b0: Vec, b1: Vec;
    if (s.tgtA !== null) [b0, b1] = offsetLine(A, s.tgtA, PA, sideFor(B, s.tgtB, PB, A.bonds.get(s.tgtA)!.b, nmap));
    else {
      b0 = PA.get(s.tu)!; b1 = PA.get(s.tv)!;
      if (Math.hypot(b0.x - a0.x, b0.y - a0.y) > Math.hypot(b1.x - a0.x, b1.y - a0.y)) [b0, b1] = [b1, b0];
    }
    let piv: Vec | null = null;
    if (s.tgtA !== null) {
      const sa = A.bonds.get(s.src)!, ta = A.bonds.get(s.tgtA)!;
      const shared = [sa.b, sa.e].filter((k) => k === ta.b || k === ta.e);
      if (shared.length === 1) piv = PA.get(shared[0])!;
    }
    let q0: Vec, q1: Vec;
    if (piv) {
      // pivot about the shared atom, keeping the line's length, rather than cutting the chord
      const p = piv;
      const near = (u: Vec, v: Vec): [Vec, Vec] => (Math.hypot(u.x - p.x, u.y - p.y) <= Math.hypot(v.x - p.x, v.y - p.y) ? [u, v] : [v, u]);
      [a0, a1] = near(a0, a1);
      [b0, b1] = near(b0, b1);
      const swing = (pa: Vec, pb: Vec): Vec => {
        const da = { x: pa.x - p.x, y: pa.y - p.y }, db = { x: pb.x - p.x, y: pb.y - p.y };
        const tha = Math.atan2(da.y, da.x), thb = Math.atan2(db.y, db.x);
        const dth = ((thb - tha + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
        const th = tha + dth * t;
        const r = lerp(Math.hypot(da.x, da.y), Math.hypot(db.x, db.y), t);
        return { x: p.x + r * Math.cos(th), y: p.y + r * Math.sin(th) };
      };
      q0 = swing(a0, b0); q1 = swing(a1, b1);
    } else { q0 = lerpV(a0, b0, t); q1 = lerpV(a1, b1, t); }
    const sa = A.bonds.get(s.src)!, tb = B.bonds.get(s.tgtB)!;
    lines.push({
      p0: q0, p1: q1, color: lerpC(sa.color, tb.color, t), z: lerp(zA.get(sa.z)!, zB.get(tb.z)!, t), alpha: 1, w: A.style.lineWidth,
      ends: s.tgtA === null ? [ka(s.tu), ka(s.tv)] : [ka(A.bonds.get(s.tgtA)!.b), ka(A.bonds.get(s.tgtA)!.e)], grp: 'S' + s.src, stereo: null,
    });
  }

  // ---- labels
  const box = (key: string, rects: Rect[], alpha: number, at: Vec) => {
    const prev = boxes.get(key);
    if (!prev || alpha > prev.alpha) boxes.set(key, { rects, alpha, at });
  };
  const pushWhole = (n: MNode, P: Map<string, Vec>, key: string, alpha: number) => {
    const L = n.label;
    if (!L || alpha <= 0.01) return;
    const at = P.get(n.key)!;
    placeGlyphs(texts, L.glyphs, at, L.color, alpha);
    box(key, L.boxes.map((r) => shiftR(r, at)), alpha, at);
  };
  for (const [a, na] of A.nodes) {
    const la = na.label;
    if (!la) continue;
    const b = nmap.get(a);
    if (b === undefined) { pushWhole(na, PA, ka(a), fadeOut); continue; }
    const nb = B.nodes.get(b)!, lb = nb.label;
    const at = PA.get(a)!;
    if (lb && la.shown === lb.shown && la.glyphs.length === lb.glyphs.length) {
      placeGlyphs(texts, la.glyphs, at, lerpC(la.color, lb.color, t), 1, lb.glyphs, t);
      const rects = la.boxes.length === lb.boxes.length ? la.boxes.map((r, i) => lerpR(r, lb.boxes[i], t)) : la.boxes;
      box(ka(a), rects.map((r) => shiftR(r, at)), 1, at);
    } else if (lb && la.attach && la.attach === lb.attach) {
      // the atom keeps its place while what hangs off it changes: the glyph the bonds meet stays
      // solid and travels; only the rest dissolves (or travels, when it is the same)
      const ga = la.glyphs.filter((g) => g.attach), gb = lb.glyphs.filter((g) => g.attach);
      const ra = la.glyphs.filter((g) => !g.attach), rb = lb.glyphs.filter((g) => !g.attach);
      const col = lerpC(la.color, lb.color, t);
      placeGlyphs(texts, ga, at, col, 1, gb.length === ga.length ? gb : undefined, t);
      if (ra.length === rb.length && ra.every((g, i) => g.text === rb[i].text)) placeGlyphs(texts, ra, at, col, 1, rb, t);
      else { placeGlyphs(texts, ra, at, la.color, fadeOut); placeGlyphs(texts, rb, at, lb.color, fadeIn); }
      const ia = la.glyphs.findIndex((g) => g.attach), ib = lb.glyphs.findIndex((g) => g.attach);
      const rA = la.boxes[ia] ?? unionRel(la.boxes), rB = lb.boxes[ib] ?? rA;
      box(ka(a), [shiftR(lerpR(rA, rB, t), at)], 1, at);
    } else if (lb) {
      pushWhole(na, PA, ka(a), fadeOut);
      // the bond end travels between the two labels' boxes instead of popping
      const rA = unionRel(la.boxes), rB = unionRel(lb.boxes);
      boxes.set(ka(a), { rects: [shiftR(lerpR(rA, rB, t), at)], alpha: 1, at });
    } else pushWhole(na, PA, ka(a), fadeOut);
  }
  for (const [b, nb] of B.nodes) {
    const lb = nb.label;
    if (!lb) continue;
    const a = inv.get(b);
    if (a !== undefined) {
      const la = A.nodes.get(a)!.label;
      if (la && (la.shown === lb.shown && la.glyphs.length === lb.glyphs.length)) continue;
      if (la && la.attach && la.attach === lb.attach) continue; // drawn with the start's label
      if (la) {
        // dissolving in on the start atom's track
        placeGlyphs(texts, lb.glyphs, PB.get(b)!, lb.color, fadeIn);
        continue;
      }
    }
    pushWhole(nb, PB, kb(b), fadeIn);
  }

  // ---- charges: they follow their atom, travelling from one drawing's placement to the other's
  const pushCharge = (n: MNode, P: Map<string, Vec>, alpha: number, other?: MNode) => {
    const c = n.charge;
    if (!c || alpha <= 0.01) return;
    const at = P.get(n.key)!;
    const g = other?.charge ? other.charge.glyph : null;
    texts.push({
      text: c.glyph.text, x: at.x + (g ? lerp(c.glyph.dx, g.dx, t) : c.glyph.dx), y: at.y + (g ? lerp(c.glyph.dy, g.dy, t) : c.glyph.dy),
      size: c.glyph.size, color: other?.charge ? lerpC(c.color, other.charge.color, t) : c.color, alpha,
    });
  };
  for (const [a, na] of A.nodes) {
    if (!na.charge) continue;
    const b = nmap.get(a);
    const nb = b !== undefined ? B.nodes.get(b)! : undefined;
    const same = !!nb?.charge && nb.charge.value === na.charge.value;
    pushCharge(na, PA, same ? 1 : fadeOut, same ? nb : undefined);
  }
  for (const [b, nb] of B.nodes) {
    if (!nb.charge) continue;
    const a = inv.get(b);
    if (a !== undefined && A.nodes.get(a)!.charge?.value === nb.charge.value) continue;
    pushCharge(nb, PB, fadeIn);
  }

  // ---- aromatic circles
  const circleKey = (keys: string[]) => [...keys].sort().join(',');
  const bCircles = new Set(B.circles.map(circleKey));
  const carried = new Set<string>();
  for (const ring of A.circles) {
    const mapped = ring.map((k) => nmap.get(k));
    const kept = mapped.every((k) => k !== undefined) && bCircles.has(circleKey(mapped as string[]));
    if (kept) carried.add(circleKey(mapped as string[]));
    const alpha = kept ? 1 : fadeOut;
    if (alpha > 0.01) rings.push({ pts: ring.map((k) => PA.get(k)!), color: [0, 0, 0], alpha, w: A.style.lineWidth });
  }
  for (const ring of B.circles) {
    if (carried.has(circleKey(ring)) || fadeIn <= 0.01) continue;
    rings.push({ pts: ring.map((k) => PB.get(k)!), color: [0, 0, 0], alpha: fadeIn, w: B.style.lineWidth });
  }

  return { lines, texts, boxes, rings };
}
