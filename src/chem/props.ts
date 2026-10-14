// Sheet chemistry worked out by RDKit: the properties of a molecule, and substructure search.
// Runs in the chemistry worker (and in tests, with RDKit loaded in Node).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { formulaFromJson, countsFromJson, hillFormula } from './formula';
import { SYMBOLS } from './elements';
import { joback, type JobackResult } from './analysis';
import type { MolProps } from '../sheet/properties';

/** Everything a sheet works out for one molecule (see src/sheet/properties.ts for the definitions). */
export function molProps(RDKit: any, input: string): MolProps | { error: string } {
  let mol: any = null;
  try {
    mol = RDKit.get_mol(input);
  } catch {
    mol = null;
  }
  if (!mol || !mol.is_valid()) {
    mol?.delete?.();
    return { error: input.includes('M  END') ? 'Could not read this structure (check valences).' : 'Not a structure or a SMILES string.' };
  }
  try {
    const { formula, charge } = formulaFromJson(mol.get_json());
    const d = JSON.parse(mol.get_descriptors());
    let inchikey = '';
    try {
      const inchi = mol.get_inchi();
      if (inchi) inchikey = RDKit.get_inchikey_for_inchi(inchi);
    } catch {
      inchikey = '';
    }
    return {
      formula, charge, mw: d.amw, exact: d.exactmw, smiles: mol.get_smiles(), inchikey,
      clogp: d.CrippenClogP, tpsa: d.tpsa, hbd: d.lipinskiHBD, hba: d.lipinskiHBA, rotb: d.NumRotatableBonds,
    };
  } finally {
    mol.delete();
  }
}

/**
 * Substructure search, as a drawn query is usually meant: the query's atoms, bonds, charges and
 * rings must all be there, and anything may be attached to them. The query is written as SMILES
 * and read back as SMARTS, so its implicit hydrogens become open places.
 */
export function substructureMatches(RDKit: any, query: string, mols: string[]): { results: (boolean | null)[]; error?: string } {
  const qm = RDKit.get_mol(query);
  if (!qm || !qm.is_valid()) { qm?.delete?.(); return { results: mols.map(() => null), error: 'Could not read the structure searched for.' }; }
  const smarts = qm.get_smiles();
  qm.delete();
  const q = RDKit.get_qmol(smarts);
  if (!q || !q.is_valid()) { q?.delete?.(); return { results: mols.map(() => null), error: 'Could not search for this structure.' }; }
  try {
    return {
      results: mols.map((input) => {
        let mol: any = null;
        try {
          mol = RDKit.get_mol(input);
          if (!mol || !mol.is_valid()) return null;
          return mol.get_substruct_match(q) !== '{}';
        } catch {
          return null;
        } finally {
          mol?.delete?.();
        }
      }),
    };
  } finally {
    q.delete();
  }
}


/** What the Analysis panel shows for one structure, besides formula and masses. */
export interface PanelProps {
  /** Element counts (H includes drawn and implied hydrogens). */
  counts: Record<string, number>;
  /** Standard atomic weight of each element present, as the chemistry engine uses them. */
  weights: Record<string, number>;
  clogp: number;
  mr: number;
  tpsa: number;
  hbd: number;
  hba: number;
  rotb: number;
  heavy: number;
  fsp3: number;
  joback: JobackResult;
}

const weightCache = new Map<string, number>();

/** Standard atomic weight of an element (D: deuterium's mass). */
export function atomicWeight(RDKit: any, el: string): number | undefined {
  if (weightCache.has(el)) return weightCache.get(el);
  const m = RDKit.get_mol(el === 'D' ? '[2H]' : `[${el}]`);
  if (!m || !m.is_valid()) { m?.delete?.(); return undefined; }
  try {
    const w = JSON.parse(m.get_descriptors()).amw as number;
    weightCache.set(el, w);
    return w;
  } finally {
    m.delete();
  }
}

/** The extra properties of a molecule (a molfile or SMILES) for the Analysis panel. */
export function panelProps(RDKit: any, mol: any): PanelProps {
  const json = mol.get_json();
  const d = JSON.parse(mol.get_descriptors());
  const counts = countsFromJson(json);
  const weights: Record<string, number> = {};
  for (const el of Object.keys(counts)) {
    const w = atomicWeight(RDKit, el);
    if (w !== undefined) weights[el] = w;
  }
  let jb: JobackResult;
  try {
    jb = joback(json);
  } catch (e) {
    jb = { tb: null, tm: null, groups: {}, missing: String(e) };
  }
  return {
    counts, weights, clogp: d.CrippenClogP, mr: d.CrippenMR, tpsa: d.tpsa, hbd: d.lipinskiHBD, hba: d.lipinskiHBA,
    rotb: d.NumRotatableBonds, heavy: d.NumHeavyAtoms, fsp3: d.FractionCSP3, joback: jb,
  };
}

export interface MassFragment {
  /** Molfile atoms (0-based) in this piece. */
  atoms: number[];
  formula: string;
  /** Element counts of the piece. */
  counts: Record<string, number>;
  exact: number;
  mw: number;
  /** The piece has R groups or other atoms that can't be weighed (left out of the numbers). */
  partial?: boolean;
}

/**
 * Mass fragmentation: the pieces a structure falls into when the given bonds (pairs of molfile
 * atoms) are broken, each with its formula and masses. Every atom keeps the hydrogens it has in the
 * whole molecule, so the pieces are the radicals a bond's breaking leaves, as in ChemDraw's tool.
 * Only pieces next to a broken bond are returned.
 */
export function massFragments(RDKit: any, molblock: string, cuts: [number, number][]): MassFragment[] | { error: string } {
  const mol = RDKit.get_mol(molblock);
  if (!mol || !mol.is_valid()) { mol?.delete?.(); return { error: 'Could not read this structure (check valences).' }; }
  let j: any;
  try {
    j = JSON.parse(mol.get_json());
  } finally {
    mol.delete();
  }
  const defs = j.defaults ?? {};
  const atoms: any[] = j.molecules[0].atoms;
  const n = atoms.length;
  const cut = new Set(cuts.map(([a, b]) => (a < b ? `${a},${b}` : `${b},${a}`)));
  const adj: number[][] = Array.from({ length: n }, () => []);
  for (const b of j.molecules[0].bonds) {
    const [p, q] = b.atoms as [number, number];
    if (cut.has(p < q ? `${p},${q}` : `${q},${p}`)) continue;
    adj[p].push(q);
    adj[q].push(p);
  }
  const seen = new Set<number>();
  const out: MassFragment[] = [];
  for (const start of cuts.flat()) {
    if (seen.has(start) || start >= n) continue;
    const piece: number[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const a = stack.pop()!;
      piece.push(a);
      for (const b of adj[a]) if (!seen.has(b)) { seen.add(b); stack.push(b); }
    }
    piece.sort((a, b) => a - b);
    const counts: Record<string, number> = {};
    const parts: string[] = [];
    let charge = 0;
    let partial = false;
    for (const i of piece) {
      const a = atoms[i];
      const z = a.z ?? defs.atom?.z ?? 6;
      const h = a.impHs ?? defs.atom?.impHs ?? 0;
      const c = a.chg ?? 0;
      const iso = a.isotope ?? 0;
      charge += c;
      if (z === 0) { partial = true; continue; }
      const sym = SYMBOLS[z];
      const key = z === 1 && iso === 2 ? 'D' : sym;
      counts[key] = (counts[key] ?? 0) + 1;
      if (h) counts.H = (counts.H ?? 0) + h;
      parts.push(`[${iso || ''}${sym}${h ? 'H' + h : ''}${c ? (c > 0 ? '+' : '-') + Math.abs(c) : ''}]`);
    }
    let exact = 0, mw = 0;
    if (parts.length) {
      const m = RDKit.get_mol(parts.join('.'));
      if (m && m.is_valid()) {
        const d = JSON.parse(m.get_descriptors());
        exact = d.exactmw;
        mw = d.amw;
      }
      m?.delete?.();
    }
    out.push({ atoms: piece, formula: hillFormula(counts, charge), counts, exact, mw, partial: partial || undefined });
  }
  return out;
}
