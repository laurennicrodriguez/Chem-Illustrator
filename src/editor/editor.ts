// Mouse and keyboard handling: drawing tools, ChemDraw hotkeys, selection, undo, zoom and
// pan. The editor changes the document and asks for a repaint; hover and drawing previews
// only repaint the overlay layer.

import { Doc, Atom, Bond, BondDisplay, Arrow, Shape } from '../model';
import { Renderer } from '../render/renderer';
import { Vec, Rect, add, sub, mul, norm, dist, dot, distToSegment, rectContains, angleOf, fromAngle, snapAngle, perp, DEG } from '../geom';
import {
  sproutDir, sproutPair, sprout, bondTo, bondLength, atomAt, freeRing, fusedRing, fuseSide, ringOnAtom,
  placeRing, chainPoints, MERGE_FRACTION,
} from '../chem/chemgeom';
import { ATOM_LABEL_KEYS, ATOM_ACTION_KEYS, BOND_KEYS, TOOL_KEYS, AtomAction } from './hotkeys';
import { elementNumber, hasImplicitH, implicitHydrogens, SYMBOLS } from '../chem/elements';
import { tokenize } from '../chem/labels';
import {
  Handle, arrowHit, shapeHit, arrowHandles, shapeHandles, dragArrowHandle, dragShapeHandle, shapeBox,
  arrowPoints, bracketsAround, bracketLip, unionRect,
} from '../objects';

export type Tool =
  | { kind: 'select' }
  | { kind: 'eraser' }
  | { kind: 'bond'; order: number; display: BondDisplay }
  | { kind: 'chain' }
  | { kind: 'ring'; size: number; aromatic: boolean }
  | { kind: 'text' }
  | { kind: 'arrow'; style: ArrowStyle }
  | { kind: 'shape'; shape: ShapeStyle; from: 'corner' | 'center' }
  | { kind: 'bracket'; bracket: NonNullable<Shape['bracket']> };

/** How a new arrow looks (everything else is the document's default). */
export type ArrowStyle = Partial<Pick<Arrow, 'headStyle' | 'tailStyle' | 'headType' | 'line' | 'noGo' | 'equilibrium' | 'sweep'>> & {
  /** Two shafts and an open head (⇒). */
  retro?: boolean;
};

/** How a new shape looks. */
export type ShapeStyle = Partial<Omit<Shape, 'id' | 'kind' | 'x1' | 'y1' | 'x2' | 'y2'>> & { kind: 'line' | 'rect' | 'oval' };

export const TOOLS: Record<string, Tool> = {
  select: { kind: 'select' },
  eraser: { kind: 'eraser' },
  'bond-single': { kind: 'bond', order: 1, display: 'solid' },
  'bond-double': { kind: 'bond', order: 2, display: 'solid' },
  'bond-triple': { kind: 'bond', order: 3, display: 'solid' },
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
};

export type Hit =
  | { kind: 'atom'; id: number }
  | { kind: 'bond'; id: number }
  | { kind: 'caption'; id: number }
  | { kind: 'arrow'; id: number }
  | { kind: 'shape'; id: number }
  | null;

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
  mode: 'none' | 'pan' | 'move' | 'marquee' | 'draw' | 'handle';
  last: Vec;
  panOrigin?: { ox: number; oy: number };
  /** The arrow or shape handle being dragged. */
  handle?: Handle;
  /** Where the pointer has been (which way a curved arrow is drawn bending). */
  path?: Vec[];
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
  /** After a hotkey sprouts an atom, the hotspot follows the new atom until the mouse moves. */
  private hotAtom: number | null = null;
  private hotAnchor: Vec | null = null;
  private drag: Drag | null = null;
  private needScene = true;
  private needOverlay = true;
  private frameQueued = false;
  private inputTs = 0;
  /** Input-to-paint times for the speed readout (ms). */
  latencies: number[] = [];
  onChange: () => void = () => {};
  onFrame: () => void = () => {};
  onToolChange: (name: string) => void = () => {};
  /** The atom most recently drawn or changed (its structure is analysed when nothing is selected). */
  lastEdited: number | null = null;
  private labelInput: HTMLInputElement | null = null;

  constructor(public doc: Doc, public r: Renderer, public host: HTMLElement) {
    const el = r.overlay;
    el.addEventListener('pointerdown', (e) => this.onDown(e));
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerup', (e) => this.onUp(e));
    el.addEventListener('pointerleave', () => { if (!this.drag) { this.hover = null; this.requestOverlay(); } });
    el.addEventListener('dblclick', (e) => this.onDoubleClick(e));
    el.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
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
    const t = TOOLS[name];
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
    for (const a of doc.atomsNear(p, Math.max(atomR, L * 2))) {
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
    for (const b of doc.bondsNear(p, bondTol)) {
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
    let shape: Shape | null = null;
    for (const s of doc.shapes.values()) if (shapeHit(s, p, at) && (!shape || (s.z ?? 0) >= (shape.z ?? 0))) shape = s;
    return shape ? { kind: 'shape', id: shape.id } : null;
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

  /** The atom or bond hotkeys apply to: the one under the pointer, or the last sprouted atom. */
  private hotspot(): Hit {
    if (this.hotAtom !== null && this.doc.atoms.has(this.hotAtom)) return { kind: 'atom', id: this.hotAtom };
    return this.hover;
  }

  // ------------------------------------------------------------------ pointer

  private docPoint(e: PointerEvent | MouseEvent | WheelEvent): Vec {
    const rect = this.r.overlay.getBoundingClientRect();
    return this.r.toDoc(e.clientX - rect.left, e.clientY - rect.top);
  }

  private onDown(e: PointerEvent): void {
    this.commitLabel();
    this.r.overlay.setPointerCapture(e.pointerId);
    const p = this.docPoint(e);
    const rect = this.r.overlay.getBoundingClientRect();
    const handle = e.button === 0 ? this.handleAt(p) : null;
    const hit = handle ? null : this.hitTest(p);
    this.drag = {
      start: p, startScreen: { x: e.clientX - rect.left, y: e.clientY - rect.top }, hit, button: e.button, moved: false,
      shift: e.shiftKey, alt: e.altKey, ctrl: e.ctrlKey || e.metaKey, mode: handle ? 'handle' : 'none', last: p, path: [p],
    };
    if (handle) this.drag.handle = handle;
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
    if (this.hotAnchor && dist(this.hotAnchor, p) > this.tol(3)) { this.hotAtom = null; this.hotAnchor = null; }
    if (!d) {
      const handle = this.handleAt(p);
      const h = handle ? null : this.hitTest(p);
      if (!sameHit(h, this.hover)) { this.hover = h; }
      this.r.overlay.style.cursor = handle ? (handle.which === 'mid' ? 'grab' : 'crosshair') : '';
      this.requestOverlay(e.timeStamp);
      return;
    }
    const rect = this.r.overlay.getBoundingClientRect();
    const sp = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (!d.moved && Math.hypot(sp.x - d.startScreen.x, sp.y - d.startScreen.y) > 3) {
      d.moved = true;
      if (d.mode === 'none') d.mode = this.dragModeFor(d);
      if (d.mode === 'handle') this.doc.begin(d.handle!.which === 'mid' ? 'Bend arrow' : 'Resize');
      if (d.mode === 'move') {
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
    if (d.mode === 'move') {
      const dx = p.x - d.last.x, dy = p.y - d.last.y;
      this.moveSelection(dx, dy);
      d.last = p;
      this.requestScene(e.timeStamp);
      return;
    }
    if (d.mode === 'handle') {
      const h = d.handle!;
      if (h.kind === 'arrow') {
        const r = this.doc.arrows.get(h.id);
        if (r) this.doc.updateArrow(h.id, dragArrowHandle(r, h.which, p, e.altKey));
      } else {
        const sh = this.doc.shapes.get(h.id);
        if (sh) this.doc.updateShape(h.id, dragShapeHandle(sh, h.which, p, e.altKey));
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
    switch (this.tool.kind) {
      case 'select':
        return d.hit ? 'move' : 'marquee';
      case 'eraser':
        return 'none';
      case 'bond':
      case 'chain':
      case 'ring':
      case 'arrow':
      case 'shape':
      case 'bracket':
        return 'draw';
      case 'text':
        return d.hit && d.hit.kind === 'caption' ? 'move' : 'none';
    }
  }

  private onUp(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    const p = this.docPoint(e);
    if (d.mode === 'pan') { this.requestScene(e.timeStamp); return; }
    if (d.mode === 'handle') {
      if (d.moved) { this.doc.commit(); this.changed(); }
      return;
    }
    if (d.mode === 'move') {
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

  private onDoubleClick(e: MouseEvent): void {
    const p = this.docPoint(e);
    const h = this.hitTest(p);
    if (this.tool.kind === 'select' && h && (h.kind === 'atom' || h.kind === 'bond')) {
      const atom = h.kind === 'atom' ? h.id : this.doc.bonds.get(h.id)!.a1;
      this.selectFragment(atom, e.shiftKey);
    } else if (h && h.kind === 'atom' && this.tool.kind !== 'text') {
      this.editLabel(h.id);
    } else if (h && h.kind === 'caption') {
      this.editCaption(h.id);
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

  /** Zoom and scroll so the whole drawing fits the window. */
  fit(): void {
    const b = this.doc.bounds();
    if (!b) return;
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
        if (!d.shift) this.sel = emptySel();
        if (h) this.toggleSel(h);
        this.onChange();
        return;
      }
      case 'eraser': {
        if (h) doc.edit('Erase', () => this.erase(h));
        this.changed();
        return;
      }
      case 'text': {
        if (h && h.kind === 'atom') this.editLabel(h.id);
        else if (h && h.kind === 'caption') this.editCaption(h.id);
        else this.newCaption(p);
        return;
      }
      case 'arrow':
      case 'shape':
      case 'bracket': {
        // clicking an arrow or shape picks it up, so its handles can be dragged
        if (h && (h.kind === 'arrow' || h.kind === 'shape')) { this.selectOnly(h); return; }
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
        this.changed();
        return;
      }
      case 'chain': {
        if (!this.sel.atoms.size) this.sel = emptySel();
        doc.edit('Chain', () => {
          if (h && h.kind === 'atom') this.lastEdited = sprout(doc, h.id).id;
          else {
            const a = doc.addAtom(p.x, p.y);
            this.lastEdited = bondTo(doc, a, add(p, fromAngle(-30 * DEG, doc.style.bondLength))).id;
          }
        });
        this.changed();
        return;
      }
      case 'ring': {
        if (!this.sel.atoms.size) this.sel = emptySel();
        doc.edit('Ring', () => this.ringClick(h, p, t.size, t.aromatic, d.alt, d.shift));
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

  private ringClick(h: Hit, p: Vec, n: number, aromatic: boolean, alt: boolean, shift: boolean, towards?: Vec): void {
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
    this.lastEdited = ids[0];
  }

  // ------------------------------------------------------------------ drags that draw

  private snapEnd(from: Vec, p: Vec, L: number, fromId?: number): { pt: Vec; atom?: Atom } {
    const h = this.hitTest(p);
    if (h && h.kind === 'atom' && h.id !== fromId) {
      const a = this.doc.atoms.get(h.id)!;
      return { pt: a, atom: a };
    }
    const ang = snapAngle(angleOf(sub(p, from)));
    return { pt: add(from, fromAngle(ang, L)) };
  }

  private finishDraw(d: Drag, p: Vec): void {
    const doc = this.doc;
    const t = this.tool;
    const h = d.hit;
    const startAtom = h && h.kind === 'atom' ? doc.atoms.get(h.id)! : null;
    const start = startAtom ?? d.start;
    if (t.kind === 'bond') {
      doc.edit('Bond', () => {
        const a = startAtom ?? doc.addAtom(start.x, start.y);
        const L = bondLength(doc, a);
        const end = this.snapEnd(a, p, L, a.id);
        const to = end.atom ?? bondTo(doc, a, end.pt, t.order, t.display);
        if (end.atom && !doc.bondBetween(a.id, end.atom.id)) doc.addBond(a.id, end.atom.id, t.order, t.display);
        this.lastEdited = to.id;
      });
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
        if (h && h.kind === 'bond') this.ringClick(h, p, t.size, t.aromatic, d.alt, d.shift);
        else if (h && h.kind === 'atom') {
          const a = doc.atoms.get(h.id)!;
          const dir = norm(fromAngle(snapAngle(angleOf(sub(p, a)))));
          const ids = placeRing(doc, ringOnAtom(a, dir, t.size, bondLength(doc, a)), { aromatic: t.aromatic, shiftPhase: d.shift, existing: [a.id], scale: a.s });
          this.lastEdited = ids[0];
        } else this.ringClick(null, d.start, t.size, t.aromatic, false, d.shift, p);
      });
    } else if (t.kind === 'arrow') {
      const end = this.arrowEnd(d.start, p, d.alt);
      doc.edit('Arrow', () => this.selectOnly({ kind: 'arrow', id: this.addArrow(d.start, end, t.style, this.bendSide(d, end)).id }));
    } else if (t.kind === 'shape') {
      const g = this.shapeGeometry(t, d.start, p, d.shift, d.alt);
      if (g) doc.edit('Shape', () => this.selectOnly({ kind: 'shape', id: doc.addShape({ ...t.shape, ...g }).id }));
    } else if (t.kind === 'bracket') {
      const r = { x1: Math.min(d.start.x, p.x), y1: Math.min(d.start.y, p.y), x2: Math.max(d.start.x, p.x), y2: Math.max(d.start.y, p.y) };
      if (r.y2 - r.y1 >= 4) this.addBrackets(r, t.bracket);
    }
    this.changed();
  }

  /** Where a dragged arrow ends: snapped to 15° steps (Alt: anywhere), and at least a bond long. */
  private arrowEnd(start: Vec, p: Vec, free: boolean): Vec {
    const L = this.doc.style.bondLength;
    const l = Math.max(L, dist(p, start));
    return add(start, fromAngle(free ? angleOf(sub(p, start)) : snapAngle(angleOf(sub(p, start))), l));
  }

  /** Which way a curved arrow bends: towards the side the pointer swung out to, else to the left. */
  private bendSide(d: Drag, end: Vec): number {
    const n = perp(norm(sub(end, d.start)));
    let most = 0;
    for (const q of d.path ?? []) { const o = dot(sub(q, d.start), n); if (Math.abs(o) > Math.abs(most)) most = o; }
    return Math.abs(most) > this.tol(4) && most > 0 ? -1 : 1;
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
    const { retro, ...rest } = style;
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
    this.sel = { atoms: new Set(d.atoms.keys()), bonds: new Set(d.bonds.keys()), captions: new Set(d.captions.keys()), arrows: new Set(d.arrows.keys()), shapes: new Set(d.shapes.keys()) };
    this.requestOverlay();
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
    for (const at of doc.atomsIn(r)) this.sel.atoms.add(at.id);
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
    for (const s of doc.shapes.values()) if (within(s.kind === 'bracket' ? { x1: Math.min(s.x1, s.x2), y1: Math.min(s.y1, s.y2), x2: Math.max(s.x1, s.x2), y2: Math.max(s.y1, s.y2) } : shapeBox(s))) this.sel.shapes.add(s.id);
  }

  private moveSelection(dx: number, dy: number): void {
    const doc = this.doc;
    doc.moveAtoms(this.sel.atoms, dx, dy);
    for (const id of this.sel.captions) { const c = doc.captions.get(id); if (c) doc.updateCaption(id, { x: c.x + dx, y: c.y + dy }); }
    for (const id of this.sel.arrows) { const r = doc.arrows.get(id); if (r) doc.updateArrow(id, { tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } }); }
    for (const id of this.sel.shapes) { const s = doc.shapes.get(id); if (s) doc.updateShape(id, { x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }); }
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

  // ------------------------------------------------------------------ keyboard

  private onKey(e: KeyboardEvent): void {
    const target = e.target as HTMLElement;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const doc = this.doc;
    if (ctrl) {
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
      if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); this.redo(); return; }
      if (k === 'a') { e.preventDefault(); this.selectAll(); return; }
      if (k === '0') { e.preventDefault(); this.fit(); return; }
      if (k === '=' || k === '+') { e.preventDefault(); this.zoomAt(this.r.width / 2, this.r.height / 2, 1.25); this.requestScene(); return; }
      if (k === '-') { e.preventDefault(); this.zoomAt(this.r.width / 2, this.r.height / 2, 0.8); this.requestScene(); return; }
      return;
    }
    if (e.altKey) return;
    if (e.key === 'Escape') { this.clearSelection(); return; }
    const hs = this.hotspot();
    if ((e.key === 'Delete' || e.key === 'Backspace') && this.hasSelection() && (!hs || this.isSelected(hs))) {
      e.preventDefault();
      this.deleteSelection();
      return;
    }
    if (hs && hs.kind === 'atom') {
      if (this.atomKey(hs.id, e.key)) { e.preventDefault(); this.inputTs = e.timeStamp; this.changed(); }
      return;
    }
    if (hs && hs.kind === 'bond') {
      if (this.bondKey(hs.id, e.key)) { e.preventDefault(); this.inputTs = e.timeStamp; this.changed(); }
      return;
    }
    if (e.key.startsWith('Arrow') && this.hasSelection()) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      doc.edit('Nudge', () => this.moveSelection(dx, dy));
      this.changed();
      return;
    }
    const tool = TOOL_KEYS[e.key];
    if (tool) { e.preventDefault(); this.setTool(tool); }
  }

  undo(): void {
    if (this.doc.undo()) this.afterUndo();
  }

  redo(): void {
    if (this.doc.redo()) this.afterUndo();
  }

  private afterUndo(): void {
    // drop selected things that no longer exist
    for (const [set, map] of [[this.sel.atoms, this.doc.atoms], [this.sel.bonds, this.doc.bonds], [this.sel.captions, this.doc.captions], [this.sel.arrows, this.doc.arrows], [this.sel.shapes, this.doc.shapes]] as [Set<number>, Map<number, unknown>][]) {
      for (const id of set) if (!map.has(id)) set.delete(id);
    }
    this.hotAtom = null;
    this.changed();
  }

  /** Apply an atom hotkey. Returns false if the key does nothing on atoms. */
  atomKey(id: number, key: string): boolean {
    const doc = this.doc;
    const a = doc.atoms.get(id);
    if (!a) return false;
    const label = ATOM_LABEL_KEYS[key];
    if (label) {
      doc.edit('Label', () => this.applyLabel(id, label));
      this.lastEdited = id;
      return true;
    }
    const act: AtomAction | undefined = ATOM_ACTION_KEYS[key];
    if (!act) return false;
    if (act === 'label') { this.editLabel(id); return false; }
    if (act === 'select') { this.sel = emptySel(); this.sel.atoms.add(id); this.requestOverlay(); this.onChange(); return false; }
    let next: number | null = null;
    doc.edit('Hotkey', () => { next = this.atomAction(a, act); });
    this.lastEdited = next ?? id;
    if (next !== null && doc.atoms.has(next)) {
      this.hotAtom = next;
      this.hotAnchor = { ...this.pointer };
    }
    return true;
  }

  private atomAction(a: Atom, act: AtomAction): number | null {
    const doc = this.doc;
    const id = a.id;
    const deg = doc.degree(id);
    const aromaticOrTertiary = deg >= 3 || this.isAromaticAtom(id);
    const L = bondLength(doc, a);
    switch (act) {
      case 'bond': return sprout(doc, id).id;
      case 'carbonyl': {
        if (deg === 2 && !aromaticOrTertiary) { sprout(doc, id, 2, 'solid', 8); return id; }
        const c = aromaticOrTertiary ? sprout(doc, sprout(doc, id).id) : sprout(doc, id);
        const [d1, d2] = sproutPair(doc, c.id);
        bondTo(doc, c, add(c, mul(d1, L)), 2, 'solid', 8);
        bondTo(doc, c, add(c, mul(d2, L)));
        return c.id;
      }
      case 'phenyl': {
        const base = deg >= 2 ? sprout(doc, id) : a;
        const ids = placeRing(doc, ringOnAtom(base, sproutDir(doc, base.id), 6, L), { aromatic: true, existing: [base.id], scale: a.s });
        return ids[0];
      }
      case 'wedge':
      case 'hashWedge': {
        const disp: BondDisplay = act;
        if (deg <= 1 || this.isAromaticAtom(id)) {
          const c = deg === 0 ? a : sprout(doc, id);
          return sprout(doc, c.id, 1, disp).id;
        }
        return sprout(doc, id, 1, disp).id;
      }
      case 'cyclohexane':
      case 'cyclopentane':
      case 'cyclopropane':
      case 'cyclobutane': {
        const n = act === 'cyclohexane' ? 6 : act === 'cyclopentane' ? 5 : act === 'cyclobutane' ? 4 : 3;
        const base = aromaticOrTertiary || act === 'cyclopropane' || act === 'cyclobutane' ? sprout(doc, id) : a;
        const ids = placeRing(doc, ringOnAtom(base, sproutDir(doc, base.id), n, L), { existing: [base.id], scale: a.s });
        return ids[0];
      }
      case 'methylidene': {
        const base = aromaticOrTertiary ? sprout(doc, id) : a;
        return sprout(doc, base.id, 2).id;
      }
      case 'dimethyl': {
        const base = deg >= 3 ? sprout(doc, id) : a;
        const [d1, d2] = sproutPair(doc, base.id);
        bondTo(doc, base, add(base, mul(d1, L)));
        bondTo(doc, base, add(base, mul(d2, L)));
        return base.id;
      }
      case 'tBu': {
        const c = sprout(doc, id);
        const dir = norm(sub(c, a));
        for (const ang of [0, 90, -90]) bondTo(doc, c, add(c, mul(fromAngle(angleOf(dir) + ang * DEG), L)));
        return c.id;
      }
      case 'alkyne': {
        const c1 = sprout(doc, id);
        const dir = norm(sub(c1, a));
        const c2 = bondTo(doc, c1, add(c1, mul(dir, L)), 3);
        return c2.id;
      }
      case 'plus': doc.updateAtom(id, { charge: a.charge + 1 }); return null;
      case 'minus': doc.updateAtom(id, { charge: a.charge - 1 }); return null;
      case 'clear': {
        if (a.label || a.z !== 6 || a.charge) doc.updateAtom(id, { label: null, z: 6, charge: 0, fileLabel: false });
        else doc.removeAtom(id);
        return null;
      }
      default: return null;
    }
  }

  private isAromaticAtom(id: number): boolean {
    const doc = this.doc;
    let dbl = false, ring = false;
    for (const bid of doc.adj.get(id) ?? []) {
      const b = doc.bonds.get(bid)!;
      if (b.order === 2 || b.order === 1.5) {
        if (doc.ringThroughBond(bid, 6)?.length === 6) { dbl = true; ring = true; }
      }
    }
    return dbl && ring;
  }

  /** Apply a bond hotkey. */
  bondKey(id: number, key: string): boolean {
    const doc = this.doc;
    const b = doc.bonds.get(id);
    if (!b) return false;
    const act = BOND_KEYS[key];
    if (!act) return false;
    if (act === 'select') { this.sel = emptySel(); this.addToSel({ kind: 'bond', id }); this.requestOverlay(); this.onChange(); return false; }
    doc.edit('Bond hotkey', () => {
      if (act === 'delete') { this.removeBondAndOrphans(id); return; }
      if ('set' in act) {
        const patch: Partial<Bond> = {};
        if (act.set.order !== undefined) patch.order = act.set.order;
        if (act.set.display !== undefined) patch.display = act.set.display as BondDisplay;
        if (act.set.dpos !== undefined) {
          patch.dpos = act.set.dpos as Bond['dpos'];
          if (b.order !== 2) patch.order = 2;
        }
        doc.updateBond(id, patch);
      } else if ('flip' in act) {
        if (b.display === act.flip) doc.updateBond(id, { a1: b.a2, a2: b.a1 });
        else doc.updateBond(id, { order: 1, display: act.flip });
      } else if ('fuse' in act) {
        const side = fuseSide(doc, b, act.fuse, this.pointer);
        const pts = fusedRing(doc.atoms.get(b.a1)!, doc.atoms.get(b.a2)!, act.fuse, side);
        placeRing(doc, pts, { aromatic: act.aromatic, existing: [b.a1, b.a2], scale: b.s });
      }
    });
    this.lastEdited = b.a1;
    return true;
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
        const bos = doc.bondOrderSum(id);
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

  private newCaption(p: Vec): void {
    this.textBox(p, '', (text) => {
      if (!text.trim()) return;
      this.doc.edit('Caption', () => this.doc.addCaption({ x: p.x, y: p.y, runs: [{ text, formula: true }], justify: 'left' }));
      this.changed();
    });
  }

  private editCaption(id: number): void {
    const c = this.doc.captions.get(id);
    if (!c) return;
    const text = c.runs.map((r) => r.text).join('');
    this.textBox({ x: c.x, y: c.y }, text, (t) => {
      this.doc.edit('Caption', () => {
        if (!t.trim()) this.doc.removeCaption(id);
        // plain-text editing for now: keeps the first run's style
        else this.doc.updateCaption(id, { runs: [{ ...c.runs[0], text: t }] });
      });
      this.changed();
    });
  }

  private textBox(p: Vec, initial: string, done: (text: string) => void): void {
    const ta = document.createElement('textarea');
    ta.className = 'caption-input';
    const sp = this.r.toScreen(p);
    const size = this.doc.style.captionSize * this.r.view.scale;
    ta.style.left = `${sp.x}px`;
    ta.style.top = `${sp.y - size}px`;
    ta.style.fontSize = `${Math.max(11, size)}px`;
    ta.value = initial;
    this.host.appendChild(ta);
    ta.focus();
    let closed = false;
    const finish = (ok: boolean) => {
      if (closed) return;
      closed = true;
      ta.remove();
      if (ok) done(ta.value);
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
      e.stopPropagation();
    });
    ta.addEventListener('blur', () => finish(true));
  }

  // ------------------------------------------------------------------ overlay

  private drawOverlay(): void {
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
      for (const id of s.shapes) { const sh = doc.shapes.get(id); if (sh) outlineShape(ctx, sh); }
    }
    // hotspot
    const h = this.drag?.mode === 'move' ? null : this.hotspot();
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
          ctx.fillStyle = '#19a34a';
          ctx.beginPath();
          ctx.arc(a.x, a.y, Math.max(0.7, 1.6 * px), 0, Math.PI * 2);
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
    // handles on selected arrows and shapes
    const handles = this.drag?.mode === 'move' ? [] : this.handles();
    if (handles.length) {
      const k = 3.5 * px;
      ctx.lineWidth = px;
      ctx.strokeStyle = PREVIEW;
      ctx.fillStyle = '#fff';
      for (const hd of handles) {
        ctx.beginPath();
        if (hd.which === 'mid') ctx.arc(hd.at.x, hd.at.y, k * 1.1, 0, Math.PI * 2);
        else ctx.rect(hd.at.x - k, hd.at.y - k, 2 * k, 2 * k);
        ctx.fill();
        ctx.stroke();
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
    if (t.kind === 'bond') {
      const end = this.snapEnd(start, d.last, L, startAtom?.id);
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
      const end = this.arrowEnd(d.start, d.last, d.alt);
      const sweep = (t.style.sweep ?? 0) * this.bendSide(d, end);
      poly(arrowPoints({ tail: d.start, head: end, sweep }), false);
    } else if (t.kind === 'shape') {
      const g = this.shapeGeometry(t, d.start, d.last, d.shift, d.alt);
      if (g) outlineShape(ctx, { id: 0, ...t.shape, ...g });
    } else if (t.kind === 'bracket') {
      const r = { x1: Math.min(d.start.x, d.last.x), y1: Math.min(d.start.y, d.last.y), x2: Math.max(d.start.x, d.last.x), y2: Math.max(d.start.y, d.last.y) };
      for (const b of bracketsAround(r, t.bracket)) outlineShape(ctx, { id: 0, ...b });
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
    default: ctx.rect(x, y, w, h); ctx.fill(); return;
  }
  if (s.filled) ctx.fill(); else ctx.stroke();
}

function sameHit(a: Hit, b: Hit): boolean {
  return a === b || (!!a && !!b && a.kind === b.kind && a.id === b.id);
}

export { MERGE_FRACTION, atomAt };
