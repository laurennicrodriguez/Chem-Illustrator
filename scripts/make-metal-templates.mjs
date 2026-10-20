// Builds src/chem/metal-templates.json: coordination geometries, organometallic complexes and
// ligands for the template tools.
//
// Geometries, sandwich and half-sandwich complexes are built in 3-D here and drawn as their
// shadow on the page, seen a little from above: bonds from the metal that come towards the
// viewer become wedges, ones going away hashed wedges, so the drawing reads the way the shape
// is. Rings bonded side-on (η⁵-Cp, η⁶-arene) get a hapto bond to their middle. Ligands are laid
// out by RDKit (CoordGen) from SMILES with the metal in place, so chelate rings come out
// regular; the metal is the template's first atom, the one put on a metal that is clicked.
// σ-donors are written with a + charge only so RDKit accepts the extra bond; the charge is
// taken off again.
//
// Run with:  node scripts/make-metal-templates.mjs

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RDKit = await require('@rdkit/rdkit')();

const DEG = Math.PI / 180;
const r3 = (v) => Math.round(v * 1000) / 1000;

// ------------------------------------------------------------------ 3-D building

/** A structure in 3-D (y up, z towards the viewer), drawn by project(). */
function mol() {
  const t = { atoms: [], bonds: [], hapto: [], circle: [] };
  t.atom = (p, el = 'C', label) => { t.atoms.push({ ...p, el, label }); return t.atoms.length - 1; };
  /** display 'auto': a wedge or hashed wedge from `a` when the bond runs towards or away from the viewer. */
  t.bond = (a, b, order = 1, display) => { t.bonds.push({ a, b, order, display }); return t; };
  t.ring = (ids, circled = true) => {
    for (let i = 0; i < ids.length; i++) t.bond(ids[i], ids[(i + 1) % ids.length]);
    if (circled) t.circle.push(ids);
    return ids;
  };
  return t;
}

const v3 = (x, y, z) => ({ x, y, z });
const addv = (p, q) => v3(p.x + q.x, p.y + q.y, p.z + q.z);
const scl = (p, k) => v3(p.x * k, p.y * k, p.z * k);
const len = (p) => Math.hypot(p.x, p.y, p.z);
/** A unit vector at `polar` from straight up and `az` round from the front (+z) towards the right (+x). */
const dirv = (polar, az) => v3(Math.sin(polar * DEG) * Math.sin(az * DEG), Math.cos(polar * DEG), Math.sin(polar * DEG) * Math.cos(az * DEG));

/** Two unit vectors across a ring whose axis is `n`. */
function frame(n) {
  const a = Math.abs(n.y) < 0.9 ? v3(0, 1, 0) : v3(0, 0, 1);
  // u = a × n, w = n × u
  let u = v3(a.y * n.z - a.z * n.y, a.z * n.x - a.x * n.z, a.x * n.y - a.y * n.x);
  u = scl(u, 1 / len(u));
  const w = v3(n.y * u.z - n.z * u.y, n.z * u.x - n.x * u.z, n.x * u.y - n.y * u.x);
  return [u, w];
}

/** A flat ring of n atoms (one bond long) round `c`, square to the axis `n`, turned by `phase`°. */
function ringAt(t, c, n, size, phase = 0, el = 'C') {
  const nn = scl(n, 1 / len(n));
  const [u, w] = frame(nn);
  const r = 1 / (2 * Math.sin(Math.PI / size));
  const ids = [];
  for (let k = 0; k < size; k++) {
    const a = (phase + (360 * k) / size) * DEG;
    ids.push(t.atom(addv(c, addv(scl(u, r * Math.cos(a)), scl(w, r * Math.sin(a)))), el));
  }
  return ids;
}

/** Methyls on each ring atom, pointing out from the ring's middle (Cp*, C6Me6). */
function methylate(t, ring) {
  const c = ring.reduce((s, i) => addv(s, scl(t.atoms[i], 1 / ring.length)), v3(0, 0, 0));
  for (const i of ring) {
    const p = t.atoms[i];
    const d = addv(p, scl(c, -1));
    t.bond(i, t.atom(addv(p, scl(d, 1 / len(d)))));
  }
}

/**
 * The page drawing of a 3-D structure: turned by `turnY`° round the upright axis, then tipped
 * by `tilt`° so it is seen from a little above; y down, centred, bond length 1 in 3-D.
 */
function project(t, { tilt = 0, turnY = 0 } = {}) {
  const cy = Math.cos(turnY * DEG), sy = Math.sin(turnY * DEG), ct = Math.cos(tilt * DEG), st = Math.sin(tilt * DEG);
  const P = t.atoms.map((p) => {
    const x = p.x * cy + p.z * sy, z1 = -p.x * sy + p.z * cy;
    return { x, y: p.y * ct - z1 * st, z: p.y * st + z1 * ct };
  });
  const atoms = t.atoms.map((p, i) => ({ x: P[i].x, y: -P[i].y, el: p.el, label: p.label }));
  const bonds = t.bonds.map((b) => {
    let display = b.display;
    if (display === 'auto') {
      const d = (P[b.b].z - P[b.a].z) / Math.max(1e-9, Math.hypot(P[b.b].x - P[b.a].x, P[b.b].y - P[b.a].y, P[b.b].z - P[b.a].z));
      display = d > 0.5 ? 'wedge' : d < -0.5 ? 'hashWedge' : undefined;
    }
    return { a: b.a, b: b.b, order: b.order, display };
  });
  return { atoms, bonds, hapto: t.hapto, circle: t.circle };
}

// ------------------------------------------------------------------ geometries

/** A metal with ligands L along these directions (polar°, azimuth°), each a bond (in 3-D) long. */
function geometry(dirs, opts = {}) {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const L = opts.length ?? 1.35;
  for (const [polar, az] of dirs) t.bond(m, t.atom(scl(dirv(polar, az), L), 'C', 'L'), 1, 'auto');
  return project(t, opts.view ?? { tilt: 15, turnY: 0 });
}

const tetra = Math.acos(-1 / 3) / DEG; // 109.47°

const GEOMETRIES = [
  ['linear', 'Linear ML₂', geometry([[90, 90], [90, -90]], { view: {} })],
  ['trigonal-planar', 'Trigonal planar ML₃', geometry([[0, 0], [120, 90], [120, -90]], { view: {} })],
  // two bonds in the page, and below them one towards the viewer and one away, drawn a little
  // apart (seen exactly side-on they would lie on top of each other)
  ['tetrahedral', 'Tetrahedral ML₄', (() => {
    const t = mol();
    const m = t.atom(v3(0, 0, 0), 'C', 'M');
    const h = (tetra / 2) * DEG;
    for (const sx of [-1, 1]) t.bond(m, t.atom(v3(sx * 1.35 * Math.sin(h), 1.35 * Math.cos(h), 0), 'C', 'L'));
    t.bond(m, t.atom(v3(0.5, -1.2, 0.8), 'C', 'L'), 1, 'wedge');
    t.bond(m, t.atom(v3(-0.5, -1.2, -0.8), 'C', 'L'), 1, 'hashWedge');
    return project(t);
  })()],
  ['square-planar', 'Square planar ML₄', geometry([[0, 0], [90, 90], [180, 0], [90, -90]], { view: {} })],
  ['tbp', 'Trigonal bipyramidal ML₅', geometry([[0, 0], [180, 0], [90, -90], [90, 30], [90, 150]], { view: { tilt: 25 } })],
  ['square-pyramidal', 'Square pyramidal ML₅', geometry([[0, 0], [90, 45], [90, 135], [90, 225], [90, 315]], { length: 1.5, view: { tilt: 25 } })],
  ['octahedral', 'Octahedral ML₆', geometry([[0, 0], [180, 0], [90, 45], [90, 135], [90, 225], [90, 315]], { length: 1.5, view: { tilt: 25 } })],
];

// ------------------------------------------------------------------ organometallic complexes

const SANDWICH = { tilt: 22 };
/** Metal to ring middle, in bond lengths (Fe–Cp 1.65 Å against C–C 1.42 Å, drawn a little longer to leave room). */
const M_RING = 1.3;

/** A ring bonded side-on to metal `m` from direction `n`, with a hapto bond to its middle. */
function hapto(t, m, n, size, phase, { circled = true, dist = M_RING, methyls = false } = {}) {
  const nn = scl(n, 1 / len(n));
  const ring = ringAt(t, addv(t.atoms[m], scl(nn, dist)), nn, size, phase);
  t.ring(ring, circled);
  if (methyls) methylate(t, ring);
  t.hapto.push([m, ring]);
  return ring;
}

function sandwich(metalEl, label, staggered) {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), metalEl, label);
  hapto(t, m, v3(0, 1, 0), 5, 90);
  hapto(t, m, v3(0, -1, 0), 5, staggered ? 90 + 36 : 90);
  return project(t, SANDWICH);
}

/** A metal with a ring on top and three legs (a piano stool): CpML₃, Cp*ML₃, (η⁶-arene)ML₃. */
function pianoStool(size, { methyls = false } = {}) {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  hapto(t, m, v3(0, 1, 0), size, 90, { methyls });
  for (const az of [0, 120, 240]) t.bond(m, t.atom(scl(dirv(125, az), 1.35), 'C', 'L'), 1, 'auto');
  return project(t, { tilt: 20 });
}

/** Cp₂MX₂ (zirconocene dichloride and the like): the rings tipped back, the X–M–X plane square to theirs. */
function bentMetallocene() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  // centroid–M–centroid about 130°, opening to the left
  hapto(t, m, dirv(25, -90), 5, 90);
  hapto(t, m, dirv(155, -90), 5, 90);
  for (const z of [1, -1]) t.bond(m, t.atom(scl(v3(Math.cos(48 * DEG), 0, z * Math.sin(48 * DEG)), 1.35), 'C', 'X'), 1, 'auto');
  return project(t, { tilt: 35 });
}

function allyl() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  // the allyl above the metal, its middle carbon pointing back
  const c1 = t.atom(v3(-0.866, 0.95, 0)), c2 = t.atom(v3(0, 1.45, 0)), c3 = t.atom(v3(0.866, 0.95, 0));
  t.bond(c1, c2, 1.5).bond(c2, c3, 1.5);
  t.hapto.push([m, [c1, c2, c3]]);
  t.bond(m, t.atom(scl(dirv(130, -90), 1.35), 'C', 'L'));
  t.bond(m, t.atom(scl(dirv(130, 90), 1.35), 'C', 'L'));
  return project(t);
}

function alkene() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const a = t.atom(v3(-0.5, 1.2, 0)), b = t.atom(v3(0.5, 1.2, 0));
  t.bond(a, b, 2);
  t.hapto.push([m, [a, b]]);
  t.bond(m, t.atom(scl(dirv(130, -90), 1.35), 'C', 'L'));
  t.bond(m, t.atom(scl(dirv(130, 90), 1.35), 'C', 'L'));
  return project(t);
}

/** [L₂M(μ-Cl)]₂: two square-planar metals sharing two chlorides. */
function chlorideDimer() {
  const t = mol();
  const m1 = t.atom(v3(-1.05, 0, 0), 'C', 'M'), m2 = t.atom(v3(1.05, 0, 0), 'C', 'M');
  const c1 = t.atom(v3(0, 1.05, 0), 'Cl'), c2 = t.atom(v3(0, -1.05, 0), 'Cl');
  for (const m of [m1, m2]) for (const c of [c1, c2]) t.bond(m, c);
  for (const [m, sx] of [[m1, -1], [m2, 1]]) {
    for (const sy of [1, -1]) t.bond(m, t.atom(addv(t.atoms[m], v3(sx * 0.95, sy * 0.95, 0)), 'C', 'L'));
  }
  return project(t);
}

/**
 * X₄M≣MX₄ (as in [Re₂Cl₈]²⁻): a quadruple bond, each metal with an X above and below and two
 * leaning outwards, one in front and one behind.
 */
function quadruple() {
  const t = mol();
  const m1 = t.atom(v3(-0.65, 0, 0), 'C', 'M'), m2 = t.atom(v3(0.65, 0, 0), 'C', 'M');
  t.bond(m1, m2, 4);
  for (const [m, sx] of [[m1, -1], [m2, 1]]) {
    const p = t.atoms[m];
    for (const sy of [1, -1]) t.bond(m, t.atom(addv(p, v3(sx * 0.3, sy * 1.3, 0)), 'C', 'X'));
    t.bond(m, t.atom(addv(p, v3(sx * 1.25, -0.45, 0)), 'C', 'X'), 1, 'wedge');
    t.bond(m, t.atom(addv(p, v3(sx * 1.25, 0.45, 0)), 'C', 'X'), 1, 'hashWedge');
  }
  return project(t);
}

/** A β-agostic alkyl: M–Cα–Cβ–H with the C–H donating to the metal (dashed). */
function agostic() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const ca = t.atom(v3(0.75, 0.8, 0)), cb = t.atom(v3(1.6, 0.25, 0)), h = t.atom(v3(0.85, -0.45, 0), 'H');
  t.bond(m, ca).bond(ca, cb).bond(cb, h).bond(m, h, 1, 'dash');
  t.bond(cb, t.atom(v3(2.55, 0.6, 0)));
  t.bond(m, t.atom(v3(-1, 0.35, 0), 'C', 'L'));
  t.bond(m, t.atom(v3(-0.35, -1.05, 0), 'C', 'L'));
  return project(t);
}

const COMPLEXES = [
  ['ferrocene', 'Ferrocene (staggered)', sandwich('Fe', undefined, true)],
  ['metallocene', 'Metallocene Cp₂M (eclipsed)', sandwich('C', 'M', false)],
  ['bent-metallocene', 'Bent metallocene Cp₂MX₂', bentMetallocene()],
  ['cpml3', 'Half-sandwich CpML₃ (piano stool)', pianoStool(5)],
  ['cpstarml3', 'Half-sandwich Cp*ML₃', pianoStool(5, { methyls: true })],
  ['arene-ml3', '(η⁶-Arene)ML₃', pianoStool(6)],
  ['allyl-complex', '(η³-Allyl)ML₂', allyl()],
  ['alkene-complex', '(η²-Alkene)ML₂', alkene()],
  ['mu-cl-dimer', 'Chloride-bridged dimer [L₂M(μ-Cl)]₂', chlorideDimer()],
  ['quadruple', 'Metal–metal quadruple bond X₄M≣MX₄', quadruple()],
  ['agostic', 'β-Agostic alkyl', agostic()],
];

// ------------------------------------------------------------------ ligands

/** A ligand on its own metal M (atom 0), from SMILES laid out by RDKit. */
function rdLigand(smiles, labels = {}) {
  // CoordGen lays a metal's bonds out short; a silicon in its place is laid out like any atom
  const m = RDKit.get_mol(smiles.replace('[Pd]', '[Si]'));
  if (!m) throw new Error(`RDKit could not read: ${smiles}`);
  m.set_new_coords(true);
  const t = parseMolblock(m.get_molblock());
  m.delete();
  // the metal on the left, the ligand to its right
  const M = t.atoms[0];
  const rest = t.atoms.slice(1);
  const cx = rest.reduce((s, p) => s + p.x, 0) / rest.length - M.x, cy = rest.reduce((s, p) => s + p.y, 0) / rest.length - M.y;
  const a = -Math.atan2(cy, cx);
  const mx = M.x, my = M.y;
  for (const p of t.atoms) {
    const x = (p.x - mx) * Math.cos(a) - (p.y - my) * Math.sin(a), y = (p.x - mx) * Math.sin(a) + (p.y - my) * Math.cos(a);
    p.x = x; p.y = y;
  }
  // bond length 1
  const k = t.bonds.length / t.bonds.reduce((s, b) => s + Math.hypot(t.atoms[b.a].x - t.atoms[b.b].x, t.atoms[b.a].y - t.atoms[b.b].y), 0);
  for (const p of t.atoms) { p.x *= k; p.y *= k; }
  t.atoms[0].el = 'C';
  t.atoms[0].label = 'M';
  for (const p of t.atoms) {
    p.charge = 0;
    if (labels[p.el]) p.label = labels[p.el];
  }
  // aromatic rings come back Kekulé (bond orders 1 and 2), as drawn
  return { atoms: t.atoms, bonds: t.bonds.map((b) => ({ ...b, display: b.stereo === 1 ? 'wedge' : b.stereo === 6 ? 'hashWedge' : undefined })), hapto: [], circle: [] };
}

/** A straight-line ligand: M–C≡O, M–N≡C–CH₃. */
function linear(els, orders) {
  const atoms = [{ x: 0, y: 0, el: 'C', label: 'M' }, ...els.map((el, i) => ({ x: i + 1, y: 0, el }))];
  return { atoms, bonds: orders.map((o, i) => ({ a: i, b: i + 1, order: o })), hapto: [], circle: [] };
}

/** A π-ligand bonded side-on to M: a ring (Cp, Cp*, benzene) seen from a little above. */
function piRing(size, opts = {}) {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  hapto(t, m, v3(0, 1, 0), size, 90, opts);
  return project(t, SANDWICH);
}

function piAllyl() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const c1 = t.atom(v3(-0.866, 0.95, 0)), c2 = t.atom(v3(0, 1.45, 0)), c3 = t.atom(v3(0.866, 0.95, 0));
  t.bond(c1, c2, 1.5).bond(c2, c3, 1.5);
  t.hapto.push([m, [c1, c2, c3]]);
  return project(t);
}

function piEthylene() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const a = t.atom(v3(-0.5, 1.2, 0)), b = t.atom(v3(0.5, 1.2, 0));
  t.bond(a, b, 2);
  t.hapto.push([m, [a, b]]);
  return project(t);
}

/**
 * η²,η²-1,5-Cyclooctadiene in its tub shape: both C=C bonds upright and facing the metal, one
 * in front and one behind, joined by CH₂CH₂ bridges over the top and under the bottom; turned
 * so the two don't hide each other.
 */
function cod(view = { tilt: 20, turnY: 50 }) {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const X = 1.25, X2 = 1.95, Y = 0.5, Y2 = 1.0, Z = 0.7, Z2 = 0.45;
  const c1 = t.atom(v3(X, Y, Z)), c2 = t.atom(v3(X, -Y, Z));
  const c3 = t.atom(v3(X2, -Y2, Z2)), c4 = t.atom(v3(X2, -Y2, -Z2));
  const c5 = t.atom(v3(X, -Y, -Z)), c6 = t.atom(v3(X, Y, -Z));
  const c7 = t.atom(v3(X2, Y2, -Z2)), c8 = t.atom(v3(X2, Y2, Z2));
  t.bond(c1, c2, 2).bond(c2, c3).bond(c3, c4).bond(c4, c5).bond(c5, c6, 2).bond(c6, c7).bond(c7, c8).bond(c8, c1);
  t.hapto.push([m, [c1, c2]], [m, [c5, c6]]);
  return project(t, view);
}

/**
 * 1,1′-Bis(diphenylphosphino)ferrocene chelating M: the two Cp rings above and below the iron,
 * each with its PPh₂ bonded on to M.
 */
function dppf() {
  const t = mol();
  const m = t.atom(v3(0, 0, 0), 'C', 'M');
  const fe = t.atom(v3(-2.45, 0, 0), 'Fe');
  const top = hapto(t, fe, v3(0, 1, 0), 5, 180, { dist: 1.25 });
  const bottom = hapto(t, fe, v3(0, -1, 0), 5, 180, { dist: 1.25 });
  for (const ring of [top, bottom]) {
    // the ring carbon nearest M carries the phosphorus
    const c = ring.reduce((best, i) => (t.atoms[i].x > t.atoms[best].x ? i : best), ring[0]);
    const q = t.atoms[c];
    const p = t.atom(v3(q.x + 0.85, q.y * 1.15, q.z), 'P', 'PPh2');
    t.bond(c, p).bond(m, p);
  }
  return project(t, SANDWICH);
}

const PPH2 = { P: 'PPh2' };
const LIGANDS = [
  ['pph3', 'Triphenylphosphine PPh₃', rdLigand('[Pd][P+](c1ccccc1)(c1ccccc1)c1ccccc1')],
  ['pcy3', 'Tricyclohexylphosphine PCy₃', rdLigand('[Pd][P+](C1CCCCC1)(C1CCCCC1)C1CCCCC1')],
  ['ptbu3', 'Tri-tert-butylphosphine P(t-Bu)₃', rdLigand('[Pd][P+](C(C)(C)C)(C(C)(C)C)C(C)(C)C')],
  ['xphos', 'XPhos', rdLigand('[Pd][PH2+]c1ccccc1-c1c(C(C)C)cc(C(C)C)cc1C(C)C', { P: 'PCy2' })],
  ['sphos', 'SPhos', rdLigand('[Pd][PH2+]c1ccccc1-c1c(OC)cccc1OC', { P: 'PCy2' })],
  ['dppe', 'dppe (chelating)', rdLigand('[Pd]1[PH2+]CC[PH2+]1', PPH2)],
  ['dppp', 'dppp (chelating)', rdLigand('[Pd]1[PH2+]CCC[PH2+]1', PPH2)],
  ['dppf', 'dppf (chelating)', dppf()],
  ['binap', 'BINAP (chelating)', rdLigand('[Pd]1[PH2+]c2ccc3ccccc3c2-c2c([PH2+]1)ccc1ccccc21', PPH2)],
  ['xantphos', 'Xantphos (chelating)', rdLigand('[Pd]1[PH2+]c2cccc3c2Oc2c(cccc2C3(C)C)[PH2+]1', PPH2)],
  ['imes', 'IMes (N-heterocyclic carbene)', rdLigand('[Pd]C1N(c2c(C)cc(C)cc2C)C=CN1c1c(C)cc(C)cc1C')],
  ['ipr', 'IPr (N-heterocyclic carbene)', rdLigand('[Pd]C1N(c2c(C(C)C)cccc2C(C)C)C=CN1c1c(C(C)C)cccc1C(C)C')],
  ['co', 'Carbonyl CO', linear(['C', 'O'], [1, 3])],
  ['mecn', 'Acetonitrile MeCN', linear(['N', 'C', 'C'], [1, 3, 1])],
  ['py', 'Pyridine', rdLigand('[Pd][n+]1ccccc1')],
  ['bipy', '2,2′-Bipyridine (chelating)', rdLigand('[Pd]1[n+]2ccccc2-c2cccc[n+]12')],
  ['phen', '1,10-Phenanthroline (chelating)', rdLigand('[Pd]1[n+]2cccc3ccc4ccc[n+]1c4c23')],
  ['tmeda', 'TMEDA (chelating)', rdLigand('[Pd]1[N+](C)(C)CC[N+]1(C)C')],
  ['en', 'Ethylenediamine (chelating)', rdLigand('[Pd]1[NH2+]CC[NH2+]1', { N: 'NH2' })],
  ['acac', 'Acetylacetonate acac (chelating)', rdLigand('[Pd]1OC(C)=CC(C)=[O+]1')],
  ['cp', 'η⁵-Cyclopentadienyl Cp', piRing(5)],
  ['cpstar', 'η⁵-Pentamethylcyclopentadienyl Cp*', piRing(5, { methyls: true })],
  ['benzene', 'η⁶-Benzene', piRing(6)],
  ['allyl', 'η³-Allyl', piAllyl()],
  ['ethylene', 'η²-Ethylene', piEthylene()],
  ['cod', 'η⁴-1,5-Cyclooctadiene COD', cod()],
];

// ------------------------------------------------------------------ molfiles and output

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
  return { atoms, bonds };
}

/** Centred on the middle of the box round its atoms. */
function centre(t) {
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const p of t.atoms) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  for (const p of t.atoms) { p.x -= (x1 + x2) / 2; p.y -= (y1 + y2) / 2; }
}

function finish(t, group, id, name) {
  centre(t);
  return {
    id, name, group,
    atoms: t.atoms.map((p) => [r3(p.x), r3(p.y), p.el, ...(p.charge || p.label ? [p.charge ?? 0] : []), ...(p.label ? [p.label] : [])]),
    bonds: t.bonds.map((b) => [b.a, b.b, b.order, ...(b.display ? [b.display] : [])]),
    // the metal: put on a metal that is clicked (ligands), or the middle of the complex
    attach: t.atoms.findIndex((p) => p.label === 'M' || p.el === 'Fe'),
    ...(group === 'ligands' || group === 'geometries' ? { onMetal: true } : {}),
    ...(t.hapto.length ? { hapto: t.hapto.map(([m, ids]) => [m, ids]) } : {}),
    ...(t.circle.length ? { circle: t.circle } : {}),
  };
}

const out = [
  ...GEOMETRIES.map(([id, name, t]) => finish(t, 'geometries', id, name)),
  ...COMPLEXES.map(([id, name, t]) => finish(t, 'organometallic', id, name)),
  ...LIGANDS.map(([id, name, t]) => finish(t, 'ligands', id, name)),
];
for (const t of out) if (t.attach < 0) { console.error(`${t.id}: no metal`); process.exit(1); }
const file = path.join(root, 'src', 'chem', 'metal-templates.json');
fs.writeFileSync(file, '[\n' + out.map((t) => '  ' + JSON.stringify(t)).join(',\n') + '\n]\n');
console.log(`Wrote ${out.length} templates to ${path.relative(root, file)}`);
