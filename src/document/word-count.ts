// Review > Word Count, as Word's: pages, words, characters (with and without spaces), paragraphs
// and lines, of the selection or the whole document, with or without what is in text boxes,
// footnotes and endnotes. Words are runs of letters or digits between spaces (so "CH2Cl2" and
// "2,4-dinitrophenyl" are one word each, as Word counts them).

import type { TextRun } from '../model';
import { OBJECT_CHAR, flatRuns, type DocText } from './document';

export interface TextCounts {
  words: number;
  /** Characters without spaces, and with them. */
  chars: number;
  charsWithSpaces: number;
  /** Paragraphs with something in them. */
  paras: number;
}

export interface DocCounts extends TextCounts {
  pages: number;
  lines: number;
}

const WORD = /\p{L}|\p{N}/u;

/** The counts of a piece of plain text (figures and other objects left out). */
export function countText(text: string): TextCounts {
  const clean = text.split(OBJECT_CHAR).join('');
  const words = clean.split(/\s+/).filter((w) => WORD.test(w)).length;
  const lines = clean.split('\n');
  const body = lines.join('');
  return {
    words,
    chars: body.replace(/\s/g, '').length,
    charsWithSpaces: body.replace(/[\r\t]/g, ' ').length,
    paras: lines.filter((l) => l.trim()).length,
  };
}

export const addCounts = (a: TextCounts, b: TextCounts): TextCounts => ({ words: a.words + b.words, chars: a.chars + b.chars, charsWithSpaces: a.charsWithSpaces + b.charsWithSpaces, paras: a.paras + b.paras });

const textOf = (runs: TextRun[]) => runs.map((r) => (r.obj !== undefined ? '' : r.text)).join('');

/**
 * The counts of a document: its text and the text in its tables, with the text of its text boxes
 * and notes when `extras` is on. `range` counts only the selected text (from the text itself).
 */
export function countDocument(t: Pick<DocText, 'runs' | 'objects'>, extras: boolean, range?: [number, number]): TextCounts {
  let out: TextCounts;
  if (range) {
    const text = t.runs.map((r) => r.text).join('').slice(range[0], range[1]);
    out = countText(text);
  } else out = countText(textOf(flatRuns(t)));
  if (!extras || range) return out;
  for (const o of Object.values(t.objects)) {
    if (o.kind === 'textbox' || o.kind === 'note') out = addCounts(out, countText(textOf(o.runs)));
  }
  return out;
}
