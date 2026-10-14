// A document's references (its bibliography), as SI Assistant keeps them (its SPEC §9.5):
// each reference is plain data kept in the document itself (and in its Word file), added by
// DOI (filled in from Crossref), by hand, or from a BibTeX or RIS file. Citations in the text
// are fields that show numbers, given in order of first citation; the bibliography lists only
// the references cited, in that order, in the chosen journal style (ACS, Angewandte or RSC).
// A citation of a reference that was deleted shows [?] and is left out, never refused.
//
// Every value filled in here can be changed by hand: each field of a reference, and the
// bibliography's text for a reference (typed over, with a way back to the automatic text).

import type { TextRun } from '../model';

export type RefType = 'article' | 'book' | 'chapter' | 'thesis' | 'web' | 'misc';

/** What each kind of reference is called. */
export const REF_TYPES: Record<RefType, string> = {
  article: 'Journal article', book: 'Book', chapter: 'Book chapter', thesis: 'Thesis', web: 'Web page', misc: 'Other',
};

export interface Reference {
  /** Never changes (citations point to it): "r-1a2b3c". */
  id: string;
  type: RefType;
  /** One per author, "Last, First" ("Fulmer, Gregory R."). A name without a comma (a group) is printed as it is. */
  authors: string[];
  title: string;
  /** The journal (abbreviated, as printed: Org. Lett.), or for a chapter the book's title. */
  journal: string;
  year: string;
  volume: string;
  issue: string;
  /** With an en dash (2176–2179), or an article number. */
  pages: string;
  doi: string;
  url: string;
  /** A book's publisher, or a thesis's university. */
  publisher: string;
  note: string;
  /** The bibliography's text for this reference typed over the automatic one (plain text). */
  typed?: string;
}

/** The journal styles references are printed in. */
export type CiteStyle = 'acs' | 'angewandte' | 'rsc';

export const CITE_STYLES: Record<CiteStyle, string> = {
  acs: 'ACS (J. Org. Chem., Org. Lett., JACS)',
  angewandte: 'Angewandte (Wiley: Angew. Chem., Chem. Eur. J.)',
  rsc: 'RSC (Chem. Sci., Chem. Commun., OBC)',
};

const TEXT_FIELDS = ['title', 'journal', 'year', 'volume', 'issue', 'pages', 'doi', 'url', 'publisher', 'note'] as const;

export const CROSSREF_URL = 'https://api.crossref.org/works/';

/** A problem to tell the person about, in plain words. */
export class ReferenceError extends Error {}

// ---------------------------------------------------------------- the data

/** A new id no reference in `taken` has. */
export function newRefId(taken: Iterable<string> = []): string {
  const used = new Set(taken);
  for (;;) {
    const id = 'r-' + Math.floor(Math.random() * 0x1000000).toString(16).padStart(6, '0');
    if (!used.has(id)) return id;
  }
}

/** An empty reference. */
export function blankRef(type: RefType = 'article', id = newRefId()): Reference {
  return { id, type, authors: [], title: '', journal: '', year: '', volume: '', issue: '', pages: '', doi: '', url: '', publisher: '', note: '' };
}

/**
 * A reference with every field there and tidied (always a new object): authors one per entry,
 * the DOI without its doi.org link, page ranges with an en dash. Anything of the wrong kind
 * (from a damaged file) falls back to empty rather than stopping the document from opening.
 */
export function cleanRef(r: Partial<Record<keyof Reference, unknown>>): Reference {
  const type = typeof r.type === 'string' && r.type in REF_TYPES ? (r.type as RefType) : 'article';
  const id = r.id !== undefined && r.id !== null && r.id !== '' && typeof r.id !== 'object' ? String(r.id) : newRefId();
  const out = blankRef(type, id);
  let authors = r.authors;
  if (typeof authors === 'string') authors = authors.split(/\s*;\s*|\s+and\s+|\n/);
  out.authors = Array.isArray(authors) ? authors.filter((a) => a !== null && a !== undefined).map((a) => String(a).trim()).filter(Boolean) : [];
  for (const f of TEXT_FIELDS) {
    const v = r[f];
    out[f] = v === null || v === undefined || typeof v === 'object' ? '' : String(v).trim();
  }
  out.doi = normaliseDoi(out.doi);
  out.pages = out.pages.replace(/(?<=\d)\s*-+\s*(?=\d)/g, '–');
  if (typeof r.typed === 'string') out.typed = r.typed;
  return out;
}

/** "https://doi.org/10.1021/OM100106E " → "10.1021/OM100106E". */
export function normaliseDoi(text: string): string {
  let t = (text ?? '').trim();
  t = t.replace(/^(?:https?:\/\/)?(?:dx\.)?doi\.org\//i, '');
  t = t.replace(/^doi:\s*/i, '');
  return t.trim();
}

/** A person's family name ("Fulmer" from "Fulmer, Gregory R."). */
export function surname(author: string): string {
  const a = author.trim();
  if (a.includes(',')) return a.split(',')[0].trim();
  const parts = a.split(/\s+/);
  return parts[parts.length - 1] ?? '';
}

/** "Fulmer 2010", "Fulmer & Miller 2010" or "Smith et al. 2020": how a reference is named in lists. */
export function shortLabel(r: Reference): string {
  const names = r.authors.map(surname).filter(Boolean);
  const who = !names.length ? (r.title || 'Untitled').slice(0, 30)
    : names.length === 1 ? names[0]
      : names.length === 2 ? `${names[0]} & ${names[1]}`
        : `${names[0]} et al.`;
  return `${who} ${r.year}`.trim();
}

/** One line for lists: who and when, journal and volume, pages, and the title. */
export function describe(r: Reference): string {
  const bits = [shortLabel(r)];
  const where = [r.journal, r.volume].filter(Boolean).join(' ');
  if (where) bits.push(where);
  if (r.pages) bits.push(r.pages);
  return bits.join(', ') + (r.title ? ` — ${r.title}` : '');
}

const titleKey = (r: Pick<Reference, 'title'>) => r.title.trim().toLowerCase();
const doiKey = (r: Pick<Reference, 'doi'>) => normaliseDoi(r.doi).toLowerCase();

/** A reference already in the list that is the same one: the same DOI, or without a DOI the same title and year. */
export function findDuplicate(refs: Reference[], r: Reference): Reference | null {
  const doi = doiKey(r);
  for (const x of refs) {
    if (doi && doiKey(x) === doi) return x;
    if (!doi && r.title.trim() && titleKey(x) === titleKey(r) && x.year === r.year) return x;
  }
  return null;
}

/**
 * The references of `found` (an imported file) that are neither in `existing` nor earlier in
 * `found` (by the rules of findDuplicate), each with an id not used yet.
 */
export function newReferences(existing: Reference[], found: Reference[]): Reference[] {
  const dois = new Set<string>();
  const titles = new Set<string>();
  const ids = new Set<string>();
  const remember = (r: Reference) => {
    const d = doiKey(r);
    if (d) dois.add(d);
    if (r.title.trim()) titles.add(`${titleKey(r)}\u0000${r.year}`);
    ids.add(r.id);
  };
  existing.forEach(remember);
  const out: Reference[] = [];
  for (const raw of found) {
    const r = cleanRef(raw);
    const d = doiKey(r);
    if (d ? dois.has(d) : !!r.title.trim() && titles.has(`${titleKey(r)}\u0000${r.year}`)) continue;
    if (ids.has(r.id)) r.id = newRefId(ids);
    remember(r);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------- Crossref

type Json = Record<string, unknown>;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** Text without the HTML tags and entities Crossref titles can carry (<i>, <sub>, &amp;). */
function stripTags(text: string): string {
  return text.replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ').trim();
}

/**
 * A reference from Crossref's record of a DOI (the "message" of /works/<doi>). The journal is
 * its abbreviation (short-container-title) when Crossref has one, else its full name.
 */
export function fromCrossref(m: Json): Reference {
  const ctype = str(m.type);
  const type: RefType = ({ 'journal-article': 'article', book: 'book', monograph: 'book', 'edited-book': 'book', 'book-chapter': 'chapter', dissertation: 'thesis', 'posted-content': 'misc' } as Record<string, RefType>)[ctype] ?? 'misc';
  const authors: string[] = [];
  for (const a of arr(m.author) as Json[]) {
    if (a && str(a.family)) authors.push(`${str(a.family)}, ${str(a.given)}`.trim().replace(/,$/, ''));
    else if (a && str(a.name)) authors.push(str(a.name));
  }
  const dated = [m['published-print'], m['published-online'], m.issued].find((d) => d && typeof d === 'object' && arr((d as Json)['date-parts']).length) as Json | undefined;
  const first = arr(arr(dated?.['date-parts'])[0])[0];
  const short = arr(m['short-container-title']).map(str).filter(Boolean);
  const full = arr(m['container-title']).map(str).filter(Boolean);
  return cleanRef({
    type, authors,
    title: stripTags(str(arr(m.title)[0])),
    journal: stripTags(short[0] ?? full[0] ?? ''),
    year: first ? str(first) : '',
    volume: str(m.volume), issue: str(m.issue), pages: str(m.page),
    doi: str(m.DOI),
    publisher: type === 'book' || type === 'chapter' ? str(m.publisher) : '',
  });
}

/**
 * Look a DOI up on Crossref (needs the internet). Crossref allows pages to ask it directly.
 * Throws a ReferenceError saying in plain words what went wrong.
 */
export async function fetchDoi(text: string, fetchFn: typeof fetch = fetch, timeoutMs = 15000): Promise<Reference> {
  const doi = normaliseDoi(text);
  if (!/^10\.\d{4,9}\/\S+$/.test(doi)) throw new ReferenceError(`"${doi}" doesn't look like a DOI (they start with 10.…/, such as 10.1021/om100106e).`);
  const url = CROSSREF_URL + encodeURIComponent(doi).replace(/%2F/gi, '/').replace(/%3A/gi, ':').replace(/%3B/gi, ';');
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs) : null;
  let res: Response;
  try {
    res = await fetchFn(url, { signal: ctl?.signal, headers: { Accept: 'application/json' } });
  } catch {
    throw new ReferenceError('Could not connect to Crossref. Are you online? You can also enter the reference by hand.');
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (res.status === 404) throw new ReferenceError(`Crossref has no record of the DOI ${doi}. Check it, or enter the reference by hand.`);
  if (!res.ok) throw new ReferenceError(`Crossref could not be reached (error ${res.status}). Try again later, or enter the reference by hand.`);
  let data: Json;
  try {
    data = (await res.json()) as Json;
  } catch {
    throw new ReferenceError('Crossref sent an answer that could not be read.');
  }
  const m = data?.message;
  if (!m || typeof m !== 'object') throw new ReferenceError('Crossref sent an answer that could not be read.');
  return fromCrossref(m as Json);
}

// ---------------------------------------------------------------- BibTeX and RIS

const LATEX_ACCENTS: Record<string, string> = {
  "'": '́', '`': '̀', '^': '̂', '"': '̈', '~': '̃', c: '̧', v: '̌', '=': '̄',
  '.': '̇', u: '̆', H: '̋', k: '̨', r: '̊',
};
const LATEX_LETTERS: Record<string, string> = { o: 'ø', O: 'Ø', ss: 'ß', ae: 'æ', AE: 'Æ', l: 'ł', L: 'Ł', aa: 'å', AA: 'Å', i: 'ı' };

/** BibTeX's LaTeX as plain text: {\"o} → ö, {\ss} → ß, -- → –, $_2$ → 2, other commands and braces dropped. */
export function delatex(text: string): string {
  let t = text.replace(/\\textendash\b\s?|--/g, '–').replace(/\\textemdash\b\s?/g, '—');
  t = t.replace(/\\(['`^"~=.uvcHkr])\s*(?:\{\s*(\\i|[A-Za-z])\s*\}|(\\i|[A-Za-z]))/g, (_m, mark: string, a?: string, b?: string) => {
    const letter = (a ?? b ?? '') === '\\i' ? 'i' : (a ?? b ?? '');
    return (letter + (LATEX_ACCENTS[mark] ?? '')).normalize('NFC');
  });
  t = t.replace(/\{?\\(ss|ae|AE|aa|AA|o|O|l|L)\}?(?![A-Za-z])/g, (_m, k: string) => LATEX_LETTERS[k]);
  t = t.replace(/\\&/g, '&').replace(/\$_\{?(\d+)\}?\$/g, '$1').replace(/\\[a-zA-Z]+\s*/g, '');
  return t.replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

/** The fields of one BibTeX entry's body ("key, author = {…}, year = 2010"), names in lower case. */
function bibtexFields(body: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let i = body.indexOf(',');
  i = i < 0 ? 0 : i + 1;
  const n = body.length;
  const name = /\s*([A-Za-z][\w-]*)\s*=\s*/y;
  while (i < n) {
    name.lastIndex = i;
    const m = name.exec(body);
    if (!m) break;
    const key = m[1].toLowerCase();
    i = name.lastIndex;
    let value: string;
    if (body[i] === '{') {
      let depth = 1, j = i + 1;
      while (j < n && depth) { if (body[j] === '{') depth++; else if (body[j] === '}') depth--; j++; }
      value = body.slice(i + 1, j - 1);
      i = j;
    } else if (body[i] === '"') {
      let j = i + 1;
      while (j < n && !(body[j] === '"' && body[j - 1] !== '\\')) j++;
      value = body.slice(i + 1, j);
      i = j + 1;
    } else {
      let j = i;
      while (j < n && body[j] !== ',' && body[j] !== '\n') j++;
      value = body.slice(i, j).trim();
      i = j;
    }
    fields[key] = value.replace(/\s+/g, ' ').trim();
    const comma = body.indexOf(',', i);
    if (comma < 0) break;
    i = comma + 1;
  }
  return fields;
}

/** "Gregory R. Fulmer" → "Fulmer, Gregory R." (a name with a comma, or of one word, is kept). */
function flipName(name: string): string {
  const n = name.trim();
  if (n.includes(',') || !n.includes(' ')) return n;
  const k = n.lastIndexOf(' ');
  return `${n.slice(k + 1)}, ${n.slice(0, k)}`;
}

/** References from a BibTeX file (exported from Zotero, EndNote, Mendeley or a journal). */
export function parseBibtex(text: string): Reference[] {
  const refs: Reference[] = [];
  const start = /@(\w+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(text))) {
    const kind = m[1].toLowerCase();
    if (kind === 'comment' || kind === 'string' || kind === 'preamble') continue;
    let i = start.lastIndex, depth = 1;
    const from = i;
    while (i < text.length && depth) { if (text[i] === '{') depth++; else if (text[i] === '}') depth--; i++; }
    const body = text.slice(from, depth ? i : i - 1);
    start.lastIndex = i;
    const e = bibtexFields(body);
    const type = ({ article: 'article', book: 'book', inbook: 'chapter', incollection: 'chapter', phdthesis: 'thesis', mastersthesis: 'thesis', thesis: 'thesis', online: 'web', misc: 'misc' } as Record<string, RefType>)[kind] ?? 'misc';
    const authors = (e.author ?? '').split(/\s+and\s+/).filter((a) => a.trim()).map((a) => flipName(delatex(a)));
    refs.push(cleanRef({
      type, authors, title: delatex(e.title ?? ''),
      journal: delatex(e.journal || e.journaltitle || e.booktitle || ''),
      year: e.year || (e.date ?? '').slice(0, 4),
      volume: e.volume ?? '', issue: e.number ?? '', pages: delatex(e.pages ?? ''), doi: e.doi ?? '', url: e.url ?? '',
      publisher: delatex(e.publisher || e.school || e.institution || ''), note: delatex(e.note ?? ''),
    }));
  }
  return refs;
}

/** One RIS record: its tags (the first of each) and its authors. */
interface RisEntry { tags: Record<string, string>; AU: string[] }

function risRef({ tags: e, AU }: RisEntry): Reference {
  const type = ({ JOUR: 'article', JFULL: 'article', EJOUR: 'article', BOOK: 'book', CHAP: 'chapter', THES: 'thesis', ELEC: 'web' } as Record<string, RefType>)[e.TY] ?? 'misc';
  let pages = e.SP ?? '';
  if (e.EP) pages = `${pages}–${e.EP}`;
  return cleanRef({
    type, authors: AU, title: e.TI || e.T1 || '',
    journal: e.J2 || e.JO || e.JA || e.T2 || e.JF || '',
    year: (e.PY || e.Y1 || e.DA || '').slice(0, 4), volume: e.VL ?? '', issue: e.IS ?? '', pages,
    doi: e.DO ?? '', url: e.UR ?? '', publisher: e.PB ?? '', note: e.N1 ?? '',
  });
}

/** References from a RIS file (EndNote, Zotero, a publisher's "Export citation"). */
export function parseRis(text: string): Reference[] {
  const refs: Reference[] = [];
  let cur: RisEntry | null = null;
  for (const raw of text.split(/\r\n?|\n/)) {
    const m = /^([A-Z][A-Z0-9])  -\s?(.*)$/.exec(raw.trimEnd());
    if (!m) continue;
    const [, tag, v] = m;
    const value = v.trim();
    if (tag === 'TY') cur = { tags: { TY: value }, AU: [] };
    else if (!cur) continue;
    else if (tag === 'ER') { refs.push(risRef(cur)); cur = null; }
    else if (tag === 'AU' || tag === 'A1') cur.AU.push(value);
    else if (!(tag in cur.tags)) cur.tags[tag] = value;
  }
  if (cur) refs.push(risRef(cur));
  return refs;
}

/** BibTeX or RIS, whichever the text is. */
export function parseReferenceText(text: string): Reference[] {
  const t = text.replace(/^﻿/, '');
  return /^TY  -/m.test(t) ? parseRis(t) : parseBibtex(t);
}

// ---------------------------------------------------------------- citations

/** What the text has that counts for citations: its runs, its fields and its references. */
export interface Citing {
  runs: TextRun[];
  objects: Record<number, { kind: string; refs?: string[] }>;
  references?: Reference[];
  citeStyle?: CiteStyle;
}

/** The ids of the fields in the text, in order. */
function fieldOrder(runs: TextRun[]): number[] {
  const out: number[] = [];
  for (const r of runs) if (r.obj !== undefined) for (let i = 0; i < r.text.length; i++) out.push(r.obj);
  return out;
}

/**
 * The number each cited reference gets: 1 for the first cited, and so on in order of first
 * citation (within one citation, in the order its references were chosen). References that
 * are not cited, and citations of references that were deleted, get none.
 */
export function citationNumbers(t: Citing): Map<string, number> {
  const known = new Set((t.references ?? []).map((r) => r.id));
  const out = new Map<string, number>();
  for (const id of fieldOrder(t.runs)) {
    const o = t.objects[id];
    if (o?.kind !== 'cite') continue;
    for (const r of o.refs ?? []) if (known.has(r) && !out.has(r)) out.set(r, out.size + 1);
  }
  return out;
}

/** How many times each reference is cited. */
export function citeCounts(t: Citing): Map<string, number> {
  const out = new Map<string, number>();
  for (const id of fieldOrder(t.runs)) {
    const o = t.objects[id];
    if (o?.kind !== 'cite') continue;
    for (const r of new Set(o.refs ?? [])) out.set(r, (out.get(r) ?? 0) + 1);
  }
  return out;
}

/** Numbers as a citation shows them: in order, with three or more in a row as a range (1–3,5). */
export function compressNumbers(nums: number[]): string {
  const ns = [...new Set(nums)].sort((a, b) => a - b);
  const parts: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j] + 1) j++;
    if (j - i >= 2) parts.push(`${ns[i]}–${ns[j]}`);
    else for (let k = i; k <= j; k++) parts.push(String(ns[k]));
    i = j + 1;
  }
  return parts.join(',');
}

/**
 * What a citation shows, in the text's superscript: ACS and RSC the numbers (1,3–5), Angewandte
 * the numbers in square brackets ([1,3–5]). References that were deleted are left out; a
 * citation with none left shows [?].
 */
export function citeText(nums: number[], style: CiteStyle = 'acs'): string {
  if (!nums.length) return '[?]';
  const s = compressNumbers(nums);
  return style === 'angewandte' ? `[${s}]` : s;
}

/** What every citation in the text shows, by its field's id. */
export function citationTexts(t: Citing): Map<number, string> {
  const numbers = citationNumbers(t);
  const out = new Map<number, string>();
  for (const [k, o] of Object.entries(t.objects)) {
    if (o.kind !== 'cite') continue;
    const nums = (o.refs ?? []).map((r) => numbers.get(r)).filter((n): n is number => n !== undefined);
    out.set(Number(k), citeText(nums, t.citeStyle));
  }
  return out;
}

/** Citations (by field id) that cite a reference no longer in the list. */
export function brokenCitations(t: Citing): number[] {
  const known = new Set((t.references ?? []).map((r) => r.id));
  const used = new Set(fieldOrder(t.runs));
  return Object.entries(t.objects)
    .filter(([k, o]) => o.kind === 'cite' && used.has(Number(k)) && (!o.refs?.length || o.refs.some((r) => !known.has(r))))
    .map(([k]) => Number(k));
}

/** A warning for citations of deleted references (never an error: they show [?] and are left out). */
export function citationWarning(t: Citing): string | null {
  const n = brokenCitations(t).length;
  if (!n) return null;
  return `${n === 1 ? 'One citation points' : `${n} citations point`} to a reference that was deleted: ${n === 1 ? 'it is' : 'they are'} left out of the numbering, and a citation with nothing left shows [?]. Undo the deletion, or cite again with References > Insert Citation.`;
}

// ---------------------------------------------------------------- the bibliography

/** A piece of a bibliography entry in one look. */
export interface Piece { text: string; italic?: boolean; bold?: boolean }

export interface BibEntry {
  n: number;
  ref: Reference;
  /** "(1)" for ACS, "[1]" for Angewandte, "1" for RSC. */
  label: string;
  /** The entry's text: the typed-over text, or the automatic one. */
  pieces: Piece[];
  /** The text was typed over (a Reset puts the automatic one back). */
  typed: boolean;
}

/** An entry's number as the style shows it. */
export function bibLabel(n: number, style: CiteStyle = 'acs'): string {
  return style === 'acs' ? `(${n})` : style === 'angewandte' ? `[${n}]` : String(n);
}

/** The references cited, in citation order, each as the style prints it. */
export function bibliography(t: Citing): BibEntry[] {
  const style = t.citeStyle ?? 'acs';
  const numbers = citationNumbers(t);
  const byId = new Map((t.references ?? []).map((r) => [r.id, r]));
  return [...numbers.entries()].sort((a, b) => a[1] - b[1]).map(([id, n]) => {
    const ref = byId.get(id)!;
    const typed = ref.typed !== undefined;
    return { n, ref, label: bibLabel(n, style), pieces: typed ? [{ text: ref.typed! }] : formatReference(ref, style), typed };
  });
}

/** An entry's plain text. */
export const piecesText = (ps: Piece[]): string => ps.map((p) => p.text).join('');

interface Name { family: string; given: string; suffix: string; literal: boolean }

/** "Fulmer, Gregory R." → family Fulmer, given Gregory R.; "Smith, Jr., John" → suffix Jr.; a name without a comma is a group's, printed as it is. */
function parseName(a: string): Name {
  const parts = a.split(',').map((s) => s.trim());
  if (parts.length < 2) return { family: a.trim(), given: '', suffix: '', literal: true };
  if (parts.length >= 3) return { family: parts[0], suffix: parts[1], given: parts.slice(2).join(' '), literal: false };
  return { family: parts[0], given: parts[1], suffix: '', literal: false };
}

/** Given names as initials: "Gregory R." → "G. R.", "Jean-Pierre" → "J.-P.", "A.J.M." → "A. J. M.". */
export function initials(given: string): string {
  const out: string[] = [];
  for (const tok of given.split(/\s+/).filter(Boolean)) {
    // particles (van, de, von) are kept as they are
    if (/^(van|von|de|der|den|la|le|da|di|du|del|dos|das)$/.test(tok)) { out.push(tok); continue; }
    out.push(tok.split('-').filter(Boolean).map((part) => {
      const dotted = part.split('.').filter(Boolean);
      if (dotted.length > 1) return dotted.map((l) => `${[...l][0].toUpperCase()}.`).join(' ');
      return `${[...part][0].toUpperCase()}.`;
    }).join('-'));
  }
  return out.join(' ');
}

/** ACS: "Fulmer, G. R."; Angewandte and RSC: "G. R. Fulmer". */
function nameAs(a: string, familyFirst: boolean): string {
  const n = parseName(a);
  if (n.literal) return n.family;
  const ini = initials(n.given);
  if (familyFirst) return [n.family, ini, n.suffix].filter(Boolean).join(', ');
  return [ini, n.family, n.suffix].filter(Boolean).join(' ');
}

const noStop = (s: string) => s.trim().replace(/[.\s]+$/, '');

/** Pieces joined, the text made to end with one full stop. */
function finish(ps: Piece[]): Piece[] {
  const out = ps.filter((p) => p.text);
  if (!out.length) return out;
  const last = out[out.length - 1];
  if (!/[.?!]$/.test(last.text.trim())) out.push({ text: '.' });
  return out;
}

/** A reference as a journal style prints it. */
export function formatReference(r: Reference, style: CiteStyle = 'acs'): Piece[] {
  return style === 'acs' ? formatAcs(r) : style === 'angewandte' ? formatAngewandte(r) : formatRsc(r);
}

/**
 * ACS style, from The ACS Guide to Scholarly Communication (2020), "References" (and The ACS
 * Style Guide, 3rd ed., ch. 14): authors last name first with initials, separated by
 * semicolons; the article's title; the abbreviated journal in italics, the year in bold, the
 * volume in italics, then the pages:
 *   Fulmer, G. R.; Miller, A. J. M. NMR Chemical Shifts… Organometallics 2010, 29, 2176–2179.
 * Books: Author. Title (italic); Publisher, Year. Chapters: Author. Chapter. In Book (italic);
 * Publisher, Year; pp pages. Theses: Author. Title. Ph.D. Thesis, University, Year.
 * An article without pages (just published online) gives its DOI instead.
 */
function formatAcs(r: Reference): Piece[] {
  const out: Piece[] = [];
  const names = r.authors.map((a) => nameAs(a, true));
  if (names.length) {
    const who = names.join('; ');
    out.push({ text: who + (who.endsWith('.') ? ' ' : '. ') });
  }
  const title = noStop(r.title);
  const doi = r.doi ? `DOI: ${r.doi}` : '';
  switch (r.type) {
    case 'book':
      if (title) out.push({ text: title, italic: true });
      out.push({ text: [r.publisher, r.year].filter(Boolean).length ? `; ${[r.publisher, r.year].filter(Boolean).join(', ')}` : '' });
      break;
    case 'chapter':
      if (title) out.push({ text: `${title}. ` });
      if (r.journal) { out.push({ text: 'In ' }, { text: noStop(r.journal), italic: true }); }
      out.push({ text: [r.publisher, r.year].filter(Boolean).length ? `; ${[r.publisher, r.year].filter(Boolean).join(', ')}` : '' });
      if (r.pages) out.push({ text: `; pp ${r.pages}` });
      break;
    case 'thesis':
      if (title) out.push({ text: `${title}. ` });
      out.push({ text: ['Ph.D. Thesis', r.publisher, r.year].filter(Boolean).join(', ') });
      break;
    case 'web':
      if (title) out.push({ text: `${title}. ` });
      if (r.url) out.push({ text: r.url });
      break;
    default: {
      if (title) out.push({ text: `${title}. ` });
      if (r.journal) out.push({ text: r.journal.trim(), italic: true });
      if (r.year) out.push({ text: r.journal ? ' ' : '' }, { text: r.year, bold: true });
      if (r.volume) out.push({ text: ', ' }, { text: r.volume, italic: true });
      if (r.pages) out.push({ text: `, ${r.pages}` });
      else if (doi) out.push({ text: `${r.journal || r.year || r.volume ? '. ' : ''}${doi}` });
    }
  }
  return finishNote(out, r);
}

/**
 * Angewandte Chemie (Wiley), from its Notes for Authors, "References": initials then last
 * name, separated by commas (no "and"); no article title; the abbreviated journal in italics,
 * the year in bold, the volume in italics, then the pages:
 *   G. R. Fulmer, A. J. M. Miller, …, Organometallics 2010, 29, 2176–2179.
 * Books: A. Author, Title (italic), Publisher, Year. Theses: A. Author, PhD thesis, University (Year).
 */
function formatAngewandte(r: Reference): Piece[] {
  const out: Piece[] = [];
  const names = r.authors.map((a) => nameAs(a, false));
  if (names.length) out.push({ text: names.join(', ') + ', ' });
  const title = noStop(r.title);
  switch (r.type) {
    case 'book':
      if (title) out.push({ text: title, italic: true });
      out.push({ text: [r.publisher, r.year].filter(Boolean).map((x) => `, ${x}`).join('') });
      break;
    case 'chapter':
      if (r.journal) out.push({ text: 'in ' }, { text: noStop(r.journal), italic: true });
      out.push({ text: [r.publisher, r.year].filter(Boolean).map((x) => `, ${x}`).join('') });
      if (r.pages) out.push({ text: `, pp. ${r.pages}` });
      break;
    case 'thesis':
      out.push({ text: ['PhD thesis', r.publisher].filter(Boolean).join(', ') + (r.year ? ` (${r.year})` : '') });
      break;
    case 'web':
      if (title) out.push({ text: title });
      if (r.url) out.push({ text: `${title ? ', ' : ''}${r.url}` });
      break;
    default:
      if (r.journal) out.push({ text: r.journal.trim(), italic: true });
      else if (title) out.push({ text: title });
      if (r.year) out.push({ text: r.journal || title ? ' ' : '' }, { text: r.year, bold: true });
      if (r.volume) out.push({ text: ', ' }, { text: r.volume, italic: true });
      if (r.pages) out.push({ text: `, ${r.pages}` });
      else if (r.doi) out.push({ text: `, DOI ${r.doi}` });
  }
  return finishNote(trimComma(out), r);
}

/**
 * RSC, from the Royal Society of Chemistry's author guidelines, "References": initials then
 * last name, separated by commas with "and" before the last; no article title; the
 * abbreviated journal in italics, then the year, the volume in bold and the pages, all
 * separated by commas:
 *   G. R. Fulmer, A. J. M. Miller, … and K. I. Goldberg, Organometallics, 2010, 29, 2176–2179.
 * Books: A. Author, Title (italic), Publisher, City, Year. Theses: A. Author, PhD thesis, University, Year.
 */
function formatRsc(r: Reference): Piece[] {
  const out: Piece[] = [];
  const names = r.authors.map((a) => nameAs(a, false));
  if (names.length) out.push({ text: (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]) + ', ' });
  const title = noStop(r.title);
  switch (r.type) {
    case 'book':
      if (title) out.push({ text: title, italic: true });
      out.push({ text: [r.publisher, r.year].filter(Boolean).map((x) => `, ${x}`).join('') });
      break;
    case 'chapter':
      if (r.journal) out.push({ text: 'in ' }, { text: noStop(r.journal), italic: true });
      out.push({ text: [r.publisher, r.year].filter(Boolean).map((x) => `, ${x}`).join('') });
      if (r.pages) out.push({ text: `, pp. ${r.pages}` });
      break;
    case 'thesis':
      out.push({ text: ['PhD thesis', r.publisher, r.year].filter(Boolean).join(', ') });
      break;
    case 'web':
      if (title) out.push({ text: title });
      if (r.url) out.push({ text: `${title ? ', ' : ''}${r.url}` });
      break;
    default:
      if (r.journal) out.push({ text: r.journal.trim(), italic: true });
      else if (title) out.push({ text: title });
      if (r.year) out.push({ text: `${r.journal || title ? ', ' : ''}${r.year}` });
      if (r.volume) out.push({ text: ', ' }, { text: r.volume, bold: true });
      if (r.pages) out.push({ text: `, ${r.pages}` });
      else if (r.doi) out.push({ text: `, DOI: ${r.doi}` });
  }
  return finishNote(trimComma(out), r);
}

/** Without a ", " left at the end (an entry with authors and nothing else). */
function trimComma(ps: Piece[]): Piece[] {
  const out = ps.filter((p) => p.text);
  const last = out[out.length - 1];
  if (last && /,\s*$/.test(last.text)) out[out.length - 1] = { ...last, text: last.text.replace(/,\s*$/, '') };
  return out;
}

/** The entry with its full stop, and any note after it. */
function finishNote(ps: Piece[], r: Reference): Piece[] {
  const out = finish(ps.map((p) => ({ ...p, text: p.text })).filter((p) => p.text).map((p, i, all) => (i === all.length - 1 ? { ...p, text: p.text.replace(/\s+$/, '') } : p)));
  const note = r.note.trim();
  if (note) out.push(...finish([{ text: (out.length ? ' ' : '') + note }]));
  return out;
}
