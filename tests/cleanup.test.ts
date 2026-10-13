import { describe, it, expect } from 'vitest';
import { cleanUp, CleanBond } from '../src/chem/cleanup';
import { Vec, dist, sub, cross, angleOf, DEG } from '../src/geom';
import { TEMPLATES } from '../src/chem/templates';

const L = 14.4;

/** A wobble that is the same every run. */
const wobble = (i: number, k = 3) => ({ x: Math.sin(i * 12.9898) * k, y: Math.cos(i * 78.233) * k });
const polygon = (n: number, c: Vec, r: number, start = 0): Vec[] =>
  Array.from({ length: n }, (_, i) => ({ x: c.x + r * Math.cos(start + (2 * Math.PI * i) / n), y: c.y + r * Math.sin(start + (2 * Math.PI * i) / n) }));
const messy = (pts: Vec[], k = 3) => pts.map((p, i) => ({ x: p.x + wobble(i, k).x, y: p.y + wobble(i, k).y }));
const ringBonds = (n: number, start = 0): CleanBond[] => Array.from({ length: n }, (_, i) => [start + i, start + ((i + 1) % n), 1]);
const centroid = (pts: Vec[]) => ({ x: pts.reduce((s, p) => s + p.x, 0) / pts.length, y: pts.reduce((s, p) => s + p.y, 0) / pts.length });
/** Angle at b in a–b–c, degrees. */
const angleAt = (a: Vec, b: Vec, c: Vec) => {
  const u = sub(a, b), w = sub(c, b);
  return Math.acos(Math.max(-1, Math.min(1, (u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y))))) / DEG;
};
const side = (a: Vec, b: Vec, c: Vec) => Math.sign(cross(sub(b, a), sub(c, a)));
/** Neighbours of an atom in the order met going round it. */
const roundOrder = (pts: Vec[], centre: number, nbrs: number[]) => {
  const ang = (j: number) => angleOf(sub(pts[j], pts[centre]));
  const sorted = [...nbrs].sort((p, q) => ang(p) - ang(q));
  const k = sorted.indexOf(nbrs[0]);
  return [...sorted.slice(k), ...sorted.slice(0, k)];
};
const expectBondsL = (pts: Vec[], bonds: CleanBond[]) => {
  for (const [a, b] of bonds) expect(dist(pts[a], pts[b])).toBeCloseTo(L, 6);
};

describe('Clean Up Structure', () => {
  it('leaves an empty drawing or a lone atom alone', () => {
    expect(cleanUp([], [], L)).toEqual([]);
    expect(cleanUp([{ x: 3, y: 4 }], [], L)).toEqual([{ x: 3, y: 4 }]);
  });

  it('makes a messy chain into an even zig-zag, wherever it was drawn bent', () => {
    // hexane drawn as an arc that keeps turning the same way
    const atoms = Array.from({ length: 6 }, (_, i) => ({ x: 100 + 30 * Math.cos(i * 0.5), y: 100 + 30 * Math.sin(i * 0.5) }));
    const bonds: CleanBond[] = [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    for (let i = 1; i < 5; i++) expect(angleAt(out[i - 1], out[i], out[i + 1])).toBeCloseTo(120, 6);
    // the turns alternate
    for (let i = 1; i < 4; i++) expect(side(out[i - 1], out[i], out[i + 1])).toBe(-side(out[i], out[i + 1], out[i + 2]));
  });

  it('makes a chain drawn straight into a zig-zag, and keeps a triple bond straight', () => {
    const atoms = Array.from({ length: 5 }, (_, i) => ({ x: i * 20, y: 0 }));
    const bonds: CleanBond[] = [[0, 1, 1], [1, 2, 3], [2, 3, 1], [3, 4, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    expect(angleAt(out[0], out[1], out[2])).toBeCloseTo(180, 3);
    expect(angleAt(out[1], out[2], out[3])).toBeCloseTo(180, 3);
    expect(angleAt(out[2], out[3], out[4])).toBeCloseTo(120, 6);
  });

  it('keeps the structure where it was', () => {
    const atoms = messy(polygon(6, { x: 250, y: 80 }, 17), 2);
    const out = cleanUp(atoms, ringBonds(6), L);
    const c0 = centroid(atoms), c1 = centroid(out);
    expect(c1.x).toBeCloseTo(c0.x, 6);
    expect(c1.y).toBeCloseTo(c0.y, 6);
  });

  it('makes a messy ring a regular hexagon squared to the page', () => {
    const atoms = messy(polygon(6, { x: 0, y: 0 }, 16, 0.2), 3);
    const bonds = ringBonds(6);
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    const c = centroid(out);
    for (const p of out) expect(dist(p, c)).toBeCloseTo(L, 6);
    // every bond at a multiple of 30°
    for (const [a, b] of bonds) {
      const deg = angleOf(sub(out[b], out[a])) / DEG;
      expect(Math.abs(deg / 30 - Math.round(deg / 30))).toBeLessThan(1e-6);
    }
  });

  it('puts a substituent straight out from a ring', () => {
    // toluene, the methyl drawn at an odd angle
    const ring = polygon(6, { x: 0, y: 0 }, L);
    const atoms = [...ring, { x: ring[0].x + 10, y: ring[0].y + 9 }];
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    expect(angleAt(out[1], out[0], out[6])).toBeCloseTo(120, 6);
    expect(angleAt(out[5], out[0], out[6])).toBeCloseTo(120, 6);
  });

  it('fuses rings on the side they were drawn', () => {
    // naphthalene: second ring on the right, both drawn squashed
    const left = polygon(6, { x: 0, y: 0 }, L, Math.PI / 6);
    // shared atoms are left[0] (lower right) and left[5] (upper right)
    const right = polygon(6, { x: L * Math.sqrt(3), y: 0 }, L, Math.PI / 6);
    // right ring atoms that are new: right[1], right[2], right[3], right[4]
    const atoms = messy([...left, right[1], right[2], right[3], right[4]].map((p) => ({ x: p.x * 1.2, y: p.y * 0.8 })), 2);
    // check the drawing really shares left[0] = right[3]-ish: right[2] and right[4] are the shared atoms
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1], [6, 7, 1], [7, 8, 1], [8, 9, 1], [9, 5, 1]];
    // (atoms 6–9 are right[1..4]; right[1] is next to left[0] and right[4] next to left[5])
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    const cl = centroid(out.slice(0, 6)), cr = centroid([out[0], out[5], ...out.slice(6)]);
    expect(cr.x).toBeGreaterThan(cl.x + L);
    for (const p of out.slice(0, 6)) expect(dist(p, cl)).toBeCloseTo(L, 6);
    for (const p of [out[0], out[5], ...out.slice(6)]) expect(dist(p, cr)).toBeCloseTo(L, 6);
  });

  it('keeps cis and trans double bonds', () => {
    for (const cis of [true, false]) {
      // but-2-ene, drawn roughly
      const atoms = [{ x: -18, y: 12 }, { x: -6, y: 1 }, { x: 9, y: -2 }, { x: 22, y: cis ? 8 : -13 }];
      const bonds: CleanBond[] = [[0, 1, 1], [1, 2, 2], [2, 3, 1]];
      const out = cleanUp(atoms, bonds, L);
      expectBondsL(out, bonds);
      const same = side(out[1], out[2], out[0]) === side(out[1], out[2], out[3]);
      expect(same).toBe(cis);
    }
  });

  it('keeps cis and trans for a double bond with branches', () => {
    // 3-methylpent-2-ene drawn with the ethyl cis to the far methyl
    const atoms = [{ x: 0, y: 0 }, { x: 13, y: -7 }, { x: 27, y: 0 }, { x: 28, y: 16 }, { x: 40, y: -9 }, { x: 54, y: -2 }];
    const bonds: CleanBond[] = [[0, 1, 1], [1, 2, 2], [2, 3, 1], [2, 4, 1], [4, 5, 1]];
    const before = side(atoms[1], atoms[2], atoms[0]) === side(atoms[1], atoms[2], atoms[4]);
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    expect(side(out[1], out[2], out[0]) === side(out[1], out[2], out[4])).toBe(before);
  });

  it('keeps the order of the bonds round a stereocentre', () => {
    // a carbon with four neighbours drawn unevenly, plus a chain on one of them
    const atoms = [{ x: 0, y: 0 }, { x: 15, y: 2 }, { x: -3, y: 14 }, { x: -12, y: -4 }, { x: 4, y: -16 }, { x: 28, y: -6 }];
    const bonds: CleanBond[] = [[0, 1, 1], [0, 2, 1], [0, 3, 1], [0, 4, 1], [1, 5, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    expect(roundOrder(out, 0, [1, 2, 3, 4])).toEqual(roundOrder(atoms, 0, [1, 2, 3, 4]));
  });

  it('keeps the order round a ring atom with two substituents', () => {
    // cyclohexane carbon with a wedge and a hash drawn on the outside
    const ring = polygon(6, { x: 0, y: 0 }, L);
    const atoms = messy([...ring, { x: ring[0].x + 14, y: ring[0].y - 9 }, { x: ring[0].x + 12, y: ring[0].y + 10 }], 1.5);
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1], [0, 7, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    expect(roundOrder(out, 0, [1, 5, 6, 7])).toEqual(roundOrder(atoms, 0, [1, 5, 6, 7]));
  });

  it('turns a ring hanging off a chain to point back along its bond', () => {
    // cyclohexyl–CH2–CH2–cyclopentyl, drawn crooked; the five-membered ring hangs off the chain
    const six = polygon(6, { x: 0, y: 0 }, L);
    const five = polygon(5, { x: 75, y: 20 }, 12, 0.7);
    const atoms = messy([...six, { x: 25, y: 5 }, { x: 45, y: 14 }, ...five], 2);
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1], [6, 7, 1], [7, 8, 1], ...ringBonds(5, 8)];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    // the chain leaves each ring straight out: 126° to both pentagon neighbours, 120° for the hexagon
    expect(angleAt(out[7], out[8], out[9])).toBeCloseTo(126, 6);
    expect(angleAt(out[7], out[8], out[12])).toBeCloseTo(126, 6);
    expect(angleAt(out[6], out[0], out[1])).toBeCloseTo(120, 6);
    expect(angleAt(out[6], out[0], out[5])).toBeCloseTo(120, 6);
  });

  it('moves a substituent drawn inside a ring to the outside, except at a stereocentre', () => {
    const ring = polygon(6, { x: 0, y: 0 }, L);
    // the methyl on atom 0 is drawn inside the ring
    const atoms = [...ring, { x: ring[0].x - 9, y: ring[0].y + 3 }];
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1]];
    const out = cleanUp(atoms, bonds, L);
    expect(angleAt(out[1], out[0], out[6])).toBeCloseTo(120, 6);
    expect(angleAt(out[5], out[0], out[6])).toBeCloseTo(120, 6);
    // marked as a stereocentre, its drawn side is kept
    const kept = cleanUp(atoms.map((p, i) => (i === 0 ? { ...p, keepOrder: true } : p)), bonds, L);
    expect(angleAt(kept[1], kept[0], kept[6])).toBeCloseTo(60, 6);
    expect(roundOrder(kept, 0, [1, 5, 6])).toEqual(roundOrder(atoms, 0, [1, 5, 6]));
  });

  it('places spiro rings without overlap', () => {
    // spiro[4.5]decane: atom 0 is shared
    const six = polygon(6, { x: 0, y: 0 }, L);
    const five = polygon(5, { x: six[0].x + 13, y: six[0].y }, 12, Math.PI);
    const atoms = messy([...six, ...five.slice(1)], 2);
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1], [6, 7, 1], [7, 8, 1], [8, 9, 1], [9, 0, 1]];
    const out = cleanUp(atoms, bonds, L);
    expectBondsL(out, bonds);
    for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) expect(dist(out[i], out[j])).toBeGreaterThan(L * 0.9);
  });

  it('keeps the drawn shape of a bridged ring system, resized', () => {
    // norbornane: bridgeheads 0 and 3, bridges 1–2, 4–5 and 6
    const atoms = [{ x: 0, y: 0 }, { x: 15, y: -14 }, { x: 35, y: -14 }, { x: 50, y: 0 }, { x: 35, y: 14 }, { x: 15, y: 14 }, { x: 25, y: -3 }];
    const bonds: CleanBond[] = [[0, 1, 1], [1, 2, 1], [2, 3, 1], [3, 4, 1], [4, 5, 1], [5, 0, 1], [0, 6, 1], [6, 3, 1]];
    const out = cleanUp(atoms, bonds, L);
    // same shape: every distance scaled by the same factor
    const k = dist(out[0], out[2]) / dist(atoms[0], atoms[2]);
    for (let i = 0; i < atoms.length; i++) for (let j = i + 1; j < atoms.length; j++) {
      expect(dist(out[i], out[j])).toBeCloseTo(dist(atoms[i], atoms[j]) * k, 6);
    }
    // bonds average L long
    const mean = bonds.reduce((s, [a, b]) => s + dist(out[a], out[b]), 0) / bonds.length;
    expect(mean).toBeCloseTo(L, 6);
  });

  it('does nothing more to a structure that is already clean', () => {
    const ring = polygon(6, { x: 0, y: 0 }, L);
    const atoms = messy([...ring, { x: 30, y: 4 }, { x: 44, y: -6 }, { x: 58, y: 3 }], 3);
    const bonds: CleanBond[] = [...ringBonds(6), [0, 6, 1], [6, 7, 2], [7, 8, 1]];
    const once = cleanUp(atoms, bonds, L);
    const twice = cleanUp(once, bonds, L);
    once.forEach((p, i) => { expect(twice[i].x).toBeCloseTo(p.x, 6); expect(twice[i].y).toBeCloseTo(p.y, 6); });
  });

  it('cleans separate structures separately', () => {
    const a = messy(polygon(6, { x: 0, y: 0 }, 15), 2), b = messy(polygon(5, { x: 200, y: 0 }, 13), 2);
    const out = cleanUp([...a, ...b], [...ringBonds(6), ...ringBonds(5, 6)], L);
    const ca = centroid(a), cb = centroid(b), oa = centroid(out.slice(0, 6)), ob = centroid(out.slice(6));
    expect(oa.x).toBeCloseTo(ca.x, 6);
    expect(ob.x).toBeCloseTo(cb.x, 6);
    expect(ob.y).toBeCloseTo(cb.y, 6);
  });
});

describe('Clean Up Structure on the templates', () => {
  const bridged = new Set(['norbornane', 'bicyclooctane', 'adamantane']);
  for (const t of TEMPLATES.filter((t) => t.group === 'rings' || t.group === 'heterocycles')) {
    it(`${t.name}: a wobbly copy comes back in the template's shape`, () => {
      const atoms = messy(t.atoms.map(([x, y]) => ({ x: 300 + x * L, y: 200 + y * L })), bridged.has(t.id) ? 0 : 3);
      const bonds: CleanBond[] = t.bonds.map(([a, b, o]) => [a, b, o]);
      const out = cleanUp(atoms, bonds, L);
      if (!bridged.has(t.id)) expectBondsL(out, bonds);
      // every distance as in the template (which is drawn with even bonds already)
      const k = bridged.has(t.id) ? dist(out[0], out[1]) / dist(atoms[0], atoms[1]) : 1;
      for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
        const want = bridged.has(t.id) ? dist(atoms[i], atoms[j]) * k : Math.hypot(t.atoms[i][0] - t.atoms[j][0], t.atoms[i][1] - t.atoms[j][1]) * L;
        expect(Math.abs(dist(out[i], out[j]) - want)).toBeLessThan(L * 0.05);
      }
    });
  }
});
