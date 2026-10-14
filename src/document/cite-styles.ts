// Reference styles as settings rather than code: each journal style is a set of choices (how
// authors are written, whether the title is printed, what is bold or italic, where the year
// goes…), so a style can be picked from a list and any of its details changed with a
// checkbox, as different journals and different people want. The presets follow the
// publishers' own author guidelines (cited on each).

/** How a style writes references; every choice can be changed in References > Manage References > Style options. */
export interface CiteFormat {
  // ---- in the text
  /** Citation numbers in the text: superscript (1,3–5), superscript in brackets, [1] on the line, or (1) on the line. */
  cite: 'super' | 'super-square' | 'square' | 'round';
  /** Run three or more numbers in a row together (1–3) rather than 1,2,3. */
  ranges: boolean;
  // ---- the list
  /** The number in front of each entry: (1), [1], 1. or 1. */
  label: '(n)' | '[n]' | 'n.' | 'n';
  /** Fulmer, G. R. or G. R. Fulmer. */
  familyFirst: boolean;
  /** Between authors: "; " or ", ". */
  authorSep: '; ' | ', ';
  /** Before the last author: nothing, "and" or "&". */
  lastAuthor: 'none' | 'and' | '&';
  /** With more than this many authors, list the first `etAlShow` and "et al." (0: list them all). */
  etAlOver: number;
  etAlShow: number;
  /** Initials with full stops and spaces (G. R.), full stops only (G.R.) or neither (GR). */
  initials: 'G. R.' | 'G.R.' | 'GR';
  /** After the authors: ". " (ACS) or ", " (Wiley, RSC). */
  afterAuthors: '. ' | ', ';
  /** Print the article's title. */
  title: boolean;
  /** The title in quotation marks. */
  titleQuotes: boolean;
  /** After the title: ". " or ", ". */
  afterTitle: '. ' | ', ';
  /** The journal's name in italics. */
  journalItalic: boolean;
  /** Where the year goes: after the journal (Organometallics 2010, 29), in brackets after the volume (Organometallics 29 (2010) 2176), or at the end in brackets (… 2176–2179 (2010)). */
  yearAt: 'journal' | 'volume' | 'end';
  yearBold: boolean;
  /** A comma between the journal and the year or volume (Organometallics, 2010) rather than a space. */
  journalComma: boolean;
  volume: 'italic' | 'bold' | 'plain';
  /** Print the issue, in brackets after the volume: 29 (9). */
  issue: boolean;
  /** Pages as a range (2176–2179) or the first page only (2176). */
  firstPageOnly: boolean;
  /** Print an article number (pages without a range, such as 1234 or e202301234); without it the DOI is given instead, as for an article without pages. */
  articleNumber: boolean;
  /** Print the DOI: always, only for an article without pages yet, or never. */
  doi: 'always' | 'no-pages' | 'never';
  /** How the DOI is written: "DOI: 10.…", "DOI 10.…", "doi:10.…" or as a link. */
  doiForm: 'DOI: ' | 'DOI ' | 'doi:' | 'https://doi.org/';
  /** Before the DOI: ". " or ", ". */
  doiSep: '. ' | ', ';
  /** Theses: "Ph.D. Thesis" (ACS) or "PhD thesis". */
  thesisWord: 'Ph.D. Thesis' | 'PhD thesis';
  /** Theses: the year in brackets at the end, as Wiley prints it. */
  thesisYearBrackets: boolean;
}

export interface CitePreset {
  name: string;
  /** Journals that use it, shown in the list. */
  journals: string;
  /** The author guidelines it follows. */
  source: string;
  format: CiteFormat;
}

// The presets, from each publisher's guide for authors (as of 2026). Where a guide could not be
// read directly, the style follows the publisher's citation style file used by Zotero and
// Mendeley (citation-style-language/styles), and the source says so.

const ACS: CiteFormat = {
  cite: 'super', ranges: true, label: '(n)', familyFirst: true, authorSep: '; ', lastAuthor: 'none', etAlOver: 0, etAlShow: 10,
  initials: 'G. R.', afterAuthors: '. ', title: true, titleQuotes: false, afterTitle: '. ', journalItalic: true, yearAt: 'journal', yearBold: true,
  journalComma: false, volume: 'italic', issue: false, firstPageOnly: false, articleNumber: true, doi: 'no-pages', doiForm: 'DOI: ', doiSep: '. ',
  thesisWord: 'Ph.D. Thesis', thesisYearBrackets: false,
};

const WILEY: CiteFormat = {
  ...ACS, cite: 'super-square', label: '[n]', familyFirst: false, authorSep: ', ', afterAuthors: ', ', title: false,
  doiForm: 'DOI ', doiSep: ', ', thesisWord: 'PhD thesis', thesisYearBrackets: true,
};

const RSC: CiteFormat = {
  ...WILEY, cite: 'super', label: 'n', lastAuthor: 'and', yearBold: false, journalComma: true, volume: 'bold', doiForm: 'DOI: ',
  thesisYearBrackets: false,
};

const CHEM_EUROPE: CiteFormat = { ...WILEY, title: true, titleQuotes: true, afterTitle: ', ' };

const ELSEVIER: CiteFormat = {
  ...WILEY, cite: 'square', label: '[n]', initials: 'G.R.', title: true, afterTitle: ', ', yearAt: 'volume', yearBold: false,
  volume: 'plain', doi: 'always', doiForm: 'https://doi.org/', doiSep: '. ', thesisYearBrackets: false,
};

const NATURE: CiteFormat = {
  ...ACS, label: 'n.', authorSep: ', ', lastAuthor: '&', etAlOver: 5, etAlShow: 1, yearAt: 'end', yearBold: false, volume: 'bold',
  doi: 'never', doiForm: 'https://doi.org/', thesisWord: 'PhD thesis',
};

const SCIENCE: CiteFormat = {
  ...WILEY, cite: 'round', label: 'n.', title: true, yearAt: 'end', yearBold: false, volume: 'bold', doi: 'no-pages',
  doiForm: 'https://doi.org/', thesisYearBrackets: false,
};

const THIEME: CiteFormat = { ...ACS, title: false, firstPageOnly: true };

const BEILSTEIN: CiteFormat = { ...ACS, cite: 'square', label: 'n.', title: false, doi: 'always', doiForm: 'doi:' };

const MDPI: CiteFormat = { ...ACS, cite: 'square', label: 'n.', initials: 'G.R.', etAlOver: 10, etAlShow: 10, doi: 'always', doiForm: 'https://doi.org/', doiSep: ', ' };

/** The styles offered, by id. ACS, Angewandte and RSC keep the ids documents already use. */
export const CITE_PRESETS: Record<string, CitePreset> = {
  acs: { name: 'ACS', journals: 'J. Am. Chem. Soc., J. Org. Chem., Org. Lett., Chem. Rev.', source: 'the ACS Style Quick Guide (pubs.acs.org/doi/10.1021/acsguide.40303)', format: ACS },
  rsc: { name: 'RSC', journals: 'Chem. Sci., Chem. Commun., Org. Biomol. Chem., Dalton Trans.', source: 'the Royal Society of Chemistry\'s journal author guidelines', format: RSC },
  angewandte: { name: 'Wiley-VCH (Angewandte)', journals: 'Angew. Chem., Chem. Eur. J., ChemCatChem', source: 'Angewandte Chemie\'s Notice to Authors as printed up to 2025 (Wiley\'s page could not be read here: please compare with a recent issue)', format: WILEY },
  chemeurope: { name: 'Chemistry Europe', journals: 'Eur. J. Org. Chem., ChemBioChem, ChemMedChem', source: 'the Wiley-VCH style with titles in quotes, as Chemistry Europe journals print them (please compare with a recent issue)', format: CHEM_EUROPE },
  elsevier: { name: 'Elsevier', journals: 'Tetrahedron, J. Organomet. Chem., Bioorg. Med. Chem.', source: 'Elsevier\'s numbered reference style (its Guide for Authors could not be read here: please compare with a recent issue)', format: ELSEVIER },
  nature: { name: 'Nature', journals: 'Nature, Nat. Chem., Nat. Synth., Nat. Commun.', source: 'Nature\'s formatting guide (nature.com/nature/for-authors/formatting-guide)', format: NATURE },
  science: { name: 'Science', journals: 'Science, Sci. Adv.', source: 'Science\'s instructions for preparing a manuscript (science.org)', format: SCIENCE },
  thieme: { name: 'Thieme', journals: 'Synthesis, Synlett, Synfacts', source: 'Thieme\'s Synlett instructions for authors (2024)', format: THIEME },
  beilstein: { name: 'Beilstein', journals: 'Beilstein J. Org. Chem.', source: 'the Beilstein Journal of Organic Chemistry\'s author instructions', format: BEILSTEIN },
  mdpi: { name: 'MDPI', journals: 'Molecules, Catalysts, Int. J. Mol. Sci.', source: 'MDPI\'s instructions for authors and references guide (v9)', format: MDPI },
};

export const DEFAULT_STYLE = 'acs';

/** The person's own style for documents that haven't chosen one (settings.json: citeStyle, citeOptions). */
let preferred: { style: string; options: Partial<CiteFormat> } = { style: DEFAULT_STYLE, options: {} };

export function setPreferredStyle(style: string, options: Partial<CiteFormat> = {}): void {
  preferred = { style: style in CITE_PRESETS ? style : DEFAULT_STYLE, options: cleanOptions(options) };
}

export const preferredStyle = (): { style: string; options: Partial<CiteFormat> } => preferred;

/** The format a document uses: its preset with any options changed on top. A document without a style uses the person's own. */
export function citeFormat(style: string | undefined, options?: Partial<CiteFormat>): CiteFormat {
  const known = !!style && style in CITE_PRESETS;
  const base = CITE_PRESETS[known ? style! : preferred.style].format;
  const opts = options ?? (known ? undefined : preferred.options);
  return opts ? { ...base, ...cleanOptions(opts) } : base;
}

const CHOICES: { [K in keyof CiteFormat]: readonly CiteFormat[K][] | 'boolean' | 'count' } = {
  cite: ['super', 'super-square', 'square', 'round'], ranges: 'boolean', label: ['(n)', '[n]', 'n.', 'n'], familyFirst: 'boolean',
  authorSep: ['; ', ', '], lastAuthor: ['none', 'and', '&'], etAlOver: 'count', etAlShow: 'count', initials: ['G. R.', 'G.R.', 'GR'],
  afterAuthors: ['. ', ', '], title: 'boolean', titleQuotes: 'boolean', afterTitle: ['. ', ', '], doiSep: ['. ', ', '], journalItalic: 'boolean', yearAt: ['journal', 'volume', 'end'],
  yearBold: 'boolean', journalComma: 'boolean', volume: ['italic', 'bold', 'plain'], issue: 'boolean', firstPageOnly: 'boolean', articleNumber: 'boolean',
  doi: ['always', 'no-pages', 'never'], doiForm: ['DOI: ', 'DOI ', 'doi:', 'https://doi.org/'], thesisWord: ['Ph.D. Thesis', 'PhD thesis'],
  thesisYearBrackets: 'boolean',
};

/** Only options that make sense (from a file that may be damaged or from another version). */
export function cleanOptions(o: unknown): Partial<CiteFormat> {
  const out: Record<string, unknown> = {};
  if (!o || typeof o !== 'object') return out;
  for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
    const c = CHOICES[k as keyof CiteFormat];
    if (!c) continue;
    if (c === 'boolean' ? typeof v === 'boolean' : c === 'count' ? Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 100 : (c as readonly unknown[]).includes(v)) out[k] = v;
  }
  return out as Partial<CiteFormat>;
}

/** The options that differ from the preset (what a document keeps). */
export function changedOptions(style: string, f: CiteFormat): Partial<CiteFormat> {
  const base = citeFormat(style);
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(CHOICES) as (keyof CiteFormat)[]) if (f[k] !== base[k]) out[k] = f[k];
  return out as Partial<CiteFormat>;
}
