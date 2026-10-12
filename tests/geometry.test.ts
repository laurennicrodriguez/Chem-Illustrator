import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { dist, angleOf, DEG } from '../src/geom';
import { freeRing, fusedRing, placeRing, sproutDir, sprout, chainPoints, ringOnAtom, fuseSide, bondTo } from '../src/chem/chemgeom';

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
