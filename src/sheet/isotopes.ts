// The isotope pattern of an ion in a sheet: ISOMZ(B2,"[M+H]+",2) is the m/z of the M+2 peak of
// the [M+H]+ ion of the structure in B2, and ISOABUND(B2,"[M+H]+",2) its height as a % of the
// tallest peak. The structure can be a drawn structure, SMILES, or a molecular formula
// (C10H12N2O), so a pattern can be worked out for a compound that hasn't been drawn.
//
// The pattern is the one the Analysis panel shows (src/chem/analysis.ts): isotopologues one mass
// unit apart are summed into one peak at their mean m/z, as a mass spectrometer shows them.

import { isotopePattern, ionCounts, formulaCounts, ISOTOPES, type IsotopePeak } from '../chem/analysis';
import { parseAdduct, type Adduct } from '../chem/hrms';
import { withoutCharge } from '../chem/formula';
import { CellError, ERR, type Value } from './values';
import type { MolProps } from './properties';

export const ISOTOPE_FUNCTIONS: Record<string, { label: string; help: string }> = {
  ISOMZ: { label: 'Isotope peak m/z', help: 'm/z of a peak of the isotope pattern: ISOMZ(B2,"[M+H]+",2) for M+2. B2 can be a structure, SMILES or a formula such as C10H12N2O' },
  ISOABUND: { label: 'Isotope peak height (%)', help: 'Height of a peak of the isotope pattern as % of the tallest: ISOABUND(B2,"[M+H]+",2)' },
};

/**
 * Does this text read as a molecular formula rather than SMILES? A formula names each element
 * once, with counts (CO2, C10H12N2O, CH2Cl2, C8H11N4O2+), so SMILES such as CCO or C1CCCCC1
 * (which repeat an element) are left as SMILES. A formula needs a number or an H in it, so CN
 * and CO stay SMILES too.
 */
export function readsAsFormula(text: string): boolean {
  const t = text.trim();
  const m = /^((?:[A-Z][a-z]?\d*)+)(\s+\d+)?([+\-−])?$/.exec(t);
  if (!m) return false;
  const seen = new Set<string>();
  for (const g of m[1].matchAll(/([A-Z][a-z]?)(\d*)/g)) {
    if (seen.has(g[1]) || !ISOTOPES[g[1]]) return false;
    seen.add(g[1]);
  }
  return /\d/.test(m[1]) || seen.has('H');
}

/**
 * The element counts of a formula and its charge: C8H11N4O2+ is +1, C4H12N2 2+ (a space before a
 * charge bigger than one) is +2.
 */
export function formulaWithCharge(text: string): { counts: Map<string, number>; charge: number } | null {
  const m = /^(.*?)(?:\s+(\d+))?([+-])?$/.exec(text.trim().replace(/[−–]/g, '-'));
  if (!m) return null;
  const counts = formulaCounts(m[1].trim());
  if (!counts) return null;
  return { counts, charge: m[3] ? (m[3] === '+' ? 1 : -1) * (m[2] ? Number(m[2]) : 1) : 0 };
}

/** The molecule an isotope function was given: a structure's properties, or a formula. */
export type IsotopeSource = { mol: MolProps } | { formula: string };

const kept = new Map<string, IsotopePeak[] | null>();

/**
 * The isotope peaks of an ion, by nominal mass: entry k is the M+k peak (undefined where there is
 * none). A molecule that already has a charge is its own ion ([M]+), whatever adduct is asked for.
 */
export function ionPeaks(src: IsotopeSource, adductText: string): { peaks: (IsotopePeak | undefined)[]; adduct: Adduct } | CellError {
  let counts: Map<string, number> | null, charge: number;
  if ('mol' in src) {
    // the formula ends with its charge (C4H12N22+ for a dication, C8H11N4O2+ for a cation), so drop
    // exactly that: the count before a single + belongs to the last element
    counts = formulaCounts(withoutCharge(src.mol.formula, src.mol.charge));
    charge = src.mol.charge;
  } else {
    const f = formulaWithCharge(src.formula);
    if (!f) return ERR.value(`"${src.formula}" is not a formula this program can read`);
    counts = f.counts;
    charge = f.charge;
  }
  if (!counts) return ERR.value('This structure has atoms the isotope pattern can\'t weigh');
  let adduct: Adduct;
  if (charge) adduct = { n: 1, parts: [], z: charge, label: `[M]${Math.abs(charge) > 1 ? Math.abs(charge) : ''}${charge > 0 ? '+' : '-'}` };
  else {
    try {
      adduct = parseAdduct(adductText.trim() || '[M+H]+');
    } catch (e) {
      return ERR.value((e as Error).message);
    }
  }
  const ion = ionCounts(counts, adduct);
  if (!ion) return ERR.value(`${adduct.label} takes away more atoms than the molecule has`);
  const key = [...ion].sort().map(([e, n]) => `${e}${n}`).join('') + `|${adduct.z}`;
  let list = kept.get(key);
  if (list === undefined) {
    list = isotopePattern(ion, adduct.z, 0);
    if (kept.size > 2000) kept.clear();
    kept.set(key, list);
  }
  if (!list) return ERR.value('This structure has an element the isotope pattern doesn\'t know');
  // place each peak at its nominal offset from the first (z = 2: half a unit of m/z apart)
  const peaks: (IsotopePeak | undefined)[] = [];
  const first = list[0]?.mz ?? 0;
  for (const p of list) peaks[Math.round((p.mz - first) * Math.abs(adduct.z))] = p;
  return { peaks, adduct };
}

/** ISOMZ or ISOABUND of a molecule: "" past the end of the pattern. */
export function isotopeValue(name: string, src: IsotopeSource, adductText: string, k: number): Value | CellError {
  if (!Number.isInteger(k) || k < 0) return ERR.value(`The peak is a whole number: 0 for M, 1 for M+1, 2 for M+2…`);
  const got = ionPeaks(src, adductText);
  if ('code' in got) return got;
  const p = got.peaks[k];
  if (!p) return '';
  return name === 'ISOMZ' ? p.mz : p.rel;
}

/**
 * The peaks worth listing, by nominal offset: those at least `min` % of the tallest, and every peak
 * between them (so a list of M, M+1, M+2… has no gaps).
 */
export function listedPeaks(src: IsotopeSource, adductText: string, min = 0.5): number[] | CellError {
  const got = ionPeaks(src, adductText);
  if ('code' in got) return got;
  let last = -1;
  got.peaks.forEach((p, k) => { if (p && p.rel >= min) last = k; });
  const out: number[] = [];
  for (let k = 0; k <= last; k++) out.push(k);
  return out;
}

/** A peak's name: M, M+1, M+2… */
export const peakName = (k: number): string => (k ? `M+${k}` : 'M');
