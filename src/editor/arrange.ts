// Lining things up: align and distribute the selected objects, and flip or rotate the
// selection. Each structure, caption, arrow and shape counts as one object; only the selected
// part of a structure moves.

import { Doc, Atom, Caption, Bond, Arrow, Shape } from '../model';
import { Vec, Rect, add, sub } from '../geom';
import { arrowPoints, boxOf, shapeBox, unionRect } from '../objects';
import { frameMembers } from './frames';

export interface Selection {
  atoms: Set<number>;
  bonds: Set<number>;
  captions: Set<number>;
  arrows: Set<number>;
  shapes: Set<number>;
}

/** How big things are on the page: label boxes round atoms, and caption boxes. */
export interface Measure {
  atomBoxes(a: Atom): Rect[];
  captionBox(c: Caption): Rect;
}

/** Positions only (labels and text ignored); good enough for tests and very large selections. */
export const POINTS: Measure = {
  atomBoxes: () => [],
  captionBox: (c) => ({ x1: c.x, y1: c.y, x2: c.x, y2: c.y }),
};

export interface Unit {
  atoms: number[];
  captions: number[];
  arrows: number[];
  shapes: number[];
  box: Rect;
}

export type Align = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

/** The selection as separate objects: one per structure, caption, arrow and shape. */
export function units(doc: Doc, sel: Selection, m: Measure): Unit[] {
  const out: Unit[] = [];
  const seen = new Set<number>();
  // a frame that follows its contents is one object with them (as when dragged)
  const carried = { atoms: new Set<number>(), captions: new Set<number>(), arrows: new Set<number>(), shapes: new Set<number>() };
  for (const id of sel.shapes) {
    const s = doc.shapes.get(id);
    if (!s?.frame?.fit || carried.shapes.has(id)) continue;
    const mem = frameMembers(doc, s.frame);
    for (const k of ['atoms', 'captions', 'arrows', 'shapes'] as const) for (const x of mem[k]) carried[k].add(x);
    carried.shapes.add(id);
    out.push({ atoms: [...mem.atoms], captions: [...mem.captions], arrows: [...mem.arrows], shapes: [id, ...mem.shapes], box: shapeBox(s) });
  }
  for (const id of carried.atoms) seen.add(id);
  for (const id of sel.atoms) {
    if (seen.has(id) || !doc.atoms.has(id)) continue;
    // the selected atoms of this structure
    const atoms: number[] = [];
    const stack = [id];
    seen.add(id);
    while (stack.length) {
      const a = stack.pop()!;
      atoms.push(a);
      for (const n of doc.neighbors(a)) if (sel.atoms.has(n.id) && !seen.has(n.id)) { seen.add(n.id); stack.push(n.id); }
    }
    out.push({ atoms, captions: [], arrows: [], shapes: [], box: atomsBox(doc, atoms, m) });
  }
  for (const id of sel.captions) { const c = doc.captions.get(id); if (c && !carried.captions.has(id)) out.push({ atoms: [], captions: [id], arrows: [], shapes: [], box: m.captionBox(c) }); }
  for (const id of sel.arrows) { const r = doc.arrows.get(id); if (r && !carried.arrows.has(id)) out.push({ atoms: [], captions: [], arrows: [id], shapes: [], box: boxOf(arrowPoints(r)) }); }
  for (const id of sel.shapes) { const s = doc.shapes.get(id); if (s && !carried.shapes.has(id)) out.push({ atoms: [], captions: [], arrows: [], shapes: [id], box: shapeBox(s) }); }
  return out;
}

export function atomsBox(doc: Doc, atoms: Iterable<number>, m: Measure): Rect {
  let r: Rect | null = null;
  for (const id of atoms) {
    const a = doc.atoms.get(id);
    if (!a) continue;
    r = unionRect(r, { x1: a.x, y1: a.y, x2: a.x, y2: a.y });
    for (const b of m.atomBoxes(a)) r = unionRect(r, b);
  }
  return r ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
}

/** Box round everything selected. */
export function selectionBox(doc: Doc, sel: Selection, m: Measure): Rect | null {
  let r: Rect | null = null;
  for (const u of units(doc, sel, m)) r = unionRect(r, u.box);
  return r;
}

/** How far to move each object so their edges or centres line up. */
export function alignOffsets(us: Unit[], how: Align): Vec[] {
  if (us.length < 2) return us.map(() => ({ x: 0, y: 0 }));
  let all: Rect | null = null;
  for (const u of us) all = unionRect(all, u.box);
  const a = all!;
  return us.map(({ box: b }) => {
    switch (how) {
      case 'left': return { x: a.x1 - b.x1, y: 0 };
      case 'right': return { x: a.x2 - b.x2, y: 0 };
      case 'hcenter': return { x: (a.x1 + a.x2) / 2 - (b.x1 + b.x2) / 2, y: 0 };
      case 'top': return { x: 0, y: a.y1 - b.y1 };
      case 'bottom': return { x: 0, y: a.y2 - b.y2 };
      case 'vcenter': return { x: 0, y: (a.y1 + a.y2) / 2 - (b.y1 + b.y2) / 2 };
    }
  });
}

/**
 * How far to move each object so the gaps between neighbours are equal. The outermost two
 * stay where they are; objects are taken in order of their centres.
 */
export function distributeOffsets(us: Unit[], axis: 'h' | 'v'): Vec[] {
  const out = us.map(() => ({ x: 0, y: 0 }));
  if (us.length < 3) return out;
  const lo = (r: Rect) => (axis === 'h' ? r.x1 : r.y1), hi = (r: Rect) => (axis === 'h' ? r.x2 : r.y2);
  const order = us.map((u, i) => i).sort((i, j) => lo(us[i].box) + hi(us[i].box) - lo(us[j].box) - hi(us[j].box));
  const first = us[order[0]].box, last = us[order[order.length - 1]].box;
  let sizes = 0;
  for (const i of order) sizes += hi(us[i].box) - lo(us[i].box);
  const gap = (hi(last) - lo(first) - sizes) / (order.length - 1);
  let at = lo(first);
  for (const i of order) {
    const d = at - lo(us[i].box);
    out[i] = axis === 'h' ? { x: d, y: 0 } : { x: 0, y: d };
    at += hi(us[i].box) - lo(us[i].box) + gap;
  }
  return out;
}

/** Move one object. Call inside an edit. */
export function moveUnit(doc: Doc, u: Unit, d: Vec): void {
  if (!d.x && !d.y) return;
  doc.moveAtoms(u.atoms, d.x, d.y);
  for (const id of u.captions) { const c = doc.captions.get(id)!; doc.updateCaption(id, { x: c.x + d.x, y: c.y + d.y }); }
  for (const id of u.arrows) { const r = doc.arrows.get(id)!; doc.updateArrow(id, { tail: add(r.tail, d), head: add(r.head, d) }); }
  for (const id of u.shapes) { const s = doc.shapes.get(id)!; doc.updateShape(id, { x1: s.x1 + d.x, y1: s.y1 + d.y, x2: s.x2 + d.x, y2: s.y2 + d.y }); }
}

// ------------------------------------------------------------------ flip and rotate

/** Where everything selected is now, so a rotation can be worked out from the start each time. */
export interface Snapshot {
  atoms: Atom[];
  bonds: Bond[];
  captions: { c: Caption; box: Rect }[];
  arrows: Arrow[];
  shapes: Shape[];
}

/**
 * The selection with what its auto-fit frames hold, so a flip, rotation or scaling takes a
 * frame's contents with it (and the frame fits round them again after, still following them).
 */
export function withFrameContents(doc: Doc, sel: Selection): Selection {
  const fits = [...sel.shapes].map((id) => doc.shapes.get(id)?.frame).filter((f) => f?.fit);
  if (!fits.length) return sel;
  const all: Selection = { atoms: new Set(sel.atoms), bonds: new Set(sel.bonds), captions: new Set(sel.captions), arrows: new Set(sel.arrows), shapes: new Set(sel.shapes) };
  for (const f of fits) {
    const mem = frameMembers(doc, f!);
    for (const k of ['atoms', 'bonds', 'captions', 'arrows', 'shapes'] as const) for (const id of mem[k]) all[k].add(id);
  }
  return all;
}

export function snapshot(doc: Doc, sel: Selection, m: Measure): Snapshot {
  sel = withFrameContents(doc, sel);
  const pick = <T>(ids: Set<number>, map: Map<number, T>) => [...ids].map((id) => map.get(id)).filter((x): x is T => !!x);
  // bonds turned over with a flip: those inside the selection
  const bonds = [...doc.bonds.values()].filter((b) => sel.atoms.has(b.a1) && sel.atoms.has(b.a2));
  return {
    atoms: pick(sel.atoms, doc.atoms).map((a) => ({ ...a })),
    bonds: bonds.map((b) => ({ ...b })),
    captions: pick(sel.captions, doc.captions).map((c) => ({ c: { ...c }, box: m.captionBox(c) })),
    arrows: pick(sel.arrows, doc.arrows).map((r) => ({ ...r })),
    shapes: pick(sel.shapes, doc.shapes).map((s) => ({ ...s })),
  };
}

/**
 * Put everything in a snapshot through a rotation or a mirror. Text stays upright: captions
 * and boxes move with their centres. A mirror turns the drawing over, so double bonds keep
 * their second line on the same side, curved arrows bend the other way and brackets keep
 * facing in. Call inside an edit.
 */
export function transform(doc: Doc, snap: Snapshot, f: (p: Vec) => Vec, mirror: boolean): void {
  for (const a of snap.atoms) { const p = f(a); doc.updateAtom(a.id, { x: p.x, y: p.y }); }
  if (mirror) {
    const side: Record<Bond['dpos'], Bond['dpos']> = { auto: 'auto', center: 'center', left: 'right', right: 'left' };
    for (const b of snap.bonds) if (b.dpos === 'left' || b.dpos === 'right') doc.updateBond(b.id, { dpos: side[b.dpos] });
  }
  for (const { c, box } of snap.captions) {
    const mid = { x: (box.x1 + box.x2) / 2, y: (box.y1 + box.y2) / 2 };
    const d = sub(f(mid), mid);
    doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y });
  }
  const half = (h: Arrow['headStyle']): Arrow['headStyle'] => (h === 'halfLeft' ? 'halfRight' : h === 'halfRight' ? 'halfLeft' : h);
  for (const r of snap.arrows) {
    const patch: Partial<Arrow> = { tail: f(r.tail), head: f(r.head) };
    if (mirror) {
      patch.sweep = -r.sweep || 0;
      if (!r.equilibrium) { patch.headStyle = half(r.headStyle); patch.tailStyle = half(r.tailStyle); }
    }
    doc.updateArrow(r.id, patch);
  }
  for (const s of snap.shapes) {
    if (s.kind === 'line' || s.kind === 'bracket') {
      let p = f({ x: s.x1, y: s.y1 }), q = f({ x: s.x2, y: s.y2 });
      // a bracket's lips are on the right of its direction, so a mirror image runs the other way
      if (mirror && s.kind === 'bracket') [p, q] = [q, p];
      doc.updateShape(s.id, { x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    } else {
      const mid = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
      const d = sub(f(mid), mid);
      doc.updateShape(s.id, { x1: s.x1 + d.x, y1: s.y1 + d.y, x2: s.x2 + d.x, y2: s.y2 + d.y });
    }
  }
}

export const rotation = (c: Vec, ang: number) => (p: Vec): Vec => {
  const cos = Math.cos(ang), sin = Math.sin(ang);
  const x = p.x - c.x, y = p.y - c.y;
  return { x: c.x + x * cos - y * sin, y: c.y + x * sin + y * cos };
};

export const mirrorX = (cx: number) => (p: Vec): Vec => ({ x: 2 * cx - p.x, y: p.y });
export const mirrorY = (cy: number) => (p: Vec): Vec => ({ x: p.x, y: 2 * cy - p.y });
