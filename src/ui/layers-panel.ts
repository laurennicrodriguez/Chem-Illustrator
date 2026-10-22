// The Layers panel (Design mode, in the right-hand panel): every shape, picture and table on the
// page, front to back. Click one to select it (Shift or Ctrl adds), drag it up or down to put it
// in front of or behind others, hide it, lock it so clicks pass through it, or double-click its
// name to rename it. Structures, text and arrows always sit above the shapes.
//
// In Slides the same panel is PowerPoint's Selection Pane (Home > Selection Pane): it also lists
// the slide's text boxes (which can be hidden and renamed too), structures and arrows, front
// to back, with Show All and Hide All.

import type { Caption, Doc, Shape } from '../model';
import { plainText } from '../richtext';
import { shapeOrder } from '../objects';
import { geoDef } from '../design/geo';

const icon = (body: string) => `<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS = {
  shown: icon('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2"/>'),
  hidden: icon('<path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" opacity=".45"/><path d="M2.5 13.5l11-11"/>'),
  locked: icon('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2"/>'),
  unlocked: icon('<rect x="3.5" y="7" width="9" height="6.5" rx="1"/><path d="M5.5 7V5a2.5 2.5 0 0 1 4.9-.7"/>'),
};

export interface LayersHooks {
  select(ids: number[]): void;
  selected(): number[];
  /** Change shapes as one undoable step. */
  edit(label: string, f: () => void): void;
  /** Slides: select text boxes, structures (their atoms) and arrows too. */
  pick?(what: Picked): void;
  /** Slides: what is selected now. */
  picked?(): Picked;
}

/** What the Selection Pane selects: shapes, text boxes, the atoms of structures, arrows. */
export interface Picked { shapes: number[]; captions: number[]; atoms: number[]; arrows: number[] }

/** The name a text box shows in the Selection Pane: its own, or what it is and the start of its text. */
export function textBoxName(c: Caption): string {
  if (c.name?.trim()) return c.name.trim();
  const kind = c.ph === 'title' ? 'Title' : c.ph === 'subtitle' ? 'Subtitle' : c.ph ? 'Content Placeholder' : 'Text Box';
  const text = plainText(c.runs).replace(/\s+/g, ' ').trim();
  return text ? `${kind}: ${text.length > 24 ? text.slice(0, 23) + '…' : text}` : kind;
}

/** The name a shape shows in the Layers panel: its own, or what it is (and the start of its text). */
export function layerName(s: Shape): string {
  if (s.name?.trim()) return s.name.trim();
  const kind = s.kind === 'geo' && s.geo === 'rect' && !s.filled && s.lineWidth === 0 ? 'Text' : s.kind === 'geo' ? geoDef(s.geo).name : s.kind === 'rect' ? 'Box' : s.kind === 'oval' ? 'Oval' : s.kind === 'picture' ? 'Picture'
    : s.kind === 'table' ? 'Table' : s.kind === 'line' ? 'Line' : s.kind === 'bracket' ? 'Bracket' : s.kind === 'ring' ? 'Ring fill' : 'Symbol';
  const text = s.text?.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim();
  return text ? `${kind}: ${text.length > 24 ? text.slice(0, 23) + '…' : text}` : kind;
}

/** The shapes' new places (front of the list = front of the page) after moving `ids` to `to`. */
export function reorderLayers(frontToBack: number[], ids: number[], to: number): number[] {
  const moving = frontToBack.filter((id) => ids.includes(id));
  const rest = frontToBack.filter((id) => !ids.includes(id));
  // `to` counts places in the whole list; find where that is among the ones staying
  const before = frontToBack.slice(0, to).filter((id) => !ids.includes(id)).length;
  return [...rest.slice(0, before), ...moving, ...rest.slice(before)];
}

export class LayersPanel {
  private list: HTMLDivElement;
  private key = '';
  private doc: Doc | null = null;
  private heading: HTMLHeadingElement;
  private note: HTMLParagraphElement;
  private bar: HTMLDivElement;
  /** Slides' Selection Pane (text boxes, structures and arrows listed too) rather than Design's Layers. */
  private pane = false;
  /** Called when the Selection Pane's close button is pressed. */
  onClose: () => void = () => {};

  constructor(private section: HTMLElement, private hooks: LayersHooks) {
    this.heading = document.createElement('h2');
    this.heading.textContent = 'Layers';
    this.note = document.createElement('p');
    this.note.className = 'muted small layers-note';
    this.note.textContent = 'Front at the top. Drag to reorder; double-click a name to rename.';
    this.bar = document.createElement('div');
    this.bar.className = 'style-buttons layers-bar';
    const button = (text: string, title: string, f: () => void) => {
      const b = Object.assign(document.createElement('button'), { type: 'button', textContent: text, title });
      b.addEventListener('click', f);
      return b;
    };
    this.bar.append(
      button('Show All', 'Show every hidden object on the slide', () => this.showAll(false)),
      button('Hide All', 'Hide every picture, shape and text box on the slide (they stay in the file)', () => this.showAll(true)),
      button('Close', 'Close the Selection Pane', () => this.onClose()),
    );
    this.list = document.createElement('div');
    this.list.className = 'layers-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Layers');
    this.list.setAttribute('aria-multiselectable', 'true');
    section.replaceChildren(this.heading, this.note, this.bar, this.list);
  }

  /** Show the panel for a drawing: Design's Layers, or (with `pane`) Slides' Selection Pane. */
  show(doc: Doc | null, pane = false): void {
    this.doc = doc;
    this.pane = pane;
    this.section.hidden = !doc;
    this.heading.textContent = pane ? 'Selection Pane' : 'Layers';
    this.list.setAttribute('aria-label', pane ? 'Objects on the slide' : 'Layers');
    this.note.textContent = pane
      ? 'Front at the top. Click to select, the eye to hide; drag pictures and shapes to reorder; double-click a name to rename.'
      : 'Front at the top. Drag to reorder; double-click a name to rename.';
    this.bar.hidden = !pane;
    this.key = '';
    this.refresh();
  }

  /** Hide everything that can be hidden, or show it all again. */
  private showAll(hide: boolean): void {
    const doc = this.doc;
    if (!doc) return;
    const shapes = [...doc.shapes.values()].filter((x) => !!x.hidden !== hide && x.kind !== 'ring' && !x.pin);
    const caps = [...doc.captions.values()].filter((x) => !!x.hidden !== hide);
    if (!shapes.length && !caps.length) return;
    this.hooks.edit(hide ? 'Hide All' : 'Show All', () => {
      for (const x of shapes) doc.updateShape(x.id, { hidden: hide || undefined });
      for (const x of caps) doc.updateCaption(x.id, { hidden: hide || undefined });
    });
  }

  /** Rebuild when the shapes or the selection changed (cheap to call every frame). */
  refresh(): void {
    const doc = this.doc;
    if (!doc || this.section.hidden) return;
    if (this.list.querySelector('input')) return; // renaming
    const sel = this.hooks.selected();
    const now = this.pane ? this.hooks.picked?.() : undefined;
    const key = `${doc.version}|${sel.join(',')}|${now ? JSON.stringify(now) : ''}`;
    if (key === this.key) return;
    this.key = key;
    // an energy diagram's own lines are part of it, not layers of their own
    const parts = new Set<number>();
    for (const x of doc.shapes.values()) if (x.energy && x.frame) for (const id of x.frame.shapes) if (doc.shapes.get(id)?.kind === 'line') parts.add(id);
    // ring fills, lone pairs and charges belong to their structures
    const order = shapeOrder([...doc.shapes.values()].filter((x) => !parts.has(x.id) && !(this.pane && (x.kind === 'ring' || x.pin)))).reverse();
    const picked = new Set(sel);
    const top = this.pane ? this.topRows(doc, now) : [];
    if (!order.length && !top.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = this.pane ? 'Text boxes, structures, pictures and shapes on the slide are listed here.' : 'Shapes, pictures and tables on the page are listed here.';
      this.list.replaceChildren(p);
      return;
    }
    this.list.replaceChildren(...top, ...order.map((s, i) => this.row(s, i, order, picked)));
  }

  /**
   * The Selection Pane's rows above the pictures and shapes (text, structures and arrows are
   * always drawn over them): text boxes first, as they are frontmost, then structures and arrows.
   */
  private topRows(doc: Doc, now: Picked | undefined): HTMLElement[] {
    const picked = (k: keyof Picked, ids: number[]) => !!now && ids.length > 0 && ids.every((id) => now[k].includes(id));
    const rows: HTMLElement[] = [];
    for (const c of doc.captions.values()) {
      const row = this.plainRow(textBoxName(c), picked('captions', [c.id]), !!c.hidden, (add) => this.pick({ captions: [c.id] }, add));
      if (!c.hidden) row.dataset.caption = String(c.id);
      const name = row.querySelector<HTMLElement>('.layer-name')!;
      name.title = 'Double-click to rename';
      name.addEventListener('dblclick', () => this.renameText(c, name));
      row.append(this.toggle(c.hidden ? ICONS.hidden : ICONS.shown, c.hidden ? 'Show' : 'Hide', () => this.hooks.edit(c.hidden ? 'Show' : 'Hide', () => this.doc!.updateCaption(c.id, { hidden: c.hidden ? undefined : true }))));
      rows.push(row);
    }
    // structures, top to bottom as they sit on the slide
    const frags = doc.fragments().map((f) => [...f]).filter((f) => f.length)
      .map((f) => ({ ids: f, y: Math.min(...f.map((id) => doc.atoms.get(id)!.y)) })).sort((a, b) => a.y - b.y);
    frags.forEach((f, i) => rows.push(this.plainRow(`Structure ${i + 1}${f.ids.length > 1 ? '' : ' (one atom)'}`, picked('atoms', f.ids), false, (add) => this.pick({ atoms: f.ids }, add))));
    let n = 0;
    for (const r of doc.arrows.values()) rows.push(this.plainRow(`Arrow ${++n}`, picked('arrows', [r.id]), false, (add) => this.pick({ arrows: [r.id] }, add)));
    return rows;
  }

  /** A row that is not a picture or shape: no grip (it can't move behind shapes) and no lock. */
  private plainRow(label: string, on: boolean, hidden: boolean, click: (add: boolean) => void): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(on));
    row.classList.toggle('picked', on);
    row.classList.toggle('is-hidden', hidden);
    const grip = document.createElement('span');
    grip.className = 'layer-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.style.visibility = 'hidden';
    grip.textContent = '⋮⋮';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = label;
    row.append(grip, name);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button') || hidden) return;
      click(e.shiftKey || e.ctrlKey || e.metaKey);
    });
    return row;
  }

  /** Select something from a row (adding to what is selected with Shift or Ctrl). */
  private pick(what: Partial<Picked>, add: boolean): void {
    const empty: Picked = { shapes: [], captions: [], atoms: [], arrows: [] };
    const base = add ? this.hooks.picked?.() ?? empty : empty;
    const out: Picked = { shapes: [...base.shapes], captions: [...base.captions], atoms: [...base.atoms], arrows: [...base.arrows] };
    for (const k of Object.keys(what) as (keyof Picked)[]) {
      const ids = what[k]!;
      const has = ids.every((id) => out[k].includes(id));
      out[k] = add && has ? out[k].filter((id) => !ids.includes(id)) : [...new Set([...out[k], ...ids])];
    }
    this.hooks.pick?.(out);
  }

  private renameText(c: Caption, name: HTMLElement): void {
    this.renameWith(c.name ?? textBoxName(c), name, (v) => { if (v !== (c.name ?? '') && !(v === textBoxName(c) && !c.name)) this.hooks.edit('Rename', () => this.doc!.updateCaption(c.id, { name: v || undefined })); else this.refresh(); });
  }

  private row(s: Shape, index: number, order: Shape[], picked: Set<number>): HTMLElement {
    const row = document.createElement('div');
    row.className = 'layer';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', String(picked.has(s.id)));
    row.classList.toggle('picked', picked.has(s.id));
    row.classList.toggle('is-hidden', !!s.hidden);
    row.dataset.id = String(s.id);
    const grip = document.createElement('span');
    grip.className = 'layer-grip';
    grip.textContent = '⋮⋮';
    grip.title = 'Drag up or down to put it in front of or behind others';
    const name = document.createElement('span');
    name.className = 'layer-name';
    name.textContent = layerName(s);
    name.title = 'Double-click to rename';
    const eye = this.toggle(s.hidden ? ICONS.hidden : ICONS.shown, s.hidden ? 'Show' : 'Hide', () => this.hooks.edit(s.hidden ? 'Show' : 'Hide', () => this.doc!.updateShape(s.id, { hidden: s.hidden ? undefined : true })));
    const lock = this.toggle(s.locked ? ICONS.locked : ICONS.unlocked, s.locked ? 'Unlock (clicks pick it again)' : 'Lock (clicks pass through it)', () => this.hooks.edit(s.locked ? 'Unlock' : 'Lock', () => this.doc!.updateShape(s.id, { locked: s.locked ? undefined : true })));
    lock.classList.toggle('on', !!s.locked);
    row.append(grip, name, eye, lock);
    row.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('button')) return;
      if (s.hidden || s.locked) return;
      const add = e.shiftKey || e.ctrlKey || e.metaKey;
      if (this.pane && this.hooks.pick) { this.pick({ shapes: [s.id] }, add); return; }
      const now = this.hooks.selected();
      if (add) this.hooks.select(now.includes(s.id) ? now.filter((x) => x !== s.id) : [...now, s.id]);
      else this.hooks.select([s.id]);
    });
    name.addEventListener('dblclick', () => this.rename(s, name));
    grip.addEventListener('pointerdown', (e) => this.drag(e, row, s, index, order));
    return row;
  }

  private toggle(svg: string, title: string, f: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'layer-toggle';
    b.innerHTML = svg;
    b.title = title;
    b.setAttribute('aria-label', title);
    b.addEventListener('click', f);
    return b;
  }

  private rename(s: Shape, name: HTMLElement): void {
    this.renameWith(s.name ?? layerName(s), name, (v) => { if (v !== (s.name ?? '') && !(v === layerName(s) && !s.name)) this.hooks.edit('Rename', () => this.doc!.updateShape(s.id, { name: v || undefined })); else this.refresh(); });
  }

  /** Rename in place: a box over the name; Enter or leaving it keeps the new name (blank for the usual one), Esc doesn't. */
  private renameWith(value: string, name: HTMLElement, keep: (v: string) => void): void {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = value;
    input.setAttribute('aria-label', 'Name');
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      this.key = '';
      if (ok) keep(v);
      else this.refresh();
    };
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** Drag a row up or down: the picked shapes (or this one) move to where it is dropped. */
  private drag(e: PointerEvent, row: HTMLElement, s: Shape, from: number, order: Shape[]): void {
    if (e.button !== 0) return;
    e.preventDefault();
    const rows = [...this.list.querySelectorAll<HTMLElement>('.layer')];
    const startY = e.clientY;
    let to = from;
    let moved = false;
    const move = (ev: PointerEvent) => {
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dy) < 4) return;
      moved = true;
      row.classList.add('dragging');
      row.style.transform = `translateY(${dy}px)`;
      to = from;
      rows.forEach((o, i) => {
        if (o === row) return;
        const r = o.getBoundingClientRect(), m = r.top + r.height / 2;
        if (i < from && ev.clientY < m) to = Math.min(to, i);
        if (i > from && ev.clientY > m) to = Math.max(to, i + 1);
      });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      row.classList.remove('dragging');
      row.style.transform = '';
      if (!moved || to === from || to === from + 1) return;
      const sel = this.hooks.selected();
      const ids = sel.includes(s.id) ? sel : [s.id];
      const next = reorderLayers(order.map((x) => x.id), ids, to);
      // back to front: the first drawn gets the lowest place
      this.hooks.edit('Reorder', () => next.slice().reverse().forEach((id, i) => this.doc!.updateShape(id, { z: i + 1 })));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }
}
