// File > New from Template, for documents: our own starting points for a chemist's writing (a
// lab report, a Supporting Information file, a thesis chapter). Each is headings in the standard
// styles with a line or two in brackets saying what goes there, so the Navigation pane, the
// table of contents and the accessibility checker work from the start. All are written here for
// this app; none is taken from another program's templates.

import { newDocument, objectRun, paraFromStyle, runStyleOf, styleOf, INCH, type DocText, type DocObject } from './document';
import * as rt from '../richtext';
import type { TextRun, TableCell, ParaStyle } from '../model';

export interface DocTemplate {
  id: string;
  name: string;
  blurb: string;
  make(): DocText;
}

/** A paragraph of a template: its style and its text (an object in a paragraph of its own instead, with `obj`). */
type Line = { style?: string; text?: string; bold?: boolean; italic?: boolean; obj?: DocObject; para?: Partial<ParaStyle> };

const cell = (text: string, bold = false): TableCell => ({ runs: text ? [{ text, ...(bold ? { bold: true } : {}) }] : [] });

/** A table with a heading row and `rows` empty rows. */
function table(heads: string[], widths: number[], rows: number, first?: string[][]): DocObject {
  return {
    kind: 'table',
    table: {
      cols: widths,
      head: 1,
      lines: 'acs',
      rows: [heads.map((h) => cell(h, true)), ...Array.from({ length: rows }, (_, r) => heads.map((_, c) => cell(first?.[r]?.[c] ?? '')))],
    },
  };
}

/** Build a document from its lines, on a fresh document of the standard styles (changed by `setup`). */
function build(lines: Line[], setup?: (t: DocText) => void): DocText {
  const t = newDocument();
  setup?.(t);
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  const objects: Record<number, DocObject> = {};
  let id = 1;
  lines.forEach((l, i) => {
    const s = styleOf(t, l.style ? { style: l.style } : undefined);
    const look = { ...runStyleOf(s), ...(l.bold ? { bold: true } : {}), ...(l.italic ? { italic: true } : {}) };
    if (l.obj) {
      objects[id] = l.obj;
      runs.push(objectRun(id++, runStyleOf(styleOf(t, undefined))));
    } else if (l.text) runs.push({ ...look, text: l.text });
    if (i < lines.length - 1) runs.push({ ...look, text: '\n' });
    paras.push({ ...paraFromStyle(s, {}), ...(l.para ?? {}) });
  });
  return { ...t, runs: rt.normalizeRuns(runs), paras, objects };
}

const H1 = (text: string): Line => ({ style: 'Heading1', text });
const H2 = (text: string): Line => ({ style: 'Heading2', text });
const P = (text: string): Line => ({ text });
const CAPTION = (text: string): Line => ({ style: 'Caption', text });

function labReport(): DocText {
  return build([
    { style: 'Title', text: '[Experiment title]' },
    { text: '[Your name] · [Date] · Notebook [book], page [page]', para: { align: 'center' } },
    H1('Aim'),
    P('[What this reaction or experiment is meant to show or make, in a sentence or two.]'),
    H1('Reaction'),
    P('[Draw the scheme here: Insert > Structure, or paste from a drawing.]'),
    CAPTION('Scheme 1. [What the scheme shows.]'),
    H1('Reagents'),
    { obj: table(['Reagent', 'MW (g/mol)', 'equiv', 'mmol', 'Amount', 'Supplier / lot'], [118, 66, 46, 50, 70, 118], 4, [['[limiting reagent]', '', '1.0']]) },
    H1('Procedure'),
    P('[What was done, in order, with times and temperatures: set-up, addition, monitoring (TLC, eluent, Rf), work-up and purification.]'),
    H1('Observations'),
    P('[Colour changes, exotherms, precipitates, anything unexpected.]'),
    H1('Results'),
    P('[Product, appearance, mass, yield (mmol and %), and the data that show what it is.]'),
    H1('Discussion'),
    P('[What worked, what did not, and what to change next time.]'),
    H1('Safety'),
    P('[Hazards of the reagents and how they were handled; waste streams.]'),
    H1('References'),
    P('[Literature procedures followed or adapted.]'),
  ]);
}

function supportingInformation(): DocText {
  return build([
    { style: 'Title', text: 'Supporting Information' },
    { text: '[Title of the paper]', bold: true, para: { align: 'center' } },
    { text: '[Authors]', para: { align: 'center' } },
    { text: '[Affiliations]', italic: true, para: { align: 'center' } },
    { text: 'Contents', bold: true, para: { keepNext: true } },
    { obj: { kind: 'toc', levels: 2 } },
    H1('General Information'),
    P('[Materials and their sources, how solvents were dried, the instruments used (NMR, HRMS, IR, melting point, optical rotation, HPLC) and how spectra are referenced.]'),
    H1('Experimental Procedures'),
    H2('General Procedure A'),
    P('[A procedure used for several compounds, written once.]'),
    H2('[Compound name] ([number])'),
    P('[Procedure or "Following General Procedure A with…", amounts, purification, and the yield.]'),
    P('[Appearance]; Rf = [value] ([eluent]); ¹H NMR ([MHz] MHz, [solvent]) δ [shifts]; ¹³C NMR ([MHz] MHz, [solvent]) δ [shifts]; HRMS ([method]) m/z [M+H]⁺ calcd for [formula] [mass], found [mass].'),
    H1('NMR Spectra'),
    P('[One spectrum per compound, each labelled with its number, nucleus and solvent.]'),
    H1('References'),
    P('[References cited in this document.]'),
  ]);
}

function thesisChapter(): DocText {
  return build([
    { style: 'Title', text: 'Chapter [N]. [Chapter title]' },
    H1('[N].1 Introduction'),
    P('[The problem, why it matters, and what this chapter sets out to do.]'),
    H2('[N].1.1 Background'),
    P('[The work this chapter builds on.]'),
    H1('[N].2 Results and Discussion'),
    H2('[N].2.1 [First part]'),
    P('[What was found, with schemes, tables and figures as they come up.]'),
    { obj: table(['Entry', 'Conditions', 'Yield (%)', 'Notes'], [44, 200, 64, 140], 3, [['1'], ['2'], ['3']]) },
    CAPTION('Table [N].1. [What was varied, and the conditions held constant.]'),
    H2('[N].2.2 [Second part]'),
    P('[…]'),
    H1('[N].3 Conclusions and Outlook'),
    P('[What the chapter showed, and what comes next.]'),
    H1('[N].4 Experimental'),
    P('[Procedures and data for the compounds in this chapter, or where to find them.]'),
    H1('[N].5 References'),
    P('[References cited in this chapter.]'),
  ], (t) => {
    // a bound thesis: a wider margin on the binding side, and text one and a half lines apart
    t.page = { ...t.page, left: 1.5 * INCH };
    t.styles = { ...t.styles, Normal: { ...t.styles.Normal, line: 1.5 } };
  });
}

export const DOC_TEMPLATES: DocTemplate[] = [
  { id: 'lab-report', name: 'Lab report', blurb: 'Aim, reaction scheme, reagent table, procedure, observations, results and safety.', make: labReport },
  { id: 'si', name: 'Supporting Information', blurb: 'Title block, contents, general information, procedures with a characterization line to fill in, and spectra.', make: supportingInformation },
  { id: 'thesis-chapter', name: 'Thesis chapter', blurb: 'Numbered sections from introduction to experimental, with a wide binding margin and 1.5 line spacing.', make: thesisChapter },
];
