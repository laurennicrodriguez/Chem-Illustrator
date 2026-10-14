// Your own colour palettes: named rows of colours shown in every colour menu, in every mode
// (drawings, slides, sheets, documents and designs), so a figure set keeps the same colours.
// They are kept with the settings, not in any one file.

export interface Palette {
  name: string;
  /** Colours as #rrggbb, lower case, in the order shown. */
  colors: string[];
}

/** The most colours one row holds. */
export const PALETTE_MAX = 24;
/** The most rows. */
export const PALETTES_MAX = 20;

const HEX = /^#[0-9a-f]{6}$/;

/** A colour as #rrggbb in lower case (#abc and RGB in capitals are accepted), or null. */
export function cleanColour(c: unknown): string | null {
  if (typeof c !== 'string') return null;
  let t = c.trim().toLowerCase();
  if (/^#?[0-9a-f]{3}$/.test(t)) t = '#' + t.replace('#', '').split('').map((x) => x + x).join('');
  if (/^[0-9a-f]{6}$/.test(t)) t = '#' + t;
  return HEX.test(t) ? t : null;
}

/** Palettes read from the settings file, keeping only what makes sense. */
export function parsePalettes(raw: unknown): Palette[] {
  if (!Array.isArray(raw)) return [];
  const out: Palette[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const r = p as Record<string, unknown>;
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : `Palette ${out.length + 1}`;
    const colors = Array.isArray(r.colors) ? r.colors.map(cleanColour).filter((c): c is string => !!c).slice(0, PALETTE_MAX) : [];
    out.push({ name, colors });
    if (out.length >= PALETTES_MAX) break;
  }
  return out;
}

/** Ready-made rows to start from (Edit Palettes > Add a ready-made row). */
export const PRESET_PALETTES: Palette[] = [
  // Okabe and Ito's set, told apart by people with the common kinds of colour blindness
  { name: 'Colour-blind safe (Okabe–Ito)', colors: ['#000000', '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7'] },
  { name: 'Greys', colors: ['#000000', '#333333', '#555555', '#777777', '#999999', '#bbbbbb', '#dddddd', '#ffffff'] },
  // ColorBrewer's Blues and OrRd steps (Cynthia Brewer, Penn State; Apache 2.0 licence)
  { name: 'Blues', colors: ['#08306b', '#08519c', '#2171b5', '#4292c6', '#6baed6', '#9ecae1', '#c6dbef', '#deebf7'] },
  { name: 'Warm', colors: ['#7f0000', '#b30000', '#d7301f', '#ef6548', '#fc8d59', '#fdbb84', '#fdd49e', '#fee8c8'] },
];

/** A row with a colour added at the end (not twice, and not past the most a row holds). */
export function withColour(p: Palette, c: string): Palette {
  const k = cleanColour(c);
  if (!k || p.colors.includes(k) || p.colors.length >= PALETTE_MAX) return p;
  return { ...p, colors: [...p.colors, k] };
}

/** A new row's name that isn't taken yet: "My colours", "My colours 2"… */
export function freshName(list: Palette[], base = 'My colours'): string {
  const taken = new Set(list.map((p) => p.name));
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base} ${i}`)) return `${base} ${i}`;
}
