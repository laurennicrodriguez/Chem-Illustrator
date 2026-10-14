// Mouse and keyboard handling: drawing tools, ChemDraw hotkeys, selection, undo, zoom and
// pan. The editor changes the document and asks for a repaint; hover and drawing previews
// only repaint the overlay layer.

import { Doc, Atom, Bond, BondDisplay, Arrow, Shape, Caption, applyBase, stripBase, type StepRoles, type HighlightStyle } from '../model';
import { CaptionEditor } from '../ui/caption-editor';
import { GEO_BY_ID, geoDef, moveSteps, traceSteps } from '../design/geo';
import { TEMPLATES, Template, Placement, templateById, templatePoints, placePoint, fusePlacements, atomPlacements, freePlacement, crowdingOf, placeTemplate, snap15 } from '../chem/templates';
import { styleFromFace, plainText } from '../richtext';
import { cleanUpMoves } from '../chem/cleanup';
import { Renderer, measureText } from '../render/renderer';
import { ASCENT } from '../text/layout';
import { cellAlign, insertRow, nextCell, partAt, partRuns, setColumnWidth, setPart, spanOf, NOTE_SCALE, type TablePart } from '../table';
import { Vec, Rect, add, sub, mul, norm, dist, dot, distToSegment, rectContains, angleOf, fromAngle, snapAngle, perp, DEG, exitParam } from '../geom';
import {
  sproutDir, sprout, bondTo, bondLength, atomAt, freeRing, fusedRing, fuseSide, ringOnAtom,
  placeRing, chainPoints, chainFrom, MERGE_FRACTION,
} from '../chem/chemgeom';
import { keymap, chordOf, parseAction, KeyContext } from './keymap';
import { sproutGroup, fuseChair, SPROUT_KINDS, SproutKind, nextNumber } from '../chem/sprouts';
import { joinAtoms, joinBonds } from '../chem/join';
import { extractDrawing, insertDrawing } from '../io/clipboard';
import { isReactionArrow, itemFinder, rolesOf, ROLES, schemeItems, type Item, type Role } from '../chem/reaction';
import { applySchemePlan, planCleanUp } from '../chem/scheme-layout';
import { fillRings, refitRingFills } from '../chem/ring-fill';
import { setMethylStyle, toggleChainEndLabels, toggleExplicitHydrogens, type MethylStyle } from '../chem/hydrogens';
import { selectedGroup } from '../chem/group-smiles';
import { circleRing, circleRings, kekulize } from '../chem/aromatic';
import { bondLayer, crossingBonds } from '../chem/crossing';
import { nextNumber as nextCompound, planNumbers, type NumberOptions } from '../chem/compound-numbers';
import { pushArrow, symbolSpot, SMALL_HEAD, type PushArrow, type PushEnd } from '../chem/mechanism';
import { applyArrange, planArrange, type ArrangeOptions } from '../chem/scheme-arrange';
import { attachWhereItIs, defaultGap, placeAttached, refitAttached } from './attached';
import { frameAround, frameBox, frameMembers, refitFrames, defaultPad, thingsInside } from './frames';
import { Align, Measure, POINTS, Snapshot, units, alignOffsets, distributeOffsets, moveUnit, selectionBox, snapshot, transform, rotation, mirrorX, mirrorY } from './arrange';
import { elementNumber, hasImplicitH, implicitHydrogens, SYMBOLS } from '../chem/elements';
import { tokenize, addNicknames, isBuiltInNickname } from '../chem/labels';
import {
  Handle, arrowHit, shapeHit, arrowHandles, shapeHandles, dragArrowHandle, dragShapeHandle, dragCropHandle, shapeBox,
  arrowPoints, bracketsAround, bracketLip, unionRect,
  shapeOrder, portNear, shapePorts,
} from '../objects';
import { isEmptyText } from '../deck/deck';
import { crossedBonds, lineAcross } from '../chem/fragments';
import { imageFor } from '../render/images';

export type Tool =
  | { kind: 'select' }
  | { kind: 'eraser' }
  | { kind: 'bond'; order: number; display: BondDisplay }
  | { kind: 'chain' }
  | { kind: 'ring'; size: number; aromatic: boolean }
  | { kind: 'text' }
  | { kind: 'arrow'; style: ArrowStyle }
  | { kind: 'shape'; shape: ShapeStyle; from: 'corner' | 'center' }
  | { kind: 'bracket'; bracket: NonNullable<Shape['bracket']> }
  | { kind: 'template'; id: string }
  | { kind: 'symbol'; symbol: SymbolKind }
  /** Puts the element picked in the periodic table on atoms (or new atoms in empty space). */
  | { kind: 'element' }
  /** Mass fragmentation: a line dragged across bonds (or a click on one) breaks them, and each piece gets its formula and mass. */
  | { kind: 'fragment' };

/** Marks put on atoms for mechanisms: a lone pair, a radical's dot, a circled charge, or δ+ / δ−. */
export type SymbolKind = 'LonePair' | 'Electron' | 'CirclePlus' | 'CircleMinus' | 'DeltaPlus' | 'DeltaMinus';

/** How a new arrow looks (everything else is the document's default). */
export type ArrowStyle = Partial<Pick<Arrow, 'headStyle' | 'tailStyle' | 'headType' | 'line' | 'noGo' | 'equilibrium' | 'sweep' | 'elbow' | 'from' | 'to'>> & {
  /** Two shafts and an open head (⇒). */
  retro?: boolean;
  /** A connector: its ends stick to shapes' connection points, and it isn't snapped to 15° steps. */
  connector?: boolean;
};

/** How a new shape looks. */
export type ShapeStyle = Partial<Omit<Shape, 'id' | 'kind' | 'x1' | 'y1' | 'x2' | 'y2'>> & { kind: 'line' | 'rect' | 'oval' | 'geo' };

export const TOOLS: Record<string, Tool> = {
  select: { kind: 'select' },
  eraser: { kind: 'eraser' },
  element: { kind: 'element' },
  fragment: { kind: 'fragment' },
  'bond-single': { kind: 'bond', order: 1, display: 'solid' },
  'bond-double': { kind: 'bond', order: 2, display: 'solid' },
  'bond-triple': { kind: 'bond', order: 3, display: 'solid' },
  'bond-quadruple': { kind: 'bond', order: 4, display: 'solid' },
  'bond-dative': { kind: 'bond', order: 1, display: 'dative' },
  'bond-wedge': { kind: 'bond', order: 1, display: 'wedge' },
  'bond-hashWedge': { kind: 'bond', order: 1, display: 'hashWedge' },
  'bond-hash': { kind: 'bond', order: 1, display: 'hash' },
  'bond-bold': { kind: 'bond', order: 1, display: 'bold' },
  'bond-dash': { kind: 'bond', order: 1, display: 'dash' },
  'bond-wavy': { kind: 'bond', order: 1, display: 'wavy' },
  chain: { kind: 'chain' },
  'ring-3': { kind: 'ring', size: 3, aromatic: false },
  'ring-4': { kind: 'ring', size: 4, aromatic: false },
  'ring-5': { kind: 'ring', size: 5, aromatic: false },
  'ring-6': { kind: 'ring', size: 6, aromatic: false },
  'ring-7': { kind: 'ring', size: 7, aromatic: false },
  'ring-8': { kind: 'ring', size: 8, aromatic: false },
  'ring-benzene': { kind: 'ring', size: 6, aromatic: true },
  'ring-cp': { kind: 'ring', size: 5, aromatic: true },
  text: { kind: 'text' },
  arrow: { kind: 'arrow', style: {} },
  'arrow-dashed': { kind: 'arrow', style: { line: 'dashed' } },
  'arrow-hollow': { kind: 'arrow', style: { headType: 'hollow' } },
  'arrow-double': { kind: 'arrow', style: { tailStyle: 'full' } },
  'arrow-equilibrium': { kind: 'arrow', style: { headStyle: 'halfLeft', tailStyle: 'halfLeft', equilibrium: true } },
  'arrow-retro': { kind: 'arrow', style: { headType: 'angle', retro: true } },
  'arrow-nogo': { kind: 'arrow', style: { noGo: true } },
  'arrow-curved': { kind: 'arrow', style: { sweep: 120 * DEG } },
  'arrow-fishhook': { kind: 'arrow', style: { sweep: 120 * DEG, headStyle: 'halfLeft' } },
  connector: { kind: 'arrow', style: { connector: true } },
  'connector-elbow': { kind: 'arrow', style: { connector: true, elbow: true } },
  'shape-rect': { kind: 'shape', shape: { kind: 'rect' }, from: 'corner' },
  'shape-rect-rounded': { kind: 'shape', shape: { kind: 'rect', rounded: true }, from: 'corner' },
  'shape-rect-shadow': { kind: 'shape', shape: { kind: 'rect', shadow: true }, from: 'corner' },
  'shape-rect-rounded-shadow': { kind: 'shape', shape: { kind: 'rect', rounded: true, shadow: true }, from: 'corner' },
  'shape-rect-dashed': { kind: 'shape', shape: { kind: 'rect', dashed: true }, from: 'corner' },
  'shape-circle': { kind: 'shape', shape: { kind: 'oval' }, from: 'center' },
  'shape-circle-filled': { kind: 'shape', shape: { kind: 'oval', filled: true }, from: 'center' },
  'shape-oval': { kind: 'shape', shape: { kind: 'oval' }, from: 'corner' },
  'shape-line': { kind: 'shape', shape: { kind: 'line' }, from: 'corner' },
  'shape-line-dashed': { kind: 'shape', shape: { kind: 'line', dashed: true }, from: 'corner' },
  'shape-line-bold': { kind: 'shape', shape: { kind: 'line', bold: true }, from: 'corner' },
  'bracket-square': { kind: 'bracket', bracket: 'square' },
  'bracket-round': { kind: 'bracket', bracket: 'round' },
  'bracket-curly': { kind: 'bracket', bracket: 'curly' },
  'sym-lonepair': { kind: 'symbol', symbol: 'LonePair' },
  'sym-radical': { kind: 'symbol', symbol: 'Electron' },
  'sym-plus': { kind: 'symbol', symbol: 'CirclePlus' },
  'sym-minus': { kind: 'symbol', symbol: 'CircleMinus' },
  'sym-delta-plus': { kind: 'symbol', symbol: 'DeltaPlus' },
  'sym-delta-minus': { kind: 'symbol', symbol: 'DeltaMinus' },
};
for (const t of TEMPLATES) TOOLS[`tpl-${t.id}`] = { kind: 'template', id: t.id };

export type Hit =
  | { kind: 'atom'; id: number }
  | { kind: 'bond'; id: number }
  | { kind: 'caption'; id: number }
  | { kind: 'arrow'; id: number }
  | { kind: 'shape'; id: number }
  | null;

/** Colour and name for each role of a reaction step, when the arrow is selected. */
const ROLE_LOOK: Record<Role, [string, string]> = {
  reactants: ['#2f6fde', 'starting material'], products: ['#16955a', 'product'], above: ['#c47a00', 'above'], below: ['#c47a00', 'below'],
};

export interface Selection {
  atoms: Set<number>;
  bonds: Set<number>;
  captions: Set<number>;
  arrows: Set<number>;
  shapes: Set<number>;
}

const emptySel = (): Selection => ({ atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() });

interface Drag {
  start: Vec; // doc coords
  startScreen: Vec;
  hit: Hit;
  button: number;
  moved: boolean;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  mode: 'none' | 'pan' | 'move' | 'marquee' | 'draw' | 'handle' | 'rotate' | 'text';
  last: Vec;
  panOrigin?: { ox: number; oy: number };
  /** The arrow or shape handle being dragged. */
  handle?: Handle;
  /** Where the pointer has been (which way a curved arrow is drawn bending). */
  path?: Vec[];
  /** Rotating the selection: what it looked like before, the centre, and the angle so far. */
  rot?: { snap: Snapshot; center: Vec; from: number; angle: number };
  /** Moving with smart guides: the selection's box when the move began, and how far it has gone. */
  guide?: { box: Rect; moved: Vec };
}

const HILITE = 'rgba(40, 120, 255, 0.28)';
const PREVIEW = '#2f6fdf';

export class Editor {
  tool: Tool = TOOLS['bond-single'];
  toolName = 'bond-single';
  sel: Selection = emptySel();
  hover: Hit = null;
  /** Where the pointer is, in document coordinates. */
  pointer: Vec = { x: 0, y: 0 };
  /**
   * A highlight set by the keyboard or by drawing (a new atom, or one reached with the arrow
   * keys). It stays when the mouse moves into empty space, as in ChemDraw, and gives way when
   * the mouse points at something else.
   */
  private keyHot: Hit = null;
  /** What the mouse pointed at when the keyboard highlight was set. */
  private keyHotHover: Hit = null;
  /** Preferences from the settings file. */
  /** With one reaction arrow selected, outline what its starting materials, products and conditions are. */
  showRoles = true;

  options = {
    /** After 1 or 0 on the atom under the mouse, the highlight stays there (ChemDraw). */
    keepHotspotOnBond: true,
    /** New bonds are one bond length long, unless Alt is held (Ctrl+L). */
    fixedLength: true,
    /** New bonds point in 15° steps, unless Alt is held (Ctrl+E). */
    fixedAngles: true,
    /** Show Terminal Methyls writes them as CH3 or as Me (Structure > Terminal Methyls as …). */
    methylStyle: 'Me' as MethylStyle,
  };
  /** Run a menu command by name; false when it doesn't apply, so the key does nothing. */
  runCommand: (name: string) => boolean = () => false;
  /** The Choose Nickname list, for =. */
  onNickname: (atomId: number) => void = () => {};
  /** Show the Style panel for what was just selected, for /. */
  onProperties: () => void = () => {};
  private drag: Drag | null = null;
  private needScene = true;
  private needOverlay = true;
  private frameQueued = false;
  private inputTs = 0;
  /** Input-to-paint times for the speed readout (ms). */
  latencies: number[] = [];
  onChange: () => void = () => {};
  /** A right click on the drawing (not a right-button drag, which pans). */
  onContextMenu: (e: MouseEvent) => void = () => {};
  private pendingContext: MouseEvent | null = null;
  private rightDragged = false;
  onFrame: () => void = () => {};
  onToolChange: (name: string) => void = () => {};
  /** The fragmentation tool drew a line from p to q across these bonds (the app works out the masses). */
  onFragment: (p: Vec, q: Vec, bonds: number[]) => void = () => {};
  /** The atom most recently drawn or changed (its structure is analysed when nothing is selected). */
  lastEdited: number | null = null;
  private labelInput: HTMLInputElement | null = null;
  /** The mouse is over the drawing, so keys are for the drawing even if a button has the focus. */
  private pointerInside = false;
  /** Keys don't reach the drawing (while presenting slides). */
  paused = false;
  /** Slides are showing: the keys for slides come before the ones for anywhere. */
  slideKeys = false;
  /** The picture being cropped: its handles cut the picture instead of resizing it. */
  cropping: number | null = null;

  constructor(public doc: Doc, public r: Renderer, public host: HTMLElement) {
    const el = r.overlay;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    // pressing on the text being typed keeps the keys going to it
    el.addEventListener('mousedown', (e) => { if (this.captionEd?.hit(this.docPoint(e))) e.preventDefault(); });
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerenter', () => { this.pointerInside = true; });
    el.addEventListener('pointerleave', () => { this.pointerInside = false; if (!this.drag) { this.hover = null; this.requestOverlay(); } });
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // a right-button drag pans; the menu only shows for a right click that stayed put.
      // (Windows sends this after the button comes up, macOS while it is still down.)
      if (this.drag?.button === 2) this.pendingContext = e;
      else if (!this.rightDragged) this.onContextMenu(e);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    // frames that follow what they surround are refitted as each change finishes
    doc.beforeCommit = (before) => {
      let frames = false, rings = false, tied = false;
      for (const s of this.doc.shapes.values()) { if (s.frame?.fit) frames = true; if (s.kind === 'ring') rings = true; }
      for (const c of this.doc.captions.values()) if (c.attach) { tied = true; break; }
      // ring fills first, then labels beside their structures: a frame round a structure takes in both
      if (rings) refitRingFills(this.doc, before);
      if (tied) refitAttached(this.doc, before, this.measure());
      if (frames) refitFrames(this.doc, before, this.measure());
    };
  }

  // ------------------------------------------------------------------ painting

  requestScene(ts = performance.now()): void {
    this.needScene = true;
    this.needOverlay = true;
    this.queue(ts);
  }

  requestOverlay(ts = performance.now()): void {
    this.needOverlay = true;
    this.queue(ts);
  }

  private queue(ts: number): void {
    if (!this.inputTs) this.inputTs = ts;
    if (this.frameQueued) return;
    this.frameQueued = true;
    requestAnimationFrame(() => this.frame());
  }

  /**
   * Paint now (used by the frame loop and by the benchmark). Interactive frames paint as many
   * new tiles as fit in a frame and finish on the next ones; `full` paints everything.
   */
  frame(full = false): void {
    this.frameQueued = false;
    if (this.needScene) {
      this.r.renderScene(this.doc, full ? Infinity : 10);
      this.needScene = this.r.incomplete;
    }
    if (this.needOverlay) {
      this.drawOverlay();
      this.needOverlay = false;
    }
    if (this.inputTs) {
      // Event timestamps share the performance.now() clock.
      this.latencies.push(performance.now() - this.inputTs);
      if (this.latencies.length > 200) this.latencies.shift();
      this.inputTs = 0;
    }
    this.onFrame();
    if (this.needScene) this.queue(performance.now());
  }

  changed(): void {
    this.onChange();
    this.requestScene();
  }

  setTool(name: string): void {
    const t = TOOLS[name] ?? (name.startsWith('geo:') ? geoTool(name.slice(4), this.geoLook) : undefined);
    if (!t) return;
    this.tool = t;
    this.toolName = name;
    this.onToolChange(name);
    this.requestOverlay();
  }

  // ------------------------------------------------------------------ hit testing

  private tol(px: number): number {
    return px / this.r.view.scale;
  }

  hitTest(p: Vec): Hit {
    const doc = this.doc;
    const L = doc.style.bondLength;
    const atomR = Math.max(L * 0.28, this.tol(6));
    let best: Atom | null = null;
    let bd = Infinity;
    // structures locked (Slides): clicks go through them to the text and shapes
    if (!this.structuresLocked) for (const a of doc.atomsNear(p, Math.max(atomR, L * 2))) {
      const d = dist(a, p);
      const k = a.s ?? 1;
      let hit = d <= atomR * k;
      if (!hit && (a.label || a.z !== 6)) {
        for (const b of this.r.atomInfo(doc, a).boxes) if (rectContains(b, p)) { hit = true; break; }
      }
      if (hit && d < bd) { bd = d; best = a; }
    }
    if (best) return { kind: 'atom', id: best.id };
    const bondTol = Math.max(L * 0.16, this.tol(5));
    let bb: Bond | null = null;
    let bbd = bondTol;
    if (!this.structuresLocked) for (const b of doc.bondsNear(p, bondTol)) {
      const a1 = doc.atoms.get(b.a1)!, a2 = doc.atoms.get(b.a2)!;
      const d = distToSegment(p, a1, a2);
      if (d < bbd) { bbd = d; bb = b; }
    }
    if (bb) return { kind: 'bond', id: bb.id };
    for (const c of doc.captions.values()) {
      const r = this.r.captionBox(c);
      if (p.x >= r.x1 - 1 && p.x <= r.x2 + 1 && p.y >= r.y1 - 1 && p.y <= r.y2 + 1) return { kind: 'caption', id: c.id };
    }
    const at = this.tol(5);
    for (const r of doc.arrows.values()) {
      if (arrowHit(r, p, at)) return { kind: 'arrow', id: r.id };
    }
    // the shape drawn last is on top
    const order = shapeOrder([...doc.shapes.values()]);
    for (let i = order.length - 1; i >= 0; i--) {
      const s = order[i];
      if (!s.hidden && !s.locked && shapeHit(s, p, at)) return { kind: 'shape', id: s.id };
    }
    return null;
  }

  /**
   * Handles shown on selected arrows and shapes: ends and middle of an arrow, corners of a box.
   * Shown when only a few arrows or shapes (and no structures) are selected.
   */
  handles(): Handle[] {
    const s = this.sel;
    const n = s.arrows.size + s.shapes.size;
    if (!n || n > 4 || s.atoms.size || s.bonds.size) return [];
    const out: Handle[] = [];
    for (const id of s.arrows) { const r = this.doc.arrows.get(id); if (r) out.push(...arrowHandles(r)); }
    for (const id of s.shapes) { const sh = this.doc.shapes.get(id); if (sh) out.push(...shapeHandles(sh)); }
    return out;
  }

  private handleAt(p: Vec): Handle | null {
    const tol = this.tol(6);
    let best: Handle | null = null, bd = tol;
    for (const h of this.handles()) {
      const d = dist(h.at, p);
      if (d <= bd) { bd = d; best = h; }
    }
    return best;
  }

  /** The atom or bond hotkeys apply to: one set by the keyboard or by drawing, else the one under the pointer. */
  hotspot(): Hit {
    const k = this.keyHot;
    if (k && (k.kind === 'atom' ? this.doc.atoms.has(k.id) : k.kind === 'bond' && this.doc.bonds.has(k.id))) return k;
    return this.hover;
  }

  /** Put the highlight on an atom or bond from the keyboard (it stays until the mouse points elsewhere). */
  setKeyHot(h: Hit): void {
    this.keyHot = h;
    this.keyHotHover = this.hover;
    this.requestOverlay();
  }

  // ------------------------------------------------------------------ pointer

  /** A drawing point as a position in the browser window. */
  private clientPoint(p: Vec): Vec {
    const rect = this.r.overlay.getBoundingClientRect();
    const s = this.r.toScreen(p);
    return { x: rect.left + s.x, y: rect.top + s.y };
  }

  private docPoint(e: PointerEvent | MouseEvent | WheelEvent): Vec {
    const rect = this.r.overlay.getBoundingClientRect();
    return this.r.toDoc(e.clientX - rect.left, e.clientY - rect.top);
  }

  private onDown(e: PointerEvent): void {
    this.commitLabel();
    // a press on the text being typed (or its width handle) goes to the text
    const cap = this.captionEd;
    if (cap && e.button === 2 && cap.hit(this.docPoint(e)) === 'text') {
      // right-click on the text: spelling suggestions and chemistry fixes
      cap.contextMenu(this.docPoint(e), e.clientX, e.clientY);
      return;
    }
    if (cap && e.button === 0 && cap.hit(this.docPoint(e))) {
      const p = this.docPoint(e);
      const rect = this.r.overlay.getBoundingClientRect();
      this.r.overlay.setPointerCapture(e.pointerId);
      this.drag = { start: p, startScreen: { x: e.clientX - rect.left, y: e.clientY - rect.top }, hit: null, button: 0, moved: false, shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, mode: 'text', last: p };
      cap.pointerDown(p, e.shiftKey);
      return;
    }
    this.closeCaption();
    this.keyHot = null;
    this.r.overlay.setPointerCapture(e.pointerId);
    const p = this.docPoint(e);
    const rect = this.r.overlay.getBoundingClientRect();
    const rh = e.button === 0 ? this.rotateHandle() : null;
    const rotating = !!rh && dist(rh, p) <= this.tol(7);
    // Shift+drag from an arrow with an arrow tool branches a new arrow off it (not its handles)
    const branching = e.shiftKey && this.tool.kind === 'arrow';
    const handle = e.button === 0 && !rotating && !branching ? this.handleAt(p) : null;
    const hit = handle || rotating ? null : this.hitTest(p);
    this.drag = {
      start: p, startScreen: { x: e.clientX - rect.left, y: e.clientY - rect.top }, hit, button: e.button, moved: false,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, mode: handle ? 'handle' : rotating ? 'rotate' : 'none', last: p, path: [p],
    };
    if (handle) this.drag.handle = handle;
    if (rotating) {
      const b = this.selBox()!;
      const center = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
      this.drag.rot = { snap: snapshot(this.doc, this.sel, this.measure()), center, from: angleOf(sub(p, center)), angle: 0 };
    }
    if (e.button === 1 || e.button === 2) {
      this.drag.mode = 'pan';
      this.drag.panOrigin = { ox: this.r.view.ox, oy: this.r.view.oy };
      e.preventDefault();
    }
  }

  private onMove(e: PointerEvent): void {
    const p = this.docPoint(e);
    this.pointer = p;
    const d = this.drag;
    if (d?.mode === 'text') {
      this.captionEd?.pointerMove(p);
      return;
    }
    if (!d && this.captionEd?.hit(p)) {
      this.r.overlay.style.cursor = this.captionEd.cursor(p);
      return;
    }
    if (!d) {
      const rh = this.rotateHandle();
      const onRotate = !!rh && dist(rh, p) <= this.tol(7);
      const handle = onRotate ? null : this.handleAt(p);
      const h = handle || onRotate ? null : this.hitTest(p);
      if (!sameHit(h, this.hover)) { this.hover = h; }
      // the keyboard highlight gives way once the mouse points at something new
      if (this.keyHot) {
        if (!h) this.keyHotHover = null;
        else if (!sameHit(h, this.keyHotHover)) this.keyHot = null;
      }
      // a hand over what is selected: dragging there moves it
      const movable = !!h && this.tool.kind !== 'eraser' && this.isSelected(h);
      // in Slides and Design, text boxes show an I-beam: a click there types, a drag moves the box
      const typing = this.textFirst && this.tool.kind === 'select' && h?.kind === 'caption';
      this.r.overlay.style.cursor = onRotate ? 'grab' : handle ? (handle.which === 'mid' ? 'grab' : 'crosshair') : typing ? 'text' : movable ? 'grab' : '';
      this.requestOverlay(e.timeStamp);
      return;
    }
    const rect = this.r.overlay.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!d.moved && Math.hypot(sp.x - d.startScreen.x, sp.y - d.startScreen.y) > 3) {
      d.moved = true;
      if (d.mode === 'none') d.mode = this.dragModeFor(d);
      if (d.mode === 'handle') this.doc.begin(d.handle!.which === 'mid' ? 'Bend arrow' : this.cropping === d.handle!.id ? 'Crop picture' : 'Resize');
      if (d.mode === 'rotate') this.doc.begin('Rotate');
      if (d.mode === 'move') {
        this.r.overlay.style.cursor = 'grabbing';
        this.doc.begin('Move');
        if (d.hit && !this.isSelected(d.hit)) {
          // dragging an unselected atom or object moves just that
          this.sel = emptySel();
          this.addToSel(d.hit);
        }
      }
    }
    if (!d.moved) return;
    if (d.mode === 'pan') {
      this.r.view.ox = d.panOrigin!.ox + (sp.x - d.startScreen.x);
      this.r.view.oy = d.panOrigin!.oy + (sp.y - d.startScreen.y);
      this.requestScene(e.timeStamp);
      return;
    }
    if (d.mode === 'move' && this.smartGuides && !e.altKey) {
      // smart guides: edges and middles snap into line with other shapes and the page
      if (!d.guide) { const box = this.selBox(); if (box) d.guide = { box, moved: { x: 0, y: 0 } }; }
      if (d.guide) {
        const g = guideSnap(d.guide.box, sub(p, d.start), this.guideTargets(), this.tol(6));
        this.moveSelection(g.offset.x - d.guide.moved.x, g.offset.y - d.guide.moved.y);
        d.guide.moved = g.offset;
        this.guideLines = g.lines;
        d.last = p;
        this.requestScene(e.timeStamp);
        return;
      }
    }
    if (d.mode === 'move') {
      const dx = p.x - d.last.x, dy = p.y - d.last.y;
      this.moveSelection(dx, dy);
      d.last = p;
      this.requestScene(e.timeStamp);
      return;
    }
    if (d.mode === 'rotate') {
      const r = d.rot!;
      let ang = angleOf(sub(p, r.center)) - r.from;
      ang = Math.atan2(Math.sin(ang), Math.cos(ang));
      // Shift turns in 15° steps
      ang = e.shiftKey ? snapAngle(ang) : Math.round(ang / DEG) * DEG;
      r.angle = ang;
      transform(this.doc, r.snap, rotation(r.center, ang), false);
      d.last = p;
      this.requestScene(e.timeStamp);
      return;
    }
    if (d.mode === 'handle') {
      const h = d.handle!;
      if (h.kind === 'arrow') {
        const r = this.doc.arrows.get(h.id);
        if (r) {
          let patch = dragArrowHandle(r, h.which, p, e.altKey);
          // a connector's end sticks to the connection point it is dropped on, and comes loose elsewhere
          if ((h.which === 'tail' || h.which === 'head') && (this.glueArrows || r.from || r.to || r.elbow)) {
            const key = h.which === 'tail' ? 'from' : 'to';
            const port = this.portAt(p);
            patch = port ? { [h.which]: port.at, [key]: { shape: port.shape, port: port.port } } : { [h.which]: p, [key]: undefined };
          }
          this.doc.updateArrow(h.id, patch);
        }
      } else {
        const sh = this.doc.shapes.get(h.id);
        if (sh) this.doc.updateShape(h.id, this.cropping === h.id ? dragCropHandle(sh, h.which, p) : dragShapeHandle(sh, h.which, p, e.altKey));
      }
      d.last = p;
      this.requestScene(e.timeStamp);
      return;
    }
    d.last = p;
    d.path?.push(p);
    this.hover = this.hitTest(p);
    this.requestOverlay(e.timeStamp);
  }

  private dragModeFor(d: Drag): Drag['mode'] {
    // with any drawing tool, dragging what is already selected moves it (as in ChemDraw)
    if (d.hit && this.tool.kind !== 'eraser' && this.isSelected(d.hit)) return 'move';
    switch (this.tool.kind) {
      case 'select':
        return d.hit ? 'move' : 'marquee';
      case 'eraser':
      case 'symbol':
      case 'element':
        return 'none';
      case 'bond':
      case 'chain':
      case 'ring':
      case 'arrow':
      case 'shape':
      case 'bracket':
      case 'template':
      case 'fragment':
        return 'draw';
      case 'text':
        // dragging across empty space makes a text box that wide
        return d.hit && d.hit.kind === 'caption' ? 'move' : d.hit ? 'none' : 'draw';
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const p = this.docPoint(e);
    if (d.mode === 'text') { this.captionEd?.pointerUp(); return; }
    if (d.button === 2) {
      this.rightDragged = d.moved;
      const ctx = this.pendingContext;
      this.pendingContext = null;
      if (ctx && !d.moved) this.onContextMenu(ctx);
    }
    if (d.mode === 'pan') { this.requestScene(e.timeStamp); return; }
    if (d.mode === 'handle' || d.mode === 'rotate') {
      if (d.moved) { this.doc.commit(); this.changed(); }
      return;
    }
    if (d.mode === 'move') {
      this.guideLines = [];
      this.doc.commit();
      this.changed();
      return;
    }
    if (d.mode === 'marquee') {
      this.selectRect(d.start, p, d.shift);
      this.requestOverlay(e.timeStamp);
      this.onChange();
      return;
    }
    if (!d.moved) this.click(d, p);
    else if (d.mode === 'draw') this.finishDraw(d, p);
    this.hover = this.hitTest(p);
    this.requestScene(e.timeStamp);
  }

  /**
   * Right-click: what is under the pointer. Something not already selected becomes the
   * selection first (a whole structure for an atom or bond), as in ChemDraw, so the menu's
   * commands act on what was clicked. Empty space away from the selection clears it. Null on
   * empty space.
   */
  contextPick(e: MouseEvent): Hit {
    const p = this.docPoint(e);
    if (this.captionEd?.hit(p)) return null;
    const h = this.hitTest(p);
    // empty space (outside the selection's box): the menu for the page, not the selection
    if (!h && this.hasSelection()) {
      const b = this.selBox();
      if (!b || p.x < b.x1 || p.x > b.x2 || p.y < b.y1 || p.y > b.y2) this.clearSelection();
    }
    if (h && !this.isSelected(h)) {
      if (h.kind === 'atom' || h.kind === 'bond') this.selectFragment(h.kind === 'atom' ? h.id : this.doc.bonds.get(h.id)!.a1, false);
      else {
        this.selectOnly(h);
        this.onChange();
      }
    }
    return h;
  }

  private onDoubleClick(e: MouseEvent): void {
    const p = this.docPoint(e);
    // (in the text being typed, a double-click selects a word: the text sees the clicks itself)
    if (this.captionEd?.hit(p)) return;
    const h = this.hitTest(p);
    if (this.tool.kind === 'select' && h && (h.kind === 'atom' || h.kind === 'bond')) {
      const atom = h.kind === 'atom' ? h.id : this.doc.bonds.get(h.id)!.a1;
      this.selectFragment(atom, e.shiftKey);
    } else if (h && h.kind === 'atom' && this.tool.kind !== 'text') {
      this.editLabel(h.id);
    } else if (h && h.kind === 'caption') {
      this.editCaption(h.id, { x: e.clientX, y: e.clientY });
    } else if (h && h.kind === 'shape' && this.doc.shapes.get(h.id)?.kind === 'table') {
      this.editTableAt(h.id, p);
    } else if (h && h.kind === 'shape' && this.doc.shapes.get(h.id)?.kind === 'geo') {
      this.editGeoText(h.id, p);
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    const rect = this.r.overlay.getBoundingClientRect();
    const sx = e.clientX - rect.left, sy = e.clientY - rect.top;
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0025));
      this.zoomAt(sx, sy, f);
    } else {
      const k = e.deltaMode === 1 ? 16 : 1;
      this.r.view.ox -= (e.shiftKey ? e.deltaY : e.deltaX) * k;
      this.r.view.oy -= (e.shiftKey ? 0 : e.deltaY) * k;
    }
    this.requestScene(e.timeStamp);
  }

  zoomAt(sx: number, sy: number, f: number): void {
    const v = this.r.view;
    const ns = Math.min(64, Math.max(0.05, v.scale * f));
    const k = ns / v.scale;
    v.ox = sx - (sx - v.ox) * k;
    v.oy = sy - (sy - v.oy) * k;
    v.scale = ns;
  }

  /** Zoom about the middle of the window by a factor, or to a scale (screen pixels per point). */
  zoomBy(f: number): void {
    this.zoomAt(this.r.width / 2, this.r.height / 2, f);
    this.requestScene();
  }

  zoomTo(scale: number): void {
    this.zoomBy(scale / this.r.view.scale);
  }

  /** What Fit shows instead of the whole drawing (the slide, in Slides mode). */
  fitArea: (() => { x1: number; y1: number; x2: number; y2: number }) | null = null;

  /** Zoom and scroll so the whole drawing (or the slide) fits the window. */
  fit(): void {
    const raw = this.fitArea ? this.fitArea() : this.doc.bounds();
    if (!raw) return;
    // room for atom labels, which reach past the atoms themselves (H3N, Re)
    const m = this.fitArea ? 0 : this.doc.style.labelSize * 1.5;
    const b = { x1: raw.x1 - m, y1: raw.y1 - m, x2: raw.x2 + m, y2: raw.y2 + m };
    const w = this.r.width, h = this.r.height;
    const bw = Math.max(20, b.x2 - b.x1), bh = Math.max(20, b.y2 - b.y1);
    const s = Math.min(8, 0.92 * Math.min(w / bw, h / bh));
    this.r.view.scale = s;
    this.r.view.ox = w / 2 - ((b.x1 + b.x2) / 2) * s;
    this.r.view.oy = h / 2 - ((b.y1 + b.y2) / 2) * s;
    this.requestScene();
  }

  // ------------------------------------------------------------------ clicks

  private click(d: Drag, p: Vec): void {
    const doc = this.doc;
    const h = d.hit;
    const t = this.tool;
    switch (t.kind) {
      case 'select': {
        // an empty title or text placeholder takes typing straight away, as in PowerPoint
        const c = h?.kind === 'caption' ? doc.captions.get(h.id) : undefined;
        if (c?.ph && isEmptyText(c) && !d.shift) { this.sel = emptySel(); this.editCaption(c.id); return; }
        // in Slides and Design a click in a text box puts the caret there, as in PowerPoint
        if (c && this.textFirst && !d.shift) { this.sel = emptySel(); this.editCaption(c.id, this.clientPoint(p)); return; }
        if (!d.shift) this.sel = emptySel();
        if (h) this.toggleSel(h);
        if (h?.kind === 'shape') this.noteTablePart(h.id, p);
        if (this.cropping !== null && !this.sel.shapes.has(this.cropping)) this.cropping = null;
        this.onChange();
        return;
      }
      case 'eraser': {
        if (h) doc.edit('Erase', () => this.erase(h));
        this.changed();
        return;
      }
      case 'symbol': {
        this.placeSymbol(t.symbol, h, p);
        return;
      }
      case 'element': {
        const sym = SYMBOLS[this.element];
        if (h && h.kind === 'atom') doc.edit(`Make ${sym}`, () => this.applyLabel(h.id, sym));
        else if (!h) doc.edit(`Add ${sym}`, () => { this.lastEdited = doc.addAtom(p.x, p.y, this.element).id; });
        else return;
        this.changed();
        return;
      }
      case 'template': {
        doc.edit('Template', () => this.placeTemplateAt(t.id, h, p, null, d.alt));
        this.changed();
        return;
      }
      case 'fragment': {
        // clicking a bond breaks just that one
        const line = h?.kind === 'bond' ? lineAcross(doc, h.id) : null;
        if (line) this.onFragment(line.p, line.q, [h!.id]);
        return;
      }
      case 'text': {
        if (h && h.kind === 'atom') this.editLabel(h.id);
        else if (h && h.kind === 'caption') this.editCaption(h.id, this.clientPoint(p));
        else if (h && h.kind === 'shape' && doc.shapes.get(h.id)?.kind === 'table') this.editTableAt(h.id, p);
        else if (h && h.kind === 'shape' && doc.shapes.get(h.id)?.kind === 'geo') this.editGeoText(h.id, p);
        else this.newCaption(p);
        return;
      }
      case 'arrow':
      case 'shape':
      case 'bracket': {
        // clicking an arrow or shape picks it up, so its handles can be dragged
        if (h && (h.kind === 'arrow' || h.kind === 'shape')) { this.selectOnly(h); return; }
        if (t.kind === 'shape' && t.shape.kind === 'geo') {
          // a click puts the shape down at its usual size, centred there
          const [w, hh] = geoDef(t.shape.geo).size;
          doc.edit('Shape', () => this.selectOnly({ kind: 'shape', id: doc.addShape({ ...t.shape, x1: p.x - w / 2, y1: p.y - hh / 2, x2: p.x + w / 2, y2: p.y + hh / 2 }).id }));
          this.afterGeo();
          this.changed();
          return;
        }
        if (t.kind === 'bracket') {
          // brackets round the structure that was clicked
          if (h && (h.kind === 'atom' || h.kind === 'bond')) {
            const atom = h.kind === 'atom' ? h.id : doc.bonds.get(h.id)!.a1;
            const L = doc.style.bondLength;
            const box = this.structureBox(doc.fragmentOf(atom));
            const r = { x1: box.x1 - L * 0.45, y1: box.y1 - L * 0.3, x2: box.x2 + L * 0.45, y2: box.y2 + L * 0.3 };
            this.addBrackets(r, t.bracket);
          }
          return;
        }
        if (t.kind === 'arrow') {
          const L = doc.style.bondLength;
          doc.edit('Arrow', () => this.selectOnly({ kind: 'arrow', id: this.addArrow(p, add(p, { x: L * (t.style.sweep ? 2 : 3), y: 0 }), t.style).id }));
          this.changed();
        }
        return;
      }
      case 'bond': {
        if (!this.sel.atoms.size) this.sel = emptySel();
        doc.edit('Bond', () => {
          if (h && h.kind === 'atom') {
            const n = sprout(doc, h.id, t.order, t.display);
            this.lastEdited = n.id;
          } else if (h && h.kind === 'bond') {
            this.clickBond(h.id, t, p);
          } else {
            const L = doc.style.bondLength;
            const a = doc.addAtom(p.x, p.y);
            const b = bondTo(doc, a, add(p, fromAngle(-30 * DEG, L)), t.order, t.display);
            this.lastEdited = b.id;
          }
        });
        // as in ChemDraw, the far end of the new bond takes the next hotkey
        if (!h || h.kind === 'atom') this.setKeyHot({ kind: 'atom', id: this.lastEdited! });
        this.changed();
        return;
      }
      case 'chain': {
        // a click asks how long a chain to draw (Alt+click draws the same length again)
        const from = h && h.kind === 'atom' ? h.id : null;
        if (d.alt || !this.askChainLength) this.drawChain(from, p, this.chainLength);
        else void this.askChainLength(this.chainLength).then((n) => { if (n) this.drawChain(from, p, n); });
        return;
      }
      case 'ring': {
        if (!this.sel.atoms.size) this.sel = emptySel();
        doc.edit('Ring', () => this.ringClick(h, p, t.size, t.aromatic, d.alt, d.shift, undefined, d.ctrl));
        this.changed();
        return;
      }
    }
  }

  private clickBond(id: number, t: Extract<Tool, { kind: 'bond' }>, p: Vec): void {
    const doc = this.doc;
    const b = doc.bonds.get(id)!;
    this.lastEdited = b.a1;
    if (t.display === 'solid' && t.order === 1) {
      // single → double → triple → single
      if (b.display !== 'solid') doc.updateBond(id, { display: 'solid', order: 1 });
      else doc.updateBond(id, { order: b.order === 1 ? 2 : b.order === 2 ? 3 : 1, dpos: 'auto' });
    } else if (t.order === 2) {
      if (b.order !== 2) doc.updateBond(id, { order: 2, display: 'solid', dpos: 'auto' });
      else {
        const next: Record<string, Bond['dpos']> = { auto: 'center', center: 'right', right: 'left', left: 'auto' };
        doc.updateBond(id, { dpos: next[b.dpos] });
      }
    } else if (t.order === 3) {
      doc.updateBond(id, { order: 3, display: 'solid' });
    } else if (t.order === 4) {
      doc.updateBond(id, { order: b.order === 4 ? 1 : 4, display: 'solid' });
    } else if (t.display === 'dative') {
      // the arrow points away from the atom nearer the click; clicking a dative bond reverses it
      if (b.display === 'dative') doc.updateBond(id, { a1: b.a2, a2: b.a1 });
      else {
        const a1 = doc.atoms.get(b.a1)!, a2 = doc.atoms.get(b.a2)!;
        const flip = dist(p, a2) < dist(p, a1);
        doc.updateBond(id, { order: 1, display: 'dative', ...(flip ? { a1: b.a2, a2: b.a1 } : {}) });
      }
    } else if (t.display === 'wedge' || t.display === 'hashWedge') {
      if (b.display === t.display) doc.updateBond(id, { a1: b.a2, a2: b.a1 });
      else {
        // narrow end at the atom nearer the click
        const a1 = doc.atoms.get(b.a1)!, a2 = doc.atoms.get(b.a2)!;
        const flip = dist(p, a2) < dist(p, a1);
        doc.updateBond(id, { order: 1, display: t.display, ...(flip ? { a1: b.a2, a2: b.a1 } : {}) });
      }
    } else {
      doc.updateBond(id, { order: 1, display: b.display === t.display ? 'solid' : t.display });
    }
  }

  private ringClick(h: Hit, p: Vec, n: number, aromatic: boolean, alt: boolean, shift: boolean, towards?: Vec, circle = false): void {
    const doc = this.doc;
    let ids: number[];
    if (h && h.kind === 'bond') {
      const b = doc.bonds.get(h.id)!;
      const side = fuseSide(doc, b, n, p);
      const pts = fusedRing(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, n, side);
      ids = placeRing(doc, pts, { aromatic, shiftPhase: shift, existing: [b.a1, b.a2], scale: b.s });
    } else if (h && h.kind === 'atom') {
      let a = doc.atoms.get(h.id)!;
      const L = bondLength(doc, a);
      const deg = doc.degree(a.id);
      if (alt || deg >= 3) a = sprout(doc, a.id);
      const dir = sproutDir(doc, a.id);
      ids = placeRing(doc, ringOnAtom(a, dir, n, L), { aromatic, shiftPhase: shift, existing: [a.id], scale: a.s });
    } else {
      const L = doc.style.bondLength;
      ids = placeRing(doc, freeRing(p, n, L, towards), { aromatic, shiftPhase: shift });
    }
    // Ctrl: an aromatic ring drawn with a circle
    if (circle && aromatic) circleRing(doc, ids.slice(0, n));
    this.lastEdited = ids[0];
  }

  /**
   * Where a template goes. On a bond: fused along it, on its emptier side. On an atom: sharing
   * it (rings, sugars) or joined to it by a new bond (amino acids; Alt swaps the two), lying
   * away from the rest of the structure, or towards the pointer when dragged. Elsewhere: centred
   * where clicked, turned towards the pointer when dragged (15° steps; Alt: any angle).
   */
  private templatePlacement(t: Template, h: Hit, start: Vec, cursor: Vec | null, alt: boolean):
    { pl: Placement; existing: Map<number, number>; bondFrom?: number; scale?: number } | null {
    const doc = this.doc;
    const best = (cands: Placement[], ignore: Set<number>, prefer?: (pl: Placement) => number) => {
      let pick: Placement | null = null, score = Infinity;
      for (const pl of cands) {
        const sc = crowdingOf(doc, t, pl, ignore) + (prefer?.(pl) ?? 0) + (pl.mirror ? 0.001 : 0);
        if (sc < score - 1e-9) { score = sc; pick = pl; }
      }
      return pick;
    };
    const nearest = (pl: Placement, i: number, ids: number[]) => {
      const q = templatePoints(t, pl)[i];
      return ids.reduce((m, id) => (dist(doc.atoms.get(id)!, q) < dist(doc.atoms.get(m)!, q) ? id : m));
    };
    if (h && h.kind === 'bond' && t.fuse) {
      const b = doc.bonds.get(h.id)!;
      const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      const n = perp(sub(q, p)), mid = mul(add(p, q), 0.5);
      const towards = cursor ?? start;
      // on a tie, the side the pointer is on
      const side = (pl: Placement) => {
        const c = placePoint(pl, 0, 0);
        return Math.sign(dot(sub(c, mid), n)) === Math.sign(dot(sub(towards, mid), n)) ? 0 : 0.01;
      };
      const pl = best(fusePlacements(t, p, q), new Set([p.id, q.id]), side);
      if (!pl) return null;
      return { pl, existing: new Map([[t.fuse[0], nearest(pl, t.fuse[0], [p.id, q.id])], [t.fuse[1], nearest(pl, t.fuse[1], [p.id, q.id])]]), scale: b.s };
    }
    if (h && h.kind === 'atom') {
      const a = doc.atoms.get(h.id)!;
      const L = bondLength(doc, a);
      let byBond = (t.join === 'bond') !== alt;
      if (!byBond && doc.degree(a.id) >= 3) byBond = true;
      const dir = cursor && dist(cursor, a) > L * 0.3 ? norm(fromAngle(snapAngle(angleOf(sub(cursor, a))))) : sproutDir(doc, a.id);
      const pl = best(atomPlacements(t, a, dir, L, byBond), new Set([a.id]));
      if (!pl) return null;
      return byBond ? { pl, existing: new Map(), bondFrom: a.id, scale: a.s } : { pl, existing: new Map([[t.attach, a.id]]), scale: a.s };
    }
    const L = doc.style.bondLength;
    let angle = 0;
    if (cursor && dist(cursor, start) > L * 0.3) angle = alt ? angleOf(sub(cursor, start)) : snap15(angleOf(sub(cursor, start)));
    return { pl: freePlacement(start, L, angle), existing: new Map() };
  }

  private placeTemplateAt(id: string, h: Hit, start: Vec, cursor: Vec | null, alt: boolean): void {
    const t = templateById(id);
    const place = t && this.templatePlacement(t, h, start, cursor, alt);
    if (!t || !place) return;
    const ids = placeTemplate(this.doc, t, place.pl, { existing: place.existing, bondFrom: place.bondFrom, scale: place.scale });
    this.lastEdited = ids[t.attach];
  }

  // ------------------------------------------------------------------ drags that draw

  /**
   * Where a dragged bond ends: on an atom under the pointer, else one bond length away in a
   * 15° step. Alt, or turning off fixed lengths (Ctrl+L) or angles (Ctrl+E), lets it go free.
   */
  private snapEnd(from: Vec, p: Vec, L: number, fromId?: number, alt = false): { pt: Vec; atom?: Atom } {
    const h = this.hitTest(p);
    if (h && h.kind === 'atom' && h.id !== fromId) {
      const a = this.doc.atoms.get(h.id)!;
      return { pt: a, atom: a };
    }
    const raw = angleOf(sub(p, from));
    const ang = this.options.fixedAngles && !alt ? snapAngle(raw) : raw;
    const len = this.options.fixedLength && !alt ? L : Math.max(L * 0.2, dist(p, from));
    return { pt: add(from, fromAngle(ang, len)) };
  }

  private finishDraw(d: Drag, p: Vec): void {
    const doc = this.doc;
    const t = this.tool;
    const h = d.hit;
    const startAtom = h && h.kind === 'atom' ? doc.atoms.get(h.id)! : null;
    const start = startAtom ?? d.start;
    if (t.kind === 'text') {
      // a text box as wide as the drag, its first line at the top
      const x1 = Math.min(d.start.x, p.x), x2 = Math.max(d.start.x, p.x), y1 = Math.min(d.start.y, p.y);
      this.openCaption(null, { x: x1, y: y1 + ASCENT * doc.style.captionSize }, undefined, Math.max(8, x2 - x1));
      return;
    }
    if (t.kind === 'bond') {
      doc.edit('Bond', () => {
        const a = startAtom ?? doc.addAtom(start.x, start.y);
        const L = bondLength(doc, a);
        const end = this.snapEnd(a, p, L, a.id, d.alt);
        const to = end.atom ?? bondTo(doc, a, end.pt, t.order, t.display);
        if (end.atom && !doc.bondBetween(a.id, end.atom.id)) doc.addBond(a.id, end.atom.id, t.order, t.display);
        this.lastEdited = to.id;
      });
      this.setKeyHot({ kind: 'atom', id: this.lastEdited! });
    } else if (t.kind === 'chain') {
      doc.edit('Chain', () => {
        const a = startAtom ?? doc.addAtom(start.x, start.y);
        const pts = chainPoints(a, p, bondLength(doc, a), doc.style.chainAngle, this.chainFirstUp(a, p));
        let cur = a;
        for (let i = 1; i < pts.length; i++) cur = bondTo(doc, cur, pts[i]);
        this.lastEdited = cur.id;
      });
    } else if (t.kind === 'ring') {
      doc.edit('Ring', () => {
        if (h && h.kind === 'bond') this.ringClick(h, p, t.size, t.aromatic, d.alt, d.shift, undefined, d.ctrl);
        else if (h && h.kind === 'atom') {
          const a = doc.atoms.get(h.id)!;
          const dir = norm(fromAngle(snapAngle(angleOf(sub(p, a)))));
          const ids = placeRing(doc, ringOnAtom(a, dir, t.size, bondLength(doc, a)), { aromatic: t.aromatic, shiftPhase: d.shift, existing: [a.id], scale: a.s });
          if (d.ctrl && t.aromatic) circleRing(doc, ids.slice(0, t.size));
          this.lastEdited = ids[0];
        } else this.ringClick(null, d.start, t.size, t.aromatic, false, d.shift, p, d.ctrl);
      });
    } else if (t.kind === 'arrow') {
      const push = this.pushFor(d, p);
      if (push) {
        const lw = doc.style.lineWidth;
        doc.edit('Arrow', () => this.selectOnly({ kind: 'arrow', id: this.addArrow(push.tail, push.head, { ...t.style, sweep: Math.abs(push.sweep), ...(push.small ? { headLength: lw * SMALL_HEAD.length, headWidth: lw * SMALL_HEAD.width } : {}) }, Math.sign(push.sweep)).id }));
        return;
      }
      const c = this.connectorEnds(t.style, d.start, p);
      if (c) {
        if (dist(c.tail, c.head) < 2) return;
        doc.edit('Connector', () => this.selectOnly({ kind: 'arrow', id: this.addArrow(c.tail, c.head, { ...t.style, ...c.glue }).id }));
        return;
      }
      const start = this.branchStart(d);
      const end = this.arrowEnd(start, p, d.alt);
      doc.edit('Arrow', () => this.selectOnly({ kind: 'arrow', id: this.addArrow(start, end, t.style, this.bendSide(d, end)).id }));
    } else if (t.kind === 'shape') {
      const g = this.shapeGeometry(t, d.start, p, d.shift, d.alt);
      if (g) doc.edit('Shape', () => this.selectOnly({ kind: 'shape', id: doc.addShape({ ...t.shape, ...g }).id }));
      if (g && t.shape.kind === 'geo') this.afterGeo();
    } else if (t.kind === 'bracket') {
      const r = { x1: Math.min(d.start.x, p.x), y1: Math.min(d.start.y, p.y), x2: Math.max(d.start.x, p.x), y2: Math.max(d.start.y, p.y) };
      if (r.y2 - r.y1 >= 4) this.addBrackets(r, t.bracket);
    } else if (t.kind === 'template') {
      doc.edit('Template', () => this.placeTemplateAt(t.id, h, d.start, p, d.alt));
    } else if (t.kind === 'fragment') {
      this.onFragment(d.start, p, crossedBonds(doc, d.start, p));
      this.requestScene();
      return;
    }
    this.changed();
  }

  /** Where a dragged arrow ends: snapped to 15° steps (Alt: anywhere), and at least a bond long. */
  private arrowEnd(start: Vec, p: Vec, free: boolean): Vec {
    const L = this.doc.style.bondLength;
    const l = Math.max(L, dist(p, start));
    return add(start, fromAngle(free ? angleOf(sub(p, start)) : snapAngle(angleOf(sub(p, start))), l));
  }

  /**
   * A new arrow Shift+dragged from an existing one branches from it: it starts exactly at that arrow's
   * head, tail or middle, whichever is nearest (to split a scheme into two paths).
   */
  private branchStart(d: Drag): Vec {
    if (d.hit?.kind !== 'arrow' || !d.shift) return d.start;
    const r = this.doc.arrows.get(d.hit.id);
    if (!r) return d.start;
    const mid = r.sweep ? arrowPoints(r)[12] : { x: (r.tail.x + r.head.x) / 2, y: (r.tail.y + r.head.y) / 2 };
    const spots = [r.tail, r.head, mid];
    return spots.reduce((a, b) => (dist(b, d.start) < dist(a, d.start) ? b : a));
  }

  /** Which way a curved arrow bends: towards the side the pointer swung out to, else to the left. */
  private bendSide(d: Drag, end: Vec): number {
    return this.swing(d, d.start, end) ?? 1;
  }

  /** The side the pointer swung out to on its way from a to b (+1 left, −1 right), if it clearly did. */
  private swing(d: Drag, a: Vec, b: Vec): number | undefined {
    const n = perp(norm(sub(b, a)));
    let most = 0;
    for (const q of d.path ?? []) { const o = dot(sub(q, a), n); if (Math.abs(o) > Math.abs(most)) most = o; }
    return Math.abs(most) > this.tol(4) ? (most > 0 ? -1 : 1) : undefined;
  }

  /**
   * A curved arrow dragged from an atom or bond, or onto one, is an electron-pushing arrow: it
   * snaps from the lone pair or bond to the atom or bond it points at (Alt: draw it freely).
   */
  private pushFor(d: Drag, p: Vec): PushArrow | null {
    const t = this.tool;
    if (t.kind !== 'arrow' || !t.style.sweep || d.alt) return null;
    const endOf = (h: Hit, at: Vec): PushEnd => (h && (h.kind === 'atom' || h.kind === 'bond') ? { kind: h.kind, id: h.id } : { kind: 'point', p: at });
    const from = endOf(d.hit, d.start);
    let to = endOf(this.hitTest(p), p);
    if (from.kind === 'point' && to.kind === 'point') return null;
    if (to.kind !== 'point' && from.kind === to.kind && (from as { id: number }).id === to.id) to = { kind: 'point', p };
    if (to.kind === 'point' && dist(p, d.start) < this.tol(6)) return null;
    // a swing of the pointer chooses the bend; otherwise it bends away from the structure
    const a = from.kind === 'point' ? from.p : d.start;
    return pushArrow(this.doc, this.measure(), from, to, this.swing(d, a, p));
  }

  /** The box, circle or line a shape tool draws for a drag from a to b (Shift: square or circle). */
  private shapeGeometry(t: Extract<Tool, { kind: 'shape' }>, a: Vec, b: Vec, shift: boolean, alt: boolean): Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'> | null {
    if (t.shape.kind === 'line') {
      const e = alt ? b : add(a, fromAngle(snapAngle(angleOf(sub(b, a))), dist(a, b)));
      return dist(a, e) < 2 ? null : { x1: a.x, y1: a.y, x2: e.x, y2: e.y };
    }
    if (t.from === 'center') {
      const r = dist(a, b);
      return r < 1 ? null : { x1: a.x - r, y1: a.y - r, x2: a.x + r, y2: a.y + r };
    }
    let w = b.x - a.x, h = b.y - a.y;
    if (shift) { const m = Math.max(Math.abs(w), Math.abs(h)); w = Math.sign(w || 1) * m; h = Math.sign(h || 1) * m; }
    if (Math.abs(w) < 2 && Math.abs(h) < 2) return null;
    return { x1: Math.min(a.x, a.x + w), y1: Math.min(a.y, a.y + h), x2: Math.max(a.x, a.x + w), y2: Math.max(a.y, a.y + h) };
  }

  /**
   * Put a lone pair, radical dot, circled charge or δ+ / δ− on the clicked atom, in the most open
   * space round it, or where the click was. A circled charge also gives the atom that charge
   * (shown by the circle instead of in its label).
   */
  private placeSymbol(kind: SymbolKind, h: Hit, p: Vec): void {
    const doc = this.doc;
    const L = doc.style.bondLength;
    const atom = h?.kind === 'atom' ? doc.atoms.get(h.id)! : null;
    const delta = kind === 'DeltaPlus' || kind === 'DeltaMinus';
    const circled = kind === 'CirclePlus' || kind === 'CircleMinus';
    const size = kind === 'LonePair' ? 2.6 : circled ? 4.5 : delta ? 0.9 * L : 1.4;
    let at = p, dir = { x: 0, y: -1 };
    if (atom) {
      // what already sits round the atom: other symbols and short captions
      const taken: Vec[] = [];
      for (const s of doc.shapes.values()) if (s.kind === 'symbol') { const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 }; if (dist(c, atom) < 0.8 * L) taken.push(c); }
      for (const c of doc.captions.values()) { const b = this.r.captionBox(c); const m = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 }; if (dist(m, atom) < 0.8 * L && plainText(c.runs).length <= 3) taken.push(m); }
      ({ at, dir } = symbolSpot(doc, this.measure(), atom.id, taken, size));
    }
    doc.edit('Symbol', () => {
      this.sel = emptySel();
      if (delta) {
        const c = doc.addCaption({ x: at.x, y: at.y, runs: [{ text: 'δ' }, { text: kind === 'DeltaPlus' ? '+' : '−', sup: true }], justify: 'left' });
        // centre it on the spot
        const b = this.r.captionBox(c);
        doc.updateCaption(c.id, { x: c.x + at.x - (b.x1 + b.x2) / 2, y: c.y + at.y - (b.y1 + b.y2) / 2 });
        this.sel.captions.add(c.id);
        return;
      }
      let box: Pick<Shape, 'x1' | 'y1' | 'x2' | 'y2'>;
      if (kind === 'LonePair') {
        // the two dots side by side across the direction they point
        const n = perp(dir);
        box = { x1: at.x - n.x * 1.12, y1: at.y - n.y * 1.12, x2: at.x + n.x * 1.12, y2: at.y + n.y * 1.12 };
      } else if (kind === 'Electron') box = { x1: at.x, y1: at.y, x2: at.x, y2: at.y };
      else box = { x1: at.x - size / 2, y1: at.y - size / 2, x2: at.x + size / 2, y2: at.y + size / 2 };
      this.sel.shapes.add(doc.addShape({ kind: 'symbol', symbol: kind, ...box }).id);
      // a radical's dot makes the atom a radical (one hydrogen fewer)
      if (atom && kind === 'Electron' && !atom.radical) doc.updateAtom(atom.id, { radical: 'doublet' });
      if (atom && circled) doc.updateAtom(atom.id, { charge: atom.charge + (kind === 'CirclePlus' ? 1 : -1), hideCharge: true });
    });
    this.changed();
  }

  private addBrackets(r: Rect, bracket: NonNullable<Shape['bracket']>): void {
    this.doc.edit('Brackets', () => {
      this.sel = emptySel();
      for (const b of bracketsAround(r, bracket)) this.sel.shapes.add(this.doc.addShape(b).id);
    });
    this.changed();
  }

  /** Box round some atoms and their labels. */
  structureBox(atomIds: Iterable<number>): Rect {
    let r: Rect | null = null;
    for (const id of atomIds) {
      const a = this.doc.atoms.get(id);
      if (!a) continue;
      r = unionRect(r, { x1: a.x, y1: a.y, x2: a.x, y2: a.y });
      for (const b of this.r.atomInfo(this.doc, a).boxes) r = unionRect(r, b);
    }
    return r ?? { x1: 0, y1: 0, x2: 0, y2: 0 };
  }

  /** Select just this one thing. */
  private selectOnly(h: NonNullable<Hit>): void {
    this.sel = emptySel();
    this.addToSel(h);
    this.requestOverlay();
    this.onChange();
  }

  /** The element the periodic table tool puts on atoms (its atomic number). */
  element = 7;

  /** Pick the periodic table tool's element; atoms already selected become that element too. */
  pickElement(z: number): void {
    this.element = z;
    const ids = [...this.sel.atoms].filter((id) => this.doc.atoms.has(id));
    if (ids.length) {
      this.doc.edit(`Make ${SYMBOLS[z]}`, () => { for (const id of ids) this.applyLabel(id, SYMBOLS[z]); });
      this.changed();
    }
    this.setTool('element');
  }

  /** How many atoms the chain tool's click adds; set by the window it opens. */
  chainLength = 4;
  /** Asks how many atoms a clicked chain should add (null: cancelled). */
  askChainLength: ((last: number) => Promise<number | null>) | null = null;

  /** Draw a zig-zag chain of n new atoms on an atom, or of n atoms in empty space. */
  drawChain(from: number | null, p: Vec, n: number): void {
    const doc = this.doc;
    n = Math.max(1, Math.min(200, Math.round(n)));
    this.chainLength = n;
    const bonds = from === null ? Math.max(1, n - 1) : n;
    if (from !== null && !doc.atoms.has(from)) return;
    if (!this.sel.atoms.size) this.sel = emptySel();
    doc.edit('Chain', () => {
      const pts = chainFrom(doc, from, p, bonds, doc.style.chainAngle);
      let cur = from !== null ? doc.atoms.get(from)! : doc.addAtom(p.x, p.y);
      for (let i = 1; i < pts.length; i++) cur = bondTo(doc, cur, pts[i]);
      this.lastEdited = cur.id;
    });
    this.setKeyHot({ kind: 'atom', id: this.lastEdited! });
    this.changed();
  }

  private chainFirstUp(a: Vec & { id?: number }, p: Vec): boolean {
    // Lean the first bond towards the side the pointer is on, relative to the snapped axis.
    const ang = snapAngle(angleOf(sub(p, a)));
    const axis = fromAngle(ang);
    const off = (p.x - a.x) * perp(axis).x + (p.y - a.y) * perp(axis).y;
    return off <= 0;
  }

  /** Add an arrow from tail to head in the given style; `side` −1 bends a curved arrow the other way. */
  private addArrow(tail: Vec, head: Vec, style: ArrowStyle = {}, side = 1): Arrow {
    const lw = this.doc.style.lineWidth;
    const { retro, connector: _, ...rest } = style;
    // ChemDraw's defaults: heads ten line widths long and 2.5 wide
    const a: Omit<Arrow, 'id'> = {
      tail, head, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false,
      equilibrium: false, sweep: 0, headLength: lw * 10, headWidth: lw * 2.5, ...rest,
    };
    if (a.sweep && side < 0) {
      a.sweep = -a.sweep;
      const swap = (x: Arrow['headStyle']) => (x === 'halfLeft' ? 'halfRight' : x === 'halfRight' ? 'halfLeft' : x);
      a.headStyle = swap(a.headStyle);
      a.tailStyle = swap(a.tailStyle);
    }
    // a retrosynthetic arrow, with the sizes ChemDraw gives one
    if (retro) Object.assign(a, { shaftSpacing: lw * 6, headLength: lw * 6, headWidth: lw * 1.5 });
    return this.doc.addArrow(a);
  }

  // ------------------------------------------------------------------ selection

  private isSelected(h: Hit): boolean {
    if (!h) return false;
    return this.selSet(h.kind).has(h.id);
  }

  private selSet(kind: NonNullable<Hit>['kind']): Set<number> {
    return kind === 'atom' ? this.sel.atoms : kind === 'bond' ? this.sel.bonds : kind === 'caption' ? this.sel.captions : kind === 'arrow' ? this.sel.arrows : this.sel.shapes;
  }

  private addToSel(h: NonNullable<Hit>): void {
    this.selSet(h.kind).add(h.id);
    if (h.kind === 'bond') {
      const b = this.doc.bonds.get(h.id)!;
      this.sel.atoms.add(b.a1);
      this.sel.atoms.add(b.a2);
    }
  }

  private toggleSel(h: NonNullable<Hit>): void {
    const s = this.selSet(h.kind);
    if (s.has(h.id)) s.delete(h.id);
    else this.addToSel(h);
  }

  selectAll(): void {
    const d = this.doc;
    this.sel = { atoms: new Set(d.atoms.keys()), bonds: new Set(d.bonds.keys()), captions: new Set(d.captions.keys()), arrows: new Set(d.arrows.keys()), shapes: new Set([...d.shapes.values()].filter((s) => !s.hidden && !s.locked).map((s) => s.id)) };
    this.requestOverlay();
    this.onChange();
  }

  /** Select one atom or bond and bring it into view (from the list of warnings). */
  reveal(kind: 'atom' | 'bond' | 'caption', id: number): void {
    const doc = this.doc;
    let p: Vec;
    if (kind === 'caption') {
      const c = doc.captions.get(id);
      if (!c) return;
      const b = this.r.captionBox(c);
      p = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    } else if (kind === 'atom') {
      const a = doc.atoms.get(id);
      if (!a) return;
      p = a;
    } else {
      const b = doc.bonds.get(id);
      if (!b) return;
      const x = doc.atoms.get(b.a1)!, y = doc.atoms.get(b.a2)!;
      p = { x: (x.x + y.x) / 2, y: (x.y + y.y) / 2 };
    }
    this.sel = emptySel();
    this.addToSel({ kind, id });
    const v = this.r.view;
    const s = this.r.toScreen(p);
    const m = 60;
    // zoom in to at least 150% so the problem can be seen, and centre it if it's off screen
    const zoom = v.scale < 2;
    if (zoom) v.scale = 2;
    if (zoom || s.x < m || s.y < m || s.x > this.r.width - m || s.y > this.r.height - m) {
      v.ox = this.r.width / 2 - p.x * v.scale;
      v.oy = this.r.height / 2 - p.y * v.scale;
    }
    this.requestScene();
    this.onChange();
  }

  clearSelection(): void {
    this.sel = emptySel();
    this.requestOverlay();
    this.onChange();
  }

  hasSelection(): boolean {
    const s = this.sel;
    return s.atoms.size + s.bonds.size + s.captions.size + s.arrows.size + s.shapes.size > 0;
  }

  private selectFragment(atomId: number, add: boolean): void {
    if (!add) this.sel = emptySel();
    for (const id of this.doc.fragmentOf(atomId)) {
      this.sel.atoms.add(id);
      for (const bid of this.doc.adj.get(id) ?? []) this.sel.bonds.add(bid);
    }
    this.requestOverlay();
    this.onChange();
  }

  private selectRect(a: Vec, b: Vec, add: boolean): void {
    const r: Rect = { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
    if (!add) this.sel = emptySel();
    const doc = this.doc;
    if (!this.structuresLocked) for (const at of doc.atomsIn(r)) this.sel.atoms.add(at.id);
    for (const id of this.sel.atoms) {
      for (const bid of doc.adj.get(id) ?? []) {
        const bb = doc.bonds.get(bid)!;
        if (this.sel.atoms.has(bb.a1) && this.sel.atoms.has(bb.a2)) this.sel.bonds.add(bid);
      }
    }
    const inside = (x: number, y: number) => x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
    for (const c of doc.captions.values()) { const bx = this.r.captionBox(c); if (inside(bx.x1, bx.y1) && inside(bx.x2, bx.y2)) this.sel.captions.add(c.id); }
    const within = (b: Rect) => inside(b.x1, b.y1) && inside(b.x2, b.y2);
    for (const ar of doc.arrows.values()) if (arrowPoints(ar).every((q) => inside(q.x, q.y))) this.sel.arrows.add(ar.id);
    for (const s of doc.shapes.values()) if (!s.hidden && !s.locked && within(s.kind === 'bracket' ? { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) } : shapeBox(s))) this.sel.shapes.add(s.id);
  }

  /**
   * Structure > Add Frame: a box round the selection, with a gap, that follows what it surrounds.
   * False when nothing is selected.
   */
  addFrame(): boolean {
    if (!this.hasSelection()) return false;
    const doc = this.doc;
    const f = frameAround(doc, this.sel, this.measure());
    if (!f) return false;
    doc.edit('Add frame', () => this.selectOnly({ kind: 'shape', id: doc.addShape({ ...f, lineWidth: doc.style.lineWidth }).id }));
    this.changed();
    return true;
  }

  /** Make a box into a frame round what lies inside it (or fit a frame again), following its contents from now on. */
  fitFrame(id: number): void {
    const doc = this.doc;
    const s = doc.shapes.get(id);
    if (!s) return;
    const m = this.measure();
    doc.edit('Fit frame', () => {
      const pad = defaultPad(doc);
      const frame = s.frame ? { ...s.frame, fit: true } : { ...thingsInside(doc, shapeBox(s), m, id), padX: pad, padY: pad, fit: true };
      doc.updateShape(id, { frame });
      const b = frameBox(doc, frame, m);
      if (b) doc.updateShape(id, b);
    });
    this.changed();
  }

  /** Fill the rings in the selection (Structure > Fill Rings), and select the fills so the Style panel shows them. */
  fillRings(): string {
    const doc = this.doc;
    const bonds = new Set(this.sel.bonds);
    // atoms selected without their bonds (one by one) count as their bonds between them
    for (const b of doc.bonds.values()) if (this.sel.atoms.has(b.a1) && this.sel.atoms.has(b.a2)) bonds.add(b.id);
    // a selected frame stands for the structures inside it
    for (const id of this.sel.shapes) {
      const f = doc.shapes.get(id)?.frame;
      if (f) for (const b of frameMembers(doc, f).bonds) bonds.add(b);
    }
    if (!bonds.size) return 'Select the rings to fill (or the whole structure) first.';
    let ids: number[] = [];
    doc.edit('Fill rings', () => { ids = fillRings(doc, bonds); });
    if (!ids.length) return 'No rings in the selection.';
    this.sel = emptySel();
    for (const id of ids) this.sel.shapes.add(id);
    this.changed();
    return `${ids.length} ring${ids.length > 1 ? 's' : ''} filled: choose the colour, gradient or pattern in the Style panel.`;
  }

  /**
   * Colour what is selected in one go (the Colours toolbox): the lines and text, the highlight
   * behind atoms and bonds, or the fill of shapes and ring fills. Undefined takes it off.
   */
  colourSelection(colour: string | undefined, what: 'line' | 'highlight' | 'fill'): boolean {
    const doc = this.doc, s = this.sel;
    if (!this.hasSelection()) return false;
    const black = colour?.toLowerCase() === '#000000' ? undefined : colour;
    doc.edit(what === 'highlight' ? 'Highlight' : what === 'fill' ? 'Fill colour' : 'Colour', () => {
      if (what === 'highlight') {
        for (const id of s.atoms) doc.updateAtom(id, { highlight: colour });
        for (const id of s.bonds) doc.updateBond(id, { highlight: colour });
        return;
      }
      if (what === 'fill') {
        for (const id of s.shapes) {
          const sh = doc.shapes.get(id);
          if (sh && (sh.kind === 'rect' || sh.kind === 'oval' || sh.kind === 'geo' || sh.kind === 'ring')) doc.updateShape(id, colour ? { filled: true, fillColor: colour } : { filled: false });
        }
        return;
      }
      for (const id of s.atoms) doc.updateAtom(id, { color: black });
      for (const id of s.bonds) doc.updateBond(id, { color: black });
      for (const id of s.arrows) doc.updateArrow(id, { color: black });
      for (const id of s.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { runs: c.runs.map((r) => ({ ...r, color: black })) }); }
      for (const id of s.shapes) { const sh = doc.shapes.get(id); if (sh && sh.kind !== 'ring' && sh.kind !== 'picture') doc.updateShape(id, { color: black }); }
    });
    this.changed();
    return true;
  }

  /** Highlight the selected atoms and bonds in a colour (Structure > Highlight), or take it off (undefined). */
  highlight(colour: string | undefined, hl?: HighlightStyle): boolean {
    const doc = this.doc;
    if (!this.sel.atoms.size && !this.sel.bonds.size) return false;
    doc.edit(colour ? 'Highlight' : 'Remove highlight', () => {
      for (const id of this.sel.atoms) doc.updateAtom(id, { highlight: colour, hl: colour ? hl : undefined });
      for (const id of this.sel.bonds) doc.updateBond(id, { highlight: colour, hl: colour ? hl : undefined });
    });
    this.changed();
    return true;
  }

  private moveSelection(dx: number, dy: number): void {
    const doc = this.doc;
    // a frame that follows its contents takes them with it
    const sel: Selection = { atoms: new Set(this.sel.atoms), bonds: this.sel.bonds, captions: new Set(this.sel.captions), arrows: new Set(this.sel.arrows), shapes: new Set(this.sel.shapes) };
    for (const id of this.sel.shapes) {
      // a ring's fill takes its structure along (it sits on the ring's atoms)
      const ring = doc.shapes.get(id)?.ring;
      if (ring?.length && doc.atoms.has(ring[0])) for (const a of doc.fragmentOf(ring[0])) sel.atoms.add(a);
      const f = doc.shapes.get(id)?.frame;
      if (!f?.fit) continue;
      const m = frameMembers(doc, f);
      for (const k of ['atoms', 'captions', 'arrows', 'shapes'] as const) for (const x of m[k]) sel[k].add(x);
    }
    doc.moveAtoms(sel.atoms, dx, dy);
    for (const id of sel.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { x: c.x + dx, y: c.y + dy }); }
    for (const id of sel.arrows) {
      const r = doc.arrows.get(id);
      if (!r) continue;
      const patch: Partial<Arrow> = { tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } };
      // a connector moved away from a shape that stays comes loose from it
      if (r.from && !sel.shapes.has(r.from.shape)) patch.from = undefined;
      if (r.to && !sel.shapes.has(r.to.shape)) patch.to = undefined;
      doc.updateArrow(id, patch);
    }
    for (const id of sel.shapes) {
      const s = doc.shapes.get(id);
      if (s) doc.updateShape(id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy, ...(s.poly ? { poly: s.poly.map((p) => ({ x: p.x + dx, y: p.y + dy })) } : {}) });
    }
  }

  deleteSelection(): void {
    const doc = this.doc;
    const s = this.sel;
    doc.edit('Delete', () => {
      for (const id of s.bonds) this.removeBondAndOrphans(id);
      for (const id of s.atoms) doc.removeAtom(id);
      for (const id of s.captions) doc.removeCaption(id);
      for (const id of s.arrows) doc.removeArrow(id);
      for (const id of s.shapes) doc.removeShape(id);
    });
    this.sel = emptySel();
    this.changed();
  }

  private erase(h: NonNullable<Hit>): void {
    const doc = this.doc;
    if (h.kind === 'atom') doc.removeAtom(h.id);
    else if (h.kind === 'bond') this.removeBondAndOrphans(h.id);
    else if (h.kind === 'caption') doc.removeCaption(h.id);
    else if (h.kind === 'arrow') doc.removeArrow(h.id);
    else doc.removeShape(h.id);
  }

  /** Remove a bond and any bare carbon left on its own. */
  private removeBondAndOrphans(id: number): void {
    const doc = this.doc;
    const b = doc.bonds.get(id);
    if (!b) return;
    doc.removeBond(id);
    for (const aid of [b.a1, b.a2]) {
      const a = doc.atoms.get(aid);
      if (a && doc.degree(aid) === 0 && !a.label && a.z === 6) doc.removeAtom(aid);
    }
  }

  // ------------------------------------------------------------------ arranging

  /** Sizes of labels and captions, for lining things up. Very large selections go by atom positions. */
  measure(): Measure {
    this.r.invalidate(this.doc);
    if (this.sel.atoms.size > 5000) return { ...POINTS, captionBox: (c) => this.r.captionBox(c) };
    return { atomBoxes: (a) => this.r.atomInfo(this.doc, a).boxes, captionBox: (c) => this.r.captionBox(c) };
  }

  private selBoxCache: { key: string; box: Rect | null } = { key: '', box: null };

  /** Box round the selection (remembered until the drawing or the selection changes). */
  selBox(): Rect | null {
    const s = this.sel;
    const sum = (x: Set<number>) => { let t = 0; for (const id of x) t += id; return `${x.size}:${t}`; };
    const key = `${this.doc.version}|${sum(s.atoms)}|${sum(s.captions)}|${sum(s.arrows)}|${sum(s.shapes)}`;
    if (key !== this.selBoxCache.key) this.selBoxCache = { key, box: selectionBox(this.doc, s, this.measure()) };
    return this.selBoxCache.box;
  }

  /** The round handle above the selection that turns it (select tool only). */
  private rotateHandle(): Vec | null {
    const s = this.sel;
    if (this.tool.kind !== 'select' || (!s.atoms.size && !s.arrows.size && !s.shapes.size)) return null;
    const b = this.selBox();
    return b ? { x: (b.x1 + b.x2) / 2, y: b.y1 - this.tol(24) } : null;
  }

  /** Line up the selected objects. Returns false when fewer than two are selected. */
  align(how: Align): boolean {
    const us = units(this.doc, this.sel, this.measure());
    if (us.length < 2) return false;
    const off = alignOffsets(us, how);
    this.doc.edit('Align', () => us.forEach((u, i) => moveUnit(this.doc, u, off[i])));
    this.changed();
    return true;
  }

  /** Space the selected objects evenly. Returns false when fewer than three are selected. */
  distribute(axis: 'h' | 'v'): boolean {
    const us = units(this.doc, this.sel, this.measure());
    if (us.length < 3) return false;
    const off = distributeOffsets(us, axis);
    this.doc.edit('Distribute', () => us.forEach((u, i) => moveUnit(this.doc, u, off[i])));
    this.changed();
    return true;
  }

  /** Mirror the selection left-to-right ('h') or top-to-bottom ('v'). This turns stereocentres over, as in ChemDraw. */
  flip(axis: 'h' | 'v'): boolean {
    const b = this.selBox();
    if (!b || !this.hasSelection()) return false;
    const snap = snapshot(this.doc, this.sel, this.measure());
    const f = axis === 'h' ? mirrorX((b.x1 + b.x2) / 2) : mirrorY((b.y1 + b.y2) / 2);
    this.doc.edit(axis === 'h' ? 'Flip horizontal' : 'Flip vertical', () => transform(this.doc, snap, f, true));
    this.changed();
    return true;
  }

  /** Turn the selection about its centre; positive is clockwise. */
  rotateBy(deg: number): boolean {
    const b = this.selBox();
    if (!b || !this.hasSelection()) return false;
    const snap = snapshot(this.doc, this.sel, this.measure());
    const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    this.doc.edit('Rotate', () => transform(this.doc, snap, rotation(c, deg * DEG), false));
    this.changed();
    return true;
  }

  /**
   * Redraw structures with even bonds and angles: the selected ones, or all of them when no atom
   * is selected. Returns false when there was nothing to change.
   */
  cleanUp(): boolean {
    const doc = this.doc;
    const frags = this.sel.atoms.size
      ? doc.fragments().filter((f) => [...f].some((id) => this.sel.atoms.has(id)))
      : doc.fragments();
    const moves = cleanUpMoves(doc, frags);
    if (!moves.length) return false;
    doc.edit('Clean Up Structure', () => { for (const [id, p] of moves) doc.updateAtom(id, { x: p.x, y: p.y }); });
    this.changed();
    return true;
  }

  // ------------------------------------------------------------------ reaction schemes

  /** Outline the parts of a reaction arrow's step, each in its role's colour with a small name. */
  private drawRoles(ctx: CanvasRenderingContext2D, arrowId: number, px: number): void {
    const roles = this.reactionRoles(arrowId);
    if (!roles) return;
    const find = itemFinder(this.schemeItems());
    const pad = 3 * px;
    ctx.save();
    ctx.lineWidth = 1.2 * px;
    ctx.setLineDash([4 * px, 3 * px]);
    ctx.font = `${10 * px}px system-ui, sans-serif`;
    ctx.textBaseline = 'bottom';
    for (const k of ROLES) {
      const [colour, name] = ROLE_LOOK[k];
      for (const ref of roles[k]) {
        const it = find(ref);
        if (!it) continue;
        const b = it.box;
        ctx.strokeStyle = colour;
        ctx.strokeRect(b.x1 - pad, b.y1 - pad, b.x2 - b.x1 + 2 * pad, b.y2 - b.y1 + 2 * pad);
        ctx.fillStyle = colour;
        ctx.fillText(name, b.x1 - pad, b.y1 - pad - px);
      }
    }
    ctx.restore();
  }

  /** The things in the drawing as scheme items (remembered until the drawing changes). */
  private itemsCache: { version: number; items: Item[] } | null = null;
  schemeItems(): Item[] {
    if (this.itemsCache?.version !== this.doc.version) this.itemsCache = { version: this.doc.version, items: schemeItems(this.doc, this.fullMeasure()) };
    return this.itemsCache.items;
  }

  /** Label and caption sizes for every atom (schemes need whole structures, however big the selection). */
  private fullMeasure(): Measure {
    this.r.invalidate(this.doc);
    return { atomBoxes: (a) => this.r.atomInfo(this.doc, a).boxes, captionBox: (c) => this.r.captionBox(c) };
  }

  /** An arrow's reaction roles: kept with it, or worked out from where things sit. */
  reactionRoles(arrowId: number): StepRoles | null {
    const r = this.doc.arrows.get(arrowId);
    if (!r || !isReactionArrow(r)) return null;
    return rolesOf(r, this.schemeItems(), this.doc.style.bondLength);
  }

  /** The reaction arrows to work on: those selected, those whose steps hold something selected, or all. */
  private selectedSteps(): number[] | undefined {
    const s = this.sel;
    if (s.arrows.size) return [...s.arrows];
    if (!this.hasSelection()) return undefined;
    const find = itemFinder(this.schemeItems());
    const picked = new Set<Item>();
    for (const id of s.atoms) { const it = find('a' + id); if (it) picked.add(it); }
    for (const id of s.captions) { const it = find('c' + id); if (it) picked.add(it); }
    for (const id of s.shapes) { const it = find('s' + id); if (it) picked.add(it); }
    const out: number[] = [];
    for (const r of this.doc.arrows.values()) {
      const roles = this.reactionRoles(r.id);
      if (roles && ROLES.some((k) => roles[k].some((ref) => { const it = find(ref); return it && picked.has(it); }))) out.push(r.id);
    }
    return out.length ? out : undefined;
  }

  /**
   * Clean Up Reaction: space the selected steps (or every step) evenly, add missing + signs,
   * centre the conditions and fit the arrows to them. False when there is no step to tidy.
   */
  cleanUpReaction(): boolean {
    const m = this.fullMeasure();
    const plan = planCleanUp(this.doc, m, this.selectedSteps());
    if (!plan) return false;
    applySchemePlan(this.doc, m, plan);
    this.changed();
    return true;
  }

  /**
   * Arrange the selected scheme (or the whole drawing) in one go: in a line, in rows, as a
   * snake, down the page, round a catalytic cycle, or as a branching tree. Selected structures
   * that aren't in a step yet are joined on with new arrows. False when it can't be done.
   */
  arrangeScheme(opts: ArrangeOptions): boolean {
    const m = this.fullMeasure();
    const s = this.sel;
    const plan = planArrange(this.doc, m, { atoms: s.atoms, captions: s.captions, shapes: s.shapes, arrows: s.arrows }, opts);
    if (!plan) return false;
    const made = applyArrange(this.doc, m, plan);
    for (const id of made) this.sel.arrows.add(id);
    this.changed();
    return true;
  }

  /**
   * Number Compounds: a bold number under each selected structure (or every structure), in
   * scheme order. Numbers already under a structure are changed in place. Returns how many.
   */
  numberCompounds(opts: NumberOptions & { bold?: boolean }): number {
    const doc = this.doc;
    const m = this.fullMeasure();
    const plan = planNumbers(doc, m, this.sel.atoms, opts);
    if (!plan.labels.length) return 0;
    const bold = opts.bold ?? true;
    doc.edit('Number Compounds', () => {
      for (const l of plan.labels) {
        if (l.caption !== undefined) {
          const c = doc.captions.get(l.caption)!;
          // changed in place, and tied to its structure from now on
          const attach = c.attach ?? attachWhereItIs(doc, c, new Set(l.item.atoms), m, 'label') ?? undefined;
          doc.updateCaption(c.id, { runs: [{ ...c.runs[0], text: l.text, bold: bold || undefined }], attach });
          continue;
        }
        // centred under the structure and tied to it
        const c = doc.addCaption({ x: l.at.x, y: l.at.y, runs: [{ text: l.text, bold: bold || undefined }], justify: 'center',
          attach: { atoms: [...l.item.atoms], side: 'below', gap: defaultGap(doc), shift: 0, role: 'label' } });
        placeAttached(doc, c, m);
        this.sel.captions.add(c.id);
        // an arrow leaving from under the structure starts below the new number instead
        const nb = this.r.captionBox(doc.captions.get(c.id)!);
        const pad = 0.2 * doc.style.bondLength;
        const room = { x1: nb.x1 - pad, y1: nb.y1 - pad, x2: nb.x2 + pad, y2: nb.y2 + pad };
        for (const r of doc.arrows.values()) {
          if (r.sweep) continue;
          const t = exitParam(r.tail, r.head, room), h = exitParam(r.head, r.tail, room);
          const cut = (from: Vec, to: Vec, k: number) => ({ x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k });
          const tail = t > 0 ? cut(r.tail, r.head, t) : r.tail, head = h > 0 ? cut(r.head, r.tail, h) : r.head;
          if ((t > 0 || h > 0) && dist(tail, head) > doc.style.bondLength) doc.updateArrow(r.id, { tail, head });
        }
      }
    });
    this.changed();
    return plan.labels.length;
  }

  /**
   * Aromatic rings in the selection (or the whole drawing) drawn with circles, or back as
   * alternating double bonds when they already have circles. Says what it did, or null.
   */
  /**
   * Fold the selected group into one label with this name (it keeps its chemistry: the name
   * becomes a nickname for the group). Returns a problem to tell the person, or null.
   */
  contractLabel(name: string): string | null {
    const doc = this.doc;
    const g = selectedGroup(doc, this.sel.atoms);
    if ('error' in g) return g.error;
    const label = name.trim();
    if (!label) return 'Type a name for the label.';
    if (isBuiltInNickname(label)) return `“${label}” is already a nickname (${label} means something else). Choose another name.`;
    addNicknames({ [label]: g.smiles });
    const ids = [...this.sel.atoms].filter((id) => id !== g.start && doc.atoms.has(id));
    doc.edit('Contract Label', () => {
      for (const id of ids) doc.removeAtom(id);
      this.applyLabel(g.start, label);
      doc.updateAtom(g.start, { group: g.smiles });
    });
    this.r.invalidate(doc);
    this.sel = emptySel();
    this.sel.atoms.add(g.start);
    this.changed();
    return null;
  }

  /** Show or hide the terminal methyls (CH3 or Me, as chosen) of the selection, or of the whole drawing. */
  toggleChainEnds(): string {
    let r = { count: 0, shown: false };
    this.doc.edit('Terminal Methyls', () => { r = toggleChainEndLabels(this.doc, this.sel.atoms, this.options.methylStyle); });
    if (!r.count) return 'No chain ends here: a chain end is a plain carbon with one bond.';
    this.changed();
    const how = this.options.methylStyle === 'Me' ? 'Me' : 'CH₃';
    return r.shown ? `${how} written out at ${r.count} chain end${r.count > 1 ? 's' : ''}.` : 'Chain ends back to plain lines.';
  }

  /** Write terminal methyls as CH3 or Me from now on, and rewrite the ones already shown in the selection (or the whole drawing). */
  setMethylStyle(style: MethylStyle, ids: Iterable<number> = this.sel.atoms): number {
    this.options.methylStyle = style;
    let n = 0;
    this.doc.edit(`Terminal Methyls as ${style}`, () => { n = setMethylStyle(this.doc, ids, style); });
    if (n) this.changed();
    return n;
  }

  /** Hide the H atoms that don't matter, or draw the selected atoms' hydrogens as atoms. */
  toggleHydrogens(): string {
    const ids = [...this.sel.atoms];
    let r = { removed: 0, added: 0 };
    this.doc.edit('Explicit Hydrogens', () => { r = toggleExplicitHydrogens(this.doc, ids); });
    if (!r.removed && !r.added) return ids.length ? 'These atoms have no hydrogens to draw.' : 'No H atoms to hide. Select atoms to draw their hydrogens as atoms.';
    this.sel = emptySel();
    this.changed();
    return r.removed ? `${r.removed} H atom${r.removed > 1 ? 's' : ''} hidden (those on wedges, charged or on heteroatoms are kept).` : r.added > 1 ? `${r.added} hydrogens drawn as atoms.` : '1 hydrogen drawn as an atom.';
  }

  toggleAromaticCircles(): string | null {
    const doc = this.doc;
    const bonds = new Set(this.sel.bonds);
    for (const id of this.sel.atoms) for (const b of doc.adj.get(id) ?? []) bonds.add(b);
    let msg: string | null = null;
    doc.edit('Aromatic Circles', () => {
      const n = circleRings(doc, bonds);
      if (n > 0) { msg = n === 1 ? 'Ring drawn with a circle.' : `${n} rings drawn with circles.`; return; }
      const k = kekulize(doc, bonds);
      msg = k > 0 ? (k === 1 ? 'Ring drawn with double bonds.' : `${k} rings drawn with double bonds.`) : k < 0 ? 'These rings can\'t be given alternating double bonds.' : null;
    });
    if (msg) this.changed();
    return msg;
  }

  /**
   * Where crossing bonds are drawn bring the selected bonds in front of (or behind) the bonds they
   * cross: the bond behind gets a gap. False when no bond is selected.
   */
  setBondLayer(front: boolean): boolean {
    const doc = this.doc;
    const ids = [...this.sel.bonds];
    if (!ids.length) return false;
    let hi = -Infinity, lo = Infinity;
    for (const b of doc.bonds.values()) { const l = bondLayer(b); hi = Math.max(hi, l); lo = Math.min(lo, l); }
    doc.edit(front ? 'Bring to Front' : 'Send to Back', () => {
      ids.forEach((id, i) => doc.updateBond(id, { z: front ? hi + 1 + i : lo - ids.length + i }));
      // the bonds crossing them are redrawn too (their gaps change)
      for (const id of ids) for (const o of crossingBonds(doc, doc.bonds.get(id)!)) doc.updateBond(o.id, {});
    });
    this.changed();
    return true;
  }

  /**
   * Bring the selected shapes (boxes, design shapes, pictures, tables) in front of the other
   * shapes, or send them behind, or one step either way. False when no shape is selected.
   */
  setShapeLayer(how: 'front' | 'back' | 'forward' | 'backward'): boolean {
    const doc = this.doc;
    const picked = new Set(this.sel.shapes);
    if (!picked.size) return false;
    const order = shapeOrder([...doc.shapes.values()]);
    const rest = order.filter((s) => !picked.has(s.id)), mine = order.filter((s) => picked.has(s.id));
    let next: Shape[];
    if (how === 'front') next = [...rest, ...mine];
    else if (how === 'back') next = [...mine, ...rest];
    else {
      // one step: past the next shape (not picked) in that direction
      next = [...order];
      const step = how === 'forward' ? 1 : -1;
      const idx = (how === 'forward' ? [...next.keys()].reverse() : [...next.keys()]);
      for (const i of idx) {
        if (!picked.has(next[i].id)) continue;
        const j = i + step;
        if (j < 0 || j >= next.length || picked.has(next[j].id)) continue;
        [next[i], next[j]] = [next[j], next[i]];
      }
    }
    const label = { front: 'Bring to Front', back: 'Send to Back', forward: 'Bring Forward', backward: 'Send Backward' }[how];
    doc.edit(label, () => next.forEach((s, i) => { if ((s.z ?? 0) !== i + 1) doc.updateShape(s.id, { z: i + 1 }); }));
    this.changed();
    return true;
  }

  /** The next free compound number in this drawing. */
  nextCompoundNumber(): number {
    return nextCompound(this.doc, this.fullMeasure());
  }

  /**
   * Give the selected things (other than the arrow) a role in the selected arrow's step by hand,
   * or ('none') take them out of it. The roles are then kept as they are.
   */
  setReactionRole(arrowId: number, role: Role | 'none'): boolean {
    const r = this.doc.arrows.get(arrowId);
    const roles = this.reactionRoles(arrowId);
    if (!r || !roles) return false;
    const find = itemFinder(this.schemeItems());
    const picked: Item[] = [];
    const add_ = (ref: string) => { const it = find(ref); if (it && !picked.includes(it)) picked.push(it); };
    for (const id of this.sel.atoms) add_('a' + id);
    for (const id of this.sel.captions) add_('c' + id);
    for (const id of this.sel.shapes) add_('s' + id);
    if (!picked.length) return false;
    const mine = new Set(picked);
    const next: StepRoles = { reactants: [], products: [], above: [], below: [], plusses: [...(roles.plusses ?? [])], manual: true };
    for (const k of ROLES) next[k] = roles[k].filter((ref) => { const it = find(ref); return !it || !mine.has(it); });
    next.plusses = next.plusses!.filter((ref) => { const it = find(ref); return !it || !mine.has(it); });
    if (role !== 'none') for (const it of picked) (it.plus && (role === 'reactants' || role === 'products') ? next.plusses! : next[role]).push(it.ref);
    this.doc.edit('Reaction roles', () => this.doc.updateArrow(arrowId, { step: next }));
    this.changed();
    return true;
  }

  /** Forget roles chosen by hand (or read from a file): they are worked out from where things sit again. */
  resetReactionRoles(arrowId: number): void {
    if (!this.doc.arrows.get(arrowId)?.step) return;
    this.doc.edit('Reaction roles', () => this.doc.updateArrow(arrowId, { step: undefined }));
    this.changed();
  }

  /** Select everything in an arrow's step with the given role. */
  selectRole(arrowId: number, role: Role): void {
    const roles = this.reactionRoles(arrowId);
    if (!roles) return;
    const find = itemFinder(this.schemeItems());
    this.clearSelection();
    for (const ref of roles[role]) {
      const it = find(ref);
      if (!it) continue;
      for (const a of it.atoms) this.sel.atoms.add(a);
      for (const b of this.doc.bonds.values()) if (it.atoms.includes(b.a1)) this.sel.bonds.add(b.id);
      if (it.caption !== undefined) this.sel.captions.add(it.caption);
      if (it.shape !== undefined) this.sel.shapes.add(it.shape);
    }
    this.changed();
  }

  /** Move the selection a few points (the arrow keys). False with nothing selected. */
  nudge(dx: number, dy: number): boolean {
    if (!this.hasSelection()) return false;
    this.doc.edit('Nudge', () => this.moveSelection(dx, dy));
    this.changed();
    return true;
  }

  /**
   * Make the selection bigger or smaller about its middle: positions, bond lengths, labels and
   * line widths together (captions keep their font size). False with nothing selected.
   */
  scaleSelection(f: number): boolean {
    const b = this.selBox();
    if (!b || !this.hasSelection() || !(f > 0) || f === 1) return false;
    const doc = this.doc, s = this.sel;
    const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    const at = (p: Vec): Vec => add(c, mul(sub(p, c), f));
    doc.edit('Scale', () => {
      for (const id of s.atoms) {
        const a = doc.atoms.get(id);
        if (a) doc.updateAtom(id, { ...at(a), s: (a.s ?? 1) * f });
      }
      for (const bd of doc.bonds.values()) {
        if (s.atoms.has(bd.a1) && s.atoms.has(bd.a2)) doc.updateBond(bd.id, { s: (bd.s ?? 1) * f });
      }
      for (const id of s.captions) {
        const cap = doc.captions.get(id);
        if (cap) doc.updateCaption(id, at(cap));
      }
      for (const id of s.arrows) {
        const r = doc.arrows.get(id);
        if (r) doc.updateArrow(id, { tail: at(r.tail), head: at(r.head), headLength: r.headLength * f, headWidth: r.headWidth * f });
      }
      for (const id of s.shapes) {
        const sh = doc.shapes.get(id);
        if (!sh) continue;
        const p1 = at({ x: sh.x1, y: sh.y1 }), p2 = at({ x: sh.x2, y: sh.y2 });
        doc.updateShape(id, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y });
      }
    });
    this.changed();
    return true;
  }

  /** The typical bond length in the selection (for the Scale window), in points. */
  selectionBondLength(): number | null {
    const ls: number[] = [];
    for (const b of this.doc.bonds.values()) {
      if (!this.sel.atoms.has(b.a1) || !this.sel.atoms.has(b.a2)) continue;
      ls.push(dist(this.doc.atoms.get(b.a1)!, this.doc.atoms.get(b.a2)!));
      if (ls.length > 2000) break;
    }
    if (!ls.length) return null;
    ls.sort((x, y) => x - y);
    return ls[ls.length >> 1];
  }

  /**
   * ChemDraw's Ctrl+arrow: a reaction arrow 90 pt long beside the selection, then a copy of the
   * selection past its head, which becomes the selection (so pressing it again carries on).
   */
  reactionStep(dir: 'right' | 'left' | 'down' | 'up'): boolean {
    const b = this.selBox();
    if (!b || !this.hasSelection()) return false;
    const GAP = 7.6, LENGTH = 90;
    const v = { right: { x: 1, y: 0 }, left: { x: -1, y: 0 }, down: { x: 0, y: 1 }, up: { x: 0, y: -1 } }[dir];
    const c = { x: (b.x1 + b.x2) / 2, y: (b.y1 + b.y2) / 2 };
    const reach = v.x ? (b.x2 - b.x1) / 2 : (b.y2 - b.y1) / 2;
    const tail = add(c, mul(v, reach + GAP));
    const head = add(tail, mul(v, LENGTH));
    const shift = sub(add(head, mul(v, GAP + reach)), c);
    const part = extractDrawing(this.doc, this.sel);
    const pb = part.bounds();
    this.doc.edit('Reaction step', () => {
      this.addArrow(tail, head);
      if (pb) this.sel = insertDrawing(this.doc, part, add({ x: (pb.x1 + pb.x2) / 2, y: (pb.y1 + pb.y2) / 2 }, shift));
    });
    this.changed();
    return true;
  }

  /** Select the next (or previous) structure, in the order they were drawn (Tab, Shift+Tab). */
  selectNextStructure(step: 1 | -1): boolean {
    const frags = this.doc.fragments();
    if (!frags.length) return false;
    const cur = frags.findIndex((f) => [...this.sel.atoms].some((id) => f.has(id)));
    const i = cur < 0 ? (step > 0 ? 0 : frags.length - 1) : (cur + step + frags.length) % frags.length;
    this.selectFragment(frags[i].values().next().value!, false);
    return true;
  }

  /**
   * Ctrl+J: join the two selected atoms, or the two selected bonds, into one (the smaller
   * structure moves). False when the selection isn't two atoms or two bonds.
   */
  join(): boolean {
    const s = this.sel;
    const bonds = [...s.bonds];
    // two bonds: their four atoms are selected too, so look at the bonds first
    const loose = [...s.atoms].filter((id) => ![...s.bonds].some((bid) => { const b = this.doc.bonds.get(bid); return b && (b.a1 === id || b.a2 === id); }));
    let ok = false;
    if (bonds.length === 2 && !loose.length) {
      this.doc.edit('Join', () => { ok = joinBonds(this.doc, bonds[0], bonds[1]); });
    } else if (s.atoms.size === 2 && !bonds.length) {
      const [a, b] = [...s.atoms];
      this.doc.edit('Join', () => {
        const kept = joinAtoms(this.doc, a, b);
        ok = kept !== null;
        if (kept !== null) this.sel = { ...emptySel(), atoms: new Set([kept]) };
      });
    }
    if (!ok) return false;
    if (bonds.length === 2) this.sel = emptySel();
    this.changed();
    return true;
  }

  // ------------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent): void {
    if (this.paused) return;
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    if (e.defaultPrevented || target?.closest?.('dialog, .menu, .flyout')) return;
    const chord = chordOf(e);
    if (!chord) return;
    // on a focused button or menu, Enter, Space and Tab do their usual jobs (unless the mouse
    // is over the drawing: then they are drawing keys, as in ChemDraw)
    if (!this.pointerInside && target && target !== document.body && target !== this.r.overlay && /^(Shift\+)?(Enter|Space|Tab)$/.test(chord)) return;
    if (chord === 'Escape') {
      this.keyHot = null;
      if (this.cropping !== null) { this.cropping = null; this.requestOverlay(); this.onChange(); return; }
      this.clearSelection();
      return;
    }
    const hs = this.hotspot();
    // Delete with a selection removes the selection, unless pointing at something outside it
    if ((chord === 'Delete' || chord === 'Backspace') && this.hasSelection() && (!hs || this.isSelected(hs))) {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    const place: KeyContext = hs?.kind === 'atom' ? 'atom' : hs?.kind === 'bond' ? 'bond' : 'space';
    for (const ctx of (this.slideKeys ? [place, 'slides', 'command'] : [place, 'command']) as KeyContext[]) {
      const action = keymap.lookup(ctx, chord);
      if (action && this.runAction(action, hs)) {
        e.preventDefault();
        this.inputTs = e.timeStamp;
        return;
      }
    }
  }

  /** Do what a key is bound to. False when it doesn't apply here (the key then does nothing). */
  runAction(action: string, hs: Hit = this.hotspot()): boolean {
    const { verb, arg } = parseAction(action);
    switch (verb) {
      case 'label': return hs?.kind === 'atom' && this.labelKey(hs.id, arg);
      case 'atom': return hs?.kind === 'atom' && this.atomKey(hs.id, arg);
      case 'bond': return hs?.kind === 'bond' && this.bondKey(hs.id, arg);
      case 'fuse': return hs?.kind === 'bond' && this.fuseKey(hs.id, arg);
      case 'hotspot': return !!hs && (hs.kind === 'atom' || hs.kind === 'bond') && this.moveHotspot(hs, arg);
      case 'tool': if (!TOOLS[arg]) return false; this.setTool(arg); return true;
      case 'command': return this.runCommand(arg);
    }
    return false;
  }

  undo(): void {
    if (this.doc.undo()) this.afterUndo();
  }

  redo(): void {
    if (this.doc.redo()) this.afterUndo();
  }

  /** After an undo or redo (here or in a slide deck's history): forget things that have gone. */
  afterUndo(): void {
    // drop selected things that no longer exist
    for (const [set, map] of [[this.sel.atoms, this.doc.atoms], [this.sel.bonds, this.doc.bonds], [this.sel.captions, this.doc.captions], [this.sel.arrows, this.doc.arrows], [this.sel.shapes, this.doc.shapes]] as [Set<number>, Map<number, unknown>][]) {
      for (const id of set) if (!map.has(id)) set.delete(id);
    }
    this.keyHot = null;
    this.changed();
  }

  /** A label key: the atom pointed at, or every selected atom when it is one of them. */
  private labelKey(id: number, text: string): boolean {
    const doc = this.doc;
    if (!doc.atoms.has(id)) return false;
    const ids = this.sel.atoms.has(id) && this.sel.atoms.size > 1 ? [...this.sel.atoms] : [id];
    doc.edit('Label', () => { for (const a of ids) if (doc.atoms.has(a)) this.applyLabel(a, text); });
    this.lastEdited = id;
    this.changed();
    return true;
  }

  /** An atom key other than a label. Returns false if it does nothing here. */
  atomKey(id: number, act: string): boolean {
    const doc = this.doc;
    const a = doc.atoms.get(id);
    if (!a) return false;
    if ((SPROUT_KINDS as readonly string[]).includes(act)) {
      const kind = act as SproutKind;
      const fromMouse = this.keyHot === null;
      let next: number | null = null;
      doc.edit('Hotkey', () => { next = sproutGroup(doc, id, kind); });
      this.lastEdited = next ?? id;
      // 1 and 0 on the atom under the mouse leave the highlight there (pressing 1 again adds
      // another branch); other keys, or keys after a keyboard move, follow the new atom
      const stay = (kind === 'bond' || kind === 'ring-bond') && fromMouse && this.options.keepHotspotOnBond;
      if (!stay && next !== null && doc.atoms.has(next)) this.setKeyHot({ kind: 'atom', id: next });
      this.changed();
      return true;
    }
    switch (act) {
      case 'plus':
      case 'minus':
        doc.edit('Charge', () => doc.updateAtom(id, { charge: a.charge + (act === 'plus' ? 1 : -1) }));
        break;
      case 'number':
        doc.edit('Atom number', () => doc.updateAtom(id, a.showNumber
          ? { showNumber: false }
          : { showNumber: true, atomNumber: a.atomNumber || String(nextNumber(doc, id, (x) => x.atomNumber)) }));
        break;
      case 'attach':
        doc.edit('Attachment point', () => doc.updateAtom(id, a.attach
          ? { attach: undefined, attachNum: undefined, z: 6 }
          : { attach: 'Unspecified', attachNum: nextNumber(doc, id, (x) => (x.attach ? x.attachNum : undefined)), z: 0, label: null, charge: 0, fileLabel: false }));
        break;
      case 'nickname': this.onNickname(id); return true;
      case 'properties': this.selectOnly({ kind: 'atom', id }); this.onProperties(); return true;
      case 'edit-label': this.editLabel(id); return true;
      case 'select': this.selectOnly({ kind: 'atom', id }); return true;
      case 'clear':
        doc.edit('Delete', () => {
          if (a.label || a.z !== 6 || a.charge || a.attach) doc.updateAtom(id, { label: null, z: 6, charge: 0, fileLabel: false, attach: undefined, attachNum: undefined });
          else doc.removeAtom(id);
        });
        break;
      default: return false;
    }
    this.lastEdited = id;
    this.changed();
    return true;
  }

  /** A bond key. Returns false if it does nothing here. */
  bondKey(id: number, act: string): boolean {
    const doc = this.doc;
    const b = doc.bonds.get(id);
    if (!b) return false;
    const SET: Record<string, Partial<Bond>> = {
      single: { order: 1, display: 'solid' }, double: { order: 2, display: 'solid' }, triple: { order: 3, display: 'solid' },
      dashed: { order: 1, display: 'dash' }, 'dashed-double': { order: 1.5, display: 'solid' }, bold: { order: 1, display: 'bold' },
      'bold-double': { order: 2, display: 'bold' }, wavy: { order: 1, display: 'wavy' }, hashed: { order: 1, display: 'hash' },
      left: { dpos: 'left' }, center: { dpos: 'center' }, right: { dpos: 'right' },
    };
    if (act === 'select') { this.selectOnly({ kind: 'bond', id }); return true; }
    if (act === 'properties') { this.selectOnly({ kind: 'bond', id }); this.onProperties(); return true; }
    doc.edit('Bond hotkey', () => {
      if (act === 'delete') { this.removeBondAndOrphans(id); return; }
      if (act === 'wedge' || act === 'hash-wedge') {
        const disp: BondDisplay = act === 'wedge' ? 'wedge' : 'hashWedge';
        // pressing it again turns the wedge round
        if (b.display === disp) doc.updateBond(id, { a1: b.a2, a2: b.a1 });
        else doc.updateBond(id, { order: 1, display: disp });
        return;
      }
      const patch = { ...SET[act] };
      if (patch.dpos && b.order !== 2) patch.order = 2;
      doc.updateBond(id, patch);
    });
    if (!(act in SET) && act !== 'delete' && act !== 'wedge' && act !== 'hash-wedge') return false;
    this.lastEdited = doc.bonds.has(id) ? b.a1 : null;
    this.changed();
    return true;
  }

  /** Fuse a ring onto a bond. */
  private fuseKey(id: number, act: string): boolean {
    const doc = this.doc;
    const b = doc.bonds.get(id);
    if (!b) return false;
    const n = act === 'benzene' ? 6 : act === 'cyclopentadiene' ? 5 : Number(act);
    if (act !== 'chair' && act !== 'chair-2' && !(n >= 3 && n <= 8)) return false;
    doc.edit('Fuse ring', () => {
      if (act === 'chair' || act === 'chair-2') { fuseChair(doc, id, act === 'chair-2'); return; }
      const side = fuseSide(doc, b, n, this.pointer);
      const pts = fusedRing(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, n, side);
      placeRing(doc, pts, { aromatic: act === 'benzene' || act === 'cyclopentadiene', existing: [b.a1, b.a2], scale: b.s });
    });
    this.lastEdited = b.a1;
    this.changed();
    return true;
  }

  /**
   * Move the highlight with the arrow keys, atom to bond to atom, towards the arrow's direction
   * ("far": about three bonds).
   */
  private moveHotspot(hs: NonNullable<Hit>, how: string): boolean {
    const far = how.startsWith('far-');
    const dirName = far ? how.slice(4) : how;
    const dir: Vec = { left: { x: -1, y: 0 }, right: { x: 1, y: 0 }, up: { x: 0, y: -1 }, down: { x: 0, y: 1 } }[dirName] ?? { x: 0, y: 0 };
    let cur: NonNullable<Hit> = hs;
    for (let i = 0; i < (far ? 6 : 1); i++) {
      const next = this.hotspotStep(cur, dir);
      if (!next) break;
      cur = next;
    }
    if (!sameHit(cur, hs)) this.setKeyHot(cur);
    return true;
  }

  /** One arrow-key step: from an atom to a bond leaving it, or from a bond to one of its atoms. */
  private hotspotStep(h: NonNullable<Hit>, dir: Vec): Hit {
    const doc = this.doc;
    const here = h.kind === 'atom' ? doc.atoms.get(h.id) : (() => {
      const b = doc.bonds.get(h.id);
      return b ? mul(add(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!), 0.5) : undefined;
    })();
    if (!here) return null;
    let best: Hit = null, bestScore = 0.35;
    const consider = (c: NonNullable<Hit>, at: Vec) => {
      const v = sub(at, here);
      const l = Math.hypot(v.x, v.y);
      if (l < 1e-9) return;
      const score = (v.x * dir.x + v.y * dir.y) / l;
      if (score > bestScore + 1e-9) { bestScore = score; best = c; }
    };
    if (h.kind === 'atom') {
      for (const bid of doc.adj.get(h.id) ?? []) {
        const b = doc.bonds.get(bid)!;
        consider({ kind: 'bond', id: bid }, mul(add(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!), 0.5));
      }
    } else if (h.kind === 'bond') {
      const b = doc.bonds.get(h.id)!;
      for (const aid of [b.a1, b.a2]) consider({ kind: 'atom', id: aid }, doc.atoms.get(aid)!);
    }
    return best;
  }

  // ------------------------------------------------------------------ labels and text

  /** Set an atom's label from typed text: plain elements become automatic labels (OH ↔ HO). */
  applyLabel(id: number, text: string): void {
    const doc = this.doc;
    const t = text.trim();
    if (!t) { doc.updateAtom(id, { label: null, z: 6, fileLabel: false }); return; }
    const z = elementNumber(t);
    if (z !== undefined && t !== 'D' && t !== 'T') { doc.updateAtom(id, { label: null, z, fileLabel: false }); return; }
    // "OH", "NH2", "HO", "H2N", "CH3": element with its normal hydrogens → automatic label
    const toks = tokenize(t);
    const els = toks.filter((k) => k.kind === 'el');
    if (els.length === toks.length && toks.length === 2 && !toks.some((k) => k.charge)) {
      const hTok = toks.find((k) => k.text === 'H');
      const heavy = toks.find((k) => k.text !== 'H');
      if (hTok && heavy) {
        const hz = elementNumber(heavy.text)!;
        const bos = doc.valenceSum(id);
        const a = doc.atoms.get(id)!;
        if (hasImplicitH(hz) && implicitHydrogens(hz, bos, a.charge) === hTok.count) {
          doc.updateAtom(id, { label: null, z: hz, fileLabel: false });
          return;
        }
      }
    }
    const head = toks[0];
    const hz = head && head.kind === 'el' ? elementNumber(head.text) ?? 6 : 6;
    doc.updateAtom(id, { label: t, z: hz, fileLabel: false });
  }

  editLabel(id: number): void {
    const doc = this.doc;
    const a = doc.atoms.get(id);
    if (!a) return;
    this.commitLabel();
    const input = document.createElement('input');
    input.className = 'label-input';
    const sp = this.r.toScreen(a);
    const size = doc.style.labelSize * (a.s ?? 1) * this.r.view.scale;
    input.style.left = `${sp.x - size * 0.4}px`;
    input.style.top = `${sp.y - size * 0.75}px`;
    input.style.fontSize = `${Math.max(11, size)}px`;
    input.value = a.label ?? (a.z !== 6 ? SYMBOLS[a.z] ?? '' : '');
    input.spellcheck = false;
    this.host.appendChild(input);
    input.focus();
    input.select();
    const finish = (ok: boolean) => {
      if (this.labelInput !== input) return;
      this.labelInput = null;
      input.remove();
      if (ok && doc.atoms.has(id)) {
        doc.edit('Label', () => this.applyLabel(id, input.value));
        this.lastEdited = id;
        this.changed();
      }
      this.r.overlay.focus();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); finish(true); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
    this.labelInput = input;
  }

  private commitLabel(): void {
    if (this.labelInput) this.labelInput.blur();
  }

  private captionEd: CaptionEditor | null = null;

  /** Finish typing in a caption, if one is open. */
  closeCaption(): void {
    this.captionEd?.finish();
  }

  private newCaption(p: Vec): void {
    this.openCaption(null, p);
  }

  /** Start typing into a caption (Add Caption, Add ID Label). */
  typeInto(id: number): void {
    this.editCaption(id);
  }

  private editCaption(id: number, client?: { x: number; y: number }): void {
    const c = this.doc.captions.get(id);
    if (!c) return;
    let at: Vec | undefined;
    if (client) {
      const rect = this.r.overlay.getBoundingClientRect();
      at = this.r.toDoc(client.x - rect.left, client.y - rect.top);
    }
    this.openCaption(c, { x: c.x, y: c.y }, at);
  }

  /**
   * Type into a new caption at a point (a text box when `wrap` is given), or into an existing
   * one, with the caret at `click`. New text takes the document's caption style; everything
   * can be restyled in the bar above the text.
   */
  private openCaption(c: Caption | null, at: Vec, click?: Vec, wrap?: number): void {
    this.closeCaption();
    this.commitLabel();
    const doc = this.doc;
    const st = doc.style;
    // a slide's title and text placeholders take the slide master's formatting
    const base = c?.ph ? doc.textStyles?.[c.ph] : undefined;
    const defaults = base ? { ...base } : { ...styleFromFace(st.captionFace), size: st.captionSize };
    const hide = (id: number | null) => {
      const shown = this.r.hiddenCaption !== null ? doc.captions.get(this.r.hiddenCaption) : null;
      if (shown) doc.dirtyRects.push(this.r.captionBox(shown));
      this.r.hiddenCaption = id;
      if (c) doc.dirtyRects.push(this.r.captionBox(c));
      this.requestScene();
    };
    if (c) hide(c.id);
    const id = c?.id ?? null;
    const host = {
      host: this.host,
      view: this.r.view,
      toScreen: (p: Vec) => this.r.toScreen(p),
      measure: (t: string, size: number, family: string, style: string) => measureText(t, size, family, style),
      defaultSize: base?.size ?? st.captionSize,
      redraw: () => this.requestOverlay(),
    };
    const initial = c
      ? { runs: applyBase(c.runs, base), paras: c.paras, justify: c.justify, wrap: c.wrap, width: c.width, lineHeight: c.lineHeight, lineSpacing: c.lineSpacing }
      : { runs: [], justify: 'left' as const, wrap };
    const ed = new CaptionEditor(host, at, initial, defaults, (res) => {
      if (this.captionEd === ed) this.captionEd = null;
      if (id !== null) hide(null);
      const empty = !plainText(res.runs).trim();
      const cur = id !== null ? doc.captions.get(id) : null;
      const fields: Partial<Caption> = {
        x: res.x, y: res.y, runs: stripBase(res.runs, base), justify: res.justify, paras: res.paras,
        wrap: res.wrap, width: res.width, lineHeight: res.lineHeight, lineSpacing: res.lineSpacing,
      };
      if (cur?.ph && empty) {
        // an emptied placeholder stays, showing its prompt again
        const paras = cur.ph === 'body' ? [{ list: 'bullet' as const }] : undefined;
        if (cur.runs.length || JSON.stringify(cur.paras) !== JSON.stringify(paras)) doc.edit('Edit caption', () => doc.updateCaption(cur.id, { runs: [], paras }));
      } else if (cur) {
        if (empty) doc.edit('Delete caption', () => doc.removeCaption(cur.id));
        else if ((Object.keys(fields) as (keyof Caption)[]).some((k) => JSON.stringify(cur[k]) !== JSON.stringify(fields[k]))) {
          doc.edit('Edit caption', () => doc.updateCaption(cur.id, fields));
        }
      } else if (!empty) {
        doc.edit('Caption', () => doc.addCaption({ ...fields, x: res.x, y: res.y, runs: res.runs, justify: res.justify }));
      }
      this.changed();
    });
    this.captionEd = ed;
    if (click) ed.ed.setCaret(ed.ed.offsetAt(click.x - at.x, click.y - at.y));
  }

  // ------------------------------------------------------------------ text in design shapes

  /** Select these shapes (from the Layers panel). */
  selectShapes(ids: number[]): void {
    this.closeCaption();
    this.sel = emptySel();
    for (const id of ids) if (this.doc.shapes.has(id)) this.sel.shapes.add(id);
    this.requestOverlay();
    this.onChange();
  }

  /** The shapes selected now. */
  selectedShapes(): number[] {
    return [...this.sel.shapes];
  }

  /** Smart guides: things moved snap into line with other shapes and the page (Design mode; Alt turns them off while dragging). */
  smartGuides = false;
  /** Text boxes take a click as typing (Slides and Design), with an I-beam over them. */
  textFirst = false;
  /** Structures ignore clicks and box selection, so text near them is easy to work on (Slides). */
  structuresLocked = false;
  /** The guide lines shown while moving. */
  private guideLines: GuideLine[] = [];

  /** What a moved selection lines up with: the shapes not being moved, and the page. */
  private guideTargets(): Rect[] {
    const out: Rect[] = [];
    for (const s of this.doc.shapes.values()) if (!this.sel.shapes.has(s.id) && s.kind !== 'line' && s.kind !== 'bracket' && s.kind !== 'symbol') out.push(shapeBox(s));
    if (this.fitArea) out.push(this.fitArea());
    return out;
  }

  /** Arrows drawn or dragged onto a shape's connection point stick to it (Design mode). */
  glueArrows = false;

  /** The connection point under `p`, on the shape in front. */
  private portAt(p: Vec): ReturnType<typeof portNear> {
    return portNear(shapeOrder([...this.doc.shapes.values()]).reverse(), p, this.tol(9));
  }

  /**
   * Where a connector drawn from `a` to `b` goes: its ends on the connection points there.
   * Null for an ordinary arrow that touches no connection point.
   */
  private connectorEnds(style: ArrowStyle, a: Vec, b: Vec): { tail: Vec; head: Vec; glue: Pick<Arrow, 'from' | 'to'> } | null {
    if (!style.connector && !this.glueArrows) return null;
    const pa = this.portAt(a), pb = this.portAt(b);
    if (!pa && !pb && !style.connector) return null;
    const glue: Pick<Arrow, 'from' | 'to'> = {};
    if (pa) glue.from = { shape: pa.shape, port: pa.port };
    if (pb && pb.shape !== pa?.shape) glue.to = { shape: pb.shape, port: pb.port };
    return { tail: pa?.at ?? a, head: glue.to ? pb!.at : b, glue };
  }

  /** How new design shapes look (Design mode sets its own defaults; settable in settings). */
  geoLook: Partial<Shape> = {};

  /** Shapes put down go back to the Select tool, as in PowerPoint (unless kept with the setting). */
  keepGeoTool = false;
  private afterGeo(): void {
    if (!this.keepGeoTool) this.setTool('select');
  }

  /** Put a library shape down at its usual size, centred on `p` (a shape dropped from the library). */
  placeGeo(id: string, p: Vec): void {
    const t = geoTool(id, this.geoLook);
    if (!t || t.kind !== 'shape') return;
    this.closeCaption();
    this.commitLabel();
    const doc = this.doc;
    const [w, h] = geoDef(id).size;
    doc.edit('Shape', () => this.selectOnly({ kind: 'shape', id: doc.addShape({ ...t.shape, x1: p.x - w / 2, y1: p.y - h / 2, x2: p.x + w / 2, y2: p.y + h / 2 }).id }));
    this.changed();
  }

  /** Type into a design shape (its text wraps in the shape's text area and stays with the shape). */
  editGeoText(id: number, click?: Vec): void {
    this.closeCaption();
    this.commitLabel();
    const doc = this.doc;
    const s = doc.shapes.get(id);
    if (!s || s.kind !== 'geo') return;
    // where the first line starts: from the text there, or from a space while it's empty
    const g = this.r.geoText(s, s.text?.runs.length ? s.text : { runs: [{ text: ' ' }] })!;
    const size = this.r.geoTextSize();
    this.sel = emptySel();
    this.sel.shapes.add(id);
    this.r.geoEdit = id;
    doc.dirtyRects.push(shapeBox(s));
    this.requestScene();
    const host = {
      host: this.host,
      view: this.r.view,
      toScreen: (p: Vec) => this.r.toScreen(p),
      measure: (t: string, sz: number, family: string, style: string) => measureText(t, sz, family, style),
      defaultSize: size,
      redraw: () => this.requestOverlay(),
      hint: 'Enter: new line · Esc: done',
      around: () => shapeBox(doc.shapes.get(id) ?? s),
    };
    const wrap = Math.max(4, g.area.x2 - g.area.x1);
    const ed = new CaptionEditor(host, { x: g.x, y: g.y }, { runs: s.text?.runs ?? [], paras: s.text?.paras, justify: s.textAlign ?? 'center', wrap }, {}, (res) => {
      if (this.captionEd === ed) this.captionEd = null;
      this.r.geoEdit = null;
      const cur = doc.shapes.get(id);
      if (cur) {
        doc.dirtyRects.push(shapeBox(cur));
        const empty = !plainText(res.runs).trim();
        const text = empty ? undefined : { runs: res.runs, ...(res.paras?.length ? { paras: res.paras } : {}) };
        const align = res.justify === 'center' ? undefined : res.justify;
        if (JSON.stringify(text) !== JSON.stringify(cur.text) || align !== cur.textAlign) doc.edit('Type in shape', () => doc.updateShape(id, { text, textAlign: align }));
      }
      this.requestScene();
      this.changed();
    });
    this.captionEd = ed;
    if (click) ed.ed.setCaret(ed.ed.offsetAt(click.x - g.x, click.y - g.y));
  }

  // ------------------------------------------------------------------ tables

  /** The table cell (or title or footnotes) last clicked or typed into, for the Style panel's row and column commands. */
  tablePart: { id: number; part: TablePart } | null = null;

  /** Remember which part of a table was clicked. */
  private noteTablePart(id: number, p: Vec): void {
    const s = this.doc.shapes.get(id);
    if (!s?.table) return;
    const part = partAt(s.table, this.r.tableLayout(s.table), { x: p.x - s.x1, y: p.y - s.y1 });
    if (part) this.tablePart = { id, part };
  }

  /** Type into the part of a table at a point. */
  private editTableAt(id: number, p: Vec): void {
    const s = this.doc.shapes.get(id);
    if (!s?.table) return;
    const part = partAt(s.table, this.r.tableLayout(s.table), { x: p.x - s.x1, y: p.y - s.y1 });
    if (part) this.editTable(id, part, p);
  }

  /**
   * Type into a cell of a table (or its title or footnotes), with the caret at `click` or at the
   * end. The row grows as the text does; Tab and Shift+Tab go on to the next or previous cell
   * (Tab in the last cell adds a row), and dragging the text box's handle sets the column width.
   */
  editTable(id: number, part: TablePart, click?: Vec): void {
    this.closeCaption();
    this.commitLabel();
    const doc = this.doc;
    const s = doc.shapes.get(id);
    const t0 = s?.table;
    if (!s || !t0) return;
    if (typeof part !== 'string' && (!t0.rows[part.r] || part.c >= t0.cols.length)) return;
    const lay = this.r.tableLayout(t0);
    const size = part === 'notes' ? lay.size * NOTE_SCALE : lay.size;
    // where the text starts, and how wide it may be
    let at: Vec, wrap: number, justify = cellAlign(t0, 0, 0);
    if (part === 'title') {
      at = { x: s.x1, y: s.y1 + (lay.title?.y ?? ASCENT * size) };
      wrap = lay.width;
      justify = 'left';
    } else if (part === 'notes') {
      at = { x: s.x1, y: s.y1 + (lay.notes?.y ?? lay.height + 0.35 * lay.size + ASCENT * size) };
      wrap = lay.width;
      justify = 'left';
    } else {
      const cell = lay.cells[part.r][part.c]!;
      at = { x: s.x1 + cell.x, y: s.y1 + cell.y };
      wrap = lay.xs[part.c + spanOf(t0, part.r, part.c)] - lay.xs[part.c] - 2 * lay.padX;
      justify = cellAlign(t0, part.r, part.c);
    }
    const shown = partRuns(t0, part);
    this.tablePart = { id, part };
    // the table stays selected, so the Style panel shows its commands
    this.sel = emptySel();
    this.sel.shapes.add(id);
    const repaint = (t: typeof t0) => {
      const box = this.r.tableBox({ ...s, table: t });
      doc.dirtyRects.push(box);
      this.requestScene();
    };
    this.r.tableEdit = { id, table: t0, part };
    repaint(t0);
    const host = {
      host: this.host,
      view: this.r.view,
      toScreen: (p: Vec) => this.r.toScreen(p),
      measure: (t: string, sz: number, family: string, style: string) => measureText(t, sz, family, style),
      defaultSize: size,
      redraw: () => this.requestOverlay(),
      hint: typeof part === 'string' ? 'Enter: new paragraph · Esc: done' : 'Tab: next cell · Shift+Tab: back · Enter: new line · Esc: done',
      around: () => { const cur = doc.shapes.get(id); return cur ? this.r.tableBox(cur) : this.r.tableBox(s); },
      typed: (rich: { runs: Caption['runs']; paras?: Caption['paras'] }) => {
        const cur = doc.shapes.get(id)?.table;
        if (!cur || this.r.tableEdit?.id !== id) return;
        const before = this.r.tableEdit.table;
        const draft = setPart(cur, part, rich);
        this.r.tableEdit = { id, table: draft, part };
        repaint(before);
        repaint(draft);
      },
      keys: (e: KeyboardEvent) => {
        if (e.key !== 'Tab' || typeof part === 'string' || e.ctrlKey || e.altKey || e.metaKey) return false;
        const t = doc.shapes.get(id)?.table;
        if (!t) return false;
        let next = nextCell(t, part.r, part.c, e.shiftKey);
        ed.finish();
        if (!next && !e.shiftKey) {
          // Tab in the last cell adds a row, as in Word
          const cur = doc.shapes.get(id)!;
          doc.edit('Add table row', () => this.updateTable(cur.id, insertRow(cur.table!, cur.table!.rows.length)));
          this.changed();
          next = { r: part.r + 1, c: 0 };
        }
        if (next) this.editTable(id, next);
        return true;
      },
    };
    const ed = new CaptionEditor(host, at, { runs: shown.runs, paras: shown.paras, justify, wrap }, {}, (res) => {
      if (this.captionEd === ed) this.captionEd = null;
      const cur = doc.shapes.get(id);
      if (this.r.tableEdit?.id === id) {
        const before = this.r.tableEdit.table;
        this.r.tableEdit = null;
        repaint(before);
      }
      if (!cur?.table) { this.changed(); return; }
      let t = setPart(cur.table, part, { runs: res.runs, paras: res.paras });
      // the text box's handle sets the width of the cell's column (or of the last column a spanning cell covers)
      if (typeof part !== 'string' && res.wrap !== undefined && Math.abs(res.wrap - wrap) > 0.01) {
        const last = part.c + spanOf(t, part.r, part.c) - 1;
        t = setColumnWidth(t, last, t.cols[last] + res.wrap - wrap);
      }
      if (JSON.stringify(t) !== JSON.stringify(cur.table)) doc.edit('Edit table', () => this.updateTable(id, t));
      repaint(t);
      this.changed();
    });
    this.captionEd = ed;
    if (click) ed.ed.setCaret(ed.ed.offsetAt(click.x - at.x, click.y - at.y));
    else ed.ed.selectAll();
    this.onChange();
  }

  /** Change a table, keeping its bounds in step with its layout. */
  updateTable(id: number, table: NonNullable<Shape['table']>): void {
    const s = this.doc.shapes.get(id);
    if (!s) return;
    const lay = this.r.tableLayout(table);
    this.doc.dirtyRects.push(this.r.tableBox(s));
    this.doc.updateShape(id, { table, x2: s.x1 + lay.width, y2: s.y1 + lay.height });
    this.doc.dirtyRects.push({ x1: s.x1, y1: s.y1, x2: s.x1 + lay.width, y2: s.y1 + lay.height });
  }

  // ------------------------------------------------------------------ overlay

  private drawOverlay(): void {
    this.captionEd?.place();
    const ctx = this.r.clearOverlay();
    const doc = this.doc;
    const scale = this.r.view.scale;
    const px = 1 / scale;
    // selection
    const s = this.sel;
    if (s.atoms.size || s.bonds.size || s.captions.size || s.arrows.size || s.shapes.size) {
      ctx.fillStyle = 'rgba(40, 120, 255, 0.18)';
      ctx.strokeStyle = 'rgba(40, 120, 255, 0.35)';
      ctx.lineCap = 'round';
      const L = doc.style.bondLength;
      ctx.lineWidth = L * 0.22;
      const path = new Path2D();
      for (const id of s.bonds) {
        const b = doc.bonds.get(id);
        if (!b) continue;
        const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
        path.moveTo(p.x, p.y);
        path.lineTo(q.x, q.y);
      }
      ctx.stroke(path);
      const dots = new Path2D();
      for (const id of s.atoms) {
        const a = doc.atoms.get(id);
        if (!a) continue;
        dots.moveTo(a.x + L * 0.14, a.y);
        dots.arc(a.x, a.y, L * 0.14, 0, Math.PI * 2);
      }
      ctx.fill(dots);
      ctx.lineWidth = px;
      for (const id of s.captions) { const c = doc.captions.get(id); if (c) { const r = this.r.captionBox(c); ctx.fillRect(r.x1, r.y1, r.x2 - r.x1, r.y2 - r.y1); } }
      ctx.lineWidth = L * 0.15;
      for (const id of s.arrows) { const r = doc.arrows.get(id); if (r) strokeAlong(ctx, arrowPoints(r)); }
      for (const id of s.shapes) {
        const sh = doc.shapes.get(id);
        // a table being typed into shows only a thin frame, so its text stays easy to read
        if (sh && id === this.r.tableEdit?.id) { const b = this.r.tableBox(sh); ctx.save(); ctx.lineWidth = px; ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); ctx.restore(); }
        else if (sh?.kind === 'table') { const b = this.r.tableBox(sh); ctx.fillRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1); }
        else if (sh) outlineShape(ctx, sh);
      }
    }
    if (this.showRoles && s.arrows.size === 1 && !this.drag) this.drawRoles(ctx, [...s.arrows][0], px);
    // hotspot
    const h = this.drag?.mode === 'move' || this.drag?.mode === 'rotate' ? null : this.hotspot();
    if (h) {
      ctx.fillStyle = HILITE;
      ctx.strokeStyle = HILITE;
      if (h.kind === 'atom') {
        const a = doc.atoms.get(h.id);
        if (a) {
          const r = doc.style.bondLength * 0.26 * (a.s ?? 1);
          ctx.beginPath();
          ctx.arc(a.x, a.y, r, 0, Math.PI * 2);
          ctx.fill();
          // a green dot where 1 would grow the next bond, as in ChemDraw
          const dot = add(a, mul(sproutDir(doc, a.id), bondLength(doc, a) * 0.46));
          ctx.fillStyle = '#19a34a';
          ctx.beginPath();
          ctx.arc(dot.x, dot.y, Math.max(0.9, 2.6 * px), 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (h.kind === 'bond') {
        const b = doc.bonds.get(h.id);
        if (b) {
          const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
          const d = norm(sub(q, p));
          const n = perp(d);
          const w = doc.style.bondLength * 0.17 * (b.s ?? 1);
          const inset = dist(p, q) * 0.12;
          const p1 = add(p, mul(d, inset)), q1 = sub(q, mul(d, inset));
          ctx.beginPath();
          ctx.moveTo(p1.x + n.x * w, p1.y + n.y * w);
          ctx.lineTo(q1.x + n.x * w, q1.y + n.y * w);
          ctx.lineTo(q1.x - n.x * w, q1.y - n.y * w);
          ctx.lineTo(p1.x - n.x * w, p1.y - n.y * w);
          ctx.closePath();
          ctx.fill();
        }
      } else if (h.kind === 'caption') {
        const c = doc.captions.get(h.id);
        if (c) { const r = this.r.captionBox(c); ctx.lineWidth = px; ctx.strokeStyle = 'rgba(40,120,255,0.7)'; ctx.strokeRect(r.x1 - 1, r.y1 - 1, r.x2 - r.x1 + 2, r.y2 - r.y1 + 2); }
      } else if (h.kind === 'arrow') {
        const r = doc.arrows.get(h.id);
        if (r) { ctx.lineWidth = doc.style.bondLength * 0.2; ctx.lineCap = 'round'; strokeAlong(ctx, arrowPoints(r)); }
      } else if (h.kind === 'shape') {
        const sh = doc.shapes.get(h.id);
        if (sh) { ctx.lineWidth = doc.style.bondLength * 0.15; ctx.lineCap = 'round'; outlineShape(ctx, sh); }
      }
    }
    // a picture being cropped: the part cut off shows faintly around it
    const crop = this.cropping !== null ? doc.shapes.get(this.cropping) : undefined;
    if (crop?.src) {
      const c = crop.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      const x1 = Math.min(crop.x1, crop.x2), y1 = Math.min(crop.y1, crop.y2), w = Math.abs(crop.x2 - crop.x1), hh = Math.abs(crop.y2 - crop.y1);
      const W = w / Math.max(0.01, 1 - c.l - c.r), H = hh / Math.max(0.01, 1 - c.t - c.b);
      const img = imageFor(crop.src);
      ctx.save();
      ctx.globalAlpha = 0.35;
      if (img) ctx.drawImage(img, x1 - c.l * W, y1 - c.t * H, W, H);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = px;
      ctx.strokeRect(x1 - c.l * W, y1 - c.t * H, W, H);
      ctx.restore();
    }
    // handles on selected arrows and shapes
    const handles = this.drag?.mode === 'move' ? [] : this.handles();
    if (handles.length) {
      const k = 3.5 * px;
      ctx.lineWidth = px;
      ctx.strokeStyle = PREVIEW;
      ctx.fillStyle = '#fff';
      for (const hd of handles) {
        ctx.beginPath();
        if (hd.kind === 'shape' && hd.id === this.cropping) {
          // crop handles: black bars along the edges and corners, as in PowerPoint
          ctx.fillStyle = '#000';
          const t = 2.2 * px, l = 9 * px;
          const sx = hd.which.includes('w') ? 1 : hd.which.includes('e') ? -1 : 0, sy = hd.which.includes('n') ? 1 : hd.which.includes('s') ? -1 : 0;
          if (sx) ctx.rect(hd.at.x - (sx < 0 ? t : 0), hd.at.y - (sy ? (sy < 0 ? l : 0) : l / 2), t, l);
          if (sy) ctx.rect(hd.at.x - (sx ? (sx < 0 ? l : 0) : l / 2), hd.at.y - (sy < 0 ? t : 0), l, t);
          ctx.fill();
          ctx.fillStyle = '#fff';
          continue;
        }
        if (hd.which === 'mid') ctx.arc(hd.at.x, hd.at.y, k * 1.1, 0, Math.PI * 2);
        else ctx.rect(hd.at.x - k, hd.at.y - k, 2 * k, 2 * k);
        ctx.fill();
        ctx.stroke();
      }
    }
    // the selection's box and the handle that turns it
    const rh = this.drag && this.drag.mode !== 'rotate' ? null : this.rotateHandle();
    if (rh) {
      const b = this.selBox()!;
      ctx.lineWidth = px;
      ctx.strokeStyle = 'rgba(47, 111, 223, 0.55)';
      ctx.setLineDash([3 * px, 3 * px]);
      ctx.strokeRect(b.x1 - 2 * px, b.y1 - 2 * px, b.x2 - b.x1 + 4 * px, b.y2 - b.y1 + 4 * px);
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(rh.x, b.y1 - 2 * px);
      ctx.lineTo(rh.x, rh.y + 4.5 * px);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(rh.x, rh.y, 4.5 * px, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.strokeStyle = PREVIEW;
      ctx.stroke();
      const r = this.drag?.rot;
      if (r && this.drag!.moved) {
        ctx.font = `${12 * px}px system-ui, sans-serif`;
        ctx.fillStyle = PREVIEW;
        ctx.fillText(`${Math.round(r.angle / DEG)}°`, this.pointer.x + 10 * px, this.pointer.y - 10 * px);
      }
    }
    // how far an arrow is bent, while bending it
    const dh = this.drag?.mode === 'handle' && this.drag.moved ? this.drag.handle : undefined;
    if (dh && dh.kind === 'arrow' && dh.which === 'mid') {
      const r = doc.arrows.get(dh.id);
      if (r) {
        ctx.font = `${12 * px}px ${'system-ui, sans-serif'}`;
        ctx.fillStyle = PREVIEW;
        ctx.fillText(r.sweep ? `${Math.round(Math.abs(r.sweep) / DEG)}°` : 'straight', this.pointer.x + 10 * px, this.pointer.y - 10 * px);
      }
    }
    this.drawPorts(ctx, px);
    if (this.guideLines.length && this.drag?.mode === 'move') {
      ctx.save();
      ctx.strokeStyle = '#e8336d';
      ctx.lineWidth = px;
      ctx.setLineDash([4 * px, 3 * px]);
      ctx.beginPath();
      for (const g of this.guideLines) { ctx.moveTo(g.x1, g.y1); ctx.lineTo(g.x2, g.y2); }
      ctx.stroke();
      ctx.restore();
    }
    // previews of what a drag will draw
    const d = this.drag;
    if (d && d.moved) {
      ctx.strokeStyle = PREVIEW;
      ctx.lineWidth = Math.max(doc.style.lineWidth, px * 1.2);
      ctx.lineCap = 'round';
      if (d.mode === 'marquee') {
        ctx.setLineDash([4 * px, 3 * px]);
        ctx.lineWidth = px;
        ctx.strokeStyle = '#333';
        ctx.strokeRect(Math.min(d.start.x, d.last.x), Math.min(d.start.y, d.last.y), Math.abs(d.last.x - d.start.x), Math.abs(d.last.y - d.start.y));
        ctx.setLineDash([]);
      } else if (d.mode === 'draw') {
        this.drawPreview(ctx, d);
      }
    }
    this.captionEd?.draw(ctx);
  }

  /** While drawing a connector (or dragging its end), the connection points of the shape under the pointer. */
  private drawPorts(ctx: CanvasRenderingContext2D, px: number): void {
    const dh = this.drag?.mode === 'handle' ? this.drag.handle : undefined;
    const r = dh?.kind === 'arrow' ? this.doc.arrows.get(dh.id) : undefined;
    const drawing = this.tool.kind === 'arrow' && (this.tool.style.connector || this.glueArrows);
    const dragging = !!r && (dh!.which === 'tail' || dh!.which === 'head') && (this.glueArrows || !!r.from || !!r.to || !!r.elbow);
    if (!drawing && !dragging) return;
    const p = this.pointer;
    const near = this.portAt(p);
    const pad = 14 * px;
    ctx.save();
    ctx.lineWidth = 1.2 * px;
    for (const s of this.doc.shapes.values()) {
      const ps = shapePorts(s);
      if (!ps) continue;
      const b = shapeBox(s);
      if (p.x < b.x1 - pad || p.x > b.x2 + pad || p.y < b.y1 - pad || p.y > b.y2 + pad) continue;
      ps.forEach((q, i) => {
        const hot = near && near.shape === s.id && near.port === i;
        ctx.beginPath();
        ctx.arc(q.x, q.y, (hot ? 5 : 3.5) * px, 0, Math.PI * 2);
        ctx.fillStyle = hot ? '#2f80ed' : '#fff';
        ctx.strokeStyle = '#2f80ed';
        ctx.fill();
        ctx.stroke();
      });
    }
    ctx.restore();
  }

  private drawPreview(ctx: CanvasRenderingContext2D, d: Drag): void {
    const doc = this.doc;
    const t = this.tool;
    const h = d.hit;
    const startAtom = h && h.kind === 'atom' ? doc.atoms.get(h.id)! : null;
    const start: Vec = startAtom ?? d.start;
    const L = startAtom ? bondLength(doc, startAtom) : doc.style.bondLength;
    const poly = (pts: Vec[], close: boolean) => {
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (close) ctx.closePath();
      ctx.stroke();
    };
    if (t.kind === 'text') {
      ctx.setLineDash([4 / this.r.view.scale, 3 / this.r.view.scale]);
      ctx.lineWidth = 1 / this.r.view.scale;
      ctx.strokeRect(Math.min(d.start.x, d.last.x), Math.min(d.start.y, d.last.y), Math.abs(d.last.x - d.start.x), Math.abs(d.last.y - d.start.y));
      ctx.setLineDash([]);
    } else if (t.kind === 'bond') {
      const end = this.snapEnd(start, d.last, L, startAtom?.id, d.alt);
      poly([start, end.pt], false);
    } else if (t.kind === 'chain') {
      const pts = chainPoints(start, d.last, L, doc.style.chainAngle, this.chainFirstUp(start, d.last));
      poly(pts, false);
      ctx.fillStyle = PREVIEW;
      ctx.font = `${10 / this.r.view.scale}px sans-serif`;
      const e = pts[pts.length - 1];
      ctx.fillText(String(pts.length - 1), e.x + 4 / this.r.view.scale, e.y - 4 / this.r.view.scale);
    } else if (t.kind === 'ring') {
      let pts: Vec[];
      if (h && h.kind === 'bond') {
        const b = doc.bonds.get(h.id)!;
        pts = fusedRing(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, t.size, fuseSide(doc, b, t.size, d.last));
      } else if (startAtom) {
        pts = ringOnAtom(startAtom, norm(fromAngle(snapAngle(angleOf(sub(d.last, startAtom))))), t.size, L);
      } else pts = freeRing(d.start, t.size, L, d.last);
      poly(pts, true);
    } else if (t.kind === 'arrow') {
      const push = this.pushFor(d, d.last);
      if (push) { poly(arrowPoints(push), false); return; }
      const c = this.connectorEnds(t.style, d.start, d.last);
      if (c) { poly(arrowPoints({ tail: c.tail, head: c.head, sweep: 0, elbow: t.style.elbow, ...c.glue }), false); return; }
      const start = this.branchStart(d);
      const end = this.arrowEnd(start, d.last, d.alt);
      const sweep = (t.style.sweep ?? 0) * this.bendSide(d, end);
      poly(arrowPoints({ tail: start, head: end, sweep }), false);
    } else if (t.kind === 'shape') {
      const g = this.shapeGeometry(t, d.start, d.last, d.shift, d.alt);
      if (g) outlineShape(ctx, { id: 0, ...t.shape, ...g });
    } else if (t.kind === 'fragment') {
      outlineShape(ctx, { id: 0, kind: 'line', dashed: true, x1: d.start.x, y1: d.start.y, x2: d.last.x, y2: d.last.y });
      // the bonds that will break
      ctx.save();
      ctx.lineWidth = Math.max(ctx.lineWidth, 3 / this.r.view.scale);
      ctx.strokeStyle = '#e0141e';
      ctx.beginPath();
      for (const id of crossedBonds(doc, d.start, d.last)) {
        const b = doc.bonds.get(id)!, a1 = doc.atoms.get(b.a1)!, a2 = doc.atoms.get(b.a2)!;
        ctx.moveTo(a1.x, a1.y); ctx.lineTo(a2.x, a2.y);
      }
      ctx.stroke();
      ctx.restore();
    } else if (t.kind === 'bracket') {
      const r = { x1: Math.min(d.start.x, d.last.x), y1: Math.min(d.start.y, d.last.y), x2: Math.max(d.start.x, d.last.x), y2: Math.max(d.start.y, d.last.y) };
      for (const b of bracketsAround(r, t.bracket)) outlineShape(ctx, { id: 0, ...b });    } else if (t.kind === 'template') {
      const tp = templateById(t.id);
      const place = tp && this.templatePlacement(tp, h, d.start, d.last, d.alt);
      if (tp && place) {
        const pts = templatePoints(tp, place.pl);
        ctx.beginPath();
        for (const [a, b] of tp.bonds) { ctx.moveTo(pts[a].x, pts[a].y); ctx.lineTo(pts[b].x, pts[b].y); }
        if (place.bondFrom !== undefined) { const f = doc.atoms.get(place.bondFrom)!; ctx.moveTo(f.x, f.y); ctx.lineTo(pts[tp.attach].x, pts[tp.attach].y); }
        ctx.stroke();
      }
    }
  }
}

function strokeAlong(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

/** Trace a shape's outline (or fill it, when the shape is filled) with the current style. */
function outlineShape(ctx: CanvasRenderingContext2D, s: Shape): void {
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2), w = Math.abs(s.x2 - s.x1), h = Math.abs(s.y2 - s.y1);
  ctx.beginPath();
  switch (s.kind) {
    case 'line': ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke(); return;
    case 'bracket': {
      // spine plus lips, on the right of the spine's direction
      const d = norm({ x: s.x2 - s.x1, y: s.y2 - s.y1 }), n = perp(d), lip = bracketLip(Math.hypot(w, h));
      ctx.moveTo(s.x1 + n.x * lip, s.y1 + n.y * lip); ctx.lineTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.lineTo(s.x2 + n.x * lip, s.y2 + n.y * lip);
      ctx.stroke();
      return;
    }
    case 'rect': ctx.rect(x, y, w, h); break;
    case 'oval': ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2); break;
    case 'geo': traceSteps(ctx, moveSteps(geoDef(s.geo).draw(w, h).body, x, y)); ctx.stroke(); return;
    case 'picture': ctx.rect(x, y, w, h); ctx.stroke(); return;
    default: ctx.rect(x, y, w, h); ctx.fill(); return;
  }
  if (s.filled) ctx.fill(); else ctx.stroke();
}

/** The tool that draws a shape from the library, looking as `look` says. */
/** The usual line widths of new design shapes, in points. */
export const CLIP_ART_LINE = 1.75, SHAPE_LINE = 1;

function geoTool(id: string, look: Partial<Shape>): Tool | undefined {
  const def = GEO_BY_ID.get(id);
  if (!def) return undefined;
  // lines in proportion to the shape: clip art (glassware…) at 1.75 pt, as it is drawn about 60 pt
  // across; other shapes at PowerPoint's 1 pt. Change it in the Style panel.
  const base: Partial<Shape> = def.outline ? { color: '#000000', lineWidth: CLIP_ART_LINE } : { filled: true, fillColor: '#dae3f3', color: '#2f5597', lineWidth: SHAPE_LINE, ...look };
  return { kind: 'shape', shape: { ...base, kind: 'geo', geo: id } as ShapeStyle, from: 'corner' };
}

export interface GuideLine { x1: number; y1: number; x2: number; y2: number }

/**
 * Smart guides: how far to move a box (`raw` is how far the pointer moved) so its left, middle
 * or right lines up with one of the targets' (and its top, middle or bottom), when within `tol`;
 * and the lines that show what it lined up with.
 */
export function guideSnap(box: Rect, raw: Vec, targets: Rect[], tol: number): { offset: Vec; lines: GuideLine[] } {
  const xs = (r: Rect) => [r.x1, (r.x1 + r.x2) / 2, r.x2];
  const ys = (r: Rect) => [r.y1, (r.y1 + r.y2) / 2, r.y2];
  let bx: { d: number; at: number; t: Rect } | null = null, by: { d: number; at: number; t: Rect } | null = null;
  const moved = { x1: box.x1 + raw.x, y1: box.y1 + raw.y, x2: box.x2 + raw.x, y2: box.y2 + raw.y };
  for (const t of targets) {
    for (const a of xs(moved)) for (const b of xs(t)) { const d = b - a; if (Math.abs(d) <= tol && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, at: b, t }; }
    for (const a of ys(moved)) for (const b of ys(t)) { const d = b - a; if (Math.abs(d) <= tol && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, at: b, t }; }
  }
  const offset = { x: raw.x + (bx?.d ?? 0), y: raw.y + (by?.d ?? 0) };
  const end = { x1: box.x1 + offset.x, y1: box.y1 + offset.y, x2: box.x2 + offset.x, y2: box.y2 + offset.y };
  const lines: GuideLine[] = [];
  if (bx) lines.push({ x1: bx.at, y1: Math.min(end.y1, bx.t.y1), x2: bx.at, y2: Math.max(end.y2, bx.t.y2) });
  if (by) lines.push({ x1: Math.min(end.x1, by.t.x1), y1: by.at, x2: Math.max(end.x2, by.t.x2), y2: by.at });
  return { offset, lines };
}

function sameHit(a: Hit, b: Hit): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

export { MERGE_FRACTION, atomAt };
