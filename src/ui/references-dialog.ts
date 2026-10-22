// References > Manage References: the document's reference list (as SI Assistant's References
// page): add by DOI (filled in from Crossref), by hand, or from a BibTeX or RIS file or pasted
// text; edit, delete, and how many times each is cited. The citation style (ACS, Angewandte,
// RSC and the other common chemistry styles), and any of its details, are chosen here too. Every change is one step of Undo in the document.
//
// Also here: the window that edits one reference (every value can be changed, and the
// bibliography's text for it typed over, with Reset to go back to the automatic text), and
// References > Insert Citation's list to choose references from.

import type { DocFile } from '../document/doc-file';
import type { DocText } from '../document/document';
import { CITE_PRESETS, changedOptions, citeFormat, preferredStyle, setPreferredStyle, type CiteFormat } from '../document/cite-styles';
import {
  REF_TYPES, bibLabel, citeSuper, citeText, formatOf, blankRef, citationNumbers, citationWarning, citeCounts, cleanRef, describe, fetchDoi, findDuplicate,
  formatReference, newRefId, newReferences, normaliseDoi, parseReferenceText, piecesText, shortLabel,
  type CiteStyle, type Piece, type Reference,
} from '../document/references';
import { ask } from './ask';
import { MANAGERS, type CiteManager } from '../document/live-cites';

export interface ReferencesHost {
  file(): DocFile | null;
  flash(msg: string, ms?: number): void;
  /** Choose a BibTeX or RIS file and read its text; null when cancelled. */
  pickFile(): Promise<{ name: string; text: string } | null>;
  /** Look a DOI up (Crossref); throws with a message to show. */
  lookup?(doi: string): Promise<Reference>;
  /** The person chose a style for new documents (settings.json). */
  preferredChanged?(): void;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Partial<HTMLElementTagNameMap[K]> = {}, ...kids: (Node | string)[]): HTMLElementTagNameMap[K] => {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...kids);
  return e;
};

const button = (label: string, title: string, on: () => void, primary = false): HTMLButtonElement => {
  const b = el('button', { type: 'button', textContent: label, title });
  if (primary) b.className = 'primary';
  b.addEventListener('click', on);
  return b;
};

/** Show pieces of text with their italics and bold. */
function showPieces(into: HTMLElement, ps: Piece[]): void {
  into.replaceChildren(...ps.map((p) => {
    if (!p.italic && !p.bold) return document.createTextNode(p.text);
    let n: HTMLElement = el('span', { textContent: p.text });
    if (p.italic) n = el('i', {}, n);
    if (p.bold) n = el('b', {}, n);
    return n;
  }));
}

/** A modal window that closes itself and is removed; resolves with `done`'s value or null. */
function modal<T>(cls: string, build: (d: HTMLDialogElement, done: (v: T | null) => void) => void): Promise<T | null> {
  return new Promise((resolve) => {
    const d = el('dialog', { className: cls });
    let finished = false;
    const done = (v: T | null) => {
      if (finished) return;
      finished = true;
      if (d.open) d.close();
      d.remove();
      resolve(v);
    };
    d.addEventListener('close', () => done(null));
    // keys typed here are for the window, not the document behind it
    d.addEventListener('keydown', (e) => e.stopPropagation());
    build(d, done);
    document.body.append(d);
    d.showModal();
    const first = d.querySelector<HTMLElement>('[autofocus]');
    first?.focus();
    // a list typed in a box starts at its top
    if (first instanceof HTMLTextAreaElement) { first.setSelectionRange(0, 0); first.scrollTop = 0; }
  });
}

// ---------------------------------------------------------------- one reference

/**
 * Edit one reference (or check one filled in from Crossref). Every value can be changed; the
 * bibliography's text can be typed over, and Reset puts the automatic text back.
 */
export function editReference(start: Reference, title: string, style: CiteStyle | CiteFormat, lookup: (doi: string) => Promise<Reference>): Promise<Reference | null> {
  return modal<Reference>('ref-edit', (d, done) => {
    const form = el('form');
    form.append(el('h2', { textContent: title }));
    const inputs = new Map<keyof Reference, HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>();
    const row = (label: string, input: HTMLElement, extra?: HTMLElement, tip?: string) => {
      const l = el('label', { className: 'ask-row ref-row' }, el('span', { textContent: label }), input);
      if (extra) l.append(extra);
      if (tip) l.title = tip;
      form.append(l);
    };
    const type = el('select');
    for (const [k, v] of Object.entries(REF_TYPES)) type.add(new Option(v, k, false, k === start.type));
    inputs.set('type', type);
    row('Type', type);
    const authors = el('textarea', { rows: 4, value: start.authors.join('\n'), placeholder: 'One per line, last name first:\nFulmer, Gregory R.\nMiller, Alexander J. M.' });
    authors.setAttribute('autofocus', '');
    inputs.set('authors', authors);
    row('Authors', authors, undefined, 'One author per line, as "Last, First" (initials are worked out). A name without a comma, such as a group, is printed as typed.');
    const text = (key: keyof Reference, label: string, placeholder = '', tip?: string, extra?: HTMLElement) => {
      const i = el('input', { type: 'text', value: String(start[key] ?? ''), placeholder });
      i.spellcheck = false;
      inputs.set(key, i);
      row(label, i, extra, tip);
      return i;
    };
    text('title', 'Title');
    text('journal', 'Journal or book', 'e.g. Org. Lett. (abbreviated)', 'Printed as typed, so use the abbreviation (J. Org. Chem.). For a chapter, the book\'s title.');
    text('year', 'Year', '2024');
    text('volume', 'Volume');
    text('issue', 'Issue');
    text('pages', 'Pages', 'e.g. 2176–2179 or e202401234', 'A hyphen between page numbers becomes an en dash.');
    const status = el('p', { className: 'ref-status muted small' });
    const fill = button('Fill in from Crossref', 'Look this DOI up online and fill in the other boxes', () => void lookupNow());
    const doi = text('doi', 'DOI', '10.1021/…', undefined, fill);
    text('url', 'Web address');
    text('publisher', 'Publisher', 'for books; a thesis\'s university');
    text('note', 'Note', 'anything else to print after it');
    form.append(status);

    // the bibliography's text: automatic, or typed over
    form.append(el('h3', { textContent: 'In the bibliography' }));
    const preview = el('p', { className: 'ref-preview' });
    const own = el('input', { type: 'checkbox', checked: start.typed !== undefined });
    const typed = el('textarea', { rows: 3, value: start.typed ?? '' });
    const reset = button('Reset to Automatic', 'Go back to the text worked out from the boxes above', () => { own.checked = false; sync(); });
    const ownRow = el('label', { className: 'ref-own' }, own, el('span', { textContent: 'Type my own text for this reference (it replaces the automatic text, in every style)' }));
    form.append(preview, ownRow, typed, el('div', { className: 'ref-reset' }, reset));
    const value = (): Reference => {
      const r: Record<string, unknown> = { ...start };
      for (const [k, i] of inputs) r[k] = k === 'authors' ? i.value.split('\n') : i.value;
      r.typed = own.checked ? typed.value : undefined;
      const out = cleanRef(r as Partial<Reference>);
      if (!own.checked) delete out.typed;
      return out;
    };
    const sync = () => {
      const auto = formatReference(value(), style);
      showPieces(preview, auto);
      preview.classList.toggle('replaced', own.checked);
      typed.hidden = !own.checked;
      reset.disabled = !own.checked;
      if (own.checked && !typed.value.trim()) typed.value = piecesText(auto);
    };
    own.addEventListener('change', () => { sync(); if (own.checked) typed.focus(); });
    form.addEventListener('input', () => sync());
    sync();

    const lookupNow = async () => {
      status.textContent = 'Looking the DOI up on Crossref…';
      fill.disabled = true;
      try {
        const got = await lookup(doi.value);
        type.value = got.type;
        authors.value = got.authors.join('\n');
        for (const k of ['title', 'journal', 'year', 'volume', 'issue', 'pages', 'doi', 'url', 'publisher'] as const) if (got[k]) inputs.get(k)!.value = got[k];
        status.textContent = 'Filled in from Crossref: check the details, then OK.';
        sync();
      } catch (e) {
        status.textContent = e instanceof Error ? e.message : String(e);
      } finally {
        fill.disabled = false;
      }
    };

    const buttons = el('p', { className: 'ask-buttons' }, button('Cancel', '', () => done(null)), el('button', { type: 'submit', className: 'primary', textContent: 'OK' }));
    form.append(buttons);
    form.addEventListener('submit', (e) => { e.preventDefault(); done(value()); });
    d.append(form);
  });
}

// ---------------------------------------------------------------- choosing references to cite

/**
 * References > Insert Citation: tick one or more references (they become one citation, such as
 * 3,5–7). `manage` opens the reference list (to add one) and gives the list as it is after.
 */
export function chooseReferences(t: DocText, chosen: string[], manage: () => Promise<DocText | null>): Promise<string[] | null> {
  return modal<string[]>('cite-pick', (d, done) => {
    let doc = t;
    const ticked: string[] = chosen.filter((id) => doc.references?.some((r) => r.id === id));
    const search = el('input', { type: 'search', placeholder: 'Find by author, title, journal, year or DOI' });
    search.setAttribute('aria-label', 'Find a reference');
    search.setAttribute('autofocus', '');
    const list = el('div', { className: 'cite-list', role: 'listbox' });
    list.setAttribute('aria-multiselectable', 'true');
    const empty = el('p', { className: 'muted' });
    const fillList = () => {
      const q = search.value.trim().toLowerCase();
      const numbers = citationNumbers(doc);
      const refs = (doc.references ?? []).filter((r) => !q || `${describe(r)} ${r.authors.join(' ')} ${r.doi}`.toLowerCase().includes(q));
      list.replaceChildren(...refs.map((r) => {
        const box = el('input', { type: 'checkbox', checked: ticked.includes(r.id) });
        box.addEventListener('change', () => {
          const k = ticked.indexOf(r.id);
          if (box.checked && k < 0) ticked.push(r.id);
          if (!box.checked && k >= 0) ticked.splice(k, 1);
          ok.disabled = !ticked.length;
        });
        const n = numbers.get(r.id);
        return el('label', { className: 'cite-row' }, box, el('span', { className: 'cite-num', textContent: n ? String(n) : '' }), el('span', { textContent: describe(r) }));
      }));
      empty.textContent = !doc.references?.length ? 'There are no references yet: Manage References… adds them (by DOI, by hand, or from a BibTeX or RIS file).'
        : !refs.length ? 'No reference matches.' : '';
    };
    search.addEventListener('input', fillList);
    const ok = el('button', { type: 'submit', className: 'primary', textContent: 'Insert' });
    ok.disabled = !ticked.length;
    const form = el('form', {},
      el('h2', { textContent: 'Insert Citation' }),
      el('p', { className: 'muted', textContent: 'Tick one or more references: they make one citation (3,5–7). References are numbered in order of first citation, and the numbers change by themselves when text moves. The number shown is the one each has now.' }),
      search, list, empty,
      el('p', { className: 'ask-buttons' },
        button('Manage References…', 'Add, edit or import references', async () => {
          const next = await manage();
          if (next) { doc = next; fillList(); }
        }),
        el('span', { className: 'spacer' }),
        button('Cancel', '', () => done(null)), ok));
    form.addEventListener('submit', (e) => { e.preventDefault(); if (ticked.length) done([...ticked]); });
    d.append(form);
    fillList();
  });
}

// ---------------------------------------------------------------- the style and its details

type Control = { key: keyof CiteFormat; label: string; title?: string } & (
  | { kind: 'check' }
  | { kind: 'count' }
  | { kind: 'select'; options: [string, string][] });

/** Every detail of a style, in groups, as the Style options window shows them. */
const STYLE_GROUPS: [string, Control[]][] = [
  ['In the text', [
    { key: 'cite', label: 'Citation numbers', kind: 'select', options: [['super', 'Superscript ¹⁻³'], ['super-square', 'Superscript in brackets ^[1–3]'], ['square', '[1–3] on the line'], ['round', '(1–3) on the line']] },
    { key: 'ranges', label: 'Runs as ranges (1–3, not 1,2,3)', kind: 'check' },
  ]],
  ['The list', [
    { key: 'label', label: 'Number before each entry', kind: 'select', options: [['(n)', '(1)'], ['[n]', '[1]'], ['n.', '1.'], ['n', '1']] },
  ]],
  ['Authors', [
    { key: 'familyFirst', label: 'Order', kind: 'select', options: [['true', 'Fulmer, G. R.'], ['false', 'G. R. Fulmer']] },
    { key: 'initials', label: 'Initials', kind: 'select', options: [['G. R.', 'G. R.'], ['G.R.', 'G.R.'], ['GR', 'GR']] },
    { key: 'authorSep', label: 'Between authors', kind: 'select', options: [['; ', 'Semicolon ( ; )'], [', ', 'Comma ( , )']] },
    { key: 'lastAuthor', label: 'Before the last author', kind: 'select', options: [['none', 'Nothing'], ['and', '"and"'], ['&', '"&"']] },
    { key: 'etAlOver', label: 'Use "et al." above (0: never)', kind: 'count', title: 'With more authors than this, only the first few are listed, then "et al."' },
    { key: 'etAlShow', label: 'Authors listed before "et al."', kind: 'count' },
    { key: 'afterAuthors', label: 'After the authors', kind: 'select', options: [['. ', 'Full stop'], [', ', 'Comma']] },
  ]],
  ['Journal articles', [
    { key: 'title', label: 'Article title', kind: 'check' },
    { key: 'titleQuotes', label: 'Title in quotation marks', kind: 'check' },
    { key: 'afterTitle', label: 'After the title', kind: 'select', options: [['. ', 'Full stop'], [', ', 'Comma']] },
    { key: 'journalItalic', label: 'Journal in italics', kind: 'check' },
    { key: 'yearAt', label: 'Year', kind: 'select', options: [['journal', 'After the journal: Org. Lett. 2024, 26'], ['volume', 'After the volume: Org. Lett. 26 (2024)'], ['end', 'At the end: … 1234–1240 (2024)']] },
    { key: 'yearBold', label: 'Year in bold', kind: 'check' },
    { key: 'journalComma', label: 'Comma after the journal', kind: 'check' },
    { key: 'volume', label: 'Volume', kind: 'select', options: [['italic', 'Italic'], ['bold', 'Bold'], ['plain', 'Plain']] },
    { key: 'issue', label: 'Issue number', kind: 'check' },
    { key: 'firstPageOnly', label: 'First page only', kind: 'check' },
    { key: 'articleNumber', label: 'Article numbers', kind: 'check', title: 'Print an article number (pages without a range, such as e202301234). Off: the DOI is given instead.' },
    { key: 'doi', label: 'DOI', kind: 'select', options: [['no-pages', 'Only without pages'], ['always', 'Always'], ['never', 'Never']] },
    { key: 'doiSep', label: 'Before the DOI', kind: 'select', options: [['. ', 'Full stop'], [', ', 'Comma']] },
    { key: 'doiForm', label: 'DOI written as', kind: 'select', options: [['DOI: ', 'DOI: 10.…'], ['DOI ', 'DOI 10.…'], ['doi:', 'doi:10.…'], ['https://doi.org/', 'https://doi.org/10.…']] },
  ]],
  ['Theses', [
    { key: 'thesisWord', label: 'Called', kind: 'select', options: [['Ph.D. Thesis', 'Ph.D. Thesis'], ['PhD thesis', 'PhD thesis']] },
    { key: 'thesisYearBrackets', label: 'Year in brackets', kind: 'check' },
  ]],
];

/** Real references the preview shows each style with. */
const SAMPLES: Reference[] = [
  { ...blankRef('article', 's1'), authors: ['Fulmer, Gregory R.', 'Miller, Alexander J. M.', 'Sherden, Nathaniel H.', 'Gottlieb, Hugo E.', 'Nudelman, Abraham', 'Stoltz, Brian M.', 'Bercaw, John E.', 'Goldberg, Karen I.'], title: 'NMR Chemical Shifts of Trace Impurities: Common Laboratory Solvents, Organics, and Gases in Deuterated Solvents Relevant to the Organometallic Chemist', journal: 'Organometallics', year: '2010', volume: '29', issue: '9', pages: '2176–2179', doi: '10.1021/om100106e' },
  { ...blankRef('article', 's2'), authors: ['Gottlieb, Hugo E.', 'Kotlyar, Vadim', 'Nudelman, Abraham'], title: 'NMR Chemical Shifts of Common Laboratory Solvents as Trace Impurities', journal: 'J. Org. Chem.', year: '1997', volume: '62', issue: '21', pages: '7512–7515', doi: '10.1021/jo971176v' },
  { ...blankRef('book', 's3'), authors: ['Clayden, Jonathan', 'Greeves, Nick', 'Warren, Stuart'], title: 'Organic Chemistry', year: '2012', publisher: 'Oxford University Press' },
];

export interface StyleChoice { style: string; options: Partial<CiteFormat>; forNew: boolean }

/**
 * References > Manage References > Style options: a style from the list, and any of its
 * details changed, with a preview of real references as they will print.
 */
export function editCiteStyle(style: string, options: Partial<CiteFormat>): Promise<StyleChoice | null> {
  return modal<StyleChoice>('cite-style-dialog', (d, done) => {
    let cur = style in CITE_PRESETS ? style : Object.keys(CITE_PRESETS)[0];
    let f: CiteFormat = citeFormat(cur, options);
    const pick = el('select');
    for (const [k, p] of Object.entries(CITE_PRESETS)) pick.add(new Option(`${p.name} (${p.journals})`, k));
    pick.value = cur;
    const source = el('p', { className: 'muted cite-source' });
    const preview = el('div', { className: 'cite-preview' });
    const inputs = new Map<keyof CiteFormat, HTMLInputElement | HTMLSelectElement>();
    const groups = STYLE_GROUPS.map(([name, ctls]) => el('fieldset', {}, el('legend', { textContent: name }), ...ctls.map((c) => {
      let input: HTMLInputElement | HTMLSelectElement;
      if (c.kind === 'check') input = el('input', { type: 'checkbox' });
      else if (c.kind === 'count') input = el('input', { type: 'number', min: '0', max: '100', step: '1' });
      else {
        input = el('select');
        for (const [v, l] of c.options) input.add(new Option(l, v));
      }
      inputs.set(c.key, input);
      input.addEventListener(c.kind === 'count' ? 'input' : 'change', () => {
        const v = c.kind === 'check' ? (input as HTMLInputElement).checked
          : c.kind === 'count' ? Math.max(0, Math.min(100, Math.round(Number(input.value) || 0)))
            : input.value === 'true' ? true : input.value === 'false' ? false : input.value;
        f = { ...f, [c.key]: v };
        show(false);
      });
      const row = el('label', { className: c.kind === 'check' ? 'cite-check' : 'cite-row', title: c.title ?? '' });
      if (c.kind === 'check') row.append(input, el('span', { textContent: c.label }));
      else row.append(el('span', { textContent: c.label }), input);
      return row;
    })));
    const show = (setInputs = true) => {
      const base = citeFormat(cur);
      for (const [k, input] of inputs) {
        if (setInputs) {
          if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = !!f[k];
          else input.value = String(f[k]);
        }
        // a detail changed from the style's own is marked, so it's clear what Reset puts back
        input.closest('label')?.classList.toggle('changed', f[k] !== base[k]);
      }
      const p = CITE_PRESETS[cur];
      source.textContent = `Follows ${p.source}.`;
      const cite = el('p', {}, 'In the text: …as reported before', citeSuper(f) ? el('sup', { textContent: citeText([1, 2, 3], f) }) : ` ${citeText([1, 2, 3], f)}`, '.');
      preview.replaceChildren(cite, ...SAMPLES.map((r, i) => {
        const line = el('p', { className: 'cite-entry' });
        showPieces(line, formatReference(r, f));
        line.prepend(el('span', { className: 'cite-label', textContent: bibLabel(i + 1, f) }));
        return line;
      }));
      reset.disabled = !Object.keys(changedOptions(cur, f)).length;
      reset.textContent = `Reset to ${p.name}`;
    };
    pick.addEventListener('change', () => { cur = pick.value; f = citeFormat(cur, {}); show(); });
    const reset = button('Reset', 'Put every detail back as the style has it', () => { f = citeFormat(cur, {}); show(); });
    const forNew = el('input', { type: 'checkbox' });
    d.append(
      el('h2', { textContent: 'Reference style' }),
      el('label', { className: 'ask-row refs-style' }, el('span', { textContent: 'Style' }), pick),
      source,
      el('p', { className: 'muted', textContent: 'Change any detail below; the preview shows real references as they will print. Choosing another style starts from that style\'s own details.' }),
      el('div', { className: 'cite-groups' }, ...groups),
      el('h3', { textContent: 'Preview' }),
      preview,
      el('div', { className: 'refs-buttons' },
        el('span', {}, reset, el('label', { className: 'cite-check', title: 'Kept in settings.json. Documents that already have a style keep theirs.' }, forNew, el('span', { textContent: 'Use for new documents' }))),
        el('span', {}, button('Cancel', '', () => done(null)), button('OK', '', () => done({ style: cur, options: changedOptions(cur, f), forNew: forNew.checked }), true))),
    );
    pick.autofocus = true;
    show();
  });
}

// ---------------------------------------------------------------- the list

export class ReferencesDialog {
  private d: HTMLDialogElement | null = null;
  private body!: HTMLTableSectionElement;
  private warning!: HTMLElement;
  private styleSel!: HTMLSelectElement;
  private styleNote!: HTMLElement;
  private managerSel!: HTMLSelectElement;
  private search!: HTMLInputElement;
  private selected: string | null = null;
  private closed: (() => void) | null = null;

  constructor(private host: ReferencesHost) {}

  private get t(): DocText | null {
    return this.host.file()?.t ?? null;
  }

  private lookup = (doi: string): Promise<Reference> => (this.host.lookup ?? ((x: string) => fetchDoi(x)))(doi);

  /** Change the document as one undo step. */
  private change(kind: string, f: (t: DocText) => DocText): void {
    const file = this.host.file();
    if (!file) return;
    file.ed.update(f(file.t), kind);
    this.fill();
  }

  private setRefs(kind: string, refs: Reference[]): void {
    this.change(kind, (t) => ({ ...t, references: refs }));
  }

  /** Show the list; resolves when it is closed. */
  open(select: string | null = null): Promise<void> {
    if (this.d) return Promise.resolve();
    this.selected = select;
    const d = (this.d = el('dialog', { className: 'refs-dialog' }));
    d.setAttribute('aria-label', 'References');
    d.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
      if (e.key === 'Delete' && this.selected) { e.preventDefault(); void this.remove(); }
      if (e.key === 'Enter' && this.selected) { e.preventDefault(); void this.edit(); }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); this.step(e.key === 'ArrowDown' ? 1 : -1); }
    });
    this.styleSel = el('select', { id: 'refs-style' });
    for (const [k, p] of Object.entries(CITE_PRESETS)) this.styleSel.add(new Option(`${p.name} (${p.journals})`, k));
    this.styleSel.addEventListener('change', () => this.setStyle(this.styleSel.value, {}));
    this.styleNote = el('span', { className: 'muted' });
    this.managerSel = el('select', { id: 'refs-manager' });
    this.managerSel.add(new Option('Chem Illustrator only (numbers Word shows as they are)', ''));
    for (const [k, name] of Object.entries(MANAGERS)) this.managerSel.add(new Option(name, k));
    this.managerSel.addEventListener('change', () => {
      const app = (this.managerSel.value || undefined) as CiteManager | undefined;
      this.change('Save citations for', (t) => ({ ...t, citeManager: app }));
      if (app) this.host.flash(`Citations are saved as ${MANAGERS[app]} citations: in Word, ${app === 'endnote' ? 'EndNote\'s Update Citations and Bibliography' : app === 'zotero' ? 'Zotero\'s Refresh' : 'Mendeley\'s refresh'} works on them, and they open here live again.`, 7000);
    });
    this.search = el('input', { type: 'search', placeholder: 'Find a reference' });
    this.search.setAttribute('aria-label', 'Find a reference');
    this.search.addEventListener('input', () => this.fill());
    this.warning = el('p', { className: 'refs-warning', role: 'status' });
    this.body = el('tbody');
    const table = el('table', { className: 'refs-table' },
      el('thead', {}, el('tr', {}, ...['Reference', 'Journal or book', 'Title', 'Cited'].map((h) => el('th', { textContent: h })))), this.body);
    this.body.addEventListener('click', (e) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr?.dataset.id) this.pick(tr.dataset.id);
    });
    this.body.addEventListener('dblclick', (e) => {
      const tr = (e.target as HTMLElement).closest('tr');
      if (tr?.dataset.id) { this.selected = tr.dataset.id; void this.edit(); }
    });
    d.append(
      el('div', { className: 'refs-head' }, el('h2', { textContent: 'References' }), this.search),
      el('p', { className: 'muted', textContent: 'The references of this document, kept in it (and in its Word file). Cite them with References > Insert Citation. Only cited references are printed in the bibliography, numbered in order of first citation, in the style chosen here.' }),
      el('div', { className: 'ask-row refs-style' }, el('label', { htmlFor: 'refs-style', textContent: 'Citation style' }), this.styleSel,
        button('Style Options…', 'Change any detail of the style: authors, "and", et al., title, year, volume, issue, article numbers, DOI…', () => void this.styleOptions())),
      el('p', { className: 'refs-style-note' }, this.styleNote),
      el('div', { className: 'ask-row refs-style', title: 'How citations are saved in the Word file: as this program\'s own fields, or as Zotero\'s, Mendeley\'s or EndNote\'s, so that program can go on managing them in Word. Files from those programs open with their citations live and choose this for you.' },
        el('label', { htmlFor: 'refs-manager', textContent: 'Save citations for' }), this.managerSel),
      this.warning,
      el('div', { className: 'refs-table-wrap' }, table),
      el('div', { className: 'refs-buttons' },
        el('span', { className: 'refs-add' },
          button('Add by DOI…', 'Paste a DOI; the details are filled in from Crossref (needs the internet)', () => void this.addByDoi()),
          button('Add by Hand…', 'Type the details in', () => void this.addByHand()),
          button('Import BibTeX / RIS…', 'A file exported from Zotero, EndNote, Mendeley, or a journal\'s "Export citation"', () => void this.importFile()),
          button('Paste BibTeX / RIS…', 'Paste the text of BibTeX or RIS references', () => void this.pasteText())),
        el('span', { className: 'refs-edit' },
          button('Edit…', 'Change the reference picked (or double-click it)', () => void this.edit()),
          button('Delete…', 'Delete the reference picked', () => void this.remove()),
          button('Close', '', () => d.close(), true))),
    );
    d.addEventListener('close', () => { d.remove(); this.d = null; this.closed?.(); this.closed = null; });
    document.body.append(d);
    this.fill();
    d.showModal();
    this.search.focus();
    return new Promise((resolve) => { this.closed = resolve; });
  }

  /** Fill the table again (after any change). */
  private fill(): void {
    const t = this.t;
    if (!this.d || !t) return;
    const style = this.style();
    this.styleSel.value = style;
    this.managerSel.value = t.citeManager ?? '';
    const changed = Object.keys(changedOptions(style, this.format())).length;
    this.styleNote.textContent = changed ? `${changed} detail${changed === 1 ? '' : 's'} changed from ${CITE_PRESETS[style].name} (Style Options… to see or reset them).` : '';
    const counts = citeCounts(t);
    const q = this.search.value.trim().toLowerCase();
    const refs = (t.references ?? []).filter((r) => !q || `${describe(r)} ${r.authors.join(' ')} ${r.doi}`.toLowerCase().includes(q));
    this.body.replaceChildren(...refs.map((r) => {
      const n = counts.get(r.id) ?? 0;
      const tr = el('tr', {},
        el('td', { textContent: shortLabel(r) + (r.typed !== undefined ? ' ✎' : '') }),
        el('td', { textContent: [r.journal || r.publisher, r.year].filter(Boolean).join(' ') }),
        el('td', { textContent: r.title }),
        el('td', { textContent: n ? `${n} time${n === 1 ? '' : 's'}` : 'not cited' }));
      tr.dataset.id = r.id;
      tr.title = describe(r) + (r.typed !== undefined ? '\n(Its bibliography text was typed over: Edit… to change it or reset it.)' : '');
      if (r.id === this.selected) tr.classList.add('picked');
      if (!n) tr.classList.add('uncited');
      return tr;
    }));
    if (!(t.references ?? []).length) {
      this.body.append(el('tr', {}, el('td', { colSpan: 4, className: 'muted', textContent: 'No references yet. Add one by DOI, by hand, or from a BibTeX or RIS file.' })));
    }
    this.body.querySelector('tr.picked')?.scrollIntoView({ block: 'nearest' });
    this.warning.textContent = citationWarning(t) ?? '';
  }

  /** Pick a reference in the list (without filling it again, so a double-click lands on the same row). */
  private pick(id: string): void {
    this.selected = id;
    for (const tr of this.body.querySelectorAll<HTMLTableRowElement>('tr[data-id]')) tr.classList.toggle('picked', tr.dataset.id === id);
    this.body.querySelector('tr.picked')?.scrollIntoView({ block: 'nearest' });
  }

  private step(dir: 1 | -1): void {
    const rows = [...this.body.querySelectorAll<HTMLTableRowElement>('tr[data-id]')];
    if (!rows.length) return;
    const i = rows.findIndex((r) => r.dataset.id === this.selected);
    this.pick(rows[Math.max(0, Math.min(rows.length - 1, i < 0 ? 0 : i + dir))].dataset.id!);
  }

  private current(): Reference | null {
    return this.t?.references?.find((r) => r.id === this.selected) ?? null;
  }

  /** Add a reference unless it is in the list already (then that one is picked). */
  private add(r: Reference): void {
    const t = this.t;
    if (!t) return;
    const list = t.references ?? [];
    const dup = findDuplicate(list, r);
    if (dup) {
      this.selected = dup.id;
      this.fill();
      this.host.flash(`This reference is already in the list (${shortLabel(dup)}).`, 5000);
      return;
    }
    const taken = new Set(list.map((x) => x.id));
    const ref = taken.has(r.id) ? { ...r, id: newRefId(taken) } : r;
    this.selected = ref.id;
    this.setRefs(`Add reference ${shortLabel(ref)}`, [...list, ref]);
  }

  /** The document's style (or, until it has one, the person's own). */
  private style(): CiteStyle {
    const s = this.t?.citeStyle;
    return s && s in CITE_PRESETS ? s : preferredStyle().style;
  }

  private format(): CiteFormat {
    return this.t ? formatOf(this.t) : citeFormat(undefined);
  }

  /** Use a style with some of its details changed; citations go up into superscript or down onto the line as it has them. One undo step. */
  private setStyle(style: string, options: Partial<CiteFormat>): void {
    this.change('Citation style', (t) => {
      const sup = citeSuper(citeFormat(style, options));
      const runs = t.runs.map((r) => (r.obj !== undefined && t.objects[r.obj]?.kind === 'cite' && !!r.sup !== sup ? { ...r, sup: sup || undefined, sub: undefined } : r));
      return { ...t, runs, citeStyle: style, citeOptions: Object.keys(options).length ? options : undefined };
    });
  }

  private async styleOptions(): Promise<void> {
    const t = this.t;
    if (!t) return;
    const got = await editCiteStyle(this.style(), t.citeStyle ? t.citeOptions ?? {} : preferredStyle().options);
    if (!got) return;
    this.setStyle(got.style, got.options);
    if (got.forNew) {
      setPreferredStyle(got.style, got.options);
      this.host.preferredChanged?.();
      this.host.flash(`New documents will use ${CITE_PRESETS[got.style].name} style${Object.keys(got.options).length ? ' with your changes' : ''}.`, 4000);
    }
  }

  private async addByDoi(): Promise<void> {
    const got = await ask('Add by DOI', [{ name: 'doi', label: 'DOI', value: '' }], {
      ok: 'Look Up', note: 'Paste a DOI (10.1021/om100106e) or a doi.org link. The details are filled in from Crossref, which needs the internet; you can check and change them before they are added.',
    });
    const doi = got?.doi.trim();
    if (!doi) return;
    let found: Reference;
    try {
      this.host.flash('Looking the DOI up on Crossref…', 3000);
      found = await this.lookup(doi);
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      const by = await ask('Could not look up the DOI', [], { ok: 'Enter by Hand', note: `${why} Enter the reference by hand instead?` });
      if (by) await this.addByHand({ ...blankRef(), doi: normaliseDoi(doi) });
      return;
    }
    const dup = findDuplicate(this.t?.references ?? [], found);
    if (dup) { this.add(found); return; }
    const r = await editReference(found, 'Check the Reference', this.format(), this.lookup);
    if (r) this.add(r);
  }

  private async addByHand(start: Reference = blankRef()): Promise<void> {
    const r = await editReference(start, 'New Reference', this.format(), this.lookup);
    if (r) this.add(r);
  }

  private async importFile(): Promise<void> {
    let f: { name: string; text: string } | null;
    try {
      f = await this.host.pickFile();
    } catch (e) {
      this.host.flash(`Could not read the file: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return;
    }
    if (f) this.importText(f.text, f.name);
  }

  private async pasteText(): Promise<void> {
    const text = await modal<string>('ref-paste', (d, done) => {
      const area = el('textarea', { rows: 14, placeholder: '@article{key,\n  author = {Fulmer, Gregory R. and …},\n  …\n}\n\nor RIS:\nTY  - JOUR\nAU  - Fulmer, Gregory R.\n…\nER  -' });
      area.setAttribute('autofocus', '');
      area.spellcheck = false;
      const form = el('form', {},
        el('h2', { textContent: 'Paste BibTeX or RIS' }),
        el('p', { className: 'muted', textContent: 'Paste references copied from Zotero, EndNote, Mendeley, Google Scholar or a journal\'s "Export citation" (BibTeX or RIS). References already in the list are not added again.' }),
        area,
        el('p', { className: 'ask-buttons' }, button('Cancel', '', () => done(null)), el('button', { type: 'submit', className: 'primary', textContent: 'Import' })));
      form.addEventListener('submit', (e) => { e.preventDefault(); done(area.value); });
      d.append(form);
    });
    if (text?.trim()) this.importText(text, 'the pasted text');
  }

  private importText(text: string, from: string): void {
    const t = this.t;
    if (!t) return;
    const found = parseReferenceText(text);
    const list = t.references ?? [];
    const added = newReferences(list, found);
    if (added.length) {
      this.selected = added[0].id;
      this.setRefs(`Import references`, [...list, ...added]);
    }
    const skipped = found.length - added.length;
    this.host.flash(!found.length ? `No references were found in ${from} (BibTeX or RIS).`
      : `Added ${added.length} reference${added.length === 1 ? '' : 's'} from ${from}.${skipped ? ` ${skipped} ${skipped === 1 ? 'was' : 'were'} already in the list.` : ''}`, 6000);
  }

  private async edit(): Promise<void> {
    const cur = this.current();
    if (!cur) { this.host.flash('Click a reference in the list first.'); return; }
    const r = await editReference(cur, 'Edit Reference', this.format(), this.lookup);
    const t = this.t;
    if (!r || !t) return;
    this.setRefs(`Edit reference ${shortLabel(r)}`, (t.references ?? []).map((x) => (x.id === cur.id ? { ...r, id: cur.id } : x)));
  }

  private async remove(): Promise<void> {
    const cur = this.current();
    const t = this.t;
    if (!cur || !t) { this.host.flash('Click a reference in the list first.'); return; }
    const n = citeCounts(t).get(cur.id) ?? 0;
    const ok = await ask('Delete Reference', [], {
      ok: 'Delete',
      note: `Delete ${shortLabel(cur)}?` + (n ? ` It is cited ${n === 1 ? 'once' : `${n} times`}: those citations will show [?] (or leave it out) and the bibliography will leave it out. Undo brings it back.` : ''),
    });
    if (!ok) return;
    const rows = [...this.body.querySelectorAll<HTMLTableRowElement>('tr[data-id]')].map((r) => r.dataset.id);
    const i = rows.indexOf(cur.id);
    this.selected = rows[i + 1] ?? rows[i - 1] ?? null;
    this.setRefs(`Delete reference ${shortLabel(cur)}`, (this.t?.references ?? []).filter((x) => x.id !== cur.id));
    if (n) this.host.flash(`${shortLabel(cur)} was deleted; its citations now show [?] or leave it out (Undo brings it back).`, 7000);
  }
}
