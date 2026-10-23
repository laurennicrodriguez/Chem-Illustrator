// Notes and comments on cells in Sheet mode, as Excel shows them. Pointing at a cell with a red
// (note) or purple (comment) corner shows its card beside the cell; clicking into the card keeps
// it open. A note's card is a yellow sticky note to type in; a comment's card is the same
// conversation card as Word's and PowerPoint's comments here (reply, resolve, edit, delete).
// Notes set to show all the time (Show Note, or View > Show All Notes) sit beside their cells.
// Every change is a step of the workbook's Undo.

import type { Sheet } from '../sheet/workbook';
import type { CellNote } from '../sheet/notes';
import { copyNote } from '../sheet/notes';
import { keyOf, rowOf, colOf, cellName, inRange } from '../sheet/refs';
import { reviewAuthor, revisionDate } from '../document/revisions';
import { threadCard, type ThreadActions } from './comment-cards';
import type { SheetView } from './sheet-view';

export interface NotesHost {
  readonly view: SheetView;
  /** One undoable change to the sheet showing. */
  edit(label: string, fn: (s: Sheet) => void): void;
  flash(msg: string, ms?: number): void;
  /** Make sure there is a name to put on notes (asks the first time). */
  askName(): Promise<boolean>;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

export class SheetNotes {
  /** View > Show All Notes. */
  showAll = false;
  /** The card showing, for which cell, and whether it stays open (clicked, or being typed in). */
  private card: { el: HTMLElement; sheet: Sheet; r: number; c: number; pinned: boolean } | null = null;
  /** A note or comment being written: on the cell only once it has some text. */
  private draft: { sheet: Sheet; r: number; c: number; note: CellNote } | null = null;
  private hideTimer = 0;
  private layerKey = '';

  constructor(private host: NotesHost) {
    // a click outside the card closes it (a click on another cell with a note opens that one)
    document.addEventListener('pointerdown', (e) => {
      const card = this.card;
      if (!card || card.el.contains(e.target as Node)) return;
      if ((e.target as HTMLElement).closest?.('dialog, .popup-menu')) return;
      this.close();
    }, true);
  }

  private get view(): SheetView {
    return this.host.view;
  }

  private noteOn(s: Sheet, r: number, c: number): CellNote | undefined {
    const d = this.draft;
    if (d && d.sheet === s && d.r === r && d.c === c) return d.note;
    return s.noteAt(r, c);
  }

  // ---------------------------------------------------------------- the card

  /** The pointer moved onto a cell with a note (or off it). */
  hover(cell: { r: number; c: number } | null, box: DOMRect | null): void {
    clearTimeout(this.hideTimer);
    if (this.card?.pinned) return;
    const s = this.view.sheet;
    if (!cell || !box || !s) {
      // a moment to reach the card (its Reply button), then it goes
      this.hideTimer = window.setTimeout(() => { if (!this.card?.pinned && !this.card?.el.matches(':hover')) this.close(); }, 350);
      return;
    }
    // a note shown all the time needs no card
    const n = s.noteAt(cell.r, cell.c);
    if (!n || (n.kind === 'note' && (n.shown || this.showAll))) { this.close(); return; }
    this.open(s, cell.r, cell.c, false, box);
  }

  /** Show a cell's card beside it; `pinned` keeps it until a click elsewhere. */
  private open(s: Sheet, r: number, c: number, pinned: boolean, box = this.view.screenRect(r, c), editing = false): void {
    const n = this.noteOn(s, r, c);
    if (!n || !box) { this.close(); return; }
    if (this.card && (this.card.sheet !== s || this.card.r !== r || this.card.c !== c || pinned || editing)) this.close(false);
    if (!this.card) {
      const cardEl = n.kind === 'comment' ? this.threadEl(s, r, c, n, editing) : this.noteEl(s, r, c, n, editing);
      cardEl.classList.add('sh-note-card');
      // clicking into a card keeps it open
      cardEl.addEventListener('pointerdown', () => { if (this.card) this.card.pinned = true; });
      cardEl.addEventListener('pointerleave', () => this.hover(null, null));
      cardEl.addEventListener('pointerenter', () => clearTimeout(this.hideTimer));
      document.body.append(cardEl);
      this.card = { el: cardEl, sheet: s, r, c, pinned };
    }
    this.card.pinned ||= pinned;
    this.placeCard(box);
  }

  private placeCard(box: DOMRect): void {
    const el = this.card?.el;
    if (!el) return;
    const w = el.offsetWidth || 240, h = el.offsetHeight || 120;
    let x = box.right + 10, y = box.top - 4;
    if (x + w > innerWidth - 6) x = Math.max(6, box.left - w - 10);
    y = Math.max(6, Math.min(y, innerHeight - h - 6));
    el.style.left = `${Math.round(x)}px`;
    el.style.top = `${Math.round(y)}px`;
  }

  /** Close the card (a note being written with nothing in it goes). */
  close(keepDraft = false): void {
    clearTimeout(this.hideTimer);
    const card = this.card;
    if (!card) return;
    this.card = null;
    // a box being typed in saves as it loses the focus, before the card goes
    const typing = card.el.querySelector<HTMLTextAreaElement>('textarea');
    if (typing && document.activeElement === typing) typing.blur();
    card.el.remove();
    if (!keepDraft && this.draft) this.draft = null;
  }

  /** A note's yellow card: its author, and its text (a box to type in when editing). */
  private noteEl(s: Sheet, r: number, c: number, n: CellNote, editing: boolean): HTMLElement {
    const card = el('div', 'sh-note');
    if (n.author) card.append(el('div', 'sh-note-who', `${n.author}:`));
    if (!editing) {
      const text = el('div', 'sh-note-text', n.text);
      text.title = 'Click to change the note';
      text.addEventListener('click', () => { this.close(); this.open(s, r, c, true, undefined, true); });
      card.append(text);
      return card;
    }
    const ta = el('textarea', 'sh-note-input');
    ta.value = n.text;
    ta.rows = Math.min(10, Math.max(4, n.text.split('\n').length + 1));
    ta.spellcheck = true;
    ta.placeholder = 'Type your note';
    let done = false;
    const finish = (keep: boolean) => {
      if (done) return;
      done = true;
      const text = ta.value.replace(/\s+$/, '');
      const draft = this.draft && this.draft.note === n ? this.draft : null;
      this.draft = null;
      if (keep && text !== n.text) {
        if (draft && !text) { /* an empty new note isn't kept */ }
        else this.host.edit(draft ? 'New note' : text ? 'Edit note' : 'Delete note', (sh) => sh.setNote(r, c, text ? { ...n, text } : undefined));
      }
      if (this.card?.el === card) this.close();
      this.view.focus();
    };
    // in a note, Enter starts a new line (as in Excel); Escape or a click elsewhere finishes
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(true); }
    });
    ta.addEventListener('blur', () => finish(true));
    for (const ev of ['keyup', 'keypress', 'paste', 'copy', 'cut'] as const) ta.addEventListener(ev, (e) => e.stopPropagation());
    card.append(ta);
    queueMicrotask(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
    return card;
  }

  /** A comment's card, with its replies and the buttons to answer it. */
  private threadEl(s: Sheet, r: number, c: number, n: CellNote, editing: boolean): HTMLElement {
    return threadCard(n, { active: true, editing, actions: this.actions(s, r, c), label: cellName(r, c) });
  }

  private actions(s: Sheet, r: number, c: number): ThreadActions {
    const now = () => ({ author: reviewAuthor() || 'Author', date: revisionDate() });
    const change = (label: string, fn: (n: CellNote) => CellNote | undefined) => {
      const n = this.noteOn(s, r, c);
      if (!n) return;
      const draft = this.draft && this.draft.sheet === s && this.draft.r === r && this.draft.c === c;
      this.draft = null;
      const next = fn(copyNote(n));
      if (s !== this.view.sheet) return;
      this.host.edit(draft ? 'New comment' : label, (sh) => sh.setNote(r, c, next));
      this.reopen(s, r, c);
    };
    return {
      edit: (text, reply) => change('Edit comment', (n) => {
        if (reply === undefined) return { ...n, text };
        if (n.replies?.[reply]) n.replies[reply] = { ...n.replies[reply], text };
        return n;
      }),
      reply: (text) => {
        void (reviewAuthor() ? Promise.resolve(true) : this.host.askName()).then((ok) => {
          if (ok) change('Reply', (n) => ({ ...n, replies: [...(n.replies ?? []), { ...now(), text }] }));
        });
      },
      removeReply: (i) => change('Delete reply', (n) => ({ ...n, replies: (n.replies ?? []).filter((_, j) => j !== i) })),
      resolve: (done) => change(done ? 'Resolve comment' : 'Reopen comment', (n) => ({ ...n, done: done || undefined })),
      remove: () => { change('Delete comment', () => undefined); this.close(); this.view.focus(); },
      focus: () => { if (this.view.sheet === s) this.view.selectCell(r, c); },
      cancelNew: () => { this.draft = null; this.close(); this.view.focus(); },
    };
  }

  /** Show the card again after a change (its new state), still open. */
  private reopen(s: Sheet, r: number, c: number): void {
    const was = this.card;
    if (!was || was.sheet !== s || was.r !== r || was.c !== c) return;
    this.close(true);
    if (this.noteOn(s, r, c)) this.open(s, r, c, true);
  }

  // ---------------------------------------------------------------- commands

  private active(): { s: Sheet; r: number; c: number } | null {
    const s = this.view.sheet;
    if (!s || s.dashboard) return null;
    const { r, c } = this.view.sel.active;
    return { s, r, c };
  }

  /** Review > New Note (Shift+F2): a note on the active cell, or its note opened to change. */
  async newNote(): Promise<void> {
    const a = this.active();
    if (!a) return;
    const had = a.s.noteAt(a.r, a.c);
    if (had?.kind === 'comment') { this.host.flash('This cell has a comment: reply to it, or delete it first to leave a note.'); this.open(a.s, a.r, a.c, true); return; }
    if (had) { this.edit(); return; }
    if (!reviewAuthor() && !(await this.host.askName())) return;
    this.view.commitEdit();
    this.view.reveal(a.r, a.c);
    this.draft = { sheet: a.s, r: a.r, c: a.c, note: { kind: 'note', author: reviewAuthor(), date: revisionDate(), text: '' } };
    this.close(true);
    this.open(a.s, a.r, a.c, true, undefined, true);
  }

  /** Review > New Comment (Ctrl+Alt+M): a comment on the active cell, or its comment opened to reply. */
  async newComment(): Promise<void> {
    const a = this.active();
    if (!a) return;
    const had = a.s.noteAt(a.r, a.c);
    if (had?.kind === 'note') { this.host.flash('This cell has a note: change it, or use Convert to Comments to turn notes into comments.'); this.edit(); return; }
    if (had) { this.open(a.s, a.r, a.c, true); return; }
    if (!reviewAuthor() && !(await this.host.askName())) return;
    this.view.commitEdit();
    this.view.reveal(a.r, a.c);
    this.draft = { sheet: a.s, r: a.r, c: a.c, note: { kind: 'comment', author: reviewAuthor(), date: revisionDate(), text: '' } };
    this.close(true);
    this.open(a.s, a.r, a.c, true, undefined, true);
  }

  /** Edit Note: the active cell's note opened to type in (a comment's card opened). */
  edit(): void {
    const a = this.active();
    const n = a && a.s.noteAt(a.r, a.c);
    if (!a || !n) { this.host.flash('There is no note on this cell. New Note (Shift+F2) adds one.'); return; }
    this.view.reveal(a.r, a.c);
    this.close();
    this.open(a.s, a.r, a.c, true, undefined, n.kind === 'note');
  }

  /** Delete the notes and comments in the selection. */
  remove(): void {
    const s = this.view.sheet;
    if (!s) return;
    const R = this.view.sel.range;
    if (![...s.notes.keys()].some((k) => inRange(R, rowOf(k), colOf(k)))) { this.host.flash('There are no notes or comments in the selected cells.'); return; }
    this.close();
    this.host.edit('Delete notes', (sh) => sh.clear(R, 'notes'));
  }

  /** Show/Hide Note: the active cell's note shown all the time, or only when pointed at. */
  toggleShown(): void {
    const a = this.active();
    const n = a && a.s.noteAt(a.r, a.c);
    if (!a || !n) { this.host.flash('There is no note on this cell.'); return; }
    if (n.kind === 'comment') { this.host.flash('Comments show when you point at their cell; use Previous and Next to go through them.'); return; }
    this.close();
    this.host.edit(n.shown ? 'Hide note' : 'Show note', (sh) => sh.setNote(a.r, a.c, { ...n, shown: !n.shown || undefined }));
  }

  /** View > Show All Notes. */
  toggleShowAll(): void {
    this.showAll = !this.showAll;
    this.close();
    this.layerKey = '';
    this.view.refresh();
  }

  /** Review > Convert to Comments: every note on the sheet becomes a comment that can be replied to. */
  convertNotes(): void {
    const s = this.view.sheet;
    const notes = s ? [...s.notes].filter(([, n]) => n.kind === 'note') : [];
    if (!notes.length) { this.host.flash('There are no notes on this sheet to convert.'); return; }
    this.close();
    this.host.edit('Convert notes to comments', (sh) => {
      for (const [k, n] of notes) sh.setNote(rowOf(k), colOf(k), { kind: 'comment', author: n.author, date: n.date || revisionDate(), text: n.text });
    });
    this.host.flash(`${notes.length} note${notes.length > 1 ? 's' : ''} became comment${notes.length > 1 ? 's' : ''}.`);
  }

  /** Previous and Next: the notes and comments of the sheet in turn, row by row, each opened. */
  step(next: boolean): void {
    const s = this.view.sheet;
    if (!s || !s.notes.size) { this.host.flash('There are no notes or comments on this sheet.'); return; }
    const keys = [...s.notes.keys()].sort((a, b) => rowOf(a) - rowOf(b) || colOf(a) - colOf(b));
    const here = keyOf(this.view.sel.active.r, this.view.sel.active.c);
    const k = next ? keys.find((x) => rowOf(x) > rowOf(here) || (rowOf(x) === rowOf(here) && colOf(x) > colOf(here))) ?? keys[0]
      : [...keys].reverse().find((x) => rowOf(x) < rowOf(here) || (rowOf(x) === rowOf(here) && colOf(x) < colOf(here))) ?? keys[keys.length - 1];
    this.close();
    this.view.selectCell(rowOf(k), colOf(k));
    this.view.draw();
    this.open(s, rowOf(k), colOf(k), true);
  }

  // ---------------------------------------------------------------- notes shown all the time

  /** Lay the notes shown all the time over the grid (after each drawing of it). */
  layout(): void {
    const v = this.view;
    const s = v.sheet;
    const layer = v.noteLayer;
    const list = s && !s.dashboard ? [...s.notes].filter(([, n]) => n.kind === 'note' && (n.shown || this.showAll)) : [];
    const key = list.length ? JSON.stringify(list) : '';
    if (key !== this.layerKey) {
      this.layerKey = key;
      layer.replaceChildren(...list.map(([k, n]) => {
        const box = el('div', 'sh-note sh-note-shown');
        box.dataset.key = String(k);
        if (n.author) box.append(el('div', 'sh-note-who', `${n.author}:`));
        box.append(el('div', 'sh-note-text', n.text));
        box.title = 'Click to change the note';
        box.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          e.preventDefault();
          v.selectCell(rowOf(k), colOf(k));
          this.edit();
        });
        return box;
      }));
    }
    // follow the cells as the sheet scrolls
    for (const box of layer.children as HTMLCollectionOf<HTMLElement>) {
      const k = Number(box.dataset.key);
      const rect = s && !s.hiddenRows.has(rowOf(k)) && !s.hiddenCols.has(colOf(k)) ? v.layerRect(rowOf(k), colOf(k)) : null;
      box.hidden = !rect;
      if (rect) { box.style.left = `${rect.x + rect.w + 8}px`; box.style.top = `${Math.max(0, rect.y - 4)}px`; }
    }
    // an open card follows its cell too
    const card = this.card;
    if (card && card.sheet === s) {
      const box = v.screenRect(card.r, card.c);
      if (box) this.placeCard(box);
    } else if (card) this.close();
  }
}
