// Mode colours: each mode's colour gives readable accents in both themes, a menu bar that
// white text reads on, and settings that ignore anything that isn't a colour.

import { describe, it, expect } from 'vitest';
import { modePalette, contrast, parseModeColours, modeColour, DEFAULT_MODE_COLOURS } from '../src/ui/mode-colours';
import { parseSettings, settingsText, DEFAULT_SETTINGS } from '../src/settings';

const WHITE = '#ffffff';
const DARK_PANEL = '#252a32';

describe('mode colours', () => {
  it('measures contrast the standard way', () => {
    expect(contrast('#000000', WHITE)).toBeCloseTo(21, 5);
    expect(contrast(WHITE, WHITE)).toBeCloseTo(1, 5);
    expect(contrast('#2f6fdf', WHITE)).toBeCloseTo(4.71, 1);
  });
  it('keeps the drawing blue as it was', () => {
    const p = modePalette('#2f6fdf');
    expect(p.accent).toBe('#2f6fdf'); // already readable on white
    expect(p.soft).toBe('#e2ebfb'); // was #e3ecfc
    expect(p.accentDark).toBe('#7babff'); // was #7aa7ff
  });
  it('makes every colour readable, however pale or dark it is chosen', () => {
    for (const c of ['#c8572a', '#ffd800', '#00ff66', '#ffffff', '#000000', '#1e8a50', '#7f3fbf']) {
      const p = modePalette(c);
      expect(contrast(p.accent, WHITE)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.accentDark, DARK_PANEL)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(WHITE, p.bar)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(WHITE, p.barDark)).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('darkens the slides orange only a little for text', () => {
    const p = modePalette('#c8572a');
    expect(contrast('#c8572a', WHITE)).toBeLessThan(4.5);
    expect(p.accent).not.toBe('#c8572a');
    expect(contrast(p.accent, WHITE)).toBeLessThan(5);
  });
  it('uses the drawing colour everywhere when switched off', () => {
    expect(modeColour('slides', DEFAULT_MODE_COLOURS)).toBe('#c8572a');
    expect(modeColour('slides', { ...DEFAULT_MODE_COLOURS, style: 'off' })).toBe('#2f6fdf');
    expect(modeColour('sheet', DEFAULT_MODE_COLOURS)).toBe('#1e8a50');
    expect(modeColour('sheet', { ...DEFAULT_MODE_COLOURS, style: 'off' })).toBe('#2f6fdf');
    expect(modeColour('document', DEFAULT_MODE_COLOURS)).toBe('#2647a8');
    expect(modeColour('document', { ...DEFAULT_MODE_COLOURS, style: 'off' })).toBe('#2f6fdf');
  });
  it('reads saved choices, ignoring anything that is not a colour', () => {
    expect(parseModeColours(undefined)).toEqual(DEFAULT_MODE_COLOURS);
    expect(parseModeColours({ style: 'window', drawing: '#00AA00', slides: 'orange' })).toEqual({ style: 'window', drawing: '#00aa00', slides: '#c8572a', sheet: '#1e8a50', document: '#2647a8', design: '#7b3fbf' });
    expect(parseModeColours({ sheet: '#AA0000' }).sheet).toBe('#aa0000');
    expect(parseModeColours({ document: '#0000AA' }).document).toBe('#0000aa');
    expect(parseModeColours({ style: 'rainbow' }).style).toBe('accent');
  });
  it('keeps them in the settings file', () => {
    expect(parseSettings(null).modeColours).toEqual(DEFAULT_MODE_COLOURS);
    const s = { ...DEFAULT_SETTINGS, modeColours: { style: 'window' as const, drawing: '#123456', slides: '#abcdef', sheet: '#0a7a3a', document: '#203080', design: '#552288' } };
    expect(parseSettings(settingsText(s)).modeColours).toEqual(s.modeColours);
  });
});
