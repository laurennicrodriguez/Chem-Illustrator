// @vitest-environment jsdom
//
// Highlight looks: shapes under atoms and bonds, grown round labels, soft edges and shadows,
// all going round the same way so one highlight fills as one; and their look saved in CDXML.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { atomPiece, bondPiece, clockwise, fullStyle, highlightSizes, highlightStyleFromTag, tracePieces } from '../src/render/highlight';
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

describe('highlight look', () => {
  it('fills in the usual look, and keeps only what differs from it', () => {
    expect(fullStyle(undefined)).toEqual({ shape: 'round', size: 1, fit: true, shadow: false, soft: false });
    expect(tidyStyle({ shape: 'round', size: 1.5, shadow: false })).toEqual({ size: 1.5 });
    expect(tidyStyle({ fit: true })).toBeUndefined();
  });

  it('reads a saved look, leaving out nonsense', () => {
    expect(highlightStyleFromTag('{"shape":"diamond","size":2,"soft":true}')).toEqual({ shape: 'diamond', size: 2, soft: true });
    expect(highlightStyleFromTag('{"shape":"star","size":-1,"shadow":"yes"}')).toBeUndefined();
    expect(highlightStyleFromTag('nope')).toBeUndefined();
  });

  it('keeps the look through CDXML', () => {
    const doc = new Doc();
    doc.edit('Draw', () => {
      const a = doc.addAtom(0, 0), b = doc.addAtom(20, 0);
      doc.addBond(a.id, b.id, 1, 'Solid', { highlight: '#ffe680', hl: { shape: 'square', shadow: true } });
      doc.updateAtom(a.id, { highlight: '#ffe680', hl: { size: 1.6, soft: true } });
    });
    const back = readCdxml(writeCdxml(doc)).doc;
    const atom = [...back.atoms.values()].find((x) => x.highlight)!;
    const bond = [...back.bonds.values()][0];
    expect(atom.hl).toEqual({ size: 1.6, soft: true });
    expect(bond.hl).toEqual({ shape: 'square', shadow: true });
  });
});
