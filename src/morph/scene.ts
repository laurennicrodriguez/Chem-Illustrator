// SPDX-License-Identifier: MIT
// Reaction animation, ported to TypeScript from cdxmorph 1.47.0 by Ryan Shenvi (Shenvi Lab),
// https://github.com/rshenvi/cdxmorph, used with his permission. Copyright (c) 2026 Ryan Shenvi;
// the MIT licence text is in THIRD-PARTY-NOTICES.md. Changes for Chem Illustrator: structures
// come from the app's own drawing (not a CDXML reader) and are drawn in its own style.
//
// One structure as the animation sees it: atoms (with the label each one shows, laid out as the
// drawing lays it out) and bonds, keyed by the drawing's atom and bond ids. Nothing here
// interprets chemistry; it is lines, text and a depth per element.

import type { Atom, Bond, BondDisplay, DoublePos, Doc } from '../model';
import { labelSpec, type GlyphRun } from '../chem/labels';
import { doubleBondGap, wedgeWidth } from '../style';
import { bondLayer } from '../chem/crossing';
import { isCircleRing } from '../chem/aromatic';
import type { Rect, Vec } from '../geom';
import type { Renderer } from '../render/renderer';

export type RGB = [number, number, number];

/** A piece of a label: one run of text, placed relative to its atom. */
export interface Glyph extends GlyphRun {
  /** Part of the glyph the bonds meet (the O of OMe), which stays put while the rest changes. */
  attach: boolean;
}

export interface MLabel {
  /** The label as drawn, left to right (OH or HO), without its charge. */
  shown: string;
  /** The same label whichever way round it is drawn (HO and OH both "OH"). */
  canon: string;
  /** The element the bonds meet ("O" for OMe), or "" when it can't be told. */
  attach: string;
  glyphs: Glyph[];
  /** Where bonds stop, relative to the atom, margin included. */
  boxes: Rect[];
  color: RGB;
}

export interface MCharge {
  value: number;
  glyph: GlyphRun;
  color: RGB;
}

export interface MNode {
  key: string;
  atom: number;
  p: Vec;
  label: MLabel | null;
  charge: MCharge | null;
  color: RGB;
  /** Which drawn structure (fragment) it belongs to: its smallest atom id. */
  frag: string;
  /** ChemDraw's AtomID from the file, for mapping files shared with the Python cdxmorph. */
  num?: string;
}

export interface MBond {
  key: string;
  id: number;
  b: string;
  e: string;
  /** 1, 2 (also aromatic 1.5 drawn as two lines), 3 or 4. */
  order: number;
  /** An aromatic bond: its second line is dashed. */
  aromatic: boolean;
  display: BondDisplay;
  dpos: DoublePos;
  z: number;
  color: RGB;
  /** Stroke width of its main line. */
  w: number;
  /** Size relative to the drawing style. */
  s: number;
  /** Rungs of a hashed bond, counted on the drawing at rest so a stretching bond keeps them. */
  rungs: number;
}

export interface MStyle {
  lineWidth: number;
  boldWidth: number;
  marginWidth: number;
  hashSpacing: number;
  bondLength: number;
  /** Distance between the lines of a double bond. */
  gap: number;
  /** Full width of a wedge's wide end. */
  wedge: number;
  labelSize: number;
  /** CSS font list the labels are set in. */
  font: string;
}

export class MScene {
  nodes = new Map<string, MNode>();
  bonds = new Map<string, MBond>();
  /** Rings drawn with a circle inside, as atom keys in order round the ring. */
  circles: string[][] = [];
  private nbrMemo: Map<string, string[]> | null = null;
  ringMemo = new Map<string, string[] | null>();

  constructor(public style: MStyle) {}

  /** Neighbours of every atom. */
  get nbr(): Map<string, string[]> {
    if (this.nbrMemo) return this.nbrMemo;
    const m = new Map<string, string[]>();
    for (const k of this.nodes.keys()) m.set(k, []);
    for (const b of this.bonds.values()) {
      if (!m.has(b.b) || !m.has(b.e)) continue;
      m.get(b.b)!.push(b.e);
      m.get(b.e)!.push(b.b);
    }
    return (this.nbrMemo = m);
  }

  /** The bond joining two atoms, if any. */
  bondBetween(u: string, v: string): string | undefined {
    for (const b of this.bonds.values()) if ((b.b === u && b.e === v) || (b.b === v && b.e === u)) return b.key;
    return undefined;
  }

  /** Positions of every atom as drawn. */
  positions(): Map<string, Vec> {
    const P = new Map<string, Vec>();
    for (const [k, n] of this.nodes) P.set(k, n.p);
    return P;
  }

  /** A copy moved by (dx, dy): labels travel with their atoms, so only positions change. */
  translated(dx: number, dy: number): MScene {
    const out = new MScene(this.style);
    for (const [k, n] of this.nodes) out.nodes.set(k, { ...n, p: { x: n.p.x + dx, y: n.p.y + dy } });
    out.bonds = this.bonds;
    out.circles = this.circles;
    return out;
  }

  /** Extent of the drawing: atoms and their labels. */
  extent(): Rect {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of this.nodes.values()) {
      x1 = Math.min(x1, n.p.x); y1 = Math.min(y1, n.p.y); x2 = Math.max(x2, n.p.x); y2 = Math.max(y2, n.p.y);
      for (const r of n.label?.boxes ?? []) {
        x1 = Math.min(x1, n.p.x + r.x1); y1 = Math.min(y1, n.p.y + r.y1); x2 = Math.max(x2, n.p.x + r.x2); y2 = Math.max(y2, n.p.y + r.y2);
      }
    }
    return { x1, y1, x2, y2 };
  }

  /** Only the atoms (and bonds among them) of one drawn fragment. */
  fragment(frag: string): MScene {
    const out = new MScene(this.style);
    for (const [k, n] of this.nodes) if (n.frag === frag) out.nodes.set(k, n);
    for (const [k, b] of this.bonds) if (out.nodes.has(b.b) && out.nodes.has(b.e)) out.bonds.set(k, b);
    return out;
  }
}

export function hexRgb(hex: string | undefined): RGB {
  if (!hex) return [0, 0, 0];
  const h = hex.replace('#', '');
  if (h.length === 3) return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16) / 255) as RGB;
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as RGB;
}

export function styleOf(doc: Doc, font: string): MStyle {
  const st = doc.style;
  return {
    lineWidth: st.lineWidth, boldWidth: st.boldWidth, marginWidth: st.marginWidth, hashSpacing: st.hashSpacing,
    bondLength: st.bondLength, gap: doubleBondGap(st), wedge: wedgeWidth(st), labelSize: st.labelSize, font,
  };
}

const MAX_HASHES = 400;

/**
 * One structure of a drawing (the atoms in `atoms` and the bonds among them), with labels laid
 * out by the renderer exactly as the drawing shows them.
 */
export function sceneOf(doc: Doc, atoms: Iterable<number>, r: Renderer, nums?: Map<number, string>): MScene {
  r.useStyle(doc);
  const sc = new MScene(styleOf(doc, r.labelFontStack()));
  const ids = new Set(atoms);
  const frags = fragmentsOf(doc, ids);
  for (const id of ids) {
    const a = doc.atoms.get(id);
    if (!a) continue;
    sc.nodes.set(String(id), nodeOf(doc, a, r, frags.get(id) ?? String(id), nums?.get(id)));
  }
  for (const b of doc.bonds.values()) {
    if (!ids.has(b.a1) || !ids.has(b.a2)) continue;
    sc.bonds.set(String(b.id), bondOf(doc, b, r));
  }
  // rings drawn with a circle
  const seen = new Set<string>();
  for (const b of doc.bonds.values()) {
    if (!b.circle || b.order !== 1.5 || !ids.has(b.a1)) continue;
    const ring = doc.ringThroughBond(b.id);
    if (!ring || !isCircleRing(doc, ring)) continue;
    const key = [...ring].sort((x, y) => x - y).join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    sc.circles.push(ring.map(String));
  }
  return sc;
}

/** Each atom's fragment: the smallest atom id of the atoms joined to it. */
function fragmentsOf(doc: Doc, ids: Set<number>): Map<number, string> {
  const out = new Map<number, string>();
  for (const id of ids) {
    if (out.has(id)) continue;
    const comp: number[] = [];
    const stack = [id];
    const seen = new Set([id]);
    while (stack.length) {
      const x = stack.pop()!;
      comp.push(x);
      for (const bid of doc.adj.get(x) ?? []) {
        const b = doc.bonds.get(bid)!;
        const y = b.a1 === x ? b.a2 : b.a1;
        if (ids.has(y) && !seen.has(y)) { seen.add(y); stack.push(y); }
      }
    }
    const name = String(Math.min(...comp));
    for (const x of comp) out.set(x, name);
  }
  return out;
}

const ELEMENT = /^[A-Z][a-z]?$/;

function nodeOf(doc: Doc, a: Atom, r: Renderer, frag: string, num?: string): MNode {
  const info = r.atomInfo(doc, a);
  const color = hexRgb(a.color);
  let label: MLabel | null = null;
  let charge: MCharge | null = null;
  const lay = info.layout;
  if (lay) {
    const m = doc.style.marginWidth * (a.s ?? 1);
    const runs = lay.runs.filter((_, i) => i !== lay.charge);
    const boxes = lay.boxes.filter((_, i) => i !== lay.charge).map((b) => ({ x1: b.x1 - m, y1: b.y1 - m, x2: b.x2 + m, y2: b.y2 + m }));
    // the glyph the bonds meet sits on the atom: the run across x = 0 on the label's own line
    const main = runs.length ? runs[0].dy : 0;
    let at = runs.findIndex((g) => Math.abs(g.dy - main) < 0.01 && g.dx <= 0.01 && g.dx + r.measure(g.text, g.size) >= -0.01);
    if (at < 0) at = 0;
    const glyphs = runs.map((g, i) => ({ ...g, attach: i === at }));
    const shown = runs.map((g) => g.text).join('');
    const spec = labelSpec(a.z, a.label, 0, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), false, !!a.showCarbon);
    const canon = spec ? spec.tokens.map((t) => t.text + (t.count > 1 ? t.count : '')).join('') + (spec.hCount ? 'H' + (spec.hCount > 1 ? spec.hCount : '') : '') : shown;
    const head = spec?.tokens[0]?.text ?? '';
    label = { shown, canon, attach: ELEMENT.test(head) ? head : '', glyphs, boxes, color };
    if (lay.charge !== undefined) charge = { value: a.charge, glyph: { ...lay.runs[lay.charge] }, color };
  } else if (a.charge && !a.hideCharge) {
    // a charge beside a bare carbon, placed as the renderer places it
    let sx = 0, sy = 0;
    for (const n of doc.neighbors(a.id)) { const l = Math.hypot(n.x - a.x, n.y - a.y) || 1; sx += (n.x - a.x) / l; sy += (n.y - a.y) / l; }
    const l = Math.hypot(sx, sy);
    const away = l > 0.1 ? { x: -sx / l, y: -sy / l } : { x: 0.7, y: -0.7 };
    const size = doc.style.labelSize * 0.8;
    const text = (Math.abs(a.charge) > 1 ? String(Math.abs(a.charge)) : '') + (a.charge > 0 ? '+' : '−');
    const w = r.measure(text, size);
    charge = { value: a.charge, glyph: { text, dx: away.x * size * 0.8 - w / 2, dy: away.y * size * 0.8 + size * 0.35, size }, color };
  }
  return { key: String(a.id), atom: a.id, p: { x: a.x, y: a.y }, label, charge, color, frag, num };
}

function bondOf(doc: Doc, b: Bond, r: Renderer): MBond {
  const k = b.s ?? 1;
  const st = doc.style;
  let rungs = 0;
  if (b.display === 'hashWedge' || b.display === 'hash') {
    const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
    const [s, e] = r.bondEnds(doc, p, q);
    rungs = Math.min(MAX_HASHES, Math.max(2, Math.floor(Math.hypot(e.x - s.x, e.y - s.y) / (st.hashSpacing * k))));
  }
  const order = b.order === 1.5 ? 2 : b.order;
  return {
    key: String(b.id), id: b.id, b: String(b.a1), e: String(b.a2),
    order: b.order === 1.5 && b.circle ? 1 : order,
    aromatic: b.order === 1.5 && !b.circle,
    display: b.display, dpos: b.dpos, z: bondLayer(b), color: hexRgb(b.color),
    w: (b.display === 'bold' && order === 1 ? st.boldWidth : st.lineWidth) * k, s: k, rungs,
  };
}

// ------------------------------------------------------------------ rings

/** Smallest ring through a bond, as atom keys, or null (memoised: topology never changes). */
export function ringThrough(sc: MScene, bid: string): string[] | null {
  if (sc.ringMemo.has(bid)) return sc.ringMemo.get(bid)!;
  const b = sc.bonds.get(bid)!;
  const nbr = sc.nbr;
  const u = b.b, v = b.e;
  const prev = new Map<string, string | null>([[u, null]]);
  const queue = [u];
  let found: string[] | null = null;
  while (queue.length && !found) {
    const x = queue.shift()!;
    for (const y of nbr.get(x) ?? []) {
      if (x === u && y === v) continue;
      if (prev.has(y)) continue;
      prev.set(y, x);
      if (y === v) {
        const path: string[] = [];
        let cur: string | null = v;
        while (cur !== null) { path.push(cur); cur = prev.get(cur) ?? null; }
        found = path;
        break;
      }
      queue.push(y);
    }
  }
  sc.ringMemo.set(bid, found);
  return found;
}

/** Every ring of at most `limit` atoms through a bond. */
export function ringsThrough(sc: MScene, bid: string, limit = 7): string[][] {
  const b = sc.bonds.get(bid)!;
  const nbr = sc.nbr;
  const u = b.b, v = b.e;
  const out: string[][] = [];
  const path = [u];
  const walk = (x: string) => {
    if (path.length > limit) return;
    for (const y of nbr.get(x) ?? []) {
      if (y === v && x !== u) out.push([...path, v]);
      else if (!path.includes(y) && y !== v) { path.push(y); walk(y); path.pop(); }
    }
  };
  walk(u);
  return out;
}

/** Do the bond orders alternate single/double all round this ring? */
export function alternating(sc: MScene, ring: string[]): boolean {
  if (ring.length % 2) return false;
  const ords: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const k = sc.bondBetween(ring[i], ring[(i + 1) % ring.length]);
    if (k === undefined) return false;
    ords.push(sc.bonds.get(k)!.order);
  }
  return ords.every((o) => o === 1 || o === 2) && ords.includes(1) && ords.includes(2) && !ords.some((o, i) => o === ords[(i + 1) % ords.length]);
}

const dringMemo = new WeakMap<MScene, Map<string, string[] | null>>();

/**
 * The ring a double bond's inner line belongs inside: the smallest ring whose orders alternate
 * all the way round (the benzene, not the smaller ring fused to it), else the smallest ring.
 */
export function doubleRing(sc: MScene, bid: string): string[] | null {
  let memo = dringMemo.get(sc);
  if (!memo) dringMemo.set(sc, (memo = new Map()));
  if (memo.has(bid)) return memo.get(bid)!;
  const rings = ringsThrough(sc, bid);
  const alt = rings.filter((r) => alternating(sc, r));
  const pool = alt.length ? alt : rings;
  const best = pool.length ? pool.reduce((a, b) => (b.length < a.length ? b : a)) : null;
  memo.set(bid, best);
  return best;
}

/**
 * Which side of a double bond its second line goes: +1 or −1 along the bond's left normal
 * (perp of begin→end), or 0 for a pair centred on the bond. A side chosen by hand is kept;
 * otherwise inside the ring, else towards the side with more substituents, and centred when an
 * end has nothing else on it (C=O), as the still drawing does.
 */
export function doubleSide(sc: MScene, bid: string, P: Map<string, Vec>): number {
  const b = sc.bonds.get(bid)!;
  const p0 = P.get(b.b)!, p1 = P.get(b.e)!;
  const dx = p1.x - p0.x, dy = p1.y - p0.y;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return 0;
  const n = { x: -dy / L, y: dx / L };
  if (b.dpos === 'right') return 1;
  if (b.dpos === 'left') return -1;
  if (b.dpos === 'center') return 0;
  const ring = doubleRing(sc, bid);
  if (ring) {
    let cx = 0, cy = 0, k = 0;
    for (const id of ring) { const q = P.get(id); if (q) { cx += q.x; cy += q.y; k++; } }
    if (k >= 3) {
      const s = (cx / k - p0.x) * n.x + (cy / k - p0.y) * n.y;
      if (Math.abs(s) > 1e-9) return s > 0 ? 1 : -1;
    }
  }
  const nbr = sc.nbr;
  const n1 = (nbr.get(b.b) ?? []).filter((x) => x !== b.e);
  const n2 = (nbr.get(b.e) ?? []).filter((x) => x !== b.b);
  if (!n1.length || !n2.length) {
    // a terminal end: centred, unless it is a bare CH=CH2 with one substituent to lean towards
    const others = [...n1, ...n2];
    const lab1 = sc.nodes.get(b.b)?.label, lab2 = sc.nodes.get(b.e)?.label;
    if (lab1 || lab2 || others.length !== 1) return 0;
    const o = P.get(others[0])!;
    return (o.x - p0.x) * n.x + (o.y - p0.y) * n.y >= 0 ? 1 : -1;
  }
  let s = 0;
  for (const [id, list] of [[b.b, n1], [b.e, n2]] as const) {
    const at = P.get(id)!;
    for (const m of list) { const q = P.get(m)!; s += Math.sign((q.x - at.x) * n.x + (q.y - at.y) * n.y); }
  }
  return s === 0 ? 1 : Math.sign(s);
}
