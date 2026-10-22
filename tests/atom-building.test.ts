// Typing molecules from the keyboard (the cheat-sheet keys), new bonds that keep out of rings,
// and Contract Label's built-in nicknames. The cheat sheet's four typed examples are checked in a
// browser (they need the editor's keyboard highlight); these cover the chemistry underneath.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { DEG } from '../src/geom';
import { freeRing, placeRing, fusedRing, sproutDir } from '../src/chem/chemgeom';
import { sproutGroup } from '../src/chem/sprouts';
import { builtInNicknames, isBuiltInNickname } from '../src/chem/labels';
import { DEFAULT_KEYS } from '../src/editor/keymap';

const L = 14.4;
const grow = (doc: Doc, id: number, kind: Parameters<typeof sproutGroup>[2]) => doc.edit('grow', () => sproutGroup(doc, id, kind));

/** Decalin: two cyclohexanes sharing a bond; returns the doc and the two fusion atoms. */
function decalin(): { doc: Doc; fusion: [number, number]; centres: { x: number; y: number }[] } {
  const doc = new Doc();
  let fusion: [number, number] = [0, 0];
  const centres = [{ x: 100, y: 100 }];
  doc.edit('draw', () => {
    const a = placeRing(doc, freeRing({ x: 100, y: 100 }, 6, L), {});
    const p = doc.atoms.get(a[0])!, q = doc.atoms.get(a[1])!;
    // the second ring on the far side of the bond a0–a1
    for (const side of [1, -1]) {
      const pts = fusedRing(p, q, 6, side);
      const c = pts.reduce((s, v) => ({ x: s.x + v.x / 6, y: s.y + v.y / 6 }), { x: 0, y: 0 });
      if (Math.hypot(c.x - 100, c.y - 100) > L) { placeRing(doc, pts, { existing: [a[0], a[1]] }); centres.push(c); break; }
    }
    fusion = [a[0], a[1]];
  });
  return { doc, fusion, centres };
}

describe('a new bond on a ring-fusion atom', () => {
  it('points out of both rings (an angular methyl), never into one', () => {
    const { doc, fusion, centres } = decalin();
    expect(doc.atoms.size).toBe(10);
    for (const f of fusion) {
      const a = doc.atoms.get(f)!;
      const d = sproutDir(doc, f);
      const end = { x: a.x + d.x * L, y: a.y + d.y * L };
      // far from both rings' centres (pointing into a ring it would land on its centre)
      for (const c of centres) expect(Math.hypot(c.x - end.x, c.y - end.y)).toBeGreaterThan(L);
    }
  });

  it('still goes into the widest gap on a plain ring atom', () => {
    const doc = new Doc();
    const r = doc.edit('ring', () => placeRing(doc, freeRing({ x: 0, y: 0 }, 6, L), {}));
    const a = doc.atoms.get(r[0])!, d = sproutDir(doc, r[0]);
    // straight out from the ring's centre
    expect((a.x * d.x + a.y * d.y) / Math.hypot(a.x, a.y)).toBeCloseTo(1, 5);
  });
});

describe('the zig-zag carries on past a branch', () => {
  it('ignores a C=O on the atom before', () => {
    // CH3–C(=O)–X: a bond from X goes on zig-zag (anti to CH3–C), not anti to the C=O
    const doc = new Doc();
    let x = 0, me = 0, c = 0;
    doc.edit('draw', () => {
      const m = doc.addAtom(0, 0), cc = doc.addAtom(L * Math.cos(30 * DEG), -L / 2);
      doc.addBond(m.id, cc.id);
      me = m.id; c = cc.id;
    });
    x = grow(doc, c, 'carbonyl')!;
    const n = grow(doc, x, 'bond')!;
    const M = doc.atoms.get(me)!, C = doc.atoms.get(c)!, N = doc.atoms.get(n)!;
    // N–X runs parallel to Me–C
    const u = { x: C.x - M.x, y: C.y - M.y }, v = { x: N.x - doc.atoms.get(x)!.x, y: N.y - doc.atoms.get(x)!.y };
    expect((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))).toBeCloseTo(1, 5);
  });

  it('ignores a wedged methyl on the atom before (4 then 2)', () => {
    const doc = new Doc();
    let n = 0, e = 0;
    doc.edit('draw', () => {
      const a = doc.addAtom(0, 0, 7), b = doc.addAtom(L * Math.cos(30 * DEG), -L / 2);
      doc.addBond(a.id, b.id);
      n = a.id; e = b.id;
    });
    const me = grow(doc, e, 'wedge')!;
    const next = grow(doc, me, 'carbonyl')!;
    const N = doc.atoms.get(n)!, E = doc.atoms.get(e)!, X = doc.atoms.get(next)!, M = doc.atoms.get(me)!;
    const u = { x: E.x - N.x, y: E.y - N.y }, v = { x: X.x - M.x, y: X.y - M.y };
    expect((u.x * v.x + u.y * v.y) / (Math.hypot(u.x, u.y) * Math.hypot(v.x, v.y))).toBeCloseTo(1, 5);
  });
});

describe('keys on a CH2 in a chain', () => {
  const middle = () => {
    const doc = new Doc();
    let mid = 0;
    doc.edit('draw', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(L * Math.cos(30 * DEG), -L / 2), c = doc.addAtom(2 * L * Math.cos(30 * DEG), 0);
      doc.addBond(a.id, b.id); doc.addBond(b.id, c.id);
      mid = b.id;
    });
    return { doc, mid };
  };

  it('v and u make spiro rings', () => {
    for (const [kind, n] of [['cyclopropyl', 3], ['cyclobutyl', 4], ['cyclopentyl', 5], ['cyclohexyl', 6]] as const) {
      const { doc, mid } = middle();
      grow(doc, mid, kind);
      expect(doc.atoms.size).toBe(3 + n - 1);
      expect(doc.degree(mid)).toBe(4);
    }
  });

  it('K makes a wedged and a plain methyl', () => {
    const { doc, mid } = middle();
    grow(doc, mid, 'tbu');
    expect(doc.degree(mid)).toBe(4);
    expect([...doc.bonds.values()].filter((b) => b.display === 'wedge')).toHaveLength(1);
  });
});

describe('cheat-sheet keys', () => {
  it('has y for Boc, W for a hashed wedge and v to fuse a cyclopropane', () => {
    expect(DEFAULT_KEYS.atom.y).toBe('label Boc');
    expect(DEFAULT_KEYS.bond.W).toBe('bond hash-wedge');
    expect(DEFAULT_KEYS.bond.v).toBe('fuse 3');
    expect(DEFAULT_KEYS.atom.j).toBe('atom cp-hapto');
    expect(DEFAULT_KEYS.atom.J).toBe('atom arene-hapto');
  });
});

describe('Contract Label', () => {
  it('knows the built-in nicknames and their groups', () => {
    const m = new Map(builtInNicknames());
    expect(m.get('Ph')).toBe('c1ccccc1');
    expect(m.get('TBS')).toBe(m.get('TBDMS'));
    expect(isBuiltInNickname('Boc')).toBe(true);
  });
});
