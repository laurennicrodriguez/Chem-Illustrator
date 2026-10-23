// Where English words may be hyphenated at the end of a line (Layout > Hyphenation in Document
// mode): Frank Liang's US English patterns for TeX, as the hyphen package gives them. Words are
// looked up once and remembered.

import hyphen from 'hyphen/en-us/index.js';
import type { Hyphenation } from './layout';

const SOFT = '­';
const known = new Map<string, number[]>();

/** The places a word may be broken (offsets into it), from the patterns. */
export function hyphenPoints(word: string): number[] {
  let got = known.get(word);
  if (got) return got;
  got = [];
  const marked = hyphen.hyphenateSync(word.toLowerCase(), { hyphenChar: SOFT, minWordLength: 5 });
  let at = 0;
  for (const ch of marked) {
    if (ch === SOFT) got.push(at);
    else at += ch.length;
  }
  if (known.size > 20000) known.clear();
  known.set(word, got);
  return got;
}

/** A document's hyphenation settings, as saved in Word's settings.xml. */
export interface DocHyphenation {
  /** Automatic hyphenation on (Layout > Hyphenation > Automatic). */
  auto: boolean;
  /** Hyphenation zone in points (Word's default is a quarter of an inch). */
  zone?: number;
  /** Most lines in a row ending in a hyphen (0 or none: no limit). */
  limit?: number;
  /** Hyphenate words in capitals (on in Word unless turned off). */
  caps?: boolean;
}

export const DEFAULT_ZONE = 18;

/** The layout's hyphenation for a document's settings, or undefined when it is off. */
export function hyphenation(h: DocHyphenation | undefined): Hyphenation | undefined {
  if (!h?.auto) return undefined;
  return { points: hyphenPoints, zone: h.zone ?? DEFAULT_ZONE, limit: h.limit ?? 0, caps: h.caps !== false };
}
