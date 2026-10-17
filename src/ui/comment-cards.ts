// A comment's card, as in Word's and PowerPoint's comment panes: who wrote it and when, its text,
// the replies under it, a box to reply, and Resolve and Delete. Documents show the cards beside
// the page next to their words; slides list them in a pane beside the slide. Each change goes
// back through `actions`, so it is one step of the file's Undo.

import { initials, shortDate, type CommentThread } from '../document/comments';

export interface ThreadActions {
  /** Change the comment's own text, or a reply's (by its place in the replies). */
  edit(text: string, reply?: number): void;
  reply(text: string): void;
  /** Take away a reply. */
  removeReply(i: number): void;
  resolve(done: boolean): void;
  remove(): void;
  /** The card was clicked: show what it is on. */
  focus(): void;
  /** A new comment was left empty: take it away again. */
  cancelNew?(): void;
}

/** A colour for a name, so each person's comments look alike. */
export function authorColour(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return `hsl(${h}, 55%, 42%)`;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** A text box for a note: Enter saves (Shift+Enter starts a new line), Escape stops. */
function noteBox(value: string, placeholder: string, save: (text: string) => void, stop: () => void): HTMLTextAreaElement {
  const ta = el('textarea', 'cmt-input');
  ta.value = value;
  ta.placeholder = placeholder;
  ta.rows = Math.min(8, Math.max(2, value.split('\n').length));
  ta.spellcheck = true;
  let done = false;
  const finish = (keep: boolean) => {
    if (done) return;
    done = true;
    if (keep) save(ta.value.replace(/\s+$/, ''));
    else stop();
  };
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); }
    else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  });
  ta.addEventListener('input', () => { ta.rows = Math.min(8, Math.max(2, ta.value.split('\n').length)); });
  ta.addEventListener('blur', () => finish(true));
  // keys typed here are the comment's, not the page's
  for (const ev of ['keyup', 'keypress', 'paste', 'copy', 'cut'] as const) ta.addEventListener(ev, (e) => e.stopPropagation());
  return ta;
}

function header(author: string, date: string): HTMLElement {
  const h = el('div', 'cmt-head');
  const badge = el('span', 'cmt-badge', initials(author) || '?');
  badge.style.background = authorColour(author);
  const who = el('span', 'cmt-who', author || 'Author');
  const when = el('span', 'cmt-when', shortDate(date));
  when.title = new Date(date).toLocaleString();
  h.append(badge, who, when);
  return h;
}

function body(text: string): HTMLElement {
  const p = el('div', 'cmt-text');
  p.textContent = text;
  return p;
}

/**
 * The card for a comment. `editing` opens its text for typing (a new comment, or after Edit);
 * `active` marks the one whose words are shown.
 */
export function threadCard(c: CommentThread, opts: { active: boolean; editing: boolean; actions: ThreadActions; label?: string }): HTMLElement {
  const a = opts.actions;
  const card = el('div', 'cmt-card' + (opts.active ? ' active' : '') + (c.done ? ' done' : ''));
  card.tabIndex = -1;
  card.addEventListener('mousedown', (e) => { if (!(e.target as HTMLElement).closest('textarea, button')) a.focus(); });

  const first = el('div', 'cmt-note');
  first.append(header(c.author, c.date));
  if (opts.label) first.prepend(el('div', 'cmt-label', opts.label));
  if (opts.editing) {
    const ta = noteBox(c.text, 'Type your comment', (t) => (t.trim() ? a.edit(t) : a.cancelNew ? a.cancelNew() : a.remove()), () => (!c.text.trim() ? (a.cancelNew ?? a.remove)() : a.edit(c.text)));
    first.append(ta);
    queueMicrotask(() => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); });
  } else {
    first.append(body(c.text));
  }
  card.append(first);
  if (c.done) card.append(el('div', 'cmt-resolved', 'Resolved'));

  (c.replies ?? []).forEach((r, i) => {
    const n = el('div', 'cmt-note cmt-reply');
    n.append(header(r.author, r.date), body(r.text));
    const tools = el('div', 'cmt-tools');
    const edit = el('button', 'cmt-link', 'Edit');
    edit.type = 'button';
    edit.addEventListener('click', () => {
      const text = n.querySelector('.cmt-text')!;
      const ta = noteBox(r.text, 'Reply', (t) => (t.trim() ? a.edit(t, i) : a.removeReply(i)), () => a.edit(r.text, i));
      text.replaceWith(ta);
      tools.remove();
      ta.focus();
    });
    const del = el('button', 'cmt-link', 'Delete');
    del.type = 'button';
    del.addEventListener('click', () => a.removeReply(i));
    tools.append(edit, del);
    n.append(tools);
    card.append(n);
  });

  if (!opts.editing) {
    const bar = el('div', 'cmt-bar');
    const reply = el('button', 'cmt-btn', 'Reply');
    reply.type = 'button';
    reply.title = 'Answer this comment';
    reply.addEventListener('click', () => {
      bar.hidden = true;
      const ta = noteBox('', 'Reply', (t) => { if (t.trim()) a.reply(t); else bar.hidden = false; }, () => { ta.remove(); bar.hidden = false; });
      card.insertBefore(ta, bar);
      ta.focus();
    });
    const resolve = el('button', 'cmt-btn', c.done ? 'Reopen' : 'Resolve');
    resolve.type = 'button';
    resolve.title = c.done ? 'Mark the comment as still open' : 'Mark the comment as dealt with (it stays, greyed, until deleted)';
    resolve.addEventListener('click', () => a.resolve(!c.done));
    const edit = el('button', 'cmt-btn', 'Edit');
    edit.type = 'button';
    edit.title = 'Change the comment’s text';
    edit.addEventListener('click', () => {
      const text = first.querySelector('.cmt-text')!;
      const ta = noteBox(c.text, 'Type your comment', (t) => (t.trim() ? a.edit(t) : a.edit(c.text)), () => a.edit(c.text));
      text.replaceWith(ta);
      bar.hidden = true;
      ta.focus();
    });
    const del = el('button', 'cmt-btn', 'Delete');
    del.type = 'button';
    del.title = 'Delete the comment and its replies';
    del.addEventListener('click', () => a.remove());
    bar.append(reply, resolve, edit, del);
    card.append(bar);
  }
  return card;
}

/**
 * Cards in a column, each as near as it can be to the height of what it is on (`want`, pixels
 * from the column's top), without overlapping: the active card sits at its own height and the
 * others move out of its way, as Word's do. Gives each card's top.
 */
export function stackCards(want: number[], heights: number[], active: number, gap = 8): number[] {
  const n = want.length;
  const top = new Array<number>(n).fill(0);
  if (!n) return top;
  const a = active >= 0 && active < n ? active : 0;
  top[a] = want[a];
  for (let i = a + 1; i < n; i++) top[i] = Math.max(want[i], top[i - 1] + heights[i - 1] + gap);
  for (let i = a - 1; i >= 0; i--) top[i] = Math.min(want[i], top[i + 1] - heights[i] - gap);
  return top;
}
