// Molecular formula in Hill order from RDKit's JSON output.

import { SYMBOLS } from './elements';

/** Hill-order formula (carbon, hydrogen, then alphabetical; alphabetical if no carbon) and net charge. */
export function formulaFromJson(json: string): { formula: string; charge: number } {
  const j = JSON.parse(json);
  const defs = j.defaults?.atom ?? {};
  const mol = j.molecules[0];
  const counts = new Map<string, number>();
  let charge = 0;
  const bump = (s: string, n: number) => counts.set(s, (counts.get(s) ?? 0) + n);
  for (const a of mol.atoms) {
    const z = a.z ?? defs.z ?? 6;
    const h = a.impHs ?? defs.impHs ?? 0;
    charge += a.chg ?? 0;
    if (h) bump('H', h);
    if (z === 0) continue; // R groups and other "any atom" labels are left out
    bump(z === 1 && a.isotope === 2 ? 'D' : SYMBOLS[z] ?? '?', 1);
  }
  const keys = [...counts.keys()];
  const hasC = counts.has('C');
  keys.sort((x, y) => {
    if (hasC) {
      const r = (s: string) => (s === 'C' ? 0 : s === 'H' ? 1 : 2);
      if (r(x) !== r(y)) return r(x) - r(y);
    }
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let formula = keys.map((k) => k + (counts.get(k)! > 1 ? counts.get(k) : '')).join('');
  if (charge) formula += (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '−');
  return { formula, charge };
}

/** Element counts from RDKit's JSON output (explicit and implicit hydrogens together; D kept apart). */
export function countsFromJson(json: string): Record<string, number> {
  const j = JSON.parse(json);
  const defs = j.defaults?.atom ?? {};
  const out: Record<string, number> = {};
  const bump = (s: string, n: number) => { out[s] = (out[s] ?? 0) + n; };
  for (const a of j.molecules[0].atoms) {
    const z = a.z ?? defs.z ?? 6;
    const h = a.impHs ?? defs.impHs ?? 0;
    if (h) bump('H', h);
    if (z === 0) continue;
    bump(z === 1 && a.isotope === 2 ? 'D' : SYMBOLS[z] ?? '?', 1);
  }
  return out;
}

/** A formula in Hill order from element counts, with the charge after it (C7H7O, NH4+). */
export function hillFormula(counts: Record<string, number>, charge = 0): string {
  const keys = Object.keys(counts).filter((k) => counts[k] > 0);
  const hasC = keys.includes('C');
  keys.sort((x, y) => {
    if (hasC) {
      const r = (s: string) => (s === 'C' ? 0 : s === 'H' ? 1 : 2);
      if (r(x) !== r(y)) return r(x) - r(y);
    }
    return x < y ? -1 : x > y ? 1 : 0;
  });
  let formula = keys.map((k) => k + (counts[k] > 1 ? counts[k] : '')).join('');
  if (charge) formula += (Math.abs(charge) > 1 ? Math.abs(charge) : '') + (charge > 0 ? '+' : '−');
  return formula;
}
