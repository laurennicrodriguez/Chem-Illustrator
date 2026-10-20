import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { templateById, placeTemplate, freePlacement } from '../src/chem/templates';
import { liftRing, fusions3d } from '../src/chem/fuse3d';
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
