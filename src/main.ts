// The app window: File menu, toolbar, drawing area, analysis and speed panels.

import './app.css';
import { Doc } from './model';
import { Renderer } from './render/renderer';
import { Editor, TOOLS } from './editor/editor';
import { readCdxml, ReadStats } from './io/cdxml';
import { ChemClient } from './chem/client';
import { toMolfile, addMolfile } from './chem/molfile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { DocumentFile } from './io/document-file';
import { copyDrawing, insertDrawing, isEmpty, nativeClipboard, readNativeClipboard, readPasteEvent, readWebClipboard, clipboardFormats, Pasted } from './io/clipboard';
import { freeRing, fusedRing, placeRing, sprout, ringOnAtom, sproutDir } from './chem/chemgeom';
import { ICONS } from './icons';

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;

const doc = new Doc();
const host = $<HTMLDivElement>('#canvas-host');
const scene = $<HTMLCanvasElement>('#scene');
const overlay = $<HTMLCanvasElement>('#overlay');
const renderer = new Renderer(scene, overlay);
const editor = new Editor(doc, renderer, host);
const chem = new ChemClient(document.baseURI);
const startMs = performance.now();

// ---------------------------------------------------------------- layout

function resize(): void {
  const r = host.getBoundingClientRect();
  renderer.resize(r.width, r.height, window.devicePixelRatio || 1);
  editor.requestScene();
}
new ResizeObserver(resize).observe(host);

// ---------------------------------------------------------------- toolbar

const TOOL_GROUPS: { name: string; title: string; key?: string }[][] = [
  [
    { name: 'select', title: 'Select and move (Space)', key: 'Space' },
    { name: 'eraser', title: 'Eraser' },
  ],
  [
    { name: 'bond-single', title: 'Single bond (x). Click a bond: single, double, triple', key: 'x' },
    { name: 'bond-double', title: 'Double bond. Click again to move the second line' },
    { name: 'bond-triple', title: 'Triple bond' },
    { name: 'bond-wedge', title: 'Wedge. Click again to reverse', key: 'w' },
    { name: 'bond-hashWedge', title: 'Hashed wedge. Click again to reverse', key: 'h' },
    { name: 'bond-hash', title: 'Hashed bond' },
    { name: 'bond-bold', title: 'Bold bond' },
    { name: 'bond-dash', title: 'Dashed bond' },
    { name: 'bond-wavy', title: 'Wavy bond' },
    { name: 'chain', title: 'Chain: drag to draw a zig-zag chain (Shift+X)', key: 'X' },
  ],
  [
    { name: 'ring-3', title: 'Cyclopropane' },
    { name: 'ring-4', title: 'Cyclobutane' },
    { name: 'ring-5', title: 'Cyclopentane' },
    { name: 'ring-6', title: 'Cyclohexane' },
    { name: 'ring-7', title: 'Cycloheptane' },
    { name: 'ring-8', title: 'Cyclooctane' },
    { name: 'ring-benzene', title: 'Benzene (j). Shift+click swaps the double bonds', key: 'j' },
    { name: 'ring-cp', title: 'Cyclopentadiene (Shift+J)', key: 'J' },
  ],
  [
    { name: 'text', title: 'Text: click an atom to label it, or empty space for a caption (t)', key: 't' },
    { name: 'arrow', title: 'Reaction arrow (e)', key: 'e' },
  ],
];

const toolbar = $<HTMLDivElement>('#tools');
for (const group of TOOL_GROUPS) {
  const g = document.createElement('div');
  g.className = 'tool-group';
  for (const t of group) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.tool = t.name;
    b.title = t.title;
    b.setAttribute('aria-label', t.title);
    b.innerHTML = ICONS[t.name] ?? t.name;
    b.addEventListener('click', () => editor.setTool(t.name));
    g.appendChild(b);
  }
  toolbar.appendChild(g);
}

const HINTS: Record<string, string> = {
  select: 'Click to select, drag to box-select or move. Double-click selects a whole structure. Delete removes.',
  eraser: 'Click an atom, bond, caption or arrow to remove it.',
  chain: 'Drag from empty space or an atom; the number shows how many bonds.',
  text: 'Click an atom to type a label (OMe, CO2Et, NHBoc…), or click empty space for a caption.',
  arrow: 'Drag to draw a reaction arrow; click for a standard one.',
};
const BOND_HINT = 'Click empty space or an atom to draw; drag to aim. Point at an atom or bond and press a hotkey (see Help).';
const RING_HINT = 'Click empty space, an atom (spiro; Alt+click to attach by a bond) or a bond (fused). Drag to orient.';

editor.onToolChange = (name) => {
  for (const b of toolbar.querySelectorAll<HTMLButtonElement>('.tool')) b.classList.toggle('active', b.dataset.tool === name);
  const t = TOOLS[name];
  $('#hint').textContent = HINTS[name] ?? (t.kind === 'ring' ? RING_HINT : BOND_HINT);
};
editor.setTool('bond-single');

// ---------------------------------------------------------------- top bar actions

$('#btn-undo').addEventListener('click', () => editor.undo());
$('#btn-redo').addEventListener('click', () => editor.redo());
$('#btn-fit').addEventListener('click', () => editor.fit());
$('#btn-stress').addEventListener('click', () => stressTest(Number($<HTMLSelectElement>('#stress-n').value)));
$('#btn-help').addEventListener('click', () => $<HTMLDialogElement>('#help').showModal());
$('#help-close').addEventListener('click', () => $<HTMLDialogElement>('#help').close());
const stereoBox = $<HTMLInputElement>('#show-stereo');
stereoBox.addEventListener('change', () => scheduleAnalysis(true));

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
  else if (got.kind === 'chemdraw') flash('Pasting drawings from ChemDraw is not ready yet.');
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
  renderer.annotations = new Map();
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
  'select-all': () => editor.selectAll(),
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

// File and clipboard shortcuts, ahead of the drawing tools' own keys.
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey) || isTyping(e.target)) return;
  const k = e.key.toLowerCase();
  let cmd: string | null = null;
  if (k === 'n') cmd = 'new';
  else if (k === 'o') cmd = 'open';
  else if (k === 's') cmd = e.shiftKey ? 'save-as' : 'save';
  else if (k === 'c') cmd = e.altKey ? 'copy-smiles' : textSelected() ? null : 'copy';
  else if (k === 'x' && !e.altKey) cmd = textSelected() ? null : 'cut';
  // in a browser, Ctrl+V goes on to the paste event, which can read the clipboard
  else if (k === 'v' && !e.altKey && nativeClipboard) cmd = 'paste';
  if (!cmd) return;
  e.preventDefault();
  e.stopPropagation();
  COMMANDS[cmd]();
}, true);

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
    renderer.annotations = new Map();
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
  const key = doc.version + ':' + frags.map((f) => [...f].join(',')).join('|') + stereoBox.checked;
  if (!force && key === analysisKey) return;
  analysisKey = key;
  const panel = $('#analysis-body');
  if (!frags.length) {
    panel.innerHTML = '<p class="muted">Select a structure, or draw one, to see its formula and masses.</p>';
    if (renderer.annotations.size) { renderer.setAnnotations(doc, new Map()); editor.requestScene(); }
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
    return `<div class="frag">
      <div class="formula">${formatFormula(r.formula)}</div>
      <table>
        <tr><th>Exact mass</th><td>${r.exact.toFixed(4)}</td></tr>
        <tr><th>Mol. wt.</th><td>${r.mw.toFixed(2)}</td></tr>
        ${r.charge === 0 ? `<tr><th>[M+H]<sup>+</sup></th><td>${(r.exact + H).toFixed(4)}</td></tr><tr><th>[M+Na]<sup>+</sup></th><td>${(r.exact + NA).toFixed(4)}</td></tr>` : ''}
        ${r.cip.length ? `<tr><th>Stereo</th><td>${r.cip.map((c) => c[1]).join(', ')}</td></tr>` : ''}
      </table>
      <div class="smiles" title="SMILES">${escapeHtml(r.smiles)}</div>
      ${unk.length ? `<p class="warn">Not understood (left out): ${unk.map(escapeHtml).join(', ')}</p>` : ''}
    </div>`;
  }).join('');
  // stereo labels on the drawing
  const next = new Map<number, string>();
  if (stereoBox.checked) for (const r of res.results) for (const [id, l] of r.cip) next.set(id, `(${l})`);
  if (renderer.annotations.size || next.size) { renderer.setAnnotations(doc, next); editor.requestScene(); }
  updatePanels();
}

function formatFormula(f: string): string {
  return escapeHtml(f).replace(/(\d+)(?=[+−]$)/, '<sup>$1</sup>').replace(/([A-Za-z])(\d+)/g, '$1<sub>$2</sub>').replace(/([+−])$/, '<sup>$1</sup>');
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
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

editor.onFrame = () => updatePanels();
editor.onChange = () => { scheduleAnalysis(); updatePanels(); file.updateTitle(); };
chem.onReady = () => {
  (window as any).__chemReadyMs = performance.now() - startMs;
  updatePanels();
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
(window as any).__app = { doc, editor, renderer, chem, openText, stressTest, pasteChemistry, sample: sampleMolecule, file, Doc };

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
