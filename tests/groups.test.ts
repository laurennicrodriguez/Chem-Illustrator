// @vitest-environment jsdom
//
// Format > Group: structures, captions, arrows and shapes that select and move together, saved
// as ChemDraw group elements and read back as groups.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { readCdxml } from '../src/io/cdxml';
import { writeCdxml } from '../src/io/cdxml-write';
import { groupSelection, ungroupSelection, withGroups, groupMembers, selectedGroups, freshGroups } from '../src/editor/groups';

const empty = () => ({ atoms: new Set<number>(), bonds: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() });

/** Ethane, a caption and a box. */
function drawing(): { doc: Doc; a: number; b: number; c: number; s: number } {
  const doc = new Doc();
  let a = 0, b = 0, c = 0, s = 0;
  doc.edit('draw', () => {
    a = doc.addAtom(0, 0, 6).id;
    b = doc.addAtom(14.4, 0, 6).id;
    doc.addBond(a, b, 1);
    c = doc.addCaption({ x: 0, y: 30, runs: [{ text: '1a' }], justify: 'left' }).id;
    s = doc.addShape({ kind: 'rect', x1: 60, y1: 0, x2: 90, y2: 20 }).id;
  });
  return { doc, a, b, c, s };
}

describe('groups', () => {
  it('groups a whole structure with a caption, and selects the group from one member', () => {
    const { doc, a, b, c, s } = drawing();
    const sel = empty();
    sel.atoms.add(a);
    sel.captions.add(c);
    let g: number | null = null;
    doc.edit('Group', () => { g = groupSelection(doc, sel); });
    expect(g).toBe(1);
    expect(doc.atoms.get(b)!.grp).toBe(1); // the rest of the structure joins
    expect(doc.shapes.get(s)!.grp).toBeUndefined();
    const one = empty();
    one.captions.add(c);
    const all = withGroups(doc, one);
    expect([...all.atoms].sort()).toEqual([a, b].sort());
    expect(all.bonds.size).toBe(1);
    doc.edit('Ungroup', () => ungroupSelection(doc, one));
    expect(selectedGroups(doc, all).size).toBe(0);
  });

  it('needs two things to group', () => {
    const { doc, a } = drawing();
    const sel = empty();
    sel.atoms.add(a);
    let g: number | null = 0;
    doc.edit('Group', () => { g = groupSelection(doc, sel); });
    expect(g).toBeNull();
  });

  it('gives pasted copies a group of their own', () => {
    const { doc, a, c } = drawing();
    const sel = empty();
    sel.atoms.add(a);
    sel.captions.add(c);
    doc.edit('Group', () => groupSelection(doc, sel));
    let copy = 0;
    doc.edit('paste', () => {
      copy = doc.addCaption({ x: 0, y: 60, runs: [{ text: '1b' }], justify: 'left', grp: 1 }).id;
      const added = empty();
      added.captions.add(copy);
      freshGroups(doc, added);
    });
    expect(doc.captions.get(copy)!.grp).toBe(2);
    expect(groupMembers(doc, 1).captions.has(copy)).toBe(false);
  });

  it('saves a group as a ChemDraw group and reads it back', () => {
    const { doc, a, c, s } = drawing();
    const sel = empty();
    sel.atoms.add(a);
    sel.captions.add(c);
    doc.edit('Group', () => groupSelection(doc, sel));
    const xml = writeCdxml(doc);
    const page = new DOMParser().parseFromString(xml, 'application/xml').querySelector('page')!;
    const groups = [...page.children].filter((e) => e.nodeName === 'group');
    expect(groups).toHaveLength(1);
    expect([...groups[0].children].map((e) => e.nodeName).sort()).toEqual(['fragment', 't']);
    const back = readCdxml(xml).doc;
    const grouped = [...back.captions.values()].filter((x) => x.grp !== undefined);
    expect(grouped).toHaveLength(1);
    expect([...back.atoms.values()].every((x) => x.grp === grouped[0].grp)).toBe(true);
    expect([...back.shapes.values()].every((x) => x.grp === undefined)).toBe(true);
    // ungrouped and saved again: the things go back onto the page
    const all = empty();
    for (const x of back.captions.keys()) all.captions.add(x);
    back.edit('Ungroup', () => ungroupSelection(back, all));
    const again = new DOMParser().parseFromString(writeCdxml(back), 'application/xml').querySelector('page')!;
    expect([...again.children].some((e) => e.nodeName === 'group')).toBe(false);
    expect(s).toBeGreaterThan(0);
  });
});
