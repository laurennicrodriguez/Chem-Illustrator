// @vitest-environment jsdom
//
// Number Compounds: numbers under structures in the order a reader meets them.

import { describe, expect, it } from 'vitest';
import { Doc } from '../src/model';
import { plainMeasure } from '../src/chem/reaction';
import { labelNumber, nextNumber, planNumbers, idText, letterId, romanId, fromRoman, parseIdStart, labelClashes } from '../src/chem/compound-numbers';

function bond(doc: Doc, x: number, y: number): number {
  const a = doc.addAtom(x - 6, y), b = doc.addAtom(x + 6, y);
  doc.addBond(a.id, b.id);
  return a.id;
}
function arrow(doc: Doc, x1: number, y1: number, x2: number, y2: number) {
  return doc.addArrow({ tail: { x: x1, y: y1 }, head: { x: x2, y: y2 }, headStyle: 'full', tailStyle: 'none', headType: 'solid', line: 'solid', noGo: false, equilibrium: false, sweep: 0, headLength: 6, headWidth: 2 }).id;
}

const order = (doc: Doc, opts = { start: 1 }) => planNumbers(doc, plainMeasure(doc), new Set(), opts).labels.map((l) => [l.item.ref, l.text]);

describe('numbering compounds', () => {
  it('follows the arrows, even when a product is drawn first', () => {
    const doc = new Doc();
    const { a, b, c } = doc.edit('build', () => {
      // C ← B on the top row (the arrow points left), A → B below... read as A, B, C
      const c = bond(doc, 0, 0), b = bond(doc, 80, 0);
      arrow(doc, 68, 0, 12, 0);
      const a = bond(doc, 80, 60);
      arrow(doc, 80, 52, 80, 8);
      return { a, b, c };
    });
    expect(order(doc)).toEqual([['a' + a, '1'], ['a' + b, '2'], ['a' + c, '3']]);
  });

  it('numbers loose structures left to right and row by row, skipping reagents over arrows', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const x = bond(doc, 0, 0), y = bond(doc, 100, 0);
      arrow(doc, 12, 0, 88, 0);
      const reagent = bond(doc, 50, -10);
      const z = bond(doc, 0, 80);
      return { x, y, z, reagent };
    });
    expect(order(doc).map((o) => o[0])).toEqual(['a' + ids.x, 'a' + ids.y, 'a' + ids.z]);
    expect(planNumbers(doc, plainMeasure(doc), new Set(), { start: 1, reagents: true }).labels).toHaveLength(4);
  });

  it('changes numbers already under structures, or keeps them, and finds the next free one', () => {
    const doc = new Doc();
    doc.edit('build', () => {
      bond(doc, 0, 0); bond(doc, 60, 0);
      doc.addCaption({ x: -3, y: 14, runs: [{ text: '7', bold: true }], justify: 'left' });
    });
    const m = plainMeasure(doc);
    const again = planNumbers(doc, m, new Set(), { start: 1 }).labels;
    expect(again.map((l) => l.text)).toEqual(['1', '2']);
    expect(again[0].caption).toBeDefined();
    expect(planNumbers(doc, m, new Set(), { start: 8, keep: true }).labels.map((l) => l.text)).toEqual(['8']);
    expect(nextNumber(doc, m)).toBe(8);
    expect(planNumbers(doc, m, new Set(), { start: 3, letters: true }).labels.map((l) => l.text)).toEqual(['3a', '3b']);
  });

  it('reads the number in a label', () => {
    expect(labelNumber('12')).toBe(12);
    expect(labelNumber('2a')).toBe(2);
    expect(labelNumber('(±)-5')).toBe(5);
    expect(labelNumber('Pd(0)')).toBeNull();
  });
});

describe('ID styles', () => {
  it('counts in each style from where it starts', () => {
    const ids = (style: Parameters<typeof idText>[0], start: number) => [0, 1, 2].map((k) => idText(style, start, k));
    expect(ids('numbers', 4)).toEqual(['4', '5', '6']);
    expect(ids('letters', 2)).toEqual(['2a', '2b', '2c']);
    expect(ids('lower', 1)).toEqual(['a', 'b', 'c']);
    expect(ids('upper', 3)).toEqual(['C', 'D', 'E']);
    expect(ids('roman', 1)).toEqual(['i', 'ii', 'iii']);
    expect(ids('ROMAN', 4)).toEqual(['IV', 'V', 'VI']);
    expect(idText('numbers', 1, 0, 'S', '')).toBe('S1');
    expect(idText('numbers', 1, 2, '(', ')')).toBe('(3)');
  });

  it('carries on past z and writes roman numerals properly', () => {
    expect([1, 26, 27, 28, 52, 53].map(letterId)).toEqual(['a', 'z', 'aa', 'ab', 'az', 'ba']);
    expect([1, 4, 9, 14, 40, 90, 1994].map(romanId)).toEqual(['i', 'iv', 'ix', 'xiv', 'xl', 'xc', 'mcmxciv']);
    expect(fromRoman('XIV')).toBe(14);
    expect(fromRoman('iiii')).toBeNull();
  });

  it('reads where to start as typed', () => {
    expect(parseIdStart('7', 'numbers')).toBe(7);
    expect(parseIdStart('c', 'lower')).toBe(3);
    expect(parseIdStart('AA', 'upper')).toBe(27);
    expect(parseIdStart('iv', 'roman')).toBe(4);
    expect(parseIdStart('x', 'numbers')).toBeNull();
  });
});

describe('the same structure, the same ID', () => {
  it('gives copies of a structure one ID and skips IDs already in use', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => [bond(doc, 0, 0), bond(doc, 40, 0), bond(doc, 80, 0), bond(doc, 120, 0)]);
    // structures 1 and 3 are the same compound
    const keys = new Map([[ids[0], 'CC'], [ids[1], 'CO'], [ids[2], 'CC'], [ids[3], 'CN']]);
    const keyOf = (atoms: number[]) => atoms.map((a) => keys.get(a)).find((k) => k);
    const plan = planNumbers(doc, plainMeasure(doc), new Set(), { start: 1, keyOf });
    expect(plan.labels.map((l) => l.text)).toEqual(['1', '2', '1', '3']);
  });

  it('keeps an existing label for a copy, and does not hand out a label already used', () => {
    const doc = new Doc();
    const ids = doc.edit('build', () => {
      const x = [bond(doc, 0, 0), bond(doc, 40, 0), bond(doc, 80, 0)];
      doc.addCaption({ x: -3, y: 10, runs: [{ text: '2' }], justify: 'left' });
      return x;
    });
    const keys = new Map([[ids[0], 'CC'], [ids[1], 'CO'], [ids[2], 'CC']]);
    const keyOf = (atoms: number[]) => atoms.map((a) => keys.get(a)).find((k) => k);
    const plan = planNumbers(doc, plainMeasure(doc), new Set(), { start: 1, keep: true, keyOf });
    expect(plan.labels.map((l) => l.text)).toEqual(['1', '2']);
  });
});

describe('labels that clash', () => {
  it('flags one label on different structures, not on copies of one', () => {
    const got = labelClashes([
      { caption: 1, text: '3', key: 'CC' },
      { caption: 2, text: '3', key: 'CC' },
      { caption: 3, text: '4', key: 'CO' },
      { caption: 4, text: '4 ', key: 'CN' },
      { caption: 5, text: '5', key: 'CO' },
      { caption: 6, text: '5' },
    ]);
    expect([...got.keys()].sort()).toEqual([3, 4]);
    expect(got.get(3)).toContain('“4”');
  });
});
