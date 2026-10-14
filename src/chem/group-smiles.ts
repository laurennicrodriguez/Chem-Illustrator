// A drawn group written as SMILES, starting at the atom where it joins the rest of the
// structure, for nicknames of the person's own and contracted labels.

import type { Doc } from '../model';
import { SYMBOLS } from './elements';
import { kekulize, labelGraph, type MiniGraph } from './labels';

/** Atoms written without brackets when they have no charge, isotope or fixed hydrogens. */
const PLAIN = new Set(['B', 'C', 'N', 'O', 'P', 'S', 'F', 'Cl', 'Br', 'I']);

/** The group as a small graph, first atom `start`; labels on its end atoms (OMe, Ph) are opened up. */
export function groupGraph(doc: Doc, ids: Set<number>, start: number): MiniGraph | null {
  const g: MiniGraph = { atoms: [], bonds: [] };
  const index = new Map<number, number>();
  const order = [start, ...[...ids].filter((id) => id !== start)];
  for (const id of order) {
    const a = doc.atoms.get(id);
    if (!a || a.attach) return null;
    index.set(id, g.atoms.length);
    if (a.label) {
      // a label inside the group: its own atoms, joined where the label's first atom is
      const inner = doc.neighbors(id).filter((n) => ids.has(n.id)).length + (id === start ? 1 : 0);
      const lg = labelGraph(a.label, inner);
      if (!lg) return null;
      const base = g.atoms.length;
      g.atoms.push(...lg.atoms.map((m) => ({ ...m })));
      g.bonds.push(...lg.bonds.map((b) => ({ a: b.a + base, b: b.b + base, order: b.order })));
    } else {
      g.atoms.push({ z: a.z, charge: a.charge, aromatic: false, dummy: a.z === 0, iso: a.isotope || undefined });
    }
  }
  for (const b of doc.bonds.values()) {
    if (!ids.has(b.a1) || !ids.has(b.a2) || b.display === 'dative') continue;
    g.bonds.push({ a: index.get(b.a1)!, b: index.get(b.a2)!, order: b.order === 4 ? 1 : b.order });
  }
  return g;
}

/** SMILES for a small graph, starting at its first atom (aromatic bonds written as double and single). */
export function graphSmiles(g: MiniGraph): string {
  const bonds = kekulize(g);
  const nbrs = g.atoms.map(() => [] as { to: number; order: number; bond: number }[]);
  bonds.forEach((b, i) => { nbrs[b.a].push({ to: b.b, order: b.order, bond: i }); nbrs[b.b].push({ to: b.a, order: b.order, bond: i }); });
  const seen = new Set<number>();
  const treeBonds = new Set<number>();
  // first pass: which bonds close rings
  const visit = (i: number) => {
    seen.add(i);
    for (const n of nbrs[i]) if (!seen.has(n.to)) { treeBonds.add(n.bond); visit(n.to); }
  };
  visit(0);
  const ringNum = new Map<number, number>();
  let nextRing = 1;
  const sym = (i: number): string => {
    const m = g.atoms[i];
    if (m.dummy) return '*';
    const s = SYMBOLS[m.z] ?? '*';
    if (PLAIN.has(s) && !m.charge && !m.iso && m.hCount === undefined) return s;
    const h = m.hCount ? (m.hCount > 1 ? `H${m.hCount}` : 'H') : '';
    const c = m.charge ? (m.charge > 0 ? '+' : '-') + (Math.abs(m.charge) > 1 ? Math.abs(m.charge) : '') : '';
    return `[${m.iso || ''}${s}${h}${c}]`;
  };
  const bondSym = (o: number) => (o === 2 ? '=' : o === 3 ? '#' : '');
  const done = new Set<number>();
  const write = (i: number, from: number): string => {
    done.add(i);
    let out = sym(i);
    // ring closures at this atom
    for (const n of nbrs[i]) {
      if (treeBonds.has(n.bond) || n.bond === from) continue;
      let k = ringNum.get(n.bond);
      if (k === undefined) { k = nextRing++; ringNum.set(n.bond, k); out += bondSym(n.order); }
      out += k > 9 ? `%${k}` : String(k);
    }
    const kids = nbrs[i].filter((n) => treeBonds.has(n.bond) && n.bond !== from && !done.has(n.to));
    kids.forEach((n, j) => {
      const part = bondSym(n.order) + write(n.to, n.bond);
      out += j < kids.length - 1 ? `(${part})` : part;
    });
    return out;
  };
  return g.atoms.length ? write(0, -1) : '';
}

/**
 * The selected atoms as a group: the atom joined to the rest of the drawing (by exactly one bond)
 * and the group's SMILES from there; null with the reason when the selection isn't one group.
 */
export function selectedGroup(doc: Doc, ids: Iterable<number>): { start: number; smiles: string; outside: number | null } | { error: string } {
  const set = new Set([...ids].filter((id) => doc.atoms.has(id) && !doc.atoms.get(id)!.attach));
  if (!set.size) return { error: 'Select the atoms of the group first.' };
  // where it joins: one bond out of the selection, or a wavy attachment point
  const out: { inside: number; outside: number }[] = [];
  for (const id of set) for (const n of doc.neighbors(id)) if (!set.has(n.id)) out.push({ inside: id, outside: n.id });
  if (out.length > 1) return { error: 'The group joins the rest of the structure by more than one bond. Select a group that hangs off by a single bond.' };
  const start = out[0]?.inside ?? [...set][0];
  const g = groupGraph(doc, set, start);
  if (!g) return { error: 'A label in the group can\'t be read as chemistry.' };
  return { start, smiles: graphSmiles(g), outside: out[0]?.outside ?? null };
}
