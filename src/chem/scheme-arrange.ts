// Arranging a whole scheme in one go, like SmartArt: the steps of the selected scheme (or the
// selected structures, joined by new arrows in reading order) are set out in a line, in rows,
// in a snake, down the page, round a catalytic cycle, or as a branching tree. Conditions stay
// with their arrows and compound numbers with their structures, so a scheme can be switched
// from one arrangement to another and back.

import type { Arrow, Doc, StepRoles } from '../model';
import type { Rect, Vec } from '../geom';
import { add, mul, sub, fromAngle, dist } from '../geom';
import type { Measure } from '../editor/arrange';
import { arrowFrame, inFrame, interpretArrow, isReactionArrow, isStep, itemFinder, schemeItems, type Item } from './reaction';
import { labelsOf, spacing, fittedLength } from './scheme-layout';
import { sweepThrough } from '../objects';

export type ArrangeKind = 'line' | 'rows' | 'snake' | 'down' | 'cycle' | 'tree';

export interface ArrangeOptions {
  kind: ArrangeKind;
  /** Rows and snake: arrows in each row. */
  perRow?: number;
  /** Cycle: go round anticlockwise (clockwise by default). */
  anticlockwise?: boolean;
  /** Cycle: conditions come in (above) and go out (below) on small curved arrows. */
  reagentArrows?: boolean;
  /** Cycle: the node holding this item (a reference such as 'c12') comes first, at `startAngle`. */
  start?: string;
  /** Cycle: where the first node goes round the circle, in radians (−π/2, the top, by default; y points down). */
  startAngle?: number;
  /** Branching: the arrows from one structure to several fan out from one point (a forked arrow). */
  forked?: boolean;
}

/** What is selected: ids of atoms, captions, shapes and arrows (all empty: the whole drawing). */
export interface Scope { atoms: Set<number>; captions: Set<number>; shapes: Set<number>; arrows: Set<number> }

/** A structure, or starting materials joined by + signs, that the scheme leads into or out of. */
interface Node { items: Item[]; box: Rect }
/** One step: an arrow (made new when there isn't one) from one node to the next, with its conditions. */
interface Link { from: number; to: number; arrow?: Arrow; above: Item[]; below: Item[]; plusses: Item[]; inside: Item[] }

export interface SchemeShape {
  nodes: Node[];
  links: Link[];
  /** The nodes in order, when the steps make a single line (or a closed loop). */
  path: number[] | null;
  /** The last step leads back to the first node. */
  closed: boolean;
  /** Captions in the selection that belong to no step (a catalyst's name, for a cycle's middle). */
  loose: Item[];
  labels: Map<Item, Item[]>;
}

export interface NewArrow {
  tail: Vec; head: Vec; sweep: number; step?: StepRoles;
  /** A small arrow bringing a reagent into a cycle's step or taking a by-product out: the step's arrow (existing, or the index of one added). */
  small?: boolean;
  reagentOf?: { arrow?: number; added?: number };
}

export interface ArrangePlan {
  shifts: Map<string, Vec>;
  /** Existing arrows: new ends, bend and roles. */
  arrows: Map<number, NewArrow>;
  /** Arrows to add. */
  added: NewArrow[];
  /** Reagent arrows of an earlier arrangement, to take away. */
  removed: number[];
}

const union = (a: Rect | null, b: Rect): Rect => (a ? { x1: Math.min(a.x1, b.x1), y1: Math.min(a.y1, b.y1), x2: Math.max(a.x2, b.x2), y2: Math.max(a.y2, b.y2) } : { ...b });
const centre = (r: Rect): Vec => ({ x: (r.x1 + r.x2) / 2, y: (r.y1 + r.y2) / 2 });
const width = (r: Rect) => r.x2 - r.x1, height = (r: Rect) => r.y2 - r.y1;

/** Read the selected scheme: its nodes and steps, and whether they run in one line. */
export function readScheme(doc: Doc, m: Measure, scope: Scope): SchemeShape {
  const bond = doc.style.bondLength;
  const items = schemeItems(doc, m);
  const find = itemFinder(items);
  const all = !scope.atoms.size && !scope.captions.size && !scope.shapes.size && !scope.arrows.size;
  const inScope = (it: Item) => all || it.atoms.some((a) => scope.atoms.has(a)) || (it.caption !== undefined && scope.captions.has(it.caption)) || (it.shape !== undefined && scope.shapes.has(it.shape));

  // the steps of the selected arrows
  const steps: { arrow: Arrow; roles: StepRoles }[] = [];
  for (const r of doc.arrows.values()) {
    if (!(all || scope.arrows.has(r.id)) || !isReactionArrow(r)) continue;
    // roles kept with the arrow (by hand, by an earlier arrangement or tidy, or from the file) stay,
    // as long as what they name is still there, so a scheme can be rearranged again and again
    const kept = r.step && [...r.step.reactants, ...r.step.products].every((ref) => find(ref)) ? r.step : null;
    const roles = kept ?? interpretArrow(r, items, bond);
    if (isStep(roles)) steps.push({ arrow: r, roles });
  }

  // nodes: the starting materials of a step (with their + signs) are one node, its products another;
  // a product that is the next step's starting material makes the two the same node
  const parent = new Map<Item, Item>();
  const top = (x: Item): Item => { const p = parent.get(x) ?? x; if (p === x) return x; const t = top(p); parent.set(x, t); return t; };
  const join = (xs: Item[]) => { for (const x of xs) if (!parent.has(x)) parent.set(x, x); for (let i = 1; i < xs.length; i++) parent.set(top(xs[i]), top(xs[0])); };
  const side = steps.map(({ arrow, roles }) => {
    const f = arrowFrame(arrow);
    const r = uniq(roles.reactants.map(find)), p = uniq(roles.products.map(find));
    const plus = uniq((roles.plusses ?? []).map(find));
    const mid = (it: Item) => { const q = inFrame(f, it.box); return (q.t1 + q.t2) / 2; };
    const rp = plus.filter((x) => mid(x) < f.length / 2), pp = plus.filter((x) => mid(x) >= f.length / 2);
    join([...r, ...rp]);
    join([...p, ...pp]);
    return { r, p, rp, pp, above: uniq(roles.above.map(find)), below: uniq(roles.below.map(find)), inside: uniq((roles.inside ?? []).map(find)) };
  });
  const used = new Set<Item>();
  for (const s of side) for (const it of [...s.r, ...s.p, ...s.rp, ...s.pp, ...s.above, ...s.below, ...s.inside]) used.add(it);
  const labels = labelsOf(items, used, doc, bond);
  const labelled = new Set([...labels.values()].flat());

  const nodeOf = new Map<Item, number>();
  const nodes: Node[] = [];
  const nodeFor = (it: Item): number => {
    const t = top(it);
    let n = nodeOf.get(t);
    if (n === undefined) { n = nodes.length; nodes.push({ items: [], box: { ...it.box } }); nodeOf.set(t, n); }
    return n;
  };
  for (const it of parent.keys()) { const n = nodeFor(it); nodes[n].items.push(it); nodes[n].box = union(nodes[n].box, it.box); }
  const links: Link[] = side.map((s, i) => ({
    from: s.r.length ? nodeOf.get(top(s.r[0]))! : -1,
    to: s.p.length ? nodeOf.get(top(s.p[0]))! : -1,
    arrow: steps[i].arrow, above: s.above, below: s.below, plusses: [...s.rp, ...s.pp], inside: s.inside,
  })).filter((l) => l.from >= 0 && l.to >= 0 && l.from !== l.to);

  // structures in the selection that are in no step yet join the end, in reading order
  const loose: Item[] = [];
  const extra: Item[] = [];
  for (const it of items) {
    if (!inScope(it) || used.has(it) || labelled.has(it)) continue;
    if (it.atoms.length || it.shape !== undefined) extra.push(it);
    else if (!it.plus) loose.push(it);
  }
  const reading = readingOrder(extra, bond);
  for (const it of reading) { const n = nodes.length; nodes.push({ items: [it], box: { ...it.box } }); nodeOf.set(it, n); parent.set(it, it); }

  const { path, closed } = chainOf(nodes.length, links, reading.map((it) => nodeOf.get(it)!), nodes);
  return { nodes, links, path, closed, loose, labels };
}

const uniq = (xs: (Item | undefined)[]): Item[] => [...new Set(xs.filter((x): x is Item => !!x))];

/** Left to right along rows, rows top to bottom. */
export function readingOrder(its: Item[], bond: number): Item[] {
  const rows: Item[][] = [];
  for (const it of [...its].sort((a, b) => centre(a.box).y - centre(b.box).y)) {
    const row = rows.find((r) => Math.abs(centre(r[0].box).y - centre(it.box).y) < 3 * bond);
    if (row) row.push(it); else rows.push([it]);
  }
  return rows.flatMap((r) => r.sort((a, b) => centre(a.box).x - centre(b.box).x));
}

/**
 * The nodes in order when every node has at most one step in and one out (a closed loop when the
 * last leads back to the first). Nodes in no step are added at the end, joined by new steps.
 */
function chainOf(n: number, links: Link[], extra: number[], nodes: Node[]): { path: number[] | null; closed: boolean } {
  const out = new Map<number, Link>(), into = new Map<number, Link>();
  for (const l of links) {
    if (out.has(l.from) || into.has(l.to)) return { path: null, closed: false };
    out.set(l.from, l);
    into.set(l.to, l);
  }
  const inSteps = [...new Set(links.flatMap((l) => [l.from, l.to]))];
  let start = inSteps.find((i) => !into.has(i));
  let closed = false;
  if (start === undefined && inSteps.length) {
    // a loop: start at the top
    closed = true;
    start = inSteps.reduce((a, b) => (nodes[b].box.y1 < nodes[a].box.y1 ? b : a));
  }
  const path: number[] = [];
  const seen = new Set<number>();
  for (let i = start; i !== undefined && !seen.has(i); i = out.get(i)?.to) { seen.add(i); path.push(i); }
  if (inSteps.some((i) => !seen.has(i))) return { path: null, closed: false };
  for (const i of extra) {
    if (seen.has(i)) continue;
    if (path.length) links.push({ from: path[path.length - 1], to: i, above: [], below: [], plusses: [], inside: [] });
    path.push(i);
    seen.add(i);
  }
  void n;
  return { path, closed };
}

/** Lay the scheme out. Null when it can't be laid out this way (steps that branch, for all but a tree). */
export function planArrange(doc: Doc, m: Measure, scope: Scope, opts: ArrangeOptions): ArrangePlan | null {
  const sh = readScheme(doc, m, scope);
  if (sh.nodes.length < 2 && !(opts.kind === 'cycle' && sh.nodes.length >= 1)) return null;
  if (opts.kind !== 'tree' && !sh.path) return null;
  const bond = doc.style.bondLength;
  const L = new Layout(sh, bond);
  switch (opts.kind) {
    case 'line': L.rows(Infinity, false); break;
    case 'rows': L.rows(Math.max(1, opts.perRow ?? 3), false); break;
    case 'snake': L.rows(Math.max(1, opts.perRow ?? 3), true); break;
    case 'down': L.down(); break;
    case 'cycle': L.cycle(!!opts.anticlockwise, !!opts.reagentArrows, opts.start, opts.startAngle); break;
    case 'tree': L.tree(!!opts.forked); break;
  }
  // reagent arrows from an earlier arrangement of these steps go (a new cycle draws its own)
  const mine = new Set(sh.links.map((l) => l.arrow?.id).filter((x) => x !== undefined));
  for (const r of doc.arrows.values()) if (r.reagentFor !== undefined && mine.has(r.reagentFor)) L.plan.removed.push(r.id);
  return L.plan;
}

class Layout {
  plan: ArrangePlan = { shifts: new Map(), arrows: new Map(), added: [], removed: [] };
  private g: number;
  private origin: Vec;
  /** Where each node's box is once placed. */
  private at = new Map<number, Rect>();

  constructor(private sh: SchemeShape, private bond: number) {
    this.g = spacing(bond).gap;
    let b: Rect | null = null;
    for (const n of sh.nodes) b = union(b, n.box);
    for (const l of sh.links) if (l.arrow) b = union(b, { x1: Math.min(l.arrow.tail.x, l.arrow.head.x), y1: Math.min(l.arrow.tail.y, l.arrow.head.y), x2: Math.max(l.arrow.tail.x, l.arrow.head.x), y2: Math.max(l.arrow.tail.y, l.arrow.head.y) });
    this.origin = { x: b!.x1, y: b!.y1 };
  }

  // ---------------------------------------------------------------- moving things

  private shift(it: Item, d: Vec): void {
    const old = this.plan.shifts.get(it.ref) ?? { x: 0, y: 0 };
    this.plan.shifts.set(it.ref, add(old, d));
    for (const l of this.sh.labels.get(it) ?? []) this.shift(l, d);
  }

  /** Put a node's box centre at `c`. */
  private placeNode(i: number, c: Vec): void {
    const n = this.sh.nodes[i];
    const d = sub(c, centre(n.box));
    for (const it of n.items) this.shift(it, d);
    this.at.set(i, { x1: n.box.x1 + d.x, y1: n.box.y1 + d.y, x2: n.box.x2 + d.x, y2: n.box.y2 + d.y });
  }

  /** Length of a straight arrow along `u` that fits its conditions. */
  private arrowLength(l: Link, u: Vec): number {
    let widest = 0;
    for (const it of [...l.above, ...l.below]) widest = Math.max(widest, Math.abs(u.x) * width(it.box) + Math.abs(u.y) * height(it.box));
    return fittedLength(widest, l.arrow?.headLength ?? DEFAULT_ARROW.headLength, this.bond);
  }

  /** How far a link's conditions reach out on each side of a straight arrow along `u`. */
  private reach(l: Link, u: Vec): { above: number; below: number } {
    const across = (it: Item) => Math.abs(u.y) * width(it.box) + Math.abs(u.x) * height(it.box);
    const sp = spacing(this.bond);
    const stack = (its: Item[]) => (its.length ? sp.conditions + its.reduce((s, it) => s + across(it), 0) + (its.length - 1) * sp.stack : 0);
    return { above: stack(l.above), below: stack([...l.inside, ...l.below]) };
  }

  /** A straight arrow from tail to head, with its conditions stacked on it as Clean Up Reaction does. */
  private straight(l: Link, tail: Vec, head: Vec): void {
    const r: NewArrow = { tail, head, sweep: 0, step: this.stepOf(l) };
    if (l.arrow) this.plan.arrows.set(l.arrow.id, r); else this.plan.added.push(r);
    const f = arrowFrame({ ...(l.arrow ?? DEFAULT_ARROW), tail, head, sweep: 0 } as Arrow);
    const pt = (t: number, s: number) => add(f.tail, add(mul(f.u, t), mul(f.n, s)));
    const stackUp = (its: Item[], sign: 1 | -1) => {
      let cursor = spacing(this.bond).conditions;
      for (const it of its) {
        const q = inFrame(f, it.box);
        const d = sign > 0 ? cursor - q.s1 : -cursor - q.s2;
        const target = pt(f.length / 2 - (q.t1 + q.t2) / 2, d);
        this.shift(it, sub(target, f.tail));
        cursor += q.s2 - q.s1 + spacing(this.bond).stack;
      }
    };
    const near = (sign: 1 | -1) => (it: Item) => { const q = inFrame(f, it.box); return sign > 0 ? q.s1 : -q.s2; };
    stackUp([...l.above].sort((a, b) => near(1)(a) - near(1)(b)), 1);
    // a cycle's step names go under the arrow when the scheme is laid out in a line
    stackUp([...l.inside, ...l.below].sort((a, b) => near(-1)(a) - near(-1)(b)), -1);
  }

  private stepOf(l: Link): StepRoles {
    const n = (i: number) => this.sh.nodes[i].items.filter((it) => !it.plus).map((it) => it.ref);
    return {
      reactants: n(l.from), products: n(l.to),
      above: l.above.map((it) => it.ref), below: l.below.map((it) => it.ref),
      ...(l.plusses.length ? { plusses: l.plusses.map((it) => it.ref) } : {}),
      ...(l.inside.length ? { inside: l.inside.map((it) => it.ref) } : {}),
    };
  }

  private linkBetween(a: number, b: number): Link {
    return this.sh.links.find((l) => l.from === a && l.to === b)!;
  }

  // ---------------------------------------------------------------- rows (a line, rows, a snake)

  /**
   * Rows of `per` arrows each. A new row starts with its arrow at the left (ACS style); in a
   * snake the scheme turns down at the end of a row and the next row runs back the other way.
   */
  rows(per: number, snake: boolean): void {
    const path = this.sh.path!, nodes = this.sh.nodes, g = this.g, bond = this.bond;
    const right = { x: 1, y: 0 }, down = { x: 0, y: 1 };
    const link = (k: number) => this.linkBetween(path[k], path[k + 1]);
    const rowsOf: number[][] = [[]];
    for (let k = 0; k < path.length - 1; k++) {
      if (rowsOf[rowsOf.length - 1].length >= per) rowsOf.push([]);
      rowsOf[rowsOf.length - 1].push(k);
    }
    // how far a row reaches above and below its middle line
    const extent = (ks: number[], withFirst: boolean) => {
      let up = 0, dn = 0;
      const ns = ks.map((k) => path[k + 1]);
      if (withFirst && ks.length) ns.push(path[ks[0]]);
      for (const i of ns) { const h = height(nodes[i].box) / 2; up = Math.max(up, h); dn = Math.max(dn, h); }
      for (const k of ks) { const r = this.reach(link(k), right); up = Math.max(up, r.above); dn = Math.max(dn, r.below); }
      return { up, dn };
    };
    /** Lay out one row's arrows and the nodes after them, from x going `dir`. */
    const lay = (ks: number[], x: number, axis: number, dir: 1 | -1) => {
      for (const k of ks) {
        const l = link(k);
        const len = this.arrowLength(l, right);
        this.straight(l, { x, y: axis }, { x: x + dir * len, y: axis });
        x += dir * (len + g);
        const b = path[k + 1], w = width(nodes[b].box);
        this.placeNode(b, { x: x + dir * w / 2, y: axis });
        x += dir * (w + g);
      }
    };
    // the first row starts with the first node
    let { up, dn } = extent(rowsOf[0], true);
    let axis = this.origin.y + up;
    const w0 = width(nodes[path[0]].box);
    this.placeNode(path[0], { x: this.origin.x + w0 / 2, y: axis });
    lay(rowsOf[0], this.origin.x + w0 + g, axis, 1);
    let dir: 1 | -1 = 1;
    for (let r = 1; r < rowsOf.length; r++) {
      const ks = rowsOf[r];
      if (!snake) {
        // the next row starts at the left with its arrow
        const e = extent(ks, false);
        axis += dn + 1.6 * bond + e.up;
        dn = e.dn;
        lay(ks, this.origin.x, axis, 1);
        continue;
      }
      // a snake: a down arrow from the end of the row above to the first node of this row, under it
      const kDown = ks[0];
      const from = this.at.get(path[kDown])!, to = path[kDown + 1];
      const e = extent(ks.slice(1), true);
      let low = -Infinity;
      for (const bx of this.at.values()) low = Math.max(low, bx.y2);
      const dl = link(kDown);
      const len = Math.max(this.arrowLength(dl, down) * 0.8, 2.2 * bond);
      const tail = { x: (from.x1 + from.x2) / 2, y: from.y2 + g };
      let head = { x: tail.x, y: tail.y + len };
      const want = Math.max(low + 1.6 * bond + e.up, head.y + g + height(nodes[to].box) / 2);
      head = { x: tail.x, y: want - g - height(nodes[to].box) / 2 };
      this.straight(dl, tail, head);
      axis = want;
      dn = e.dn;
      this.placeNode(to, { x: tail.x, y: axis });
      dir = dir > 0 ? -1 : 1;
      const tb = this.at.get(to)!;
      lay(ks.slice(1), dir > 0 ? tb.x2 + g : tb.x1 - g, axis, dir);
    }
    this.closeLoop();
  }

  /**
   * In anything but a cycle, the step from the last node back to the first is a return arrow
   * round the outside: under the rows, or (down the page) up the left side.
   */
  private closeLoop(side: 'below' | 'left' = 'below'): void {
    const path = this.sh.path!;
    if (!this.sh.closed || path.length < 2) return;
    const a = this.at.get(path[path.length - 1])!, b = this.at.get(path[0])!;
    const l = this.linkBetween(path[path.length - 1], path[0]);
    let all: Rect | null = null;
    for (const r of this.at.values()) all = union(all, r);
    const off = 1.2 * this.bond;
    if (side === 'below') {
      const y = all!.y2 + off + this.reach(l, { x: 1, y: 0 }).above;
      this.straight(l, { x: centre(a).x, y }, { x: centre(b).x, y });
    } else {
      const x = all!.x1 - off - this.reach(l, { x: 0, y: -1 }).above;
      this.straight(l, { x, y: centre(a).y }, { x, y: centre(b).y });
    }
  }

  // ---------------------------------------------------------------- down the page

  down(): void {
    const path = this.sh.path!, nodes = this.sh.nodes, g = this.g;
    const dn = { x: 0, y: 1 };
    const link = (k: number) => this.linkBetween(path[k], path[k + 1]);
    // the column's middle: room on the left for the widest structure and the conditions below the arrows
    let left = 0;
    for (const i of path) left = Math.max(left, width(nodes[i].box) / 2);
    for (let k = 0; k < path.length - 1; k++) left = Math.max(left, this.reach(link(k), dn).below);
    const x = this.origin.x + left;
    let y = this.origin.y;
    for (let k = 0; k < path.length; k++) {
      const h = height(nodes[path[k]].box);
      this.placeNode(path[k], { x, y: y + h / 2 });
      y += h + g;
      if (k === path.length - 1) break;
      const l = link(k);
      const len = this.arrowLength(l, dn);
      this.straight(l, { x, y }, { x, y: y + len });
      y += len + g;
    }
    this.closeLoop('left');
  }

  // ---------------------------------------------------------------- catalytic cycle

  cycle(anticlockwise: boolean, reagentArrows: boolean, start?: string, startAngle = -Math.PI / 2): void {
    const nodes = this.sh.nodes, g = this.g, bond = this.bond;
    let path = this.sh.path!;
    const N = path.length;
    // a cycle closes on itself: add the step back to the start when it isn't there yet
    if (!this.sh.closed && N > 1) this.sh.links.push({ from: path[N - 1], to: path[0], above: [], below: [], plusses: [], inside: [] });
    // round a loop, any node can come first
    const first = start === undefined ? -1 : path.findIndex((i) => nodes[i].items.some((it) => it.ref === start));
    if (first > 0) path = this.sh.path = [...path.slice(first), ...path.slice(0, first)];
    const link = (k: number) => this.linkBetween(path[k], path[(k + 1) % N]);
    const size = (i: number) => Math.hypot(width(nodes[i].box), height(nodes[i].box));
    // a circle big enough for the structures with room for arrows between them
    let R = Math.max(3 * bond, path.reduce((s, i) => s + size(i) + 3 * bond, 0) / (2 * Math.PI));
    const sign = anticlockwise ? -1 : 1;
    const angle = (k: number) => startAngle + sign * (2 * Math.PI * k) / N;
    let reach = 0;
    for (const i of path) reach = Math.max(reach, size(i) / 2);
    const cen = { x: this.origin.x + R + reach, y: this.origin.y + R + reach };
    const boxAt = (i: number, c: Vec): Rect => { const b = nodes[i].box, w = width(b) / 2, h = height(b) / 2; return { x1: c.x - w - g, y1: c.y - h - g, x2: c.x + w + g, y2: c.y + h + g }; };
    const inside = (r: Rect, p: Vec) => p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2;
    // how far a caption reaches along the radius at angle a (half its box, seen that way)
    const radial = (it: Item, a: number) => { const d = fromAngle(a, 1); return Math.abs(d.x) * width(it.box) / 2 + Math.abs(d.y) * height(it.box) / 2; };
    const middle = this.sh.loose.length === 1 ? Math.hypot(width(this.sh.loose[0].box), height(this.sh.loose[0].box)) / 2 : 0;
    // the arc from one structure to the next starts and ends where the circle leaves their boxes
    const ends = (k: number) => {
      const a0 = angle(k), a1 = angle(k + 1);
      const ba = boxAt(path[k], add(cen, fromAngle(a0, R))), bb = boxAt(path[(k + 1) % N], add(cen, fromAngle(a1, R)));
      const steps = 200;
      let s = a0, e = a1;
      for (let j = 0; j <= steps; j++) { const t = a0 + ((a1 - a0) * j) / steps; if (!inside(ba, add(cen, fromAngle(t, R)))) { s = t; break; } }
      for (let j = 0; j <= steps; j++) { const t = a1 - ((a1 - a0) * j) / steps; if (!inside(bb, add(cen, fromAngle(t, R)))) { e = t; break; } }
      return { s, e };
    };
    // grow the circle until every arc has room
    for (let tries = 0; tries < 20; tries++) {
      let ok = true;
      for (let k = 0; k < N && N > 1; k++) {
        const { s, e } = ends(k);
        // each arc needs room for its arrowhead, and for its conditions alongside it
        const l = link(k);
        const need = Math.max(2.8 * bond, ...[...l.above, ...l.below, ...l.inside].map((it) => 0.9 * Math.max(width(it.box), height(it.box))));
        if (sign * (e - s) * R < need) { ok = false; break; }
        // and the step names inside need room clear of the middle (and of the catalyst's name there)
        const inward = [...l.inside, ...(reagentArrows ? [] : l.below)].reduce((d, it) => d + 2 * radial(it, (s + e) / 2) + spacing(bond).stack, spacing(bond).conditions * 2);
        if (inward > spacing(bond).conditions * 2 && R - inward < middle + g) { ok = false; break; }
      }
      if (ok) break;
      R *= 1.15;
      cen.x = this.origin.x + R + reach;
      cen.y = this.origin.y + R + reach;
    }
    path.forEach((i, k) => this.placeNode(i, add(cen, fromAngle(angle(k), R))));
    if (N < 2) return;
    for (let k = 0; k < N; k++) {
      const l = link(k);
      const { s, e } = ends(k);
      const tail = add(cen, fromAngle(s, R)), head = add(cen, fromAngle(e, R));
      const mid = add(cen, fromAngle((s + e) / 2, R));
      const sweep = sweepThrough(tail, head, mid);
      const r: NewArrow = { tail, head, sweep, step: this.stepOf(l) };
      if (l.arrow) this.plan.arrows.set(l.arrow.id, r); else this.plan.added.push(r);
      // conditions sit outside the circle by the middle of their arc (those below the arrow inside it,
      // or with reagent arrows: coming in before the middle and going out after it)
      // (returns how far out from the circle, or in, the last one reaches)
      const out = (its: Item[], a: number, inward: boolean, from = spacing(bond).conditions * 2) => {
        const rad = fromAngle(a, 1);
        let dist0 = inward ? -from : from;
        for (const it of its) {
          const ext = radial(it, a);
          const c = add(cen, mul(rad, R + dist0 + (inward ? -ext : ext)));
          this.shift(it, sub(c, centre(it.box)));
          dist0 += (inward ? -1 : 1) * (2 * ext + spacing(bond).stack);
        }
        return Math.abs(dist0);
      };
      const amid = (s + e) / 2;
      // the step's name inside the circle, nearest the arc
      const inner = l.inside.length ? out(l.inside, amid, true) : spacing(bond).conditions * 2;
      if (reagentArrows) {
        const dirA = Math.sign(e - s) || 1, span = Math.abs(e - s);
        const d = 1.5 * bond, delta = Math.min(span * 0.3, (1.6 * bond) / R);
        const pt = (a: number, r: number) => add(cen, fromAngle(a, r));
        const owner = l.arrow ? { arrow: l.arrow.id } : { added: this.plan.added.length - 1 };
        if (l.above.length) {
          const touch = s + (e - s) * 0.38, far = touch - dirA * delta;
          const tail = pt(far, R + d), head = pt(touch, R + 0.12 * bond);
          this.plan.added.push({ tail, head, sweep: sweepThrough(tail, head, pt(touch - dirA * delta * 0.3, R + d * 0.7)), small: true, reagentOf: owner });
          out(l.above, far, false, d + 0.3 * bond);
        }
        if (l.below.length) {
          const touch = s + (e - s) * 0.62, far = touch + dirA * delta;
          const tail = pt(touch, R + 0.12 * bond), head = pt(far, R + d);
          this.plan.added.push({ tail, head, sweep: sweepThrough(tail, head, pt(touch + dirA * delta * 0.3, R + d * 0.7)), small: true, reagentOf: owner });
          out(l.below, far, false, d + 0.3 * bond);
        }
      } else {
        out(l.above, amid, false);
        out(l.below, amid, true, inner);
      }
    }
    // a caption on its own (the catalyst's name) goes in the middle
    if (this.sh.loose.length === 1) { const it = this.sh.loose[0]; this.shift(it, sub(cen, centre(it.box))); }
  }

  // ---------------------------------------------------------------- branching tree

  tree(forked = false): void {
    const { nodes, links } = this.sh;
    const g = this.g, bond = this.bond;
    // columns: how many steps lead to each node (the longest way)
    const depth = new Map<number, number>();
    const inLinks = (i: number) => links.filter((l) => l.to === i);
    // steps that lead back to an earlier node (a loop) don't count
    const back = new Set<Link>();
    const state = new Map<number, number>();
    const dfs = (i: number) => {
      state.set(i, 1);
      for (const l of links.filter((x) => x.from === i)) {
        if (state.get(l.to) === 1) back.add(l);
        else if (!state.get(l.to)) dfs(l.to);
      }
      state.set(i, 2);
    };
    for (const i of nodes.keys()) if (!state.get(i) && !inLinks(i).length) dfs(i);
    for (const i of nodes.keys()) if (!state.get(i)) dfs(i);
    const depthOf = (i: number): number => {
      if (depth.has(i)) return depth.get(i)!;
      depth.set(i, 0);
      const d = Math.max(0, ...inLinks(i).filter((l) => !back.has(l)).map((l) => depthOf(l.from) + 1));
      depth.set(i, d);
      return d;
    };
    nodes.forEach((_, i) => depthOf(i));
    const cols: number[][] = [];
    // within a column, in the order their first step out of the column before
    const order = [...nodes.keys()].sort((a, b) => depth.get(a)! - depth.get(b)! || nodes[a].box.y1 - nodes[b].box.y1);
    for (const i of order) (cols[depth.get(i)!] ??= []).push(i);
    for (let c = 1; c < cols.length; c++) {
      const prev = cols[c - 1];
      const rank = (i: number) => { const ps = inLinks(i).map((l) => prev.indexOf(l.from)).filter((x) => x >= 0); return ps.length ? ps.reduce((s, x) => s + x, 0) / ps.length : 1e9; };
      cols[c].sort((a, b) => rank(a) - rank(b));
    }
    const right = { x: 1, y: 0 };
    const colHeight = (col: number[]) => col.reduce((s, i) => s + height(nodes[i].box), 0) + (col.length - 1) * 2.4 * bond;
    const tallest = Math.max(...cols.map(colHeight));
    let x = this.origin.x;
    cols.forEach((col, c) => {
      const w = Math.max(...col.map((i) => width(nodes[i].box)));
      if (c > 0) {
        const into = links.filter((l) => col.includes(l.to));
        const len = Math.max(...into.map((l) => this.arrowLength(l, right)), spacing(bond).minArrow);
        x += len + 2 * g;
      }
      let y = this.origin.y + (tallest - colHeight(col)) / 2;
      for (const i of col) {
        const h = height(nodes[i].box);
        this.placeNode(i, { x: x + w / 2, y: y + h / 2 });
        y += h + 2.4 * bond;
      }
      x += w;
    });
    // straight arrows from box to box; a step back to an earlier node goes round underneath
    let all: Rect | null = null;
    for (const r of this.at.values()) all = union(all, r);
    let below = all!.y2 + 1.2 * bond;
    for (const l of links) {
      const a = this.at.get(l.from)!, b = this.at.get(l.to)!;
      if (back.has(l)) {
        const y = below + this.reach(l, right).above;
        this.straight(l, { x: centre(a).x, y }, { x: centre(b).x, y });
        below = y + this.reach(l, right).below + 1.2 * bond;
        continue;
      }
      const ca = centre(a), cb = centre(b);
      // a fork: every step out of a structure that leads to several starts at one point beside it
      const fan = forked && links.filter((x) => x.from === l.from && !back.has(x)).length > 1;
      const t0 = fan ? { x: a.x2 + g, y: ca.y } : leave(ca, cb, a, g), t1 = leave(cb, fan ? t0 : ca, b, g);
      if (dist(t0, t1) < bond) continue;
      this.straight(l, t0, t1);
    }
  }
}

/** Where the line from `p` (inside box r) to `q` leaves r grown by `pad`. */
function leave(p: Vec, q: Vec, r: Rect, pad: number): Vec {
  const d = sub(q, p);
  const rr = { x1: r.x1 - pad, y1: r.y1 - pad, x2: r.x2 + pad, y2: r.y2 + pad };
  let t = 1;
  if (d.x > 0) t = Math.min(t, (rr.x2 - p.x) / d.x); else if (d.x < 0) t = Math.min(t, (rr.x1 - p.x) / d.x);
  if (d.y > 0) t = Math.min(t, (rr.y2 - p.y) / d.y); else if (d.y < 0) t = Math.min(t, (rr.y1 - p.y) / d.y);
  return add(p, mul(d, Math.max(0, t)));
}

const DEFAULT_ARROW: Omit<Arrow, 'id' | 'tail' | 'head'> = {
  headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 10, headWidth: 2.5,
};

/** Carry out a layout (one undoable step). New arrows take the look of the scheme's first arrow. */
export function applyArrange(doc: Doc, m: Measure, plan: ArrangePlan, label = 'Arrange Scheme'): number[] {
  const made: number[] = [];
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
    const lw = doc.style.lineWidth;
    const first = plan.arrows.size ? doc.arrows.get([...plan.arrows.keys()][0]) : undefined;
    const look = first
      ? { headStyle: first.headStyle, tailStyle: first.tailStyle, headType: first.headType, line: first.line, headLength: first.headLength, headWidth: first.headWidth, ...(first.lineWidth ? { lineWidth: first.lineWidth } : {}), ...(first.color ? { color: first.color } : {}) }
      : { headLength: lw * 10, headWidth: lw * 2.5 };
    for (const [id, a] of plan.arrows) {
      const r = doc.arrows.get(id)!;
      const patch: Partial<Arrow> = { tail: a.tail, head: a.head, sweep: a.sweep, step: a.step && { ...a.step, ...(r.step?.manual ? { manual: true } : {}) } };
      // an arrow that becomes curved can't stay an equilibrium or retrosynthetic arrow's two shafts
      if (a.sweep && (r.equilibrium || r.shaftSpacing)) Object.assign(patch, { equilibrium: false, shaftSpacing: undefined, headStyle: 'full', tailStyle: 'none' });
      // an arrow drawn backwards (its head at the tail end) keeps pointing the same way
      if (r.headStyle === 'none' && r.tailStyle !== 'none') Object.assign(patch, { tail: a.head, head: a.tail, sweep: -a.sweep });
      doc.updateArrow(id, patch);
    }
    for (const id of plan.removed) doc.removeArrow(id);
    const ids: number[] = [];
    for (const a of plan.added) {
      const small = a.small ? { headLength: lw * 7, headWidth: lw * 2 } : {};
      const owner = a.reagentOf?.arrow ?? (a.reagentOf?.added !== undefined ? ids[a.reagentOf.added] : undefined);
      const r = doc.addArrow({
        ...DEFAULT_ARROW, ...look, ...small, ...(a.small ? { headStyle: 'full' as const, tailStyle: 'none' as const, line: 'solid' as const } : {}),
        tail: a.tail, head: a.head, sweep: a.sweep, ...(a.step ? { step: a.step } : {}), ...(owner !== undefined ? { reagentFor: owner } : {}),
      });
      ids.push(r.id);
      made.push(r.id);
    }
  });
  return made;
}
