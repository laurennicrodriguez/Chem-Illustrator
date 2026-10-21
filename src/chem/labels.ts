// Atom labels: reading label text ("OMe", "CO2Et", "NHBoc"), choosing which way it runs
// (OH vs HO, CH3 vs H3C), and turning it into atoms for the chemistry engine.

import { passParam, type Rect } from '../geom';
import type { Atom, Doc } from '../model';
import { doubleBondGap } from '../style';
import { SYMBOLS, elementNumber, hasImplicitH, implicitHydrogens, lowestValence, maxValence, valenceOfBonds } from './elements';

/**
 * Abbreviations, each written as SMILES whose first atom is the one bonded to the structure.
 * A subset of ChemDraw's 156 defaults (User Guide pp. 83–84) plus common protecting groups.
 */
export const NICKNAMES: Record<string, string> = {
  Me: 'C', Et: 'CC', Pr: 'CCC', 'n-Pr': 'CCC', 'i-Pr': 'C(C)C', iPr: 'C(C)C', Bu: 'CCCC', 'n-Bu': 'CCCC', nBu: 'CCCC',
  'i-Bu': 'CC(C)C', iBu: 'CC(C)C', 's-Bu': 'C(C)CC', sBu: 'C(C)CC', 't-Bu': 'C(C)(C)C', tBu: 'C(C)(C)C',
  Ph: 'c1ccccc1', Bn: 'Cc1ccccc1', Bz: 'C(=O)c1ccccc1', Ac: 'C(C)=O', Piv: 'C(=O)C(C)(C)C', Pv: 'C(=O)C(C)(C)C',
  Boc: 'C(=O)OC(C)(C)C', Cbz: 'C(=O)OCc1ccccc1', Fmoc: 'C(=O)OCC1c2ccccc2-c2ccccc21', Troc: 'C(=O)OCC(Cl)(Cl)Cl',
  Alloc: 'C(=O)OCC=C', Allyl: 'CC=C', Ts: 'S(=O)(=O)c1ccc(C)cc1', Tos: 'S(=O)(=O)c1ccc(C)cc1', Ms: 'S(=O)(=O)C',
  Tf: 'S(=O)(=O)C(F)(F)F', Ns: 'S(=O)(=O)c1ccc(cc1)[N+](=O)[O-]', TMS: '[Si](C)(C)C', TES: '[Si](CC)(CC)CC',
  TBS: '[Si](C)(C)C(C)(C)C', TBDMS: '[Si](C)(C)C(C)(C)C', TIPS: '[Si](C(C)C)(C(C)C)C(C)C',
  TBDPS: '[Si](c1ccccc1)(c1ccccc1)C(C)(C)C', PMB: 'Cc1ccc(OC)cc1', MPM: 'Cc1ccc(OC)cc1', MOM: 'COC', MEM: 'COCCOC',
  SEM: 'COCC[Si](C)(C)C', THP: 'C1CCCCO1', Tr: 'C(c1ccccc1)(c1ccccc1)c1ccccc1', Trt: 'C(c1ccccc1)(c1ccccc1)c1ccccc1',
  MDP: 'c1ccc2OCOc2c1', '3,4-MDP': 'c1ccc2OCOc2c1', '(3,4)-MDP': 'c1ccc2OCOc2c1',
  Cy: 'C1CCCCC1', cHx: 'C1CCCCC1', Mes: 'c1c(C)cc(C)cc1C', Tol: 'c1ccc(C)cc1', 'p-Tol': 'c1ccc(C)cc1', Np: 'c1cccc2ccccc12',
  Ar: '*', Het: '*', CN: 'C#N', NO2: '[N+](=O)[O-]', CF3: 'C(F)(F)F', CCl3: 'C(Cl)(Cl)Cl', N3: 'N=[N+]=[N-]',
  CO2H: 'C(=O)O', COOH: 'C(=O)O', CO2Me: 'C(=O)OC', CO2Et: 'C(=O)OCC', CO2tBu: 'C(=O)OC(C)(C)C', CO2Bn: 'C(=O)OCc1ccccc1',
  CO2R: 'C(=O)O*', CHO: 'C=O', COMe: 'C(C)=O', OAc: 'OC(C)=O', OTf: 'OS(=O)(=O)C(F)(F)F', SO2Ph: 'S(=O)(=O)c1ccccc1',
  SO2Me: 'S(=O)(=O)C', Bpin: 'B1OC(C)(C)C(C)(C)O1', BPin: 'B1OC(C)(C)C(C)(C)O1', Cp: 'C1C=CC=C1',
  // solvents and ligands, bonded through the atom a metal would hold
  THF: 'O1CCCC1', DMF: 'O=CN(C)C', DMSO: 'O=S(C)C', Et2O: 'O(CC)CC', DME: 'O(C)CCOC', MeCN: 'N#CC', PhCN: 'N#Cc1ccccc1',
  'o-Tol': 'c1ccccc1C', 'm-Tol': 'c1cccc(C)c1',
  // phosphines (P first; the second P of a chelating one is left free)
  PPh3: 'P(c1ccccc1)(c1ccccc1)c1ccccc1', PCy3: 'P(C1CCCCC1)(C1CCCCC1)C1CCCCC1', PMe3: 'P(C)(C)C', PEt3: 'P(CC)(CC)CC',
  PtBu3: 'P(C(C)(C)C)(C(C)(C)C)C(C)(C)C', PnBu3: 'P(CCCC)(CCCC)CCCC',
  dppm: 'P(c1ccccc1)(c1ccccc1)CP(c1ccccc1)c1ccccc1', dppe: 'P(c1ccccc1)(c1ccccc1)CCP(c1ccccc1)c1ccccc1',
  dppp: 'P(c1ccccc1)(c1ccccc1)CCCP(c1ccccc1)c1ccccc1', dppb: 'P(c1ccccc1)(c1ccccc1)CCCCP(c1ccccc1)c1ccccc1',
  BINAP: 'P(c1ccccc1)(c1ccccc1)c1ccc2ccccc2c1-c1c(P(c3ccccc3)c3ccccc3)ccc2ccccc12',
  Xantphos: 'P(c1ccccc1)(c1ccccc1)c1cccc2c1Oc1c(P(c3ccccc3)c3ccccc3)cccc1C2(C)C',
  XPhos: 'P(C1CCCCC1)(C1CCCCC1)c1ccccc1-c1c(C(C)C)cc(C(C)C)cc1C(C)C', SPhos: 'P(C1CCCCC1)(C1CCCCC1)c1ccccc1-c1c(OC)cccc1OC',
  RuPhos: 'P(C1CCCCC1)(C1CCCCC1)c1ccccc1-c1c(OC(C)C)cccc1OC(C)C', JohnPhos: 'P(C(C)(C)C)(C(C)(C)C)c1ccccc1-c1ccccc1',
  DavePhos: 'P(C1CCCCC1)(C1CCCCC1)c1ccccc1-c1ccccc1N(C)C',
  // nitrogen and carbon donors (N-heterocyclic carbenes bonded through the carbene carbon)
  py: 'N1=CC=CC=C1', bpy: 'N1=CC=CC=C1C1=CC=CC=N1', bipy: 'N1=CC=CC=C1C1=CC=CC=N1', phen: 'N1=CC=CC2=C1C1=NC=CC=C1C=C2',
  tmeda: 'N(C)(C)CCN(C)C', TMEDA: 'N(C)(C)CCN(C)C', en: 'NCCN',
  IMes: '[C]1N(c2c(C)cc(C)cc2C)C=CN1c1c(C)cc(C)cc1C', SIMes: '[C]1N(c2c(C)cc(C)cc2C)CCN1c1c(C)cc(C)cc1C',
  IPr: '[C]1N(c2c(C(C)C)cccc2C(C)C)C=CN1c1c(C(C)C)cccc1C(C)C', SIPr: '[C]1N(c2c(C(C)C)cccc2C(C)C)CCN1c1c(C(C)C)cccc1C(C)C',
  // π ligands and anionic ones
  'Cp*': 'C1(C)C(C)=C(C)C(C)=C1C', Ind: 'C1C=Cc2ccccc12', COD: 'C1=CCCC=CCC1', NBD: 'C1=CC2C=CC1C2',
  dba: 'O=C(C=Cc1ccccc1)C=Cc1ccccc1', 'p-cymene': 'c1cc(C(C)C)ccc1C', C6Me6: 'c1(C)c(C)c(C)c(C)c(C)c1C',
  acac: 'OC(C)=CC(C)=O', hfac: 'OC(C(F)(F)F)=CC(C(F)(F)F)=O', OPiv: 'OC(=O)C(C)(C)C', TFA: 'OC(=O)C(F)(F)F',
};

/**
 * Ligands that give the metal a lone pair or a π-bond (L-type): their bond to a metal takes no
 * hydrogen off them, so PPh₃, COD and THF keep every hydrogen they have as free molecules.
 */
const L_LIGANDS = new Set(['CO', 'OC', 'THF', 'DMF', 'DMSO', 'Et2O', 'DME', 'MeCN', 'PhCN', 'PPh3', 'PCy3', 'PMe3', 'PEt3', 'PtBu3', 'PnBu3',
  'dppm', 'dppe', 'dppp', 'dppb', 'BINAP', 'Xantphos', 'XPhos', 'SPhos', 'RuPhos', 'JohnPhos', 'DavePhos', 'py', 'bpy', 'bipy',
  'phen', 'tmeda', 'TMEDA', 'en', 'IMes', 'SIMes', 'IPr', 'SIPr', 'COD', 'NBD', 'dba', 'p-cymene', 'C6Me6']);

/**
 * Does this label, bonded to a metal, give it a lone pair or π-bond rather than share an
 * electron (PPh3, NH3, OH2, NEt3, COD: yes; Cl, OMe, Me, OAc, Cp: no)? Written formulas give
 * a lone pair when their first atom already has its lowest valence without the bond, counting
 * `others`, the label's bonds to atoms that aren't metals (dppf's PPh2 on its Cp ring: yes).
 */
export function labelDonates(label: string, others = 0): boolean {
  if (L_LIGANDS.has(label)) return true;
  const g = labelGraph(label, 0);
  const head = g?.atoms[0];
  if (!g || !head || head.dummy) return false;
  const low = lowestValence(head.z, head.charge);
  if (low === undefined) return false;
  const orders = g.bonds.filter((b) => b.a === 0 || b.b === 0).map((b) => b.order);
  return valenceOfBonds(orders, head.z) + (head.hCount ?? 0) + others >= low;
}

/** Labels that stand for "any group" and are left out of formula and mass. */
export const GENERIC = new Set(['R', "R'", "R''", 'R1', 'R2', 'R3', 'R4', 'R5', 'X', 'Z', 'A', 'Q', 'M', 'G', 'E', 'Nu', 'LG', 'PG', 'EWG', 'EDG', 'L', 'Ln']);
/** Numbered R and Ar groups of any number (R6, R12, Ar1, R1') stand for any group too. */
const NUMBERED_GENERIC = /^(?:R|Ar)\d+'*/;

/** Does this whole label stand for "any group"? */
export function isGenericLabel(label: string): boolean {
  if (GENERIC.has(label)) return true;
  const m = NUMBERED_GENERIC.exec(label);
  return !!m && m[0] === label;
}

// Formula-like entries (CO2Me, NO2, CF3…) are shown as their elements so they can be
// reversed the ChemDraw way (MeO2C, O2N, F3C); true abbreviations stay whole.
const nickNames = () => Object.keys(NICKNAMES)
  .filter((k) => !/^[CNOSB][A-Z0-9]/.test(k))
  .sort((a, b) => b.length - a.length);
let NICK_NAMES = nickNames();

/** The built-in nicknames, which one of the person's own can't replace. */
const BUILT_IN = new Set(Object.keys(NICKNAMES));

/** Is this one of the program's own nicknames (Boc, Ph, TBS…)? */
export const isBuiltInNickname = (name: string): boolean => BUILT_IN.has(name);

/**
 * Add nicknames of the person's own (or ones a drawing brings with it): name → SMILES, the
 * first atom being where it joins. Built-in names are left as they are. Returns the names added.
 */
export function addNicknames(more: Record<string, string>): string[] {
  const added: string[] = [];
  for (const [name, smi] of Object.entries(more)) {
    if (!name || BUILT_IN.has(name) || typeof smi !== 'string' || !smi) continue;
    NICKNAMES[name] = smi;
    nickCache.delete(name);
    added.push(name);
  }
  if (added.length) { NICK_NAMES = nickNames(); graphCache.clear(); }
  return added;
}

/** Take away a nickname of the person's own. */
export function removeNickname(name: string): void {
  if (BUILT_IN.has(name) || !(name in NICKNAMES)) return;
  delete NICKNAMES[name];
  nickCache.delete(name);
  NICK_NAMES = nickNames();
  graphCache.clear();
}

export interface Token {
  kind: 'el' | 'nick' | 'generic' | 'other';
  text: string;
  /** Subscript count written after the token, e.g. 3 in CH3. */
  count: number;
  /** Charge text written after the token ("+", "2−"). */
  charge: string;
  /** The count was written out (so "Ar1" keeps its 1). */
  explicit?: boolean;
}

/**
 * Split label text into tokens. Abbreviations win over elements, as in ChemDraw
 * (so "Ac" is acetyl and "Pr" is propyl).
 */
export function tokenize(label: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < label.length) {
    const rest = label.slice(i);
    let tok: Token | null = null;
    let g = [...GENERIC].filter((x) => rest.startsWith(x) && !/[a-z]/.test(rest[x.length] ?? '')).sort((a, b) => b.length - a.length)[0];
    const num = NUMBERED_GENERIC.exec(rest)?.[0];
    if (num && !/[a-z]/.test(rest[num.length] ?? '') && (!g || num.length > g.length)) g = num;
    const nick = NICK_NAMES.find((n) => rest.startsWith(n) && !/[a-z]/.test(rest[n.length] ?? ''));
    if (nick && (!g || nick.length >= g.length)) {
      tok = { kind: 'nick', text: nick, count: 1, charge: '' };
      i += nick.length;
    } else if (g && !(g.length === 1 && elementNumber(rest.slice(0, 2)) !== undefined && /[a-z]/.test(rest[1] ?? ''))) {
      tok = { kind: 'generic', text: g, count: 1, charge: '' };
      i += g.length;
    } else if (/[A-Z]/.test(label[i])) {
      const two = label.slice(i, i + 2);
      if (two.length === 2 && /[a-z]/.test(two[1]) && elementNumber(two) !== undefined) {
        tok = { kind: 'el', text: two, count: 1, charge: '' };
        i += 2;
      } else if (elementNumber(label[i]) !== undefined) {
        tok = { kind: 'el', text: label[i], count: 1, charge: '' };
        i += 1;
      } else {
        tok = { kind: 'other', text: label[i], count: 1, charge: '' };
        i += 1;
      }
    } else {
      // stray characters (parentheses, lowercase, punctuation) are kept as text
      const prev = out[out.length - 1];
      // a sign is a charge only at the end of the label ("N+", "CO2−"), not a hyphen ("(3,4)-MDP")
      if (prev && /[+\-−]/.test(label[i]) && /^[+\-−]*$/.test(label.slice(i + 1))) {
        let m = label[i];
        i++;
        prev.charge += m;
        continue;
      }
      // digits count the group before them (CH3, (CH2)3), but not after other punctuation ("(3,4)")
      if (prev && /\d/.test(label[i]) && (prev.kind !== 'other' || /^[)\]]$/.test(prev.text))) {
        let j = i;
        while (j < label.length && /\d/.test(label[j])) j++;
        if (/[+\-−]/.test(label[j] ?? '') && (j + 1 === label.length) && out.length === 1 && prev.kind === 'el' && i === prev.text.length) {
          // a lone element: Fe3+ is iron(III); otherwise digits count atoms, as in NH3+ and SO3−
          prev.charge = label.slice(i, j + 1);
          i = j + 1;
          continue;
        }
        prev.count = Number(label.slice(i, j));
        prev.explicit = true;
        i = j;
        continue;
      }
      tok = { kind: 'other', text: label[i], count: 1, charge: '' };
      i += 1;
    }
    out.push(tok);
  }
  return out;
}

/** Text of one token as displayed, split into normal, subscript and superscript parts. */
export interface Piece { text: string; sub?: boolean; sup?: boolean }

function tokenPieces(t: Token, supDigits = false): Piece[] {
  // Numbers after R groups and abbreviations (R1, Ar2) can be superscripts; element counts are subscripts.
  const up = supDigits && t.kind !== 'el';
  const m = t.kind === 'generic' ? /^(.*?\D)(\d+)$/.exec(t.text) : null;
  const p: Piece[] = m ? [{ text: m[1] }, { text: m[2], sub: !up, sup: up }] : [{ text: t.text }];
  if (t.count > 1 || t.explicit) p.push({ text: String(t.count), sub: !up, sup: up });
  if (t.charge) p.push({ text: t.charge.replace('-', '−'), sup: true });
  return p;
}

export interface LabelSpec {
  /** Tokens in reading order with the bonded token first. */
  tokens: Token[];
  /** Hydrogens shown on the label (automatic labels only). */
  hCount: number;
  charge: number;
  /** Show numbers after R groups as superscripts (R¹), as in the file the label came from. */
  supDigits?: boolean;
}

/** Tokens to show for an atom: its custom label, or element + hydrogens. Null = no label (plain carbon). */
export function labelSpec(z: number, label: string | null, charge: number, isotope: number, bondOrderSum: number, degree: number, showCharge = true, showCarbon = false): LabelSpec | null {
  const shown = showCharge ? charge : 0;
  if (label) return { tokens: tokenize(label), hCount: 0, charge: shown };
  if (z === 6 && degree > 0 && isotope === 0 && !showCarbon) return null;
  const h = hasImplicitH(z) ? implicitHydrogens(z, bondOrderSum, charge) : 0;
  const sym = isotope && z === 1 && isotope === 2 ? 'D' : SYMBOLS[z] ?? '?';
  return { tokens: [{ kind: 'el', text: sym, count: 1, charge: '' }], hCount: h, charge: shown };
}

/**
 * A bond as a label's layout sees it: the way it leaves the atom and, when known, its length,
 * how far its lines reach either side, and whether the atom at its far end shows a label too.
 */
export interface LabelBond { x: number; y: number; len?: number; spread?: number; far?: boolean }

/** The bonds round an atom, for laying out its label. */
export function labelBonds(doc: Doc, a: Atom): LabelBond[] {
  const out: LabelBond[] = [];
  const k = a.s ?? 1;
  const lw = (doc.style.lineWidth * k) / 2, gap = doubleBondGap(doc.style) * k;
  for (const bid of doc.adj.get(a.id) ?? []) {
    const b = doc.bonds.get(bid);
    const n = b && doc.atoms.get(b.a1 === a.id ? b.a2 : b.a1);
    if (!b || !n) continue;
    const l = Math.hypot(n.x - a.x, n.y - a.y);
    if (l < 1e-9) { out.push({ x: 0, y: 0, len: 0 }); continue; }
    // a double bond's second line can sit either side, so count it both ways
    const far = !!n.label || n.z !== 6 || !!n.showCarbon || !!n.isotope;
    out.push({ x: (n.x - a.x) / l, y: (n.y - a.y) / l, len: l, spread: lw + (b.order >= 1.5 ? gap : 0), far });
  }
  return out;
}

export interface GlyphRun {
  text: string;
  /** Left of the run, relative to the atom position. */
  dx: number;
  /** Baseline, relative to the atom position. */
  dy: number;
  size: number;
}

export interface LabelLayout {
  runs: GlyphRun[];
  /** Boxes (relative to atom) that bonds must stop at, before adding the margin. */
  boxes: { x1: number; y1: number; x2: number; y2: number }[];
  /** Which of the runs (and boxes) is the charge, when one is shown after the label. */
  charge?: number;
}

export type Measure = (text: string, size: number) => number;

const SUB_SCALE = 0.75;
const CAP = 0.716; // Arial cap height as a fraction of the font size

/**
 * Which way a label runs from its atom: to the right (OH), to the left (HO), or with the
 * H stacked above or below (the NH of a ring).
 *
 * This follows what ChemDraw 25 showed for NH and OH at many bond angles. Add up the
 * directions of the bonds. When that sum points within 22.5° of straight up or down and the
 * atom has two or more bonds, the H is stacked on the opposite side (pyrrole's NH below).
 * Otherwise the label runs right, or left when the sum leans right at all (HO with a bond 5°
 * right of vertical). When the bonds cancel out (a straight line through the atom), the H
 * goes on the first free side of right, left, above, below.
 */
export function labelDir(spec: LabelSpec, bondDirs: { x: number; y: number }[], just: 'auto' | 'left' | 'right' = 'auto'): 'right' | 'left' | 'up' | 'down' {
  if (just === 'left') return 'left';
  if (just === 'right') return 'right';
  let sx = 0, sy = 0;
  for (const d of bondDirs) { sx += d.x; sy += d.y; }
  const EPS = 1e-3; // saved coordinates are rounded, so smaller differences mean nothing
  const stack = bondDirs.length >= 2 && spec.tokens.length === 1 && spec.hCount > 0;
  if (Math.hypot(sx, sy) < EPS) {
    if (!bondDirs.some((d) => d.x > 0.7)) return 'right';
    if (!bondDirs.some((d) => d.x < -0.7)) return 'left';
    if (!stack) return 'right';
    return bondDirs.some((d) => d.y < -0.7) ? 'down' : 'up';
  }
  if (stack && Math.abs(sx) < Math.tan(Math.PI / 8) * Math.abs(sy) - EPS) return sy > 0 ? 'up' : 'down';
  return sx > EPS ? 'left' : 'right';
}

/**
 * Lay out a label. `bondDirs` are unit vectors from the atom to its neighbours, with the bonds'
 * lengths when known (so a charge can move out of the way of a short bond).
 * Follows ChemDraw's automatic justification: the bonded atom sits on the atom
 * position, and the rest of the label runs away from the bonds (p. 46).
 */
export function layoutLabel(spec: LabelSpec, bondDirs: LabelBond[], size: number, measure: Measure, just: 'auto' | 'left' | 'right' = 'auto'): LabelLayout {
  const head = spec.tokens[0];
  const tail = spec.tokens.slice(1);
  const hTok: Token | null = spec.hCount > 0 ? { kind: 'el', text: 'H', count: spec.hCount, charge: '' } : null;
  const chargeText = spec.charge ? (Math.abs(spec.charge) > 1 ? String(Math.abs(spec.charge)) : '') + (spec.charge > 0 ? '+' : '−') : '';
  const dir = labelDir(spec, bondDirs, just);

  const runs: GlyphRun[] = [];
  const boxes: LabelLayout['boxes'] = [];
  // the charge goes on last, once the rest of the label is in place
  let chargeAt = 0;
  const pushCharge = (x: number) => { chargeAt = x; };
  const baseline = (CAP * size) / 2;
  const subSize = size * SUB_SCALE;

  const pieceWidth = (p: Piece) => measure(p.text, p.sub || p.sup ? subSize : size);
  const pushPieces = (pieces: Piece[], x: number): number => {
    for (const p of pieces) {
      const s = p.sub || p.sup ? subSize : size;
      const dy = baseline + (p.sub ? size * 0.22 : p.sup ? -size * 0.42 : 0);
      const w = measure(p.text, s);
      runs.push({ text: p.text, dx: x, dy, size: s });
      boxes.push({ x1: x, y1: dy - CAP * s, x2: x + w, y2: dy + (p.sub ? 0.1 * s : 0) });
      x += w;
    }
    return x;
  };

  // Head token: its first character is centred on the atom.
  const sd = !!spec.supDigits;
  const headPieces = tokenPieces(head, sd);
  const firstCharW = measure(head.text[0], size);
  const headX = -firstCharW / 2;

  if (dir === 'right' || dir === 'up' || dir === 'down') {
    let x = pushPieces(headPieces, headX);
    if (dir === 'right' && hTok) x = pushPieces(tokenPieces(hTok), x);
    for (const t of tail) x = pushPieces(tokenPieces(t, sd), x);
    if (chargeText) pushCharge(x);
    if (hTok && dir !== 'right') {
      // stacked H above or below the atom (e.g. the NH of a ring)
      const w = pieceWidth({ text: 'H' }) + (hTok.count > 1 ? pieceWidth({ text: String(hTok.count), sub: true }) : 0);
      const yOff = dir === 'up' ? -size * 1.0 : size * 1.0;
      const start = runs.length;
      pushPieces(tokenPieces(hTok), -firstCharW / 2 + (firstCharW - w) / 2 + (hTok.count > 1 ? 0 : 0));
      for (let i = start; i < runs.length; i++) runs[i].dy += yOff;
      for (let i = start; i < boxes.length; i++) { boxes[i].y1 += yOff; boxes[i].y2 += yOff; }
    }
  } else if (spec.tokens.some((t) => t.kind === 'other')) {
    // Text that is not a formula ("(3,4)-MDP", "Aryl") is never reversed: ChemDraw keeps its
    // reading order and puts the last letter or digit on the atom.
    const pieces: Piece[] = [];
    for (const t of spec.tokens) pieces.push(...tokenPieces(t, sd));
    let x = 0, anchor = 0;
    for (const p of pieces) {
      const i = p.sub || p.sup ? -1 : p.text.search(/[A-Za-z0-9](?![\s\S]*[A-Za-z0-9])/);
      if (i >= 0) anchor = x + measure(p.text.slice(0, i), size) + measure(p.text[i], size) / 2;
      x += pieceWidth(p);
    }
    const end = pushPieces(pieces, -anchor);
    if (chargeText) pushCharge(end);
  } else {
    // Reversed: rest of the label to the left, abbreviations kept whole (THPO, not PHTO).
    const leftTokens: Token[] = [...tail].reverse();
    const leftPieces: Piece[] = [];
    for (const t of leftTokens) leftPieces.push(...tokenPieces(t, sd));
    if (hTok) leftPieces.push(...tokenPieces(hTok));
    let w = 0;
    for (const p of leftPieces) w += pieceWidth(p);
    let headStart = headX;
    if (head.text.length > 1) {
      // A right-justified label ("Ph", "Boc", "Cl") meets the bond at its last letter, as in ChemDraw.
      let hw = 0;
      for (const p of headPieces) hw += pieceWidth(p);
      headStart = measure(head.text[head.text.length - 1], size) / 2 - hw;
    }
    pushPieces(leftPieces, headStart - w);
    const x = pushPieces(headPieces, headStart);
    if (chargeText) pushCharge(x);
  }
  let charge: number | undefined;
  if (chargeText) {
    const spot = chargeSpot(chargeText, chargeAt, boxes, dir, bondDirs, size, measure);
    charge = runs.length;
    const s = subSize, w = measure(chargeText, s);
    runs.push({ text: chargeText, dx: spot.x, dy: spot.dy, size: s });
    boxes.push({ x1: spot.x, y1: spot.dy - CAP * s, x2: spot.x + w, y2: spot.dy });
  }
  return { runs, boxes, charge };
}

/**
 * Where the ink of a charge is, for a run of it at (x, baseline dy) in size s, as boxes: the
 * two bars of a "+", the one of a "−" (a number is taken as a whole box). The signs are much
 * smaller than a capital letter, so a bond can pass close by without touching them.
 */
export function chargeInk(text: string, x: number, dy: number, s: number, measure: Measure): Rect[] {
  const w = measure(text, s);
  if (/\d/.test(text)) return [{ x1: x, y1: dy - CAP * s, x2: x + w, y2: dy }];
  // Arial's plus and minus are bars 0.07 of the size thick, 0.06 in from each side, across at
  // 0.35 of the size above the baseline; the plus's upright runs 0.12–0.59
  const x1 = x + 0.06 * s, x2 = x + w - 0.06 * s, mid = dy - 0.35 * s, t = 0.035 * s;
  const across = { x1, y1: mid - t, x2, y2: mid + t };
  if (!text.endsWith('+')) return [across];
  const cx = (x1 + x2) / 2;
  return [across, { x1: cx - t, y1: dy - 0.59 * s, x2: cx + t, y2: dy - 0.11 * s }];
}

/**
 * Where a label's charge goes. Its place is raised after the label (N⁺), as in ChemDraw, and a
 * bond that runs under it is cut short there. Only when that would leave almost nothing of a
 * bond (short bonds, or a label at the far end too: a bent C=N⁺=N⁻) does it move, to the first
 * of above the atom, raised before the label, lowered after it, below the atom or lowered
 * before it that no bond runs under, else to wherever leaves the most of the bonds.
 * Bond lengths (`len`) are needed for the move; without them the charge stays in its place.
 */
function chargeSpot(text: string, end: number, boxes: Rect[], dir: string, bonds: LabelBond[], size: number, measure: Measure): { x: number; dy: number } {
  const s = size * SUB_SCALE, w = measure(text, s);
  const baseline = (CAP * size) / 2;
  const home = { x: end, dy: baseline - size * 0.42 };
  if (!bonds.some((b) => b.len)) return home;
  let left = Infinity, top = Infinity, bottom = -Infinity;
  for (const b of boxes) { left = Math.min(left, b.x1); top = Math.min(top, b.y1); bottom = Math.max(bottom, b.y2); }
  // how much of a bond a charge here cuts away, with the label at its far end (a fraction), and
  // whether any line of a bond runs under it at all
  const hit = 0.05 * size, cut = 0.12 * size, farCut = 0.7 * size;
  const grow = (r: Rect, m: number): Rect => ({ x1: r.x1 - m, y1: r.y1 - m, x2: r.x2 + m, y2: r.y2 + m });
  const cost = (p: { x: number; dy: number }) => {
    const ink = chargeInk(text, p.x, p.dy, s, measure);
    let worst = 0, touches = false;
    for (const b of bonds) {
      const l = b.len ?? 0;
      if (l <= 0) continue;
      const q = { x: b.x * l, y: b.y * l }, sp = b.spread ?? 0;
      if (ink.every((r) => passParam({ x: 0, y: 0 }, q, grow(r, hit + sp)) <= 0)) continue;
      touches = true;
      for (const r of ink) worst = Math.max(worst, passParam({ x: 0, y: 0 }, q, grow(r, cut)) + (b.far ? farCut / l : 0));
    }
    return { worst, touches };
  };
  if (cost(home).worst <= 0.8) return home;
  const raised = home.dy, lowered = baseline + size * 0.22;
  const spots = [
    dir !== 'up' && { x: -w / 2, dy: top - 0.05 * size },
    { x: left - w, dy: raised },
    { x: end, dy: lowered },
    dir !== 'down' && { x: -w / 2, dy: bottom + CAP * s + 0.05 * size },
    { x: left - w, dy: lowered },
  ].filter((p): p is { x: number; dy: number } => !!p);
  let best = home, bestCut = cost(home).worst;
  for (const p of spots) {
    const c = cost(p);
    if (!c.touches) return p;
    if (c.worst < bestCut) { best = p; bestCut = c.worst; }
  }
  return best;
}

// ------------------------------------------------------------------ chemistry of labels

export interface MiniAtom {
  z: number;
  charge: number;
  aromatic: boolean;
  dummy: boolean;
  /** Hydrogens written in the label (NH2 → 2); undefined = worked out by the chemistry engine. */
  hCount?: number;
  /** Mass number (2 for D, 3 for T); 0 or undefined = natural. */
  iso?: number;
}
export interface MiniBond { a: number; b: number; order: number }
export interface MiniGraph { atoms: MiniAtom[]; bonds: MiniBond[] }

/** A small SMILES reader, enough for the abbreviation table. The first atom is the attachment. */
export function parseSmiles(smi: string): MiniGraph {
  const atoms: MiniAtom[] = [];
  const bonds: MiniBond[] = [];
  const stack: number[] = [];
  const rings = new Map<number, { atom: number; order: number }>();
  let prev = -1;
  let pendingOrder = 0;
  let i = 0;
  const add = (z: number, aromatic: boolean, charge = 0, dummy = false, hCount?: number) => {
    const idx = atoms.length;
    atoms.push({ z, charge, aromatic, dummy, hCount });
    if (prev >= 0) {
      const ord = pendingOrder || (aromatic && atoms[prev].aromatic ? 1.5 : 1);
      bonds.push({ a: prev, b: idx, order: ord });
    }
    pendingOrder = 0;
    prev = idx;
  };
  while (i < smi.length) {
    const c = smi[i];
    if (c === '(') { stack.push(prev); i++; continue; }
    if (c === ')') { prev = stack.pop() ?? prev; i++; continue; }
    if (c === '=') { pendingOrder = 2; i++; continue; }
    if (c === '#') { pendingOrder = 3; i++; continue; }
    if (c === '-') { pendingOrder = 1; i++; continue; }
    if (c === '*') { add(0, false, 0, true); i++; continue; }
    if (/\d/.test(c)) {
      const n = Number(c);
      const open = rings.get(n);
      if (open) {
        const ord = pendingOrder || open.order || (atoms[open.atom].aromatic && atoms[prev].aromatic ? 1.5 : 1);
        bonds.push({ a: open.atom, b: prev, order: ord });
        rings.delete(n);
      } else rings.set(n, { atom: prev, order: pendingOrder });
      pendingOrder = 0;
      i++;
      continue;
    }
    if (c === '[') {
      const j = smi.indexOf(']', i);
      const inner = smi.slice(i + 1, j);
      const m = /^(\d*)([A-Za-z][a-z]?)(H\d?)?([+-]\d?)?$/.exec(inner)!;
      const aromatic = /^[a-z]/.test(m[2]);
      const sym = aromatic ? m[2][0].toUpperCase() + m[2].slice(1) : m[2];
      let charge = 0;
      if (m[4]) charge = (m[4][0] === '+' ? 1 : -1) * (m[4].length > 1 ? Number(m[4].slice(1)) : 1);
      const h = m[3] ? (m[3].length > 1 ? Number(m[3].slice(1)) : 1) : 0;
      add(elementNumber(sym) ?? 0, aromatic, charge, false, h);
      i = j + 1;
      continue;
    }
    const two = smi.slice(i, i + 2);
    if (two === 'Cl' || two === 'Br') { add(elementNumber(two)!, false); i += 2; continue; }
    if (/[BCNOPSFI]/.test(c)) { add(elementNumber(c)!, false); i++; continue; }
    if (/[bcnops]/.test(c)) { add(elementNumber(c.toUpperCase())!, true); i++; continue; }
    i++;
  }
  return { atoms, bonds };
}

/**
 * The bonds of a small graph with aromatic (1.5) bonds written as alternating single and
 * double bonds, as ChemDraw draws them. ChemDraw ranks groups for R/S with these, so a phenyl
 * written with 1.5 bonds can flip a stereo label. Aromatic bonds stay 1.5 if no alternating
 * pattern fits.
 */
export function kekulize(g: MiniGraph): MiniBond[] {
  const arom = g.bonds.map((b, i) => (b.order === 1.5 ? i : -1)).filter((i) => i >= 0);
  if (!arom.length) return g.bonds;
  // atoms that need one double bond: aromatic carbons, and nitrogens without H as in pyridine
  const needs = (i: number) => {
    const a = g.atoms[i];
    return a.z === 6 || a.z === 5 || ((a.z === 7 || a.z === 15) && !a.hCount && a.charge >= 0);
  };
  const atoms = [...new Set(arom.flatMap((i) => [g.bonds[i].a, g.bonds[i].b]))].filter(needs);
  const mate = new Map<number, number>(); // atom → bond index of its double bond
  const solve = (k: number): boolean => {
    if (k === atoms.length) return true;
    const x = atoms[k];
    if (mate.has(x)) return solve(k + 1);
    for (const bi of arom) {
      const b = g.bonds[bi];
      const y = b.a === x ? b.b : b.b === x ? b.a : -1;
      if (y < 0 || mate.has(y) || !atoms.includes(y)) continue;
      mate.set(x, bi);
      mate.set(y, bi);
      if (solve(k + 1)) return true;
      mate.delete(x);
      mate.delete(y);
    }
    return false;
  };
  if (!solve(0)) return g.bonds;
  const doubles = new Set(mate.values());
  return g.bonds.map((b, i) => (b.order === 1.5 ? { ...b, order: doubles.has(i) ? 2 : 1 } : b));
}

const nickCache = new Map<string, MiniGraph>();
function nickGraph(name: string): MiniGraph {
  let g = nickCache.get(name);
  if (!g) { g = parseSmiles(NICKNAMES[name]); nickCache.set(name, g); }
  return g;
}

/** An atom of a label with too many bonds: its index in the label's graph, and the counts. */
export interface OverValent { atom: number; z: number; used: number; max: number; h: number }

/** A label read as a list: tokens, and bracketed groups with how many times they repeat. */
type Item = { tok: Token } | GroupItem;
interface GroupItem { group: Item[]; count: number; charge: string }

const isH = (it: Item) => 'tok' in it && it.tok.kind === 'el' && it.tok.text === 'H';

function groupItems(toks: Token[]): Item[] | null {
  const root: Item[] = [];
  const stack: { items: Item[]; g?: GroupItem }[] = [{ items: root }];
  for (const t of toks) {
    if (t.kind === 'other' && t.text === '(') {
      const g: GroupItem = { group: [], count: 1, charge: '' };
      stack[stack.length - 1].items.push(g);
      stack.push({ items: g.group, g });
    } else if (t.kind === 'other' && t.text === ')') {
      const top = stack.pop()!;
      if (!top.g || !top.g.group.length) return null;
      top.g.count = t.explicit ? t.count : 1;
      top.g.charge = t.charge;
    } else if (t.kind === 'other') return null;
    else stack[stack.length - 1].items.push({ tok: t });
  }
  return stack.length === 1 && root.length ? root : null;
}

/** True if a label's brackets ( ) [ ] { } don't pair up. */
export function bracketsUnbalanced(label: string): boolean {
  const open: string[] = [];
  const pair: Record<string, string> = { ')': '(', ']': '[', '}': '{' };
  for (const c of label) {
    if (c === '(' || c === '[' || c === '{') open.push(c);
    else if (pair[c] && open.pop() !== pair[c]) return true;
  }
  return open.length > 0;
}

const signedCharge = (text: string) => {
  const n = Number(text.replace(/[^0-9]/g, '') || '1');
  return /[-−]/.test(text) ? -n : n;
};

/** Builds the atoms of a label, reading it the way a chemist writes a condensed formula. */
class LabelBuilder {
  g: MiniGraph = { atoms: [], bonds: [] };
  /** The atom the next part of the label bonds to. */
  backbone = -1;
  private pendingH = 0;
  /** Atoms inside abbreviations: their bonds are complete. */
  private body = new Set<number>();
  /** First atom of each abbreviation or R group (they bond once to the rest). */
  private heads = new Set<number>();

  constructor(private ext: number) {}

  private add(z: number, extra: Partial<MiniAtom> = {}): number {
    const i = this.g.atoms.length;
    this.g.atoms.push({ z, charge: 0, aromatic: false, dummy: false, ...extra });
    if (this.pendingH && !extra.dummy) { this.g.atoms[i].hCount = this.pendingH; this.pendingH = 0; }
    return i;
  }

  private bond(a: number, b: number, order = 1): void {
    if (a >= 0 && b >= 0) this.g.bonds.push({ a, b, order });
  }

  private addSub(sub: MiniGraph): number {
    const off = this.g.atoms.length;
    this.g.atoms.push(...sub.atoms.map((a) => ({ ...a })));
    this.g.bonds.push(...sub.bonds.map((b) => ({ a: b.a + off, b: b.b + off, order: b.order })));
    for (let i = off + 1; i < this.g.atoms.length; i++) this.body.add(i);
    this.heads.add(off);
    return off;
  }

  /** Bonds an atom makes, counting written hydrogens and, for the first atom, the structure's bonds. */
  used(i: number): number {
    const orders: number[] = [];
    for (const b of this.g.bonds) if (b.a === i || b.b === i) orders.push(b.order);
    return valenceOfBonds(orders, this.g.atoms[i].z) + (this.g.atoms[i].hCount ?? 0) + (i === 0 ? this.ext : 0);
  }

  /** Free valence left on an atom (abbreviations have none, except one bond on their first atom). */
  open(i: number): number {
    if (this.body.has(i)) return 0;
    const a = this.g.atoms[i];
    if (this.heads.has(i) || a.dummy) {
      let extra = i === 0 ? this.ext : 0;
      for (const b of this.g.bonds) {
        const o = b.a === i ? b.b : b.b === i ? b.a : -1;
        if (o >= 0 && !this.body.has(o)) extra++;
      }
      return Math.max(0, 1 - extra);
    }
    const max = maxValence(a.z, a.charge);
    return max === undefined ? 1 : Math.max(0, max - this.used(i));
  }

  /** Atoms with more bonds than their element allows (counting written hydrogens). */
  overValent(charge0 = 0): OverValent[] {
    const out: OverValent[] = [];
    this.g.atoms.forEach((a, i) => {
      if (a.dummy || this.body.has(i)) return;
      const max = maxValence(a.z, a.charge + (i === 0 ? charge0 : 0));
      const used = this.used(i);
      if (max !== undefined && used > max) out.push({ atom: i, z: a.z, used, max, h: a.hCount ?? 0 });
    });
    return out;
  }

  private setCharge(i: number, text: string): void {
    if (i >= 0 && text) this.g.atoms[i].charge = signedCharge(text);
  }

  seq(items: Item[]): void {
    let run: number[] = [];
    items.forEach((it, k) => {
      const more = k < items.length - 1;
      if ('group' in it) { this.group(it); run = []; return; }
      const t = it.tok;
      if (t.kind === 'el' && t.text === 'H') {
        if (this.backbone < 0) { this.pendingH += t.count; return; }
        if (run.length > 1) {
          // C2H5: share the hydrogens out along the chain, ends first
          let left = t.count;
          for (let r = run.length - 1; r >= 0 && left > 0; r--) {
            const room = Math.max(0, (maxValence(this.g.atoms[run[r]].z) ?? 4) - this.used(run[r]) - (r === run.length - 1 && more ? 1 : 0));
            const h = Math.min(room, left);
            this.g.atoms[run[r]].hCount = (this.g.atoms[run[r]].hCount ?? 0) + h;
            left -= h;
          }
          if (left) this.g.atoms[this.backbone].hCount = (this.g.atoms[this.backbone].hCount ?? 0) + left;
        } else {
          const a = this.g.atoms[this.backbone];
          a.hCount = (a.hCount ?? 0) + t.count;
        }
        this.setCharge(this.backbone, t.charge);
        run = [];
        return;
      }
      run = [];
      let n = Math.max(1, t.count);
      const prev = items[k - 1];
      if (t.kind === 'generic' && /^R\d$/.test(t.text) && prev && 'tok' in prev && prev.tok.kind === 'el') {
        // NR2, SiR3: R groups counted, not the R2 of a numbered set (which stands alone)
        n = Number(t.text[1]);
      }
      if (t.kind === 'nick' || t.kind === 'generic') {
        // NMe3+, PPh3+, OTf−: the charge after groups on an atom belongs to that atom
        const on = this.backbone;
        const toAtom = !!t.charge && on >= 0 && !this.heads.has(on) && !this.g.atoms[on].dummy && !this.body.has(on);
        let head = -1;
        for (let r = 0; r < n; r++) {
          head = t.kind === 'nick' ? this.addSub(nickGraph(t.text)) : this.add(0, { dummy: true });
          if (t.kind === 'generic') this.heads.add(head);
          // abbreviations end a branch, so what follows bonds to the same atom (NMeBn, PPh2Cl)
          if (this.backbone >= 0) this.bond(this.backbone, head);
          else this.backbone = head;
        }
        this.setCharge(toAtom ? on : head, t.charge);
        return;
      }
      const z = t.text === 'D' || t.text === 'T' ? 1 : elementNumber(t.text) ?? 0;
      const iso = t.text === 'D' ? 2 : t.text === 'T' ? 3 : undefined;
      const extra: Partial<MiniAtom> = iso ? { iso } : {};
      const b = this.backbone;
      let last = -1;
      if ((z === 8 || z === 16) && b >= 0 && !this.heads.has(b) && !this.g.atoms[b].dummy && this.g.atoms[b].z !== 1) {
        // C=O and S(=O)2 written as CO, SO2: as many double-bonded O as the atom has room for,
        // keeping one bond free when more of the label follows (CONH2, SO3H, CO2Me)
        const room = (maxValence(this.g.atoms[b].z, this.g.atoms[b].charge) ?? 4) - this.used(b);
        const oxo = Math.max(0, Math.min(n, Math.floor((room - (more ? 1 : 0)) / 2)));
        for (let r = 0; r < oxo; r++) { last = this.add(z, { ...extra }); this.bond(b, last, 2); }
        for (let r = oxo; r < n; r++) { last = this.add(z, { ...extra }); this.bond(this.backbone, last); this.backbone = last; }
      } else if (oneBond(z) && n > 1) {
        // CF3, CCl3, CD3: each on the atom before (D5 on its own: just the atoms)
        for (let r = 0; r < n; r++) {
          last = this.add(z, { ...extra });
          if (b >= 0) this.bond(b, last);
          else if (r === 0) this.backbone = last;
        }
      } else {
        for (let r = 0; r < n; r++) {
          last = this.add(z, { ...extra });
          this.bond(this.backbone, last);
          this.backbone = last;
          run.push(last);
        }
      }
      this.setCharge(last, t.charge);
    });
  }

  private group(it: GroupItem): void {
    const sub = new LabelBuilder(0);
    sub.seq(it.group);
    const n = sub.g.atoms.length;
    if (!n) return;
    // C(O)Me, P(O)Ph2, S(O)Me: a bare O or S in brackets is double bonded to the atom before (an
    // oxo, as CO and SO2 are), not a link in the chain
    const b = this.backbone, only = sub.g.atoms[0];
    if (n === 1 && it.count === 1 && !it.charge && (only.z === 8 || only.z === 16) && !only.charge && !only.hCount && sub.open(0) === 2
      && b >= 0 && !this.heads.has(b) && !this.g.atoms[b].dummy && this.g.atoms[b].z !== 1) {
      const room = (maxValence(this.g.atoms[b].z, this.g.atoms[b].charge) ?? 4) - this.used(b);
      if (room >= 2) {
        const o = this.add(only.z, only.iso ? { iso: only.iso } : {});
        this.bond(b, o, 2);
        return;
      }
    }
    let open = 0, tail = 0;
    for (let i = 0; i < n; i++) { const o = sub.open(i); open += o; if (o > 0) tail = i; }
    // (CH2)3 and (CH2CH2O)n are links in a chain; (OH)2, (CH3)2 and (Ph)3 hang off the atom before
    const chain = open >= 2 || this.backbone < 0;
    for (let r = 0; r < it.count; r++) {
      const off = this.g.atoms.length;
      this.g.atoms.push(...sub.g.atoms.map((a) => ({ ...a })));
      this.g.bonds.push(...sub.g.bonds.map((b) => ({ a: b.a + off, b: b.b + off, order: b.order })));
      for (const i of sub.body) this.body.add(i + off);
      for (const i of sub.heads) this.heads.add(i + off);
      if (this.backbone >= 0) this.bond(this.backbone, off);
      if (chain) this.backbone = off + tail;
    }
    this.setCharge(this.backbone, it.charge);
  }

  finish(): MiniGraph | null {
    if (!this.g.atoms.length && this.pendingH) {
      // "H" (or "H2") on its own is a hydrogen atom
      this.pendingH = 0;
      this.add(1);
    }
    return this.g.atoms.length ? this.g : null;
  }
}

/** A terminal piece of a label: an abbreviation, R group or one-bond element (F, Cl). */
function terminal(it: Item): boolean {
  if (!('tok' in it)) {
    // (HO)2B, (MeO)3Si: groups that hang off the atom after them
    const b = new LabelBuilder(0);
    b.seq(it.group);
    let open = 0;
    for (let i = 0; i < b.g.atoms.length; i++) open += b.open(i);
    return open <= 1;
  }
  const t = it.tok;
  if (t.kind === 'nick' || t.kind === 'generic') return true;
  return t.kind === 'el' && t.text !== 'H' && oneBond(elementNumber(t.text) ?? 0);
}

/**
 * Elements that make one bond in a label: H and the halogens (whose highest valence is 7, as in
 * IF7, though in CCl3 or SiCl3 each makes one), and anything whose highest valence is 1.
 */
function oneBond(z: number): boolean {
  return z === 1 || z === 9 || z === 17 || z === 35 || z === 53 || z === 85 || (maxValence(z) ?? 2) <= 1;
}

const itemText = (it: Item): string => 'tok' in it
  ? it.tok.text + (it.tok.count > 1 || it.tok.explicit ? it.tok.count : '') + it.tok.charge
  : '(' + it.group.map(itemText).join('') + ')' + (it.count > 1 ? it.count : '') + it.charge;

/**
 * A label written backwards, as on the left of a structure (MeO, BocHN, F3C, O2N, HO2C):
 * the items in bonding order, or null if it reads forwards. Hydrogens written before an
 * atom (the H of BocHN) belong to that atom.
 */
function reversedItems(items: Item[]): Item[] | null {
  const units: Item[][] = [];
  let hs: Item[] = [];
  for (const it of items) {
    if (isH(it)) { hs.push(it); continue; }
    units.push([it, ...hs]);
    hs = [];
  }
  if (hs.length || units.length < 2) return null;
  const rev = units.reverse().flat();
  const text = rev.map(itemText).join('');
  if (NICKNAMES[text] || terminal(units[units.length - 1][0])) return rev;
  return null;
}

const graphCache = new Map<string, { g: MiniGraph | null; over: OverValent[] }>();

/** An element list such as [Cl, Br, I] (or [Rh]): any one of these, left out of the formula. */
export function isElementList(label: string): boolean {
  const m = /^\[(.*)\]$/.exec(label.trim());
  return !!m && m[1].split(/\s*,\s*/).every((x) => elementNumber(x) !== undefined);
}

const ALKALI = new Set(['Li', 'Na', 'K', 'Rb', 'Cs']);

function buildLabel(label: string, ext: number, charge = 0): { g: MiniGraph | null; over: OverValent[] } {
  const key = ext + '|' + charge + '|' + label;
  let r = graphCache.get(key);
  if (r) return r;
  r = { g: null, over: [] };
  let items: Item[] | null = null;
  let nick: string | null = NICKNAMES[label] ? label : null;
  if (!nick && (isGenericLabel(label) || isElementList(label))) r.g = { atoms: [{ z: 0, charge: 0, aromatic: false, dummy: true }], bonds: [] };
  else if (!nick && ext === 0 && (items = groupItems(tokenize(label))) && items.length > 1 && 'tok' in items[0] && ALKALI.has(items[0].tok.text) && items[0].tok.count <= 1 && !items[0].tok.charge && !items.slice(1).every(isH)) {
    // a salt written as one label (NaBH4, KOtBu, LiAlH4): the metal cation and the anion, not bonded
    const cation = new LabelBuilder(0);
    cation.seq([items[0]]);
    const anion = new LabelBuilder(0);
    anion.seq(items.slice(1));
    const ga = anion.finish();
    if (ga) {
      cation.g.atoms[0].charge = 1;
      if (!items.slice(1).some((it) => ('tok' in it ? it.tok.charge : it.charge))) ga.atoms[0].charge -= 1;
      const off = cation.g.atoms.length;
      r.g = { atoms: [...cation.g.atoms, ...ga.atoms], bonds: ga.bonds.map((b) => ({ ...b, a: b.a + off, b: b.b + off })) };
      r.over = anion.overValent().map((o) => ({ ...o, atom: o.atom + off }));
    }
    items = null;
  } else if (!nick) {
    items = groupItems(tokenize(label));
    const rev = items && ext > 0 ? reversedItems(items) : null;
    if (rev) {
      const t = rev.map(itemText).join('');
      if (NICKNAMES[t]) nick = t;
      else items = rev;
    }
  }
  // an abbreviation is read as one token, so a second bond to it shows up as too many bonds
  if (nick) items = [{ tok: { kind: 'nick', text: nick, count: 1, charge: '' } }];
  if (items) {
    const b = new LabelBuilder(ext);
    b.seq(items);
    r.g = b.finish();
    if (r.g) r.over = b.overValent(charge);
  }
  if (graphCache.size > 2000) graphCache.clear();
  graphCache.set(key, r);
  return r;
}

/**
 * Atoms and bonds that a text label stands for, with index 0 bonded to the structure.
 * Whole-label abbreviations (CO2Me, NO2) are looked up first; otherwise the label is read as
 * a condensed formula: OMe → O–CH3, NHBoc → N–Boc, CH2OH → C–O, CONH2 → C(=O)–N,
 * B(OH)2 → B with two OH, (CH2)3OH → a three-carbon chain, MeO and F3C read from the right.
 * `ext` is how many bonds the label makes to the structure. Null if it can't be read.
 */
export function labelGraph(label: string, ext = 1): MiniGraph | null {
  return buildLabel(label, ext).g;
}

/** A CO label given to a metal is carbon monoxide, M←C⁻≡O⁺ to the chemistry engine, not a formyl group. */
export const CARBONYL_LIGAND: MiniGraph = parseSmiles('[C-]#[O+]');
export const isCarbonylLabel = (label: string) => label === 'CO' || label === 'OC';

/**
 * Atoms of a label with more bonds than their element allows, counting the hydrogens written in
 * the label and the `ext` bonds to the structure. `charge` is the atom's own charge (a node's
 * charge that is not written in the label text).
 */
export function labelOverValent(label: string, ext = 1, charge = 0): OverValent[] {
  return buildLabel(label, ext, charge).over;
}
