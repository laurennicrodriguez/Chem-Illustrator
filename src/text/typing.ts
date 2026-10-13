// Chemistry help while typing: replacements (oC → °C, -> → →) and formatting (CH2Cl2 → CH₂Cl₂,
// 1H NMR → ¹H NMR, DMSO-d6 with an italic d) when a word is finished, each its own undo step
// so Ctrl+Z takes back just that. Both can be switched off, and the replacements changed, in
// Edit > Typing and Spelling.

import type { TextEditing } from './editing';
import { DEFAULT_REPLACEMENTS, WORD_ENDS, replacementAt, typingFormats } from './chemtext';

export interface TypingPrefs {
  /** Format chemistry as words are finished. */
  chemistry: boolean;
  /** Replacements made as you type: [typed, replaced by]. */
  replacements: [string, string][];
  /** Underline misspelled words and chemistry formatting slips. */
  spelling: boolean;
  /** The person's own words for the spelling check. */
  dictionary: string[];
}

export const DEFAULT_TYPING: TypingPrefs = { chemistry: true, replacements: DEFAULT_REPLACEMENTS.map(([a, b]) => [a, b]), spelling: true, dictionary: [] };

/** The current preferences (main.ts fills these in from the settings file). */
export const typingPrefs: TypingPrefs = { ...DEFAULT_TYPING, replacements: [...DEFAULT_TYPING.replacements], dictionary: [] };

/** After text is typed: if it ends a word, make that word's replacement and chemistry formatting. */
export function afterTyping(ed: TextEditing, typed: string, prefs: TypingPrefs = typingPrefs): void {
  if (typed.length !== 1 || !WORD_ENDS.includes(typed) || !ed.collapsed) return;
  let end = ed.focus - 1;
  if (prefs.replacements.length) {
    const r = replacementAt(ed.text, end, prefs.replacements);
    if (r) {
      ed.fix([{ start: r[0], end, text: r[1] }], 'replace');
      end = r[0] + r[1].length;
    }
  }
  if (prefs.chemistry) {
    const looks = ed.looks();
    const edits = typingFormats(ed.text, end, (i) => looks[i] ?? { pos: 'base', italic: false });
    if (edits.length) ed.fix(edits, 'format');
  }
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
