// Drawing styles: the journal presets, reading a saved style back, and changing a drawing to a
// new style either by redrawing what is there or by keeping its look for new work only.

import { describe, it, expect } from 'vitest';
import { Doc } from '../src/model';
import { ACS_1996 } from '../src/style';
import { STYLE_PRESETS, presetNamed, sameLook, cleanStyle, applyStyle, restyleContents, scaleStyle, parseOwnStyles, parseModeStyles, styleNamed } from '../src/drawing-styles';

const RSC = presetNamed('RSC')!.style;

/** Ethane-ish: three atoms in a chain at ACS bond length, plus a caption. */
function sample(): Doc {
  const d = new Doc();
  d.edit('draw', () => {
    const a = d.addAtom(0, 0), b = d.addAtom(14.4, 0), c = d.addAtom(28.8, 0, 8);
    d.addBond(a.id, b.id);
    d.addBond(b.id, c.id);
    d.addCaption({ x: 0, y: 30, runs: [{ text: '1', size: ACS_1996.captionSize, font: 'Arial' }, { text: 'plain' }], justify: 'left' });
  });
  return d;
}

const bondLen = (d: Doc) => {
  const b = [...d.bonds.values()][0];
  const p = d.atoms.get(b.a1)!, q = d.atoms.get(b.a2)!;
  return Math.hypot(p.x - q.x, p.y - q.y);
};

describe('built-in styles', () => {
  it('have every number positive and a source', () => {
    for (const p of STYLE_PRESETS) {
      expect(cleanStyle(p.style)).not.toBeNull();
      expect(p.source.length).toBeGreaterThan(10);
    }
  });

  it('take the RSC values from its guideline (cm to points)', () => {
    expect(RSC.bondLength).toBeCloseTo(0.43 * 28.3465, 1);
    expect(RSC.lineWidth).toBeCloseTo(0.016 * 28.3465, 2);
    expect(RSC.bondSpacing).toBe(20);
    expect(RSC.labelSize).toBe(7);
  });

  it('tell apart styles that draw differently, ignoring the name', () => {
    expect(sameLook(ACS_1996, { ...ACS_1996, name: 'Mine' })).toBe(true);
    expect(sameLook(ACS_1996, RSC)).toBe(false);
  });
});

describe('reading a saved style', () => {
  it('keeps a good one', () => {
    expect(cleanStyle({ ...RSC, name: ' My RSC ' })).toEqual({ ...RSC, name: 'My RSC' });
  });

  it('turns down a missing name or a bad number', () => {
    expect(cleanStyle({ ...RSC, name: '' })).toBeNull();
    expect(cleanStyle({ ...RSC, bondLength: -1 })).toBeNull();
    expect(cleanStyle({ ...RSC, lineWidth: 'thin' })).toBeNull();
    expect(cleanStyle(null)).toBeNull();
  });
});

describe('changing a drawing to a new style', () => {
  it('redraws structures at the new bond length about their middle', () => {
    const d = sample();
    d.edit('style', () => applyStyle(d, RSC, 'restyle'));
    expect(bondLen(d)).toBeCloseTo(RSC.bondLength, 6);
    const xs = [...d.atoms.values()].map((a) => a.x);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(14.4, 6);
    expect(d.style.name).toBe('RSC');
  });

  it('puts sizes set by hand back to the style when redrawing', () => {
    const d = sample();
    const id = [...d.atoms.keys()][2];
    d.edit('scale', () => d.updateAtom(id, { s: 1.5 }));
    d.edit('style', () => applyStyle(d, RSC, 'restyle'));
    expect(d.atoms.get(id)!.s).toBeUndefined();
  });

  it('moves caption text written in the old caption size to the new one', () => {
    const d = sample();
    d.edit('style', () => applyStyle(d, RSC, 'restyle'));
    const runs = [...d.captions.values()][0].runs;
    expect(runs[0].size).toBe(RSC.captionSize);
    expect(runs[1].size).toBeUndefined();
  });

  it('keeps what is there looking the same when only new work takes the style', () => {
    const d = sample();
    d.edit('style', () => applyStyle(d, RSC, 'new-only'));
    expect(bondLen(d)).toBeCloseTo(14.4, 6);
    const o = [...d.atoms.values()][2];
    expect((o.s ?? 1) * RSC.labelSize).toBeCloseTo(ACS_1996.labelSize, 6);
    const b = [...d.bonds.values()][0];
    expect((b.s ?? 1) * RSC.lineWidth).toBeCloseTo(ACS_1996.lineWidth, 6);
    const runs = [...d.captions.values()][0].runs;
    expect(runs[1]).toMatchObject({ size: ACS_1996.captionSize, font: ACS_1996.captionFont });
    expect(d.style.name).toBe('RSC');
  });

  it('comes back in one undo, style and all', () => {
    const d = sample();
    const before = [...d.atoms.values()].map((a) => [a.x, a.y]);
    d.edit('style', () => applyStyle(d, RSC, 'restyle'));
    d.undo();
    expect(d.style).toEqual(ACS_1996);
    expect([...d.atoms.values()].map((a) => [a.x, a.y])).toEqual(before);
    d.redo();
    expect(d.style.name).toBe('RSC');
    expect(bondLen(d)).toBeCloseTo(RSC.bondLength, 6);
  });
});

describe('your own styles', () => {
  it('scale as a whole, keeping proportions', () => {
    const big = scaleStyle(ACS_1996, 2);
    expect(big.bondLength).toBeCloseTo(28.8);
    expect(big.lineWidth / big.bondLength).toBeCloseTo(ACS_1996.lineWidth / ACS_1996.bondLength);
    expect(big.bondSpacing).toBe(ACS_1996.bondSpacing);
  });

  it('are read back without bad entries or repeated names', () => {
    const own = parseOwnStyles([{ ...RSC, name: 'Mine' }, { ...RSC, name: 'Mine', bondLength: 99 }, { name: 'Broken' }, 5]);
    expect(own.map((s) => s.name)).toEqual(['Mine']);
    expect(parseModeStyles({ drawing: 'Mine', slides: '', bogus: 'x' })).toEqual({ drawing: 'Mine' });
  });

  it('are found by name before a built-in one of the same name', () => {
    const own = [{ ...RSC, bondLength: 13 }];
    expect(styleNamed('RSC', own)!.bondLength).toBe(13);
    expect(styleNamed('Nature journals', own)!.labelSize).toBe(6);
    expect(styleNamed('Nothing', own)).toBeUndefined();
  });
});

describe('stored drawings (document figures)', () => {
  it('are redrawn in a new style like a drawing is', () => {
    const c = restyleContents(sample().contents(), ACS_1996, RSC, 'restyle');
    const [p, q] = c.atoms;
    expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeCloseTo(RSC.bondLength, 6);
  });
});
