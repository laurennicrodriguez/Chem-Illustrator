"""Make src/chem/conformers.json: the 3-D templates (conformers, fused and bridged rings,
projections, stereocentres, large rings, aromatics and rings seen in perspective).

Every 3-D shape is worked out here from real geometry, not traced from any picture:

* ring conformations are force-field structures (RDKit's MMFF94), held in the named shape
  where it is not an energy minimum (a boat, an envelope) by fixing its ring torsion angles,
  as described by Cremer & Pople (J. Am. Chem. Soc. 1975, 97, 1354) and named as in the IUPAC
  Basic Terminology of Stereochemistry (Pure Appl. Chem. 1996, 68, 2193);
* fused and bridged ring systems are the lowest-energy MMFF94 conformer of many embedded with
  RDKit's ETKDG, with the stereochemistry given in their SMILES (trans-decalin, 5α-steroid…);
* the shapes are then seen from a chosen direction (orthographic projection), so each template
  keeps its depth (`z`) and the editor can fuse further rings onto it in three dimensions.

Every template is checked: its atoms, bonds and (for 3-D ones) the stereochemistry its 3-D
shape implies must give the molecule of its SMILES.

Run with Python 3, RDKit and NumPy (pip install rdkit numpy):
    python scripts/make-conformers.py            # writes the JSON
    python scripts/make-conformers.py --png DIR  # also draws every template as a PNG, to check
"""

import json
import math
import sys
from pathlib import Path

import numpy as np
from rdkit import Chem
from rdkit.Chem import AllChem
from rdkit.Chem import rdMolTransforms as T

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'src' / 'chem' / 'conformers.json'

# ------------------------------------------------------------------ 3-D structures


def embed(smiles, torsions=(), seed=7, confs=40, keep_h=False, minimize=True):
    """A molecule's lowest-energy MMFF94 conformer (heavy atoms, or all atoms with keep_h).

    `torsions` fixes ring torsion angles while minimising: (i, j, k, l, degrees), with atom
    indexes as in the SMILES. Returns (mol without H unless keep_h, coordinates N×3)."""
    mol = Chem.AddHs(Chem.MolFromSmiles(smiles))
    params = AllChem.ETKDGv3()
    params.randomSeed = seed
    ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=confs, params=params))
    if not ids:
        # strained rings (cyclophanes) embed from random starting coordinates
        params.useRandomCoords = True
        ids = list(AllChem.EmbedMultipleConfs(mol, numConfs=confs, params=params))
    if not ids:
        raise RuntimeError(f'could not embed {smiles}')
    props = AllChem.MMFFGetMoleculeProperties(mol)
    best = None
    for cid in ids:
        if minimize:
            ff = AllChem.MMFFGetMoleculeForceField(mol, props, confId=cid)
            for (i, j, k, l, deg) in torsions:
                ff.MMFFAddTorsionConstraint(i, j, k, l, False, deg, deg, 1e4)
            ff.Minimize(maxIts=5000)
            e = ff.CalcEnergy()
        else:
            e = 0
        if best is None or e < best[0] - 1e-6:
            best = (e, cid)
    conf = mol.GetConformer(best[1])
    xyz = np.array([list(conf.GetAtomPosition(i)) for i in range(mol.GetNumAtoms())])
    if keep_h:
        return mol, xyz, best[1]
    heavy = [a.GetIdx() for a in mol.GetAtoms() if a.GetAtomicNum() > 1]
    m2 = Chem.RemoveHs(mol)
    return m2, xyz[heavy], None


def torsion_list(ring, values):
    """Torsion constraints round a ring (atom indexes in ring order) from a list of angles."""
    n = len(ring)
    return [(ring[k], ring[(k + 1) % n], ring[(k + 2) % n], ring[(k + 3) % n], values[k]) for k in range(n)]


def with_stubs(smiles, torsions=(), only=None, seed=7):
    """A ring with its hydrogens' directions as bonds (axial and equatorial stubs): returns
    atoms (element, xyz) and bonds, with every C–H turned into a C–C one bond long."""
    mol, xyz, _ = embed(smiles, torsions, seed=seed, keep_h=True)
    cc = np.mean([np.linalg.norm(xyz[b.GetBeginAtomIdx()] - xyz[b.GetEndAtomIdx()]) for b in mol.GetBonds()
                  if b.GetBeginAtom().GetAtomicNum() > 1 and b.GetEndAtom().GetAtomicNum() > 1])
    atoms, bonds, index = [], [], {}
    for a in mol.GetAtoms():
        if a.GetAtomicNum() > 1:
            index[a.GetIdx()] = len(atoms)
            atoms.append([a.GetSymbol(), xyz[a.GetIdx()], a.GetFormalCharge()])
    for b in mol.GetBonds():
        i, j = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        if i in index and j in index:
            bonds.append([index[i], index[j], bond_order(b)])
    for a in mol.GetAtoms():
        if a.GetAtomicNum() != 1:
            continue
        c = a.GetNeighbors()[0].GetIdx()
        if only is not None and c not in only:
            continue
        d = xyz[a.GetIdx()] - xyz[c]
        p = xyz[c] + d / np.linalg.norm(d) * cc
        atoms.append(['C', p, 0])
        bonds.append([index[c], len(atoms) - 1, 1])
    atoms = Stubbed(atoms)
    atoms.core = len(index)
    return atoms, bonds


class Stubbed(list):
    """A list of atoms whose first `core` are the molecule and the rest stubs."""
    core = 0


def bond_order(b):
    t = b.GetBondType()
    return 2 if t == Chem.BondType.DOUBLE else 3 if t == Chem.BondType.TRIPLE else 1.5 if t == Chem.BondType.AROMATIC else 1


def from_mol(mol, xyz):
    mol = Chem.Mol(mol)
    Chem.Kekulize(mol, clearAromaticFlags=True)
    atoms = [[a.GetSymbol(), xyz[a.GetIdx()], a.GetFormalCharge()] for a in mol.GetAtoms()]
    bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), bond_order(b)] for b in mol.GetBonds()]
    return atoms, bonds


# ------------------------------------------------------------------ views


def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def frame(xyz, ring_atoms=None):
    """Axes of the shape (or of some of its atoms): longest, middle and shortest spread."""
    pts = xyz if ring_atoms is None else xyz[ring_atoms]
    c = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - c)
    u, v, n = vt[0], vt[1], vt[2]
    if np.dot(np.cross(u, v), n) < 0:
        n = -n
    return c, np.array([u, v, n])


def classic(xyz, tilt=18, turn=0, spin=0, ring_atoms=None, flip=False):
    """The textbook view: the mean plane seen almost edge on from just above (tilted `tilt`°
    towards the viewer), its long axis across the page. `turn` swings the shape round its
    plane's normal first, `spin` turns the picture. Returns X (right), Y (up), Z (towards the viewer)."""
    c, R = frame(xyz, ring_atoms)
    p = (xyz - c) @ R.T  # long axis x, middle y, normal z
    if flip:
        p = p @ rot_x(math.pi).T
    p = p @ rot_z(math.radians(turn)).T
    # plane edge on (normal up the page), then tipped towards the viewer
    p = p @ rot_x(-math.pi / 2).T
    p = p @ rot_x(math.radians(tilt)).T
    p = p @ rot_z(math.radians(spin)).T
    return p


def face_on(xyz, ring_atoms=None, spin=0):
    c, R = frame(xyz, ring_atoms)
    p = (xyz - c) @ R.T
    return p @ rot_z(math.radians(spin)).T


def look(xyz, yaw=0, pitch=0, roll=0):
    """Turn about the vertical axis, then tip forwards, then turn the picture."""
    c = xyz.mean(axis=0)
    p = xyz - c
    p = p @ rot_y(math.radians(yaw)).T
    p = p @ rot_x(math.radians(pitch)).T
    p = p @ rot_z(math.radians(roll)).T
    return p


def edge_view(xyz, bonds, ring=None, elevs=(14, 18, 22), up=None, prefer=None):
    """Seen almost edge on, from a little above the ring's mean plane, from whichever side
    shows every atom and bond most clearly (no atom hidden behind another or on a bond).
    `up`: +1 or −1 to look from one face only. `prefer(p)`: extra score for a picture."""
    ring = ring if ring is not None else list(range(len(xyz)))
    c, R = frame(xyz, ring)
    p0 = (xyz - c) @ R.T  # mean plane is x–y, normal z
    best = None
    for side in ((1, -1) if up is None else (up,)):
        ps = p0 if side > 0 else p0 @ rot_x(math.pi).T
        for az in range(0, 360, 3):
            pa = ps @ rot_z(math.radians(az)).T
            for el in elevs:
                # look along −y (plane edge on), tipped el° to see the top face
                p = pa @ rot_x(-math.pi / 2).T
                p = p @ rot_x(math.radians(el)).T
                s = clarity(p, bonds) - abs(el - 17) * 0.002
                if prefer:
                    s += prefer(p)
                if best is None or s > best[0] + 1e-9:
                    best = (s, p)
    return best[1]


def raised(xyz, ring, count):
    """The ring atoms furthest out of its mean plane, on one side: a boat's bow and stern
    (count 2) or an envelope's flap (count 1)."""
    c, R = frame(xyz, ring)
    z = (xyz[ring] - c) @ R[2]
    if abs(z.min()) > abs(z.max()):
        z = -z
    return [ring[k] for k in np.argsort(-z)[:count]]


def tips_up(atoms_up):
    """A view score: these atoms at the far left and right (or one at a side), above the rest."""
    def score(p):
        xs = p[:, 0]
        s = 0
        if len(atoms_up) == 2:
            lo, hi = int(np.argmin(xs)), int(np.argmax(xs))
            s += 0.5 if {lo, hi} == set(atoms_up) else 0
        else:
            k = atoms_up[0]
            s += 0.5 if k in (int(np.argmin(xs)), int(np.argmax(xs))) else 0
        others = [i for i in range(len(p)) if i not in atoms_up]
        s += 0.3 if min(p[atoms_up, 1]) > np.mean(p[others, 1]) else 0
        return s
    return score


def clearest(xyz, bonds):
    """Almost edge on if that shows everything clearly, otherwise from wherever does."""
    p = edge_view(xyz, bonds, elevs=(15, 20, 25, 30))
    if clarity(p, bonds) >= 0.33:
        return p
    q = best_view(xyz, bonds, samples=1200)
    return q if clarity(q, bonds) > clarity(p, bonds) else p


def best_view(xyz, bonds, ring_atoms=None, samples=1500):
    """A direction from which no atoms or bonds hide each other: the one where the closest
    pair of things in the picture are furthest apart (with no crossing bonds if possible)."""
    best = None
    golden = math.pi * (3 - math.sqrt(5))
    c = xyz.mean(axis=0)
    p0 = xyz - c
    for k in range(samples):
        zc = 1 - (k + 0.5) / samples
        r = math.sqrt(1 - zc * zc)
        d = np.array([math.cos(golden * k) * r, math.sin(golden * k) * r, zc])
        if d[2] < 0:
            continue
        # rotation taking d to +z
        R = to_z(d)
        p = p0 @ R.T
        s = clarity(p, bonds)
        if best is None or s > best[0]:
            best = (s, p)
    p = best[1]
    # long axis across the page
    c2, R2 = frame(np.c_[p[:, :2], np.zeros(len(p))])
    ang = math.atan2(R2[0][1], R2[0][0])
    return p @ rot_z(-ang).T


def to_z(d):
    d = d / np.linalg.norm(d)
    z = np.array([0, 0, 1.0])
    v = np.cross(d, z)
    s = np.linalg.norm(v)
    if s < 1e-9:
        return np.eye(3) if d[2] > 0 else rot_x(math.pi)
    c = np.dot(d, z)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * ((1 - c) / (s * s))


def seg_dist(p, a, b):
    ab = b - a
    t = max(0, min(1, np.dot(p - a, ab) / max(1e-12, np.dot(ab, ab))))
    return np.linalg.norm(p - (a + t * ab))


def crosses(a, b, c, d):
    def ccw(p, q, r):
        return (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
    return ccw(a, b, c) * ccw(a, b, d) < 0 and ccw(c, d, a) * ccw(c, d, b) < 0


def clarity(p, bonds):
    q = p[:, :2]
    L = np.mean([np.linalg.norm(p[i] - p[j]) for i, j, *_ in bonds])
    worst = 10.0
    n = len(q)
    for i in range(n):
        for j in range(i + 1, n):
            worst = min(worst, np.linalg.norm(q[i] - q[j]) / L)
    for i, j, *_ in bonds:
        worst = min(worst, np.linalg.norm(q[i] - q[j]) / L * 1.2)
        for k in range(n):
            if k in (i, j):
                continue
            worst = min(worst, seg_dist(q[k], q[i], q[j]) / L * 1.5)
    # no bonds in a straight line through an atom, or folded back onto each other
    nb = {}
    for i, j, *_ in bonds:
        nb.setdefault(i, []).append(j)
        nb.setdefault(j, []).append(i)
    for c, ns in nb.items():
        for x in range(len(ns)):
            for y in range(x + 1, len(ns)):
                u, w = q[ns[x]] - q[c], q[ns[y]] - q[c]
                cosv = np.dot(u, w) / max(1e-9, np.linalg.norm(u) * np.linalg.norm(w))
                ang = math.degrees(math.acos(max(-1, min(1, cosv))))
                worst = min(worst, (180 - ang) / 60, ang / 45)
    cross = 0
    for x in range(len(bonds)):
        for y in range(x + 1, len(bonds)):
            i, j = bonds[x][:2]
            k, l = bonds[y][:2]
            if len({i, j, k, l}) == 4 and crosses(q[i], q[j], q[k], q[l]):
                cross += 1
    return worst - 0.25 * cross


# ------------------------------------------------------------------ templates


TEMPLATES = []


def ring_bonds(n_atoms, bonds):
    adj = {i: set() for i in range(n_atoms)}
    for i, j, *_ in bonds:
        adj[i].add(j)
        adj[j].add(i)
    out = []
    for k, (i, j, *_) in enumerate(bonds):
        seen, stack = {i}, [i]
        while stack:
            x = stack.pop()
            for y in adj[x]:
                if (x, y) in ((i, j), (j, i)):
                    continue
                if y not in seen:
                    seen.add(y)
                    stack.append(y)
        if j in seen:
            out.append(k)
    return out


def add(group, tid, name, smiles, atoms, bonds, view, *, flat=False, stereo3d=False, wedges=False,
        front_bold=False, fuse=None, attach=None, circle=False, shapes=None, labels=None, check=True, core=None):
    """Add a template: atoms are [element, xyz, charge] in Å (any units), seen as `view` gives
    (X right, Y up, Z towards the viewer). Bonds are [i, j, order] (+ display)."""
    P = np.array(view, dtype=float)
    # bond length 1 in the picture on average (so it draws at the drawing's bond length)
    proj = [np.linalg.norm(P[i, :2] - P[j, :2]) for i, j, *_ in bonds]
    k = 1 / np.mean(proj) if bonds else 1
    P = P * k
    x1, x2 = P[:, 0].min(), P[:, 0].max()
    y1, y2 = P[:, 1].min(), P[:, 1].max()
    P[:, 0] -= (x1 + x2) / 2
    P[:, 1] -= (y1 + y2) / 2
    P[:, 2] -= P[:, 2].mean()
    out_atoms = []
    for idx, (el, _, charge) in enumerate(atoms):
        a = [r3(P[idx, 0]), r3(-P[idx, 1]), el]
        lab = labels.get(idx) if labels else None
        if charge or lab:
            a.append(charge)
        if lab:
            a.append(lab)
        out_atoms.append(a)
    out_bonds = []
    for b in bonds:
        i, j, order = b[0], b[1], b[2]
        disp = b[3] if len(b) > 3 else None
        if wedges and disp is None and order == 1:
            # bonds from a stereocentre: towards the viewer wedged, away hashed (narrow end at the centre)
            dz = P[j, 2] - P[i, 2]
            if abs(dz) > 0.25:
                disp = 'wedge' if dz > 0 else 'hashWedge'
        tb = [i, j, order if order != 1.5 else 1]
        if disp:
            tb.append(disp)
        out_bonds.append(tb)
    if front_bold:
        rb = set(ring_bonds(len(atoms), bonds))
        zs = sorted(((P[b[0], 2] + P[b[1], 2]) / 2, k) for k, b in enumerate(bonds) if k in rb)
        # the bonds nearest the viewer (within a third of the ring's depth of the front)
        zmax, zmin = zs[-1][0], zs[0][0]
        for z, k in zs:
            if z > zmax - (zmax - zmin) * 0.34 and len(out_bonds[k]) == 3:
                out_bonds[k].append('bold')
    t = {'id': tid, 'name': name, 'group': group, 'atoms': out_atoms, 'bonds': out_bonds}
    if not flat:
        t['z'] = [r3(v) for v in P[:, 2]]
    rbs = ring_bonds(len(atoms), bonds)
    deg = [0] * len(atoms)
    for i, j, *_ in bonds:
        deg[i] += 1
        deg[j] += 1
    if fuse is None and rbs:
        heavy_deg = deg
        # an outside ring bond on the left, between carbons with no other bonds
        cands = [bonds[k] for k in rbs if heavy_deg[bonds[k][0]] == 2 and heavy_deg[bonds[k][1]] == 2]
        if not cands:
            cands = [bonds[k] for k in rbs]
        cands.sort(key=lambda b: (atoms[b[0]][0] != 'C' or atoms[b[1]][0] != 'C', P[b[0], 0] + P[b[1], 0]))
        fuse = [cands[0][0], cands[0][1]]
    if fuse:
        t['fuse'] = fuse
    if attach is None:
        ring_atoms = {bonds[k][0] for k in rbs} | {bonds[k][1] for k in rbs}
        order = sorted(range(len(atoms)), key=lambda i: (i not in ring_atoms and bool(rbs), atoms[i][0] != 'C', deg[i] != 2 if rbs else deg[i] != 1, P[i, 0]))
        attach = order[0]
    t['attach'] = attach
    if not rbs:
        t['join'] = 'bond'
    if circle:
        t['circle'] = circle
    if shapes:
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        t['shapes'] = [[sh[0], r3(sh[1] * k - cx), r3(-(sh[2] * k - cy)), r3(sh[3] * k - cx), r3(-(sh[4] * k - cy))] for sh in shapes]
    if check and smiles:
        n = core if core is not None else stub_start(atoms, bonds)
        verify(t, smiles, P[:n], atoms[:n], [b for b in bonds if b[0] < n and b[1] < n], stereo3d)
    TEMPLATES.append(t)
    return t


def stub_start(atoms, bonds):
    """Templates made by with_stubs list their stub atoms last: where they start."""
    return getattr(atoms, 'core', len(atoms))


def r3(v):
    return round(float(v) * 1000) / 1000 + 0.0


FAILED = []


def verify(t, smiles, P, atoms, bonds, stereo3d):
    rw = Chem.RWMol()
    for el, _, charge in atoms:
        a = Chem.Atom(el)
        a.SetFormalCharge(int(charge))
        rw.AddAtom(a)
    for b in bonds:
        o = b[2]
        rw.AddBond(int(b[0]), int(b[1]), Chem.BondType.DOUBLE if o == 2 else Chem.BondType.TRIPLE if o == 3 else Chem.BondType.AROMATIC if o == 1.5 else Chem.BondType.SINGLE)
    m = rw.GetMol()
    if any(b[2] == 1.5 for b in bonds):
        for a in m.GetAtoms():
            if a.GetIsAromatic() or any(bb.GetBondType() == Chem.BondType.AROMATIC for bb in a.GetBonds()):
                a.SetIsAromatic(True)
    try:
        Chem.SanitizeMol(m)
    except Exception as e:  # noqa: BLE001
        FAILED.append(f"{t['id']}: {e}")
        return
    if stereo3d:
        conf = Chem.Conformer(m.GetNumAtoms())
        for i in range(m.GetNumAtoms()):
            conf.SetAtomPosition(i, P[i].tolist())
        conf.Set3D(True)
        m.AddConformer(conf, assignId=True)
        Chem.AssignStereochemistryFrom3D(m)
        got = Chem.MolToSmiles(m)
        want = Chem.MolToSmiles(Chem.MolFromSmiles(smiles))
    else:
        got = Chem.MolToSmiles(m, isomericSmiles=False)
        want = Chem.MolToSmiles(Chem.MolFromSmiles(smiles), isomericSmiles=False)
    if got != want:
        FAILED.append(f"{t['id']}: built {got}, expected {want}")


# ------------------------------------------------------------------ the conformers

def xyz_of(atoms):
    return np.array([p for _, p, _ in atoms])


def ring_idx(n):
    return list(range(n))


def cyclohexanes():
    G = 'conformers'
    # chair: the energy minimum
    mol, xyz, _ = embed('C1CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'chair', 'Cyclohexane chair', 'C1CCCCC1', atoms, bonds, chair_view(xyz))
    add(G, 'chair-2', 'Cyclohexane chair (ring flipped)', 'C1CCCCC1', atoms, bonds, chair_view(xyz, flip=True))
    a, b = with_stubs('C1CCCCC1')
    add(G, 'chair-ae', 'Chair with axial and equatorial bonds', 'C1CCCCC1', a, b, chair_view(xyz_of(a), ring=ring_idx(6)))
    # boat: ring torsions 0, +ω, −ω, 0, +ω, −ω (C2v), held while the rest relaxes
    boat = torsion_list(ring_idx(6), [0, 52, -52, 0, 52, -52])
    mol, xyz, _ = embed('C1CCCCC1', boat)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'boat', 'Cyclohexane boat', 'C1CCCCC1', atoms, bonds, edge_view(xyz, bonds, prefer=tips_up(raised(xyz, ring_idx(6), 2))))
    a, b = with_stubs('C1CCCCC1', boat)
    add(G, 'boat-ae', 'Boat with all its bonds (flagpoles, bowsprits)', 'C1CCCCC1', a, b, edge_view(xyz_of(a), b, ring_idx(6), prefer=tips_up(raised(xyz_of(a), ring_idx(6), 2))))
    # twist-boat (D2): an energy minimum, reached from a twisted start
    tb = torsion_list(ring_idx(6), [31, 31, -65, 31, 31, -65])
    mol, xyz, _ = embed('C1CCCCC1', tb)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'twist-boat', 'Cyclohexane twist-boat', 'C1CCCCC1', atoms, bonds, edge_view(xyz, bonds))
    # cyclohexene half-chair (the minimum)
    mol, xyz, _ = embed('C1=CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'half-chair', 'Cyclohexene half-chair', 'C1=CCCCC1', atoms, bonds, edge_view(xyz, bonds))
    a, b = with_stubs('C1=CCCCC1', only={2, 3, 4, 5})
    add(G, 'half-chair-ae', 'Cyclohexene half-chair with its bonds', 'C1=CCCCC1', a, b, edge_view(xyz_of(a), b, ring_idx(6)))
    # cyclohexanone chair, the flattened end at the carbonyl
    mol, xyz, _ = embed('O=C1CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cyclohexanone', 'Cyclohexanone chair', 'O=C1CCCCC1', atoms, bonds, chair_view(xyz, ring=[1, 2, 3, 4, 5, 6]))


def chair_view(xyz, flip=False, ring=None, tilt=19):
    """A chair seen as in textbooks: the tips left and right, from 15–20° above its mean plane."""
    ring = ring if ring is not None else list(range(6))
    c, R = frame(xyz, ring)
    p = (xyz - c) @ R.T
    q = p[ring]
    # turn so that one ring atom (a tip) points along +x
    ang = math.atan2(q[0, 1], q[0, 0])
    p = p @ rot_z(-ang).T
    if p[ring[0], 2] < 0:
        p = p @ rot_x(math.pi).T  # left tip low, right tip high in the usual picture
    p = p @ rot_x(-math.pi / 2).T
    p = p @ rot_x(math.radians(tilt)).T
    if flip:
        p[:, 0] = -p[:, 0]
    return p


def boat_view(xyz, ring=None):
    """A boat from the side and a little above: bow and stern (the raised atoms) up."""
    ring = ring if ring is not None else list(range(6))
    c, R = frame(xyz, ring)
    p = (xyz - c) @ R.T
    q = p[ring]
    # the two atoms furthest from the mean plane (on the same side) are bow and stern
    k = int(np.argmax(np.abs(q[:, 2])))
    if q[k, 2] < 0:
        p = p @ rot_x(math.pi).T
        q = p[ring]
    ang = math.atan2(q[k, 1], q[k, 0])
    p = p @ rot_z(-ang).T
    p = p @ rot_x(-math.pi / 2).T
    p = p @ rot_x(math.radians(20)).T
    return p


def small_rings():
    G = 'conformers'
    # cyclopentane envelope (Cs): one ring torsion 0, the flap atom out of the plane of the other four
    env = [(1, 2, 3, 4, 0.0)]
    mol, xyz, _ = embed('C1CCCC1', env)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'envelope', 'Cyclopentane envelope', 'C1CCCC1', atoms, bonds, edge_view(xyz, bonds, prefer=tips_up(raised(xyz, ring_idx(5), 1))))
    a, b = with_stubs('C1CCCC1', env)
    add(G, 'envelope-ae', 'Envelope with all its bonds', 'C1CCCC1', a, b, edge_view(xyz_of(a), b, ring_idx(5), prefer=tips_up(raised(xyz_of(a), ring_idx(5), 1))))
    # half-chair (twist, C2): two neighbouring atoms either side of the plane of the other three
    tw = torsion_list(ring_idx(5), [0, 0, 0, 0, 0])
    tw = [(0, 1, 2, 3, 26), (1, 2, 3, 4, -42), (2, 3, 4, 0, 42), (3, 4, 0, 1, -26)]
    mol, xyz, _ = embed('C1CCCC1', tw)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c5-twist', 'Cyclopentane half-chair (twist)', 'C1CCCC1', atoms, bonds, edge_view(xyz, bonds))
    # cyclopentanone and cyclopentene envelopes
    mol, xyz, _ = embed('C1=CCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cyclopentene', 'Cyclopentene envelope', 'C1=CCCC1', atoms, bonds, edge_view(xyz, bonds))
    # puckered cyclobutane (butterfly)
    mol, xyz, _ = embed('C1CCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cyclobutane', 'Puckered cyclobutane', 'C1CCC1', atoms, bonds, edge_view(xyz, bonds))
    a, b = with_stubs('C1CCC1')
    add(G, 'cyclobutane-ae', 'Puckered cyclobutane with its bonds', 'C1CCC1', a, b, edge_view(xyz_of(a), b, ring_idx(4)))
    # cyclopropane, from just above its plane, with its bonds
    a, b = with_stubs('C1CC1')
    add(G, 'cyclopropane-ae', 'Cyclopropane with its bonds', 'C1CC1', a, b, edge_view(xyz_of(a), b, ring_idx(3)))


def flap_view(xyz, flap_hint, ring=None):
    """An envelope from the side: the flap atom up, at the back right."""
    ring = ring if ring is not None else list(range(5))
    c, R = frame(xyz, ring)
    p = (xyz - c) @ R.T
    q = p[ring]
    k = int(np.argmax(np.abs(q[:, 2])))
    if q[k, 2] < 0:
        p = p @ rot_x(math.pi).T
        q = p[ring]
    ang = math.atan2(q[k, 1], q[k, 0])
    p = p @ rot_z(-ang + math.radians(30)).T
    p = p @ rot_x(-math.pi / 2).T
    p = p @ rot_x(math.radians(20)).T
    return p


def medium_rings():
    G = 'conformers'
    # cycloheptane twist-chair and cyclooctane boat-chair: the lowest-energy conformers
    mol, xyz, _ = embed('C1CCCCCC1', confs=200)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c7-twist-chair', 'Cycloheptane twist-chair', 'C1CCCCCC1', atoms, bonds, edge_view(xyz, bonds))
    mol, xyz, _ = embed('C1CCCCCCC1', confs=300)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c8-boat-chair', 'Cyclooctane boat-chair', 'C1CCCCCCC1', atoms, bonds, edge_view(xyz, bonds))
    # cyclooctane crown (D4d): ring torsions ±87.5° alternately
    crown = torsion_list(ring_idx(8), [87.5, -87.5] * 4)
    mol, xyz, _ = embed('C1CCCCCCC1', crown)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c8-crown', 'Cyclooctane crown', 'C1CCCCCCC1', atoms, bonds, edge_view(xyz, bonds))
    # cyclooctatetraene tub (D2d)
    mol, xyz, _ = embed('C1=CC=CC=CC=C1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cot-tub', 'Cyclooctatetraene tub', 'C1=CC=CC=CC=C1', atoms, bonds, edge_view(xyz, bonds))


def wide(weight=0.15):
    """A view score: wider than tall (ring systems read along their length)."""
    def score(p):
        w = p[:, 0].max() - p[:, 0].min()
        h = p[:, 1].max() - p[:, 1].min()
        return weight * min(w / max(h, 1e-6), 4) / 4
    return score


def both(*fs):
    return lambda p: sum(f(p) for f in fs)


def fusion_kinds(smiles, seed=7):
    """For each bond shared by two rings: 'trans' or 'cis', from the H–C–C–H torsion of the
    lowest-energy 3-D structure (atoms without H, such as quaternary ones, are skipped)."""
    mol, xyz, cid = embed(smiles, keep_h=True, seed=seed)
    ri = mol.GetRingInfo()
    out = []
    for b in mol.GetBonds():
        if ri.NumBondRings(b.GetIdx()) < 2:
            continue
        i, j = b.GetBeginAtomIdx(), b.GetEndAtomIdx()
        hi = [n.GetIdx() for n in mol.GetAtomWithIdx(i).GetNeighbors() if n.GetAtomicNum() == 1]
        hj = [n.GetIdx() for n in mol.GetAtomWithIdx(j).GetNeighbors() if n.GetAtomicNum() == 1]
        if len(hi) != 1 or len(hj) != 1:
            continue
        conf = mol.GetConformer(cid)
        t = abs(T.GetDihedralDeg(conf, hi[0], i, j, hj[0]))
        out.append('trans' if t > 120 else 'cis')
    return out


def need(smiles, kinds):
    got = fusion_kinds(smiles)
    if sorted(got) != sorted(kinds):
        FAILED.append(f'{smiles}: ring fusions {got}, wanted {kinds}')


def mol3d(smiles, confs=60, seed=7, torsions=()):
    mol, xyz, _ = embed(smiles, torsions, confs=confs, seed=seed)
    atoms, bonds = from_mol(mol, xyz)
    return atoms, bonds, xyz


def ring_atoms_of(smiles):
    m = Chem.MolFromSmiles(smiles)
    return sorted({i for r in m.GetRingInfo().AtomRings() for i in r})


def fused():
    G = 'fused'
    items = [
        ('trans-decalin', 'trans-Decalin', 'C1CC[C@H]2CCCC[C@@H]2C1', ['trans']),
        ('cis-decalin', 'cis-Decalin', 'C1CC[C@H]2CCCC[C@H]2C1', ['cis']),
        ('trans-hydrindane', 'trans-Hydrindane', 'C1CC[C@H]2CCC[C@@H]2C1', ['trans']),
        ('cis-hydrindane', 'cis-Hydrindane', 'C1CC[C@H]2CCC[C@H]2C1', ['cis']),
        ('cis-bicyclooctane', 'cis-Bicyclo[3.3.0]octane (diquinane)', 'C1C[C@H]2CCC[C@H]2C1', ['cis']),
        ('perhydroazulene', 'cis-Perhydroazulene (hydroazulene of guaianes)', 'C1CC[C@H]2CCC[C@H]2CC1', ['cis']),
        ('trans-perhydrophenanthrene', 'Perhydrophenanthrene (trans-anti-trans)', 'C1CC[C@@H]2[C@@H](C1)CC[C@H]1CCCC[C@@H]12', ['trans', 'trans']),
        ('trans-perhydroanthracene', 'Perhydroanthracene (trans-anti-trans)', 'C1CC[C@@H]2C[C@H]3CCCC[C@@H]3C[C@H]2C1', ['trans', 'trans']),
    ]
    for tid, name, smi, kinds in items:
        need(smi, kinds)
        atoms, bonds, xyz = mol3d(smi)
        add(G, tid, name, smi, atoms, bonds, edge_view(xyz, bonds, elevs=(20, 25, 30), prefer=wide()), stereo3d=True)
    # steroids: 5α (A/B trans) and 5β (A/B cis), from 5α- and 5β-dihydrotestosterone with the
    # oxygens taken off, so the rings have the natural (8β,9α,10β,13β,14α) configuration
    for tid, name, dht in [
        ('steroid-5a', '5α-Steroid (androstane) skeleton', 'C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CC[C@@H]4[C@@]3(CCC(=O)C4)C'),
        ('steroid-5b', '5β-Steroid skeleton (A/B cis)', 'C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CC[C@H]4[C@@]3(CCC(=O)C4)C'),
    ]:
        mol, xyz, _ = embed(dht, confs=80)
        keep = [a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() == 'C']
        rw = Chem.RWMol(mol)
        for a in sorted((a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() != 'C'), reverse=True):
            rw.RemoveAtom(a)
        m2 = rw.GetMol()
        for b in m2.GetBonds():
            b.SetBondType(Chem.BondType.SINGLE)
        for a in m2.GetAtoms():
            a.SetNumExplicitHs(0)
            a.SetNoImplicit(False)
        Chem.SanitizeMol(m2)
        xyz2 = xyz[keep]
        atoms, bonds = from_mol(m2, xyz2)
        conf = Chem.Conformer(m2.GetNumAtoms())
        for i in range(m2.GetNumAtoms()):
            conf.SetAtomPosition(i, xyz2[i].tolist())
        m2.AddConformer(conf)
        Chem.AssignStereochemistryFrom3D(m2)
        smi = Chem.MolToSmiles(m2)
        add(G, tid, name, smi, atoms, bonds, edge_view(xyz2, bonds, elevs=(20, 25, 30), prefer=wide()), stereo3d=True)
    # bicyclo[3.3.1]nonane twin chair, adamantane, twistane, cubane
    for tid, name, smi in [
        ('adamantane-3d', 'Adamantane', 'C1C2CC3CC1CC(C2)C3'),
        ('twistane', 'Twistane', 'C1CC2CC3CC1CC2C3'),
        ('cubane', 'Cubane', 'C12C3C4C1C5C2C3C45'),
    ]:
        atoms, bonds, xyz = mol3d(smi)
        add(G, tid, name, smi, atoms, bonds, clearest(xyz, bonds))


def bicyclics():
    """Bicyclo[x.y.z]alkanes: the bridged ones seen so every bond shows, the fused ones (z = 0) cis."""
    G = 'bicyclics'
    def smiles_for(x, y, z):
        # bridgeheads 1 and 2; bridges of x, y and z carbons
        s = 'C12' + 'C' * x + 'C(' + 'C' * y + '1)' if False else None
        return s
    systems = [(1, 1, 0), (1, 1, 1), (2, 1, 0), (2, 1, 1), (2, 2, 0), (2, 2, 1), (2, 2, 2), (3, 1, 0), (3, 1, 1),
               (3, 2, 0), (3, 2, 1), (3, 2, 2), (3, 3, 0), (3, 3, 1), (3, 3, 2), (3, 3, 3), (4, 1, 0), (4, 1, 1),
               (4, 2, 0), (4, 2, 1), (4, 2, 2), (4, 3, 0), (4, 3, 1), (4, 4, 0), (4, 4, 1)]
    names = {(2, 2, 1): 'Norbornane, bicyclo[2.2.1]heptane', (3, 1, 1): 'Bicyclo[3.1.1]heptane (pinane ring system)',
             (4, 1, 0): 'Bicyclo[4.1.0]heptane (norcarane)', (2, 1, 0): 'Bicyclo[2.1.0]pentane (housane)',
             (4, 3, 0): 'Bicyclo[4.3.0]nonane (hydrindane)', (4, 4, 0): 'Bicyclo[4.4.0]decane (decalin)',
             (3, 2, 1): 'Bicyclo[3.2.1]octane (tropane ring system)'}
    for x, y, z in systems:
        # a ring of x + y + 2 atoms, the bridgeheads joined by z more
        n = x + y + 2
        ring = list(range(n))
        bh1, bh2 = 0, x + 1
        mol = Chem.RWMol()
        for _ in range(n + z):
            mol.AddAtom(Chem.Atom(6))
        for k in range(n):
            mol.AddBond(k, (k + 1) % n, Chem.BondType.SINGLE)
        if z == 0:
            mol.AddBond(bh1, bh2, Chem.BondType.SINGLE)
        else:
            prev = bh1
            for k in range(z):
                mol.AddBond(prev, n + k, Chem.BondType.SINGLE)
                prev = n + k
            mol.AddBond(prev, bh2, Chem.BondType.SINGLE)
        m = mol.GetMol()
        Chem.SanitizeMol(m)
        smi = Chem.MolToSmiles(m)
        if z == 0:
            # fused: the cis isomer (the only one for small rings, the usual one to draw)
            from rdkit.Chem.EnumerateStereoisomers import EnumerateStereoisomers
            isos = [Chem.MolToSmiles(i) for i in EnumerateStereoisomers(Chem.MolFromSmiles(smi))]
            cis = []
            for s2 in isos:
                try:
                    if fusion_kinds(s2) == ['cis']:
                        cis.append(s2)
                except RuntimeError:
                    pass
            if cis:
                smi = cis[0]
        try:
            atoms, bonds, xyz = mol3d(smi)
        except RuntimeError:
            continue
        name = names.get((x, y, z), f'Bicyclo[{x}.{y}.{z}]{ALKANE[x + y + z + 2]}')
        add(G, f'bicyclo{x}{y}{z}', name, smi, atoms, bonds, clearest(xyz, bonds), stereo3d=z == 0)


ALKANE = {4: 'butane', 5: 'pentane', 6: 'hexane', 7: 'heptane', 8: 'octane', 9: 'nonane', 10: 'decane', 11: 'undecane', 12: 'dodecane'}


def projections():
    G = 'projections'
    # Newman projections: the front carbon's bonds meet in the middle, the back carbon's start at
    # the rim of the circle that stands for it
    R = 0.42
    for tid, name, back in [('newman-staggered', 'Newman projection, staggered', 60), ('newman-eclipsed', 'Newman projection, eclipsed', 12)]:
        atoms = [['C', np.array([0.0, 0.0, 0.0]), 0]]
        bonds = []
        shapes = [['oval', -R, -R, R, R]]
        for k in range(3):
            a = math.radians(90 + 120 * k)
            atoms.append(['C', np.array([math.cos(a), math.sin(a), 0.0]), 0])
            bonds.append([0, len(atoms) - 1, 1])
            b = math.radians(90 + back + 120 * k)
            shapes.append(['line', R * math.cos(b), R * math.sin(b), math.cos(b) * 1.05, math.sin(b) * 1.05])
        add(G, tid, name, 'CC(C)C', atoms, bonds, np.array([p for _, p, _ in atoms]), flat=True, shapes=shapes, attach=0)
    # sawhorse projections: ethane's bonds as seen from above and to one side
    for tid, name, tor in [('sawhorse-staggered', 'Sawhorse projection, staggered', 180), ('sawhorse-eclipsed', 'Sawhorse projection, eclipsed', 0)]:
        a, b = with_stubs('CC', [(2, 0, 1, 5, tor)])
        xyz = xyz_of(a)
        # the C–C bond pointing away from the viewer, then seen from up and to the left
        d = xyz[1] - xyz[0]
        Rz = to_z(-d)
        p = (xyz - xyz[0]) @ Rz.T
        p = p @ rot_y(math.radians(-42)).T @ rot_x(math.radians(30)).T
        add(G, tid, name, 'CC', a, b, p, core=2)
    # Fischer projections: the chain up and down, the bonds across coming towards the viewer
    for n in (1, 2, 3, 4):
        atoms = []
        bonds = []
        for k in range(n + 2):
            atoms.append(['C', np.array([0.0, -k * 1.0, 0.0]), 0])
            if k:
                bonds.append([k - 1, k, 1])
        for k in range(1, n + 1):
            for sx in (-1, 1):
                atoms.append(['C', np.array([sx * 1.0, -k * 1.0, 0.0]), 0])
                bonds.append([k, len(atoms) - 1, 1])
        smi = Chem.MolToSmiles(mol_from(atoms, bonds))
        add(G, f'fischer-{n}', f'Fischer projection, {n} stereocentre' + ('s' if n > 1 else ''), smi, atoms, bonds, xyz_of(atoms), flat=True, attach=0)


def mol_from(atoms, bonds):
    rw = Chem.RWMol()
    for el, _, ch in atoms:
        a = Chem.Atom(el)
        a.SetFormalCharge(int(ch))
        rw.AddAtom(a)
    for b in bonds:
        rw.AddBond(int(b[0]), int(b[1]), {1: Chem.BondType.SINGLE, 2: Chem.BondType.DOUBLE, 3: Chem.BondType.TRIPLE}[b[2]])
    m = rw.GetMol()
    Chem.SanitizeMol(m)
    return m


def stereocentres():
    """Wedge-and-hash pictures of stereocentres, drawn as the IUPAC recommendations for
    graphical representations of stereochemistry (Pure Appl. Chem. 2006, 78, 1897) prefer: the
    wedged and hashed bonds next to each other, the plain bonds opposite."""
    G = 'stereo'
    def dirs(*angles):
        return [np.array([math.cos(math.radians(a)), math.sin(math.radians(a)), 0.0]) for a in angles]
    def centre(tid, name, spec, el='C', label=None, smi=None):
        atoms = [[el, np.zeros(3), 0]]
        bonds = []
        for ang, disp in spec:
            atoms.append(['C', dirs(ang)[0], 0])
            bonds.append([0, len(atoms) - 1, 1] + ([disp] if disp else []))
        labels = {0: label} if label else None
        add(G, tid, name, smi, atoms, bonds, xyz_of(atoms), flat=True, labels=labels, attach=1, check=smi is not None)
    centre('stereo-4a', 'Stereocentre: two plain bonds, a wedge and a hash', [(150, None), (30, None), (-60, 'wedge'), (-120, 'hashWedge')], smi='CC(C)(C)C')
    centre('stereo-4b', 'Stereocentre (mirror image)', [(150, None), (30, None), (-60, 'hashWedge'), (-120, 'wedge')], smi='CC(C)(C)C')
    centre('stereo-4c', 'Stereocentre: three plain bonds and a wedge', [(90, None), (210, None), (330, None), (270 + 25, 'wedge')], smi='CC(C)(C)C')
    centre('stereo-4d', 'Stereocentre: three plain bonds and a hash', [(90, None), (210, None), (330, None), (270 + 25, 'hashWedge')], smi='CC(C)(C)C')
    centre('stereo-tbp', 'Trigonal bipyramid', [(90, None), (270, None), (180, None), (-20, 'wedge'), (20, 'hashWedge')], label='M')
    centre('stereo-oct', 'Octahedron', [(90, None), (270, None), (195, 'wedge'), (-15, 'hashWedge'), (165, 'hashWedge'), (15, 'wedge')], label='M')
    centre('stereo-sqpy', 'Square pyramid', [(90, None), (195, 'wedge'), (-15, 'hashWedge'), (165, 'hashWedge'), (15, 'wedge')], label='M')
    centre('stereo-sqpl', 'Square planar, in perspective', [(195, 'wedge'), (-15, 'hashWedge'), (165, 'hashWedge'), (15, 'wedge')], label='M')
    # chains with stereocentres: zig-zag with wedges (syn) and wedge + hash (anti)
    def chain(tid, name, marks):
        atoms, bonds = [], []
        n = len(marks) + 2
        for k in range(n):
            atoms.append(['C', np.array([k * math.cos(math.radians(30)), 0.5 * (k % 2), 0.0]), 0])
            if k:
                bonds.append([k - 1, k, 1])
        for k, m in enumerate(marks, start=1):
            up = 1 if k % 2 else -1
            atoms.append(['C', atoms[k][1] + np.array([0, up * 1.0, 0]), 0])
            bonds.append([k, len(atoms) - 1, 1, m])
        add(G, tid, name, Chem.MolToSmiles(mol_from(atoms, [b[:3] for b in bonds])), atoms, bonds, xyz_of(atoms), flat=True, attach=0)
    chain('stereo-chain-1w', 'Chain with a wedged bond', ['wedge'])
    chain('stereo-chain-1h', 'Chain with a hashed bond', ['hashWedge'])
    chain('stereo-chain-syn', 'Two stereocentres, syn', ['wedge', 'hashWedge'])
    chain('stereo-chain-anti', 'Two stereocentres, anti', ['wedge', 'wedge'])
    chain('stereo-chain-3', 'Three stereocentres', ['wedge', 'hashWedge', 'wedge'])


def cycloalkanes():
    G = 'cycloalkanes'
    from rdkit.Chem import rdDepictor
    rdDepictor.SetPreferCoordGen(True)
    names = {9: 'Cyclononane', 10: 'Cyclodecane', 11: 'Cycloundecane', 12: 'Cyclododecane', 13: 'Cyclotridecane', 14: 'Cyclotetradecane',
             15: 'Cyclopentadecane', 16: 'Cyclohexadecane', 17: 'Cycloheptadecane', 18: 'Cyclooctadecane', 19: 'Cyclononadecane', 20: 'Cycloicosane'}
    for n in range(9, 21):
        smi = 'C1' + 'C' * (n - 1) + '1'
        atoms = [['C', np.array([math.cos(2 * math.pi * k / n + math.pi / 2), math.sin(2 * math.pi * k / n + math.pi / 2), 0.0]), 0] for k in range(n)]
        bonds = [[k, (k + 1) % n, 1] for k in range(n)]
        add(G, f'ring{n}', f'{names[n]} ({n})', smi, atoms, bonds, xyz_of(atoms), flat=True)
    for n in range(9, 21):
        smi = 'C1' + 'C' * (n - 1) + '1'
        m = Chem.MolFromSmiles(smi)
        rdDepictor.Compute2DCoords(m)
        c = m.GetConformer()
        atoms = [['C', np.array(list(c.GetAtomPosition(i))), 0] for i in range(n)]
        bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), 1] for b in m.GetBonds()]
        xyz = xyz_of(atoms)
        add(G, f'ring{n}-folded', f'{names[n]} ({n}), drawn with 120° angles', smi, atoms, bonds, flat_long(xyz), flat=True)


def flat_long(xyz):
    """A flat drawing turned so it is longest across the page."""
    c, R = frame(np.c_[xyz[:, :2], np.zeros(len(xyz))])
    ang = math.atan2(R[0][1], R[0][0])
    return (xyz - c) @ rot_z(-ang).T


def aromatics():
    G = 'aromatics'
    from rdkit.Chem import rdDepictor
    rdDepictor.SetPreferCoordGen(True)
    flat_list = [
        ('cyclopropenylium', 'Cyclopropenylium cation', 'C1=C[CH+]1'),
        ('cyclobutadiene', 'Cyclobutadiene', 'C1=CC=C1'),
        ('cyclopentadienide', 'Cyclopentadienide anion', '[cH-]1cccc1', True),
        ('tropylium', 'Tropylium cation', '[cH+]1cccccc1', True),
        ('cot-planar', 'Cyclooctatetraene (drawn flat)', 'C1=CC=CC=CC=C1'),
        ('pentalene', 'Pentalene', 'C1=CC2=CC=CC2=C1'),
        ('indene', 'Indene', 'C1C=Cc2ccccc21'),
        ('biphenylene', 'Biphenylene', 'c1ccc2c(c1)-c1ccccc1-2'),
        ('acenaphthylene', 'Acenaphthylene', 'C1=Cc2cccc3cccc1c23'),
        ('phenalene', '1H-Phenalene', 'C1C=Cc2cccc3cccc1c23'),
        ('fluoranthene', 'Fluoranthene', 'c1ccc-2c(c1)-c1cccc3cccc-2c13'),
        ('pyrene', 'Pyrene', 'c1cc2ccc3cccc4ccc(c1)c2c34'),
        ('tetracene', 'Tetracene', 'c1ccc2cc3cc4ccccc4cc3cc2c1'),
        ('pentacene', 'Pentacene', 'c1ccc2cc3cc4cc5ccccc5cc4cc3cc2c1'),
        ('chrysene', 'Chrysene', 'c1ccc2c(c1)ccc1c3ccccc3ccc21'),
        ('triphenylene', 'Triphenylene', 'c1ccc2c(c1)c1ccccc1c1ccccc21'),
        ('benzopyrene', 'Benzo[a]pyrene', 'c1ccc2c(c1)cc1ccc3cccc4ccc2c1c34'),
        ('perylene', 'Perylene', 'c1cc2cccc3c4cccc5cccc(c(c1)c23)c54'),
        ('coronene', 'Coronene', 'c1cc2ccc3ccc4ccc5ccc6ccc1c1c2c3c4c5c61'),
        ('porphine', 'Porphine', 'C1=CC2=NC1=CC1=CC=C(N1)C=C1C=CC(=N1)C=C1C=CC(N1)=C2'),
    ]
    for item in flat_list:
        tid, name, smi = item[:3]
        m = Chem.MolFromSmiles(smi)
        rdDepictor.Compute2DCoords(m)
        c = m.GetConformer()
        mk = Chem.Mol(m)
        Chem.Kekulize(mk, clearAromaticFlags=True)
        atoms = [[a.GetSymbol(), np.array(list(c.GetAtomPosition(a.GetIdx()))), a.GetFormalCharge()] for a in mk.GetAtoms()]
        bonds = [[b.GetBeginAtomIdx(), b.GetEndAtomIdx(), bond_order(b)] for b in mk.GetBonds()]
        circle = [list(r) for r in m.GetRingInfo().AtomRings()] if len(item) > 3 else None
        add(G, tid, name, smi, atoms, bonds, flat_long(xyz_of(atoms)), flat=True, circle=circle)
    # bent and three-dimensional ones
    for tid, name, smi, view in [
        ('corannulene', 'Corannulene (a bowl)', 'c1cc2ccc3ccc4ccc5ccc1c1c2c3c4c51', 'edge'),
        ('triptycene', 'Triptycene', 'c1ccc2c(c1)C1c3ccccc3C2c2ccccc21', 'best'),
    ]:
        atoms, bonds, xyz = mol3d(smi, confs=20)
        v = edge_view(xyz, bonds, elevs=(20, 30, 40)) if view == 'edge' else best_view(xyz, bonds, samples=800)
        add(G, tid, name, smi, atoms, bonds, v)
    # C60: a truncated icosahedron (the even permutations of (0, ±1, ±3φ), (±1, ±(2+φ), ±2φ), (±φ, ±2, ±(2φ+1)))
    phi = (1 + 5 ** 0.5) / 2
    base = [(0, 1, 3 * phi), (1, 2 + phi, 2 * phi), (phi, 2, 2 * phi + 1)]
    pts = set()
    for x, y, z in base:
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    v = (sx * x, sy * y, sz * z)
                    for perm in ((0, 1, 2), (1, 2, 0), (2, 0, 1)):
                        pts.add(tuple(round(v[i], 6) + 0.0 for i in perm))
    xyz = np.array(sorted(pts))
    bonds = []
    for i in range(len(xyz)):
        for j in range(i + 1, len(xyz)):
            if abs(np.linalg.norm(xyz[i] - xyz[j]) - 2) < 1e-3:
                bonds.append([i, j, 1])
    # double bonds: the bonds between two hexagons (6:6 bonds), one per atom
    adj = {i: [] for i in range(len(xyz))}
    for b in bonds:
        adj[b[0]].append(b[1])
        adj[b[1]].append(b[0])
    def in_pentagon(i, j):
        # a 6:5 bond lies on a five-membered ring: i and j share a neighbour path of length 3 back
        for k in adj[j]:
            if k == i:
                continue
            for l in adj[k]:
                if l in (i, j):
                    continue
                for mm in adj[l]:
                    if mm in adj[i] and mm not in (j, k, l):
                        return True
        return False
    for b in bonds:
        if not in_pentagon(b[0], b[1]):
            b[2] = 2
    atoms = [['C', p, 0] for p in xyz]
    add('aromatics', 'c60', 'Buckminsterfullerene, C60', None, atoms, bonds, look(xyz, yaw=15, pitch=20), check=False)


def perspective():
    G = 'perspective'
    # flat rings seen from above at an angle, the front bonds bold (as in Haworth drawings)
    names = {3: 'Cyclopropane', 4: 'Cyclobutane', 5: 'Cyclopentane', 6: 'Cyclohexane'}
    for n in (3, 4, 5, 6):
        for stubs in (False, True):
            atoms, bonds = [], []
            for k in range(n):
                a = 2 * math.pi * k / n + (math.pi / 2 if n % 2 else math.pi / n) + math.pi
                r = 0.5 / math.sin(math.pi / n)
                atoms.append(['C', np.array([r * math.cos(a), 0.0, r * math.sin(a)]), 0])
            for k in range(n):
                bonds.append([k, (k + 1) % n, 1])
            if stubs:
                for k in range(n):
                    for up in (1, -1):
                        atoms.append(['C', atoms[k][1] + np.array([0, up * 0.75, 0]), 0])
                        bonds.append([k, len(atoms) - 1, 1])
            xyz = xyz_of(atoms)
            p = xyz @ rot_x(math.radians(28)).T
            tid = f'persp{n}' + ('-subs' if stubs else '')
            add(G, tid, f'{names[n]} in perspective' + (', with bonds up and down' if stubs else ''), 'C1' + 'C' * (n - 1) + '1', atoms, bonds, p, front_bold=True, core=n)
    # aromatic rings seen at an angle (cyclopentadienyl and benzene ligands), drawn with a circle
    for n, ring_name in ((5, 'Cyclopentadienyl'), (6, 'Benzene')):
        for tilt, spin in ((0, 0), (55, 0), (70, 0), (55, 30), (55, 60), (55, 90)):
            atoms = []
            for k in range(n):
                a = 2 * math.pi * k / n + math.pi / 2
                atoms.append(['C', np.array([math.cos(a), math.sin(a), 0.0]), 0])
            bonds = [[k, (k + 1) % n, 1.5] for k in range(n)]
            xyz = xyz_of(atoms)
            p = xyz @ rot_x(math.radians(-tilt)).T @ rot_z(math.radians(spin)).T
            tid = f'persp-{"cp" if n == 5 else "bz"}-{tilt}-{spin}'
            nm = f'{ring_name} ring' + (f', tipped {tilt}°' if tilt else ', face on') + (f', turned {spin}°' if spin else '')
            add(G, tid, nm, 'c1ccccc1' if n == 6 else None, atoms, bonds, p, front_bold=bool(tilt), circle=[list(range(n))], flat=not tilt, check=n == 6)


def sugar_chairs():
    G = 'sugars'
    for tid, name, smi in [
        ('b-glc-chair', 'β-D-Glucopyranose, ⁴C₁ chair', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@@H]1O'),
        ('a-glc-chair', 'α-D-Glucopyranose, ⁴C₁ chair', 'OC[C@H]1O[C@H](O)[C@H](O)[C@@H](O)[C@@H]1O'),
        ('b-gal-chair', 'β-D-Galactopyranose, ⁴C₁ chair', 'OC[C@H]1O[C@@H](O)[C@H](O)[C@@H](O)[C@H]1O'),
        ('b-man-chair', 'β-D-Mannopyranose, ⁴C₁ chair', 'OC[C@H]1O[C@@H](O)[C@@H](O)[C@@H](O)[C@@H]1O'),
    ]:
        atoms, bonds, xyz = mol3d(smi, confs=80)
        # ring in order C1, C2, C3, C4, C5, O5 (atom indexes in the SMILES)
        ring = [4, 6, 8, 10, 2, 3]
        p = pyranose_view(xyz, ring)
        add(G, tid, name, smi, atoms, bonds, p, stereo3d=True, attach=5)


def pyranose_view(xyz, ring):
    """A ⁴C₁ pyranose as usually drawn: C1 the right-hand tip, below C4 at the left-hand tip,
    with the ring oxygen at the back if the chair allows (seen from whichever face does)."""
    c, R = frame(xyz, ring)
    best = None
    for face in (np.eye(3), rot_x(math.pi)):
        p = (xyz - c) @ R.T @ face.T
        ang = math.atan2(p[ring[0], 1], p[ring[0], 0])
        p = p @ rot_z(-ang).T
        p = p @ rot_x(-math.pi / 2).T
        p = p @ rot_x(math.radians(19)).T
        score = 2 * (p[ring[3], 1] > p[ring[0], 1]) + (p[ring[5], 2] < 0)
        if best is None or score > best[0]:
            best = (score, p)
    return best[1]


# ------------------------------------------------------------------ main


def main():
    only = dict(a.split('=') for a in sys.argv if '=' in a).get('only')
    for f in FAMILIES:
        if not only or f.__name__ in only.split(','):
            f()
    if FAILED:
        print('\n'.join(FAILED), file=sys.stderr)
        sys.exit(1)
    if not only:
        OUT.write_text('[\n' + ',\n'.join('  ' + json.dumps(t, separators=(',', ':'), ensure_ascii=False) for t in TEMPLATES) + '\n]\n', encoding='utf-8')
        print(f'Wrote {len(TEMPLATES)} templates to {OUT.relative_to(ROOT)}')
    if '--png' in sys.argv:
        draw_all(Path(sys.argv[sys.argv.index('--png') + 1]))


FAMILIES = [cyclohexanes, small_rings, medium_rings, fused, bicyclics, projections, stereocentres, cycloalkanes, aromatics, perspective, sugar_chairs]


def draw_all(folder):
    from PIL import Image, ImageDraw
    folder.mkdir(parents=True, exist_ok=True)
    cell = int(dict(a.split('=') for a in sys.argv if '=' in a).get('cell', 180))
    cols = 1080 // cell
    rows = math.ceil(len(TEMPLATES) / cols)
    img = Image.new('RGB', (cols * cell, rows * cell), 'white')
    d = ImageDraw.Draw(img)
    for n, t in enumerate(TEMPLATES):
        ox, oy = (n % cols) * cell, (n // cols) * cell
        d.rectangle([ox, oy, ox + cell - 1, oy + cell - 1], outline='#ccc')
        xs = [a[0] for a in t['atoms']]
        ys = [a[1] for a in t['atoms']]
        span = max(max(xs) - min(xs), max(ys) - min(ys), 1)
        s = (cell - 40) / span
        pt = lambda i: (ox + cell / 2 + t['atoms'][i][0] * s, oy + cell / 2 + 6 + t['atoms'][i][1] * s)
        for b in t['bonds']:
            w = 4 if len(b) > 3 and b[3] == 'bold' else 1
            col = 'black' if len(b) <= 3 or b[3] == 'bold' else ('#c00' if b[3] == 'wedge' else '#06c')
            d.line([pt(b[0]), pt(b[1])], fill=col, width=w)
            if b[2] == 2:
                (x1, y1), (x2, y2) = pt(b[0]), pt(b[1])
                L = math.hypot(x2 - x1, y2 - y1) or 1
                nx, ny = -(y2 - y1) / L * 4, (x2 - x1) / L * 4
                d.line([(x1 + nx, y1 + ny), (x2 + nx, y2 + ny)], fill=col, width=1)
        for i, a in enumerate(t['atoms']):
            if a[2] != 'C':
                x, y = pt(i)
                d.text((x - 4, y - 6), a[2], fill='#a00')
        if 'fuse' in t:
            d.line([pt(t['fuse'][0]), pt(t['fuse'][1])], fill='#0a0', width=2)
        d.text((ox + 4, oy + 3), t['id'], fill='#555')
    img.save(folder / 'templates.png')
    print(f'Drew {folder / "templates.png"}')


if __name__ == '__main__':
    main()
