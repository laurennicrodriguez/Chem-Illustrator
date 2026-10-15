// What the Analysis panel works out besides formula and masses: the isotope pattern of an ion,
// elemental analysis, and estimated boiling and melting points.
//
// Sources:
// - Isotope masses and abundances: NIST, "Atomic Weights and Isotopic Compositions for All
//   Elements" (masses from the 2016 Atomic Mass Evaluation, abundances as IUPAC's
//   "representative isotopic compositions").
// - Boiling and melting points: K. G. Joback and R. C. Reid, "Estimation of pure-component
//   properties from group-contributions", Chem. Eng. Commun. 1987, 57, 233–243.
//   Tb = 198 + Σ(Tb groups) K and Tm = 122.5 + Σ(Tm groups) K. The method is rough (its authors give
//   an average error of about 13 K for Tb and 23 K for Tm, worse for large molecules), so the
//   panel calls these estimates.

import { ALIASES, ELECTRON, type Adduct } from './hrms';

/** Element counts of a neutral formula such as C9H8O4, CH2Cl2, C2H5D or an adduct's NH4. */
export function formulaCounts(formula: string): Map<string, number> | null {
  const f = ALIASES[formula] ?? formula;
  const counts = new Map<string, number>();
  const re = /([A-Z][a-z]?)(\d*)/g;
  let pos = 0;
  for (let g; (g = re.exec(f)); ) {
    if (g.index !== pos || !g[0]) return null;
    pos = g.index + g[0].length;
    counts.set(g[1], (counts.get(g[1]) ?? 0) + (g[2] ? Number(g[2]) : 1));
  }
  return pos === f.length && f.length > 0 ? counts : null;
}

/** The elements of an ion such as [M+Na]+ of a molecule with these counts. Null when an adduct takes away more than there is. */
export function ionCounts(mol: Map<string, number>, adduct: Adduct): Map<string, number> | null {
  const out = new Map<string, number>();
  for (const [el, n] of mol) out.set(el, n * adduct.n);
  for (const p of adduct.parts) {
    const c = formulaCounts(p.formula);
    if (!c) return null;
    for (const [el, n] of c) out.set(el, (out.get(el) ?? 0) + p.sign * p.count * n);
  }
  for (const [el, n] of out) {
    if (n < 0) return null;
    if (n === 0) out.delete(el);
  }
  return out;
}

/** Isotopes of the elements the isotope pattern knows: [mass (u), abundance (%)]. */
export const ISOTOPES: Record<string, [number, number][]> = {
  H: [[1.00782503223, 99.9885], [2.01410177812, 0.0115]],
  D: [[2.01410177812, 100]],
  Li: [[6.0151228874, 7.59], [7.0160034366, 92.41]],
  B: [[10.01293695, 19.9], [11.00930536, 80.1]],
  C: [[12, 98.93], [13.00335483507, 1.07]],
  N: [[14.00307400443, 99.636], [15.00010889888, 0.364]],
  O: [[15.99491461957, 99.757], [16.9991317565, 0.038], [17.99915961286, 0.205]],
  F: [[18.99840316273, 100]],
  Na: [[22.989769282, 100]],
  Mg: [[23.985041697, 78.99], [24.985836976, 10.0], [25.982592968, 11.01]],
  Si: [[27.97692653465, 92.223], [28.9764946649, 4.685], [29.973770136, 3.092]],
  P: [[30.97376199842, 100]],
  S: [[31.9720711744, 94.99], [32.9714589098, 0.75], [33.967867004, 4.25], [35.96708071, 0.01]],
  Cl: [[34.968852682, 75.76], [36.965902602, 24.24]],
  K: [[38.9637064864, 93.2581], [39.963998166, 0.0117], [40.9618252579, 6.7302]],
  Fe: [[53.93960899, 5.845], [55.93493633, 91.754], [56.93539284, 2.119], [57.93327443, 0.282]],
  Cu: [[62.92959772, 69.15], [64.9277897, 30.85]],
  Se: [[73.922475934, 0.89], [75.919213704, 9.37], [76.919914154, 7.63], [77.91730928, 23.77], [79.9165218, 49.61], [81.9166995, 8.73]],
  Br: [[78.9183376, 50.69], [80.9162897, 49.31]],
  Pd: [[101.9056022, 1.02], [103.9040305, 11.14], [104.9050796, 22.33], [105.9034804, 27.33], [107.9038916, 26.46], [109.9051722, 11.72]],
  Ag: [[106.9050916, 51.839], [108.9047553, 48.161]],
  I: [[126.9044719, 100]],
  Cs: [[132.905451961, 100]],
};

/**
 * A distribution by nominal mass: entry k holds the isotopologues k mass units above the
 * lightest (their summed probability `p`, and `pm`, the sum of probability times mass, so
 * their mean mass is pm / p). This is exactly what the pattern shows (M, M+1, M+2…, each at
 * its mean m/z), and it stays a few hundred numbers long even for a protein, where keeping
 * every isotopologue apart took seconds.
 */
interface Nominal { p: Float64Array; pm: Float64Array }

/** Entries weaker than this fraction of the strongest are dropped from the ends. */
const PRUNE = 1e-12;

function convolve(a: Nominal, b: Nominal): Nominal {
  const n = a.p.length + b.p.length - 1;
  const p = new Float64Array(n), pm = new Float64Array(n);
  for (let i = 0; i < a.p.length; i++) {
    const ap = a.p[i], apm = a.pm[i];
    if (!ap) continue;
    for (let j = 0; j < b.p.length; j++) {
      const bp = b.p[j];
      if (!bp) continue;
      p[i + j] += ap * bp;
      // the mean mass of a sum is the sum of the means: Σ pa·pb·(ma + mb)
      pm[i + j] += apm * bp + ap * b.pm[j];
    }
  }
  return trim({ p, pm });
}

/** Drop the negligible ends (keeping index 0, the lightest, as the reference). */
function trim(d: Nominal): Nominal {
  let max = 0;
  for (const x of d.p) if (x > max) max = x;
  let end = d.p.length;
  while (end > 1 && d.p[end - 1] < max * PRUNE) end--;
  for (let i = 0; i < end; i++) if (d.p[i] < max * PRUNE) { d.p[i] = 0; d.pm[i] = 0; }
  return end === d.p.length ? d : { p: d.p.slice(0, end), pm: d.pm.slice(0, end) };
}

/** One atom of an element, by nominal mass above its lightest isotope. */
function atomOf(iso: [number, number][]): Nominal {
  const light = Math.min(...iso.map(([m]) => m));
  const n = Math.max(...iso.map(([m]) => Math.round(m - light))) + 1;
  const p = new Float64Array(n), pm = new Float64Array(n);
  for (const [m, a] of iso) {
    const k = Math.round(m - light);
    p[k] += a / 100;
    pm[k] += (a / 100) * m;
  }
  return { p, pm };
}

/** The distribution of n atoms of one element, by repeated squaring. */
function elementPeaks(iso: [number, number][], n: number): Nominal {
  let result: Nominal = { p: Float64Array.of(1), pm: Float64Array.of(0) };
  let base = atomOf(iso);
  for (let k = n; k > 0; k >>= 1) {
    if (k & 1) result = convolve(result, base);
    if (k > 1) base = convolve(base, base);
  }
  return result;
}

export interface IsotopePeak {
  /** m/z, the intensity-weighted mean of the isotopologues that make up this peak. */
  mz: number;
  /** Height relative to the tallest peak, in % (the tallest is 100). */
  rel: number;
}

/** Patterns already worked out (the Analysis panel asks again on every change). */
const patterns = new Map<string, IsotopePeak[] | null>();

/**
 * The isotope pattern of an ion with these element counts and charge z, as a mass spectrometer
 * shows it: isotopologues one mass unit apart are summed into one peak (M, M+1, M+2…), at their
 * mean m/z. Peaks below `min` % of the tallest are left out. Null when an element is not in the table.
 */
export function isotopePattern(counts: Map<string, number>, z: number, min = 0.1): IsotopePeak[] | null {
  const key = `${[...counts].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([e, n]) => e + n).join('')}|${z}`;
  let all = patterns.get(key);
  if (all === undefined) {
    all = computePattern(counts, z);
    if (patterns.size > 200) patterns.clear();
    patterns.set(key, all);
  }
  return all && all.filter((g) => g.rel >= min);
}

function computePattern(counts: Map<string, number>, z: number): IsotopePeak[] | null {
  let d: Nominal = { p: Float64Array.of(1), pm: Float64Array.of(0) };
  for (const [el, n] of counts) {
    const iso = ISOTOPES[el];
    if (!iso) return null;
    if (n > 0) d = convolve(d, elementPeaks(iso, n));
  }
  if (!z) z = 1;
  let max = 0;
  for (const x of d.p) if (x > max) max = x;
  const out: IsotopePeak[] = [];
  for (let k = 0; k < d.p.length; k++) {
    if (!d.p[k]) continue;
    const m = d.pm[k] / d.p[k];
    out.push({ mz: (m - z * ELECTRON) / Math.abs(z), rel: (100 * d.p[k]) / max });
  }
  return out;
}

/**
 * Elemental analysis: each element's share of the mass, in %, from the element counts and the
 * standard atomic weights (as the chemistry engine uses them). Hill order, as journals list it (C, H, N…).
 */
export function elementalAnalysis(counts: Map<string, number>, weights: Record<string, number>): { el: string; pct: number }[] | null {
  let total = 0;
  for (const [el, n] of counts) {
    const w = weights[el];
    if (w === undefined) return null;
    total += n * w;
  }
  if (!total) return null;
  const els = [...counts.keys()];
  const hasC = counts.has('C');
  const rank = (s: string) => (hasC ? (s === 'C' ? 0 : s === 'H' ? 1 : s === 'D' ? 1.5 : s === 'N' ? 2 : 3) : 0);
  els.sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
  return els.map((el) => ({ el, pct: (100 * counts.get(el)! * weights[el]) / total }));
}

// ---------------------------------------------------------------- Joback estimates

/** Joback and Reid's groups: [Tb, Tm] contributions in K (Tm null where the paper gives none). */
export const JOBACK: Record<string, [number, number | null]> = {
  '-CH3': [23.58, -5.1],
  '-CH2-': [22.88, 11.27],
  '>CH-': [21.74, 12.64],
  '>C<': [18.25, 46.43],
  '=CH2': [18.18, -4.32],
  '=CH-': [24.96, 8.73],
  '=C<': [24.14, 11.14],
  '=C=': [26.15, 17.78],
  '≡CH': [9.2, -11.18],
  '≡C-': [27.38, 64.32],
  '-CH2- (ring)': [27.15, 7.75],
  '>CH- (ring)': [21.78, 19.88],
  '>C< (ring)': [21.32, 60.15],
  '=CH- (ring)': [26.73, 8.13],
  '=C< (ring)': [31.01, 37.02],
  '-F': [-0.03, -15.78],
  '-Cl': [38.13, 13.55],
  '-Br': [66.86, 43.43],
  '-I': [93.84, 41.69],
  '-OH (alcohol)': [92.88, 44.45],
  '-OH (phenol)': [76.34, 82.83],
  '-O-': [22.42, 22.23],
  '-O- (ring)': [31.22, 23.05],
  '>C=O': [76.75, 61.2],
  '>C=O (ring)': [94.97, 75.97],
  'O=CH- (aldehyde)': [72.24, 36.9],
  '-COOH': [169.09, 155.5],
  '-COO- (ester)': [81.1, 53.6],
  '=O (other)': [-10.5, 2.08],
  '-NH2': [73.23, 66.89],
  '>NH': [50.17, 52.66],
  '>NH (ring)': [52.82, 101.51],
  '>N-': [11.74, 48.84],
  '-N=': [74.6, null],
  '-N= (ring)': [57.55, 68.4],
  '=NH': [83.08, 68.91],
  '-CN': [125.66, 59.89],
  '-NO2': [152.54, 127.24],
  '-SH': [63.56, 20.09],
  '-S-': [68.78, 34.4],
  '-S- (ring)': [52.1, 79.93],
};

export interface JobackResult {
  /** Normal boiling point, K (null when a group can't be assigned). */
  tb: number | null;
  /** Melting point, K (null when a group can't be assigned or has no Tm value). */
  tm: number | null;
  /** How many of each group were counted. */
  groups: Record<string, number>;
  /** Why there is no estimate, in plain words. */
  missing?: string;
}

/** A molecule as RDKit's JSON gives it (commonchem), the parts used here. */
interface JsonMol {
  atoms: { z?: number; impHs?: number; chg?: number }[];
  bonds: { bo?: number; atoms: [number, number] }[];
  extensions?: { name: string; aromaticAtoms?: number[]; atomRings?: number[][] }[];
}

const SYM: Record<number, string> = { 6: 'C', 7: 'N', 8: 'O', 9: 'F', 16: 'S', 17: 'Cl', 35: 'Br', 53: 'I' };

/**
 * Joback and Reid's estimated boiling and melting points for a molecule given as RDKit JSON.
 * Each heavy atom is put in one group (carbonyls, acids, esters, nitriles and nitro groups take
 * their O and N with them); a molecule with an atom no group fits gets no estimate.
 */
export function joback(json: string): JobackResult {
  const j = JSON.parse(json);
  const defs = j.defaults ?? {};
  const mol: JsonMol = j.molecules[0];
  const n = mol.atoms.length;
  const z = mol.atoms.map((a) => a.z ?? defs.atom?.z ?? 6);
  const hs = mol.atoms.map((a) => a.impHs ?? defs.atom?.impHs ?? 0);
  const chg = mol.atoms.map((a) => a.chg ?? defs.atom?.chg ?? 0);
  const ext = mol.extensions?.find((e) => e.name === 'rdkitRepresentation');
  const arom = new Set(ext?.aromaticAtoms ?? []);
  const inRing = new Set((ext?.atomRings ?? []).flat());
  // neighbours as [atom, bond order], explicit H atoms folded into their atom's H count
  const nb: [number, number][][] = Array.from({ length: n }, () => []);
  for (const b of mol.bonds) {
    const [p, q] = b.atoms;
    const bo = b.bo ?? defs.bond?.bo ?? 1;
    if (z[p] === 1 && z[q] !== 1) { hs[q]++; continue; }
    if (z[q] === 1 && z[p] !== 1) { hs[p]++; continue; }
    nb[p].push([q, bo]);
    nb[q].push([p, bo]);
  }
  const groups: Record<string, number> = {};
  const done = new Set<number>();
  const add = (g: string, ...atoms: number[]) => { groups[g] = (groups[g] ?? 0) + 1; for (const a of atoms) done.add(a); };
  const fail = (why: string): JobackResult => ({ tb: null, tm: null, groups, missing: why });
  const terminal = (a: number) => nb[a].length === 1;

  // groups of several atoms first
  for (let a = 0; a < n; a++) {
    if (z[a] === 6 && !arom.has(a) && !chg[a]) {
      const dO = nb[a].find(([b, bo]) => bo === 2 && z[b] === 8 && terminal(b) && !chg[b]);
      if (dO) {
        const sO = nb[a].filter(([b, bo]) => bo === 1 && z[b] === 8 && !chg[b] && !done.has(b)).map(([b]) => b);
        const acid = sO.find((b) => terminal(b) && hs[b] === 1);
        const ester = sO.find((b) => nb[b].length === 2 && hs[b] === 0 && nb[b].every(([c]) => z[c] === 6));
        if (acid !== undefined && hs[a] === 0) add('-COOH', a, dO[0], acid);
        else if (ester !== undefined && hs[a] === 0 && !inRing.has(a)) add('-COO- (ester)', a, dO[0], ester);
        else if (hs[a] >= 1 && !inRing.has(a)) add('O=CH- (aldehyde)', a, dO[0]);
        else add(inRing.has(a) ? '>C=O (ring)' : '>C=O', a, dO[0]);
        continue;
      }
      const tN = nb[a].find(([b, bo]) => bo === 3 && z[b] === 7 && terminal(b));
      if (tN && hs[a] === 0) { add('-CN', a, tN[0]); continue; }
    }
    if (z[a] === 7) {
      const os = nb[a].filter(([b]) => z[b] === 8 && terminal(b));
      if (os.length === 2 && nb[a].length === 3 && chg[a] + os.reduce((s, [b]) => s + chg[b], 0) === 0) add('-NO2', a, ...os.map(([b]) => b));
    }
  }

  for (let a = 0; a < n; a++) {
    if (done.has(a) || z[a] === 1) continue;
    const sym = SYM[z[a]];
    const ring = inRing.has(a);
    const h = hs[a];
    const deg = nb[a].length;
    const doubles = nb[a].filter(([, bo]) => bo === 2).length;
    const triples = nb[a].filter(([, bo]) => bo === 3).length;
    if (!sym) return fail(`Joback's method has no group for ${elementName(z[a])}.`);
    if (chg[a]) return fail('Joback\'s method has no groups for charged atoms.');
    switch (sym) {
      case 'C':
        if (arom.has(a)) add(h ? '=CH- (ring)' : '=C< (ring)', a);
        else if (triples) add(h ? '≡CH' : '≡C-', a);
        else if (doubles >= 2) add('=C=', a);
        else if (doubles === 1) add(h === 2 ? '=CH2' : h === 1 ? (ring ? '=CH- (ring)' : '=CH-') : ring ? '=C< (ring)' : '=C<', a);
        else if (h === 3) add('-CH3', a);
        else if (h === 2) add(ring ? '-CH2- (ring)' : '-CH2-', a);
        else if (h === 1) add(ring ? '>CH- (ring)' : '>CH-', a);
        else if (h === 0 && deg === 4) add(ring ? '>C< (ring)' : '>C<', a);
        else return fail('Joback\'s method has no group for methane or a carbon with this many hydrogens.');
        break;
      case 'O':
        if (doubles) add('=O (other)', a);
        else if (deg === 1 && h === 1) add(nb[a].some(([b]) => arom.has(b)) ? '-OH (phenol)' : '-OH (alcohol)', a);
        else if (deg === 2) add(ring ? '-O- (ring)' : '-O-', a);
        else return fail('Joback\'s method has no group for water or an O like this one.');
        break;
      case 'N':
        if (arom.has(a)) {
          if (h === 1) add('>NH (ring)', a);
          else if (deg === 2) add('-N= (ring)', a);
          else return fail('Joback\'s method has no group for an aromatic N with three bonds (as in N-methylpyrrole).');
        } else if (triples) return fail('Joback\'s method has no group for this N.');
        else if (doubles) add(h === 1 ? '=NH' : ring ? '-N= (ring)' : '-N=', a);
        else if (h === 2) add('-NH2', a);
        else if (h === 1) add(ring ? '>NH (ring)' : '>NH', a);
        else if (deg === 3 && !ring) add('>N-', a);
        else return fail('Joback\'s method has no group for a ring N with three bonds (as in N-methylpiperidine).');
        break;
      case 'S':
        if (deg === 1 && h === 1 && !doubles) add('-SH', a);
        else if (deg === 2 && !doubles) add(ring || arom.has(a) ? '-S- (ring)' : '-S-', a);
        else return fail('Joback\'s method has no group for S with more than two bonds (sulfoxides, sulfones).');
        break;
      default:
        add('-' + sym, a);
    }
  }
  if (!Object.keys(groups).length) return fail('No groups.');
  let tb = 198, tm: number | null = 122.5;
  for (const [g, k] of Object.entries(groups)) {
    const [b, m] = JOBACK[g];
    tb += k * b;
    tm = tm === null || m === null ? null : tm + k * m;
  }
  return { tb, tm, groups, missing: tm === null ? 'No melting point: Joback\'s method has no value for an open-chain -N= group.' : undefined };
}

function elementName(z: number): string {
  const names: Record<number, string> = { 5: 'boron', 14: 'silicon', 15: 'phosphorus', 34: 'selenium', 0: 'R groups' };
  return names[z] ?? 'this element';
}
