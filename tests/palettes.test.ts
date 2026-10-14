// Your own colour palettes: reading them from the settings and adding colours.

import { describe, expect, it } from 'vitest';
import { PALETTE_MAX, PRESET_PALETTES, cleanColour, freshName, parsePalettes, withColour } from '../src/palettes';

describe('colour codes', () => {
  it('reads #rrggbb, #rgb and codes without #', () => {
    expect(cleanColour('#1F5FBF')).toBe('#1f5fbf');
    expect(cleanColour('abc')).toBe('#aabbcc');
    expect(cleanColour(' 00ff00 ')).toBe('#00ff00');
    expect(cleanColour('blue')).toBeNull();
    expect(cleanColour(12)).toBeNull();
  });
});

describe('palettes from the settings', () => {
  it('keeps good rows and colours and drops the rest', () => {
    const p = parsePalettes([
      { name: ' Group ', colors: ['#FF0000', 'nonsense', '#0f0'] },
      { colors: [] },
      'junk',
    ]);
    expect(p).toEqual([{ name: 'Group', colors: ['#ff0000', '#00ff00'] }, { name: 'Palette 2', colors: [] }]);
    expect(parsePalettes(undefined)).toEqual([]);
  });

  it('holds at most so many colours a row', () => {
    const many = Array.from({ length: 40 }, (_, i) => '#0000' + i.toString(16).padStart(2, '0'));
    expect(parsePalettes([{ name: 'x', colors: many }])[0].colors).toHaveLength(PALETTE_MAX);
  });
});

describe('adding colours', () => {
  it('adds a colour once, in lower case', () => {
    const p = withColour({ name: 'a', colors: ['#000000'] }, '#E69F00');
    expect(p.colors).toEqual(['#000000', '#e69f00']);
    expect(withColour(p, '#e69f00')).toBe(p);
    expect(withColour(p, 'not a colour')).toBe(p);
  });

  it('names new rows so they differ', () => {
    expect(freshName([])).toBe('My colours');
    expect(freshName([{ name: 'My colours', colors: [] }])).toBe('My colours 2');
  });

  it('ready-made rows are proper colour codes', () => {
    for (const p of PRESET_PALETTES) for (const c of p.colors) expect(cleanColour(c)).toBe(c);
  });
});
