// Groups (Format > Group): structures, captions, arrows and shapes put together so they select
// and move as one, as in ChemDraw and PowerPoint. Each thing carries its group's number (grp);
// a structure is grouped whole. Groups are one level deep: grouping things already in groups
// makes one new group of everything.

import { Doc } from '../model';
import type { Selection } from './arrange';

const empty = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

/** The group something is in, if any. */
export function groupOf(doc: Doc, kind: 'atom' | 'bond' | 'caption' | 'arrow' | 'shape', id: number): number | undefined {
  switch (kind) {
    case 'atom': return doc.atoms.get(id)?.grp;
    case 'bond': { const b = doc.bonds.get(id); return b ? doc.atoms.get(b.a1)?.grp : undefined; }
    case 'caption': return doc.captions.get(id)?.grp;
    case 'arrow': return doc.arrows.get(id)?.grp;
    case 'shape': return doc.shapes.get(id)?.grp;
  }
}

/** Everything in a group, with the bonds of its structures. */
export function groupMembers(doc: Doc, grp: number): Selection {
  const sel = empty();
  for (const a of doc.atoms.values()) if (a.grp === grp) sel.atoms.add(a.id);
  for (const b of doc.bonds.values()) if (sel.atoms.has(b.a1) && sel.atoms.has(b.a2)) sel.bonds.add(b.id);
  for (const c of doc.captions.values()) if (c.grp === grp) sel.captions.add(c.id);
  for (const r of doc.arrows.values()) if (r.grp === grp) sel.arrows.add(r.id);
  for (const s of doc.shapes.values()) if (s.grp === grp) sel.shapes.add(s.id);
  return sel;
}

/** The groups that something selected is in. */
export function selectedGroups(doc: Doc, sel: Selection): Set<number> {
  const out = new Set<number>();
  const add = (g: number | undefined) => { if (g !== undefined) out.add(g); };
  for (const id of sel.atoms) add(doc.atoms.get(id)?.grp);
  for (const id of sel.captions) add(doc.captions.get(id)?.grp);
  for (const id of sel.arrows) add(doc.arrows.get(id)?.grp);
  for (const id of sel.shapes) add(doc.shapes.get(id)?.grp);
  return out;
}

/** The selection grown to the whole of every group it touches. */
export function withGroups(doc: Doc, sel: Selection): Selection {
  const out: Selection = { atoms: new Set(sel.atoms), bonds: new Set(sel.bonds), captions: new Set(sel.captions), arrows: new Set(sel.arrows), shapes: new Set(sel.shapes) };
  for (const g of selectedGroups(doc, sel)) {
    const m = groupMembers(doc, g);
    for (const k of ['atoms', 'bonds', 'captions', 'arrows', 'shapes'] as const) for (const id of m[k]) out[k].add(id);
  }
  return out;
}

/**
 * Group the selection (inside an edit): its structures whole, its captions, arrows and shapes,
 * and everything in groups it touches. Returns the new group's number, or null when there are
 * fewer than two things to group.
 */
export function groupSelection(doc: Doc, sel: Selection): number | null {
  const all = withGroups(doc, sel);
  const atoms = new Set<number>();
  let things = 0;
  for (const id of all.atoms) {
    if (atoms.has(id) || !doc.atoms.has(id)) continue;
    things++;
    for (const x of doc.fragmentOf(id)) atoms.add(x);
  }
  things += all.captions.size + all.arrows.size + all.shapes.size;
  if (things < 2) return null;
  let top = 0;
  for (const m of [doc.atoms, doc.captions, doc.arrows, doc.shapes] as Map<number, { grp?: number }>[]) for (const e of m.values()) if (e.grp !== undefined && e.grp > top) top = e.grp;
  const grp = top + 1;
  for (const id of atoms) doc.updateAtom(id, { grp });
  for (const id of all.captions) doc.updateCaption(id, { grp });
  for (const id of all.arrows) doc.updateArrow(id, { grp });
  for (const id of all.shapes) doc.updateShape(id, { grp });
  return grp;
}

/** Take apart the groups the selection touches (inside an edit). False when none does. */
export function ungroupSelection(doc: Doc, sel: Selection): boolean {
  const groups = selectedGroups(doc, sel);
  if (!groups.size) return false;
  for (const g of groups) {
    const m = groupMembers(doc, g);
    for (const id of m.atoms) doc.updateAtom(id, { grp: undefined });
    for (const id of m.captions) doc.updateCaption(id, { grp: undefined });
    for (const id of m.arrows) doc.updateArrow(id, { grp: undefined });
    for (const id of m.shapes) doc.updateShape(id, { grp: undefined });
  }
  return true;
}

/** Give the groups among things just added new numbers of their own (inside an edit). */
export function freshGroups(doc: Doc, added: Selection): void {
  const mine = new Set<string>();
  for (const id of added.atoms) mine.add('a' + id);
  for (const id of added.captions) mine.add('c' + id);
  for (const id of added.arrows) mine.add('r' + id);
  for (const id of added.shapes) mine.add('s' + id);
  let top = 0;
  const lists: [string, Map<number, { id: number; grp?: number }>][] = [['a', doc.atoms], ['c', doc.captions], ['r', doc.arrows], ['s', doc.shapes]];
  for (const [k, m] of lists) for (const e of m.values()) if (!mine.has(k + e.id) && e.grp !== undefined && e.grp > top) top = e.grp;
  const renum = new Map<number, number>();
  const next = (g: number) => { let n = renum.get(g); if (n === undefined) renum.set(g, (n = top + renum.size + 1)); return n; };
  for (const id of added.atoms) { const g = doc.atoms.get(id)?.grp; if (g !== undefined) doc.updateAtom(id, { grp: next(g) }); }
  for (const id of added.captions) { const g = doc.captions.get(id)?.grp; if (g !== undefined) doc.updateCaption(id, { grp: next(g) }); }
  for (const id of added.arrows) { const g = doc.arrows.get(id)?.grp; if (g !== undefined) doc.updateArrow(id, { grp: next(g) }); }
  for (const id of added.shapes) { const g = doc.shapes.get(id)?.grp; if (g !== undefined) doc.updateShape(id, { grp: next(g) }); }
}
