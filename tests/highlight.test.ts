// @vitest-environment jsdom
//
// Highlight looks: shapes under atoms and bonds, grown round labels, soft edges and shadows,
// all going round the same way so one highlight fills as one; and their look saved in CDXML.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { atomPiece, bondPiece, clockwise, fullStyle, highlightPieces, highlightSizes, highlightStyleFromTag, tracePieces, type Piece } from '../src/render/highlight';
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
    for (const shape of ['diamond', 'square'] as const) {
      const a = atomPiece({ x: 0, y: 0 }, 5, shape, null, 0);
      const b = bondPiece({ x: 0, y: 0 }, { x: 10, y: 5 }, 4, shape);
      if (a.kind !== 'poly' || b.kind !== 'poly') throw new Error('expected outlines');
      expect(area(a.pts)).toBeGreaterThan(0);
      expect(area(b.pts)).toBeGreaterThan(0);
    }
  });

  it('is a disc of the usual size under a plain atom', () => {
    expect(atomPiece({ x: 3, y: 4 }, 5, 'round', null, 1)).toEqual({ kind: 'disc', c: { x: 3, y: 4 }, r: 5 });
    expect(atomPiece({ x: 3, y: 4 }, 5, 'round', null, 1, 2)).toEqual({ kind: 'disc', c: { x: 3, y: 4 }, r: 7 });
  });

  it('grows round a long label so the whole label sits on it', () => {
    // "OTBS": 24 wide, 8 high, centred on (12, 0)
    const label = { x1: 0, y1: -4, x2: 24, y2: 4 };
    const pill = atomPiece({ x: 4, y: 0 }, 5, 'round', label, 1);
    expect(pill).toEqual({ kind: 'band', p: { x: 4, y: 0 }, q: { x: 20, y: 0 }, r: 5 });
    const sq = atomPiece({ x: 4, y: 0 }, 5, 'square', label, 1);
    if (sq.kind !== 'poly') throw new Error('expected a square');
    expect(Math.min(...sq.pts.map((p) => p.x))).toBe(-1);
    expect(Math.max(...sq.pts.map((p) => p.x))).toBe(25);
    // a diamond half as wide again as the label (with its pad), and never smaller than a plain one
    const di = atomPiece({ x: 4, y: 0 }, 5, 'diamond', label, 1);
    if (di.kind !== 'poly') throw new Error('expected a diamond');
    expect(Math.max(...di.pts.map((p) => p.x)) - 12).toBeCloseTo(19.5, 9);
    expect(Math.max(...di.pts.map((p) => p.y))).toBeCloseTo(7.5, 9);
  });

  it('draws bands with round or square ends past the atoms, or flat ends for diamonds', () => {
    expect(bondPiece({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 'round')).toEqual({ kind: 'band', p: { x: 0, y: 0 }, q: { x: 10, y: 0 }, r: 3 });
    const sq = bondPiece({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 'square');
    if (sq.kind !== 'poly') throw new Error('expected an outline');
    expect(Math.min(...sq.pts.map((p) => p.x))).toBeCloseTo(-3, 9);
    expect(Math.max(...sq.pts.map((p) => p.y))).toBeCloseTo(3, 9);
    const di = bondPiece({ x: 0, y: 0 }, { x: 10, y: 0 }, 3, 'diamond');
    if (di.kind !== 'poly') throw new Error('expected an outline');
    expect(Math.max(...di.pts.map((p) => p.x))).toBeCloseTo(10, 9);
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

describe('smooth highlights', () => {
  it('makes square and diamond highlights one even band with a sharp corner, not a shape on each atom', () => {
    for (const shape of ['square', 'diamond'] as const) {
      const { a, b, c, bonds } = chain();
      const ps = highlightPieces(bonds, [a, b, c].map((at) => ({ at, label: null })), sizes, fullStyle({ shape }), 1);
      // the corner at the bend: the band's outer edges carried on to meet (h / sin 60° out)
      expect(b.y - top(ps)).toBeCloseTo(sizes.band / Math.sin(Math.PI / 3), 6);
      for (const pc of ps) if (pc.kind === 'poly') expect(area(pc.pts)).toBeGreaterThan(0);
      expect(ps.some((pc) => pc.kind === 'disc')).toBe(false);
    }
  });

  it('ends a square band square and a diamond band in a point', () => {
    const { a, b, c, bonds } = chain();
    const sq = highlightPieces(bonds, [a, b, c].map((at) => ({ at, label: null })), sizes, fullStyle({ shape: 'square' }), 1);
    const di = highlightPieces(bonds, [a, b, c].map((at) => ({ at, label: null })), sizes, fullStyle({ shape: 'diamond' }), 1);
    // past the end atom by the band's half width: square corners, or one point
    expect(Math.min(...sq.flatMap((pc) => pc.kind === 'poly' ? pc.pts.map((p) => p.x) : []))).toBeCloseTo(-sizes.band * Math.cos(Math.PI / 6) - sizes.band * Math.sin(Math.PI / 6), 6);
    const tip = di.flatMap((pc) => pc.kind === 'poly' ? pc.pts : []).reduce((m, p) => (p.x - a.x) * Math.cos(Math.PI / 6) - (p.y - a.y) * -0.5 < (m.x - a.x) * Math.cos(Math.PI / 6) - (m.y - a.y) * -0.5 ? p : m);
    expect(Math.hypot(tip.x - a.x, tip.y - a.y)).toBeCloseTo(sizes.band, 6);
  });

  it('keeps the shape under an atom with no highlighted bond', () => {
    const at = { x: 5, y: 5 };
    expect(highlightPieces([], [{ at, label: null }], sizes, fullStyle({ shape: 'diamond' }), 1)).toEqual([atomPiece(at, sizes.disc, 'diamond', null, 1)]);
    expect(highlightPieces([], [{ at, label: null }], sizes, fullStyle({ smooth: true }), 1)).toEqual([{ kind: 'disc', c: at, r: sizes.disc }]);
  });

  it('puts a disc on each atom of a round highlight unless it is smooth', () => {
    const { a, b, c, bonds } = chain();
    const atoms = [a, b, c].map((at) => ({ at, label: null }));
    const bumpy = highlightPieces(bonds, atoms, sizes, fullStyle(undefined), 1);
    expect(bumpy.filter((pc) => pc.kind === 'disc')).toHaveLength(3);
    const smooth = highlightPieces(bonds, atoms, sizes, fullStyle({ smooth: true }), 1);
    expect(smooth).toEqual(bonds.map(([p, q]) => ({ kind: 'band', p, q, r: sizes.band })));
  });

  it('swells the band just enough to hold a label at a bend', () => {
    const { a, b, c, bonds } = chain();
    // a label as big as an N: wider than the band
    const label = { x1: b.x - 5, y1: b.y - 5, x2: b.x + 5, y2: b.y + 5 };
    const ps = highlightPieces(bonds, [{ at: a, label: null }, { at: b, label }, { at: c, label: null }], sizes, fullStyle({ shape: 'square' }), 0.5);
    const inPiece = (v: { x: number; y: number }) => ps.some((pc) => {
      if (pc.kind !== 'poly') return false;
      let n = false;
      for (let i = 0, j = pc.pts.length - 1; i < pc.pts.length; j = i++) {
        const p = pc.pts[i], q = pc.pts[j];
        if ((p.y > v.y) !== (q.y > v.y) && v.x < ((q.x - p.x) * (v.y - p.y)) / (q.y - p.y) + p.x) n = !n;
      }
      return n;
    });
    for (const v of [{ x: b.x + 5.4, y: b.y }, { x: b.x - 5.4, y: b.y }, { x: b.x, y: b.y + 5.4 }, { x: b.x, y: b.y - 5.4 }]) expect(inPiece(v)).toBe(true);
    // and no further than it needs
    expect(b.y - top(ps)).toBeLessThan(5.4 + sizes.band);
  });
});

describe('highlight look', () => {
  it('fills in the usual look, and keeps only what differs from it', () => {
    expect(fullStyle(undefined)).toEqual({ shape: 'round', size: 1, fit: true, shadow: false, soft: false, smooth: false });
    expect(tidyStyle({ shape: 'round', size: 1.5, shadow: false })).toEqual({ size: 1.5 });
    expect(tidyStyle({ fit: true })).toBeUndefined();
  });

  it('reads a saved look, leaving out nonsense', () => {
    expect(highlightStyleFromTag('{"shape":"diamond","size":2,"soft":true}')).toEqual({ shape: 'diamond', size: 2, soft: true });
    expect(highlightStyleFromTag('{"smooth":true}')).toEqual({ smooth: true });
    expect(highlightStyleFromTag('{"shape":"star","size":-1,"shadow":"yes"}')).toBeUndefined();
    expect(highlightStyleFromTag('nope')).toBeUndefined();
  });

  it('keeps the look through CDXML', () => {
    const doc = new Doc();
    doc.edit('Draw', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(20, 0);
      doc.addBond(a.id, b.id, 1, 'Solid', { highlight: '#ffe680', hl: { shape: 'square', shadow: true } });
      doc.updateAtom(a.id, { highlight: '#ffe680', hl: { size: 1.6, soft: true, smooth: true } });
    });
    const back = readCdxml(writeCdxml(doc)).doc;
    const atom = [...back.atoms.values()].find((x) => x.highlight)!;
    const bond = [...back.bonds.values()][0];
    expect(atom.hl).toEqual({ size: 1.6, soft: true, smooth: true });
    expect(bond.hl).toEqual({ shape: 'square', shadow: true });
  });
});
