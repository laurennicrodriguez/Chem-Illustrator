// Polymer and repeat brackets: a pair of brackets round part of a structure, labelled n (a
// polymer's structural repeat unit, ChemDraw's "SRU") or a number (a group repeated that many
// times, ChemDraw's "Multiple Group"). Which atoms are inside and which bonds cross the brackets
// are worked out from where things are drawn, so moving atoms in or out changes the unit.

import type { Doc, Shape, Bond } from '../model';
import type { Vec } from '../geom';
import { perp, norm, sub, add, mul } from '../geom';

export interface RepeatGroup {
  /** The labelled bracket and the one facing it (the same shape for a pair drawn as one). */
  label: Shape;
  other: Shape;
  /** The label as typed: n, x, 3… */
  text: string;
  /** A number: the group is there that many times. Null for a letter (a polymer). */
  count: number | null;
  /** The region between the two spines. */
  poly: Vec[];
  /** The two spines, each as two points. */
  spines: [Vec, Vec][];
  /** Atoms inside the brackets. */
  inner: number[];
  /** Bonds crossing a bracket: the bond, its atom inside, and which spine (index into `spines`). */
  crossing: { bond: number; inner: number; spine: number }[];
}

/** A repeat count read from a label: "3" is 3, "n" or "x" is null. */
export function repeatCount(text: string): number | null {
  const t = text.trim();
  return /^\d+$/.test(t) && Number(t) > 0 ? Number(t) : null;
}

const spineOf = (s: Shape): [Vec, Vec] => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }];

/** The direction a bracket's lips point (to the right of its spine's direction, as ChemDraw stores them). */
export function lipDirection(s: Shape): Vec {
  const d = norm(sub({ x: s.x2, y: s.y2 }, { x: s.x1, y: s.y1 }));
  return { x: -d.y, y: d.x };
}

/** The bracket facing this one: the nearest bracket on its lips' side whose lips face back. */
function partner(doc: Doc, s: Shape): { other: Shape; spine: [Vec, Vec] } | null {
  const [p, q] = spineOf(s);
  if (s.pair) {
    const l = Math.hypot(q.x - p.x, q.y - p.y);
    const n = perp(norm(sub(q, p)));
    return { other: s, spine: [add(q, mul(n, l * 0.6)), add(p, mul(n, l * 0.6))] };
  }
  const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
  const lip = lipDirection(s);
  let best: { other: Shape; d: number } | null = null;
  for (const o of doc.shapes.values()) {
    if (o.kind !== 'bracket' || o.id === s.id) continue;
    const om = { x: (o.x1 + o.x2) / 2, y: (o.y1 + o.y2) / 2 };
    const v = sub(om, mid);
    const ahead = v.x * lip.x + v.y * lip.y;
    const back = lipDirection(o);
    if (ahead <= 0 || back.x * lip.x + back.y * lip.y > -0.7) continue;
    const d = Math.hypot(v.x, v.y);
    if (!best || d < best.d) best = { other: o, d };
  }
  return best ? { other: best.other, spine: spineOf(best.other) } : null;
}

function inside(p: Vec, poly: Vec[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

function crosses(a: Vec, b: Vec, c: Vec, d: Vec): boolean {
  const cr = (o: Vec, p: Vec, q: Vec) => (p.x - o.x) * (q.y - o.y) - (p.y - o.y) * (q.x - o.x);
  return cr(c, d, a) * cr(c, d, b) < 0 && cr(a, b, c) * cr(a, b, d) < 0;
}

/** Every labelled repeat group in the drawing. */
export function repeatGroups(doc: Doc): RepeatGroup[] {
  const out: RepeatGroup[] = [];
  for (const s of doc.shapes.values()) {
    if (s.kind !== 'bracket' || !s.repeat) continue;
    const pr = partner(doc, s);
    if (!pr) continue;
    const a = spineOf(s), b = pr.spine;
    // the four ends in order round the region (the spines run opposite ways when facing)
    const sameWay = (a[1].x - a[0].x) * (b[1].x - b[0].x) + (a[1].y - a[0].y) * (b[1].y - b[0].y) > 0;
    const poly = sameWay ? [a[0], a[1], b[1], b[0]] : [a[0], a[1], b[0], b[1]];
    const inner = [...doc.atoms.values()].filter((at) => inside(at, poly)).map((at) => at.id);
    const inSet = new Set(inner);
    const crossing: RepeatGroup['crossing'] = [];
    const seen = new Set<number>();
    for (const id of inner) {
      for (const bid of doc.adj.get(id) ?? []) {
        if (seen.has(bid)) continue;
        seen.add(bid);
        const bond = doc.bonds.get(bid) as Bond;
        const outer = bond.a1 === id ? bond.a2 : bond.a1;
        if (inSet.has(outer)) continue;
        const p = doc.atoms.get(id)!, q = doc.atoms.get(outer)!;
        const spine = crosses(p, q, a[0], a[1]) ? 0 : crosses(p, q, b[0], b[1]) ? 1 : 0;
        crossing.push({ bond: bid, inner: id, spine });
      }
    }
    out.push({ label: s, other: pr.other, text: s.repeat, count: repeatCount(s.repeat), poly, spines: [a, b], inner, crossing });
  }
  return out;
}

/** Where a bracket's label goes: by its lower end, outside the brackets. Returns the text's left baseline point. */
export function repeatLabelPlace(s: Shape, size: number, width: number): Vec {
  const lip = lipDirection(s);
  const low = s.y2 >= s.y1 ? { x: s.x2, y: s.y2 } : { x: s.x1, y: s.y1 };
  // outward is away from the lips; the text hangs just below the end
  const out = { x: -lip.x, y: -lip.y };
  const x = low.x + out.x * size * 0.3 - (out.x < -0.5 ? width : 0);
  return { x, y: low.y + size * 0.31 };
}
