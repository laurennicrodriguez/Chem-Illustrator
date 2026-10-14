// Sheet chemistry worked out by RDKit: the properties of a molecule, and substructure search.
// Runs in the chemistry worker (and in tests, with RDKit loaded in Node).

/* eslint-disable @typescript-eslint/no-explicit-any */
import { formulaFromJson } from './formula';
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

