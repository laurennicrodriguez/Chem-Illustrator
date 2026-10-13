// The Style panel: shows how the selected arrows, shapes and captions look, and changes them.
// Anything the drawing tools set automatically can be changed here by hand.

import { Doc, Arrow, Shape, Caption } from '../model';
import { Selection } from '../editor/editor';
import { DEG } from '../geom';
import { isCircle } from '../objects';

type Opt<T> = [T, string];

const HEADS: Opt<Arrow['headStyle']>[] = [['none', 'None'], ['full', 'Full'], ['halfLeft', 'Half, left side'], ['halfRight', 'Half, right side']];
const HEAD_TYPES: Opt<Arrow['headType']>[] = [['solid', 'Solid'], ['hollow', 'Hollow'], ['angle', 'Open']];
const LINES: Opt<Arrow['line']>[] = [['solid', 'Solid'], ['dashed', 'Dashed'], ['bold', 'Bold'], ['wavy', 'Wavy']];
const SHAFTS: Opt<string>[] = [['one', 'One line'], ['equilibrium', 'Equilibrium (two half arrows)'], ['retro', 'Retrosynthetic (double line)']];
const BRACKETS: Opt<NonNullable<Shape['bracket']>>[] = [['square', 'Square [ ]'], ['round', 'Round ( )'], ['curly', 'Curly { }']];
const JUSTIFY: Opt<Caption['justify']>[] = [['left', 'Left'], ['center', 'Centre'], ['right', 'Right']];

const round = (x: number, k = 100) => Math.round(x * k) / k;

export class StylePanel {
  private key = '';

  constructor(private section: HTMLElement, private body: HTMLElement, private doc: Doc, private sel: () => Selection, private changed: () => void) {}

  /** Redraw the panel for the current selection, keeping the focus on the same control. */
  refresh(): void {
    const s = this.sel();
    const key = `${this.doc.version}|${[...s.arrows].join(',')}|${[...s.shapes].join(',')}|${[...s.captions].join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const focused = this.body.contains(document.activeElement) ? document.activeElement!.closest('.style-row')?.textContent : null;
    this.body.textContent = '';
    const arrows = [...s.arrows].map((id) => this.doc.arrows.get(id)).filter((x): x is Arrow => !!x);
    const shapes = [...s.shapes].map((id) => this.doc.shapes.get(id)).filter((x): x is Shape => !!x && !x.picture);
    const caps = [...s.captions].map((id) => this.doc.captions.get(id)).filter((x): x is Caption => !!x);
    this.section.hidden = !arrows.length && !shapes.length && !caps.length;
    if (arrows.length) this.arrowControls(arrows);
    if (shapes.length) this.shapeControls(shapes);
    if (caps.length) this.captionControls(caps);
    if (focused) [...this.body.querySelectorAll<HTMLElement>('.style-row')].find((r) => r.textContent === focused)?.querySelector<HTMLElement>('select, input')?.focus();
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
      if (v === 'equilibrium') return { equilibrium: true, shaftSpacing: undefined, headStyle: 'halfLeft', tailStyle: 'halfLeft', headType: 'solid', sweep: 0 };
      if (v === 'retro') return { equilibrium: false, shaftSpacing: w * 6, headStyle: 'full', tailStyle: 'none', headType: 'angle', headLength: w * 6, headWidth: w * 1.5, sweep: 0 };
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
      this.number('Curve (°)', round(r.sweep / DEG, 1), 5, -330, 330, (v) => set('Bend arrow', () => ({ sweep: v * DEG })),
        'Positive bends to the left of the arrow’s direction, negative to the right; 0 is straight.');
    }
    this.number('Head length (pt)', round(r.headLength), 0.5, 0, 100, (v) => set('Arrowhead size', () => ({ headLength: v })));
    this.number('Head width (pt)', round(r.headWidth), 0.25, 0, 100, (v) => set('Arrowhead size', () => ({ headWidth: v })));
    this.number('Line width (pt)', round(r.lineWidth ?? lw), 0.1, 0.1, 20, (v) => set('Arrow line width', () => ({ lineWidth: Math.abs(v - lw) < 1e-9 ? undefined : v })));
    this.color('Colour', r.color, (v) => set('Arrow colour', () => ({ color: v })));
  }

  // ------------------------------------------------------------------ shapes

  private shapeControls(shapes: Shape[]): void {
    const s = shapes[0];
    const lw = this.doc.style.lineWidth;
    const set = (label: string, ok: (x: Shape) => boolean, patch: (x: Shape) => Partial<Shape>) =>
      this.edit(label, () => { for (const x of shapes) if (ok(x)) this.doc.updateShape(x.id, patch(x)); });
    const any = (f: (x: Shape) => boolean) => shapes.find(f);
    const names: Record<Shape['kind'], string> = { line: 'Line', rect: 'Box', oval: 'Oval', symbol: 'Symbol', bracket: 'Bracket' };
    this.heading(shapes.length > 1 ? `${shapes.length} shapes` : isCircle(s) ? 'Circle' : names[s.kind]);
    const lined = (x: Shape) => x.kind !== 'symbol';
    const l = any(lined);
    if (l) {
      this.check('Dashed', !!l.dashed, (v) => set('Dashed', lined, () => ({ dashed: v })));
      this.check('Bold', !!l.bold, (v) => set('Bold', lined, () => ({ bold: v })));
    }
    const fillable = (x: Shape) => x.kind === 'rect' || x.kind === 'oval';
    const f = any(fillable);
    if (f) this.check('Filled', !!f.filled, (v) => set('Fill', fillable, () => ({ filled: v })));
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
    this.color('Colour', s.color, (v) => set('Colour', () => true, () => ({ color: v })));
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
    this.select('Line up', JUSTIFY, c.justify, (v) => set('Justification', () => ({ justify: v })));
    this.color('Colour', c.runs[0]?.color, (v) => set('Text colour', (x) => ({ runs: x.runs.map((r) => ({ ...r, color: v })) })));
  }

  // ------------------------------------------------------------------ building blocks

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

  private check(label: string, value: boolean, on: (v: boolean) => void): void {
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = value;
    box.addEventListener('change', () => on(box.checked));
    const l = document.createElement('label');
    l.className = 'style-row check';
    const span = document.createElement('span');
    span.textContent = label;
    l.append(box, span);
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

  private color(label: string, value: string | undefined, on: (v: string | undefined) => void): void {
    const inp = document.createElement('input');
    inp.type = 'color';
    inp.value = value ?? '#000000';
    inp.addEventListener('change', () => on(inp.value.toLowerCase() === '#000000' ? undefined : inp.value));
    this.row(label, inp);
  }
}
