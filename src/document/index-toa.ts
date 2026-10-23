// An index and a table of authorities, as in Word (References > Mark Entry and Insert Index,
// Mark Citation and Insert Table of Authorities). Words and phrases are marked where they come
// up: each mark is kept on its paragraph (ParaStyle.xe and .ta, Word's XE and TA fields), so it
// moves with the text. The index lists the marked entries A to Z, with subentries under them
// and the pages they are on; the table of authorities lists the marked citations (cases,
// statutes, rules…) by category, each with its pages. Like the contents, both are worked out
// again whenever the text changes, with page numbers from laying the document out.

import type { AuthorityMark, IndexMark, ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { withStack, layoutText, type Glyphs, type LaidLine, type Measure } from '../text/layout';
import { fitParas, paraCount } from '../text/paragraphs';
import type { DocText, NamedStyle } from './document';

/** Word's categories of authorities, numbered from 1 as in its Mark Citation window (Word's own 8 to 16 have no names). */
export const TOA_CATEGORIES = ['Cases', 'Statutes', 'Other Authorities', 'Rules', 'Treatises', 'Regulations', 'Constitutional Provisions'];

/** A category's name (its number, from 8 up). */
export const categoryName = (cat: number): string => TOA_CATEGORIES[cat - 1] ?? String(cat);

/** One page of an entry: its number as printed, in bold or italic when marked so. */
export interface PageRef { label: string; bold?: boolean; italic?: boolean }

/** A line of an index or table of authorities before it is laid out. */
export interface ListItem {
  /** 0: a heading (a letter, a category); 1: an entry; 2: a subentry. */
  level: number;
  text: string;
  pages: PageRef[];
  /** A cross-reference in place of (or after) the pages: "See Enolates". */
  see?: string;
  /** The paragraphs it is marked in (for going to it, and for working out its pages again). */
  paras: number[];
}

/** Where the marks are: each paragraph's index entries and citations. */
function marksOf(t: Pick<DocText, 'runs' | 'paras'>): ParaStyle[] {
  return fitParas(t.paras, paraCount(rt.plainText(t.runs)));
}

const key = (s: string) => s.trim().toLocaleLowerCase();
const collate = new Intl.Collator(undefined, { sensitivity: 'base', numeric: true });

/** Pages in the order of the text, each once (a bold or italic mark makes its page so). */
function pagesFor(marks: { para: number; bold?: boolean; italic?: boolean }[], pageOf: (para: number) => string): PageRef[] {
  const out = new Map<string, PageRef>();
  for (const m of [...marks].sort((a, b) => a.para - b.para)) {
    const label = pageOf(m.para);
    if (!label) continue;
    const got = out.get(label) ?? { label };
    if (m.bold) got.bold = true;
    if (m.italic) got.italic = true;
    out.set(label, got);
  }
  return [...out.values()];
}

/** The letter an entry is filed under (its first letter, or # for numbers and signs). */
export function indexLetter(text: string): string {
  const ch = text.trim().charAt(0).toLocaleUpperCase();
  return /\p{L}/u.test(ch) ? ch.normalize('NFD').charAt(0) : '#';
}

/**
 * The index's lines: each entry A to Z (as the language sorts, ignoring case and accents), its
 * pages, and under it its subentries with theirs; a letter heading over each letter's entries
 * when `letters`.
 */
export function indexItems(t: Pick<DocText, 'runs' | 'paras'>, pageOf: (para: number) => string, letters = false): ListItem[] {
  type Main = { text: string; marks: { para: number; bold?: boolean; italic?: boolean }[]; see?: string; subs: Map<string, Main> };
  const mains = new Map<string, Main>();
  marksOf(t).forEach((ps, para) => {
    for (const m of ps.xe ?? []) {
      if (!m.main.trim()) continue;
      let e = mains.get(key(m.main));
      if (!e) { e = { text: m.main.trim(), marks: [], subs: new Map() }; mains.set(key(m.main), e); }
      if (m.sub?.trim()) {
        let s = e.subs.get(key(m.sub));
        if (!s) { s = { text: m.sub.trim(), marks: [], subs: new Map() }; e.subs.set(key(m.sub), s); }
        e = s;
      }
      if (m.see?.trim()) e.see ??= m.see.trim();
      else e.marks.push({ para, bold: m.bold, italic: m.italic });
    }
  });
  const sorted = (m: Map<string, Main>) => [...m.values()].sort((a, b) => collate.compare(a.text, b.text));
  const out: ListItem[] = [];
  let letter = '';
  for (const e of sorted(mains)) {
    const l = indexLetter(e.text);
    if (letters && l !== letter) { out.push({ level: 0, text: l === '#' ? 'Symbols' : l, pages: [], paras: [] }); letter = l; }
    out.push({ level: 1, text: e.text, pages: pagesFor(e.marks, pageOf), see: e.see, paras: e.marks.map((x) => x.para) });
    for (const s of sorted(e.subs)) out.push({ level: 2, text: s.text, pages: pagesFor(s.marks, pageOf), see: s.see, paras: s.marks.map((x) => x.para) });
  }
  return out;
}

/** The citations marked for a table of authorities, each once: its long form (from the mark that gives one) and category, and where it is marked. */
export interface Authority { short: string; long: string; cat: number; paras: number[] }

export function authorities(t: Pick<DocText, 'runs' | 'paras'>): Authority[] {
  const got = new Map<string, Authority>();
  marksOf(t).forEach((ps, para) => {
    for (const m of ps.ta ?? []) {
      const short = m.short.trim() || m.long?.trim() || '';
      if (!short) continue;
      let a = got.get(key(short));
      if (!a) { a = { short, long: '', cat: 0, paras: [] }; got.set(key(short), a); }
      if (m.long?.trim() && !a.long) a.long = m.long.trim();
      if (m.cat && !a.cat) a.cat = m.cat;
      a.paras.push(para);
    }
  });
  for (const a of got.values()) { if (!a.long) a.long = a.short; if (!a.cat) a.cat = 1; }
  return [...got.values()];
}

/** How many pages make "passim" (Word's: five or more). */
export const PASSIM = 5;

/** The table of authorities' lines: each category asked for (all when 0) under its heading, its citations A to Z with their pages. */
export function toaItems(t: Pick<DocText, 'runs' | 'paras'>, cat: number, pageOf: (para: number) => string, passim = false): ListItem[] {
  const all = authorities(t);
  const cats = cat ? [cat] : [...new Set(all.map((a) => a.cat))].sort((a, b) => a - b);
  const out: ListItem[] = [];
  for (const c of cats) {
    const mine = all.filter((a) => a.cat === c).sort((a, b) => collate.compare(a.long, b.long));
    if (!mine.length && !cat) continue;
    out.push({ level: 0, text: categoryName(c), pages: [], paras: [] });
    for (const a of mine) {
      const pages = pagesFor(a.paras.map((para) => ({ para })), pageOf);
      out.push({ level: 1, text: a.long, pages: passim && pages.length >= PASSIM ? [{ label: 'passim', italic: true }] : pages, paras: a.paras });
    }
  }
  return out;
}

/** What an index shows when nothing is marked yet (on screen and in the PDF only). */
export const EMPTY_INDEX = 'Index: no entries marked yet. Select a word and choose References > Mark Entry (Alt+Shift+X), and it appears here with its page numbers.';
export function emptyToa(cat: number): string {
  return `Table of authorities: no ${cat ? `${categoryName(cat).toLowerCase()} ` : ''}citations marked yet. Select one and choose References > Mark Citation (Alt+Shift+I), and it appears here with its pages.`;
}

/** How far each level is indented, and how far an entry's lines after its first hang in (as Word's Index 1 and 2). */
export const INDEX_INDENT = 14;

/**
 * The lines laid out `wrap` wide: headings in bold with space above, entries and subentries
 * indented by level with their later lines hanging in. The pages follow each entry after a
 * comma ("Aldol reaction, 3, 7"), or, with `right` (the table of authorities always), at the
 * right after a line of dots.
 */
export function listLines(items: ListItem[], st: NamedStyle, line: number | undefined, wrap: number, measure: Measure, empty: string, right: boolean): LaidLine[] {
  const base = { font: st.font, size: st.size };
  const family = withStack(st.font);
  if (!items.length) {
    return layoutText({ runs: [{ ...base, italic: true, color: '#8a8f98', text: empty }], paras: [{ line }], justify: 'left', wrap, boxes: true }, st.size, measure).lines;
  }
  const pageText = (it: ListItem) => it.pages.map((p) => p.label).join(', ');
  const labels = items.map((it) => (right && it.level ? [pageText(it), it.see ?? ''].filter(Boolean).join('; ') : ''));
  const numW = right ? Math.max(0, ...labels.map((l) => measure(l, st.size, family, l === 'passim' ? 'italic ' : ''))) : 0;
  const keep = right ? numW + 2 * st.size : 0;
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  items.forEach((it, i) => {
    if (i) runs.push({ ...base, text: '\n' });
    if (it.level === 0) {
      runs.push({ ...base, bold: true, text: it.text });
      paras.push({ line, spaceBefore: i ? st.size : 0, spaceAfter: 0.25 * st.size, keepNext: true });
      return;
    }
    runs.push({ ...base, text: it.text });
    if (!right) {
      it.pages.forEach((p) => runs.push({ ...base, text: ', ' }, { ...base, text: p.label, ...(p.bold ? { bold: true } : {}), ...(p.italic ? { italic: true } : {}) }));
      if (it.see) runs.push({ ...base, text: '. ' }, { ...base, italic: true, text: it.see.split(/\s+/)[0] }, { ...base, text: it.see.slice(it.see.split(/\s+/)[0].length) });
    }
    const indent = (it.level - 1) * INDEX_INDENT + INDEX_INDENT;
    paras.push({ line, indent, firstLine: -INDEX_INDENT, indentRight: keep || undefined });
  });
  const lay = layoutText({ runs, paras, justify: 'left', wrap, boxes: true }, st.size, measure);
  if (!right) return lay.lines;
  const unit = '. ';
  const unitW = measure(unit, st.size, family, '');
  const lines = lay.lines.map((l) => ({ ...l, pieces: [...l.pieces] }));
  for (const l of lines) {
    if (!l.last || !items[l.para]?.level) continue;
    const label = labels[l.para] ?? '';
    const style = label === 'passim' ? 'italic ' : '';
    const w = measure(label, st.size, family, style);
    const numX = wrap - w;
    const from = l.x + l.width + 0.4 * st.size;
    const to = numX - 0.3 * st.size;
    const n = unitW > 0 ? Math.floor((to - from) / unitW) : 0;
    const piece = (text: string, x: number, pw: number, style = ''): Glyphs => ({ text, start: l.end, x, w: pw, dy: 0, size: st.size, family, style, decor: true });
    if (n > 0) {
      const dots = unit.repeat(n).trimEnd();
      const dw = measure(dots, st.size, family, '');
      l.pieces.push(piece(dots, to - dw, dw));
    }
    if (label) l.pieces.push(piece(label, numX, w, style));
    l.width = wrap - l.x;
  }
  return lines;
}

/** The lines as plain text ("Aldol reaction, 3, 7"), for finding text and the Word file's field. */
export function itemText(it: ListItem): string {
  return [it.text, ...it.pages.map((p) => p.label)].join(', ') + (it.see ? `. ${it.see}` : '');
}

// ---------------------------------------------------------------- marking

/**
 * Mark an entry in one paragraph, or (Mark All) in every paragraph where its text comes up as a
 * whole word, once each (as Word does); a paragraph already marked with the same entry isn't
 * marked again. Gives the text and how many paragraphs were marked.
 */
export function markIndex(t: DocText, para: number, m: IndexMark, all = false, find = m.main): { t: DocText; count: number } {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  const same = (x: IndexMark) => key(x.main) === key(m.main) && key(x.sub ?? '') === key(m.sub ?? '') && key(x.see ?? '') === key(m.see ?? '');
  const targets = all ? paragraphsWith(t, find) : [para];
  let count = 0;
  for (const p of targets) {
    const have = paras[p].xe ?? [];
    if (have.some(same)) continue;
    paras[p] = { ...paras[p], xe: [...have, clean(m)] };
    count++;
  }
  return { t: { ...t, paras }, count };
}

/** Mark a citation for the table of authorities (Mark All: wherever its short form comes up). */
export function markAuthority(t: DocText, para: number, m: AuthorityMark, all = false, find = m.short): { t: DocText; count: number } {
  const n = paraCount(rt.plainText(t.runs));
  const paras = fitParas(t.paras, n);
  const first = !authorities(t).some((a) => key(a.short) === key(m.short));
  const targets = all ? paragraphsWith(t, find) : [para];
  if (!targets.includes(para) && !all) targets.push(para);
  let count = 0;
  for (const p of targets) {
    const have = paras[p].ta ?? [];
    if (have.some((x) => key(x.short) === key(m.short))) continue;
    // the long form and category go on the first mark; the rest just name the short form, as Word does
    const mark: AuthorityMark = count === 0 && first ? { short: m.short.trim(), ...(m.long?.trim() ? { long: m.long.trim() } : {}), cat: m.cat ?? 1 } : { short: m.short.trim() };
    paras[p] = { ...paras[p], ta: [...have, mark] };
    count++;
  }
  return { t: { ...t, paras }, count };
}

/** A citation's long form and category changed (they live on its first mark). */
export function setAuthority(t: DocText, short: string, patch: { long?: string; cat?: number }): DocText {
  let done = false;
  const paras = t.paras.map((p) => {
    if (done || !p?.ta?.some((x) => key(x.short) === key(short))) return p;
    done = true;
    return { ...p, ta: p.ta.map((x) => (key(x.short) === key(short) ? { ...x, ...patch } : x)) };
  });
  return { ...t, paras };
}

/** Take an index entry (by its text and subentry) or a citation (by its short form) off a paragraph, or off every paragraph when `para` is -1. */
export function unmark(t: DocText, para: number, what: { xe?: IndexMark; ta?: string }): DocText {
  const paras = t.paras.map((p, i) => {
    if (!p || (para >= 0 && i !== para)) return p;
    const out: ParaStyle = { ...p };
    if (what.xe && p.xe) { const xe = p.xe.filter((x) => !(key(x.main) === key(what.xe!.main) && key(x.sub ?? '') === key(what.xe!.sub ?? ''))); if (xe.length) out.xe = xe; else delete out.xe; }
    if (what.ta && p.ta) { const ta = p.ta.filter((x) => key(x.short) !== key(what.ta!)); if (ta.length) out.ta = ta; else delete out.ta; }
    return out;
  });
  return { ...t, paras };
}

function clean(m: IndexMark): IndexMark {
  return { main: m.main.trim(), ...(m.sub?.trim() ? { sub: m.sub.trim() } : {}), ...(m.see?.trim() ? { see: m.see.trim() } : {}), ...(m.bold ? { bold: true } : {}), ...(m.italic ? { italic: true } : {}) };
}

/** The paragraphs whose text has `find` as a whole word or phrase (ignoring case), in order. */
export function paragraphsWith(t: Pick<DocText, 'runs'>, find: string): number[] {
  const f = find.trim();
  if (!f) return [];
  const esc = f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc}(?=$|[^\\p{L}\\p{N}])`, 'iu');
  return rt.plainText(t.runs).split('\n').flatMap((p, i) => (re.test(p) ? [i] : []));
}

// ---------------------------------------------------------------- Word's fields

/** Text in a field's quotes: quotes and backslashes escaped (and, in an entry, colons, which split levels). */
const quoted = (s: string, colons = false) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/:/g, colons ? '\\:' : ':')}"`;

/** An index entry as Word's XE field instruction. */
export function xeInstr(m: IndexMark): string {
  const entry = m.main.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/:/g, '\\:') + (m.sub ? ':' + m.sub.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/:/g, '\\:') : '');
  return ` XE "${entry}"${m.see ? ` \\t ${quoted(m.see)}` : ''}${m.bold ? ' \\b' : ''}${m.italic ? ' \\i' : ''} `;
}

/** A citation as Word's TA field instruction. */
export function taInstr(m: AuthorityMark): string {
  return ` TA${m.long ? ` \\l ${quoted(m.long)}` : ''} \\s ${quoted(m.short)}${m.cat ? ` \\c ${m.cat}` : ''} `;
}

/** An index as Word's INDEX field instruction (\c columns, \h letter headings, \e a tab before the page numbers). */
export function indexInstr(o: { cols?: number; right?: boolean; letters?: boolean }): string {
  return ` INDEX${o.letters ? ' \\h "A"' : ''}${o.right ? ' \\e "\t"' : ''} \\c "${Math.max(1, Math.min(4, o.cols ?? 1))}" \\z "1033" `;
}

/** A table of authorities of one category as Word's TOA field instruction (\h its heading, \p passim). */
export function toaInstr(cat: number, passim = false): string {
  return ` TOA \\h \\c "${cat}"${passim ? ' \\p' : ''} `;
}

/** A field instruction's words: its name, then each argument (quoted text with its escapes undone) and switch. */
export function fieldWords(instr: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let i = 0;
  const s = instr;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      let text = '';
      i++;
      while (i < s.length && s[i] !== '"') {
        if (s[i] === '\\' && i + 1 < s.length) { text += s[i] === '\\' && s[i + 1] === ':' ? '\\:' : s[i + 1]; i += 2; continue; }
        text += s[i++];
      }
      i++;
      out.push({ text, quoted: true });
    } else {
      let text = '';
      while (i < s.length && !/\s/.test(s[i])) text += s[i++];
      out.push({ text, quoted: false });
    }
  }
  return out;
}

/** A switch's argument (\c "2"), or true for a switch with none, or undefined when it isn't there. */
function switchArg(words: { text: string; quoted: boolean }[], name: string): string | true | undefined {
  const i = words.findIndex((w) => !w.quoted && w.text.toLowerCase() === `\\${name}`);
  if (i < 0) return undefined;
  const next = words[i + 1];
  return next && (next.quoted || !next.text.startsWith('\\')) ? next.text : true;
}

/** An XE field's entry, or null when it isn't one. Levels past the second join the subentry. */
export function parseXe(instr: string): IndexMark | null {
  const w = fieldWords(instr);
  if (w[0]?.text.toUpperCase() !== 'XE' || !w[1]) return null;
  // levels are split at colons not escaped (\:)
  const levels = w[1].text.split(/(?<!\\):/).map((x) => x.replace(/\\:/g, ':').trim());
  if (!levels[0]) return null;
  const see = switchArg(w, 't');
  return {
    main: levels[0],
    ...(levels.length > 1 && levels.slice(1).join(', ') ? { sub: levels.slice(1).join(', ') } : {}),
    ...(typeof see === 'string' && see ? { see } : {}),
    ...(switchArg(w, 'b') ? { bold: true } : {}),
    ...(switchArg(w, 'i') ? { italic: true } : {}),
  };
}

/** A TA field's citation, or null. */
export function parseTa(instr: string): AuthorityMark | null {
  const w = fieldWords(instr);
  if (w[0]?.text.toUpperCase() !== 'TA') return null;
  const long = switchArg(w, 'l'), short = switchArg(w, 's'), cat = switchArg(w, 'c');
  const s = typeof short === 'string' ? short : typeof long === 'string' ? long : '';
  if (!s.trim()) return null;
  const c = typeof cat === 'string' ? Number(cat) : NaN;
  return { short: s.trim(), ...(typeof long === 'string' && long.trim() ? { long: long.trim() } : {}), ...(Number.isInteger(c) && c > 0 ? { cat: c } : {}) };
}

/** An INDEX field's settings, or null. */
export function parseIndex(instr: string): { cols?: number; right?: boolean; letters?: boolean } | null {
  const w = fieldWords(instr);
  if (w[0]?.text.toUpperCase() !== 'INDEX') return null;
  const c = switchArg(w, 'c'), e = switchArg(w, 'e'), h = switchArg(w, 'h');
  const cols = typeof c === 'string' ? Math.max(1, Math.min(4, Math.round(Number(c)) || 1)) : 1;
  return { ...(cols > 1 ? { cols } : {}), ...(typeof e === 'string' && e.includes('\t') ? { right: true } : {}), ...(h !== undefined ? { letters: true } : {}) };
}

/** A TOA field's category and passim switch, or null. */
export function parseToa(instr: string): { cat: number; passim?: boolean } | null {
  const w = fieldWords(instr);
  if (w[0]?.text.toUpperCase() !== 'TOA') return null;
  const c = switchArg(w, 'c');
  const cat = typeof c === 'string' ? Math.max(1, Math.round(Number(c)) || 1) : 1;
  return { cat, ...(switchArg(w, 'p') ? { passim: true } : {}) };
}

/** Is this run an index or a table of authorities? */
export const isIndexLike = (t: Pick<DocText, 'objects'>, r: { obj?: number }): boolean => r.obj !== undefined && (t.objects[r.obj]?.kind === 'index' || t.objects[r.obj]?.kind === 'toa');
