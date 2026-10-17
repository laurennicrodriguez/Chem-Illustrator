// Comments on slides, as in PowerPoint (Review > New Comment): each one pinned to a point on the
// slide, shown there as a small marker (on screen only: never in the slide show, pictures or
// print), with its card in the Comments pane beside the slide. Markers can be dragged; the cards
// reply, resolve, edit and delete. Every change is a step of the deck's Undo.

import type { Deck } from '../deck/deck';
import { initials, type PinnedComment } from '../document/comments';
import { reviewAuthor, revisionDate } from '../document/revisions';
import { authorColour, threadCard, type ThreadActions } from './comment-cards';
import type { View } from '../render/renderer';

export interface SlideCommentsHooks {
  /** The deck showing in Slides mode (null in other modes). */
  deck(): Deck | null;
  /** Where a new comment goes: beside what is selected, or null for the slide's corner. */
  anchor(): { x: number; y: number } | null;
  /** The drawing's view (for placing the markers over it). */
  view(): View;
  /** Make sure there is a name to put on comments (asks the first time). */
  askName(): Promise<boolean>;
  flash(msg: string): void;
  /** Back to the slide. */
  focus(): void;
}


export class SlideComments {
  /** Review > Show Comments: the markers and the pane. */
  shown = false;
  /** The comment looked at. */
  active: number | null = null;
  private editing: number | null = null;
  private list: HTMLDivElement;
  private empty: HTMLParagraphElement;
  private markers: HTMLDivElement;
  private key = '';

  constructor(private section: HTMLElement, host: HTMLElement, private hooks: SlideCommentsHooks) {
    const h = document.createElement('h2');
    h.textContent = 'Comments';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'an-close';
    close.textContent = '×';
    close.title = 'Close the Comments pane';
    close.setAttribute('aria-label', 'Close the Comments pane');
    close.addEventListener('click', () => this.show(false));
    h.append(close);
    const bar = document.createElement('div');
    bar.className = 'an-bar';
    const add = document.createElement('button');
    add.type = 'button';
    add.textContent = '+ New';
    add.title = 'New Comment (Ctrl+Alt+M): a note pinned to the slide, beside what is selected';
    add.addEventListener('click', () => void this.add());
    const prev = document.createElement('button');
    prev.type = 'button';
    prev.textContent = '◀';
    prev.title = 'The comment before (on this slide or an earlier one)';
    prev.addEventListener('click', () => this.step(false));
    const next = document.createElement('button');
    next.type = 'button';
    next.textContent = '▶';
    next.title = 'The next comment (on this slide or a later one)';
    next.addEventListener('click', () => this.step(true));
    bar.append(add, prev, next);
    this.list = document.createElement('div');
    this.list.className = 'cmt-pane';
    this.empty = document.createElement('p');
    this.empty.className = 'muted small';
    this.empty.textContent = 'No comments on this slide. New Comment pins one beside what is selected, or in the corner; drag its marker to move it.';
    section.replaceChildren(h, bar, this.list, this.empty);
    this.markers = document.createElement('div');
    this.markers.className = 'slide-cmt-markers';
    host.append(this.markers);
  }

  /** A new comment being typed: on the slide only once it has some text (one Undo step). */
  private draft: { slide: number; c: PinnedComment } | null = null;

  /** The slide's comments (with one being written). */
  private comments(): PinnedComment[] {
    const cur = this.hooks.deck()?.current;
    const list = cur?.comments ?? [];
    return this.draft && cur?.id === this.draft.slide ? [...list, this.draft.c] : list;
  }

  private change(list: PinnedComment[], label: string): void {
    const d = this.draft?.c.id;
    this.hooks.deck()?.setComments(list.filter((c) => c.id !== d), label);
  }

  private patch(id: number, fn: (c: PinnedComment) => PinnedComment, label: string): void {
    this.change(this.comments().map((c) => (c.id === id ? fn(c) : c)), label);
  }

  // ---------------------------------------------------------------- showing

  /** Show or hide the pane and the markers. */
  show(on: boolean): void {
    this.shown = on;
    document.querySelector('[data-sl-cmt="show"]')?.setAttribute('aria-pressed', String(on));
    document.querySelector('[role="menuitemcheckbox"][data-cmd="show-comments"]')?.setAttribute('aria-checked', String(on));
    this.update();
  }

  /** Show what there is for the mode and slide (the deck changed, or another slide is shown). */
  update(): void {
    const deck = this.hooks.deck();
    this.section.hidden = !(deck && this.shown);
    this.markers.hidden = !(deck && this.shown);
    if (!deck || !this.shown) { this.key = ''; this.markers.replaceChildren(); return; }
    const list = this.comments();
    if (this.active !== null && !list.some((c) => c.id === this.active)) this.active = null;
    const key = `${deck.current?.id}|${this.active}|${this.editing}|${JSON.stringify(list)}`;
    if (key !== this.key) {
      this.key = key;
      this.list.replaceChildren(...list.map((c, i) => {
        const card = threadCard(c, { active: c.id === this.active, editing: c.id === this.editing, actions: this.actions(c.id), label: `Comment ${i + 1}` });
        return card;
      }));
      this.empty.hidden = list.length > 0;
      this.markers.replaceChildren(...list.map((c, i) => this.marker(c, i)));
      if (this.active !== null) this.list.querySelector('.cmt-card.active')?.scrollIntoView({ block: 'nearest' });
    }
    this.place();
  }

  /** Put the markers over their points on the slide (the view moved or zoomed). */
  place(): void {
    if (this.markers.hidden) return;
    const v = this.hooks.view();
    const list = this.comments();
    [...this.markers.children].forEach((m, i) => {
      const c = list[i];
      if (!c) return;
      (m as HTMLElement).style.transform = `translate(${Math.round(v.ox + c.x * v.scale)}px, ${Math.round(v.oy + c.y * v.scale)}px)`;
    });
  }

  private marker(c: PinnedComment, i: number): HTMLElement {
    const m = document.createElement('button');
    m.type = 'button';
    m.className = 'slide-cmt-marker' + (c.id === this.active ? ' active' : '') + (c.done ? ' done' : '');
    m.textContent = `${initials(c.author)}${i + 1}`;
    m.style.setProperty('--who', authorColour(c.author));
    m.title = `${c.author || 'Author'}: ${c.text}${c.replies?.length ? ` (${c.replies.length} ${c.replies.length === 1 ? 'reply' : 'replies'})` : ''}\nDrag to move it.`;
    // click to look at it; drag to move it
    m.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      m.setPointerCapture(e.pointerId);
      const v = this.hooks.view();
      const sx = e.clientX, sy = e.clientY;
      let moved = false;
      const onMove = (ev: PointerEvent) => {
        const dx = ev.clientX - sx, dy = ev.clientY - sy;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        moved = true;
        m.style.transform = `translate(${Math.round(v.ox + c.x * v.scale + dx)}px, ${Math.round(v.oy + c.y * v.scale + dy)}px)`;
      };
      const onUp = (ev: PointerEvent) => {
        m.removeEventListener('pointermove', onMove);
        m.removeEventListener('pointerup', onUp);
        m.removeEventListener('pointercancel', onUp);
        if (!moved) { this.active = c.id; this.key = ''; this.update(); return; }
        const size = this.hooks.deck()?.size ?? { w: 960, h: 540 };
        const x = Math.max(0, Math.min(size.w, c.x + (ev.clientX - sx) / v.scale));
        const y = Math.max(0, Math.min(size.h, c.y + (ev.clientY - sy) / v.scale));
        this.active = c.id;
        this.patch(c.id, (x0) => ({ ...x0, x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }), 'Move comment');
        this.update();
      };
      m.addEventListener('pointermove', onMove);
      m.addEventListener('pointerup', onUp);
      m.addEventListener('pointercancel', onUp);
    });
    return m;
  }

  // ---------------------------------------------------------------- changes

  private actions(id: number): ThreadActions {
    const note = (text: string) => ({ author: reviewAuthor() || 'Author', date: revisionDate(), text });
    return {
      edit: (text, reply) => {
        this.editing = null;
        const d = this.draft;
        if (d && d.c.id === id) {
          this.draft = null;
          this.hooks.deck()?.setComments([...(this.hooks.deck()?.current?.comments ?? []), { ...d.c, text }], 'New comment');
          this.update();
          this.hooks.focus();
          return;
        }
        this.patch(id, (c) => {
          if (reply === undefined) return { ...c, text };
          const replies = [...(c.replies ?? [])];
          if (replies[reply]) replies[reply] = { ...replies[reply], text };
          return { ...c, replies };
        }, 'Edit comment');
        this.update();
        this.hooks.focus();
      },
      reply: async (text) => {
        if (!reviewAuthor() && !(await this.hooks.askName())) return;
        this.active = id;
        this.patch(id, (c) => ({ ...c, replies: [...(c.replies ?? []), note(text)] }), 'Reply to comment');
        this.update();
      },
      removeReply: (i) => { this.patch(id, (c) => { const replies = (c.replies ?? []).filter((_, k) => k !== i); const { replies: _, ...rest } = c; return replies.length ? { ...rest, replies } : rest; }, 'Delete reply'); this.update(); },
      resolve: (done) => { this.patch(id, (c) => { const { done: _, ...rest } = c; return done ? { ...rest, done: true } : rest; }, done ? 'Resolve comment' : 'Reopen comment'); this.update(); },
      remove: () => this.remove(id),
      focus: () => { if (this.active !== id) { this.active = id; this.update(); } },
      // a new comment left empty goes as if never made
      cancelNew: () => { this.editing = null; if (this.draft?.c.id === id) this.draft = null; else this.remove(id); this.update(); this.hooks.focus(); },
    };
  }

  /** Review > New Comment: pinned beside what is selected, or in the slide's corner. */
  async add(): Promise<void> {
    const deck = this.hooks.deck();
    if (!deck?.current) return;
    if (!reviewAuthor() && !(await this.hooks.askName())) return;
    const list = this.comments();
    const at = this.hooks.anchor() ?? { x: 8, y: 8 + 28 * list.length };
    const id = list.reduce((n, c) => Math.max(n, c.id + 1), 0);
    const c: PinnedComment = { id, x: Math.round(Math.max(0, Math.min(deck.size.w - 30, at.x))), y: Math.round(Math.max(0, Math.min(deck.size.h - 22, at.y))), author: reviewAuthor() || 'Author', date: revisionDate(), text: '' };
    this.draft = { slide: deck.current.id, c };
    this.active = id;
    this.editing = id;
    this.show(true);
  }

  /** Delete a comment (the one looked at, when none is named). */
  remove(id = this.active): void {
    if (id === null || !this.comments().some((c) => c.id === id)) { this.hooks.flash('Click a comment’s marker or card first.'); return; }
    if (this.active === id) this.active = null;
    this.change(this.comments().filter((c) => c.id !== id), 'Delete comment');
    this.update();
  }

  /** Delete every comment on this slide. */
  removeAll(): void {
    if (!this.comments().length) { this.hooks.flash('There are no comments on this slide.'); return; }
    this.active = null;
    this.change([], 'Delete all comments');
    this.update();
  }

  /** Mark the comment looked at as resolved (or open again). */
  toggleResolved(): void {
    const c = this.comments().find((x) => x.id === this.active);
    if (!c) { this.hooks.flash('Click a comment’s marker or card first.'); return; }
    this.actions(c.id).resolve(!c.done);
  }

  /** The next comment in the deck (or the one before), going to its slide. */
  step(forward: boolean): void {
    const deck = this.hooks.deck();
    if (!deck) return;
    const all = deck.slides.flatMap((s, i) => (s.comments ?? []).map((c) => ({ i, id: c.id })));
    if (!all.length) { this.hooks.flash('There are no comments.'); return; }
    let k = all.findIndex((x) => x.i === deck.index && x.id === this.active);
    if (k < 0) {
      k = forward ? all.findIndex((x) => x.i >= deck.index) : all.length - 1 - [...all].reverse().findIndex((x) => x.i <= deck.index);
      if (k < 0 || k >= all.length) k = forward ? 0 : all.length - 1;
      if (all[k].i === deck.index && this.active !== null) k = (k + (forward ? 1 : all.length - 1)) % all.length;
    } else k = (k + (forward ? 1 : all.length - 1)) % all.length;
    const to = all[k];
    if (to.i !== deck.index) deck.go(to.i);
    this.active = to.id;
    this.show(true);
  }

  /** Another slide is shown: nothing on it is looked at yet. */
  slideChanged(): void {
    this.draft = null;
    if (!this.comments().some((c) => c.id === this.active)) this.active = null;
    this.editing = null;
    this.update();
  }
}
