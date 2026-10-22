// Workbook themes (Page Layout > Themes): twelve colours and two fonts, as an Office theme holds
// them. Cells with no font of their own show in the body font; Title and Heading cell styles use
// the headings font; the theme colours are the top row of the colour menus and the colours of
// the Accent and Heading cell styles. Excel's default theme is first, so files open as Excel
// shows them; the others are this program's own, with fonts that come with the app (so a saved
// file looks the same on a computer without them, where Office uses the fonts inside the file).
//
// Colours are kept in the order a theme file lists them: dark 1, light 1, dark 2, light 2, accents
// 1 to 6, link and followed link.

export interface WorkbookTheme {
  name: string;
  /** "#rrggbb": dk1, lt1, dk2, lt2, accent1…accent6, hlink, folHlink. */
  colors: string[];
  /** Headings font. */
  major: string;
  /** Body font: cells with no font of their own. */
  minor: string;
}

/** The names of the colours, in the theme's order. */
export const THEME_COLOUR_NAMES = ['Text 1 (dark)', 'Background 1 (light)', 'Text 2', 'Background 2', 'Accent 1', 'Accent 2', 'Accent 3', 'Accent 4', 'Accent 5', 'Accent 6', 'Link', 'Followed link'];
export const SCHEME_ELEMENTS = ['dk1', 'lt1', 'dk2', 'lt2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6', 'hlink', 'folHlink'];

const T = (name: string, major: string, minor: string, colors: string): WorkbookTheme => ({ name, major, minor, colors: colors.split(' ').map((c) => '#' + c.toLowerCase()) });

/** Excel's default theme (what a workbook has when it says nothing). */
export const DEFAULT_THEME: WorkbookTheme = T('Office', 'Calibri Light', 'Calibri', '000000 FFFFFF 44546A E7E6E6 4472C4 ED7D31 A5A5A5 FFC000 5B9BD5 70AD47 0563C1 954F72');

export const WORKBOOK_THEMES: WorkbookTheme[] = [
  DEFAULT_THEME,
  T('Lab Notebook', 'IBM Plex Sans', 'IBM Plex Sans', '1F2A2E FFFFFF 1F3F47 EEF3F4 2D6A7A E07A3F 5F8F4E 8C6BB1 C9A227 3E7CB1 1F6FB2 7A4E9A'),
  T('Harbor', 'Source Sans 3', 'Source Sans 3', '1D2733 FFFFFF 1D3A5F E9EEF4 2F5D8A D98A3D 5C8F6E A3496B 6FA3C7 9AA5B1 2563A8 7A4F8E'),
  T('Slate', 'Inter', 'Inter', '1F2933 FFFFFF 2F3A45 EDF0F3 3B5B7D 8FB3C9 6C7A89 C27C4A 5E8C7A A35D6A 2F6FDF 7D5BA6'),
  T('Paper', 'Source Serif 4', 'Source Sans 3', '2E2A24 FFFFFF 4A4136 F4F1EA 7A6A55 B5654A 6F8A5B 4F6E8C C49A3A 8C6A8F 3D6EA8 7E5A8C'),
  T('Academic', 'Merriweather', 'Source Sans 3', '2A1F22 FFFFFF 3B2E30 F3EEEE 7A1F2B 2F5D8A C9A227 4F7F5A 8A6A9E D07A3D 2B5DA0 7A3F7F'),
  T('Sage', 'Lato', 'Lato', '2F3D31 FFFFFF 33463A EEF2EC 5F7A63 B98B4B 6D8DA6 A8625A 8FA86B 7D6E9C 3A6EA5 6F5A8C'),
  T('Navy and Orange', 'Montserrat', 'Source Sans 3', '1A2230 FFFFFF 0C2340 EEF1F5 0C2340 E87722 4A90A4 B33951 8DB255 F2C14E 1F6FB2 7A4E9A'),
  T('Violet', 'Inter', 'Inter', '2D2147 FFFFFF 3A2D5C F1EEF8 6C4AB6 E0A43A 3FA7A0 D45D79 7FA1D6 9AA5B1 4A55C9 8A4AA8'),
  T('Sunrise', 'Lato', 'Lato', '3B2A1A FFFFFF 4A3524 FBF4EA F2A541 F2545B 3E8E7E 5B6EAE C46A2F 8C6A8F 2F6FB2 8C4A7E'),
  // Okabe and Ito's eight colours, which people with colour blindness can tell apart
  T('Colour-blind safe', 'Inter', 'Inter', '000000 FFFFFF 1F2933 F2F2F2 0072B2 E69F00 009E73 D55E00 56B4E9 CC79A7 0072B2 7A4E9A'),
];

/** The theme a workbook shows in (its own, or Excel's default). */
export const themeOf = (t: WorkbookTheme | null | undefined): WorkbookTheme => t ?? DEFAULT_THEME;

/**
 * A theme colour by the number cell formats give it in a file (0 light 1, 1 dark 1, 2 light 2,
 * 3 dark 2, then the accents, link and followed link): Excel swaps the first two pairs.
 */
export function themeColourByIndex(t: WorkbookTheme, i: number): string | undefined {
  const order = [1, 0, 3, 2, 4, 5, 6, 7, 8, 9, 10, 11];
  return t.colors[order[i] ?? -1];
}

/** A colour made lighter (tint > 0) or darker (tint < 0), as Office works out theme shades. */
export function tintColour(hex: string, tint: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (tint < 0 ? v * (1 + tint) : v + (255 - v) * tint));
  return '#' + ch.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('');
}

/** The ten columns of theme colours in the colour menus (text, background, text 2, background 2, accents), each with its shades. */
export function themePalette(t: WorkbookTheme): { name: string; colours: string[] }[] {
  const cols = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return cols.map((i) => {
    const c = t.colors[i];
    // light colours get darker shades, dark ones lighter
    const n = parseInt(c.slice(1), 16);
    const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
    const tints = lum > 0.8 ? [-0.05, -0.15, -0.25, -0.35, -0.5] : lum < 0.2 ? [0.5, 0.35, 0.25, 0.15, 0.05] : [0.8, 0.6, 0.4, -0.25, -0.5];
    return { name: THEME_COLOUR_NAMES[i], colours: [c, ...tints.map((x) => tintColour(c, x))] };
  });
}

/** A theme with some of its parts changed (Colors or Fonts from another theme). */
export function mixTheme(base: WorkbookTheme, colours: WorkbookTheme | null, fonts: WorkbookTheme | null): WorkbookTheme {
  const c = colours ?? base, f = fonts ?? base;
  const name = c === f ? c.name : `${base.name} (custom)`;
  return { name, colors: c.colors.slice(), major: f.major, minor: f.minor };
}

/** Do two themes look the same? */
export const sameTheme = (a: WorkbookTheme | null, b: WorkbookTheme | null): boolean =>
  JSON.stringify(themeOf(a)) === JSON.stringify(themeOf(b));

/** A theme read from a file (unreadable parts from the default). */
export function readThemeParts(colors: (string | undefined)[], major: string | undefined, minor: string | undefined, name: string | undefined): WorkbookTheme {
  return {
    name: name || 'Office',
    colors: DEFAULT_THEME.colors.map((d, i) => (colors[i] && /^[0-9a-f]{6}$/i.test(colors[i]!) ? '#' + colors[i]!.toLowerCase() : d)),
    major: major || DEFAULT_THEME.major,
    minor: minor || DEFAULT_THEME.minor,
  };
}
