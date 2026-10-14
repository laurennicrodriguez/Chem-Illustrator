// Dark page: the page shown dark on screen only (View > Dark Page, or the eye button). Files,
// printing, copying and exports are not touched: the page canvases are drawn as always and a
// colour filter is laid over them. White paper shows as the palette's paper colour, black ink as
// its ink colour, and colours keep their hue with their lightness turned round, so a pale ring
// fill or highlight becomes a dim one instead of a glare.

export interface DarkPalette {
  name: string;
  /** What white paper shows as. */
  paper: string;
  /** What black ink shows as. */
  ink: string;
}

export const DARK_PALETTES: DarkPalette[] = [
  { name: 'Graphite', paper: '#1e1e1e', ink: '#d6d6d6' },
  { name: 'Slate', paper: '#1b2330', ink: '#cdd6e2' },
  { name: 'Warm dark', paper: '#27221e', ink: '#e4d9ca' },
];

const HEX = /^#[0-9a-f]{6}$/i;

const rgb = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];

/** Hue turned half way round (CSS hue-rotate(180deg)): with lightness inverted, colours keep their hue. */
const HUE_180 = [
  [-0.574, 1.43, 0.144],
  [0.426, 0.43, 0.144],
  [0.426, 1.43, -0.856],
];

/**
 * The 4×5 colour matrix (SVG feColorMatrix, row by row) that shows a page in a palette: invert,
 * turn the hue back, then stretch black-to-white onto ink-to-paper. White goes to paper exactly,
 * black to ink exactly.
 */
export function darkMatrix(p: DarkPalette): number[] {
  const paper = rgb(p.paper), ink = rgb(p.ink);
  const out: number[] = [];
  for (let c = 0; c < 3; c++) {
    const d = ink[c] - paper[c];
    // out = ink - d * (H · v): white (H·v = 1) gives paper, black gives ink
    out.push(-d * HUE_180[c][0], -d * HUE_180[c][1], -d * HUE_180[c][2], 0, ink[c]);
  }
  out.push(0, 0, 0, 1, 0);
  return out.map((v) => Math.round(v * 10000) / 10000);
}

/** Apply a matrix to one colour (for tests and for colouring things drawn outside the filter). */
export function darkColour(m: number[], hex: string): string {
  const v = rgb(hex);
  const ch = (r: number) => Math.min(1, Math.max(0, m[r * 5] * v[0] + m[r * 5 + 1] * v[1] + m[r * 5 + 2] * v[2] + m[r * 5 + 4]));
  return '#' + [0, 1, 2].map((r) => Math.round(ch(r) * 255).toString(16).padStart(2, '0')).join('');
}

/** Your own palettes read back from the settings file. */
export function parseDarkPalettes(raw: unknown): DarkPalette[] {
  if (!Array.isArray(raw)) return [];
  const out: DarkPalette[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const { name, paper, ink } = r as Record<string, unknown>;
    if (typeof name !== 'string' || !name.trim() || typeof paper !== 'string' || !HEX.test(paper) || typeof ink !== 'string' || !HEX.test(ink)) continue;
    if (out.some((o) => o.name === name.trim())) continue;
    out.push({ name: name.trim(), paper: paper.toLowerCase(), ink: ink.toLowerCase() });
  }
  return out;
}

/** A palette by name: built-in or your own (Graphite when not found). */
export function darkPaletteNamed(name: string, own: DarkPalette[]): DarkPalette {
  return own.find((p) => p.name === name) ?? DARK_PALETTES.find((p) => p.name === name) ?? DARK_PALETTES[0];
}

const FILTER_ID = 'dark-page-filter';

/** Show the page dark in `p`, or as it is (null). Only the page canvases change; the rest of the window keeps its look. */
export function showDarkPage(p: DarkPalette | null): void {
  let svg = document.getElementById(FILTER_ID + '-svg') as unknown as SVGSVGElement | null;
  if (!svg) {
    const ns = 'http://www.w3.org/2000/svg';
    svg = document.createElementNS(ns, 'svg');
    svg.id = FILTER_ID + '-svg';
    svg.setAttribute('aria-hidden', 'true');
    svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    const filter = document.createElementNS(ns, 'filter');
    filter.id = FILTER_ID;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    const m = document.createElementNS(ns, 'feColorMatrix');
    m.setAttribute('type', 'matrix');
    filter.append(m);
    svg.append(filter);
    document.body.append(svg);
  }
  if (p) svg.querySelector('feColorMatrix')!.setAttribute('values', darkMatrix(p).join(' '));
  document.documentElement.classList.toggle('dark-page', !!p);
  if (p) document.documentElement.style.setProperty('--dark-paper', p.paper);
  else document.documentElement.style.removeProperty('--dark-paper');
}
