// Insert > Symbol: finding a character by name, by group or by its code, and the list of the
// ones used lately (kept in the settings, newest first, as Word's Recently Used row).

import { SYMBOL_GROUPS, SYMBOL_TABLE } from './symbol-table';

export { SYMBOL_GROUPS };

export interface SymbolInfo {
  ch: string;
  /** Its Unicode name, with the words chemists look for added (degree, angstrom, equilibrium). */
  name: string;
  /** The group it is listed in first. */
  group: string;
}

/** How many recently used symbols are kept. */
export const RECENT_MAX = 24;

const byChar = new Map<string, SymbolInfo>();
for (const [ch, name, group] of SYMBOL_TABLE) if (!byChar.has(ch)) byChar.set(ch, { ch, name, group });

/** Every listed symbol once, in the order of the groups. */
export const ALL_SYMBOLS: SymbolInfo[] = [...byChar.values()];

/** The symbols of a group, in order. */
export function groupSymbols(group: string): SymbolInfo[] {
  return SYMBOL_TABLE.filter((x) => x[2] === group).map(([ch]) => byChar.get(ch)!);
}

/** U+00B0 for °. */
export function codeOf(ch: string): string {
  return 'U+' + (ch.codePointAt(0) ?? 0).toString(16).toUpperCase().padStart(4, '0');
}

/** What is known about a character: its listed name, or just its code for one not listed. */
export function symbolInfo(ch: string): SymbolInfo {
  return byChar.get(ch) ?? { ch, name: '', group: '' };
}

/**
 * A character typed as its code: U+00B0, u+b0, 0x00B0, &#176; or &#xB0; (Word's Character code box
 * takes the hex digits alone, so 00B0 is read too: four to six hex digits with a number among them,
 * so that a word such as "face" stays a word). Null when the text isn't a code.
 */
export function charFromCode(text: string): string | null {
  const t = text.trim();
  let m = /^(?:u\+|0x|&#x)([0-9a-f]{1,6});?$/i.exec(t);
  let n = m ? parseInt(m[1], 16) : NaN;
  if (!m) {
    m = /^&#([0-9]{1,7});?$/.exec(t);
    if (m) n = parseInt(m[1], 10);
  }
  if (!m && /^(?=.*\d)[0-9a-f]{4,6}$/i.test(t)) n = parseInt(t, 16);
  if (!isFinite(n) || n < 0x20 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff) || (n >= 0x7f && n < 0xa0)) return null;
  return String.fromCodePoint(n);
}

/**
 * Symbols whose name (or the character itself, or its code) matches what was typed. Every word
 * typed has to be found, at the start of a word of the name ("deg" finds °, "arrow right"
 * finds →); names that start with the first word come first.
 */
export function searchSymbols(query: string): SymbolInfo[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const exact = [...q].length === 1 ? q : null;
  const code = charFromCode(q);
  const words = q.split(/\s+/);
  const found: { s: SymbolInfo; rank: number }[] = [];
  for (const s of ALL_SYMBOLS) {
    if (s.ch === exact || s.ch.toLowerCase() === exact || s.ch === code) { found.push({ s, rank: 0 }); continue; }
    const names = s.name.split(' ');
    if (!words.every((w) => names.some((n) => n.startsWith(w)))) continue;
    found.push({ s, rank: names[0].startsWith(words[0]) ? 1 : names.includes(words[0]) ? 2 : 3 });
  }
  // a character typed or coded that isn't in the list is still offered
  for (const ch of [exact, code]) if (ch && !byChar.has(ch) && !found.some((f) => f.s.ch === ch)) found.unshift({ s: symbolInfo(ch), rank: 0 });
  return found.sort((a, b) => a.rank - b.rank).map((f) => f.s);
}

/** The recently used list with `ch` put first. */
export function addRecent(recent: readonly string[], ch: string): string[] {
  return [ch, ...recent.filter((x) => x !== ch)].slice(0, RECENT_MAX);
}

/** A recently used list read from the settings: single characters only, no repeats. */
export function parseRecent(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const x of raw) if (typeof x === 'string' && [...x].length === 1 && !out.includes(x)) out.push(x);
  return out.slice(0, RECENT_MAX);
}
