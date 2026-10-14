// References in documents (from SI Assistant's reference manager): DOIs, Crossref's records,
// BibTeX and RIS files, duplicates, citation numbers in order of first citation with ranges,
// and each journal style's bibliography (ACS, Angewandte, RSC). No network: Crossref's
// answer is a recorded sample.

import { describe, it, expect } from 'vitest';
import {
  blankRef, bibliography, brokenCitations, citationNumbers, citationTexts, citationWarning, citeCounts, citeText, cleanRef,
  compressNumbers, delatex, describe as describeRef, fetchDoi, findDuplicate, formatReference, fromCrossref, initials,
  newReferences, normaliseDoi, parseBibtex, parseReferenceText, parseRis, piecesText, shortLabel, ReferenceError,
  type Citing, type Piece, type Reference,
} from '../src/document/references';
import { OBJECT_CHAR, fieldTexts, newDocument, objectRun, documentPlainText } from '../src/document/document';
import type { TextRun } from '../src/model';

/** Crossref's answer for 10.1021/om100106e (api.crossref.org/works/…, cut to the fields used). */
const CROSSREF_FULMER = {
  status: 'ok',
  'message-type': 'work',
  message: {
    publisher: 'American Chemical Society (ACS)',
    issue: '9',
    DOI: '10.1021/om100106e',
    type: 'journal-article',
    page: '2176-2179',
    title: ['NMR Chemical Shifts of Trace Impurities: Common Laboratory Solvents, Organics, and Gases in Deuterated Solvents Relevant to the Organometallic Chemist'],
    volume: '29',
    author: [
      { given: 'Gregory R.', family: 'Fulmer', sequence: 'first', affiliation: [] },
      { given: 'Alexander J. M.', family: 'Miller', sequence: 'additional', affiliation: [] },
      { given: 'Nathaniel H.', family: 'Sherden', sequence: 'additional', affiliation: [] },
      { given: 'Hugo E.', family: 'Gottlieb', sequence: 'additional', affiliation: [] },
      { given: 'Abraham', family: 'Nudelman', sequence: 'additional', affiliation: [] },
      { given: 'Brian M.', family: 'Stoltz', sequence: 'additional', affiliation: [] },
      { given: 'John E.', family: 'Bercaw', sequence: 'additional', affiliation: [] },
      { given: 'Karen I.', family: 'Goldberg', sequence: 'additional', affiliation: [] },
    ],
    'container-title': ['Organometallics'],
    'short-container-title': ['Organometallics'],
    'published-print': { 'date-parts': [[2010, 5, 10]] },
    'published-online': { 'date-parts': [[2010, 4, 16]] },
    issued: { 'date-parts': [[2010, 4, 16]] },
  },
};

const fulmer = (): Reference => ({ ...fromCrossref(CROSSREF_FULMER.message), id: 'r-fulmer' });

const ref = (id: string, extra: Partial<Reference> = {}): Reference => ({ ...blankRef('article', id), ...extra });

/** A text with citations: each array is one citation's references. */
function citing(cites: string[][], refs: Reference[], style: Citing['citeStyle'] = 'acs'): Citing & { runs: TextRun[] } {
  const runs: TextRun[] = [];
  const objects: Citing['objects'] = {};
  cites.forEach((c, i) => {
    objects[i + 1] = { kind: 'cite', refs: c };
    runs.push({ text: `Text ${i} ` }, { obj: i + 1, text: OBJECT_CHAR, sup: true });
  });
  return { runs, objects, references: refs, citeStyle: style };
}

const marked = (ps: Piece[]) => ps.map((p) => (p.bold ? `**${p.text}**` : p.italic ? `*${p.text}*` : p.text)).join('');

describe('reference data', () => {
  it('takes the link and "doi:" off a DOI', () => {
    expect(normaliseDoi(' https://doi.org/10.1021/OM100106E ')).toBe('10.1021/OM100106E');
    expect(normaliseDoi('http://dx.doi.org/10.1021/om100106e')).toBe('10.1021/om100106e');
    expect(normaliseDoi('doi: 10.1039/C5SC01234A')).toBe('10.1039/C5SC01234A');
    expect(normaliseDoi('10.1002/anie.201912345')).toBe('10.1002/anie.201912345');
  });

  it('tidies a reference: authors from text, an en dash in page ranges, bad values made empty', () => {
    const r = cleanRef({ id: 7, type: 'nonsense', authors: 'Smith, J.; Jones, K.', pages: '12 - 19', doi: 'https://doi.org/10.1/x', title: null, year: 2020 });
    expect(r.id).toBe('7');
    expect(r.type).toBe('article');
    expect(r.authors).toEqual(['Smith, J.', 'Jones, K.']);
    expect(r.pages).toBe('12–19');
    expect(r.doi).toBe('10.1/x');
    expect(r.title).toBe('');
    expect(r.year).toBe('2020');
    expect(cleanRef({ authors: null }).authors).toEqual([]);
    expect(cleanRef({ typed: 'My own text' }).typed).toBe('My own text');
  });

  it('names a reference shortly, as SI Assistant does', () => {
    expect(shortLabel(fulmer())).toBe('Fulmer et al. 2010');
    expect(shortLabel(ref('a', { authors: ['Smith, John'], year: '2020' }))).toBe('Smith 2020');
    expect(shortLabel(ref('a', { authors: ['Smith, John', 'Jones, Kate'], year: '2021' }))).toBe('Smith & Jones 2021');
    expect(shortLabel(ref('a', { title: 'A very long title that goes on and on', year: '1999' }))).toBe('A very long title that goes on 1999');
    expect(describeRef(fulmer())).toMatch(/^Fulmer et al\. 2010, Organometallics 29, 2176–2179 — NMR Chemical Shifts/);
  });

  it('finds duplicates by DOI (any case or link), or by title and year when there is no DOI', () => {
    const list = [fulmer(), ref('b', { title: 'Total Synthesis of Something', year: '2001' })];
    expect(findDuplicate(list, ref('x', { doi: 'https://doi.org/10.1021/OM100106E' }))?.id).toBe('r-fulmer');
    expect(findDuplicate(list, ref('x', { title: 'total synthesis of something ', year: '2001' }))?.id).toBe('b');
    expect(findDuplicate(list, ref('x', { title: 'Total Synthesis of Something', year: '2002' }))).toBeNull();
    expect(findDuplicate(list, ref('x', { doi: '10.1/other', title: 'Total Synthesis of Something', year: '2001' }))).toBeNull();
  });

  it('adds only new references from an import, with ids not used yet', () => {
    const existing = [fulmer()];
    const found = [ref('r-fulmer', { doi: '10.1021/om100106e' }), ref('r-fulmer', { title: 'New', year: '2020' }), ref('c', { title: 'New', year: '2020' })];
    const out = newReferences(existing, found);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('New');
    expect(out[0].id).not.toBe('r-fulmer');
  });
});

describe('Crossref', () => {
  it('reads a recorded record: authors last name first, the abbreviated journal, year, pages with an en dash', () => {
    const r = fulmer();
    expect(r.type).toBe('article');
    expect(r.authors[0]).toBe('Fulmer, Gregory R.');
    expect(r.authors).toHaveLength(8);
    expect(r.journal).toBe('Organometallics');
    expect(r.year).toBe('2010');
    expect(r.volume).toBe('29');
    expect(r.issue).toBe('9');
    expect(r.pages).toBe('2176–2179');
    expect(r.doi).toBe('10.1021/om100106e');
    expect(r.publisher).toBe('');
  });

  it('prefers the short journal name, strips markup from titles and reads books', () => {
    const r = fromCrossref({ type: 'journal-article', title: ['Synthesis of <i>trans</i>-Stilbene &amp; Friends'], 'container-title': ['The Journal of Organic Chemistry'], 'short-container-title': ['J. Org. Chem.'], issued: { 'date-parts': [[2019]] }, author: [{ name: 'The Consortium' }] });
    expect(r.title).toBe('Synthesis of trans-Stilbene & Friends');
    expect(r.journal).toBe('J. Org. Chem.');
    expect(r.year).toBe('2019');
    expect(r.authors).toEqual(['The Consortium']);
    const b = fromCrossref({ type: 'book', title: ['Organic Chemistry'], publisher: 'OUP', 'published-print': { 'date-parts': [[2012]] } });
    expect(b.type).toBe('book');
    expect(b.publisher).toBe('OUP');
  });

  it('looks a DOI up through fetch, and says in plain words what went wrong', async () => {
    let asked = '';
    const ok = (async (url: string) => { asked = url; return new Response(JSON.stringify(CROSSREF_FULMER), { status: 200 }); }) as unknown as typeof fetch;
    const r = await fetchDoi('https://doi.org/10.1021/om100106e', ok);
    expect(asked).toBe('https://api.crossref.org/works/10.1021/om100106e');
    expect(r.title).toMatch(/^NMR Chemical Shifts/);
    const missing = (async () => new Response('Resource not found.', { status: 404 })) as unknown as typeof fetch;
    await expect(fetchDoi('10.1021/nothing', missing)).rejects.toThrow(/no record of the DOI/);
    const offline = (async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch;
    await expect(fetchDoi('10.1021/om100106e', offline)).rejects.toThrow(/Are you online/);
    const broken = (async () => new Response('<html>', { status: 200 })) as unknown as typeof fetch;
    await expect(fetchDoi('10.1021/om100106e', broken)).rejects.toThrow(/could not be read/);
    await expect(fetchDoi('not a doi', ok)).rejects.toBeInstanceOf(ReferenceError);
  });
});

describe('BibTeX and RIS', () => {
  it('turns LaTeX accents and symbols into letters', () => {
    expect(delatex('M{\\"u}ller and Sch{\\"o}n')).toBe('Müller and Schön');
    expect(delatex('{\\\'e}t{\\\'{e}} \\c{c}a')).toBe('été ça');
    expect(delatex('Erd\\H{o}s, {\\o}rsted, Stra{\\ss}e, \\v{C}ech')).toBe('Erdős, ørsted, Straße, Čech');
    expect(delatex('CO$_2$ fixation, pp. 1--10 \\& more')).toBe('CO2 fixation, pp. 1–10 & more');
    expect(delatex('{\\textit{trans}}-Stilbene')).toBe('trans-Stilbene');
  });

  it('reads a BibTeX file (as Zotero exports it)', () => {
    const bib = `% exported
@comment{ignore me}
@article{fulmer2010,
  title = {{NMR} Chemical Shifts of Trace Impurities},
  author = {Fulmer, Gregory R. and Miller, Alexander J. M. and G{\\"o}ttlieb, Hugo E.},
  journal = {Organometallics},
  volume = {29},
  number = 9,
  pages = {2176--2179},
  year = {2010},
  doi = {10.1021/om100106e}
}
@book{clayden, author = "Jonathan Clayden and Nick Greeves", title = "Organic Chemistry", publisher = {Oxford University Press}, year = 2012}
@phdthesis{t, author={Doe, Jane}, title={Things}, school={Auburn University}, date={2024-05-01}}`;
    const refs = parseBibtex(bib);
    expect(refs).toHaveLength(3);
    const [a, b, c] = refs;
    expect(a.type).toBe('article');
    expect(a.authors).toEqual(['Fulmer, Gregory R.', 'Miller, Alexander J. M.', 'Göttlieb, Hugo E.']);
    expect(a.title).toBe('NMR Chemical Shifts of Trace Impurities');
    expect(a.pages).toBe('2176–2179');
    expect(a.issue).toBe('9');
    expect(a.doi).toBe('10.1021/om100106e');
    expect(b.type).toBe('book');
    expect(b.authors).toEqual(['Clayden, Jonathan', 'Greeves, Nick']);
    expect(b.publisher).toBe('Oxford University Press');
    expect(b.year).toBe('2012');
    expect(c.type).toBe('thesis');
    expect(c.publisher).toBe('Auburn University');
    expect(c.year).toBe('2024');
  });

  it('reads a RIS file (a journal\'s "Export citation")', () => {
    const ris = 'TY  - JOUR\r\nAU  - Fulmer, Gregory R.\r\nAU  - Miller, Alexander J. M.\r\nTI  - NMR Chemical Shifts\r\nT2  - Organometallics\r\nJ2  - Organometallics\r\nPY  - 2010/05/10\r\nVL  - 29\r\nIS  - 9\r\nSP  - 2176\r\nEP  - 2179\r\nDO  - 10.1021/om100106e\r\nER  - \r\nTY  - BOOK\nAU  - Clayden, J.\nTI  - Organic Chemistry\nPB  - OUP\nPY  - 2012\nER  -\n';
    const refs = parseRis(ris);
    expect(refs).toHaveLength(2);
    expect(refs[0]).toMatchObject({ type: 'article', authors: ['Fulmer, Gregory R.', 'Miller, Alexander J. M.'], journal: 'Organometallics', year: '2010', pages: '2176–2179', doi: '10.1021/om100106e', issue: '9' });
    expect(refs[1]).toMatchObject({ type: 'book', publisher: 'OUP', year: '2012' });
    expect(parseReferenceText('﻿' + ris)).toHaveLength(2);
    expect(parseReferenceText('@article{x, title={T}}')).toHaveLength(1);
    expect(parseReferenceText('nothing here')).toHaveLength(0);
  });
});

describe('citation numbers', () => {
  const refs = ['a', 'b', 'c', 'd', 'e'].map((id) => ref(id));

  it('compresses runs of three or more into ranges', () => {
    expect(compressNumbers([1, 2, 3])).toBe('1–3');
    expect(compressNumbers([3, 1, 2, 5])).toBe('1–3,5');
    expect(compressNumbers([1, 2])).toBe('1,2');
    expect(compressNumbers([5, 7, 6, 7, 9, 10])).toBe('5–7,9,10');
    expect(compressNumbers([4])).toBe('4');
    expect(citeText([1, 2, 3, 5], 'angewandte')).toBe('[1–3,5]');
    expect(citeText([2], 'rsc')).toBe('2');
    expect(citeText([], 'acs')).toBe('[?]');
  });

  it('numbers references in the order they are first cited', () => {
    const t = citing([['c'], ['a', 'c'], ['b', 'd', 'e'], ['c']], refs);
    expect([...citationNumbers(t)]).toEqual([['c', 1], ['a', 2], ['b', 3], ['d', 4], ['e', 5]]);
    expect([...citationTexts(t).values()]).toEqual(['1', '1,2', '3–5', '1']);
    expect(citeCounts(t).get('c')).toBe(3);
    expect(citeCounts(t).get('e')).toBe(1);
  });

  it('follows when the text changes: moving a citation renumbers', () => {
    const t = citing([['a'], ['b']], refs);
    expect(citationTexts(t).get(1)).toBe('1');
    const swapped = { ...t, runs: [t.runs[2], t.runs[3], t.runs[0], t.runs[1]] };
    expect(citationTexts(swapped).get(1)).toBe('2');
    expect(citationTexts(swapped).get(2)).toBe('1');
  });

  it('leaves a deleted reference out, shows [?] when nothing is left, and warns', () => {
    const t = citing([['a'], ['gone'], ['gone', 'b']], refs);
    expect([...citationTexts(t).values()]).toEqual(['1', '[?]', '2']);
    expect(brokenCitations(t)).toEqual([2, 3]);
    expect(citationWarning(t)).toMatch(/^2 citations point to a reference that was deleted/);
    expect(citationWarning(citing([['a']], refs))).toBeNull();
  });

  it('shows the numbers in a document\'s fields, and in its plain text', () => {
    const d = newDocument();
    d.references = [ref('a'), ref('b')];
    d.objects = { 1: { kind: 'cite', refs: ['b'] }, 2: { kind: 'cite', refs: ['a', 'b'] } };
    d.runs = [{ text: 'One' }, objectRun(1, { sup: true }), { text: ' two' }, objectRun(2, { sup: true })];
    expect(fieldTexts(d).get(1)).toBe('1');
    expect(fieldTexts(d).get(2)).toBe('1,2');
    expect(documentPlainText(d)).toBe('One1 two1,2');
    expect(fieldTexts({ ...d, citeStyle: 'angewandte' }).get(2)).toBe('[1,2]');
  });
});

describe('bibliography styles', () => {
  it('writes initials as journals print them', () => {
    expect(initials('Gregory R.')).toBe('G. R.');
    expect(initials('Alexander J. M.')).toBe('A. J. M.');
    expect(initials('A.J.M.')).toBe('A. J. M.');
    expect(initials('Jean-Pierre')).toBe('J.-P.');
    expect(initials('Émile')).toBe('É.');
  });

  it('ACS: last names first with semicolons, the title, journal italic, year bold, volume italic', () => {
    const r = { ...fulmer(), authors: fulmer().authors.slice(0, 2), title: 'NMR Chemical Shifts of Trace Impurities' };
    expect(marked(formatReference(r, 'acs'))).toBe('Fulmer, G. R.; Miller, A. J. M. NMR Chemical Shifts of Trace Impurities. *Organometallics* **2010**, *29*, 2176–2179.');
  });

  it('Angewandte: initials first, no title, year bold, volume italic', () => {
    const r = { ...fulmer(), authors: fulmer().authors.slice(0, 2) };
    expect(marked(formatReference(r, 'angewandte'))).toBe('G. R. Fulmer, A. J. M. Miller, *Organometallics* **2010**, *29*, 2176–2179.');
  });

  it('RSC: initials first, "and" before the last, commas, volume bold', () => {
    const r = { ...fulmer(), authors: fulmer().authors.slice(0, 3) };
    expect(marked(formatReference(r, 'rsc'))).toBe('G. R. Fulmer, A. J. M. Miller and N. H. Sherden, *Organometallics*, 2010, **29**, 2176–2179.');
  });

  it('prints all eight authors of the Fulmer paper', () => {
    const acs = piecesText(formatReference(fulmer(), 'acs'));
    expect(acs.startsWith('Fulmer, G. R.; Miller, A. J. M.; Sherden, N. H.; Gottlieb, H. E.; Nudelman, A.; Stoltz, B. M.; Bercaw, J. E.; Goldberg, K. I. NMR')).toBe(true);
    expect(piecesText(formatReference(fulmer(), 'rsc'))).toContain('J. E. Bercaw and K. I. Goldberg, Organometallics, 2010');
  });

  it('gives a DOI when an article has no pages yet, and keeps an abbreviated journal\'s full stop', () => {
    const r = ref('x', { authors: ['Smith, John'], title: 'New Things', journal: 'Org. Lett.', year: '2024', doi: '10.1021/acs.orglett.4c00001' });
    expect(marked(formatReference(r, 'acs'))).toBe('Smith, J. New Things. *Org. Lett.* **2024**. DOI: 10.1021/acs.orglett.4c00001.');
    expect(marked(formatReference(r, 'angewandte'))).toBe('J. Smith, *Org. Lett.* **2024**, DOI 10.1021/acs.orglett.4c00001.');
  });

  it('prints books, chapters, theses and notes', () => {
    const book = ref('b', { type: 'book', authors: ['Clayden, Jonathan', 'Greeves, Nick'], title: 'Organic Chemistry', publisher: 'Oxford University Press', year: '2012' });
    expect(marked(formatReference(book, 'acs'))).toBe('Clayden, J.; Greeves, N. *Organic Chemistry*; Oxford University Press, 2012.');
    expect(marked(formatReference(book, 'angewandte'))).toBe('J. Clayden, N. Greeves, *Organic Chemistry*, Oxford University Press, 2012.');
    expect(marked(formatReference(book, 'rsc'))).toBe('J. Clayden and N. Greeves, *Organic Chemistry*, Oxford University Press, 2012.');
    const thesis = ref('t', { type: 'thesis', authors: ['Doe, Jane'], title: 'Things', publisher: 'Auburn University', year: '2024' });
    expect(piecesText(formatReference(thesis, 'acs'))).toBe('Doe, J. Things. Ph.D. Thesis, Auburn University, 2024.');
    expect(piecesText(formatReference(thesis, 'angewandte'))).toBe('J. Doe, PhD thesis, Auburn University (2024).');
    const noted = ref('n', { authors: ['Smith, J.'], journal: 'Nature', year: '2001', volume: '1', pages: '2', note: 'Retracted' });
    expect(piecesText(formatReference(noted, 'rsc'))).toBe('J. Smith, Nature, 2001, 1, 2. Retracted.');
  });

  it('lists only cited references, in citation order, typed-over text in place of the automatic', () => {
    const refs = [ref('a', { authors: ['A, Al'], journal: 'J. A', year: '2001' }), ref('b', { authors: ['B, Bo'], journal: 'J. B', year: '2002', typed: 'My own words.' }), ref('c')];
    const t = citing([['b'], ['a']], refs, 'acs');
    const bib = bibliography(t);
    expect(bib.map((e) => [e.n, e.ref.id, e.label, e.typed])).toEqual([[1, 'b', '(1)', true], [2, 'a', '(2)', false]]);
    expect(piecesText(bib[0].pieces)).toBe('My own words.');
    expect(piecesText(bib[1].pieces)).toBe('A, A. *J. A* 2001.'.replace(/\*/g, ''));
    expect(bibliography({ ...t, citeStyle: 'angewandte' })[0].label).toBe('[1]');
    expect(bibliography({ ...t, citeStyle: 'rsc' })[0].label).toBe('1');
  });
});
