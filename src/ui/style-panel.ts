// The Style panel: shows how the selected arrows, shapes and captions look, and changes them;
// the stereo labels of selected stereocentres and double bonds; and a single selected atom or
// bond (label, charge, atom number; order and style).
// Anything the drawing tools set automatically can be changed here by hand.

import { Doc, Arrow, Shape, Caption, Atom, Bond, PICTURE_STYLES, type PictureLook, type StepRoles, type Pattern, type AttachSide, type Attachment, type DescriptorKey, type HighlightEnds, type HighlightFill, type HighlightLine, type HighlightShape, type HighlightSoftSide, type HighlightStyle } from '../model';
import { fullStyle, tidyStyle } from '../render/highlight';
import type { HighlightLookPreset } from './highlight-looks';

export { tidyStyle };
import { DESCRIPTORS } from './analysis-panel';
import { COMMON_ADDUCTS } from '../chem/hrms';
import { PATTERNS, RING_FILL_COLOUR, RING_PATTERN_COLOUR, patternSpacing, ringShadowSize, shadowLook } from '../render/fills';
import type { Role } from '../chem/reaction';
import { setStereoShown, setStereoText } from '../chem/stereo';
import { arialWidth } from '../text-metrics';
import { Selection } from '../editor/editor';
import { DEG } from '../geom';
import { isCircle, cropTo, isCurved, headBend, swapHalf } from '../objects';
import { GEOS, geoDef } from '../design/geo';
import { nextNumber } from '../chem/sprouts';
import { ringFillsOn } from '../chem/ring-fill';
import { frameMembers } from '../editor/frames';
import { methylState, writeTerminalMethyls, type MethylStyle } from '../chem/hydrogens';
import type { TableData } from '../model';
import { deleteColumn, deleteRow, fitColumns, insertColumn, insertRow, setColumnAlign, setColumnWidth, setSpan, spanOf, type TablePart } from '../table';
import type { Measure } from '../text/layout';
import { colourButton } from './colour-picker';
import { centreEnd, haptoText, splitHapto } from '../chem/hapto';
import type { EnergyData } from '../design/energy';
import { DIAGRAM_COLOURS, DIAGRAM_LAYOUTS, type DiagramData } from '../design/diagrams';

/** What the table controls need from the editor. */
export interface TableHooks {
  /** The cell (or title or footnotes) last clicked or typed into. */
  part(): { id: number; part: TablePart } | null;
  setPart(p: { id: number; part: TablePart } | null): void;
  /** Change a table, keeping its size in step with its text. */
  update(id: number, t: TableData): void;
  /** Start typing into a part of a table. */
  edit(id: number, part: TablePart): void;
  measure: Measure;
}

/** What the Reaction controls need from the editor. */
export interface ReactionHooks {
  roles(arrowId: number): StepRoles | null;
  /** How many things other than arrows are selected. */
  others(): number;
  setRole(arrowId: number, role: Role | 'none'): void;
  reset(arrowId: number): void;
  select(arrowId: number, role: Role): void;
  cleanUp(): void;
  arrange(): void;
  /** The text above and below the arrow (the nearest line of each), as plain text. */
  sideText(arrowId: number): { above: string; below: string } | null;
  /** Set it: a new line of text if there is none, the nearest one changed, or removed when emptied. */
  setSideText(arrowId: number, side: 'above' | 'below', text: string): void;
}

type Opt<T> = [T, string];

const HEADS: Opt<Arrow['headStyle']>[] = [['none', 'None'], ['full', 'Full'], ['halfLeft', 'Half, left side'], ['halfRight', 'Half, right side']];
const HEAD_TYPES: Opt<Arrow['headType']>[] = [['solid', 'Solid'], ['hollow', 'Hollow'], ['angle', 'Open']];
const LINES: Opt<Arrow['line']>[] = [['solid', 'Solid'], ['dashed', 'Dashed'], ['bold', 'Bold'], ['wavy', 'Wavy']];
const SHAFTS: Opt<string>[] = [['one', 'One line'], ['equilibrium', 'Equilibrium (two half arrows)'], ['retro', 'Retrosynthetic (double line)']];
const BRACKETS: Opt<NonNullable<Shape['bracket']>>[] = [['square', 'Square [ ]'], ['round', 'Round ( )'], ['curly', 'Curly { }']];
const VALIGN: Opt<NonNullable<Shape['textValign']>>[] = [['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom']];
const HL_SHAPES: Opt<HighlightShape>[] = [['round', 'Round (discs and bands)'], ['straight', 'Straight (sharp corners, discs round labels)']];
const HL_ENDS: Opt<HighlightEnds>[] = [['round', 'Round'], ['square', 'Square'], ['pointed', 'Pointed']];
const HL_FILLS: Opt<HighlightFill>[] = [['solid', 'One colour'], ['linear', 'Gradient across'], ['edge', 'Gradient (bonds to edge)'], ['none', 'None (outline or texture only)']];
const HL_LINES: Opt<HighlightLine>[] = [['none', 'None'], ['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']];
const HL_SOFT_SIDES: Opt<HighlightSoftSide>[] = [['outer', 'At the outer edge'], ['inner', 'Inside (along the middle)'], ['both', 'Both (half each)']];
const SHADOW_DIRS: Opt<string>[] = [['45', 'Down and right'], ['90', 'Down'], ['135', 'Down and left'], ['0', 'Right'], ['180', 'Left'], ['-45', 'Up and right'], ['-90', 'Up'], ['-135', 'Up and left']];
/** The Style panel's folding groups that are open. */
const OPEN_GROUPS = new Set<string>();
const SIDES: Opt<AttachSide>[] = [['below', 'Below'], ['above', 'Above'], ['left', 'Left'], ['right', 'Right']];
const JUSTIFY: Opt<Caption['justify']>[] = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];
const TABLE_LINES: Opt<TableData['lines']>[] = [['acs', 'ACS style (rules above and below the headings, and at the end)'], ['grid', 'Every cell boxed'], ['none', 'None']];

const LABEL_DIRS: Opt<Atom['just']>[] = [['auto', 'Automatically (away from the bonds)'], ['right', 'To the right (OMe)'], ['left', 'To the left (MeO)']];

type Fill = 'none' | 'solid' | 'faded' | 'shaded' | 'gradient';
const FILLS: Opt<Fill>[] = [['none', 'None'], ['solid', 'Solid colour'], ['faded', 'Faded (light tint)'], ['shaded', 'Shaded (light to dark)'], ['gradient', 'Gradient (two colours)']];
const GRAD_DIRS: Opt<string>[] = [['90', 'Top to bottom'], ['270', 'Bottom to top'], ['0', 'Left to right'], ['180', 'Right to left'], ['45', 'Diagonal, top left to bottom right'], ['-45', 'Diagonal, bottom left to top right'], ['radial', 'Out from the middle']];
const PATTERN_OPTS: Opt<string>[] = [['none', 'None'], ...PATTERNS];

const BOND_ORDERS: Opt<string>[] = [['1', 'Single'], ['2', 'Double'], ['3', 'Triple'], ['1.5', 'Aromatic'], ['4', 'Quadruple'], ['0.5', 'Partial (transition state)']];
const BOND_STYLES: Opt<Bond['display']>[] = [['solid', 'Plain'], ['wedge', 'Wedge'], ['hashWedge', 'Hashed wedge'], ['hash', 'Hashed'], ['bold', 'Bold'], ['dash', 'Dashed'], ['wavy', 'Wavy'], ['dative', 'Dative (arrow to the acceptor)']];
const DOUBLE_POS: Opt<Bond['dpos']>[] = [['auto', 'Automatic'], ['left', 'Left'], ['center', 'Centred'], ['right', 'Right']];

const round = (x: number, k = 100) => Math.round(x * k) / k;

export class StylePanel {
  private key = '';

  /** Turns typed label text into a label (the editor's rules: "OH" is an O with its H, and so on). */
  applyLabel: (atomId: number, text: string) => void = () => {};
  /** Crop a picture with the mouse (its handles cut the edges off), or stop. */
  cropWithMouse: (shapeId: number) => void = () => {};
  /** Frames (set up by the app): add one round the selection, or fit a box round what is inside it. */
  frames: { add(): void; fit(shapeId: number): void } | null = null;
  /** A highlight colour was chosen (the app remembers it for Chemistry > Highlight and Fill > Highlight). */
  highlightUsed: (colour: string) => void = () => {};
  /** The look last chosen for highlights (new highlights take it). */
  highlightStyleUsed: (style: HighlightStyle) => void = () => {};
  /** Highlight looks (set up by the app): the ready-made and saved ones, giving the selection one, saving one. */
  highlightLooks: { list(): HighlightLookPreset[]; apply(look: HighlightLookPreset): void; save(): void } = { list: () => [], apply: () => {}, save: () => {} };
  /** Fill the rings in the selection (set up by the app). */
  ringFill: (() => void) | null = null;
  /** Make a picture's white background see-through (set up by the app). */
  removeWhite: (shapeIds: number[]) => void = () => {};
  /** A picture's width and height change together. */
  private keepProportions = true;
  /** Table commands (set up by the app). */
  tables: TableHooks | null = null;
  /** Reaction step commands (set up by the app). */
  reaction: ReactionHooks | null = null;
  /** Energy diagrams (set up by the app): open the window, or redraw with some settings changed. */
  energy: { edit(shapeId: number): void; restyle(shapeId: number, patch: Partial<EnergyData>): void } | null = null;
  /** SmartArt-style diagrams: the window with their text, a change of layout or look, and Convert to Shapes. */
  diagram: { edit(shapeId: number): void; restyle(shapeId: number, patch: Partial<DiagramData>): void; ungroup(shapeId: number): void } | null = null;
  /** Tie captions to the structure nearest each (Tie to Structure). */
  tie: ((captionIds: number[]) => void) | null = null;

  constructor(private section: HTMLElement, private body: HTMLElement, private doc: Doc, private sel: () => Selection, private changed: () => void) {}

  /** Redraw the panel for the current selection, keeping the focus on the same control. */
  refresh(force = false): void {
    if (force) this.key = '';
    const s = this.sel();
    const tp = this.tables?.part();
    const key = `${this.doc.version}|${this.doc.stereo?.version}|${tp ? JSON.stringify(tp) : ''}|${[...s.arrows].join(',')}|${[...s.shapes].join(',')}|${[...s.captions].join(',')}|${[...s.atoms].join(',')}|${[...s.bonds].join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const focused = this.body.contains(document.activeElement) ? document.activeElement!.closest('.style-row')?.textContent : null;
    this.body.textContent = '';
    const arrows = [...s.arrows].map((id) => this.doc.arrows.get(id)).filter((x): x is Arrow => !!x);
    const all = [...s.shapes].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x && !x.picture);
    const shapes = all.filter((x) => x.kind !== 'picture' && x.kind !== 'table' && x.kind !== 'ring'), pictures = all.filter((x) => x.kind === 'picture');
    // ring fills get their own section, with those on the selected structures and on the
    // structures inside selected frames, so they can be changed without picking them out
    const under = new Set(s.atoms);
    for (const x of all) if (x.frame) for (const id of frameMembers(this.doc, x.frame).atoms) under.add(id);
    const ringIds = new Set([...all.filter((x) => x.kind === 'ring').map((x) => x.id), ...ringFillsOn(this.doc, under)]);
    const rings = [...ringIds].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x);
    const tables = all.filter((x) => x.kind === 'table' && x.table);
    const caps = [...s.captions].map((id) => this.doc.captions.get(id)).filter((x): x is Caption => !!x);
    // stereocentres and E/Z double bonds among the selected atoms and bonds
    const info = this.doc.stereo;
    const centres = [...s.atoms].map((id) => this.doc.atoms.get(id)).filter((a): a is Atom => !!a && (!!info?.atom(a.id) || !!info?.undecided?.('a', a.id) || !!a.stereoLabel));
    const dbls = [...s.bonds].map((id) => this.doc.bonds.get(id)).filter((b): b is Bond => !!b && (!!info?.bond(b.id) || !!info?.undecided?.('b', b.id) || !!b.stereoLabel));
    // one atom or one bond on its own (as after / or ? over it)
    const atom = s.atoms.size === 1 && !s.bonds.size ? this.doc.atoms.get([...s.atoms][0]) : undefined;
    const bond = s.bonds.size === 1 && s.atoms.size <= 2 ? this.doc.bonds.get([...s.bonds][0]) : undefined;
    this.section.hidden = !arrows.length && !shapes.length && !rings.length && !pictures.length && !tables.length && !caps.length && !centres.length && !dbls.length && !atom && !bond;
    const selAtoms = [...s.atoms].map((id) => this.doc.atoms.get(id)).filter((a): a is Atom => !!a);
    const selBonds = [...s.bonds].map((id) => this.doc.bonds.get(id)).filter((b): b is Bond => !!b);
    const several = !atom && !bond && selAtoms.length + selBonds.length > 1;
    if (several) this.section.hidden = false;
    if (atom) this.atomControls(atom);
    if (bond) this.bondControls(bond);
    if (several) this.structureControls(selAtoms, selBonds);
    if (arrows.length) this.arrowControls(arrows);
    // an energy diagram is a frame drawn from its numbers: its own section, not a rectangle's
    const diagram = all.length === 1 && (all[0].energy || all[0].diagram) ? all[0] : undefined;
    if (diagram?.energy) this.energyControls(diagram);
    else if (diagram?.diagram) this.diagramControls(diagram);
    else if (shapes.length) this.shapeControls(shapes);
    if (rings.length) this.shapeControls(rings, rings.length > 1 ? `${rings.length} ring fills` : 'Ring fill');
    if (pictures.length) this.pictureControls(pictures);
    if (tables.length) this.tableControls(tables[0]);
    if (caps.length) this.captionControls(caps);
    if (centres.length || dbls.length) this.stereoControls(centres, dbls);
    const boxes = shapes.filter((x) => x.kind === 'rect' || x.kind === 'oval' || x.kind === 'geo');
    if (diagram) { /* the diagram keeps its own frame fitted */ }
    else if (boxes.length === 1 && all.length === 1 && !caps.length && !arrows.length && !s.atoms.size) this.frameControls(boxes[0]);
    else if (!this.section.hidden && this.frames) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Add frame';
      b.title = 'Draw a box round the selection that grows and moves with it (Chemistry > Labels and Numbers > Add Frame)';
      b.addEventListener('click', () => this.frames?.add());
      row.append(b);
      this.body.append(row);
    }
    if (focused) [...this.body.querySelectorAll<HTMLElement>('.style-row')].find((r) => r.textContent === focused)?.querySelector<HTMLElement>('select, input, textarea')?.focus();
  }

  // ------------------------------------------------------------------ arrows

  private arrowControls(arrows: Arrow[]): void {
    const r = arrows[0];
    const lw = this.doc.style.lineWidth;
    const set = (label: string, patch: (a: Arrow) => Partial<Arrow>) => this.edit(label, () => { for (const a of arrows) this.doc.updateArrow(a.id, patch(a)); });
    this.heading(arrows.length > 1 ? `${arrows.length} arrows` : 'Arrow');
    const shafts = r.equilibrium ? 'equilibrium' : r.shaftSpacing ? 'retro' : 'one';
    this.select('Shafts', SHAFTS, shafts, (v) => set('Arrow shafts', (a) => {
      const w = a.lineWidth ?? lw;
      if (v === 'equilibrium') return { equilibrium: true, shaftSpacing: undefined, headStyle: 'halfLeft', tailStyle: 'halfLeft', headType: 'solid', sweep: 0, bez: undefined };
      if (v === 'retro') return { equilibrium: false, shaftSpacing: w * 6, headStyle: 'full', tailStyle: 'none', headType: 'angle', headLength: w * 6, headWidth: w * 1.5, sweep: 0, bez: undefined };
      return { equilibrium: false, shaftSpacing: undefined, ...(a.equilibrium ? { headStyle: 'full', tailStyle: 'none' } : {}), ...(a.shaftSpacing ? { headType: 'solid', headLength: w * 10, headWidth: w * 2.5 } : {}) };
    }));
    if (!r.equilibrium) {
      this.select('Head', HEADS, r.headStyle, (v) => set('Arrowhead', () => ({ headStyle: v })));
      this.select('Tail', HEADS, r.tailStyle, (v) => set('Arrow tail', () => ({ tailStyle: v })));
    }
    this.select('Head shape', HEAD_TYPES, r.headType, (v) => set('Arrowhead shape', () => ({ headType: v })));
    this.select('Line', LINES, r.line, (v) => set('Arrow line', () => ({ line: v })));
    this.check('Crossed out (no reaction)', r.noGo, (v) => set('Crossed-out arrow', () => ({ noGo: v })));
    if (!r.equilibrium && !r.shaftSpacing) {
      this.check('Square bends (elbow)', !!r.elbow, (v) => set('Elbow connector', () => ({ elbow: v || undefined, sweep: 0, bez: undefined })));
    }
    if (r.from || r.to) {
      const loose = (a: Arrow) => ({ from: undefined, to: undefined } as Partial<Arrow>);
      this.note('Stuck to shapes: it follows them when they move.');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Unstick from shapes';
      b.title = 'Let the ends stay where they are when the shapes move';
      b.addEventListener('click', () => set('Unstick connector', loose));
      this.body.append(b);
    }
    if (r.pin) {
      this.note('Stuck to the structure: it follows it when it moves.');
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Unstick from structure';
      b.title = 'Let the ends stay where they are when the structure moves';
      b.addEventListener('click', () => set('Detach', () => ({ pin: undefined })));
      this.body.append(b);
    }
    if (!r.equilibrium && !r.shaftSpacing && !r.elbow && isCurved(r)) {
      // an S bends one way and then the other; its diamonds on the page shape it
      this.check('S-shaped (two bends)', !!r.bez?.length, (v) => set(v ? 'S-shaped arrow' : 'Single-curve arrow', (a) => {
        const side = a.bez?.length ? (a.bez[0].y >= 0 ? 1 : -1) : a.sweep > 0 ? -1 : 1;
        const patch: Partial<Arrow> = v ? { sweep: 0, bez: [{ x: 0.25, y: 0.8 * side }, { x: 0.75, y: -0.8 * side }] } : { bez: undefined, sweep: -side * 120 * DEG };
        if (headBend(a) !== headBend({ ...a, ...patch })) Object.assign(patch, { headStyle: swapHalf(a.headStyle), tailStyle: swapHalf(a.tailStyle) });
        return patch;
      }));
    }
    if (!r.equilibrium && !r.shaftSpacing && !r.elbow && !r.bez?.length) {
      this.number('Curve (°)', round(r.sweep / DEG, 1), 5, -330, 330, (v) => set('Bend arrow', () => ({ sweep: v * DEG })),
        'Positive bends to the left of the arrow’s direction, negative to the right; 0 is straight.');
    }
    this.number('Head length (pt)', round(r.headLength), 0.5, 0, 100, (v) => set('Arrowhead size', () => ({ headLength: v })));
    this.number('Head width (pt)', round(r.headWidth), 0.25, 0, 100, (v) => set('Arrowhead size', () => ({ headWidth: v })));
    this.number('Line width (pt)', round(r.lineWidth ?? lw), 0.1, 0.1, 20, (v) => set('Arrow line width', () => ({ lineWidth: Math.abs(v - lw) < 1e-9 ? undefined : v })));
    this.color('Colour', r.color, (v) => set('Arrow colour', () => ({ color: v })));
    if (arrows.length === 1) this.reactionControls(r);
  }

  /** A reaction arrow's step: what its starting materials, products and conditions are, and changing them. */
  private reactionControls(r: Arrow): void {
    const hooks = this.reaction;
    const roles = hooks?.roles(r.id);
    if (!hooks || !roles) return;
    this.heading('Reaction');
    // reagents and conditions typed straight in (the "+" boxes on the drawing do the same)
    const sides = hooks.sideText(r.id);
    if (sides) {
      for (const [side, label] of [['above', 'Above arrow'], ['below', 'Below arrow']] as const) {
        const ta = document.createElement('textarea');
        ta.rows = Math.min(4, Math.max(1, sides[side].split('\n').length));
        ta.value = sides[side];
        ta.placeholder = side === 'above' ? 'Reagents' : 'Solvent, temperature, time';
        ta.className = 'style-arrow-text';
        const set = () => { if (ta.value !== sides[side]) hooks.setSideText(r.id, side, ta.value); };
        ta.addEventListener('change', set);
        ta.addEventListener('keydown', (e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ta.blur(); }
        });
        ta.addEventListener('input', () => { ta.rows = Math.min(4, Math.max(1, ta.value.split('\n').length)); });
        this.row(label, ta, `Text ${side} the arrow. Enter sets it; Shift+Enter starts a new line. Formulas get their subscripts (H2O, Pd(PPh3)4); select the text on the drawing for other formatting.`);
      }
    }
    const names: [Role, string, string][] = [
      ['reactants', 'Starting materials', 'starting material'], ['products', 'Products', 'product'],
      ['above', 'Above the arrow', 'thing'], ['below', 'Below the arrow', 'thing'],
    ];
    const list = document.createElement('div');
    list.className = 'style-roles';
    for (const [k, label] of names) {
      const n = roles[k].length;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `role-${k}`;
      b.innerHTML = `<span class="role-dot"></span>${label}<span class="muted">${n || 'none'}</span>`;
      b.title = n ? `Select the ${label.toLowerCase()}` : `Nothing is ${label.toLowerCase()}`;
      b.disabled = !n;
      b.addEventListener('click', () => hooks.select(r.id, k));
      list.append(b);
    }
    this.body.appendChild(list);
    this.note(r.step?.manual ? 'Chosen by hand.' : r.step ? 'Kept with the arrow (from the file, or when it was last tidied).' : 'Worked out from where things sit.');
    if (hooks.others()) {
      const opts: Opt<string>[] = [['', 'Choose…'], ['reactants', 'Starting materials'], ['products', 'Products'], ['above', 'Above the arrow'], ['below', 'Below the arrow'], ['none', 'Not part of this step']];
      this.select('Selected things are', opts, '', (v) => { if (v) hooks.setRole(r.id, v as Role | 'none'); },);
    } else this.note('To change a role by hand, select the arrow and the things with Shift, then choose what they are here.');
    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const button = (text: string, title: string, on: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.addEventListener('click', on);
      buttons.append(btn);
    };
    button('Clean Up Reaction', 'Space this step evenly: starting materials and products in line with the arrow, conditions centred on it (Ctrl+Shift+R)', () => hooks.cleanUp());
    button('Arrange…', 'Lay the scheme out as a line, rows, a snake, down the page, a catalytic cycle or a branching tree', () => hooks.arrange());
    if (r.step) button('Work out again', 'Forget the kept roles and work them out from where things sit', () => hooks.reset(r.id));
    this.body.appendChild(buttons);
  }

  // ------------------------------------------------------------------ shapes

  private shapeControls(shapes: Shape[], title?: string): void {
    const s = shapes[0];
    const lw = this.doc.style.lineWidth;
    const set = (label: string, ok: (x: Shape) => boolean, patch: (x: Shape) => Partial<Shape>) =>
      this.edit(label, () => { for (const x of shapes) if (ok(x)) this.doc.updateShape(x.id, patch(x)); });
    const any = (f: (x: Shape) => boolean) => shapes.find(f);
    const names: Record<Shape['kind'], string> = { line: 'Line', rect: 'Box', oval: 'Oval', symbol: 'Symbol', bracket: 'Bracket', picture: 'Picture', table: 'Table', geo: 'Shape', ring: 'Ring fill' };
    this.heading(title ?? (shapes.length > 1 ? `${shapes.length} shapes` : isCircle(s) ? 'Circle' : s.kind === 'geo' ? geoDef(s.geo).name : names[s.kind]));
    const geo = any((x) => x.kind === 'geo');
    const isGeo = (x: Shape) => x.kind === 'geo';
    if (geo) {
      // another shape from the library, keeping the size, colours and text
      // (an icon is listed too, so it can be swapped for a shape and back)
      const own = geoDef(geo.geo);
      const opts = [...(own.icon ? [own] : []), ...GEOS].map((g): Opt<string> => [g.id, `${g.name} (${g.group.toLowerCase()})`]);
      this.select('Shape', opts, own.id, (v) => set('Change shape', isGeo, () => ({ geo: v })));
    }
    const lined = (x: Shape) => x.kind !== 'symbol' && x.kind !== 'ring';
    const l = any(lined);
    if (l) {
      this.check('Dashed', !!l.dashed, (v) => set('Dashed', lined, () => ({ dashed: v })));
      if (!geo) this.check('Bold', !!l.bold, (v) => set('Bold', lined, () => ({ bold: v })));
    }
    const fillable = (x: Shape) => x.kind === 'rect' || x.kind === 'oval' || x.kind === 'geo' || x.kind === 'ring';
    const f = any(fillable);
    if (f) {
      const now: Fill = !f.filled ? 'none' : f.fill ?? 'solid';
      this.select('Fill', FILLS, now, (v) => set('Fill', fillable, () => (v === 'none' ? { filled: false } : { filled: true, fill: v === 'solid' ? undefined : v })));
      // a ring fill has no line of its own: its colour unless chosen is the soft blue
      const ringOnly = shapes.every((x) => x.kind === 'ring');
      if (f.filled) {
        this.color(f.fill === 'gradient' ? 'From colour' : 'Fill colour', f.fillColor, (v) => set('Fill colour', fillable, (x) => (x.kind === 'ring' && !v ? { fillColor: undefined, color: undefined } : { fillColor: v })),
          ringOnly ? 'Soft blue' : 'Same as the line', ringOnly ? RING_FILL_COLOUR : f.color ?? '#000000');
      }
      if (f.filled && f.fill === 'gradient') {
        this.color('To colour', f.fill2, (v) => set('Gradient colour', fillable, () => ({ fill2: v })), 'White', '#ffffff');
        this.select('Direction', GRAD_DIRS, f.gradRadial ? 'radial' : String(f.gradAngle ?? 90), (v) => set('Gradient direction', fillable, () => (v === 'radial' ? { gradRadial: true } : { gradRadial: undefined, gradAngle: Number(v) })));
      }
      const see = any((x) => x.kind === 'geo' || x.kind === 'ring');
      if (f.filled && see) {
        const seeable = (x: Shape) => x.kind === 'geo' || x.kind === 'ring';
        this.number('See-through (%)', Math.round((see.transparency ?? 0) * 100), 5, 0, 100, (v) => set('Transparency', seeable, () => ({ transparency: v ? v / 100 : undefined })), 'How much shows through the fill: 0 is solid');
      }
      // hatching and stippling, over the fill or on their own
      this.select('Pattern', PATTERN_OPTS, f.pattern ?? 'none', (v) => set('Pattern', fillable, () => ({ pattern: v === 'none' ? undefined : (v as Pattern) })));
      if (f.pattern) {
        this.color('Pattern colour', f.patternColor, (v) => set('Pattern colour', fillable, () => ({ patternColor: v })),
          f.kind === 'ring' ? 'Light grey' : 'Same as the line', f.kind === 'ring' ? RING_PATTERN_COLOUR : f.color ?? '#000000');
        this.number('Pattern see-through (%)', Math.round((f.patternTransparency ?? 0) * 100), 5, 0, 100, (v) => set('Pattern transparency', fillable, () => ({ patternTransparency: v ? v / 100 : undefined })),
          'How much shows through the lines or dots: 0 is solid');
        this.number('Pattern spacing (pt)', round(patternSpacing(f)), 0.25, 0.5, 40, (v) => set('Pattern spacing', fillable, () => ({ patternSize: v })), 'How far apart the lines or dots are');
        const ring = any((x) => x.kind === 'ring' && !!x.pattern);
        if (ring) this.check('Pattern under double bonds', !ring.patternClear, (v) => set('Pattern under double bonds', (x) => x.kind === 'ring', () => ({ patternClear: v ? undefined : true })),
          'Run the lines or dots up to the bonds and under the double bonds; untick to keep them clear of the bonds and labels');
      }
    }
    // ring fills and design shapes: a drop shadow, with its colour, darkness, direction and blur folded away
    const shaded = (x: Shape) => x.kind === 'ring' || x.kind === 'geo';
    const sh = any(shaded);
    if (sh) {
      const dist = (x: Shape) => (x.kind === 'ring' ? ringShadowSize(x, this.doc.style.bondLength) : x.shadowSize ?? Math.max(2, 0.04 * Math.min(Math.abs(x.x2 - x.x1), Math.abs(x.y2 - x.y1))));
      const look = shadowLook(sh, dist(sh));
      this.group('Shadow', sh.shadow ? `${Math.round(look.opacity * 100)}%${look.blur ? ', blurred' : ''}` : 'off', () => {
        this.check('Shadow', !!sh.shadow, (v) => set(sh.kind === 'ring' ? 'Ring fill shadow' : 'Shadow', shaded, () => ({ shadow: v || undefined })), 'A drop shadow, down and to the right unless you choose another way');
        if (sh.shadow) this.shadowRows({ ...look }, 'pt', (p) => set('Shadow', shaded, () => ({
          ...(p.colour !== undefined ? { shadowColor: p.colour === '#000000' ? undefined : p.colour } : {}), ...(p.opacity !== undefined ? { shadowOpacity: p.opacity } : {}),
          ...(p.angle !== undefined ? { shadowAngle: p.angle === 45 ? undefined : p.angle } : {}), ...(p.distance !== undefined ? { shadowSize: p.distance } : {}), ...(p.blur !== undefined ? { shadowBlur: p.blur || undefined } : {}),
        })));
      });
    }
    if (geo) {
      this.number('Outline (pt)', round(geo.lineWidth ?? (geo.bold ? lw * 2.5 : lw)), 0.25, 0, 50, (v) => set('Outline width', isGeo, () => ({ lineWidth: v, bold: undefined })), '0 for no outline');
      this.select('Text across', JUSTIFY, geo.textAlign ?? 'center', (v) => set('Text alignment', isGeo, () => ({ textAlign: v === 'center' ? undefined : v })));
      this.select('Text up and down', VALIGN, geo.textValign ?? 'middle', (v) => set('Text alignment', isGeo, () => ({ textValign: v === 'middle' ? undefined : v })));
      this.note('Double-click the shape to type in it.');
    }
    const box = any((x) => x.kind === 'rect');
    if (box) {
      const isBox = (x: Shape) => x.kind === 'rect';
      this.check('Round corners', !!box.rounded, (v) => set('Round corners', isBox, () => ({ rounded: v })));
      if (box.rounded) this.number('Corner radius (pt)', round(box.radius ?? 6 * lw), 0.5, 0, 200, (v) => set('Corner radius', isBox, () => ({ radius: v })));
      this.check('Shadow', !!box.shadow, (v) => set('Shadow', isBox, () => ({ shadow: v })));
      if (box.shadow) this.number('Shadow size (pt)', round(box.shadowSize ?? 4 * lw), 0.5, 0, 100, (v) => set('Shadow size', isBox, () => ({ shadowSize: v })));
    }
    const br = any((x) => x.kind === 'bracket');
    if (br) this.select('Bracket', BRACKETS, br.bracket ?? 'square', (v) => set('Bracket shape', (x) => x.kind === 'bracket', () => ({ bracket: v })));
    // ring fills have no line, so no line colour (it only stood in for a fill colour that wasn't set)
    if (shapes.some((x) => x.kind !== 'ring')) this.color(f?.filled && f.fillColor ? 'Line colour' : 'Colour', s.color, (v) => set('Colour', (x) => x.kind !== 'ring', () => ({ color: v })));
  }

  // ------------------------------------------------------------------ energy diagrams

  /** An energy diagram: how it is drawn, and the window with its numbers. */
  private energyControls(sh: Shape): void {
    const d = sh.energy!;
    this.heading('Energy diagram');
    const set = (patch: Partial<EnergyData>) => this.energy?.restyle(sh.id, patch);
    this.select('Joined by', [['levels', 'Levels and dashed lines'], ['curve', 'A smooth curve']], d.style, (v) => set({ style: v as EnergyData['style'] }));
    this.check('Show the energies', d.values, (v) => set({ values: v }));
    this.check('Axis and its titles', d.axis, (v) => set({ axis: v }));
    this.check('Mark the largest barrier', d.barrier, (v) => set({ barrier: v }), 'A double arrow from the lowest point up to the highest after it, on each pathway');
    this.number('Decimal places', d.digits, 1, 0, 3, (v) => set({ digits: v }));
    const n = Math.max(...d.paths.map((p) => p.points.length));
    this.note(`${d.paths.length === 1 ? 'One pathway' : `${d.paths.length} pathways`} through ${n} species. Change the names and energies in the window; drag a corner to resize it. Anything you draw inside stays when it is redrawn.`);
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Energy Diagram…';
    b.title = 'Change the species, energies and pathways (or double-click the diagram)';
    b.addEventListener('click', () => this.energy?.edit(sh.id));
    row.append(b);
    this.body.append(row);
  }

  // ------------------------------------------------------------------ SmartArt-style diagrams

  /** A diagram: its layout and look, the window with its text, and Convert to Shapes. */
  private diagramControls(sh: Shape): void {
    const d = sh.diagram!;
    this.heading('Diagram');
    const set = (patch: Partial<DiagramData>) => this.diagram?.restyle(sh.id, patch);
    this.select('Layout', DIAGRAM_LAYOUTS.map((l) => [l.id, `${l.category}: ${l.name}`] as [string, string]), d.layout, (v) => set({ layout: v }));
    this.select('Colours', DIAGRAM_COLOURS, d.colours, (v) => set({ colours: v }));
    if (d.colours !== 'colourful' && d.colours !== 'mono' && d.colours !== 'grey') this.color('Accent colour', d.accent, (v) => set({ accent: v ?? '#4472c4' }), 'Blue', '#4472c4');
    this.check('Rounded corners', d.rounded, (v) => set({ rounded: v }));
    this.check('Shadow', d.shadow, (v) => set({ shadow: v }));
    this.check('Fit the text', d.size === undefined, (v) => set({ size: v ? undefined : 14 }), 'The text as big as fits, the same size in every shape; off, a size of your own');
    if (d.size !== undefined) this.number('Text size', d.size, 1, 4, 96, (v) => set({ size: v }));
    this.note('Double-click a shape to type in it, or change all the text in the window. Drag a corner to resize it: it is drawn again to fill the box.');
    const row = document.createElement('div');
    row.className = 'style-buttons';
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = 'Edit Diagram…';
    b.title = 'Change the text, one item per line (or double-click away from the words)';
    b.addEventListener('click', () => this.diagram?.edit(sh.id));
    const u = document.createElement('button');
    u.type = 'button';
    u.textContent = 'Convert to Shapes';
    u.title = 'Make it ordinary shapes and connectors, to change one by one (it is no longer drawn from its text)';
    u.addEventListener('click', () => this.diagram?.ungroup(sh.id));
    row.append(b, u);
    this.body.append(row);
  }

  // ------------------------------------------------------------------ frames

  /** A box: as a frame, the gap it keeps round what it surrounds and whether it follows them. */
  private frameControls(sh: Shape): void {
    const f = sh.frame;
    this.heading('Frame');
    if (!f) {
      this.note('Make this box a frame: it fits round what lies inside it, with a gap, and follows it from then on.');
    } else {
      const set = (label: string, patch: Partial<NonNullable<Shape['frame']>>) => this.edit(label, () => {
        const now = this.doc.shapes.get(sh.id)?.frame;
        if (now) this.doc.updateShape(sh.id, { frame: { ...now, ...patch } });
      });
      this.check('Fit round its contents', f.fit, (v) => (v ? this.frames?.fit(sh.id) : set('Stop fitting frame', { fit: false })));
      this.number('Gap across (pt)', round(f.padX, 10), 0.5, 0, 500, (v) => set('Frame gap', { padX: v }),
        'Space between the frame and what it surrounds, left and right.');
      this.number('Gap up and down (pt)', round(f.padY, 10), 0.5, 0, 500, (v) => set('Frame gap', { padY: v }),
        'Space between the frame and what it surrounds, above and below.');
      // each structure counts once, however many of its atoms were selected
      const seen = new Set<number>();
      let n = f.captions.length + f.arrows.length + f.shapes.length;
      for (const id of f.atoms) if (this.doc.atoms.has(id) && !seen.has(id)) { n++; for (const a of this.doc.fragmentOf(id)) seen.add(a); }
      this.note(`${f.fit ? 'Follows' : 'Surrounds'} ${n} ${n === 1 ? 'thing' : 'things'} (structures, text, arrows, shapes). Moving or resizing the frame by hand stops it fitting; tick the box to fit it again.`);
    }
    if (!f || !f.fit) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = f ? 'Fit now' : 'Fit round what is inside';
      b.addEventListener('click', () => this.frames?.fit(sh.id));
      row.append(b);
      this.body.append(row);
    }
  }

  // ------------------------------------------------------------------ pictures

  private pictureControls(pics: Shape[]): void {
    const p = pics[0];
    const set = (label: string, patch: (x: Shape) => Partial<Shape>) => this.edit(label, () => { for (const x of pics) this.doc.updateShape(x.id, patch(x)); });
    const box = (x: Shape) => ({ x1: Math.min(x.x1, x.x2), y1: Math.min(x.y1, x.y2), w: Math.abs(x.x2 - x.x1), h: Math.abs(x.y2 - x.y1) });
    this.heading(pics.length > 1 ? `${pics.length} pictures` : 'Picture');
    // vector pictures (SVG, Windows metafiles) have no pixels to count
    if (pics.length === 1 && p.video && p.px) this.note(`MP4 video, ${p.px.w} × ${p.px.h} pixels. It plays in the slide show and in PowerPoint.`);
    else if (pics.length === 1 && p.px) this.note(/^data:image\/(svg|x-emf)/.test(p.src ?? '') ? pictureType(p.src) : `${pictureType(p.src)}, ${p.px.w} × ${p.px.h} pixels`);
    // sizes change from the top left corner, as in PowerPoint's size boxes
    const size = (w: number | null, h: number | null) => set('Resize picture', (x) => {
      const b = box(x);
      let nw = w ?? b.w, nh = h ?? b.h;
      if (this.keepProportions && w !== null && h === null) nh = b.h * (w / b.w);
      if (this.keepProportions && h !== null && w === null) nw = b.w * (h / b.h);
      return { x1: b.x1, y1: b.y1, x2: b.x1 + nw, y2: b.y1 + nh };
    });
    const b = box(p);
    this.number('Width (pt)', round(b.w, 10), 1, 1, 20000, (v) => size(v, null));
    this.number('Height (pt)', round(b.h, 10), 1, 1, 20000, (v) => size(null, v));
    this.check('Keep proportions', this.keepProportions, (v) => { this.keepProportions = v; });
    const c = p.crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const sides: [keyof typeof c, string][] = [['l', 'Crop left (%)'], ['t', 'Crop top (%)'], ['r', 'Crop right (%)'], ['b', 'Crop bottom (%)']];
    for (const [k, label] of sides) {
      this.number(label, round(c[k] * 100, 10), 1, 0, 98, (v) => set('Crop picture', (x) => cropTo(x, { ...(x.crop ?? { l: 0, t: 0, r: 0, b: 0 }), [k]: v / 100 })),
        'How much of the picture is cut off on this side, as a percentage of its full width or height.');
    }
    this.pictureLook(pics);
    const buttons = document.createElement('div');
    buttons.className = 'style-buttons';
    const button = (text: string, title: string, on: () => void) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = text;
      btn.title = title;
      btn.addEventListener('click', on);
      buttons.append(btn);
    };
    if (pics.length === 1) button('Crop with mouse', 'Drag the black handles to cut the edges off; Esc when done', () => this.cropWithMouse(p.id));
    if (pics.some((x) => x.crop)) button('Uncrop', 'Show the whole picture again', () => set('Uncrop picture', (x) => cropTo(x, { l: 0, t: 0, r: 0, b: 0 })));
    // only pictures made of pixels have a background to take out
    const bitmaps = pics.filter((x) => x.src && !/^data:image\/(svg|x-emf|x-wmf)/.test(x.src));
    if (bitmaps.length) button('Remove white…', 'Make the white background see-through (a logo or a picture of a structure on white)', () => this.removeWhite(bitmaps.map((x) => x.id)));
    button('Original size', 'Its own size: 96 pixels to the inch, as in PowerPoint', () => set('Picture size', (x) => {
      const bx = box(x), cc = x.crop ?? { l: 0, t: 0, r: 0, b: 0 };
      if (!x.px) return {};
      return { x2: bx.x1 + x.px.w * 0.75 * (1 - cc.l - cc.r), y2: bx.y1 + x.px.h * 0.75 * (1 - cc.t - cc.b) };
    }));
    this.body.appendChild(buttons);
  }

  /** A picture's frame, corners and shadow: a ready-made style, then each part on its own. */
  private pictureLook(pics: Shape[]): void {
    const look = pics[0].look ?? {};
    const setLook = (label: string, patch: (l: PictureLook) => PictureLook | undefined) => this.edit(label, () => {
      for (const x of pics) {
        const next = patch({ ...(x.look ?? {}) });
        const tidy = next && Object.fromEntries(Object.entries(next).filter(([, v]) => v !== undefined && v !== 0)) as PictureLook;
        this.doc.updateShape(x.id, { look: tidy && Object.keys(tidy).length ? tidy : undefined });
      }
    });
    const same = (a: PictureLook | undefined, b: PictureLook | undefined) => JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
    const preset = PICTURE_STYLES.find((p) => same(p.look, pics[0].look))?.id ?? 'custom';
    const opts: Opt<string>[] = PICTURE_STYLES.map((p) => [p.id, p.name]);
    if (preset === 'custom') opts.push(['custom', 'Your own']);
    this.select('Frame style', opts, preset, (v) => {
      const p = PICTURE_STYLES.find((x) => x.id === v);
      if (p) setLook('Picture style', () => p.look && { ...p.look });
    });
    this.number('Frame line (pt)', look.line ?? 0, 0.5, 0, 72, (v) => setLook('Picture frame', (l) => ({ ...l, line: v })),
      'The width of the line round the picture; 0 for none.');
    if (look.line) this.color('Frame colour', look.lineColor, (v) => setLook('Picture frame colour', (l) => ({ ...l, lineColor: v ?? '#000000' })));
    this.number('Rounded corners (%)', round((look.round ?? 0) * 100, 10), 1, 0, 50, (v) => setLook('Rounded corners', (l) => ({ ...l, round: v / 100 })),
      'How round the corners are, as a percentage of the shorter side (50 makes a circle or a pill).');
    this.select<'none' | 'soft' | 'hard'>('Shadow', [['none', 'None'], ['soft', 'Soft'], ['hard', 'Hard']], look.shadow ?? 'none',
      (v) => setLook('Picture shadow', (l) => ({ ...l, shadow: v === 'none' ? undefined : v })));
  }

  // ------------------------------------------------------------------ tables

  private tableControls(s: Shape): void {
    const hooks = this.tables;
    const t = s.table!;
    if (!hooks) return;
    const set = (label: string, next: TableData, part?: TablePart | null) => this.edit(label, () => {
      hooks.update(s.id, next);
      if (part !== undefined) hooks.setPart(part ? { id: s.id, part } : null);
    });
    const cur = hooks.part();
    const part = cur?.id === s.id ? cur.part : null;
    const cell = part && typeof part !== 'string' && t.rows[part.r] && part.c < t.cols.length ? part : null;
    this.heading('Table');
    this.note(cell ? `Row ${cell.r + 1}, column ${cell.c + 1}${cell.r < t.head ? ' (a heading)' : ''}. Double-click a cell to type; Tab goes on to the next one.`
      : 'Click a cell to choose its row and column; double-click it to type.');
    const buttons = (list: [string, string, (() => void) | null][]) => {
      const box = document.createElement('div');
      box.className = 'style-buttons';
      for (const [text, title, on] of list) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = text;
        btn.title = title;
        btn.disabled = !on;
        if (on) btn.addEventListener('click', on);
        box.append(btn);
      }
      this.body.appendChild(box);
    };
    const r = cell?.r ?? t.rows.length - 1, c = cell?.c ?? t.cols.length - 1;
    buttons([
      ['Row above', 'Put a new row above this one', cell ? () => set('Add table row', insertRow(t, r), { r: r + 1, c }) : null],
      ['Row below', 'Put a new row below this one', () => set('Add table row', insertRow(t, r + 1), { r: r + 1, c })],
      ['Delete row', 'Take this row out', cell && t.rows.length > 1 ? () => set('Delete table row', deleteRow(t, r), { r: Math.min(r, t.rows.length - 2), c }) : null],
    ]);
    buttons([
      ['Column left', 'Put a new column to the left of this one', cell ? () => set('Add table column', insertColumn(t, c), { r, c: c + 1 }) : null],
      ['Column right', 'Put a new column to the right of this one', () => set('Add table column', insertColumn(t, c + 1), { r, c: c + 1 })],
      ['Delete column', 'Take this column out', cell && t.cols.length > 1 ? () => set('Delete table column', deleteColumn(t, c), { r, c: Math.min(c, t.cols.length - 2) }) : null],
    ]);
    this.number('Heading rows', t.head, 1, 0, t.rows.length, (v) => set('Table headings', { ...t, head: Math.round(v) }),
      'How many rows at the top are headings; in the ACS style a rule goes under them.');
    this.select('Lines', TABLE_LINES, t.lines, (v) => set('Table lines', { ...t, lines: v }));
    if (cell) {
      const colAlign = t.align?.[cell.c] ?? (cell.c === 0 ? 'left' : 'center');
      this.select('Column lines up', JUSTIFY, colAlign === 'justify' ? 'left' : colAlign, (v) => set('Column alignment', setColumnAlign(t, cell.c, v)));
      this.number('Column width (pt)', round(t.cols[cell.c], 10), 1, 4, 2000, (v) => set('Column width', setColumnWidth(t, cell.c, v)),
        'You can also drag the handle at the right of the text box while typing in a cell.');
      this.number('Cell spans (columns)', spanOf(t, cell.r, cell.c), 1, 1, t.cols.length - cell.c, (v) => set('Join table cells', setSpan(t, cell.r, cell.c, v)),
        'Join this cell with the ones to its right, for a heading over several columns.');
    }
    const size = t.size ?? this.doc.style.captionSize;
    this.number('Text size (pt)', round(size, 10), 0.5, 1, 200, (v) => set('Table text size', resizeTableText(t, v)),
      'Changes all the table’s text; the footnotes are set a little smaller. Double-click a cell to change part of it.');
    this.color('Line colour', s.color, (v) => this.edit('Table line colour', () => this.doc.updateShape(s.id, { color: v })));
    buttons([
      [t.title ? 'Edit title' : 'Add title', 'The title above the table, such as “Table 1. Optimization of the Reaction Conditions”', () => hooks.edit(s.id, 'title')],
      [t.notes ? 'Edit footnotes' : 'Add footnotes', 'Notes under the table, such as “a Isolated yield.”', () => hooks.edit(s.id, 'notes')],
    ]);
    buttons([
      ['Fit columns to text', 'Make each column as wide as its longest line', () => set('Fit table columns', fitColumns(t, hooks.measure, this.doc.style.captionSize))],
    ]);
  }

  // ------------------------------------------------------------------ captions

  private captionControls(caps: Caption[]): void {
    const c = caps[0];
    const def = this.doc.style.captionSize;
    const set = (label: string, patch: (x: Caption) => Partial<Caption>) => this.edit(label, () => { for (const x of caps) this.doc.updateCaption(x.id, patch(x)); });
    this.heading(caps.length > 1 ? `${caps.length} captions` : 'Caption');
    const size = c.runs[0]?.size ?? def;
    this.number('Text size (pt)', round(size, 10), 1, 1, 200, (v) => set('Text size', (x) => ({ runs: x.runs.map((r) => ({ ...r, size: v })) })),
      'Changes the whole caption; double-click a caption to change part of it.');
    const all = (k: 'bold' | 'italic' | 'formula') => caps.every((x) => x.runs.every((r) => r[k] || !r.text.trim()));
    const whole = (label: string, k: 'bold' | 'italic' | 'formula') =>
      this.check(label, all(k), (v) => set(label, (x) => ({ runs: x.runs.map((r) => ({ ...r, [k]: v || undefined, ...(k === 'formula' && v ? { sub: undefined, sup: undefined } : {}) })) })));
    whole('Bold', 'bold');
    whole('Italic', 'italic');
    whole('Formula style (CH₃, NH₄⁺)', 'formula');
    this.select('Line up', JUSTIFY, c.justify, (v) => set('Justification', () => ({ justify: v })));
    this.color('Colour', c.runs[0]?.color, (v) => set('Text colour', (x) => ({ runs: x.runs.map((r) => ({ ...r, color: v })) })));
    this.attachControls(caps);
  }

  /** Where a caption tied to a structure sits, what descriptors it shows; tie or untie it. */
  private attachControls(caps: Caption[]): void {
    const tied = caps.filter((x) => x.attach);
    const loose = caps.filter((x) => !x.attach);
    let row: HTMLDivElement | null = null;
    const button = (text: string, help: string, on: () => void) => {
      if (!row) { row = document.createElement('div'); row.className = 'style-buttons'; }
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = text;
      b.title = help;
      b.addEventListener('click', on);
      row.append(b);
      this.body.appendChild(row);
    };
    if (!tied.length) {
      if (this.tie) button('Tie to nearest structure', 'Keep this caption beside the structure nearest it: it follows when the structure moves', () => this.tie?.(loose.map((x) => x.id)));
      return;
    }
    const a = tied[0].attach!;
    const setA = (label: string, patch: (x: Attachment) => Partial<Attachment>) =>
      this.edit(label, () => { for (const x of tied) this.doc.updateCaption(x.id, { attach: { ...x.attach!, ...patch(x.attach!) } }); });
    this.heading(a.role === 'descriptors' ? 'Tied descriptors' : a.role === 'label' ? 'Tied ID label' : 'Tied to its structure');
    // text beside a structure lines up towards it; above and below, centred (Line up changes it back)
    this.select<AttachSide>('Sits', SIDES, a.side, (v) => this.edit('Caption side', () => {
      for (const x of tied) this.doc.updateCaption(x.id, { attach: { ...x.attach!, side: v, shift: 0 }, justify: v === 'right' ? 'left' : v === 'left' ? 'right' : 'center' });
    }));
    this.number('Gap (pt)', round(a.gap, 10), 0.5, -200, 500, (v) => setA('Caption gap', () => ({ gap: v })),
      'Space between the structure (with its atom labels) and the caption. You can also drag the caption.');
    this.number('Shift (pt)', round(a.shift, 10), 0.5, -1000, 1000, (v) => setA('Caption shift', () => ({ shift: v })),
      'How far off the middle of its side: across for below and above, down for left and right. 0 centres it.');
    const desc = tied.filter((x) => x.attach!.role === 'descriptors');
    if (desc.length) {
      const show = new Set<DescriptorKey>(desc[0].attach!.show ?? []);
      for (const d of DESCRIPTORS) {
        this.check(d.label, show.has(d.key), (v) => setA(`Show ${d.label.toLowerCase()}`, (x) => {
          if (x.role !== 'descriptors') return {};
          const now = new Set(x.show ?? []);
          if (v) now.add(d.key); else now.delete(d.key);
          // keep the usual order; the text is worked out again
          return { show: DESCRIPTORS.map((y) => y.key).filter((k) => now.has(k)), sig: undefined, keepText: undefined };
        }));
      }
      const ions: Opt<string>[] = COMMON_ADDUCTS.map((x) => [x, x]);
      const ion = desc[0].attach!.adduct ?? '[M+H]+';
      if (!COMMON_ADDUCTS.includes(ion)) ions.push([ion, ion]);
      this.select('Ion (m/z, HRMS)', ions, ion, (v) => setA('Ion', (x) => (x.role === 'descriptors' ? { adduct: v, sig: undefined, keepText: undefined } : {})));
      this.check('Update when the structure changes', !desc[0].attach!.keepText, (v) => setA(v ? 'Update descriptors' : 'Keep descriptor text', (x) => (x.role === 'descriptors' ? { keepText: v ? undefined : true, sig: v ? undefined : x.sig } : {})),
        'Turn off to keep the text as it is, for instance after typing over it by hand.');
    }
    button('Untie from structure', 'Leave the caption where it is as ordinary text: it no longer follows the structure', () =>
      this.edit('Untie caption', () => { for (const x of tied) this.doc.updateCaption(x.id, { attach: undefined }); }));
    if (loose.length && this.tie) button('Tie the others too', 'Tie the selected captions that are loose to the structure nearest each', () => this.tie?.(loose.map((x) => x.id)));
  }

  // ------------------------------------------------------------------ building blocks

  // ------------------------------------------------------------------ one atom, one bond

  private atomControls(a: Atom): void {
    const set = (label: string, patch: Partial<Atom>) => this.edit(label, () => this.doc.updateAtom(a.id, patch));
    if (a.multi) {
      this.heading(`Middle of ${a.multi.length === 2 ? 'a π-bond' : 'a ring'} (${haptoText(a.multi.length)})`);
      const note = document.createElement('p');
      note.className = 'muted';
      note.textContent = 'Where a metal\'s hapto bond ends. It stays in the middle of its atoms; delete it to remove the bond.';
      this.body.appendChild(note);
      return;
    }
    if (a.attach) {
      this.heading('Point of attachment');
      this.number('Number', a.attachNum ?? 0, 1, 0, 99, (v) => set('Attachment number', { attachNum: v || undefined }),
        'The number in the black diamond; 0 for none.');
      return;
    }
    this.heading('Atom');
    this.text('Label', a.label ?? '', a.z === 6 ? 'carbon (no label)' : 'automatic', (v) => this.edit('Label', () => this.applyLabel(a.id, v)),
      'Type a label (O, NH2, OTBS, CO2Et…); leave empty for a plain carbon.');
    this.number('Charge', a.charge, 1, -8, 8, (v) => set('Charge', { charge: v }));
    this.color('Colour', a.color, (v) => set('Atom colour', { color: v }));
    this.color('Highlight', a.highlight, (v) => { set(v ? 'Highlight' : 'Remove highlight', { highlight: v }); if (v) this.highlightUsed(v); }, 'None');
    this.highlightControls([a], []);
    if (a.label || a.z !== 6 || a.showCarbon) {
      this.select('Label runs', LABEL_DIRS, a.just, (v) => set('Label direction', { just: v }));
    }
    if (methylState(this.doc, [a.id]) !== 'none') this.methylControls([a.id]);
    else if (a.z === 6 && !a.label && this.doc.degree(a.id) > 0) {
      this.check('Show C and its H', !!a.showCarbon, (v) => set(v ? 'Show carbon' : 'Hide carbon', { showCarbon: v || undefined }));
    }
    this.check('Show atom number', !!a.showNumber, (v) => set(v ? 'Show atom number' : 'Hide atom number',
      v ? { showNumber: true, atomNumber: a.atomNumber || String(nextNumber(this.doc, a.id, (x) => x.atomNumber)) } : { showNumber: false }));
    if (a.showNumber || a.atomNumber) {
      this.text('Atom number', a.atomNumber ?? '', 'number', (v) => set('Atom number', { atomNumber: v.trim() || undefined, showNumber: !!v.trim() && a.showNumber }),
        'Any text: 1, 2a, C-7…');
    }
  }

  private bondControls(b: Bond): void {
    const set = (label: string, patch: Partial<Bond>) => this.edit(label, () => this.doc.updateBond(b.id, patch));
    const centre = centreEnd(this.doc, b);
    if (centre) {
      // a metal bonded to the middle of a ring or π-bond
      this.heading(`Hapto bond (${haptoText(centre.multi!.length)})`);
      this.select('Style', BOND_STYLES.filter(([v]) => v !== 'wedge' && v !== 'hashWedge'), b.display, (v) => set('Bond style', { display: v }));
      this.check('A line to each atom', !!b.spokes, (v) => set(v ? 'Hapto bond to each atom' : 'Hapto bond to the middle', { spokes: v || undefined }),
        'Draw a line from the metal to each atom of the ring or π-bond, instead of one line to its middle. ChemDraw shows it to the middle either way.');
      this.color('Colour', b.color, (v) => set('Bond colour', { color: v }));
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const split = document.createElement('button');
      split.type = 'button';
      split.textContent = 'Split into single bonds';
      split.title = 'Replace the hapto bond with an ordinary bond from the metal to each atom (σ bonds, or a κ chelate)';
      split.addEventListener('click', () => this.edit('Split hapto bond', () => { splitHapto(this.doc, b.id); }));
      row.append(split);
      this.body.appendChild(row);
      return;
    }
    this.heading('Bond');
    // a partial bond is drawn dashed (until another style is chosen)
    this.select('Order', BOND_ORDERS, String(b.order), (v) => set('Bond order', { order: Number(v), ...(Number(v) === 0.5 && b.display === 'solid' ? { display: 'dash' as const } : {}) }));
    this.select('Style', BOND_STYLES, b.display, (v) => set('Bond style', { display: v }));
    if (b.order === 2) this.select('Second line', DOUBLE_POS, b.dpos, (v) => set('Double bond position', { dpos: v }));
    this.color('Colour', b.color, (v) => set('Bond colour', { color: v }));
    this.color('Highlight', b.highlight, (v) => { set(v ? 'Highlight' : 'Remove highlight', { highlight: v }); if (v) this.highlightUsed(v); }, 'None');
    this.highlightControls([], [b]);
  }

  /**
   * How the highlight on these atoms and bonds is drawn: a saved look, its shape, smooth or
   * ends and size, then folded groups for placement, fill and texture, outline, soft edges,
   * shadow and glow (each saying in a word or two how it is set while folded).
   */
  private highlightControls(atoms: Atom[], bonds: Bond[]): void {
    const lit = [...atoms, ...bonds].filter((x) => x.highlight);
    if (!lit.length) return;
    const st = fullStyle(lit[0].hl);
    const set = (label: string, patch: HighlightStyle) => {
      this.edit(label, () => {
        for (const a of atoms) if (a.highlight) this.doc.updateAtom(a.id, { hl: tidyStyle({ ...a.hl, ...patch }) });
        for (const b of bonds) if (b.highlight) this.doc.updateBond(b.id, { hl: tidyStyle({ ...b.hl, ...patch }) });
      });
      this.highlightStyleUsed({ ...st, ...patch });
    };
    const pct = (x: number) => Math.round(x * 100);
    const looks = this.highlightLooks.list();
    if (looks.length) {
      this.select<string>('Look', [['', 'Choose a look…'], ...looks.map((l, i): Opt<string> => [String(i), l.name])], '', (v) => { if (v !== '') this.highlightLooks.apply(looks[Number(v)]); });
    }
    this.select<HighlightShape>('Highlight shape', HL_SHAPES, st.shape, (v) => set('Highlight shape', { shape: v }));
    // straight highlights are always one even band; round ones can have a disc on each atom
    if (st.shape === 'round') this.check('Smooth outline', st.smooth, (v) => set(v ? 'Smooth highlight' : 'Highlight with discs', { smooth: v }),
      'One even band along the bonds, with no disc bulging out at each atom (Chemistry > Highlight and Fill > Smooth Highlight).');
    else this.select<HighlightEnds>('Highlight ends', HL_ENDS, st.ends, (v) => set('Highlight ends', { ends: v }));
    this.number('Highlight size (%)', pct(st.size), 10, 20, 400, (v) => set('Highlight size', { size: v / 100 }),
      '100% is the usual size; larger for a bolder highlight.');

    this.group('Placement', [st.centre && 'centred', !st.fit && 'labels not held'].filter(Boolean).join(', ') || 'on the bonds', () => {
      this.check('Centre on double bonds', st.centre, (v) => set(v ? 'Centre highlight on double bonds' : 'Highlight on the bonds', { centre: v }),
        'Run the highlight midway between a double bond\'s two lines, and round a ring midway between the ring and its inner double-bond lines (Chemistry > Highlight and Fill > Centre Highlight on Double Bonds).');
      this.check('Grow round atom labels', st.fit, (v) => set(v ? 'Highlight round labels' : 'Highlight not round labels', { fit: v }),
        'Make the highlight under a labelled atom (Me, OTBS, CO2Et) big enough to hold its whole label.');
    });

    const fillName = HL_FILLS.find(([v]) => v === st.fill)![1].split(' (')[0];
    this.group('Fill and texture', [fillName, st.transparency > 0 && `${pct(st.transparency)}% see-through`, st.pattern !== 'none' && PATTERN_OPTS.find(([v]) => v === st.pattern)?.[1].split(' (')[0].toLowerCase()].filter(Boolean).join(', '), () => {
      this.select<HighlightFill>('Fill', HL_FILLS, st.fill, (v) => set('Highlight fill', { fill: v }));
      if (st.fill === 'linear' || st.fill === 'edge') {
        this.color(st.fill === 'edge' ? 'Colour at the edge' : 'Second colour', st.colour2 || undefined, (v) => set('Highlight gradient colour', { colour2: v ?? '' }), 'White', '#ffffff');
        if (st.fill === 'linear') {
          const dirs = GRAD_DIRS.filter(([v]) => v !== 'radial');
          this.select<string>('Direction', dirs.some(([v]) => v === String(st.gradAngle)) ? dirs : [...dirs, [String(st.gradAngle), `${st.gradAngle}°`]], String(st.gradAngle), (v) => set('Highlight gradient direction', { gradAngle: Number(v) }));
        }
      }
      this.number('See-through (%)', pct(st.transparency), 5, 0, 100, (v) => set('Highlight transparency', { transparency: v / 100 }), 'How much shows through the fill and texture: 0 is solid');
      this.select<string>('Texture', PATTERN_OPTS, st.pattern, (v) => set('Highlight texture', { pattern: v as HighlightStyle['pattern'] }));
      if (st.pattern !== 'none') {
        this.color('Texture colour', st.patternColour || undefined, (v) => set('Highlight texture colour', { patternColour: v ?? '' }), 'A darker shade', '#808080');
        this.number('Texture spacing (pt)', st.patternSize, 0.25, 0, 40, (v) => set('Highlight texture spacing', { patternSize: v }), 'How far apart the lines or dots are: 0 for the usual spacing');
      }
    });

    this.group('Outline', st.line === 'none' ? 'none' : HL_LINES.find(([v]) => v === st.line)![1].toLowerCase(), () => {
      this.select<HighlightLine>('Line round it', HL_LINES, st.line, (v) => set('Highlight outline', { line: v }));
      if (st.line !== 'none') {
        this.color('Line colour', st.lineColour || undefined, (v) => set('Highlight outline colour', { lineColour: v ?? '' }), 'A darker shade', '#808080');
        this.number('Line width (pt)', st.lineWidth, 0.25, 0.25, 10, (v) => set('Highlight outline width', { lineWidth: v }));
      }
      if (st.fill !== 'none') this.note('For an outline on its own, set Fill to None (Chemistry > Highlight and Fill > Outline-Only Highlight).');
    });

    this.group('Soft edges', st.soft ? `${pct(st.softAmount)}%, ${HL_SOFT_SIDES.find(([v]) => v === st.softSide)![1].split(' (')[0].toLowerCase()}` : 'off', () => {
      this.check('Soft edges', st.soft, (v) => set(v ? 'Soft highlight' : 'Sharp highlight', { soft: v }), 'Fade the highlight out instead of a sharp edge (Chemistry > Highlight and Fill > Soft Highlight Edges).');
      if (st.soft) {
        this.number('How much fades (%)', pct(st.softAmount), 5, 5, 100, (v) => set('Soft edge amount', { softAmount: v / 100 }),
          'How much of the band fades, measured from its edge in to its middle: 25% fades only the outer quarter');
        this.select<HighlightSoftSide>('Fades', HL_SOFT_SIDES, st.softSide, (v) => set('Soft edge side', { softSide: v }));
      }
    });

    this.group('Shadow', st.shadow ? `${pct(st.shadowOpacity)}%${st.shadowBlur > 0 ? ', blurred' : ''}` : 'off', () => {
      this.check('Shadow', st.shadow, (v) => set(v ? 'Highlight shadow' : 'No highlight shadow', { shadow: v }), 'A drop shadow under the highlight (Chemistry > Highlight and Fill > Highlight Shadow).');
      if (st.shadow) this.shadowRows(
        { colour: st.shadowColour, opacity: st.shadowOpacity, angle: st.shadowAngle, distance: pct(st.shadowDistance), blur: pct(st.shadowBlur) }, '% of a bond',
        (p) => set('Highlight shadow', {
          ...(p.colour !== undefined ? { shadowColour: p.colour } : {}), ...(p.opacity !== undefined ? { shadowOpacity: p.opacity } : {}), ...(p.angle !== undefined ? { shadowAngle: p.angle } : {}),
          ...(p.distance !== undefined ? { shadowDistance: p.distance / 100 } : {}), ...(p.blur !== undefined ? { shadowBlur: p.blur / 100 } : {}),
        }));
    });

    this.group('Glow', st.glow ? `${pct(st.glowSize)}%` : 'off', () => {
      this.check('Glow', st.glow, (v) => set(v ? 'Highlight glow' : 'No highlight glow', { glow: v }), 'A soft halo of colour round the outside (Chemistry > Highlight and Fill > Highlight Glow).');
      if (st.glow) {
        this.color('Glow colour', st.glowColour || undefined, (v) => set('Glow colour', { glowColour: v ?? '' }), 'The highlight\'s', '#ffe680');
        this.number('Glow size (% of a bond)', pct(st.glowSize), 1, 1, 200, (v) => set('Glow size', { glowSize: v / 100 }));
        this.number('Glow see-through (%)', pct(st.glowTransparency), 5, 0, 95, (v) => set('Glow transparency', { glowTransparency: v / 100 }));
      }
    });

    const row = document.createElement('div');
    row.className = 'style-buttons';
    const save = document.createElement('button');
    save.type = 'button';
    save.textContent = 'Save look…';
    save.title = 'Keep this highlight\'s look (and colour) under a name, to use again in any drawing (Chemistry > Highlight and Fill > Save Highlight Look)';
    save.addEventListener('click', () => this.highlightLooks.save());
    row.append(save);
    this.body.append(row);
  }

  /** A drop shadow's colour, darkness, direction, distance and blur (distance and blur in `unit`). */
  private shadowRows(now: { colour: string; opacity: number; angle: number; distance: number; blur: number }, unit: string, on: (patch: Partial<typeof now>) => void): void {
    this.color('Shadow colour', now.colour === '#000000' ? undefined : now.colour, (v) => on({ colour: v ?? '#000000' }), 'Black', '#000000');
    this.number('Darkness (%)', Math.round(now.opacity * 100), 5, 0, 100, (v) => on({ opacity: v / 100 }));
    const a = Math.round(now.angle);
    this.select<string>('Falls', SHADOW_DIRS.some(([v]) => Number(v) === a) ? SHADOW_DIRS : [...SHADOW_DIRS, [String(a), `${a}°`]], String(a), (v) => on({ angle: Number(v) }));
    this.number(`Distance (${unit})`, round(now.distance), unit === 'pt' ? 0.25 : 1, 0, unit === 'pt' ? 50 : 200, (v) => on({ distance: v }));
    this.number(`Blur (${unit})`, round(now.blur), unit === 'pt' ? 0.25 : 1, 0, unit === 'pt' ? 50 : 200, (v) => on({ blur: v }), 'How far the shadow fades out: 0 for a sharp shadow');
  }

  /** Settings that fold away under a title, with a word or two saying how they are set. */
  private group(title: string, state: string, fill: () => void): void {
    const d = document.createElement('details');
    d.className = 'style-group';
    d.open = OPEN_GROUPS.has(title);
    const sum = document.createElement('summary');
    const name = document.createElement('span');
    name.textContent = title;
    const st = document.createElement('span');
    st.className = 'style-group-state';
    st.textContent = state;
    sum.append(name, st);
    d.append(sum);
    // which groups are open is remembered (for the rest of the session), so a setting stays in view
    d.addEventListener('toggle', () => { if (d.open) OPEN_GROUPS.add(title); else OPEN_GROUPS.delete(title); });
    const body = this.body;
    this.body = d;
    try { fill(); } finally { this.body = body; }
    body.append(d);
  }

  /** Several atoms and bonds: their colour (labels and lines together). */
  private structureControls(atoms: Atom[], bonds: Bond[]): void {
    const parts = [atoms.length && `${atoms.length} atom${atoms.length > 1 ? 's' : ''}`, bonds.length && `${bonds.length} bond${bonds.length > 1 ? 's' : ''}`].filter(Boolean);
    this.heading(parts.join(', '));
    const first = atoms[0]?.color ?? bonds[0]?.color;
    this.color('Colour', first, (v) => this.edit('Colour', () => {
      for (const a of atoms) this.doc.updateAtom(a.id, { color: v });
      for (const b of bonds) this.doc.updateBond(b.id, { color: v });
    }));
    // a highlight picks out part of a structure: a disc under each atom and a band under each bond
    const hl = [...atoms, ...bonds].map((x) => x.highlight);
    this.color('Highlight', hl.every((c) => c === hl[0]) ? hl[0] : undefined, (v) => {
      this.edit(v ? 'Highlight' : 'Remove highlight', () => {
        for (const a of atoms) this.doc.updateAtom(a.id, { highlight: v });
        for (const b of bonds) this.doc.updateBond(b.id, { highlight: v });
      });
      if (v) this.highlightUsed(v);
    }, 'None');
    this.highlightControls(atoms, bonds);
    if (bonds.length >= 3 && this.ringFill) {
      const row = document.createElement('div');
      row.className = 'style-buttons';
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Fill rings';
      b.title = 'Colour in, shade or hatch the rings in the selection (Chemistry > Highlight and Fill > Fill Rings)';
      b.addEventListener('click', () => this.ringFill?.());
      row.append(b);
      this.body.append(row);
    }
    this.methylControls(atoms.map((a) => a.id));
  }

  /** Terminal methyls among these atoms: not written out, CH3 or Me (Chemistry > Show Terminal Methyls). */
  private methylControls(ids: number[]): void {
    // (no atoms would mean the whole drawing to the methyl commands)
    const now = ids.length ? methylState(this.doc, ids) : 'none';
    if (now === 'none') return;
    const opts: Opt<string>[] = [['hidden', 'Not written out'], ['CH3', 'CH3'], ['Me', 'Me']];
    if (now === 'mixed') opts.unshift(['mixed', 'Mixed']);
    this.select('Terminal methyls', opts, now, (v) => {
      if (v !== 'mixed') this.edit('Terminal Methyls', () => writeTerminalMethyls(this.doc, ids, v as MethylStyle | 'hidden'));
    });
  }

  // ------------------------------------------------------------------ stereo labels

  private stereoControls(centres: Atom[], dbls: Bond[]): void {
    const info = this.doc.stereo;
    const n = centres.length + dbls.length;
    this.heading(n > 1 ? 'Stereo labels' : centres.length ? 'Stereocentre' : 'Double bond');
    const found = [...centres.map((a) => info?.atom(a.id)), ...dbls.map((b) => info?.bond(b.id))].filter(Boolean);
    if (found.length) this.note(`Worked out: ${found.join(', ')}`);
    if (centres.some((a) => info?.undecided?.('a', a.id)) || dbls.some((b) => info?.undecided?.('b', b.id))) {
      this.note('An R, Ar or unreadable group decides the order here, so the CIP rules can’t give a label. Type one below if you want it.');
    }
    const shown = [...centres, ...dbls].every((x) => x.showStereo || x.stereoLabel);
    this.check('Show label on drawing', shown, (v) => this.edit(v ? 'Show stereo label' : 'Hide stereo label', () => setStereoShown(this.doc, centres.map((a) => a.id), dbls.map((b) => b.id), v)));
    if (n === 1) {
      const a = centres[0], b = dbls[0];
      const l = a ? a.stereoLabel : b.stereoLabel;
      const auto = a ? info?.atom(a.id) : info?.bond(b.id);
      this.text('Label text', l?.manual ? l.text : '', auto ? `(${auto}), worked out` : 'worked out', (v) => this.edit('Stereo label text', () => setStereoText(this.doc, a ? 'a' : 'b', a ? a.id : b.id, v, arialWidth)),
        'Type your own label (for example (R*) or rel-(S)); leave empty to show the worked-out one.');
    }
  }

  private note(text: string): void {
    const p = document.createElement('p');
    p.className = 'muted small';
    p.textContent = text;
    this.body.appendChild(p);
  }

  private text(label: string, value: string, placeholder: string, on: (v: string) => void, help?: string): void {
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.value = value;
    inp.placeholder = placeholder;
    inp.addEventListener('change', () => on(inp.value));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') inp.blur(); e.stopPropagation(); });
    this.row(label, inp, help);
  }

  private edit(label: string, fn: () => void): void {
    this.doc.edit(label, fn);
    this.key = '';
    this.changed();
  }

  private heading(text: string): void {
    const h = document.createElement('h3');
    h.textContent = text;
    this.body.appendChild(h);
  }

  private row(label: string, control: HTMLElement, help?: string): void {
    const l = document.createElement('label');
    l.className = 'style-row';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(span, control);
    if (help) l.title = help;
    this.body.appendChild(l);
  }

  private select<T extends string>(label: string, opts: Opt<T>[], value: T, on: (v: T) => void): void {
    const sel = document.createElement('select');
    for (const [v, text] of opts) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = text;
      sel.appendChild(o);
    }
    sel.value = value;
    sel.addEventListener('change', () => on(sel.value as T));
    this.row(label, sel);
  }

  private check(label: string, value: boolean, on: (v: boolean) => void, help?: string): void {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => on(box.checked));
    const l = document.createElement('label');
    l.className = 'style-row check';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(box, span);
    if (help) l.title = help;
    this.body.appendChild(l);
  }

  private number(label: string, value: number, step: number, min: number, max: number, on: (v: number) => void, help?: string): void {
    const inp = document.createElement('input');
    inp.type = 'number';
    inp.step = String(step);
    inp.min = String(min);
    inp.max = String(max);
    inp.value = String(value);
    const apply = () => {
      const v = Number(inp.value);
      if (inp.value.trim() !== '' && Number.isFinite(v)) on(Math.max(min, Math.min(max, v)));
    };
    inp.addEventListener('change', apply);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { apply(); inp.blur(); } e.stopPropagation(); });
    this.row(label, inp, help);
  }

  /** A colour row: the drawing's palette, "automatic" (black unless `auto` says otherwise), or any colour. */
  private color(label: string, value: string | undefined, on: (v: string | undefined) => void, auto?: string, autoSwatch?: string): void {
    this.row(label, colourButton(this.doc, value, (v) => on(v && v.toLowerCase() === '#000000' && !auto ? undefined : v), auto ? { autoLabel: auto, autoSwatch } : { autoSwatch: '#000000' }));
  }
}

/** A picture's kind, from its data, as people know it. */
function pictureType(src: string | undefined): string {
  const m = /^data:image\/([^;,]+)/.exec(src ?? '');
  const t = m?.[1] ?? '';
  return ({ png: 'PNG', jpeg: 'JPEG', gif: 'GIF', 'svg+xml': 'SVG (sharp at any size)', bmp: 'Bitmap', 'x-emf': 'Windows metafile (sharp at any size)', tiff: 'TIFF', webp: 'WebP' } as Record<string, string>)[t] ?? 'Picture';
}

/** A table with all its text at one size (runs that set their own size take the new one too). */
function resizeTableText(t: TableData, size: number): TableData {
  const plain = (runs: TextRunList) => runs.map((r) => { if (r.size === undefined) return r; const { size: _, ...rest } = r; return rest; });
  return {
    ...t,
    size,
    rows: t.rows.map((row) => row.map((cell) => ({ ...cell, runs: plain(cell.runs) }))),
    title: t.title && plain(t.title),
    notes: t.notes && plain(t.notes),
  };
}

type TextRunList = TableData['rows'][number][number]['runs'];

