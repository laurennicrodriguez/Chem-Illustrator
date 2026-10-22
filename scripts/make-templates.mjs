// Builds src/chem/templates.json, the structures offered by the template tools.
//
// Ring systems, heterocycles and amino acids are laid out by RDKit (CoordGen) from SMILES,
// then turned to sit on the usual 30° grid; sugars are drawn by hand below. (Conformers and
// other 3-D templates are made by make-conformers.py.)
// Every structure is checked: written back as a molfile, it must give the same molecule
// (stereochemistry included) as the SMILES it came from.
//
// Run with:  node scripts/make-templates.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RDKit = await require('@rdkit/rdkit')();

// group, id, name, SMILES, and how to turn it: 'grid' (30° grid), 'ring5' (heteroatom at the
// bottom), 'amino' (backbone across, side chain up) or 'asis' (as RDKit draws it)
const LIST = [
  ['rings', 'naphthalene', 'Naphthalene', 'c1ccc2ccccc2c1'],
  ['rings', 'anthracene', 'Anthracene', 'c1ccc2cc3ccccc3cc2c1'],
  ['rings', 'phenanthrene', 'Phenanthrene', 'c1ccc2c(c1)ccc1ccccc12'],
  ['rings', 'biphenyl', 'Biphenyl', 'c1ccc(cc1)-c1ccccc1'],
  ['rings', 'fluorene', 'Fluorene', 'C1c2ccccc2-c2ccccc12'],
  ['rings', 'indane', 'Indane', 'C1Cc2ccccc2C1'],
  ['rings', 'tetralin', 'Tetralin', 'C1CCc2ccccc2C1'],
  ['rings', 'azulene', 'Azulene', 'c1ccc2cccc2cc1'],
  ['rings', 'decalin', 'Decalin', 'C1CCC2CCCCC2C1'],
  ['rings', 'steroid', 'Steroid skeleton', 'C1CCC2C(C1)CCC1C2CCC2CCCC12'],

  ['heterocycles', 'pyridine', 'Pyridine', 'c1ccncc1'],
  ['heterocycles', 'pyrimidine', 'Pyrimidine', 'c1cncnc1'],
  ['heterocycles', 'pyrazine', 'Pyrazine', 'c1cnccn1'],
  ['heterocycles', 'pyridazine', 'Pyridazine', 'c1ccnnc1'],
  ['heterocycles', 'triazine', '1,3,5-Triazine', 'c1ncncn1'],
  ['heterocycles', 'pyrrole', 'Pyrrole', 'c1cc[nH]c1', 'ring5'],
  ['heterocycles', 'furan', 'Furan', 'c1ccoc1', 'ring5'],
  ['heterocycles', 'thiophene', 'Thiophene', 'c1ccsc1', 'ring5'],
  ['heterocycles', 'imidazole', 'Imidazole', 'c1cnc[nH]1', 'ring5'],
  ['heterocycles', 'pyrazole', 'Pyrazole', 'c1cn[nH]c1', 'ring5'],
  ['heterocycles', 'oxazole', 'Oxazole', 'c1cocn1', 'ring5'],
  ['heterocycles', 'isoxazole', 'Isoxazole', 'c1cnoc1', 'ring5'],
  ['heterocycles', 'thiazole', 'Thiazole', 'c1cscn1', 'ring5'],
  ['heterocycles', 'triazole123', '1,2,3-Triazole', 'c1cn[nH]n1', 'ring5'],
  ['heterocycles', 'triazole124', '1,2,4-Triazole', 'c1nc[nH]n1', 'ring5'],
  ['heterocycles', 'tetrazole', 'Tetrazole', 'c1nnn[nH]1', 'ring5'],
  ['heterocycles', 'indole', 'Indole', 'c1ccc2[nH]ccc2c1'],
  ['heterocycles', 'benzofuran', 'Benzofuran', 'c1ccc2occc2c1'],
  ['heterocycles', 'benzothiophene', 'Benzothiophene', 'c1ccc2sccc2c1'],
  ['heterocycles', 'benzimidazole', 'Benzimidazole', 'c1ccc2[nH]cnc2c1'],
  ['heterocycles', 'benzoxazole', 'Benzoxazole', 'c1ccc2ocnc2c1'],
  ['heterocycles', 'benzothiazole', 'Benzothiazole', 'c1ccc2scnc2c1'],
  ['heterocycles', 'quinoline', 'Quinoline', 'c1ccc2ncccc2c1'],
  ['heterocycles', 'isoquinoline', 'Isoquinoline', 'c1ccc2cnccc2c1'],
  ['heterocycles', 'quinazoline', 'Quinazoline', 'c1ccc2ncncc2c1'],
  ['heterocycles', 'quinoxaline', 'Quinoxaline', 'c1ccc2nccnc2c1'],
  ['heterocycles', 'purine', 'Purine', 'c1ncc2[nH]cnc2n1'],
  ['heterocycles', 'carbazole', 'Carbazole', 'c1ccc2c(c1)[nH]c1ccccc12'],
  ['heterocycles', 'aziridine', 'Aziridine', 'C1CN1'],
  ['heterocycles', 'oxirane', 'Oxirane (epoxide)', 'C1CO1'],
  ['heterocycles', 'azetidine', 'Azetidine', 'C1CNC1'],
  ['heterocycles', 'oxetane', 'Oxetane', 'C1COC1'],
  ['heterocycles', 'pyrrolidine', 'Pyrrolidine', 'C1CCNC1', 'ring5'],
  ['heterocycles', 'thf', 'Tetrahydrofuran', 'C1CCOC1', 'ring5'],
  ['heterocycles', 'dioxolane', '1,3-Dioxolane', 'C1OCCO1', 'ring5'],
  ['heterocycles', 'piperidine', 'Piperidine', 'C1CCNCC1'],
  ['heterocycles', 'piperazine', 'Piperazine', 'C1CNCCN1'],
  ['heterocycles', 'morpholine', 'Morpholine', 'C1COCCN1'],
  ['heterocycles', 'thp', 'Tetrahydropyran', 'C1CCOCC1'],
  ['heterocycles', 'dioxane', '1,4-Dioxane', 'C1COCCO1'],

  ['amino', 'gly', 'Glycine (Gly, G)', 'NCC(=O)O', 'amino'],
  ['amino', 'ala', 'L-Alanine (Ala, A)', 'N[C@@H](C)C(=O)O', 'amino'],
  ['amino', 'val', 'L-Valine (Val, V)', 'N[C@@H](C(C)C)C(=O)O', 'amino'],
  ['amino', 'leu', 'L-Leucine (Leu, L)', 'N[C@@H](CC(C)C)C(=O)O', 'amino'],
  ['amino', 'ile', 'L-Isoleucine (Ile, I)', 'N[C@@H]([C@@H](C)CC)C(=O)O', 'amino'],
  ['amino', 'pro', 'L-Proline (Pro, P)', 'N1CCC[C@H]1C(=O)O', 'amino'],
  ['amino', 'phe', 'L-Phenylalanine (Phe, F)', 'N[C@@H](Cc1ccccc1)C(=O)O', 'amino'],
  ['amino', 'trp', 'L-Tryptophan (Trp, W)', 'N[C@@H](Cc1c[nH]c2ccccc12)C(=O)O', 'amino'],
  ['amino', 'met', 'L-Methionine (Met, M)', 'N[C@@H](CCSC)C(=O)O', 'amino'],
  ['amino', 'ser', 'L-Serine (Ser, S)', 'N[C@@H](CO)C(=O)O', 'amino'],
  ['amino', 'thr', 'L-Threonine (Thr, T)', 'N[C@@H]([C@@H](C)O)C(=O)O', 'amino'],
  ['amino', 'cys', 'L-Cysteine (Cys, C)', 'N[C@@H](CS)C(=O)O', 'amino'],
  ['amino', 'tyr', 'L-Tyrosine (Tyr, Y)', 'N[C@@H](Cc1ccc(O)cc1)C(=O)O', 'amino'],
  ['amino', 'asn', 'L-Asparagine (Asn, N)', 'N[C@@H](CC(N)=O)C(=O)O', 'amino'],
  ['amino', 'gln', 'L-Glutamine (Gln, Q)', 'N[C@@H](CCC(N)=O)C(=O)O', 'amino'],
  ['amino', 'asp', 'L-Aspartic acid (Asp, D)', 'N[C@@H](CC(=O)O)C(=O)O', 'amino'],
  ['amino', 'glu', 'L-Glutamic acid (Glu, E)', 'N[C@@H](CCC(=O)O)C(=O)O', 'amino'],
  ['amino', 'lys', 'L-Lysine (Lys, K)', 'N[C@@H](CCCCN)C(=O)O', 'amino'],
  ['amino', 'arg', 'L-Arginine (Arg, R)', 'N[C@@H](CCCNC(=N)N)C(=O)O', 'amino'],
  ['amino', 'his', 'L-Histidine (His, H)', 'N[C@@H](Cc1c[nH]cn1)C(=O)O', 'amino'],
];

// L-amino acids are S at the α carbon, except cysteine (R); isoleucine is 2S,3S and threonine 2S,3R.
const EXPECTED_CIP = { ile: ['(S)', '(S)'], thr: ['(S)', '(R)'], cys: ['(R)'] };

// ------------------------------------------------------------------ geometry helpers

const r3 = (v) => Math.round(v * 1000) / 1000;
const angle = (dx, dy) => Math.atan2(dy, dx);
const rot = (p, a) => ({ ...p, x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

function parseMolblock(mb) {
  const lines = mb.split('\n');
  const na = parseInt(lines[3].slice(0, 3), 10), nb = parseInt(lines[3].slice(3, 6), 10);
  const atoms = [], bonds = [];
  for (let i = 0; i < na; i++) {
    const l = lines[4 + i];
    // molfiles have y up; the page has y down
    atoms.push({ x: parseFloat(l.slice(0, 10)), y: -parseFloat(l.slice(10, 20)), el: l.slice(31, 34).trim(), charge: 0 });
  }
  for (let i = 0; i < nb; i++) {
    const l = lines[4 + na + i];
    bonds.push({ a: parseInt(l.slice(0, 3), 10) - 1, b: parseInt(l.slice(3, 6), 10) - 1, order: parseInt(l.slice(6, 9), 10), stereo: parseInt(l.slice(9, 12), 10) || 0 });
  }
  for (const l of lines) {
    if (!l.startsWith('M  CHG')) continue;
    const n = parseInt(l.slice(6, 9), 10);
    for (let k = 0; k < n; k++) atoms[parseInt(l.slice(10 + k * 8, 13 + k * 8), 10) - 1].charge = parseInt(l.slice(14 + k * 8, 17 + k * 8), 10);
  }
  return { atoms, bonds };
}

function toMolblock(t) {
  const f = (v) => v.toFixed(4).padStart(10);
  const i3 = (v) => String(v).padStart(3);
  const out = ['', '  template', '', `${i3(t.atoms.length)}${i3(t.bonds.length)}  0  0  0  0  0  0  0  0999 V2000`];
  for (const a of t.atoms) out.push(`${f(a.x)}${f(-a.y)}${f(0)} ${(a.el + '   ').slice(0, 3)} 0  0  0  0  0  0  0  0  0  0  0  0`);
  for (const b of t.bonds) out.push(`${i3(b.a + 1)}${i3(b.b + 1)}${i3(b.order)}${i3(b.stereo)}`);
  const chg = t.atoms.map((a, i) => [i, a.charge]).filter(([, c]) => c);
  if (chg.length) out.push(`M  CHG${i3(chg.length)}` + chg.map(([i, c]) => ` ${i3(i + 1)} ${i3(c)}`).join(''));
  out.push('M  END');
  return out.join('\n');
}

/** Same size (bond length 1) and centred on the middle of the box round it. */
function normalize(t) {
  let sum = 0;
  for (const b of t.bonds) sum += Math.hypot(t.atoms[b.a].x - t.atoms[b.b].x, t.atoms[b.a].y - t.atoms[b.b].y);
  const k = t.bonds.length ? t.bonds.length / sum : 1;
  for (const p of t.atoms) { p.x *= k; p.y *= k; }
  const box = bbox(t);
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  for (const p of t.atoms) { p.x -= cx; p.y -= cy; }
}

function centre(t) {
  const box = bbox(t);
  const cx = (box.x1 + box.x2) / 2, cy = (box.y1 + box.y2) / 2;
  for (const p of t.atoms) { p.x -= cx; p.y -= cy; }
}

function bbox(t) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of t.atoms) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  return { x1, y1, x2, y2 };
}

function turn(t, ang) { t.atoms = t.atoms.map((p) => rot(p, ang)); }

/** Mirror top to bottom; wedges and hashes swap so the stereochemistry stays the same. */
function mirror(t) {
  for (const p of t.atoms) p.y = -p.y;
  for (const b of t.bonds) b.stereo = b.stereo === 1 ? 6 : b.stereo === 6 ? 1 : b.stereo;
}

const hetero = (t) => t.atoms.filter((p) => p.el !== 'C' && p.el !== 'H');

/** Turn so the bonds lie on the 30° grid, then pick the turn that reads best. */
function onGrid(t) {
  let sx = 0, sy = 0;
  for (const b of t.bonds) {
    const ang = angle(t.atoms[b.b].x - t.atoms[b.a].x, t.atoms[b.b].y - t.atoms[b.a].y);
    sx += Math.cos(6 * ang); sy += Math.sin(6 * ang);
  }
  // bonds at 30°, 90°, 150°…: 6 × angle is 180° (mod 360°)
  const base = (Math.PI - Math.atan2(sy, sx)) / 6;
  let best = null;
  const het = hetero(t).length ? hetero(t) : null;
  for (let k = 0; k < 12; k++) {
    for (const flip of [false, true]) {
      const c = { atoms: t.atoms.map((p) => ({ ...p })), bonds: t.bonds.map((b) => ({ ...b })) };
      if (flip) mirror(c);
      turn(c, base + (k * Math.PI) / 6);
      const box = bbox(c);
      const w = box.x2 - box.x1, h = box.y2 - box.y1;
      // on the grid; wider than tall; heteroatoms low and to the right; a vertex at the top
      const off = c.bonds.reduce((s, b) => s + (1 + Math.cos(6 * angle(c.atoms[b.b].x - c.atoms[b.a].x, c.atoms[b.b].y - c.atoms[b.a].y))), 0);
      let score = off * 100 + (h > w * 1.05 ? 10 : 0);
      if (het) {
        const hx = het.reduce((s, p, i) => s + hetero(c)[i].x, 0) / het.length, hy = hetero(c).reduce((s, p) => s + p.y, 0) / het.length;
        score += -hy * 2 - hx * 0.5;
      }
      if (!best || score < best.score - 1e-6) best = { score, c };
    }
  }
  t.atoms = best.c.atoms;
  t.bonds = best.c.bonds;
}

/** Five-membered rings: the (first) heteroatom straight below the middle. */
function ring5(t) {
  const het = t.atoms.find((p) => p.el !== 'C');
  if (!het) return onGrid(t);
  const cx = t.atoms.reduce((s, p) => s + p.x, 0) / t.atoms.length, cy = t.atoms.reduce((s, p) => s + p.y, 0) / t.atoms.length;
  turn(t, Math.PI / 2 - angle(het.x - cx, het.y - cy));
}

/** Amino acids: N on the left, the carboxyl on the right, the side chain upwards. */
function amino(t) {
  const n = 0;
  const nb = (i) => t.bonds.filter((b) => b.a === i || b.b === i).map((b) => (b.a === i ? b.b : b.a));
  const isAcid = (i) => t.atoms[i].el === 'C' && nb(i).some((j) => t.atoms[j].el === 'O' && t.bonds.some((b) => ((b.a === i && b.b === j) || (b.a === j && b.b === i)) && b.order === 2));
  // the α carbon: the nitrogen's neighbour that carries the carboxyl group
  const ca = nb(n).find((i) => nb(i).some(isAcid));
  const co = nb(ca).find(isAcid);
  turn(t, -angle(t.atoms[co].x - t.atoms[n].x, t.atoms[co].y - t.atoms[n].y));
  const side = nb(ca).filter((j) => j !== n && j !== co);
  const sy = side.length ? side.reduce((s, j) => s + t.atoms[j].y, 0) / side.length - t.atoms[ca].y : -1;
  if (sy > 0) mirror(t);
}

// ------------------------------------------------------------------ hand-drawn templates

// Haworth projections: ring oxygen at the back right, anomeric carbon on the right, the front
// edge drawn bold. Ring substituents stand straight up or down (the front carbons' upper ones
// shorter, as they sit inside the ring); hydrogens are left out. The ring is drawn wide, as
// usual for Haworth projections, so the labels have room; substituent bonds are a bond long.
function haworth(kind, ups, downs) {
  const ring = kind === 'pyranose'
    ? [['O', 1, -0.85], ['C', 2, 0], ['C', 1, 0.85], ['C', -1, 0.85], ['C', -2, 0], ['C', -1, -0.85]]
    : [['O', 0, -1], ['C', 1.5, -0.2], ['C', 1, 0.95], ['C', -1, 0.95], ['C', -1.5, -0.2]];
  const atoms = ring.map(([el, x, y]) => ({ el, x, y, charge: 0 }));
  const n = atoms.length;
  const front = kind === 'pyranose' ? [2, 3] : [2, 3];
  const bonds = [];
  for (let i = 0; i < n; i++) {
    // the three front edges (C1–C2, C2–C3, C3–C4) are bold
    bonds.push({ a: i, b: (i + 1) % n, order: 1, stereo: 0, display: i >= 1 && i <= 3 ? 'bold' : undefined });
  }
  const add = (i, dir, what) => {
    const p = atoms[i];
    const len = dir < 0 && front.includes(i) ? 0.75 : 1;
    let x = p.x, y = p.y + dir * len;
    // the furanose's CH2OH leans out to the left, clear of the ring oxygen
    if (what === 'CH2OH' && kind === 'furanose') { x = p.x - 0.7; y = p.y - 0.7; }
    atoms.push({ el: what === 'CH2OH' ? 'C' : 'O', x, y, charge: 0, ...(what === 'CH2OH' ? { label: 'CH2OH' } : {}) });
    bonds.push({ a: i, b: atoms.length - 1, order: 1, stereo: 0 });
  };
  for (const [i, what] of Object.entries(ups)) add(Number(i), -1, what);
  for (const [i, what] of Object.entries(downs)) add(Number(i), 1, what);
  return { atoms, bonds, scaled: true };
}

// ring positions: pyranose 0 O5, 1 C1, 2 C2, 3 C3, 4 C4, 5 C5; furanose 0 O4, 1 C1, 2 C2, 3 C3, 4 C4
const HAND = [
  { group: 'sugars', id: 'b-glc', name: 'β-D-Glucopyranose', smiles: 'OCC1OC(O)C(O)C(O)C1O',
    ...haworth('pyranose', { 1: 'OH', 3: 'OH', 5: 'CH2OH' }, { 2: 'OH', 4: 'OH' }) },
  { group: 'sugars', id: 'a-glc', name: 'α-D-Glucopyranose', smiles: 'OCC1OC(O)C(O)C(O)C1O',
    ...haworth('pyranose', { 3: 'OH', 5: 'CH2OH' }, { 1: 'OH', 2: 'OH', 4: 'OH' }) },
  { group: 'sugars', id: 'b-gal', name: 'β-D-Galactopyranose', smiles: 'OCC1OC(O)C(O)C(O)C1O',
    ...haworth('pyranose', { 1: 'OH', 3: 'OH', 4: 'OH', 5: 'CH2OH' }, { 2: 'OH' }) },
  { group: 'sugars', id: 'b-man', name: 'β-D-Mannopyranose', smiles: 'OCC1OC(O)C(O)C(O)C1O',
    ...haworth('pyranose', { 1: 'OH', 2: 'OH', 3: 'OH', 5: 'CH2OH' }, { 4: 'OH' }) },
  { group: 'sugars', id: 'b-rib', name: 'β-D-Ribofuranose', smiles: 'OCC1OC(O)C(O)C1O',
    ...haworth('furanose', { 1: 'OH', 4: 'CH2OH' }, { 2: 'OH', 3: 'OH' }) },
  { group: 'sugars', id: 'b-drib', name: '2-Deoxy-β-D-ribofuranose', smiles: 'OCC1OC(O)CC1O',
    ...haworth('furanose', { 1: 'OH', 4: 'CH2OH' }, { 3: 'OH' }) },
];

// ------------------------------------------------------------------ build and check

function canon(smilesOrMolblock, stereo = true) {
  const m = RDKit.get_mol(smilesOrMolblock);
  if (!m) throw new Error(`RDKit could not read: ${smilesOrMolblock.slice(0, 60)}`);
  const s = stereo ? m.get_smiles() : RDKit.get_mol(m.get_smiles()).get_smiles(JSON.stringify({ doIsomericSmiles: false }));
  m.delete();
  return s;
}

/** Bond used when the template is clicked onto a bond: an outside ring edge between two carbons, leftmost first. */
function pickFuse(t) {
  const deg = t.atoms.map((_, i) => t.bonds.filter((b) => b.a === i || b.b === i).length);
  const ringBond = new Set(cyclicBonds(t));
  const cands = t.bonds.map((b, i) => ({ b, i })).filter(({ b, i }) => ringBond.has(i) && deg[b.a] === 2 && deg[b.b] === 2);
  if (!cands.length) return undefined;
  const score = ({ b }) => (t.atoms[b.a].el === 'C' && t.atoms[b.b].el === 'C' ? 0 : 100) + (t.atoms[b.a].x + t.atoms[b.b].x) / 2 + (b.order === 1 ? 0 : 0.01);
  cands.sort((p, q) => score(p) - score(q));
  return [cands[0].b.a, cands[0].b.b];
}

/** Bonds in rings: those whose removal leaves their ends still connected. */
function cyclicBonds(t) {
  const out = [];
  t.bonds.forEach((skip, i) => {
    const seen = new Set([skip.a]);
    const stack = [skip.a];
    while (stack.length) {
      const x = stack.pop();
      for (const b of t.bonds) {
        if (b === skip) continue;
        const y = b.a === x ? b.b : b.b === x ? b.a : -1;
        if (y >= 0 && !seen.has(y)) { seen.add(y); stack.push(y); }
      }
    }
    if (seen.has(skip.b)) out.push(i);
  });
  return out;
}

/** Atom used when the template is clicked onto an atom. */
function pickAttach(t, group) {
  if (group === 'amino') return 0; // the amino nitrogen, joined by a new bond
  if (group === 'sugars' && t.atoms[0].el === 'O' && t.atoms.length > 6) {
    // the anomeric OH: the substituent on C1
    const b = t.bonds.find((x) => (x.a === 1 && t.atoms[x.b].el === 'O' && x.b !== 0));
    if (b) return b.b;
  }
  const deg = t.atoms.map((_, i) => t.bonds.filter((b) => b.a === i || b.b === i).length);
  const ring = new Set(cyclicBonds(t).flatMap((i) => [t.bonds[i].a, t.bonds[i].b]));
  let best = 0;
  t.atoms.forEach((p, i) => {
    const q = t.atoms[best];
    const ok = (k) => ring.has(k) && deg[k] === 2 && t.atoms[k].el === 'C';
    if (ok(i) && (!ok(best) || p.x < q.x - 1e-6 || (Math.abs(p.x - q.x) < 1e-6 && p.y < q.y))) best = i;
  });
  return best;
}

const out = [];
let failures = 0;
for (const [group, id, name, smiles, how = 'grid'] of LIST) {
  const m = RDKit.get_mol(smiles);
  m.set_new_coords(true);
  const t = parseMolblock(m.get_molblock());
  m.delete();
  normalize(t);
  if (how === 'grid') onGrid(t);
  else if (how === 'ring5') ring5(t);
  else if (how === 'amino') amino(t);
  normalize(t);
  // checks: same molecule, and L-amino acids have the right configuration
  const want = canon(smiles), got = canon(toMolblock(t));
  if (want !== got) { console.error(`${id}: drawn as ${got}, expected ${want}`); failures++; }
  if (group === 'amino' && id !== 'gly') {
    const tags = JSON.parse(RDKit.get_mol(toMolblock(t)).get_stereo_tags()).CIP_atoms.map(([, c]) => c);
    const exp = EXPECTED_CIP[id] ?? ['(S)'];
    if (JSON.stringify(tags) !== JSON.stringify(exp)) { console.error(`${id}: CIP ${tags} expected ${exp}`); failures++; }
  }
  out.push(finish(t, group, id, name));
}
for (const h of HAND) {
  const t = { atoms: h.atoms.map((p) => ({ ...p })), bonds: h.bonds.map((b) => ({ ...b })) };
  if (h.scaled) centre(t);
  else normalize(t);
  // CH2OH labels stand for C–O: check the skeleton with the label written out
  const full = { atoms: t.atoms.map((p) => ({ ...p })), bonds: t.bonds.map((b) => ({ ...b })) };
  full.atoms.forEach((p, i) => { if (p.label === 'CH2OH') { full.atoms.push({ el: 'O', x: p.x, y: p.y - 1, charge: 0 }); full.bonds.push({ a: i, b: full.atoms.length - 1, order: 1, stereo: 0 }); } });
  const want = canon(h.smiles, false), got = canon(toMolblock(full), false);
  if (want !== got) { console.error(`${h.id}: drawn as ${got}, expected ${want}`); failures++; }
  out.push(finish(t, h.group, h.id, h.name));
}

function finish(t, group, id, name) {
  const fuse = pickFuse(t);
  const attach = pickAttach(t, group);
  return {
    id, name, group,
    atoms: t.atoms.map((p) => [r3(p.x), r3(p.y), p.el, ...(p.charge || p.label ? [p.charge] : []), ...(p.label ? [p.label] : [])]),
    bonds: t.bonds.map((b) => [b.a, b.b, b.order, ...(b.stereo === 1 ? ['wedge'] : b.stereo === 6 ? ['hashWedge'] : b.display ? [b.display] : [])]),
    attach,
    ...(fuse ? { fuse } : {}),
    ...(group === 'amino' ? { join: 'bond' } : {}),
  };
}

if (failures) { console.error(`${failures} template(s) failed their checks; nothing written.`); process.exit(1); }
const file = path.join(root, 'src', 'chem', 'templates.json');
// one template per line keeps the file readable and the diffs small
fs.writeFileSync(file, '[\n' + out.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n');
console.log(`Wrote ${out.length} templates to ${path.relative(root, file)}`);
