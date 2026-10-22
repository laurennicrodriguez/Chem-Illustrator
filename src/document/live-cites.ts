// Live citations from Zotero, Mendeley and EndNote. Each of them keeps its citations in a Word
// file as fields whose instructions hold the cited items' details: Zotero and Mendeley Desktop
// as CSL-JSON (ADDIN ZOTERO_ITEM CSL_CITATION {...}, ADDIN CSL_CITATION {...}), Mendeley Cite
// as content controls tagged with the same JSON in base64 (MENDELEY_CITATION_v3_...), and
// EndNote as XML records (ADDIN EN.CITE <EndNote>..., often base64 in the field's data).
//
// Opening such a file here reads those details into the document's references, so the
// citations are ours to renumber and restyle. Saving writes each citation back in the same
// manager's form, keeping the manager's own item ids, so the manager still knows them and its
// Refresh or Update Citations works on the file afterwards. New citations made here go out in
// that form too, carrying their details (Zotero and Mendeley keep them as items embedded in
// the document; EndNote adds them to the document's travelling library).
//
// The formats are documented by the projects themselves: CSL-JSON by the Citation Style
// Language schema (citationstyles.org, csl-citation.json and csl-data.json), Zotero's document
// data by its Word integration's source, EndNote's record by its XML export format.

import { cleanRef, newRefId, surname, type RefType, type Reference } from './references';

export type CiteManager = 'zotero' | 'mendeley' | 'mendeley-cite' | 'endnote';

/** Each manager as named in menus. */
export const MANAGERS: Record<CiteManager, string> = {
  zotero: 'Zotero',
  mendeley: 'Mendeley Desktop (Word plugin)',
  'mendeley-cite': 'Mendeley Cite (Word add-in)',
  endnote: 'EndNote',
};

export type Json = Record<string, unknown>;

/** A reference's place in a manager's library: the manager's item id and what it said of the item. */
export interface RefLink {
  app: CiteManager;
  /** The manager's id of the item (Zotero's and Mendeley's citation item id, EndNote's record number). */
  id: string;
  /** Zotero's and Mendeley's item addresses (their library's URIs). */
  uris?: string[];
  /** The item as the manager gave it (CSL-JSON itemData, or EndNote's record XML). */
  item?: Json;
  record?: string;
  /** EndNote's library id (foreign-keys db-id). */
  db?: string;
}

/** A citation's own details from its manager: its id, and each item's page, prefix and suffix. */
export interface CiteLive {
  app: CiteManager;
  /** The citation's id (Zotero's and Mendeley's citationID). */
  id?: string;
  /** Per reference id: what the citation said of that item besides the item (locator, label, prefix, suffix…). */
  items?: Record<string, Json>;
}

/** A citation read from a field: the references it cites (each with its link) and those details. */
export interface ManagerCite {
  app: CiteManager;
  id?: string;
  items: { ref: Reference; extra: Json }[];
}

const SCHEMA = 'https://github.com/citation-style-language/schema/raw/master/csl-citation.json';

// ---------------------------------------------------------------- base64 (UTF-8)

export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  // EndNote writes its data as UTF-8 (UTF-16 with a byte order mark in some versions)
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return new TextDecoder('utf-16le').decode(bytes.subarray(2));
  return new TextDecoder().decode(bytes);
}

export function toBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

// ---------------------------------------------------------------- CSL-JSON

const CSL_TYPES: Record<string, RefType> = {
  'article-journal': 'article', article: 'article', 'article-magazine': 'article', 'article-newspaper': 'article', 'paper-conference': 'article',
  book: 'book', chapter: 'chapter', thesis: 'thesis', webpage: 'web', 'post-weblog': 'web',
};
const TO_CSL: Record<RefType, string> = { article: 'article-journal', book: 'book', chapter: 'chapter', thesis: 'thesis', web: 'webpage', misc: 'document' };

const str = (v: unknown): string => (typeof v === 'string' || typeof v === 'number' ? String(v) : '');

/** A reference from CSL-JSON itemData (the journal's abbreviation when it has one). */
export function refFromCsl(item: Json, id = newRefId()): Reference {
  const authors: string[] = [];
  for (const a of Array.isArray(item.author) ? (item.author as Json[]) : []) {
    if (!a || typeof a !== 'object') continue;
    const family = [str(a['non-dropping-particle']), str(a.family)].filter(Boolean).join(' ');
    if (family) authors.push(`${family}, ${str(a.given)}`.trim().replace(/,$/, ''));
    else if (str(a.literal)) authors.push(str(a.literal));
  }
  const issued = item.issued as Json | undefined;
  const parts = Array.isArray(issued?.['date-parts']) ? (issued!['date-parts'] as unknown[][])[0] : undefined;
  const year = str(parts?.[0]) || (/\b(\d{4})\b/.exec(str(issued?.raw) || str(issued?.literal))?.[1] ?? '');
  const type = CSL_TYPES[str(item.type)] ?? 'misc';
  return cleanRef({
    id, type, authors,
    title: str(item.title),
    journal: str(item['container-title-short']) || str(item.journalAbbreviation) || str(item['container-title']),
    year, volume: str(item.volume), issue: str(item.issue), pages: str(item.page),
    doi: str(item.DOI), url: str(item.URL), publisher: type === 'thesis' ? str(item.publisher) || str(item.authority) : str(item.publisher),
    note: str(item.note),
  });
}

/** A family and given name for CSL ("Fulmer, Gregory R." → family Fulmer, given Gregory R.). */
function cslName(a: string): Json {
  if (!a.includes(',')) return { literal: a };
  const [family, ...rest] = a.split(',');
  return { family: family.trim(), given: rest.join(',').trim() };
}

/**
 * A reference as CSL-JSON itemData: what its manager gave (so fields we don't keep, such as
 * the abstract or ISSN, go back as they came), with what was changed here put over it.
 */
export function cslFromRef(r: Reference): Json {
  const stored = r.live && r.live.app !== 'endnote' ? r.live.item : undefined;
  const was = stored ? refFromCsl(stored, r.id) : null;
  const out: Json = stored ? structuredClone(stored) : { id: r.live?.id ?? r.id, type: TO_CSL[r.type] };
  const changed = (k: keyof Reference) => !was || JSON.stringify(was[k]) !== JSON.stringify(r[k]);
  const set = (k: string, v: string) => { if (v) out[k] = v; else delete out[k]; };
  if (changed('type')) out.type = TO_CSL[r.type];
  if (changed('authors')) out.author = r.authors.map(cslName);
  if (changed('title')) set('title', r.title);
  if (changed('journal')) {
    set('container-title', r.journal);
    delete out['container-title-short'];
    delete out.journalAbbreviation;
  }
  if (changed('year')) { if (r.year) out.issued = { 'date-parts': [[/^\d+$/.test(r.year) ? Number(r.year) : r.year]] }; else delete out.issued; }
  if (changed('volume')) set('volume', r.volume);
  if (changed('issue')) set('issue', r.issue);
  if (changed('pages')) set('page', r.pages.replace(/–/g, '-'));
  if (changed('doi')) set('DOI', r.doi);
  if (changed('url')) set('URL', r.url);
  if (changed('publisher')) set('publisher', r.publisher);
  if (changed('note')) set('note', r.note);
  return out;
}

const parseJson = (text: string): Json | null => {
  try {
    const v = JSON.parse(text) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : null;
  } catch {
    return null;
  }
};

/** A CSL citation (Zotero's and Mendeley's): its items as references, each linked to its manager. */
function fromCslCitation(app: CiteManager, json: Json): ManagerCite {
  const items: ManagerCite['items'] = [];
  for (const it of Array.isArray(json.citationItems) ? (json.citationItems as Json[]) : []) {
    if (!it || typeof it !== 'object') continue;
    const data = (it.itemData && typeof it.itemData === 'object' ? it.itemData : {}) as Json;
    const id = str(it.id) || str(data.id) || newRefId();
    const uris = (Array.isArray(it.uris) ? it.uris : Array.isArray(it.uri) ? it.uri : []).map(str).filter(Boolean);
    const ref = refFromCsl(data);
    ref.live = { app, id, ...(uris.length ? { uris } : {}), item: data };
    const { id: _i, itemData: _d, uris: _u, uri: _u2, ...extra } = it;
    items.push({ ref, extra });
  }
  return { app, id: str(json.citationID) || undefined, items };
}

// ---------------------------------------------------------------- EndNote

const EN_TYPES: Record<string, RefType> = { 'journal article': 'article', 'electronic article': 'article', 'conference paper': 'article', book: 'book', 'edited book': 'book', 'book section': 'chapter', thesis: 'thesis', 'web page': 'web' };
const EN_NUMBERS: Record<RefType, [number, string]> = { article: [17, 'Journal Article'], book: [6, 'Book'], chapter: [5, 'Book Section'], thesis: [32, 'Thesis'], web: [12, 'Web Page'], misc: [13, 'Generic'] };

const el = (p: Element | null | undefined, ...path: string[]): Element | null => {
  let at: Element | null = p ?? null;
  for (const name of path) at = at ? Array.from(at.children).find((c) => c.localName === name) ?? null : null;
  return at;
};
const text = (e: Element | null): string => (e?.textContent ?? '').replace(/\s+/g, ' ').trim();

/** A reference from an EndNote record (the XML export format's <record>). */
export function refFromEndNote(rec: Element, id = newRefId()): Reference {
  const type = EN_TYPES[(el(rec, 'ref-type')?.getAttribute('name') ?? '').toLowerCase()] ?? 'misc';
  const authors = Array.from(el(rec, 'contributors', 'authors')?.children ?? []).filter((c) => c.localName === 'author').map(text).filter(Boolean);
  const titles = el(rec, 'titles');
  const journal = text(el(rec, 'periodical', 'abbr-1')) || text(el(titles, 'alt-title')) || text(el(titles, 'secondary-title')) || text(el(rec, 'periodical', 'full-title'));
  const url = Array.from(el(rec, 'urls', 'related-urls')?.children ?? []).map(text).find(Boolean) ?? '';
  return cleanRef({
    id, type, authors,
    title: text(el(titles, 'title')), journal,
    year: text(el(rec, 'dates', 'year')), volume: text(el(rec, 'volume')), issue: text(el(rec, 'number')), pages: text(el(rec, 'pages')),
    doi: text(el(rec, 'electronic-resource-num')), url, publisher: text(el(rec, 'publisher')), note: '',
  });
}

/** EndNote's citation XML (<EndNote><Cite>…</Cite></EndNote>) as references, each with its record. */
export function fromEndNote(xmlText: string): ManagerCite | null {
  const doc = new DOMParser().parseFromString(xmlText.trim(), 'application/xml');
  const root = doc.documentElement;
  if (!root || root.localName !== 'EndNote' || doc.getElementsByTagName('parsererror').length) return null;
  const items: ManagerCite['items'] = [];
  for (const cite of Array.from(root.children).filter((c) => c.localName === 'Cite')) {
    const rec = el(cite, 'record');
    if (!rec) continue;
    const ref = refFromEndNote(rec);
    const key = el(rec, 'foreign-keys', 'key');
    const recNum = text(el(cite, 'RecNum')) || text(el(rec, 'rec-number')) || text(key);
    ref.live = { app: 'endnote', id: recNum, record: new XMLSerializer().serializeToString(rec), ...(key?.getAttribute('db-id') ? { db: key.getAttribute('db-id')! } : {}) };
    const extra: Json = {};
    for (const k of ['Pages', 'Prefix', 'Suffix']) { const v = text(el(cite, k)); if (v) extra[k] = v; }
    if (cite.getAttribute('ExcludeAuth')) extra.ExcludeAuth = cite.getAttribute('ExcludeAuth');
    if (cite.getAttribute('ExcludeYear')) extra.ExcludeYear = cite.getAttribute('ExcludeYear');
    items.push({ ref, extra });
  }
  return { app: 'endnote', items };
}

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A reference as an EndNote record: the one EndNote gave when nothing was changed here, else written afresh. */
export function endNoteRecord(r: Reference): string {
  const link = r.live?.app === 'endnote' ? r.live : undefined;
  if (link?.record) {
    const rec = new DOMParser().parseFromString(link.record, 'application/xml').documentElement;
    const was = refFromEndNote(rec, r.id);
    const same = (Object.keys(was) as (keyof Reference)[]).every((k) => k === 'typed' || JSON.stringify(was[k]) === JSON.stringify(r[k]));
    if (same) return link.record;
  }
  const num = link?.id ?? '';
  const [tn, tname] = EN_NUMBERS[r.type];
  const tag = (name: string, v: string) => (v ? `<${name}>${esc(v)}</${name}>` : '');
  return '<record>' + (num ? `<rec-number>${esc(num)}</rec-number>` : '') +
    (num ? `<foreign-keys><key app="EN"${link?.db ? ` db-id="${esc(link.db)}"` : ''}>${esc(num)}</key></foreign-keys>` : '') +
    `<ref-type name="${tname}">${tn}</ref-type>` +
    (r.authors.length ? `<contributors><authors>${r.authors.map((a) => tag('author', a)).join('')}</authors></contributors>` : '') +
    `<titles>${tag('title', r.title)}${tag('secondary-title', r.journal)}</titles>` +
    (r.journal ? `<periodical>${tag('full-title', r.journal)}</periodical>` : '') +
    tag('pages', r.pages.replace(/–/g, '-')) + tag('volume', r.volume) + tag('number', r.issue) +
    (r.year ? `<dates>${tag('year', r.year)}</dates>` : '') + tag('publisher', r.publisher) +
    tag('electronic-resource-num', r.doi) +
    (r.url ? `<urls><related-urls>${tag('url', r.url)}</related-urls></urls>` : '') + '</record>';
}

// ---------------------------------------------------------------- fields: reading

/**
 * A reference manager's citation from a field's instruction (and, for EndNote, its field data
 * in base64), or null when the field is not one or its details can't be read.
 */
export function readCiteField(instr: string, data?: string): ManagerCite | null {
  const ins = instr.trim();
  const zotero = /^ADDIN\s+ZOTERO_ITEM\s+(?:CSL_CITATION\s+)?(\{[\s\S]*\})\s*$/i.exec(ins);
  if (zotero) { const j = parseJson(zotero[1]); return j ? fromCslCitation('zotero', j) : null; }
  const mendeley = /^ADDIN\s+CSL_CITATION\s+(\{[\s\S]*\})\s*$/i.exec(ins);
  if (mendeley) { const j = parseJson(mendeley[1]); return j ? fromCslCitation('mendeley', j) : null; }
  if (/^ADDIN\s+EN\.CITE(\s|$)/i.test(ins) && !/^ADDIN\s+EN\.CITE\.DATA/i.test(ins)) {
    const inline = ins.replace(/^ADDIN\s+EN\.CITE\s*/i, '');
    if (/^<EndNote\b/i.test(inline)) return fromEndNote(inline);
    if (data) { try { return fromEndNote(fromBase64(data)); } catch { return null; } }
  }
  return null;
}

/** A Mendeley Cite citation from its content control's tag (MENDELEY_CITATION_v3_ and the citation in base64). */
export function readMendeleyTag(tag: string): ManagerCite | null {
  const m = /^MENDELEY_CITATION_v3_(.+)$/.exec(tag.trim());
  if (!m) return null;
  let j: Json | null = null;
  try { j = parseJson(fromBase64(m[1])); } catch { return null; }
  return j ? fromCslCitation('mendeley-cite', j) : null;
}

/** The manager whose bibliography a field is (ZOTERO_BIBL, Mendeley Bibliography, EN.REFLIST), or null. */
export function bibFieldApp(instr: string): CiteManager | null {
  const ins = instr.trim();
  if (/^ADDIN\s+ZOTERO_BIBL\b/i.test(ins)) return 'zotero';
  if (/^ADDIN\s+Mendeley\s+Bibliography\b/i.test(ins)) return 'mendeley';
  if (/^ADDIN\s+EN\.REFLIST\b/i.test(ins)) return 'endnote';
  return null;
}

/**
 * The document's reference for a cited item: the one already linked to the same item, or the
 * same reference (by DOI, or title and year), which gets the link; else the item is added.
 */
export function placeRef(refs: Reference[], got: Reference): string {
  const link = got.live!;
  const linked = refs.find((r) => r.live?.app === link.app && r.live.id === link.id);
  if (linked) return linked.id;
  // one of ours, written for the manager under its own id
  const ours = refs.find((r) => !r.live && r.id === link.id);
  if (ours) return ours.id;
  const doi = got.doi.toLowerCase();
  const same = refs.find((r) => (doi ? r.doi.toLowerCase() === doi : !!got.title && r.title.trim().toLowerCase() === got.title.trim().toLowerCase() && r.year === got.year));
  if (same) { same.live ??= link; return same.id; }
  if (refs.some((r) => r.id === got.id)) got.id = newRefId(refs.map((r) => r.id));
  refs.push(got);
  return got.id;
}

// ---------------------------------------------------------------- fields: writing

/** How a citation is written for a manager: the field's instruction, and (EndNote) its data. */
export interface CiteOut { instr: string; data?: string; tag?: string }

/** A citation of `refs` written for `app`, showing `shown` (what the manager would show, so it sees no edit by hand). */
export function writeCite(app: CiteManager, refs: Reference[], live: CiteLive | undefined, shown: string): CiteOut {
  const extra = (r: Reference): Json => (live?.app === app ? live.items?.[r.id] ?? {} : {});
  const own = (r: Reference) => (r.live?.app === app || (app === 'mendeley-cite' && r.live?.app === 'mendeley') || (app === 'mendeley' && r.live?.app === 'mendeley-cite') ? r.live : undefined);
  const citationID = live?.app === app && live.id ? live.id : Math.random().toString(36).slice(2, 10);
  if (app === 'endnote') {
    const cites = refs.map((r) => {
      const x = extra(r);
      const attrs = ['ExcludeAuth', 'ExcludeYear'].filter((k) => x[k]).map((k) => ` ${k}="${esc(str(x[k]))}"`).join('');
      const first = r.authors[0] ? surname(r.authors[0]) : '';
      return `<Cite${attrs}>${first ? `<Author>${esc(first)}</Author>` : ''}${r.year ? `<Year>${esc(r.year)}</Year>` : ''}<RecNum>${esc(own(r)?.id ?? '')}</RecNum>` +
        ['Pages', 'Prefix', 'Suffix'].filter((k) => x[k]).map((k) => `<${k}>${esc(str(x[k]))}</${k}>`).join('') +
        `<DisplayText>${esc(shown)}</DisplayText>${endNoteRecord(r)}</Cite>`;
    });
    return { instr: ' ADDIN EN.CITE ', data: toBase64(`<EndNote>${cites.join('')}</EndNote>`) };
  }
  const citationItems = refs.map((r) => {
    const l = own(r);
    return { ...extra(r), id: l?.id ?? r.id, ...(l?.uris?.length ? { uris: l.uris } : {}), itemData: { ...cslFromRef(r), id: l?.id ?? r.id } };
  });
  if (app === 'zotero') {
    const json = { citationID, properties: { formattedCitation: shown, plainCitation: shown, noteIndex: 0 }, citationItems, schema: SCHEMA };
    return { instr: ` ADDIN ZOTERO_ITEM CSL_CITATION ${JSON.stringify(json)} ` };
  }
  if (app === 'mendeley') {
    const json = { citationID, properties: { noteIndex: 0 }, citationItems, mendeley: { formattedCitation: shown, plainTextFormattedCitation: shown, previouslyFormattedCitation: shown }, schema: SCHEMA };
    return { instr: ` ADDIN CSL_CITATION ${JSON.stringify(json)} ` };
  }
  const cid = citationID.startsWith('MENDELEY_CITATION_') ? citationID : `MENDELEY_CITATION_${citationID}`;
  const json = { citationID: cid, properties: { noteIndex: 0 }, isEdited: false, manualOverride: { isManuallyOverridden: false, citeprocText: shown, manualOverrideText: '' }, citationItems: citationItems.map((c) => ({ ...c, isTemporary: false })) };
  return { instr: '', tag: `MENDELEY_CITATION_v3_${toBase64(JSON.stringify(json))}` };
}

/** A bibliography's field instruction for `app` (for Mendeley Cite, the tag of its content control). */
export function bibInstr(app: CiteManager): { instr: string; tag?: string } {
  switch (app) {
    case 'zotero': return { instr: ' ADDIN ZOTERO_BIBL {"uncited":[],"omitted":[],"custom":[]} CSL_BIBLIOGRAPHY ' };
    case 'mendeley': return { instr: ' ADDIN Mendeley Bibliography CSL_BIBLIOGRAPHY ' };
    case 'endnote': return { instr: ' ADDIN EN.REFLIST ' };
    default: return { instr: '', tag: 'MENDELEY_BIBLIOGRAPHY' };
  }
}

// ---------------------------------------------------------------- Zotero's document preferences

/** Zotero's citation styles for ours (its style repository's ids), both ways. */
const ZOTERO_STYLES: Record<string, string> = {
  acs: 'american-chemical-society', rsc: 'royal-society-of-chemistry', angewandte: 'angewandte-chemie', chemeurope: 'chemistry-a-european-journal',
  elsevier: 'elsevier-with-titles', nature: 'nature', science: 'science', thieme: 'thieme-chemistry', beilstein: 'beilstein-journal-of-organic-chemistry', mdpi: 'multidisciplinary-digital-publishing-institute',
};

/** Our style for a CSL style id ("http://www.zotero.org/styles/american-chemical-society" → acs), or null. */
export function styleFromCsl(id: string): string | null {
  const name = id.replace(/^https?:\/\/www\.zotero\.org\/styles\//, '').trim();
  for (const [ours, z] of Object.entries(ZOTERO_STYLES)) if (name === z) return ours;
  if (/^elsevier-/.test(name)) return 'elsevier';
  if (/^thieme-/.test(name)) return 'thieme';
  if (/^american-chemical-society/.test(name)) return 'acs';
  return null;
}

/** The style id in Zotero's document preferences (the ZOTERO_PREF_n properties joined), or null. */
export const zoteroStyleOf = (prefs: string): string | null => /<style\b[^>]*\bid="([^"]+)"/.exec(prefs)?.[1] ?? null;

/** Zotero's document preferences for a document made here: the style matching ours, citations as Word fields. */
export function newZoteroPrefs(style: string): string {
  const session = Math.random().toString(36).slice(2, 10);
  return `<data data-version="3" zotero-version="7.0"><session id="${session}"/><style id="http://www.zotero.org/styles/${ZOTERO_STYLES[style] ?? ZOTERO_STYLES.acs}" hasBibliography="1" bibliographyStyleHasBeenSet="1"/><prefs><pref name="fieldType" value="Field"/></prefs></data>`;
}

/** Zotero's preferences as Word document properties (ZOTERO_PREF_1, _2… of up to 255 characters each). */
export function splitPrefs(prefs: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < prefs.length; i += 255) out.push(prefs.slice(i, i + 255));
  return out;
}
