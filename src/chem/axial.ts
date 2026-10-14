// Axial chirality: Ra/Sa (or P/M) for biaryls and other hindered single bonds, allenes and
// alkylidenecycloalkanes, by IUPAC 2013 P-93.5.1.1. The chemistry engine gives no labels for
// these, so they are worked out here from the molfile the drawing makes.
//
// How the drawing says which way round the molecule is: one end of the axis lies in the page and
// the other stands across it, its groups drawn with a wedge (toward you) or a hash (away). For a
// biaryl that is a wedge or hash from the ring atom next to the axis (either the ring bond to it
// or the bond to its substituent); for an allene, the bonds to the groups on one end.
//
// The rule: look along the axis. The two groups on the near end rank before the two on the far
// end, and each pair is ranked by the CIP rules. Going near 1 → near 2 → far 1 clockwise is Ra,
// anticlockwise Sa; looking from either end gives the same answer. Ra is the same as M and Sa
// the same as P (helicity from near 1 to far 1).
//
// The ranking here uses CIP rules 1a (atomic number, with duplicate atoms for multiple bonds and
// ring closures; aromatic rings with one averaged duplicate per atom, so a ring has no Kekulé
// "side") and 2 (mass number). When those can't tell the two groups of an end apart, no label
// is given.

import { elementNumber, hasImplicitH, implicitHydrogens } from './elements';

export type AxialLabel = 'Ra' | 'Sa';

interface MAtom { z: number; x: number; y: number; charge: number; iso: number; h: number }
interface Nb { to: number; order: number; bond: number }
interface MBond { a: number; b: number; order: number; stereo: number }

export interface Mol { atoms: MAtom[]; bonds: MBond[]; nbrs: Nb[][] }

/** Reads the atoms, bonds, charges and isotopes of a V2000 molfile. */
export function readMol(molblock: string): Mol | null {
  const lines = molblock.split(/\r?\n/);
  const na = parseInt(lines[3]?.slice(0, 3) ?? '', 10), nb = parseInt(lines[3]?.slice(3, 6) ?? '', 10);
  if (!(na >= 0) || !(nb >= 0) || lines[3].includes('V3000')) return null;
  const atoms: MAtom[] = [];
  for (let k = 0; k < na; k++) {
    const l = lines[4 + k] ?? '';
    const sym = l.slice(31, 34).trim();
    atoms.push({ z: sym === '*' || sym === 'R' || sym === 'A' ? 0 : elementNumber(sym) ?? 0, x: parseFloat(l.slice(0, 10)), y: parseFloat(l.slice(10, 20)), charge: 0, iso: sym === 'D' ? 2 : sym === 'T' ? 3 : 0, h: 0 });
  }
  const bonds: MBond[] = [];
  for (let k = 0; k < nb; k++) {
    const l = lines[4 + na + k] ?? '';
    bonds.push({ a: parseInt(l.slice(0, 3), 10) - 1, b: parseInt(l.slice(3, 6), 10) - 1, order: parseInt(l.slice(6, 9), 10), stereo: parseInt(l.slice(9, 12), 10) || 0 });
  }
  for (const l of lines.slice(4 + na + nb)) {
    const m = /^M {2}(CHG|ISO)/.exec(l);
    if (!m) continue;
    const n = parseInt(l.slice(6, 9), 10);
    for (let k = 0; k < n; k++) {
      const i = parseInt(l.slice(9 + 8 * k, 13 + 8 * k), 10) - 1, v = parseInt(l.slice(13 + 8 * k, 17 + 8 * k), 10);
      if (!atoms[i]) continue;
      if (m[1] === 'CHG') atoms[i].charge = v; else atoms[i].iso = v;
    }
  }
  if (bonds.some((b) => !atoms[b.a] || !atoms[b.b])) return null;
  markAromatic(atoms, bonds);
  const nbrs: Nb[][] = atoms.map(() => []);
  bonds.forEach((b, i) => {
    nbrs[b.a].push({ to: b.b, order: b.order, bond: i });
    nbrs[b.b].push({ to: b.a, order: b.order, bond: i });
  });
  atoms.forEach((a, i) => {
    const sum = nbrs[i].reduce((s, n) => s + (n.order === 4 ? 1.5 : n.order), 0);
    a.h = hasImplicitH(a.z) ? implicitHydrogens(a.z, sum, a.charge) : 0;
  });
  return { atoms, bonds, nbrs };
}

/**
 * Six-membered rings drawn with alternating bonds become aromatic (order 4), so ranking doesn't
 * depend on which Kekulé structure was drawn: each ring atom has its one double bond to another
 * ring atom (naphthalene, pyridine; not a quinone).
 */
function markAromatic(atoms: MAtom[], bonds: MBond[]): void {
  const nb: { to: number; bond: number }[][] = atoms.map(() => []);
  bonds.forEach((b, i) => { nb[b.a].push({ to: b.b, bond: i }); nb[b.b].push({ to: b.a, bond: i }); });
  const doubles = (i: number) => nb[i].filter((n) => bonds[n.bond].order === 2);
  const inSixRing = new Set<number>();
  const rings: number[][] = [];
  // six-membered rings: paths of five bonds back to the start
  const walk = (path: number[], bondPath: number[]) => {
    const last = path[path.length - 1];
    for (const n of nb[last]) {
      if (bondPath.includes(n.bond)) continue;
      if (path.length === 6) { if (n.to === path[0]) rings.push([...bondPath, n.bond]); continue; }
      if (path.includes(n.to) || n.to < path[0]) continue;
      walk([...path, n.to], [...bondPath, n.bond]);
    }
  };
  for (let i = 0; i < atoms.length; i++) if (nb[i].length >= 2) walk([i], []);
  const ringAtoms = rings.map((r) => new Set(r.flatMap((bi) => [bonds[bi].a, bonds[bi].b])));
  ringAtoms.forEach((s) => s.forEach((a) => inSixRing.add(a)));
  rings.forEach((r, k) => {
    const ok = [...ringAtoms[k]].every((a) => {
      if (r.some((bi) => bonds[bi].order === 4 && (bonds[bi].a === a || bonds[bi].b === a))) return true;
      const d = doubles(a);
      return d.length === 1 && inSixRing.has(d[0].to) && r.every((bi) => bonds[bi].order !== 3);
    });
    if (ok) for (const bi of r) if (bonds[bi].order === 1 || bonds[bi].order === 2) bonds[bi].order = 4;
  });
}

// ------------------------------------------------------------------ ranking (CIP rules 1a and 2)

interface Node { z: number; mass: number; atom: number; from: number; path: number[]; dup: boolean }

/** Nodes looked at in one sphere at most; past this the groups count as the same. */
const MAX_SPHERE = 4000;

function children(m: Mol, n: Node): Node[] {
  if (n.dup || n.atom < 0) return [];
  const out: Node[] = [];
  const dupOf = (atom: number): Node => ({ z: m.atoms[atom].z, mass: 0, atom, from: n.atom, path: n.path, dup: true });
  let aromZ = 0, aromN = 0;
  for (const nb of m.nbrs[n.atom]) {
    if (nb.order === 4) { aromZ += m.atoms[nb.to].z; aromN++; }
    const extra = nb.order === 2 ? 1 : nb.order === 3 ? 2 : 0;
    if (nb.to === n.from) {
      for (let k = 0; k < extra; k++) out.push(dupOf(nb.to));
      continue;
    }
    if (n.path.includes(nb.to)) out.push(dupOf(nb.to));
    else out.push({ z: m.atoms[nb.to].z, mass: m.atoms[nb.to].iso, atom: nb.to, from: n.atom, path: [...n.path, nb.to], dup: false });
    for (let k = 0; k < extra; k++) out.push(dupOf(nb.to));
  }
  // an aromatic atom with a double bond in every Kekulé structure: one duplicate, its atomic number averaged
  const a = m.atoms[n.atom];
  if (aromN >= 2 && (a.z === 6 || a.z === 5 || ((a.z === 7 || a.z === 15) && !a.h && a.charge >= 0))) {
    out.push({ z: aromZ / aromN, mass: 0, atom: -1, from: n.atom, path: n.path, dup: true });
  }
  for (let k = 0; k < m.atoms[n.atom].h; k++) out.push({ z: 1, mass: 0, atom: -1, from: n.atom, path: n.path, dup: true });
  return out;
}

const keyOf = (n: Node | undefined, rule: 1 | 2) => (n ? (rule === 1 ? n.z : n.mass) : 0);

/** Which of two groups ranks higher: > 0 for a, < 0 for b, 0 when these rules can't tell. */
function compareRule(m: Mol, a: Node, b: Node, rule: 1 | 2): number {
  let la = [a], lb = [b];
  if (keyOf(a, rule) !== keyOf(b, rule)) return keyOf(a, rule) - keyOf(b, rule);
  for (let sphere = 0; sphere < 60; sphere++) {
    const sort = (ns: Node[]) => ns.sort((p, q) => q.z - p.z || q.mass - p.mass);
    const ca = la.map((n) => sort(children(m, n))), cb = lb.map((n) => sort(children(m, n)));
    for (let i = 0; i < Math.max(ca.length, cb.length); i++) {
      const sa = ca[i] ?? [], sb = cb[i] ?? [];
      for (let j = 0; j < Math.max(sa.length, sb.length); j++) {
        const d = keyOf(sa[j], rule) - keyOf(sb[j], rule);
        if (d) return d;
      }
    }
    la = ca.flat();
    lb = cb.flat();
    if (!la.length && !lb.length) return 0;
    if (la.length > MAX_SPHERE || lb.length > MAX_SPHERE) return 0;
  }
  return 0;
}

/**
 * Ranks the groups `s1`, `s2` on `root` (−1 stands for an implicit hydrogen): > 0 when s1 ranks
 * higher, < 0 when s2 does, 0 when they can't be told apart.
 */
export function rankPair(m: Mol, root: number, s1: number, s2: number): number {
  const node = (s: number): Node => (s < 0
    ? { z: 1, mass: 0, atom: -1, from: root, path: [root], dup: true }
    : { z: m.atoms[s].z, mass: m.atoms[s].iso, atom: s, from: root, path: [root, s], dup: false });
  // a double bond from the root to the group: its duplicate sits on the root, not in the group
  return compareRule(m, node(s1), node(s2), 1) || compareRule(m, node(s1), node(s2), 2);
}

// ------------------------------------------------------------------ geometry

type V3 = [number, number, number];
const sub = (p: V3, q: V3): V3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const dot = (p: V3, q: V3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: V3, q: V3): V3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];

/** One end of an axis: its atom and its two groups (−1 for an implicit hydrogen). */
interface End { atom: number; groups: [number, number] }

/**
 * Up (+1), down (−1) or not shown (0) for a group on an end: a wedge or hash from the end atom
 * to it, or (for a biaryl's ring atoms, `viaGroup`) from it to one of its own substituents.
 * An allene's groups may be stereocentres with wedges of their own, so only the end's bonds count there.
 */
function tilt(m: Mol, end: number, g: number, viaGroup: boolean): number {
  if (g < 0) return 0;
  const sense = (b: MBond) => (b.stereo === 1 ? 1 : b.stereo === 6 ? -1 : 0);
  for (const nb of m.nbrs[end]) {
    const b = m.bonds[nb.bond];
    if (nb.to === g && b.a === end && sense(b)) return sense(b);
  }
  if (!viaGroup) return 0;
  for (const nb of m.nbrs[g]) {
    const b = m.bonds[nb.bond];
    if (nb.to !== end && b.a === g && sense(b)) return sense(b);
  }
  return 0;
}

/** The two groups' up/down, the second worked out from the first when only one is shown; null if they disagree. */
function tilts(m: Mol, e: End, viaGroup: boolean): [number, number] | null {
  let [t1, t2] = [tilt(m, e.atom, e.groups[0], viaGroup), tilt(m, e.atom, e.groups[1], viaGroup)];
  if (t1 && t2) return t1 === t2 ? null : [t1, t2];
  if (t1) t2 = -t1; else if (t2) t1 = -t2;
  return [t1, t2];
}

/**
 * Where an end's groups are in space. With `stand` false they lie in the page as drawn; with
 * `stand` true the end's plane is turned to stand across the page, each group keeping how far
 * along the axis it is and going up or down by its distance from the axis.
 */
function place(m: Mol, e: End, axis: V3, stand: boolean, t: [number, number]): [V3, V3] {
  const at = (i: number): V3 => [m.atoms[i].x, m.atoms[i].y, 0];
  const o = at(e.atom);
  const pos = (g: number, other: number): V3 => {
    if (g >= 0) return at(g);
    // an implicit hydrogen: across the axis from the other group
    const v = sub(at(other), o);
    const along = dot(v, axis);
    const perp = sub(v, [axis[0] * along, axis[1] * along, 0]);
    return [o[0] + axis[0] * along - perp[0], o[1] + axis[1] * along - perp[1], 0];
  };
  const p: [V3, V3] = [pos(e.groups[0], e.groups[1]), pos(e.groups[1], e.groups[0])];
  if (!stand) return p;
  return p.map((q, k) => {
    const v = sub(q, o);
    const along = dot(v, axis);
    const perp = Math.hypot(v[0] - axis[0] * along, v[1] - axis[1] * along);
    return [o[0] + axis[0] * along, o[1] + axis[1] * along, t[k] * perp] as V3;
  }) as [V3, V3];
}

/**
 * Ra or Sa for an axis from end `a` to end `b`, or null: no wedge says which way round it is,
 * the wedges disagree, or the groups on an end rank the same.
 */
export function axialDescriptor(m: Mol, a: End, b: End, viaGroup = false): AxialLabel | null {
  const ra = rankPair(m, a.atom, a.groups[0], a.groups[1]);
  const rb = rankPair(m, b.atom, b.groups[0], b.groups[1]);
  if (!ra || !rb) return null;
  const ta = tilts(m, a, viaGroup), tb = tilts(m, b, viaGroup);
  if (!ta || !tb) return null;
  const shownA = !!ta[0], shownB = !!tb[0];
  if (!shownA && !shownB) return null;
  const pa: V3 = [m.atoms[a.atom].x, m.atoms[a.atom].y, 0], pb: V3 = [m.atoms[b.atom].x, m.atoms[b.atom].y, 0];
  const len = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]);
  if (len < 1e-6) return null;
  const axis: V3 = [(pb[0] - pa[0]) / len, (pb[1] - pa[1]) / len, 0];
  const at = (standing: 'a' | 'b'): AxialLabel | null => {
    const ga = place(m, a, axis, standing === 'a', ta);
    const gb = place(m, b, axis, standing === 'b', tb);
    const near1 = ra > 0 ? ga[0] : ga[1], near2 = ra > 0 ? ga[1] : ga[0];
    const far1 = rb > 0 ? gb[0] : gb[1];
    const turn = dot(cross(sub(near2, near1), sub(far1, near1)), axis);
    if (Math.abs(turn) < 1e-9) return null;
    return turn > 0 ? 'Ra' : 'Sa';
  };
  // the end with wedges is the one standing across the page; with wedges on both, both readings must agree
  const fromA = shownA ? at('a') : null, fromB = shownB ? at('b') : null;
  if (fromA && fromB) return fromA === fromB ? fromA : null;
  return fromA ?? fromB;
}

// ------------------------------------------------------------------ finding axes

/** Bonds that are part of a ring. */
function ringBonds(m: Mol): Set<number> {
  const out = new Set<number>();
  m.bonds.forEach((b, i) => {
    // is there another path from b.a to b.b?
    const seen = new Set([b.a]);
    const stack = [b.a];
    while (stack.length) {
      const x = stack.pop()!;
      for (const n of m.nbrs[x]) {
        if (n.bond === i || seen.has(n.to)) continue;
        if (n.to === b.b) { out.add(i); stack.length = 0; break; }
        seen.add(n.to);
        stack.push(n.to);
      }
    }
  });
  return out;
}

/** The two groups on `atom` other than `not` (−1 for one implicit hydrogen), or null when it doesn't have exactly two. */
function twoGroups(m: Mol, atom: number, not: number[]): [number, number] | null {
  const g = m.nbrs[atom].map((n) => n.to).filter((t) => !not.includes(t));
  if (g.length === 2 && m.atoms[atom].h === 0) return [g[0], g[1]];
  if (g.length === 1 && m.atoms[atom].h === 1) return [g[0], -1];
  return null;
}

const multiple = (m: Mol, i: number) => m.nbrs[i].some((n) => n.order === 2 || n.order === 4);

export interface AxialTags {
  /** On a single bond (biaryls) or on the double bond of an alkylidenecycloalkane. */
  bonds: [number, number, AxialLabel][];
  /** On the middle atom of an allene. */
  atoms: [number, AxialLabel][];
}

/** Every axis in a molfile with its label. Atoms in `skip` (inside abbreviations) are never an axis end. */
export function axialTags(molblock: string, skip: readonly number[] = []): AxialTags {
  const out: AxialTags = { bonds: [], atoms: [] };
  const m = readMol(molblock);
  if (!m || !m.bonds.some((b) => b.stereo === 1 || b.stereo === 6)) return out;
  const skipped = new Set(skip);
  const rings = ringBonds(m);
  m.bonds.forEach((b, i) => {
    if (skipped.has(b.a) || skipped.has(b.b)) return;
    // biaryls and other hindered single bonds between two flat (sp2) atoms
    if (b.order === 1 && !rings.has(i) && multiple(m, b.a) && multiple(m, b.b)) {
      const ga = twoGroups(m, b.a, [b.b]), gb = twoGroups(m, b.b, [b.a]);
      if (!ga || !gb || ga[1] < 0 || gb[1] < 0) return;
      const l = axialDescriptor(m, { atom: b.a, groups: ga }, { atom: b.b, groups: gb }, true);
      if (l) out.bonds.push([b.a, b.b, l]);
      return;
    }
    if (b.order !== 2) return;
    // allenes: the middle atom has two double bonds
    for (const [mid, end] of [[b.a, b.b], [b.b, b.a]]) {
      const doubles = m.nbrs[mid].filter((n) => n.order === 2);
      if (m.nbrs[mid].length !== 2 || doubles.length !== 2) continue;
      const other = doubles.find((n) => n.to !== end)!.to;
      if (end > other) continue; // each allene once
      if (skipped.has(other) || skipped.has(mid)) continue;
      const ga = twoGroups(m, end, [mid]), gb = twoGroups(m, other, [mid]);
      if (!ga || !gb) continue;
      const l = axialDescriptor(m, { atom: end, groups: ga }, { atom: other, groups: gb });
      if (l) out.atoms.push([mid, l]);
    }
    // alkylidenecycloalkanes: a double bond out of a four- or six-membered ring, read to the ring atom across from it
    if (!rings.has(i)) {
      for (const [ringAtom, outer] of [[b.a, b.b], [b.b, b.a]]) {
        const across = acrossRing(m, ringAtom, rings);
        if (across === null || skipped.has(across)) continue;
        const ga = twoGroups(m, outer, [ringAtom]);
        const ringNbrs = m.nbrs[across].filter((n) => rings.has(n.bond)).map((n) => n.to);
        if (ringNbrs.length !== 2) continue;
        const gb = twoGroups(m, across, ringNbrs);
        if (!ga || !gb) continue;
        const l = axialDescriptor(m, { atom: outer, groups: ga }, { atom: across, groups: gb });
        if (l) out.bonds.push([b.a, b.b, l]);
      }
    }
  });
  return out;
}

/**
 * The ring atom across from `atom` when `atom` is in exactly one ring of four or six atoms (not a
 * fused or bridged one), else null.
 */
function acrossRing(m: Mol, atom: number, rings: Set<number>): number | null {
  const inRing = m.nbrs[atom].filter((n) => rings.has(n.bond));
  if (inRing.length !== 2) return null;
  // walk round the ring from one neighbour back to the atom
  const path = [atom, inRing[0].to];
  while (path.length < 8) {
    const last = path[path.length - 1];
    const next = m.nbrs[last].filter((n) => rings.has(n.bond) && n.to !== path[path.length - 2]);
    if (next.length !== 1) return null;
    if (next[0].to === atom) break;
    path.push(next[0].to);
  }
  if (path.length !== 4 && path.length !== 6) return null;
  return path[path.length / 2];
}
