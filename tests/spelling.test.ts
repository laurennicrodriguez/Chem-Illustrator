// The spelling check: the cases are those of SI Assistant's tests (test_text_checks.py).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { Speller, checkSpans, isAbbreviation } from '../src/text/spelling';

const read = (f: string) => readFileSync(new URL(`../public/dict/${f}`, import.meta.url), 'utf8');
const speller = () => new Speller({ english: read('english.txt'), chemistry: read('chemistry.txt'), lab: read('lab-words.txt') });
const s = speller();
const words = (text: string) => checkSpans(text).map(([a, b]) => text.slice(a, b));
const wrong = (sp: Speller, text: string) => sp.misspelled(text).map(([a, b]) => text.slice(a, b));

describe('which words are checked', () => {
  it('skips names, abbreviations, links and symbols', () => {
    const text = 'The (E)-alkene, 2-methylfuran, N,N-dimethyl, n-BuLi and EtOAc/hexanes in THF '
      + 'and DMSO (see https://doi.org/10.1/x, a@b.org) gave 3a; α-pinene, x and ￼.';
    expect(words(text)).toEqual(['The', 'and', 'hexanes', 'in', 'and', 'see', 'gave', 'and']);
  });
  it('checks hyphenated words part by part', () => {
    expect(words('tert-butyl well-known')).toEqual(['tert', 'butyl', 'well', 'known']);
    expect(words('O-benzyl t-butyl')).toEqual([]);
    expect(words('CHROMATOGRAPHY')).toEqual(['CHROMATOGRAPHY']);
    expect(words("Nathan's")).toEqual(['Nathan']);
  });
  it.each(['MeCN', 'EtOAc', 'nBuLi', 'iPrOH', 'tBuOK', 'PhMe', 'PhMgBr', 'LiAlH', 'NaOtBu', 'BnBr', 'KOtBu', 'iPrMgCl', 'TBSCl', 'TBDPSCl', 'pTsOH', 'MeOD', 'AcOH', 'BocNH', 'NaHMDS', 'secBuLi', 'PhNTf'])('takes %s as an abbreviation', (w) => {
    expect(isAbbreviation(w)).toBe(true);
    expect(words(`with ${w} in`)).toEqual(['with', 'in']);
  });
  it.each(['Me', 'Bu', 'Ph', 'Cu', 'Hello', 'Teh', 'THe', 'MeCNx', 'AbcDef', 'McMurry', 'DavePhos', 'Etoac', 'nBuLiQ', 'Me-CN', 'MeC2N'])('does not take %s as an abbreviation', (w) => {
    expect(isAbbreviation(w)).toBe(false);
  });
});

describe('the speller', () => {
  it('knows English, chemistry words and systematic names', () => {
    for (const w of ['purified', 'Silica', 'hexanes', 'rotamers', 'eluent', 'vacuo', 'mmol', 'dichloromethane', 'tetrahydrofuran', 'triethylamine', 'thiophene', 'tosyl']) expect(s.known(w), w).toBe(true);
    for (const w of ['teh', 'recieve', 'chromatograhpy', 'seperate']) expect(s.known(w), w).toBe(false);
    expect(wrong(s, 'Purified by flash chromatograhpy on silica (teh crude).')).toEqual(['chromatograhpy', 'teh']);
  });
  it('suggests corrections, most likely first, in the same capitals', () => {
    expect(s.suggestions('chromatograhpy')[0]).toBe('chromatography');
    expect(s.suggestions('Teh')[0]).toBe('The');
    expect(s.suggestions('diastereotopci')).toContain('diastereotopic');
  });
  it('knows named reactions and lab words', () => {
    for (const w of ['diastereotopic', 'Regioselective', 'pyrrolidines', 'Suzuki', 'Miyaura', 'Buchwald', 'Hartwig', 'Sonogashira', 'Mitsunobu', 'Horner', 'Wadsworth', 'Emmons', 'Swern', 'Bestmann', 'Ohira', 'McMurry', 'Fétizon']) expect(s.known(w), w).toBe(true);
    expect(s.misspelled('Suzuki–Miyaura coupling, then a Horner–Wadsworth–Emmons olefination')).toEqual([]);
    for (const w of ['electrospray', 'butyllithium', 'diisobutylaluminum', 'sonication', 'photoredox', 'propanol', 'tetramethylsilane', 'pinacolborane', 'epoxide', 'diene', 'enone', 'acetophenone', 'azetidine', 'triturated', 'portionwise', 'Weinreb', 'Orbitrap', 'Avance', 'Aldrich', 'Kugelrohr', 'olefination', 'tributyltin']) expect(s.known(w), w).toBe(true);
    for (const w of ['areaction', 'byield', 'couldn', 'solvant', 'mixure', 'stired']) expect(s.known(w), w).toBe(false);
  });
  it('checks words with capitals inside, accepting ones joined from known words', () => {
    const sp = speller();
    const text = 'AbcDef and MeCNx, but MeCN, mCPBA, NMRs, iPr, tBu, pH, ChemDraw, TopSpin, ReactIR, XPhos, RuPhos and tBuXPhos are fine';
    expect(wrong(sp, text)).toEqual(['AbcDef', 'MeCNx']);
    sp.setPersonal(['AbcDef']);
    expect(wrong(sp, text)).toEqual(['MeCNx']);
  });
  it('learns words and ignores words', () => {
    const sp = speller();
    expect(sp.known('Fooxane')).toBe(false);
    sp.setPersonal(['Fooxane']);
    expect(sp.known('fooxanes')).toBe(true);
    sp.ignore('Quxone');
    expect(sp.known('quxone')).toBe(true);
    expect(sp.suggestions('fooxame')).toContain('fooxane');
  });
});
