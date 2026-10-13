// High-resolution mass spectrometry: the m/z of an ion such as [M+H]+, [M+Na]+, [M−H]− or
// [2M+NH4]+ from a molecule's monoisotopic (exact) mass.
//
// m/z = (n·M + the masses added − the masses taken away − z·mₑ) / |z|
//
// Masses are of the most abundant isotope of each element, from NIST's "Atomic Weights and
// Isotopic Compositions" (values of the 2016 Atomic Mass Evaluation); the electron mass is the
// CODATA 2018 value. An ion's charge comes from its electrons, so z electron masses are taken
// off for a cation and added for an anion.

/** Mass of the electron, u (CODATA 2018). */
export const ELECTRON = 0.000548579909065;

/** Monoisotopic masses (u) of the elements that make up adducts and losses. */
export const MONOISOTOPIC: Record<string, number> = {
  H: 1.00782503223, D: 2.01410177812, Li: 7.0160034366, B: 11.00930536, C: 12, N: 14.00307400443, O: 15.99491461957,
  F: 18.99840316273, Na: 22.989769282, Mg: 23.985041697, Si: 27.97692653465, P: 30.97376199842, S: 31.9720711744,
  Cl: 34.968852682, K: 38.9637064864, Ca: 39.962590863, Fe: 55.93493633, Cu: 62.92959772, Zn: 63.92914201,
  Se: 79.9165218, Br: 78.9183376, Rb: 84.9117897379, Ag: 106.9050916, Pd: 105.9034804, Sn: 119.90220163,
  I: 126.9044719, Cs: 132.905451961, Pt: 194.9647917, Au: 196.96656879,
};

/** Common groups written in adducts, as formulas. */
const ALIASES: Record<string, string> = { HCOO: 'CHO2', CH3COO: 'C2H3O2', OAc: 'C2H3O2', ACN: 'C2H3N', MeCN: 'C2H3N', MeOH: 'CH4O', FA: 'CH2O2', TFA: 'C2HF3O2', DMSO: 'C2H6OS' };

/** The charge each ion brings when it is added (taking it away brings the opposite). Anything else is neutral. */
const ION_CHARGE: Record<string, number> = {
  H: 1, D: 1, Li: 1, Na: 1, K: 1, Rb: 1, Cs: 1, Ag: 1, NH4: 1, Cu: 1,
  Cl: -1, Br: -1, I: -1, F: -1, HCOO: -1, CH3COO: -1, OAc: -1, CF3COO: -1,
};

/** Mass of a formula such as H2O, NH4 or C2H3N. Null when it holds an element not in the table. */
export function formulaMass(formula: string): number | null {
  const f = ALIASES[formula] ?? formula;
  let m = 0;
  const re = /([A-Z][a-z]?)(\d*)/g;
  let pos = 0;
  for (let g; (g = re.exec(f)); ) {
    if (g.index !== pos || !g[0]) return null;
    pos = g.index + g[0].length;
    const mass = MONOISOTOPIC[g[1]];
    if (mass === undefined) return null;
    m += mass * (g[2] ? Number(g[2]) : 1);
  }
  return pos === f.length && f.length > 0 ? m : null;
}

export interface Adduct {
  /** How many molecules: 2 for [2M+H]+. */
  n: number;
  /** Groups added (+) or taken away (−), each with its mass. */
  parts: { sign: 1 | -1; count: number; formula: string; mass: number }[];
  /** Charge of the ion: +1, −1, +2… */
  z: number;
  /** Written neatly: [M+H]+. */
  label: string;
}

/**
 * Read an adduct: "[M+H]+", "M+Na", "[M-H]-", "[M+2H]2+", "[2M+NH4]+", "[M+H-H2O]+", "[M]+".
 * When the charge isn't written it comes from the ions (M+Na is +1, M−H is −1). Throws with a
 * plain message when the text can't be read.
 */
export function parseAdduct(text: string): Adduct {
  const s = text.replace(/\s+/g, '').replace(/[−–]/g, '-').replace(/[·•]$/, '');
  const m = /^\[?(\d*)M((?:[+-]\d*[A-Za-z][A-Za-z0-9]*)*)\]?(\d*)([+-]?)\.?$/.exec(s);
  if (!m) throw new Error(`"${text}" is not an adduct this program can read. Write it like [M+H]+, [M+Na]+ or [M-H]-.`);
  const n = m[1] ? Number(m[1]) : 1;
  const parts: Adduct['parts'] = [];
  let ionCharge = 0;
  for (const p of m[2].matchAll(/([+-])(\d*)([A-Za-z][A-Za-z0-9]*)/g)) {
    const sign = p[1] === '+' ? 1 : -1;
    const count = p[2] ? Number(p[2]) : 1;
    const mass = formulaMass(p[3]);
    if (mass === null) throw new Error(`"${p[3]}" in ${text} is not a formula this program can weigh.`);
    parts.push({ sign, count, formula: p[3], mass });
    ionCharge += sign * count * (ION_CHARGE[p[3]] ?? 0);
  }
  let z: number;
  if (m[4]) z = (m[3] ? Number(m[3]) : 1) * (m[4] === '+' ? 1 : -1);
  else if (m[3]) throw new Error(`Add + or − after the charge in ${text}.`);
  else z = ionCharge;
  if (z === 0) throw new Error(`${text} has no charge. Write the charge after it, like [M+H]+.`);
  const body = parts.map((p) => `${p.sign > 0 ? '+' : '-'}${p.count > 1 ? p.count : ''}${p.formula}`).join('');
  const label = `[${n > 1 ? n : ''}M${body}]${Math.abs(z) > 1 ? Math.abs(z) : ''}${z > 0 ? '+' : '-'}`;
  return { n, parts, z, label };
}

/** m/z of the ion, from the molecule's monoisotopic mass (as RDKit gives it: atoms only, no electrons). */
export function ionMz(exactMass: number, adduct: Adduct | string): number {
  const a = typeof adduct === 'string' ? parseAdduct(adduct) : adduct;
  let m = a.n * exactMass;
  for (const p of a.parts) m += p.sign * p.count * p.mass;
  m -= a.z * ELECTRON;
  return m / Math.abs(a.z);
}

/** The adducts offered in lists, most used first. */
export const COMMON_ADDUCTS = ['[M+H]+', '[M+Na]+', '[M+K]+', '[M+NH4]+', '[M]+', '[M+2H]2+', '[2M+H]+', '[2M+Na]+', '[M+H-H2O]+', '[M-H]-', '[M+Cl]-', '[M+HCOO]-'];
