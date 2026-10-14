// The person's own settings (key map and preferences), kept as a small readable JSON file:
// in the desktop app, settings.json in the app's settings folder (on Windows
// %APPDATA%\io.github.nathanohare.chemillustrator); in a browser, the browser's storage for
// this page. Drawings never go here.

import { invoke, isTauri } from '@tauri-apps/api/core';
import { KeyOverrides } from './editor/keymap';
import { DEFAULT_TYPING } from './text/typing';
import { ModeColours, DEFAULT_MODE_COLOURS, parseModeColours } from './ui/mode-colours';
import { parseOwnTemplates, type Template } from './chem/templates';
import { parsePalettes, type Palette } from './palettes';
import { CITE_PRESETS, DEFAULT_STYLE, cleanOptions, type CiteFormat } from './document/cite-styles';

export interface Settings {
  /** Changes to ChemDraw's default keys. */
  hotkeys: KeyOverrides;
  /**
   * After 1 or 0 on the atom under the mouse, keep the highlight there (ChemDraw: pressing 1
   * three times adds three branches). Off: the highlight moves to the new atom, so 1 1 1
   * draws a chain.
   */
  keepHotspotOnBond: boolean;
  /** New bonds are one bond length long unless Alt is held (Structure > Fixed Bond Lengths, Ctrl+L). */
  fixedLength: boolean;
  /** New bonds point in 15° steps unless Alt is held (Structure > Fixed Angles, Ctrl+E). */
  fixedAngles: boolean;
  /** View > Developer Tools: the Speed panel and the stress test. Off unless switched on. */
  devTools: boolean;
  /** Scheme > Show Reaction Roles: with a reaction arrow selected, outline its starting materials, products and conditions. */
  showRoles: boolean;
  /** Format chemistry as words are finished (CH2Cl2, 1H NMR, DMSO-d6). Edit > Typing and Spelling. */
  chemTyping: boolean;
  /** Underline misspelled words (red) and chemistry formatting slips (blue) while typing. */
  spellCheck: boolean;
  /** Replacements made as you type: [typed, replaced by] (oC → °C). */
  replacements: [string, string][];
  /** Words added to the spelling check. */
  dictionary: string[];
  /** Each mode's colour and how much of the window it colours (View > Mode Colours). */
  modeColours: ModeColours;
  /** Nicknames of the person's own: name → SMILES, first atom where it joins (Structure > Define Nickname). */
  nicknames: Record<string, string>;
  /** Drawings saved as templates (Structure > Save as Template), in the "My templates" palette. */
  templates: Template[];
  /** Split view: the share of the window's width the drawing beside a document, sheet or slides takes (0.2 to 0.8). */
  splitWidth: number;
  /** Scroll bars along the drawing's bottom and right (View > Scroll Bars). */
  scrollBars: boolean;
  /** The reference style new documents use (References > Manage References > Style options > Use for new documents). */
  citeStyle: string;
  /** That style's details changed. */
  citeOptions: Partial<CiteFormat>;
  /** Show Terminal Methyls writes them as CH3 or as Me (Structure > Terminal Methyls as …). */
  methylStyle: 'CH3' | 'Me';
  /** Your own colour rows, in every colour menu and every mode (Edit > Colour Palettes). */
  palettes: Palette[];
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {}, keepHotspotOnBond: true, fixedLength: true, fixedAngles: true, devTools: false, showRoles: true,
  chemTyping: true, spellCheck: true, replacements: DEFAULT_TYPING.replacements, dictionary: [],
  modeColours: DEFAULT_MODE_COLOURS, nicknames: {}, templates: [], splitWidth: 0.38, scrollBars: true,
  citeStyle: DEFAULT_STYLE, citeOptions: {}, methylStyle: 'CH3', palettes: [],
};

const STORAGE_KEY = 'chem-illustrator.settings';

/** Read settings saved as text, keeping only what makes sense. */
export function parseSettings(text: string | null | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, hotkeys: {}, replacements: DEFAULT_SETTINGS.replacements.map(([a, b]) => [a, b]), dictionary: [], modeColours: { ...DEFAULT_MODE_COLOURS }, nicknames: {}, templates: [], palettes: [] };
  if (!text) return s;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return s; }
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (r.hotkeys && typeof r.hotkeys === 'object' && !Array.isArray(r.hotkeys)) s.hotkeys = r.hotkeys as KeyOverrides;
  for (const k of ['keepHotspotOnBond', 'fixedLength', 'fixedAngles', 'devTools', 'showRoles', 'chemTyping', 'spellCheck', 'scrollBars'] as const) if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  if (Array.isArray(r.replacements)) {
    s.replacements = r.replacements.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0] !== '').map(([a, b]) => [a, b]);
  }
  s.modeColours = parseModeColours(r.modeColours);
  if (r.nicknames && typeof r.nicknames === 'object' && !Array.isArray(r.nicknames)) {
    for (const [k, v] of Object.entries(r.nicknames as Record<string, unknown>)) if (k.trim() && typeof v === 'string' && v.trim()) s.nicknames[k.trim()] = v.trim();
  }
  s.templates = parseOwnTemplates(r.templates);
  if (typeof r.splitWidth === 'number' && isFinite(r.splitWidth)) s.splitWidth = Math.min(0.8, Math.max(0.2, r.splitWidth));
  if (typeof r.citeStyle === 'string' && r.citeStyle in CITE_PRESETS) s.citeStyle = r.citeStyle;
  s.citeOptions = cleanOptions(r.citeOptions);
  s.palettes = parsePalettes(r.palettes);
  if (r.methylStyle === 'Me' || r.methylStyle === 'CH3') s.methylStyle = r.methylStyle;
  if (Array.isArray(r.dictionary)) s.dictionary = r.dictionary.filter((w): w is string => typeof w === 'string' && w.trim() !== '').map((w) => w.trim());
  return s;
}

/** Settings as the text saved in the file. */
export function settingsText(s: Settings): string {
  return JSON.stringify({ app: 'Chem Illustrator', version: 1, ...s }, null, 2) + '\n';
}

export async function loadSettings(): Promise<Settings> {
  try {
    if (isTauri()) return parseSettings(await invoke<string | null>('settings_read'));
    return parseSettings(localStorage.getItem(STORAGE_KEY));
  } catch {
    return parseSettings(null);
  }
}

let pending: ReturnType<typeof setTimeout> | null = null;

/** Save settings shortly (several quick changes make one write). Failures are reported, never fatal. */
export function saveSettings(s: Settings, onError: (msg: string) => void = () => {}): void {
  if (pending) clearTimeout(pending);
  pending = setTimeout(async () => {
    pending = null;
    const text = settingsText(s);
    try {
      if (isTauri()) await invoke('settings_write', { contents: text });
      else localStorage.setItem(STORAGE_KEY, text);
    } catch (e) {
      onError(`Settings were not saved: ${e}`);
    }
  }, 300);
}

/** Where the settings live, for the Hotkeys window. */
export async function settingsLocation(): Promise<string> {
  if (!isTauri()) return 'this browser’s storage for the page';
  try { return await invoke<string>('settings_path'); } catch { return 'the app’s settings folder'; }
}
