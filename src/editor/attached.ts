// Captions tied to a structure: ID labels, captions and descriptors (formula, masses) that keep
// their place beside the structure when it moves, grows or turns. They are put back in place at
// the end of every change, inside the same undo step, as frames are. Moving one by hand keeps
// the new place (as a gap and a shift from the middle of its side), so it follows from there.

import type { AttachSide, Attachment, Caption, Doc, Entity } from '../model';
import type { Rect, Vec } from '../geom';
import { POINTS, selectionBox, type Measure } from './arrange';

/** The name of the tag that saves a caption's tie in a CDXML file. */
export const ATTACH_TAG = 'Chem Illustrator attached';

/** The usual gap between a structure and its label: a third of a bond length. */
export function defaultGap(doc: Doc): number {
  return Math.round(doc.style.bondLength * 0.3 * 10) / 10;
}

/** The structure a caption is tied to, as it is now (empty when it is gone). */
export function attachedAtoms(doc: Doc, a: Attachment): Set<number> {
  const id = a.atoms.find((x) => doc.atoms.has(x));
  return id === undefined ? new Set() : doc.fragmentOf(id);
}

/** A structure's box, with its atom labels. */
export function structureBox(doc: Doc, atoms: Set<number>, m: Measure): Rect | null {
  if (!atoms.size) return null;
  return selectionBox(doc, { atoms, bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }, m);
}

/** The point of the caption's box that is held to the structure: the edge facing it, in the middle. */
function capPoint(cap: Rect, side: AttachSide): Vec {
  const cx = (cap.x1 + cap.x2) / 2, cy = (cap.y1 + cap.y2) / 2;
  return side === 'below' ? { x: cx, y: cap.y1 } : side === 'above' ? { x: cx, y: cap.y2 } : side === 'left' ? { x: cap.x2, y: cy } : { x: cap.x1, y: cy };
}

/** Where that point goes, beside the structure's box. */
export function anchorPoint(box: Rect, a: Pick<Attachment, 'side' | 'gap' | 'shift'>): Vec {
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  switch (a.side) {
    case 'below': return { x: cx + a.shift, y: box.y2 + a.gap };
    case 'above': return { x: cx + a.shift, y: box.y1 - a.gap };
    case 'left': return { x: box.x1 - a.gap, y: cy + a.shift };
    case 'right': return { x: box.x2 + a.gap, y: cy + a.shift };
  }
}

/** How far to move a caption (its box `cap`) so it sits in its place beside the structure's box. */
export function attachOffset(box: Rect, cap: Rect, a: Pick<Attachment, 'side' | 'gap' | 'shift'>): Vec {
  const want = anchorPoint(box, a), now = capPoint(cap, a.side);
  return { x: want.x - now.x, y: want.y - now.y };
}

/** The gap and shift of a caption where it is now (after it was moved by hand), on its side. */
export function readPlace(box: Rect, cap: Rect, side: AttachSide): { gap: number; shift: number } {
  const p = capPoint(cap, side);
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  const r = (v: number) => Math.round(v * 100) / 100;
  switch (side) {
    case 'below': return { gap: r(p.y - box.y2), shift: r(p.x - cx) };
    case 'above': return { gap: r(box.y1 - p.y), shift: r(p.x - cx) };
    case 'left': return { gap: r(box.x1 - p.x), shift: r(p.y - cy) };
    case 'right': return { gap: r(p.x - box.x2), shift: r(p.y - cy) };
  }
}

/** The side a caption sits on, judged from where it is (for captions tied to a structure after the fact). */
export function sideOf(box: Rect, cap: Rect): AttachSide {
  const cx = (cap.x1 + cap.x2) / 2, cy = (cap.y1 + cap.y2) / 2;
  const bx = (box.x1 + box.x2) / 2, by = (box.y1 + box.y2) / 2;
  const w = Math.max(1, box.x2 - box.x1), h = Math.max(1, box.y2 - box.y1);
  const dx = (cx - bx) / w, dy = (cy - by) / h;
  if (Math.abs(dy) >= Math.abs(dx)) return dy >= 0 ? 'below' : 'above';
  return dx >= 0 ? 'right' : 'left';
}

/** A structure as written now (its atoms and bonds), to tell when its descriptors need working out again. */
export function structureSig(doc: Doc, atoms: Set<number>): string {
  const parts: string[] = [];
  for (const id of [...atoms].sort((x, y) => x - y)) {
    const a = doc.atoms.get(id);
    if (!a) continue;
    parts.push(`${id}:${a.z}:${a.charge}:${a.isotope ?? ''}:${a.label ?? ''}:${a.group ?? ''}`);
    for (const b of doc.adj.get(id) ?? []) {
      const bd = doc.bonds.get(b);
      if (bd && bd.a1 === id) parts.push(`${bd.a1}-${bd.a2}:${bd.order}:${bd.display}`);
    }
  }
  return parts.join('|');
}

/** Put a caption in its place beside its structure (inside an edit). */
export function placeAttached(doc: Doc, c: Caption, m: Measure): void {
  if (!c.attach) return;
  const box = structureBox(doc, attachedAtoms(doc, c.attach), m);
  if (!box) return;
  const d = attachOffset(box, m.captionBox(c), c.attach);
  if (Math.abs(d.x) > 1e-6 || Math.abs(d.y) > 1e-6) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y });
}

const sameList = (a: number[], b: Set<number>) => a.length === b.size && a.every((x) => b.has(x));

/**
 * At the end of a change (`before` holds how the changed things were): captions whose structure
 * moved or changed take their places beside it again; a caption moved by hand on its own keeps
 * its new place; captions whose structure was deleted go with it.
 */
export function refitAttached(doc: Doc, before: ReadonlyMap<string, Entity | null>, m: Measure): void {
  for (const c of [...doc.captions.values()]) {
    const a = c.attach;
    if (!a) continue;
    const atoms = attachedAtoms(doc, a);
    if (!atoms.size) {
      // the structure is gone: so is its label, unless the caption was what changed
      if (a.atoms.some((id) => before.has('a' + id))) doc.removeCaption(c.id);
      continue;
    }
    const structure = a.atoms.some((id) => before.has('a' + id)) || [...atoms].some((id) => before.has('a' + id));
    const old = before.get('c' + c.id) as Caption | null | undefined;
    if (!structure && !old) continue;
    // keep the list of atoms up to date (atoms added to or erased from the structure)
    let at: Attachment = a;
    if (!sameList(a.atoms, atoms)) at = { ...a, atoms: [...atoms] };
    const box = structureBox(doc, atoms, m);
    if (!box) continue;
    const moved = !!old && !structure && (old.x !== c.x || old.y !== c.y) && sameAttach(old.attach, a);
    if (moved) {
      // moved by hand: it stays there, and follows the structure from there on
      at = { ...at, ...readPlace(box, m.captionBox(c), a.side) };
      doc.updateCaption(c.id, { attach: at });
      continue;
    }
    if (at !== a) doc.updateCaption(c.id, { attach: at });
    placeAttached(doc, doc.captions.get(c.id)!, m);
  }
}

function sameAttach(x: Attachment | undefined, y: Attachment): boolean {
  return !!x && x.side === y.side && x.gap === y.gap && x.shift === y.shift;
}

/**
 * Tie a caption to a structure where it sits now: on the side it is on, at its present gap and
 * shift (Tie to Structure, and captions read back from a file).
 */
export function attachWhereItIs(doc: Doc, c: Caption, atoms: Set<number>, m: Measure, role: Attachment['role'], extra: Partial<Attachment> = {}): Attachment | null {
  const box = structureBox(doc, atoms, m);
  if (!box) return null;
  const cap = m.captionBox(c);
  const side = extra.side ?? sideOf(box, cap);
  return { atoms: [...atoms], side, ...readPlace(box, cap, side), role, ...extra };
}

/** The structure nearest a caption (its box closest to the caption's box), for tying one after the fact. */
export function nearestStructure(doc: Doc, cap: Rect, m: Measure, maxDist = Infinity): Set<number> | null {
  let best: Set<number> | null = null, bd = maxDist;
  for (const f of doc.fragments()) {
    const b = structureBox(doc, f, m);
    if (!b) continue;
    const dx = Math.max(0, b.x1 - cap.x2, cap.x1 - b.x2), dy = Math.max(0, b.y1 - cap.y2, cap.y1 - b.y2);
    const d = Math.hypot(dx, dy);
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}

/** An attachment as saved in a file (the structure is found again from where the caption sits). */
export function attachTag(a: Attachment): string {
  const { atoms: _atoms, sig: _sig, ...rest } = a;
  return JSON.stringify(rest);
}

const SIDES: AttachSide[] = ['below', 'above', 'left', 'right'];
const KEYS = ['formula', 'exact', 'mw', 'mz', 'ea', 'hrms'];

export function attachFromTag(text: string | null): Attachment | undefined {
  if (!text) return undefined;
  try {
    const v = JSON.parse(text) as Partial<Attachment>;
    const n = (x: unknown, d: number) => (typeof x === 'number' && isFinite(x) ? x : d);
    const role = v.role === 'label' || v.role === 'caption' || v.role === 'descriptors' ? v.role : 'caption';
    const out: Attachment = { atoms: [], side: SIDES.includes(v.side as AttachSide) ? (v.side as AttachSide) : 'below', gap: n(v.gap, 4), shift: n(v.shift, 0), role };
    if (Array.isArray(v.show)) out.show = v.show.filter((k) => KEYS.includes(k));
    if (typeof v.adduct === 'string') out.adduct = v.adduct;
    if (v.keepText === true) out.keepText = true;
    return out;
  } catch {
    return undefined;
  }
}

/** After reading a file: tie each saved attached caption to the structure beside it. */
export function fillAttachments(doc: Doc, m: Measure = POINTS): void {
  for (const c of [...doc.captions.values()]) {
    if (!c.attach || c.attach.atoms.length) continue;
    const f = nearestStructure(doc, m.captionBox(c), m, doc.style.bondLength * 6);
    // saved descriptors are taken to match the structure as saved (they are redone when it changes)
    if (f) doc.updateCaption(c.id, { attach: { ...c.attach, atoms: [...f], ...(c.attach.role === 'descriptors' ? { sig: structureSig(doc, f) } : {}) } });
    else doc.updateCaption(c.id, { attach: undefined });
  }
}
