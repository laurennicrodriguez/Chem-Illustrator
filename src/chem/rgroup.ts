// R-group tables: a core structure with R groups (R1, R2, X…) and a table of what each R group
// is in each compound. Each row's compound is made by putting its groups in place of the R
// labels, so its formula and mass can be worked out.

import { Doc } from '../model';
import { isGenericLabel } from './labels';
import { toMolfile, type MolExport } from './molfile';
import type { TextRun } from '../model';

/** The R groups of a structure, in a sensible order (R1, R2… then R, X…), with their atoms. */
export function rGroupsOf(doc: Doc, atomIds: Iterable<number>): { label: string; atoms: number[] }[] {
  const by = new Map<string, number[]>();
  for (const id of atomIds) {
    const a = doc.atoms.get(id);
    if (!a?.label || !isGenericLabel(a.label)) continue;
    (by.get(a.label) ?? by.set(a.label, []).get(a.label)!).push(id);
  }
  const key = (l: string) => { const m = /^([A-Za-z]+)(\d*)('*)$/.exec(l); return m ? [m[1] === 'R' ? 0 : 1, m[1], Number(m[2] || 0), m[3].length] as const : [2, l, 0, 0] as const; };
  return [...by.entries()].map(([label, atoms]) => ({ label, atoms })).sort((p, q) => {
    const a = key(p.label), b = key(q.label);
    return a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0) || a[2] - b[2] || a[3] - b[3];
  });
}

/**
 * The compound with these groups in place of the R labels, as a molfile. A group is typed the way
 * an atom label is (Me, Ph, OMe, CO2Et, Cl, H…); an empty one leaves the R label as it is.
 */
export function substituted(doc: Doc, atomIds: Iterable<number>, values: Record<string, string>): MolExport {
  const ids = new Set([...atomIds].filter((id) => doc.atoms.has(id)));
  const tmp = new Doc();
  tmp.style = doc.style;
  const map = new Map<number, number>();
  tmp.edit('r', () => {
    for (const id of ids) {
      const a = doc.atoms.get(id)!;
      const v = a.label ? values[a.label]?.trim() : undefined;
      const extra = { charge: a.charge, isotope: a.isotope, radical: a.radical };
      let n;
      if (v === 'H') n = tmp.addAtom(a.x, a.y, 1, extra);
      else if (v) n = tmp.addAtom(a.x, a.y, 6, { ...extra, label: v });
      else n = tmp.addAtom(a.x, a.y, a.z, { ...extra, label: a.label, group: a.group });
      map.set(id, n.id);
    }
    const seen = new Set<number>();
    for (const id of ids) for (const bid of doc.adj.get(id) ?? []) {
      if (seen.has(bid)) continue;
      seen.add(bid);
      const b = doc.bonds.get(bid)!;
      if (!ids.has(b.a1) || !ids.has(b.a2)) continue;
      tmp.addBond(map.get(b.a1)!, map.get(b.a2)!, b.order, b.display);
    }
  });
  return toMolfile(tmp, tmp.atoms.keys());
}

/** Compound numbers for the rows: 2a, 2b… after a number, else 1, 2, 3. */
export function rowNumbers(n: number, prefix: string): string[] {
  const p = prefix.trim();
  const letter = (i: number): string => (i < 26 ? String.fromCharCode(97 + i) : letter(Math.floor(i / 26) - 1) + String.fromCharCode(97 + (i % 26)));
  return Array.from({ length: n }, (_, i) => (p ? p + letter(i) : String(i + 1)));
}

/**
 * The rows typed in the R-Group Table window: one compound per line, its groups in the order of
 * the R labels, split by commas or tabs (so cells pasted from Excel work). A first line that
 * repeats the R labels is skipped. A group starting with "#" sets that row's compound number.
 */
export function parseRows(text: string, labels: string[]): { number?: string; values: string[] }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l);
  const split = (l: string) => l.split(l.includes('\t') ? '\t' : ',').map((v) => v.trim());
  const out: { number?: string; values: string[] }[] = [];
  lines.forEach((l, i) => {
    let cells = split(l);
    if (i === 0 && cells.length === labels.length && cells.every((c, k) => c === labels[k])) return;
    let number: string | undefined;
    if (cells[0]?.startsWith('#')) { number = cells[0].slice(1).trim(); cells = cells.slice(1); }
    out.push({ number, values: labels.map((_, k) => cells[k] ?? '') });
  });
  return out;
}

export interface RGroupColumns {
  formula: boolean;
  mw: boolean;
  exact: boolean;
  /** Headings of extra empty columns to fill in by hand (yield, ee…). */
  extra: string[];
}

/** One compound's worked-out values, or null where they couldn't be worked out. */
export type RowMass = { formula: string; mw: number; exact: number } | null;

/**
 * The table's cells: a heading row, then a row per compound with its number (bold), its groups,
 * the worked-out columns and empty extra columns. Everything is ordinary table text afterwards,
 * so any of it can be typed over.
 */
export function rGroupCells(labels: string[], rows: { number: string; values: string[] }[], masses: RowMass[], cols: RGroupColumns): { runs: TextRun[] }[][] {
  const cell = (...runs: TextRun[]) => ({ runs: runs.filter((r) => r.text) });
  const head = [cell({ text: 'Compound' }), ...labels.map((l) => cell({ text: l, formula: true }))];
  if (cols.formula) head.push(cell({ text: 'Formula' }));
  if (cols.mw) head.push(cell({ text: 'MW' }));
  if (cols.exact) head.push(cell({ text: 'Exact mass' }));
  for (const e of cols.extra) head.push(cell({ text: e }));
  const body = rows.map((r, i) => {
    const m = masses[i];
    const out = [cell({ text: r.number, bold: true }), ...r.values.map((v) => cell({ text: v, formula: true }))];
    if (cols.formula) out.push(m ? cell({ text: m.formula, formula: true }) : cell({ text: '?' }));
    if (cols.mw) out.push(cell({ text: m ? m.mw.toFixed(2) : '?' }));
    if (cols.exact) out.push(cell({ text: m ? m.exact.toFixed(4) : '?' }));
    for (const _ of cols.extra) out.push(cell());
    return out;
  });
  return [head, ...body];
}
