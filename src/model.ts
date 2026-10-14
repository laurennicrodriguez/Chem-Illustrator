// The document model: atoms, bonds, captions, arrows and shapes, with undo/redo and a
// spatial index for fast hit-testing. Every change goes through a transaction so it can
// be undone as one step.

import { Vec, Rect } from './geom';
import { DocStyle, ACS_1996 } from './style';
import { arrowPoints, gluePoint } from './objects';

/** 'dative' is a coordinate bond, drawn as an arrow from the donor (a1) to the acceptor (a2). */
export type BondDisplay = 'solid' | 'wedge' | 'hashWedge' | 'hash' | 'bold' | 'dash' | 'wavy' | 'dative';
export type DoublePos = 'auto' | 'left' | 'right' | 'center';

export interface Atom {
  id: number;
  x: number;
  y: number;
  /** Atomic number; 6 for carbon. Ignored for display when `label` is set. */
  z: number;
  /** Text label for groups and abbreviations (e.g. "OMe", "Boc", "CO2Et"); null = automatic. */
  label: string | null;
  charge: number;
  isotope: number;
  /** Which way a text label runs from the atom: automatic, or forced to the left or right. */
  just: 'auto' | 'left' | 'right';
  /** Label text carried over from a file exactly as written (shown as-is). */
  fileLabel?: boolean;
  color?: string;
  /** Size relative to the document style (structures shrunk or enlarged in ChemDraw keep their own scale). */
  s?: number;
  /** A contracted label: the group it stands for, as SMILES from the atom where it joins (Structure > Contract Label). */
  group?: string;
  /** A carbon shown with its letter and hydrogens (CH3 at a chain end; ChemDraw's ShowTerminalCarbonLabels). */
  showCarbon?: boolean;
  /** The charge is drawn by a separate circled-charge symbol, so the label leaves it out. */
  hideCharge?: boolean;
  /** Numbers after R groups are superscripts (R¹ rather than R₁). */
  supDigits?: boolean;
  /** Show this atom's R/S label when it has one (ChemDraw's "Show Stereochemistry"). */
  showStereo?: boolean;
  /** Where the stereo label sits (relative to the atom), and its text as saved or typed by hand. */
  stereoLabel?: StereoLabel;
  /** The person chose to ignore this atom's chemistry warnings (ChemDraw's IgnoreWarnings). */
  ignoreWarnings?: boolean;
  /** A highlight drawn behind the atom (a disc of this colour), to pick out part of a structure. */
  highlight?: string;
  /** How the highlight is drawn (its shape, size, shadow…); the usual look when not set. */
  hl?: HighlightStyle;
  /** Unpaired electrons: a doublet radical uses one bond's worth of valence, a carbene two. */
  radical?: 'singlet' | 'doublet' | 'triplet';
  /**
   * A point of attachment, where this structure joins something not drawn: no atom, just the
   * end of the bond, marked with a wavy line ('Wavy', ChemDraw's ExternalConnectionType).
   */
  attach?: string;
  /** The number in a numbered point of attachment, drawn in a black diamond (ExternalConnectionNum). */
  attachNum?: number;
  /** The atom's number (ChemDraw's AtomNumber), kept as the text the file has. */
  atomNumber?: string;
  /** Show the atom number beside the atom (the ' key; ChemDraw's ShowAtomNumber). */
  showNumber?: boolean;
  /** Where the shown number sits, relative to the atom, when the file says or it was moved. */
  numberLabel?: { dx: number; dy: number; size: number };
  /**
   * Enhanced stereo (ChemDraw's EnhancedStereoType): this stereocentre's configuration is known
   * as drawn ('abs'), or belongs to a group whose centres are a mixture of both forms ('and',
   * labelled &1) or are one form that isn't known ('or', labelled or1).
   */
  enhStereo?: EnhancedStereo;
}

export interface EnhancedStereo {
  type: 'abs' | 'and' | 'or';
  /** Group number for 'and' and 'or' (1, 2…). */
  group?: number;
}

/** An enhanced stereo label as drawn: abs, &1, or1. */
export function enhancedText(e: EnhancedStereo): string {
  return e.type === 'abs' ? 'abs' : e.type === 'and' ? `&${e.group ?? 1}` : `or${e.group ?? 1}`;
}

/** The chiral flags a structure can carry (ChemDraw's symbols, drawn as a boxed word). */
export const CHIRAL_FLAGS: Record<string, string> = { Absolute: 'Abs', Relative: 'Rel', Racemic: 'Rac' };

/** Size of a chiral flag's word, from its box (ChemDraw's box is 2 pt clear of the text all round). */
export function flagTextSize(s: { y1: number; y2: number }): number {
  return Math.max(3, (Math.abs(s.y2 - s.y1) - 4) / 1.15);
}

/** Valence an atom's radical takes up (no hydrogens fill it). */
export function radicalElectrons(a: Atom): number {
  return a.radical === 'doublet' ? 1 : a.radical ? 2 : 0;
}

export interface StereoLabel {
  /** The text saved with the drawing; shown only while the live label isn't known, or when typed by hand. */
  text: string;
  /** Start of the text's baseline, relative to the atom (or to the middle of the bond). */
  dx: number;
  dy: number;
  size: number;
  italic?: boolean;
  /** Typed by hand: always shows `text` instead of the worked-out label. */
  manual?: boolean;
}

/** R/S and E/Z labels worked out for a drawing: a descriptor, null for none, undefined while not known. */
export interface StereoInfo {
  atom(id: number): string | null | undefined;
  bond(id: number): string | null | undefined;
  /**
   * True when the rules can't decide an atom's or bond's label because an undefined group (R, Ar,
   * a label that can't be read) sets the order of its neighbours.
   */
  undecided?(kind: 'a' | 'b', id: number): boolean;
  /** Changes whenever a label does. */
  readonly version?: number;
}

export interface Bond {
  id: number;
  a1: number;
  a2: number;
  /** 1, 1.5 (aromatic), 2, 3 or 4. */
  order: number;
  display: BondDisplay;
  dpos: DoublePos;
  color?: string;
  /** Line widths relative to the document style. */
  s?: number;
  /** An aromatic bond (order 1.5) in a ring drawn with a circle rather than a dashed second line. */
  circle?: boolean;
  /** Where it sits among bonds that cross it (higher in front; else the order it was drawn in). ChemDraw's Z. */
  z?: number;
  /** The person chose to ignore this bond's chemistry warnings. */
  ignoreWarnings?: boolean;
  /** Show this double bond's E/Z label when it has one. */
  showStereo?: boolean;
  /** Where the E/Z label sits, relative to the middle of the bond. */
  stereoLabel?: StereoLabel;
  /** A highlight drawn behind the bond (a broad band of this colour), to pick out part of a structure. */
  highlight?: string;
  hl?: HighlightStyle;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  sub?: boolean;
  sup?: boolean;
  /** Formula style: digits become subscripts, charges superscripts. */
  formula?: boolean;
  size?: number;
  font?: string;
  color?: string;
  /** A coloured background behind the text, like a highlighter pen (documents). */
  highlight?: string;
  /** A document's figure, table or field sitting in the text: its one character (U+FFFC) stands for the object with this id. */
  obj?: number;
}

/**
 * Formatting a text takes where its runs don't set their own: the placeholders on slides take
 * the slide master's fonts, sizes and colours this way, so changing the master changes them.
 */
export type TextBase = Pick<TextRun, 'size' | 'font' | 'color' | 'bold' | 'italic'>;
const BASE_KEYS = ['size', 'font', 'color', 'bold', 'italic'] as const;

/** Runs with the base formatting filled in wherever a run doesn't set its own. */
export function applyBase(runs: TextRun[], base: TextBase | undefined): TextRun[] {
  if (!base) return runs;
  return runs.map((r) => {
    const out = { ...r };
    for (const k of BASE_KEYS) if (out[k] === undefined && base[k] !== undefined) (out as Record<string, unknown>)[k] = base[k];
    return out;
  });
}

/**
 * The reverse, for runs that were given the base to edit: formatting that only repeats the base
 * is left off, so the text keeps following it. Bold or italic in the base that a run no longer
 * has was switched off on purpose, and is kept off.
 */
export function stripBase(runs: TextRun[], base: TextBase | undefined): TextRun[] {
  if (!base) return runs;
  return runs.map((r) => {
    const out = { ...r } as Record<string, unknown>;
    for (const k of BASE_KEYS) {
      if (out[k] !== undefined && out[k] === base[k]) delete out[k];
      else if (out[k] === undefined && base[k] === true) out[k] = false;
    }
    return out as unknown as TextRun;
  });
}

/** The text boxes a slide layout provides, filled in from the slide master. */
export type Placeholder = 'title' | 'subtitle' | 'body';

/** How the lines of a text sit in its box ('justify': stretched to both edges, ChemDraw's "Full"). */
export type Justify = 'left' | 'center' | 'right' | 'justify';

/**
 * Formatting of one paragraph (the text between two line breaks). Everything is optional, so a
 * plain paragraph is {}.
 */
export interface ParaStyle {
  /** A bullet or numbered list item. */
  list?: 'bullet' | 'number';
  /** List level: 0 is the outermost, each level is indented one step further. */
  level?: number;
  /** Carries on the list item above (Shift+Enter): indented with it, with no bullet of its own. */
  cont?: boolean;
  /** This paragraph's own alignment, in place of the text box's. */
  align?: Justify;
  /** Extra space above and below the paragraph, in points. */
  spaceBefore?: number;
  spaceAfter?: number;
  /** Extra left indent, in points. */
  indent?: number;
  /** Documents: the named style (Normal when left out), for Heading 1 and the rest. */
  style?: string;
  /** Documents: starts a new page. */
  pageBreak?: boolean;
  /** Documents set in columns: starts the next column. */
  colBreak?: boolean;
  /** Documents: the first line's indent from the rest, in points (less than 0 hangs it out). */
  firstLine?: number;
  /** Documents: line spacing as a multiple of single spacing (single when left out). */
  line?: number;
  /** Documents: kept on the same page as the paragraph after it (headings). */
  keepNext?: boolean;
  /** Documents: indent from the right margin, in points. */
  indentRight?: number;
  /** Documents: line spacing in points instead of a multiple: exactly this, or at least this. */
  linePt?: number;
  lineRule?: 'exact' | 'atLeast';
}

export interface Caption {
  id: number;
  /** Left end of the first line's baseline (for centred/right text, of the line box). */
  x: number;
  y: number;
  runs: TextRun[];
  justify: Justify;
  /** Width of the text box when known (from a file); used for centring and right alignment. */
  width?: number;
  /** Fixed distance between lines, in points (ChemDraw's "Fixed" line spacing). */
  lineHeight?: number;
  /** Line spacing as a multiple of single spacing (1.5, 2…), when there's no fixed lineHeight. */
  lineSpacing?: number;
  /** Lines wrap to fit this width, in points (a text box); without it they break only at line breaks. */
  wrap?: number;
  /** Paragraph formatting, one per paragraph in order; missing entries are plain paragraphs. */
  paras?: ParaStyle[];
  /** A slide's title or text placeholder: formatted from the slide master, and shown with a prompt while empty. */
  ph?: Placeholder;
  /** Height of a placeholder's box, in points (its top is the top of the first line). */
  boxH?: number;
  /** Tied to a structure: it keeps its place beside it when the structure moves or changes. */
  attach?: Attachment;
  /** Don't warn about this compound label (shared with a different structure on purpose). */
  ignoreWarnings?: boolean;
}

/** The shape of a highlight: discs and round-ended bands, diamonds, or squares. */
export type HighlightShape = 'round' | 'diamond' | 'square';

/** How a highlight is drawn. Anything left out takes the usual look (HIGHLIGHT_DEFAULTS). */
export interface HighlightStyle {
  shape?: HighlightShape;
  /** Bigger or smaller than usual: 1 is the usual size. */
  size?: number;
  /** Grow round an atom's label (Me, OTBS) so the whole label sits on the highlight. */
  fit?: boolean;
  shadow?: boolean;
  /** Fade out at the edges instead of a sharp edge. */
  soft?: boolean;
}

export const HIGHLIGHT_DEFAULTS: Required<HighlightStyle> = { shape: 'round', size: 1, fit: true, shadow: false, soft: false };

/** Which side of its structure an attached caption sits on. */
export type AttachSide = 'below' | 'above' | 'left' | 'right';

/** What an attached caption shows about its structure (Analysis > Attach descriptors). */
export type DescriptorKey = 'formula' | 'exact' | 'mw' | 'mz' | 'ea' | 'hrms';

/**
 * A caption tied to a structure: an ID label, a caption, or its descriptors (formula, masses…),
 * which are worked out again when the structure changes.
 */
export interface Attachment {
  /** The structure's atoms (any one still there finds it). */
  atoms: number[];
  side: AttachSide;
  /** Space between the structure and the caption, in points. */
  gap: number;
  /** How far it sits off the middle of that side (across for below and above, down for left and right), in points. */
  shift: number;
  role: 'label' | 'caption' | 'descriptors';
  /** For descriptors: what is shown, in order, and the ion for m/z and HRMS. */
  show?: DescriptorKey[];
  adduct?: string;
  /** For descriptors: the structure as it was when they were worked out (they are redone when it changes). */
  sig?: string;
  /** For descriptors: keep the text as it is (typed over by hand) instead of working it out again. */
  keepText?: boolean;
}

export type ArrowHead = 'none' | 'full' | 'halfLeft' | 'halfRight';

export interface Arrow {
  id: number;
  tail: Vec;
  head: Vec;
  headStyle: ArrowHead;
  tailStyle: ArrowHead;
  /** Solid, hollow or open (angle) heads. */
  headType: 'solid' | 'hollow' | 'angle';
  line: 'solid' | 'dashed' | 'bold' | 'wavy';
  noGo: boolean;
  /** Equilibrium arrows: two half-headed shafts. */
  equilibrium: boolean;
  /** Distance between two parallel shafts (a retrosynthetic arrow), in points; absent for one shaft. */
  shaftSpacing?: number;
  /** For curved arrows: signed sweep of the arc in radians (0 = straight). */
  sweep: number;
  headLength: number;
  headWidth: number;
  color?: string;
  /** Line width when it differs from the document's. */
  lineWidth?: number;
  /**
   * A reaction arrow's roles as they were stored (read from a file, set by Clean Up Reaction, or
   * chosen by hand); without them they are worked out from where things sit (chem/reaction.ts).
   */
  step?: StepRoles;
  /** A small arrow a catalytic cycle drew to bring a reagent into this arrow's step (or take a by-product out). */
  reagentFor?: number;
  /** A connector's tail and head stuck to shapes' connection points: they follow the shapes. */
  from?: Glue;
  to?: Glue;
  /** Drawn with right-angled bends (an elbow connector). */
  elbow?: boolean;
}

/** Where a connector's end is stuck: a shape and its connection point (0 top, 1 right, 2 bottom, 3 left). */
export interface Glue { shape: number; port: number }

/**
 * The parts of one reaction step, as references: 'a12' the structure holding atom 12, 'c5'
 * caption 5, 's7' shape 7.
 */
export interface StepRoles {
  reactants: string[];
  products: string[];
  /** Conditions above and below the arrow. */
  above: string[];
  below: string[];
  /** The + signs between starting materials or products. */
  plusses?: string[];
  /** Chosen by hand: Clean Up Reaction keeps these instead of working the roles out again. */
  manual?: boolean;
}

/** Lines or dots over a fill (Style panel > Pattern). */
export type Pattern = 'hatch' | 'backhatch' | 'crosshatch' | 'horizontal' | 'vertical' | 'grid' | 'dots' | 'dense-dots';

export interface Shape {
  id: number;
  kind: 'line' | 'rect' | 'oval' | 'symbol' | 'bracket' | 'picture' | 'table' | 'geo' | 'ring';
  /**
   * A ring's fill (Structure > Fill Rings): the ring's atoms in order. The fill follows them, and
   * goes when one of them goes. `poly` is where their centres were at the last change.
   */
  ring?: number[];
  poly?: { x: number; y: number }[];
  /** A design shape (kind 'geo'): which one, from the shape library (design/geo.ts). */
  geo?: string;
  /** Text inside a design shape: wraps to the shape's text area and moves with it. */
  text?: { runs: TextRun[]; paras?: ParaStyle[] };
  /** Text inside a design shape: across (centred unless set) and up and down (middle unless set). */
  textAlign?: Justify;
  textValign?: 'top' | 'middle' | 'bottom';
  /** Outline width in points, when not the drawing's line width; 0 for no outline. */
  lineWidth?: number;
  /** See-through amount of the fill, 0 (solid) to 1 (clear). */
  transparency?: number;

  /** x1, y1 is the top left corner; for a table x2, y2 follow from its layout and are kept up to date when it changes. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  dashed?: boolean;
  filled?: boolean;
  /**
   * How a filled shape is filled: evenly (absent), a light tint, shaded light to dark, or a
   * gradient from the fill colour to `fill2` (across at `gradAngle` degrees, or out from the middle).
   */
  fill?: 'faded' | 'shaded' | 'gradient';
  fill2?: string;
  /** The gradient's direction in degrees: 0 left to right, 90 top to bottom. */
  gradAngle?: number;
  gradRadial?: boolean;
  /** Lines or dots drawn over the fill (or on their own when there is no fill): hatching, stippling. */
  pattern?: Pattern;
  /** The pattern's colour (the outline colour when not given) and its spacing in points. */
  patternColor?: string;
  patternSize?: number;
  /**
   * A ring fill's pattern keeps clear of the bonds and the inner lines of double bonds (true), or
   * runs right up to the ring's bonds and under its double bonds (absent, the default).
   */
  patternClear?: boolean;
  /** Fill colour, when it differs from the outline colour (the outline is then drawn too). */
  fillColor?: string;
  rounded?: boolean;
  /** Corner radius of a rounded box, in points (ChemDraw's default is six line widths). */
  radius?: number;
  shadow?: boolean;
  /** How far a box's shadow sticks out, in points (ChemDraw's default is four line widths). */
  shadowSize?: number;
  bold?: boolean;
  symbol?: string;
  bracket?: 'square' | 'round' | 'curly';
  /** Brackets: draw both halves of the pair. */
  pair?: boolean;
  /**
   * Brackets: the label of a repeat group, shown by the bracket's lower end: n (or another letter)
   * for a polymer's repeat unit, or a number for a group repeated that many times (chem/polymer.ts).
   */
  repeat?: string;
  /** Stands in for a picture in a ChemDraw file, which is kept as it was when saving. */
  picture?: boolean;
  /** A picture: its image as a data URL (PNG, JPEG, GIF or SVG); x1..y2 is where it shows. */
  src?: string;
  /** Picture size in pixels (for the crop and for saving). */
  px?: { w: number; h: number };
  /** Parts of a picture cut off, as fractions of its width and height from each side. */
  crop?: { l: number; t: number; r: number; b: number };
  color?: string;
  z?: number;
  /** Its name in the Layers panel (Design mode). */
  name?: string;
  /** Hidden (Layers panel): not drawn, printed or picked. */
  hidden?: boolean;
  /** Locked (Layers panel): drawn, but can't be picked or moved by clicking. */
  locked?: boolean;
  /** A table: its cells, column widths and rules (see table.ts). */
  table?: TableData;
  /**
   * A frame round other things (Structure > Add Frame): what it surrounds (whole structures for
   * the atoms), the gap it keeps round them in points, and whether it follows them (grows,
   * shrinks and moves as they change). Moving or resizing the frame by hand stops it following.
   */
  frame?: Frame;
}

/** One cell of a table. */
export interface TableCell {
  runs: TextRun[];
  paras?: ParaStyle[];
  /** This cell's own alignment, in place of its column's. */
  align?: Justify;
  /** Number of columns the cell spans (the cells it covers are left empty). */
  span?: number;
  /** Documents: the cell's background colour (Word's shading). */
  fill?: string;
  /** Documents: where the text sits up and down in a cell taller than it (top when left out). */
  valign?: 'center' | 'bottom';
}

/**
 * A table in a drawing or on a slide. It is never changed in place: every edit makes a new one,
 * so undo and the renderer's cached layouts can rely on it staying as it is.
 */
export interface TableData {
  /** Width of each column, in points. */
  cols: number[];
  /** The cells, row by row (every row has one cell per column). */
  rows: TableCell[][];
  /** How many rows at the top are headings. */
  head: number;
  /** ACS style (rules above and below the headings and under the last row), every cell boxed, or no lines. */
  lines: 'acs' | 'grid' | 'none';
  /** How each column lines up (the first is left, the others centred, when not given). */
  align?: Justify[];
  /** Text size in points for runs that don't give one (the drawing's caption size when not given). */
  size?: number;
  /** The title above the table ("Table 1. Optimization of…") and the footnotes below it. */
  title?: TextRun[];
  notes?: TextRun[];
}

export type Entity = Atom | Bond | Caption | Arrow | Shape;
/** One letter per entity type: atom, bond, caption, arrow (r), shape. */
/** What an undo step can hold: atoms, bonds, captions, arrows, shapes, and 'y' the drawing style. */
export type Kind = 'a' | 'b' | 'c' | 'r' | 's' | 'y';

/**
 * The CDXML file a drawing was opened from. Saving rewrites only what changed and keeps
 * everything else (including objects this program cannot draw yet) exactly as it was.
 */
export interface CdxmlSource {
  text: string;
  /** Entity key (kind + id) → position of its element among all elements of the file. */
  ord: Map<string, number>;
  /** Each entity as it was read, to tell what changed. */
  orig: Map<string, Entity>;
  /** Highest object id used anywhere in the file. */
  maxId: number;
}

/**
 * Atoms changed since a watcher last looked (for work kept per atom outside the renderer, such
 * as the chemistry warnings). `all` means start again from scratch.
 */
export interface AtomWatch { ids: Set<number>; all: boolean }

/** Everything in a drawing, as plain lists (see Doc.contents). */
export interface Contents { atoms: Atom[]; bonds: Bond[]; captions: Caption[]; arrows: Arrow[]; shapes: Shape[] }

export interface Frame {
  atoms: number[];
  captions: number[];
  arrows: number[];
  shapes: number[];
  padX: number;
  padY: number;
  fit: boolean;
}

interface UndoEntry {
  label: string;
  before: Map<string, Entity | null>;
  after: Map<string, Entity | null>;
}

const CELL = 12; // spatial grid cell size in points

function cellKey(cx: number, cy: number): number {
  return cx * 100003 + cy; // cx, cy stay well inside ±1e5 for any real drawing
}

function clone<T>(e: T): T {
  return { ...(e as object) } as T;
}

export class Doc {
  style: DocStyle = { ...ACS_1996 };
  /** Page colour. */
  background = '#ffffff';
  /** Set when the drawing came from a CDXML file. */
  source: CdxmlSource | null = null;
  /** Live R/S and E/Z labels from the chemistry engine (not saved, not undone). */
  stereo: StereoInfo | null = null;
  /** Formatting of placeholder text by kind (from a slide master); null outside slides. */
  textStyles: Partial<Record<Placeholder, TextBase>> | null = null;
  /** Called each time an undoable change is recorded (a slide deck keeps one history across its slides). */
  onCommit: (() => void) | null = null;
  /**
   * Called as an undoable change finishes, with what it changed (and how those things were
   * before); changes made here join the same undo step (frames follow what they surround).
   */
  beforeCommit: ((before: ReadonlyMap<string, Entity | null>) => void) | null = null;
  atoms = new Map<number, Atom>();
  bonds = new Map<number, Bond>();
  captions = new Map<number, Caption>();
  arrows = new Map<number, Arrow>();
  shapes = new Map<number, Shape>();
  /** Bonds at each atom. */
  adj = new Map<number, number[]>();
  /** Incremented on every change; the renderer and analysis use it to know when to redo work. */
  version = 0;
  /** Atoms and bonds changed since the renderer last looked (it caches layout per atom and bond). */
  dirtyAtoms = new Set<number>();
  dirtyBonds = new Set<number>();
  allDirty = true;
  /** Areas that changed since the renderer last looked (old and new places), for repainting only those. */
  dirtyRects: Rect[] = [];
  /** Captions removed, added or changed (old and new versions), whose boxes need repainting. */
  dirtyCaptions: Caption[] = [];

  private nextId = 1;
  private watches: AtomWatch[] = [];
  private grid = new Map<number, number[]>();
  private atomCell = new Map<number, number>();
  private maxBondLen = 0;
  /** Longest bond drawn so far (used to know how far around a point to look). */
  get maxBondLength(): number { return this.maxBondLen; }
  private tx: UndoEntry | null = null;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  /** Start collecting the ids of atoms that change (an atom's bonds changing counts too). */
  watchAtoms(): AtomWatch {
    const w: AtomWatch = { ids: new Set(), all: true };
    this.watches.push(w);
    return w;
  }

  private noteAtom(id: number): void {
    for (const w of this.watches) if (!w.all) w.ids.add(id);
  }

  newId(): number {
    return this.nextId++;
  }

  /** Make sure new ids are above `id` (ids used by a file for things not in the model). */
  reserveIds(id: number): void {
    if (id >= this.nextId) this.nextId = id + 1;
  }

  // ---------------------------------------------------------------- transactions

  begin(label: string): void {
    if (this.tx) return; // nested: fold into the outer transaction
    this.tx = { label, before: new Map(), after: new Map() };
  }

  commit(): void {
    const tx = this.tx;
    if (!tx) return;
    if (tx.before.size && this.beforeCommit) this.beforeCommit(new Map(tx.before));
    this.tx = null;
    if (tx.before.size === 0) return;
    for (const key of tx.before.keys()) tx.after.set(key, this.snapshot(key));
    this.undoStack.push(tx);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onCommit?.();
  }

  /** Run `fn` inside one undoable step. */
  edit<T>(label: string, fn: () => T): T {
    const outer = this.tx !== null;
    this.begin(label);
    try {
      return fn();
    } finally {
      if (!outer) this.commit();
    }
  }

  /**
   * Changes worked out after the last step finished (a caption's masses, from the chemistry
   * engine): they join that step, so one undo takes back both. With nothing to join, they make
   * a step of their own.
   */
  amend(label: string, fn: () => void): void {
    if (this.tx) { fn(); return; }
    const last = this.undoStack[this.undoStack.length - 1];
    this.begin(label);
    const tx = this.tx!;
    try {
      fn();
      if (tx.before.size && this.beforeCommit) this.beforeCommit(new Map(tx.before));
    } finally {
      this.tx = null;
    }
    if (!tx.before.size) return;
    if (!last) {
      for (const key of tx.before.keys()) tx.after.set(key, this.snapshot(key));
      this.undoStack.push(tx);
    } else {
      for (const [key, was] of tx.before) {
        if (!last.before.has(key)) last.before.set(key, was);
        last.after.set(key, this.snapshot(key));
      }
    }
    this.onCommit?.();
  }

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }

  undo(): boolean {
    const e = this.undoStack.pop();
    if (!e) return false;
    this.apply(e.before);
    this.redoStack.push(e);
    return true;
  }

  redo(): boolean {
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e.after);
    this.undoStack.push(e);
    return true;
  }

  private apply(states: Map<string, Entity | null>): void {
    // Bonds removed first and atoms restored first, so adjacency stays consistent.
    const keys = [...states.keys()].sort((a, b) => order(a) - order(b));
    for (const key of keys) {
      const kind = key[0] as Kind;
      const id = Number(key.slice(1));
      const st = states.get(key) ?? null;
      this.rawSet(kind, id, st ? clone(st) : null);
    }
    this.version++;
    function order(k: string): number {
      // atoms before bonds when restoring
      return k[0] === 'y' ? -1 : k[0] === 'a' ? 0 : k[0] === 'b' ? 1 : 2;
    }
  }

  private snapshot(key: string): Entity | null {
    const kind = key[0] as Kind;
    const id = Number(key.slice(1));
    if (kind === 'y') return clone(this.style) as unknown as Entity;
    const e = this.mapOf(kind).get(id);
    return e ? clone(e) : null;
  }

  private touch(kind: Kind, id: number): void {
    if (!this.tx) throw new Error('Document changes must happen inside an edit');
    const key = kind + id;
    if (!this.tx.before.has(key)) this.tx.before.set(key, this.snapshot(key));
    this.version++;
  }

  /** Change the drawing style (bond length, line widths, fonts), as part of the edit going on. */
  setStyle(st: DocStyle): void {
    this.touch('y', 0);
    this.style = { ...st };
    this.allDirty = true;
  }

  private mapOf(kind: Kind): Map<number, Entity> {
    switch (kind) {
      case 'y': return new Map();
      case 'a': return this.atoms as Map<number, Entity>;
      case 'b': return this.bonds as Map<number, Entity>;
      case 'c': return this.captions as Map<number, Entity>;
      case 'r': return this.arrows as Map<number, Entity>;
      case 's': return this.shapes as Map<number, Entity>;
    }
  }

  /** Low-level set used by undo/redo and the public mutators; keeps indexes in sync. */
  private markDirty(kind: Kind, e: Entity | undefined | null): void {
    if (!e) return;
    const pt = (x: number, y: number) => this.dirtyRects.push({ x1: x, y1: y, x2: x, y2: y });
    if (kind === 'a') { const a = e as Atom; pt(a.x, a.y); }
    else if (kind === 'b') {
      const b = e as Bond;
      const p = this.atoms.get(b.a1), q = this.atoms.get(b.a2);
      if (p) pt(p.x, p.y);
      if (q) pt(q.x, q.y);
    } else if (kind === 'c') this.dirtyCaptions.push(e as Caption);
    else if (kind === 'r') {
      const r = e as Arrow;
      const pad = r.sweep ? Math.hypot(r.head.x - r.tail.x, r.head.y - r.tail.y) : r.headWidth + 2;
      this.dirtyRects.push({ x1: Math.min(r.tail.x, r.head.x) - pad, y1: Math.min(r.tail.y, r.head.y) - pad, x2: Math.max(r.tail.x, r.head.x) + pad, y2: Math.max(r.tail.y, r.head.y) + pad });
    } else {
      const sh = e as Shape;
      this.dirtyRects.push({ x1: Math.min(sh.x1, sh.x2) - 4, y1: Math.min(sh.y1, sh.y2) - 4, x2: Math.max(sh.x1, sh.x2) + 4, y2: Math.max(sh.y1, sh.y2) + 4 });
    }
  }

  private rawSet(kind: Kind, id: number, e: Entity | null): void {
    if (kind === 'y') {
      if (e) this.style = { ...(e as unknown as DocStyle) };
      this.allDirty = true;
      return;
    }
    if (!this.allDirty) {
      this.markDirty(kind, this.mapOf(kind).get(id));
      this.markDirty(kind, e);
    }
    if (kind === 'a') {
      this.dirtyAtoms.add(id);
      this.noteAtom(id);
      if (e) {
        this.atoms.set(id, e as Atom);
        if (!this.adj.has(id)) this.adj.set(id, []);
        this.indexAtom(e as Atom);
      } else {
        this.atoms.delete(id);
        this.unindexAtom(id);
        this.adj.delete(id);
      }
    } else if (kind === 'b') {
      this.dirtyBonds.add(id);
      const old = this.bonds.get(id);
      if (old) {
        this.detach(old.a1, id);
        this.detach(old.a2, id);
        this.dirtyAtoms.add(old.a1);
        this.dirtyAtoms.add(old.a2);
        this.noteAtom(old.a1);
        this.noteAtom(old.a2);
      }
      if (e) {
        const b = e as Bond;
        this.dirtyAtoms.add(b.a1);
        this.dirtyAtoms.add(b.a2);
        this.noteAtom(b.a1);
        this.noteAtom(b.a2);
        this.bonds.set(id, b);
        this.attach(b.a1, id);
        this.attach(b.a2, id);
        this.noteBondLength(b);
      } else {
        this.bonds.delete(id);
      }
    } else {
      const m = this.mapOf(kind);
      if (e) m.set(id, e);
      else m.delete(id);
    }
    if (id >= this.nextId) this.nextId = id + 1;
  }

  private attach(atomId: number, bondId: number): void {
    let l = this.adj.get(atomId);
    if (!l) { l = []; this.adj.set(atomId, l); }
    if (!l.includes(bondId)) l.push(bondId);
  }

  private detach(atomId: number, bondId: number): void {
    const l = this.adj.get(atomId);
    if (!l) return;
    const i = l.indexOf(bondId);
    if (i >= 0) l.splice(i, 1);
  }

  // ---------------------------------------------------------------- spatial index

  private indexAtom(a: Atom): void {
    const key = cellKey(Math.floor(a.x / CELL), Math.floor(a.y / CELL));
    const old = this.atomCell.get(a.id);
    if (old === key) return;
    if (old !== undefined) this.removeFromCell(old, a.id);
    let l = this.grid.get(key);
    if (!l) { l = []; this.grid.set(key, l); }
    l.push(a.id);
    this.atomCell.set(a.id, key);
  }

  private unindexAtom(id: number): void {
    const old = this.atomCell.get(id);
    if (old !== undefined) this.removeFromCell(old, id);
    this.atomCell.delete(id);
  }

  private removeFromCell(key: number, id: number): void {
    const l = this.grid.get(key);
    if (!l) return;
    const i = l.indexOf(id);
    if (i >= 0) { l[i] = l[l.length - 1]; l.pop(); }
    if (l.length === 0) this.grid.delete(key);
  }

  private noteBondLength(b: Bond): void {
    const p = this.atoms.get(b.a1), q = this.atoms.get(b.a2);
    if (!p || !q) return;
    const l = Math.hypot(p.x - q.x, p.y - q.y);
    if (l > this.maxBondLen) this.maxBondLen = l;
  }

  /** Atoms within `r` points of p. */
  atomsNear(p: Vec, r: number): Atom[] {
    const out: Atom[] = [];
    const c0x = Math.floor((p.x - r) / CELL), c1x = Math.floor((p.x + r) / CELL);
    const c0y = Math.floor((p.y - r) / CELL), c1y = Math.floor((p.y + r) / CELL);
    const r2 = r * r;
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const l = this.grid.get(cellKey(cx, cy));
        if (!l) continue;
        for (const id of l) {
          const a = this.atoms.get(id)!;
          const dx = a.x - p.x, dy = a.y - p.y;
          if (dx * dx + dy * dy <= r2) out.push(a);
        }
      }
    }
    return out;
  }

  /** Atoms inside a rectangle. */
  atomsIn(r: Rect): Atom[] {
    const out: Atom[] = [];
    const c0x = Math.floor(r.x1 / CELL), c1x = Math.floor(r.x2 / CELL);
    const c0y = Math.floor(r.y1 / CELL), c1y = Math.floor(r.y2 / CELL);
    if ((c1x - c0x + 1) * (c1y - c0y + 1) > this.grid.size * 2) {
      for (const a of this.atoms.values()) if (a.x >= r.x1 && a.x <= r.x2 && a.y >= r.y1 && a.y <= r.y2) out.push(a);
      return out;
    }
    for (let cx = c0x; cx <= c1x; cx++) {
      for (let cy = c0y; cy <= c1y; cy++) {
        const l = this.grid.get(cellKey(cx, cy));
        if (!l) continue;
        for (const id of l) {
          const a = this.atoms.get(id)!;
          if (a.x >= r.x1 && a.x <= r.x2 && a.y >= r.y1 && a.y <= r.y2) out.push(a);
        }
      }
    }
    return out;
  }

  /** Bonds that could lie within `r` of p (candidates; caller checks distance). */
  bondsNear(p: Vec, r: number): Bond[] {
    const reach = Math.min(this.maxBondLen, 200) / 2 + r;
    const seen = new Set<number>();
    const out: Bond[] = [];
    for (const a of this.atomsNear(p, reach)) {
      for (const bid of this.adj.get(a.id) ?? []) {
        if (seen.has(bid)) continue;
        seen.add(bid);
        out.push(this.bonds.get(bid)!);
      }
    }
    return out;
  }

  // ---------------------------------------------------------------- mutators

  addAtom(x: number, y: number, z = 6, extra: Partial<Atom> = {}): Atom {
    const id = extra.id ?? this.newId();
    this.touch('a', id);
    const a: Atom = { id, x, y, z, label: null, charge: 0, isotope: 0, just: 'auto', ...extra };
    this.rawSet('a', id, a);
    return a;
  }

  updateAtom(id: number, patch: Partial<Atom>): void {
    const a = this.atoms.get(id);
    if (!a) return;
    this.touch('a', id);
    const n = { ...a, ...patch, id };
    this.rawSet('a', id, n);
    if (patch.x !== undefined || patch.y !== undefined) {
      for (const bid of this.adj.get(id) ?? []) this.noteBondLength(this.bonds.get(bid)!);
    }
  }

  moveAtoms(ids: Iterable<number>, dx: number, dy: number): void {
    for (const id of ids) {
      const a = this.atoms.get(id);
      if (a) this.updateAtom(id, { x: a.x + dx, y: a.y + dy });
    }
  }

  removeAtom(id: number): void {
    if (!this.atoms.has(id)) return;
    for (const bid of [...(this.adj.get(id) ?? [])]) this.removeBond(bid);
    this.touch('a', id);
    this.rawSet('a', id, null);
  }

  addBond(a1: number, a2: number, order = 1, display: BondDisplay = 'solid', extra: Partial<Bond> = {}): Bond {
    const id = extra.id ?? this.newId();
    this.touch('b', id);
    const b: Bond = { id, a1, a2, order, display, dpos: 'auto', ...extra };
    this.rawSet('b', id, b);
    return b;
  }

  updateBond(id: number, patch: Partial<Bond>): void {
    const b = this.bonds.get(id);
    if (!b) return;
    this.touch('b', id);
    this.rawSet('b', id, { ...b, ...patch, id });
  }

  removeBond(id: number): void {
    if (!this.bonds.has(id)) return;
    this.touch('b', id);
    this.rawSet('b', id, null);
  }

  addCaption(c: Omit<Caption, 'id'> & { id?: number }): Caption {
    const id = c.id ?? this.newId();
    this.touch('c', id);
    const cap: Caption = { ...c, id };
    this.rawSet('c', id, cap);
    return cap;
  }

  updateCaption(id: number, patch: Partial<Caption>): void {
    const c = this.captions.get(id);
    if (!c) return;
    this.touch('c', id);
    this.rawSet('c', id, { ...c, ...patch, id });
  }

  removeCaption(id: number): void {
    if (!this.captions.has(id)) return;
    this.touch('c', id);
    this.rawSet('c', id, null);
  }

  addArrow(a: Omit<Arrow, 'id'> & { id?: number }): Arrow {
    const id = a.id ?? this.newId();
    this.touch('r', id);
    const arr: Arrow = { ...a, id };
    this.rawSet('r', id, arr);
    return arr;
  }

  updateArrow(id: number, patch: Partial<Arrow>): void {
    const a = this.arrows.get(id);
    if (!a) return;
    this.touch('r', id);
    this.rawSet('r', id, { ...a, ...patch, id });
  }

  removeArrow(id: number): void {
    if (!this.arrows.has(id)) return;
    this.touch('r', id);
    this.rawSet('r', id, null);
  }

  addShape(s: Omit<Shape, 'id'> & { id?: number }): Shape {
    const id = s.id ?? this.newId();
    this.touch('s', id);
    const sh: Shape = { ...s, id };
    this.rawSet('s', id, sh);
    return sh;
  }

  updateShape(id: number, patch: Partial<Shape>): void {
    const s = this.shapes.get(id);
    if (!s) return;
    this.touch('s', id);
    this.rawSet('s', id, { ...s, ...patch, id });
    this.followGlue(id);
  }

  removeShape(id: number): void {
    if (!this.shapes.has(id)) return;
    this.touch('s', id);
    this.rawSet('s', id, null);
    this.followGlue(id);
  }

  /** Connectors stuck to a shape follow it when it moves or changes size, and come loose when it goes. */
  private followGlue(id: number): void {
    const s = this.shapes.get(id);
    for (const r of this.arrows.values()) {
      if (r.from?.shape !== id && r.to?.shape !== id) continue;
      const patch: Partial<Arrow> = {};
      if (r.from?.shape === id) { if (s) patch.tail = gluePoint(s, r.from.port); else patch.from = undefined; }
      if (r.to?.shape === id) { if (s) patch.head = gluePoint(s, r.to.port); else patch.to = undefined; }
      this.updateArrow(r.id, patch);
    }
  }

  /** Replace the whole document (e.g. after opening a file). Clears undo history. */
  loadFrom(other: Doc): void {
    this.style = { ...other.style };
    this.background = other.background;
    this.source = other.source;
    this.nextId = Math.max(this.nextId, other.nextId);
    this.atoms.clear(); this.bonds.clear(); this.captions.clear(); this.arrows.clear(); this.shapes.clear();
    this.adj.clear(); this.grid.clear(); this.atomCell.clear(); this.maxBondLen = 0;
    for (const a of other.atoms.values()) this.rawSet('a', a.id, clone(a));
    for (const b of other.bonds.values()) this.rawSet('b', b.id, clone(b));
    for (const c of other.captions.values()) this.rawSet('c', c.id, clone(c));
    for (const r of other.arrows.values()) this.rawSet('r', r.id, clone(r));
    for (const s of other.shapes.values()) this.rawSet('s', s.id, clone(s));
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.allDirty = true;
    for (const w of this.watches) { w.all = true; w.ids.clear(); }
    this.version++;
  }

  /**
   * Exchange everything drawn, with its style, file and undo history, with another document. A
   * slide deck keeps each slide in a document of its own and swaps the one being edited into
   * this one, so the editor, the checks and the chemistry engine always work on this document.
   * Watchers, live stereo labels and the commit hook stay with this document.
   */
  swap(other: Doc): void {
    if (this.tx || other.tx) throw new Error('Cannot swap documents in the middle of an edit');
    const fields = ['style', 'background', 'source', 'textStyles', 'atoms', 'bonds', 'captions', 'arrows', 'shapes', 'adj',
      'grid', 'atomCell', 'maxBondLen', 'undoStack', 'redoStack'] as const;
    const a = this as unknown as Record<string, unknown>, b = other as unknown as Record<string, unknown>;
    for (const f of fields) { const t = a[f]; a[f] = b[f]; b[f] = t; }
    // ids stay unique across both, so things moved between them never clash
    this.nextId = other.nextId = Math.max(this.nextId, other.nextId);
    for (const d of [this, other]) {
      d.allDirty = true;
      d.dirtyAtoms.clear(); d.dirtyBonds.clear(); d.dirtyRects.length = 0; d.dirtyCaptions.length = 0;
      for (const w of d.watches) { w.all = true; w.ids.clear(); }
      d.version++;
    }
  }

  /** A copy of everything drawn, to put back later with `restoreContents`. */
  contents(): Contents {
    return {
      atoms: [...this.atoms.values()].map(clone), bonds: [...this.bonds.values()].map(clone), captions: [...this.captions.values()].map(clone),
      arrows: [...this.arrows.values()].map(clone), shapes: [...this.shapes.values()].map(clone),
    };
  }

  /** Put back what `contents` copied, outside the undo history (the slide deck's own history does this). */
  restoreContents(c: Contents): void {
    this.bulk(() => {
      for (const id of [...this.bonds.keys()]) this.rawSet('b', id, null);
      for (const id of [...this.atoms.keys()]) this.rawSet('a', id, null);
      for (const k of ['c', 'r', 's'] as const) for (const id of [...this.mapOf(k).keys()]) this.rawSet(k, id, null);
      for (const a of c.atoms) this.rawSet('a', a.id, clone(a));
      for (const b of c.bonds) this.rawSet('b', b.id, clone(b));
      for (const x of c.captions) this.rawSet('c', x.id, clone(x));
      for (const x of c.arrows) this.rawSet('r', x.id, clone(x));
      for (const x of c.shapes) this.rawSet('s', x.id, clone(x));
    });
    this.allDirty = true;
  }

  /** Build without undo tracking (file loading, tests). */
  bulk(fn: () => void): void {
    this.begin('bulk');
    fn();
    this.tx = null;
    this.version++;
  }

  // ---------------------------------------------------------------- queries

  neighbors(atomId: number): Atom[] {
    const out: Atom[] = [];
    for (const bid of this.adj.get(atomId) ?? []) {
      const b = this.bonds.get(bid)!;
      const other = b.a1 === atomId ? b.a2 : b.a1;
      const a = this.atoms.get(other);
      if (a) out.push(a);
    }
    return out;
  }

  bondBetween(a1: number, a2: number): Bond | undefined {
    for (const bid of this.adj.get(a1) ?? []) {
      const b = this.bonds.get(bid)!;
      if ((b.a1 === a1 && b.a2 === a2) || (b.a1 === a2 && b.a2 === a1)) return b;
    }
    return undefined;
  }

  degree(atomId: number): number {
    return this.adj.get(atomId)?.length ?? 0;
  }

  /** Bond orders plus any radical electrons: what an atom's hydrogens are worked out from. */
  valenceSum(atomId: number): number {
    const a = this.atoms.get(atomId);
    return this.bondOrderSum(atomId) + (a ? radicalElectrons(a) : 0);
  }

  bondOrderSum(atomId: number): number {
    let s = 0;
    for (const bid of this.adj.get(atomId) ?? []) {
      const b = this.bonds.get(bid)!;
      // a dative bond doesn't change either atom's hydrogens (H3N→BF3)
      if (b.display === 'dative') continue;
      s += b.order;
    }
    return s;
  }

  /** Connected atoms of the structure containing `atomId`. */
  fragmentOf(atomId: number): Set<number> {
    const seen = new Set<number>([atomId]);
    const stack = [atomId];
    while (stack.length) {
      const id = stack.pop()!;
      for (const n of this.neighbors(id)) {
        if (!seen.has(n.id)) { seen.add(n.id); stack.push(n.id); }
      }
    }
    return seen;
  }

  /** All structures as sets of atom ids. */
  fragments(): Set<number>[] {
    const seen = new Set<number>();
    const out: Set<number>[] = [];
    for (const id of this.atoms.keys()) {
      if (seen.has(id)) continue;
      const f = this.fragmentOf(id);
      for (const x of f) seen.add(x);
      out.push(f);
    }
    return out;
  }

  /** Smallest ring through a bond (atom ids in order), or null. Used to place double bonds. */
  ringThroughBond(bondId: number, maxSize = 8): number[] | null {
    const b = this.bonds.get(bondId);
    if (!b) return null;
    // BFS from a2 back to a1 without using the bond itself.
    const prev = new Map<number, number>([[b.a2, -1]]);
    let frontier = [b.a2];
    for (let depth = 1; depth < maxSize && frontier.length; depth++) {
      const next: number[] = [];
      for (const id of frontier) {
        for (const bid of this.adj.get(id) ?? []) {
          if (bid === bondId) continue;
          const bb = this.bonds.get(bid)!;
          const o = bb.a1 === id ? bb.a2 : bb.a1;
          if (prev.has(o)) continue;
          prev.set(o, id);
          if (o === b.a1) {
            const path = [o];
            let cur = id;
            while (cur !== -1) { path.push(cur); cur = prev.get(cur)!; }
            return path; // a1 … a2
          }
          next.push(o);
        }
      }
      frontier = next;
    }
    return null;
  }

  bounds(): Rect | null {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const grow = (x: number, y: number) => { if (x < x1) x1 = x; if (y < y1) y1 = y; if (x > x2) x2 = x; if (y > y2) y2 = y; };
    for (const a of this.atoms.values()) grow(a.x, a.y);
    for (const c of this.captions.values()) { grow(c.x, c.y - 10); grow(c.x + (c.width ?? 40), c.y + 4); }
    for (const r of this.arrows.values()) for (const p of arrowPoints(r, 12)) grow(p.x, p.y);
    for (const s of this.shapes.values()) { grow(s.x1, s.y1); grow(s.x2, s.y2); }
    if (x1 === Infinity) return null;
    return { x1, y1, x2, y2 };
  }
}
