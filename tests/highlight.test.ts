// @vitest-environment jsdom
//
// Highlight looks: shapes under atoms and bonds, grown round labels, soft edges and shadows,
// all going round the same way so one highlight fills as one; and their look saved in CDXML.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { atomPiece, bondPiece, centredSpots, clockwise, fullStyle, highlightPieces, highlightSizes, highlightStyleFromTag, tracePieces, type Piece } from '../src/render/highlight';
import { tidyStyle } from '../src/ui/style-panel';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';

const area = (pts: { x: number; y: number }[]) => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0) / 2;

describe('highlight shapes', () => {
  it('scales with the bond length and the size chosen', () => {
    expect(highlightSizes(20)).toEqual({ disc: 5.4, band: 4.2 });
    expect(highlightSizes(20, 2).disc).toBeCloseTo(10.8, 9);
  });

  it('turns every outline the same way', () => {
    const ccw = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }];
    expect(area(clockwise(ccw))).toBeGreaterThan(0);
    expect(area(clockwise(clockwise(ccw)))).toBeGreaterThan(0);
    const b = bondPiece({ x: 0, y: 0 }, { x: 10, y: 5 }, 4, 'straight');
    if (b.kind !== 'poly') throw new Error('expected an outline');
    expect(area(b.pts)).toBeGreaterThan(0);
  });

  it('is a disc of the usual size under a plain atom', () => {
    expect(atomPiece({ x: 3, y: 4 }, 5, null, 1)).toEqual({ kind: 'disc', c: { x: 3, y: 4 }, r: 5 });
    expect(atomPiece({ x: 3, y: 4 }, 5, null, 1, 2)).toEqual({ kind: 'disc', c: { x: 3, y: 4 }, r: 7 });
  });

  it('grows round a long label so the whole label sits on it', () => {
    // "OTBS": 24 wide, 8 high, centred on (12, 0)
    const label = { x1: 0, y1: -4, x2: 24, y2: 4 };
    expect(atomPiece({ x: 4, y: 0 }, 5, label, 1)).toEqual({ kind: 'band', p: { x: 4, y: 0 }, q: { x: 20, y: 0 }, r: 5 });
  });

  it('draws bands with round ends, or flat ends at the atoms when straight', () => {
    expect(bondPiece({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 'round')).toEqual({ kind: 'band', p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, r: 3 });
    const st = bondPiece({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 'straight');
    if (st.kind !== 'poly') throw new Error('expected an outline');
    expect(Math.min(...st.pts.map((p) => p.x))).toBeCloseTo(0, 9);
    expect(Math.max(...st.pts.map((p) => p.x))).toBeCloseTo(10, 9);
    expect(Math.max(...st.pts.map((p) => p.y))).toBeCloseTo(3, 9);
  });

  it('traces a band as one closed loop', () => {
    const calls: string[] = [];
    tracePieces({ moveTo: () => calls.push('m'), lineTo: () => calls.push('l'), arc: () => calls.push('a'), closePath: () => calls.push('z') },
      [{ kind: 'band', p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, r: 2 }]);
    expect(calls).toEqual(['m', 'a', 'a', 'z']);
  });
});

// a chain bent at 120° (as in a drawn structure), bond length 20
const L = 20, sizes = highlightSizes(L);
const chain = () => {
  const a = { x: 0, y: 0 }, b = { x: L * Math.cos(Math.PI / 6), y: -L / 2 }, c = { x: 2 * L * Math.cos(Math.PI / 6), y: 0 };
  return { a, b, c, bonds: [[a, b], [b, c]] as [{ x: number; y: number }, { x: number; y: number }][] };
};
/** The top of some pieces (outlines only). */
const top = (ps: Piece[]) => Math.min(...ps.flatMap((pc) => (pc.kind === 'poly' ? pc.pts.map((p) => p.y) : [])));
/** The farthest left any piece reaches. */
const left = (ps: Piece[]) => Math.min(...ps.flatMap((pc) => pc.kind === 'poly' ? pc.pts.map((p) => p.x) : pc.kind === 'disc' ? [pc.c.x - pc.r] : [Math.min(pc.p.x, pc.q.x) - pc.r]));

describe('straight and smooth highlights', () => {
  it('makes a straight highlight one even band with a sharp corner, not a shape on each atom', () => {
    const { a, b, c, bonds } = chain();
    const ps = highlightPieces(bonds, [a, b, c].map((at) => ({ at, label: null })), sizes, fullStyle({ shape: 'straight' }), 1);
    // the corner at the bend: the band's outer edges carried on to meet (h / sin 60° out)
    expect(b.y - top(ps)).toBeCloseTo(sizes.band / Math.sin(Math.PI / 3), 6);
    for (const pc of ps) if (pc.kind === 'poly') expect(area(pc.pts)).toBeGreaterThan(0);
  });

  it('ends a straight band round, square or in a point', () => {
    const { a, b, c, bonds } = chain();
    const atoms = [a, b, c].map((at) => ({ at, label: null }));
    const reach = (ends: 'round' | 'square' | 'pointed') => -left(highlightPieces(bonds, atoms, sizes, fullStyle({ shape: 'straight', ends }), 1));
    const h = sizes.band;
    expect(reach('round')).toBeCloseTo(h, 6);
    // the square's far corner, turned with the bond (30° off level)
    expect(reach('square')).toBeCloseTo(h * Math.cos(Math.PI / 6) + h * Math.sin(Math.PI / 6), 6);
    expect(reach('pointed')).toBeCloseTo(h * Math.cos(Math.PI / 6), 6);
  });

  it('puts a disc round each label on a straight highlight', () => {
    const { a, b, c, bonds } = chain();
    const label = { x1: b.x - 5, y1: b.y - 5, x2: b.x + 5, y2: b.y + 5 };
    const ps = highlightPieces(bonds, [{ at: a, label: null }, { at: b, label }, { at: c, label: null }], sizes, fullStyle({ shape: 'straight' }), 0.5);
    expect(ps).toContainEqual({ kind: 'band', p: { x: b.x, y: b.y }, q: { x: b.x, y: b.y }, r: 5.5 });
  });

  it('keeps a disc under an atom with no highlighted bond', () => {
    const at = { x: 5, y: 5 };
    for (const style of [{ shape: 'straight' as const }, { smooth: true }]) expect(highlightPieces([], [{ at, label: null }], sizes, fullStyle(style), 1)).toEqual([{ kind: 'disc', c: at, r: sizes.disc }]);
  });

  it('puts a disc on each atom of a round highlight unless it is smooth', () => {
    const { a, b, c, bonds } = chain();
    const atoms = [a, b, c].map((at) => ({ at, label: null }));
    const bumpy = highlightPieces(bonds, atoms, sizes, fullStyle(undefined), 1);
    expect(bumpy.filter((pc) => pc.kind === 'disc')).toHaveLength(3);
    const smooth = highlightPieces(bonds, atoms, sizes, fullStyle({ smooth: true }), 1);
    expect(smooth).toEqual(bonds.map(([p, q]) => ({ kind: 'band', p, q, r: sizes.band })));
  });
});

describe('highlights centred on double bonds', () => {
  it('takes a ring in by half the gap on every side', () => {
    // a hexagon of side 20 round the origin, each side moved 2 toward the middle
    const ring = Array.from({ length: 6 }, (_, i) => ({ x: 20 * Math.cos((i * Math.PI) / 3), y: 20 * Math.sin((i * Math.PI) / 3) }));
    const lines = ring.map((p, i) => {
      const q = ring[(i + 1) % 6], m = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 }, l = Math.hypot(m.x, m.y);
      return { p, q, shift: { x: (-m.x / l) * 2, y: (-m.y / l) * 2 } };
    });
    const spots = centredSpots(lines);
    for (const a of ring) {
      const s = spots.get(a)!;
      // each corner moves toward the middle by d / cos 30°, so each side moves in by d
      expect(Math.hypot(s.x, s.y)).toBeCloseTo(20 - 2 / Math.cos(Math.PI / 6), 6);
    }
  });

  it('moves a double bond outside a ring toward its second line, and leaves other atoms', () => {
    const p = { x: 0, y: 0 }, q = { x: 20, y: 0 }, r = { x: 30, y: 10 };
    const spots = centredSpots([{ p, q, shift: { x: 0, y: 1.5 } }, { p: q, q: r, shift: { x: 0, y: 0 } }]);
    expect(spots.get(p)!.x).toBeCloseTo(0, 6);
    expect(spots.get(p)!.y).toBeCloseTo(1.5, 6);
    expect(spots.has(r)).toBe(false);
  });

  it('keeps a single bond between double bonds on its own line, at the bonds\' angles', () => {
    // a zigzag triene: = - = with 120° corners, the double bonds' second lines below
    const L = 20, c = Math.cos(Math.PI / 6) * L, h = L / 2;
    const at = [{ x: 0, y: 0 }, { x: c, y: -h }, { x: 2 * c, y: 0 }, { x: 3 * c, y: -h }];
    const below = (p: { x: number; y: number }, q: { x: number; y: number }, d: number) => {
      const l = Math.hypot(q.x - p.x, q.y - p.y);
      let n = { x: -(q.y - p.y) / l, y: (q.x - p.x) / l };
      if (n.y < 0) n = { x: -n.x, y: -n.y };
      return { x: n.x * d, y: n.y * d };
    };
    const spots = centredSpots([
      { p: at[0], q: at[1], shift: below(at[0], at[1], 1.5) },
      { p: at[1], q: at[2], shift: { x: 0, y: 0 } },
      { p: at[2], q: at[3], shift: below(at[2], at[3], 1.5) },
    ]);
    const s1 = spots.get(at[1])!, s2 = spots.get(at[2])!;
    // the single bond's ends stay on its own line…
    const u = { x: at[2].x - at[1].x, y: at[2].y - at[1].y };
    const off = (s: { x: number; y: number }) => ((s.x - at[1].x) * u.y - (s.y - at[1].y) * u.x) / Math.hypot(u.x, u.y);
    expect(off(s1)).toBeCloseTo(0, 6);
    expect(off(s2)).toBeCloseTo(0, 6);
    // …and each double bond's band runs parallel to it, 1.5 off
    const s0 = spots.get(at[0])!;
    expect(Math.atan2(s1.y - s0.y, s1.x - s0.x)).toBeCloseTo(Math.atan2(at[1].y - at[0].y, at[1].x - at[0].x), 6);
  });
});

describe('highlight look', () => {
  it('fills in the usual look, and keeps only what differs from it', () => {
    expect(fullStyle(undefined)).toEqual({ shape: 'round', ends: 'round', size: 1, fit: true, shadow: false, soft: false, smooth: false, centre: false });
    expect(tidyStyle({ shape: 'round', size: 1.5, shadow: false })).toEqual({ size: 1.5 });
    expect(tidyStyle({ fit: true })).toBeUndefined();
  });

  it('reads a saved look, leaving out nonsense', () => {
    expect(highlightStyleFromTag('{"shape":"straight","ends":"pointed","centre":true}')).toEqual({ shape: 'straight', ends: 'pointed', centre: true });
    // diamonds and squares from older files are straight, with pointed or square ends
    expect(highlightStyleFromTag('{"shape":"diamond","size":2,"soft":true}')).toEqual({ shape: 'straight', ends: 'pointed', size: 2, soft: true });
    expect(highlightStyleFromTag('{"shape":"square"}')).toEqual({ shape: 'straight', ends: 'square' });
    expect(highlightStyleFromTag('{"smooth":true}')).toEqual({ smooth: true });
    expect(highlightStyleFromTag('{"shape":"star","size":-1,"shadow":"yes"}')).toBeUndefined();
    expect(highlightStyleFromTag('nope')).toBeUndefined();
  });

  it('keeps the look through CDXML', () => {
    const doc = new Doc();
    doc.edit('Draw', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(20, 0);
      doc.addBond(a.id, b.id, 1, 'Solid', { highlight: '#ffe680', hl: { shape: 'straight', ends: 'square', centre: true, shadow: true } });
      doc.updateAtom(a.id, { highlight: '#ffe680', hl: { size: 1.6, soft: true, smooth: true } });
    });
    const back = readCdxml(writeCdxml(doc)).doc;
    const atom = [...back.atoms.values()].find((x) => x.highlight)!;
    const bond = [...back.bonds.values()][0];
    expect(atom.hl).toEqual({ size: 1.6, soft: true, smooth: true });
    expect(bond.hl).toEqual({ shape: 'straight', ends: 'square', centre: true, shadow: true });
  });
});
