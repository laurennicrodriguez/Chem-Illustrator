// Chemistry warnings: atoms with too many bonds, labels that can't be read, impossible
// isotopes, atoms sitting on top of each other and lone bonds. They are shown as red boxes
// on screen (never printed, saved or copied) and never stop anything; each can be ignored.
//
// The checks are worked out per atom and kept, so after an edit only the changed atoms and
// their close neighbours are looked at again.

import { isMetalAtom, radicalElectrons, type Atom, type AtomWatch, type Bond, type Doc } from '../model';
import { SYMBOLS, elementNumber, maxValence, minValence, valenceOfBonds } from './elements';
import { bracketsUnbalanced, labelGraph, labelOverValent, tokenize } from './labels';

/** Atoms closer than this (a fraction of the bond length) look dropped on top of each other. */
export const TOO_CLOSE_ATOM = 0.2;
/** An atom closer than this to a bond it isn't part of looks as if it sits on the bond. */
export const TOO_CLOSE_BOND = 0.1;

const NAMES: Record<number, string> = { 1: 'hydrogen', 5: 'boron', 6: 'carbon', 7: 'nitrogen', 8: 'oxygen', 9: 'fluorine', 14: 'silicon', 15: 'phosphorus', 16: 'sulfur', 17: 'chlorine', 35: 'bromine', 53: 'iodine' };

function chargeText(charge: number): string {
  if (!charge) return '';
  return (Math.abs(charge) > 1 ? String(Math.abs(charge)) : '') + (charge > 0 ? '+' : '−');
}

const SUPER: Record<string, string> = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '−': '⁻' };

/** "⁺", "²⁻": a charge as it is written after a symbol. */
function supCharge(charge: number): string {
  return [...chargeText(charge)].map((c) => SUPER[c] ?? c).join('');
}

/** "uncharged O", "O⁺", "N²⁻": an element with its charge, for valence messages. */
function species(z: number, charge: number): string {
  const sym = SYMBOLS[z] ?? '?';
  return charge ? sym + supCharge(charge) : 'uncharged ' + sym;
}

/** B, C, N and O: where one unit of charge changes the valence in the familiar octet way. */
const OCTET = new Set([5, 6, 7, 8]);

/**
 * The valence an atom has with its charge, and, for B, C, N and O, when one unit of charge more
 * or less (but no more than ±1) would allow `bonds`, that charge: "uncharged O has a valence of
 * 2. O⁺ can have 3: add a + charge if that is meant." The valences are maxValence's.
 */
export function valenceAdvice(z: number, charge: number, bonds: number): string {
  let s = `${species(z, charge)} has a valence of ${maxValence(z, charge)}.`;
  if (!OCTET.has(z)) return s;
  for (const c of [charge + 1, charge - 1]) {
    const m = maxValence(z, c);
    if (Math.abs(c) > 1 || m === undefined || m < bonds) continue;
    const sym = SYMBOLS[z] ?? '?';
    s += c === 0
      ? ` Uncharged ${sym} can have ${m}: remove the charge if that is meant.`
      : ` ${species(z, c)} can have ${m}: add a ${c > charge ? '+' : '−'} charge if that is meant.`;
    break;
  }
  return s;
}

/** "this carbon", "this N+": how a warning names an atom. */
function atomName(z: number, charge: number): string {
  if (!charge && NAMES[z]) return `this ${NAMES[z]}`;
  return `this ${SYMBOLS[z] ?? '?'}${supCharge(charge)}`;
}

/** Problems with one atom on its own: too many bonds, an unreadable label, an impossible isotope. */
export function atomWarnings(doc: Doc, a: Atom): string[] {
  const out: string[] = [];
  const orders: number[] = [];
  // a dative bond leaves both atoms' valences as they were (H3N→BF3); a bond to a metal may be
  // a lone pair the atom gives it (PPh3, a bridging Cl, a pyridine N), so it may go past the valence
  let toMetal = 0;
  for (const bid of doc.adj.get(a.id) ?? []) {
    const b = doc.bonds.get(bid)!;
    if (b.display === 'dative') continue;
    orders.push(b.order);
    if (isMetalAtom(doc.atoms.get(b.a1 === a.id ? b.a2 : b.a1))) toMetal++;
  }
  if (a.attach || a.multi) return out;
  // metals: no valence check (how many ligands a metal holds varies too much)
  const metal = isMetalAtom(a);
  if (metal && !a.label) return a.isotope && !isotopeOk(a.z, a.isotope) ? [`There is no isotope ${a.isotope}${SYMBOLS[a.z] ?? ''}.`] : out;
  const z = a.label ? 6 : a.z;
  const bonds = valenceOfBonds(orders, z);
  if (a.label) {
    if (bracketsUnbalanced(a.label)) out.push(`The brackets in “${a.label}” don't pair up.`);
    else if (!labelGraph(a.label, bonds)) out.push(`“${a.label}” can't be read as chemistry, so it's left out of the formula and mass.`);
    else {
      // (the label's first atom may give the metal a lone pair: THF's O, DMSO's S)
      const over = metal ? [] : labelOverValent(a.label, bonds, a.charge).filter((o) => o.atom !== 0 || o.used - o.max > toMetal);
      if (over.length) {
        const o = over[0];
        const sym = SYMBOLS[o.z] ?? '?';
        const charge = maxValence(o.z, a.charge) === o.max ? a.charge : 0;
        out.push(`Too many bonds: the ${sym} in “${a.label}” has ${o.used}${o.h ? `, counting its ${o.h} H` : ''}, but ${valenceAdvice(o.z, charge, o.used)}`);
      } else {
        const few = tooFewBonds(a, orders);
        if (few) out.push(few);
      }
    }
  } else {
    const max = maxValence(a.z, a.charge);
    const rad = radicalElectrons(a);
    if (max !== undefined && bonds + rad > max + toMetal) {
      const who = atomName(a.z, a.charge);
      out.push(`Too many bonds: ${who} has ${bonds}${rad ? ` and ${rad === 1 ? 'an unpaired electron' : 'two unpaired electrons'}` : ''}, but ${valenceAdvice(a.z, a.charge, bonds + rad)}`);
    }
  }
  if (a.isotope && !isotopeOk(a.z, a.isotope)) out.push(`There is no isotope ${a.isotope}${SYMBOLS[a.z] ?? ''}.`);
  return out;
}

/**
 * A label that is one element with its hydrogens written out ("P", "NH", "B") fixes how many
 * hydrogens the atom has, so too few bonds is a problem too: the formula would not match what
 * is drawn. (Labels left to work out their own hydrogens never get this warning.)
 */
function tooFewBonds(a: Atom, orders: number[]): string | null {
  const label = a.label!, charge = a.charge;
  const toks = tokenize(label);
  if (!toks.length || toks[0].kind !== 'el' || toks[0].count > 1) return null;
  if (toks.slice(1).some((t) => t.kind !== 'el' || t.text !== 'H')) return null;
  const z = elementNumber(toks[0].text);
  if (z === undefined) return null;
  const h = toks.slice(1).reduce((s, t) => s + t.count, 0);
  const signed = toks.reduce((s, t) => s + (t.charge ? (/[-−]/.test(t.charge) ? -1 : 1) * Number(t.charge.replace(/[^0-9]/g, '') || '1') : 0), 0);
  const min = minValence(z, charge + signed);
  // aromatic bonds counted at most (as for pyridine N), so only a real shortfall is reported
  const used = valenceOfBonds(orders, 6) + h + radicalElectrons(a);
  if (min === undefined || used >= min) return null;
  return `Too few bonds: “${label}” shows ${h ? `${h} H` : 'no H'}, so it has ${used} bond${used === 1 ? '' : 's'}, but ${species(z, charge + signed)} has a valence of ${min}.`;
}

/**
 * A rough check that a mass number fits the element: at least as many nucleons as protons,
 * and not far beyond the heaviest known isotopes (about three times the atomic number).
 */
export function isotopeOk(z: number, mass: number): boolean {
  return Number.isInteger(mass) && mass >= z && mass <= 3 * z + 16;
}

/** A single bond on its own between two plain carbons, which reads as ethane. */
export function isLoneBond(doc: Doc, b: Bond): boolean {
  if (b.order !== 1 || b.display === 'dative') return false;
  const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
  if (!p || !q || p.label || q.label || p.z !== 6 || q.z !== 6 || p.charge || q.charge) return false;
  return doc.degree(p.id) === 1 && doc.degree(q.id) === 1;
}

const LONE_BOND = 'A single bond on its own reads as ethane. If it is meant as a line, draw it with the line tool.';
const ON_ATOM = 'This atom is almost on top of another one, and the two are not joined.';
const ON_BOND = 'This atom sits on a bond it is not part of.';

function segDist(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): { d: number; t: number } {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  return { d: Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy), t };
}

/** All warnings in a drawing, kept up to date as it changes. */
export class StructureChecks {
  /** Warnings by atom id and by bond id (only entries with at least one warning). */
  readonly atoms = new Map<number, string[]>();
  readonly bonds = new Map<number, string[]>();
  /** Goes up whenever the set of warnings changes. */
  version = 0;
  private watch: AtomWatch;
  /** Atoms linked by closeness (either way round), so moving one re-checks the other. */
  private links = new Map<number, Set<number>>();

  constructor(private doc: Doc) {
    this.watch = doc.watchAtoms();
  }

  /**
   * Bring the warnings up to date with the drawing. Returns the atoms whose warnings changed
   * (including the ends of bonds whose warnings changed), or null when everything was redone.
   */
  update(): number[] | null {
    const w = this.watch;
    const doc = this.doc;
    if (w.all) {
      w.all = false;
      w.ids.clear();
      this.atoms.clear();
      this.bonds.clear();
      this.links.clear();
      for (const a of doc.atoms.values()) this.checkAtom(a, null);
      for (const b of doc.bonds.values()) if (isLoneBond(doc, b)) this.bonds.set(b.id, [LONE_BOND]);
      this.version++;
      return null;
    }
    if (!w.ids.size) return [];
    const queue = [...w.ids];
    w.ids.clear();
    const todo = new Set(queue);
    const add = (o: number) => { if (!todo.has(o)) { todo.add(o); queue.push(o); } };
    const dirty = queue.length;
    for (let k = 0; k < dirty; k++) {
      const id = queue[k];
      // atoms that were close to a changed atom need looking at again
      for (const o of this.links.get(id) ?? []) {
        this.links.get(o)?.delete(id);
        add(o);
      }
      this.links.delete(id);
      // and so do atoms that a changed atom's bonds now run over
      const a = doc.atoms.get(id);
      if (!a) continue;
      const r = TOO_CLOSE_BOND * doc.style.bondLength * (a.s ?? 1);
      for (const n of doc.neighbors(id)) {
        const mid = { x: (a.x + n.x) / 2, y: (a.y + n.y) / 2 };
        for (const o of doc.atomsNear(mid, Math.hypot(a.x - n.x, a.y - n.y) / 2 + r)) add(o.id);
      }
    }
    const changed: number[] = [];
    for (let k = 0; k < queue.length; k++) {
      const id = queue[k];
      const a = doc.atoms.get(id);
      const before = this.atoms.get(id);
      if (!a) {
        if (before) { this.atoms.delete(id); changed.push(id); }
        continue;
      }
      this.checkAtom(a, add);
      if (!sameList(before, this.atoms.get(id))) changed.push(id);
      for (const bid of doc.adj.get(id) ?? []) {
        const b = doc.bonds.get(bid)!;
        const had = this.bonds.has(bid);
        const lone = isLoneBond(doc, b);
        if (lone && !had) this.bonds.set(bid, [LONE_BOND]);
        else if (!lone && had) this.bonds.delete(bid);
        if (lone !== had) changed.push(b.a1, b.a2);
      }
    }
    // bonds that no longer exist
    for (const bid of this.bonds.keys()) if (!doc.bonds.has(bid)) this.bonds.delete(bid);
    if (changed.length) this.version++;
    return changed;
  }

  /** Work out one atom's warnings; `found` is told about close atoms that should be re-checked too. */
  private checkAtom(a: Atom, found: ((id: number) => void) | null): void {
    const doc = this.doc;
    // a ring's middle, where a metal is bonded (η⁵), is not an atom: nothing to check
    if (a.multi) { this.atoms.delete(a.id); return; }
    const list = atomWarnings(doc, a);
    const L = doc.style.bondLength * (a.s ?? 1);
    // another atom almost on top of this one
    let onAtom = false;
    for (const o of doc.atomsNear(a, TOO_CLOSE_ATOM * L)) {
      if (o.id === a.id || o.multi) continue;
      onAtom = true;
      this.link(a.id, o.id);
      found?.(o.id);
    }
    if (onAtom) list.push(ON_ATOM);
    // a bond running through this atom
    const r = TOO_CLOSE_BOND * L;
    const reach = Math.min(doc.maxBondLength / 2, 2 * L) + r;
    const seen = new Set<number>();
    let onBond = false;
    for (const n of doc.atomsNear(a, reach)) {
      for (const bid of doc.adj.get(n.id) ?? []) {
        if (seen.has(bid)) continue;
        seen.add(bid);
        const b = doc.bonds.get(bid)!;
        if (b.a1 === a.id || b.a2 === a.id) continue;
        const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
        // a bond to a ring's middle runs over the ring as it is meant to
        if (p.multi || q.multi) continue;
        const { d, t } = segDist(a, p, q);
        if (t <= 0 || t >= 1 || d >= r) continue;
        onBond = true;
        this.link(a.id, p.id);
        this.link(a.id, q.id);
      }
    }
    if (onBond && !onAtom) list.push(ON_BOND);
    if (list.length) this.atoms.set(a.id, list);
    else this.atoms.delete(a.id);
  }

  private link(x: number, y: number): void {
    let s = this.links.get(x);
    if (!s) this.links.set(x, (s = new Set()));
    s.add(y);
    let t = this.links.get(y);
    if (!t) this.links.set(y, (t = new Set()));
    t.add(x);
  }

  /** Warnings shown for an atom (none if the person chose to ignore them). */
  forAtom(a: Atom): string[] | undefined {
    return a.ignoreWarnings ? undefined : this.atoms.get(a.id);
  }

  forBond(b: Bond): string[] | undefined {
    return b.ignoreWarnings ? undefined : this.bonds.get(b.id);
  }

  /** Every warning not ignored, in drawing order (top to bottom, then left to right). */
  list(): { kind: 'atom' | 'bond'; id: number; text: string[]; x: number; y: number }[] {
    const doc = this.doc;
    const out: { kind: 'atom' | 'bond'; id: number; text: string[]; x: number; y: number }[] = [];
    for (const [id, text] of this.atoms) {
      const a = doc.atoms.get(id);
      if (a && !a.ignoreWarnings) out.push({ kind: 'atom', id, text, x: a.x, y: a.y });
    }
    for (const [id, text] of this.bonds) {
      const b = doc.bonds.get(id);
      if (!b || b.ignoreWarnings) continue;
      const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      out.push({ kind: 'bond', id, text, x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });
    }
    const row = doc.style.bondLength * 3;
    return out.sort((u, v) => Math.floor(u.y / row) - Math.floor(v.y / row) || u.x - v.x);
  }

  /** How many warnings the person has chosen to ignore. */
  ignoredCount(): number {
    let n = 0;
    for (const id of this.atoms.keys()) if (this.doc.atoms.get(id)?.ignoreWarnings) n++;
    for (const id of this.bonds.keys()) if (this.doc.bonds.get(id)?.ignoreWarnings) n++;
    return n;
  }
}

function sameList(x: string[] | undefined, y: string[] | undefined): boolean {
  if (!x || !y) return x === y;
  return x.length === y.length && x.every((s, i) => s === y[i]);
}
