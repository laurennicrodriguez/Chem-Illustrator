import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { templateById, placeTemplate, freePlacement } from '../src/chem/templates';
import { liftRing, latticeRing, fusions3d } from '../src/chem/fuse3d';
import { dist } from '../src/geom';

const L = 14.4;

function chairDoc(id = 'chair') {
  const doc = new Doc();
  let ids: number[] = [];
  doc.bulk(() => { ids = placeTemplate(doc, templateById(id)!, freePlacement({ x: 100, y: 100 }, L)); });
  return { doc, ids };
}

describe('reading a ring drawn in perspective', () => {
  it('finds a chair in a chair drawing, and nothing in a flat hexagon', () => {
    const { doc, ids } = chairDoc();
    const lift = liftRing(ids.map((i) => doc.atoms.get(i)!));
    expect(lift).not.toBeNull();
    const hex = Array.from({ length: 6 }, (_, k) => ({ x: Math.cos((k * Math.PI) / 3) * L, y: Math.sin((k * Math.PI) / 3) * L }));
    expect(liftRing(hex)).toBeNull();
  });
});

describe('fusing a chair onto a chair', () => {
  it('offers trans and the two cis fusions on every bond, never axial–axial', () => {
    const { doc } = chairDoc();
    for (const b of [...doc.bonds.values()]) {
      const f = fusions3d(doc, templateById('chair')!, b.id);
      expect(f, `bond ${b.id}`).not.toBeNull();
      expect(f!.length, `bond ${b.id}`).toBe(3);
      for (const x of f!) {
        // the new ring is a chair drawn in perspective too
        const lift = liftRing(x.pts);
        expect(lift).not.toBeNull();
      }
    }
  });
});

describe('trans and cis', () => {
  it('puts trans (both equatorial) first and labels the others cis', () => {
    const { doc } = chairDoc();
    const b = [...doc.bonds.values()][0];
    const f = fusions3d(doc, templateById('chair')!, b.id)!;
    expect(f.map((x) => x.join)).toEqual(['trans', 'cis', 'cis']);
  });
});

describe('textbook drawings', () => {
  // the slopes a textbook chair is drawn with (degrees, either way along the bond)
  const slopes = [56, 165, 12, 90];
  const onSlope = (p: { x: number; y: number }, q: { x: number; y: number }) => {
    const a = ((Math.atan2(-(q.y - p.y), q.x - p.x) * 180) / Math.PI + 360) % 180;
    return slopes.some((s) => Math.min(Math.abs(a - s), 180 - Math.abs(a - s)) < 1);
  };

  it('reads a chair drawn the textbook way exactly, either way round', () => {
    for (const id of ['chair', 'chair-2']) {
      const { doc, ids } = chairDoc(id);
      expect(latticeRing(ids.map((i) => doc.atoms.get(i)!)), id).not.toBeNull();
    }
  });

  it('fuses a chair trans onto a chair as the textbook trans-decalin, every bond on its slope', () => {
    const { doc } = chairDoc();
    const b = [...doc.bonds.values()][0];
    const f = fusions3d(doc, templateById('chair')!, b.id)![0];
    expect(f.join).toBe('trans');
    doc.bulk(() => placeTemplate(doc, templateById('chair')!, { origin: { x: 0, y: 0 }, scale: f.len, angle: 0, mirror: false, pts: f.pts }, { existing: f.existing, move: f.move, noMerge: true }));
    expect(doc.atoms.size).toBe(10);
    for (const bd of doc.bonds.values()) expect(onSlope(doc.atoms.get(bd.a1)!, doc.atoms.get(bd.a2)!)).toBe(true);
  });

  it('moves a short axial or equatorial bond end that becomes a ring atom', () => {
    const { doc, ids } = chairDoc('chair-ae');
    const t = templateById('chair')!;
    const ring = new Set(ids.slice(0, 6));
    const b = [...doc.bonds.values()].find((x) => ring.has(x.a1) && ring.has(x.a2))!;
    const f = fusions3d(doc, t, b.id)![0];
    expect(f.move?.size).toBeGreaterThan(0);
    doc.bulk(() => placeTemplate(doc, t, { origin: { x: 0, y: 0 }, scale: f.len, angle: 0, mirror: false, pts: f.pts }, { existing: f.existing, move: f.move, noMerge: true }));
    // the moved ends are a full bond from their ring neighbours now
    for (const [i, id] of f.existing) {
      if (!f.move!.has(i)) continue;
      const a = doc.atoms.get(id)!;
      for (const bid of doc.adj.get(id) ?? []) {
        const bd = doc.bonds.get(bid)!;
        const o = doc.atoms.get(bd.a1 === id ? bd.a2 : bd.a1)!;
        if (ring.has(o.id) || !ids.includes(o.id)) expect(dist(a, o) / f.len).toBeGreaterThan(0.85);
      }
    }
  });
});
