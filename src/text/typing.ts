// Chemistry help while typing: replacements (oC → °C, -> → →) and formatting (CH2Cl2 → CH₂Cl₂,
// 1H NMR → ¹H NMR, DMSO-d6 with an italic d) when a word is finished, each its own undo step
// so Ctrl+Z takes back just that. Both can be switched off, and the replacements changed, in
// Edit > Typing and Spelling.

import type { TextEditing } from './editing';
import { DEFAULT_REPLACEMENTS, WORD_ENDS, nameFormats, replacementAt, typingFormats } from './chemtext';
import { linkOfChar, typedLink, typedLinkLength } from '../links';

/** The text since the last space, tab or line break before `end`. */
function tokenBefore(text: string, end: number): { from: number; word: string } {
  let from = end;
  while (from > 0 && !/\s/.test(text[from - 1])) from--;
  return { from, word: text.slice(from, end) };
}

/** Something being typed that will be a web address, a DOI or an e-mail address: left alone until it is finished. */
const LINKISH = /^(https?:|ftp:|www\.|doi:|mailto:)|@/i;

/** A web address, DOI or e-mail address just finished becomes a link (its own undo step). */
function autoLink(ed: TextEditing, end: number): void {
  const { from, word } = tokenBefore(ed.text, end);
  const link = typedLink(word);
  if (!link || linkOfChar(ed.t.runs, from) !== undefined) return;
  const to = from + typedLinkLength(word);
  const [a, f] = [ed.anchor, ed.focus];
  ed.select(from, to);
  ed.setLink(link);
  ed.select(a, f);
}

export interface TypingPrefs {
  /** Format chemistry as words are finished. */
  chemistry: boolean;
  /** Replacements made as you type: [typed, replaced by]. */
  replacements: [string, string][];
  /** Underline misspelled words and chemistry formatting slips. */
  spelling: boolean;
  /** The person's own words for the spelling check. */
  dictionary: string[];
  /** Stereodescriptors in front of a name in italics as it is typed: (S)-proline. */
  stereoItalic: boolean;
  /** Compound numbers in bold as they are typed: (4), compound 4a. */
  boldNumbers: boolean;
  /** Web addresses, doi: and e-mail addresses become links as they are typed (Word's AutoFormat). */
  links: boolean;
  /** Links open with Ctrl+click (Word's way), or with a plain click outside the text being typed. */
  linkCtrlClick: boolean;
}

export const DEFAULT_TYPING: TypingPrefs = { chemistry: true, replacements: DEFAULT_REPLACEMENTS.map(([a, b]) => [a, b]), spelling: true, dictionary: [], stereoItalic: true, boldNumbers: false, links: true, linkCtrlClick: true };

/** The current preferences (main.ts fills these in from the settings file). */
export const typingPrefs: TypingPrefs = { ...DEFAULT_TYPING, replacements: [...DEFAULT_TYPING.replacements], dictionary: [] };

/** After text is typed: if it ends a word, make that word's replacement and chemistry formatting. */
export function afterTyping(ed: TextEditing, typed: string, prefs: TypingPrefs = typingPrefs): void {
  if (typed.length !== 1 || !WORD_ENDS.includes(typed) || !ed.collapsed) return;
  let end = ed.focus - 1;
  // a web address or e-mail address being typed: no replacements or chemistry inside it, and
  // once a space or a line break ends it, it becomes a link
  const token = tokenBefore(ed.text, /\s/.test(typed) ? end : ed.focus);
  if (LINKISH.test(token.word) || linkOfChar(ed.t.runs, token.from) !== undefined) {
    if (prefs.links && /\s/.test(typed)) autoLink(ed, end);
    return;
  }
  if (prefs.replacements.length) {
    const r = replacementAt(ed.text, end, prefs.replacements);
    if (r) {
      ed.fix([{ start: r[0], end, text: r[1] }], 'replace');
      end = r[0] + r[1].length;
    }
  }
  if (prefs.chemistry) formatWord(ed, end);
  if (prefs.stereoItalic || prefs.boldNumbers) {
    // its own undo step, so Ctrl+Z straight after takes back just this
    const from = Math.max(0, ed.text.lastIndexOf('\n', end - 1) + 1, end - 40);
    const edits = nameFormats(ed.text.slice(from, end + 1), end - from, { stereo: prefs.stereoItalic, numbers: prefs.boldNumbers });
    if (edits.length) ed.fix(edits.map((e) => ({ ...e, start: e.start + from, end: e.end + from })), 'format');
  }
}

/** How far back the chemistry rules look for the word just finished: they need it and the word before. */
const LOOK_BACK = 300;

/**
 * Format the word ending at `end`, looking only at its paragraph (at most LOOK_BACK characters
 * of it), so a long document isn't searched on every space.
 */
function formatWord(ed: TextEditing, end: number): void {
  const text = ed.text;
  let from = text.lastIndexOf('\n', end - 1) + 1;
  if (end - from > LOOK_BACK) {
    // start after a space, never in the middle of a word
    const cut = text.slice(end - LOOK_BACK, end).search(/\s/);
    if (cut >= 0) from = end - LOOK_BACK + cut + 1;
  }
  const looks = ed.looksBetween(from, end + 1);
  const edits = typingFormats(text.slice(from, end + 1), end - from, (i) => looks[i] ?? { pos: 'base', italic: false });
  if (edits.length) ed.fix(edits.map((e) => ({ ...e, start: e.start + from, end: e.end + from })), 'format');
}

/**
 * A word finished without a word-ending key (Tab on to the next table cell, or the text box
 * closed): make its replacement and chemistry formatting as if a space had been typed.
 */
export function finishWord(ed: TextEditing, prefs: TypingPrefs = typingPrefs): void {
  if (!ed.collapsed || ed.composing !== null) return;
  const text = ed.text;
  let end = ed.focus;
  // only at the end of a word, not in the middle of one or after a space
  if (end === 0 || /\s/.test(text[end - 1]) || (end < text.length && !/\s/.test(text[end]) && !WORD_ENDS.includes(text[end]))) return;
  const token = tokenBefore(text, end);
  if (LINKISH.test(token.word) || linkOfChar(ed.t.runs, token.from) !== undefined) {
    if (prefs.links) autoLink(ed, end);
    return;
  }
  if (prefs.replacements.length) {
    const r = replacementAt(text, end, prefs.replacements);
    if (r) {
      ed.fix([{ start: r[0], end, text: r[1] }], 'replace');
      end = r[0] + r[1].length;
    }
  }
  if (prefs.chemistry) formatWord(ed, end);
}

const listeners = new Set<() => void>();

/** Be told when the preferences change (to save them, or redraw underlines). */
export function onTypingPrefs(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

/** Change the preferences. */
export function setTypingPrefs(p: Partial<TypingPrefs>): void {
  Object.assign(typingPrefs, p);
  for (const f of listeners) f();
}
