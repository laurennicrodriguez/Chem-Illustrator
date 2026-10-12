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

/** True if the atom carries more bonds than any of its normal valences allows. */
export function valenceExceeded(z: number, bondOrderSum: number, charge: number): boolean {
  const vals = VALENCES[z];
  if (!vals) return false;
  let adj = 0;
  if (charge !== 0) {
    if (z === 6 || z === 14) adj = -Math.abs(charge);
    else if (z === 5) adj = -charge;
    else if (isPnictogenOrChalcogen(z)) adj = charge;
    else adj = -Math.abs(charge);
  }
  return Math.ceil(bondOrderSum - 1e-6) > vals[vals.length - 1] + adj;
}
