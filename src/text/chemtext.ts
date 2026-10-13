// Recognising chemistry in text: formulas, deuterated solvents, nuclei before "NMR", numbers
// glued to their units and hyphens in number ranges. Used to format chemistry as it is typed
// and by the formatting check (blue underlines). Rewritten from SI Assistant's chemtext.py.

const ELEMENTS = ('H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn '
  + 'Ga Ge As Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce '
  + 'Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi D T').split(' ');
const GROUPS = ['Me', 'Et', 'Pr', 'Bu', 'Ph', 'Bn', 'Bz', 'Ac', 'Ts', 'Ms', 'Tf', 'Cy', 'Cp', 'Boc',
  'Cbz', 'Fmoc', 'Piv', 'Tol', 'Mes', 'TMS', 'TES'];
// (TBS and TIPS need no entry: they read as the elements T, B, S and T, I, P, S. No entry may
// be readable as a run of other units, or a long word could take the matcher a long time.)
// Ligands written in lower case: part of a formula inside brackets (Pd2(dba)3, Ni(cod)2,
// [Ir(cod)Cl]2); "pin" also straight after B (B2pin2).
const LIGANDS = ['dba', 'cod', 'nbd', 'bpy', 'bipy', 'dtbbpy', 'dtbpy', 'ppy', 'phen', 'py', 'acac',
  'pin', 'cat', 'dppf', 'dppe', 'dppp', 'dppb', 'tmeda'];
const BARE_LIGANDS = ['pin'];

const alternatives = (words: string[]) => [...words].sort((a, b) => b.length - a.length).join('|');

// one unit of a formula: an element, a group, or an alkyl group with an i/n/s/t in front
// (iPr2NEt, nBu4NI, tBu3P, N(iPr)2, Ti(OiPr)4)
const UNIT = `(?:(?<![A-Za-z])[inst]-?(?:Pr|Bu)|(?<=O)[int](?:Pr|Bu)|${alternatives([...ELEMENTS, ...GROUPS])})`;
const INNER = `(?:${alternatives(LIGANDS)}|${UNIT})`;
const PAREN = `\\((?:${INNER}\\d*)+\\)\\d*`;
const BRACKET = `\\[(?:${INNER}\\d*|${PAREN})+\\]\\d*`;
const ITEM = `(?:${UNIT}\\d*|(?:(?<=B)|(?<=B\\d))(?:${alternatives(BARE_LIGANDS)})\\d*|${PAREN}|${BRACKET})`;

// Words that look like formulas but are not: SN1/SN2 mechanisms, transition states, IC50
// values, photosystems, optical density, supplementary labels, protein and cell-line names.
const FORMULA_EXCEPTIONS = 'S[NE][12]|TS\\d+|IC\\d+|CC\\d+|[IL]D\\d+|PS[12]|OD\\d+|SI\\d+|NIH3T3|'
  + 'COVID\\d*|HCT\\d+|HT\\d+|PC\\d+|PI3K\\w*|CDK\\d+|CDC\\d+|CYP\\w+|CB\\d+|'
  + 'P2[XY]\\d+|INT\\d+|HSP\\d+|NS\\d+|HIV\\d*|NK\\d+|SH[23]|PDK\\d+|CK\\d+|TBK\\d+';
// Molecules of one element. Their names are also atom labels ("1H, H2", "N2-alkylation"), so
// they count as formulas only in context: halogens and ozone unless next to a dash, the
// others only when the words around them show the gas ("under N2", "H2 (1 atm)").
const ALWAYS_MOLECULES = ['Cl2', 'Br2', 'I2', 'O3'];
const CONTEXT_MOLECULES = ['H2', 'D2', 'N2', 'O2', 'F2'];
const SINGLE_ELEMENT = [...ALWAYS_MOLECULES, ...CONTEXT_MOLECULES];
const MOLECULE_BEFORE = new Set(('under atmosphere balloon atm bar psi purged flushed backfilled sparged bubbled degassed '
  + 'evacuated dry anhydrous gaseous liquid pressurized pressure stream flow filled charged '
  + 'saturated excess hydrogenated hydrogenation').split(' '));
const MOLECULE_BRIDGE = new Set(['of', 'with', 'a', 'an', 'the']);
const MOLECULE_AFTER = new Set(('gas atmosphere atmospheres balloon atm bar psi mpa kpa torr pressure stream flow line '
  + 'inlet purge uptake evolution sparging bubbling manifold').split(' '));
const MOLECULE_HYPHEN = new Set(['filled', 'free', 'saturated', 'purged', 'flushed', 'atmosphere', 'sparged']);

// A formula-like word: two or more units with a digit after one of them (CDCl3, Na2SO4,
// Pd(PPh3)4, [Ir(cod)Cl]2), or a molecule of one element (checked in context).
const FORMULA = new RegExp(
  '(?<![A-Za-z0-9])(?=\\S{1,100}(?!\\S))'
  + `(?!(?:${FORMULA_EXCEPTIONS})(?![A-Za-z0-9]))`
  + `(?:(?=[A-Za-z()\\[\\]-]*\\d)(?:${ITEM}{2,}`
  + `|\\[(?:${INNER}\\d*|${PAREN}){2,}\\]\\d*${ITEM}*)`
  + `|(?:${SINGLE_ELEMENT.join('|')}))`
  + '(?![A-Za-z0-9])', 'g');

/** A word in any capitals, as a regex (JavaScript has no inline (?i:) everywhere yet). */
const anyCase = (w: string) => w.replace(/[A-Za-z]/g, (c) => `[${c.toLowerCase()}${c.toUpperCase()}]`);
const DEUTERATED_NAMES = 'DMSO|DMF|acetone|THF|toluene|benzene|methanol|MeOH|MeOD|MeCN|acetonitrile|pyridine|DCM|'
  + 'dichloromethane|chloroform|dioxane|cyclohexane|nitromethane';
const NAMES_ANY_CASE = DEUTERATED_NAMES.split('|').map(anyCase).join('|');
// "DMSO-d6", "methanol-d4", "chloroform-d" (no digits): group 1 the name, group 2 the digits
const DEUTERATED = new RegExp(`\\b(${NAMES_ANY_CASE})-d(\\d+|(?<=${anyCase('chloroform')}-d))(?![A-Za-z0-9])`, 'g');
// the same the other way round: "d6-DMSO"
const DEUTERATED_PREFIX = new RegExp(`(?<![A-Za-z0-9])d(\\d+)-(?=(?:${NAMES_ANY_CASE})\\b)`, 'g');
export const SOLVENT_FORMULAS = ['CDCl3', 'CD2Cl2', 'CD3OD', 'CD3CN', 'C6D6', 'D2O', 'CD3SOCD3'];
// a nucleus only before "NMR" or a decoupling brace, so integrations ("2H") are left alone
const NUCLEUS = /(?<![A-Za-z0-9])(\d{1,3})(H|C|F|P|B|N|Si|Se|Sn|Pt|Li|O|Al)(?=\s*NMR\b|\{|\})/g;
const RANGE_CHAIN = /\d[\d.]*(?:-\d[\d.]*)+/g;

/** Units written after a number with a space (ACS: "1.2 mmol", "8.0 Hz", "25 °C"). */
export const UNITS = ['mmol', 'µmol', 'μmol', 'nmol', 'mol', 'mg', 'µg', 'μg', 'kg', 'mL', 'µL', 'μL', 'nL',
  'mM', 'µM', 'μM', 'nM', 'Hz', 'kHz', 'MHz', 'GHz', 'min', 'nm', 'cm', 'mm', 'µm', 'μm',
  '°C', 'equiv', 'ppm', 'psi', 'mbar', 'bar', 'atm', 'Torr', 'kcal', 'kJ', 'wt%', 'mol%'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\%]/g, '\\$&');
const LONG_UNITS = [...UNITS].sort((a, b) => b.length - a.length).map(esc).join('|');
const GLUED_UNITS = [
  new RegExp(`(?<![\\w.,])(\\d+(?:\\.\\d+)?)(${LONG_UNITS})(?![A-Za-z%])`, 'g'),
  /(?<![\w.,])(\d+\.\d+)([ghs])(?![A-Za-z%])/g,
  /(?<![\w.,])(\d+(?:\.\d+)?)([LMK])(?![A-Za-z%])/g,
];
const UNIT_START = new RegExp(`^(?:${LONG_UNITS}|wt|[ghsLMK])(?![A-Za-z])`);
const URL = /(?<!\S)\S*?(?:https?:\/\/|www\.|doi\.org|doi:)\S*|\b10\.\d{4,}\/\S+/gi;

const DASHES = "-–—‐'′’";

/** Is the one-element word text[start..end] (N2, Cl2…) the molecule here, not an atom label? */
function molecule(text: string, start: number, end: number): boolean {
  const word = text.slice(start, end);
  const after = text.slice(end, end + 30);
  const hy = /^-([A-Za-z]+)/.exec(after);
  if (hy && MOLECULE_HYPHEN.has(hy[1].toLowerCase())) return true; // "N2-filled glovebox"
  if ((after && DASHES.includes(after[0])) || (start > 0 && DASHES.includes(text[start - 1]))) return false;
  if (ALWAYS_MOLECULES.includes(word)) return true;
  let before = text.slice(Math.max(0, start - 50), start);
  for (let k = 0; k < 3; k++) {
    // "under N2", "purged with N2", "under an atmosphere of N2"
    const m = /([A-Za-z]+)[\s(]*$/.exec(before);
    if (!m) break;
    const prev = m[1].toLowerCase();
    if (MOLECULE_BEFORE.has(prev)) return true;
    if (!MOLECULE_BRIDGE.has(prev)) break;
    before = before.slice(0, m.index);
  }
  const m = /^\s*\(?\s*(?:\d+(?:\.\d+)?\s*)?([A-Za-z]+)/.exec(after);
  return !!m && MOLECULE_AFTER.has(m[1].toLowerCase());
}

export interface Found { start: number; end: number; text: string }

/** The formulas in a text, with the context rules applied. Words in `leave` (lower case) are skipped. */
export function formulaMatches(text: string, leave: ReadonlySet<string> = new Set()): Found[] {
  const out: Found[] = [];
  for (const m of text.matchAll(FORMULA)) {
    const word = m[0];
    const start = m.index!;
    if (leave.has(word.toLowerCase())) continue;
    if (/[DT]\d{3}/.test(word)) continue; // OD600, HCT116
    if (SINGLE_ELEMENT.includes(word) && !molecule(text, start, start + word.length)) continue;
    out.push({ start, end: start + word.length, text: word });
  }
  return out;
}

/** Is this word on its own a formula whose digits should be subscripts? */
export function isFormula(word: string): boolean {
  return formulaMatches(word).some((m) => m.start === 0 && m.end === word.length);
}

/** Positions of the digits of the formulas in a text (only the one ending at `end`, when given). */
export function formulaDigits(text: string, end?: number, leave?: ReadonlySet<string>): number[] {
  const out: number[] = [];
  for (const m of formulaMatches(text, leave)) {
    if (end !== undefined && m.end !== end) continue;
    for (let i = 0; i < m.text.length; i++) if (/\d/.test(m.text[i])) out.push(m.start + i);
  }
  return out;
}

/**
 * Hyphens in number ranges ("7.36-7.29", "1-3"). Left alone: chains with more than one hyphen
 * (CAS numbers, dates), numbers stuck to a word before them (C2-3) and numbers followed by
 * letters that are not a unit (6-31G).
 */
export function rangeHyphens(text: string): number[] {
  const out: number[] = [];
  for (const c of text.matchAll(RANGE_CHAIN)) {
    const start = c.index!, end = start + c[0].length;
    if ((c[0].match(/-/g) ?? []).length > 1) continue;
    if (/[A-Za-z][-–]?$|\d[-–]$/.test(text.slice(Math.max(0, start - 2), start))) continue;
    const rest = text.slice(end, end + 12);
    if (/^[-–]\d/.test(rest)) continue;
    if (/^\+*[A-Za-z]/.test(rest) && !UNIT_START.test(rest)) continue;
    out.push(text.indexOf('-', start));
  }
  return out;
}

// ------------------------------------------------------------------ the formatting check

/** How a character looks now, for the check: its position (base, sub, sup) and italics. */
export interface CharLook { pos: 'base' | 'sub' | 'sup'; italic: boolean }

/** One change a Fix makes to characters start..end: new text, and/or position and italics. */
export interface FixEdit { start: number; end: number; pos?: 'sub' | 'sup'; italic?: boolean; text?: string }

export type IssueKind = 'formula' | 'solvent' | 'unit' | 'range' | 'nucleus';

export interface Issue {
  kind: IssueKind;
  start: number;
  end: number;
  /** What is wrong, in plain words. */
  message: string;
  /** How it will look once fixed, for the menu ("PdCl₂"). */
  fixed: string;
  edits: FixEdit[];
}

export const ISSUE_MESSAGES: Record<IssueKind, string> = {
  formula: 'Formula without subscripts',
  solvent: 'Deuterated solvent not formatted (italic d, subscript digits)',
  unit: 'Number written without a space before its unit',
  range: 'Hyphen in a number range (use an en dash)',
  nucleus: 'Nucleus before “NMR” not superscripted',
};

const SUB_DIGITS = '₀₁₂₃₄₅₆₇₈₉';
const SUP_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';
const subDigits = (s: string) => s.replace(/\d/g, (d) => SUB_DIGITS[Number(d)]);
const supDigits = (s: string) => s.replace(/\d/g, (d) => SUP_DIGITS[Number(d)]);

/**
 * Chemistry formatting problems in a text, in order and not overlapping. `look(i)` tells how
 * character i looks now. Issues whose text (lower case) is in `leave` are not reported.
 */
export function findIssues(text: string, look: (i: number) => CharLook, leave: ReadonlySet<string> = new Set()): Issue[] {
  const skip = new Uint8Array(text.length);
  for (const m of text.matchAll(URL)) skip.fill(1, m.index!, m.index! + m[0].length);
  const taken = new Uint8Array(text.length);
  const found: Issue[] = [];
  const add = (kind: IssueKind, start: number, end: number, fixed: string, edits: FixEdit[]) => {
    if (!edits.length || skip.subarray(start, end).some((x) => x) || leave.has(text.slice(start, end).toLowerCase())) return;
    if (taken.subarray(start, end).some((x) => x)) return;
    taken.fill(1, start, end);
    found.push({ kind, start, end, message: ISSUE_MESSAGES[kind], fixed, edits });
  };
  for (const m of text.matchAll(DEUTERATED)) {
    const s2 = m.index! + m[1].length + 2;
    const d = s2 - 1;
    const e2 = s2 + m[2].length;
    let done = look(d).italic;
    for (let i = s2; i < e2; i++) if (look(i).pos !== 'sub') done = false;
    if (done) continue;
    const edits: FixEdit[] = [{ start: d, end: d + 1, italic: true }];
    if (m[2]) edits.push({ start: s2, end: e2, pos: 'sub' });
    add('solvent', m.index!, m.index! + m[0].length, `${m[1]}-d${subDigits(m[2])}`, edits);
  }
  for (const m of formulaMatches(text, leave)) {
    const todo: FixEdit[] = [];
    for (let i = m.start; i < m.end; i++) if (/\d/.test(text[i]) && look(i).pos !== 'sub') todo.push({ start: i, end: i + 1, pos: 'sub' });
    if (!todo.length) continue;
    add(SOLVENT_FORMULAS.includes(m.text) ? 'solvent' : 'formula', m.start, m.end, subDigits(m.text), todo);
  }
  for (const m of text.matchAll(NUCLEUS)) {
    const todo: FixEdit[] = [];
    for (let i = m.index!; i < m.index! + m[1].length; i++) if (look(i).pos !== 'sup') todo.push({ start: i, end: i + 1, pos: 'sup' });
    if (todo.length) add('nucleus', m.index!, m.index! + m[0].length, supDigits(m[1]) + m[2], todo);
  }
  for (const re of GLUED_UNITS) {
    for (const m of text.matchAll(re)) {
      const unitStart = m.index! + m[1].length;
      if (look(unitStart).pos !== 'base' || look(m.index!).pos !== 'base') continue;
      const unit = m[2];
      const newUnit = unit === 'mol%' ? 'mol %' : unit;
      add('unit', m.index!, m.index! + m[0].length, `${m[1]} ${newUnit}`, [{ start: unitStart, end: m.index! + m[0].length, text: ' ' + newUnit }]);
    }
  }
  for (const h of rangeHyphens(text)) {
    if (look(h).pos !== 'base') continue;
    let start = h;
    while (start > 0 && /[\d.]/.test(text[start - 1])) start--;
    const tail = /^(?:[\d.]*\d)?/.exec(text.slice(h + 1, h + 41))![0];
    const end = h + 1 + tail.length;
    add('range', start, end, `${text.slice(start, h)}–${text.slice(h + 1, end)}`, [{ start: h, end: h + 1, text: '–' }]);
  }
  return found.sort((a, b) => a.start - b.start);
}

// ------------------------------------------------------------------ formatting as you type

/** Keys that end a word, so the word before them is looked at. */
export const WORD_ENDS = ' ,.;:!?)]}/–-\t\n ';

/**
 * The formatting to give the word that ends at `end` (just before a word-ending key): its
 * formula digits go down, a nucleus before "NMR" goes up, a deuterated solvent's d goes italic
 * and its digits down. A word before it that this word shows to be a gas ("N2 atmosphere") is
 * formatted too, unless it was already a formula before (then the person has seen it).
 */
export function typingFormats(text: string, end: number, look: (i: number) => CharLook, leave: ReadonlySet<string> = new Set()): FixEdit[] {
  const upto = text.slice(0, end);
  const wordStart = /\S*$/.exec(upto)!.index;
  const out: FixEdit[] = [];
  const digits = formulaDigits(upto, end, leave);
  const before = new Set(formulaMatches(upto.slice(0, wordStart), leave).map((m) => m.start));
  for (const m of formulaMatches(upto, leave)) {
    if (m.end <= wordStart && !before.has(m.start)) for (let i = m.start; i < m.end; i++) if (/\d/.test(upto[i])) digits.push(i);
  }
  for (const i of digits) if (look(i).pos === 'base') out.push({ start: i, end: i + 1, pos: 'sub' });
  // a nucleus in this word ("13C{1H}"), or just before an "NMR" typed now ("1H NMR")
  for (const m of text.slice(0, end + 1).matchAll(NUCLEUS)) {
    const nucEnd = m.index! + m[0].length;
    if (nucEnd > end || !(m.index! >= wordStart || /^\s*NMR$/.test(text.slice(nucEnd, end)))) continue;
    for (let i = m.index!; i < m.index! + m[1].length; i++) if (look(i).pos === 'base') out.push({ start: i, end: i + 1, pos: 'sup' });
  }
  for (const m of upto.matchAll(DEUTERATED)) {
    if (m.index! + m[0].length !== end) continue;
    const s2 = m.index! + m[1].length + 2;
    if (!look(s2 - 1).italic) out.push({ start: s2 - 1, end: s2, italic: true });
    for (let i = s2; i < s2 + m[2].length; i++) if (look(i).pos === 'base') out.push({ start: i, end: i + 1, pos: 'sub' });
  }
  for (const m of upto.matchAll(DEUTERATED_PREFIX)) {
    const nameEnd = /^[A-Za-z]+/.exec(upto.slice(m.index! + m[0].length));
    if (!nameEnd || m.index! + m[0].length + nameEnd[0].length !== end) continue;
    if (!look(m.index!).italic) out.push({ start: m.index!, end: m.index! + 1, italic: true });
    for (let i = m.index! + 1; i <= m.index! + m[1].length; i++) if (look(i).pos === 'base') out.push({ start: i, end: i + 1, pos: 'sub' });
  }
  // one change per character
  const seen = new Set<string>();
  return out.filter((e) => { const k = `${e.start}:${e.pos ?? ''}:${e.italic ?? ''}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

// ------------------------------------------------------------------ typing replacements

/** Replacements made as you type (each can be changed or removed in Typing and Spelling). */
export const DEFAULT_REPLACEMENTS: [string, string][] = [
  ['oC', '°C'],
  ['+/-', '±'],
  ['->', '→'],
  ['<-', '←'],
  ['<->', '↔'],
  ['<=>', '⇌'],
  ['--', '–'],
  ['uL', 'µL'],
  ['umol', 'µmol'],
  ['ug', 'µg'],
  ['uM', 'µM'],
];

/**
 * The replacement for the text just before a word-ending key, if one applies: [start, new text].
 * A replacement that starts with a letter needs something other than a letter in front of it
 * (so "65 oC" and "65oC" change, but "ZnoC" doesn't); others apply after anything.
 */
export function replacementAt(text: string, end: number, list: readonly [string, string][]): [number, string] | null {
  let best: [number, string] | null = null;
  let bestLen = 0;
  for (const [from, to] of list) {
    if (!from || from.length <= bestLen || end < from.length) continue;
    if (text.slice(end - from.length, end) !== from) continue;
    const start = end - from.length;
    const prev = text[start - 1];
    if (/^\p{L}/u.test(from) && prev && /\p{L}/u.test(prev)) continue;
    best = [start, to];
    bestLen = from.length;
  }
  return best;
}
