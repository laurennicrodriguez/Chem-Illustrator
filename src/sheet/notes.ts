// Notes and comments on cells, as Excel has them (Review > New Note, New Comment). A note is a
// sticky note: who wrote it and what it says, shown when the pointer is over its cell (or all the
// time, with Show Note). A comment is a conversation: its first note, the replies under it, and
// a Resolved mark. Each cell holds one or the other, marked by a triangle in its top right corner
// (red for a note, purple for a comment).

import type { CommentThread } from '../document/comments';

export interface CellNote extends CommentThread {
  kind: 'note' | 'comment';
  /** A note shown all the time, not only when the pointer is over its cell. */
  shown?: boolean;
}

/** A note copied (for the undo history and pasting). */
export function copyNote(n: CellNote): CellNote {
  return { ...n, ...(n.replies ? { replies: n.replies.map((r) => ({ ...r })) } : {}) };
}

/** A comment as plain text, replies as lines under it (for programs that show only notes). */
export function noteText(n: CellNote): string {
  if (!n.replies?.length) return n.text;
  return [n.text, ...n.replies.map((r) => `${r.author || 'Reply'}: ${r.text}`)].join('\n');
}
