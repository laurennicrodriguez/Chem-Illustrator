// Atom labels: reading label text ("OMe", "CO2Et", "NHBoc"), choosing which way it runs
// (OH vs HO, CH3 vs H3C), and turning it into atoms for the chemistry engine.

import { SYMBOLS, elementNumber, hasImplicitH, implicitHydrogens } from './elements';

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
  Cy: 'C1CCCCC1', cHx: 'C1CCCCC1', Mes: 'c1c(C)cc(C)cc1C', Tol: 'c1ccc(C)cc1', 'p-Tol': 'c1ccc(C)cc1', Np: 'c1cccc2ccccc12',
  Ar: '*', Het: '*', CN: 'C#N', NO2: '[N+](=O)[O-]', CF3: 'C(F)(F)F', CCl3: 'C(Cl)(Cl)Cl', N3: 'N=[N+]=[N-]',
  CO2H: 'C(=O)O', COOH: 'C(=O)O', CO2Me: 'C(=O)OC', CO2Et: 'C(=O)OCC', CO2tBu: 'C(=O)OC(C)(C)C', CO2Bn: 'C(=O)OCc1ccccc1',
  CO2R: 'C(=O)O*', CHO: 'C=O', COMe: 'C(C)=O', OAc: 'OC(C)=O', OTf: 'OS(=O)(=O)C(F)(F)F', SO2Ph: 'S(=O)(=O)c1ccccc1',
  SO2Me: 'S(=O)(=O)C', Bpin: 'B1OC(C)(C)C(C)(C)O1', BPin: 'B1OC(C)(C)C(C)(C)O1', Cp: 'C1C=CC=C1',
};

/** Labels that stand for "any group" and are left out of formula and mass. */
export const GENERIC = new Set(['R', "R'", "R''", 'R1', 'R2', 'R3', 'R4', 'R5', 'X', 'Z', 'A', 'Q', 'M', 'G', 'E', 'Nu', 'LG', 'PG', 'EWG', 'EDG', 'L', 'Ln']);

// Formula-like entries (CO2Me, NO2, CF3…) are shown as their elements so they can be
// reversed the ChemDraw way (MeO2C, O2N, F3C); true abbreviations stay whole.
const NICK_NAMES = Object.keys(NICKNAMES)
  .filter((k) => !/^[CNOSB][A-Z0-9]/.test(k))
  .sort((a, b) => b.length - a.length);

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
    const g = [...GENERIC].filter((x) => rest.startsWith(x) && !/[a-z]/.test(rest[x.length] ?? '')).sort((a, b) => b.length - a.length)[0];
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
      if (prev && /[+\-−]/.test(label[i])) {
        let m = label[i];
        i++;
        prev.charge += m;
        continue;
      }
      if (prev && /\d/.test(label[i])) {
        let j = i;
        while (j < label.length && /\d/.test(label[j])) j++;
        if (/[+\-−]/.test(label[j] ?? '') && (j + 1 === label.length)) {
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
export function labelSpec(z: number, label: string | null, charge: number, isotope: number, bondOrderSum: number, degree: number, showCharge = true): LabelSpec | null {
  const shown = showCharge ? charge : 0;
  if (label) return { tokens: tokenize(label), hCount: 0, charge: shown };
  if (z === 6 && degree > 0 && isotope === 0) return null;
  const h = hasImplicitH(z) ? implicitHydrogens(z, bondOrderSum, charge) : 0;
  const sym = isotope && z === 1 && isotope === 2 ? 'D' : SYMBOLS[z] ?? '?';
  return { tokens: [{ kind: 'el', text: sym, count: 1, charge: '' }], hCount: h, charge: shown };
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
}

export type Measure = (text: string, size: number) => number;

const SUB_SCALE = 0.75;
const CAP = 0.716; // Arial cap height as a fraction of the font size

/**
 * Which way a label runs from its atom: to the right (OH), to the left (HO), or with the
 * H stacked above or below (the NH of a ring).
 */
export function labelDir(spec: LabelSpec, bondDirs: { x: number; y: number }[], just: 'auto' | 'left' | 'right' = 'auto'): 'right' | 'left' | 'up' | 'down' {
  let sx = 0, sy = 0;
  for (const d of bondDirs) { sx += d.x; sy += d.y; }
  const hasRight = bondDirs.some((d) => d.x > 0.3);
  const hasLeft = bondDirs.some((d) => d.x < -0.3);
  if (just === 'left') return 'left';
  if (just === 'right') return 'right';
  if (hasLeft && hasRight && spec.tokens.length === 1 && spec.hCount > 0) return sy > 0 ? 'up' : 'down';
  if (sx > 0.25 || (hasRight && !hasLeft && sx > 0)) return 'left';
  return 'right';
}

/**
 * Lay out a label. `bondDirs` are unit vectors from the atom to its neighbours.
 * Follows ChemDraw's automatic justification: the bonded atom sits on the atom
 * position, and the rest of the label runs away from the bonds (p. 46).
 */
export function layoutLabel(spec: LabelSpec, bondDirs: { x: number; y: number }[], size: number, measure: Measure, just: 'auto' | 'left' | 'right' = 'auto'): LabelLayout {
  const head = spec.tokens[0];
  const tail = spec.tokens.slice(1);
  const hTok: Token | null = spec.hCount > 0 ? { kind: 'el', text: 'H', count: spec.hCount, charge: '' } : null;
  const chargeText = spec.charge ? (Math.abs(spec.charge) > 1 ? String(Math.abs(spec.charge)) : '') + (spec.charge > 0 ? '+' : '−') : '';
  const dir = labelDir(spec, bondDirs, just);

  const runs: GlyphRun[] = [];
  const boxes: LabelLayout['boxes'] = [];
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
    if (chargeText) pushPieces([{ text: chargeText, sup: true }], x);
    if (hTok && dir !== 'right') {
      // stacked H above or below the atom (e.g. the NH of a ring)
      const w = pieceWidth({ text: 'H' }) + (hTok.count > 1 ? pieceWidth({ text: String(hTok.count), sub: true }) : 0);
      const yOff = dir === 'up' ? -size * 1.0 : size * 1.0;
      const start = runs.length;
      pushPieces(tokenPieces(hTok), -firstCharW / 2 + (firstCharW - w) / 2 + (hTok.count > 1 ? 0 : 0));
      for (let i = start; i < runs.length; i++) runs[i].dy += yOff;
      for (let i = start; i < boxes.length; i++) { boxes[i].y1 += yOff; boxes[i].y2 += yOff; }
    }
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
    if (chargeText) pushPieces([{ text: chargeText, sup: true }], x);
  }
  return { runs, boxes };
}

// ------------------------------------------------------------------ chemistry of labels

export interface MiniAtom { z: number; charge: number; aromatic: boolean; dummy: boolean; hCount?: number }
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

const nickCache = new Map<string, MiniGraph>();
function nickGraph(name: string): MiniGraph {
  let g = nickCache.get(name);
  if (!g) { g = parseSmiles(NICKNAMES[name]); nickCache.set(name, g); }
  return g;
}

/**
 * Atoms and bonds that a text label stands for, with index 0 bonded to the structure.
 * Whole-label abbreviations (CO2Me, NO2) are looked up first; otherwise tokens are joined
 * in a chain (OMe → O–CH3, NHBoc → N–Boc, CH2OH → C–O); "H" tokens become implicit H.
 */
export function labelGraph(label: string): MiniGraph | null {
  if (NICKNAMES[label]) return nickGraph(label);
  if (GENERIC.has(label)) return { atoms: [{ z: 0, charge: 0, aromatic: false, dummy: true }], bonds: [] };
  const toks = tokenize(label);
  if (toks.some((t) => t.kind === 'other')) return null;
  const g: MiniGraph = { atoms: [], bonds: [] };
  let backbone = -1;
  const append = (sub: MiniGraph) => {
    const off = g.atoms.length;
    g.atoms.push(...sub.atoms.map((a) => ({ ...a })));
    g.bonds.push(...sub.bonds.map((b) => ({ a: b.a + off, b: b.b + off, order: b.order })));
    if (backbone >= 0) g.bonds.push({ a: backbone, b: off, order: 1 });
    return off;
  };
  for (const t of toks) {
    if (t.kind === 'el' && t.text === 'H') continue; // implicit hydrogens
    const reps = Math.max(1, t.count);
    let last = backbone;
    const anchor = backbone;
    for (let k = 0; k < reps; k++) {
      let sub: MiniGraph;
      if (t.kind === 'nick') sub = nickGraph(t.text);
      else if (t.kind === 'generic') sub = { atoms: [{ z: 0, charge: 0, aromatic: false, dummy: true }], bonds: [] };
      else sub = { atoms: [{ z: elementNumber(t.text) ?? 0, charge: 0, aromatic: false, dummy: false }], bonds: [] };
      backbone = anchor;
      last = append(sub);
    }
    if (t.charge) {
      const n = Number(t.charge.replace(/[^0-9]/g, '') || '1');
      g.atoms[last].charge = /[-−]/.test(t.charge) ? -n : n;
    }
    backbone = last;
  }
  return g.atoms.length ? g : null;
}
