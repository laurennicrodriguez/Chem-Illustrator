// Stereochemistry as drawn: which bonds say "towards you" or "away from you" and at which atom,
// the R/S and E/Z labels the chemistry engine works out from a molfile, and where a label goes
// beside its atom or bond.
//
// The rules follow ChemDraw (checked by opening test files in ChemDraw 25): plain bold bonds
// count as wedges and plain hashed or dashed bonds as hashed wedges, and R groups and labels
// that can't be read rank above every real atom.

import { Doc, Bond, Atom, StereoInfo } from '../model';
import { Vec, Rect, norm, sub, len, lerp, distToSegment } from '../geom';
import { labelSpec, layoutLabel } from './labels';
import { doubleBondGap, wedgeWidth } from '../style';

export type StereoSense = 'up' | 'down' | 'either';

/** What a bond says about stereochemistry: towards you (up), away (down), unknown (wavy), or nothing. */
export function stereoSense(b: Bond): StereoSense | null {
  if (b.order !== 1) return null;
  switch (b.display) {
    case 'wedge': case 'bold': return 'up';
    case 'hashWedge': case 'hash': case 'dash': return 'down';
    case 'wavy': return 'either';
    default: return null;
  }
}

/**
 * The atom a stereo bond describes, or null for an ordinary bond. A wedge describes the atom at
 * its narrow end (where it starts). Plain bold, hashed and dashed bonds have no narrow end, so,
 * as in ChemDraw, they describe whichever end can be a stereocentre: where the bond starts,
 * unless only the other end has three or more bonds.
 */
export function stereoAnchor(doc: Doc, b: Bond): number | null {
  if (!stereoSense(b)) return null;
  if (b.display === 'wedge' || b.display === 'hashWedge' || b.display === 'wavy') return b.a1;
  return doc.degree(b.a1) < 3 && doc.degree(b.a2) >= 3 ? b.a2 : b.a1;
}

/** True when a structure could have a stereo label: a stereo bond, or a double bond with something on both ends. */
export function mayHaveStereo(doc: Doc, atoms: Iterable<number>): boolean {
  for (const id of atoms) {
    for (const bid of doc.adj.get(id) ?? []) {
      const b = doc.bonds.get(bid)!;
      if (b.a1 !== id) continue;
      if (stereoSense(b)) return true;
      if (b.order === 2 && doc.degree(b.a1) >= 2 && doc.degree(b.a2) >= 2) return true;
    }
  }
  return false;
}

// ------------------------------------------------------------------ labels from the chemistry engine

/** Labels for one molfile, by molfile atom number (0-based). */
export interface StereoTags {
  /** False when the chemistry engine could not read the structure. */
  ok: boolean;
  /** R, S, r or s at an atom. */
  atoms: [number, string][];
  /** E or Z on the double bond between two atoms. */
  bonds: [number, number, string][];
  /** Atoms (by index) whose label the rules can't decide, because an undefined group sets the order. */
  undecided?: number[];
  /** Double bonds (by their atoms' indexes) whose E/Z the rules can't decide. */
  undecidedBonds?: [number, number][];
}

/**
 * How undefined groups (R, Ar, labels that can't be read) rank. The CIP rules rank by atomic
 * number, so they can't place such a group: with 'undecided', a label that would change with what
 * the group is gets none; with 'highest', the group ranks above every real atom, as in ChemDraw.
 */
export type GenericRule = 'undecided' | 'highest';
export const GENERIC_RULE: GenericRule = 'undecided';

/**
 * R/S and E/Z from RDKit for a molfile, by the CIP rules of the 2013 IUPAC recommendations
 * (P-92; RDKit's CIP labeller follows Hanson et al., J. Chem. Inf. Model. 2018, 58, 1755).
 * Atoms listed in `skip` (those inside abbreviation labels, whose positions the drawing doesn't
 * fix) get no label, nor do double bonds that end at one. Unassigned centres ("?") get no label
 * either. Undefined groups are written as the superheavy element Og (see toMolfile) and ranked by
 * `generic`. For 'undecided' the labels are worked out again with the undefined groups standing
 * for groups of every rank (lighter than carbon, and each element of the structure with only
 * hydrogens or with the heaviest possible neighbours), and a label that changes is listed as
 * undecided instead.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function stereoTags(RDKit: any, molblock: string, skip: readonly number[] = [], generic: GenericRule = GENERIC_RULE, groups: readonly [number, string][] = []): StereoTags {
  const high = readTags(RDKit, molblock, skip);
  if (generic === 'highest' || !high.ok) return high;
  const runs = [high, ...probeBlocks(molblock, groups).map((b) => readTags(RDKit, b, skip)).filter((r) => r.ok)];
  if (runs.length === 1) return high;
  const atomLabels = new Map<number, Set<string>>();
  const bondLabels = new Map<string, Set<string>>();
  const key = (i: number, j: number) => (i < j ? `${i},${j}` : `${j},${i}`);
  runs.forEach((r) => {
    for (const [i, l] of r.atoms) (atomLabels.get(i) ?? atomLabels.set(i, new Set()).get(i)!).add(l);
    for (const [i, j, l] of r.bonds) (bondLabels.get(key(i, j)) ?? bondLabels.set(key(i, j), new Set()).get(key(i, j))!).add(l);
  });
  const sameIn = (n: number, labels: Set<string>) => labels.size === 1 && n === runs.length;
  const atoms: [number, string][] = [], undecided: number[] = [];
  for (const [i, ls] of atomLabels) {
    const n = runs.filter((r) => r.atoms.some(([j]) => j === i)).length;
    if (sameIn(n, ls)) atoms.push([i, [...ls][0]]); else undecided.push(i);
  }
  const bonds: [number, number, string][] = [], undecidedBonds: [number, number][] = [];
  for (const [k, ls] of bondLabels) {
    const [i, j] = k.split(',').map(Number);
    const n = runs.filter((r) => r.bonds.some(([p, q]) => key(p, q) === k)).length;
    if (sameIn(n, ls)) bonds.push([i, j, [...ls][0]]); else undecidedBonds.push([i, j]);
  }
  return { ok: true, atoms, bonds, undecided, undecidedBonds };
}

/** Bonds an element makes, for the stand-ins below. */
const PROBE_VALENCE: Record<string, number> = { B: 3, C: 4, N: 3, O: 2, Si: 4, P: 3, S: 2, Se: 2, F: 1, Cl: 1, Br: 1, I: 1 };

/**
 * Copies of a molfile with its undefined-group stand-ins (Og) replaced by other groups: boron
 * (lighter than every common atom but H), and each element of the structure carrying hydrogens
 * (the lowest such group) or Og atoms (the highest). Stand-ins with the same label in `groups`
 * (molfile index, label) are the same group; different groups (R1, R2) also get copies where
 * each is the highest while the others are the lowest, and the other way round.
 */
function probeBlocks(molblock: string, groups: readonly [number, string][]): string[] {
  const lines = molblock.split('\n');
  const na = parseInt(lines[3]?.slice(0, 3) ?? '', 10), nb = parseInt(lines[3]?.slice(3, 6) ?? '', 10);
  if (!(na > 0) || !(nb >= 0)) return [];
  const sym = (k: number) => lines[4 + k].slice(31, 34).trim();
  const generic: number[] = [], elements = new Set<string>();
  const degree = new Array<number>(na).fill(0);
  for (let k = 0; k < na; k++) {
    const e = sym(k);
    if (e === 'Og') generic.push(k);
    else if (PROBE_VALENCE[e]) elements.add(e);
  }
  if (!generic.length) return [];
  for (let k = 0; k < nb; k++) {
    const l = lines[4 + na + k];
    degree[parseInt(l.slice(0, 3), 10) - 1]++;
    degree[parseInt(l.slice(3, 6), 10) - 1]++;
  }
  /** The molfile with generic atom k made `pick(k)`: an element and how many Og atoms to hang on it. */
  const build = (pick: (k: number) => { e: string; heavy: boolean }): string => {
    const atomLines = lines.slice(4, 4 + na), bondLines = lines.slice(4 + na, 4 + na + nb);
    for (const k of generic) {
      const { e, heavy } = pick(k);
      const room = (PROBE_VALENCE[e] ?? 0) - degree[k];
      if (e === 'Og' || room < 0) continue;
      const l = atomLines[k];
      atomLines[k] = l.slice(0, 31) + e.padEnd(3) + l.slice(34);
      if (!heavy) continue;
      const x = parseFloat(l.slice(0, 10)), y = parseFloat(l.slice(10, 20));
      for (let m = 0; m < room; m++) {
        const ang = (2 * Math.PI * m) / room + 0.3;
        atomLines.push(`${(x + 0.4 * Math.cos(ang)).toFixed(4).padStart(10)}${(y + 0.4 * Math.sin(ang)).toFixed(4).padStart(10)}${'0.0000'.padStart(10)} Og  0  0  0  0  0  0  0  0  0  0  0  0`);
        bondLines.push(`${String(k + 1).padStart(3)}${String(atomLines.length).padStart(3)}  1  0`);
      }
    }
    const counts = String(atomLines.length).padStart(3) + String(bondLines.length).padStart(3) + lines[3].slice(6);
    return [...lines.slice(0, 3), counts, ...atomLines, ...bondLines, ...lines.slice(4 + na + nb)].join('\n');
  };
  const out = [build(() => ({ e: 'B', heavy: false }))];
  for (const e of elements) {
    out.push(build(() => ({ e, heavy: false })));
    out.push(build(() => ({ e, heavy: true })));
  }
  const groupOf = new Map(groups);
  const names = [...new Set(generic.map((k) => groupOf.get(k) ?? `#${k}`))];
  if (names.length > 1 && names.length <= 12) {
    for (const name of names) {
      const mine = (k: number) => (groupOf.get(k) ?? `#${k}`) === name;
      out.push(build((k) => (mine(k) ? { e: 'Og', heavy: false } : { e: 'B', heavy: false })));
      out.push(build((k) => (mine(k) ? { e: 'B', heavy: false } : { e: 'Og', heavy: false })));
    }
  }
  return [...new Set(out)].filter((b) => b !== molblock);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readTags(RDKit: any, molblock: string, skip: readonly number[]): StereoTags {
  const mol = RDKit.get_mol(molblock);
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { ok: false, atoms: [], bonds: [] };
  }
  try {
    const tags = JSON.parse(mol.get_stereo_tags());
    const skipped = new Set(skip);
    const clean = (l: unknown) => String(l).replace(/[()]/g, '');
    const atoms: [number, string][] = [];
    for (const [i, l] of tags.CIP_atoms ?? []) {
      const t = clean(l);
      if (/^[RSrs]$/.test(t) && !skipped.has(i)) atoms.push([i, t]);
    }
    const bonds: [number, number, string][] = [];
    for (const [i, j, l] of tags.CIP_bonds ?? []) {
      const t = clean(l);
      if (/^[EZ]$/.test(t) && !skipped.has(i) && !skipped.has(j)) bonds.push([i, j, t]);
    }
    return { ok: true, atoms, bonds };
  } finally {
    mol.delete();
  }
}

// ------------------------------------------------------------------ what a label says

/**
 * Text of an atom's stereo label as drawn, or null for none. A label typed by hand stays as typed;
 * otherwise it shows the worked-out descriptor, falling back to the text saved in the file while
 * the chemistry engine hasn't looked at the structure, can't read it, or the rules can't decide it.
 */
export function atomStereoText(a: Atom, info: StereoInfo | null): string | null {
  const l = a.stereoLabel;
  if (l?.manual) return l.text || null;
  if (!a.showStereo && !l) return null;
  const d = info?.atom(a.id);
  if (d === undefined) return l?.text ?? null;
  return d ? `(${d})` : null;
}

export function bondStereoText(b: Bond, info: StereoInfo | null): string | null {
  const l = b.stereoLabel;
  if (l?.manual) return l.text || null;
  if (!b.showStereo && !l) return null;
  const d = info?.bond(b.id);
  if (d === undefined) return l?.text ?? null;
  return d ? `(${d})` : null;
}

// ------------------------------------------------------------------ where a label goes

/** Where a stereo label's text starts (its baseline), its size and style. */
export interface PlacedLabel { x: number; y: number; size: number; italic: boolean }

export type Measure = (text: string, size: number) => number;

/** How far out a label sits: its centre is half a bond length from the atom or bond (as ChemDraw). */
const OUT = 0.5;
/** If a label can't be fitted that close without touching something, it moves further out. */
const RINGS = [OUT, 0.65, 0.8, 1.0, 1.25];
const STEP = 5 * Math.PI / 180;

/** Ink box of a stereo label from where its text starts (parentheses reach above the capitals and below the baseline). */
function labelBox(p: PlacedLabel, w: number): Rect {
  return { x1: p.x, y1: p.y - 0.73 * p.size, x2: p.x + w, y2: p.y + 0.12 * p.size };
}

/** A label placed with its capitals centred on `c`. */
function centred(c: Vec, w: number, size: number): PlacedLabel {
  return { x: c.x - w / 2, y: c.y + 0.358 * size, size, italic: true };
}

/** Signed distance from a box to a bond drawn `r` thick on each side (negative = overlapping). */
function boxToSegment(b: Rect, p: Vec, q: Vec, r: number): number {
  const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
  if (segmentHitsRect(p, q, b)) return distToSegment(c, p, q) - Math.hypot(b.x2 - c.x, b.y2 - c.y) - r;
  const toBox = (v: Vec) => Math.hypot(Math.max(b.x1 - v.x, 0, v.x - b.x2), Math.max(b.y1 - v.y, 0, v.y - b.y2));
  const corners = [{ x: b.x1, y: b.y1 }, { x: b.x2, y: b.y1 }, { x: b.x1, y: b.y2 }, { x: b.x2, y: b.y2 }];
  return Math.min(toBox(p), toBox(q), ...corners.map((v) => distToSegment(v, p, q))) - r;
}

function segmentHitsRect(p: Vec, q: Vec, b: Rect): boolean {
  // clip the segment against the box (Liang-Barsky)
  let t0 = 0, t1 = 1;
  const dx = q.x - p.x, dy = q.y - p.y;
  for (const [den, num] of [[-dx, p.x - b.x1], [dx, b.x2 - p.x], [-dy, p.y - b.y1], [dy, b.y2 - p.y]]) {
    if (den === 0) { if (num < 0) return false; continue; }
    const t = num / den;
    if (den < 0) { if (t > t1) return false; if (t > t0) t0 = t; } else { if (t < t0) return false; if (t < t1) t1 = t; }
  }
  return true;
}

function insidePolygon(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Distance between two boxes (negative = overlapping, by how far they reach into each other). */
function boxDistance(a: Rect, b: Rect): number {
  const dx = Math.max(b.x1 - a.x2, a.x1 - b.x2), dy = Math.max(b.y1 - a.y2, a.y1 - b.y2);
  return dx < 0 && dy < 0 ? Math.max(dx, dy) : Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

/** Boxes of an atom's label text, as the drawing lays it out. */
function labelBoxesOf(doc: Doc, measure: Measure): (a: Atom) => Rect[] {
  return (a) => {
    if (a.attach) return [];
    const spec = labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), !a.hideCharge);
    if (!spec) return [];
    if (a.supDigits) spec.supDigits = true;
    const k = a.s ?? 1;
    const dirs = doc.neighbors(a.id).map((n) => norm(sub(n, a)));
    const m = doc.style.marginWidth * k;
    return layoutLabel(spec, dirs, doc.style.labelSize * k, measure, a.just).boxes
      .map((b) => ({ x1: a.x + b.x1 - m, y1: a.y + b.y1 - m, x2: a.x + b.x2 + m, y2: a.y + b.y2 + m }));
  };
}

interface Obstacles { segs: { p: Vec; q: Vec; r: number }[]; boxes: Rect[] }

/**
 * Finds a spot for each stereo label that has no saved spot of its own: about half a bond length
 * out, where it is furthest from bonds, atom labels and the other stereo labels near it, moving
 * further out only when there is no room close in. Labels are placed in a fixed order (E/Z first,
 * then by atom), each keeping clear of the ones placed before it, so the same drawing always gives
 * the same spots on screen and in the saved file.
 */
export class StereoPlacer {
  private labelBoxes: (a: Atom) => Rect[];
  private boxCache = new Map<number, Rect[]>();
  private preview: boolean;
  private firstAtom = new Map<number, Rect | null>();
  private firstBond = new Map<number, Rect | null>();
  private done = new Map<string, PlacedLabel>();

  /**
   * `measure` gives text widths (of stereo labels and atom labels); with `preview`, the labels
   * drawn only on screen count as well. Make a new one after the drawing changes.
   */
  constructor(private doc: Doc, private measure: Measure, opts: { preview?: boolean } = {}) {
    this.labelBoxes = labelBoxesOf(doc, measure);
    this.preview = !!opts.preview;
  }

  private grid: Map<string, number[]> | null = null;

  /** Atoms within `r` of a point (found through a grid of the drawing, made once). */
  private atomsNear(p: Vec, r: number): number[] {
    const cell = this.doc.style.bondLength;
    if (!this.grid) {
      this.grid = new Map();
      for (const a of this.doc.atoms.values()) {
        const k = `${Math.floor(a.x / cell)},${Math.floor(a.y / cell)}`;
        (this.grid.get(k) ?? this.grid.set(k, []).get(k)!).push(a.id);
      }
    }
    const out: number[] = [];
    const n = Math.ceil(r / cell);
    const cx = Math.floor(p.x / cell), cy = Math.floor(p.y / cell);
    for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) {
      for (const id of this.grid.get(`${i},${j}`) ?? []) {
        const a = this.doc.atoms.get(id)!;
        if (Math.hypot(a.x - p.x, a.y - p.y) <= r) out.push(id);
      }
    }
    return out;
  }

  private boxesOf(a: Atom): Rect[] {
    let b = this.boxCache.get(a.id);
    if (!b) this.boxCache.set(a.id, b = this.labelBoxes(a));
    return b;
  }

  /** Where an atom's R/S label goes: its saved spot, or one worked out. */
  atom(a: Atom, text: string): PlacedLabel {
    const l = a.stereoLabel;
    if (l) return { x: a.x + l.dx, y: a.y + l.dy, size: l.size, italic: !!l.italic };
    const key = `a${a.id}|${text}`;
    let p = this.done.get(key);
    if (!p) this.done.set(key, p = this.spotAtom(a, text, true));
    return p;
  }

  /** Where a double bond's E/Z label goes: its saved spot, or one worked out. */
  bond(b: Bond, text: string): PlacedLabel {
    const p = this.doc.atoms.get(b.a1)!, q = this.doc.atoms.get(b.a2)!;
    const l = b.stereoLabel;
    if (l) return { x: (p.x + q.x) / 2 + l.dx, y: (p.y + q.y) / 2 + l.dy, size: l.size, italic: !!l.italic };
    const key = `b${b.id}|${text}`;
    let pl = this.done.get(key);
    if (!pl) this.done.set(key, pl = this.spotBond(b, text, true));
    return pl;
  }

  private spotAtom(a: Atom, text: string, others: boolean): PlacedLabel {
    const doc = this.doc;
    const k = a.s ?? 1;
    const size = 0.75 * doc.style.labelSize * k;
    const L = doc.style.bondLength * k;
    const w = this.measure(text, size);
    const obs = this.obstacles([a.id], { kind: 1, id: a.id, preview: !atomStereoText(a, doc.stereo) }, others);
    // As ChemDraw does, a label goes inside a ring of single bonds when there is room, stays out
    // of rings with double bonds (their inner lines crowd it), and otherwise leans to above the
    // atom, then to the left.
    const rings = this.ringsAt(a);
    const pick = (ring: number, ang: number) => {
      const c = { x: a.x + ring * L * Math.cos(ang), y: a.y + ring * L * Math.sin(ang) };
      const p = centred(c, w, size);
      const room = this.room(labelBox(p, w), obs, 0.2 * size);
      const inRing = rings.find((r) => insidePolygon(c, r.pts));
      const bonus = inRing ? (inRing.saturated ? 0.06 : -0.06) * L : 0;
      return { p, room, score: room + bonus - 0.03 * L * Math.sin(ang) - 1e-3 * L * Math.cos(ang) };
    };
    return this.best(RINGS, (ring) => {
      const cands = [];
      for (let ang = -Math.PI; ang < Math.PI - 1e-9; ang += STEP) cands.push(pick(ring, ang));
      // refine around the best direction
      const top = cands.reduce((x, y) => (y.score > x.score ? y : x));
      const ang0 = Math.atan2(top.p.y - 0.358 * size - a.y, top.p.x + w / 2 - a.x);
      for (let d = -STEP; d <= STEP + 1e-9; d += STEP / 10) cands.push(pick(ring, ang0 + d));
      return cands;
    });
  }

  private spotBond(b: Bond, text: string, others: boolean): PlacedLabel {
    const doc = this.doc;
    const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
    const k = b.s ?? 1;
    const size = 0.75 * doc.style.labelSize * k;
    const L = len(sub(q, p)) || doc.style.bondLength * k;
    const w = this.measure(text, size);
    const mid = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    const d = norm(sub(q, p));
    const up = d.x >= 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x }; // the side above the bond
    // only its own bond's neighbours count: it is already set off the bond itself
    const obs = this.obstacles([b.a1, b.a2], { kind: 0, id: b.id, preview: !bondStereoText(b, doc.stereo) }, others);
    return this.best(RINGS, (ring) => {
      const cands = [];
      for (const side of [1, -1]) for (const s of [0, 0.1, -0.1, 0.2, -0.2, 0.3, -0.3]) {
        const c = { x: mid.x + s * L * d.x + side * ring * L * up.x, y: mid.y + s * L * d.y + side * ring * L * up.y };
        const pl = centred(c, w, size);
        const room = this.room(labelBox(pl, w), obs, 0.2 * size);
        // with room enough, the middle of the bond and then above it win
        cands.push({ p: pl, room, score: Math.min(room, 0.15 * L) - 0.1 * L * Math.abs(s) + (side > 0 ? 1e-3 * L : 0) });
      }
      return cands;
    });
  }

  /** The smallest rings through an atom, and whether each is all single bonds. */
  private ringsAt(a: Atom): { pts: Vec[]; saturated: boolean }[] {
    const doc = this.doc;
    const out: { pts: Vec[]; saturated: boolean }[] = [];
    const seen = new Set<string>();
    for (const bid of doc.adj.get(a.id) ?? []) {
      const ids = doc.ringThroughBond(bid);
      if (!ids) continue;
      const key = [...ids].sort((x, y) => x - y).join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      let saturated = true;
      for (let i = 0; i < ids.length; i++) {
        const rb = doc.bondBetween(ids[i], ids[(i + 1) % ids.length]);
        if (rb && rb.order !== 1) saturated = false;
      }
      out.push({ pts: ids.map((id) => doc.atoms.get(id)!), saturated });
    }
    return out;
  }

  /** The best-scoring candidate that touches nothing, trying the closest ring first. */
  private best(rings: number[], at: (ring: number) => { p: PlacedLabel; room: number; score: number }[]): PlacedLabel {
    let fallback: { p: PlacedLabel; room: number } | null = null;
    for (const ring of rings) {
      let top: { p: PlacedLabel; room: number; score: number } | null = null;
      for (const c of at(ring)) {
        if (!fallback || c.room > fallback.room + 1e-9) fallback = c;
        if (c.room >= 0 && (!top || c.score > top.score)) top = c;
      }
      if (top) return top.p;
    }
    return fallback!.p;
  }

  /**
   * How far a label's box is from the nearest obstacle (negative when it overlaps one). The box's
   * corners are rounded off by `round`: letters such as parentheses leave them empty.
   */
  private room(box: Rect, obs: Obstacles, round = 0): number {
    const inner = { x1: box.x1 + round, y1: box.y1 + round, x2: box.x2 - round, y2: box.y2 - round };
    let m = Infinity;
    for (const s of obs.segs) m = Math.min(m, boxToSegment(inner, s.p, s.q, s.r));
    for (const b of obs.boxes) m = Math.min(m, boxDistance(inner, b));
    return Math.min(m - round, 4 * this.doc.style.bondLength);
  }

  /**
   * Bonds, atom labels and stereo labels within two bonds of `from`. `self` is the label being
   * placed: saved labels always count, and labels without a saved spot count when they come
   * before it (E/Z labels, then R/S labels, each in order of id). Labels shown only on screen
   * count only for each other, so the drawing's own labels sit the same with or without them.
   * Without `others`, stereo labels are left out.
   */
  private obstacles(from: number[], self: { kind: 0 | 1; id: number; preview: boolean }, others: boolean): Obstacles {
    const doc = this.doc;
    const near = new Set<number>(from);
    let ring = from;
    for (let depth = 0; depth < 2; depth++) {
      const next: number[] = [];
      for (const id of ring) for (const n of doc.neighbors(id)) if (!near.has(n.id)) { near.add(n.id); next.push(n.id); }
      ring = next;
    }
    // and whatever else is drawn close by (across a ring, or another structure)
    for (const id of from) for (const n of this.atomsNear(doc.atoms.get(id)!, 2 * doc.style.bondLength)) near.add(n);
    const segs: Obstacles['segs'] = [], boxes: Rect[] = [];
    const bonds = new Set<number>();
    for (const id of near) for (const bid of doc.adj.get(id) ?? []) bonds.add(bid);
    const st = doc.style, L = st.bondLength;
    for (const bid of bonds) {
      const b = doc.bonds.get(bid)!;
      if (self.kind === 0 && bid === self.id) continue; // an E/Z label is set off its own bond by its spot
      // half the drawn width, plus a little room: a double bond's second line, a bold bond, and a
      // wedge, which widens from its narrow end (a1) to its wide end in steps
      const m = 0.02 * L, p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      if (b.order === 1 && (b.display === 'wedge' || b.display === 'hashWedge')) {
        const r0 = st.lineWidth / 2, r1 = wedgeWidth(st) / 2;
        for (let k = 0; k < 4; k++) segs.push({ p: lerp(p, q, k / 4), q: lerp(p, q, (k + 1) / 4), r: r0 + ((r1 - r0) * (k + 1)) / 4 + m });
        continue;
      }
      const half = b.order >= 2 || b.order === 1.5 ? doubleBondGap(st) : b.display === 'bold' || b.display === 'hash' ? st.boldWidth / 2 : st.lineWidth / 2;
      segs.push({ p, q, r: half + m });
    }
    for (const id of near) boxes.push(...this.boxesOf(doc.atoms.get(id)!));
    if (others) {
      const before = (kind: 0 | 1, id: number) => kind < self.kind || (kind === self.kind && id < self.id);
      for (const id of near) {
        if (self.kind === 1 && id === self.id) continue;
        const a = doc.atoms.get(id)!;
        const box = this.labelOf(1, a, before(1, id), self.preview);
        if (box) boxes.push(box);
      }
      for (const bid of bonds) {
        if (self.kind === 0 && bid === self.id) continue;
        const b = doc.bonds.get(bid)!;
        const box = this.labelOf(0, b, before(0, bid), self.preview);
        if (box) boxes.push(box);
      }
    }
    return { segs, boxes };
  }

  /** The box of another stereo label: its saved spot, or (when `auto`) where it goes by itself. */
  private labelOf(kind: 0 | 1, x: Atom | Bond, auto: boolean, preview: boolean): Rect | null {
    const info = this.doc.stereo;
    let text = kind === 1 ? atomStereoText(x as Atom, info) : bondStereoText(x as Bond, info);
    if (!text && preview && this.preview && !x.showStereo && !x.stereoLabel) {
      const d = kind === 1 ? info?.atom(x.id) : info?.bond(x.id);
      if (d) text = `(${d})`;
    }
    if (!text) return null;
    const saved = x.stereoLabel;
    if (!saved && !auto) return null;
    const cache = kind === 1 ? this.firstAtom : this.firstBond;
    if (!saved && cache.has(x.id)) return cache.get(x.id)!;
    const size = saved?.size ?? 0.75 * this.doc.style.labelSize * (x.s ?? 1);
    const p = saved
      ? (kind === 1 ? this.atom(x as Atom, text) : this.bond(x as Bond, text))
      : (kind === 1 ? this.spotAtom(x as Atom, text, false) : this.spotBond(x as Bond, text, false));
    const box = labelBox(p, this.measure(text, size));
    if (!saved) cache.set(x.id, box);
    return box;
  }
}

/** Where an atom's R/S label goes (see StereoPlacer). */
export function atomStereoPlace(doc: Doc, a: Atom, text: string, measure: Measure): PlacedLabel {
  return new StereoPlacer(doc, measure).atom(a, text);
}

/** Where a double bond's E/Z label goes (see StereoPlacer). */
export function bondStereoPlace(doc: Doc, b: Bond, text: string, measure: Measure): PlacedLabel {
  return new StereoPlacer(doc, measure).bond(b, text);
}

// ------------------------------------------------------------------ editing labels

/**
 * Show or hide stereo labels (call inside an edit). Showing marks every given atom and bond, as
 * ChemDraw's Show Stereochemistry does, so a stereocentre made later shows its label too.
 * Hiding also drops labels placed or typed by hand.
 */
export function setStereoShown(doc: Doc, atoms: Iterable<number>, bonds: Iterable<number>, show: boolean): void {
  for (const id of atoms) {
    const a = doc.atoms.get(id);
    if (!a || a.attach) continue;
    if (show && !a.showStereo) doc.updateAtom(id, { showStereo: true });
    if (!show && (a.showStereo || a.stereoLabel)) doc.updateAtom(id, { showStereo: undefined, stereoLabel: undefined });
  }
  for (const id of bonds) {
    const b = doc.bonds.get(id);
    if (!b) continue;
    if (show && !b.showStereo) doc.updateBond(id, { showStereo: true });
    if (!show && (b.showStereo || b.stereoLabel)) doc.updateBond(id, { showStereo: undefined, stereoLabel: undefined });
  }
}

/**
 * Type an atom's or bond's stereo label by hand (call inside an edit); empty text goes back to
 * the worked-out label. The label stays where it was shown.
 */
export function setStereoText(doc: Doc, kind: 'a' | 'b', id: number, text: string, measure: Measure): void {
  const t = text.trim();
  if (kind === 'a') {
    const a = doc.atoms.get(id);
    if (!a) return;
    if (!t) {
      if (a.stereoLabel?.manual) doc.updateAtom(id, { stereoLabel: { ...a.stereoLabel, manual: undefined } });
      return;
    }
    const p = atomStereoPlace(doc, a, t, measure);
    doc.updateAtom(id, { showStereo: true, stereoLabel: { text: t, dx: p.x - a.x, dy: p.y - a.y, size: p.size, italic: p.italic || undefined, manual: true } });
  } else {
    const b = doc.bonds.get(id);
    if (!b) return;
    if (!t) {
      if (b.stereoLabel?.manual) doc.updateBond(id, { stereoLabel: { ...b.stereoLabel, manual: undefined } });
      return;
    }
    const p = bondStereoPlace(doc, b, t, measure);
    const m = doc.atoms.get(b.a1)!, n = doc.atoms.get(b.a2)!;
    doc.updateBond(id, { showStereo: true, stereoLabel: { text: t, dx: p.x - (m.x + n.x) / 2, dy: p.y - (m.y + n.y) / 2, size: p.size, italic: p.italic || undefined, manual: true } });
  }
}
