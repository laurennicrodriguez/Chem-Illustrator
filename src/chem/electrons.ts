// Electron counting for metal complexes (Analysis panel): each ligand sorted into L (gives two
// electrons), X (shares one) or Z (takes two) as in Green's covalent bond classification
// (J. Organomet. Chem. 1995, 500, 127), and from that the metal's oxidation state, its dⁿ count
// and the complex's electron count (18 for a closed shell):
//   oxidation state = x + q,  dⁿ = m − oxidation state,  electrons = m + 2l + x − q
// where m is the metal's group number and q the complex's charge. The neutral (covalent) and
// ionic ways of counting give the same totals; they only split them differently (an X ligand is
// one electron from a neutral radical, or two from an anion on an oxidised metal), so both are
// shown for each ligand.

import { Doc, isMetalAtom, outsideValence, radicalElectrons, type Atom, type Bond } from '../model';
import { SYMBOLS, elementNumber, lowestValence, tablePosition, valenceOfBonds } from './elements';
import { labelDonates, labelGraph } from './labels';
import { metalCarbonyl } from './hapto';

export type LigandKind = 'L' | 'X' | 'Z' | 'M–M';

export interface LigandCount {
  /** How the ligand is named in the breakdown: its label, its donor atom, or ηⁿ and its atoms. */
  name: string;
  l: number;
  x: number;
  z: number;
  /** Metal–metal bonds (each gives each metal one electron and doesn't change oxidation states). */
  mm: number;
  /** Electrons it gives counted neutral (covalent) and ionic. */
  neutral: number;
  ionic: number;
  /** The ηⁿ of a ligand bonded through its middle. */
  hapto?: number;
  /** How many such ligands (rows with the same name and class are put together). */
  count: number;
}

export interface MetalCount {
  metal: number;
  symbol: string;
  /** Group number (electrons of the neutral metal atom). */
  group: number;
  l: number;
  x: number;
  z: number;
  mm: number;
  /** The charge counted against this metal (the complex's charge, shared out between its metals). */
  charge: number;
  oxidation: number;
  dn: number;
  electrons: number;
  ligands: LigandCount[];
  /** The covalent bond classification, ML₃X and so on (with its charge). */
  classification: string;
  /** Why the count may be off (a metal label with ligands written in it that weren't understood). */
  notes: string[];
}

/** Ligand labels whose class is not simply one L or one X: π ligands and chelates written as labels. */
const LABEL_CLASS: Record<string, { l: number; x: number; hapto?: number }> = {
  Cp: { l: 2, x: 1, hapto: 5 }, 'Cp*': { l: 2, x: 1, hapto: 5 }, Ind: { l: 2, x: 1, hapto: 5 },
  COD: { l: 2, x: 0 }, cod: { l: 2, x: 0 }, NBD: { l: 2, x: 0 }, nbd: { l: 2, x: 0 },
  C6H6: { l: 3, x: 0, hapto: 6 }, 'p-cymene': { l: 3, x: 0, hapto: 6 }, C6Me6: { l: 3, x: 0, hapto: 6 },
  dppm: { l: 2, x: 0 }, dppe: { l: 2, x: 0 }, dppp: { l: 2, x: 0 }, dppb: { l: 2, x: 0 }, dppf: { l: 2, x: 0 },
  BINAP: { l: 2, x: 0 }, Xantphos: { l: 2, x: 0 }, bpy: { l: 2, x: 0 }, bipy: { l: 2, x: 0 }, phen: { l: 2, x: 0 },
  tmeda: { l: 2, x: 0 }, TMEDA: { l: 2, x: 0 }, en: { l: 2, x: 0 }, DME: { l: 2, x: 0 }, dme: { l: 2, x: 0 },
  acac: { l: 1, x: 1 }, hfac: { l: 1, x: 1 },
};

/** The group number of a d-block (or s- or p-block) metal; f-block metals aren't counted. */
export function groupNumber(z: number): number | null {
  const p = tablePosition(z);
  if (!p || p.row > 7) return null;
  return p.col;
}

/** The atoms bonded to `id` (through ordinary bonds and through a ring's middle). */
function neighbours(doc: Doc, id: number): number[] {
  const out: number[] = [];
  for (const bid of doc.adj.get(id) ?? []) { const b = doc.bonds.get(bid)!; out.push(b.a1 === id ? b.a2 : b.a1); }
  const a = doc.atoms.get(id);
  for (const m of [...(a?.multi ?? []), ...(doc.centresOf.get(id) ?? [])]) out.push(m);
  return out;
}

/** An N-heterocyclic carbene's carbon: two single bonds to N and one to the metal (it gives a lone pair). */
function nhcCarbon(doc: Doc, a: Atom, metalBonds: Bond[]): boolean {
  if (a.z !== 6 || a.label || a.charge || a.radical || metalBonds.length !== 1) return false;
  const rest = (doc.adj.get(a.id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => b !== metalBonds[0]);
  return rest.length === 2 && rest.every((b) => b.order === 1 && doc.atoms.get(b.a1 === a.id ? b.a2 : b.a1)?.z === 7);
}

/** Subscript digits (and n) for the classification and the names. */
const SUB: Record<string, string> = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const SUP: Record<string, string> = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻' };
const sub = (n: number) => String(n).replace(/\d/g, (d) => SUB[d]);
export const sup = (s: string | number) => String(s).replace(/[\d+\-−]/g, (d) => SUP[d]);

/** Oxidation states written as Roman numerals, as in Pd(II); 0 as 0, negative ones with a minus. */
export function roman(n: number): string {
  if (n === 0) return '0';
  const sign = n < 0 ? '−' : '';
  let v = Math.abs(n), out = '';
  for (const [k, r] of [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']] as [number, string][]) while (v >= k) { out += r; v -= k; }
  return sign + out;
}

/**
 * Formula-style metal labels with their ligands written in (PdCl2, Pd(PPh3)4, RhCl(PPh3)3): the
 * metal and its ligands, or null when the label isn't one metal followed by ligands.
 */
function metalLabelParts(label: string): { z: number; ligands: string[] } | null {
  const m = /^([A-Z][a-z]?)(.*)$/.exec(label.trim());
  if (!m) return null;
  const z = elementNumber(m[1]);
  if (z === undefined) return null;
  const ligands: string[] = [];
  const re = /\(([^()]+)\)(\d*)|([A-Z][a-z]?)(\d*)/y;
  let rest = m[2];
  // L and Ln written before the metal ("LnPd") aren't counted
  while (rest.length) {
    re.lastIndex = 0;
    const t = re.exec(rest);
    if (!t) return null;
    const name = t[1] ?? t[3];
    const n = Number(t[2] || t[4] || 1);
    for (let k = 0; k < n; k++) ligands.push(name);
    rest = rest.slice(t[0].length);
  }
  return { z, ligands };
}

/** The class of a ligand written as a label, bonded to the metal by one bond of `order`. */
function labelClass(label: string, order: number, others: number): { l: number; x: number; hapto?: number } {
  const known = LABEL_CLASS[label];
  if (known) return known;
  if (labelDonates(label, others)) return { l: 1, x: 0 };
  return { l: 0, x: order };
}

/** How many electrons a ligand gives, counted neutral and ionic. */
function electronsOf(l: number, x: number): { neutral: number; ionic: number } {
  return { neutral: 2 * l + x, ionic: 2 * l + 2 * x };
}

/**
 * Count the electrons of every metal in the structure containing `atomId`. Metals of the f-block,
 * and "M" or other labels that don't name one metal, are left out.
 */
export function countElectrons(doc: Doc, atomId: number): MetalCount[] {
  const frag = doc.fragmentOf(atomId);
  const metals = [...frag].filter((id) => isMetalAtom(doc.atoms.get(id))).sort((a, b) => a - b);
  if (!metals.length) return [];
  const isMetalId = new Set(metals);

  // the complex's charges, each counted against the nearest metal (fewest bonds away)
  const share = new Map<number, number>(metals.map((m) => [m, 0]));
  const near = new Map<number, number>();
  const queue: [number, number][] = metals.map((m) => [m, m]);
  for (const m of metals) near.set(m, m);
  while (queue.length) {
    const [id, m] = queue.shift()!;
    for (const n of neighbours(doc, id)) {
      if (near.has(n) || !frag.has(n)) continue;
      near.set(n, m);
      queue.push([n, m]);
    }
  }
  for (const id of frag) {
    const a = doc.atoms.get(id)!;
    if (a.charge && near.has(id)) share.set(near.get(id)!, share.get(near.get(id)!)! + a.charge);
  }

  const rows = new Map<number, LigandCount[]>(metals.map((m) => [m, []]));
  const add = (metal: number, row: Omit<LigandCount, 'neutral' | 'ionic' | 'count' | 'mm'> & { mm?: number }) => {
    const e = electronsOf(row.l, row.x);
    rows.get(metal)!.push({ mm: 0, ...row, neutral: e.neutral + (row.mm ?? 0), ionic: e.ionic + (row.mm ?? 0), count: 1 });
  };
  const xSoFar = new Map<number, number>(metals.map((m) => [m, 0]));
  const notes = new Map<number, string[]>(metals.map((m) => [m, []]));

  // ligands written into a metal's own label (PdCl2, Pd(PPh3)4)
  const groups = new Map<number, number>();
  for (const m of metals) {
    const a = doc.atoms.get(m)!;
    let z = a.z;
    if (a.label) {
      const parts = metalLabelParts(a.label);
      if (!parts) { notes.get(m)!.push(`The label ${a.label} isn't read for its ligands.`); continue; }
      z = parts.z;
      for (const lig of parts.ligands) {
        const c = labelClass(lig, 1, 0);
        add(m, { name: lig, l: c.l, x: c.x, z: 0, hapto: c.hapto });
        xSoFar.set(m, xSoFar.get(m)! + c.x);
      }
    }
    const g = groupNumber(z);
    if (g !== null) groups.set(m, g);
  }

  // bonds to the metals, atom by atom (in order, so a bridging ligand's X goes to the metal with fewest so far)
  const donors = [...frag].filter((id) => !isMetalId.has(id)).sort((a, b) => a - b);
  for (const id of donors) {
    const a = doc.atoms.get(id)!;
    const all = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!);
    const toMetal = all.filter((b) => isMetalId.has(b.a1 === id ? b.a2 : b.a1));
    if (!toMetal.length) continue;
    const metalOf = (b: Bond) => (b.a1 === id ? b.a2 : b.a1);

    // a ring or π-bond bonded through its middle: ηⁿ, X for an odd number of atoms, then L for each pair
    if (a.multi) {
      const n = a.multi.length;
      const name = `η${sup(n)}-${n === 2 ? 'alkene' : n === 3 ? 'allyl' : n === 5 ? 'C₅ ring' : n === 6 ? 'arene' : `C${sub(n)}`}`;
      for (const b of toMetal) add(metalOf(b), { name, l: Math.floor(n / 2), x: n % 2, z: 0, hapto: n });
      continue;
    }
    // dative bonds: drawn from the atom giving the pair to the one taking it
    const plain = toMetal.filter((b) => !outsideValence(b));
    for (const b of toMetal) {
      if (b.display !== 'dative') continue;
      const m = metalOf(b);
      const name = a.label ?? SYMBOLS[a.z] ?? '?';
      if (b.a2 === m) add(m, { name, l: 1, x: 0, z: 0 });
      else add(m, { name: `${name} (acceptor)`, l: 0, x: 0, z: 1 });
    }
    if (!plain.length) continue;

    // X as far as the atom has room for bonds, then L (a bridging Cl: X to one metal, L to the other);
    // the metals with fewest X so far get the X first
    const share1 = (name: string, room: number, bonds: Bond[]) => {
      const order = [...bonds].sort((p, q) => xSoFar.get(metalOf(p))! - xSoFar.get(metalOf(q))! || metalOf(p) - metalOf(q));
      let left = room;
      for (const b of order) {
        const m = metalOf(b);
        if (left >= b.order) {
          left -= b.order;
          add(m, { name: b.order === 3 ? `≡${name}` : b.order === 2 ? `=${name}` : name, l: 0, x: b.order, z: 0 });
          xSoFar.set(m, xSoFar.get(m)! + b.order);
        } else add(m, { name, l: 1, x: 0, z: 0 });
      }
    };

    if (a.label) {
      const others = all.filter((b) => !outsideValence(b) && !toMetal.includes(b)).reduce((s, b) => s + b.order, 0);
      const known = LABEL_CLASS[a.label];
      if (known) {
        for (const b of plain) { add(metalOf(b), { name: a.label, ...known, z: 0 }); xSoFar.set(metalOf(b), xSoFar.get(metalOf(b))! + known.x); }
        continue;
      }
      if (labelDonates(a.label, others)) { for (const b of plain) add(metalOf(b), { name: a.label, l: 1, x: 0, z: 0 }); continue; }
      const g = labelGraph(a.label, 0);
      const head = g?.atoms[0];
      const low = head && !head.dummy ? lowestValence(head.z, (head.charge ?? 0) + a.charge) : undefined;
      const inner = g ? valenceOfBonds(g.bonds.filter((x) => x.a === 0 || x.b === 0).map((x) => x.order), head?.z) + (head?.hCount ?? 0) : 0;
      const room = low === undefined ? plain.reduce((s, b) => s + b.order, 0) : Math.max(0, low - inner - others);
      share1(a.label, room, plain);
      continue;
    }
    // a carbonyl carbon or an N-heterocyclic carbene gives a lone pair
    const carbonyl = a.z === 6 && all.some((b) => b.order === 3 && metalCarbonyl(doc, doc.atoms.get(b.a1 === id ? b.a2 : b.a1)!) !== null);
    if (carbonyl || nhcCarbon(doc, a, plain)) {
      for (const b of plain) add(metalOf(b), { name: carbonyl ? 'CO' : 'NHC', l: 1, x: 0, z: 0 });
      continue;
    }
    // as many bonds as the atom has room for are X (shared), the rest L (a lone pair given)
    let own = 0;
    for (const b of all) if (!outsideValence(b) && !toMetal.includes(b)) own += b.order;
    const room = Math.max(0, doc.valenceSum(id) - own - radicalElectrons(a));
    share1(SYMBOLS[a.z] ?? '?', room, plain);
  }

  // metal–metal bonds: each metal gets one electron per bond
  for (const m of metals) {
    for (const bid of doc.adj.get(m) ?? []) {
      const b = doc.bonds.get(bid)!;
      const other = b.a1 === m ? b.a2 : b.a1;
      if (!isMetalId.has(other) || b.display === 'dative') continue;
      const o = doc.atoms.get(other)!;
      add(m, { name: `${o.label ?? SYMBOLS[o.z]} (metal–metal)`, l: 0, x: 0, z: 0, mm: b.order === 1.5 ? 1 : b.order });
    }
  }

  const out: MetalCount[] = [];
  for (const m of metals) {
    const group = groups.get(m);
    if (group === undefined) continue;
    const a = doc.atoms.get(m)!;
    // the same ligand more than once goes on one row
    const merged: LigandCount[] = [];
    for (const r of rows.get(m)!) {
      const same = merged.find((x) => x.name === r.name && x.l === r.l && x.x === r.x && x.z === r.z && x.mm === r.mm && x.hapto === r.hapto);
      if (same) same.count++;
      else merged.push({ ...r });
    }
    const l = merged.reduce((s, r) => s + r.l * r.count, 0);
    const x = merged.reduce((s, r) => s + r.x * r.count, 0);
    const z = merged.reduce((s, r) => s + r.z * r.count, 0);
    const mm = merged.reduce((s, r) => s + r.mm * r.count, 0);
    const q = share.get(m)!;
    const oxidation = x + q;
    const symbol = a.label ? (metalLabelParts(a.label) ? SYMBOLS[metalLabelParts(a.label)!.z] : a.label) : SYMBOLS[a.z];
    const cls = `M${l ? 'L' + (l > 1 ? sub(l) : '') : ''}${x ? 'X' + (x > 1 ? sub(x) : '') : ''}${z ? 'Z' + (z > 1 ? sub(z) : '') : ''}`;
    out.push({
      metal: m, symbol, group, l, x, z, mm, charge: q, oxidation, dn: group - oxidation,
      electrons: group + 2 * l + x + mm - q, ligands: merged,
      classification: q ? `[${cls}]${sup(Math.abs(q) > 1 ? Math.abs(q) : '')}${q > 0 ? '⁺' : '⁻'}` : cls,
      notes: notes.get(m)!,
    });
  }
  return out;
}
