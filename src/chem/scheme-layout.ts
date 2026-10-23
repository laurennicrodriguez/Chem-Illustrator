// Tidying and laying out reaction schemes. Clean Up Reaction spaces each step evenly: starting
// materials in line before the arrow with + signs between them, products after it, conditions
// centred above and below it, and the arrow sized to fit its conditions. Steps that follow on
// from one another (a product that is the next step's starting material) are laid out in turn.

import type { Arrow, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { add, mul } from '../geom';
import type { Measure } from '../editor/arrange';
import { arrowFrame, inFrame, interpretArrow, isReactionArrow, isStep, itemFinder, schemeItems, type Frame, type Item } from './reaction';
import { plainText } from '../richtext';

/** Spacing, as fractions of the bond length (ChemDraw-like: an arrow starts about half a bond from a structure). */
export const SPACING = {
  /** Between an arrow's end and a structure. */
  gap: 0.75,
  /** Either side of a + sign. */
  plus: 0.45,
  /** Between the arrow and the conditions above or below it. */
  conditions: 0.25,
  /** Between lines of conditions stacked on one another. */
  stack: 0.12,
  /** Shortest arrow. */
  minArrow: 2.8,
  /** Extra arrow length beyond the widest condition, at each end. */
  overhang: 0.35,
};

/**
 * The person's own scheme settings (Chemistry > Reactions and Schemes > Scheme Settings): distances in points, or null to
 * follow the drawing's bond length (the fractions above). Used by Clean Up Reaction, Arrange
 * Scheme and the text typed above and below arrows.
 */
export interface SchemePrefs {
  /** Between an arrow's end and the structures. */
  structGap: number | null;
  /** Either side of a + sign. */
  plusGap: number | null;
  /** Between an arrow and the text above or below it. */
  textGap: number | null;
  /** Text above and below arrows: its size (null: the drawing's caption size) and how its lines line up. */
  textSize: number | null;
  textAlign: 'left' | 'center' | 'right';
  /** The "+" boxes above and below new reaction arrows. */
  helpers: boolean;
  /** Arrows grow or shrink to fit their text (moving the products along), when it is typed and on Clean Up. */
  fit: boolean;
  /** With fit: arrow before the text starts, and between the text's end and the arrowhead. */
  lead: number | null;
  headGap: number | null;
}

export const DEFAULT_SCHEME_PREFS: SchemePrefs = { structGap: null, plusGap: null, textGap: null, textSize: null, textAlign: 'center', helpers: true, fit: true, lead: null, headGap: null };

export const schemePrefs: SchemePrefs = { ...DEFAULT_SCHEME_PREFS };

/** Change the scheme settings (from the saved settings or the dialog). */
export function setSchemePrefs(p: Partial<SchemePrefs>): void {
  Object.assign(schemePrefs, p);
}

/** Read saved scheme settings, keeping only what makes sense. */
export function parseSchemePrefs(raw: unknown): SchemePrefs {
  const out = { ...DEFAULT_SCHEME_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  const len = (v: unknown) => (typeof v === 'number' && isFinite(v) && v >= 0 && v <= 500 ? v : null);
  for (const k of ['structGap', 'plusGap', 'textGap', 'lead', 'headGap'] as const) out[k] = len(r[k]);
  out.textSize = len(r.textSize) || null;
  if (r.textAlign === 'left' || r.textAlign === 'center' || r.textAlign === 'right') out.textAlign = r.textAlign;
  if (typeof r.helpers === 'boolean') out.helpers = r.helpers;
  if (typeof r.fit === 'boolean') out.fit = r.fit;
  return out;
}

/** The spacings for a drawing with this bond length, in points. */
export function spacing(bond: number, p: SchemePrefs = schemePrefs) {
  const over = SPACING.overhang * bond;
  return {
    gap: p.structGap ?? SPACING.gap * bond,
    plus: p.plusGap ?? SPACING.plus * bond,
    conditions: p.textGap ?? SPACING.conditions * bond,
    stack: SPACING.stack * bond,
    minArrow: SPACING.minArrow * bond,
    lead: p.lead ?? over,
    headGap: p.headGap ?? over,
  };
}

/** How long an arrow is to fit text this wide (its head this long), as the settings ask. */
export function fittedLength(widest: number, headLength: number, bond: number, p: SchemePrefs = schemePrefs): number {
  const sp = spacing(bond, p);
  return Math.max(sp.minArrow, sp.lead + widest + sp.headGap + headLength);
}

/** Where along an arrow (from its tail) a line of text this wide starts, in a block `widest` wide. */
export function lineStart(width: number, widest: number, length: number, headLength: number, bond: number, p: SchemePrefs = schemePrefs): number {
  const sp = spacing(bond, p);
  // with fitting the block starts after the lead; otherwise it is centred on the arrow's shaft
  const start = p.fit ? sp.lead : (length - headLength - widest) / 2;
  const block = Math.max(0, start);
  return p.textAlign === 'left' ? block : p.textAlign === 'right' ? block + widest - width : block + (widest - width) / 2;
}

export interface SchemePlan {
  /** How far each item moves, by its reference. */
  shifts: Map<string, Vec>;
  /** New ends (and roles) for arrows. */
  arrows: Map<number, { tail: Vec; head: Vec; sweep?: number; step: StepRoles }>;
  /** + signs to add, by the arrow whose step they belong to, centred on the point given. */
  plusses: { arrow: number; at: Vec; role: 'reactants' | 'products' }[];
}

interface Step { arrow: Arrow; roles: StepRoles }

/** The roles Clean Up Reaction works with: chosen by hand, or worked out again from where things are now. */
function rolesFor(r: Arrow, items: Item[], bond: number): StepRoles {
  if (r.step?.manual) return r.step;
  const got = interpretArrow(r, items, bond);
  if (isStep(got) || !r.step) return got;
  return r.step;
}

/** Captions that label a structure (its compound number, say): short text just below it. */
export function labelsOf(items: Item[], used: Set<Item>, doc: Doc, bond: number): Map<Item, Item[]> {
  const out = new Map<Item, Item[]>();
  const structures = items.filter((it) => it.atoms.length);
  const byAtom = new Map<number, Item>();
  for (const s of structures) for (const a of s.atoms) byAtom.set(a, s);
  for (const it of items) {
    if (it.caption === undefined || used.has(it) || it.plus) continue;
    const c = doc.captions.get(it.caption)!;
    // an ID label tied to a structure is its label wherever it sits; other tied captions aren't labels
    if (c.attach) {
      const s = c.attach.role === 'label' ? c.attach.atoms.map((a) => byAtom.get(a)).find((x) => x) : undefined;
      if (s) out.set(s, [...(out.get(s) ?? []), it]);
      continue;
    }
    const text = plainText(c.runs).trim();
    // compound numbers are short: 1, 2a, (±)-3
    if (text.length > 8 || text.includes('\n')) continue;
    const cx = (it.box.x1 + it.box.x2) / 2;
    let best: Item | null = null, bestD = 1.4 * bond;
    for (const s of structures) {
      if (cx < s.box.x1 || cx > s.box.x2) continue;
      const d = it.box.y1 >= s.box.y2 - 2 ? it.box.y1 - s.box.y2 : Infinity;
      if (d < bestD) { best = s; bestD = d; }
    }
    if (best) out.set(best, [...(out.get(best) ?? []), it]);
  }
  return out;
}

/** Point at (t, s) in a frame. */
const at = (f: Frame, t: number, s: number): Vec => add(f.tail, add(mul(f.u, t), mul(f.n, s)));

/** An arrow pointing within a few degrees of across or down the page is set straight. */
function straighten(f: Frame): Frame {
  const ang = Math.atan2(f.u.y, f.u.x);
  const q = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
  if (Math.abs(ang - q) > 4 * (Math.PI / 180)) return f;
  const u = { x: Math.round(Math.cos(q)), y: Math.round(Math.sin(q)) };
  let n = { x: u.y, y: -u.x };
  if (n.y > 1e-9) n = { x: -n.x, y: -n.y };
  return { ...f, u, n };
}

/**
 * Clean Up Reaction: a plan for tidying the steps of these arrows (all reaction arrows when none
 * are given). Returns null when there is no reaction step to tidy.
 */
export function planCleanUp(doc: Doc, m: Measure, arrowIds?: Iterable<number>): SchemePlan | null {
  const bond = doc.style.bondLength;
  const items = schemeItems(doc, m);
  const find = itemFinder(items);
  const ids = arrowIds ? new Set(arrowIds) : null;
  const steps: Step[] = [];
  for (const r of doc.arrows.values()) {
    // (curved arrows, as round a catalytic cycle, are laid out by Chemistry > Reactions and Schemes > Arrange Scheme)
    if ((ids && !ids.has(r.id)) || !isReactionArrow(r) || r.sweep) continue;
    const roles = rolesFor(r, items, bond);
    if (isStep(roles) || roles.above.length || roles.below.length) steps.push({ arrow: r, roles });
  }
  if (!steps.length) return null;

  const used = new Set<Item>();
  for (const { roles } of steps) for (const k of ['reactants', 'products', 'above', 'below', 'plusses'] as const) for (const ref of roles[k] ?? []) { const it = find(ref); if (it) used.add(it); }
  const labels = labelsOf(items, used, doc, bond);

  // steps in order: a step whose starting material is another's product comes after it
  const producedBy = new Map<Item, Step>();
  for (const s of steps) for (const ref of s.roles.products) { const it = find(ref); if (it && !producedBy.has(it)) producedBy.set(it, s); }
  const order: Step[] = [];
  const state = new Map<Step, number>();
  const visit = (s: Step) => {
    if (state.get(s)) return;
    state.set(s, 1);
    for (const ref of s.roles.reactants) { const p = find(ref) && producedBy.get(find(ref)!); if (p && p !== s) visit(p); }
    state.set(s, 2);
    order.push(s);
  };
  for (const s of [...steps].sort((a, b) => a.arrow.tail.x - b.arrow.tail.x || a.arrow.tail.y - b.arrow.tail.y)) visit(s);

  const plan: SchemePlan = { shifts: new Map(), arrows: new Map(), plusses: [] };
  /** Where each item's box is once moved. */
  const placed = new Map<Item, Rect>();
  const boxOf = (it: Item) => placed.get(it) ?? it.box;
  const move = (it: Item, d: Vec) => {
    const old = plan.shifts.get(it.ref) ?? { x: 0, y: 0 };
    plan.shifts.set(it.ref, add(old, d));
    const b = boxOf(it);
    placed.set(it, { x1: b.x1 + d.x, y1: b.y1 + d.y, x2: b.x2 + d.x, y2: b.y2 + d.y });
    for (const l of labels.get(it) ?? []) move(l, d);
  };
  const sp = spacing(bond);
  const g = sp.gap, pg = sp.plus;
  const plusSize = plusBox(doc, m);

  for (const { arrow, roles } of order) {
    let f = straighten(arrowFrame(arrow));
    const R = uniq(roles.reactants.map(find));
    const P = uniq(roles.products.map(find));
    const A = uniq(roles.above.map(find)), B = uniq(roles.below.map(find));
    const plusPool = uniq((roles.plusses ?? []).map(find));
    const span = (its: Item[]) => {
      let t1 = Infinity, t2 = -Infinity, s1 = Infinity, s2 = -Infinity;
      for (const it of its) { const q = inFrame(f, boxOf(it)); t1 = Math.min(t1, q.t1); t2 = Math.max(t2, q.t2); s1 = Math.min(s1, q.s1); s2 = Math.max(s2, q.s2); }
      return { t1, t2, s1, s2 };
    };
    // the starting material nearest the arrow (or one already placed by an earlier step) stays put
    const groupsR = clusters(R.sort((a, b) => inFrame(f, boxOf(b)).t2 - inFrame(f, boxOf(a)).t2), boxOf, f, 0.6 * bond);
    const anchor = groupsR.find((gr) => gr.some((it) => placed.has(it))) ?? groupsR[0];
    if (anchor) {
      const q = span(anchor);
      f = { ...f, tail: at(f, q.t2 + g, (q.s1 + q.s2) / 2) };
    }
    // the arrow fits its conditions
    let widest = 0;
    for (const it of [...A, ...B]) { const q = span([it]); widest = Math.max(widest, q.t2 - q.t1); }
    const headLen = arrow.headStyle !== 'none' || arrow.tailStyle !== 'none' ? arrow.headLength : 0;
    const L = schemePrefs.fit ? fittedLength(widest, headLen, bond) : Math.max(f.length, sp.minArrow);

    const lineUp = (groups: Item[][], start: number, dir: 1 | -1, role: 'reactants' | 'products') => {
      let cursor = start;
      groups.forEach((gr, i) => {
        if (i > 0) {
          const plus = plusPool.shift();
          if (plus) {
            const q = span([plus]);
            const want = dir > 0 ? cursor + pg - q.t1 : cursor - pg - q.t2;
            moveIn(plus, want, -(q.s1 + q.s2) / 2);
            cursor = dir > 0 ? cursor + pg + (q.t2 - q.t1) + pg : cursor - pg - (q.t2 - q.t1) - pg;
          } else {
            const w = plusSize.w;
            const c = dir > 0 ? cursor + pg + w / 2 : cursor - pg - w / 2;
            plan.plusses.push({ arrow: arrow.id, at: at(f, c, 0), role });
            cursor = dir > 0 ? cursor + 2 * pg + w : cursor - 2 * pg - w;
          }
        }
        const q = span(gr);
        if (gr === anchor) { cursor = q.t1; return; }
        if (gr.some((it) => placed.has(it)) && role === 'products') { cursor = q.t2; return; }
        const dt = dir > 0 ? cursor - q.t1 : cursor - q.t2;
        const ds = -(q.s1 + q.s2) / 2;
        for (const it of gr) moveIn(it, dt, ds);
        cursor = dir > 0 ? q.t2 + dt : q.t1 + dt;
      });
    };
    const moveIn = (it: Item, dt: number, ds: number) => move(it, add(mul(f.u, dt), mul(f.n, ds)));

    lineUp(groupsR, -g, -1, 'reactants');
    const groupsP = clusters(P.sort((a, b) => inFrame(f, boxOf(a)).t1 - inFrame(f, boxOf(b)).t1), boxOf, f, 0.6 * bond);
    lineUp(groupsP, L + g, 1, 'products');

    // conditions: stacked from the arrow outwards, each centred along it
    const stackUp = (its: Item[], sign: 1 | -1) => {
      let cursor = sp.conditions;
      const near = (it: Item) => { const q = span([it]); return sign > 0 ? q.s1 : -q.s2; };
      for (const it of its.sort((a, b) => near(a) - near(b))) {
        const q = span([it]);
        const dt = lineStart(q.t2 - q.t1, widest, L, headLen, bond) - q.t1;
        const ds = sign > 0 ? cursor - q.s1 : -cursor - q.s2;
        moveIn(it, dt, ds);
        cursor += q.s2 - q.s1 + sp.stack;
      }
    };
    stackUp(A, 1);
    stackUp(B, -1);

    const fwd = arrow.headStyle !== 'none' || arrow.tailStyle === 'none';
    const start = f.tail, end = at(f, L, 0);
    const step: StepRoles = { ...roles, plusses: [...(roles.plusses ?? [])] };
    plan.arrows.set(arrow.id, { tail: fwd ? start : end, head: fwd ? end : start, step });
  }
  // nothing moved and nothing to add: already tidy
  const moved = [...plan.shifts.values()].some((d) => Math.hypot(d.x, d.y) > 0.01);
  const reshaped = [...plan.arrows].some(([id, a]) => {
    const r = doc.arrows.get(id)!;
    return Math.hypot(r.tail.x - a.tail.x, r.tail.y - a.tail.y) > 0.01 || Math.hypot(r.head.x - a.head.x, r.head.y - a.head.y) > 0.01;
  });
  if (!moved && !reshaped && !plan.plusses.length) {
    // still record the roles, so ChemDraw and later clean-ups know them
    return [...plan.arrows].some(([id, a]) => JSON.stringify(doc.arrows.get(id)!.step) !== JSON.stringify(a.step)) ? plan : null;
  }
  return plan;
}

const uniq = (xs: (Item | undefined)[]): Item[] => [...new Set(xs.filter((x): x is Item => !!x))];

/** Items that touch (a salt's ions) stay together as one group. */
function clusters(its: Item[], boxOf: (it: Item) => Rect, f: Frame, touch: number): Item[][] {
  const out: Item[][] = [];
  for (const it of its) {
    const q = inFrame(f, boxOf(it));
    const last = out[out.length - 1];
    const prev = last && inFrame(f, boxOf(last[last.length - 1]));
    if (prev && Math.max(0, q.t1 - prev.t2, prev.t1 - q.t2) <= touch && Math.max(0, q.s1 - prev.s2, prev.s1 - q.s2) <= touch) last.push(it);
    else out.push([it]);
  }
  return out;
}

/** Size of a + sign in the drawing's caption style. */
function plusBox(doc: Doc, m: Measure): { w: number; h: number } {
  const b = m.captionBox({ id: -1, x: 0, y: 0, runs: [{ text: '+' }], justify: 'left' });
  return { w: b.x2 - b.x1, h: b.y2 - b.y1 };
}

/** Carry out a plan (inside one undoable step). */
export function applySchemePlan(doc: Doc, m: Measure, plan: SchemePlan, label = 'Clean Up Reaction'): void {
  doc.edit(label, () => {
    const items = schemeItems(doc, m);
    const find = itemFinder(items);
    for (const [ref, d] of plan.shifts) {
      if (Math.hypot(d.x, d.y) < 1e-9) continue;
      const it = find(ref);
      if (!it) continue;
      if (it.atoms.length) doc.moveAtoms(it.atoms, d.x, d.y);
      else if (it.caption !== undefined) { const c = doc.captions.get(it.caption)!; doc.updateCaption(c.id, { x: c.x + d.x, y: c.y + d.y }); }
      else if (it.shape !== undefined) { const s = doc.shapes.get(it.shape)!; doc.updateShape(s.id, { x1: s.x1 + d.x, y1: s.y1 + d.y, x2: s.x2 + d.x, y2: s.y2 + d.y }); }
    }
    const added = new Map<number, string[]>();
    for (const p of plan.plusses) {
      const c = doc.addCaption({ x: 0, y: 0, runs: [{ text: '+' }], justify: 'left' });
      const b = m.captionBox(c);
      doc.updateCaption(c.id, { x: p.at.x - (b.x1 + b.x2) / 2, y: p.at.y - (b.y1 + b.y2) / 2 });
      added.set(p.arrow, [...(added.get(p.arrow) ?? []), 'c' + c.id]);
    }
    for (const [id, a] of plan.arrows) {
      const plusses = [...(a.step.plusses ?? []), ...(added.get(id) ?? [])];
      const { plusses: _, ...rest } = a.step;
      const step: StepRoles = plusses.length ? { ...rest, plusses } : rest;
      const patch: Partial<Arrow> = { tail: a.tail, head: a.head, step };
      if (a.sweep !== undefined) patch.sweep = a.sweep;
      doc.updateArrow(id, patch);
    }
  });
}
