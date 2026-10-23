// Text above and below a reaction arrow (reagents and conditions): which captions are there now,
// where a new line goes, setting it from plain text, and fitting the arrow to it. The helper "+"
// boxes on the drawing and the Above/Below fields in the side panel both work through these;
// the gaps, size, alignment and fitting come from the scheme settings (Chemistry > Reactions and Schemes > Scheme Settings).

import type { Arrow, Caption, Doc, Justify, TextRun } from '../model';
import type { Rect, Vec } from '../geom';
import { add, mul } from '../geom';
import type { Measure } from '../editor/arrange';
import { plainText } from '../richtext';
import * as rt from '../richtext';
import { formulaDigits } from '../text/chemtext';
import { arrowFrame, inFrame, isReactionArrow, itemFinder, rolesOf, schemeItems, type Frame, type Item } from './reaction';
import { fittedLength, labelsOf, lineStart, schemePrefs, spacing } from './scheme-layout';

export type ArrowSide = 'above' | 'below';

/** The captions above and below an arrow, nearest the arrow first. */
export function arrowTexts(doc: Doc, m: Measure, r: Arrow): Record<ArrowSide, Caption[]> {
  const roles = rolesOf(r, schemeItems(doc, m), doc.style.bondLength);
  const f = arrowFrame(r);
  const pick = (refs: string[], sign: 1 | -1) => refs
    .filter((ref) => ref[0] === 'c')
    .map((ref) => doc.captions.get(Number(ref.slice(1))))
    .filter((c): c is Caption => !!c)
    .sort((a, b) => near(f, m.captionBox(a), sign) - near(f, m.captionBox(b), sign));
  return { above: pick(roles.above, 1), below: pick(roles.below, -1) };
}

/** How far a box's edge nearest the arrow is from it, on one side. */
const near = (f: Frame, b: Rect, sign: 1 | -1) => { const q = inFrame(f, b); return sign > 0 ? q.s1 : -q.s2; };

/** The arrowhead's length (the text stops short of it). */
const headOf = (r: Arrow) => (r.headStyle !== 'none' || r.tailStyle !== 'none' ? r.headLength : 0);

/** Where the next line of text goes on one side: its near edge `gap` out from the arrow and what is there. */
export function sideSlot(doc: Doc, m: Measure, r: Arrow, side: ArrowSide, have = arrowTexts(doc, m, r)[side]): { mid: Vec; out: Vec; gap: number } {
  const f = arrowFrame(r);
  const sign = side === 'above' ? 1 : -1;
  const sp = spacing(doc.style.bondLength);
  let gap = sp.conditions;
  for (const c of have) {
    const q = inFrame(f, m.captionBox(c));
    gap = Math.max(gap, (sign > 0 ? q.s2 : -q.s1) + sp.stack);
  }
  return { mid: add(f.tail, mul(f.u, (f.length - headOf(r)) / 2)), out: mul(f.n, sign), gap };
}

/** The helper box on one side of an arrow (drawing coordinates): where a click starts the text. */
export function helperBox(doc: Doc, r: Arrow, side: ArrowSide): Rect {
  const f = arrowFrame(r);
  const bond = doc.style.bondLength;
  const shaft = Math.max(1, f.length - headOf(r));
  const w = Math.min(shaft * 0.9, 2.6 * bond), h = textSize(doc) * 1.5;
  const sign = side === 'above' ? 1 : -1;
  const c = add(add(f.tail, mul(f.u, shaft / 2)), mul(f.n, sign * (spacing(bond).conditions + h / 2)));
  return { x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2 };
}

/** Arrows that get helper boxes: straight reaction arrows lying close to level. */
export function takesHelpers(r: Arrow): boolean {
  if (!isReactionArrow(r) || r.sweep || r.from || r.to || r.elbow || r.reagentFor !== undefined) return false;
  const f = arrowFrame(r);
  return f.length > 1 && Math.abs(f.u.y) < 0.26;
}

/** The size new text above and below arrows takes. */
export const textSize = (doc: Doc) => schemePrefs.textSize ?? doc.style.captionSize;

/** How new text's lines line up. */
export const textJustify = (): Justify => schemePrefs.textAlign;

/** The look of new text: the settings' size when it differs from the drawing's caption size. */
export function newTextLook(doc: Doc): Partial<TextRun> {
  return schemePrefs.textSize && schemePrefs.textSize !== doc.style.captionSize ? { size: schemePrefs.textSize } : {};
}

/** Plain text as caption runs: formulas' digits as subscripts, in the look of `like` (its first run). */
export function textRuns(text: string, like?: Partial<TextRun>[]): TextRun[] {
  const base = like?.length ? rt.styleOf({ text: '', ...like[0] }) : {};
  const { sub: _s, sup: _p, ...look } = base;
  const subs = new Set(formulaDigits(text));
  const runs: TextRun[] = [];
  for (let i = 0; i < text.length; i++) runs.push({ ...look, text: text[i], ...(subs.has(i) ? { sub: true } : {}) });
  return rt.normalizeRuns(runs);
}

/**
 * Line the text up on both sides of an arrow as the settings say: stacked out from it, along it
 * from the lead-in (fitting) or centred on its shaft. Call inside an edit.
 */
export function lineUpText(doc: Doc, m: Measure, r: Arrow): void {
  const t = arrowTexts(doc, m, r);
  const f = arrowFrame(r);
  const bond = doc.style.bondLength;
  const sp = spacing(bond);
  const all = [...t.above, ...t.below];
  const widest = Math.max(0, ...all.map((c) => { const q = inFrame(f, m.captionBox(c)); return q.t2 - q.t1; }));
  for (const [side, sign] of [['above', 1], ['below', -1]] as const) {
    let cursor = sp.conditions;
    for (const c of t[side]) {
      const q = inFrame(f, m.captionBox(c));
      const dt = lineStart(q.t2 - q.t1, widest, f.length, headOf(r), bond) - q.t1;
      const ds = sign > 0 ? cursor - q.s1 : -cursor - q.s2;
      const d = add(mul(f.u, dt), mul(f.n, ds));
      if (Math.hypot(d.x, d.y) > 1e-6) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y });
      cursor += q.s2 - q.s1 + sp.stack;
    }
  }
}

/**
 * Fit the arrow to its text (when the settings ask): lengthen or shorten it from the head end,
 * moving the products (and their numbers and + signs) along with the head, then line the text up.
 * Call inside an edit.
 */
export function fitArrowToText(doc: Doc, m: Measure, r0: Arrow): void {
  const r = doc.arrows.get(r0.id);
  if (!r) return;
  if (!schemePrefs.fit) { lineUpText(doc, m, r); return; }
  const t = arrowTexts(doc, m, r);
  const all = [...t.above, ...t.below];
  if (!all.length) return;
  const f = arrowFrame(r);
  const widest = Math.max(...all.map((c) => { const q = inFrame(f, m.captionBox(c)); return q.t2 - q.t1; }));
  const bond = doc.style.bondLength;
  const L = fittedLength(widest, headOf(r), bond);
  const dl = L - f.length;
  if (Math.abs(dl) > 0.01) {
    const d = mul(f.u, dl);
    // the frame runs tail to head the way the arrow points: move whichever end is the head
    const fwd = r.headStyle !== 'none' || r.tailStyle === 'none';
    doc.updateArrow(r.id, fwd ? { head: add(r.head, d) } : { tail: add(r.tail, d) });
    // the products, their + signs and the numbers under them move with the head
    const items = schemeItems(doc, m);
    const find = itemFinder(items);
    const roles = rolesOf(r, items, bond);
    const products = new Set(roles.products.map(find).filter((x): x is Item => !!x));
    for (const ref of roles.plusses ?? []) {
      const p = find(ref);
      if (p && inFrame(f, p.box).t1 > f.length * 0.5) products.add(p);
    }
    const used = new Set<Item>();
    for (const k of ['reactants', 'products', 'above', 'below'] as const) for (const ref of roles[k]) { const it = find(ref); if (it) used.add(it); }
    const labels = labelsOf(items, used, doc, bond);
    const moving = new Set<Item>();
    for (const it of products) { moving.add(it); for (const l of labels.get(it) ?? []) moving.add(l); }
    for (const it of moving) moveItem(doc, it, d);
  }
  lineUpText(doc, m, doc.arrows.get(r.id)!);
}

function moveItem(doc: Doc, it: Item, d: Vec): void {
  if (it.atoms.length) doc.moveAtoms(it.atoms, d.x, d.y);
  else if (it.caption !== undefined) { const c = doc.captions.get(it.caption); if (c) doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y }); }
  else if (it.shape !== undefined) { const s = doc.shapes.get(it.shape); if (s) doc.updateShape(s.id, { x1: s.x1 + d.x, y1: s.y1 + d.y, x2: s.x2 + d.x, y2: s.y2 + d.y }); }
}

/** A caption just added beside an arrow: counted as its text, then the arrow fitted and the text lined up. */
export function adoptSideCaption(doc: Doc, m: Measure, r0: Arrow, id: number, side: ArrowSide): void {
  const r = doc.arrows.get(r0.id);
  const c = doc.captions.get(id);
  if (!r || !c) return;
  // first centred along the shaft, so however long it is it reads as this arrow's text; fitting
  // and lining up then put it exactly
  const f = arrowFrame(r);
  const q = inFrame(f, m.captionBox(c));
  const d = mul(f.u, (f.length - headOf(r)) / 2 - (q.t1 + q.t2) / 2);
  if (Math.hypot(d.x, d.y) > 1e-6) doc.updateCaption(id, { x: c.x + d.x, y: c.y + d.y });
  if (r.step && !r.step[side].includes('c' + id)) doc.updateArrow(r.id, { step: { ...r.step, [side]: [...r.step[side], 'c' + id] } });
  fitArrowToText(doc, m, doc.arrows.get(r.id)!);
}

/**
 * Set the text on one side of an arrow from plain text (the side panel's fields): changes the
 * nearest caption there, or adds one, or removes it when the text is emptied. Call inside an edit.
 */
export function setSideText(doc: Doc, m: Measure, r: Arrow, side: ArrowSide, text: string): void {
  const have = arrowTexts(doc, m, r)[side];
  const cur = have[0];
  const t = text.replace(/\r/g, '').replace(/\s+$/, '');
  if (cur) {
    if (plainText(cur.runs) === t) return;
    if (!t.trim()) doc.removeCaption(cur.id);
    else doc.updateCaption(cur.id, { runs: textRuns(t, cur.runs) });
    fitArrowToText(doc, m, r);
    return;
  }
  if (!t.trim()) return;
  const slot = sideSlot(doc, m, r, side, have);
  const at = add(slot.mid, mul(slot.out, slot.gap));
  const c = doc.addCaption({ x: at.x, y: at.y, runs: textRuns(t, [newTextLook(doc)]), justify: textJustify() });
  // a first rough place on this side; adopting it centres it, fitting puts it exactly
  const f = arrowFrame(r);
  const q = inFrame(f, m.captionBox(c));
  const ds = side === 'above' ? slot.gap - q.s1 : -slot.gap - q.s2;
  doc.updateCaption(c.id, { x: c.x + f.n.x * ds, y: c.y + f.n.y * ds });
  adoptSideCaption(doc, m, r, c.id, side);
}
