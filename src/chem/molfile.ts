// Turning drawn structures into MDL molfiles for the chemistry engine (RDKit), and reading
// molfiles back (for pasted SMILES). Abbreviation labels are expanded into real atoms so
// formula, mass and stereo come out right; "R"-type labels become dummy atoms.

import { Doc, Atom } from '../model';
import { SYMBOLS, elementNumber, valenceOfBonds } from './elements';
import { labelGraph, MiniGraph } from './labels';

export interface MolExport {
  molblock: string;
  /** Molfile atom index (0-based) → drawn atom id, or −1 for atoms expanded from a label. */
  map: number[];
  /** Labels that could not be interpreted (shown as warnings). */
  unknownLabels: string[];
}

interface MAtom { sym: string; x: number; y: number; charge: number; iso: number; rad?: number }
interface MBond { a: number; b: number; order: number; stereo: number }

const f = (v: number, w: number, d = 4) => v.toFixed(d).padStart(w);
const i3 = (v: number) => String(v).padStart(3);

export function toMolfile(doc: Doc, atomIds: Iterable<number>, name = ''): MolExport {
  const ids = [...atomIds].filter((id) => doc.atoms.has(id));
  const inSet = new Set(ids);
  const L = doc.style.bondLength || 14.4;
  const atoms: MAtom[] = [];
  const bonds: MBond[] = [];
  const map: number[] = [];
  const attach = new Map<number, number>();
  const unknown: string[] = [];

  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    const x = a.x / L, y = -a.y / L;
    let g: MiniGraph | null = null;
    if (a.label) {
      g = labelGraph(a.label, valenceOfBonds((doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!.order)));
      if (!g) unknown.push(a.label);
    }
    if (!g || g.atoms.length === 0) {
      attach.set(id, atoms.length);
      const rad = a.radical === 'singlet' ? 1 : a.radical === 'doublet' ? 2 : a.radical === 'triplet' ? 3 : 0;
      atoms.push({ sym: a.label && !g ? '*' : SYMBOLS[a.z] || '*', x, y, charge: a.charge, iso: a.isotope, rad });
      map.push(id);
      continue;
    }
    const base = atoms.length;
    attach.set(id, base);
    g.atoms.forEach((ga, k) => {
      // spread expanded atoms a little so no two share a position
      const ang = (k * 2.4);
      const r = k === 0 ? 0 : 0.35 + 0.05 * k;
      atoms.push({ sym: ga.dummy ? '*' : SYMBOLS[ga.z] || '*', x: x + r * Math.cos(ang), y: y + r * Math.sin(ang), charge: ga.charge + (k === 0 ? a.charge : 0), iso: ga.iso ?? 0 });
      map.push(k === 0 ? id : -1);
    });
    for (const gb of g.bonds) bonds.push({ a: base + gb.a, b: base + gb.b, order: gb.order === 1.5 ? 4 : gb.order, stereo: 0 });
  }
  const seen = new Set<number>();
  for (const id of ids) {
    for (const bid of doc.adj.get(id) ?? []) {
      if (seen.has(bid)) continue;
      seen.add(bid);
      const b = doc.bonds.get(bid)!;
      if (!inSet.has(b.a1) || !inSet.has(b.a2)) continue;
      const order = b.order === 1.5 ? 4 : b.order === 2 ? 2 : b.order === 3 ? 3 : 1;
      const stereo = order !== 1 ? 0 : b.display === 'wedge' ? 1 : b.display === 'hashWedge' ? 6 : b.display === 'wavy' ? 4 : 0;
      bonds.push({ a: attach.get(b.a1)!, b: attach.get(b.a2)!, order, stereo });
    }
  }

  const lines: string[] = [name.slice(0, 80), '  ChemIllus         2D', ''];
  lines.push(`${i3(atoms.length)}${i3(bonds.length)}  0  0  0  0  0  0  0  0999 V2000`);
  for (const a of atoms) {
    lines.push(`${f(a.x, 10)}${f(a.y, 10)}${f(0, 10)} ${a.sym.padEnd(3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  }
  for (const b of bonds) lines.push(`${i3(b.a + 1)}${i3(b.b + 1)}${i3(b.order)}${i3(b.stereo)}`);
  const chg = atoms.map((a, i) => [i, a.charge] as const).filter(([, c]) => c !== 0);
  for (let k = 0; k < chg.length; k += 8) {
    const part = chg.slice(k, k + 8);
    lines.push(`M  CHG${i3(part.length)}` + part.map(([i, c]) => ` ${i3(i + 1)} ${i3(c)}`).join(''));
  }
  const iso = atoms.map((a, i) => [i, a.iso] as const).filter(([, m]) => m > 0);
  for (let k = 0; k < iso.length; k += 8) {
    const part = iso.slice(k, k + 8);
    lines.push(`M  ISO${i3(part.length)}` + part.map(([i, m]) => ` ${i3(i + 1)} ${i3(m)}`).join(''));
  }
  const rad = atoms.map((a, i) => [i, a.rad ?? 0] as const).filter(([, r]) => r > 0);
  for (let k = 0; k < rad.length; k += 8) {
    const part = rad.slice(k, k + 8);
    lines.push(`M  RAD${i3(part.length)}` + part.map(([i, r]) => ` ${i3(i + 1)} ${i3(r)}`).join(''));
  }
  lines.push('M  END');
  return { molblock: lines.join('\n') + '\n', map, unknownLabels: unknown };
}

/** Add the atoms and bonds of a molfile to the document, centred at (cx, cy). Returns new atom ids. */
export function addMolfile(doc: Doc, molblock: string, cx: number, cy: number): number[] {
  const lines = molblock.split(/\r?\n/);
  const counts = lines[3] ?? '';
  const na = parseInt(counts.slice(0, 3), 10), nb = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(na) || counts.includes('V3000')) throw new Error('Only V2000 molfiles are supported so far.');
  const raw: { x: number; y: number; sym: string; chg: number }[] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    raw.push({ x: parseFloat(l.slice(0, 10)), y: parseFloat(l.slice(10, 20)), sym: l.slice(31, 34).trim(), chg: 0 });
  }
  // average bond length, to scale to the document's bond length
  let sum = 0;
  const bl: [number, number, number, number][] = [];
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    const a = parseInt(l.slice(0, 3), 10) - 1, b = parseInt(l.slice(3, 6), 10) - 1;
    bl.push([a, b, parseInt(l.slice(6, 9), 10), parseInt(l.slice(9, 12), 10) || 0]);
    sum += Math.hypot(raw[a].x - raw[b].x, raw[a].y - raw[b].y);
  }
  for (let i = 4 + na + nb; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('M  CHG')) {
      const n = parseInt(l.slice(6, 9), 10);
      for (let k = 0; k < n; k++) {
        const idx = parseInt(l.slice(10 + k * 8, 13 + k * 8), 10) - 1;
        const c = parseInt(l.slice(14 + k * 8, 17 + k * 8), 10);
        if (raw[idx]) raw[idx].chg = c;
      }
    }
  }
  const k = nb ? doc.style.bondLength / (sum / nb) : doc.style.bondLength;
  let mx = 0, my = 0;
  for (const r of raw) { mx += r.x; my += r.y; }
  mx /= Math.max(1, na); my /= Math.max(1, na);
  const ids: number[] = [];
  const atoms: Atom[] = [];
  for (const r of raw) {
    const z = elementNumber(r.sym);
    const a = doc.addAtom(cx + (r.x - mx) * k, cy - (r.y - my) * k, z ?? 6, { charge: r.chg, label: z === undefined ? r.sym : null });
    ids.push(a.id);
    atoms.push(a);
  }
  for (const [a, b, order, stereo] of bl) {
    const display = stereo === 1 ? 'wedge' : stereo === 6 ? 'hashWedge' : stereo === 4 ? 'wavy' : 'solid';
    doc.addBond(atoms[a].id, atoms[b].id, order === 4 ? 1.5 : order, display);
  }
  return ids;
}
