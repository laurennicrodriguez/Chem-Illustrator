// Insert > Symbol: finding characters by name, group or code, and the recently used list.

import { describe, it, expect } from 'vitest';
import { ALL_SYMBOLS, RECENT_MAX, SYMBOL_GROUPS, addRecent, charFromCode, codeOf, groupSymbols, parseRecent, searchSymbols } from '../src/text/symbols';
import { parseSettings } from '../src/settings';

const found = (q: string) => searchSymbols(q).map((s) => s.ch);

describe('Insert Symbol', () => {
  it('finds the characters chemists look for by name', () => {
    expect(found('degree')[0]).toBe('°');
    expect(found('deg')).toContain('°');
    expect(found('angstrom')).toContain('Å');
    expect(found('equilibrium')).toContain('⇌');
    expect(found('plus minus')[0]).toBe('±');
    expect(found('alpha')[0]).toBe('α');
    expect(found('capital delta')).toContain('Δ');
    expect(found('dagger')).toEqual(expect.arrayContaining(['†', '‡']));
    expect(found('arrow right')).toContain('→');
    expect(found('zzzz')).toEqual([]);
  });

  it('finds a character typed as itself or as its code', () => {
    expect(found('°')[0]).toBe('°');
    expect(found('U+2192')[0]).toBe('→');
    expect(charFromCode('u+b0')).toBe('°');
    expect(charFromCode('00B0')).toBe('°');
    expect(charFromCode('&#176;')).toBe('°');
    expect(charFromCode('&#x2192;')).toBe('→');
    // a word made of hex letters stays a word; control characters are not offered
    expect(charFromCode('face')).toBeNull();
    expect(charFromCode('U+0007')).toBeNull();
    // a character not in the list is still offered when its code is typed
    expect(found('U+1F600')[0]).toBe('😀');
    expect(codeOf('°')).toBe('U+00B0');
  });

  it('lists every group, each with something in it, and every symbol once', () => {
    for (const g of SYMBOL_GROUPS) expect(groupSymbols(g.id).length).toBeGreaterThan(5);
    expect(new Set(ALL_SYMBOLS.map((s) => s.ch)).size).toBe(ALL_SYMBOLS.length);
    expect(ALL_SYMBOLS.every((s) => [...s.ch].length === 1 && s.name)).toBe(true);
  });

  it('keeps the recently used ones newest first, without repeats, and saves them', () => {
    let r: string[] = [];
    for (const ch of ['°', 'Å', '°', '→']) r = addRecent(r, ch);
    expect(r).toEqual(['→', '°', 'Å']);
    for (let i = 0; i < 40; i++) r = addRecent(r, String.fromCharCode(0x3b1 + (i % 25)));
    expect(r.length).toBe(RECENT_MAX);
    expect(parseRecent(['°', 'ab', 3, '°', 'Å'])).toEqual(['°', 'Å']);
    expect(parseSettings(JSON.stringify({ recentSymbols: ['⇌', 'x'] })).recentSymbols).toEqual(['⇌', 'x']);
    expect(parseSettings(null).recentSymbols).toEqual([]);
  });
});
