// A few plain grammar and style checks for the Spelling and Grammar pane, kept to the ones that
// are nearly always right so they don't nag over chemistry: a word written twice ("the the"),
// two spaces between words, a space before a full stop or comma, "a" before a vowel sound or
// "an" before a consonant, and a sentence starting with a small letter. Text that a chemist
// writes on purpose (n-BuLi, p-TsOH, mL, e.g., i.e., et al.) is left alone.

export interface GrammarIssue {
  start: number;
  end: number;
  message: string;
  /** What to put instead (none when the person has to choose). */
  fix?: string;
}

/** Words "an" goes before though they start with a consonant letter, and "a" before though they start with a vowel. */
const AN_WORDS = /^(?:hour|honou?r|honest|heir|herb|NMR|HPLC|HRMS|MS\b|FTIR|ESI|LC|X-ray|SN[12]|SEM|STM|HMBC|HSQC|NOE|NOESY|IR|MRI|R[- ]?group|F\b|H\b|L\b|M\b|N\b|S\b|X\b)/;
const A_WORDS = /^(?:uni|use|usu|uti|ura|uro|eu|one\b|once|ewe|U[.-]|UV|US\b)/i;
/** Words after a full stop that don't start a sentence. */
const ABBREVIATIONS = /(?:\b(?:e\.g|i\.e|etc|et al|vs|cf|approx|ca|Fig|Figs|Eq|Eqs|Ref|Refs|No|Vol|ed|eds|Dr|Prof|Mr|Ms|Mrs|St|aq|equiv|min|h|mL|mmol|mol|calcd|Anal|obsd|resp|ppm|conc|sat|soln|temp|Tab|Chem|Soc|Am|J|Org|Lett|Angew|Int|Ed|Engl|Nat|Sci|Commun|Rev|Acc|Res|Synth|Catal)\.)$/;

/** Grammar and style problems in a paragraph's text, in order. */
export function grammarIssues(text: string): GrammarIssue[] {
  const out: GrammarIssue[] = [];
  // a word twice ("the the"), not numbers ("10 10") or words that can be doubled ("had had", "that that")
  for (const m of text.matchAll(/\b(\p{L}+)(\s+)(\1)\b/giu)) {
    const w = m[1].toLowerCase();
    if (['had', 'that', 'is', 'do', 'bye', 'very'].includes(w) || m[1].length < 2 && w !== 'a') continue;
    const start = m.index! + m[1].length;
    out.push({ start, end: start + m[2].length + m[3].length, message: `“${m[1]}” twice`, fix: '' });
  }
  // two or more spaces between words
  for (const m of text.matchAll(/(\S)( {2,})(?=\S)/g)) {
    const start = m.index! + 1;
    out.push({ start, end: start + m[2].length, message: 'More than one space between words', fix: ' ' });
  }
  // a space before a full stop, comma, semicolon or colon (not "…" or a decimal like " .5")
  for (const m of text.matchAll(/(\p{L})( +)([.,;:])(?=\s|$)/gu)) {
    const start = m.index! + 1;
    out.push({ start, end: start + m[2].length, message: `Space before “${m[3]}”`, fix: '' });
  }
  // "a" or "an" before the wrong sound
  for (const m of text.matchAll(/(?<![\p{L}\-])(a|an|A|An)\s+([\p{L}][\p{L}\d\-]*)/gu)) {
    const art = m[1], next = m[2];
    if (/^[A-Z]{2,}/.test(next) && !AN_WORDS.test(next)) {
      // an abbreviation said letter by letter: "an FTIR", "a DFT study" go by the letter's sound
      const vowelSound = /^[AEFHILMNORSX]/.test(next);
      if (vowelSound === (art.toLowerCase() === 'an')) continue;
      out.push(articleIssue(m.index!, art, vowelSound));
      continue;
    }
    const vowel = AN_WORDS.test(next) || (/^[aeiou]/i.test(next) && !A_WORDS.test(next));
    if (vowel === (art.toLowerCase() === 'an')) continue;
    // one letter on its own ("a b"), and words that are not English ("a la") are left
    if (next.length < 2) continue;
    out.push(articleIssue(m.index!, art, vowel));
  }
  // a sentence starting with a small letter (after ". " or "? " or "! "), but not after an abbreviation or before a chemistry prefix
  for (const m of text.matchAll(/([.!?])(\s+)(\p{Ll}\p{L}*)/gu)) {
    const before = text.slice(Math.max(0, m.index! - 12), m.index! + 1);
    if (m[1] === '.' && ABBREVIATIONS.test(before)) continue;
    // a decimal (".5 equiv"), a dotted abbreviation (U.S. army), a number before it ("1. solid")
    if (m[1] === '.' && /\d$|\.\p{L}$|\b\p{L}$/u.test(text.slice(0, m.index!))) continue;
    const word = m[3];
    if (/^(?:n|i|s|t|o|m|p|d|l|cis|trans|syn|anti|endo|exo|tert|sec|iso|neo|rac|meso|ipso|erythro|threo|mCPBA|pH|pKa|mL|mg|mmol|μ)$/.test(word) || /^[a-z][A-Z]/.test(word)) continue;
    const start = m.index! + 1 + m[2].length;
    out.push({ start, end: start + 1, message: 'A sentence starting with a small letter', fix: word[0].toUpperCase() });
  }
  return out.sort((a, b) => a.start - b.start);
}

function articleIssue(at: number, art: string, vowel: boolean): GrammarIssue {
  const cap = art[0] === 'A';
  const want = vowel ? (cap ? 'An' : 'an') : cap ? 'A' : 'a';
  return { start: at, end: at + art.length, message: vowel ? `“${want}” before a vowel sound` : `“${want}” before a consonant sound`, fix: want };
}
