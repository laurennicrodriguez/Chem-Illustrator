// The app window: File menu, toolbar, drawing area, analysis and speed panels.

import './app.css';
import { Doc, Atom } from './model';
import { Renderer } from './render/renderer';
import { Editor, TOOLS } from './editor/editor';
import type { Align } from './editor/arrange';
import { readCdxml, ReadStats } from './io/cdxml';
import { ChemClient } from './chem/client';
import { toMolfile, addMolfile } from './chem/molfile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DocumentFile } from './io/document-file';
import { copyDrawing, extractDrawing, insertDrawing, isEmpty, nativeClipboard, readClipboardText, readNativeClipboard, readPasteEvent, readWebClipboard, clipboardFormats, Pasted } from './io/clipboard';
import { writeCdxml } from './io/cdxml-write';
import { openFileDialog, saveFileDialog, writeFile, KEYMAP_FILE } from './io/files';
import { freeRing, fusedRing, placeRing, sprout, ringOnAtom, sproutDir } from './chem/chemgeom';
import { Toolbar, ToolbarItem, PaletteDef } from './ui/toolbar';
import { StylePanel } from './ui/style-panel';
import { TEMPLATES, Template, templateById } from './chem/templates';
import { templateIcon } from './ui/template-icons';
import { StructureChecks } from './chem/warnings';
import { LiveStereo } from './chem/live-stereo';
import { setStereoShown } from './chem/stereo';
import { keymap, registerToolNames, displayChord, actionName, KeyContext, KeyOverrides } from './editor/keymap';
import { loadSettings, saveSettings, settingsLocation, Settings } from './settings';
import { HotkeysDialog } from './ui/hotkeys-dialog';
import { NicknameChooser } from './ui/nickname-chooser';
import { ask } from './ui/ask';

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
const templatePalette = (group: Template['group'], palette: string, title: string, columns: number): PaletteDef => ({
  palette,
  title,
  items: TEMPLATES.filter((t) => t.group === group).map((t) => ({ name: `tpl-${t.id}`, title: t.name })),
  columns,
  large: true,
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
    templatePalette('amino', 'tpl-amino', 'Amino acids', 5),
    templatePalette('sugars', 'tpl-sugars', 'Sugars and chair', 4),
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

$('#btn-undo').addEventListener('click', () => editor.undo());
$('#btn-redo').addEventListener('click', () => editor.redo());
$('#btn-fit').addEventListener('click', () => editor.fit());
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

host.addEventListener('dragover', (e) => { e.preventDefault(); host.classList.add('drop'); });
host.addEventListener('dragleave', () => host.classList.remove('drop'));
host.addEventListener('drop', (e) => {
  e.preventDefault();
  host.classList.remove('drop');
  const f = e.dataTransfer?.files?.[0];
  if (f) openFile(f);
});

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
  if (isTyping(e.target)) return;
  e.preventDefault();
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
    editor.sel = insertDrawing(doc, got.doc, renderer.toDoc(renderer.width / 2, renderer.height / 2));
    editor.changed();
  } else if (got.kind === 'text') await pasteChemistry(got.text);
  else flash('There is nothing to paste.');
}

/** Paste a SMILES string or a molfile as a structure. */
async function pasteChemistry(text: string): Promise<void> {
  if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
  const c = renderer.toDoc(renderer.width / 2, renderer.height / 2);
  let mb: string | null = text.includes('M  END') ? text : null;
  if (!mb && !/\s/.test(text)) mb = await chem.smilesToMol(text);
  if (!mb) { flash('Paste a SMILES string or a molfile.'); return; }
  try {
    let ids: number[] = [];
    doc.edit('Paste', () => { ids = addMolfile(doc, mb!, c.x, c.y); });
    editor.sel = { atoms: new Set(ids), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
    for (const id of ids) for (const b of doc.adj.get(id) ?? []) editor.sel.bonds.add(b);
    editor.changed();
  } catch (err) {
    flash(String(err));
  }
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
  return copyText(writeCdxml(part, { name: 'Clipboard.cdxml' }), 'Copied as CDXML text.');
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

// ---------------------------------------------------------------- opening files

let lastOpen = '';
let lastStats: ReadStats | null = null;

async function openFile(f: File): Promise<void> {
  const text = await f.text();
  await file.openText(text, f.name);
}

function clearDrawing(): void {
  doc.loadFrom(new Doc());
  editor.clearSelection();
  editor.lastEdited = null;
  renderer.view = { scale: 2, ox: 40, oy: 40 };
  lastOpen = '';
  editor.changed();
}

// ---------------------------------------------------------------- the drawing's file

const file = new DocumentFile(doc, {
  load: (text, name) => openText(text, name) !== null,
  reset: clearDrawing,
  flash,
  title: (t) => {
    document.title = t;
    if (isTauri()) getCurrentWindow().setTitle(t).catch(() => {});
  },
});

const COMMANDS: Record<string, () => unknown> = {
  new: () => file.newDrawing(),
  open: () => file.open(),
  save: () => file.save(),
  'save-as': () => file.saveAs(),
  'export-mol': () => file.exportMolfile(editor.sel.atoms.size ? editor.sel.atoms : doc.atoms.keys()),
  undo: () => editor.undo(),
  redo: () => editor.redo(),
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
  'zoom-in': () => editor.zoomBy(1.25),
  'zoom-out': () => editor.zoomBy(0.8),
  'zoom-fit': () => editor.fit(),
  // 100%: a point on the page is a point on the screen (96 pixels to the inch)
  'zoom-actual': () => editor.zoomTo(96 / 72),
  hotkeys: () => hotkeysDialog.open(),
  'clean-up': () => editor.cleanUp() || flash('Nothing to clean up: the structures are already tidy.'),
  'check-structure': () => checkStructure(),
  'stereo-labels': () => toggleStereoLabels(),
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
    COMMANDS[cmd]?.();
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
  const run = COMMANDS[name];
  if (!run) return false;
  return run() !== false;
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
  };
  saveSettings(s, (msg) => flash(msg, 10000));
}

/** Show the current keys in the menus and tool tips, and tick the options that are on. */
function refreshKeys(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('.menu button[data-cmd]')) {
    const k = keysOf('command', `command ${b.dataset.cmd}`)[0];
    let kbd = b.querySelector('kbd');
    if (!k) { kbd?.remove(); continue; }
    if (!kbd) { kbd = document.createElement('kbd'); b.append(kbd); }
    kbd.textContent = k;
  }
  for (const [cmd, on] of [['fixed-length', editor.options.fixedLength], ['fixed-angles', editor.options.fixedAngles]] as const) {
    $(`[data-cmd="${cmd}"]`)?.setAttribute('aria-checked', String(on));
  }
  const tip = (id: string, text: string, cmd: string) => {
    const k = keysOf('command', `command ${cmd}`)[0];
    $(id).title = k ? `${text} (${k})` : text;
  };
  tip('#btn-undo', 'Undo', 'undo');
  tip('#btn-redo', 'Redo', 'redo');
  tip('#btn-fit', 'Fit drawing to window', 'zoom-fit');
  toolbar.refreshTitles();
}

keymap.onChange(() => { refreshKeys(); storeSettings(); });

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
  keymap.setOverrides(s.hotkeys);
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
    if (!(await file.confirmClose())) e.preventDefault();
  }).catch(() => {});
} else {
  window.addEventListener('beforeunload', (e) => { if (file.dirty) e.preventDefault(); });
}

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
  if (panelQueued) return;
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

let stereoSeen = -1;
editor.onFrame = () => {
  updatePanels();
  updateWarnings();
  if (doc.version !== stereoSeen) { stereoSeen = doc.version; updateStereo(); }
};
editor.onChange = () => { updateStereo(); scheduleAnalysis(); updatePanels(); file.updateTitle(); stylePanel.refresh(); };
chem.onReady = () => {
  (window as any).__chemReadyMs = performance.now() - startMs;
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

resize();
requestAnimationFrame(() => {
  editor.fit();
  editor.frame(true);
  (window as any).__firstPaintMs = performance.now() - startMs;
  // start the speed readout from the first real interaction
  editor.latencies.length = 0;
});

// Hooks for the automated speed tests.
(window as any).__app = { doc, editor, renderer, chem, live, openText, stressTest, pasteChemistry, sample: sampleMolecule, file, Doc, keymap };

// ---------------------------------------------------------------- desktop self-test

// Inside the desktop app, started with CHEM_ILLUSTRATOR_SELFTEST set (see src-tauri/src/lib.rs):
// check that the drawing and the chemistry engine work in this web view, time a few redraws,
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
