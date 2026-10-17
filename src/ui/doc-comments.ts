// Comments in a document, shown as Word shows them: the words a comment is on shaded, and its
// card in a column beside the page at the height of those words. Review > New Comment puts one on
// the selection (or the word at the caret); the cards reply, resolve, edit and delete. Every
// change is a step of the document's Undo.

import type { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import { commentSpan, markComment, nextCommentId, placedComments, unmarkComment, type CommentThread } from '../document/comments';
import { reviewAuthor, revisionDate } from '../document/revisions';
import { plainText } from '../richtext';
import { stackCards, threadCard, type ThreadActions } from './comment-cards';
import type { DocView } from './doc-view';

export interface DocCommentsHost {
  file(): DocFile | null;
  /** Back to typing in the page. */
  focus(): void;
  flash(msg: string, ms?: number): void;
  /** Make sure there is a name to put on comments (asks the first time). */
  askName(): Promise<boolean>;
}

/** The column's width in pixels (room kept beside the pages while comments show). */
const COLUMN = 280;

export class DocComments {
  /** Review > Show Comments. */
  shown = true;
  /** The comment being looked at (its words shaded more strongly, its card to the front). */
  active: number | null = null;
  /** The comment whose text is open for typing (a new one). */
  private editing: number | null = null;
  private layer: HTMLDivElement;
  private built: { t: DocText; active: number | null; editing: number | null; shown: boolean } | null = null;
  private cards = new Map<number, HTMLElement>();

  constructor(host: HTMLElement, private view: DocView, private h: DocCommentsHost) {
    this.layer = document.createElement('div');
    this.layer.className = 'doc-comments';
    host.append(this.layer);
  }

  private get file(): DocFile | null {
    return this.h.file();
  }

  /** The comments on some text, in the order of the text. */
  placed(): ReturnType<typeof placedComments> {
    const f = this.file;
    return f ? placedComments(f.t.runs, f.t.comments) : [];
  }

  /** The shading the page draws for comments. */
  shading(): { start: number; end: number; active: boolean }[] {
    if (!this.shown) return [];
    return this.placed().map((p) => ({ start: p.start, end: p.end, active: p.id === this.active }));
  }

  /** The caret moved: the comment it is in becomes the one looked at (the innermost, if they overlap). */
  followCaret(): void {
    const f = this.file;
    if (!f || f.box || this.editing !== null) return;
    const at = f.ed.start;
    const cur = this.active !== null ? this.placed().find((p) => p.id === this.active) : undefined;
    if (cur && cur.start <= at && f.ed.end <= cur.end) return;
    const inside = this.placed().filter((p) => p.start <= at && at <= p.end && (f.ed.end <= p.end));
    inside.sort((a, b) => (a.end - a.start) - (b.end - b.start));
    const next = inside[0]?.id ?? null;
    if (next !== this.active) this.active = next;
  }

  /** Show the cards (rebuilt when the comments changed, else only moved to follow the page). */
  update(): void {
    const f = this.file;
    const list = f && this.shown ? this.placed() : [];
    const gutter = list.length ? COLUMN : 0;
    if (gutter !== this.view.gutter) {
      this.view.gutter = gutter;
      this.view.sizeSpace();
      // when the page and the comments don't both fit, zoom out so they do (as Word does)
      if (gutter && this.view.overflows()) this.view.fitWidth();
      this.view.redraw();
    }
    this.layer.hidden = !list.length;
    if (!f || !list.length) { this.layer.replaceChildren(); this.cards.clear(); this.built = null; return; }
    const b = this.built;
    if (!b || b.t !== f.t || b.active !== this.active || b.editing !== this.editing || b.shown !== this.shown) {
      this.layer.replaceChildren();
      this.cards.clear();
      for (const p of list) {
        const card = threadCard(p.c, { active: p.id === this.active, editing: p.id === this.editing, actions: this.actions(p.id) });
        this.cards.set(p.id, card);
        this.layer.append(card);
      }
      this.built = { t: f.t, active: this.active, editing: this.editing, shown: this.shown };
    }
    this.place(list);
  }

  /** Put each card beside its words. */
  place(list = this.placed()): void {
    if (!this.cards.size) return;
    const host = this.layer.parentElement!.getBoundingClientRect();
    const left = this.view.toScreen(this.view.pageWidth(), 0).x + 14;
    this.layer.style.left = `${left}px`;
    this.layer.style.maxWidth = `${Math.max(0, host.width - left)}px`;
    this.layer.style.width = `${COLUMN - 24}px`;
    const want: number[] = [], heights: number[] = [], cards: HTMLElement[] = [];
    let active = -1;
    for (const p of list) {
      const card = this.cards.get(p.id);
      if (!card) continue;
      const r = this.view.rangeRects(p.start, p.end)[0];
      want.push(r ? this.view.toScreen(0, r.y1).y : 0);
      heights.push(card.offsetHeight);
      if (p.id === this.active) active = cards.length;
      cards.push(card);
    }
    const tops = stackCards(want, heights, active);
    cards.forEach((c, i) => { c.style.top = `${tops[i]}px`; });
  }

  // ---------------------------------------------------------------- changes

  private change(t: DocText, kind: string | null): void {
    this.file!.ed.update(t, kind);
  }

  private withComments(t: DocText, comments: Record<number, CommentThread>): DocText {
    return { ...t, comments: Object.keys(comments).length ? comments : undefined };
  }

  private setThread(id: number, patch: (c: CommentThread) => CommentThread, kind: string): void {
    const f = this.file;
    const c = f?.t.comments?.[id];
    if (!f || !c) return;
    this.change(this.withComments(f.t, { ...f.t.comments, [id]: patch(c) }), kind);
  }

  private actions(id: number): ThreadActions {
    const note = (text: string) => ({ author: reviewAuthor() || 'Author', date: revisionDate(), text });
    return {
      edit: (text, reply) => {
        this.editing = null;
        this.setThread(id, (c) => {
          if (reply === undefined) return c.text === text ? c : { ...c, text };
          const replies = [...(c.replies ?? [])];
          if (replies[reply]) replies[reply] = { ...replies[reply], text };
          return { ...c, replies };
        }, 'Edit comment');
        this.update();
        this.h.focus();
      },
      reply: async (text) => {
        if (!reviewAuthor() && !(await this.h.askName())) return;
        this.setThread(id, (c) => ({ ...c, replies: [...(c.replies ?? []), note(text)] }), 'Reply to comment');
        this.active = id;
        this.update();
      },
      removeReply: (i) => this.setThread(id, (c) => ({ ...c, replies: (c.replies ?? []).filter((_, k) => k !== i) }), 'Delete reply'),
      resolve: (done) => this.setThread(id, (c) => ({ ...c, done: done || undefined }), done ? 'Resolve comment' : 'Reopen comment'),
      remove: () => this.remove(id),
      focus: () => this.goTo(id),
      // a new comment left empty goes as if never made (one step with its making, for Undo)
      cancelNew: () => { this.editing = null; this.remove(id, null); this.h.focus(); },
    };
  }

  /** Review > New Comment: on the selection, or on the word at the caret. */
  async add(): Promise<void> {
    const f = this.file;
    if (!f) return;
    if (!reviewAuthor() && !(await this.h.askName())) return;
    const ed = f.ed;
    const span = commentSpan(plainText(ed.t.runs), ed.start, ed.end);
    if (!span) { this.h.flash('Type or select some text first: a comment goes on the words it is about.'); return; }
    const id = nextCommentId(f.t.comments);
    const c: CommentThread = { author: reviewAuthor() || 'Author', date: revisionDate(), text: '' };
    const t = this.withComments({ ...f.t, runs: markComment(f.t.runs, span[0], span[1], id) }, { ...f.t.comments, [id]: c });
    this.shown = true;
    this.active = id;
    this.editing = id;
    this.change(t, 'New comment');
    this.update();
  }

  /** Delete a comment (the one looked at, when none is named). `kind` null joins the last Undo step. */
  remove(id = this.active, kind: string | null = 'Delete comment'): void {
    const f = this.file;
    if (!f || id === null || !f.t.comments?.[id]) { if (id === null) this.h.flash('Click in a comment’s words, or on its card, first.'); return; }
    const { [id]: _, ...rest } = f.t.comments;
    if (this.active === id) this.active = null;
    this.change(this.withComments({ ...f.t, runs: unmarkComment(f.t.runs, id) }, rest), kind);
    this.update();
  }

  /** Delete every comment in the document. */
  removeAll(): void {
    const f = this.file;
    if (!f || !f.t.comments) { this.h.flash('There are no comments.'); return; }
    let runs = f.t.runs;
    for (const id of Object.keys(f.t.comments)) runs = unmarkComment(runs, Number(id));
    this.active = null;
    this.change({ ...f.t, runs, comments: undefined }, 'Delete all comments');
    this.update();
  }

  /** Mark the comment looked at as resolved (or open again). */
  toggleResolved(): void {
    const id = this.active;
    const c = id !== null ? this.file?.t.comments?.[id] : undefined;
    if (id === null || !c) { this.h.flash('Click in a comment’s words, or on its card, first.'); return; }
    this.setThread(id, (x) => ({ ...x, done: !x.done || undefined }), c.done ? 'Reopen comment' : 'Resolve comment');
    this.update();
  }

  /** Select a comment's words and look at it. */
  goTo(id: number): void {
    const f = this.file;
    const p = this.placed().find((x) => x.id === id);
    if (!f || !p) return;
    f.endBox();
    this.active = id;
    f.ed.select(p.start, p.end);
    const r = this.view.rangeRects(p.start, p.end)[0];
    if (r) this.view.reveal(r, 80);
    this.update();
  }

  /** The next comment after the caret (or the one before it). */
  step(forward: boolean): void {
    const f = this.file;
    const list = this.placed();
    if (!f || !list.length) { this.h.flash('There are no comments.'); return; }
    const at = f.ed.start;
    const cur = this.active !== null ? list.findIndex((p) => p.id === this.active) : -1;
    let next: (typeof list)[number] | undefined;
    if (cur >= 0) next = list[(cur + (forward ? 1 : list.length - 1)) % list.length];
    else next = forward ? list.find((p) => p.start > at) ?? list[0] : [...list].reverse().find((p) => p.start < at) ?? list[list.length - 1];
    this.goTo(next.id);
    this.h.focus();
  }

  /** Review > Show Comments. */
  toggleShown(): void {
    this.shown = !this.shown;
    this.update();
    this.view.redraw();
  }
}
