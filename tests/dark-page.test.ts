// Dark page: the colour filter takes white paper to the palette's paper and black ink to its ink
// exactly, keeps colours' hue, and your own palettes are read back from settings safely.

import { describe, it, expect } from 'vitest';
import { DARK_PALETTES, darkMatrix, darkColour, parseDarkPalettes, darkPaletteNamed } from '../src/dark-page';
import { parseSettings, settingsText, DEFAULT_SETTINGS } from '../src/settings';

const near = (a: string, b: string) => {
  const v = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  return v(a).every((x, i) => Math.abs(x - v(b)[i]) <= 1);
};

describe('dark page colours', () => {
  it('shows white paper as the palette paper and black ink as its ink', () => {
    for (const p of DARK_PALETTES) {
      const m = darkMatrix(p);
      expect(near(darkColour(m, '#ffffff'), p.paper)).toBe(true);
      expect(near(darkColour(m, '#000000'), p.ink)).toBe(true);
    }
  });

  it('keeps a red atom label reddish, and makes a pale highlight dim', () => {
    const m = darkMatrix(DARK_PALETTES[0]);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(darkColour(m, '#cc0000').slice(i, i + 2), 16));
    expect(r).toBeGreaterThan(g + 40);
    expect(r).toBeGreaterThan(b + 40);
    const pale = darkColour(m, '#fff3a0');
    const light = [1, 3, 5].map((i) => parseInt(pale.slice(i, i + 2), 16)).reduce((a, x) => a + x, 0) / 3;
    expect(light).toBeLessThan(110);
  });

  it('reads your own palettes, dropping bad colours and repeats', () => {
    expect(parseDarkPalettes([
      { name: 'Mine', paper: '#101010', ink: '#EEEEEE' },
      { name: 'Mine', paper: '#202020', ink: '#eeeeee' },
      { name: 'Bad', paper: 'black', ink: '#eeeeee' },
      null,
    ])).toEqual([{ name: 'Mine', paper: '#101010', ink: '#eeeeee' }]);
    expect(darkPaletteNamed('nope', []).name).toBe('Graphite');
  });

  it('keeps dark page, drawing style choices and own styles in the settings file', () => {
    const s = { ...DEFAULT_SETTINGS, darkPage: true, darkPalette: 'Slate', darkPalettes: [{ name: 'Mine', paper: '#101010', ink: '#eeeeee' }],
      myStyles: [{ ...DARK_STYLE }], modeStyles: { slides: 'Big' } };
    const back = parseSettings(settingsText(s));
    expect(back.darkPage).toBe(true);
    expect(back.darkPalette).toBe('Slate');
    expect(back.darkPalettes).toHaveLength(1);
    expect(back.myStyles[0].bondLength).toBe(30);
    expect(back.modeStyles).toEqual({ slides: 'Big' });
  });
});

const DARK_STYLE = {
  name: 'Big', bondLength: 30, lineWidth: 1.2, boldWidth: 4, marginWidth: 3, hashSpacing: 5, bondSpacing: 18, chainAngle: 120,
  labelFont: 'Arial', labelSize: 20, captionFont: 'Arial', captionSize: 20, captionFace: 96,
};
