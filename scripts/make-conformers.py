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


# axial and equatorial bonds are drawn this long (in bond lengths): shorter than the ring's
# bonds, as in textbook pictures (a real C–H is 0.71 of a C–C)
STUB = 0.75
# how much more puckered than they are rings are drawn (see conv_view)
PUCKER = 1.8
VERBOSE = '-v' in sys.argv


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
    atoms (element, xyz) and bonds, with every C–H turned into a C–C stub (add() draws stubs
    STUB bond lengths long)."""
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


def conv_view(xyz, ring, right, left=None, up=None, tilt=20, turn=0, stretch=1.0, face=1):
    """The textbook view of a ring or ring system: its mean plane seen almost edge on, from
    `tilt`° above, the `right` atom(s) at the right-hand end and `left` (or the middle) at the
    left, the face that `up` atoms (or the right-hand end) lie on facing up, so axial bonds run
    straight up and down the page. `turn` swings the far side round to the right (degrees),
    which is how a chair's back and front bonds are kept apart. Returns X right, Y up, Z
    towards the viewer."""
    pt = lambda k: xyz[list(k)].mean(axis=0) if isinstance(k, (list, tuple, set)) else xyz[k]
    c, R = frame(xyz, ring)
    n = R[2]
    ref = pt(up) if up is not None else pt(right)
    if np.dot(ref - c, n) * face < 0:
        n = -n
    v = pt(right) - (pt(left) if left is not None else c)
    h = v - np.dot(v, n) * n
    h = h / np.linalg.norm(h)
    f = np.cross(h, n)  # towards the viewer
    a = math.radians(turn)
    h, f = h * math.cos(a) + f * math.sin(a), f * math.cos(a) - h * math.sin(a)
    t = math.radians(tilt)
    Z = f * math.cos(t) + n * math.sin(t)
    Y = n * math.cos(t) - f * math.sin(t)
    q = xyz - c
    # textbooks draw rings more puckered than they are: the depth across the mean plane
    # stretched (which keeps parallel bonds parallel and axial bonds upright)
    q = q + np.outer(q @ n, n) * (stretch - 1)
    return np.c_[q @ h, q @ Y, q @ Z]


def straightest(p, bonds):
    """The widest angle between two bonds at an atom in the picture (degrees)."""
    q = p[:, :2]
    nb = {}
    for i, j, *_ in bonds:
        nb.setdefault(i, []).append(j)
        nb.setdefault(j, []).append(i)
    worst = 0
    for c, ns in nb.items():
        for x in range(len(ns)):
            for y in range(x + 1, len(ns)):
                u, w = q[ns[x]] - q[c], q[ns[y]] - q[c]
                cosv = np.dot(u, w) / max(1e-9, np.linalg.norm(u) * np.linalg.norm(w))
                worst = max(worst, math.degrees(math.acos(max(-1, min(1, cosv)))))
    return worst


def restub(p, bonds, core):
    """Axial and equatorial stubs (bonds to atoms from `core` on) cut to STUB of the ring's
    bond length, after a view has stretched them."""
    if core is None or core >= len(p):
        return p
    p = p.copy()
    L = np.mean([np.linalg.norm(p[i] - p[j]) for i, j, *_ in bonds if i < core and j < core])
    for i, j, *_ in bonds:
        a, b = (i, j) if j >= core else (j, i)
        if b >= core and a < core:
            d = p[b] - p[a]
            p[b] = p[a] + d / np.linalg.norm(d) * L * STUB
    return p


def gaps(p, bonds):
    """The closest an atom comes to another atom, and to a bond it is not on, in bond lengths."""
    q = p[:, :2]
    L = core_bond(q, bonds)
    aa = min((np.linalg.norm(q[i] - q[j]) for i in range(len(q)) for j in range(i + 1, len(q))), default=9) / L
    ab = 9.0
    for i, j, *_ in bonds:
        for k in range(len(q)):
            if k not in (i, j):
                ab = min(ab, seg_dist(q[k], q[i], q[j]) / L)
    return aa, ab


LAST_VIEW = LAST_PICK = None


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


def core_bond(q, bonds):
    """The mean bond length in the picture, leaving out bonds to end atoms (stubs)."""
    deg = {}
    for i, j, *_ in bonds:
        deg[i] = deg.get(i, 0) + 1
        deg[j] = deg.get(j, 0) + 1
    inner = [np.linalg.norm(q[i] - q[j]) for i, j, *_ in bonds if deg[i] > 1 and deg[j] > 1]
    return np.mean(inner or [np.linalg.norm(q[i] - q[j]) for i, j, *_ in bonds])


def clarity(p, bonds):
    q = p[:, :2]
    L = core_bond(q, bonds)
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


# ------------------------------------------------------------------ textbook drawings
#
# Textbooks do not draw a chair as its true shadow. Every ring bond is drawn the same length,
# in one of three directions, opposite bonds parallel, axial bonds straight up and down, and
# each equatorial bond parallel to the ring bonds one along (measured from textbook and
# teaching drawings, e.g. Antonelli, Nascimento & Cunha, Rev. Virtual Quim. 2024,
# doi:10.21577/1984-6835.20240007). That is a picture of the diamond lattice: the chair's
# bonds, and those of decalins, steroids and adamantane, all run along the lattice's four bond
# directions, and each of the four is given its own direction on the page (LW). Bonds that do
# not lie along the lattice (in a five-membered ring, a boat's bow) are drawn by the oblique
# projection that comes closest to that (LA). src/chem/fuse3d.ts uses the same numbers to read
# such drawings back into 3-D, so keep the two in step.

S8 = math.sqrt(8) / 3
# the lattice's bond directions in the canonical frame (x right, y away from the viewer, z up):
# from a "down" atom of a chair (the left-hand tip) to the ring atom behind it on the right,
# to the equatorial direction (left), to the ring atom in front on the right, and axial (down)
LT = np.array([[S8 / 2, S8 * math.sqrt(3) / 2, 1 / 3], [-S8, 0, 1 / 3], [S8 / 2, -S8 * math.sqrt(3) / 2, 1 / 3], [0, 0, -1.0]])
# and on the page (x right, y up): steep, gentle up to the left, gentle up to the right, down
LW_DEG = (56, 165, 12, 270)
LW = np.array([[math.cos(math.radians(d)), math.sin(math.radians(d))] for d in LW_DEG])


def _oblique():
    """The linear projection nearest LW that keeps vertical lines vertical."""
    ax, *_ = np.linalg.lstsq(LT[:, :2], LW[:, 0], rcond=None)
    ay, *_ = np.linalg.lstsq(LT, LW[:, 1], rcond=None)
    return np.array([[ax[0], ax[1], 0.0], ay])


LA = _oblique()


def vocab(mirror):
    """(lattice directions, page directions, oblique projection), or their mirror images
    (left and right swapped in both), which draw a chair the other way round."""
    if not mirror:
        return LT, LW, LA
    return LT * [-1, 1, 1], LW * [-1, 1], LA * np.array([[1, -1, -1], [-1, 1, 1]])


def towards_viewer(A):
    _, _, vt = np.linalg.svd(A)
    k = vt[2]
    return k if k[1] < 0 else -k


def ideal_chair(T):
    return np.array([[0, 0, 0], T[0], T[0] - T[1], T[0] - T[1] + T[2], T[2] - T[1], T[2]])


def kabsch(a, b):
    """The proper rotation R and shift t with a @ R.T + t ≈ b, and the rms miss."""
    ca, cb = a.mean(0), b.mean(0)
    U, _, Vt = np.linalg.svd((a - ca).T @ (b - cb))
    d = np.sign(np.linalg.det(Vt.T @ U.T))
    R = Vt.T @ np.diag([1, 1, d]) @ U.T
    rms = np.sqrt(np.mean(np.sum(((a - ca) @ R.T - (b - cb)) ** 2, axis=1)))
    return R, cb - ca @ R.T, rms


def mean_bond(xyz, bonds):
    return np.mean([np.linalg.norm(xyz[i] - xyz[j]) for i, j, *_ in bonds])


def chair_frames(xyz, ring, mirror, on=None):
    """The ways of laying the chair `ring` (atoms in ring order) on the lattice's chair, as
    (rotation, shift, bond length). `on`: the chair positions (0–5) its atoms go to, if only
    some of them (a boat's other five atoms)."""
    T, _, _ = vocab(mirror)
    ideal = ideal_chair(T)
    n = len(ring)
    L = mean_bond(xyz, [[ring[k], ring[(k + 1) % n]] for k in range(n)])
    pos = on if on is not None else list(range(n))
    out = []
    for k in range(n):
        for d in (1, -1):
            order = [ring[(k + d * m) % n] for m in range(n)]
            R, t, rms = kabsch(xyz[order] / L, ideal[pos])
            if rms < 0.2:
                out.append((R, t, L))
    return out


def textbook(Q, bonds, mirror, snap=15, lattice=None, even=False):
    """The textbook picture of atoms Q (in the canonical frame, bonds about 1 long): bonds
    within `snap`° of a lattice direction are drawn along its page direction, others by the
    oblique projection, and the atoms placed to fit them all best (exactly, on the lattice).
    `lattice(k)`: whether bond k may be snapped; `even`: the other bonds evened out (see
    even_out). Returns the picture (x, y and depth) and the
    tidied 3-D shape (lattice bonds made exact)."""
    T, W, A = vocab(mirror)
    n = len(Q)
    d2, d3 = [], []
    cs = math.cos(math.radians(snap)) if snap else 2
    for k, (i, j, *_) in enumerate(bonds):
        v = Q[j] - Q[i]
        c = T @ (v / np.linalg.norm(v))
        m = int(np.argmax(np.abs(c)))
        if abs(c[m]) >= cs and (lattice is None or lattice(k)):
            d2.append(np.sign(c[m]) * W[m])
            d3.append(np.sign(c[m]) * T[m])
        else:
            d2.append(A @ v)
            d3.append(v)

    def solve(ds, dim):
        M = np.zeros((len(bonds) + 1, n))
        rhs = np.zeros((len(bonds) + 1, dim))
        for r, (b, d) in enumerate(zip(bonds, ds)):
            M[r, b[0]], M[r, b[1]] = -1, 1
            rhs[r] = d
        M[-1, 0] = 1
        X, *_ = np.linalg.lstsq(M, rhs, rcond=None)
        return X

    p2, q3 = solve(d2, 2), solve(d3, 3)
    snapped = [k for k, d in enumerate(d3) if any(np.allclose(np.abs(d), np.abs(t)) for t in T)]
    if even:
        p2 = even_out(p2, bonds, snapped)
    return np.c_[p2, q3 @ towards_viewer(A)], q3


def even_out(p, bonds, snapped, keep=0.08, steps=400):
    """Textbooks draw every bond the same length: the bonds not drawn along the lattice
    stretched or shrunk towards one bond length, the atoms moving as little as they can (those
    with only lattice bonds stay put)."""
    free = np.ones(len(p), bool)
    loose = [b for k, b in enumerate(bonds) if k not in snapped]
    if not loose:
        return p
    touched = {i for b in loose for i in b[:2]}
    for i in range(len(p)):
        free[i] = i in touched
    p0 = p.copy()
    p = p.copy()
    for _ in range(steps):
        g = keep * (p - p0)
        for i, j, *_ in loose:
            d = p[j] - p[i]
            L = np.linalg.norm(d) or 1e-9
            f = (L - 1) * d / L
            g[i] -= f
            g[j] += f
        p[free] -= 0.2 * g[free]
    return p


def pic_score(P, bonds, core=None):
    """Nothing on top of anything else, then as few crossing bonds as can be (an axial bond
    passing behind a ring bond, as textbooks draw it, hardly counts)."""
    aa, ab = gaps(P, bonds)
    q = P[:, :2]
    cr = 0
    for x in range(len(bonds)):
        for y in range(x + 1, len(bonds)):
            i, j = bonds[x][:2]
            k, l = bonds[y][:2]
            if len({i, j, k, l}) == 4 and crosses(q[i], q[j], q[k], q[l]):
                stub = core is not None and max(i, j, k, l) >= core
                cr += 0.05 if stub else 1
    # and no bond drawn much shorter than the rest (seen end on)
    L = core_bond(q, bonds)
    short = sum(max(0, 0.6 - np.linalg.norm(q[i] - q[j]) / L) for i, j, *_ in bonds if core is None or max(i, j) < core)
    # nor two bonds at an atom in a straight line
    flat = max(0, straightest(P[:, :2] if core is None else P[:core, :2], [b for b in bonds if core is None or max(b[:2]) < core]) - 160)
    return -10 * max(0, 0.36 - aa) - 10 * max(0, 0.2 - ab) - 0.3 * cr - 2 * short - 0.03 * flat


def rings_of(n_atoms, bonds, size=None):
    m = Chem.RWMol()
    for _ in range(n_atoms):
        m.AddAtom(Chem.Atom(6))
    for i, j, *_ in bonds:
        m.AddBond(int(i), int(j), Chem.BondType.SINGLE)
    m = m.GetMol()
    m.UpdatePropertyCache(False)
    return [ring_order(list(r), bonds) for r in Chem.GetSymmSSSR(m) if size is None or len(r) == size]


def ring_order(ring, bonds):
    adj = {}
    for i, j, *_ in bonds:
        adj.setdefault(i, set()).add(j)
        adj.setdefault(j, set()).add(i)
    s = set(ring)
    out = [ring[0]]
    while len(out) < len(ring):
        out.append(next(x for x in adj[out[-1]] if x in s and x not in out))
    return out


class Pic:
    """A chosen picture: atoms on the page (x, y, depth) and the 3-D shape behind it."""
    def __init__(self, score, P, q3, mirror):
        self.score, self.P, self.q3, self.mirror = score, P, q3, mirror


def distinct(cands, top):
    out = []
    for c in sorted(cands, key=lambda c: -c.score):
        if any(np.allclose(c.P[:, :2] - c.P[0, :2], o.P[:, :2] - o.P[0, :2], atol=0.05) for o in out):
            continue
        out.append(c)
    return out[:top]


def lattice_pics(xyz, bonds, prefer=None, core=None, mirrors=(False, True), rings=None, on=None, top=1, snap=15, lattice=None):
    """Textbook pictures of a molecule built on chairs, each of its chairs (or `rings`) in turn
    laid on the lattice's chair, best first."""
    cands = []
    for mirror in mirrors:
        for r in (rings if rings is not None else rings_of(len(xyz), bonds, 6)):
            for R, t, L in chair_frames(xyz, r, mirror, on):
                P, q3 = textbook((xyz / L) @ R.T + t, bonds, mirror, snap, lattice, even=True)
                cands.append(Pic(pic_score(P, bonds, core) + (prefer(P) if prefer else 0), P, q3, mirror))
    return distinct(cands, top)


def oblique_pics(xyz, bonds, ring, prefer=None, core=None, mirrors=(False, True), top=1, snap=15, turns=range(0, 360, 5), tilts=(0,)):
    """Textbook pictures of a ring that is not a chair: its mean plane level (as a chair's is),
    turned about the vertical every 5°, either face up, drawn as textbook() does."""
    c, R = frame(xyz, ring)
    L = mean_bond(xyz, [[ring[k], ring[(k + 1) % len(ring)]] for k in range(len(ring))])
    base = (xyz - c) @ R.T / L
    cands = []
    for mirror in mirrors:
        for flip in (False, True):
            b = base @ rot_x(math.pi).T if flip else base
            for tu in turns:
                for ti in tilts:
                    Q = b @ rot_z(math.radians(tu)).T @ rot_x(math.radians(ti)).T
                    P, q3 = textbook(Q, bonds, mirror, snap)
                    cands.append(Pic(pic_score(P, bonds, core) + (prefer(P) if prefer else 0), P, q3, mirror))
    return distinct(cands, top)


def framed_pics(Q, bonds, prefer=None, core=None, mirrors=(False, True), top=1, snap=15, spins=(0,), tilts=(0,)):
    """Textbook pictures of atoms already set up in the canonical frame (x right, y away, z
    up), turned a little about the vertical (`spins`) and tipped (`tilts`) for clarity."""
    cands = []
    for mirror in mirrors:
        for sp in spins:
            for ti in tilts:
                Q2 = Q @ rot_z(math.radians(sp)).T @ rot_x(math.radians(ti)).T
                P, q3 = textbook(Q2, bonds, mirror, snap)
                cands.append(Pic(pic_score(P, bonds, core) + (prefer(P) if prefer else 0), P, q3, mirror))
    return distinct(cands, top)


def like(pic, ring, xyz, bonds, core=None, snap=15):
    """The same view as `pic` of another version of the molecule (one with its axial and
    equatorial bonds): its `ring` atoms laid on the picture's."""
    L = mean_bond(xyz, [[ring[k], ring[(k + 1) % len(ring)]] for k in range(len(ring))])
    R, t, _ = kabsch(xyz[ring] / L, pic.q3[ring])
    P, q3 = textbook((xyz / L) @ R.T + t, bonds, pic.mirror, snap)
    return Pic(pic_score(P, bonds, core), P, q3, pic.mirror)


def with_bonds(pics, ring, xyz, bonds, core, snap=15):
    """Of several views of a ring, the one that also shows the ring with all its axial and
    equatorial bonds (`xyz`, `bonds`) clearly: (bare picture, picture with the bonds)."""
    pairs = [(p, like(p, ring, xyz, bonds, core, snap)) for p in pics]
    return max(pairs, key=lambda pq: pq[0].score + pq[1].score)


def vertical_ring_bonds(P, bonds):
    rb = ring_bonds(len(P), bonds)
    return sum(1 for k in rb if abs(P[bonds[k][1], 0] - P[bonds[k][0], 0]) < 0.1 * np.linalg.norm(P[bonds[k][1], :2] - P[bonds[k][0], :2]))


def wide_pic(P, weight=0.1):
    return weight * min(np.ptp(P[:, 0]) / max(np.ptp(P[:, 1]), 1e-6), 4)


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
    (X right, Y up, Z towards the viewer). Bonds are [i, j, order] (+ display). A textbook
    picture (a Pic) also gives the 3-D shape behind it, saved as `xyz` for fusing."""
    shape = None
    if isinstance(view, Pic):
        shape = view.q3 - view.q3.mean(axis=0)
        view = view.P
    P = np.array(view, dtype=float)
    if isinstance(atoms, Stubbed):
        P = restub(P, bonds, atoms.core)
    # bond length 1 in the picture on average (so it draws at the drawing's bond length), not
    # counting the shorter axial and equatorial stubs
    n_core = core if core is not None else stub_start(atoms, bonds)
    proj = [np.linalg.norm(P[i, :2] - P[j, :2]) for i, j, *_ in bonds if i < n_core and j < n_core] or \
        [np.linalg.norm(P[i, :2] - P[j, :2]) for i, j, *_ in bonds]
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
    if shape is not None:
        n_core = core if core is not None else stub_start(atoms, bonds)
        s3 = mean_bond(shape, [b for b in bonds if b[0] < n_core and b[1] < n_core] or bonds)
        t['xyz'] = [[r3(v / s3) for v in row] for row in shape]
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
        verify(t, smiles, (shape if shape is not None else P)[:n], atoms[:n], [b for b in bonds if b[0] < n and b[1] < n], stereo3d)
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
    R6 = ring_idx(6)
    # chair: the energy minimum, drawn the textbook way (left-hand tip down, right-hand tip up),
    # and the other way round (the chair after a ring flip)
    mol, xyz, _ = embed('C1CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'chair', 'Cyclohexane chair', 'C1CCCCC1', atoms, bonds, lattice_pics(xyz, bonds, mirrors=(False,))[0])
    add(G, 'chair-2', 'Cyclohexane chair (ring flipped)', 'C1CCCCC1', atoms, bonds, lattice_pics(xyz, bonds, mirrors=(True,))[0])
    a, b = with_stubs('C1CCCCC1')
    xa = xyz_of(a)
    add(G, 'chair-ae', 'Chair with axial and equatorial bonds', 'C1CCCCC1', a, b, lattice_pics(xa, b, core=a.core, rings=[R6], mirrors=(False,))[0])
    add(G, 'chair-ae-2', 'Chair with axial and equatorial bonds (ring flipped)', 'C1CCCCC1', a, b, lattice_pics(xa, b, core=a.core, rings=[R6], mirrors=(True,))[0])
    # boat: ring torsions 0, +ω, −ω, 0, +ω, −ω (C2v), held while the rest relaxes; drawn from the
    # side, bow and stern up at the two ends
    boat = torsion_list(R6, [0, 52, -52, 0, 52, -52])
    mol, xyz, _ = embed('C1CCCCC1', boat)
    atoms, bonds = from_mol(mol, xyz)
    a, b = with_stubs('C1CCCCC1', boat)
    pic = side_boat(xyz, bonds, R6, raised(xyz, R6, 2))
    pic_ae = side_boat(xyz_of(a), b, R6, None, a.core, ref=pic.q3[R6])
    add(G, 'boat', 'Cyclohexane boat', 'C1CCCCC1', atoms, bonds, pic)
    add(G, 'boat-ae', 'Boat with all its bonds (flagpoles, bowsprits)', 'C1CCCCC1', a, b, pic_ae)
    # twist-boat (D2): an energy minimum, reached from a twisted start
    tb = torsion_list(R6, [31, 31, -65, 31, 31, -65])
    mol, xyz, _ = embed('C1CCCCC1', tb)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'twist-boat', 'Cyclohexane twist-boat', 'C1CCCCC1', atoms, bonds, oblique_pics(xyz, bonds, R6, prefer=wide_pic)[0])
    # cyclohexene half-chair (the minimum): four atoms in a plane, the double bond at the front,
    # the other two either side of the plane
    mol, xyz, _ = embed('C1=CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    def front(P):
        v = P[1, :2] - P[0, :2]
        level = 1 - abs(math.degrees(math.atan2(abs(v[1]), abs(v[0])))) / 45
        return 0.2 * (P[0, 1] + P[1, 1] < P[3, 1] + P[4, 1]) + 0.2 * level + wide_pic(P)
    a, b = with_stubs('C1=CCCCC1', only={2, 3, 4, 5})
    pic, pic_ae = with_bonds(oblique_pics(xyz, bonds, R6, prefer=front, top=12), R6, xyz_of(a), b, a.core)
    add(G, 'half-chair', 'Cyclohexene half-chair', 'C1=CCCCC1', atoms, bonds, pic)
    add(G, 'half-chair-ae', 'Cyclohexene half-chair with its bonds', 'C1=CCCCC1', a, b, pic_ae)
    # cyclohexanone chair, the carbonyl at the right-hand tip
    mol, xyz, _ = embed('O=C1CCCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cyclohexanone', 'Cyclohexanone chair', 'O=C1CCCCC1', atoms, bonds,
        lattice_pics(xyz, bonds, rings=[[1, 2, 3, 4, 5, 6]], mirrors=(False,), prefer=lambda P: 0.5 * (P[0, 0] == P[:, 0].max()))[0])


def side_boat(xyz, bonds, ring, tips, core=None, ref=None, tilts=range(8, 27, 2)):
    """A boat as textbooks draw it: square on from the side (straight, not oblique, so it is
    symmetric), bow and stern up at the ends, seen a little from above. `ref`: the bare boat's
    ring (atoms in the order of `ring`) to lay this one on, so a boat with its bonds is seen the
    same way. Returns the best Pic over the tilts."""
    n = len(ring)
    L = mean_bond(xyz, [[ring[k], ring[(k + 1) % n]] for k in range(n)])
    if ref is not None:
        R, t, _ = kabsch(xyz[ring] / L, ref)
        Q = (xyz / L) @ R.T + t
    else:
        c, F = frame(xyz, ring)
        nz = F[2] if np.dot(xyz[tips].mean(0) - c, F[2]) > 0 else -F[2]
        ex = xyz[tips[1]] - xyz[tips[0]]
        ex -= np.dot(ex, nz) * nz
        ex /= np.linalg.norm(ex)
        Q = (xyz - c) @ np.array([ex, np.cross(nz, ex), nz]).T / L
    cands = []
    for ti in tilts:
        a = math.radians(ti)
        # the far side tipped up into view
        y = Q[:, 1] * math.cos(a) - Q[:, 2] * math.sin(a)
        z = Q[:, 2] * math.cos(a) + Q[:, 1] * math.sin(a)
        P = np.c_[Q[:, 0], z, -y]
        cands.append(Pic(pic_score(P, bonds, core), P, Q, False))
    return max(cands, key=lambda c: c.score)


def envelope_pics(xyz, bonds, ring, flap, top=1):
    """An envelope drawn as a boat is, from the side: the four atoms in a plane along the page
    (two bonds running back level), the flap up at one end."""
    k = ring.index(flap)
    n = len(ring)
    far = (xyz[ring[(k + 2) % n]] + xyz[ring[(k + 3) % n]]) / 2
    c, R = frame(xyz, ring)
    nz = R[2] if np.dot(xyz[flap] - c, R[2]) > 0 else -R[2]
    ex = xyz[flap] - far
    ex -= np.dot(ex, nz) * nz
    ex /= np.linalg.norm(ex)
    ey = np.cross(nz, ex)
    L = mean_bond(xyz, [[ring[m], ring[(m + 1) % n]] for m in range(n)])
    Q = (xyz - c) @ np.array([ex, ey, nz]).T / L
    others = [i for i in ring if i != flap]
    # the flap clearly above the rest
    up = lambda P: 0.5 * min(1, (P[flap, 1] - P[others, 1].max()) / 0.3) + wide_pic(P)
    return framed_pics(Q, bonds, prefer=up, spins=range(-30, 31, 5), tilts=(-25, -20, -15, -10, -5, 0), top=top)


def small_rings():
    G = 'conformers'
    R5 = ring_idx(5)
    # cyclopentane envelope (Cs): one ring torsion 0, the flap atom out of the plane of the other
    # four; drawn with the flap up at one end
    env = [(1, 2, 3, 4, 0.0)]
    mol, xyz, _ = embed('C1CCCC1', env)
    atoms, bonds = from_mol(mol, xyz)
    flap = raised(xyz, R5, 1)[0]
    a, b = with_stubs('C1CCCC1', env)
    pic, pic_ae = with_bonds(envelope_pics(xyz, bonds, R5, flap, top=12), R5, xyz_of(a), b, a.core)
    add(G, 'envelope', 'Cyclopentane envelope', 'C1CCCC1', atoms, bonds, pic)
    add(G, 'envelope-ae', 'Envelope with all its bonds', 'C1CCCC1', a, b, pic_ae)
    # half-chair (twist, C2): two neighbouring atoms either side of the plane of the other three
    tw = [(0, 1, 2, 3, 26), (1, 2, 3, 4, -42), (2, 3, 4, 0, 42), (3, 4, 0, 1, -26)]
    mol, xyz, _ = embed('C1CCCC1', tw)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c5-twist', 'Cyclopentane half-chair (twist)', 'C1CCCC1', atoms, bonds, oblique_pics(xyz, bonds, R5, prefer=wide_pic)[0])
    # cyclopentene envelope: the flap (C4) up, the double bond at the other end
    mol, xyz, _ = embed('C1=CCCC1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cyclopentene', 'Cyclopentene envelope', 'C1=CCCC1', atoms, bonds, envelope_pics(xyz, bonds, R5, 3)[0])
    # puckered cyclobutane (butterfly), seen a little more from above
    mol, xyz, _ = embed('C1CCC1')
    atoms, bonds = from_mol(mol, xyz)
    a, b = with_stubs('C1CCC1')
    pic, pic_ae = with_bonds(oblique_pics(xyz, bonds, ring_idx(4), prefer=wide_pic, tilts=(0, 10, 20), snap=0, top=12), ring_idx(4), xyz_of(a), b, a.core, snap=0)
    add(G, 'cyclobutane', 'Puckered cyclobutane', 'C1CCC1', atoms, bonds, pic)
    add(G, 'cyclobutane-ae', 'Puckered cyclobutane with its bonds', 'C1CCC1', a, b, pic_ae)
    # cyclopropane, from just above its plane, with its bonds
    a, b = with_stubs('C1CC1')
    add(G, 'cyclopropane-ae', 'Cyclopropane with its bonds', 'C1CC1', a, b,
        oblique_pics(xyz_of(a), b, ring_idx(3), core=a.core, tilts=(0, 10, 20, 30), snap=0)[0])


def medium_rings():
    G = 'conformers'
    # cycloheptane twist-chair and cyclooctane boat-chair: the lowest-energy conformers
    mol, xyz, _ = embed('C1CCCCCC1', confs=200)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c7-twist-chair', 'Cycloheptane twist-chair', 'C1CCCCCC1', atoms, bonds, oblique_pics(xyz, bonds, ring_idx(7), prefer=wide_pic)[0])
    mol, xyz, _ = embed('C1CCCCCCC1', confs=300)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c8-boat-chair', 'Cyclooctane boat-chair', 'C1CCCCCCC1', atoms, bonds, oblique_pics(xyz, bonds, ring_idx(8), prefer=wide_pic)[0])
    # cyclooctane crown (D4d): ring torsions ±87.5° alternately
    crown = torsion_list(ring_idx(8), [87.5, -87.5] * 4)
    mol, xyz, _ = embed('C1CCCCCCC1', crown)
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'c8-crown', 'Cyclooctane crown', 'C1CCCCCCC1', atoms, bonds, oblique_pics(xyz, bonds, ring_idx(8), prefer=wide_pic)[0])
    # cyclooctatetraene tub (D2d)
    mol, xyz, _ = embed('C1=CC=CC=CC=C1')
    atoms, bonds = from_mol(mol, xyz)
    add(G, 'cot-tub', 'Cyclooctatetraene tub', 'C1=CC=CC=CC=C1', atoms, bonds, oblique_pics(xyz, bonds, ring_idx(8), prefer=wide_pic)[0])


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


def fused():
    G = 'fused'
    items = [
        ('trans-decalin', 'trans-Decalin', 'C1CC[C@H]2CCCC[C@@H]2C1', ['trans']),
        ('cis-decalin', 'cis-Decalin', 'C1CC[C@H]2CCCC[C@H]2C1', ['cis']),
        ('trans-hydrindane', 'trans-Hydrindane', 'C1CC[C@H]2CCC[C@@H]2C1', ['trans']),
        ('cis-hydrindane', 'cis-Hydrindane', 'C1CC[C@H]2CCC[C@H]2C1', ['cis']),
        ('trans-perhydrophenanthrene', 'Perhydrophenanthrene (trans-anti-trans)', 'C1CC[C@@H]2[C@@H](C1)CC[C@@H]1CCCC[C@H]12', ['trans', 'trans']),
        ('trans-perhydroanthracene', 'Perhydroanthracene (trans-anti-trans)', 'C1CC[C@@H]2C[C@@H]3CCCC[C@H]3C[C@H]2C1', ['trans', 'trans']),
    ]
    # ring systems built on chairs: drawn along the page, with as few ring bonds upright as can be
    for tid, name, smi, kinds in items:
        need(smi, kinds)
        atoms, bonds, xyz = mol3d(smi)
        pref = lambda P, bonds=bonds: wide_pic(P) - 0.05 * vertical_ring_bonds(P, bonds)
        pics = lattice_pics(xyz, bonds, prefer=pref, top=2, lattice=chair_bonds(len(atoms), bonds))
        add(G, tid, name, smi, atoms, bonds, pics[0], stereo3d=True)
        if tid == 'cis-decalin':
            # the other common picture: the second ring going up instead of down
            add(G, 'cis-decalin-2', 'cis-Decalin (drawn the other way up)', smi, atoms, bonds, pics[1], stereo3d=True)
    for tid, name, smi, kinds in [
        ('cis-bicyclooctane', 'cis-Bicyclo[3.3.0]octane (diquinane)', 'C1C[C@H]2CCC[C@H]2C1', ['cis']),
        ('perhydroazulene', 'cis-Perhydroazulene (hydroazulene of guaianes)', 'C1CC[C@H]2CCC[C@H]2CC1', ['cis']),
    ]:
        need(smi, kinds)
        atoms, bonds, xyz = mol3d(smi)
        add(G, tid, name, smi, atoms, bonds, oblique_pics(xyz, bonds, list(range(len(atoms))), prefer=wide_pic)[0], stereo3d=True)
    # steroids: 5α (A/B trans) and 5β (A/B cis), from 5α- and 5β-dihydrotestosterone with the
    # oxygens taken off, so the rings have the natural (8β,9α,10β,13β,14α) configuration; drawn
    # as usual, ring A at the left and D at the right, the β face (the angular methyls) up
    for tid, name, dht in [
        ('steroid-5a', '5α-Steroid (androstane) skeleton', 'C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CC[C@@H]4[C@@]3(CCC(=O)C4)C'),
        ('steroid-5b', '5β-Steroid skeleton (A/B cis)', 'C[C@]12CC[C@H]3[C@H]([C@@H]1CC[C@@H]2O)CC[C@H]4[C@@]3(CCC(=O)C4)C'),
    ]:
        mol, xyz, _ = embed(dht, confs=80)
        keep = [a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() == 'C']
        c3 = next(a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() == 'C' and any(n.GetSymbol() == 'O' and mol.GetBondBetweenAtoms(a.GetIdx(), n.GetIdx()).GetBondTypeAsDouble() == 2 for n in a.GetNeighbors()))
        c17 = next(a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() == 'C' and any(n.GetSymbol() == 'O' and mol.GetBondBetweenAtoms(a.GetIdx(), n.GetIdx()).GetBondTypeAsDouble() == 1 for n in a.GetNeighbors()))
        methyls = [a.GetIdx() for a in mol.GetAtoms() if a.GetSymbol() == 'C' and a.GetDegree() == 1]
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
        at = {old: new for new, old in enumerate(keep)}
        a3, a17 = at[c3], at[c17]
        ups = [(at[m], next(at[n.GetIdx()] for n in mol.GetAtomWithIdx(m).GetNeighbors())) for m in methyls]

        def pref(P, bonds=bonds, a3=a3, a17=a17, ups=ups):
            s = wide_pic(P) + 0.5 * (P[a3, 0] < P[a17, 0]) - 0.05 * vertical_ring_bonds(P, bonds)
            return s + sum(0.3 for m, c in ups if P[m, 1] > P[c, 1] + 0.5)
        add(G, tid, name, smi, atoms, bonds, lattice_pics(xyz2, bonds, prefer=pref, lattice=chair_bonds(len(atoms), bonds))[0], stereo3d=True)
    # adamantane: a chair at the bottom, the three bridges rising to the top CH, as usually drawn
    smi = 'C1C2CC3CC1CC(C2)C3'
    atoms, bonds, xyz = mol3d(smi)
    add(G, 'adamantane-3d', 'Adamantane', smi, atoms, bonds, lattice_pics(xyz, bonds)[0])
    # twistane: along the page like a ring system
    smi = 'C1CC2CC3CC1CC2C3'
    atoms, bonds, xyz = mol3d(smi)
    add(G, 'twistane', 'Twistane', smi, atoms, bonds, oblique_pics(xyz, bonds, list(range(len(atoms))), prefer=wide_pic, tilts=(0, 15, 30))[0])
    # cubane: the front face square on, seen a little from the right and above (the usual cube)
    smi = 'C12C3C4C1C5C2C3C45'
    atoms, bonds, xyz = mol3d(smi)
    add(G, 'cubane', 'Cubane', smi, atoms, bonds, cube_view(xyz))


def chair_bonds(n, bonds):
    """Which bonds may be drawn along the lattice: those of six-membered rings and those not in
    a ring (not the bonds of a fused five-membered ring, which is no chair)."""
    six = {frozenset((r[k], r[(k + 1) % 6])) for r in rings_of(n, bonds, 6) for k in range(6)}
    in_ring = set(ring_bonds(n, bonds))
    return lambda k: frozenset(bonds[k][:2]) in six or k not in in_ring


def cube_view(xyz, yaw=24, pitch=16):
    """A cube with one face towards the viewer, turned `yaw`° and tipped `pitch`° so the faces
    behind show: the cube as it is drawn in books."""
    c = xyz.mean(axis=0)
    q = xyz - c
    # the cube's own axes: the three edge directions from one corner
    d = [q[j] - q[0] for j in range(1, len(q)) if abs(np.linalg.norm(q[j] - q[0]) - np.min([np.linalg.norm(q[k] - q[0]) for k in range(1, len(q))])) < 0.05]
    ex = d[0] / np.linalg.norm(d[0])
    ey = d[1] - np.dot(d[1], ex) * ex
    ey /= np.linalg.norm(ey)
    ez = np.cross(ex, ey)
    p = q @ np.array([ex, ey, ez]).T
    return p @ rot_y(math.radians(yaw)).T @ rot_x(math.radians(pitch)).T


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
        if z == 0:
            pics = lattice_pics(xyz, bonds, prefer=wide_pic, lattice=chair_bonds(len(atoms), bonds))
            pic = pics[0] if pics else oblique_pics(xyz, bonds, list(range(len(atoms))), prefer=wide_pic)[0]
        else:
            bh1, bh2, bridges = bridges_of(len(atoms), bonds)
            # on the diamond lattice (bicyclo[3.3.1]nonane, two chairs): drawn as chairs are
            pic = lattice_pics(xyz, bonds, prefer=wide_pic)[0] if off_lattice(xyz, bonds) < 16 else bridged_pic(xyz, bonds, bh1, bh2, bridges)
        add(G, f'bicyclo{x}{y}{z}', name, smi, atoms, bonds, pic, stereo3d=z == 0)


def off_lattice(xyz, bonds):
    """How far (degrees) the bond furthest from the lattice's directions is, the molecule laid
    on the lattice as well as it goes (180 with no chair to lay it by)."""
    best = 180
    for r in rings_of(len(xyz), bonds, 6):
        for R, t, L in chair_frames(xyz, r, False):
            Q = (xyz / L) @ R.T + t
            worst = max(math.degrees(math.acos(min(1, np.max(np.abs(LT @ ((Q[j] - Q[i]) / np.linalg.norm(Q[j] - Q[i]))))))) for i, j, *_ in bonds)
            best = min(best, worst)
    return best


def bridges_of(n, bonds):
    """A bicyclic's two bridgeheads and the atoms of each bridge between them."""
    adj = {i: set() for i in range(n)}
    for i, j, *_ in bonds:
        adj[i].add(j)
        adj[j].add(i)
    bh = [i for i in range(n) if len(adj[i]) == 3]
    bridges = []
    for start in adj[bh[0]]:
        if start == bh[1]:
            bridges.append([])
            continue
        path, prev = [start], bh[0]
        while path[-1] != bh[1]:
            nxt = next(x for x in adj[path[-1]] if x != prev)
            prev = path[-1]
            path.append(nxt)
        bridges.append(path[:-1])
    return bh[0], bh[1], bridges


def bridged_pic(xyz, bonds, bh1, bh2, bridges):
    """A bridged ring system as it is usually drawn: the bridgeheads left and right, the
    shortest bridge over the top, the longest at the front, seen a little from above (norbornane
    as a boat with C7 across its top)."""
    L = mean_bond(xyz, bonds)
    c = (xyz[bh1] + xyz[bh2]) / 2
    ex = xyz[bh2] - xyz[bh1]
    ex /= np.linalg.norm(ex)
    small, big = min(bridges, key=len), max(bridges, key=len)
    up = xyz[small].mean(axis=0) - c
    ez = up - np.dot(up, ex) * ex
    ez /= np.linalg.norm(ez)
    ey = np.cross(ez, ex)  # away from the viewer
    Q = (xyz - c) @ np.array([ex, ey, ez]).T / L
    if Q[big, 1].mean() > 0:
        Q = Q @ rot_z(math.pi).T  # the longest bridge to the front
    def top(P):
        lens = [np.linalg.norm(P[i, :2] - P[j, :2]) for i, j, *_ in bonds]
        # no bond foreshortened to a stub
        even = -2 * max(0, 0.4 - min(lens) / np.median(lens))
        # and no bonds crossing (pic_score lets one pass cheaply)
        q = P[:, :2]
        cross = sum(1 for x in range(len(bonds)) for y in range(x + 1, len(bonds))
                    if len({*bonds[x][:2], *bonds[y][:2]}) == 4 and crosses(q[bonds[x][0]], q[bonds[x][1]], q[bonds[y][0]], q[bonds[y][1]]))
        # the back bridge may run close inside the outline, as in the usual norbornane picture
        # (pic_score wants atoms 0.2 bonds from other bonds; 0.13 will do here)
        ab = gaps(P, bonds)[1]
        close = 10 * max(0, 0.2 - ab) - 10 * max(0, 0.13 - ab)
        return 0.3 * (P[small, 1].min() >= P[[i for i in range(len(P)) if i not in small], 1].max() - 0.05) + wide_pic(P) + even + close - 0.5 * cross
    return framed_pics(Q, bonds, prefer=top, spins=range(-30, 31, 5), tilts=(-30, -20, -10, 0))[0]


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
        # ring in order C1, C2, C3, C4, C5, O5 (atom indexes in the SMILES): drawn as usual, C1 the
        # right-hand tip, C4 the left-hand one, the ring oxygen at the back
        ring = [4, 6, 8, 10, 2, 3]
        pref = lambda P, r=ring: 0.5 * (P[r[0], 0] >= P[r, 0].max() - 1e-6) + 0.3 * (P[r[5], 1] > P[r[1], 1])
        add(G, tid, name, smi, atoms, bonds, lattice_pics(xyz, bonds, prefer=pref, rings=[ring])[0], stereo3d=True, attach=5)


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
