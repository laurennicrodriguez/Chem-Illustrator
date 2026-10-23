// Chemistry > Expand Label: an abbreviation (OMe, Boc, CO2Et, PPh3 on a metal) drawn out as
// the atoms and bonds it stands for, joined where the label was. Ligands on a metal use their
// template (so a chelate's donors both bond to the metal); anything else is laid out by the
// chemistry engine from SMILES and turned to lie along the bond the label hung from.

import type { Doc, Atom, Bond } from '../model';
import { isMetalAtom } from '../model';
import { Vec, dist, angleOf } from '../geom';
import { SYMBOLS, elementNumber } from './elements';
import { NICKNAMES, labelGraph, type MiniGraph } from './labels';
import { templateById, atomPlacements, crowdingOf, placeTemplate } from './templates';

/** Ligand abbreviations with a template, by the label written on the drawing. */
const LIGAND_TEMPLATE: Record<string, string> = {
  PPh3: 'pph3', PCy3: 'pcy3', PtBu3: 'ptbu3', 'P(t-Bu)3': 'ptbu3', XPhos: 'xphos', SPhos: 'sphos',
  dppe: 'dppe', dppp: 'dppp', dppf: 'dppf', BINAP: 'binap', Xantphos: 'xantphos', IMes: 'imes', IPr: 'ipr',
  CO: 'co', MeCN: 'mecn', NCMe: 'mecn', py: 'py', bpy: 'bipy', bipy: 'bipy', phen: 'phen', TMEDA: 'tmeda', tmeda: 'tmeda',
  en: 'en', acac: 'acac', Cp: 'cp', 'Cp*': 'cpstar', C6H6: 'benzene', COD: 'cod', cod: 'cod',
};

/** The metal a label hangs from, when its only bond is to one. */
function metalOf(doc: Doc, a: Atom): Atom | null {
  const bonds = doc.adj.get(a.id) ?? [];
  if (bonds.length !== 1) return null;
  const b = doc.bonds.get(bonds[0])!;
  const m = doc.atoms.get(b.a1 === a.id ? b.a2 : b.a1);
  return m && isMetalAtom(m) ? m : null;
}

/** The template a ligand label on a metal expands to, if there is one. */
export function ligandTemplateFor(doc: Doc, a: Atom): string | null {
  return a.label && metalOf(doc, a) ? LIGAND_TEMPLATE[a.label] ?? null : null;
}

/** SMILES (the first atom where the label joins) for what a label stands for, or null. */
export function labelSmiles(a: Atom, ext: number): string | null {
  if (!a.label) return null;
  if (a.group) return a.group;
  if (NICKNAMES[a.label]) return NICKNAMES[a.label];
  const g = labelGraph(a.label, ext);
  return g && g.atoms.length && !g.atoms.some((x) => x.dummy) ? miniSmiles(g) : null;
}

/** SMILES for a label's atoms, from its first atom. */
export function miniSmiles(g: MiniGraph): string {
  const nbrs = g.atoms.map(() => [] as { to: number; order: number }[]);
  for (const b of g.bonds) { nbrs[b.a].push({ to: b.b, order: b.order }); nbrs[b.b].push({ to: b.a, order: b.order }); }
  const seen = new Array(g.atoms.length).fill(false);
  const ringAt = new Map<number, string[]>();
  let ring = 0;
  const bondSym = (o: number, i: number, j: number) => (o === 2 ? '=' : o === 3 ? '#' : o === 1 && g.atoms[i].aromatic && g.atoms[j].aromatic ? '-' : '');
  const atomSym = (i: number) => {
    const x = g.atoms[i];
    const sym = SYMBOLS[x.z] ?? '*';
    const s = x.aromatic ? sym.toLowerCase() : sym;
    if (x.hCount === undefined && !x.charge && !x.iso && /^(B|C|N|O|P|S|F|Cl|Br|I|b|c|n|o|p|s)$/.test(s)) return s;
    const h = x.hCount ? (x.hCount > 1 ? `H${x.hCount}` : 'H') : '';
    const c = x.charge ? (x.charge > 0 ? '+' : '-') + (Math.abs(x.charge) > 1 ? Math.abs(x.charge) : '') : '';
    return `[${x.iso || ''}${s}${h}${c}]`;
  };
  // ring closures first: bonds back to atoms already reached
  const order: number[] = [];
  const parent = new Array(g.atoms.length).fill(-1);
  const visit = (i: number) => {
    seen[i] = true;
    order.push(i);
    for (const { to } of nbrs[i]) if (!seen[to]) { parent[to] = i; visit(to); }
  };
  visit(0);
  const done = new Set<string>();
  for (const b of g.bonds) {
    if (parent[b.b] === b.a || parent[b.a] === b.b) continue;
    const key = `${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`;
    if (done.has(key)) continue;
    done.add(key);
    const n = ++ring;
    const d = n > 9 ? `%${n}` : String(n);
    const [first, second] = order.indexOf(b.a) < order.indexOf(b.b) ? [b.a, b.b] : [b.b, b.a];
    (ringAt.get(first) ?? ringAt.set(first, []).get(first)!).push(bondSym(b.order, b.a, b.b) + d);
    (ringAt.get(second) ?? ringAt.set(second, []).get(second)!).push(d);
  }
  const write = (i: number): string => {
    let s = atomSym(i) + (ringAt.get(i) ?? []).join('');
    const kids = nbrs[i].filter(({ to }) => parent[to] === i);
    kids.forEach(({ to, order: o }, k) => {
      const part = bondSym(o, i, to) + write(to);
      s += k < kids.length - 1 ? `(${part})` : part;
    });
    return s;
  };
  return write(0);
}

/**
 * Put a ligand's template on the metal its label hangs from, in place of the label. Returns
 * the new atoms, or null when there is no template. Call inside an edit.
 */
export function expandLigand(doc: Doc, labelId: number): number[] | null {
  const a = doc.atoms.get(labelId);
  const id = a && ligandTemplateFor(doc, a);
  const t = id ? templateById(id) : undefined;
  const m = a && metalOf(doc, a);
  if (!a || !t || !m) return null;
  const d = Math.max(1e-9, dist(a, m));
  const dir = { x: (a.x - m.x) / d, y: (a.y - m.y) / d };
  doc.removeAtom(a.id);
  const ignore = new Set([m.id]);
  const pls = atomPlacements(t, m, dir, doc.style.bondLength * (m.s ?? 1), false)
    .map((pl) => ({ pl, c: crowdingOf(doc, t, pl, ignore) })).sort((p, q) => p.c - q.c);
  const at = { x: a.x, y: a.y };
  const ids = placeTemplate(doc, t, pls[0].pl, { existing: new Map([[t.attach, m.id]]), scale: m.s, noMerge: true });
  // one donor (PPh3, CO, py): it goes where the label was, so the metal's bonds keep their length
  const donors = t.bonds.filter(([i, j]) => i === t.attach || j === t.attach).map(([i, j]) => (i === t.attach ? j : i));
  if (donors.length === 1 && !t.hapto?.length) {
    const d = doc.atoms.get(ids[donors[0]])!;
    const dx = at.x - d.x, dy = at.y - d.y;
    if (Math.hypot(dx, dy) > 0.5) doc.moveAtoms(ids.filter((id) => id !== m.id), dx, dy);
  }
  return ids;
}

interface RawMol { atoms: { x: number; y: number; sym: string; chg: number }[]; bonds: [number, number, number][] }

function readMolblock(mb: string): RawMol {
  const lines = mb.split(/\r?\n/);
  const na = parseInt(lines[3].slice(0, 3), 10), nb = parseInt(lines[3].slice(3, 6), 10);
  const atoms: RawMol['atoms'] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    atoms.push({ x: parseFloat(l.slice(0, 10)), y: -parseFloat(l.slice(10, 20)), sym: l.slice(31, 34).trim(), chg: 0 });
  }
  const bonds: RawMol['bonds'] = [];
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    bonds.push([parseInt(l.slice(0, 3), 10) - 1, parseInt(l.slice(3, 6), 10) - 1, parseInt(l.slice(6, 9), 10)]);
  }
  for (const l of lines) {
    if (!l.startsWith('M  CHG')) continue;
    const n = parseInt(l.slice(6, 9), 10);
    for (let k = 0; k < n; k++) {
      const at = atoms[parseInt(l.slice(10 + k * 8, 13 + k * 8), 10) - 1];
      if (at) at.chg = parseInt(l.slice(14 + k * 8, 17 + k * 8), 10);
    }
  }
  return { atoms, bonds };
}

const isDummy = (sym: string) => sym === '*' || sym === 'R' || sym === 'R#' || sym === 'A';

/**
 * Replace a label by the structure in a molfile (laid out from "*" + its SMILES, the * standing
 * for the atom the label hangs from): the * goes on that atom, the label's first atom where
 * the label was, the rest turned whichever way is least crowded. Call inside an edit.
 */
export function expandWithMolblock(doc: Doc, labelId: number, molblock: string): number[] {
  const a = doc.atoms.get(labelId)!;
  const raw = readMolblock(molblock);
  const L = doc.style.bondLength * (a.s ?? 1);
  const bondIds = doc.adj.get(a.id) ?? [];
  const old: Bond | undefined = bondIds.length === 1 ? doc.bonds.get(bondIds[0]) : undefined;
  const nb = old ? doc.atoms.get(old.a1 === a.id ? old.a2 : old.a1)! : null;
  const dummy = raw.atoms.findIndex((x) => isDummy(x.sym));
  const first = dummy >= 0 ? raw.bonds.find((b) => b[0] === dummy || b[1] === dummy) : undefined;
  const f = first ? (first[0] === dummy ? first[1] : first[0]) : 0;
  let sum = 0, n = 0;
  for (const [i, j] of raw.bonds) if (i !== dummy && j !== dummy) { sum += Math.hypot(raw.atoms[i].x - raw.atoms[j].x, raw.atoms[i].y - raw.atoms[j].y); n++; }
  const k = n ? L / (sum / n) : L;
  const origin = raw.atoms[f];
  // turned so the * → first atom bond lies along the drawn bond; either way over
  const angle = nb && dummy >= 0 ? angleOf({ x: a.x - nb.x, y: a.y - nb.y }) - angleOf({ x: origin.x - raw.atoms[dummy].x, y: origin.y - raw.atoms[dummy].y }) : 0;
  const placeAt = (mirror: boolean) => raw.atoms.map((p): Vec => {
    let x = p.x - origin.x, y = p.y - origin.y;
    if (mirror && dummy >= 0) {
      // mirrored across the line through the * and the first atom
      const ax = raw.atoms[dummy].x - origin.x, ay = raw.atoms[dummy].y - origin.y, al = Math.hypot(ax, ay) || 1;
      const ux = ax / al, uy = ay / al, dp = x * ux + y * uy;
      x = 2 * dp * ux - x; y = 2 * dp * uy - y;
    }
    const c = Math.cos(angle), s = Math.sin(angle);
    return { x: a.x + k * (x * c - y * s), y: a.y + k * (x * s + y * c) };
  });
  const crowd = (pts: Vec[]) => {
    let c = 0;
    pts.forEach((p, i) => {
      if (i === dummy || i === f) return;
      for (const o of doc.atomsNear(p, L * 1.2)) if (o.id !== a.id && o.id !== nb?.id) c += (L * 1.2 - dist(o, p)) / L;
    });
    return c;
  };
  const opts = [placeAt(false), placeAt(true)];
  const pts = crowd(opts[1]) < crowd(opts[0]) - 1e-6 ? opts[1] : opts[0];
  const extra = a.s && a.s !== 1 ? { s: a.s } : {};
  const ids: number[] = [];
  raw.atoms.forEach((p, i) => {
    if (i === dummy) { ids.push(-1); return; }
    const z = elementNumber(p.sym);
    ids.push(doc.addAtom(pts[i].x, pts[i].y, z ?? 6, { ...extra, charge: p.chg, label: z === undefined ? p.sym : null, ...(a.color ? { color: a.color } : {}) }).id);
  });
  for (const [i, j, o] of raw.bonds) {
    if (i === dummy || j === dummy) continue;
    doc.addBond(ids[i], ids[j], o === 4 ? 1.5 : o, 'solid', extra);
  }
  if (old && nb) {
    // the bond the label hung from now goes to its first atom, drawn as it was
    const { id: _id, a1, a2, ...rest } = old;
    void _id;
    doc.removeAtom(a.id);
    doc.addBond(a1 === a.id ? ids[f] : a1, a2 === a.id ? ids[f] : a2, rest.order, rest.display, rest);
  } else {
    doc.removeAtom(a.id);
  }
  return ids.filter((id) => id >= 0);
}
