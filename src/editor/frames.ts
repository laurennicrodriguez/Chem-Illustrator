// Frames (Chemistry > Labels and Numbers > Add Frame): a box round a structure, a scheme or anything else, with a gap
// you choose. A frame that follows its contents is refitted at the end of every change, inside
// the same undo step, so it grows when a structure grows and moves when its contents move.

import type { Doc, Entity, Frame, Shape } from '../model';
import type { Rect } from '../geom';
import { selectionBox, POINTS, units, type Measure, type Selection } from './arrange';
import { shapeBox } from '../objects';

/** The default gap round a frame's contents: half a bond length, as boxes round schemes are usually drawn. */
export function defaultPad(doc: Doc): number {
  return Math.round(doc.style.bondLength * 0.5 * 10) / 10;
}

/** What a frame surrounds, as it is now: whole structures for its atoms, and the things still there. */
export function frameMembers(doc: Doc, f: Frame): Selection {
  const atoms = new Set<number>();
  for (const id of f.atoms) if (doc.atoms.has(id) && !atoms.has(id)) for (const a of doc.fragmentOf(id)) atoms.add(a);
  const bonds = new Set<number>();
  for (const id of atoms) for (const b of doc.adj.get(id) ?? []) bonds.add(b);
  return {
    atoms, bonds,
    captions: new Set(f.captions.filter((id) => doc.captions.has(id))),
    arrows: new Set(f.arrows.filter((id) => doc.arrows.has(id))),
    shapes: new Set(f.shapes.filter((id) => doc.shapes.has(id))),
  };
}

/** The frame's box round its contents: their box with the gap added. Null when they are all gone. */
export function frameBox(doc: Doc, f: Frame, m: Measure): Rect | null {
  const b = selectionBox(doc, frameMembers(doc, f), m);
  return b && { x1: b.x1 - f.padX, y1: b.y1 - f.padY, x2: b.x2 + f.padX, y2: b.y2 + f.padY };
}

/** A new frame shape round the selection (frames already in it are left out of what it surrounds). */
export function frameAround(doc: Doc, sel: Selection, m: Measure, pad = defaultPad(doc)): Omit<Shape, 'id'> | null {
  const f: Frame = {
    atoms: [...sel.atoms], captions: [...sel.captions], arrows: [...sel.arrows],
    shapes: [...sel.shapes].filter((id) => !doc.shapes.get(id)?.frame), padX: pad, padY: pad, fit: true,
  };
  const b = frameBox(doc, f, m);
  if (!b) return null;
  return { kind: 'rect', ...b, frame: f, color: '#000000' };
}

const same = (a: Rect, b: Rect) => Math.abs(a.x1 - b.x1) + Math.abs(a.y1 - b.y1) + Math.abs(a.x2 - b.x2) + Math.abs(a.y2 - b.y2) < 1e-6;

/**
 * At the end of a change (`before` holds how the changed things were): refit every frame that
 * follows its contents. A frame moved or resized on its own, with nothing inside it changing,
 * has been placed by hand, so it stops following.
 */
export function refitFrames(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  for (const s of [...doc.shapes.values()]) {
    const f = s.frame;
    if (!f?.fit) continue;
    const mem = frameMembers(doc, f);
    const touched = (k: string, ids: Iterable<number>) => { for (const id of ids) if (before.has(k + id)) return true; return false; };
    // a removed atom of the structure no longer shows up in its fragment, so check the list as well
    const inside = touched('a', mem.atoms) || touched('a', f.atoms) || touched('b', mem.bonds) || touched('c', f.captions) || touched('r', f.arrows) || touched('s', f.shapes);
    const old = before.get('s' + s.id) as Shape | null | undefined;
    // a new gap, or fitting switched on, refits it too
    const settings = !!old && (old.frame?.padX !== f.padX || old.frame?.padY !== f.padY || !old.frame?.fit);
    if (!inside && !settings) {
      if (old && !same(shapeBox(old), shapeBox(s))) doc.updateShape(s.id, { frame: { ...f, fit: false } });
      continue;
    }
    const b = frameBox(doc, f, m);
    if (b && !same(b, shapeBox(s))) doc.updateShape(s.id, b);
  }
}

/** The structures, text, arrows and shapes lying wholly inside a box (a frame's contents when it is read from a file or made from a box). */
export function thingsInside(doc: Doc, r: Rect, m: Measure, skip?: number): Pick<Frame, 'atoms' | 'captions' | 'arrows' | 'shapes'> {
  const all: Selection = {
    atoms: new Set(doc.atoms.keys()), bonds: new Set(), captions: new Set(doc.captions.keys()),
    arrows: new Set(doc.arrows.keys()), shapes: new Set([...doc.shapes.keys()].filter((id) => id !== skip)),
  };
  const out = { atoms: [] as number[], captions: [] as number[], arrows: [] as number[], shapes: [] as number[] };
  const tol = 0.5;
  for (const u of units(doc, all, m)) {
    const b = u.box;
    if (b.x1 < r.x1 - tol || b.y1 < r.y1 - tol || b.x2 > r.x2 + tol || b.y2 > r.y2 + tol) continue;
    // a frame inside a frame stays a thing of its own
    if (u.shapes.length && doc.shapes.get(u.shapes[0])?.frame) continue;
    out.atoms.push(...u.atoms.slice(0, 1));
    out.captions.push(...u.captions);
    out.arrows.push(...u.arrows);
    out.shapes.push(...u.shapes);
  }
  return out;
}

/** Frames read from a file know only their gap and whether they follow: they take what lies inside them. */
export function fillFrameMembers(doc: Doc, m: Measure = POINTS): void {
  for (const s of [...doc.shapes.values()]) {
    if (!s.frame || s.frame.atoms.length + s.frame.captions.length + s.frame.arrows.length + s.frame.shapes.length) continue;
    doc.updateShape(s.id, { frame: { ...s.frame, ...thingsInside(doc, shapeBox(s), m, s.id) } });
  }
}

/** A frame's settings as saved in a file (what it surrounds is worked out again on opening). */
export function frameTag(f: Frame): string {
  return JSON.stringify({ padX: f.padX, padY: f.padY, fit: f.fit });
}

export function frameFromTag(text: string | null): Frame | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<Frame>;
    const n = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) && x >= 0 ? x : d);
    return { atoms: [], captions: [], arrows: [], shapes: [], padX: n(v.padX, 7), padY: n(v.padY, 7), fit: v.fit !== false };
  } catch {
    return undefined;
  }
}
