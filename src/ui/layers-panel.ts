// The Layers panel (Design mode, in the right-hand panel): every shape, picture and table on the
// page, front to back. Click one to select it (Shift or Ctrl adds), drag it up or down to put it
// in front of or behind others, hide it, lock it so clicks pass through it, or double-click its
// name to rename it. Structures, text and arrows always sit above the shapes.

import type { Doc, Shape } from '../model';
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
}

/** The name a shape shows in the Layers panel: its own, or what it is (and the start of its text). */
export function layerName(s: Shape): string {
  if (s.name?.trim()) return s.name.trim();
  const kind = s.kind === 'geo' && s.geo === 'rect' && !s.filled && s.lineWidth === 0 ? 'Text' : s.kind === 'geo' ? geoDef(s.geo).name : s.kind === 'rect' ? 'Box' : s.kind === 'oval' ? 'Oval' : s.kind === 'picture' ? 'Picture'
    : s.kind === 'table' ? 'Table' : s.kind === 'line' ? 'Line' : s.kind === 'bracket' ? 'Bracket' : 'Symbol';
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

  constructor(private section: HTMLElement, private hooks: LayersHooks) {
    const h = document.createElement('h2');
    h.textContent = 'Layers';
    const note = document.createElement('p');
    note.className = 'muted small layers-note';
    note.textContent = 'Front at the top. Drag to reorder; double-click a name to rename.';
    this.list = document.createElement('div');
    this.list.className = 'layers-list';
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Layers');
    this.list.setAttribute('aria-multiselectable', 'true');
    section.replaceChildren(h, note, this.list);
  }

  show(doc: Doc | null): void {
    this.doc = doc;
    this.section.hidden = !doc;
    this.key = '';
    this.refresh();
  }

  /** Rebuild when the shapes or the selection changed (cheap to call every frame). */
  refresh(): void {
    const doc = this.doc;
    if (!doc || this.section.hidden) return;
    if (this.list.querySelector('input')) return; // renaming
    const sel = this.hooks.selected();
    const key = `${doc.version}|${sel.join(',')}`;
    if (key === this.key) return;
    this.key = key;
    const order = shapeOrder([...doc.shapes.values()]).reverse();
    const picked = new Set(sel);
    if (!order.length) {
      const p = document.createElement('p');
      p.className = 'muted';
      p.textContent = 'Shapes, pictures and tables on the page are listed here.';
      this.list.replaceChildren(p);
      return;
    }
    this.list.replaceChildren(...order.map((s, i) => this.row(s, i, order, picked)));
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
      const now = this.hooks.selected();
      if (e.shiftKey || e.ctrlKey || e.metaKey) this.hooks.select(now.includes(s.id) ? now.filter((x) => x !== s.id) : [...now, s.id]);
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
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'layer-rename';
    input.value = s.name ?? layerName(s);
    input.setAttribute('aria-label', 'Name');
    name.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      input.remove();
      this.key = '';
      if (keep && v !== (s.name ?? '')) this.hooks.edit('Rename', () => this.doc!.updateShape(s.id, { name: v || undefined }));
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
