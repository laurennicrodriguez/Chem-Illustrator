// Format Painter (Home > Clipboard in every mode, as in Office): take the look of what is
// selected, then give it to the next thing clicked or dragged over. One click on the button
// paints once; a double-click keeps the brush until Escape or another click on the button.
//
// Only the look goes across, never the content or its meaning: in text, the font, size,
// colour, bold and so on (and the paragraph's look when a whole paragraph, or just a caret, was
// picked); on a drawing, colours, lines, fills and shadows, but not a bond's order or wedge,
// an arrow's kind of head (one or two electrons) or a shape's kind; in a sheet, the cells' formats.

import * as rt from './richtext';
import type { Arrow, Atom, Bond, Caption, Doc, ParaStyle, Shape, TextRun } from './model';
import type { Sheet, CellBlock } from './sheet/workbook';
import type { Range } from './sheet/refs';
import { wordAt } from './text/layout';
import { paraAt, paraRange } from './text/paragraphs';

// ------------------------------------------------------------------ text

/** What of a run is its look (not its words, figures, links, comments or tracked changes). */
export const RUN_LOOK_KEYS = ['bold', 'italic', 'underline', 'sub', 'sup', 'formula', 'size', 'font', 'color', 'highlight', 'strike', 'spacing', 'smallCaps', 'allCaps', 'cstyle'] as const;
/** What of a paragraph is its look (not its breaks, section or bookmarks). */
export const PARA_LOOK_KEYS = ['list', 'level', 'align', 'spaceBefore', 'spaceAfter', 'indent', 'style', 'firstLine', 'line', 'keepNext', 'indentRight', 'linePt', 'lineRule', 'tabs', 'scheme', 'bullet', 'border', 'shade'] as const;

export type RunLook = Pick<TextRun, (typeof RUN_LOOK_KEYS)[number]>;
export type ParaLook = Pick<ParaStyle, (typeof PARA_LOOK_KEYS)[number]>;

/** The look of some text: its characters', and its paragraph's when that was picked too. */
export interface TextLook {
  run: RunLook;
  para?: ParaLook;
}

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>;
  for (const k of keys) if (o[k] !== undefined) out[k] = Array.isArray(o[k]) ? ([...(o[k] as unknown[])] as T[K]) : o[k];
  return out;
}

/** Everything but the look keys, with the look put in their place. */
function relook<T extends object>(o: T, keys: readonly string[], look: object): T {
  const out = { ...o } as Record<string, unknown>;
  for (const k of keys) delete out[k];
  return { ...out, ...look } as T;
}

export const runLook = (s: rt.RunStyle): RunLook => pick(s as TextRun, RUN_LOOK_KEYS);
export const paraLook = (p: ParaStyle): ParaLook => pick(p, PARA_LOOK_KEYS);

/** Give a stretch of text a look: each character keeps its words, links and so on. Figures in the text are left as they are. */
export function paintRuns(runs: TextRun[], start: number, end: number, look: RunLook): TextRun[] {
  if (end <= start) return runs;
  const mid = rt.sliceRuns(runs, start, end).map((r) => (r.obj !== undefined ? r : relook(r, RUN_LOOK_KEYS, look)));
  return rt.normalizeRuns(rt.replaceRange(runs, start, end, mid));
}

/** Give paragraphs first..last a paragraph's look (their breaks, sections and bookmarks stay). */
export function paintParas(paras: ParaStyle[], first: number, last: number, look: ParaLook): ParaStyle[] {
  const out = paras.slice();
  for (let i = first; i <= last; i++) out[i] = relook(out[i] ?? {}, PARA_LOOK_KEYS, look);
  return out;
}

/**
 * What the brush paints in a text: the selection, or the word at the caret (as in Word, a click on
 * a word paints the whole word).
 */
export function paintRange(text: string, start: number, end: number): [number, number] {
  return start === end ? wordAt(text, start) : [start, end];
}

/**
 * Does picking this selection take the paragraph's look as well? As in Word: yes for a caret
 * (nothing selected) or for whole paragraphs, no for some words in a paragraph.
 */
export function picksParagraph(text: string, start: number, end: number): boolean {
  if (start === end) return true;
  const a = paraRange(text, paraAt(text, start)), b = paraRange(text, paraAt(text, end));
  return start === a.start && (end === b.end || end === b.start);
}

// ------------------------------------------------------------------ drawings, slides, designs

const ATOM_KEYS = ['color', 'highlight', 'hl'] as const;
const BOND_KEYS = ['color', 'highlight', 'hl'] as const;
/** An arrow's line and head size, not which heads it has (a fishhook means one electron). */
const ARROW_KEYS = ['color', 'lineWidth', 'line', 'headType', 'headLength', 'headWidth'] as const;
const SHAPE_KEYS = ['color', 'fillColor', 'filled', 'fill', 'fill2', 'gradAngle', 'gradRadial', 'pattern', 'patternColor', 'patternSize', 'patternTransparency',
  'transparency', 'lineWidth', 'dashed', 'bold', 'shadow', 'shadowSize', 'shadowColor', 'shadowOpacity', 'shadowAngle', 'shadowBlur', 'textAlign', 'textValign'] as const;
const PICTURE_KEYS = ['look'] as const;

/** Shapes whose outline and fill are their look (not tables, charts, equations, videos, or the invisible frames of diagrams). */
const LOOK_KINDS = new Set<Shape['kind']>(['rect', 'oval', 'geo', 'ring', 'line', 'bracket', 'symbol']);
const paintableShape = (s: Shape) => LOOK_KINDS.has(s.kind) && !s.energy && !s.diagram;
const plainPicture = (s: Shape) => s.kind === 'picture' && !s.chart && !s.math && !s.video && !s.zoom;

/** The look taken from things on a drawing: one of each kind, so a mixed selection paints each kind from its own. */
export interface ObjectLook {
  atom?: Pick<Atom, (typeof ATOM_KEYS)[number]>;
  bond?: Pick<Bond, (typeof BOND_KEYS)[number]>;
  arrow?: Pick<Arrow, (typeof ARROW_KEYS)[number]>;
  shape?: Pick<Shape, (typeof SHAPE_KEYS)[number]>;
  picture?: Pick<Shape, (typeof PICTURE_KEYS)[number]>;
  /** The text of a caption or of a shape. */
  text?: TextLook & { justify?: Caption['justify'] };
  /** The colour of what was picked (a shape's first, then an arrow's, then a structure's; undefined: the drawing's own), for things of another kind. */
  colour?: { color?: string };
}

export interface PickedThings {
  atoms: Iterable<number>;
  bonds: Iterable<number>;
  captions: Iterable<number>;
  arrows: Iterable<number>;
  shapes: Iterable<number>;
}

const first = <T>(ids: Iterable<number>, get: (id: number) => T | undefined, ok: (x: T) => boolean = () => true): T | undefined => {
  for (const id of ids) { const x = get(id); if (x && ok(x)) return x; }
  return undefined;
};

/** The look of what is selected; null when nothing selected has one to give. */
export function pickObjectLook(doc: Doc, sel: PickedThings): ObjectLook | null {
  const out: ObjectLook = {};
  const atom = first(sel.atoms, (id) => doc.atoms.get(id));
  const bond = first(sel.bonds, (id) => doc.bonds.get(id));
  const arrow = first(sel.arrows, (id) => doc.arrows.get(id));
  const shape = first(sel.shapes, (id) => doc.shapes.get(id), paintableShape);
  const picture = first(sel.shapes, (id) => doc.shapes.get(id), plainPicture);
  const caption = first(sel.captions, (id) => doc.captions.get(id));
  const texted = caption ?? (shape?.text?.runs.length ? shape : undefined);
  if (atom) out.atom = pick(atom, ATOM_KEYS);
  if (bond) out.bond = pick(bond, BOND_KEYS);
  if (arrow) out.arrow = pick(arrow, ARROW_KEYS);
  if (shape) out.shape = pick(shape, SHAPE_KEYS);
  if (picture) out.picture = { look: picture.look && { ...picture.look } };
  if (texted) {
    const runs = 'runs' in texted ? texted.runs : texted.text!.runs;
    const paras = 'runs' in texted ? texted.paras : texted.text!.paras;
    const n = rt.plainText(runs).length;
    out.text = { run: runLook(rt.commonStyle(runs, 0, n)), ...(paras?.[0] ? { para: paraLook(paras[0]) } : {}), ...('runs' in texted ? { justify: texted.justify } : {}) };
  }
  const c = shape ?? arrow ?? atom ?? bond;
  if (c) out.colour = { color: c.color };
  else if (out.text) out.colour = { color: out.text.run.color };
  return Object.keys(out).length ? out : null;
}

/** Text of a caption or a shape with the text look given to all of it. */
function paintAllText(runs: TextRun[], paras: ParaStyle[] | undefined, look: TextLook): { runs: TextRun[]; paras?: ParaStyle[] } {
  const text = rt.plainText(runs);
  const n = text.length;
  const out = { runs: paintRuns(runs, 0, n, look.run) } as { runs: TextRun[]; paras?: ParaStyle[] };
  if (look.para) {
    const count = text.split('\n').length;
    out.paras = paintParas(Array.from({ length: count }, (_, i) => paras?.[i] ?? {}), 0, count - 1, look.para);
  } else if (paras) out.paras = paras;
  return out;
}

/**
 * Give things on a drawing the look picked (call inside an undo step). Each takes the look of
 * its own kind, or else just the colour of what was picked. Returns how many changed.
 */
export function paintObjects(doc: Doc, sel: PickedThings, look: ObjectLook): number {
  let n = 0;
  const colour = look.colour;
  for (const id of sel.atoms) {
    const p = look.atom ?? look.bond ?? colour;
    if (p && doc.atoms.has(id)) { doc.updateAtom(id, relook({}, look.atom || look.bond ? ATOM_KEYS : ['color'], p)); n++; }
  }
  for (const id of sel.bonds) {
    const p = look.bond ?? look.atom ?? colour;
    if (p && doc.bonds.has(id)) { doc.updateBond(id, relook({}, look.bond || look.atom ? BOND_KEYS : ['color'], p)); n++; }
  }
  for (const id of sel.arrows) {
    const p = look.arrow ?? colour;
    if (p && doc.arrows.has(id)) { doc.updateArrow(id, relook({}, look.arrow ? ARROW_KEYS : ['color'], p)); n++; }
  }
  for (const id of sel.shapes) {
    const s = doc.shapes.get(id);
    if (!s) continue;
    if (plainPicture(s)) {
      if (look.picture) { doc.updateShape(id, { look: look.picture.look && { ...look.picture.look } }); n++; }
      continue;
    }
    if (!paintableShape(s)) continue;
    const p = look.shape ?? colour;
    const patch: Partial<Shape> = p ? relook({}, look.shape ? SHAPE_KEYS : ['color'], p) : {};
    if (s.text?.runs.length && look.text) patch.text = paintAllText(s.text.runs, s.text.paras, look.text);
    if (Object.keys(patch).length) { doc.updateShape(id, patch); n++; }
  }
  for (const id of sel.captions) {
    const c = doc.captions.get(id);
    if (!c) continue;
    if (look.text) {
      doc.updateCaption(id, { ...paintAllText(c.runs, c.paras, look.text), ...(look.text.justify ? { justify: look.text.justify } : {}) });
      n++;
    } else if (colour) {
      // only the colour from a thing that isn't text: the caption keeps its fonts and sizes
      doc.updateCaption(id, { runs: rt.applyStyle(c.runs, 0, rt.plainText(c.runs).length, { color: colour.color }) });
      n++;
    }
  }
  return n;
}

// ------------------------------------------------------------------ sheets

/**
 * Where cells picked up with the brush go: a single cell clicked takes the whole block (as many
 * rows and columns as were picked); a range dragged over is filled, the block repeated across it.
 */
export function cellPaintTarget(block: { rows: number; cols: number }, target: Range): Range {
  if (target.r1 === target.r2 && target.c1 === target.c2) return { r1: target.r1, c1: target.c1, r2: target.r1 + block.rows - 1, c2: target.c1 + block.cols - 1 };
  return target;
}

/** Give a range the formats of a copied block, repeating the block across it (call inside an undo step). */
export function paintCells(sheet: Sheet, block: CellBlock, target: Range): Range {
  const to = cellPaintTarget(block, target);
  const rows = to.r2 - to.r1 + 1, cols = to.c2 - to.c1 + 1;
  const cells = Array.from({ length: rows }, (_, i) => Array.from({ length: cols }, (_, j) => block.cells[i % block.rows]?.[j % block.cols]));
  sheet.paste({ row: to.r1, col: to.c1 }, { rows, cols, cells, origin: null }, 'formats');
  return to;
}

// ------------------------------------------------------------------ the brush

/**
 * The brush itself, the same in every mode: what was picked up, and whether it stays after
 * painting. `take` is called by the button: a second press soon after the first (a double-click)
 * makes the brush stay; a press while it is held puts it down.
 */
export class Brush<T = unknown> {
  look: T | null = null;
  /** Kept after painting (double-click), until Escape or the button. */
  sticky = false;
  /** Which mode it was picked up in (it paints only there). */
  where = '';
  private at = 0;
  /** Called whenever it is picked up or put down (the buttons show it pressed, the pointer a brush). */
  onChange: () => void = () => {};
  /** The clock (replaceable in tests). */
  now: () => number = () => performance.now();

  get held(): boolean { return this.look !== null; }

  /**
   * The button was pressed. `pickUp` gives the look of the selection (null: nothing to take).
   * Returns what happened, for the status bar.
   */
  press(where: string, pickUp: () => T | null): 'picked' | 'sticky' | 'dropped' | 'nothing' {
    const t = this.now();
    if (this.held && this.where === where) {
      // the second click of a double-click: keep the brush
      if (!this.sticky && t - this.at < 500) { this.sticky = true; this.onChange(); return 'sticky'; }
      this.drop();
      return 'dropped';
    }
    const look = pickUp();
    if (look === null) { this.drop(); return 'nothing'; }
    this.look = look;
    this.where = where;
    this.sticky = false;
    this.at = t;
    this.onChange();
    return 'picked';
  }

  /** Painted once: the brush is put down unless it was double-clicked. */
  used(): void {
    if (!this.sticky) this.drop();
  }

  drop(): void {
    const was = this.held;
    this.look = null;
    this.sticky = false;
    this.where = '';
    if (was) this.onChange();
  }
}
