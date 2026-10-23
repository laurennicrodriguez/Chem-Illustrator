// The spelling check, with chemistry: rewritten from SI Assistant's spelling.py, with the same
// word lists. A word is spelled right if it is in any of (capitals don't matter):
//   - the English words of pyspellchecker (public/dict/english.txt, most common first);
//   - Adam Azman's Open Source Chemistry Dictionary (public/dict/chemistry.txt, CC BY 3.0 US);
//   - SI Assistant's chemistry word lists: lab words, NMR multiplicities, named reactions
//     (public/dict/lab-words.txt), and our own list of name-reaction surnames and everyday
//     words of synthesis (public/dict/name-reactions.txt);
//   - units, the person's own dictionary, and the words ignored while the program is open;
//   - or it is a systematic name built from name pieces ("dichloromethane").
// Words that could be compound names or abbreviations are never underlined: words with digits,
// brackets, locants or Greek letters, capitalised abbreviations (THF, DMSO), and words made of
// element symbols and groups (MeCN, EtOAc, nBuLi, NaOtBu).

import { UNITS } from './chemtext';

const MAX_ABBREVIATION = 6;
const MAX_SUGGESTIONS = 6;
/** Longer words get only one-letter-off suggestions (quick). */
const SLOW_SUGGESTIONS = 12;

const ABBREVIATION_ELEMENTS = new Set(`H He Li Be B C N O F Ne Na Mg Al Si P S Cl Ar K Ca Sc Ti V Cr Mn Fe Co Ni Cu Zn Ga Ge As
Se Br Kr Rb Sr Y Zr Nb Mo Tc Ru Rh Pd Ag Cd In Sn Sb Te I Xe Cs Ba La Ce Pr Nd Pm Sm Eu
Gd Tb Dy Ho Er Tm Yb Lu Hf Ta W Re Os Ir Pt Au Hg Tl Pb Bi Po At Rn Fr Ra Ac Th Pa U Np
Pu Am D`.split(/\s+/));
const ABBREVIATION_GROUPS = new Set(`Me Et Pr Bu Pent Hex Ph Bn Tol Xyl Mes Cy Cp Ad Ar Het Vin Py R X Nu
Ac Bz Piv Ts Ms Tf Ns Bs Nf Tr Trt Boc Cbz Fmoc Alloc Troc Teoc PMB PMP DMB MOM MEM SEM
BOM THP TMS TES TBS TBDMS TIPS TBDPS HMDS TMP Bpin`.split(/\s+/));
/** Locants written in front of a group: nBu, iPr, tBu, cHex, pTol, secBu, tertBu. */
const LOCANTS = ['tert', 'sec', 'iso', 'neo', 'n', 'i', 's', 't', 'c', 'm', 'o', 'p'];
const LONGEST_UNIT = Math.max(...[...ABBREVIATION_ELEMENTS, ...ABBREVIATION_GROUPS].map((u) => u.length));

/** Made entirely of element symbols and groups (a group may have a locant in front)? Capitals matter. */
function madeOfUnits(word: string): boolean {
  if (!/^[A-Za-z]+$/.test(word)) return false;
  const n = word.length;
  const reach = [true, ...Array<boolean>(n).fill(false)];
  for (let i = 0; i < n; i++) {
    if (!reach[i]) continue;
    const starts: [number, boolean][] = [[i, false]];
    for (const loc of LOCANTS) if (word.startsWith(loc, i)) starts.push([i + loc.length, true]);
    for (const [at, afterLocant] of starts) {
      for (let size = 1; size <= Math.min(LONGEST_UNIT, n - at); size++) {
        const unit = word.slice(at, at + size);
        if (ABBREVIATION_GROUPS.has(unit) || (!afterLocant && ABBREVIATION_ELEMENTS.has(unit))) reach[at + size] = true;
      }
    }
  }
  return reach[n];
}

/** An abbreviation made of element symbols and groups, with two or more capitals (MeCN, EtOAc, nBuLi)? */
export function isAbbreviation(word: string): boolean {
  return [...word].filter((c) => c >= 'A' && c <= 'Z').length >= 2 && madeOfUnits(word);
}

const capitalInside = (w: string) => /[A-Z]/.test(w.slice(1));

/** Phosphine ligands named "…Phos" (XantPhos, Xantphos, SEGPHOS, CyJohnPhos, tBuXPhos, RuPhos). */
const PHOS_NAMES = new Set('xant nixant josi seg du dave brett john rock tang wal mandy tania trixie dal bippy dpe am chira x s q a c e g v'.split(' '));
export function isPhosLigand(word: string): boolean {
  const w = word.replace(/^['’]+|['’]+$/g, '');
  if (w.length < 5 || w.slice(-4).toLowerCase() !== 'phos') return false;
  const head = w.slice(0, -4);
  if (PHOS_NAMES.has(head.toLowerCase()) || madeOfUnits(head)) return true;
  for (const name of PHOS_NAMES) {
    if (head.length <= name.length) continue;
    const found = name.length === 1 ? head[head.length - 1] === name.toUpperCase() : head.toLowerCase().endsWith(name);
    if (found && madeOfUnits(head.slice(0, -name.length))) return true;
  }
  return false;
}

/** Pieces of systematic names: a word made only of these is accepted. */
const NAME_FRAGMENTS = new Set(`mono di tri tetra penta hexa hepta octa nona deca bis tris tetrakis
meth eth prop but pent hex hept oct non dec cyclo iso neo sec tert
yl ylene ylidene ene yne ane anyl enyl ynyl oxy oxo hydroxy amino amido imino cyano
fluoro chloro bromo iodo iodin halo thio sulf sulfo sulfon sulfin sulfonyl sulfinyl sulfonate
phosph phospho phosphon phosphin phosphate boron boro borate silyl sila stann
ol one al ic ate ite ide ine amine amide imide imine nitrile oate oic ium ane
benz benzo phen phenyl naphth pyr pyrid pyrrol pyran furan thiophen thiazol oxazol
imidazol indol quinol quinolin morpholin piperidin piperazin pyrimid pyrazin pyrazol
triazol tetrazol carbazol azet oxet azep oxir aziridin
acet form carb carbox carbonyl carbamate carbamoyl acyl acetyl benzyl tosyl mesyl trifl
formyl vinyl allyl aryl alk propargyl homo nor per anhydr hydr hydro dehydro hydride
oxide aza oxa thia ether ester amin amid fluor chlor brom iod nitr ethan methan
anol anal anone enone enol enal diene triene idine idin aceto sil silane bor borane
pinacol epox lithium sodium potassium magnesium aluminum aluminium zinc copper cesium
caesium titanium tin boronic keto ketone dien trien ynon`.split(/\s+/));

function fragments(word: string): number {
  const n = word.length;
  if (n < 4) return 0;
  const best = [0, ...Array<number>(n).fill(-1)];
  for (let end = 1; end <= n; end++) {
    for (let start = Math.max(0, end - 12); start < end; start++) {
      if (best[start] >= 0 && NAME_FRAGMENTS.has(word.slice(start, end))) best[end] = Math.max(best[end], best[start] + 1);
    }
  }
  return Math.max(best[n], 0);
}

/** Made of name pieces: two or more (tetrahydrofuran), or one long one (tosyl), maybe with a final e. */
export function isSystematic(word: string): boolean {
  word = word.toLowerCase();
  if (word.endsWith('e') && word.length > 5 && fragments(word.slice(0, -1)) >= 1) return true;
  const n = fragments(word);
  return (n >= 2 && word.length >= 6) || (n === 1 && word.length >= 5);
}

const CHUNK = /[^\s/–—]+/g;
const URL = /^(?:https?:|www\.|doi[:.]|10\.\d)|:\/\/|@/i;
const LEAD = '([{"\'“‘«*';
const TRAIL = ')]}"\'”’».,;:!?…*';
const LATIN = /^[A-Za-zÀ-ɏ'’-]+$/;

function worthChecking(word: string): boolean {
  const core = word.replace(/^['’]+|['’]+$/g, '');
  if (core.length < 2) return false;
  if (core === core.toUpperCase()) return core.length > MAX_ABBREVIATION; // THF, DMSO, HRMS
  if (!capitalInside(core)) return true;
  const rest = core.slice(1), head = core.slice(0, -1);
  if (core[0] === core[0].toLowerCase() && rest === rest.toUpperCase() && rest.length <= MAX_ABBREVIATION) return false; // mCPBA
  if (core.endsWith('s') && head === head.toUpperCase() && head.length <= MAX_ABBREVIATION) return false; // NMRs
  if (LOCANTS.some((l) => core.startsWith(l) && ABBREVIATION_GROUPS.has(core.slice(l.length)))) return false; // iPr, tBu
  return !isAbbreviation(core); // MeCN, EtOAc
}

/** Where the words to check are: [start, end] of each word or part of a hyphenated word. */
export function checkSpans(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of text.matchAll(CHUNK)) {
    const chunk = m[0], start = m.index!;
    if (URL.test(chunk)) continue;
    let lo = 0, hi = chunk.length;
    while (lo < hi && LEAD.includes(chunk[lo])) lo++;
    while (hi > lo && TRAIL.includes(chunk[hi - 1])) hi--;
    let word = chunk.slice(lo, hi);
    for (const ending of ["'s", '’s']) if (word.endsWith(ending)) { word = word.slice(0, -2); hi -= 2; }
    if (!word || !LATIN.test(word)) continue; // digits, brackets, Greek letters, symbols
    const parts = word.split(/(-)/);
    if (parts.filter((_, k) => k % 2 === 0).some((p) => p.length <= 1)) continue; // N-, O-, n-, t-
    let pos = start + lo;
    parts.forEach((piece, k) => {
      if (k % 2 === 0 && worthChecking(piece)) out.push([pos, pos + piece.length]);
      pos += piece.length;
    });
  }
  return out;
}

/** A suggestion in the capitals of the word it replaces. */
export function matchCase(suggestion: string, original: string): string {
  if (original.length > 1 && original === original.toUpperCase()) return suggestion.toUpperCase();
  if (original[0] && original[0] === original[0].toUpperCase() && original[0] !== original[0].toLowerCase()) return suggestion[0].toUpperCase() + suggestion.slice(1);
  return suggestion;
}

const LETTERS = "abcdefghijklmnopqrstuvwxyz'";

function edits1(word: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i <= word.length; i++) {
    const a = word.slice(0, i), b = word.slice(i);
    if (b) out.add(a + b.slice(1));
    if (b.length > 1) out.add(a + b[1] + b[0] + b.slice(2));
    for (const c of LETTERS) {
      if (b) out.add(a + c + b.slice(1));
      out.add(a + c + b);
    }
  }
  out.delete(word);
  return out;
}

/** The word lists, as text (one word per line; "#" lines are comments). */
export interface WordLists { english: string; chemistry: string; lab: string }

const lines = (text: string) => text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));

export class Speller {
  /** English words, by how common they are (0 is the most common). */
  private english = new Map<string, number>();
  private chemistry = new Set<string>();
  private lab = new Set<string>();
  private units = new Set(UNITS.map((u) => u.toLowerCase()));
  /** The person's own dictionary, and words ignored while the program is open (lower case). */
  personal = new Set<string>();
  ignored = new Set<string>();
  private cache = new Map<string, boolean>();

  constructor(lists: WordLists) {
    lines(lists.english).forEach((w, i) => { const k = w.toLowerCase(); if (!this.english.has(k)) this.english.set(k, i); });
    for (const w of lines(lists.chemistry)) this.chemistry.add(w.toLowerCase());
    for (const w of lines(lists.lab)) this.lab.add(w.toLowerCase());
  }

  setPersonal(words: Iterable<string>): void {
    this.personal = new Set([...words].map((w) => w.toLowerCase()));
    this.cache.clear();
  }

  ignore(word: string): void {
    this.ignored.add(word.toLowerCase());
    this.cache.clear();
  }

  private own(w: string): boolean {
    return this.lab.has(w) || this.personal.has(w) || this.ignored.has(w) || this.units.has(w);
  }

  private listed(w: string): boolean {
    return this.own(w) || this.chemistry.has(w) || this.english.has(w);
  }

  /** Is the word known (capitals don't matter)? */
  known(word: string): boolean {
    const w = word.replace(/^['’]+|['’]+$/g, '').replace(/’/g, "'").toLowerCase();
    let hit = this.cache.get(w);
    if (hit === undefined) {
      hit = this.listed(w) || ['s', 'es'].some((s) => w.endsWith(s) && this.listed(w.slice(0, -s.length))) || isSystematic(w);
      if (this.cache.size > 50000) this.cache.clear();
      this.cache.set(w, hit);
    }
    return hit;
  }

  /** Is the word (as written) spelled right? Known, a "…Phos" ligand, or joined from known words (ChemDraw, TopSpin). */
  accepts(word: string): boolean {
    if (this.known(word) || isPhosLigand(word)) return true;
    if (!capitalInside(word)) return false;
    const core = word.replace(/^['’]+|['’]+$/g, '');
    let parts: string[] = core.match(/[A-Z]+(?![a-z])|[A-Z]?[a-z]+/g) ?? [];
    if (parts.length < 2 || parts.join('') !== core) return false;
    if (LOCANTS.includes(parts[0])) parts = parts.slice(1);
    let words = 0;
    for (const p of parts) {
      if (p === p.toUpperCase() && p.length <= MAX_ABBREVIATION) continue; // IR, X
      if (ABBREVIATION_ELEMENTS.has(p) || ABBREVIATION_GROUPS.has(p)) continue; // Ru, Bu, Me
      if (p.length < 3 || !this.known(p)) return false;
      words++;
    }
    return words >= 1;
  }

  /** [start, end] of every misspelled word in a text. */
  misspelled(text: string): [number, number][] {
    return checkSpans(text).filter(([s, e]) => !this.accepts(text.slice(s, e)));
  }

  /** Up to n likely corrections, in the word's capitals: own lists first, then common English words, then chemistry words. */
  suggestions(word: string, n = MAX_SUGGESTIONS): string[] {
    const low = word.toLowerCase();
    const near = edits1(low);
    const rank = (set: Iterable<string>) => {
      const own: string[] = [], eng: string[] = [], chem: string[] = [];
      for (const w of set) {
        if (this.own(w)) own.push(w);
        else if (this.english.has(w)) eng.push(w);
        else if (this.chemistry.has(w)) chem.push(w);
      }
      return { own: own.sort(), eng: eng.sort((a, b) => this.english.get(a)! - this.english.get(b)!), chem: chem.sort() };
    };
    let r = rank(near);
    if (!r.own.length && !r.eng.length && !r.chem.length && low.length <= SLOW_SUGGESTIONS) {
      const far = new Set<string>();
      for (const w of near) for (const x of edits1(w)) far.add(x);
      r = rank(far);
    }
    return [...r.own, ...r.eng, ...r.chem].slice(0, n).map((w) => matchCase(w, word));
  }
}

let loading: Promise<Speller | null> | null = null;

/** The speller, with its word lists read the first time it is needed (null if they can't be read). */
export function loadSpeller(base = './dict/'): Promise<Speller | null> {
  loading ??= (async () => {
    try {
      const get = async (f: string) => {
        const r = await fetch(base + f);
        if (!r.ok) throw new Error(`${f}: ${r.status}`);
        return r.text();
      };
      const [english, chemistry, lab, names] = await Promise.all([get('english.txt'), get('chemistry.txt'), get('lab-words.txt'), get('name-reactions.txt')]);
      return new Speller({ english, chemistry, lab: `${lab}\n${names}` });
    } catch (e) {
      console.warn('The spelling check could not read its word lists:', e);
      return null;
    }
  })();
  return loading;
}
