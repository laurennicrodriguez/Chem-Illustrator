// SPDX-License-Identifier: MIT
// Part of the reaction animation ported from cdxmorph by Ryan Shenvi (MIT; see scene.ts).
//
// A step's settings (the pairs the person chose, 1,2-shifts, lines that slide) turned into the
// full pairing the animation runs on, with every request checked against the two structures.

import { matchNodes, matchConnectivity, matchFragments, matchEquivalent, matchBonds, type NodeMap } from './match';
import { turnPairs, mirroredRings } from './turn';
import type { MScene } from './scene';

/** One step's settings, in atom keys of the drawing (start atom, then product atom). */
export interface StepConfig {
  /** Pairs chosen by hand: start atom → product atom. */
  pairs?: [string, string][];
  /** Use `pairs` exactly as given; otherwise the matcher fills in the rest. */
  exact?: boolean;
  /** 1,2-shifts: bond u–v keeps its u end and walks its v end along v–dest onto dest (start atoms). */
  shifts?: [string, string, string][];
  /** A double bond's inner line moves to another bond: [[u, v], [x, y]] in start atoms. */
  slides?: [[string, string], [string, string]][];
}

export interface Shift { tgt: string; mover: string; dest: string }
/** A line that travels: from bond `src` onto atoms tu–tv (bond tgtA in the start, if any; tgtB in the product). */
export interface Slide { src: string; tu: string; tv: string; tgtA: string | null; tgtB: string }

export interface Mapping {
  nmap: NodeMap;
  bmap: Map<string, string>;
  shifts: Map<string, Shift>;
  slides: Slide[];
}

export class MappingError extends Error {}

/**
 * The full pairing for one step. `equiv` says the two drawings are one molecule redrawn (an
 * equivalency sign), so they pair by connectivity first.
 */
export function resolve(cfg: StepConfig, A: MScene, B: MScene, equiv = false): Mapping {
  const name = (sc: MScene, k: string) => sc.nodes.get(k)?.num ?? k;
  const forced: NodeMap = new Map();
  const claimed = new Map<string, string>();
  for (const [a, b] of cfg.pairs ?? []) {
    if (!A.nodes.has(a)) throw new MappingError(`The starting structure has no atom ${a}.`);
    if (!B.nodes.has(b)) throw new MappingError(`The product has no atom ${b}.`);
    if (claimed.has(b)) throw new MappingError(`Product atom ${name(B, b)} is paired with both ${name(A, claimed.get(b)!)} and ${name(A, a)}; each atom can have one partner.`);
    claimed.set(b, a);
    forced.set(a, b);
  }

  let nmap: NodeMap;
  if (cfg.exact && cfg.pairs) nmap = forced;
  else if (equiv) {
    let iso = matchEquivalent(A, B);
    if (forced.size) {
      const keep: NodeMap = new Map([...iso].filter(([k, v]) => (forced.get(k) ?? v) === v && !forced.has(k)));
      for (const [k, v] of forced) keep.set(k, v);
      iso = keep;
    }
    nmap = iso.size ? iso : matchNodes(A, B, forced);
  } else {
    // Four ways to pair, kept as candidates: position over the whole structure, position per
    // drawn fragment, connectivity grown along the bonds, and connectivity per fragment.
    // Whichever carries the most bonds wins.
    let cands = [
      matchNodes(A, B, forced),
      matchConnectivity(A, B, forced),
      matchFragments(A, B, forced),
      matchFragments(A, B, forced, matchConnectivity),
    ];
    if (forced.size) {
      // a pair the person asked for is not a hint: keep candidates that honour every one, or
      // impose them on the others
      const keep = cands.filter((c) => c.size && [...forced].every(([k, v]) => c.get(k) === v));
      if (keep.length) cands = keep;
      else {
        cands = cands.filter((c) => c.size).map((c) => {
          const taken = new Set(forced.values());
          const m: NodeMap = new Map([...c].filter(([k, v]) => !forced.has(k) && !taken.has(v)));
          for (const [k, v] of forced) m.set(k, v);
          return m;
        });
      }
    }
    nmap = new Map();
    let best = -1;
    for (const c of cands) {
      if (!c.size) continue;
      const n = matchBonds(A, B, c).size;
      if (n > best) { best = n; nmap = c; }
    }
  }
  if (!(cfg.exact && cfg.pairs)) {
    // an atom that swapped sides while its group turned about a bond is only found once the turn is known
    const taken = new Set(nmap.values());
    for (const [k, v] of turnPairs(A, B, nmap)) {
      if (!nmap.has(k) && !taken.has(v)) { nmap.set(k, v); taken.add(v); }
    }
  }
  const bmap = matchBonds(A, B, nmap);

  const shifts = new Map<string, Shift>();
  for (const [u, v, dest] of cfg.shifts ?? []) {
    for (const k of [u, v, dest]) if (!A.nodes.has(k)) throw new MappingError(`Shift ${name(A, u)}–${name(A, v)} → ${name(A, dest)}: the starting structure has no atom ${k}.`);
    const ab = A.bondBetween(u, v);
    const label = `Shift ${name(A, u)}–${name(A, v)} → ${name(A, dest)}`;
    if (ab === undefined) throw new MappingError(`${label}: ${name(A, u)}–${name(A, v)} is not a bond.`);
    if (bmap.has(ab)) throw new MappingError(`${label}: that bond is already carried over by the pairing, so it has nowhere to shift to. Unpair one of its atoms or drop the shift.`);
    const movers = [u, v].filter((x) => A.nbr.get(x)!.includes(dest));
    if (movers.length !== 1) throw new MappingError(`${label}: exactly one end of the bond must be bonded to ${name(A, dest)}.`);
    const mover = movers[0];
    const anchor = mover === u ? v : u;
    for (const [k, role] of [[anchor, 'staying'], [mover, 'moving'], [dest, 'destination']] as const) {
      if (!nmap.has(k)) throw new MappingError(`${label}: the ${role} atom ${name(A, k)} has no partner.`);
    }
    const tgt = B.bondBetween(nmap.get(anchor)!, nmap.get(dest)!);
    if (tgt === undefined) throw new MappingError(`${label}: the product has no bond ${name(B, nmap.get(anchor)!)}–${name(B, nmap.get(dest)!)} for it to become.`);
    shifts.set(ab, { tgt, mover, dest });
  }

  const slides: Slide[] = [];
  for (const [[s1, s2], [t1, t2]] of cfg.slides ?? []) {
    const label = `Slide ${name(A, s1)}–${name(A, s2)} → ${name(A, t1)}–${name(A, t2)}`;
    for (const k of [s1, s2, t1, t2]) if (!A.nodes.has(k)) throw new MappingError(`${label}: the starting structure has no atom ${k}.`);
    const src = A.bondBetween(s1, s2);
    if (src === undefined) throw new MappingError(`${label}: that is not a bond.`);
    if (A.bonds.get(src)!.order !== 2) throw new MappingError(`${label}: only a double bond has a second line to move.`);
    for (const k of [t1, t2]) if (!nmap.has(k)) throw new MappingError(`${label}: atom ${name(A, k)} has no partner.`);
    const tgtB = B.bondBetween(nmap.get(t1)!, nmap.get(t2)!);
    if (tgtB === undefined) throw new MappingError(`${label}: the product has no bond there to move onto.`);
    const tgtA = A.bondBetween(t1, t2) ?? null;
    if (tgtA !== null && A.bonds.get(tgtA)!.order === 2 && B.bonds.get(tgtB)!.order === 2) throw new MappingError(`${label}: that bond is already double in both structures.`);
    slides.push({ src, tu: t1, tv: t2, tgtA, tgtB });
  }
  return { nmap, bmap, shifts, slides };
}

export interface StepSummary {
  paired: number;
  startAtoms: number;
  productAtoms: number;
  carried: number;
  startBonds: number;
  productBonds: number;
  /** Bonds that break and bonds that form, as pairs of atom keys. */
  breaking: [string, string][];
  forming: [string, string][];
  unpairedStart: string[];
  unpairedProduct: string[];
  mirroredRings: string[][];
}

/** What a pairing does: what carries over, what breaks and what forms. */
export function summary(A: MScene, B: MScene, m: Mapping): StepSummary {
  const inv = new Set(m.nmap.values());
  const carriedB = new Set([...m.bmap.values(), ...[...m.shifts.values()].map((s) => s.tgt)]);
  return {
    paired: m.nmap.size, startAtoms: A.nodes.size, productAtoms: B.nodes.size,
    carried: m.bmap.size, startBonds: A.bonds.size, productBonds: B.bonds.size,
    breaking: [...A.bonds].filter(([k]) => !m.bmap.has(k) && !m.shifts.has(k)).map(([, b]) => [b.b, b.e]),
    forming: [...B.bonds].filter(([k]) => !carriedB.has(k)).map(([, b]) => [b.b, b.e]),
    unpairedStart: [...A.nodes.keys()].filter((k) => !m.nmap.has(k)),
    unpairedProduct: [...B.nodes.keys()].filter((k) => !inv.has(k)),
    mirroredRings: mirroredRings(A, B, m.nmap),
  };
}
