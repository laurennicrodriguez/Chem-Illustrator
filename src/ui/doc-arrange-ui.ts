// Arrange in Document mode, as Word's (Layout > Arrange, Picture Format > Arrange): Position on
// the page, Rotate and Flip, Bring Forward and Send Backward, Group, and the Selection Pane that
// lists the figures floating on the pages to pick, rename, hide or group.

import type { DocFile } from '../document/doc-file';
import { floatOf, lookExtent, lookOf, type DocObject, type DocText, type Float } from '../document/document';
import {
  floatingIds, groupOf, grouped, objectName, placeName, positioned, restacked, stackOrder, turned, ungrouped, withFloats,
  POSITION_PLACES, type PositionPlace, type Restack, type Turn,
} from '../document/arrange';
import { ask } from './ask';
import { FloatBox } from './float-box';
import { popupMenu } from './sheet-view';

export interface DocArrangeHost {
  file(): DocFile | null;
  /** The figure picked on the page (or the one the caret is next to). */
  picked(): number | null;
  /** Pick a figure on the page and show it. */
  pick(id: number): void;
  /** Take a figure out of its line (Wrap Text), keeping where it shows. */
  float(id: number): void;
  flash(msg: string, ms?: number): void;
}

/** A ribbon button to open a box under, if it is showing (else the box opens at the right). */
const shown = (el: HTMLElement | null | undefined) => (el && el.offsetParent !== null ? el : null);

export class DocArrangeUI {
  private pane: FloatBox | null = null;
  /** The figures picked in the Selection Pane (Ctrl+click picks more, to group). */
  private chosen = new Set<number>();

  constructor(private host: DocArrangeHost) {}

  private update(t: DocText, kind: string): void {
    this.host.file()?.ed.update(t, kind);
    this.refresh();
  }

  private target(): number | null {
    const id = this.host.picked();
    const o = id !== null ? this.host.file()?.t.objects[id] : undefined;
    if (id === null || !o || (o.kind !== 'drawing' && o.kind !== 'picture' && o.kind !== 'textbox')) {
      this.host.flash('Click a structure, picture or text box first.');
      return null;
    }
    return id;
  }

  /** Position: in line with the text, or at one of nine places on the page with the text round it. */
  positionMenu(x: number, y: number): void {
    const id = this.target();
    if (id === null) return;
    popupMenu(x, y, [
      ['In Line with Text', () => this.toInline(id)],
      null,
      ...POSITION_PLACES.map((p): [string, () => void] => [`${placeName(p)}, Square Wrapping`, () => this.place(id, p)]),
    ]);
  }

  private toInline(id: number): void {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || !o || o.kind === 'textbox' || !floatOf(o)) return;
    this.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, float: undefined } as DocObject } }, 'Position');
  }

  private place(id: number, p: PositionPlace): void {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || !o) return;
    const placed = f.layout().objects.find((x) => x.id === id);
    const size = f.layout().sizes.get(id) ?? (placed ? { w: placed.w, h: placed.h } : null);
    if (!size) return;
    // the section the figure is in decides the margins (Word's Position is inside them)
    const page = (placed ? f.layout().pages[placed.page]?.setup : undefined) ?? f.t.page;
    const fl = positioned(floatOf(o), p, size, page, lookExtent(lookOf(o)));
    this.update({ ...f.t, objects: { ...f.t.objects, [id]: { ...o, float: fl } as DocObject } }, 'Position');
  }

  /** Rotate: a quarter right or left, flipped, or by any angle. */
  rotateMenu(x: number, y: number): void {
    const id = this.host.picked();
    const o = id !== null ? this.host.file()?.t.objects[id] : undefined;
    if (id === null || o?.kind !== 'picture') { this.host.flash('Click a picture first. (A structure turns in its drawing: double-click it.)'); return; }
    popupMenu(x, y, [
      ['Rotate Right 90°', () => this.turn(id, 'right')],
      ['Rotate Left 90°', () => this.turn(id, 'left')],
      ['Flip Vertical', () => this.turn(id, 'flipV')],
      ['Flip Horizontal', () => this.turn(id, 'flipH')],
      null,
      ['More Rotation Options…', () => void this.turnBy(id)],
    ]);
  }

  private turn(id: number, how: Turn | number): void {
    const f = this.host.file();
    const o = f?.t.objects[id];
    if (!f || o?.kind !== 'picture') return;
    this.update({ ...f.t, objects: { ...f.t.objects, [id]: turned(o, how) } }, 'Rotate');
  }

  private async turnBy(id: number): Promise<void> {
    const o = this.host.file()?.t.objects[id];
    if (o?.kind !== 'picture') return;
    const got = await ask('Rotation', [{ name: 'deg', label: 'Rotation (degrees, clockwise)', value: String(o.rot ?? 0), type: 'number' }], { ok: 'Rotate' });
    const deg = Number(got?.deg);
    if (got && Number.isFinite(deg)) this.turn(id, deg);
  }

  /** Bring Forward or Send Backward (and to the front or back), for a floating figure. */
  orderMenu(x: number, y: number, forward: boolean): void {
    const id = this.target();
    if (id === null) return;
    if (!floatOf(this.host.file()?.t.objects[id])) { this.host.flash('A figure in line with the text has no order: choose a Wrap Text other than In Line first.'); return; }
    popupMenu(x, y, forward
      ? [['Bring Forward', () => this.restack(id, 'forward')], ['Bring to Front', () => this.restack(id, 'front')]]
      : [['Send Backward', () => this.restack(id, 'backward')], ['Send to Back', () => this.restack(id, 'back')]]);
  }

  restack(id: number, how: Restack): void {
    const f = this.host.file();
    if (!f) return;
    // a group moves up and down the stack together
    let t = f.t;
    const members = groupOf(t, id);
    for (const m of how === 'forward' || how === 'front' ? members : [...members].reverse()) t = restacked(t, m, how);
    this.update(t, how === 'forward' || how === 'front' ? 'Bring forward' : 'Send backward');
  }

  /** Group: the figures picked in the Selection Pane together (they move together); or ungroup the picked one's group. */
  groupMenu(x: number, y: number, near?: HTMLElement | null): void {
    const f = this.host.file();
    if (!f) return;
    const id = this.host.picked();
    const inGroup = id !== null && floatOf(f.t.objects[id])?.group !== undefined;
    popupMenu(x, y, [
      ['Group', () => this.group(near), this.chosen.size >= 2 || !this.pane?.open],
      ['Ungroup', () => { if (id !== null) this.update(ungrouped(f.t, id), 'Ungroup'); }, inGroup],
    ]);
  }

  private group(near?: HTMLElement | null): void {
    const f = this.host.file();
    if (!f) return;
    const ids = [...this.chosen].filter((id) => floatOf(f.t.objects[id]));
    if (ids.length < 2) {
      this.selectionPane(near);
      this.host.flash('Pick two or more figures in the Selection Pane (Ctrl+click), then Group.', 6000);
      return;
    }
    this.update(grouped(f.t, ids), 'Group');
    this.host.flash(`Grouped ${ids.length} figures: they move together. Ungroup to move them one by one.`);
  }

  // ---------------------------------------------------------------- the Selection Pane

  /** The Selection Pane: every floating figure from front to back, to pick, rename, hide, reorder or group. */
  selectionPane(near?: HTMLElement | null): void {
    if (!this.pane) {
      this.pane = new FloatBox('Selection', () => {});
      this.pane.el.classList.add('doc-sel-pane');
      this.pane.el.querySelector<HTMLElement>('.fb-pin')?.style.setProperty('display', 'none');
    }
    this.refresh();
    this.pane.show(shown(near));
  }

  get paneOpen(): boolean {
    return !!this.pane?.open;
  }

  /** Show the pane's list again (after any change to the document). */
  refresh(): void {
    const pane = this.pane;
    const f = this.host.file();
    if (!pane?.open && pane) return;
    if (!pane) return;
    const body = pane.body;
    body.replaceChildren();
    if (!f) return;
    const t = f.t;
    const all = new Set(floatingIds(t));
    for (const id of [...this.chosen]) if (!all.has(id)) this.chosen.delete(id);
    const tools = document.createElement('div');
    tools.className = 'sel-tools';
    const tool = (label: string, title: string, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      tools.append(b);
    };
    const ids = [...this.chosen];
    tool('Show All', 'Show every figure hidden here', () => this.update(withFloats(t, [...all].map((id) => [id, { hidden: undefined }])), 'Show all'));
    tool('Hide All', 'Hide every floating figure from the pages (they stay in the document)', () => this.update(withFloats(t, [...all].map((id) => [id, { hidden: true }])), 'Hide all'));
    tool('▲', 'Bring Forward', () => { const id = this.host.picked(); if (id !== null && all.has(id)) this.restack(id, 'forward'); });
    tool('▼', 'Send Backward', () => { const id = this.host.picked(); if (id !== null && all.has(id)) this.restack(id, 'backward'); });
    tool('Group', 'Group the figures picked here (Ctrl+click picks more): they move together', () => this.group());
    body.append(tools);
    const list = document.createElement('div');
    list.className = 'sel-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-multiselectable', 'true');
    // front first, as Word lists them
    const order = stackOrder(t).reverse();
    if (!order.length) {
      const none = document.createElement('p');
      none.className = 'sel-none';
      none.textContent = 'No figures float on the pages. Structures, pictures and text boxes show here once their Wrap Text is other than In Line with Text.';
      list.append(none);
    }
    const picked = this.host.picked();
    for (const id of order) {
      const fl = floatOf(t.objects[id])!;
      const row = document.createElement('div');
      row.className = 'sel-row';
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(this.chosen.has(id) || id === picked));
      if (fl.group !== undefined) row.classList.add('grouped');
      const name = document.createElement('span');
      name.className = 'sel-name';
      name.textContent = (fl.group !== undefined ? `Group ${fl.group} · ` : '') + objectName(t, id);
      name.title = 'Click to pick (Ctrl+click to pick more); double-click to rename';
      name.addEventListener('click', (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey) { if (this.chosen.has(id)) this.chosen.delete(id); else this.chosen.add(id); }
        else { this.chosen = new Set([id]); if (!fl.hidden) this.host.pick(id); }
        this.refresh();
      });
      name.addEventListener('dblclick', () => void this.rename(id));
      const eye = document.createElement('button');
      eye.type = 'button';
      eye.className = 'sel-eye';
      eye.textContent = fl.hidden ? '—' : '👁';
      eye.title = fl.hidden ? 'Hidden: click to show it on its page' : 'Click to hide it from its page (it stays in the document)';
      eye.setAttribute('aria-pressed', String(!fl.hidden));
      eye.addEventListener('click', () => this.update(withFloats(t, groupOf(t, id).map((m) => [m, { hidden: fl.hidden ? undefined : true }])), fl.hidden ? 'Show' : 'Hide'));
      row.append(name, eye);
      list.append(row);
    }
    body.append(list);
    if (ids.length >= 2) {
      const note = document.createElement('p');
      note.className = 'sel-none';
      note.textContent = `${ids.length} picked.`;
      body.append(note);
    }
  }

  private async rename(id: number): Promise<void> {
    const f = this.host.file();
    if (!f || !floatOf(f.t.objects[id])) return;
    const got = await ask('Rename', [{ name: 'name', label: 'Name', value: objectName(f.t, id) }], { ok: 'Rename' });
    if (!got) return;
    const name = got.name.trim();
    const own = name && name !== objectName({ objects: { [id]: { ...f.t.objects[id], float: { ...floatOf(f.t.objects[id])!, name: undefined } } as DocObject } }, id) ? name : undefined;
    this.update(withFloats(f.t, [[id, { name: own } as Partial<Float>]]), 'Rename');
  }
}
