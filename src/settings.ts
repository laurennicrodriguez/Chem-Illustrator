// The person's own settings (key map and preferences), kept as a small readable JSON file:
// in the desktop app, settings.json in the app's settings folder (on Windows
// %APPDATA%\io.github.nathanohare.chemillustrator); in a browser, the browser's storage for
// this page. Drawings never go here.

import { parseLooks, type HighlightLookPreset } from './ui/highlight-looks';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { KeyOverrides } from './editor/keymap';
import { DEFAULT_TYPING } from './text/typing';
import { ModeColours, DEFAULT_MODE_COLOURS, parseModeColours } from './ui/mode-colours';
import { parseOwnTemplates, type Template } from './chem/templates';
import { parsePalettes, type Palette } from './palettes';
import { defaultToolboxes, parseToolboxes, type ToolboxState } from './ui/toolboxes';
import { parseOwnStyles, parseModeStyles, type StyleMode } from './drawing-styles';
import type { DocStyle } from './style';
import { parseDarkPalettes, type DarkPalette } from './dark-page';
import { DEFAULT_SCHEME_PREFS, parseSchemePrefs, type SchemePrefs } from './chem/scheme-layout';
import { CITE_PRESETS, DEFAULT_STYLE, cleanOptions, type CiteFormat } from './document/cite-styles';
import { DEFAULT_KEEP, parseKeepPrefs, type KeepPrefs } from './keep/prefs';
import { parseThemes, type SlideTemplate } from './deck/templates';
import { parseRecent } from './text/symbols';

export interface Settings {
  /** Changes to ChemDraw's default keys. */
  hotkeys: KeyOverrides;
  /**
   * After 1 or 0 on the atom under the mouse, keep the highlight there (ChemDraw: pressing 1
   * three times adds three branches). Off: the highlight moves to the new atom, so 1 1 1
   * draws a chain.
   */
  keepHotspotOnBond: boolean;
  /** New bonds are one bond length long unless Alt is held (Chemistry > Fixed Bond Lengths, Ctrl+L). */
  fixedLength: boolean;
  /** New bonds point in 15° steps unless Alt is held (Chemistry > Fixed Angles, Ctrl+E). */
  fixedAngles: boolean;
  /** View > Developer Tools: the Speed panel and the stress test. Off unless switched on. */
  devTools: boolean;
  /** Chemistry > Reactions and Schemes > Show Reaction Roles: with a reaction arrow selected, outline its starting materials, products and conditions. */
  showRoles: boolean;
  /** Format chemistry as words are finished (CH2Cl2, 1H NMR, DMSO-d6). Edit > Typing and Spelling. */
  chemTyping: boolean;
  /** Stereodescriptors in front of a name in italics as it is typed: (S)-proline. Edit > Typing and Spelling. */
  stereoItalic: boolean;
  /** Compound numbers in bold as they are typed: (4), compound 4a. Edit > Typing and Spelling. */
  boldNumbers: boolean;
  /** Web addresses, doi: and e-mail addresses become links as they are typed (Edit > Typing and Spelling). */
  autoLinks: boolean;
  /** Links open with Ctrl+click, or with a plain click (Edit > Typing and Spelling). */
  linkCtrlClick: boolean;
  /** Underline misspelled words (red) and chemistry formatting slips (blue) while typing. */
  spellCheck: boolean;
  /** Replacements made as you type: [typed, replaced by] (oC → °C). */
  replacements: [string, string][];
  /** Words added to the spelling check. */
  dictionary: string[];
  /** Each mode's colour and how much of the window it colours (View > Mode Colours). */
  modeColours: ModeColours;
  /** Nicknames of the person's own: name → SMILES, first atom where it joins (Chemistry > Nicknames and Templates > Define Nickname). */
  nicknames: Record<string, string>;
  /** Drawings saved as templates (Chemistry > Nicknames and Templates > Save as Template), in the "My templates" palette. */
  templates: Template[];
  /** Split view: the share of the window's width the drawing beside a document, sheet or slides takes (0.2 to 0.8). */
  splitWidth: number;
  /** Scroll bars along the drawing's bottom and right (View > Scroll Bars). */
  scrollBars: boolean;
  /** The page new drawings start on (File > Page Setup's default); null for no page. */
  page: { name?: string; w: number; h: number; grow: boolean } | null;
  /** The welcome card has been closed (it shows once, on a first empty drawing). */
  welcomed: boolean;
  /** Show the page's edge in drawings (View > Page Edge). */
  pageEdge: boolean;
  /** Where the text formatting bar goes while typing text (View > Text Formatting Bar). */
  textBar: 'docked' | 'floating' | 'hidden';
  /** Resting the mouse on an abbreviation shows the group written out (View > Group Tooltips). */
  groupTips: boolean;
  /** The reference style new documents use (References > Manage References > Style options > Use for new documents). */
  citeStyle: string;
  /** That style's details changed. */
  citeOptions: Partial<CiteFormat>;
  /** Show Terminal Methyls writes them as CH3 or as Me (Edit > Settings). */
  methylStyle: 'CH3' | 'Me';
  /** The template new slide decks start with (Design > Templates), or null for the plain look. */
  slideTemplate: string | null;
  /** Your own slide themes (Design > Templates > New Theme), shown with the ready-made ones. */
  slideThemes: SlideTemplate[];
  /** Axial chirality written as Ra/Sa or as helicity P/M (Edit > Settings). */
  axialStyle: 'RaSa' | 'PM';
  /** The + and − keys put charges in circles (⊕, ⊖) rather than plain signs. */
  circledCharges: boolean;
  /** An atom or group typed with the Text tool beside a bond end becomes that atom. */
  textToAtom: boolean;
  /** A click on something grouped selects the whole group, or just that thing. */
  groupClick: 'group' | 'item';
  /** Selecting part of a group outlines the rest of it. */
  groupOutline: boolean;
  /** Mechanism arrows left running into something by a change find their own way round. */
  rerouteArrows: boolean;
  /** Labels that are R and a number (R1, R12) show the number raised (R¹). */
  superscriptR: boolean;
  /** Where Format > Link Text to Structure puts the text: where it is, or a side of the structure. */
  linkSide: 'keep' | 'below' | 'above' | 'left' | 'right';
  /** Ask before a command with nothing selected changes every structure on the page (Edit > Settings). */
  askWholeDrawing: boolean;
  /** Your own colour rows, in every colour menu and every mode (Edit > Colour Palettes). */
  palettes: Palette[];
  /** Which toolboxes show and where (View > Toolboxes), and what is in your own. */
  toolboxes: ToolboxState;
  /** Your own drawing styles (File > Drawing Style > Save as My Style). */
  myStyles: DocStyle[];
  /** The style each kind of new tab starts with, by name (File > Drawing Style > Use for new…). */
  modeStyles: Partial<Record<StyleMode, string>>;
  /** Show the page dark on screen (View > Dark Page, or the eye button). */
  darkPage: boolean;
  /** Which dark palette, by name. */
  darkPalette: string;
  /** Your own dark palettes (View > Dark Page Colours). */
  darkPalettes: DarkPalette[];
  /** Alignment guides on or off in each kind of tab (View > Alignment Guides). */
  guides: { drawing: boolean; slides: boolean; design: boolean };
  /** Document settings boxes pinned in the panel on the right ('para', 'style', 'page', 'hf'). */
  docPins: string[];
  /** Document mode's ruler shown (View > Ruler). */
  docRuler: boolean;
  /** Sheet mode's formula bar shown (View > Formula Bar). */
  sheetFormulaBar: boolean;
  /** Look for a newer version when the desktop app starts (Edit > Settings). */
  updateCheck: boolean;
  /** Names the name reader can't read are looked up on PubChem (Edit > Settings). */
  pubchemNames: boolean;
  /** The Windows app has offered to open the chemistry file types (once, at its first start). */
  fileTypesOffered: boolean;
  /** The Windows app has registered its drawings as objects Word can send back to edit (once, at its first start). */
  wordObjectsOffered: boolean;
  /** The name put on tracked changes in documents (Review > Your Name, Edit > Settings). */
  reviewName: string;
  /** A version the user chose Skip This Version for, so starting the app doesn't offer it again. */
  skipVersion: string | null;
  /** Files and workspaces opened or saved lately, newest first (File menu, desktop app). */
  recentFiles: string[];
  /** Characters typed from Insert > Symbol lately, newest first. */
  recentSymbols: string[];
  /** Your own saved highlight looks (Chemistry > Highlight and Fill > Save Highlight Look). */
  highlightLooks: HighlightLookPreset[];
  /** Spacing in schemes and the text above and below arrows (Chemistry > Reactions and Schemes > Scheme Settings). */
  scheme: SchemePrefs;
  /** AutoSave, recovery copies, Version History and shared folders (File > AutoSave and Recovery Options). */
  keep: KeepPrefs;
}

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {}, keepHotspotOnBond: true, fixedLength: true, fixedAngles: true, devTools: false, showRoles: true,
  chemTyping: true, stereoItalic: true, boldNumbers: false, autoLinks: true, linkCtrlClick: true, spellCheck: true, replacements: DEFAULT_TYPING.replacements, dictionary: [],
  modeColours: DEFAULT_MODE_COLOURS, nicknames: {}, templates: [], splitWidth: 0.38, scrollBars: true, page: { name: 'letter', w: 540, h: 720, grow: true }, pageEdge: true, welcomed: false, textBar: 'docked', groupTips: true,
  citeStyle: DEFAULT_STYLE, citeOptions: {}, methylStyle: 'Me', axialStyle: 'RaSa', circledCharges: false, textToAtom: true, groupClick: 'group', groupOutline: true, rerouteArrows: true, superscriptR: true, linkSide: 'keep', slideTemplate: null, slideThemes: [], askWholeDrawing: true, palettes: [], toolboxes: defaultToolboxes(),
  myStyles: [], modeStyles: {}, darkPage: false, darkPalette: 'Graphite', darkPalettes: [],
  guides: { drawing: false, slides: true, design: true },
  docPins: [],
  docRuler: false,
  sheetFormulaBar: true,
  updateCheck: true, pubchemNames: true, fileTypesOffered: false, wordObjectsOffered: false, reviewName: '', skipVersion: null, recentFiles: [], recentSymbols: [], highlightLooks: [],
  scheme: DEFAULT_SCHEME_PREFS,
  keep: DEFAULT_KEEP,
};

const STORAGE_KEY = 'chem-illustrator.settings';

/** Read settings saved as text, keeping only what makes sense. */
export function parseSettings(text: string | null | undefined): Settings {
  const s: Settings = { ...DEFAULT_SETTINGS, hotkeys: {}, replacements: DEFAULT_SETTINGS.replacements.map(([a, b]) => [a, b]), dictionary: [], modeColours: { ...DEFAULT_MODE_COLOURS }, nicknames: {}, templates: [], palettes: [], toolboxes: defaultToolboxes(), myStyles: [], modeStyles: {}, darkPalettes: [], guides: { ...DEFAULT_SETTINGS.guides }, docPins: [], recentFiles: [], recentSymbols: [], highlightLooks: [], scheme: { ...DEFAULT_SCHEME_PREFS }, keep: { ...DEFAULT_KEEP } };
  if (!text) return s;
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { return s; }
  if (!raw || typeof raw !== 'object') return s;
  const r = raw as Record<string, unknown>;
  if (r.hotkeys && typeof r.hotkeys === 'object' && !Array.isArray(r.hotkeys)) s.hotkeys = r.hotkeys as KeyOverrides;
  for (const k of ['keepHotspotOnBond', 'fixedLength', 'fixedAngles', 'devTools', 'showRoles', 'chemTyping', 'stereoItalic', 'boldNumbers', 'autoLinks', 'linkCtrlClick', 'spellCheck', 'scrollBars', 'pageEdge', 'welcomed', 'groupTips', 'askWholeDrawing', 'darkPage', 'circledCharges', 'textToAtom', 'groupOutline', 'rerouteArrows', 'superscriptR', 'updateCheck', 'pubchemNames', 'fileTypesOffered', 'wordObjectsOffered'] as const) if (typeof r[k] === 'boolean') s[k] = r[k] as boolean;
  if (r.page === null) s.page = null;
  else if (r.page && typeof r.page === 'object') {
    const p = r.page as Record<string, unknown>;
    if (typeof p.w === 'number' && typeof p.h === 'number' && p.w > 10 && p.h > 10) s.page = { w: p.w, h: p.h, grow: p.grow !== false, ...(typeof p.name === 'string' ? { name: p.name } : {}) };
  }
  if (typeof r.textBar === 'string' && ['docked', 'floating', 'hidden'].includes(r.textBar)) s.textBar = r.textBar as Settings['textBar'];
  if (typeof r.linkSide === 'string' && ['keep', 'below', 'above', 'left', 'right'].includes(r.linkSide)) s.linkSide = r.linkSide as Settings['linkSide'];
  if (Array.isArray(r.replacements)) {
    s.replacements = r.replacements.filter((x): x is [string, string] => Array.isArray(x) && typeof x[0] === 'string' && typeof x[1] === 'string' && x[0] !== '').map(([a, b]) => [a, b]);
  }
  s.modeColours = parseModeColours(r.modeColours);
  if (r.nicknames && typeof r.nicknames === 'object' && !Array.isArray(r.nicknames)) {
    for (const [k, v] of Object.entries(r.nicknames as Record<string, unknown>)) if (k.trim() && typeof v === 'string' && v.trim()) s.nicknames[k.trim()] = v.trim();
  }
  if (typeof r.reviewName === 'string') s.reviewName = r.reviewName.trim().slice(0, 80);
  s.templates = parseOwnTemplates(r.templates);
  if (typeof r.splitWidth === 'number' && isFinite(r.splitWidth)) s.splitWidth = Math.min(0.8, Math.max(0.2, r.splitWidth));
  if (typeof r.citeStyle === 'string' && r.citeStyle in CITE_PRESETS) s.citeStyle = r.citeStyle;
  s.citeOptions = cleanOptions(r.citeOptions);
  s.palettes = parsePalettes(r.palettes);
  s.toolboxes = parseToolboxes(r.toolboxes);
  s.myStyles = parseOwnStyles(r.myStyles);
  s.modeStyles = parseModeStyles(r.modeStyles);
  if (typeof r.darkPalette === 'string' && r.darkPalette.trim()) s.darkPalette = r.darkPalette.trim();
  s.darkPalettes = parseDarkPalettes(r.darkPalettes);
  if (r.guides && typeof r.guides === 'object') {
    const g = r.guides as Record<string, unknown>;
    for (const k of ['drawing', 'slides', 'design'] as const) if (typeof g[k] === 'boolean') s.guides[k] = g[k] as boolean;
  }
  if (typeof r.docRuler === 'boolean') s.docRuler = r.docRuler;
  if (typeof r.sheetFormulaBar === 'boolean') s.sheetFormulaBar = r.sheetFormulaBar;
  if (Array.isArray(r.docPins)) s.docPins = ['para', 'style', 'page', 'hf'].filter((k) => (r.docPins as unknown[]).includes(k));
  if (r.methylStyle === 'Me' || r.methylStyle === 'CH3') s.methylStyle = r.methylStyle;
  if (r.groupClick === 'group' || r.groupClick === 'item') s.groupClick = r.groupClick;
  if (r.axialStyle === 'RaSa' || r.axialStyle === 'PM') s.axialStyle = r.axialStyle;
  if (typeof r.slideTemplate === 'string' || r.slideTemplate === null) s.slideTemplate = r.slideTemplate as string | null;
  s.slideThemes = parseThemes(r.slideThemes);
  s.highlightLooks = parseLooks(r.highlightLooks);
  if (Array.isArray(r.recentFiles)) s.recentFiles = r.recentFiles.filter((p): p is string => typeof p === 'string' && p.trim() !== '').slice(0, 10);
  s.recentSymbols = parseRecent(r.recentSymbols);
  if (typeof r.skipVersion === 'string' || r.skipVersion === null) s.skipVersion = r.skipVersion as string | null;
  s.scheme = parseSchemePrefs(r.scheme);
  s.keep = parseKeepPrefs(r.keep);
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
