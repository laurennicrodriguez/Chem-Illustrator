// The slide list down the left of Slides mode, as in PowerPoint: a small picture of each
// slide. Click to edit a slide, Ctrl+click or Shift+click to pick several, drag to reorder,
// and Delete, Ctrl+D or Enter in the list to delete, duplicate or add slides. Ctrl+C, Ctrl+X
// and Ctrl+V copy, cut and paste whole slides (into this deck or another), and right-click
// opens the slide commands. Hidden slides (Hide Slide) are greyed, their numbers struck through.
//
// In a deck with sections each section has a heading: click its arrow to fold it, drag it to
// move the section with all its slides, double-click its name to rename it, right-click for the
// section commands. Slide Sorter is the same list in a grid of larger pictures (`grid`), where
// double-clicking a slide opens it in Normal view.

import type { Deck } from '../deck/deck';
import { paintSlide } from '../deck/slide-view';

export interface SlideListHooks {
  /** Edit slide i. */
  go(i: number): void;
  /** The slide list's own keys (Delete, Ctrl+D, Enter) and buttons. */
  remove(indices: number[]): void;
  duplicate(indices: number[]): void;
  add(): void;
  /** Ctrl+C, Ctrl+X and Ctrl+V on whole slides. */
  copy(indices: number[]): void;
  cut(indices: number[]): void;
  paste(): void;
  /** Right-click in the list (on a slide, or below the slides). */
  menu(x: number, y: number): void;
  /** Right-click on a section's heading. */
  sectionMenu?(x: number, y: number, section: number): void;
  /** Double-click a section's name. */
  renameSection?(section: number): void;
  /** Slide Sorter: double-click a slide (or Enter) to open it. */
  open?(i: number): void;
}

const SLIDES_TYPE = 'application/x-chem-illustrator-slides';
const SECTION_TYPE = 'application/x-chem-illustrator-section';

export interface SlideListOptions {
  /** Slide Sorter: rows of larger pictures. */
  grid?: boolean;
  /** Width of each picture, in pixels. */
  thumbW?: number;
}

export class SlideList {
  private deck: Deck | null = null;
  /** Picked slides (by index), for deleting, duplicating or moving several. */
  picked = new Set<number>();
  private anchor = 0;
  private list: HTMLDivElement;
  /** Each slide's item (by index); slides in folded sections have none. */
  private items: (HTMLDivElement | undefined)[] = [];
  private heads: { el: HTMLDivElement; section: number; start: number }[] = [];
  private dragFrom: number[] | null = null;
  private dragSection: number | null = null;
  private dropMark: HTMLDivElement;
  private thumbTimer = 0;
  private grid: boolean;
  thumbW: number;

  constructor(private el: HTMLElement, private hooks: SlideListHooks, opts: SlideListOptions = {}) {
    this.grid = !!opts.grid;
    this.thumbW = opts.thumbW ?? 168;
    this.list = document.createElement('div');
    this.list.className = this.grid ? 'sl-list sl-grid' : 'sl-list';
    this.list.tabIndex = 0;
    this.list.setAttribute('role', 'listbox');
    this.list.setAttribute('aria-label', this.grid ? 'Slide Sorter' : 'Slides');
    this.list.setAttribute('aria-multiselectable', 'true');
    this.dropMark = document.createElement('div');
    this.dropMark.className = 'sl-drop';
    this.dropMark.hidden = true;
    if (this.grid) el.replaceChildren(this.list);
    else {
      const add = document.createElement('button');
      add.className = 'sl-add';
      add.type = 'button';
      add.textContent = '+ New slide';
      add.addEventListener('click', () => hooks.add());
      el.replaceChildren(this.list, add);
    }
    this.list.addEventListener('keydown', (e) => this.onKey(e));
    this.list.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const head = (e.target as HTMLElement).closest<HTMLElement>('.sl-sec');
      if (head && hooks.sectionMenu) { this.list.focus(); hooks.sectionMenu(e.clientX, e.clientY, Number(head.dataset.section)); return; }
      // a right-click on a slide that isn't picked picks it alone, as a click would
      const item = (e.target as HTMLElement).closest<HTMLElement>('.sl-item');
      const i = item ? Number(item.dataset.i) : -1;
      if (i >= 0 && !this.picked.has(i)) this.onClick(new MouseEvent('click'), i);
      this.list.focus();
      hooks.menu(e.clientX, e.clientY);
    });
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
    if (!deck) { this.list.replaceChildren(); this.items = []; this.heads = []; return; }
    // keep picked slides that still exist, and always the one being edited
    this.picked = new Set([...this.picked].filter((i) => i < deck.slides.length));
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    // the slide being edited is never hidden in a folded section
    const curSec = deck.slides[deck.index]?.section;
    if (curSec !== undefined) deck.folded.delete(curSec);
    const kids: HTMLElement[] = [];
    this.items = [];
    this.heads = [];
    const spans = deck.sections.length ? deck.sectionSpans() : [{ section: null, start: 0, count: deck.slides.length }];
    for (const sp of spans) {
      const folded = !!sp.section && deck.folded.has(sp.section.id);
      if (sp.section) {
        const head = this.heading(sp.section.id, sp.section.name, sp.count, folded, sp.start);
        kids.push(head);
      }
      if (folded) continue;
      for (let i = sp.start; i < sp.start + sp.count; i++) {
        const item = this.item(deck, i);
        this.items[i] = item;
        kids.push(item);
      }
    }
    this.list.replaceChildren(...kids, this.dropMark);
    this.mark();
    for (let i = 0; i < deck.slides.length; i++) this.paint(i);
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
  }

  private heading(id: number, name: string, count: number, folded: boolean, start: number): HTMLDivElement {
    const head = document.createElement('div');
    head.className = folded ? 'sl-sec folded' : 'sl-sec';
    head.dataset.section = String(id);
    head.draggable = true;
    head.setAttribute('role', 'group');
    const fold = document.createElement('button');
    fold.type = 'button';
    fold.className = 'sl-sec-fold';
    fold.textContent = folded ? '▸' : '▾';
    fold.title = folded ? 'Show this section\'s slides' : 'Fold this section';
    fold.setAttribute('aria-expanded', String(!folded));
    fold.addEventListener('click', (e) => { e.stopPropagation(); this.deck?.fold(id, !folded); });
    const label = document.createElement('span');
    label.className = 'sl-sec-name';
    label.textContent = name;
    label.title = 'Double-click to rename; drag to move the section with its slides; right-click for more';
    label.addEventListener('dblclick', (e) => { e.stopPropagation(); this.hooks.renameSection?.(id); });
    const n = document.createElement('span');
    n.className = 'sl-sec-count';
    n.textContent = `(${count})`;
    head.append(fold, label, n);
    // a click on the heading picks the section's slides, as in PowerPoint
    head.addEventListener('click', () => {
      const deck = this.deck;
      if (!deck || !count) return;
      this.picked = new Set(Array.from({ length: count }, (_, k) => start + k));
      this.anchor = start;
      if (!this.picked.has(deck.index)) this.hooks.go(start);
      this.mark();
      this.list.focus();
    });
    head.addEventListener('dragstart', (e) => {
      this.dragSection = id;
      this.dragFrom = null;
      e.dataTransfer?.setData(SECTION_TYPE, String(id));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    head.addEventListener('dragend', () => { this.dragSection = null; this.dropMark.hidden = true; });
    this.heads.push({ el: head, section: id, start });
    return head;
  }

  private item(deck: Deck, i: number): HTMLDivElement {
    const s = deck.slides[i];
    const item = document.createElement('div');
    item.className = s.hidden ? 'sl-item is-hidden' : 'sl-item';
    item.draggable = true;
    item.setAttribute('role', 'option');
    item.dataset.i = String(i);
    const num = document.createElement('span');
    num.className = 'sl-num';
    num.textContent = String(i + 1);
    if (s.hidden) num.title = 'Hidden: the slide show skips it (Hide Slide to show it again)';
    const canvas = document.createElement('canvas');
    canvas.className = 'sl-thumb';
    const h = Math.round((this.thumbW * deck.size.h) / deck.size.w);
    canvas.style.width = `${this.thumbW}px`;
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
    if (this.hooks.open) item.addEventListener('dblclick', () => this.hooks.open!(i));
    item.addEventListener('dragstart', (e) => this.onDragStart(e, i));
    item.addEventListener('dragend', () => { this.dragFrom = null; this.dropMark.hidden = true; });
    return item;
  }

  /** Another slide is being edited: only the marks move (the pictures stay as they are). */
  switched(): void {
    const deck = this.deck;
    if (!deck) return;
    if (!this.items[deck.index]) { this.rebuild(); return; }
    if (!this.picked.has(deck.index)) this.picked = new Set([deck.index]);
    this.mark();
    this.items[deck.index]?.scrollIntoView({ block: 'nearest' });
  }

  private mark(): void {
    const deck = this.deck;
    this.items.forEach((it, i) => {
      if (!it) return;
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
    const h = Math.round((this.thumbW * deck.size.h) / deck.size.w);
    paintSlide(canvas, this.thumbW, h, window.devicePixelRatio || 1, deck.page(i), deck.docOf(i));
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
    // the next slide that shows (slides in folded sections are passed over)
    const step = (d: 1 | -1) => {
      let i = deck.index + d;
      while (i >= 0 && i < deck.slides.length && !this.items[i]) i += d;
      if (i >= 0 && i < deck.slides.length) go(i);
    };
    // in the grid, up and down go a row at a time
    const perRow = this.grid ? Math.max(1, Math.floor(this.list.clientWidth / (this.thumbW + 40))) : 1;
    const ctrl = e.ctrlKey || e.metaKey;
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === 'ArrowDown' && perRow === 1)) step(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp' || (e.key === 'ArrowUp' && perRow === 1)) step(-1);
    else if (e.key === 'ArrowDown') go(deck.index + perRow);
    else if (e.key === 'ArrowUp') go(deck.index - perRow);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(deck.slides.length - 1);
    else if (e.key === 'Delete' || e.key === 'Backspace') this.hooks.remove(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'd') this.hooks.duplicate(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'c') this.hooks.copy(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'x') this.hooks.cut(this.pickedList());
    else if (ctrl && e.key.toLowerCase() === 'v') this.hooks.paste();
    else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
      const r = (this.items[deck.index] ?? this.list).getBoundingClientRect();
      this.hooks.menu(r.left + 24, r.top + 24);
    }
    else if (e.key === 'Enter' && this.hooks.open) this.hooks.open(deck.index);
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

  /** Put the keyboard focus in the list. */
  focus(): void {
    this.list.focus();
  }

  // ---------------------------------------------------------------- dragging to reorder

  private onDragStart(e: DragEvent, i: number): void {
    if (!this.picked.has(i)) { this.picked = new Set([i]); this.anchor = i; this.mark(); }
    this.dragFrom = this.pickedList();
    this.dragSection = null;
    e.dataTransfer?.setData(SLIDES_TYPE, this.dragFrom.join(','));
    if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
  }

  /**
   * Where a drop at this point goes: before slide `at` (counted in the full list), or onto a
   * section's heading (its slides then go at the start of that section).
   */
  private dropAt(x: number, y: number): { at: number; section?: number; mark: { x: number; y: number; vertical: boolean } } {
    const deck = this.deck!;
    const lr = this.list.getBoundingClientRect();
    const local = (px: number, py: number) => ({ x: px - lr.left + this.list.scrollLeft, y: py - lr.top + this.list.scrollTop });
    for (const h of this.heads) {
      const r = h.el.getBoundingClientRect();
      if (y >= r.top && y <= r.bottom) return { at: h.start, section: h.section, mark: { ...local(r.left, r.bottom + 2), vertical: false } };
    }
    // the nearest slide showing, and which side of it
    let best: { i: number; r: DOMRect; d: number } | null = null;
    this.items.forEach((it, i) => {
      if (!it) return;
      const r = it.getBoundingClientRect();
      const d = Math.hypot(Math.max(r.left - x, 0, x - r.right), Math.max(r.top - y, 0, y - r.bottom));
      if (!best || d < best.d) best = { i, r, d };
    });
    if (!best) return { at: deck.slides.length, mark: { ...local(lr.left, lr.top), vertical: false } };
    const { i, r } = best as { i: number; r: DOMRect };
    if (this.grid) {
      const after = x > r.left + r.width / 2;
      return { at: after ? i + 1 : i, mark: { ...local(after ? r.right + 6 : r.left - 6, r.top), vertical: true } };
    }
    const after = y > r.top + r.height / 2;
    return { at: after ? i + 1 : i, mark: { ...local(r.left, after ? r.bottom + 4 : r.top - 4), vertical: false } };
  }

  private onDragOver(e: DragEvent): void {
    if (!this.dragFrom && this.dragSection === null) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    const d = this.dropAt(e.clientX, e.clientY);
    const m = this.dropMark;
    m.classList.toggle('vertical', d.mark.vertical);
    if (d.mark.vertical) {
      m.style.left = `${d.mark.x}px`;
      m.style.top = `${d.mark.y}px`;
      m.style.height = `${Math.round((this.thumbW * (this.deck?.size.h ?? 9)) / (this.deck?.size.w ?? 16))}px`;
    } else {
      m.style.left = '';
      m.style.height = '';
      m.style.top = `${d.mark.y}px`;
    }
    m.hidden = false;
  }

  private onDrop(e: DragEvent): void {
    const deck = this.deck;
    const from = this.dragFrom;
    const sec = this.dragSection;
    this.dropMark.hidden = true;
    if (!deck || (!from && sec === null)) return;
    e.preventDefault();
    const d = this.dropAt(e.clientX, e.clientY);
    this.dragFrom = null;
    this.dragSection = null;
    if (sec !== null) {
      // a section dropped: it goes before the section the drop point is in (or after the last)
      const spans = deck.sectionSpans().filter((x) => x.section.id !== sec);
      let to = spans.length;
      if (d.section !== undefined) to = spans.findIndex((x) => x.section.id === d.section);
      else {
        const k = spans.findIndex((x) => d.at <= x.start);
        if (k >= 0) to = k;
      }
      deck.moveSection(sec, Math.max(0, to));
      return;
    }
    // the position among the slides that stay put
    const to = d.at - from!.filter((i) => i < d.at).length;
    const slides = from!.map((i) => deck.slides[i]);
    deck.move(from!, to, d.section);
    // the moved slides stay picked, in their new places
    const moved = new Set(slides.map((s) => deck.slides.indexOf(s)));
    if (moved.has(deck.index)) { this.picked = moved; this.mark(); }
  }
}
