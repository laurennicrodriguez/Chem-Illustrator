// Showing and hiding hydrogens: CH3 written out at chain ends, and H atoms drawn as atoms.

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

/**
 * Write CH3 (or CH2 and so on) at the chain ends among these atoms, or take it off again if they
 * all show it already. Returns how many changed and whether they now show it.
 */
export function toggleChainEndLabels(doc: Doc, ids: Iterable<number>): { count: number; shown: boolean } {
  const ends = chainEnds(doc, ids);
  const show = ends.some((id) => !doc.atoms.get(id)!.showCarbon);
  for (const id of ends) doc.updateAtom(id, { showCarbon: show || undefined });
  return { count: ends.length, shown: show };
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
    if (!a || a.z === 1 || a.attach || a.label) continue;
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
