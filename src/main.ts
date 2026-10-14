// The app window: menus, a tab for each open file (drawings, slide decks and sheets), the
// toolbar, the drawing area (with the slide list and notes in Slides mode, or the grid in Sheet
// mode), and the panels on the right.

import './app.css';
import { Doc, Atom, Caption, Shape, Contents } from './model';
import { Renderer, measureText } from './render/renderer';
import { Editor, TOOLS } from './editor/editor';
import type { Align } from './editor/arrange';
import { readCdxml, ReadStats } from './io/cdxml';
import { ChemClient } from './chem/client';
import { toMolfile, addMolfile } from './chem/molfile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyDrawing, extractDrawing, insertDrawing, isEmpty, nativeClipboard, readClipboardText, readNativeClipboard, readPasteEvent, readWebClipboard, clipboardFormats, fitPasted, Pasted,
  nativeFirst, writeNativeFormats, looksLikeCdxml, cfHtml, fromCfHtml, CELLS_FORMAT, OWN_FORMAT, CDX_FORMAT } from './io/clipboard';
import { cdxToCdxml } from './io/cdx';
import { writeCdxml } from './io/cdxml-write';
import { openFileDialog, openBytesDialog, saveFileDialog, writeFile, showError, withExtension, KEYMAP_FILE, MOL, PDF, PICTURE_EXTENSIONS } from './io/files';
import { Workspace, Tab } from './workspace';
import { Deck, LayoutId, LAYOUTS, WIDE, STANDARD, Image as SlideImage, sizeName } from './deck/deck';
import { drawSlidePage, recordSlide, SURROUND } from './deck/slide-view';
import { writePdf, jpegInfo, PdfPage, PdfImage } from './io/pdf';
import { SlideList } from './ui/slide-list';
import { Presenter } from './ui/present';
import { editMaster } from './ui/master-dialog';
import { recordPicture, pictureSvg, pictureCanvas, canvasPng } from './render/picture';
import { dataUrl, fromDataUrl, imageSize, loadImage, onImageReady, pictureMime, showableSrc } from './render/images';
import { freeRing, fusedRing, placeRing, sprout, ringOnAtom, sproutDir } from './chem/chemgeom';
import { Toolbar, ToolbarItem, PaletteDef } from './ui/toolbar';
import { StylePanel } from './ui/style-panel';
import { TEMPLATES, Template, templateById } from './chem/templates';
import { templateIcon } from './ui/template-icons';
import { StructureChecks } from './chem/warnings';
import { LiveStereo } from './chem/live-stereo';
import { setStereoShown } from './chem/stereo';
import { keymap, registerToolNames, displayChord, actionName, chordOf, parseAction, KeyContext, KeyOverrides } from './editor/keymap';
import { loadSettings, saveSettings, settingsLocation, Settings } from './settings';
import { HotkeysDialog } from './ui/hotkeys-dialog';
import { TypingDialog } from './ui/typing-dialog';
import { ModeColoursDialog, ModeColours, DEFAULT_MODE_COLOURS, applyModeColours } from './ui/mode-colours';
import { typingPrefs, setTypingPrefs, onTypingPrefs } from './text/typing';
import { NicknameChooser } from './ui/nickname-chooser';
import { ask } from './ui/ask';
import { NameReader, captionName, attachmentAtoms, cxNotes } from './chem/names';
import { NameDialog } from './ui/name-dialog';
import { SheetMode, ClipboardCells } from './ui/sheet-mode';
import { DocumentMode, DocPaste } from './ui/doc-mode';
import { setScreenMeasure, figures } from './document/doc-file';
import { readDocx, writeDocx, type DocxDeps, type DocxReadDeps } from './io/docx';
import { FIGURE_MARGIN } from './document/figures';
import { recordPages } from './document/doc-paint';
import { layoutTable } from './table';
import { SheetChem } from './sheet/sheet-chem';
import { structureDoc, structureMolfile } from './sheet/structure-doc';
import { StructurePictures } from './ui/structure-pictures';
import { structurePlace } from './sheet/layout';
import { readSheetFile, writeSheetFile, SheetFileDeps } from './io/sheet-files';
import { ACS_1996, DocStyle } from './style';
import { emptyTable, tableFromCells } from './table';
import type { TableData } from './model';
import type { PastedRows } from './io/table-clip';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const doc = new Doc();
const host = $<HTMLDivElement>('#canvas-host');
const scene = $<HTMLCanvasElement>('#scene');
const overlay = $<HTMLCanvasElement>('#overlay');
const renderer = new Renderer(scene, overlay);
const editor = new Editor(doc, renderer, host);
const chem = new ChemClient(document.baseURI);
const checks = new StructureChecks(doc);
renderer.checks = checks;
// R/S and E/Z for every structure, worked out in the background after each change
const live = new LiveStereo(doc, (jobs) => chem.stereo(jobs));
doc.stereo = live;
live.onChange = (atoms, bonds) => {
  const all = renderer.previewStereo;
  for (const id of atoms) {
    const a = doc.atoms.get(id);
    if (a && (all || a.showStereo || a.stereoLabel)) doc.dirtyRects.push({ x1: a.x, y1: a.y, x2: a.x, y2: a.y });
  }
  for (const id of bonds) {
    const b = doc.bonds.get(id);
    if (!b || !(all || b.showStereo || b.stereoLabel)) continue;
    const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
    doc.dirtyRects.push({ x1: Math.min(p.x, q.x), y1: Math.min(p.y, q.y), x2: Math.max(p.x, q.x), y2: Math.max(p.y, q.y) });
  }
  editor.requestScene();
  scheduleAnalysis();
};
function updateStereo(): void {
  if (chem.ready) void live.update();
}
const startMs = performance.now();

// ---------------------------------------------------------------- layout

function resize(): void {
  const r = host.getBoundingClientRect();
  // hidden (a sheet is showing): keep the last size
  if (r.width < 1 || r.height < 1) return;
  renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
  editor.requestScene();
}
new ResizeObserver(resize).observe(host);

// ---------------------------------------------------------------- toolbar

const ARROWS: PaletteDef = {
  palette: 'arrows',
  title: 'Arrows',
  items: [
    { name: 'arrow', title: 'Reaction arrow' },
    { name: 'arrow-dashed', title: 'Dashed arrow' },
    { name: 'arrow-hollow', title: 'Arrow with a hollow head' },
    { name: 'arrow-double', title: 'Resonance arrow (heads at both ends)' },
    { name: 'arrow-equilibrium', title: 'Equilibrium arrows' },
    { name: 'arrow-retro', title: 'Retrosynthetic arrow' },
    { name: 'arrow-nogo', title: 'Crossed-out arrow (reaction does not go)' },
    { name: 'arrow-curved', title: 'Curved arrow (electron pair)' },
    { name: 'arrow-fishhook', title: 'Curved half-headed arrow (one electron)' },
  ],
};

const SHAPES: PaletteDef = {
  palette: 'shapes',
  title: 'Shapes',
  items: [
    { name: 'shape-rect', title: 'Box' },
    { name: 'shape-rect-rounded', title: 'Box with round corners' },
    { name: 'shape-rect-shadow', title: 'Box with a shadow' },
    { name: 'shape-rect-rounded-shadow', title: 'Round-cornered box with a shadow' },
    { name: 'shape-rect-dashed', title: 'Dashed box' },
    { name: 'shape-oval', title: 'Oval (Shift: circle)' },
    { name: 'shape-circle', title: 'Circle, drawn from its centre' },
    { name: 'shape-circle-filled', title: 'Filled circle, drawn from its centre' },
    { name: 'shape-line', title: 'Line' },
    { name: 'shape-line-dashed', title: 'Dashed line' },
    { name: 'shape-line-bold', title: 'Bold line' },
  ],
};

const BRACKETS: PaletteDef = {
  palette: 'brackets',
  title: 'Brackets',
  items: [
    { name: 'bracket-square', title: 'Square brackets [ ]' },
    { name: 'bracket-round', title: 'Parentheses ( )' },
    { name: 'bracket-curly', title: 'Braces { }' },
  ],
};

// Template palettes, one per kind of structure
const templatePalette = (group: Template['group'], palette: string, title: string, columns: number, iconSize?: number): PaletteDef => ({
  palette,
  title,
  items: TEMPLATES.filter((t) => t.group === group).map((t) => ({ name: `tpl-${t.id}`, title: t.name })),
  columns,
  large: true,
  iconSize,
  icon: (name, size) => templateIcon(templateById(name.slice(4))!, size),
});

const TOOL_GROUPS: ToolbarItem[][] = [
  [
    { name: 'select', title: 'Select and move' },
    { name: 'eraser', title: 'Eraser' },
  ],
  [
    { name: 'bond-single', title: 'Single bond. Click a bond: single, double, triple' },
    { name: 'bond-double', title: 'Double bond. Click again to move the second line' },
    { name: 'bond-triple', title: 'Triple bond' },
    { name: 'bond-wedge', title: 'Wedge. Click again to reverse' },
    { name: 'bond-hashWedge', title: 'Hashed wedge. Click again to reverse' },
    { name: 'bond-hash', title: 'Hashed bond' },
    { name: 'bond-bold', title: 'Bold bond' },
    { name: 'bond-dash', title: 'Dashed bond' },
    { name: 'bond-wavy', title: 'Wavy bond' },
    { name: 'chain', title: 'Chain: drag to draw a zig-zag chain' },
  ],
  [
    { name: 'ring-3', title: 'Cyclopropane' },
    { name: 'ring-4', title: 'Cyclobutane' },
    { name: 'ring-5', title: 'Cyclopentane' },
    { name: 'ring-6', title: 'Cyclohexane' },
    { name: 'ring-7', title: 'Cycloheptane' },
    { name: 'ring-8', title: 'Cyclooctane' },
    { name: 'ring-benzene', title: 'Benzene. Shift+click swaps the double bonds' },
    { name: 'ring-cp', title: 'Cyclopentadiene' },
  ],
  [
    templatePalette('rings', 'tpl-rings', 'Ring systems', 5),
    templatePalette('heterocycles', 'tpl-heterocycles', 'Heterocycles', 7),
    templatePalette('amino', 'tpl-amino', 'Amino acids', 5, 64),
    templatePalette('sugars', 'tpl-sugars', 'Sugars and chair', 4, 64),
  ],
  [
    { name: 'text', title: 'Text: click an atom to label it, or empty space for a caption' },
    ARROWS,
    SHAPES,
    BRACKETS,
  ],
];

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The keys that do an action, as people read them. */
function keysOf(ctx: KeyContext, action: string): string[] {
  return keymap.keysFor(ctx, action).map((k) => displayChord(k, isMac));
}

// Tool names for the Hotkeys window: the tool tip up to its first full stop or colon.
const toolNames: Record<string, string> = {};
for (const group of TOOL_GROUPS) {
  for (const item of group) {
    for (const t of 'palette' in item ? item.items : [item]) toolNames[t.name] = t.title.replace(/\s*\(.*?\)/g, '').split(/[.:] /)[0];
  }
}
registerToolNames(toolNames);

const toolbar = new Toolbar($<HTMLDivElement>('#tools'), TOOL_GROUPS, (name) => editor.setTool(name), (name) => {
  const keys = keysOf('space', `tool ${name}`);
  return keys.length ? ` (${keys.join(', ')})` : '';
});

const HINTS: Record<string, string> = {
  select: 'Click to select, drag to box-select or move. Double-click selects a whole structure. Delete removes.',
  eraser: 'Click an atom, bond, caption, arrow or shape to remove it.',
  chain: 'Drag from empty space or an atom; the number shows how many bonds.',
  text: 'Click an atom to type a label (OMe, CO2Et, NHBoc…), or click empty space for a caption.',
};
const ARROW_HINT = 'Drag to draw an arrow (Alt: any angle); click for a standard one. Drag the ends to move them, the middle to bend it.';
const CURVE_HINT = 'Drag from where the electrons start to where they go; swing out to one side to bend that way. Drag the middle dot to change the curve.';
const SHAPE_HINT = 'Drag to draw. Drag the corner squares to resize; the Style panel changes dashes, fill, corners and shadow.';
const BRACKET_HINT = 'Drag a box to put brackets round it, or click a structure to bracket it.';
const BOND_HINT = 'Click empty space or an atom to draw; drag to aim. Point at an atom or bond and press a hotkey (Edit > Hotkeys lists them).';
const RING_HINT = 'Click empty space, an atom (spiro; Alt+click to attach by a bond) or a bond (fused). Drag to orient.';
const TEMPLATE_HINT = 'Click empty space to place it (drag to turn it), a bond to fuse it on, or an atom to join it there (Alt: the other way: by a new bond, or sharing the atom).';

editor.onToolChange = (name) => {
  toolbar.setActive(name);
  const t = TOOLS[name];
  $('#hint').textContent = HINTS[name] ?? (t.kind === 'ring' ? RING_HINT : t.kind === 'arrow' ? (t.style.sweep ? CURVE_HINT : ARROW_HINT)
    : t.kind === 'shape' ? SHAPE_HINT : t.kind === 'bracket' ? BRACKET_HINT : t.kind === 'template' ? TEMPLATE_HINT : BOND_HINT);
};
editor.setTool('bond-single');

// ---------------------------------------------------------------- top bar actions

$('#btn-undo').addEventListener('click', () => undo());
$('#btn-redo').addEventListener('click', () => redo());
$('#btn-fit').addEventListener('click', () => command('zoom-fit'));
$('#btn-stress').addEventListener('click', () => stressTest(Number($<HTMLSelectElement>('#stress-n').value)));
$('#btn-help').addEventListener('click', () => openHelp());
$('#help-hotkeys').addEventListener('click', () => { $<HTMLDialogElement>('#help').close(); hotkeysDialog.open(); });
$('#help-close').addEventListener('click', () => $<HTMLDialogElement>('#help').close());
const stereoBox = $<HTMLInputElement>('#show-stereo');
stereoBox.addEventListener('change', () => {
  renderer.previewStereo = stereoBox.checked;
  renderer.repaintAll();
  editor.requestScene();
});

// Files dropped on the window: pictures go on the drawing or slide, other files open in tabs.
const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files');
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  host.classList.add('drop');
});
window.addEventListener('dragleave', (e) => { if (!e.relatedTarget) host.classList.remove('drop'); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  host.classList.remove('drop');
  void dropFiles([...(e.dataTransfer?.files ?? [])], { x: e.clientX, y: e.clientY });
});

async function dropFiles(files: File[], at: { x: number; y: number }): Promise<void> {
  const r = host.getBoundingClientRect();
  const inside = at.x >= r.left && at.x <= r.right && at.y >= r.top && at.y <= r.bottom;
  for (const f of files) {
    const bytes = new Uint8Array(await f.arrayBuffer());
    const mime = /\.(cdxml|cdx|pptx|xlsx|docx|csv|tsv|txt|sdf?)$/i.test(f.name) ? null : pictureMime(f.name, bytes);
    if (mime && sheetActive()) flash('Pictures can\'t go in a cell yet. Drop sheet files (.xlsx, .csv, .sdf) to open them.');
    else if (mime && docActive()) docMode.dropPicture(bytes, mime);
    else if (mime) placePicture(bytes, mime, inside ? renderer.toDoc(at.x - r.left, at.y - r.top) : null);
    else await ws.openBytes(bytes, f.name);
  }
}

// ---------------------------------------------------------------- cut, copy and paste

/** True when keys go into a text box rather than to the drawing. */
function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  return el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'range', 'color', 'file'].includes((el as HTMLInputElement).type);
}

/** True when some text on the page (not the drawing) is selected, so Ctrl+C should copy that. */
function textSelected(): boolean {
  const s = document.getSelection();
  return !!s && !s.isCollapsed && s.toString().trim() !== '';
}

/** Copy the selection, or the whole drawing when nothing is selected. */
function copy(): Promise<void> {
  return copyDrawing(doc, editor.hasSelection() ? editor.sel : null).then(flash, (err) => flash('Could not copy: ' + String(err)));
}

async function cut(): Promise<void> {
  if (!editor.hasSelection()) { flash('Select something to cut.'); return; }
  let msg: string;
  try {
    msg = await copyDrawing(doc, editor.sel);
  } catch (err) {
    flash('Could not copy: ' + String(err));
    return;
  }
  editor.deleteSelection();
  flash(msg.replace(/^Copied/, 'Cut'));
}

function paste(): void {
  void pasteFrom(nativeClipboard ? readNativeClipboard : readWebClipboard);
}

// In a browser, Ctrl+V arrives as a paste event, which carries the clipboard's text.
window.addEventListener('paste', (e) => {
  if (isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.('dialog')) return;
  e.preventDefault();
  if (sheetActive()) { void sheetMode.paste(nativeClipboard ? null : e); return; }
  if (docActive()) { void docMode.paste(nativeClipboard ? null : e); return; }
  if (nativeClipboard) paste();
  else void pasteFrom(() => readPasteEvent(e));
});

async function pasteFrom(read: () => Pasted | Promise<Pasted>): Promise<void> {
  let got: Pasted;
  try {
    got = await read();
  } catch (err) {
    flash('Could not paste: ' + String(err));
    return;
  }
  if (got.kind === 'drawing') {
    if (isEmpty(got.doc)) { flash('There is nothing to paste.'); return; }
    // on slides, structures can take the slide master's bond length; elsewhere they keep their size
    const deck = deckNow();
    fitPasted(got.doc, doc.style, deck?.master.fitPasted ? deck.master.drawing.bondLength : undefined);
    editor.sel = insertDrawing(doc, got.doc, pasteCentre());
    editor.changed();
  } else if (got.kind === 'text') await pasteChemistry(got.text);
  else if (got.kind === 'picture') placePicture(got.bytes, got.mime, null);
  else if (got.kind === 'table') pasteTable(got.rows);
  else flash('There is nothing to paste.');
}

/** Cells from Excel, Word or a sheet become a table in the ACS style, with the first row as headings. */
function pasteTable(rows: PastedRows): void {
  const t = tableFromCells(rows, textMeasure, doc.style.captionSize);
  placeTable(t, 'Paste table');
  flash(`Pasted a table of ${t.rows.length} rows and ${t.cols.length} columns. Double-click a cell to type; the Style panel has its rows, columns and lines.`, 7000);
}

const textMeasure = (t: string, size: number, family: string, style: string) => measureText(t, size, family, style);

/** Put a table in the middle of the window (or slide), selected. */
function placeTable(t: TableData, label: string): number {
  finishTyping();
  renderer.useStyle(doc);
  const lay = renderer.tableLayout(t);
  const c = pasteCentre();
  const x1 = c.x - lay.width / 2, y1 = c.y - lay.height / 2;
  let id = 0;
  doc.edit(label, () => { id = doc.addShape({ kind: 'table', x1, y1, x2: x1 + lay.width, y2: y1 + lay.height, table: t }).id; });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([id]) };
  editor.tablePart = { id, part: { r: 0, c: 0 } };
  editor.changed();
  return id;
}

/** Insert > Table: an empty table of the rows and columns asked for, ready to type into. */
async function insertTable(): Promise<void> {
  finishTyping();
  const got = await ask('Insert Table', [
    { name: 'rows', label: 'Rows', value: '4', type: 'number' },
    { name: 'cols', label: 'Columns', value: '3', type: 'number' },
  ], { ok: 'Insert', note: 'An ACS-style table: a rule above and below the heading row and under the last row. The Style panel changes the lines, headings, rows and columns.' });
  if (!got) return;
  const rows = Math.max(1, Math.min(500, Math.round(Number(got.rows) || 4)));
  const cols = Math.max(1, Math.min(60, Math.round(Number(got.cols) || 3)));
  const id = placeTable(emptyTable(rows, cols, doc.style.captionSize), 'Insert table');
  editor.editTable(id, { r: 0, c: 0 });
}

/** Where pasted things go: the middle of the slide in Slides mode, else the middle of the window. */
function pasteCentre(): { x: number; y: number } {
  const deck = deckNow();
  return deck ? { x: deck.size.w / 2, y: deck.size.h / 2 } : renderer.toDoc(renderer.width / 2, renderer.height / 2);
}

/** Paste a SMILES string or a molfile as a structure. */
async function pasteChemistry(text: string): Promise<void> {
  if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
  const c = pasteCentre();
  let mb: string | null = text.includes('M  END') ? text : null;
  if (!mb && !/\s/.test(text)) mb = await chem.smilesToMol(text);
  if (!mb) { flash('Paste a SMILES string or a molfile.'); return; }
  try {
    let ids: number[] = [];
    doc.edit('Paste', () => { ids = addMolfile(doc, mb!, c.x, c.y); });
    selectNewAtoms(ids);
  } catch (err) {
    flash(String(err));
  }
}

/** Select just these (new) atoms and their bonds. */
function selectNewAtoms(ids: number[]): void {
  editor.sel = { atoms: new Set(ids), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
  for (const id of ids) for (const b of doc.adj.get(id) ?? []) editor.sel.bonds.add(b);
  editor.changed();
}

// ------------------------------------------------------------------ name to structure

const names = new NameReader(new URL('opsin/opsin-data.dat', document.baseURI).href);
let namesReady = false;

/** A name as a laid-out molfile, or why not. */
async function nameToMolfile(name: string): Promise<{ mb: string; attach: number[]; warnings: string[] } | { error: string }> {
  const r = await names.read(name);
  namesReady = true;
  if (!r.ok) return { error: r.message };
  if (!chem.ready) return { error: 'The chemistry engine is still loading; try again in a moment.' };
  const mb = await chem.smilesToMol(r.smiles).catch(() => null);
  if (!mb) return { error: 'The name was read, but the structure could not be drawn (' + r.smiles + ').' };
  return { mb, attach: attachmentAtoms(r.smiles), warnings: [...r.warnings, ...cxNotes(r.smiles)] };
}

/** Adds a named structure centred at (x, y), its attachment points drawn as wavy lines. Use inside doc.edit (or `to`'s bulk). */
function addNamed(got: { mb: string; attach: number[] }, x: number, y: number, to: Doc = doc): number[] {
  const ids = addMolfile(to, got.mb, x, y);
  for (const i of got.attach) {
    if (ids[i] !== undefined) to.updateAtom(ids[i], { attach: 'Wavy', attachNum: undefined, z: 0, label: null, charge: 0 });
  }
  return ids;
}

const nameDialog = new NameDialog(async (name) => {
  const got = await nameToMolfile(name);
  if ('error' in got) return got.error;
  const c = renderer.toDoc(renderer.width / 2, renderer.height / 2);
  try {
    let ids: number[] = [];
    doc.edit('Name to Structure', () => { ids = addNamed(got, c.x, c.y); });
    selectNewAtoms(ids);
  } catch (err) {
    return String(err);
  }
  if (got.warnings.length) flash('Note from the name reader: ' + got.warnings.join(' '), 9000);
  return null;
}, () => !namesReady);

/**
 * Structure > Name to Structure. Selected captions are read as names and replaced by their
 * structures (Undo puts them back); with no caption selected, a window asks for a name.
 */
async function nameToStructure(): Promise<void> {
  const caps = [...editor.sel.captions].map((id) => doc.captions.get(id)).filter((c): c is Caption => !!c);
  if (!caps.length) { nameDialog.open(); return; }
  if (!namesReady) flash('Starting the name reader (only the first time)…');
  const found: { cap: Caption; mb: string; attach: number[] }[] = [];
  const problems: { name: string; why: string }[] = [], notes: string[] = [];
  for (const cap of caps) {
    const name = captionName(cap.runs.map((r) => r.text).join(''));
    const got = await nameToMolfile(name);
    if ('error' in got) problems.push({ name, why: got.error });
    else { found.push({ cap, mb: got.mb, attach: got.attach }); notes.push(...got.warnings); }
  }
  if (found.length) {
    let ids: number[] = [];
    try {
      doc.edit('Name to Structure', () => {
        for (const f of found) {
          const box = renderer.captionBox(f.cap);
          ids = ids.concat(addNamed(f, (box.x1 + box.x2) / 2, (box.y1 + box.y2) / 2));
          doc.removeCaption(f.cap.id);
        }
      });
    } catch (err) {
      flash(String(err));
      return;
    }
    selectNewAtoms(ids);
  }
  if (problems.length === 1 && !found.length) flash(problems[0].why, 9000);
  else if (problems.length) flash(`Not read as ${problems.length === 1 ? 'a name' : 'names'} (select one on its own to see why): ${problems.map((p) => `"${p.name}"`).join(', ')}`, 9000);
  else if (notes.length) flash('Note from the name reader: ' + notes.join(' '), 9000);
}

/** Copy the selected structures (or everything) as SMILES text. */
async function copySmiles(): Promise<void> {
  if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
  const atoms = editor.sel.atoms.size ? editor.sel.atoms : doc.atoms.keys();
  const { molblock } = toMolfile(doc, atoms);
  const smiles = await chem.molToSmiles(molblock);
  if (!smiles) { flash('There is no structure to copy.'); return; }
  await navigator.clipboard.writeText(smiles).then(() => flash('Copied SMILES: ' + smiles), () => flash('Could not use the clipboard.'));
}

/** Paste the clipboard's text as SMILES (or a molfile), even when a drawing is on it too. */
async function pasteSmiles(): Promise<void> {
  let text = '';
  try {
    text = (await readClipboardText()).trim();
  } catch (err) {
    flash('Could not read the clipboard: ' + String(err));
    return;
  }
  if (!text) { flash('The clipboard has no text on it.'); return; }
  await pasteChemistry(text);
}

function copyText(text: string, done: string): Promise<void> {
  return navigator.clipboard.writeText(text).then(() => flash(done), () => flash('Could not use the clipboard.'));
}

/** Copy the selected structures (or all of them) as molfile text. */
function copyMolfile(): Promise<void> {
  const atoms = editor.sel.atoms.size ? editor.sel.atoms : doc.atoms.keys();
  const { molblock } = toMolfile(doc, atoms);
  return copyText(molblock, 'Copied as molfile text.');
}

/** Copy the selection (or the whole drawing) as CDXML text, for pasting into a text editor or script. */
function copyCdxmlText(): Promise<void> | void {
  const part = extractDrawing(doc, editor.hasSelection() ? editor.sel : null);
  if (isEmpty(part)) { flash('There is nothing to copy.'); return; }
  return copyText(writeCdxml(part, { name: 'Clipboard.cdxml', textMeasure: measureText }), 'Copied as CDXML text.');
}

let lastTurn = { angle: '90', dir: 'cw' };
async function rotateDialog(): Promise<void> {
  if (!editor.hasSelection()) { flash('Select something to rotate.'); return; }
  const r = await ask('Rotate', [
    { name: 'angle', label: 'Angle', value: lastTurn.angle, unit: 'degrees', type: 'number' },
    { name: 'dir', label: 'Direction', value: lastTurn.dir, options: [{ value: 'cw', label: 'Clockwise' }, { value: 'ccw', label: 'Anticlockwise' }] },
  ], { ok: 'Rotate' });
  if (!r) return;
  const a = parseFloat(r.angle);
  if (!Number.isFinite(a)) { flash('Type the angle in degrees.'); return; }
  lastTurn = { angle: r.angle, dir: r.dir };
  editor.rotateBy(r.dir === 'ccw' ? -a : a);
}

async function scaleDialog(): Promise<void> {
  if (!editor.hasSelection()) { flash('Select something to scale.'); return; }
  const L = editor.selectionBondLength();
  const shown = L ? L.toFixed(1) : '';
  const r = await ask('Scale', [
    { name: 'pct', label: 'Size', value: '100', unit: '%', type: 'number' },
    ...(L ? [{ name: 'len', label: 'or bond length', value: shown, unit: 'pt', type: 'number' as const }] : []),
  ], {
    ok: 'Scale',
    note: L ? `The selected bonds are ${shown} pt long; the drawing's standard is ${doc.style.bondLength.toFixed(1)} pt. Change either box.` : undefined,
  });
  if (!r) return;
  let f = parseFloat(r.pct) / 100;
  if (L && r.len !== undefined && r.len.trim() !== shown) f = parseFloat(r.len) / L;
  if (!Number.isFinite(f) || f <= 0) { flash('Type a size above zero.'); return; }
  editor.scaleSelection(f);
}

function reactionStep(dir: 'right' | 'left' | 'down' | 'up'): void {
  if (!editor.reactionStep(dir)) flash('Select the starting material first: this adds a reaction arrow and a copy of it to turn into the product.');
}

const OPTION_TEXT = {
  fixedLength: ['Fixed bond lengths on: new bonds are the standard length (hold Alt to drag any length).', 'Fixed bond lengths off: new bonds are as long as you drag them.'],
  fixedAngles: ['Fixed angles on: new bonds point in 15° steps (hold Alt for any angle).', 'Fixed angles off: new bonds point wherever you drag.'],
};
function toggleOption(key: 'fixedLength' | 'fixedAngles'): void {
  editor.options[key] = !editor.options[key];
  flash(OPTION_TEXT[key][editor.options[key] ? 0 : 1]);
  refreshKeys();
  storeSettings();
}

/** View > Developer Tools: the Speed panel and the stress test, hidden unless switched on. */
let devTools = false;
function showDevTools(on: boolean): void {
  devTools = on;
  for (const el of document.querySelectorAll<HTMLElement>('.dev-only')) el.hidden = !on;
  $('[data-cmd="dev-tools"]')?.setAttribute('aria-checked', String(on));
  if (on) updatePanels();
}

function align(how: Align): void {
  if (!editor.align(how)) flash('Select two or more structures, captions, arrows or shapes to line them up.');
}

let flashTimer = 0;
function flash(msg: string, ms = 3500): void {
  const el = $('#flash');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = window.setTimeout(() => el.classList.remove('show'), ms);
}

// ---------------------------------------------------------------- tabs: drawings and slide decks

let lastOpen = '';
let lastStats: ReadStats | null = null;

const tabsEl = $<HTMLDivElement>('#tabs');
const notesBox = $<HTMLTextAreaElement>('#notes');
const layoutSel = $<HTMLSelectElement>('#rb-layout');
const sizeSel = $<HTMLSelectElement>('#rb-size');
const presenter = new Presenter();

/** View > Mode Colours: blue for drawings, orange for slides, green for sheets, or the person's own colours. */
let modeColours: ModeColours = { ...DEFAULT_MODE_COLOURS };
// Each mode keeps its own tool: slides start with Select (click a placeholder to type), drawings
// and structures drawn for sheet cells with a bond.
const modeTool: Record<Tab['mode'], string> = { drawing: 'bond-single', slides: 'select', sheet: 'bond-single', document: 'bond-single' };

// ---------------------------------------------------------------- sheets

// Properties of the structures in sheets (formula, MW, HRMS…), worked out by the chemistry engine
const sheetChem = new SheetChem(chem, (c) => structureMolfile(c, ws.active.book?.drawingStyle ?? ACS_1996));

// Pictures of structures for Excel files, drawn in the workbook's drawing style
const filePictures = new WeakMap<DocStyle, StructurePictures>();
function picturesFor(style: DocStyle): StructurePictures {
  let p = filePictures.get(style);
  if (!p) { p = new StructurePictures(() => style); filePictures.set(style, p); }
  return p;
}

/** Twice the screen's pixels, so pictures stay sharp when Excel is zoomed in. */
const FILE_PICTURE_SCALE = 2;

const sheetFiles: SheetFileDeps = {
  settled: () => sheetChem.settled(),
  box: (s, style) => picturesFor(style).box(s),
  // the picture covers the cell as the grid shows it: its fill, and the structure where it sits
  picture: async (s, style, cell) => {
    const pics = picturesFor(style);
    const S = FILE_PICTURE_SCALE;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(cell.w * S));
    canvas.height = Math.max(1, Math.round(cell.h * S));
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = cell.fill ?? '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // the picture sits inside the gridlines: place the structure as in the whole cell
    const p = structurePlace(pics.box(s), { x: -1, y: -1, w: cell.w + 2, h: cell.h + 2 }, cell.align, cell.valign);
    if (p.k > 0) {
      const bmp = pics.bitmap(s, p.k * S, true);
      if (bmp) ctx.drawImage(bmp, p.x * S, p.y * S, p.w * S, p.h * S);
    }
    return new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
  },
  rowHeights: (s) => sheetMode.view.autoHeights(s),
};

/** Pictures of a document's drawings for Word files (300 dots to the inch, as for PowerPoint). */
const docFiles: DocxDeps = {
  picture: async (contents, style) => {
    const d = structureDoc(contents, style);
    const pic = recordPicture(d, FIGURE_MARGIN);
    if (!pic) return null;
    const png = new Uint8Array(await (await canvasPng(pictureCanvas(d, pic).canvas)).arrayBuffer());
    return { png, svg: pictureSvg(pic), w: pic.box.x2 - pic.box.x1, h: pic.box.y2 - pic.box.y1 };
  },
  svgToPng,
};

/** Opening Word files: ChemDraw objects in them become structures, kept at the size they had. */
const docRead: DocxReadDeps = {
  chemdraw: (cdx, style) => {
    const d = readCdxml(cdxToCdxml(cdx)).doc;
    fitPasted(d, style);
    return d.contents();
  },
  drawingSize: (contents, style) => {
    const pic = recordPicture(structureDoc(contents, style), FIGURE_MARGIN);
    return pic ? { w: pic.box.x2 - pic.box.x1, h: pic.box.y2 - pic.box.y1 } : null;
  },
  tableDrawing,
};

const ws: Workspace = new Workspace(doc, {
  leave: (tab) => {
    finishTyping();
    if (tab.mode === 'sheet') sheetMode.leave();
    if (tab.mode === 'document') docMode.leave();
    modeTool[tab.mode] = editor.toolName;
    editor.cropping = null;
    tab.view = { ...renderer.view };
    if (tab.deck) { tab.deck.onChange = () => {}; tab.deck.onSwitch = () => {}; }
  },
  enter: (tab, opened) => enterTab(tab, opened),
  changed: () => { renderTabs(); updateTitle(); },
  flash,
  pptx: {
    picture: async (d) => {
      const pic = recordPicture(d, 1);
      if (!pic) return null;
      const png = new Uint8Array(await (await canvasPng(pictureCanvas(d, pic).canvas)).arrayBuffer());
      return { svg: pictureSvg(pic), png, box: pic.box };
    },
    svgToPng,
  },
  measure: measureText,
  sheets: {
    read: (bytes, name) => readSheetFile(bytes, name, sheetFiles),
    write: (book, name) => writeSheetFile(book, name, sheetFiles),
  },
  documents: {
    read: (bytes) => readDocx(bytes, docRead),
    write: (d) => writeDocx(d, docFiles),
  },
});

/** The slide deck showing (in Slides mode), or null for a drawing. */
function deckNow(): Deck | null {
  return ws.active.mode === 'slides' ? ws.active.deck : null;
}

/** Finish typing in a caption or the notes (and drawing a structure for a cell), before the slide or tab changes. */
function finishTyping(): void {
  finishCellStructure(true);
  editor.closeCaption();
  flushNotes();
}

/** Set the window up for a tab that has just come to the front. */
function enterTab(tab: Tab, opened: boolean): void {
  const deck = tab.deck;
  const slides = !!deck;
  const sheet = tab.mode === 'sheet';
  const words = tab.mode === 'document';
  document.body.classList.toggle('slides-mode', slides);
  document.body.classList.toggle('sheet-mode', sheet);
  document.body.classList.toggle('doc-mode', words);
  applyModeColours(tab.mode, modeColours);
  for (const el of document.querySelectorAll<HTMLElement>('.slides-only')) el.hidden = !slides;
  showSheetParts();
  editor.paused = sheet || words;
  sheetMode.show(sheet ? tab : null);
  docMode.show(words ? tab : null);
  renderer.screen = slides;
  renderer.page = slides ? slidePage : null;
  editor.slideKeys = slides;
  editor.cropping = null;
  editor.lastEdited = null;
  if (editor.toolName !== modeTool[tab.mode]) editor.setTool(modeTool[tab.mode]);
  editor.fitArea = deck ? () => ({ x1: 0, y1: 0, x2: deck.size.w, y2: deck.size.h }) : null;
  if (deck) {
    deck.onChange = () => deckChanged(deck);
    deck.onSwitch = () => slideSwitched(deck);
    listKey = slideListKey(deck);
    masterSeen = deck.master;
    slideList.show(deck);
    notesBox.value = deck.current?.notes ?? '';
    showSlideState();
  } else slideList.show(null);
  // the slide list and notes take room from the drawing area
  resize();
  if (tab.view && !opened) renderer.view = { ...tab.view };
  else editor.fit();
  renderer.repaintAll();
  editor.clearSelection();
  editor.frame(true);
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
  if (sheet) $('#hint').textContent = SHEET_HINT;
  else if (words) $('#hint').textContent = DOC_HINT;
  else editor.onToolChange(editor.toolName);
}

/** The slide's background, logo, number and footer, drawn under its drawing. */
const slidePage = {
  draw(ctx: CanvasRenderingContext2D): void {
    const d = deckNow();
    if (d?.current) drawSlidePage(ctx, { size: d.size, master: d.master, layout: d.current.layout, index: d.index }, SURROUND);
  },
};

// The slide list is rebuilt when slides come, go or move; otherwise only the slide being
// edited gets a new picture.
let listKey = '';
let masterSeen: unknown = null;
const slideListKey = (d: Deck) => `${d.slides.map((s) => s.id + (s.notes.trim() ? 'n' : '')).join(',')}|${d.index}|${d.size.w}x${d.size.h}`;

function deckChanged(deck: Deck): void {
  const key = slideListKey(deck);
  if (key !== listKey || masterSeen !== deck.master) {
    listKey = key;
    masterSeen = deck.master;
    slideList.rebuild();
  } else slideList.refresh();
  showSlideState();
  ws.noteChange();
}

function slideSwitched(deck: Deck): void {
  editor.cropping = null;
  editor.lastEdited = null;
  notesBox.value = deck.current?.notes ?? '';
  renderer.repaintAll();
  editor.requestScene();
  editor.clearSelection();
}

/** The layout and size boxes and the Slide menu show the slide being edited. */
function showSlideState(): void {
  const deck = deckNow();
  if (!deck?.current) return;
  layoutSel.value = deck.current.layout;
  const named = deck.size.w === WIDE.w && deck.size.h === WIDE.h ? 'wide' : deck.size.w === STANDARD.w && deck.size.h === STANDARD.h ? 'standard' : 'custom';
  let custom = sizeSel.querySelector<HTMLOptionElement>('option[value="custom"]');
  if (named === 'custom') {
    if (!custom) { custom = new Option('', 'custom'); sizeSel.add(custom); }
    custom.text = sizeName(deck.size);
  } else custom?.remove();
  sizeSel.value = named;
  for (const l of LAYOUTS) $(`[data-cmd="layout-${l.id}"]`)?.setAttribute('aria-checked', String(l.id === deck.current.layout));
  $('[data-cmd="size-wide"]')?.setAttribute('aria-checked', String(named === 'wide'));
  $('[data-cmd="size-standard"]')?.setAttribute('aria-checked', String(named === 'standard'));
}

const slideList = new SlideList($('#slide-list'), {
  go: (i) => goSlide(i),
  remove: (ix) => removeSlides(ix),
  duplicate: (ix) => { const d = deckNow(); if (d) { finishTyping(); d.duplicate(ix); } },
  add: () => newSlide(),
});

function goSlide(i: number): void {
  const d = deckNow();
  if (!d || i < 0 || i >= d.slides.length) return;
  finishTyping();
  d.go(i);
}

function newSlide(layout?: LayoutId): void {
  const d = deckNow();
  if (!d) { flash('Slides are for presentations: use File > New Slides, or open a PowerPoint file.'); return; }
  finishTyping();
  d.addSlide(layout);
}

function removeSlides(ix: number[]): void {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  if (!d.remove(ix)) flash('A presentation needs at least one slide.');
}

function setLayout(l: LayoutId): void {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  d.setLayout(l);
}

function setSlideSize(size: { w: number; h: number }): void {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  d.setSize(size);
  editor.fit();
}

layoutSel.addEventListener('change', () => { setLayout(layoutSel.value as LayoutId); layoutSel.blur(); });
sizeSel.addEventListener('change', () => {
  if (sizeSel.value === 'wide') setSlideSize(WIDE);
  else if (sizeSel.value === 'standard') setSlideSize(STANDARD);
  sizeSel.blur();
});

// Speaker notes are saved with the slide a moment after typing stops (and when the box is left).
let notesTimer = 0;
let notesFor: { deck: Deck; slide: unknown } | null = null;
notesBox.addEventListener('input', () => {
  const deck = deckNow();
  if (!deck) return;
  if (!notesFor) notesFor = { deck, slide: deck.current };
  clearTimeout(notesTimer);
  notesTimer = window.setTimeout(flushNotes, 500);
});
notesBox.addEventListener('blur', () => flushNotes());

function flushNotes(): void {
  clearTimeout(notesTimer);
  const f = notesFor;
  notesFor = null;
  if (!f) return;
  const i = f.deck.slides.indexOf(f.slide as Deck['slides'][number]);
  if (i >= 0) f.deck.setNotes(notesBox.value, i);
}

/** Undo and Redo: in Slides mode the deck's history covers every slide and the slide list; a sheet has its own. */
function undo(): void {
  if (sheetActive()) { sheetMode.undo(); return; }
  if (docActive()) { docMode.run('undo'); return; }
  const d = deckNow();
  if (!d) { editor.undo(); return; }
  finishTyping();
  if (d.undo()) editor.afterUndo();
}

function redo(): void {
  if (sheetActive()) { sheetMode.redo(); return; }
  if (docActive()) { docMode.run('redo'); return; }
  const d = deckNow();
  if (!d) { editor.redo(); return; }
  finishTyping();
  if (d.redo()) editor.afterUndo();
}

// ---------------------------------------------------------------- the tab strip

function renderTabs(): void {
  const items = ws.tabs.map((t) => {
    const el = document.createElement('div');
    el.className = `tab tab-${t.mode}${t === ws.active ? ' active' : ''}${t.dirty ? ' dirty' : ''}`;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t === ws.active));
    el.title = (t.ref.kind === 'path' ? t.ref.path : t.name) + (t.dirty ? ' (not saved)' : '');
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.textContent = t.mode === 'slides' ? 'P' : t.mode === 'sheet' ? 'X' : t.mode === 'document' ? 'W' : 'D';
    icon.title = t.mode === 'slides' ? 'Slides' : t.mode === 'sheet' ? 'Sheet' : t.mode === 'document' ? 'Document' : 'Drawing';
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = t.name;
    const close = document.createElement('button');
    close.className = 'tab-close';
    close.type = 'button';
    close.title = 'Close';
    close.setAttribute('aria-label', `Close ${t.name}`);
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); void ws.close(t); });
    el.addEventListener('click', () => ws.activate(t));
    // the middle mouse button closes a tab, as in browsers
    el.addEventListener('auxclick', (e) => { if (e.button === 1) { e.preventDefault(); void ws.close(t); } });
    el.append(icon, name, close);
    return el;
  });
  const add = (label: string, title: string, cmd: string) => {
    const b = document.createElement('button');
    b.className = 'tab-new';
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => command(cmd));
    return b;
  };
  tabsEl.replaceChildren(...items, add('+ Drawing', 'New drawing', 'new'), add('+ Slides', 'New slides', 'new-slides'), add('+ Sheet', 'New sheet', 'new-sheet'), add('+ Document', 'New document', 'new-document'));
  tabsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

let lastTitle = '';
function updateTitle(): void {
  const t = `${ws.active.dirty ? '• ' : ''}${ws.active.name} – Chem Illustrator`;
  if (t === lastTitle) return;
  lastTitle = t;
  document.title = t;
  if (isTauri()) getCurrentWindow().setTitle(t).catch(() => {});
}

// ---------------------------------------------------------------- pictures

/** Ask for a picture file. */
async function pickPicture(): Promise<{ bytes: Uint8Array; mime: string; name: string } | null> {
  let f;
  try {
    f = await openBytesDialog('Pictures', [], PICTURE_EXTENSIONS);
  } catch (e) {
    await showError('Could not open the picture: ' + String(e));
    return null;
  }
  if (!f) return null;
  const mime = pictureMime(f.name, f.bytes);
  if (!mime) { flash(`${f.name} isn't a picture this can show.`); return null; }
  return { bytes: f.bytes, mime, name: f.name };
}

async function insertPicture(): Promise<void> {
  const p = await pickPicture();
  if (p) placePicture(p.bytes, p.mime, null);
}

/**
 * Put a picture on the drawing or slide, centred at `at` (the middle of the slide or window
 * when null), at its own size (96 pixels to the inch) or smaller to fit.
 */
function placePicture(bytes: Uint8Array, mime: string, at: { x: number; y: number } | null): void {
  finishTyping();
  const px = imageSize(bytes, mime) ?? { w: 400, h: 300 };
  const deck = deckNow();
  const room = deck ? { w: deck.size.w * 0.8, h: deck.size.h * 0.8 } : { w: (renderer.width * 0.8) / renderer.view.scale, h: (renderer.height * 0.8) / renderer.view.scale };
  const k = Math.min(0.75, room.w / px.w, room.h / px.h);
  const w = px.w * k, h = px.h * k;
  const c = at ?? pasteCentre();
  let made: Shape | null = null;
  doc.edit('Insert picture', () => {
    made = doc.addShape({ kind: 'picture', x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, src: dataUrl(bytes, mime), px });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([made!.id]) };
  editor.changed();
  if (mime === 'image/tiff' || mime === 'image/x-wmf' || !showableSrc(made!.src ?? '')) flash('This kind of picture shows as a grey box here for now; it is kept, and saved with the file.', 8000);
}

/** Insert > Crop Picture: the selected picture's handles cut its edges off until Esc or a click elsewhere. */
function cropPicture(): void {
  const pics = [...editor.sel.shapes].filter((id) => doc.shapes.get(id)?.kind === 'picture');
  if (pics.length !== 1) { flash('Select one picture to crop.'); return; }
  editor.cropping = editor.cropping === pics[0] ? null : pics[0];
  editor.requestOverlay();
  stylePanel.refresh();
  if (editor.cropping !== null) flash('Drag the black handles to cut the edges off. Press Esc or click elsewhere when you are done.', 6000);
}

/** A PNG of an SVG picture, for programs that can't show SVG (w × h pixels, kept to a sensible size). */
async function svgToPng(svg: string, w: number, h: number): Promise<Uint8Array> {
  const k = Math.min(1, 8000 / w, 8000 / h, Math.sqrt(12e6 / (w * h)));
  const img = await loadImage('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return new Uint8Array(await (await canvasPng(c)).arrayBuffer());
}

// a picture that has just loaded is drawn, on the slide and in the slide list
onImageReady(() => {
  renderer.repaintAll();
  editor.requestScene();
  slideList.refreshAll();
});

// ---------------------------------------------------------------- slide master and the slide show

async function slideMaster(): Promise<void> {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  const m = await editMaster(d.master, {
    pickPicture: async (): Promise<SlideImage | null> => {
      const p = await pickPicture();
      return p ? { src: dataUrl(p.bytes, p.mime), px: imageSize(p.bytes, p.mime) ?? { w: 200, h: 200 } } : null;
    },
  });
  // the deck may have gone (its tab closed) while the window was open
  if (m && deckNow() === d) d.setMaster(m);
}

function present(fromHere: boolean): void {
  const d = deckNow();
  if (!d) { flash('Present shows slides: use File > New Slides, or open a PowerPoint file.'); return; }
  finishTyping();
  editor.paused = true;
  void presenter.start(d, fromHere ? d.index : 0);
}

presenter.onEnd = (i) => {
  editor.paused = false;
  // carry on editing the slide the show ended on
  goSlide(i);
  editor.requestScene();
};

// ---------------------------------------------------------------- export

async function exportMolfile(): Promise<void> {
  const ids = [...(editor.sel.atoms.size ? editor.sel.atoms : doc.atoms.keys())];
  if (!ids.length) { flash('There is no structure to export.'); return; }
  const { molblock, unknownLabels } = toMolfile(doc, ids);
  const target = await saveFileDialog(withExtension(ws.active.name, MOL.extension), MOL).catch(async (e) => { await showError(String(e)); return null; });
  if (!target) return;
  try {
    await writeFile(target.ref, target.name, molblock, MOL);
  } catch (e) {
    await showError(`Could not save ${target.name}: ${String(e)}`);
    return;
  }
  const left = unknownLabels.length ? ` (left out, not understood: ${unknownLabels.join(', ')})` : '';
  flash(`Saved ${target.name}${left}`);
}

/** File > Export PDF: every slide as a page, or the drawing on a page of its own size. */
async function exportPdf(): Promise<void> {
  const tab = ws.active, deck = tab.deck;
  let pages: PdfPage[];
  const docFile = docActive() ? tab.document : null;
  if (docFile) {
    // the pages as laid out on screen, figures as shapes and text so they stay sharp
    pages = recordPages(docFile.t, docFile.layout(), (c, style) => figures.record(c, style).pic);
  } else if (deck) {
    pages = deck.slides.map((s, i) => ({
      w: deck.size.w, h: deck.size.h,
      items: recordSlide({ size: deck.size, master: deck.master, layout: s.layout, index: i }, deck.docOf(i)),
    }));
  } else {
    const pic = recordPicture(doc, 18);
    if (!pic) { flash('There is nothing to put in a PDF yet.'); return; }
    const b = pic.box;
    pages = [{ w: b.x2 - b.x1, h: b.y2 - b.y1, items: pic.items, origin: { x: b.x1, y: b.y1 } }];
  }
  const target = await saveFileDialog(withExtension(tab.name, PDF.extension), PDF).catch(async (e) => { await showError(String(e)); return null; });
  if (!target) return;
  try {
    const bytes = await writePdf(pages, { title: tab.name.replace(/\.[^.]+$/, ''), image: pdfImage });
    await writeFile(target.ref, target.name, bytes, PDF);
  } catch (e) {
    await showError(`Could not save ${target.name}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  flash(`Saved ${target.name}${pages.length > 1 ? ` (${pages.length} pages)` : ''}`);
}

/** A picture's pixels for a PDF: JPEGs go in as they are; others are read through the browser. */
async function pdfImage(src: string): Promise<PdfImage | null> {
  const { mime, bytes } = fromDataUrl(src);
  if (mime === 'image/jpeg') {
    const info = jpegInfo(bytes);
    if (info) return { kind: 'jpeg', bytes, ...info };
  }
  if (mime === 'image/x-wmf' || mime === 'image/tiff') return null;
  let img: HTMLImageElement;
  try {
    img = await loadImage(src);
  } catch {
    return null;
  }
  let w = img.naturalWidth || 300, h = img.naturalHeight || 150;
  // a drawing in SVG (or a Windows metafile, shown as SVG) has no pixels of its own: make plenty so it prints sharply
  if (mime === 'image/svg+xml' || mime === 'image/x-emf') { const k = 3000 / Math.max(w, h); w *= k; h *= k; }
  const k = Math.min(1, Math.sqrt(16e6 / (w * h)));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0, w, h);
  const px = g.getImageData(0, 0, w, h).data;
  const rgb = new Uint8Array(w * h * 3), alpha = new Uint8Array(w * h);
  let clear = false;
  for (let i = 0, j = 0; i < w * h; i++, j += 4) {
    rgb[i * 3] = px[j]; rgb[i * 3 + 1] = px[j + 1]; rgb[i * 3 + 2] = px[j + 2];
    alpha[i] = px[j + 3];
    if (px[j + 3] < 255) clear = true;
  }
  return { kind: 'raw', w, h, rgb, alpha: clear ? alpha : null };
}

// ---------------------------------------------------------------- sheets: the grid, and structures drawn for cells

const SHEET_HINT = 'Type in a cell, or double-click to change it. Sheet > Draw Structure puts a structure in a cell; Insert Property Columns works out formula, MW, HRMS m/z and more.';

/** True when a sheet is showing (and no structure is being drawn for one of its cells). */
function sheetActive(): boolean {
  return ws.active.mode === 'sheet' && !cellEdit;
}

const sheetMode = new SheetMode({
  flash,
  editStructure: (contents, title, done) => editCellStructure(contents, title, done),
  key: (e) => sheetKey(e),
  changed: () => ws.noteChange(),
  toStructure: (text, style) => textToStructure(text, style),
  writeCells: (own, text, html) => writeCells(own, text, html),
  copyStructure: async (contents, style) => (await copyDrawing(structureDoc(contents, style), null)).replace(/^Copied the whole drawing/, 'Copied the structure'),
  readCells: (e) => readCells(e),
}, sheetChem);

/** The style structures in the sheet showing are drawn in. */
const sheetStyle = (): DocStyle => ws.active.book?.drawingStyle ?? ACS_1996;

/**
 * The sheet's and document's ribbons, menus and panes show with a sheet or a document; the
 * drawing menus only while drawing a structure for a cell or a document.
 */
function showSheetParts(): void {
  const sheet = ws.active.mode === 'sheet';
  const words = ws.active.mode === 'document';
  for (const el of document.querySelectorAll<HTMLElement>('.sheet-only, .no-sheet, .doc-only, .no-doc, .draw-only')) {
    const c = el.classList;
    el.hidden = (c.contains('sheet-only') && !sheet) || (c.contains('no-sheet') && sheet) || (c.contains('doc-only') && !words)
      || (c.contains('no-doc') && words) || (c.contains('draw-only') && (sheet || words) && !cellEdit);
  }
  $('#sheet-menu-wrap').hidden = !sheet || !!cellEdit;
}

/** A key pressed in a sheet: Excel's keys first, then the menu keys that use Ctrl, Alt or a function key. */
function sheetKey(e: KeyboardEvent): boolean {
  const chord = chordOf(e);
  if (!chord) return false;
  // Alt+← and Alt+→ would go back and forward in a browser, leaving the page
  if (chord === 'Alt+ArrowLeft' || chord === 'Alt+ArrowRight') return true;
  for (const ctx of ['sheet', 'command'] as KeyContext[]) {
    const action = keymap.lookup(ctx, chord);
    if (!action) continue;
    // plain keys type in cells and arrows move between them, so the drawing's plain keys don't apply
    if (ctx === 'command' && !/^(Ctrl|Alt)\+|^(Shift\+)?F\d+$/.test(chord)) continue;
    const { verb, arg } = parseAction(action);
    if (verb !== 'command') continue;
    if ((arg === 'copy' || arg === 'cut') && textSelected()) return false;
    // in a browser, Ctrl+V goes on to the paste event, which can read the clipboard
    if (arg === 'paste' && !nativeClipboard) return false;
    if (command(arg)) return true;
  }
  return false;
}

/** A SMILES string, molfile or name as a drawing, for a cell. */
async function textToStructure(text: string, style: DocStyle): Promise<{ contents: Contents; notes: string[] } | { error: string }> {
  const t = text.trim();
  if (!t) return { error: 'Type a name or SMILES.' };
  if (!chem.ready) return { error: 'The chemistry engine is still loading; try again in a moment.' };
  let got: { mb: string; attach: number[]; warnings: string[] } | null = null;
  if (t.includes('M  END')) got = { mb: t, attach: [], warnings: [] };
  else if (!/\s/.test(t)) {
    const mb = await chem.smilesToMol(t).catch(() => null);
    if (mb) got = { mb, attach: [], warnings: [] };
  }
  if (!got) {
    const named = await nameToMolfile(t);
    if ('error' in named) return { error: `"${t}" isn't SMILES, and couldn't be read as a name: ${named.error}` };
    got = named;
  }
  const d = new Doc();
  d.style = { ...style };
  try {
    d.bulk(() => { addNamed(got!, 0, 0, d); });
  } catch (err) {
    return { error: String(err) };
  }
  return { contents: d.contents(), notes: got.warnings };
}

/**
 * Cells to the clipboard: our own copy (formulas, structures and formats), an HTML table (Excel
 * and Word keep bold, colours and borders) and tab-separated text.
 */
async function writeCells(own: string, text: string, html: string): Promise<void> {
  if (nativeClipboard) {
    const enc = new TextEncoder();
    await writeNativeFormats([[CELLS_FORMAT, enc.encode(own)], ['HTML Format', cfHtml(html)], ['CF_UNICODETEXT', enc.encode(text)]]);
    return;
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': new Blob([text], { type: 'text/plain' }), 'text/html': new Blob([html], { type: 'text/html' }) })]);
  } catch {
    await navigator.clipboard.writeText(text);
  }
}

/** What's on the clipboard for a paste into a sheet. Drawings (from here or ChemDraw) stay structures. */
async function readCells(e: ClipboardEvent | null): Promise<ClipboardCells> {
  const dec = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');
  const drawingOf = (d: Doc): Contents => { fitPasted(d, sheetStyle()); return d.contents(); };
  if (nativeClipboard) {
    const t = await nativeFirst(['CF_UNICODETEXT']);
    const text = t ? dec(t[1]) : undefined;
    const own = await nativeFirst([CELLS_FORMAT]);
    if (own) return { own: dec(own[1]), text };
    const drawing = await nativeFirst([OWN_FORMAT, CDX_FORMAT]);
    if (drawing) {
      const [name, data] = drawing;
      return { drawing: drawingOf(readCdxml(name === CDX_FORMAT ? cdxToCdxml(data) : dec(data)).doc), text };
    }
    if (text && looksLikeCdxml(text)) return { drawing: drawingOf(readCdxml(text).doc) };
    if (text) return { text };
    return { picture: !!(await nativeFirst(['PNG', 'CF_ENHMETAFILE', 'CF_DIB'])) };
  }
  const text = e ? e.clipboardData?.getData('text/plain') ?? '' : await navigator.clipboard.readText().catch(() => '');
  if (looksLikeCdxml(text)) return { drawing: drawingOf(readCdxml(text).doc) };
  if (text) return { text };
  if (!e) return {};
  // a drawing copied here goes on the clipboard as a picture; the drawing itself is kept for pasting back
  const p = await readPasteEvent(e);
  if (p.kind === 'drawing') return { drawing: drawingOf(p.doc) };
  return { picture: p.kind === 'picture' };
}

/** The structure in the selected cell as a drawing (for Copy as Molfile and CDXML text). */
function activeStructureDoc(): Doc | null {
  const c = sheetMode.activeStructure();
  return c ? structureDoc(c, sheetStyle()) : null;
}

// Drawing a structure for a cell: the drawing area floats over the sheet, with Done and Cancel.
// The cell's drawing is swapped into the editor's document while it's drawn (the sheet's tab
// leaves that document empty), so every drawing tool, key and check works on it as usual.
let cellEdit: { done: (c: Contents | null) => void; saved: Doc } | null = null;

function editCellStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void, style: DocStyle = sheetStyle()): void {
  finishCellStructure(true);
  const blank: Contents = { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] };
  const drawing = structureDoc(contents ?? blank, style);
  editor.clearSelection();
  doc.swap(drawing);
  cellEdit = { done, saved: drawing };
  document.body.classList.add('floating-drawing');
  $('#structure-title').textContent = title;
  $('#structure-bar').hidden = false;
  showSheetParts();
  editor.paused = false;
  editor.lastEdited = null;
  editor.cropping = null;
  const mode = ws.active.mode;
  if (editor.toolName !== modeTool[mode]) editor.setTool(modeTool[mode]);
  editor.onToolChange(editor.toolName);
  resize();
  // the structure in the middle, at a comfortable size (a new one starts at the middle)
  const b = doc.bounds();
  const w = renderer.width, h = renderer.height;
  const k = b ? Math.min(2.5, 0.8 * Math.min(w / Math.max(20, b.x2 - b.x1), h / Math.max(20, b.y2 - b.y1))) : 2;
  renderer.view = { ...renderer.view, scale: k, ox: w / 2 - (b ? (b.x1 + b.x2) / 2 : 0) * k, oy: h / 2 - (b ? (b.y1 + b.y2) / 2 : 0) * k };
  renderer.repaintAll();
  editor.frame(true);
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
  overlay.focus();
  // a new, empty table on its own (Insert > Table in a document): start typing in its first cell
  const shapes = [...doc.shapes.values()];
  const table = shapes.length === 1 && !doc.atoms.size ? shapes[0] : null;
  if (table?.table && table.table.rows.every((r) => r.every((c) => !c.runs.length))) editor.editTable(table.id, { r: 0, c: 0 });
}

/** Done (keep the drawing) or Cancel. The cell only changes when something was drawn. */
function finishCellStructure(keep: boolean): void {
  const e = cellEdit;
  if (!e) return;
  editor.closeCaption();
  cellEdit = null;
  const result = keep && doc.canUndo() ? doc.contents() : null;
  modeTool[ws.active.mode] = editor.toolName;
  editor.clearSelection();
  editor.lastEdited = null;
  editor.cropping = null;
  doc.swap(e.saved);
  document.body.classList.remove('floating-drawing');
  $('#structure-bar').hidden = true;
  const sheet = ws.active.mode === 'sheet';
  const words = ws.active.mode === 'document';
  editor.paused = sheet || words;
  showSheetParts();
  refreshKeys();
  if (sheet) $('#hint').textContent = SHEET_HINT;
  if (words) $('#hint').textContent = DOC_HINT;
  e.done(result);
  if (!result && sheet) sheetMode.focus();
  if (!result && words) docMode.focus();
}

$('#structure-done').addEventListener('click', () => finishCellStructure(true));
$('#structure-cancel').addEventListener('click', () => finishCellStructure(false));
// clicking the sheet or pages behind the drawing finishes it (as Done)
for (const pane of ['#sheet-pane', '#doc-pane']) {
  $(pane).addEventListener('pointerdown', (e) => {
    if (!cellEdit) return;
    e.preventDefault();
    e.stopPropagation();
    finishCellStructure(true);
  }, true);
}
window.addEventListener('keydown', (e) => {
  // Ctrl+Enter: Done
  if (cellEdit && e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !isTyping(e.target)) {
    e.preventDefault();
    e.stopPropagation();
    finishCellStructure(true);
  }
}, true);
// keys while a sheet shows but the grid doesn't have the focus (after clicking a tab or a menu)
window.addEventListener('keydown', (e) => {
  if (!sheetActive() || e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (isTyping(t) || t?.closest?.('dialog, .menu, .menu-wrap, #sheet-pane, select')) return;
  if (sheetKey(e)) { e.preventDefault(); return; }
  if (!t || t === document.body) sheetMode.focus();
});

/** Menu commands that work differently while a sheet shows. */
const SHEET_COMMANDS: Record<string, () => unknown> = {
  cut: () => sheetMode.copy(true),
  copy: () => sheetMode.copy(),
  paste: () => sheetMode.paste(null),
  'select-all': () => sheetMode.selectAll(),
  'copy-smiles': async () => {
    if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
    const smiles = await sheetMode.copySmiles();
    if (!smiles) { flash('Select cells with structures in them to copy their SMILES.'); return; }
    const n = smiles.split('\n').length;
    await copyText(smiles, n > 1 ? `Copied ${n} SMILES, one per line.` : 'Copied SMILES: ' + smiles);
  },
  'paste-smiles': async () => {
    let text = '';
    try {
      text = (await readClipboardText()).trim();
    } catch (err) {
      flash('Could not read the clipboard: ' + String(err));
      return;
    }
    if (!text) { flash('The clipboard has no text on it.'); return; }
    await sheetMode.structureFromText(text);
  },
  'copy-mol': () => {
    const d = activeStructureDoc();
    if (!d) { flash('Select a cell with a structure in it.'); return; }
    return copyText(toMolfile(d, d.atoms.keys()).molblock, 'Copied as molfile text.');
  },
  'copy-cdxml': () => {
    const d = activeStructureDoc();
    if (!d) { flash('Select a cell with a structure in it.'); return; }
    return copyText(writeCdxml(d, { name: 'Clipboard.cdxml', textMeasure: measureText }), 'Copied as CDXML text.');
  },
  'name-to-structure': () => sheetMode.run('structure-from-name'),
  'zoom-in': () => sheetMode.view.setZoom(sheetMode.view.zoom * 1.25),
  'zoom-out': () => sheetMode.view.setZoom(sheetMode.view.zoom * 0.8),
  'zoom-fit': () => sheetMode.view.setZoom(1),
  'zoom-actual': () => sheetMode.view.setZoom(1),
};

// ---------------------------------------------------------------- documents: pages of text with structures in them

const DOC_HINT = 'Type on the page. Insert > Structure draws a structure in the text (double-click it to change it); References > Insert Caption numbers figures and schemes. The panel on the right sets the paragraph, its style, the page and the page numbers.';

/** True when a document is showing (and no structure is being drawn for it). */
function docActive(): boolean {
  return ws.active.mode === 'document' && !cellEdit;
}

/** The style structures in the document showing are drawn in. */
const docStyle = (): DocStyle => ws.active.document?.t.drawingStyle ?? ACS_1996;

const docMode = new DocumentMode({
  flash,
  key: (e) => docKey(e),
  command: (name) => command(name),
  changed: () => ws.noteChange(),
  editDrawing: (contents, title, done) => editCellStructure(contents, title, done, docStyle()),
  copyDrawing: async (contents, style) => (await copyDrawing(structureDoc(contents, style), null)).replace(/^Copied the whole drawing/, 'Copied the structure'),
  readPaste: (e) => readDocPaste(e),
  toStructure: (text, style) => textToStructure(text, style),
  pickPicture: () => pickPicture(),
  newTable: (rows, cols, style) => tableDrawing(emptyTable(rows, cols, style.captionSize), style),
  measure: measureText,
});
// documents measure fonts they have no published widths for on the screen
setScreenMeasure(measureText);
void document.fonts?.ready.then(() => docMode.fontsChanged());

/** A table as a drawing (for a document): one table shape at its laid-out size. */
function tableDrawing(t: TableData, style: DocStyle): Contents {
  const lay = layoutTable(t, style.captionSize, textMeasure);
  return { atoms: [], bonds: [], captions: [], arrows: [], shapes: [{ id: 1, kind: 'table', x1: 0, y1: 0, x2: lay.width, y2: lay.height, table: t }] };
}

/** A key the document's text doesn't use: the menu keys that use Ctrl, Alt or a function key. */
function docKey(e: KeyboardEvent): boolean {
  const chord = chordOf(e);
  if (!chord) return false;
  // Alt+← and Alt+→ would go back and forward in a browser, leaving the page
  if (chord === 'Alt+ArrowLeft' || chord === 'Alt+ArrowRight') return true;
  if (!/^(Ctrl|Alt)\+|^(Shift\+)?F\d+$/.test(chord)) return false;
  for (const ctx of ['document', 'command'] as KeyContext[]) {
    const action = keymap.lookup(ctx, chord);
    if (!action) continue;
    const { verb, arg } = parseAction(action);
    if (verb !== 'command') continue;
    // the text field copies, cuts and pastes itself
    if (arg === 'copy' || arg === 'cut' || arg === 'paste') return false;
    if (command(arg)) return true;
  }
  return false;
}

/** What's on the clipboard for a paste into a document: a drawing (from here or ChemDraw), text, or a picture. */
async function readDocPaste(e: ClipboardEvent | null): Promise<DocPaste> {
  const dec = (b: Uint8Array) => new TextDecoder().decode(b).replace(/\0+$/, '');
  const drawingOf = (d: Doc): Contents => { fitPasted(d, docStyle()); return d.contents(); };
  if (nativeClipboard) {
    const drawing = await nativeFirst([OWN_FORMAT, CDX_FORMAT]);
    if (drawing) {
      const [name, data] = drawing;
      return { drawing: drawingOf(readCdxml(name === CDX_FORMAT ? cdxToCdxml(data) : dec(data)).doc) };
    }
    const t = await nativeFirst(['CF_UNICODETEXT']);
    const text = t ? dec(t[1]) : '';
    if (looksLikeCdxml(text)) return { drawing: drawingOf(readCdxml(text).doc) };
    const h = await nativeFirst(['HTML Format']);
    const html = h ? fromCfHtml(h[1]) : undefined;
    if (text || html) return { text, html };
    const p = await readNativeClipboard();
    return p.kind === 'picture' ? { picture: { bytes: p.bytes, mime: p.mime } } : {};
  }
  const text = e ? e.clipboardData?.getData('text/plain') ?? '' : await navigator.clipboard.readText().catch(() => '');
  if (looksLikeCdxml(text)) return { drawing: drawingOf(readCdxml(text).doc) };
  if (text) return { text };
  const p = e ? await readPasteEvent(e) : await readWebClipboard();
  if (p.kind === 'drawing') return { drawing: drawingOf(p.doc) };
  if (p.kind === 'picture') return { picture: { bytes: p.bytes, mime: p.mime } };
  return {};
}

/** The structure picked in the document, as a drawing (for Copy as SMILES, Molfile and CDXML). */
function pickedFigureDoc(): Doc | null {
  const f = ws.active.document;
  const id = docMode.pickedObject();
  const o = f && id !== null ? f.t.objects[id] : null;
  return o?.kind === 'drawing' ? structureDoc(o.contents, f!.t.drawingStyle) : null;
}

/** Menu commands that work differently while a document shows. */
const DOC_COMMANDS: Record<string, () => unknown> = {
  'copy-smiles': async () => {
    const d = pickedFigureDoc();
    if (!d) { flash('Click a structure first (it gets a blue frame), then Copy as SMILES.'); return; }
    if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
    const { molblock } = toMolfile(d, d.atoms.keys());
    const smiles = await chem.molToSmiles(molblock).catch(() => '');
    if (!smiles) { flash('Could not make SMILES for this drawing.'); return; }
    await copyText(smiles, 'Copied SMILES: ' + smiles);
  },
  'copy-mol': () => {
    const d = pickedFigureDoc();
    if (!d) { flash('Click a structure first, then Copy as Molfile Text.'); return; }
    return copyText(toMolfile(d, d.atoms.keys()).molblock, 'Copied as molfile text.');
  },
  'copy-cdxml': () => {
    const d = pickedFigureDoc();
    if (!d) { flash('Click a structure first, then Copy as CDXML Text.'); return; }
    return copyText(writeCdxml(d, { name: 'Clipboard.cdxml', textMeasure: measureText }), 'Copied as CDXML text.');
  },
  'paste-smiles': async () => {
    let text = '';
    try {
      text = (await readClipboardText()).trim();
    } catch (err) {
      flash('Could not read the clipboard: ' + String(err));
      return;
    }
    if (!text) { flash('The clipboard has no text on it.'); return; }
    const r = await textToStructure(text, docStyle());
    if ('error' in r) { flash(r.error, 8000); return; }
    docMode.insertObject({ kind: 'drawing', contents: r.contents }, 'Paste SMILES');
  },
  'name-to-structure': () => docMode.run('structure-from-name-doc'),
};

/** Menu commands from the drawing's list that also work while a document shows. */
const DOC_ANY = new Set(['export-pdf']);

// keys while a document shows but its text doesn't have the focus (after clicking a tab or a menu)
window.addEventListener('keydown', (e) => {
  if (!docActive() || e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (isTyping(t) || t?.closest?.('dialog, .menu, .menu-wrap, select, aside, .ribbon')) return;
  if (docKey(e)) { e.preventDefault(); return; }
  if (!t || t === document.body) docMode.focus();
});

/** Menu commands that work the same whatever shows. */
const ANY_TAB = new Set(['new', 'new-slides', 'new-sheet', 'new-document', 'open', 'save', 'save-as', 'close-tab', 'next-tab', 'prev-tab', 'undo', 'redo',
  'hotkeys', 'typing-spelling', 'mode-colours', 'dev-tools', 'clipboard-formats']);

/** Run a menu command in the way that suits the tab showing. False when it doesn't apply there. */
function command(name: string): boolean {
  if (sheetActive()) {
    const own = SHEET_COMMANDS[name];
    if (own) return own() !== false;
    if (sheetMode.run(name)) return true;
    if (!ANY_TAB.has(name)) return false;
  }
  if (docActive()) {
    const own = DOC_COMMANDS[name];
    if (own) return own() !== false;
    if (!ANY_TAB.has(name) && docMode.run(name)) return true;
    if (!ANY_TAB.has(name) && !DOC_ANY.has(name)) return false;
  }
  const run = COMMANDS[name];
  return !!run && run() !== false;
}

const COMMANDS: Record<string, () => unknown> = {
  new: () => { finishTyping(); ws.newDrawing(); },
  'new-slides': () => { finishTyping(); ws.newSlides(); },
  'new-sheet': () => { finishTyping(); ws.newSheet(); },
  'new-document': () => { finishTyping(); ws.newDocument(); },
  open: () => ws.open(),
  save: () => { finishTyping(); return ws.save(); },
  'save-as': () => { finishTyping(); return ws.saveAs(); },
  'close-tab': () => { finishTyping(); return ws.close(); },
  'next-tab': () => ws.cycle(1),
  'prev-tab': () => ws.cycle(-1),
  'export-mol': () => exportMolfile(),
  'export-pdf': () => { finishTyping(); return exportPdf(); },
  undo: () => undo(),
  redo: () => redo(),
  'insert-picture': () => insertPicture(),
  'insert-table': () => { void insertTable(); },
  crop: () => cropPicture(),
  'text-box': () => { editor.setTool('text'); flash('Click to type, or drag across to make a text box that wraps.'); },
  'new-slide': () => newSlide(),
  'duplicate-slide': () => { const d = deckNow(); if (d) { finishTyping(); d.duplicate(slideList.pickedList()); } },
  'delete-slide': () => removeSlides(slideList.pickedList()),
  'next-slide': () => { const d = deckNow(); if (!d) return false; goSlide(d.index + 1); },
  'prev-slide': () => { const d = deckNow(); if (!d) return false; goSlide(d.index - 1); },
  ...Object.fromEntries(LAYOUTS.map((l) => [`layout-${l.id}`, () => setLayout(l.id)])),
  'size-wide': () => setSlideSize(WIDE),
  'size-standard': () => setSlideSize(STANDARD),
  'slide-master': () => slideMaster(),
  present: () => present(false),
  'present-current': () => present(true),
  cut: () => cut(),
  copy: () => copy(),
  paste: () => paste(),
  'copy-smiles': () => copySmiles(),
  'paste-smiles': () => pasteSmiles(),
  'copy-mol': () => copyMolfile(),
  'copy-cdxml': () => copyCdxmlText(),
  'select-all': () => editor.selectAll(),
  'next-structure': () => editor.selectNextStructure(1),
  'prev-structure': () => editor.selectNextStructure(-1),
  // arrow keys move the selection; with nothing selected they do nothing here
  'nudge-left': () => editor.nudge(-1, 0),
  'nudge-right': () => editor.nudge(1, 0),
  'nudge-up': () => editor.nudge(0, -1),
  'nudge-down': () => editor.nudge(0, 1),
  'nudge-far-left': () => editor.nudge(-10, 0),
  'nudge-far-right': () => editor.nudge(10, 0),
  'nudge-far-up': () => editor.nudge(0, -10),
  'nudge-far-down': () => editor.nudge(0, 10),
  'align-left': () => align('left'),
  'align-hcenter': () => align('hcenter'),
  'align-right': () => align('right'),
  'align-top': () => align('top'),
  'align-vcenter': () => align('vcenter'),
  'align-bottom': () => align('bottom'),
  'distribute-h': () => editor.distribute('h') || flash('Select three or more structures, captions, arrows or shapes to space them evenly.'),
  'distribute-v': () => editor.distribute('v') || flash('Select three or more structures, captions, arrows or shapes to space them evenly.'),
  'flip-h': () => editor.flip('h') || flash('Select something to flip.'),
  'flip-v': () => editor.flip('v') || flash('Select something to flip.'),
  'rotate-cw': () => editor.rotateBy(90) || flash('Select something to rotate.'),
  'rotate-ccw': () => editor.rotateBy(-90) || flash('Select something to rotate.'),
  'rotate-180': () => editor.rotateBy(180) || flash('Select something to rotate.'),
  // Alt+arrows turn the selection (and must never reach the browser, where Alt+← goes back)
  'turn-ccw-1': () => { editor.rotateBy(-1); },
  'turn-cw-1': () => { editor.rotateBy(1); },
  'turn-ccw-15': () => { editor.rotateBy(-15); },
  'turn-cw-15': () => { editor.rotateBy(15); },
  'rotate-dialog': () => rotateDialog(),
  scale: () => scaleDialog(),
  'reaction-right': () => reactionStep('right'),
  'reaction-left': () => reactionStep('left'),
  'reaction-down': () => reactionStep('down'),
  'reaction-up': () => reactionStep('up'),
  join: () => editor.join() || flash('Select two atoms, or two bonds, to join them into one.'),
  'fixed-length': () => toggleOption('fixedLength'),
  'fixed-angles': () => toggleOption('fixedAngles'),
  'dev-tools': () => { showDevTools(!devTools); storeSettings(); },
  'zoom-in': () => editor.zoomBy(1.25),
  'zoom-out': () => editor.zoomBy(0.8),
  'zoom-fit': () => editor.fit(),
  // 100%: a point on the page is a point on the screen (96 pixels to the inch)
  'zoom-actual': () => editor.zoomTo(96 / 72),
  hotkeys: () => hotkeysDialog.open(),
  'typing-spelling': () => typingDialog.open(),
  'mode-colours': () => modeDialog.open(),
  'clean-up': () => editor.cleanUp() || flash('Nothing to clean up: the structures are already tidy.'),
  'clean-up-reaction': () => editor.cleanUpReaction() || flash('No reaction to tidy: draw starting materials, an arrow and products (the arrow pointing from one to the other), or the scheme is already tidy.', 6000),
  'show-roles': () => { editor.showRoles = !editor.showRoles; $('[data-cmd="show-roles"]')?.setAttribute('aria-checked', String(editor.showRoles)); editor.requestScene(); storeSettings(); },
  'check-structure': () => checkStructure(),
  'stereo-labels': () => toggleStereoLabels(),
  'name-to-structure': () => nameToStructure(),
  'clipboard-formats': async () => {
    const names = await clipboardFormats().catch((err) => [String(err)]);
    flash(names.length ? 'On the clipboard: ' + names.join(', ') : 'The clipboard is empty.', 15000);
  },
};

// The menus: click a name to open its menu; with one open, pointing at another name opens that.
const menus = [...document.querySelectorAll<HTMLDivElement>('.menu-wrap')].map((w) => ({
  btn: w.querySelector<HTMLButtonElement>(':scope > button')!,
  list: w.querySelector<HTMLDivElement>('.menu')!,
}));
type Menu = (typeof menus)[number];
let openMenu: Menu | null = null;
function showMenu(m: Menu | null, focus = true): void {
  openMenu = m;
  for (const x of menus) {
    x.list.hidden = x !== m;
    x.btn.setAttribute('aria-expanded', String(x === m));
  }
  if (m && focus) m.list.querySelector<HTMLButtonElement>('button:not([hidden])')?.focus();
}
for (const m of menus) {
  m.btn.addEventListener('click', () => showMenu(openMenu === m ? null : m));
  m.btn.addEventListener('pointerenter', () => { if (openMenu && openMenu !== m) showMenu(m, false); });
  m.list.addEventListener('click', (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.cmd;
    if (!cmd) return;
    showMenu(null);
    command(cmd);
  });
  m.list.addEventListener('keydown', (e) => {
    const items = [...m.list.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    const j = menus.indexOf(m);
    if (e.key === 'Escape') { showMenu(null); m.btn.focus(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      showMenu(menus[(j + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length]);
    }
  });
}
document.addEventListener('pointerdown', (e) => {
  if (openMenu && !(e.target as HTMLElement).closest('.menu-wrap')) showMenu(null);
});
// listing the clipboard's formats needs the Windows app
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-cmd="clipboard-formats"]')) b.hidden = !nativeClipboard;

// Keys for menu commands come through the drawing's key handler (from the key map); these are
// the special cases where the key should do its usual job instead.
editor.runCommand = (name) => {
  // with text on the page selected, Ctrl+C and Ctrl+X copy that text
  if ((name === 'copy' || name === 'cut') && textSelected()) return false;
  // in a browser, Ctrl+V goes on to the paste event, which can read the clipboard
  if (name === 'paste' && !nativeClipboard) return false;
  return command(name);
};

// ---------------------------------------------------------------- settings and the Hotkeys window

let settingsLoaded = false;
/** Save the key map and preferences (after the saved ones have been read, so they aren't lost). */
function storeSettings(): void {
  if (!settingsLoaded) return;
  const s: Settings = {
    hotkeys: keymap.overrides(),
    keepHotspotOnBond: editor.options.keepHotspotOnBond,
    fixedLength: editor.options.fixedLength,
    fixedAngles: editor.options.fixedAngles,
    devTools,
    showRoles: editor.showRoles,
    chemTyping: typingPrefs.chemistry,
    spellCheck: typingPrefs.spelling,
    replacements: typingPrefs.replacements,
    dictionary: typingPrefs.dictionary,
    modeColours,
  };
  saveSettings(s, (msg) => flash(msg, 10000));
}

/** The key for a menu command as things are now (in Slides mode PowerPoint's keys come first, in sheets Excel's). */
function commandKey(cmd: string): string | undefined {
  const first: KeyContext | null = sheetActive() ? 'sheet' : docActive() ? 'document' : editor.slideKeys ? 'slides' : null;
  const own = first ? keysOf(first, `command ${cmd}`)[0] : undefined;
  if (own) return own;
  // a key the slides or sheets use for something else does not do this command while they show
  const k = keymap.keysFor('command', `command ${cmd}`).find((c) => !first || !keymap.lookup(first, c));
  return k ? displayChord(k, isMac) : undefined;
}

/** Show the current keys in the menus and tool tips, and tick the options that are on. */
function refreshKeys(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.menu button[data-cmd], .ribbon button[data-cmd], .ribbon button[data-sh], .ribbon button[data-doc]')) {
    const k = commandKey((b.dataset.cmd ?? b.dataset.sh ?? b.dataset.doc)!);
    if (b.closest('.ribbon')) {
      const base = b.dataset.tip ?? (b.dataset.tip = b.title);
      b.title = k ? `${base} (${k})` : base;
      continue;
    }
    let kbd = b.querySelector('kbd');
    if (!k) { kbd?.remove(); continue; }
    if (!kbd) { kbd = document.createElement('kbd'); b.append(kbd); }
    kbd.textContent = k;
  }
  for (const [cmd, on] of [['fixed-length', editor.options.fixedLength], ['fixed-angles', editor.options.fixedAngles]] as const) {
    $(`[data-cmd="${cmd}"]`)?.setAttribute('aria-checked', String(on));
  }
  const tip = (id: string, text: string, cmd: string) => {
    const k = commandKey(cmd);
    $(id).title = k ? `${text} (${k})` : text;
  };
  tip('#btn-undo', 'Undo', 'undo');
  tip('#btn-redo', 'Redo', 'redo');
  tip('#btn-fit', 'Fit drawing to window', 'zoom-fit');
  toolbar.refreshTitles();
}

keymap.onChange(() => { refreshKeys(); storeSettings(); });
onTypingPrefs(() => { storeSettings(); editor.requestOverlay(); });

const modeDialog = new ModeColoursDialog({
  get: () => modeColours,
  set(c) {
    modeColours = c;
    applyModeColours(ws.active.mode, modeColours);
    storeSettings();
  },
});

const typingDialog = new TypingDialog({
  get: () => ({ ...typingPrefs }),
  set: (v) => setTypingPrefs(v),
  location: settingsLocation,
});

const hotkeysDialog = new HotkeysDialog({
  mac: isMac,
  location: settingsLocation,
  keepHotspot: {
    get: () => editor.options.keepHotspotOnBond,
    set: (v) => { editor.options.keepHotspotOnBond = v; storeSettings(); },
  },
  exportKeys: async () => {
    const target = await saveFileDialog('Chem Illustrator hotkeys.json', KEYMAP_FILE).catch((e) => { hotkeysDialog.say(String(e)); return null; });
    if (!target) return;
    const text = JSON.stringify({ app: 'Chem Illustrator', kind: 'hotkeys', version: 1, hotkeys: keymap.overrides() }, null, 2) + '\n';
    await writeFile(target.ref, target.name, text, KEYMAP_FILE).then(
      () => hotkeysDialog.say(`Saved your keys in ${target.name}. Import it on another computer to use them there.`),
      (e) => hotkeysDialog.say(`Could not save the keys: ${e}`),
    );
  },
  importKeys: async () => {
    const got = await openFileDialog([KEYMAP_FILE]).catch((e) => { hotkeysDialog.say(String(e)); return null; });
    if (!got) return;
    let raw: { hotkeys?: KeyOverrides } | null = null;
    try { raw = JSON.parse(got.text); } catch { /* reported below */ }
    if (!raw || typeof raw !== 'object' || !raw.hotkeys || typeof raw.hotkeys !== 'object') {
      hotkeysDialog.say(`${got.name} isn't a hotkeys file (use one saved with Export).`);
      return;
    }
    keymap.setOverrides(raw.hotkeys);
    hotkeysDialog.say(`Using the keys from ${got.name}.`);
  },
});

void loadSettings().then((s) => {
  editor.options.keepHotspotOnBond = s.keepHotspotOnBond;
  editor.options.fixedLength = s.fixedLength;
  editor.options.fixedAngles = s.fixedAngles;
  editor.showRoles = s.showRoles;
  $('[data-cmd="show-roles"]')?.setAttribute('aria-checked', String(s.showRoles));
  showDevTools(s.devTools);
  modeColours = s.modeColours;
  applyModeColours(ws.active.mode, modeColours);
  keymap.setOverrides(s.hotkeys);
  setTypingPrefs({ chemistry: s.chemTyping, spelling: s.spellCheck, replacements: s.replacements, dictionary: s.dictionary });
  settingsLoaded = true;
  refreshKeys();
});
refreshKeys();

// The Help window lists the most used keys as they are now (they can be changed).
const HELP_KEYS: Record<'atom' | 'bond' | 'space', string[]> = {
  atom: ['atom bond', 'atom ring-bond', 'atom carbonyl', 'atom phenyl', 'atom wedge', 'atom hash-wedge', 'atom cyclohexyl',
    'atom cyclopentyl', 'atom methylidene', 'atom dimethyl', 'atom alkyne', 'atom sulfonyl', 'label O', 'label N', 'label S',
    'label Cl', 'label Me', 'label OMe', 'label Ph', 'label Boc', 'atom plus', 'atom minus', 'atom number', 'atom attach',
    'atom nickname', 'atom edit-label', 'atom clear'],
  bond: ['bond single', 'bond double', 'bond triple', 'bond wedge', 'bond hash-wedge', 'bond bold', 'bond dashed', 'bond wavy',
    'bond left', 'bond center', 'bond right', 'fuse benzene', 'fuse 6', 'fuse 5', 'fuse chair'],
  space: ['tool select', 'tool bond-single', 'tool chain', 'tool ring-benzene', 'tool text', 'tool arrow'],
};

function openHelp(): void {
  for (const ctx of ['atom', 'bond', 'space'] as const) {
    const ul = $(`#help-${ctx}`);
    ul.replaceChildren(...HELP_KEYS[ctx].flatMap((action) => {
      const keys = keysOf(ctx, action);
      if (!keys.length) return [];
      const li = document.createElement('li');
      for (const k of keys.slice(0, 2)) {
        const kbd = document.createElement('kbd');
        kbd.textContent = k;
        li.append(kbd, ' ');
      }
      li.append(actionName(action));
      return [li];
    }));
  }
  for (const el of document.querySelectorAll<HTMLElement>('#help [data-cmd-key]')) {
    el.textContent = keysOf('command', `command ${el.dataset.cmdKey}`)[0] ?? '(no key)';
  }
  $<HTMLDialogElement>('#help').showModal();
}

const nicknames = new NicknameChooser();
editor.onNickname = (atomId) => nicknames.open((name) => editor.runAction(`label ${name}`, { kind: 'atom', id: atomId }));
// / or ? on an atom or bond: select it and show its settings in the Style panel
editor.onProperties = () => {
  // after the panel has caught up with the new selection
  setTimeout(() => {
    const sec = $('#style-section');
    if (sec.hidden) return;
    sec.scrollIntoView({ block: 'nearest' });
    sec.querySelector<HTMLElement>('input, select, button')?.focus();
  }, 60);
};

// Unsaved work: ask before the window closes.
if (isTauri()) {
  getCurrentWindow().onCloseRequested(async (e) => {
    finishTyping();
    if (!(await ws.closeAll())) e.preventDefault();
  }).catch(() => {});
} else {
  window.addEventListener('beforeunload', (e) => { finishTyping(); if (ws.anyDirty) e.preventDefault(); });
}

/** For the speed tests: a ChemDraw file's text into the drawing showing, timed. */
function openText(text: string, name: string): ReadStats | null {
  const t0 = performance.now();
  try {
    const { doc: loaded, stats } = readCdxml(text);
    doc.loadFrom(loaded);
    editor.clearSelection();
    editor.lastEdited = null;
    editor.fit();
    editor.frame(true);
    const total = performance.now() - t0;
    lastStats = stats;
    lastOpen = `${name}: opened and drawn in ${total.toFixed(0)} ms (read ${stats.parseMs.toFixed(0)} ms, build ${stats.buildMs.toFixed(0)} ms, first paint ${renderer.lastSceneMs.toFixed(0)} ms)`;
    const sk = Object.entries(stats.skipped).map(([k, v]) => `${v} ${k}`).join(', ');
    flash(`Opened ${name}: ${stats.atoms} atoms, ${stats.bonds} bonds, ${stats.captions} captions, ${stats.arrows} arrows${sk ? `. Not shown yet: ${sk}` : ''}`);
    (window as any).__lastOpenMs = total;
    updatePanels();
    return stats;
  } catch (err) {
    flash('Could not open ' + name + ': ' + String(err));
    return null;
  }
}

// ---------------------------------------------------------------- stress test

/** Draw n drug-sized molecules with the same tools a person would use. */
function stressTest(n: number): void {
  const t0 = performance.now();
  const L = doc.style.bondLength;
  const cols = Math.ceil(Math.sqrt(n));
  doc.edit('Stress test', () => {
    for (let i = 0; i < n; i++) {
      const cx = (i % cols) * L * 9, cy = Math.floor(i / cols) * L * 7;
      const ring = placeRing(doc, freeRing({ x: cx, y: cy }, 6, L), { aromatic: true });
      const p = doc.atoms.get(ring[1])!, q = doc.atoms.get(ring[2])!;
      const ring2 = placeRing(doc, fusedRing(p, q, 6, -1), { existing: [p.id, q.id] });
      const n1 = doc.atoms.get(ring2[3])!;
      doc.updateAtom(n1.id, { z: 7 });
      const c1 = sprout(doc, n1.id);
      const c2 = sprout(doc, c1.id, 2, 'solid', 8);
      void c2;
      const c3 = sprout(doc, c1.id);
      const o = sprout(doc, c3.id, 1, 'wedge');
      doc.updateAtom(o.id, { label: 'OMe' });
      const top = doc.atoms.get(ring[4])!;
      const s1 = sprout(doc, top.id);
      doc.updateAtom(s1.id, { label: 'CO2Et' });
      const r5 = doc.atoms.get(ring2[4])!;
      placeRing(doc, ringOnAtom(r5, sproutDir(doc, r5.id), 5, L), { existing: [r5.id] });
      const f = sprout(doc, ring[5]);
      doc.updateAtom(f.id, { z: 9 });
    }
  });
  const built = performance.now() - t0;
  editor.fit();
  editor.frame(true);
  lastOpen = `Stress test: built ${n} molecules (${doc.atoms.size} atoms) in ${built.toFixed(0)} ms, first paint ${renderer.lastSceneMs.toFixed(0)} ms`;
  updatePanels();
}

// ---------------------------------------------------------------- analysis (background chemistry)

let analysisTimer = 0;
let analysisSeq = 0;
let analysisKey = '';

function scheduleAnalysis(force = false): void {
  clearTimeout(analysisTimer);
  analysisTimer = window.setTimeout(() => runAnalysis(force), 30);
}

async function runAnalysis(force: boolean): Promise<void> {
  if (!chem.ready) return;
  // Analyse the selected structures, or else the one last drawn on.
  let roots: number[] = [];
  if (editor.sel.atoms.size) roots = [...editor.sel.atoms];
  else if (editor.lastEdited !== null && doc.atoms.has(editor.lastEdited)) roots = [editor.lastEdited];
  const frags: Set<number>[] = [];
  const seen = new Set<number>();
  for (const r of roots) {
    if (seen.has(r)) continue;
    const f = doc.fragmentOf(r);
    for (const x of f) seen.add(x);
    frags.push(editor.sel.atoms.size ? new Set([...f].filter((x) => editor.sel.atoms.has(x))) : f);
    if (frags.length >= 12) break;
  }
  const key = doc.version + ':' + live.version + ':' + frags.map((f) => [...f].join(',')).join('|');
  if (!force && key === analysisKey) return;
  analysisKey = key;
  const panel = $('#analysis-body');
  if (!frags.length) {
    panel.innerHTML = '<p class="muted">Select a structure, or draw one, to see its formula and masses.</p>';
    return;
  }
  const seq = ++analysisSeq;
  const t0 = performance.now();
  const exports = frags.map((f) => toMolfile(doc, f));
  const res = await chem.analyze(exports.map((e) => ({ molblock: e.molblock, map: e.map }))).catch((e) => { panel.textContent = String(e); return null; });
  if (!res || seq !== analysisSeq) return;
  const roundTrip = performance.now() - t0;
  chemTimes.push(roundTrip);
  if (chemTimes.length > 50) chemTimes.shift();
  const H = 1.00727646688, NA = 22.98922070;
  panel.innerHTML = res.results.map((r, i) => {
    if (r.error) return `<div class="frag"><p class="warn">${escapeHtml(r.error)}</p></div>`;
    const unk = exports[i].unknownLabels;
    const stereo = stereoSummary(frags[i]);
    return `<div class="frag">
      <div class="formula">${formatFormula(r.formula)}</div>
      <table>
        <tr><th>Exact mass</th><td>${r.exact.toFixed(4)}</td></tr>
        <tr><th>Mol. wt.</th><td>${r.mw.toFixed(2)}</td></tr>
        ${r.charge === 0 ? `<tr><th>[M+H]<sup>+</sup></th><td>${(r.exact + H).toFixed(4)}</td></tr><tr><th>[M+Na]<sup>+</sup></th><td>${(r.exact + NA).toFixed(4)}</td></tr>` : ''}
        ${stereo ? `<tr><th>Stereo</th><td>${escapeHtml(stereo)}</td></tr>` : ''}
      </table>
      <div class="smiles" title="SMILES">${escapeHtml(r.smiles)}</div>
      ${unk.length ? `<p class="warn">Not understood (left out): ${unk.map(escapeHtml).join(', ')}</p>` : ''}
    </div>`;
  }).join('');
  updatePanels();
}

/**
 * Structure > Show Stereo Labels: shows the R/S and E/Z labels of the selected structures (or of
 * all of them) as part of the drawing, or hides them when they are all showing already.
 */
function toggleStereoLabels(): void {
  const s = editor.sel;
  const roots = s.atoms.size || s.bonds.size ? [...s.atoms, ...[...s.bonds].map((id) => doc.bonds.get(id)?.a1 ?? -1)] : [...doc.atoms.keys()];
  const atoms = new Set<number>();
  for (const r of roots) if (doc.atoms.has(r) && !atoms.has(r)) for (const id of doc.fragmentOf(r)) atoms.add(id);
  const bonds = new Set<number>();
  for (const id of atoms) for (const bid of doc.adj.get(id) ?? []) bonds.add(bid);
  const labelled = [...atoms].filter((id) => live.atom(id)).map((id) => doc.atoms.get(id)!);
  const labelledB = [...bonds].filter((id) => live.bond(id)).map((id) => doc.bonds.get(id)!);
  if (!labelled.length && !labelledB.length) {
    flash(chem.ready ? 'No stereocentres or E/Z double bonds here.' : 'The chemistry engine is still loading.');
    return;
  }
  const show = ![...labelled, ...labelledB].every((x) => x.showStereo || x.stereoLabel);
  doc.edit(show ? 'Show stereo labels' : 'Hide stereo labels', () => setStereoShown(doc, atoms, bonds, show));
  editor.changed();
  const n = labelled.length + labelledB.length;
  flash(show ? `Showing ${n} stereo label${n === 1 ? '' : 's'}.` : `Hid ${n} stereo label${n === 1 ? '' : 's'}.`);
}

/** The R/S and E/Z labels of a structure in reading order, e.g. "R, S; E". */
function stereoSummary(frag: Set<number>): string {
  const byPlace = (p: { x: number; y: number }, q: { x: number; y: number }) => p.y - q.y || p.x - q.x;
  // the drawing may have changed while the analysis ran: skip atoms that have gone
  const centres = [...frag].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a && !!live.atom(a.id)).sort(byPlace).map((a) => live.atom(a.id)!);
  const dbl: { x: number; y: number; l: string }[] = [];
  for (const id of frag) for (const bid of doc.adj.get(id) ?? []) {
    const b = doc.bonds.get(bid);
    const l = b && b.a1 === id ? live.bond(bid) : null;
    if (b && l) { const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!; dbl.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, l }); }
  }
  dbl.sort(byPlace);
  return [centres.join(', '), dbl.map((d) => d.l).join(', ')].filter(Boolean).join('; ');
}

function formatFormula(f: string): string {
  return escapeHtml(f).replace(/(\d+)(?=[+−]$)/, '<sup>$1</sup>').replace(/([A-Za-z])(\d+)/g, '$1<sub>$2</sub>').replace(/([+−])$/, '<sup>$1</sup>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
}

// ---------------------------------------------------------------- chemistry warnings

const warnBox = $<HTMLInputElement>('#show-warnings');
warnBox.addEventListener('change', () => {
  renderer.showWarnings = warnBox.checked;
  renderer.repaintAll();
  editor.requestScene();
});
const warnTip = $<HTMLDivElement>('#warn-tip');
let warnKey = '';

/** The Warnings panel and the tip shown when pointing at a problem. Runs after each paint. */
function updateWarnings(): void {
  // tip for the atom or bond under the pointer
  const h = editor.hover;
  let tip: string[] | undefined;
  let at: { x: number; y: number } | null = null;
  if (h?.kind === 'atom') {
    const a = doc.atoms.get(h.id);
    if (a) { tip = checks.forAtom(a); at = a; }
  } else if (h?.kind === 'bond') {
    const b = doc.bonds.get(h.id);
    if (b) {
      tip = checks.forBond(b);
      const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
      at = { x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 };
    }
  }
  if (tip && at && renderer.showWarnings) {
    const s = renderer.toScreen(at);
    warnTip.textContent = tip.join(' ');
    warnTip.hidden = false;
    const w = warnTip.offsetWidth, ht = warnTip.offsetHeight;
    warnTip.style.left = `${Math.max(4, Math.min(renderer.width - w - 4, s.x + 14))}px`;
    warnTip.style.top = `${s.y + 16 + ht > renderer.height ? s.y - 16 - ht : s.y + 16}px`;
  } else warnTip.hidden = true;

  // the list, redone only when the warnings or the drawing changed
  const key = checks.version + ':' + doc.version;
  if (key === warnKey) return;
  warnKey = key;
  const list = checks.list();
  const ignored = checks.ignoredCount();
  $('#warnings-count').textContent = list.length ? String(list.length) : '';
  const MAX = 100;
  const rows = list.slice(0, MAX).map((w, i) =>
    `<li><button class="w-text" data-i="${i}" title="Show it on the drawing">${escapeHtml(w.text.join(' '))}</button>` +
    `<button class="w-ignore" data-i="${i}" title="Stop flagging this one (saved with the file)">Ignore</button></li>`).join('');
  $('#warnings-body').innerHTML =
    (list.length ? `<ul class="warn-list">${rows}</ul>${list.length > MAX ? `<p class="muted small">and ${list.length - MAX} more</p>` : ''}` : '<p class="muted">No problems found.</p>') +
    (ignored ? `<p class="muted small">${ignored} ignored. <button id="w-unignore">Show them again</button></p>` : '');
  const items = list.slice(0, MAX);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#warnings-body .w-text')) {
    b.addEventListener('click', () => { const w = items[Number(b.dataset.i)]; editor.reveal(w.kind, w.id); });
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('#warnings-body .w-ignore')) {
    b.addEventListener('click', () => {
      const w = items[Number(b.dataset.i)];
      doc.edit('Ignore warning', () => {
        if (w.kind === 'atom') doc.updateAtom(w.id, { ignoreWarnings: true });
        else doc.updateBond(w.id, { ignoreWarnings: true });
      });
      editor.changed();
    });
  }
  $('#w-unignore')?.addEventListener('click', () => {
    doc.edit('Show ignored warnings', () => {
      for (const id of checks.atoms.keys()) if (doc.atoms.get(id)?.ignoreWarnings) doc.updateAtom(id, { ignoreWarnings: false });
      for (const id of checks.bonds.keys()) if (doc.bonds.get(id)?.ignoreWarnings) doc.updateBond(id, { ignoreWarnings: false });
    });
    editor.changed();
  });
}

/** Structure > Check Structure: go to the next problem after the one selected. */
function checkStructure(): void {
  const list = checks.list();
  if (!list.length) {
    flash(checks.ignoredCount() ? 'No problems found (apart from the ones you chose to ignore).' : 'No problems found.');
    return;
  }
  const cur = list.findIndex((w) => (w.kind === 'atom' ? editor.sel.atoms : editor.sel.bonds).has(w.id));
  const w = list[(cur + 1) % list.length];
  editor.reveal(w.kind, w.id);
  flash(`${(cur + 1) % list.length + 1} of ${list.length}: ${w.text.join(' ')}`);
}

// ---------------------------------------------------------------- speed panel

const chemTimes: number[] = [];

function stat(xs: number[]): { last: number; med: number; p95: number } {
  if (!xs.length) return { last: 0, med: 0, p95: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { last: xs[xs.length - 1], med: s[Math.floor(s.length / 2)], p95: s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] };
}

let panelQueued = false;
function updatePanels(): void {
  if (panelQueued || !devTools) return;
  panelQueued = true;
  requestAnimationFrame(() => {
    panelQueued = false;
    const lat = stat(editor.latencies);
    const ch = stat(chemTimes);
    const ok = (v: number, lim: number) => `<span class="${v <= lim ? 'ok' : 'slow'}">${v.toFixed(1)}</span>`;
    $('#speed-body').innerHTML = `
      <table>
        <tr><th>Input → screen</th><td>${ok(lat.last, 16)} ms <span class="muted">(median ${lat.med.toFixed(1)}, 95% ${lat.p95.toFixed(1)})</span></td></tr>
        <tr><th>Full redraw</th><td>${ok(renderer.lastSceneMs, 16)} ms</td></tr>
        <tr><th>Chemistry</th><td>${chem.ready ? `${ok(ch.last, 50)} ms <span class="muted">(engine loaded in ${chem.loadMs.toFixed(0)} ms)</span>` : chem.error ? `<span class="slow">${escapeHtml(chem.error)}</span>` : 'loading…'}</td></tr>
        <tr><th>Drawing size</th><td>${doc.atoms.size.toLocaleString()} atoms, ${doc.bonds.size.toLocaleString()} bonds, ${doc.captions.size.toLocaleString()} captions</td></tr>
        <tr><th>Zoom</th><td>${Math.round((renderer.view.scale * 72 / 96) * 100)}%</td></tr>
      </table>
      ${lastOpen ? `<p class="muted small">${escapeHtml(lastOpen)}</p>` : ''}
      ${lastStats ? '' : ''}`;
  });
}

const stylePanel = new StylePanel($('#style-section'), $('#style-body'), doc, () => editor.sel, () => editor.changed());
stylePanel.applyLabel = (id, text) => editor.applyLabel(id, text);
stylePanel.cropWithMouse = () => cropPicture();
stylePanel.reaction = {
  roles: (id) => editor.reactionRoles(id),
  others: () => editor.sel.atoms.size + editor.sel.captions.size + editor.sel.shapes.size,
  setRole: (id, role) => { editor.setReactionRole(id, role); },
  reset: (id) => editor.resetReactionRoles(id),
  select: (id, role) => editor.selectRole(id, role),
  cleanUp: () => command('clean-up-reaction'),
};
stylePanel.tables = {
  part: () => editor.tablePart,
  setPart: (p) => { editor.tablePart = p; },
  update: (id, t) => editor.updateTable(id, t),
  edit: (id, part) => editor.editTable(id, part),
  measure: textMeasure,
};

let stereoSeen = -1;
editor.onFrame = () => {
  updatePanels();
  updateWarnings();
  if (doc.version !== stereoSeen) { stereoSeen = doc.version; updateStereo(); }
};
editor.onChange = () => { updateStereo(); scheduleAnalysis(); updatePanels(); ws.noteChange(); stylePanel.refresh(); };
chem.onReady = () => {
  (window as any).__chemReadyMs = performance.now() - startMs;
  sheetChem.flush();
  updatePanels();
  updateStereo();
  scheduleAnalysis(true);
};

/** A sample molecule, for the self-test and the speed tests. */
function sampleMolecule(): void {
  doc.bulk(() => {
    const L = doc.style.bondLength;
    const ring = placeRing(doc, freeRing({ x: 120, y: 90 }, 6, L), { aromatic: true });
    const a = doc.atoms.get(ring[1])!;
    const c = sprout(doc, a.id);
    const ch = sprout(doc, c.id, 1, 'hashWedge');
    doc.updateAtom(ch.id, { label: null });
    const n = sprout(doc, c.id);
    doc.updateAtom(n.id, { z: 7 });
    const co = sprout(doc, n.id);
    sprout(doc, co.id, 2, 'solid', 8);
    const o = sprout(doc, co.id, 1, 'solid', 8);
    doc.updateAtom(o.id, { label: null });
    const tb = sprout(doc, o.id);
    doc.updateAtom(tb.id, { label: 'tBu' });
    editor.lastEdited = ring[0];
  });
  doc.allDirty = true;
  editor.fit();
  editor.changed();
}

// the ribbon's buttons run the same commands as the menus
$('#ribbon').addEventListener('click', (e) => {
  const cmd = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]')?.dataset.cmd;
  if (cmd) command(cmd);
});
renderTabs();
updateTitle();

resize();
requestAnimationFrame(() => {
  editor.fit();
  editor.frame(true);
  (window as any).__firstPaintMs = performance.now() - startMs;
  // start the speed readout from the first real interaction
  editor.latencies.length = 0;
});

// Hooks for the automated speed tests.
(window as any).__app = { doc, editor, renderer, chem, live, openText, stressTest, pasteChemistry, placePicture, sample: sampleMolecule, ws, slideList, presenter, Doc, keymap, names, sheetMode, sheetChem, docMode };

// ---------------------------------------------------------------- desktop self-test

// Inside the desktop app, started with CHEM_ILLUSTRATOR_SELFTEST set (see src-tauri/src/lib.rs):
// check that the drawing, the chemistry engine and the name reader work in this web view, time a few redraws,
// report, and close. The automatic Windows build runs this on the app it has just built.
if (isTauri()) {
  invoke<boolean>('selftest_requested').then((yes) => { if (yes) desktopSelfTest(); }).catch(() => {});
}

async function desktopSelfTest(): Promise<void> {
  const report: Record<string, unknown> = { userAgent: navigator.userAgent };
  let ok = false;
  try {
    sampleMolecule();
    const t0 = performance.now();
    while (!chem.ready && !chem.error && performance.now() - t0 < 60000) await new Promise((r) => setTimeout(r, 50));
    await new Promise((r) => requestAnimationFrame(r));
    Object.assign(report, {
      atoms: doc.atoms.size,
      firstPaintMs: (window as any).__firstPaintMs,
      chemReadyMs: (window as any).__chemReadyMs,
      rdkit: chem.version,
      chemError: chem.error,
    });
    if (chem.ready) {
      const { molblock, map } = toMolfile(doc, doc.atoms.keys());
      const res = await chem.analyze([{ molblock, map }]);
      report.formula = res.results[0]?.formula;
      report.exactMass = res.results[0]?.exact;
      ok = !!report.formula && !res.results[0]?.error;
    }
    // Name to structure (OPSIN in its worker) in this web view, under the app's security rules.
    const n0 = performance.now();
    const nr = await names.read('(2R)-butan-2-ol');
    report.nameToStructure = { ok: nr.ok, smiles: nr.smiles, message: nr.message, ms: Math.round(performance.now() - n0) };
    ok = ok && nr.ok && nr.smiles === 'C[C@H](CC)O';
    // Redraw speed on a large drawing, in this web view.
    const s0 = performance.now();
    stressTest(2000);
    report.stress2000 = { atoms: doc.atoms.size, buildAndFirstPaintMs: performance.now() - s0 };
    const times: number[] = [];
    renderer.renderScene(doc);
    for (let i = 0; i < 40; i++) { renderer.view.ox += i % 2 ? 3 : -3; renderer.renderScene(doc); times.push(renderer.lastSceneMs); }
    (report.stress2000 as Record<string, unknown>).panMedianMs = stat(times).med;
  } catch (e) {
    report.exception = String(e);
    ok = false;
  }
  await invoke('selftest_report', { report: JSON.stringify(report, null, 2), ok });
}
