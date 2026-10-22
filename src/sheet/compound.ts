// The Compound data type (Data > Data Types > Compound), as Excel's linked data types work: a
// cell keeps its compound's name as its text, with a card of what PubChem knows about it. A
// formula reads a field of the card with FIELDVALUE(A2,"Molecular weight"), and Insert Data adds
// a column of such formulas beside a column of compounds.

import type { Value } from './values';

/** What a compound cell carries: PubChem's compound number, and its fields as they were looked up. */
export interface CompoundCard {
  cid: number;
  /** The name shown in the cell. */
  name: string;
  fields: Record<string, string | number>;
  /** When the card was looked up (ISO time). */
  looked?: string;
}

/** The fields in the order the card lists them, with a few other names each may be asked for by. */
export const COMPOUND_FIELDS: { name: string; also?: string[]; numeric?: boolean; slow?: boolean }[] = [
  { name: 'Name', also: ['Title'] },
  { name: 'IUPAC name', also: ['IUPACName'] },
  { name: 'Formula', also: ['MolecularFormula', 'Molecular formula'] },
  { name: 'Molecular weight', also: ['MW', 'MolecularWeight', 'Molar mass'], numeric: true },
  { name: 'Exact mass', also: ['ExactMass', 'Monoisotopic mass', 'MonoisotopicMass'], numeric: true },
  { name: 'CAS', also: ['CAS number', 'CAS RN'] },
  { name: 'PubChem CID', also: ['CID'], numeric: true },
  { name: 'SMILES', also: ['IsomericSMILES'] },
  { name: 'InChI' },
  { name: 'InChIKey' },
  { name: 'XLogP', also: ['logP', 'cLogP'], numeric: true },
  { name: 'TPSA', also: ['Polar surface area'], numeric: true },
  { name: 'H-bond donors', also: ['HBondDonorCount', 'HBD'], numeric: true },
  { name: 'H-bond acceptors', also: ['HBondAcceptorCount', 'HBA'], numeric: true },
  { name: 'Rotatable bonds', also: ['RotatableBondCount'], numeric: true },
  { name: 'Heavy atoms', also: ['HeavyAtomCount'], numeric: true },
  { name: 'Charge', numeric: true },
  { name: 'Complexity', numeric: true },
  { name: 'Melting point', also: ['MP', 'mp'], slow: true },
  { name: 'Boiling point', also: ['BP', 'bp'], slow: true },
  { name: 'Density', slow: true },
  { name: 'GHS signal', also: ['Signal word'], slow: true },
  { name: 'Hazard statements', also: ['H statements', 'Hazards'], slow: true },
  { name: 'PubChem page', also: ['URL', 'Link'] },
];

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
const BY_NAME = new Map<string, string>();
for (const f of COMPOUND_FIELDS) for (const n of [f.name, ...(f.also ?? [])]) BY_NAME.set(squash(n), f.name);

/** The card's own name for a field asked for ("mw", "Molecular Weight" → "Molecular weight"); null when there is no such field. */
export function fieldName(asked: string): string | null {
  return BY_NAME.get(squash(asked)) ?? null;
}

/** A field of a compound's card: undefined when the card doesn't have it. */
export function fieldValue(card: CompoundCard, asked: string): Value | undefined {
  const name = fieldName(asked);
  if (!name) return undefined;
  const v = card.fields[name];
  return v === undefined || v === '' ? undefined : v;
}

/** The fields this card has, in the card's order (for Insert Data and the card). */
export function cardFields(card: CompoundCard): [string, string | number][] {
  return COMPOUND_FIELDS.filter((f) => card.fields[f.name] !== undefined && card.fields[f.name] !== '').map((f) => [f.name, card.fields[f.name]]);
}

/** Is this a card as saved (from a file, which may have been changed by hand)? */
export function isCard(x: unknown): x is CompoundCard {
  const c = x as CompoundCard;
  return !!c && typeof c === 'object' && typeof c.cid === 'number' && typeof c.name === 'string' && !!c.fields && typeof c.fields === 'object';
}
