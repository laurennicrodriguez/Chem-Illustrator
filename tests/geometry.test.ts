import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { dist, angleOf, DEG } from '../src/geom';
import { freeRing, fusedRing, placeRing, sproutDir, sprout, chainPoints, ringOnAtom, ringDir, fuseSide, bondTo, bondLength, matchStructure, structureBondLength } from '../src/chem/chemgeom';

const L = 14.4;
const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;

function doubleCount(d: Doc, atomId: number): number {
  return (d.adj.get(atomId) ?? []).filter((b) => d.bonds.get(b)!.order === 2).length;
}

describe('ring geometry', () => {
  it('draws regular rings with the bond length as the side', () => {
    for (const n of [3, 4, 5, 6, 7, 8]) {
      const pts = freeRing({ x: 0, y: 0 }, n, L);
      for (let i = 0; i < n; i++) expect(close(dist(pts[i], pts[(i + 1) % n]), L)).toBe(true);
    }
  });
  it('puts a vertex at the top of a hexagon and a flat top on a square', () => {
    const hex = freeRing({ x: 0, y: 0 }, 6, L);
    expect(close(hex[0].x, 0)).toBe(true);
    expect(hex[0].y).toBeLessThan(0);
    const sq = freeRing({ x: 0, y: 0 }, 4, L);
    expect(close(sq[0].y, sq[3].y)).toBe(true);
  });
  it('fuses a ring onto an edge', () => {
    const p = { x: 0, y: 0 }, q = { x: L, y: 0 };
    const pts = fusedRing(p, q, 6, 1);
    expect(pts[0]).toEqual(p);
    expect(pts[1]).toEqual(q);
    for (let i = 0; i < 6; i++) expect(close(dist(pts[i], pts[(i + 1) % 6]), L, 1e-6)).toBe(true);
    // side +1 is perp(q − p) = (0, +1): below the edge on screen
    expect(pts[3].y).toBeGreaterThan(0);
  });
  it('fuses on the empty side of a bond', () => {
    const d = new Doc();
    let ids: number[] = [];
    d.bulk(() => { ids = placeRing(d, freeRing({ x: 0, y: 0 }, 6, L)); });
    const b = d.bondBetween(ids[0], ids[1])!;
    const side = fuseSide(d, b, 6);
    const pts = fusedRing(d.atoms.get(b.a1)!, d.atoms.get(b.a2)!, 6, side);
    // new ring centre is away from the first ring's centre (0, 0)
    const cx = pts.reduce((s, p) => s + p.x, 0) / 6, cy = pts.reduce((s, p) => s + p.y, 0) / 6;
    expect(Math.hypot(cx, cy)).toBeGreaterThan(L);
  });
});

describe('benzene double bonds', () => {
  it('alternates three double bonds in benzene', () => {
    const d = new Doc();
    let ids: number[] = [];
    d.bulk(() => { ids = placeRing(d, freeRing({ x: 0, y: 0 }, 6, L), { aromatic: true }); });
    expect([...d.bonds.values()].filter((b) => b.order === 2).length).toBe(3);
    for (const id of ids) expect(doubleCount(d, id)).toBe(1);
  });
  it('builds naphthalene without giving any atom two double bonds', () => {
    const d = new Doc();
    d.bulk(() => {
      const ids = placeRing(d, freeRing({ x: 0, y: 0 }, 6, L), { aromatic: true });
      for (const [i, j] of [[0, 1], [1, 2], [2, 3]]) {
        const p = d.atoms.get(ids[i])!, q = d.atoms.get(ids[j])!;
        const b = d.bondBetween(p.id, q.id)!;
        if (b.order === 1) {
          placeRing(d, fusedRing(p, q, 6, fuseSide(d, b, 6)), { aromatic: true, existing: [p.id, q.id] });
          break;
        }
      }
    });
    expect(d.atoms.size).toBe(10);
    for (const id of d.atoms.keys()) expect(doubleCount(d, id)).toBeLessThanOrEqual(1);
    expect([...d.bonds.values()].filter((b) => b.order === 2).length).toBe(5);
  });
  it('reuses atoms that land on existing ones', () => {
    const d = new Doc();
    d.bulk(() => {
      const ids = placeRing(d, freeRing({ x: 0, y: 0 }, 6, L));
      // a second ring drawn exactly on top shares all atoms
      placeRing(d, freeRing({ x: 0.5, y: 0.5 }, 6, L));
      expect(ids.length).toBe(6);
    });
    expect(d.atoms.size).toBe(6);
    expect(d.bonds.size).toBe(6);
  });
});

describe('sprouting bonds', () => {
  it('starts up and to the right, then zig-zags', () => {
    const d = new Doc();
    d.bulk(() => {
      const a = d.addAtom(0, 0);
      expect(close(angleOf(sproutDir(d, a.id)), -30 * DEG)).toBe(true);
      const b = sprout(d, a.id);
      const c = sprout(d, b.id);
      const e = sprout(d, c.id);
      // a zig-zag chain: every other atom on the same line, chain grows to the right
      expect(close(a.y, c.y, 1e-6)).toBe(true);
      expect(close(b.y, e.y, 1e-6)).toBe(true);
      expect(e.x).toBeGreaterThan(c.x);
      expect(close(dist(b, c), L)).toBe(true);
    });
  });
  it('puts the third bond in the widest gap', () => {
    const d = new Doc();
    d.bulk(() => {
      const c = d.addAtom(0, 0);
      bondTo(d, c, { x: -L, y: 0 });
      bondTo(d, c, { x: L * Math.cos(60 * DEG), y: -L * Math.sin(60 * DEG) });
      const dir = sproutDir(d, c.id);
      // neighbours at 180° and −60°: widest gap is centred on +60°
      expect(close(angleOf(dir), 60 * DEG, 1e-6)).toBe(true);
    });
  });
  it('places a spiro ring with the atom as a vertex', () => {
    const pts = ringOnAtom({ x: 0, y: 0 }, { x: 1, y: 0 }, 5, L);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(close(dist(pts[0], pts[1]), L, 1e-6)).toBe(true);
  });
  it('grows a ring on a chain end straight on from the bond, so both ring bonds sit at 120°', () => {
    // N-CH2-CH3 as drawn: the end carbon's bond runs down and to the right
    const d = new Doc();
    const ids = d.edit('ring', () => {
      const n = d.addAtom(0, 0);
      const c1 = bondTo(d, n, { x: 0, y: L });
      const c2 = bondTo(d, c1, { x: L * Math.cos(30 * DEG), y: L * 1.5 });
      const ring = placeRing(d, ringOnAtom(c2, ringDir(d, c2.id), 6, L), { aromatic: true, existing: [c2.id] });
      return { c1, c2, ring };
    });
    const { c1, c2, ring } = ids;
    const ortho = d.neighbors(c2.id).filter((x) => x.id !== c1.id);
    expect(ortho.length).toBe(2);
    for (const o of ortho) {
      const a = Math.abs(angleOf({ x: o.x - c2.x, y: o.y - c2.y }) - angleOf({ x: c1.x - c2.x, y: c1.y - c2.y }));
      expect(close(Math.min(a, 2 * Math.PI - a), 120 * DEG, 1e-6)).toBe(true);
    }
    expect(ring.length).toBe(6);
  });
  it('keeps a spiro ring in the widest gap of an atom with two bonds', () => {
    const d = new Doc();
    const id = d.edit('chain', () => {
      const a = d.addAtom(0, 0);
      const m = bondTo(d, a, { x: L * Math.cos(30 * DEG), y: -L / 2 });
      bondTo(d, m, { x: 2 * L * Math.cos(30 * DEG), y: 0 });
      return m.id;
    });
    expect(close(angleOf(ringDir(d, id)), -90 * DEG, 1e-6)).toBe(true);
  });
});

describe('chains', () => {
  it('counts bonds from the drag length', () => {
    const pts = chainPoints({ x: 0, y: 0 }, { x: 5 * L * Math.cos(30 * DEG), y: 0 }, L);
    expect(pts.length).toBe(6);
    for (let i = 1; i < pts.length; i++) expect(close(dist(pts[i - 1], pts[i]), L, 1e-9)).toBe(true);
  });
});

describe('undo and redo', () => {
  it('undoes a whole edit as one step', () => {
    const d = new Doc();
    d.edit('ring', () => placeRing(d, freeRing({ x: 0, y: 0 }, 6, L), { aromatic: true }));
    expect(d.atoms.size).toBe(6);
    d.edit('bond', () => sprout(d, [...d.atoms.keys()][0]));
    expect(d.atoms.size).toBe(7);
    d.undo();
    expect(d.atoms.size).toBe(6);
    expect(d.bonds.size).toBe(6);
    d.undo();
    expect(d.atoms.size).toBe(0);
    d.redo();
    d.redo();
    expect(d.atoms.size).toBe(7);
    expect(d.degree([...d.atoms.keys()][0])).toBe(3);
  });
  it('finds atoms through the spatial index after moves', () => {
    const d = new Doc();
    let id = 0;
    d.edit('a', () => { id = d.addAtom(0, 0).id; });
    d.edit('move', () => d.moveAtoms([id], 100, 50));
    expect(d.atomsNear({ x: 100, y: 50 }, 1).map((a) => a.id)).toEqual([id]);
    expect(d.atomsNear({ x: 0, y: 0 }, 1)).toEqual([]);
    d.undo();
    expect(d.atomsNear({ x: 0, y: 0 }, 1).map((a) => a.id)).toEqual([id]);
  });
});

describe('adding to a structure drawn with other settings', () => {
  /** A propane chain drawn at 30 pt bonds, with thick red bonds and a scaled label, in a 14.4 pt document. */
  function bigChain(d: Doc) {
    let atoms: ReturnType<Doc['addAtom']>[] = [];
    d.bulk(() => {
      atoms = [[0, 0], [26, 15], [52, 0]].map(([x, y]) => d.addAtom(x, y, 6, { s: 1.5, color: '#ff0000' }));
      d.addBond(atoms[0].id, atoms[1].id, 1, 'solid', { s: 2, color: '#ff0000' });
      d.addBond(atoms[1].id, atoms[2].id, 1, 'solid', { s: 2, color: '#ff0000' });
    });
    return atoms;
  }

  it('takes the structure\'s bond length, line width and colour by default', () => {
    const d = new Doc();
    const [, b, c] = bigChain(d);
    const len = dist(b, c);
    expect(bondLength(d, c)).toBeCloseTo(len, 6);
    let n = c;
    d.bulk(() => { n = sprout(d, c.id); });
    expect(dist(n, c)).toBeCloseTo(len, 6);
    expect(n).toMatchObject({ s: 1.5, color: '#ff0000' });
    expect(d.bondBetween(c.id, n.id)).toMatchObject({ s: 2, color: '#ff0000' });
    // a ring on it too
    let ids: number[] = [];
    d.bulk(() => { ids = placeRing(d, ringOnAtom(n, ringDir(d, n.id), 6, bondLength(d, n)), { existing: [n.id], scale: n.s, like: n }); });
    expect(dist(d.atoms.get(ids[1])!, d.atoms.get(ids[2])!)).toBeCloseTo(len, 6);
    expect(d.bondBetween(ids[1], ids[2])).toMatchObject({ s: 2, color: '#ff0000' });
  });

  it('goes by the document\'s settings when switched off', () => {
    matchStructure.on = false;
    try {
      const d = new Doc();
      const [, , c] = bigChain(d);
      let n = c;
      d.bulk(() => { n = sprout(d, c.id); });
      expect(dist(n, c)).toBeCloseTo(d.style.bondLength * 1.5, 6);
      expect(n.color).toBeUndefined();
      expect(d.bondBetween(c.id, n.id)).toMatchObject({ s: 1.5 });
    } finally {
      matchStructure.on = true;
    }
  });

  it('keeps the style\'s length for a lone atom and for structures in perspective', () => {
    const d = new Doc();
    let a = null as unknown as ReturnType<Doc['addAtom']>;
    d.bulk(() => { a = d.addAtom(0, 0); });
    expect(structureBondLength(d, a)).toBeNull();
    expect(bondLength(d, a)).toBe(d.style.bondLength);
    d.bulk(() => { const p = d.addAtom(10, 0, 6, { depth: 1 }); d.addBond(a.id, p.id); });
    expect(structureBondLength(d, a)).toBeNull();
  });
});
