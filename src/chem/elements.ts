// Element symbols and the default valences used to work out implicit hydrogens.

export const SYMBOLS = [
  '', 'H', 'He', 'Li', 'Be', 'B', 'C', 'N', 'O', 'F', 'Ne', 'Na', 'Mg', 'Al', 'Si', 'P', 'S', 'Cl', 'Ar',
  'K', 'Ca', 'Sc', 'Ti', 'V', 'Cr', 'Mn', 'Fe', 'Co', 'Ni', 'Cu', 'Zn', 'Ga', 'Ge', 'As', 'Se', 'Br', 'Kr',
  'Rb', 'Sr', 'Y', 'Zr', 'Nb', 'Mo', 'Tc', 'Ru', 'Rh', 'Pd', 'Ag', 'Cd', 'In', 'Sn', 'Sb', 'Te', 'I', 'Xe',
  'Cs', 'Ba', 'La', 'Ce', 'Pr', 'Nd', 'Pm', 'Sm', 'Eu', 'Gd', 'Tb', 'Dy', 'Ho', 'Er', 'Tm', 'Yb', 'Lu',
  'Hf', 'Ta', 'W', 'Re', 'Os', 'Ir', 'Pt', 'Au', 'Hg', 'Tl', 'Pb', 'Bi', 'Po', 'At', 'Rn',
  'Fr', 'Ra', 'Ac', 'Th', 'Pa', 'U', 'Np', 'Pu', 'Am', 'Cm', 'Bk', 'Cf', 'Es', 'Fm', 'Md', 'No', 'Lr',
  'Rf', 'Db', 'Sg', 'Bh', 'Hs', 'Mt', 'Ds', 'Rg', 'Cn', 'Nh', 'Fl', 'Mc', 'Lv', 'Ts', 'Og',
];

const BY_SYMBOL = new Map<string, number>(SYMBOLS.map((s, i) => [s, i] as [string, number]).filter(([s]) => s));

export function elementNumber(sym: string): number | undefined {
  if (sym === 'D' || sym === 'T') return 1;
  return BY_SYMBOL.get(sym);
}

/** Normal valences for main-group elements that take implicit hydrogens. */
const VALENCES: Record<number, number[]> = {
  1: [1], 5: [3], 6: [4], 7: [3], 8: [2], 9: [1], 14: [4], 15: [3, 5], 16: [2, 4, 6], 17: [1],
  32: [4], 33: [3, 5], 34: [2, 4, 6], 35: [1], 50: [4], 51: [3, 5], 52: [2, 4, 6], 53: [1, 3, 5],
};

export function hasImplicitH(z: number): boolean {
  return z in VALENCES;
}

/** Group of a main-group element used to adjust valence for charge. */
function isPnictogenOrChalcogen(z: number): boolean {
  return [7, 8, 15, 16, 33, 34, 51, 52].includes(z);
}

/**
 * Implicit hydrogen count for an atom with the given total bond order and charge,
 * following the usual rules (e.g. N+ takes 4 bonds, C+ and C− take 3, O− takes 1).
 */
export function implicitHydrogens(z: number, bondOrderSum: number, charge: number, radical = 0): number {
  const vals = VALENCES[z];
  if (!vals) return 0;
  let adj = 0;
  if (charge !== 0) {
    if (z === 6 || z === 14) adj = -Math.abs(charge);
    else if (z === 5) adj = -charge; // B− takes 4
    else if (isPnictogenOrChalcogen(z)) adj = charge;
    else adj = -Math.abs(charge);
  }
  const used = Math.ceil(bondOrderSum - 1e-6) + radical;
  for (const val of vals) {
    const target = val + adj;
    if (target >= used) return target - used;
  }
  return 0;
}

/**
 * Most bonds an element normally makes, for the valence warning, adjusted for charge the same
 * way as the hydrogen count (N+ makes 4, C+ and C− make 3, O− makes 1, B− makes 4).
 * Undefined for elements that are not checked (transition metals, noble gases).
 */
export function maxValence(z: number, charge = 0): number | undefined {
  const max = MAX_VALENCE[z];
  if (max === undefined) return undefined;
  let adj = 0;
  if (charge !== 0) {
    if (z === 6 || z === 14) adj = -Math.abs(charge);
    else if (GROUP_13.has(z)) adj = -charge;
    else if (isPnictogenOrChalcogen(z)) adj = charge;
    else adj = -Math.abs(charge);
  }
  return Math.max(0, max + adj);
}

const GROUP_13 = new Set([5, 13, 31, 49, 81]);

/** Highest normal valence: the hydrogen-taking elements above, plus main-group metals. */
const MAX_VALENCE: Record<number, number> = {
  ...Object.fromEntries(Object.entries(VALENCES).map(([z, v]) => [z, v[v.length - 1]])),
  17: 7, 35: 7, 53: 7, // perchlorate, periodinane
  3: 1, 11: 1, 19: 1, 37: 1, 55: 1, // alkali metals
  4: 2, 12: 2, 20: 2, 38: 2, 56: 2, // alkaline earths
  13: 3, 31: 3, 49: 3, 81: 3, 30: 2, 48: 2, 80: 2, 82: 4,
};

/**
 * How many bonds an atom's bonds add up to for valence: single 1, double 2, triple 3. Aromatic
 * (1.5) bonds count as drawn alternating: a ring carbon gets one double bond among them (benzene
 * C–R makes 4), while N, O, S, P, Se and B may instead give a lone pair (pyrrole N–R makes 3).
 */
export function valenceOfBonds(orders: Iterable<number>, z = 6): number {
  let sum = 0, arom = 0;
  for (const o of orders) {
    if (o === 1.5) arom++;
    else sum += o;
  }
  if (!arom) return sum;
  return sum + arom + (LONE_PAIR_DONORS.has(z) ? 0 : 1);
}

const LONE_PAIR_DONORS = new Set([5, 7, 8, 15, 16, 34]);

/** Fewest bonds an element normally makes (with its hydrogens), adjusted for charge; undefined if not checked. */
export function minValence(z: number, charge = 0): number | undefined {
  const vals = VALENCES[z];
  const max = maxValence(z, charge);
  if (!vals || max === undefined) return undefined;
  return Math.max(0, vals[0] + (max - MAX_VALENCE[z]));
}

/** True if the atom carries more bonds than any of its normal valences allows. */
export function valenceExceeded(z: number, bondOrderSum: number, charge: number): boolean {
  const max = maxValence(z, charge);
  if (max === undefined) return false;
  return Math.ceil(bondOrderSum - 1e-6) > max;
}

/** Where an element sits in the periodic table: row 1–7, or 9–10 for the f-block rows below. */
export function tablePosition(z: number): { row: number; col: number } | null {
  if (z < 1 || z > 118) return null;
  const ends = [2, 10, 18, 36, 54, 86, 118];
  const period = ends.findIndex((e) => z <= e) + 1;
  const i = z - (period === 1 ? 0 : ends[period - 2]) - 1; // place within the period, from 0
  if (period === 1) return { row: 1, col: i === 0 ? 1 : 18 };
  if (period <= 3) return { row: period, col: i < 2 ? i + 1 : i + 11 };
  if (period <= 5) return { row: period, col: i + 1 };
  // periods 6 and 7: s-block, then the f-block (lanthanides, actinides) in its own row, then the rest
  if (i < 2) return { row: period, col: i + 1 };
  if (i < 17) return { row: period + 3, col: i + 1 };
  return { row: period, col: i - 13 };
}
