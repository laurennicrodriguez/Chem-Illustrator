// @vitest-environment jsdom
//
// Design > Document Formatting: themes (fonts and colours), style sets, paragraph spacing and
// Set as Default, each changing the document's styles and the paragraphs in them.

import { describe, it, expect, afterEach } from 'vitest';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { applyDesign, newDocDesign, parseDesign, setNewDocDesign, setParaSpacing, setStyleSet, setTheme, setThemeColors, setThemeFonts, STYLE_SETS, THEMES, THEME_FONTS } from '../src/document/themes';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import type { TextRun } from '../src/model';

const deps: DocxDeps = { async picture() { return null; }, async svgToPng() { return new Uint8Array(); } };

/** A heading, then body text, one word of it bold by hand in another font. */
function sample(): DocText {
  const d = newDocument();
  const H = d.styles.Heading1, N = d.styles.Normal;
  const runs: TextRun[] = [
    { ...runStyleOf(H), text: 'Results\n' },
    { ...runStyleOf(N), text: 'The ' },
    { ...runStyleOf(N), font: 'Courier New', text: 'NMR' },
    { ...runStyleOf(N), text: ' spectrum.' },
  ];
  return { ...d, runs, paras: [paraFromStyle(H, { style: 'Heading1' }), paraFromStyle(N, {})] };
}

afterEach(() => setNewDocDesign(null));

describe('themes', () => {
  it('sets the headings\' and the text\'s fonts and the headings\' colour, leaving hand formatting', () => {
    const t = setTheme(sample(), 'Report');
    expect(t.styles.Heading1.font).toBe('Source Sans 3');
    expect(t.styles.Normal.font).toBe('Source Serif 4');
    expect(t.styles.Heading1.color).toBe('#1f3864');
    expect(t.styles.Normal.color).toBeUndefined();
    expect(t.runs[0]).toMatchObject({ font: 'Source Sans 3', color: '#1f3864' });
    expect(t.runs.find((r) => r.text === 'The ')?.font).toBe('Source Serif 4');
    expect(t.runs.find((r) => r.text === 'NMR')?.font).toBe('Courier New');
    expect(t.design).toEqual({ theme: 'Report', fonts: 'Source', colors: 'Navy' });
  });

  it('changes just the fonts or just the colours', () => {
    let t = setThemeFonts(sample(), 'Plex');
    expect(t.styles.Title.font).toBe('IBM Plex Sans');
    t = setThemeColors(t, 'Teal');
    expect(t.styles.Heading2.color).toBe('#0b5d6b');
    expect(t.design).toEqual({ fonts: 'Plex', colors: 'Teal' });
    // black takes the colour off again
    expect(setThemeColors(t, 'Black and White').styles.Heading2.color).toBeUndefined();
  });

  it('only uses fonts that come with the app (or Times New Roman)', async () => {
    const { BUNDLED_GROUPS } = await import('../src/fonts');
    const ok = new Set([...BUNDLED_GROUPS.flatMap((g) => g.fonts), 'Times New Roman']);
    for (const f of THEME_FONTS) { expect(ok.has(f.heading)).toBe(true); expect(ok.has(f.body)).toBe(true); }
    for (const th of THEMES) expect(THEME_FONTS.some((f) => f.name === th.fonts)).toBe(true);
  });
});

describe('style sets and paragraph spacing', () => {
  it('lays the styles out as the set has them, from the standard look, keeping the theme\'s fonts', () => {
    let t = setTheme(sample(), 'Clean');
    t = setStyleSet(t, 'Thesis');
    expect(t.styles.Normal).toMatchObject({ line: 2, firstLine: 36, align: 'left', font: 'Inter' });
    expect(t.paras[1]).toMatchObject({ line: 2, firstLine: 36 });
    expect(t.styles.Heading1.align).toBe('center');
    // another set starts from the standard look again
    t = setStyleSet(t, 'Compact');
    expect(t.styles.Normal).toMatchObject({ line: 1, firstLine: 0, spaceAfter: 4, align: 'justify', font: 'Inter' });
    expect(t.styles.Heading1.align).toBe('left');
    expect(STYLE_SETS.every((s) => s.description)).toBe(true);
  });

  it('sets the text\'s spacing, and goes back to the style set\'s', () => {
    let t = setStyleSet(sample(), 'Open');
    t = setParaSpacing(t, 'Double');
    expect(t.styles.Normal).toMatchObject({ line: 2, spaceAfter: 8 });
    expect(t.design?.spacing).toBe('Double');
    t = setParaSpacing(t, null);
    expect(t.styles.Normal).toMatchObject({ line: 1.25, spaceAfter: 12 });
  });
});

describe('keeping the design', () => {
  it('is saved in Word files (with the styles) and read back', async () => {
    const t = setParaSpacing(setStyleSet(setTheme(sample(), 'Classic'), 'Centered'), 'Tight');
    const { doc } = await readDocx(await writeDocx(t, deps));
    expect(doc.design).toEqual(t.design);
    expect(doc.styles.Heading1.font).toBe('Libre Baskerville');
    expect(doc.styles.Heading1.align).toBe('center');
  });

  it('Set as Default starts new documents with the same look', () => {
    setNewDocDesign(parseDesign({ theme: 'Poster', styleSet: 'Simple', junk: 3 }));
    expect(newDocDesign()).toEqual({ theme: 'Poster', styleSet: 'Simple' });
    const t = applyDesign(newDocument(), newDocDesign());
    expect(t.styles.Heading1.font).toBe('Montserrat');
    expect(t.styles.Normal.align).toBe('left');
  });
});
