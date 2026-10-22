// The slide list down the left of Slides mode, as in PowerPoint: a small picture of each
// slide. Click to edit a slide, Ctrl+click or Shift+click to pick several, drag to reorder,
// and Delete, Ctrl+D or Enter in the list to delete, duplicate or add slides.

import type { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';

export interface SlideListHooks {
  /** Edit slide i. */
  go(i: number): void;
  /** The slide list's own keys (Delete, Ctrl+D, Enter) and buttons. */
  remove(indices: number[]): void;
  duplicate(indices: number[]): void;
  add(): void;
}

const THUMB_W = 168;

export class SlideList {
  private deck: Deck | null = null;
  /** Picked slides (by index), for deleting, duplicating or moving several. */
  picked = new Set<number>();
  private anchor = 0;
  private list: HTMLDivElement;
  private items: HTMLDivElement[] = [];
  private dragFrom: number[] | null = null;
  private dropMark: HTMLDivElement;
  private thumbTimer = 0;

  constructor(private el: HTMLElement, private hooks: SlideListHooks) {
    this.list = document.createElement('div');
    this.list.className = 'sl-list';
    this.list.tabIndex = 0;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', 'Slides');
    this.list.setAttribute('aria-multiselectable', 'true');
    this.dropMark = document.createElement('div');
    this.dropMark.className = 'sl-drop';
    this.dropMark.hidden = true;
    const add = document.createElement('button');
    add.className = 'sl-add';
    add.type = 'button';
    add.textContent = '+ New slide';
    add.addEventListener('click', () => hooks.add());
    el.replaceChildren(this.list, add);
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('dragover', (e) => this.onDragOver(e));
    this.list.addEventListener('drop', (e) => this.onDrop(e));
    this.list.addEventListener('dragleave', (e) => {
      if (!this.list.contains(e.relatedTarget as Node)) this.dropMark.hidden = true;
    });
  }

  /** Show this deck's slides (or none). */
  show(deck: Deck | null): void {
    this.deck = deck;
    this.picked = new Set(deck ? [deck.index] : []);
    this.anchor = deck?.index ?? 0;
    this.rebuild();
  }

  /** The slides were added, removed, reordered or switched. */
  rebuild(): void {
    const deck = this.deck;
    if (!deck) { this.list.replaceChildren(); this.items = []; return; }
    // keep picked slides that still exist, and always the one being edited
    this.picked = new Set([...this.picked].filter((i) => i < deck.slides.length));
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    this.items = deck.slides.map((s, i) => {
      const item = document.createElement('div');
      item.className = 'sl-item';
      item.draggable = true;
      item.setAttribute('role', 'option');
      item.dataset.i = String(i);
      const num = document.createElement('span');
      num.className = 'sl-num';
      num.textContent = String(i + 1);
      const canvas = document.createElement('canvas');
      canvas.className = 'sl-thumb';
      const h = Math.round((THUMB_W * deck.size.h) / deck.size.w);
      canvas.style.width = `${THUMB_W}px`;
      canvas.style.height = `${h}px`;
      item.append(num, canvas);
      if (s.notes.trim()) {
        const n = document.createElement('span');
        n.className = 'sl-has-notes';
        n.title = 'This slide has speaker notes';
        n.textContent = '✎';
        item.append(n);
      }
      item.addEventListener('click', (e) => this.onClick(e, i));
      item.addEventListener('dragstart', (e) => this.onDragStart(e, i));
      item.addEventListener('dragend', () => { this.dragFrom = null; this.dropMark.hidden = true; });
      return item;
    });
    this.list.replaceChildren(...this.items, this.dropMark);
    this.mark();
    for (let i = 0; i < deck.slides.length; i++) this.paint(i);
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
  }

  /** Another slide is being edited: only the marks move (the pictures stay as they are). */
  switched(): void {
    const deck = this.deck;
    if (!deck) return;
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    this.mark();
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
  }

  private mark(): void {
    const deck = this.deck;
    this.items.forEach((it, i) => {
      it.classList.toggle('current', i === deck?.index);
      it.classList.toggle('picked', this.picked.has(i));
      it.setAttribute('aria-selected', String(this.picked.has(i)));
    });
  }

  /** Redraw one slide's picture (soon, for the slide being edited, so typing stays quick). */
  refresh(i = this.deck?.index ?? 0, soon = true): void {
    if (!soon) { this.paint(i); return; }
    clearTimeout(this.thumbTimer);
    this.thumbTimer = window.setTimeout(() => this.paint(i), 250);
  }

  /** Redraw every slide's picture (after the master changed, or a picture loaded). */
  refreshAll(): void {
    if (!this.deck) return;
    for (let i = 0; i < this.deck.slides.length; i++) this.paint(i);
  }

  private paint(i: number): void {
    const deck = this.deck;
    const item = this.items[i];
    if (!deck || !item || !deck.slides[i]) return;
    const canvas = item.querySelector('canvas')!;
    const h = Math.round((THUMB_W * deck.size.h) / deck.size.w);
    paintSlide(canvas, THUMB_W, h, window.devicePixelRatio || 1, deck.page(i), deck.docOf(i));
  }

  // ---------------------------------------------------------------- picking

  private onClick(e: MouseEvent, i: number): void {
    const deck = this.deck;
    if (!deck) return;
    if (e.shiftKey) {
      const [a, b] = [Math.min(this.anchor, i), Math.max(this.anchor, i)];
      this.picked = new Set(Array.from({ length: b - a + 1 }, (_, k) => a + k));
    } else if (e.ctrlKey || e.metaKey) {
      if (this.picked.has(i) && this.picked.size > 1) this.picked.delete(i);
      else this.picked.add(i);
      this.anchor = i;
    } else {
      this.picked = new Set([i]);
      this.anchor = i;
    }
    if (i !== deck.index && this.picked.has(i)) this.hooks.go(i);
    this.mark();
    this.list.focus();
  }

  /** The picked slides, in order (the slide being edited when nothing else is picked). */
  pickedList(): number[] {
    const deck = this.deck;
    if (!deck) return [];
    const list = [...this.picked].filter((i) => i < deck.slides.length).sort((a, b) => a - b);
    return list.length ? list : [deck.index];
  }

  private onKey(e: KeyboardEvent): void {
    const deck = this.deck;
    if (!deck) return;
    const go = (i: number) => {
      i = Math.max(0, Math.min(deck.slides.length - 1, i));
      this.picked = new Set([i]);
      this.anchor = i;
      this.hooks.go(i);
      this.mark();
      this.items[i]?.scrollIntoView({ block: 'nearest' });
    };
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') go(deck.index + 1);
    else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') go(deck.index - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(deck.slides.length - 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.remove(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'd') this.hooks.duplicate(this.pickedList());
    else if (e.key === 'Enter') this.hooks.add();
    else if (ctrl && e.key.toLowerCase() === 'a') { this.picked = new Set(deck.slides.map((_, i) => i)); this.mark(); }
    else return;
    // these keys are the list's, not the drawing's
    e.preventDefault();
    e.stopPropagation();
  }

  /** True when keys should go to the slide list (it has the focus). */
  get focused(): boolean {
    return this.el.contains(document.activeElement);
  }

  // ---------------------------------------------------------------- dragging to reorder

  private onDragStart(e: DragEvent, i: number): void {
    if (!this.picked.has(i)) { this.picked = new Set([i]); this.anchor = i; this.mark(); }
    this.dragFrom = this.pickedList();
    e.dataTransfer?.setData('application/x-chem-illustrator-slides', this.dragFrom.join(','));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /** Where a drop at this height goes: before slide `at` (counted in the full list). */
  private dropIndex(y: number): number {
    for (let i = 0; i < this.items.length; i++) {
      const r = this.items[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) return i;
    }
    return this.items.length;
  }

  private onDragOver(e: DragEvent): void {
    if (!this.dragFrom) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const at = this.dropIndex(e.clientY);
    const lr = this.list.getBoundingClientRect();
    const ref = this.items[at] ?? this.items[this.items.length - 1];
    const r = ref.getBoundingClientRect();
    const y = at < this.items.length ? r.top - 4 : r.bottom + 4;
    this.dropMark.style.top = `${y - lr.top + this.list.scrollTop}px`;
    this.dropMark.hidden = false;
  }

  private onDrop(e: DragEvent): void {
    const deck = this.deck;
    const from = this.dragFrom;
    this.dropMark.hidden = true;
    if (!deck || !from) return;
    e.preventDefault();
    const at = this.dropIndex(e.clientY);
    // the position among the slides that stay put
    const to = at - from.filter((i) => i < at).length;
    this.dragFrom = null;
    deck.move(from, to);
    // the moved slides stay picked, in their new places
    const moved = new Set(from.map((_, k) => Math.min(deck.slides.length - 1, to) + k));
    if (moved.has(deck.index)) { this.picked = moved; this.mark(); }
  }
}
