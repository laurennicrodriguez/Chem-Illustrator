// Turning drawn structures into MDL molfiles for the chemistry engine (RDKit), and reading
// molfiles back (for pasted SMILES). Abbreviation labels are expanded into real atoms so
// formula, mass and stereo come out right; "R"-type labels become dummy atoms.

import { Doc, Atom, isMetalAtom, radicalElectrons } from '../model';
import { metalCarbonyl } from './hapto';
import { SYMBOLS, elementNumber, valenceOfBonds } from './elements';
import { labelDonates, labelGraph, MiniGraph } from './labels';
import { stereoAnchor, stereoSense } from './stereo';

export interface MolExport {
  molblock: string;
  /** Molfile atom index (0-based) → drawn atom id, or −1 for atoms expanded from a label. */
  map: number[];
  /** Labels that could not be interpreted (shown as warnings). */
  unknownLabels: string[];
  /** Molfile atoms that belong to multi-atom labels (positions made up, so no stereo label for them). */
  inLabel: number[];
  /**
   * Molfile atoms that stand for undefined groups (R, Ar, labels that can't be read), each with
   * the label it comes from: groups with the same label are taken to be the same group.
   */
  generic: [number, string][];
}

export interface MolfileOptions {
  /**
   * For working out R/S and E/Z: R groups, attachment points and labels that can't be read
   * become a very heavy stand-in atom (see stereoTags for how it is ranked), and
   * positions are measured from the first atom so a structure that only moved gives the same
   * molfile.
   */
  stereo?: boolean;
}

/** Stands in for R groups when working out R/S: oganesson, heavier than any atom in a real drawing. */
const GENERIC_STAND_IN = 'Og';

interface MAtom { sym: string; x: number; y: number; charge: number; iso: number; rad?: number }
interface MBond { a: number; b: number; order: number; stereo: number }

const f = (v: number, w: number, d = 4) => v.toFixed(d).padStart(w);
const i3 = (v: number) => String(v).padStart(3);

export function toMolfile(doc: Doc, atomIds: Iterable<number>, name = '', opts: MolfileOptions = {}): MolExport {
  // a ring's middle, where a metal is bonded (η⁵), is not an atom: it and its bonds are left out
  const ids = [...atomIds].filter((id) => doc.atoms.has(id) && !doc.atoms.get(id)!.multi);
  const inSet = new Set(ids);
  const L = doc.style.bondLength || 14.4;
  const atoms: MAtom[] = [];
  const bonds: MBond[] = [];
  const map: number[] = [];
  const attach = new Map<number, number>();
  const unknown: string[] = [];
  const inLabel: number[] = [];
  const genericAt: [number, string][] = [];
  const first = opts.stereo && ids.length ? doc.atoms.get(ids[0])! : { x: 0, y: 0 };
  const generic = opts.stereo ? GENERIC_STAND_IN : '*';

  // Bonds to metals that are a lone pair or π-bond given to the metal (PPh3, a pyridine, the
  // second bond of a bridging Cl) go to the engine as dative bonds, which take no hydrogen off
  // the atom giving them; the rest (a methyl, a chloride) are ordinary bonds.
  const dative = new Set<number>();
  const metalBonds = (id: number) => (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!)
    .filter((b) => b.display !== 'dative' && isMetalAtom(doc.atoms.get(b.a1 === id ? b.a2 : b.a1)));
  // a carbonyl ligand, drawn M–C≡O, is M←C⁻≡O⁺ to the engine
  const charged = new Map<number, number>();
  for (const id of ids) {
    const c = metalCarbonyl(doc, doc.atoms.get(id)!);
    if (!c || !inSet.has(c.id)) continue;
    charged.set(id, 1);
    charged.set(c.id, -1);
    for (const b of metalBonds(c.id)) dative.add(b.id);
  }
  // an N-heterocyclic carbene (a carbon with two N, bonded to the metal) gives it its lone pair
  const carbene = new Set<number>();
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    if (a.z !== 6 || a.label || a.charge || a.radical || isMetalAtom(a) || charged.has(id)) continue;
    const mb = metalBonds(id);
    if (mb.length !== 1) continue;
    const rest = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => b !== mb[0]);
    if (rest.length !== 2 || rest.some((b) => b.order !== 1 || doc.atoms.get(b.a1 === id ? b.a2 : b.a1)?.z !== 7)) continue;
    carbene.add(id);
    charged.set(id, 0);
    dative.add(mb[0].id);
  }
  // An odd π-system bonded through its middle (η⁵-Cp, η³-allyl) is an anion on a cation to the
  // engine: one of its carbons −1, the metal +1 (Cp⁻ Fe²⁺ Cp⁻ for ferrocene), so it reads as the
  // aromatic ring or allyl it is and the formula comes out right.
  const kekule = new Map<number, number>();
  const centres = new Set(ids.flatMap((id) => [...(doc.centresOf.get(id) ?? [])]));
  for (const id of centres) {
    const c = doc.atoms.get(id);
    if (!c?.multi || c.multi.length % 2 === 0 || !c.multi.every((m) => inSet.has(m))) continue;
    const metals = (doc.adj.get(id) ?? []).map((bid) => { const b = doc.bonds.get(bid)!; return b.a1 === id ? b.a2 : b.a1; }).filter((m) => inSet.has(m));
    if (!metals.length) continue;
    const members = new Set(c.multi);
    const inner = (m: number) => (doc.adj.get(m) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => members.has(b.a1 === m ? b.a2 : b.a1));
    const plain = (m: number) => inner(m).every((b) => b.order !== 2);
    const ends = c.multi.filter((m) => inner(m).length === 1);
    // the anion: the carbon with no double bond (an end of an allyl, the CH of a Kekulé Cp)
    const anion = (ends.length ? ends : c.multi).find(plain);
    const at = anion !== undefined ? doc.atoms.get(anion)! : null;
    if (!at || at.z !== 6 || at.label || at.charge || charged.has(anion!)) continue;
    charged.set(anion!, -1);
    charged.set(metals[0], (charged.get(metals[0]) ?? 0) + 1);
    // a ring's 1½ bonds written out round from the anion: single, double, single… (C5H5⁻)
    if (!ends.length && c.multi.every((m) => inner(m).every((b) => b.order === 1.5))) {
      let cur = anion!, prev = -1;
      for (let k = 0; k < members.size; k++) {
        const next = inner(cur).find((b) => (b.a1 === cur ? b.a2 : b.a1) !== prev && !kekule.has(b.id));
        if (!next) break;
        kekule.set(next.id, k % 2 === 1 && k < members.size - 1 ? 2 : 1);
        prev = cur; cur = next.a1 === cur ? next.a2 : next.a1;
      }
    }
    // an open chain's 1½ bonds: double, single… from the far end
    if (ends.length === 2) {
      let cur = ends.find((e) => e !== anion)!, prev = -1, k = 0;
      while (cur !== anion && k < members.size) {
        const next = inner(cur).find((b) => (b.a1 === cur ? b.a2 : b.a1) !== prev);
        if (!next) break;
        if (next.order === 1.5) kekule.set(next.id, k % 2 === 0 ? 2 : 1);
        prev = cur; cur = next.a1 === cur ? next.a2 : next.a1; k++;
      }
    }
  }
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    if (isMetalAtom(a) || charged.has(id)) continue;
    const mb = metalBonds(id);
    if (!mb.length) continue;
    if (a.label) {
      const others = (doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => b.display !== 'dative' && !mb.includes(b)).reduce((s, b) => s + b.order, 0);
      if (labelDonates(a.label, others)) for (const b of mb) dative.add(b.id);
      continue;
    }
    // as many as the atom's hydrogens were worked out with stay ordinary (see Doc.valenceSum)
    let own = 0;
    for (const bid of doc.adj.get(id) ?? []) { const b = doc.bonds.get(bid)!; if (b.display !== 'dative' && !mb.includes(b)) own += b.order; }
    let keep = doc.valenceSum(id) - own - radicalElectrons(a);
    for (const b of mb) { if (keep >= b.order) keep -= b.order; else dative.add(b.id); }
  }
  for (const id of ids) {
    const a = doc.atoms.get(id)!;
    const x = (a.x - first.x) / L, y = -(a.y - first.y) / L;
    let g: MiniGraph | null = null;
    if (a.label) {
      g = labelGraph(a.label, valenceOfBonds((doc.adj.get(id) ?? []).map((bid) => doc.bonds.get(bid)!).filter((b) => b.display !== 'dative' && !dative.has(b.id)).map((b) => b.order)));
      if (!g) unknown.push(a.label);
    }
    if (!g || g.atoms.length === 0) {
      attach.set(id, atoms.length);
      const rad = a.radical === 'singlet' || carbene.has(id) ? 1 : a.radical === 'doublet' ? 2 : a.radical === 'triplet' ? 3 : 0;
      const sym = a.label && !g ? generic : SYMBOLS[a.z] || generic;
      if (sym === generic) genericAt.push([atoms.length, a.label ?? '']);
      atoms.push({ sym, x, y, charge: a.charge + (charged.get(id) ?? 0), iso: a.isotope, rad });
      map.push(id);
      continue;
    }
    const base = atoms.length;
    attach.set(id, base);
    g.atoms.forEach((ga, k) => {
      // spread expanded atoms a little so no two share a position
      const ang = (k * 2.4);
      const r = k === 0 ? 0 : 0.35 + 0.05 * k;
      const sym = ga.dummy ? generic : SYMBOLS[ga.z] || generic;
      if (sym === generic) genericAt.push([atoms.length, `${a.label}/${k}`]);
      atoms.push({ sym, x: x + r * Math.cos(ang), y: y + r * Math.sin(ang), charge: ga.charge + (k === 0 ? a.charge : 0), iso: ga.iso ?? 0 });
      map.push(k === 0 ? id : -1);
      if (g!.atoms.length > 1) inLabel.push(base + k);
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
      // a dative bond joins two molecules that are each whole (the formula is the same)
      if (b.display === 'dative') continue;
      if (dative.has(b.id)) {
        // from the atom giving the bond to the metal (V2000 bond type 9, a coordination bond)
        const donor = isMetalAtom(doc.atoms.get(b.a1)) ? b.a2 : b.a1;
        bonds.push({ a: attach.get(donor)!, b: attach.get(donor === b.a1 ? b.a2 : b.a1)!, order: 9, stereo: 0 });
        continue;
      }
      const order = kekule.get(b.id) ?? (b.order === 1.5 ? 4 : b.order === 2 ? 2 : b.order === 3 ? 3 : 1);
      // a stereo bond is written from the atom it describes
      const sense = stereoSense(b);
      const from = sense ? stereoAnchor(doc, b)! : b.a1;
      const stereo = sense === 'up' ? 1 : sense === 'down' ? 6 : sense === 'either' ? 4 : 0;
      const to = from === b.a1 ? b.a2 : b.a1;
      bonds.push({ a: attach.get(from)!, b: attach.get(to)!, order, stereo });
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
  return { molblock: lines.join('\n') + '\n', map, unknownLabels: unknown, inLabel, generic: genericAt };
}

/** Add the atoms and bonds of a molfile to the document, centred at (cx, cy). Returns new atom ids. */
export function addMolfile(doc: Doc, molblock: string, cx: number, cy: number): number[] {
  const lines = molblock.split(/\r?\n/);
  const counts = lines[3] ?? '';
  const na = parseInt(counts.slice(0, 3), 10), nb = parseInt(counts.slice(3, 6), 10);
  if (!Number.isFinite(na) || counts.includes('V3000')) throw new Error('Only V2000 molfiles are supported so far.');
  const raw: { x: number; y: number; sym: string; chg: number; iso: number; rad: number }[] = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    raw.push({ x: parseFloat(l.slice(0, 10)), y: parseFloat(l.slice(10, 20)), sym: l.slice(31, 34).trim(), chg: 0, iso: 0, rad: 0 });
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
    // charges, isotopes (13C, D) and radicals, each as atom-value pairs
    const field = l.startsWith('M  CHG') ? 'chg' : l.startsWith('M  ISO') ? 'iso' : l.startsWith('M  RAD') ? 'rad' : null;
    if (field) {
      const n = parseInt(l.slice(6, 9), 10);
      for (let k = 0; k < n; k++) {
        const idx = parseInt(l.slice(10 + k * 8, 13 + k * 8), 10) - 1;
        const v = parseInt(l.slice(14 + k * 8, 17 + k * 8), 10);
        if (raw[idx] && Number.isFinite(v)) raw[idx][field] = v;
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
    const radical = r.rad === 1 ? 'singlet' : r.rad === 2 ? 'doublet' : r.rad === 3 ? 'triplet' : undefined;
    const a = doc.addAtom(cx + (r.x - mx) * k, cy - (r.y - my) * k, z ?? 6, {
      charge: r.chg, label: z === undefined ? r.sym : null, ...(r.iso ? { isotope: r.iso } : {}), ...(radical ? { radical } : {}),
    });
    ids.push(a.id);
    atoms.push(a);
  }
  for (const [a, b, order, stereo] of bl) {
    const display = stereo === 1 ? 'wedge' : stereo === 6 ? 'hashWedge' : stereo === 4 ? 'wavy' : 'solid';
    doc.addBond(atoms[a].id, atoms[b].id, order === 4 ? 1.5 : order, display);
  }
  return ids;
}
