// Showing and hiding hydrogens: terminal methyls written out (CH3 or Me), and H atoms drawn as atoms.

import type { Doc } from '../model';
import { implicitHydrogens } from './elements';
import { sprout } from './chemgeom';

/** The atoms to work on: the ones given, or every atom when none are. */
const scope = (doc: Doc, ids: Iterable<number>): number[] => {
  const list = [...ids].filter((id) => doc.atoms.has(id));
  return list.length ? list : [...doc.atoms.keys()];
};

/** Plain carbons at the end of a chain (one bond, no label). */
export function chainEnds(doc: Doc, ids: Iterable<number>): number[] {
  return scope(doc, ids).filter((id) => {
    const a = doc.atoms.get(id)!;
    return a.z === 6 && !a.label && !a.attach && doc.degree(id) === 1;
  });
}

/** How terminal methyls are written out: CH3, or Me (View > Terminal Methyls as …). */
export type MethylStyle = 'CH3' | 'Me';

/** A chain end that is a methyl (CH3: one single bond, no charge or isotope), so it can be written Me. */
const isMethyl = (doc: Doc, id: number): boolean => {
  const a = doc.atoms.get(id)!;
  return !a.charge && !a.isotope && doc.valenceSum(id) === 1;
};

/** A chain end written as Me (by this command or by hand). */
const isMeEnd = (doc: Doc, id: number): boolean => {
  const a = doc.atoms.get(id)!;
  return a.label === 'Me' && !a.attach && doc.degree(id) === 1;
};

/** Every chain end among these atoms, written out or not: plain ends, and ends labelled Me. */
export function terminalEnds(doc: Doc, ids: Iterable<number>): number[] {
  const plain = new Set(chainEnds(doc, ids));
  return scope(doc, ids).filter((id) => plain.has(id) || isMeEnd(doc, id));
}

const isShown = (doc: Doc, id: number) => isMeEnd(doc, id) || !!doc.atoms.get(id)!.showCarbon;

/** Write one chain end out in the style (CH2 and CH ends, which aren't methyls, are always written with C and H). */
function writeOut(doc: Doc, id: number, style: MethylStyle): void {
  if (style === 'Me' && isMethyl(doc, id)) doc.updateAtom(id, { label: 'Me', showCarbon: undefined, fileLabel: false });
  else doc.updateAtom(id, { label: null, z: 6, showCarbon: true, fileLabel: false });
}

/**
 * Show Terminal Methyls: write out CH3 (or Me, or CH2 and so on) at the chain ends among these
 * atoms, or take it off again if they all show it already. Returns how many changed and whether
 * they now show it.
 */
export function toggleChainEndLabels(doc: Doc, ids: Iterable<number>, style: MethylStyle = 'CH3'): { count: number; shown: boolean } {
  const ends = terminalEnds(doc, ids);
  const show = ends.some((id) => !isShown(doc, id));
  writeTerminalMethyls(doc, ends, show ? style : 'hidden');
  return { count: ends.length, shown: show };
}

/** Write every chain end among these atoms one way: as plain line ends, or written out in a style. Returns how many there are. */
export function writeTerminalMethyls(doc: Doc, ids: Iterable<number>, how: MethylStyle | 'hidden'): number {
  const ends = terminalEnds(doc, ids);
  for (const id of ends) {
    if (how !== 'hidden') writeOut(doc, id, how);
    else if (isShown(doc, id)) doc.updateAtom(id, { label: null, z: 6, showCarbon: undefined, fileLabel: false });
  }
  return ends.length;
}

/** Rewrite the chain ends already written out among these atoms in another style. Returns how many changed. */
export function setMethylStyle(doc: Doc, ids: Iterable<number>, style: MethylStyle): number {
  let n = 0;
  for (const id of terminalEnds(doc, ids)) {
    if (!isShown(doc, id)) continue;
    const before = isMeEnd(doc, id);
    writeOut(doc, id, style);
    if (before !== isMeEnd(doc, id)) n++;
  }
  return n;
}

/** How the chain ends among these atoms are written: not at all, CH3, Me, or a mixture. */
export function methylState(doc: Doc, ids: Iterable<number>): 'none' | 'hidden' | MethylStyle | 'mixed' {
  const ends = terminalEnds(doc, ids);
  if (!ends.length) return 'none';
  const kinds = new Set(ends.map((id) => (isMeEnd(doc, id) ? 'Me' : doc.atoms.get(id)!.showCarbon ? (isMethyl(doc, id) ? 'CH3' : 'C') : 'hidden')));
  // CH2 and CH ends are written with C whichever style is chosen
  if (kinds.size > 1 && kinds.has('C')) kinds.delete('C');
  if (kinds.size === 1) {
    const k = [...kinds][0];
    return k === 'C' ? 'CH3' : (k as 'hidden' | MethylStyle);
  }
  return 'mixed';
}

/**
 * H atoms that can go without losing anything: on a carbon, by a plain single bond, with no
 * charge, isotope or colour of their own. Hydrogens on stereo (wedged or hashed) bonds and on
 * N, O and other heteroatoms stay, as they say something the drawing would otherwise not.
 */
export function removableHydrogens(doc: Doc, ids: Iterable<number>): number[] {
  const out = new Set<number>();
  for (const id of scope(doc, ids)) {
    const a = doc.atoms.get(id)!;
    // an H itself, or the H atoms on a selected atom
    const hs = a.z === 1 ? [id] : doc.neighbors(id).filter((n) => n.z === 1).map((n) => n.id);
    for (const h of hs) {
      const ha = doc.atoms.get(h)!;
      if (ha.label && ha.label !== 'H') continue;
      if (ha.charge || ha.isotope || ha.color || doc.degree(h) !== 1) continue;
      const bid = [...(doc.adj.get(h) ?? [])][0];
      const b = doc.bonds.get(bid)!;
      if (b.order !== 1 || b.display !== 'solid') continue;
      const c = doc.atoms.get(b.a1 === h ? b.a2 : b.a1)!;
      if (c.z !== 6 || c.label) continue;
      out.add(h);
    }
  }
  return [...out];
}

/** Draw each of these atoms' hydrogens as H atoms on bonds. Returns how many were added. */
export function addExplicitHydrogens(doc: Doc, ids: Iterable<number>): number {
  let added = 0;
  for (const id of [...ids]) {
    const a = doc.atoms.get(id);
    if (!a || a.z === 1 || a.attach || a.multi || a.label) continue;
    const n = implicitHydrogens(a.z, doc.valenceSum(id), a.charge);
    for (let i = 0; i < n; i++) { sprout(doc, id, 1, 'solid', 1); added++; }
  }
  return added;
}

/**
 * Hide the H atoms that don't matter among these atoms (all, when none are given); when there
 * are none to hide, draw the selected atoms' hydrogens as atoms instead.
 */
export function toggleExplicitHydrogens(doc: Doc, ids: Iterable<number>): { removed: number; added: number } {
  const list = [...ids];
  const gone = removableHydrogens(doc, list);
  if (gone.length) {
    for (const h of gone) doc.removeAtom(h);
    return { removed: gone.length, added: 0 };
  }
  return { removed: 0, added: list.length ? addExplicitHydrogens(doc, list) : 0 };
}
