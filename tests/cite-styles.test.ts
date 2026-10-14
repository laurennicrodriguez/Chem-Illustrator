// Journal reference styles as settings: each preset prints a real reference as its publisher's
// guide shows, every detail can be changed on top of a preset, and the changes are kept
// (only those that make sense, from a file or settings).

import { afterEach, describe, it, expect } from 'vitest';
import { CITE_PRESETS, changedOptions, citeFormat, cleanOptions, preferredStyle, setPreferredStyle } from '../src/document/cite-styles';
import { authorList, bibLabel, bibliography, blankRef, citeSuper, citeText, formatReference, type Citing, type Piece } from '../src/document/references';

/** Pieces as markdown (*italic*, **bold**), to compare the looks too. */
const md = (ps: Piece[]) => ps.map((p) => (p.bold ? `**${p.text}**` : p.italic ? `*${p.text}*` : p.text)).join('');

const FULMER = {
  ...blankRef('article'), authors: ['Fulmer, Gregory R.', 'Miller, Alexander J. M.', 'Sherden, Nathaniel H.', 'Gottlieb, Hugo E.', 'Nudelman, Abraham', 'Stoltz, Brian M.', 'Bercaw, John E.', 'Goldberg, Karen I.'],
  title: 'NMR Chemical Shifts of Trace Impurities', journal: 'Organometallics', year: '2010', volume: '29', issue: '9', pages: '2176–2179', doi: '10.1021/om100106e',
};
const GOTTLIEB = { ...blankRef('article'), authors: ['Gottlieb, Hugo E.', 'Kotlyar, Vadim', 'Nudelman, Abraham'], title: 'NMR Shifts', journal: 'J. Org. Chem.', year: '1997', volume: '62', issue: '21', pages: '7512–7515', doi: '10.1021/jo971176v' };
const ONLINE = { ...blankRef('article'), authors: ['Doe, Jane'], title: 'Online', journal: 'Nat. Commun.', year: '2024', volume: '15', pages: '1234', doi: '10.1038/x' };

const as = (style: string, r = GOTTLIEB, o = {}) => md(formatReference(r, citeFormat(style, o)));

afterEach(() => setPreferredStyle('acs'));

describe('the presets', () => {
  it('print a reference as each journal style does', () => {
    expect(as('acs')).toBe('Gottlieb, H. E.; Kotlyar, V.; Nudelman, A. NMR Shifts. *J. Org. Chem.* **1997**, *62*, 7512–7515.');
    expect(as('rsc')).toBe('H. E. Gottlieb, V. Kotlyar and A. Nudelman, *J. Org. Chem.*, 1997, **62**, 7512–7515.');
    expect(as('angewandte')).toBe('H. E. Gottlieb, V. Kotlyar, A. Nudelman, *J. Org. Chem.* **1997**, *62*, 7512–7515.');
    expect(as('chemeurope')).toBe('H. E. Gottlieb, V. Kotlyar, A. Nudelman, “NMR Shifts,” *J. Org. Chem.* **1997**, *62*, 7512–7515.');
    expect(as('elsevier')).toBe('H.E. Gottlieb, V. Kotlyar, A. Nudelman, NMR Shifts, *J. Org. Chem.* 62 (1997) 7512–7515. https://doi.org/10.1021/jo971176v');
    expect(as('nature')).toBe('Gottlieb, H. E., Kotlyar, V. & Nudelman, A. NMR Shifts. *J. Org. Chem.* **62**, 7512–7515 (1997).');
    expect(as('science')).toBe('H. E. Gottlieb, V. Kotlyar, A. Nudelman, NMR Shifts. *J. Org. Chem.* **62**, 7512–7515 (1997).');
    expect(as('thieme')).toBe('Gottlieb, H. E.; Kotlyar, V.; Nudelman, A. *J. Org. Chem.* **1997**, *62*, 7512.');
    expect(as('beilstein')).toBe('Gottlieb, H. E.; Kotlyar, V.; Nudelman, A. *J. Org. Chem.* **1997**, *62*, 7512–7515. doi:10.1021/jo971176v.');
    expect(as('mdpi')).toBe('Gottlieb, H.E.; Kotlyar, V.; Nudelman, A. NMR Shifts. *J. Org. Chem.* **1997**, *62*, 7512–7515, https://doi.org/10.1021/jo971176v');
  });

  it('shorten long author lists where the style does', () => {
    expect(as('nature', FULMER)).toMatch(/^Fulmer, G\. R\. et al\. NMR/);
    expect(as('acs', FULMER)).toContain('Bercaw, J. E.; Goldberg, K. I. NMR');
    expect(authorList(FULMER.authors, citeFormat('mdpi', { etAlOver: 5, etAlShow: 3 }))).toBe('Fulmer, G.R.; Miller, A.J.M.; Sherden, N.H.; et al.');
    expect(authorList(FULMER.authors, citeFormat('angewandte', { etAlOver: 6, etAlShow: 3 }))).toBe('G. R. Fulmer, A. J. M. Miller, N. H. Sherden, et al.');
  });

  it('number citations and entries as each style does', () => {
    expect([citeText([1, 2, 3, 5], citeFormat('acs')), citeText([1, 2, 3], citeFormat('angewandte')), citeText([2, 1], citeFormat('elsevier')), citeText([4], citeFormat('science'))])
      .toEqual(['1–3,5', '[1–3]', '[1,2]', '(4)']);
    expect(citeText([1, 2, 3], citeFormat('acs', { ranges: false }))).toBe('1,2,3');
    expect(['acs', 'angewandte', 'rsc', 'nature', 'elsevier'].map((s) => bibLabel(7, citeFormat(s)))).toEqual(['(7)', '[7]', '7', '7.', '[7]']);
    expect(['acs', 'angewandte', 'elsevier', 'science'].map((s) => citeSuper(citeFormat(s)))).toEqual([true, true, false, false]);
  });

  it('each name a source and journals that use it', () => {
    for (const p of Object.values(CITE_PRESETS)) {
      expect(p.name && p.journals && p.source).toBeTruthy();
      expect(cleanOptions(p.format)).toEqual(p.format);
    }
  });
});

describe('changing the details', () => {
  it('"and" before the last author, the title, the issue', () => {
    expect(as('angewandte', GOTTLIEB, { lastAuthor: 'and' })).toMatch(/^H\. E\. Gottlieb, V\. Kotlyar and A\. Nudelman, /);
    expect(as('rsc', GOTTLIEB, { title: true })).toContain('A. Nudelman, NMR Shifts. *J. Org. Chem.*');
    expect(as('acs', GOTTLIEB, { issue: true })).toContain('*62* (21), 7512');
    expect(as('acs', GOTTLIEB, { initials: 'GR', familyFirst: true })).toMatch(/^Gottlieb HE; Kotlyar V; Nudelman A\. /);
  });

  it('article numbers, or the DOI instead', () => {
    expect(as('acs', ONLINE)).toBe('Doe, J. Online. *Nat. Commun.* **2024**, *15*, 1234.');
    expect(as('acs', ONLINE, { articleNumber: false })).toBe('Doe, J. Online. *Nat. Commun.* **2024**, *15*. DOI: 10.1038/x.');
    expect(as('acs', GOTTLIEB, { doi: 'always', doiForm: 'https://doi.org/' })).toBe('Gottlieb, H. E.; Kotlyar, V.; Nudelman, A. NMR Shifts. *J. Org. Chem.* **1997**, *62*, 7512–7515. https://doi.org/10.1021/jo971176v');
    expect(as('rsc', GOTTLIEB, { doi: 'never' })).not.toContain('DOI');
  });

  it('the year after the volume or at the end', () => {
    expect(as('acs', GOTTLIEB, { yearAt: 'volume', yearBold: false })).toContain('*J. Org. Chem.* *62* (1997) 7512–7515.');
    expect(as('acs', GOTTLIEB, { yearAt: 'end', yearBold: false })).toContain('*J. Org. Chem.* *62*, 7512–7515 (1997).');
  });

  it('keeps only the details that differ from the style, and only sensible ones', () => {
    const f = { ...citeFormat('rsc'), lastAuthor: 'none' as const, issue: true };
    expect(changedOptions('rsc', f)).toEqual({ lastAuthor: 'none', issue: true });
    expect(cleanOptions({ lastAuthor: 'or', issue: 'yes', etAlOver: -2, volume: 'bold', nonsense: 1 })).toEqual({ volume: 'bold' });
    expect(cleanOptions(null)).toEqual({});
  });

  it('a document uses its own style and details; one without uses the person\'s own', () => {
    const t: Citing = { runs: [{ text: '￼', obj: 1 }], objects: { 1: { kind: 'cite', refs: ['a'] } }, references: [{ ...GOTTLIEB, id: 'a' }] };
    expect(bibliography(t)[0].label).toBe('(1)');
    setPreferredStyle('nature', { label: '[n]' });
    expect(preferredStyle()).toEqual({ style: 'nature', options: { label: '[n]' } });
    expect(bibliography(t)[0].label).toBe('[1]');
    expect(md(bibliography(t)[0].pieces)).toMatch(/& Nudelman, A\./);
    expect(bibliography({ ...t, citeStyle: 'rsc' })[0].label).toBe('1');
    expect(bibliography({ ...t, citeStyle: 'rsc', citeOptions: { label: 'n.' } })[0].label).toBe('1.');
    setPreferredStyle('nonsense');
    expect(preferredStyle().style).toBe('acs');
  });
});
