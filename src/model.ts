// The document model: atoms, bonds, captions, arrows and shapes, with undo/redo and a
// spatial index for fast hit-testing. Every change goes through a transaction so it can
// be undone as one step.

import type { SectionBreak } from './document/document';
import { Vec, Rect } from './geom';
import { DocStyle, ACS_1996 } from './style';
import { arrowPoints, gluePoint } from './objects';
import { followPins } from './chem/pins';
import type { EnergyData } from './design/energy';
import type { DiagramData } from './design/diagrams';
import type { ChartBox } from './sheet/chart-box';
import { isMetal, isMetalLabel, lowestValence } from './chem/elements';
import { NICKNAMES } from './chem/labels';

/** 'dative' is a coordinate bond, drawn as an arrow from the donor (a1) to the acceptor (a2). */
export type BondDisplay = 'solid' | 'wedge' | 'hashWedge' | 'hash' | 'bold' | 'dash' | 'wavy' | 'dative';

/** A partial bond (order 0.5), one forming or breaking in a transition state: drawn dashed. */
export const PARTIAL = 0.5;

/**
 * A bond that leaves both atoms' valences as they were: a dative bond (H3N→BF3) or a partial
 * bond in a transition state. Neither counts toward hydrogens, and neither goes to RDKit.
 */
export function outsideValence(b: Pick<Bond, 'display' | 'order'>): boolean {
  return b.display === 'dative' || b.order === PARTIAL;
}
export type DoublePos = 'auto' | 'left' | 'right' | 'center';

export interface Atom {
  id: number;
  /** The group it belongs to (Format > Group); things with the same number move and select together. */
  grp?: number;
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
  /** A 3-D position kept from a file (ChemDraw's xyz on a structure built from a crystal file). */
  xyz?: [number, number, number];
  /** A contracted label: the group it stands for, as SMILES from the atom where it joins (Chemistry > Contract Label). */
  group?: string;
  /** A carbon shown with its letter and hydrogens (CH3 at a chain end; ChemDraw's ShowTerminalCarbonLabels). */
  showCarbon?: boolean;
  /** The charge is drawn by a separate circled-charge symbol, so the label leaves it out. */
  hideCharge?: boolean;
  /** Numbers after R groups are superscripts (R¹ rather than R₁); false keeps them down. Not set: R1, R12… go up, as the preferences say. */
  supDigits?: boolean;
  /** Characters of the label raised or lowered by hand, one mark per character ("^" up, "_" down, "=" on the line). */
  labelMarks?: string;
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
  /**
   * A multicentre point (ChemDraw's MultiAttachment node): not an atom but the middle of these
   * atoms together, the ring or π-bond a metal is bonded to all at once (η⁵-C₅H₅, η²-alkene,
   * η³-allyl, an agostic C–H). A bond to it is a hapto bond, ηⁿ with n the number of atoms. It
   * sits at their centre, follows them when they move, and goes when fewer than two are left.
   */
  multi?: number[];
}

/** A metal atom: a metal element, or a label written for one (Pd, PdCl2, LnPd, [M]). */
export function isMetalAtom(a: Atom | undefined): boolean {
  if (!a || a.multi || a.attach) return false;
  // (abbreviations that start like a metal are groups: MOM, Allyl, Ind)
  return a.label ? !NICKNAMES[a.label] && isMetalLabel(a.label) : isMetal(a.z);
}

/** A multicentre point standing for several atoms at once (see Atom.multi), rather than an atom. */
export function isCentre(a: Atom | undefined): boolean {
  return !!a?.multi;
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
  /**
   * A hapto bond (to a multicentre point) drawn as a line from the metal to each of the point's
   * atoms, rather than one line to their middle.
   */
  spokes?: boolean;
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
  /** A line through the text (shown on deleted text while changes are tracked). */
  strike?: boolean;
  /** Documents with tracked changes: this text was inserted or deleted, by whom and when ("ins|Nate|2026-10-14T21:00:00Z"; see document/revisions). */
  rev?: string;
  /** Documents: the comments this text is under, by id, joined by commas ("2,5"; see document/comments). */
  cmt?: string;
  /** Where the text links to: a web page, a DOI, an e-mail address, a file or a place in the file (see links.ts). */
  link?: string;
  /** Character spacing: points added after each character (less than 0 is condensed), as PowerPoint's Character Spacing. */
  spacing?: number;
}

/**
 * Formatting a text takes where its runs don't set their own: the placeholders on slides take
 * the slide master's fonts, sizes and colours this way, so changing the master changes them.
 */
export type TextBase = Pick<TextRun, 'size' | 'font' | 'color' | 'bold' | 'italic'>;
const BASE_KEYS = ['size', 'font', 'color', 'bold', 'italic'] as const;

/** Runs with the base formatting filled in wherever a run doesn't set its own. */
/** A drawing's own caption font, as the base its captions' text takes (none when it is Arial, the plain default). */
export function captionBase(style: { captionFont: string }): TextBase | undefined {
  const f = style.captionFont?.trim();
  return f && !/^arial$/i.test(f) ? { font: f } : undefined;
}

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
  /**
   * Documents: a new section starts with this paragraph (a section break before it), with how
   * it starts and its own page setup, header and footer, page numbering and line numbers.
   */
  section?: SectionBreak;
  /** Documents: this paragraph's lines get no line numbers (Word's Suppress Line Numbers). */
  noLineNumbers?: boolean;
  /** Documents: bookmarks at this paragraph (Insert > Bookmark), by name, for links to point at. */
  marks?: string[];
}

export interface Caption {
  id: number;
  /** The group it belongs to (Format > Group); things with the same number move and select together. */
  grp?: number;
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
  /** Turned this many degrees clockwise about (x, y), the start of its first line. */
  rot?: number;
  /** Its name in the Selection Pane (Slides), when given one. */
  name?: string;
  /** Hidden (Selection Pane): not drawn, printed or picked, but kept and saved. */
  hidden?: boolean;
  /** Columns in a text box (it needs a width, `wrap`), and the room between them in points. */
  cols?: number;
  colGap?: number;
  /**
   * AutoFit (slides): left out, the box grows with its text; 'shrink' makes the text smaller to
   * fit a box of height boxH; 'fixed' keeps the box at boxH and lets the text run past it.
   */
  fit?: 'shrink' | 'fixed';
  /** Text direction: the text runs down (rotated 90°) or up (270°). Its turn is in `rot`; this says it is the text's direction, for PowerPoint. */
  dir?: 'vert' | 'vert270';
}

/**
 * The shape of a highlight: discs and round-ended bands (round), or straight bands with sharp
 * corners where bonds meet and a disc round each atom label (straight). Files from before
 * straight highlights may say diamond or square; they are read as straight.
 */
export type HighlightShape = 'round' | 'straight';

/** How the end of a straight highlight looks: round, square past the atom, or a point. */
export type HighlightEnds = 'round' | 'square' | 'pointed';

/** How a highlight is drawn. Anything left out takes the usual look (HIGHLIGHT_DEFAULTS). */
export interface HighlightStyle {
  shape?: HighlightShape;
  /** Straight highlights only: how a line of highlighted bonds ends. */
  ends?: HighlightEnds;
  /** Bigger or smaller than usual: 1 is the usual size. */
  size?: number;
  /** Grow round an atom's label (Me, OTBS) so the whole label sits on the highlight. */
  fit?: boolean;
  shadow?: boolean;
  /** Fade out at the edges instead of a sharp edge. */
  soft?: boolean;
  /** Round highlights only: one even band along the bonds, with no bulging disc at each atom. */
  smooth?: boolean;
  /**
   * Run the highlight midway between a double bond's two lines (and round a ring drawn with its
   * double bonds inside, midway between the ring and those inner lines) instead of on the bond.
   */
  centre?: boolean;
  /** Soft edges: how much of the band fades, 0 to 1 of the way in from its edge to its middle. */
  softAmount?: number;
  /** Soft edges: fade at the outer edge, along the middle (a hollow band), or both (half each). */
  softSide?: HighlightSoftSide;
  /** How see-through the fill and texture are, 0 (solid) to 1 (clear). */
  transparency?: number;
  /** One colour, a gradient across, a gradient out from the bonds to the edge, or none (outline or texture only). */
  fill?: HighlightFill;
  /** A gradient's second colour ('' for white). */
  colour2?: string;
  /** A gradient across: its direction in degrees, 0 left to right, 90 top to bottom. */
  gradAngle?: number;
  /** Lines or dots over the fill (or on their own with no fill). */
  pattern?: Pattern | 'none';
  /** The texture's colour ('' for a darker shade of the highlight) and spacing in points (0 for the usual). */
  patternColour?: string;
  patternSize?: number;
  /** A line round the highlight's outline. */
  line?: HighlightLine;
  /** The outline's colour ('' for a darker shade of the highlight) and width in points. */
  lineColour?: string;
  lineWidth?: number;
  /** The shadow's colour, how dark it is (0 to 1), which way it falls (degrees, 45 down and to the right). */
  shadowColour?: string;
  shadowOpacity?: number;
  shadowAngle?: number;
  /** How far the shadow falls and how blurred it is, as parts of a bond length (times the highlight's size). */
  shadowDistance?: number;
  shadowBlur?: number;
  /** A soft halo of colour round the outside, as PowerPoint's glow. */
  glow?: boolean;
  /** The glow's colour ('' for the highlight's own), how far it reaches (part of a bond length) and how see-through it is. */
  glowColour?: string;
  glowSize?: number;
  glowTransparency?: number;
}

export type HighlightSoftSide = 'outer' | 'inner' | 'both';
export type HighlightFill = 'solid' | 'linear' | 'edge' | 'none';
export type HighlightLine = 'none' | 'solid' | 'dashed' | 'dotted';

export const HIGHLIGHT_DEFAULTS: Required<HighlightStyle> = {
  shape: 'round', ends: 'round', size: 1, fit: true, shadow: false, soft: false, smooth: false, centre: false,
  softAmount: 0.5, softSide: 'outer', transparency: 0, fill: 'solid', colour2: '', gradAngle: 0,
  pattern: 'none', patternColour: '', patternSize: 0, line: 'none', lineColour: '', lineWidth: 0.75,
  shadowColour: '#000000', shadowOpacity: 0.22, shadowAngle: 45, shadowDistance: 0.07, shadowBlur: 0,
  glow: false, glowColour: '', glowSize: 0.15, glowTransparency: 0.4,
};

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
  /** The group it belongs to (Format > Group); things with the same number move and select together. */
  grp?: number;
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
  /** How this step animates (Chemistry > Animate > Animate Reaction): the atom pairing and moves chosen for it. */
  morph?: MorphStep;
  /**
   * A curved arrow drawn along Bézier curves instead of an arc (an S-shaped arrow: one curve
   * whose two control points lie on opposite sides). The control points (and the joins between
   * curves) after the tail, in the frame of the line from tail to head: x along it, y across it
   * (towards perp of that line), both as fractions of its length. Two per curve plus a join
   * between curves; the arrow follows its ends this way, as an arc does with its sweep.
   */
  bez?: Vec[];
  /** What an electron-pushing arrow's ends are stuck to, so they follow the structure when it moves. */
  pin?: { tail?: Pin; head?: Pin };
  /** Bent by hand: it keeps its curve when the structure changes, rather than finding its own way round. */
  bent?: boolean;
}

/**
 * Where something is stuck to a structure (an arrow's end, a lone pair or charge on an atom):
 * a point held in the frame of up to three atoms (the one it is on, one that sets the direction
 * and one that tells a mirror image apart), so it moves, turns and flips with them.
 */
export interface Pin {
  /** What it sits on: an atom (or the lone pair drawn on it), a bond, or the gap where a bond will form. */
  on: 'atom' | 'bond' | 'gap';
  /** The atoms whose places frame it: the atom (or a bond's or gap's two ends), then the ones that set direction and handedness. */
  ref: number[];
  /** The point in that frame, in lengths of the line from the first atom to the second (points when there is no second). */
  at: Vec;
  /** Which side the third atom was on when it was stuck (+1 or −1), to see a mirror image. */
  hand: number;
  /** Where the point was when it was last put in place: when it is elsewhere, it was moved by hand. */
  was: Vec;
}

/**
 * A reaction step's animation settings, in atom ids: pairs chosen by hand (starting material
 * atom, product atom), 1,2-shifts (bond u–v walks its v end onto dest) and double-bond lines
 * that slide onto another bond.
 */
export interface MorphStep {
  pairs?: [number, number][];
  /** Use exactly these pairs; otherwise they are fixed points and the rest is matched. */
  exact?: boolean;
  shifts?: [number, number, number][];
  slides?: [[number, number], [number, number]][];
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
  /** Written inside a catalytic cycle beside the arrow: the step's name (oxidative addition, OA). */
  inside?: string[];
  /** Chosen by hand: Clean Up Reaction keeps these instead of working the roles out again. */
  manual?: boolean;
}

/** Lines or dots over a fill (Style panel > Pattern). */
export type Pattern = 'hatch' | 'backhatch' | 'crosshatch' | 'horizontal' | 'vertical' | 'grid' | 'dots' | 'dense-dots';

export interface Shape {
  id: number;
  /** The group it belongs to (Format > Group); things with the same number move and select together. */
  grp?: number;
  kind: 'line' | 'rect' | 'oval' | 'symbol' | 'bracket' | 'picture' | 'table' | 'geo' | 'ring';
  /**
   * A ring's fill (Chemistry > Highlight and Fill > Fill Rings): the ring's atoms in order. The fill follows them, and
   * goes when one of them goes. `poly` is where their centres were at the last change.
   */
  ring?: number[];
  poly?: { x: number; y: number }[];
  /** A lone pair, radical dot or circled charge stuck to its atom: it goes where the atom goes. */
  pin?: Pin;
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
  /**
   * Boxes, ovals, design shapes and pictures (see turnsFreely): turned this many degrees
   * clockwise about the middle of x1..y2, as PowerPoint turns shapes. x1..y2 stay the box before it is turned.
   */
  rot?: number;
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
  /** See-through amount of the pattern, 0 (solid, when not given) to 1 (clear). */
  patternTransparency?: number;
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
  /** Boxes, design shapes and ring fills: a drop shadow down and to the right. */
  shadow?: boolean;
  /**
   * How far the shadow sticks out, in points (a box's default is four line widths, ChemDraw's; a
   * ring fill's is that of a highlight's shadow).
   */
  shadowSize?: number;
  /** Design shapes and ring fills: the shadow's colour, how dark it is (0 to 1), which way it falls (degrees, 45 down and to the right) and its blur in points. */
  shadowColor?: string;
  shadowOpacity?: number;
  shadowAngle?: number;
  shadowBlur?: number;
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
  /**
   * A video or sound shown in the picture's place (an animation put on a slide, or Insert >
   * Video or Audio): the file as a data URL. `src` is the video's first frame (a speaker for a
   * sound), shown where it can't play. See Media for how it plays.
   */
  video?: Media;
  /**
   * What a click on it does in the slide show (an action button, a zoom, any shape): a link as
   * text links have them (links.ts): a slide, a show jump (#next, #return…), a web page or file.
   */
  link?: string;
  /**
   * A picture that is a Slide Zoom (Insert > Zoom): a picture of the slide `link` goes to. In
   * the show a click zooms into that slide; with `back`, the show comes back here after it (a
   * Summary Zoom's part runs on to the slide `to` first).
   */
  zoom?: { back?: boolean; to?: string };
  /** Parts of a picture cut off, as fractions of its width and height from each side. */
  crop?: { l: number; t: number; r: number; b: number };
  /** A picture's frame, corners and shadow (PowerPoint's Picture Styles). */
  look?: PictureLook;
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
   * A picture that is a chart (Insert > Chart): the chart and its data, drawn live in the
   * picture's box; `src` is a copy of it as a bitmap for programs that can't draw charts.
   */
  chart?: ChartBox;
  /**
   * A picture that is an equation (Insert > Equation on slides and designs): its LaTeX, laid out
   * live to fit the picture's box; `size` is its text size at its own size, in points. `src` is a
   * copy of it as an SVG for exports and for programs that can't lay out equations.
   */
  math?: ShapeMath;
  /**
   * A frame round other things (Chemistry > Labels and Numbers > Add Frame): what it surrounds (whole structures for
   * the atoms), the gap it keeps round them in points, and whether it follows them (grows,
   * shrinks and moves as they change). Moving or resizing the frame by hand stops it following.
   */
  frame?: Frame;
  /** An energy diagram's numbers and look, kept on the invisible frame round its drawing (design/energy.ts). */
  energy?: EnergyData;
  /** A SmartArt-style diagram's text and look, kept on the invisible frame round its shapes (design/diagrams.ts). */
  diagram?: DiagramData;
}

/** Can this shape be turned to any angle (Slides and Design), keeping its box and turning it as a whole? */
export function turnsFreely(s: Pick<Shape, 'kind' | 'chart' | 'table' | 'ring' | 'frame' | 'pin'>): boolean {
  return (s.kind === 'rect' || s.kind === 'oval' || s.kind === 'geo' || s.kind === 'picture') && !s.chart && !s.frame && !s.pin;
}

/**
 * How a video or sound on a slide plays (PowerPoint's Playback tab). Left out, a setting is as an
 * animation put on a slide has always played: by itself as the slide comes in, round and round,
 * at full volume.
 */
export interface Media {
  /** The file, as a data URL (video/mp4, audio/mpeg…). */
  src: string;
  /** Play once rather than round and round until the slide changes (Loop until Stopped off). */
  once?: boolean;
  /** A sound: nothing to see but its icon. */
  audio?: boolean;
  /** Seconds cut off its start and its end (Trim). */
  trimStart?: number;
  trimEnd?: number;
  /** Seconds it fades in over at the start, and out over at the end. */
  fadeIn?: number;
  fadeOut?: number;
  /** When it starts: by itself as the slide comes in (absent) or when it is clicked in the show. */
  start?: 'auto' | 'click';
  /** Volume, 0 to 1 (absent: full); `mute` silences it. */
  vol?: number;
  mute?: boolean;
  /** Back to its first frame when it has played (Rewind after Playing). */
  rewind?: boolean;
  /** A sound's icon isn't shown in the slide show (Hide During Show). */
  hide?: boolean;
  /** A sound keeps playing when the show goes on to the next slides (Play Across Slides). */
  across?: boolean;
  /** A video fills the screen while it plays (Play Full Screen). */
  full?: boolean;
  /** How long it is, in seconds, when known. */
  length?: number;
}

/** An equation on a slide or design: LaTeX, its text size in points, colour and font. */
export interface ShapeMath { tex: string; size: number; color?: string; font?: string }

/**
 * A picture's frame, corners and shadow. The line is drawn centred on the picture's edge, as
 * PowerPoint draws a picture's border.
 */
export interface PictureLook {
  /** A line round it, this many points wide, in `lineColor` (black when not set). */
  line?: number;
  lineColor?: string;
  /** Rounded corners: the radius as a fraction of the shorter side (0 to 0.5), as PowerPoint keeps it. */
  round?: number;
  /** A shadow down and to the right: soft (blurred) or hard (sharp). */
  shadow?: 'soft' | 'hard';
}

/** The two picture shadows: how far down and right, how blurred and how dark, in points (as in Document mode). */
export const PICTURE_SHADOWS: Record<'soft' | 'hard', { off: number; blur: number; alpha: number }> = {
  soft: { off: 3, blur: 6, alpha: 0.35 },
  hard: { off: 3, blur: 0, alpha: 0.5 },
};

/** Ready-made picture looks (Picture Format > Styles); each can be changed afterwards in the panel. */
export const PICTURE_STYLES: { id: string; name: string; look: PictureLook | undefined }[] = [
  { id: 'none', name: 'No frame', look: undefined },
  { id: 'thin', name: 'Thin line', look: { line: 1, lineColor: '#000000' } },
  { id: 'grey', name: 'Grey line', look: { line: 1.5, lineColor: '#7f7f7f' } },
  { id: 'thick', name: 'Thick line', look: { line: 4, lineColor: '#000000' } },
  { id: 'white', name: 'White frame', look: { line: 10, lineColor: '#ffffff', shadow: 'soft' } },
  { id: 'black', name: 'Black frame', look: { line: 10, lineColor: '#000000' } },
  { id: 'soft', name: 'Soft shadow', look: { shadow: 'soft' } },
  { id: 'hard', name: 'Hard shadow', look: { shadow: 'hard' } },
  { id: 'rounded', name: 'Rounded corners', look: { round: 0.08 } },
  { id: 'rounded-shadow', name: 'Rounded with shadow', look: { round: 0.08, shadow: 'soft' } },
  { id: 'rounded-line', name: 'Rounded with line', look: { round: 0.08, line: 1.5, lineColor: '#404040' } },
];

/** The corner radius of a picture with this look, in points, for a picture w × h. */
export function pictureRadius(look: PictureLook | undefined, w: number, h: number): number {
  return Math.max(0, Math.min(0.5, look?.round ?? 0)) * Math.min(Math.abs(w), Math.abs(h));
}

/** One cell of a table. */
export interface TableCell {
  runs: TextRun[];
  paras?: ParaStyle[];
  /** This cell's own alignment, in place of its column's. */
  align?: Justify;
  /** Number of columns the cell spans (the cells it covers are left empty). */
  span?: number;
  /** Number of rows the cell is merged down over (the cells it covers below are left empty). */
  rowSpan?: number;
  /** The cell's background colour (Word's shading; on slides, over the table style's own). */
  fill?: string;
  /** Documents: where the text sits up and down in a cell taller than it (top when left out). */
  valign?: 'center' | 'bottom';
  /** Drawings: room kept at the top of the cell for a structure dropped into it (its width and height, in points). */
  fig?: { w: number; h: number };
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
  /**
   * A table style: on slides and drawings one of PowerPoint's ("pp-medium2-1", see
   * deck/table-styles.ts), drawn in place of `lines`; in documents Word's (document/table-styles.ts).
   */
  style?: string;
  /** Which parts of the table its style marks out (PowerPoint's and Word's Table Style Options). */
  look?: TableLook;
}

/** Table Style Options: which rows and columns the table style marks out. */
export interface TableLook {
  header?: boolean;
  total?: boolean;
  bandRows?: boolean;
  firstCol?: boolean;
  lastCol?: boolean;
  bandCols?: boolean;
}

/** A drawing's page: the drawing area of one sheet of paper (inside its margins), in points. */
export interface PageSetup {
  w: number;
  h: number;
  /** The paper's name (Letter, A4…), for the Page Setup window. */
  name?: string;
  /** More pages are added when the drawing goes past the page; otherwise it is kept on the page when saved. */
  grow: boolean;
}

/** Paper sizes, as the area ChemDraw draws on (the paper less half-inch margins). */
export const PAPER: { name: string; label: string; w: number; h: number }[] = [
  { name: 'letter', label: 'US Letter (8.5 × 11 in)', w: 540, h: 720 },
  { name: 'a4', label: 'A4 (210 × 297 mm)', w: 523, h: 770 },
  { name: 'legal', label: 'US Legal (8.5 × 14 in)', w: 540, h: 936 },
  { name: 'a3', label: 'A3 (297 × 420 mm)', w: 770, h: 1118 },
  { name: 'tabloid', label: 'Tabloid (11 × 17 in)', w: 720, h: 1152 },
];

/**
 * A drawing kept on its page (File > Page Setup without "add pages"): moved back onto the page
 * where it has gone past it and fits, as one undoable step. False when it is too big to fit.
 */
export function keepOnPage(doc: Doc): boolean {
  const p = doc.page, b = doc.bounds();
  if (!p || p.grow || !b) return true;
  if (b.x2 - b.x1 > p.w || b.y2 - b.y1 > p.h) return false;
  const dx = b.x1 < 0 ? -b.x1 : b.x2 > p.w ? p.w - b.x2 : 0, dy = b.y1 < 0 ? -b.y1 : b.y2 > p.h ? p.h - b.y2 : 0;
  if (!dx && !dy) return true;
  doc.edit('Keep on page', () => {
    doc.moveAtoms(new Set(doc.atoms.keys()), dx, dy);
    for (const c of [...doc.captions.values()]) doc.updateCaption(c.id, { x: c.x + dx, y: c.y + dy });
    for (const r of [...doc.arrows.values()]) doc.updateArrow(r.id, { tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } });
    for (const s of [...doc.shapes.values()]) doc.updateShape(s.id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, ...(s.poly ? { poly: s.poly.map((q) => ({ x: q.x + dx, y: q.y + dy })) } : {}) });
  });
  return true;
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
  /** The page the drawing is on (File > Page Setup): its size in points, and whether it grows to hold the drawing. Null: no page shown. */
  page: PageSetup | null = null;
  /**
   * Draw only the highlights (a highlight animated on its own in a slide show, or saved to
   * PowerPoint as its own picture behind its structure). Not saved.
   */
  onlyHighlights = false;
  /** Set when the drawing came from a CDXML file. */
  source: CdxmlSource | null = null;
  /** Live R/S and E/Z labels from the chemistry engine (not saved, not undone). */
  stereo: StereoInfo | null = null;
  /** Formatting of placeholder text by kind (from a slide master); null outside slides. */
  textStyles: Partial<Record<Placeholder, TextBase>> | null = null;
  /** Called each time an undoable change is recorded (a slide deck keeps one history across its slides). */
  onCommit: (() => void) | null = null;
  /** Called when amend() adds to the last step instead of making a new one. */
  onAmend: (() => void) | null = null;
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
  /** The multicentre points (Atom.multi) each atom belongs to. */
  centresOf = new Map<number, number[]>();
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
  /** Set when the longest bond may have got shorter (an atom moved, a bond went): worked out again when next asked. */
  private bondLenStale = false;
  /** The longest bond (for how far around a point to look for bonds that reach it). */
  get maxBondLength(): number {
    if (this.bondLenStale) {
      this.bondLenStale = false;
      this.maxBondLen = 0;
      for (const b of this.bonds.values()) this.noteBondLength(b);
    }
    return this.maxBondLen;
  }
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

  /** The id the next new object will get (objects made after this have this id or higher). */
  get idMark(): number {
    return this.nextId;
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
    this.dropLoneCentres(tx.before);
    // arrow ends, lone pairs and charges stuck to atoms that moved go with them
    if (tx.before.size) followPins(this, tx.before);
    if (tx.before.size && this.beforeCommit) this.beforeCommit(new Map(tx.before));
    this.tx = null;
    if (tx.before.size === 0) return;
    for (const key of tx.before.keys()) tx.after.set(key, this.snapshot(key));
    this.undoStack.push(tx);
    if (this.undoStack.length > 500) this.undoStack.shift();
    this.redoStack.length = 0;
    this.onCommit?.();
  }

  /**
   * Multicentre points left with no bond (the bond to the metal erased, or the metal) go too,
   * at the end of the step, so a step that moves their bonds elsewhere keeps them.
   */
  private dropLoneCentres(before: ReadonlyMap<string, Entity | null>): void {
    const ends = new Set<number>();
    for (const [key, was] of before) {
      if (key[0] !== 'b') continue;
      const now = this.bonds.get(Number(key.slice(1)));
      for (const b of [was as Bond | null, now]) if (b) { ends.add(b.a1); ends.add(b.a2); }
    }
    for (const id of ends) if (this.atoms.get(id)?.multi && !this.degree(id)) this.removeAtom(id);
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
      if (tx.before.size) followPins(this, tx.before);
      if (tx.before.size && this.beforeCommit) this.beforeCommit(new Map(tx.before));
    } finally {
      this.tx = null;
    }
    if (!tx.before.size) return;
    if (!last) {
      for (const key of tx.before.keys()) tx.after.set(key, this.snapshot(key));
      this.undoStack.push(tx);
      this.onCommit?.();
    } else {
      for (const [key, was] of tx.before) {
        if (!last.before.has(key)) last.before.set(key, was);
        last.after.set(key, this.snapshot(key));
      }
      // no new step: a listener counting steps (Slides' undo across slides) must not count one
      this.onAmend?.();
    }
  }

  /** The things the last undo or redo put back (keys such as "a12"), for selecting them. */
  lastApplied: string[] = [];

  canUndo(): boolean { return this.undoStack.length > 0; }
  canRedo(): boolean { return this.redoStack.length > 0; }
  /** The name of the step Undo (or Redo) would take back, such as "Add Ring" ('' with none). */
  get undoLabel(): string { return this.undoStack[this.undoStack.length - 1]?.label ?? ''; }
  get redoLabel(): string { return this.redoStack[this.redoStack.length - 1]?.label ?? ''; }

  undo(): boolean {
    // not while a step is still being made (a drag): it would be undone half-way and lost
    if (this.tx) return false;
    const e = this.undoStack.pop();
    if (!e) return false;
    this.apply(e.before);
    this.lastApplied = [...e.before.keys()];
    this.redoStack.push(e);
    return true;
  }

  redo(): boolean {
    if (this.tx) return false;
    const e = this.redoStack.pop();
    if (!e) return false;
    this.apply(e.after);
    this.lastApplied = [...e.after.keys()];
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
    // a bond's whole length, so the tiles along a long one are drawn again however short the longest bond is now
    const span = (p: Vec, q: Vec) => this.dirtyRects.push({ x1: Math.min(p.x, q.x), y1: Math.min(p.y, q.y), x2: Math.max(p.x, q.x), y2: Math.max(p.y, q.y) });
    if (kind === 'a') {
      const a = e as Atom;
      pt(a.x, a.y);
      for (const bid of this.adj.get(a.id) ?? []) {
        const b = this.bonds.get(bid), q = b && this.atoms.get(b.a1 === a.id ? b.a2 : b.a1);
        if (q) span(a, q);
        // a hapto bond may be drawn to each of its point's atoms
        for (const m of q?.multi ?? []) { const r = this.atoms.get(m); if (r) span(a, r); }
      }
      // and the bonds to a multicentre point this atom is part of
      for (const c of this.centresOf.get(a.id) ?? []) for (const bid of this.adj.get(c) ?? []) {
        const b = this.bonds.get(bid), q = b && this.atoms.get(b.a1 === c ? b.a2 : b.a1);
        if (q) span(a, q);
      }
    } else if (kind === 'b') {
      const b = e as Bond;
      const p = this.atoms.get(b.a1), q = this.atoms.get(b.a2);
      if (p && q) span(p, q);
      else if (p) pt(p.x, p.y);
      else if (q) pt(q.x, q.y);
      for (const [x, y] of [[p, q], [q, p]]) for (const m of x?.multi ?? []) { const r = this.atoms.get(m); if (r && y) span(y, r); }
    } else if (kind === 'c') this.dirtyCaptions.push(e as Caption);
    else if (kind === 'r') {
      const r = e as Arrow;
      const pad = r.sweep || r.bez ? Math.hypot(r.head.x - r.tail.x, r.head.y - r.tail.y) * (r.bez ? 1.5 : 1) : r.headWidth + 2;
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
      // a moved or removed atom may have shortened the longest bond
      const was = this.atoms.get(id);
      if (was && (!e || (e as Atom).x !== was.x || (e as Atom).y !== was.y) && this.adj.get(id)?.length) this.bondLenStale = true;
      if (was?.multi) this.unlinkCentre(was);
      if (e) {
        this.atoms.set(id, e as Atom);
        if (!this.adj.has(id)) this.adj.set(id, []);
        this.indexAtom(e as Atom);
        if ((e as Atom).multi) this.linkCentre(e as Atom);
      } else {
        this.atoms.delete(id);
        this.unindexAtom(id);
        this.adj.delete(id);
      }
    } else if (kind === 'b') {
      this.dirtyBonds.add(id);
      const old = this.bonds.get(id);
      if (old) {
        this.bondLenStale = true;
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

  private linkCentre(c: Atom): void {
    for (const m of c.multi!) {
      const l = this.centresOf.get(m);
      if (!l) this.centresOf.set(m, [c.id]);
      else if (!l.includes(c.id)) l.push(c.id);
    }
  }

  private unlinkCentre(c: Atom): void {
    for (const m of c.multi!) {
      const l = this.centresOf.get(m);
      if (!l) continue;
      const i = l.indexOf(c.id);
      if (i >= 0) l.splice(i, 1);
      if (!l.length) this.centresOf.delete(m);
    }
  }

  /** The middle of a multicentre point's atoms, where it sits (null when none of them are left). */
  centreOf(c: Pick<Atom, 'multi'>): Vec | null {
    let x = 0, y = 0, n = 0;
    for (const id of c.multi ?? []) { const a = this.atoms.get(id); if (a) { x += a.x; y += a.y; n++; } }
    return n ? { x: x / n, y: y / n } : null;
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
    const reach = Math.min(this.maxBondLength, 200) / 2 + r;
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
    // a multicentre point always sits in the middle of its atoms, wherever it is asked to go
    if (n.multi) { const c = this.centreOf(n); if (c) { n.x = c.x; n.y = c.y; } }
    this.rawSet('a', id, n);
    if (n.x !== a.x || n.y !== a.y || patch.multi) {
      for (const bid of this.adj.get(id) ?? []) this.noteBondLength(this.bonds.get(bid)!);
      for (const c of [...(this.centresOf.get(id) ?? [])]) this.updateAtom(c, {});
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
    const centres = [...(this.centresOf.get(id) ?? [])];
    this.touch('a', id);
    this.rawSet('a', id, null);
    // a multicentre point loses the atom, and goes once fewer than two are left
    for (const c of centres) {
      const ca = this.atoms.get(c);
      if (!ca?.multi) continue;
      const rest = ca.multi.filter((m) => m !== id && this.atoms.has(m));
      if (rest.length < 2) this.removeAtom(c);
      else this.updateAtom(c, { multi: rest });
    }
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
    this.page = other.page && { ...other.page };
    this.source = other.source;
    this.nextId = Math.max(this.nextId, other.nextId);
    this.atoms.clear(); this.bonds.clear(); this.captions.clear(); this.arrows.clear(); this.shapes.clear();
    this.adj.clear(); this.centresOf.clear(); this.grid.clear(); this.atomCell.clear(); this.maxBondLen = 0; this.bondLenStale = false;
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
    const fields = ['style', 'background', 'page', 'source', 'textStyles', 'atoms', 'bonds', 'captions', 'arrows', 'shapes', 'adj', 'centresOf',
      'grid', 'atomCell', 'maxBondLen', 'bondLenStale', 'undoStack', 'redoStack'] as const;
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
    // a step already open (a drag) is kept as it was, not folded into this or closed by it
    const outer = this.tx;
    this.tx = null;
    this.begin('bulk');
    try {
      fn();
    } finally {
      this.tx = outer;
      this.version++;
    }
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

  /**
   * Bond orders plus any radical electrons: what an atom's hydrogens are worked out from. Bonds
   * to metals count only as far as the atom's lowest valence has room for them, as the rest are
   * its lone pairs given to the metal: PPh₃ on a metal stays P (not PH), a chloride bridging two
   * metals stays Cl, and a methyl on one is still CH₃.
   */
  valenceSum(atomId: number): number {
    const a = this.atoms.get(atomId);
    const rad = a ? radicalElectrons(a) : 0;
    let own = 0, toMetal = 0;
    for (const bid of this.adj.get(atomId) ?? []) {
      const b = this.bonds.get(bid)!;
      if (outsideValence(b)) continue;
      if (isMetalAtom(this.atoms.get(b.a1 === atomId ? b.a2 : b.a1))) toMetal += b.order;
      else own += b.order;
    }
    if (toMetal && a && !a.label && !isMetalAtom(a)) {
      const low = lowestValence(a.z, a.charge);
      if (low !== undefined) toMetal = Math.min(toMetal, Math.max(0, low - Math.ceil(own - 1e-6) - rad));
    }
    return own + toMetal + rad;
  }

  bondOrderSum(atomId: number): number {
    let s = 0;
    for (const bid of this.adj.get(atomId) ?? []) {
      const b = this.bonds.get(bid)!;
      // a dative bond doesn't change either atom's hydrogens (H3N→BF3), nor does a partial bond
      if (outsideValence(b)) continue;
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
      // a metal bonded to a ring through its middle is one structure with it
      const a = this.atoms.get(id);
      for (const m of [...(a?.multi ?? []), ...(this.centresOf.get(id) ?? [])]) {
        if (!seen.has(m) && this.atoms.has(m)) { seen.add(m); stack.push(m); }
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
