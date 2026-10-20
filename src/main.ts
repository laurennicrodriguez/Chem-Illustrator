// The app window: menus, a tab for each open file (drawings, slide decks and sheets), the
// toolbar, the drawing area (with the slide list and notes in Slides mode, or the grid in Sheet
// mode), and the panels on the right.

import './app.css';
import type { MethylStyle } from './chem/hydrogens';
import { STANDARD_COLOURS, usedColours } from './colours';
import { ICONS } from './icons';
import { Toolboxes, lockIcon, sideFolded, commandButton, customizeToolbox, defaultToolboxes, menuCommands, type Pickable, type ToolboxDef, type ToolboxId, type ToolboxState } from './ui/toolboxes';
import { editPalettes, getPalettes, onPalettes, setPalettes, useDrawingColours, usePaletteMenus } from './ui/palette-ui';
import { Doc, Atom, Caption, Shape, Contents, CHIRAL_FLAGS, PICTURE_STYLES, type PictureLook, type Attachment, type HighlightStyle } from './model';
import { Renderer, measureText, forgetTextWidths } from './render/renderer';
import { Editor, TOOLS } from './editor/editor';
import { selectionBox, POINTS, type Align } from './editor/arrange';
import { readCdxml, ReadStats } from './io/cdxml';
import { ChemClient } from './chem/client';
import type { FragmentResult } from './worker/chem-worker';
import { COMMON_ADDUCTS } from './chem/hrms';
import { pubchemName, pubchemCid, pubchemCompound, compoundPage } from './chem/pubchem';
import { pubchemHtml, pubchemRuns, type PubChemState } from './ui/pubchem-panel';
import { paragraphPages } from './document/doc-file';
import { reviewAuthor, setReviewAuthor } from './document/revisions';
import { analysisHtml, analysisRuns, withRepeats, polymerHtml, descriptorRuns, DEFAULT_DESCRIPTORS, type RepeatUnit } from './ui/analysis-panel';
import { attachedAtoms, attachWhereItIs, defaultGap, nearestStructure, placeAttached, structureSig } from './editor/attached';
import { repeatGroups, lipDirection } from './chem/polymer';
import { rGroupsOf, substituted, rowNumbers, parseRows, rGroupCells, type RowMass } from './chem/rgroup';
import type { Vec } from './geom';
import { captionPlaces, fragmentRuns } from './chem/fragments';
import { toMolfile, addMolfile } from './chem/molfile';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyDrawing, extractDrawing, insertDrawing, isEmpty, nativeClipboard, readClipboardText, readNativeClipboard, readPasteEvent, readWebClipboard, clipboardFormats, fitPasted, Pasted,
  nativeFirst, writeNativeFormats, looksLikeCdxml, cfHtml, fromCfHtml, CELLS_FORMAT, OWN_FORMAT, CDX_FORMAT } from './io/clipboard';
import { cdxToCdxml } from './io/cdx';
import { writeCdxml } from './io/cdxml-write';
import { WORKSPACE } from './io/workspace-file';
import { openFileDialog, openBytesDialog, saveFileDialog, writeFile, showError, baseName, readPath, withExtension, KEYMAP_FILE, MOL, PDF, PICTURE, SVG, PICTURE_EXTENSIONS } from './io/files';
import { Workspace, Tab } from './workspace';
import { Deck, LayoutId, LAYOUTS, WIDE, STANDARD, Image as SlideImage, sizeName, SlideSize } from './deck/deck';
import { drawSlidePage, recordSlide, paintSlide, SURROUND } from './deck/slide-view';
import { writePdf, jpegInfo, PdfPage, PdfImage } from './io/pdf';
import { SlideList } from './ui/slide-list';
import { DesignLibrary, GEO_DRAG_TYPE, pickDesignSize, sizeLabel } from './ui/design-panel';
import { ShapeMenu } from './ui/shape-menu';
import { SlideTextRibbon } from './ui/slide-text-ribbon';
import { CaptionEditor } from './ui/caption-editor';
import { LayersPanel } from './ui/layers-panel';
import { Scrollbars } from './ui/scrollbars';
import { Presenter } from './ui/present';
import { PresenterView } from './ui/presenter-view';
import { editMaster } from './ui/master-dialog';
import { editDrawingStyle } from './ui/style-dialog';
import type { DocText } from './document/document';
import { DARK_PALETTES, darkPaletteNamed, showDarkPage, type DarkPalette } from './dark-page';
import { applyStyle, restyleContents, styleNamed, type StyleMode } from './drawing-styles';
import { recordPicture, pictureSvg, pictureCanvas, canvasPng, bitmapScale, EXPORT_MAX_SIDE, EXPORT_MAX_PIXELS } from './render/picture';
import { pngWithDpi } from './render/emf-read';
import { whiteToClear } from './render/background';

import { pickSlideTemplate } from './ui/slide-templates';
import { AnimationUI } from './ui/animation-ui';
import { SlideComments } from './ui/slide-comments';
import { writePptx, type PptxOptions } from './io/pptx-write';
import { EFFECTS, animName, newAnim } from './deck/animation';
import { SLIDE_TEMPLATES, applyTemplate } from './deck/templates';import { pickTemplate } from './ui/template-gallery';
import { showContextMenu, topMenuEntry, type MenuItem } from './ui/context-menu';
import { CommandSearch, uniqueCommands, type CommandItem } from './ui/command-search';
import { fillTemplate, templateSize } from './design/templates';
import { askCycle } from './ui/cycle-dialog';
import { itemsToSvg } from './render/svg';
import { PAPERS, defaultPaper, orient, placeIn, inside, handoutCells, noteLines, placeSvg, pageSvg } from './print-layout';
import { printPages } from './ui/print';
import { dataUrl, fromDataUrl, imageSize, loadImage, onImageReady, pictureMime, showableSrc, webpToPng } from './render/images';
import { freeRing, fusedRing, placeRing, sprout, ringOnAtom, ringDir } from './chem/chemgeom';
import { Toolbar, ToolbarItem, PaletteDef } from './ui/toolbar';
import { StylePanel, tidyStyle } from './ui/style-panel';
import { installCombos } from './ui/combo';
import { installFontList, registerBundledFonts, bundledFaces } from './fonts';
import { applyRibbonIcons } from './ui/ribbon-icons';
import { TEMPLATES, Template, templateById, ownTemplates, setOwnTemplates, templateFromAtoms } from './chem/templates';
import { centreEnd } from './chem/hapto';
import { addNicknames, removeNickname, isBuiltInNickname } from './chem/labels';
import { selectedGroup } from './chem/group-smiles';
import { templateIcon } from './ui/template-icons';
import { StructureChecks } from './chem/warnings';
import { idText, labelClashes, parseIdStart, type IdStyle } from './chem/compound-numbers';
import { schemeItems } from './chem/reaction';
import { labelsOf, schemePrefs, setSchemePrefs, SPACING, type SchemePrefs } from './chem/scheme-layout';
import { plainText } from './richtext';
import { LiveStereo } from './chem/live-stereo';
import { setStereoShown, shownDescriptor, axialStyle } from './chem/stereo';
import { keymap, registerToolNames, displayChord, actionName, chordOf, parseAction, KeyContext, KeyOverrides } from './editor/keymap';
import { loadSettings, saveSettings, settingsLocation, Settings } from './settings';
import { HotkeysDialog } from './ui/hotkeys-dialog';
import { TypingDialog } from './ui/typing-dialog';
import { ModeColoursDialog, ModeColours, DEFAULT_MODE_COLOURS, applyModeColours } from './ui/mode-colours';
import { typingPrefs, setTypingPrefs, onTypingPrefs } from './text/typing';
import { NicknameChooser } from './ui/nickname-chooser';
import { ask } from './ui/ask';
import { UpdateUI } from './ui/update-ui';
import { canUpdate, appVersion, portableInfo } from './updates';
import { GUIDE_URL, computerName } from './feedback';
import { FeedbackDialog } from './ui/feedback-dialog';
import { addRecent, removeRecent, recentLabel } from './recent';
import { NameReader, captionName, attachmentAtoms, cxNotes } from './chem/names';
import { NameDialog } from './ui/name-dialog';
import { ArrangeDialog } from './ui/arrange-dialog';
import { PeriodicTable } from './ui/periodic-table';
import { SheetMode, ClipboardCells } from './ui/sheet-mode';
import { DocumentMode, DocPaste } from './ui/doc-mode';
import { docBoxPrefs, parseDocPins } from './ui/doc-panel';
import { setScreenMeasure, figures } from './document/doc-file';
import { readDocx, writeDocx, type DocxDeps, type DocxReadDeps } from './io/docx';
import { FIGURE_MARGIN } from './document/figures';
import { recordPages } from './document/doc-paint';
import { preferredStyle, setPreferredStyle } from './document/cite-styles';
import { layoutTable } from './table';
import { SheetChem } from './sheet/sheet-chem';
import { structureDoc, structureMolfile } from './sheet/structure-doc';
import { StructurePictures } from './ui/structure-pictures';
import { LabelTooltip } from './ui/label-tooltip';
import { starAtoms } from './chem/label-tip';
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

// Split view (View > Split View): a drawing beside a document, sheet or slides.
/** The share of the width the drawing takes (settings.json). */
let splitWidth = 0.38;
/** Your own drawing styles, and the style each kind of new tab starts with (settings.json). */
let ownStyles: DocStyle[] = [];
let modeStyles: Partial<Record<StyleMode, string>> = {};
/** View > Dark Page: on or off, which palette, and your own palettes. */
const dark = { on: false, palette: 'Graphite', own: [] as DarkPalette[] };
/** Beside slides: the deck whose drawing is being worked on (the drawing's tab shows; the slide is a picture). */
let slideSplit: Tab | null = null;
/** Beside a document or sheet: the drawing has the keys and menus (it was clicked last). */
let splitDrawing = false;

// ---------------------------------------------------------------- layout

function resize(): boolean {
  const r = host.getBoundingClientRect();
  // hidden (a sheet is showing): keep the last size
  if (r.width < 1 || r.height < 1) return false;
  if (!renderer.resize(r.width, r.height, window.devicePixelRatio || 1)) return false;
  editor.requestScene();
  return true;
}
// resizing a canvas blanks it: when the window or a panel beside the drawing changes size,
// paint again at once, before the browser shows the blank canvas (a flicker)
new ResizeObserver(() => { if (resize()) editor.frame(); }).observe(host);

// ---------------------------------------------------------------- toolbar

const ARROWS: PaletteDef = {
  palette: 'arrows',
  title: 'Arrows',
  items: [
    { name: 'arrow', title: 'Reaction arrow. Shift+drag from an arrow\'s end or middle to branch a new arrow off it' },
    { name: 'arrow-dashed', title: 'Dashed arrow' },
    { name: 'arrow-hollow', title: 'Arrow with a hollow head' },
    { name: 'arrow-double', title: 'Resonance arrow (heads at both ends)' },
    { name: 'arrow-equilibrium', title: 'Equilibrium arrows' },
    { name: 'arrow-retro', title: 'Retrosynthetic arrow' },
    { name: 'arrow-nogo', title: 'Crossed-out arrow (reaction does not go)' },
    { name: 'arrow-curved', title: 'Curved arrow (electron pair). Drag from an atom or bond to an atom or bond and it snaps like a mechanism arrow; hold Alt to draw freely' },
    { name: 'arrow-fishhook', title: 'Curved half-headed arrow (one electron). Snaps between atoms and bonds like the curved arrow; hold Alt to draw freely' },
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

const SYMBOLS: PaletteDef = {
  palette: 'symbols',
  title: 'Mechanism symbols',
  items: [
    { name: 'sym-lonepair', title: 'Lone pair: click an atom to put one in its most open space, or press on the atom and drag round it to aim it (Alt: 15° steps)' },
    { name: 'sym-radical', title: 'Radical dot: click an atom (it becomes a radical); drag round the atom to aim it' },
    { name: 'sym-plus', title: 'Circled plus: click an atom to give it a + charge shown in a circle; drag round the atom to aim it' },
    { name: 'sym-minus', title: 'Circled minus: click an atom to give it a − charge shown in a circle; drag round the atom to aim it' },
    { name: 'sym-delta-plus', title: 'Partial positive charge (δ+): click an atom' },
    { name: 'sym-delta-minus', title: 'Partial negative charge (δ−): click an atom' },
  ],
};

// The person's own templates; the first button saves the selected structure as a new one
const OWN_ADD = 'own-template-add';
const OWN_PALETTE: PaletteDef = {
  palette: 'tpl-own',
  title: 'My templates',
  items: [{ name: OWN_ADD, title: 'Save the selected structure as a template of your own' }],
  columns: 4,
  large: true,
  icon: (name, size) => { const t = templateById(name.slice(4)); return t ? templateIcon(t, size) : name; },
};

// Template palettes, one per kind of structure
const templatePalette = (group: Template['group'] | Template['group'][], palette: string, title: string, columns: number, iconSize?: number): PaletteDef => ({
  palette,
  title,
  items: TEMPLATES.filter((t) => (Array.isArray(group) ? group.includes(t.group) : t.group === group)).map((t) => ({ name: `tpl-${t.id}`, title: t.name })),
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
    { name: 'bond-quadruple', title: 'Quadruple bond (metal–metal)' },
    { name: 'bond-wedge', title: 'Wedge. Click again to reverse' },
    { name: 'bond-hashWedge', title: 'Hashed wedge. Click again to reverse' },
    { name: 'bond-hash', title: 'Hashed bond' },
    { name: 'bond-bold', title: 'Bold bond' },
    { name: 'bond-dash', title: 'Dashed bond' },
    { name: 'bond-wavy', title: 'Wavy bond' },
    { name: 'bond-dative', title: 'Dative bond: draw from the donor atom to the acceptor. Click again to reverse' },
    { name: 'bond-hapto', title: 'Hapto (η) bond: drag from a metal into a ring or onto a π-bond to bond it to the middle (η⁵-Cp, η⁶-arene, η²-alkene); click inside a ring or on a bond for a new metal there. Click a hapto bond to draw it to each atom' },
    { name: 'chain', title: 'Chain: drag to draw a zig-zag chain, or click to type how many atoms (Alt+click: the same number again)' },
  ],
  [
    { name: 'ring-3', title: 'Cyclopropane' },
    { name: 'ring-4', title: 'Cyclobutane' },
    { name: 'ring-5', title: 'Cyclopentane' },
    { name: 'ring-6', title: 'Cyclohexane' },
    { name: 'ring-7', title: 'Cycloheptane' },
    { name: 'ring-8', title: 'Cyclooctane' },
    { name: 'ring-benzene', title: 'Benzene. Shift+click swaps the double bonds; Ctrl+click draws it with a circle' },
    { name: 'ring-cp', title: 'Cyclopentadiene. Ctrl+click draws it with a circle' },
  ],
  [
    templatePalette('rings', 'tpl-rings', 'Ring systems', 5),
    templatePalette('heterocycles', 'tpl-heterocycles', 'Heterocycles', 7),
    templatePalette('amino', 'tpl-amino', 'Amino acids', 5, 64),
    templatePalette('sugars', 'tpl-sugars', 'Sugars', 4, 64),
    templatePalette('conformers', 'tpl-conformers', 'Conformers', 5, 64),
    templatePalette('fused', 'tpl-fused', 'Fused and caged rings in 3-D', 4, 64),
    templatePalette('bicyclics', 'tpl-bicyclics', 'Bicyclic rings', 5, 56),
    templatePalette(['projections', 'stereo'], 'tpl-projections', 'Projections and stereocentres', 6, 56),
    templatePalette('cycloalkanes', 'tpl-cycloalkanes', 'Large rings', 6, 56),
    templatePalette('aromatics', 'tpl-aromatics', 'Aromatics', 6, 56),
    templatePalette('perspective', 'tpl-perspective', 'Rings in perspective', 6, 56),
    templatePalette(['geometries', 'organometallic'], 'tpl-metal', 'Metal complexes', 6, 64),
    templatePalette('ligands', 'tpl-ligands', 'Ligands', 6, 64),
    OWN_PALETTE,
  ],
  [
    { name: 'text', title: 'Text: click an atom to label it, or empty space for a caption' },
    { name: 'element', title: 'Periodic table: pick an element, then click atoms to change them' },
    { name: 'fragment', title: 'Mass fragmentation: drag a line across bonds (or click a bond) to break them and label each piece with its formula and mass' },
    ARROWS,
    SYMBOLS,
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

const periodicTable = new PeriodicTable((z) => editor.pickElement(z), () => editor.element);
const toolbar = new Toolbar($<HTMLDivElement>('#tools'), TOOL_GROUPS, (name) => {
  if (name === OWN_ADD) { void saveTemplate(); return; }
  pickTool(name);
}, (name) => {
  const keys = keysOf('space', `tool ${name}`);
  return keys.length ? ` (${keys.join(', ')})` : '';
});

const HINTS: Record<string, string> = {
  connector: 'Drag from one shape\'s blue dot to another\'s: the connector sticks to both and follows them when they move.',
  'connector-elbow': 'Drag from one shape\'s blue dot to another\'s: the connector bends square and follows the shapes when they move.',
  select: 'Click to select (Shift or Ctrl+click adds), drag to box-select or move. Ctrl+drag copies; Shift keeps a drag straight. Double-click selects a whole structure. Delete removes.',
  eraser: 'Click an atom, bond, caption, arrow or shape to remove it.',
  chain: 'Drag from empty space or an atom; the number shows how many bonds. Click to type how many atoms; Alt+click repeats the last number.',
  text: 'Click an atom to type a label (OMe, CO2Et, NHBoc…), or click empty space for a caption.',
  element: 'Click atoms to make them the element picked in the periodic table, or empty space to add one.',
  'bond-hapto': 'Drag from a metal into a ring (η⁵, η⁶) or onto a bond (η²), or the other way. Click inside a ring or on a bond for a new metal M there; select an allyl or diene, then click the metal. Click a hapto bond to draw it to each atom.',
  fragment: 'Drag a line across the bonds to break (or click one bond). Each piece gets a caption with its formula and exact mass, which you can edit.',
};
const ARROW_HINT = 'Drag to draw an arrow (Alt: any angle); click for a standard one. Drag the ends to move them, the middle to bend it.';
const CURVE_HINT = 'Drag from where the electrons start to where they go; swing out to one side to bend that way. Drag the middle dot to change the curve.';
const SHAPE_HINT = 'Drag to draw. Drag the corner squares to resize; the Style panel changes dashes, fill, corners and shadow.';
const BRACKET_HINT = 'Drag a box to put brackets round it, or click a structure to bracket it.';
const BOND_HINT = 'Click empty space or an atom to draw; drag to aim. Point at an atom or bond and press a hotkey (Edit > Hotkeys lists them).';
const RING_HINT = 'Click empty space, an atom (spiro; Alt+click to attach by a bond) or a bond (fused). Drag to orient.';
const TEMPLATE_HINT = 'Click empty space to place it (drag to turn it), a bond to fuse it on, or an atom to join it there (Alt: the other way: by a new bond, or sharing the atom).';

// Design mode's shape library (made further down, once the page is ready)
let designLib: DesignLibrary | null = null;
/** Insert > Shapes in Slides and Documents. */
const shapeMenu = new ShapeMenu();
let layers: LayersPanel | null = null;
let animUi: AnimationUI | null = null;
let slideCmts: SlideComments | null = null;
/** View > Alignment Guides: moved things snap into line with other things and the page, on or off for each kind of tab. */
const guidesOn: Record<'drawing' | 'slides' | 'design', boolean> = { drawing: false, slides: true, design: true };
const guideMode = (): keyof typeof guidesOn | null => {
  const m = ws.active.mode;
  return m === 'drawing' || m === 'slides' || m === 'design' ? m : null;
};
/** Turn the guides on or off for the kind of tab showing, and tick the menus. */
function showGuides(): void {
  const m = guideMode();
  editor.smartGuides = !!m && guidesOn[m];
  $('[data-cmd="alignment-guides"]')?.setAttribute('aria-checked', String(editor.smartGuides));
  if (m === 'design') $<HTMLInputElement>('#dz-guides').checked = guidesOn.design;
}
const GEO_HINT = 'Click on the page to put the shape down, or drag to draw it at any size (Shift keeps its shape). Double-click a shape to type in it.';

editor.onToolChange = (name) => {
  toolbar.setActive(name);
  for (const b of document.querySelectorAll<HTMLElement>('.tb-tool')) b.classList.toggle('active', b.dataset.tool === name);
  designLib?.setActive(name);
  if (name.startsWith('geo:')) { $('#hint').textContent = GEO_HINT; return; }
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
$('#btn-dark').addEventListener('click', () => command('dark-page'));
$('#help-hotkeys').addEventListener('click', () => { $<HTMLDialogElement>('#help').close(); hotkeysDialog.open(); });
$('#help-close').addEventListener('click', () => $<HTMLDialogElement>('#help').close());
/** View > Show R/S Preview: every R/S and E/Z label in red, on screen only. */
function previewStereo(on: boolean): void {
  renderer.previewStereo = on;
  $('[data-cmd="show-stereo"]')?.setAttribute('aria-checked', String(on));
  renderer.repaintAll();
  editor.requestScene();
}

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
function placeTable(t: TableData, label: string, top?: Vec): number {
  finishTyping();
  renderer.useStyle(doc);
  const lay = renderer.tableLayout(t);
  const c = top ?? pasteCentre();
  const x1 = c.x - lay.width / 2, y1 = top ? top.y : c.y - lay.height / 2;
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

/** Insert ▸ Catalytic Cycle…: a ready-made cycle to edit, or the selected structures put round one. */
async function insertCycle(): Promise<void> {
  finishTyping();
  const got = await askCycle(editor.selectedStructures().length);
  if (got) editor.insertCycle(got.spec, got.look, pasteCentre());
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

/** Names the name reader can't read are looked up on PubChem (Edit > Preferences). */
let pubchemNames = true;

/**
 * A name as a laid-out molfile, or why not. Systematic names are read here, on this computer;
 * a name that can't be read (a trade name, an abbreviation) is looked up on PubChem, unless
 * that is turned off in Edit > Preferences.
 */
async function nameToMolfile(name: string): Promise<{ mb: string; attach: number[]; warnings: string[] } | { error: string }> {
  const r = await names.read(name);
  namesReady = true;
  if (!chem.ready) return { error: 'The chemistry engine is still loading; try again in a moment.' };
  if (!r.ok) {
    if (!pubchemNames || !name.trim()) return { error: r.message };
    const why = r.message.trim().replace(/([^.])$/, '$1.');
    let found: Awaited<ReturnType<typeof pubchemName>>;
    try {
      found = await pubchemName(name);
    } catch (e) {
      return { error: `${why} Looking it up on PubChem didn't work either: ${(e as Error).message}` };
    }
    if (!found) return { error: `${why} PubChem doesn't know this name either.` };
    const mb = await chem.smilesToMol(found.smiles).catch(() => null);
    if (!mb) return { error: `PubChem knows this name, but its structure could not be drawn (${found.smiles}).` };
    const same = found.title.toLowerCase() === name.trim().toLowerCase();
    return { mb, attach: [], warnings: [`Found on PubChem${same ? '' : ` as ${found.title}`} (CID ${found.cid}). Check it is the compound you meant.`] };
  }
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

/** Slides: structures locked so clicks reach the text near them. */
let structuresLocked = false;

function toggleStructureLock(): void {
  structuresLocked = !structuresLocked;
  const slides = !!ws.active.deck && ws.active.mode !== 'design';
  editor.structuresLocked = slides && structuresLocked;
  $('#rb-lock-structures').setAttribute('aria-pressed', String(structuresLocked));
  if (structuresLocked) {
    // let go of any atoms and bonds picked up
    editor.sel.atoms.clear();
    editor.sel.bonds.clear();
    editor.changed();
  }
  flash(structuresLocked ? 'Structures locked: clicks go to text and pictures. Click Lock Structures again to edit structures.' : 'Structures can be clicked again.');
}

/** How Number Compounds counted last time (offered again). */
const numbering = { style: 'numbers' as IdStyle, prefix: '', suffix: '', bold: true, same: true };

/**
 * Each structure's key for "the same structure, the same ID": its canonical SMILES (with
 * stereo), by atom. Structures the chemistry engine can't read have none.
 */
async function structureKeys(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (!chem.ready) return out;
  const frags = doc.fragments().filter((f) => f.size);
  const mols = frags.map((f) => { const ex = toMolfile(doc, f); return { molblock: ex.molblock, map: ex.map }; });
  if (!mols.length) return out;
  const res = await chem.analyze(mols).catch(() => null);
  frags.forEach((f, i) => {
    const r = res?.results[i];
    if (r && !r.error && r.smiles) for (const a of f) out.set(a, r.smiles);
  });
  return out;
}

/**
 * Scheme > Scheme Settings: spacing between structures and + signs, and the text above and below
 * arrows (size, alignment, gap, the + boxes, fitting the arrow to it). A blank distance follows
 * the drawing's bond length.
 */
async function schemeSettings(): Promise<void> {
  finishTyping();
  const p = schemePrefs;
  const bond = doc.style.bondLength;
  const pt = (v: number | null) => (v === null ? '' : String(v));
  const auto = (frac: number) => `${Math.round(frac * bond * 10) / 10} pt`;
  const got = await ask('Scheme Settings', [
    { name: 'structGap', label: 'Gap between arrow and structures', value: pt(p.structGap), type: 'number', unit: 'pt', placeholder: auto(SPACING.gap) },
    { name: 'plusGap', label: 'Space either side of +', value: pt(p.plusGap), type: 'number', unit: 'pt', placeholder: auto(SPACING.plus) },
    { name: 'helpers', label: 'Show + boxes above and below new arrows', value: String(p.helpers), type: 'checkbox' },
    { name: 'textSize', label: 'Text size above and below arrows', value: pt(p.textSize), type: 'number', unit: 'pt', placeholder: `${doc.style.captionSize} pt` },
    { name: 'textAlign', label: 'Text alignment', value: p.textAlign, options: [{ value: 'left', label: 'Left' }, { value: 'center', label: 'Centre' }, { value: 'right', label: 'Right' }] },
    { name: 'textGap', label: 'Gap between arrow and text', value: pt(p.textGap), type: 'number', unit: 'pt', placeholder: auto(SPACING.conditions) },
    { name: 'fit', label: 'Fit arrow length to its text (moves the products)', value: String(p.fit), type: 'checkbox' },
    { name: 'lead', label: 'Arrow before the text starts', value: pt(p.lead), type: 'number', unit: 'pt', placeholder: auto(SPACING.overhang) },
    { name: 'headGap', label: 'Space between text and arrowhead', value: pt(p.headGap), type: 'number', unit: 'pt', placeholder: auto(SPACING.overhang) },
  ], { ok: 'Save', note: 'Used when you type text beside an arrow, and by Clean Up Reaction and Arrange Scheme. Leave a distance blank to scale it with the bond length. Existing schemes change when you next clean them up.' });
  if (!got) return;
  const len = (v: string) => { const n = Number(v); return v.trim() === '' || !isFinite(n) || n < 0 ? null : Math.min(500, n); };
  const next: Partial<SchemePrefs> = {
    structGap: len(got.structGap), plusGap: len(got.plusGap), textGap: len(got.textGap), lead: len(got.lead), headGap: len(got.headGap),
    textSize: len(got.textSize) || null,
    textAlign: got.textAlign === 'left' || got.textAlign === 'right' ? got.textAlign : 'center',
    helpers: got.helpers === 'true', fit: got.fit === 'true',
  };
  setSchemePrefs(next);
  storeSettings();
  editor.requestOverlay();
}

/**
 * Scheme > Number Compounds: ID labels under the selected structures (or all), in scheme order,
 * counted as chosen; copies of one structure share an ID. Labels are tied to their structures.
 */
async function numberCompounds(): Promise<void> {
  const next = editor.sel.atoms.size ? editor.nextCompoundNumber() : 1;
  const startText = idText(numbering.style, next, 0).replace(/^\d+(?=[a-z])/, '');
  const got = await ask('Number Compounds', [
    { name: 'style', label: 'Count', value: numbering.style, options: [
      { value: 'numbers', label: '1, 2, 3 …' }, { value: 'letters', label: '1a, 1b, 1c …' }, { value: 'lower', label: 'a, b, c …' },
      { value: 'upper', label: 'A, B, C …' }, { value: 'roman', label: 'i, ii, iii …' }, { value: 'ROMAN', label: 'I, II, III …' }] },
    { name: 'start', label: 'Start at', value: numbering.style === 'letters' ? String(next) : startText, type: 'text', placeholder: '1, c or iii' },
    { name: 'prefix', label: 'Before each', value: numbering.prefix, type: 'text', placeholder: 'e.g. S for S1, S2' },
    { name: 'suffix', label: 'After each', value: numbering.suffix, type: 'text', placeholder: 'e.g. ′' },
    { name: 'bold', label: 'Bold', value: String(numbering.bold), type: 'checkbox' },
    { name: 'same', label: 'Same structure, same ID', value: String(numbering.same), type: 'checkbox' },
    { name: 'old', label: 'IDs already there', value: 'renumber', options: [{ value: 'renumber', label: 'Number again' }, { value: 'keep', label: 'Keep' }] },
    { name: 'reagents', label: 'Reagents over arrows', value: 'skip', options: [{ value: 'skip', label: 'Leave unnumbered' }, { value: 'number', label: 'Number them too' }] },
  ], { ok: 'Number', note: 'Puts an ID under each selected structure (or every structure), following the arrows of a scheme, else left to right and top to bottom. Each is tied to its structure and is ordinary text you can change. For 1a, 1b, “Start at” is the number.' });
  if (!got) return;
  const style = got.style as IdStyle;
  const start = parseIdStart(got.start, style);
  if (start === null) { flash(`“${got.start}” isn't a place to start counting ${style === 'roman' || style === 'ROMAN' ? 'in roman numerals' : style === 'lower' || style === 'upper' ? 'in letters' : 'from'}.`); return; }
  Object.assign(numbering, { style, prefix: got.prefix, suffix: got.suffix, bold: got.bold === 'true', same: got.same === 'true' });
  let keyOf: ((atoms: number[]) => string | undefined) | undefined;
  if (numbering.same) {
    const keys = await structureKeys();
    keyOf = (atoms) => keys.get(atoms[0]);
  }
  const n = editor.numberCompounds({ start: Math.max(0, start), style, prefix: got.prefix, suffix: got.suffix, bold: numbering.bold, keep: got.old === 'keep', reagents: got.reagents === 'number', keyOf });
  if (!n) flash('No structures to number.');
}

/**
 * Structure > Add ID Label and Add Caption: text centred under each chosen structure, tied to
 * it, then typing straight away. An ID label is the next compound number (or the ID a copy of
 * the structure already has).
 */
async function addTiedText(role: 'label' | 'caption'): Promise<void> {
  const frags = chosenStructures();
  if (!frags.length) { flash('Select a structure first.'); return; }
  const m = editor.measure();
  // copies already labelled keep their ID
  const keys = role === 'label' && numbering.same ? await structureKeys() : new Map<number, string>();
  const known = new Map<string, string>();
  if (keys.size) {
    for (const c of doc.captions.values()) {
      if (c.attach?.role !== 'label') continue;
      const k = c.attach.atoms.map((a) => keys.get(a)).find((x) => x);
      if (k) known.set(k, plainText(c.runs).trim());
    }
  }
  // new IDs count on in the style Number Compounds last used, skipping any already in use
  const inUse = new Set([...doc.captions.values()].filter((c) => c.attach?.role === 'label').map((c) => plainText(c.runs).trim()));
  const base = numbering.style === 'numbers' || numbering.style === 'letters' ? editor.nextCompoundNumber() : 1;
  let k = 0;
  const freshId = () => {
    let t: string;
    do t = idText(numbering.style, base, k++, numbering.prefix, numbering.suffix); while (inUse.has(t));
    inUse.add(t);
    return t;
  };
  const made: number[] = [];
  doc.edit(role === 'label' ? 'Add ID label' : 'Add caption', () => {
    for (const f of frags) {
      const k = keys.get([...f][0]);
      const text = role === 'caption' ? '' : (k && known.get(k)) || freshId();
      if (k && role === 'label' && !known.has(k)) known.set(k, text);
      const c = doc.addCaption({ x: 0, y: 0, runs: [{ text, bold: role === 'label' && numbering.bold ? true : undefined }], justify: 'center',
        attach: { atoms: [...f], side: 'below', gap: defaultGap(doc), shift: 0, role } });
      placeAttached(doc, c, m);
      made.push(c.id);
    }
  });
  editor.changed();
  // type into the first (the others are selected, to style together)
  if (made.length === 1) editor.typeInto(made[0]);
  else { editor.clearSelection(); for (const id of made) editor.sel.captions.add(id); editor.changed(); }
}

// ---------------------------------------------------------------- labels that clash

/** Captions whose compound label is also used for a different structure, with the warning to show. */
let labelWarnings = new Map<number, string>();
let labelWarnVersion = 0, labelCheckTimer = 0, labelCheckedAt = -1;

/** Look for one ID used under different structures (shortly after each change). */
function scheduleLabelCheck(): void {
  if (labelCheckedAt === doc.version) return;
  clearTimeout(labelCheckTimer);
  labelCheckTimer = window.setTimeout(() => void checkLabels(), 400);
}

async function checkLabels(): Promise<void> {
  const version = doc.version;
  const items = schemeItems(doc, editor.measure());
  const labels = labelsOf(items, new Set(), doc, doc.style.bondLength);
  let found = new Map<number, string>();
  if (labels.size > 1) {
    const keys = await structureKeys();
    if (doc.version !== version) { scheduleLabelCheck(); return; }
    const list: { caption: number; text: string; key?: string }[] = [];
    for (const [it, caps] of labels) {
      for (const c of caps) {
        const cap = doc.captions.get(c.caption!);
        if (cap && !cap.ignoreWarnings) list.push({ caption: cap.id, text: plainText(cap.runs), key: keys.get(it.atoms[0]) });
      }
    }
    found = labelClashes(list);
  }
  labelCheckedAt = version;
  const same = found.size === labelWarnings.size && [...found].every(([k, v]) => labelWarnings.get(k) === v);
  if (!same) { labelWarnings = found; labelWarnVersion++; updateWarnings(); }
}

editor.askChainLength = async (last) => {
  const got = await ask('Chain', [{ name: 'n', label: 'Number of atoms', value: String(last), type: 'number' }],
    { ok: 'Draw', note: 'Clicked on an atom, the chain adds this many atoms to it. Alt+click draws the same number again without asking.' });
  const n = got ? Math.round(Number(got.n)) : NaN;
  return n >= 1 ? n : null;
};

// ---------------------------------------------------------------- your own templates and nicknames

/** Nicknames the person defined (kept in the settings file). */
let ownNicknames: Record<string, string> = {};

/** Put these templates in the My templates palette. */
function useOwnTemplates(list: Template[]): void {
  setOwnTemplates(list);
  for (const name of Object.keys(TOOLS)) if (name.startsWith('tpl-own-')) delete TOOLS[name];
  for (const t of ownTemplates()) TOOLS[`tpl-${t.id}`] = { kind: 'template', id: t.id };
  OWN_PALETTE.items = [OWN_PALETTE.items[0], ...ownTemplates().map((t) => ({ name: `tpl-${t.id}`, title: t.name }))];
  toolbar.refreshTitles();
}

/** Structure > Save as Template: the selected structure goes into My templates. */
async function saveTemplate(): Promise<void> {
  const ids = [...editor.sel.atoms];
  if (!ids.length) { flash('Select a structure first, then save it as a template.'); return; }
  const got = await ask('Save as Template', [{ name: 'name', label: 'Name', value: '' }],
    { ok: 'Save', note: 'The selected structure goes into My templates on the tool bar (the last template palette). It is kept in your settings file, so it is there every time.' });
  const name = got?.name.trim();
  if (!name) return;
  const t = templateFromAtoms(doc, ids, name, `own-${Date.now().toString(36)}`);
  if (!t) { flash('Nothing to save: select atoms and bonds.'); return; }
  useOwnTemplates([...ownTemplates(), t]);
  storeSettings();
  editor.setTool(`tpl-${t.id}`);
  flash(`Saved “${name}” in My templates. Click to place it, a bond to fuse it, or an atom to join it.`, 6000);
}

/** Structure > Delete Template…: take one of your own templates away. */
async function deleteTemplate(): Promise<void> {
  const list = ownTemplates();
  if (!list.length) { flash('You have no templates of your own yet (Structure > Save as Template).'); return; }
  const got = await ask('Delete Template', [{ name: 'id', label: 'Template', value: list[list.length - 1].id, options: list.map((t) => ({ value: t.id, label: t.name })) }], { ok: 'Delete' });
  if (!got) return;
  useOwnTemplates(list.filter((t) => t.id !== got.id));
  if (editor.toolName === `tpl-${got.id}`) editor.setTool('bond-single');
  storeSettings();
}

/** Structure > Define Nickname…: the selected group gets a name that can be typed as a label. */
async function defineNickname(): Promise<void> {
  const g = selectedGroup(doc, editor.sel.atoms);
  if ('error' in g) { flash(g.error, 6000); return; }
  const got = await ask('Define Nickname', [{ name: 'name', label: 'Nickname', value: '' }],
    { ok: 'Define', note: `Select a group that hangs off a structure by one bond. Its nickname can then be typed as an atom label (like Boc or TBS), with the formula and mass worked out. The group is ${g.smiles}.` });
  const name = got?.name.trim();
  if (!name) return;
  if (isBuiltInNickname(name)) { flash(`“${name}” is already a nickname. Choose another name.`, 6000); return; }
  if (/\s/.test(name)) { flash('A nickname can\'t have spaces in it.'); return; }
  ownNicknames = { ...ownNicknames, [name]: g.smiles };
  addNicknames({ [name]: g.smiles });
  storeSettings();
  flash(`“${name}” can now be typed as a label.`, 5000);
}

/** Structure > Delete Nickname…: take one of your own nicknames away. */
async function deleteNickname(): Promise<void> {
  const names = Object.keys(ownNicknames);
  if (!names.length) { flash('You have no nicknames of your own yet (Structure > Define Nickname).'); return; }
  const got = await ask('Delete Nickname', [{ name: 'name', label: 'Nickname', value: names[0], options: names.map((n) => ({ value: n, label: `${n}  (${ownNicknames[n]})` })) }], { ok: 'Delete' });
  if (!got) return;
  const { [got.name]: _, ...rest } = ownNicknames;
  ownNicknames = rest;
  removeNickname(got.name);
  renderer.repaintAll();
  editor.requestScene();
  storeSettings();
}

/** Structure > Contract Label…: fold the selected group into one label (Undo opens it again). */
/**
 * Structure > Expand Label: the selected labels drawn out as atoms and bonds. Ligands on a
 * metal come from their templates; other abbreviations are laid out by the chemistry engine.
 */
async function expandLabel(): Promise<void> {
  const list = editor.expandableLabels();
  if (!list.length) { flash('Select a label to expand: an abbreviation such as OMe, Boc or CO2Et, or a ligand on a metal such as PPh3, dppe or Cp*.', 6000); return; }
  const mbs = new Map<number, string>();
  const failed: string[] = [];
  for (const x of list) {
    if (x.template) continue;
    const mb = x.smiles ? await chem.smilesToMol((doc.degree(x.id) ? '*' : '') + x.smiles) : null;
    if (mb) mbs.set(x.id, mb);
    else failed.push(doc.atoms.get(x.id)?.label ?? '');
  }
  const n = editor.expandLabels(list, mbs);
  if (failed.length) flash(`Not expanded (not read as chemistry): ${failed.map((f) => `“${f}”`).join(', ')}`, 6000);
  else if (!n) flash('Nothing to expand.');
}

async function contractLabel(): Promise<void> {
  const g = selectedGroup(doc, editor.sel.atoms);
  if ('error' in g) { flash(g.error, 6000); return; }
  const got = await ask('Contract Label', [{ name: 'name', label: 'Label', value: '' }],
    { ok: 'Contract', note: 'The selected group becomes one label with this name. The formula and mass still count the whole group, and ChemDraw sees the group inside the label.' });
  if (!got) return;
  const err = editor.contractLabel(got.name);
  if (err) flash(err, 6000);
}

const arrangeDialog = new ArrangeDialog({ apply: (o) => editor.arrangeScheme(o), undo: () => editor.undo() });
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
  if (got.warnings.length) flash('Note: ' + got.warnings.join(' '), 9000);
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
  else if (notes.length) flash('Note: ' + notes.join(' '), 9000);
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
const presenterView = new PresenterView();

/** View > Mode Colours: blue for drawings, orange for slides, green for sheets, or the person's own colours. */
let modeColours: ModeColours = { ...DEFAULT_MODE_COLOURS };
// Each mode keeps its own tool: slides start with Select (click a placeholder to type), drawings
// and structures drawn for sheet cells with a bond.
const modeTool: Record<Tab['mode'], string> = { drawing: 'bond-single', slides: 'select', sheet: 'bond-single', document: 'bond-single', design: 'select' };

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
  pages: (t) => paragraphPages.get(t),
  picture: async (contents, style) => {
    const d = structureDoc(contents, style);
    const pic = recordPicture(d, FIGURE_MARGIN);
    if (!pic) return null;
    const png = new Uint8Array(await (await canvasPng(pictureCanvas(d, pic).canvas)).arrayBuffer());
    return { png, svg: pictureSvg(pic), w: pic.box.x2 - pic.box.x1, h: pic.box.y2 - pic.box.y1 };
  },
  svgToPng,
  fonts: bundledFaces,
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
  remember: (path) => rememberFile(path),
  leave: (tab) => {
    finishTyping();
    if (tab.mode === 'sheet') sheetMode.leave();
    if (tab.mode === 'document') docMode.leave();
    modeTool[tab.mode] = editor.toolName;
    editor.cropping = null;
    (ws.pane ?? tab).view = { ...renderer.view };
    if (tab.deck) { tab.deck.onChange = () => {}; tab.deck.onSwitch = () => {}; tab.deck.onMotion = () => {}; }
  },
  enter: (tab, opened) => enterTab(tab, opened),
  changed: () => { renderTabs(); updateTitle(); layoutSplit(); },
  flash,
  pptx: pptxOptions(),
  measure: measureText,
  sheets: {
    read: (bytes, name) => readSheetFile(bytes, name, sheetFiles),
    write: (book, name) => writeSheetFile(book, name, sheetFiles),
  },
  documents: {
    read: (bytes) => readDocx(bytes, docRead),
    write: (d) => writeDocx(d, docFiles),
  },
  newStyle: (mode) => { const n = modeStyles[mode]; return n ? styleNamed(n, ownStyles) ?? null : null; },
  newMaster: (m) => { const t = SLIDE_TEMPLATES.find((x) => x.id === slideTemplate); return t && t.id !== 'plain' ? applyTemplate(m, t) : null; },
});

/** How slides are saved for PowerPoint: structures as pictures (PNG and SVG), the bundled fonts inside. */
function pptxOptions(): PptxOptions {
  return {
    picture: async (d) => {
      const pic = recordPicture(d, 1);
      if (!pic) return null;
      const png = new Uint8Array(await (await canvasPng(pictureCanvas(d, pic).canvas)).arrayBuffer());
      return { svg: pictureSvg(pic), png, box: pic.box };
    },
    svgToPng,
    fonts: bundledFaces,
  };
}

/** The slide deck showing (in Slides mode), or null for a drawing. */
function deckNow(): Deck | null {
  return ws.active.deck ?? null;
}

/** Finish typing in a caption or the notes (and drawing a structure for a cell), before the slide or tab changes. */
function finishTyping(): void {
  finishCellStructure(true);
  editor.closeCaption();
  flushNotes();
}

/** Set the window up for a tab that has just come to the front. */
function enterTab(tab: Tab, opened: boolean): void {
  if (slideSplit && tab !== slideSplit.partner) slideSplit = null;
  splitDrawing = false;
  const deck = tab.deck;
  const design = tab.mode === 'design';
  const slides = !!deck && !design;
  const sheet = tab.mode === 'sheet';
  const words = tab.mode === 'document';
  document.body.classList.toggle('slides-mode', slides);
  document.body.classList.toggle('design-mode', design);
  editor.glueArrows = design;
  layers?.show(design ? doc : null);
  showGuides();
  if (deck) deck.onMotion = () => { animUi?.refresh(); ws.noteChange(); renderer.repaintAll(); editor.requestScene(); };
  if (deck) deck.onComments = () => { slideCmts?.update(); ws.noteChange(); };
  editor.textFirst = !!deck;
  editor.structuresLocked = slides && structuresLocked;
  for (const el of document.querySelectorAll<HTMLElement>('.design-only')) el.hidden = !design;
  document.body.classList.toggle('sheet-mode', sheet);
  document.body.classList.toggle('doc-mode', words);
  placeSidePanel();
  tickToolboxes();
  applyModeColours(tab.mode, modeColours);
  for (const el of document.querySelectorAll<HTMLElement>('.slides-only')) el.hidden = !slides;
  showSheetParts();
  editor.paused = sheet || words;
  sheetMode.show(sheet ? tab : null);
  docMode.show(words ? tab : null);
  renderer.screen = !!deck;
  renderer.page = deck ? slidePage : null;
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
    slideList.show(design ? null : deck);
    if (design) showDesignState();
    notesBox.value = deck.current?.notes ?? '';
    showSlideState();
  } else slideList.show(null);
  animUi?.update();
  slideCmts?.slideChanged();
  layoutSplit();
  // the slide list and notes take room from the drawing area
  resize();
  const viewOf = ws.pane ?? tab;
  if (viewOf.view && (!opened || ws.pane)) renderer.view = { ...viewOf.view };
  else if (ws.pane || slideSplit) fitSplitDrawing();
  else editor.fit();
  renderer.repaintAll();
  editor.clearSelection();
  editor.frame(true);
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
  if (sheet && !splitDrawing) $('#hint').textContent = SHEET_HINT;
  else if (words && !splitDrawing) $('#hint').textContent = DOC_HINT;
  else editor.onToolChange(editor.toolName);
}

/** The slide's background, logo, number and footer, drawn under its drawing. */
const slidePage = {
  draw(ctx: CanvasRenderingContext2D): void {
    const d = deckNow();
    if (!d?.current) return;
    drawSlidePage(ctx, { size: d.size, master: d.master, layout: d.current.layout, index: d.index }, SURROUND);
    if (ws.active.mode === 'design' && designGrid.on) drawGrid(ctx, d.size, designGrid.step);
    if (ws.active.mode === 'slides') animUi?.drawMarkers(ctx, renderer.view.scale);
    // (the comment markers are over the drawing, and follow it as it moves)
    if (ws.active.mode === 'slides') slideCmts?.place();
  },
};

// The slide list is rebuilt when slides come, go or move; otherwise only the slide being
// edited gets a new picture.
let listKey = '';
let masterSeen: unknown = null;
let indexSeen = -1;
const slideListKey = (d: Deck) => `${d.slides.map((s) => s.id + (s.notes.trim() ? 'n' : '')).join(',')}|${d.size.w}x${d.size.h}`;

function deckChanged(deck: Deck): void {
  const key = slideListKey(deck);
  if (key !== listKey || masterSeen !== deck.master) {
    listKey = key;
    masterSeen = deck.master;
    indexSeen = deck.index;
    slideList.rebuild();
  } else if (deck.index !== indexSeen) {
    // going to another slide moves the highlight; no picture needs drawing again
    indexSeen = deck.index;
    slideList.switched();
  } else slideList.refresh();
  showSlideState();
  if (ws.active.mode === 'design') showDesignState();
  ws.noteChange();
}

function slideSwitched(deck: Deck): void {
  editor.cropping = null;
  editor.lastEdited = null;
  notesBox.value = deck.current?.notes ?? '';
  renderer.repaintAll();
  editor.requestScene();
  editor.clearSelection();
  animUi?.slideChanged();
  slideCmts?.slideChanged();
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

// ---------------------------------------------------------------- transitions and animations (Slides mode)

animUi = new AnimationUI($('#ribbon'), $('#anim-section'), {
  deck: () => (ws.active.mode === 'slides' ? deckNow() : null),
  doc: () => doc,
  selection: () => {
    const s = editor.sel;
    const typing = renderer.hiddenCaption;
    return typing === null ? s : { ...s, captions: new Set([...s.captions, typing]) };
  },
  select: (sel) => editor.selectThese(sel),
  finishTyping,
  flash,
  repaint: () => { renderer.repaintAll(); editor.requestScene(); },
});

slideCmts = new SlideComments($('#cmt-section'), $('#canvas-host'), {
  deck: () => (ws.active.mode === 'slides' ? deckNow() : null),
  anchor: () => {
    const s = editor.sel;
    const b = s.atoms.size + s.captions.size + s.arrows.size + s.shapes.size ? selectionBox(doc, s, POINTS) : null;
    return b ? { x: b.x2 + 4, y: b.y1 } : null;
  },
  view: () => renderer.view,
  askName: () => docMode.askReviewName(),
  flash,
  focus: () => $('#overlay').focus(),
});

// ---------------------------------------------------------------- Design mode

layers = new LayersPanel($('#layers-section'), {
  select: (ids) => editor.selectShapes(ids),
  selected: () => editor.selectedShapes(),
  edit: (label, f) => { finishTyping(); doc.edit(label, f); editor.changed(); },
});
const lib = (designLib = new DesignLibrary($('#design-lib'), (id) => { finishTyping(); editor.setTool(`geo:${id}`); }));
const designGrid = { on: false, step: 18 };
const dzBg = $<HTMLInputElement>('#dz-bg');
const dzGrid = $<HTMLInputElement>('#dz-grid');
const dzStep = $<HTMLSelectElement>('#dz-grid-step');
dzGrid.addEventListener('change', () => { designGrid.on = dzGrid.checked; renderer.repaintAll(); editor.requestScene(); });
dzStep.addEventListener('change', () => { designGrid.step = Number(dzStep.value) || 18; dzGrid.checked = designGrid.on = true; renderer.repaintAll(); editor.requestScene(); });
dzStep.value = String(designGrid.step);
const dzGuides = $<HTMLInputElement>('#dz-guides');
dzGuides.checked = guidesOn.design;
dzGuides.addEventListener('change', () => { guidesOn.design = dzGuides.checked; showGuides(); storeSettings(); });
dzBg.addEventListener('change', () => {
  const d = deckNow();
  if (!d || d.master.background.toLowerCase() === dzBg.value.toLowerCase()) return;
  finishTyping();
  d.setMaster({ ...d.master, background: dzBg.value });
});

/** The Design ribbon shows the page's size and background. */
function showDesignState(): void {
  const d = deckNow();
  if (!d) return;
  $('#dz-size').textContent = sizeLabel(d.size);
  if (/^#[0-9a-f]{6}$/i.test(d.master.background)) dzBg.value = d.master.background;
}

/** Light lines across the page to line things up by (on screen only). */
function drawGrid(ctx: CanvasRenderingContext2D, size: SlideSize, step: number): void {
  const k = renderer.view.scale;
  // too close together to see: every second (fourth…) line instead
  let s = step;
  while (s * k < 6) s *= 2;
  ctx.save();
  ctx.lineWidth = 1 / k;
  ctx.strokeStyle = 'rgba(80, 110, 170, 0.22)';
  ctx.beginPath();
  for (let x = s; x < size.w - 1e-6; x += s) { ctx.moveTo(x, 0); ctx.lineTo(x, size.h); }
  for (let y = s; y < size.h - 1e-6; y += s) { ctx.moveTo(0, y); ctx.lineTo(size.w, y); }
  ctx.stroke();
  ctx.restore();
}

async function newDesign(): Promise<void> {
  finishTyping();
  const t = await pickTemplate();
  if (t === 'blank') {
    const size = await pickDesignSize('New Design: page size');
    if (size) ws.newDesign(size);
  } else if (t) {
    ws.newDesign(templateSize(t), (d) => fillTemplate(d, t));
    editor.fit();
  }
}

async function designSize(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'design') { flash('Page Size is for designs: use File > New Design.'); return; }
  finishTyping();
  const size = await pickDesignSize('Page size', d.size);
  if (size && deckNow() === d) {
    d.setSize(size);
    editor.fit();
  }
}

// a shape dragged from the library onto the page
host.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes(GEO_DRAG_TYPE)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
host.addEventListener('drop', (e) => {
  const id = e.dataTransfer?.getData(GEO_DRAG_TYPE);
  if (!id) return;
  e.preventDefault();
  e.stopPropagation();
  const r = host.getBoundingClientRect();
  editor.placeGeo(id, renderer.toDoc(e.clientX - r.left, e.clientY - r.top));
  overlay.focus();
});

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

/** Each kind of tab's picture (white on its mode's colour), so they tell apart at a glance. */
const tabSvg = (body: string) => `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">${body}</svg>`;
const TAB_ICONS: Record<Tab['mode'], [string, string]> = {
  // a hexagon (a ring), a page of lines, a screen, a grid, and a pen nib over shapes
  drawing: [tabSvg('<polygon points="8,2 13.2,5 13.2,11 8,14 2.8,11 2.8,5"/>'), 'Drawing'],
  document: [tabSvg('<path d="M4 2.5h6l2.5 2.5v8.5h-8.5z"/><path d="M6 7.5h4.5M6 10h4.5"/>'), 'Document'],
  slides: [tabSvg('<rect x="2" y="3" width="12" height="8.5" rx="1"/><path d="M8 11.5V14M5.5 14h5"/>'), 'Slides'],
  sheet: [tabSvg('<rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M2.5 6.5h11M2.5 10h11M6.5 2.5v11"/>'), 'Sheet'],
  design: [tabSvg('<circle cx="5" cy="11" r="2.6"/><rect x="8.3" y="2.5" width="5.2" height="5.2" rx="0.6"/><path d="M3 4.5l3-2.2 1.5 3.4z"/>'), 'Design'],
};

function renderTabs(): void {
  const items = ws.tabs.map((t) => {
    const el = document.createElement('div');
    el.className = `tab tab-${t.mode}${t === ws.active ? ' active' : ''}${t.dirty ? ' dirty' : ''}`;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t === ws.active));
    el.title = (t.ref.kind === 'path' ? t.ref.path : t.name) + (t.dirty ? ' (not saved)' : '');
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = TAB_ICONS[t.mode][0];
    icon.title = TAB_ICONS[t.mode][1];
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
    el.addEventListener('click', () => { if (!tabDragged) ws.activate(t); });
    el.addEventListener('pointerdown', (e) => dragTab(e, el, t));
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
  tabsEl.replaceChildren(...items, add('+ Drawing', 'New drawing', 'new'), add('+ Slides', 'New slides', 'new-slides'), add('+ Sheet', 'New sheet', 'new-sheet'), add('+ Document', 'New document', 'new-document'), add('+ Design', 'New design: a TOC graphic, graphical abstract, poster, flowchart or figure', 'new-design'));
  tabsEl.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

// Tabs are dragged along the strip to put them in another order (as in browsers).
let tabDragged = false;
function dragTab(e: PointerEvent, el: HTMLElement, t: Tab): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return;
  tabDragged = false;
  const startX = e.clientX;
  const tabs = [...tabsEl.querySelectorAll<HTMLElement>('.tab')];
  const from = tabs.indexOf(el);
  let to = from;
  const move = (ev: PointerEvent) => {
    const dx = ev.clientX - startX;
    if (!tabDragged) {
      if (Math.abs(dx) < 6) return;
      tabDragged = true;
      el.setPointerCapture(ev.pointerId);
      el.classList.add('tab-dragging');
    }
    el.style.transform = `translateX(${dx}px)`;
    // the place it would go: past every tab whose middle it has crossed
    const mid = el.getBoundingClientRect().left + el.offsetWidth / 2;
    to = from;
    tabs.forEach((o, i) => {
      if (o === el) return;
      const r = o.getBoundingClientRect(), m = r.left + r.width / 2;
      if (i < from && mid < m) to = Math.min(to, i);
      if (i > from && mid > m) to = Math.max(to, i);
    });
    tabs.forEach((o, i) => {
      if (o === el) return;
      const shift = from < to && i > from && i <= to ? -el.offsetWidth : from > to && i >= to && i < from ? el.offsetWidth : 0;
      o.style.transform = shift ? `translateX(${shift}px)` : '';
    });
  };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    if (!tabDragged) return;
    for (const o of tabs) { o.style.transform = ''; o.classList.remove('tab-dragging'); }
    if (to !== from) ws.moveTab(t, to);
    // the click that ends a drag doesn't switch tabs
    setTimeout(() => { tabDragged = false; }, 0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
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

/** Ask for a BibTeX or RIS file of references, and read its text. */
async function pickReferenceFile(): Promise<{ name: string; text: string } | null> {
  const f = await openBytesDialog('BibTeX or RIS references', [], ['bib', 'ris', 'txt']);
  if (!f) return null;
  return { name: f.name, text: new TextDecoder().decode(f.bytes).replace(/^\uFEFF/, '') };
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
  // WebP goes in as PNG, so it can be saved in Word and PowerPoint files
  if (mime === 'image/webp') {
    void webpToPng(bytes).then((png) => (png ? placePicture(png, 'image/png', at) : flash('Could not read this WebP picture.')));
    return;
  }
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

/** Picture > Remove white: near-white pixels become see-through (the picture becomes a PNG). */
async function removeWhite(ids: number[]): Promise<void> {
  const v = await ask('Remove White Background', [
    { name: 'which', label: 'Remove', value: 'edges', options: [
      { value: 'edges', label: 'White joined to the edges (keeps white inside the picture)' },
      { value: 'all', label: 'All white, everywhere' },
    ] },
    { name: 'tol', label: 'How near white counts', value: '24', type: 'number', unit: 'of 255' },
  ], { ok: 'Remove', note: 'Raise the number if a grey haze is left round the picture; lower it if pale parts of the picture disappear. Undo puts it back.' });
  if (!v) return;
  const tol = Math.max(0, Math.min(200, Number(v.tol) || 0));
  const done: { id: number; src: string }[] = [];
  for (const id of ids) {
    const s = doc.shapes.get(id);
    if (!s?.src) continue;
    try {
      const img = await loadImage(s.src);
      const c = document.createElement('canvas');
      c.width = img.naturalWidth; c.height = img.naturalHeight;
      const g = c.getContext('2d')!;
      g.drawImage(img, 0, 0);
      const data = g.getImageData(0, 0, c.width, c.height);
      whiteToClear(data.data, c.width, c.height, tol, v.which !== 'all');
      g.putImageData(data, 0, 0);
      done.push({ id, src: dataUrl(new Uint8Array(await (await canvasPng(c)).arrayBuffer()), 'image/png') });
    } catch (e) {
      await showError(`Could not change the picture: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
  }
  if (!done.length) return;
  doc.edit('Remove white', () => { for (const d of done) doc.updateShape(d.id, { src: d.src }); });
  editor.requestScene();
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

// ---------------------------------------------------------------- File > Drawing Style

const STYLE_KINDS: Record<StyleMode, { plural: string; where: string }> = {
  drawing: { plural: 'drawings', where: 'this drawing' },
  slides: { plural: 'slide decks', where: 'every slide of this deck' },
  design: { plural: 'designs', where: 'this design' },
  document: { plural: 'documents', where: 'this document' },
  sheet: { plural: 'sheets', where: 'this workbook\'s structure cells' },
};

/** Pick or change how structures are drawn in the tab showing (a journal's style, or your own). */
async function drawingStyleDialog(): Promise<void> {
  const tab = ws.active, mode = tab.mode as StyleMode;
  finishTyping();
  const deck = tab.deck, book = tab.book, file = tab.document;
  const current = deck ? deck.master.drawing : book ? book.drawingStyle : file ? file.t.drawingStyle : doc.style;
  const hasStructures = deck ? deck.slides.some((_, i) => deck.docOf(i).atoms.size > 0)
    : file ? Object.values(file.t.objects).some((o) => o.kind === 'drawing' && o.contents.atoms.length > 0)
    : book ? false : doc.atoms.size > 0 || doc.captions.size > 0;
  const got = await editDrawingStyle({
    current, own: ownStyles, kindPlural: STYLE_KINDS[mode].plural, where: STYLE_KINDS[mode].where,
    isDefault: modeStyles[mode] !== undefined && modeStyles[mode] === current.name, hasStructures,
  });
  if (!got || ws.active !== tab) return;
  ownStyles = got.own;
  if (got.forNew) modeStyles[mode] = got.style.name;
  else if (modeStyles[mode] === current.name || modeStyles[mode] === got.style.name) delete modeStyles[mode];
  if (modeStyles[mode] && !styleNamed(modeStyles[mode]!, ownStyles)) {
    // a default that isn't a built-in style is kept as one of your own, so new tabs can find it
    ownStyles = [...ownStyles, { ...got.style }];
  }
  storeSettings();
  const next = got.style;
  if (deck) deck.setDrawingStyle(next, got.how);
  else if (book) {
    book.drawingStyle = { ...next };
    book.edits++;
    sheetMode.styleChanged();
  } else if (file) {
    const t = file.t, old = t.drawingStyle;
    const objects = { ...t.objects };
    for (const [k, o] of Object.entries(objects)) if (o.kind === 'drawing') objects[Number(k)] = { ...o, contents: restyleContents(o.contents, old, next, got.how) };
    const changed: DocText = { ...t, objects, drawingStyle: { ...next } };
    file.ed.update(changed, 'Drawing style');
    docMode.fontsChanged();
  } else {
    doc.edit(`Drawing style: ${next.name}`, () => applyStyle(doc, next, got.how));
    editor.changed();
  }
  flash(`Structures are now drawn in ${next.name}${got.forNew ? `, and new ${STYLE_KINDS[mode].plural} will start in it` : ''}.`, 4000);
}

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

/** Design > Templates: a ready-made look for every slide, and optionally for new decks too. */
let slideTemplate: string | null = null;
async function slideTemplates(): Promise<void> {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  const got = await pickSlideTemplate(d.master, d.size, slideTemplate);
  if (!got) return;
  if (deckNow() === d) d.setMaster(applyTemplate(d.master, got.template));
  if (got.forNew) {
    slideTemplate = got.template.id;
    storeSettings();
    flash(`New slide decks will start with ${got.template.name}. Pick Plain to go back.`);
  }
}

function present(fromHere: boolean, notes = false): void {
  const d = deckNow();
  if (!d) { flash('Present shows slides: use File > New Slides, or open a PowerPoint file.'); return; }
  if (presenter.running || presenterView.running) return;
  finishTyping();
  editor.paused = true;
  void (notes ? presenterView : presenter).start(d, fromHere ? d.index : 0);
}

presenter.onEnd = presenterView.onEnd = (i) => {
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

// ---------------------------------------------------------------- printing

/** The choices made in the Print window, kept while the app is open. */
const printChoices = { paper: defaultPaper(navigator.language) as string, orient: 'auto', size: 'actual', handout: '1', frame: 'true', sheet: 'all', sheetOrient: 'portrait', grid: 'false' };
const PAPER_OPTIONS = Object.entries(PAPERS).map(([value, p]) => ({ value, label: p.name }));

const pageSvgOf = (p: PdfPage) => {
  const x = p.origin?.x ?? 0, y = p.origin?.y ?? 0;
  return itemsToSvg(p.items, { x1: x, y1: y, x2: x + p.w, y2: y + p.h });
};

/** File > Print (Ctrl+P): asks how, for drawings, slides and sheets, then opens the system's Print dialog. */
async function printNow(): Promise<void> {
  finishTyping();
  const tab = ws.active, deck = tab.deck;
  if (sheetActive()) {
    const v = await ask('Print', [
      { name: 'sheet', label: 'Print', value: printChoices.sheet, options: [{ value: 'all', label: 'The whole sheet' }, { value: 'sel', label: 'The selected cells' }] },
      { name: 'sheetOrient', label: 'Orientation', value: printChoices.sheetOrient, options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
      { name: 'grid', label: 'Gridlines', value: printChoices.grid, type: 'checkbox' },
    ], { ok: 'Print…', note: 'The paper size, copies and pages are chosen in the next window.' });
    if (!v) return;
    Object.assign(printChoices, v);
    const html = sheetMode.printTable(v.sheet === 'sel');
    if (!html) { flash('There is nothing in this sheet to print.'); return; }
    printPages({ html: `<div class="${v.grid === 'true' ? 'grid' : ''}">${html}</div>`, landscape: v.sheetOrient === 'landscape' });
    return;
  }
  const docFile = docActive() ? tab.document : null;
  if (docFile) {
    // the pages as laid out on screen
    const pages = recordPages(docFile.t, docFile.layout(), (c, style) => figures.record(c, style).pic);
    if (!pages.length) return;
    printPages({ pages: pages.map(pageSvgOf), w: pages[0].w, h: pages[0].h });
    return;
  }
  if (deck) {
    const slide = (i: number) => itemsToSvg(recordSlide({ size: deck.size, master: deck.master, layout: deck.slides[i].layout, index: i }, deck.docOf(i)), { x1: 0, y1: 0, x2: deck.size.w, y2: deck.size.h });
    if (tab.mode === 'design') { printPages({ pages: [slide(deck.index)], w: deck.size.w, h: deck.size.h }); return; }
    const v = await ask('Print', [
      { name: 'handout', label: 'Layout', value: printChoices.handout, options: [
        { value: '1', label: 'Full page slides' }, { value: '2', label: 'Handouts: 2 slides a page' }, { value: '3', label: 'Handouts: 3 slides a page, with lines for notes' },
        { value: '4', label: 'Handouts: 4 slides a page' }, { value: '6', label: 'Handouts: 6 slides a page' }, { value: '9', label: 'Handouts: 9 slides a page' },
      ] },
      { name: 'paper', label: 'Paper (handouts)', value: printChoices.paper, options: PAPER_OPTIONS },
      { name: 'frame', label: 'Frame the slides (handouts)', value: printChoices.frame, type: 'checkbox' },
    ], { ok: 'Print…', note: 'Full page slides print at the slide\'s own shape; the next window fits them to the paper. Copies and which pages are chosen there too.' });
    if (!v) return;
    Object.assign(printChoices, v);
    const n = Number(v.handout);
    if (n === 1) { printPages({ pages: deck.slides.map((_, i) => slide(i)), w: deck.size.w, h: deck.size.h }); return; }
    const page = orient(PAPERS[v.paper] ?? PAPERS.letter, 'portrait');
    const cells = handoutCells(page, n);
    const pages: string[] = [];
    for (let first = 0; first < deck.slides.length; first += n) {
      const parts: string[] = [];
      cells.forEach((cell, k) => {
        const i = first + k;
        if (i >= deck.slides.length) return;
        const at = placeIn(deck.size.w, deck.size.h, cell, 'fit');
        parts.push(placeSvg(slide(i), at));
        if (v.frame === 'true') parts.push(`<rect x="${at.x}" y="${at.y}" width="${at.w}" height="${at.h}" fill="none" stroke="#888" stroke-width="0.5"/>`);
        if (n === 3) for (const l of noteLines({ ...cell, h: at.h, y: at.y }, page)) parts.push(`<line x1="${l.x1}" x2="${l.x2}" y1="${l.y}" y2="${l.y}" stroke="#bbb" stroke-width="0.5"/>`);
      });
      pages.push(pageSvg(page.w, page.h, parts));
    }
    printPages({ pages, w: page.w, h: page.h });
    return;
  }
  const pic = recordPicture(doc, 4);
  if (!pic) { flash('There is nothing to print yet.'); return; }
  const v = await ask('Print', [
    { name: 'paper', label: 'Paper', value: printChoices.paper, options: PAPER_OPTIONS },
    { name: 'orient', label: 'Orientation', value: printChoices.orient, options: [{ value: 'auto', label: 'To suit the drawing' }, { value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
    { name: 'size', label: 'Size', value: printChoices.size, options: [{ value: 'actual', label: 'Actual size (smaller only if it would not fit)' }, { value: 'fit', label: 'As large as fits the page' }] },
  ], { ok: 'Print…', note: 'The drawing is centred on the page with half-inch margins. Copies and the printer are chosen in the next window.' });
  if (!v) return;
  Object.assign(printChoices, v);
  const b = pic.box, w = b.x2 - b.x1, h = b.y2 - b.y1;
  const page = orient(PAPERS[v.paper] ?? PAPERS.letter, v.orient as 'auto', w, h);
  const at = placeIn(w, h, inside(page, 36), v.size as 'actual');
  printPages({ pages: [pageSvg(page.w, page.h, [placeSvg(itemsToSvg(pic.items, b), at)])], w: page.w, h: page.h });
}

/**
 * File > Export Picture: the page (a design or the current slide) or the drawing as a PNG at
 * the resolution picked, or as an SVG, on its background colour or see-through.
 */
async function exportPicture(): Promise<void> {
  const tab = ws.active, deck = tab.deck;
  const what = deck ? (tab.mode === 'design' ? 'the page' : 'this slide') : 'the drawing';
  const v = await ask('Export Picture', [
    { name: 'format', label: 'Format', value: 'png', options: [
      { value: 'png', label: 'PNG (a picture of dots: journals, Word, web)' },
      { value: 'svg', label: 'SVG (shapes that stay sharp: Illustrator, Inkscape, web)' },
    ] },
    { name: 'dpi', label: 'Resolution (PNG)', value: '300', type: 'number', unit: 'dpi' },
    { name: 'bg', label: 'Background', value: deck ? 'page' : 'clear', options: [
      { value: deck ? 'page' : 'white', label: deck ? 'The page colour' : 'White' },
      { value: 'clear', label: 'See-through' },
    ] },
  ], { ok: 'Export…', note: `Saves ${what}. Journals usually ask for 300 dpi for colour pictures and 600 to 1200 dpi for line drawings.` });
  if (!v) return;
  const dpi = Math.max(30, Math.min(2400, Number(v.dpi) || 300));
  const clear = v.bg === 'clear';
  const CLEAR = 'rgba(0,0,0,0)';
  let w: number, h: number;
  let svg: () => string;
  let png: (k: number) => HTMLCanvasElement;
  if (deck) {
    const i = deck.index, s = deck.slides[i];
    const page = { size: deck.size, master: clear ? { ...deck.master, background: CLEAR } : deck.master, layout: s.layout, index: i };
    ({ w, h } = deck.size);
    svg = () => itemsToSvg(recordSlide(page, deck.docOf(i)).filter((it) => !(it.kind === 'path' && it.fill === CLEAR)), { x1: 0, y1: 0, x2: w, y2: h });
    png = (k) => {
      const c = document.createElement('canvas');
      paintSlide(c, w, h, k, page, deck.docOf(i));
      return c;
    };
  } else {
    const pic = recordPicture(doc, 4);
    if (!pic) { flash('There is nothing to export yet.'); return; }
    const b = pic.box;
    w = b.x2 - b.x1; h = b.y2 - b.y1;
    const back = clear ? [] : [{ kind: 'path' as const, segs: [{ k: 'M' as const, x: b.x1, y: b.y1 }, { k: 'L' as const, x: b.x2, y: b.y1 }, { k: 'L' as const, x: b.x2, y: b.y2 }, { k: 'L' as const, x: b.x1, y: b.y2 }, { k: 'Z' as const }], fill: '#ffffff' }];
    svg = () => itemsToSvg([...back, ...pic.items], b);
    png = (k) => {
      const { canvas } = pictureCanvas(doc, pic, k * 72);
      if (clear) return canvas;
      const c = document.createElement('canvas');
      c.width = canvas.width; c.height = canvas.height;
      const g = c.getContext('2d')!;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, c.width, c.height);
      g.drawImage(canvas, 0, 0);
      return c;
    };
  }
  const type = v.format === 'svg' ? SVG : PICTURE;
  const target = await saveFileDialog(withExtension(tab.name, type.extension), type).catch(async (e) => { await showError(String(e)); return null; });
  if (!target) return;
  let note = '';
  try {
    if (type === SVG) await writeFile(target.ref, target.name, svg(), SVG);
    else {
      const k = bitmapScale(w, h, dpi, EXPORT_MAX_SIDE, EXPORT_MAX_PIXELS);
      const c = png(k);
      const got = Math.round((c.width / w) * 72);
      if (got < dpi - 1) note = ` at ${got} dpi (the most for a page this big)`;
      const bytes = new Uint8Array(await (await canvasPng(c)).arrayBuffer());
      await writeFile(target.ref, target.name, pngWithDpi(bytes, (c.width / w) * 72), PICTURE);
      note = `, ${c.width} × ${c.height} pixels` + note;
    }
  } catch (e) {
    await showError(`Could not save ${target.name}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  flash(`Saved ${target.name}${note}`);
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
  return ws.active.mode === 'sheet' && !drawingOnTop();
}

/** True when a structure is being drawn for a cell or figure, or the drawing in split view has the keys. */
function drawingOnTop(): boolean {
  return !!cellEdit || (splitDrawing && !!ws.pane);
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
      || (c.contains('no-doc') && words) || (c.contains('draw-only') && (sheet || words) && !drawingOnTop());
  }
  $('#sheet-menu-wrap').hidden = !sheet || drawingOnTop();
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
  layoutSplit();
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
  splitDrawing = false;
  layoutSplit();
  if (ws.pane) { resize(); renderer.repaintAll(); }
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

const DOC_HINT = 'Type on the page. Insert > Structure draws a structure in the text (double-click it to change it); References > Insert Caption numbers figures and schemes. The small ⬊ buttons on the ribbon (or a right-click) open the Paragraph, Style, Page Setup and Header settings.';

/** True when a document is showing (and no structure is being drawn for it). */
function docActive(): boolean {
  return ws.active.mode === 'document' && !drawingOnTop();
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
  pickReferenceFile: () => pickReferenceFile(),
  preferredChanged: () => storeSettings(),
  reviewNameChanged: () => storeSettings(),
  newTable: (rows, cols, style) => tableDrawing(emptyTable(rows, cols, style.captionSize), style),
  measure: measureText,
});
docBoxPrefs.changed = () => storeSettings();
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
  'insert-shapes': () => {
    const b = document.querySelector<HTMLElement>('#doc-ribbon [data-doc="insert-shapes"]');
    const anchor = b && b.offsetParent ? b : document.querySelector<HTMLElement>('#doc-ribbon .rb-tabs')!;
    shapeMenu.show(anchor, 'Click a shape to put it in the text at the caret. Double-click it there to change its size, colour or text.', (id) => docMode.insertShape(id));
  },
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
const DOC_ANY = new Set(['export-pdf', 'print']);

// keys while a document shows but its text doesn't have the focus (after clicking a tab or a menu)
window.addEventListener('keydown', (e) => {
  if (!docActive() || e.defaultPrevented) return;
  const t = e.target as HTMLElement | null;
  if (isTyping(t) || t?.closest?.('dialog, .menu, .menu-wrap, select, aside, .ribbon')) return;
  if (docKey(e)) { e.preventDefault(); return; }
  if (!t || t === document.body) docMode.focus();
});

/** Menu commands that work the same whatever shows. */
const ANY_TAB = new Set(['edit-palettes', 'preferences', 'toolbox-main', 'toolbox-structure', 'toolbox-arrange', 'toolbox-templates', 'toolbox-colours', 'toolbox-custom', 'fold-side', 'customize-toolbox', 'lock-toolboxes', 'new', 'new-slides', 'new-design', 'new-sheet', 'new-document', 'open', 'save', 'save-as', 'close-tab', 'next-tab', 'prev-tab', 'undo', 'redo',
  'drawing-style', 'dark-page', 'dark-colours', 'alignment-guides', 'hotkeys', 'typing-spelling', 'mode-colours', 'dev-tools', 'scroll-bars', 'group-tips', 'show-stereo', 'clipboard-formats', 'split-view', 'command-search', 'print',
  'help', 'user-guide', 'send-feedback', 'report-problem', 'check-updates']);

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
  if (ws.active.mode === 'design' && (SLIDE_ONLY.has(name) || name.startsWith('layout-'))) {
    flash('A design is one page: use Page Size and Background on the Design ribbon. For several pages, use File > New Slides.');
    return true;
  }
  if (name.startsWith('add-ligand:')) {
    if (editor.addLigand(name.slice('add-ligand:'.length))) return true;
    flash('Select one metal first, then add the ligand to it.');
    return false;
  }
  if (name.startsWith('fuse-ring:')) {
    const [, id, index] = name.split(':');
    return contextBond !== null && editor.fuseRing(contextBond, id, Number(index));
  }
  const run = COMMANDS[name];
  return !!run && run() !== false;
}

/** Picture Style (right-click on a picture): a ready-made frame, corners and shadow for the pictures picked. */
function setPictureStyle(look: PictureLook | undefined): boolean {
  const pics = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => x?.kind === 'picture');
  if (!pics.length) { flash('Select a picture first.'); return false; }
  doc.edit('Picture style', () => { for (const p of pics) doc.updateShape(p.id, { look: look && { ...look } }); });
  return true;
}

/** Slide commands that don't apply to a design's single page. */
const SLIDE_ONLY = new Set(['new-slide', 'duplicate-slide', 'delete-slide', 'size-wide', 'size-standard', 'slide-master', 'slide-templates',
  'slide-transitions', 'slide-animations', 'animation-pane', 'preview-slide', 'remove-animation']);

/** The animation commands: an effect for the selected objects (the right-click menu's Animation). */
const ANIM_COMMANDS: { cmd: string; label: string }[] = [false, true].flatMap((exit) => EFFECTS.map((e) => ({
  cmd: `animate-${e.id}${exit ? '-out' : ''}`, label: animName(newAnim({ kind: 'shape', id: 0 }, e.id, exit)),
})));

const COMMANDS: Record<string, () => unknown> = {
  new: () => { finishTyping(); ws.newDrawing(); },
  'new-slides': () => { finishTyping(); ws.newSlides(); },
  'new-design': () => newDesign(),
  'design-size': () => designSize(),
  'connector-tool': () => { finishTyping(); editor.setTool('connector'); },
  'connector-elbow-tool': () => { finishTyping(); editor.setTool('connector-elbow'); },
  'slide-shapes': () => {
    const b = document.querySelector<HTMLElement>('#ribbon [data-cmd="slide-shapes"]:not([hidden])');
    const anchor = b && b.offsetParent ? b : document.querySelector<HTMLElement>('#ribbon .rb-tabs')!;
    shapeMenu.show(anchor, 'Click a shape, then click or drag on the slide. Type in it once placed.', (id) => { finishTyping(); editor.setTool(`geo:${id}`); });
  },
  'design-shapes': () => { if (ws.active.mode === 'design') lib.focusSearch(); else flash('Shapes are in Design mode: use File > New Design.'); },
  'shape-front': () => editor.setShapeLayer('front') || flash('Select the shapes to bring to the front.'),
  'shape-back': () => editor.setShapeLayer('back') || flash('Select the shapes to send to the back.'),
  'shape-forward': () => editor.setShapeLayer('forward') || flash('Select the shapes to bring forward.'),
  'shape-backward': () => editor.setShapeLayer('backward') || flash('Select the shapes to send backward.'),
  'new-sheet': () => { finishTyping(); ws.newSheet(); },
  'new-document': () => { finishTyping(); ws.newDocument(); },
  open: () => ws.open(),
  save: () => { finishTyping(); return ws.save(focusTab()); },
  'save-as': () => { finishTyping(); return ws.saveAs(focusTab()); },
  'save-workspace': () => saveWorkspace(false),
  'save-workspace-as': () => saveWorkspace(true),
  'open-workspace': () => openWorkspace(),
  'close-tab': () => { finishTyping(); return ws.close(); },
  'next-tab': () => ws.cycle(1),
  'prev-tab': () => ws.cycle(-1),
  'export-mol': () => exportMolfile(),
  'export-pdf': () => { finishTyping(); return exportPdf(); },
  print: () => void printNow(),
  'export-picture': () => { finishTyping(); return exportPicture(); },
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
  'slide-templates': () => slideTemplates(),
  'slide-transitions': () => animUi?.showTab('transitions'),
  'slide-animations': () => animUi?.showTab('animations'),
  'animation-pane': () => animUi?.showPane(!animUi.paneShown),
  'preview-slide': () => animUi?.preview(),
  'remove-animation': () => animUi?.removePicked(),
  // comments on slides (in documents, the document's own commands run first)
  'new-comment': () => { if (ws.active.mode !== 'slides' || !slideCmts) return false; finishTyping(); void slideCmts.add(); },
  'prev-comment': () => { if (ws.active.mode !== 'slides') return false; slideCmts?.step(false); },
  'next-comment': () => { if (ws.active.mode !== 'slides') return false; slideCmts?.step(true); },
  'resolve-comment': () => { if (ws.active.mode !== 'slides') return false; slideCmts?.toggleResolved(); },
  'delete-comment': () => { if (ws.active.mode !== 'slides') return false; slideCmts?.remove(); },
  'delete-all-comments': () => { if (ws.active.mode !== 'slides') return false; slideCmts?.removeAll(); },
  'show-comments': () => { if (ws.active.mode !== 'slides' || !slideCmts) return false; slideCmts.show(!slideCmts.shown); },
  'drawing-style': () => drawingStyleDialog(),
  present: () => present(false),
  'present-current': () => present(true),
  'presenter-view': () => present(false, true),
  cut: () => cut(),
  copy: () => copy(),
  paste: () => paste(),
  'copy-smiles': () => copySmiles(),
  'paste-smiles': () => pasteSmiles(),
  'copy-mol': () => copyMolfile(),
  'copy-cdxml': () => copyCdxmlText(),
  'select-all': () => editor.selectAll(),
  delete: () => { finishTyping(); editor.deleteSelection(); },
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
  'show-stereo': () => previewStereo(!renderer.previewStereo),
  'scroll-bars': () => { showScrollBars(!scrollbars.shown); storeSettings(); },
  'group-tips': () => { showGroupTips(!labelTips.enabled); storeSettings(); },
  'dark-page': () => { showDark(!dark.on); storeSettings(); },
  'alignment-guides': () => {
    const m = guideMode();
    if (!m) { flash('Alignment guides are for drawings, slides and designs. In a document, figures line up with the text.'); return; }
    guidesOn[m] = !guidesOn[m];
    showGuides();
    storeSettings();
    flash(guidesOn[m] ? 'Alignment guides on: moved things snap into line with structures, text and shapes (hold Alt to move freely).' : 'Alignment guides off.');
  },
  'dark-colours': () => darkColours(),
  'zoom-in': () => editor.zoomBy(1.25),
  'zoom-out': () => editor.zoomBy(0.8),
  'zoom-fit': () => editor.fit(),
  // 100%: a point on the page is a point on the screen (96 pixels to the inch)
  'zoom-actual': () => editor.zoomTo(96 / 72),
  hotkeys: () => hotkeysDialog.open(),
  'typing-spelling': () => typingDialog.open(),
  'mode-colours': () => modeDialog.open(),
  'edit-palettes': () => editPalettes(),
  preferences: () => void openPreferences(),
  'check-updates': () => void updates.check(),
  help: () => openHelp(),
  'user-guide': () => openWebPage(GUIDE_URL),
  'send-feedback': () => feedback.open(),
  'report-problem': () => feedback.open('problem'),
  'command-search': () => commandSearch.open(),
  'toolbox-main': () => toolboxes.toggle('main'),
  'toolbox-structure': () => toolboxes.toggle('structure'),
  'toolbox-arrange': () => toolboxes.toggle('arrange'),
  'toolbox-templates': () => toolboxes.toggle('templates'),
  'toolbox-colours': () => toolboxes.toggle('colours'),
  'toolbox-custom': () => toolboxes.toggle('custom'),
  // the panel taken out as a toolbox folds up to its title bar; at the right it folds to a strip
  'fold-side': () => toolboxes.setSideCollapsed(ws.active.mode, !sideIsFolded()),
  'customize-toolbox': () => openCustomToolbox(),
  'lock-toolboxes': () => { toolboxes.setLocked(!toolboxState.locked); flash(toolboxState.locked ? 'Toolboxes locked.' : 'Toolboxes unlocked: drag one by its title to an edge of the drawing to dock it, or anywhere else to float.', 6000); },
  'add-frame': () => editor.addFrame() || flash('Select what to frame: structures, text, arrows or shapes.'),
  'fill-rings': () => flash(editor.fillRings(), 6000),
  'ring-shadow': () => {
    const r = editor.ringShadow();
    flash(!r ? 'Select filled rings (or their structure) first: Fill Rings fills them.' : r === 'on' ? 'Ring fills have a drop shadow. Change its size in the Style panel.' : 'Ring fill shadows off.', 5000);
  },
  'highlight': () => editor.highlight(highlightColour, highlightStyle) ? flash('Highlighted. Change the colour with Highlight in the Style panel.', 5000) : flash('Select the atoms and bonds to highlight.'),
  'remove-highlight': () => editor.highlight(undefined) || flash('Select the atoms and bonds to take the highlight off.'),
  'smooth-highlight': () => {
    const r = editor.smoothHighlight();
    if (!r) { flash('Select highlighted atoms and bonds first.'); return; }
    // new highlights take the same look
    highlightStyle = tidyStyle({ ...highlightStyle, smooth: r === 'on' });
    flash(r === 'on' ? 'Round highlights smoothed: one even band, with no disc at each atom. Square and diamond highlights are always smooth.' : 'Round highlights back to a disc at each atom.', 6000);
  },
  'clean-up': () => editor.cleanUp() || flash('Nothing to clean up: the structures are already tidy.'),
  'clean-up-arrow': () => {
    const curved = [...editor.sel.arrows].some((id) => doc.arrows.get(id)?.sweep);
    if (!curved) { flash('Select one or more curved (mechanism) arrows first.'); return; }
    const n = editor.cleanUpArrows();
    flash(n ? `Tidied ${n} arrow${n === 1 ? '' : 's'}.` : 'The arrows are already as tidy as they can be.');
  },
  'clean-up-reaction': () => editor.cleanUpReaction() || flash('No reaction to tidy: draw starting materials, an arrow and products (the arrow pointing from one to the other), or the scheme is already tidy.', 6000),
  'arrange-scheme': () => arrangeDialog.open(),
  'catalytic-cycle': () => void insertCycle(),
  'number-compounds': () => void numberCompounds(),
  'scheme-settings': () => void schemeSettings(),
  'attach-descriptors': () => void attachDescriptors(),
  'pubchem-lookup': () => void lookUpChosen(),
  'add-id-label': () => void addTiedText('label'),
  'lock-structures': () => toggleStructureLock(),
  'add-caption': () => void addTiedText('caption'),
  'bring-front': () => editor.setBondLayer(true) || flash('Select the bond to bring to the front (where bonds cross, the one behind has a gap).'),
  'send-back': () => editor.setBondLayer(false) || flash('Select the bond to send to the back (where bonds cross, the one behind has a gap).'),
  'save-template': () => void saveTemplate(),
  'delete-template': () => void deleteTemplate(),
  'define-nickname': () => void defineNickname(),
  'delete-nickname': () => void deleteNickname(),
  'contract-label': () => void contractLabel(),
  'expand-label': () => void expandLabel(),
  'hapto-bond': () => flash(editor.bondMetalToRing(), 5000),
  'split-hapto': () => flash(editor.splitHaptoBonds()),
  'chain-ends': () => void toggleTerminalMethyls(),
  'methyls-ch3': () => chooseMethylStyle('CH3'),
  'methyls-me': () => chooseMethylStyle('Me'),
  'explicit-h': () => flash(editor.toggleHydrogens(), 6000),
  'periodic-table': () => { editor.setTool('element'); periodicTable.open(); },
  'aromatic-circles': () => flash(editor.toggleAromaticCircles() ?? 'No aromatic rings here: select a ring with alternating double bonds, or one drawn with a circle.', 5000),
  'show-roles': () => { editor.showRoles = !editor.showRoles; $('[data-cmd="show-roles"]')?.setAttribute('aria-checked', String(editor.showRoles)); editor.requestScene(); storeSettings(); },
  'check-structure': () => checkStructure(),
  'stereo-labels': () => toggleStereoLabels(),
  'enhanced-stereo': () => { void setStereoGroup(); },
  'chiral-flag': () => { void setChiralFlag(); },
  'rgroup-table': () => { void rGroupTable(); },
  'split-view': () => toggleSplit(),
  'repeat-group': () => { void setRepeatGroup(); },
  'name-to-structure': () => nameToStructure(),
  'clipboard-formats': async () => {
    const names = await clipboardFormats().catch((err) => [String(err)]);
    flash(names.length ? 'On the clipboard: ' + names.join(', ') : 'The clipboard is empty.', 15000);
  },
};
for (const p of PICTURE_STYLES) COMMANDS[`picture-style-${p.id}`] = () => setPictureStyle(p.look);
for (const [i, a] of ANIM_COMMANDS.entries()) {
  const e = EFFECTS[i % EFFECTS.length].id, exit = i >= EFFECTS.length;
  COMMANDS[a.cmd] = () => { if (ws.active.mode !== 'slides') return false; animUi?.applyEffect(e, exit); return true; };
  SLIDE_ONLY.add(a.cmd);
}

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
    const recent = (e.target as HTMLElement).closest<HTMLButtonElement>('button')?.dataset.recent;
    if (recent !== undefined) { showMenu(null); void openRecent(recent); return; }
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

// ---------------------------------------------------------------- split view

// A drawing beside a document, sheet or slides (View > Split View). Beside a document or sheet
// both sides are live: the drawing is in the app's document (they don't use it) and whichever
// side was clicked last has the keys and menus. Slides use the drawing area themselves, so beside
// slides the side not being worked on shows as a picture, and clicking it swaps the two over.

const splitPane = $<HTMLDivElement>('#split-pane');
const splitBody = $<HTMLDivElement>('#split-body');
const splitPick = $<HTMLSelectElement>('#split-pick');
const splitSnap = $<HTMLCanvasElement>('#split-snap');
const mainSnap = $<HTMLDivElement>('#main-snap');
const workEl = $<HTMLElement>('#work');

/** The document, sheet or slides in split view and the drawing beside it; null without a split. */
function splitState(): { main: Tab; drawing: Tab } | null {
  if (slideSplit && ws.tabs.includes(slideSplit) && ws.active === slideSplit.partner) return { main: slideSplit, drawing: ws.active };
  const t = ws.active;
  return t.mode !== 'drawing' && t.partner && ws.tabs.includes(t.partner) ? { main: t, drawing: t.partner } : null;
}

/** The tab Save saves: the drawing beside a document or sheet when it has the keys. */
function focusTab(): Tab {
  return splitDrawing && ws.pane && !cellEdit ? ws.pane : ws.active;
}

function applySplitWidth(): void {
  workEl.style.setProperty('--split-w', `${Math.round(splitWidth * 1000) / 10}vw`);
}

/** Put the drawing area, the pictures and the marks where the split (or no split) needs them. */
function layoutSplit(): void {
  const st = splitState();
  if (!st) slideSplit = null;
  const live = !!st && (!!ws.pane || ws.active === st.drawing);
  const drawingSide = !!st && (ws.active === st.drawing || (!!ws.pane && splitDrawing));
  splitPane.hidden = !st;
  document.body.classList.toggle('split-view', !!st);
  document.body.classList.toggle('split-live', live);
  document.body.classList.toggle('split-drawing', drawingSide && !cellEdit);
  // the drawing area sits beside, except while a figure or cell structure is drawn (it floats over the pages then)
  const want = live && !cellEdit ? splitBody : workEl;
  if (host.parentElement !== want) {
    if (want === workEl) workEl.insertBefore(host, mainSnap);
    else splitBody.prepend(host);
  }
  mainSnap.hidden = !st || ws.active !== st.drawing;
  splitSnap.hidden = live;
  if (ws.pane) editor.paused = !splitDrawing && !cellEdit;
  $('[data-cmd="split-view"]')?.setAttribute('aria-checked', String(!!st));
  if (!st) { $('#split-empty').hidden = true; return; }
  const opts = ws.tabs.filter((t) => t.mode === 'drawing').map((t) => new Option(t.name.replace(/\.(cdxml|cdx)$/i, ''), String(t.id), false, t === st.drawing));
  opts.push(new Option('New drawing', 'new'));
  splitPick.replaceChildren(...opts);
  $('#split-insert').textContent = st.main.mode === 'document' ? 'Insert into Document' : st.main.mode === 'sheet' ? 'Insert into Cell' : 'Insert into Slide';
  if (live) $('#split-empty').hidden = true;
  else drawSplitSnap(st.drawing);
}

/** Beside slides: the drawing as a picture, fitted to its side, while the slide is worked on. */
function drawSplitSnap(t: Tab): void {
  const r = splitBody.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return;
  const dpr = window.devicePixelRatio || 1;
  splitSnap.width = Math.round(r.width * dpr);
  splitSnap.height = Math.round(r.height * dpr);
  splitSnap.style.width = `${r.width}px`;
  splitSnap.style.height = `${r.height}px`;
  const ctx = splitSnap.getContext('2d')!;
  ctx.clearRect(0, 0, splitSnap.width, splitSnap.height);
  const d = ws.docOf(t);
  const pic = isEmpty(d) ? null : recordPicture(d, 4);
  $('#split-empty').hidden = !!pic;
  if (!pic) return;
  const pw = pic.box.x2 - pic.box.x1, ph = pic.box.y2 - pic.box.y1;
  const k = Math.min((r.width * 0.9) / pw, (r.height * 0.9) / ph, 2) * dpr;
  const src = pictureCanvas(d, pic, Math.min(300, 72 * k)).canvas;
  const w = pw * k, h = ph * k;
  ctx.drawImage(src, (splitSnap.width - w) / 2, (splitSnap.height - h) / 2, w, h);
}
new ResizeObserver(() => {
  const st = splitState();
  if (st && !splitSnap.hidden) drawSplitSnap(st.drawing);
}).observe(splitBody);

/** After the drawing beside a document or sheet changes: show it, at the zoom it had. */
function paneEntered(fit = false): void {
  layoutSplit();
  showSheetParts();
  resize();
  const p = ws.pane;
  if (p?.view && !fit) renderer.view = { ...p.view };
  else if (p) fitSplitDrawing();
  renderer.repaintAll();
  editor.clearSelection();
  editor.frame(true);
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
}

/** A drawing fitted to its side of a split, but no bigger than twice actual size (a lone ring would fill it). */
function fitSplitDrawing(): void {
  editor.fit();
  const most = 2 * 96 / 72;
  if (renderer.view.scale > most) editor.zoomTo(most);
}

/** Beside a document or sheet: give the keys and menus to the drawing (true) or the pages or cells. */
function setSplitSide(drawing: boolean): void {
  if (!ws.pane || cellEdit || splitDrawing === drawing) return;
  if (!drawing) editor.closeCaption();
  splitDrawing = drawing;
  layoutSplit();
  showSheetParts();
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
  if (drawing) editor.onToolChange(editor.toolName);
  else $('#hint').textContent = ws.active.mode === 'sheet' ? SHEET_HINT : DOC_HINT;
}

/** Beside slides: work on the drawing (true; the slide becomes a picture) or on the slide. */
function focusSlideDrawing(on: boolean): void {
  const st = splitState();
  if (!st || st.main.mode !== 'slides') return;
  if (on === (ws.active === st.drawing)) return;
  if (on) {
    // the slide as it looks now, kept as a picture on its side
    const c = mainSnap.querySelector('canvas')!;
    c.width = scene.width;
    c.height = scene.height;
    c.style.width = scene.style.width || `${scene.clientWidth}px`;
    c.style.height = scene.style.height || `${scene.clientHeight}px`;
    c.getContext('2d')!.drawImage(scene, 0, 0);
    slideSplit = st.main;
    ws.activate(st.drawing);
  } else {
    slideSplit = null;
    ws.activate(st.main);
  }
}

/** View > Split View: a drawing beside the document, sheet or slides showing, or no split. */
function toggleSplit(): void {
  if (splitState()) { closeSplit(); return; }
  const t = ws.active;
  if (t.mode === 'drawing') {
    flash('Split view puts a drawing beside a document, sheet or slides: show one of those (or start one with the + tabs) and choose View > Split View there.', 8000);
    return;
  }
  finishTyping();
  const drawing = ws.tabs.find((x) => x.mode === 'drawing') ?? ws.addDrawing();
  // fitted to its side the first time it shows there
  drawing.view = null;
  ws.setPartner(drawing);
  splitDrawing = false;
  if (ws.pane) paneEntered(true);
  else layoutSplit();
  mainResized();
  flash(`${drawing.name} is beside the ${t.mode === 'document' ? 'document' : t.mode === 'sheet' ? 'sheet' : 'slides'}. Click a side to work on it; the bar above the drawing picks another drawing and puts structures in.`, 7000);
}

function closeSplit(): void {
  const st = splitState();
  if (!st) return;
  if (ws.active === st.drawing) focusSlideDrawing(false);
  finishTyping();
  if (ws.pane) ws.pane.view = { ...renderer.view };
  editor.clearSelection();
  ws.setPartner(null);
  splitDrawing = false;
  layoutSplit();
  const sheet = ws.active.mode === 'sheet', words = ws.active.mode === 'document';
  editor.paused = sheet || words;
  showSheetParts();
  refreshKeys();
  analysisKey = '';
  scheduleAnalysis(true);
  if (sheet) { $('#hint').textContent = SHEET_HINT; sheetMode.focus(); }
  if (words) { $('#hint').textContent = DOC_HINT; docMode.focus(); }
  resize();
  renderer.repaintAll();
  mainResized();
}

/** The document or slide got narrower or wider: fit the page or slide to its new width. */
function mainResized(): void {
  requestAnimationFrame(() => {
    if (ws.active.mode === 'document') docMode.refit();
    if (ws.active.mode === 'slides') { resize(); editor.fit(); }
  });
}

/** The bar's drawing list: show another open drawing, or a new one. */
splitPick.addEventListener('change', () => {
  const st = splitState();
  if (!st) return;
  finishTyping();
  const t = splitPick.value === 'new' ? ws.addDrawing() : ws.tabs.find((x) => String(x.id) === splitPick.value);
  if (!t || t === st.drawing) return;
  if (ws.active === st.drawing) {
    // beside slides, with the drawing being worked on: the other drawing comes up in its place
    st.main.partner = t;
    slideSplit = st.main;
    t.view = null;
    ws.activate(t);
    return;
  }
  if (ws.pane) ws.pane.view = { ...renderer.view };
  editor.clearSelection();
  t.view = null;
  ws.setPartner(t);
  if (ws.pane) paneEntered(true);
  else layoutSplit();
});

/** The bar's Insert: the selected structures (or the whole drawing) into the document, cell or slide. */
$('#split-insert').addEventListener('click', () => {
  const st = splitState();
  if (!st) return;
  editor.closeCaption();
  const live = !!ws.pane || ws.active === st.drawing;
  const part = extractDrawing(ws.docOf(st.drawing), live && editor.hasSelection() ? editor.sel : null);
  if (isEmpty(part)) { flash('Draw something first.'); return; }
  if (st.main.mode === 'document') {
    setSplitSide(false);
    docMode.insertDrawing(part.contents());
  } else if (st.main.mode === 'sheet') {
    setSplitSide(false);
    sheetMode.putStructure(part.contents());
  } else {
    focusSlideDrawing(false);
    const deck = deckNow();
    fitPasted(part, doc.style, deck?.master.fitPasted ? deck.master.drawing.bondLength : undefined);
    editor.sel = insertDrawing(doc, part, pasteCentre(), 'Insert structure');
    editor.changed();
  }
});

$('#split-close').addEventListener('click', () => closeSplit());

// clicking a side gives it the keys and menus
splitBody.addEventListener('pointerdown', (e) => {
  const st = splitState();
  if (!st) return;
  if (ws.pane) { setSplitSide(true); return; }
  if (ws.active !== st.drawing) {
    e.preventDefault();
    e.stopPropagation();
    focusSlideDrawing(true);
    overlay.focus();
  }
}, true);
for (const sel of ['#doc-pane', '#sheet-pane', '#doc-ribbon', '#sheet-ribbon']) {
  $(sel).addEventListener('pointerdown', () => { if (ws.pane && splitDrawing) setSplitSide(false); }, true);
}
mainSnap.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  focusSlideDrawing(false);
});
$('#split-handle').addEventListener('pointerdown', (e) => {
  const h = e.currentTarget as HTMLElement;
  h.setPointerCapture(e.pointerId);
  h.classList.add('dragging');
  const right = workEl.getBoundingClientRect().right;
  const move = (ev: PointerEvent) => {
    splitWidth = Math.min(0.8, Math.max(0.2, (right - ev.clientX) / window.innerWidth));
    applySplitWidth();
  };
  const up = () => {
    h.classList.remove('dragging');
    h.removeEventListener('pointermove', move);
    h.removeEventListener('pointerup', up);
    storeSettings();
    mainResized();
  };
  h.addEventListener('pointermove', move);
  h.addEventListener('pointerup', up);
  e.preventDefault();
});
applySplitWidth();

// ---------------------------------------------------------------- settings and the Hotkeys window

/** The colour Structure > Highlight uses: the one last chosen in the Style panel (a soft yellow at first). */
let highlightColour = '#ffe680';
/** The look new highlights take: the one last chosen in the Style panel. */
let highlightStyle: HighlightStyle | undefined;

/** Tick the chosen way of writing terminal methyls in the Structure menu. */
function tickMethylStyle(): void {
  $('[data-cmd="methyls-ch3"]')?.setAttribute('aria-checked', String(editor.options.methylStyle === 'CH3'));
  $('[data-cmd="methyls-me"]')?.setAttribute('aria-checked', String(editor.options.methylStyle === 'Me'));
}

/** Write terminal methyls as CH3 or Me from now on; the ones already shown in the selection (or the drawing) change too. */
function chooseMethylStyle(style: MethylStyle): void {
  const n = editor.setMethylStyle(style);
  tickMethylStyle();
  storeSettings();
  const how = style === 'Me' ? 'Me' : 'CH₃';
  flash(n ? `${n} terminal methyl${n > 1 ? 's' : ''} now written ${how}.` : `Show Terminal Methyls will write them as ${how}.`, 5000);
}

/** Ask before a command with nothing selected changes every structure on the page (Edit > Preferences). */
let askWholeDrawing = true;

/**
 * Show Terminal Methyls: on the selection, or with nothing selected on every structure, after
 * asking when there are several (some may be meant one way and some the other).
 */
async function toggleTerminalMethyls(): Promise<void> {
  const doc = editor.doc;
  if (!editor.sel.atoms.size && askWholeDrawing && doc.fragments().length > 1) {
    const r = await ask('Every structure on the page?', [
      { name: 'again', label: 'Don\u2019t ask again (Edit > Preferences)', type: 'checkbox', value: 'false' },
    ], { ok: 'Change every structure', note: 'Nothing is selected, so this shows or hides the terminal methyls on every structure on the page. To change only some, cancel and select them first.' });
    if (!r) return;
    if (r.again === 'true') { askWholeDrawing = false; storeSettings(); }
  }
  flash(editor.toggleChainEnds(), 5000);
}

/** Axial chirality as P/M instead of Ra/Sa: every label shown changes. */
function showHelicity(on: boolean): void {
  if (axialStyle.helicity === on) return;
  axialStyle.helicity = on;
  editor.requestScene();
}

// File > Recent (desktop app): files and workspaces opened or saved lately
let recentFiles: string[] = [];
function rememberFile(path: string): void {
  recentFiles = addRecent(recentFiles, path);
  renderRecent();
  storeSettings();
}
function renderRecent(): void {
  const box = document.querySelector<HTMLElement>('#recent-files');
  if (!box) return;
  const items = recentFiles.map((p) => {
    const b = document.createElement('button');
    b.setAttribute('role', 'menuitem');
    b.dataset.recent = p;
    b.title = p;
    const { name, folder } = recentLabel(p);
    const n = document.createElement('span');
    n.textContent = name;
    const f = document.createElement('small');
    f.className = 'muted';
    f.textContent = folder;
    b.append(n, f);
    return b;
  });
  const head = document.createElement('div');
  head.className = 'menu-head';
  head.textContent = 'Recent';
  const clear = document.createElement('button');
  clear.setAttribute('role', 'menuitem');
  clear.dataset.recent = '';
  clear.textContent = 'Clear Recent Files';
  box.replaceChildren(...(items.length ? [head, ...items, clear] : []));
  box.hidden = !canUpdate || !items.length;
}
async function openRecent(path: string): Promise<void> {
  finishTyping();
  if (!path) { recentFiles = []; renderRecent(); storeSettings(); return; }
  let bytes: Uint8Array;
  try {
    bytes = await readPath(path);
  } catch {
    // moved, renamed or deleted: said, and taken off the list
    recentFiles = removeRecent(recentFiles, path);
    renderRecent();
    storeSettings();
    flash(`${baseName(path)} isn't there any more (moved, renamed or deleted?), so it has come off the recent list.`, 8000);
    return;
  }
  await ws.openBytes(bytes, baseName(path), { kind: 'path', path });
}

// Workspaces (desktop app): every open tab saved together, with a list file to open them all again
const workspaceChoices = { copyIn: true, saveChanges: true };
async function saveWorkspace(choosePlace: boolean): Promise<void> {
  finishTyping();
  let path = choosePlace ? null : ws.workspacePath;
  const unsaved = ws.unsavedTabs.map((t) => t.name);
  const r = await ask(path ? 'Save Workspace' : 'Save Workspace As', [
    { name: 'copy', label: 'Put copies of files kept in other folders into the workspace folder (their tabs then save to the copies)', type: 'checkbox', value: String(workspaceChoices.copyIn) },
    { name: 'save', label: 'Save changes to tabs already saved as files', type: 'checkbox', value: String(workspaceChoices.saveChanges) },
  ], {
    ok: path ? 'Save' : 'Choose Folder…',
    note: (path ? `Saves the open tabs as the workspace ${baseName(path)}.` : 'A workspace is a folder with your files and a small .ciworkspace file listing the tabs, their order and split views. Next, pick or make a folder and name the workspace.')
      + (unsaved.length ? ` These tabs have never been saved and go into the workspace folder: ${unsaved.join(', ')}.` : ''),
  });
  if (!r) return;
  workspaceChoices.copyIn = r.copy === 'true';
  workspaceChoices.saveChanges = r.save === 'true';
  if (!path) {
    const target = await saveFileDialog(ws.workspacePath ? baseName(ws.workspacePath) : `Workspace.${WORKSPACE.extension}`, WORKSPACE).catch(async (e) => { await showError(String(e)); return null; });
    if (!target || target.ref.kind !== 'path') return;
    path = target.ref.path;
  }
  await ws.saveWorkspace(path, workspaceChoices);
}
async function openWorkspace(): Promise<void> {
  finishTyping();
  const f = await openBytesDialog('Workspaces', [WORKSPACE]).catch(async (e) => { await showError(String(e)); return null; });
  if (f && f.ref.kind === 'path') await ws.openWorkspace(new TextDecoder().decode(f.bytes), f.ref.path);
}

// Newer versions of the desktop app (File > Check for Updates…, Edit > Preferences)
let updateCheck = true;
let skipVersion: string | null = null;
const updates = new UpdateUI({
  unsaved: () => ws.tabs.filter((t) => t.dirty).map((t) => t.name),
  skipped: () => skipVersion,
  skip: (v) => { skipVersion = v; storeSettings(); },
});
for (const el of document.querySelectorAll<HTMLElement>('.desktop-only')) el.hidden = !canUpdate;
let versionText = canUpdate ? '' : 'Web version';
void Promise.all([appVersion(), portableInfo()]).then(([v, portable]) => {
  versionText = canUpdate ? `Version ${v}${portable ? ' (portable)' : ''}` : 'Web version';
  if (portable && !portable.writable) flash(`This portable copy can’t write to its “Chem Illustrator Data” folder (a locked or read-only drive), so settings are kept on this computer instead.`, 8000);
  const el = document.querySelector('#app-version');
  if (el) el.textContent = versionText;
});

// Help > Send Feedback and Report a Problem
const feedback = new FeedbackDialog({
  openWebPage,
  copyText,
  about: () => ({
    Version: versionText || 'desktop app',
    Computer: computerName(navigator.userAgent),
    Mode: ws.active.mode,
  }),
});

/** Edit > Preferences: drawing choices that are set once rather than per structure. */
async function openPreferences(): Promise<void> {
  const r = await ask('Preferences', [
    { name: 'methyl', label: 'Terminal methyls written as', value: editor.options.methylStyle, options: [{ value: 'Me', label: 'Me' }, { value: 'CH3', label: 'CH3' }] },
    { name: 'axial', label: 'Axial chirality written as', value: axialStyle.helicity ? 'PM' : 'RaSa', options: [{ value: 'RaSa', label: 'Ra / Sa' }, { value: 'PM', label: 'P / M (helicity)' }] },
    { name: 'charges', label: 'Charges from the + and − keys', value: editor.options.circledCharges ? 'circled' : 'plain', options: [{ value: 'plain', label: 'Plain sign (N+)' }, { value: 'circled', label: 'In a circle (⊕, ⊖)' }] },
    { name: 'ask', label: 'Ask before changing every structure on the page when nothing is selected', type: 'checkbox', value: String(askWholeDrawing) },
    ...(canUpdate ? [{ name: 'updates', label: 'Check for a newer version when the app starts', type: 'checkbox' as const, value: String(updateCheck) }] : []),
    { name: 'pubchem', label: 'Look up names the name reader can\'t read on PubChem (sends the name typed to PubChem, a free NIH database)', type: 'checkbox', value: String(pubchemNames) },
    { name: 'reviewer', label: 'Your name on tracked changes in documents', value: reviewAuthor() },
  ], { ok: 'Save', note: 'Charges already drawn keep their look; the circle tools on the Object toolbox always draw a circled charge. Show Terminal Methyls writes them this way; methyls already written out in the selection (or the whole drawing, with nothing selected) change too. Axial chirality labels (biaryls, allenes) follow the choice at once; Ra is the same as M, and Sa as P.' });
  if (!r) return;
  askWholeDrawing = r.ask === 'true';
  pubchemNames = r.pubchem === 'true';
  setReviewAuthor(r.reviewer ?? '');
  if (canUpdate) {
    // turning the check back on also forgets a skipped version
    if (r.updates === 'true' && !updateCheck) skipVersion = null;
    updateCheck = r.updates === 'true';
  }
  editor.options.circledCharges = r.charges === 'circled';
  showHelicity(r.axial === 'PM');
  if (r.methyl !== editor.options.methylStyle) chooseMethylStyle(r.methyl as MethylStyle);
  else storeSettings();
}

let settingsLoaded = false;
// your palettes show in every colour box, in every mode
usePaletteMenus();
useDrawingColours(() => usedColours(editor.doc));
onPalettes(() => storeSettings());
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
    scrollBars: scrollbars.shown,
    groupTips: labelTips.enabled,
    chemTyping: typingPrefs.chemistry,
    spellCheck: typingPrefs.spelling,
    replacements: typingPrefs.replacements,
    dictionary: typingPrefs.dictionary,
    modeColours,
    nicknames: ownNicknames,
    templates: ownTemplates(),
    splitWidth,
    citeStyle: preferredStyle().style,
    citeOptions: preferredStyle().options,
    methylStyle: editor.options.methylStyle,
    axialStyle: axialStyle.helicity ? 'PM' : 'RaSa',
    circledCharges: editor.options.circledCharges,
    slideTemplate,
    askWholeDrawing,
    palettes: getPalettes(),
    toolboxes: toolboxState,
    myStyles: ownStyles,
    modeStyles,
    darkPage: dark.on,
    darkPalette: dark.palette,
    darkPalettes: dark.own,
    guides: { ...guidesOn },
    docPins: [...docBoxPrefs.pinned],
    updateCheck,
    pubchemNames,
    reviewName: reviewAuthor(),
    skipVersion,
    recentFiles,
    scheme: { ...schemePrefs },
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
  const sk = commandKey('command-search');
  $('#btn-search kbd').textContent = sk ?? '';
  $('#btn-search').title = sk ? `Search for a command by name (${sk})` : 'Search for a command by name';
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
  setSchemePrefs(s.scheme);
  $('[data-cmd="show-roles"]')?.setAttribute('aria-checked', String(s.showRoles));
  showDevTools(s.devTools);
  showScrollBars(s.scrollBars);
  showGroupTips(s.groupTips);
  modeColours = s.modeColours;
  applyModeColours(ws.active.mode, modeColours);
  keymap.setOverrides(s.hotkeys);
  setTypingPrefs({ chemistry: s.chemTyping, spelling: s.spellCheck, replacements: s.replacements, dictionary: s.dictionary });
  ownNicknames = s.nicknames;
  addNicknames(ownNicknames);
  useOwnTemplates(s.templates);
  splitWidth = s.splitWidth;
  applySplitWidth();
  setPreferredStyle(s.citeStyle, s.citeOptions);
  editor.options.methylStyle = s.methylStyle;
  showHelicity(s.axialStyle === 'PM');
  editor.options.circledCharges = s.circledCharges;
  slideTemplate = s.slideTemplate;
  askWholeDrawing = s.askWholeDrawing;
  updateCheck = s.updateCheck;
  pubchemNames = s.pubchemNames;
  setReviewAuthor(s.reviewName);
  skipVersion = s.skipVersion;
  recentFiles = s.recentFiles;
  renderRecent();
  setPalettes(s.palettes);
  toolboxState = s.toolboxes;
  ownStyles = s.myStyles;
  modeStyles = s.modeStyles;
  dark.palette = s.darkPalette;
  dark.own = s.darkPalettes;
  showDark(s.darkPage);
  Object.assign(guidesOn, s.guides);
  docBoxPrefs.pinned = parseDocPins(s.docPins);
  docMode.boxesChanged();
  showGuides();
  // the drawing the app opened with takes your default style, if nothing has been drawn yet
  const first = modeStyles.drawing ? styleNamed(modeStyles.drawing, ownStyles) : undefined;
  if (first && ws.tabs.length === 1 && ws.active.mode === 'drawing' && ws.active.ref.kind === 'none' && doc.atoms.size === 0 && !doc.canUndo()) {
    doc.style = first;
    doc.allDirty = true;
    editor.changed();
  }
  toolboxes.render();
  tickToolboxes();
  placeSidePanel();
  tickMethylStyle();
  settingsLoaded = true;
  // a few seconds after starting, so the check doesn't slow down opening the window
  if (canUpdate && updateCheck) setTimeout(() => void updates.quietCheck(), 4000);
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
      placeRing(doc, ringOnAtom(r5, ringDir(doc, r5.id), 5, L), { existing: [r5.id] });
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

// ---------------------------------------------------------------- mass fragmentation

editor.onFragment = (p, q, bondIds) => { void fragmentAt(p, q, bondIds); };

/** The fragmentation tool's line: break the bonds it crosses and label each piece with its formula and mass. */
async function fragmentAt(p: { x: number; y: number }, q: { x: number; y: number }, bondIds: number[]): Promise<void> {
  if (!bondIds.length) { flash('Draw the line across one or more bonds to break them.'); return; }
  if (!chem.ready) { flash('The chemistry engine is still loading.'); return; }
  // one structure at a time: the one the first crossed bond belongs to
  const first = doc.bonds.get(bondIds[0])!;
  const frag = doc.fragmentOf(first.a1);
  const bonds = bondIds.map((id) => doc.bonds.get(id)!).filter((b) => frag.has(b.a1));
  const ex = toMolfile(doc, frag);
  const index = new Map<number, number>();
  ex.map.forEach((id, i) => { if (id >= 0) index.set(id, i); });
  const cuts = bonds.map((b) => [index.get(b.a1), index.get(b.a2)] as [number | undefined, number | undefined])
    .filter((c): c is [number, number] => c[0] !== undefined && c[1] !== undefined);
  const res = await chem.fragments(ex.molblock, cuts).catch((e) => ({ error: String(e) }));
  if ('error' in res) { flash(res.error); return; }
  const size = doc.style.captionSize;
  const font = doc.style.captionFont;
  const pieces = res.map((r) => {
    const atoms = r.atoms.map((i) => doc.atoms.get(ex.map[i])).filter((a): a is Atom => !!a);
    const c = atoms.length ? { x: atoms.reduce((s, a) => s + a.x, 0) / atoms.length, y: atoms.reduce((s, a) => s + a.y, 0) / atoms.length } : p;
    const runs = fragmentRuns(r.formula, r.exact);
    const w = Math.max(measureText(r.formula, size, font), measureText(r.exact.toFixed(4), size, font));
    return { r, c, runs, w };
  });
  const all = [...frag].map((id) => doc.atoms.get(id)!);
  const box = { x1: Math.min(...all.map((a) => a.x)) - size * 0.5, y1: Math.min(...all.map((a) => a.y)) - size * 0.5, x2: Math.max(...all.map((a) => a.x)) + size * 0.5, y2: Math.max(...all.map((a) => a.y)) + size * 0.5 };
  const places = captionPlaces(p, q, pieces.map((x) => x.c), pieces.map((x) => x.w), size, box);
  doc.edit('Mass fragmentation', () => {
    doc.addShape({ kind: 'line', dashed: true, x1: p.x, y1: p.y, x2: q.x, y2: q.y });
    pieces.forEach((x, i) => doc.addCaption({ x: places[i].x, y: places[i].y, runs: x.runs, justify: 'left' }));
  });
  editor.changed();
  const ring = res.length === 1 ? ' The bonds broken are in a ring, so the structure stays in one piece.' : '';
  flash(`Broke ${cuts.length} bond${cuts.length === 1 ? '' : 's'}: ${res.map((r) => `${r.formula} ${r.exact.toFixed(4)}`).join(', ')}.${ring}`);
}

// ---------------------------------------------------------------- analysis (background chemistry)

let analysisTimer = 0;
/** The structures last analysed, for the panel's buttons. */
let lastAnalysis: { results: FragmentResult[]; frags: Set<number>[] } | null = null;
const adductSel = $<HTMLSelectElement>('#analysis-adduct');
adductSel.innerHTML = COMMON_ADDUCTS.map((a) => `<option>${a}</option>`).join('');
adductSel.addEventListener('change', () => scheduleAnalysis(true));
/** What PubChem had on each structure looked up this session, by SMILES. */
const pubchemStates = new Map<string, PubChemState>();

/** The Analysis panel's PubChem button: find the structure's compound number, then its record. */
async function lookUpOnPubChem(smiles: string): Promise<void> {
  pubchemStates.set(smiles, { kind: 'busy' });
  scheduleAnalysis(true);
  try {
    const cid = await pubchemCid(smiles);
    pubchemStates.set(smiles, cid ? { kind: 'found', c: await pubchemCompound(cid) } : { kind: 'none' });
  } catch (e) {
    pubchemStates.set(smiles, { kind: 'error', message: (e as Error).message });
  }
  scheduleAnalysis(true);
}

/** Structure > Look Up on PubChem (and the right-click menu): the structure picked, shown in the Analysis panel. */
async function lookUpChosen(): Promise<void> {
  const f = chosenStructures()[0];
  if (!f) { flash('Select a structure first.'); return; }
  const r = await weigh(f);
  if (!r?.smiles) { flash('Couldn\'t read that structure to look it up.'); return; }
  // the answer shows in the Analysis panel, so unfold it if it's folded away
  if (sideIsFolded()) command('fold-side');
  await lookUpOnPubChem(r.smiles);
  $('#analysis-body .pubchem')?.scrollIntoView({ block: 'nearest' });
}

/** A web page, in the computer's browser. */
function openWebPage(url: string): void {
  if (isTauri()) void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url)).catch((e) => flash(`Couldn't open the browser: ${e}`));
  else window.open(url, '_blank', 'noopener');
}

$('#analysis-body').addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  const page = t.closest<HTMLElement>('[data-pubchem-page]');
  if (page) { e.preventDefault(); openWebPage(compoundPage(Number(page.dataset.pubchemPage))); return; }
  const look = t.closest<HTMLButtonElement>('button[data-pubchem]');
  if (look && lastAnalysis) { const r = lastAnalysis.results[Number(look.dataset.pubchem)]; if (r?.smiles) void lookUpOnPubChem(r.smiles); return; }
  const b = t.closest<HTMLButtonElement>('button[data-insert]');
  if (!b || !lastAnalysis) return;
  const [kind, n] = b.dataset.insert!.split(':');
  const r = lastAnalysis.results[Number(n)], frag = lastAnalysis.frags[Number(n)];
  if (kind === 'formula') { if (frag) void attachDescriptors([frag]); return; }
  if (kind === 'pcname' || kind === 'pccas' || kind === 'pchaz') {
    const st = r && pubchemStates.get(r.smiles);
    const runs = st?.kind === 'found' ? pubchemRuns(kind, st.c) : null;
    if (!runs || !frag) return;
    // tied to the structure like Add Caption's, so it follows it; edit or retype it like any text
    // (the structure stays selected, so the panel stays open for the other buttons)
    const m = editor.measure();
    doc.edit(kind === 'pcname' ? 'Name caption' : kind === 'pccas' ? 'CAS caption' : 'Hazards caption', () => {
      const c = doc.addCaption({ x: 0, y: 0, runs, justify: 'center', attach: { atoms: [...frag], side: 'below', gap: defaultGap(doc), shift: 0, role: 'caption' } });
      placeAttached(doc, c, m);
    });
    editor.changed();
    flash('Added under the structure; it follows it. Double-click to edit.');
    return;
  }
  const runs = r && analysisRuns(kind as 'formula' | 'hrms' | 'ea', r, adductSel.value);
  if (!runs || !frag) return;
  // under the structure, lined up with its left edge
  const atoms = [...frag].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a);
  if (!atoms.length) return;
  const x = Math.min(...atoms.map((a) => a.x)), y = Math.max(...atoms.map((a) => a.y)) + doc.style.bondLength * 1.2;
  doc.edit(kind === 'formula' ? 'Analysis caption' : kind === 'hrms' ? 'HRMS text' : 'Elemental analysis text', () => {
    // long lines wrap to the structure's width (or about 15 bond lengths, if wider)
    const w = Math.max(Math.max(...atoms.map((a) => a.x)) - x, doc.style.bondLength * 15);
    doc.addCaption({ x, y, runs, justify: 'left', ...(kind === 'formula' ? {} : { wrap: w }) });
  });
  editor.changed();
  flash(kind === 'formula' ? 'Added the formula and masses as a caption. Double-click it to edit.' : 'Added the text. Double-click it to type the found values.');
});
let analysisSeq = 0;
let analysisKey = '';

// ---------------------------------------------------------------- captions tied to structures

/** The structures to work on: those with atoms selected, else the one last drawn on. */
function chosenStructures(): Set<number>[] {
  const roots = editor.sel.atoms.size ? [...editor.sel.atoms] : editor.lastEdited !== null && doc.atoms.has(editor.lastEdited) ? [editor.lastEdited] : [];
  const out: Set<number>[] = [];
  const seen = new Set<number>();
  for (const r of roots) {
    if (seen.has(r)) continue;
    const f = doc.fragmentOf(r);
    for (const x of f) seen.add(x);
    out.push(f);
  }
  return out;
}

/** A structure's formula and masses from the chemistry engine (null when it can't be worked out). */
async function weigh(atoms: Set<number>): Promise<FragmentResult | null> {
  if (!chem.ready || !atoms.size) return null;
  const ex = toMolfile(doc, atoms);
  const res = await chem.analyze([{ molblock: ex.molblock, map: ex.map }]).catch(() => null);
  const r = res?.results[0];
  return r && !r.error ? r : null;
}

/**
 * Structure > Attach Descriptors (and the Analysis panel's button): the formula and masses under
 * each structure, tied to it. They follow it, and are worked out again when it changes; the Style
 * panel chooses what they show and where they sit.
 */
async function attachDescriptors(frags = chosenStructures()): Promise<void> {
  if (!frags.length) { flash('Select a structure first.'); return; }
  if (!chem.ready) { flash('The chemistry engine is still loading. Try again in a moment.'); return; }
  const made: number[] = [];
  const weighed = await Promise.all(frags.map((f) => weigh(f)));
  doc.edit('Attach descriptors', () => {
    frags.forEach((f, i) => {
      const r = weighed[i];
      if (!r) return;
      const adduct = adductSel.value;
      const runs = descriptorRuns(r, DEFAULT_DESCRIPTORS, adduct);
      const attach: Attachment = { atoms: [...f], side: 'below', gap: defaultGap(doc), shift: 0, role: 'descriptors', show: [...DEFAULT_DESCRIPTORS], adduct, sig: structureSig(doc, f) };
      const c = doc.addCaption({ x: 0, y: 0, runs, justify: 'center', attach });
      placeAttached(doc, c, editor.measure());
      made.push(c.id);
    });
  });
  if (!made.length) { flash('Couldn\'t work out the formula of that structure.'); return; }
  editor.clearSelection();
  for (const id of made) editor.sel.captions.add(id);
  editor.changed();
  flash('Attached the formula and masses. They follow the structure and update when it changes; choose what they show in the Style panel.', 7000);
}

let descriptorBusy = false, descriptorAgain = false;
/** Work out tied descriptors again for structures that changed (the new text joins the change that caused it). */
async function refreshDescriptors(): Promise<void> {
  if (descriptorBusy) { descriptorAgain = true; return; }
  descriptorBusy = true;
  try {
    do {
      descriptorAgain = false;
      for (const c of [...doc.captions.values()]) {
        const a = c.attach;
        if (a?.role !== 'descriptors' || a.keepText) continue;
        const atoms = attachedAtoms(doc, a);
        const sig = structureSig(doc, atoms);
        if (!atoms.size || sig === a.sig) continue;
        const version = doc.version;
        const r = await weigh(atoms);
        // something else changed meanwhile: look again from the start
        if (doc.version !== version) { descriptorAgain = true; break; }
        const now = doc.captions.get(c.id);
        if (!r || !now?.attach) continue;
        doc.amend('Descriptors', () => doc.updateCaption(c.id, { runs: descriptorRuns(r, now.attach!.show ?? DEFAULT_DESCRIPTORS, now.attach!.adduct ?? adductSel.value), attach: { ...now.attach!, sig } }));
        editor.changed();
      }
    } while (descriptorAgain);
  } finally {
    descriptorBusy = false;
  }
}

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
  // repeat groups (polymer brackets): weigh each unit and count it as many times as its label says
  const groups = repeatGroups(doc);
  const results: FragmentResult[] = [];
  const polymers: (ReturnType<typeof withRepeats>['polymer'])[] = [];
  for (let i = 0; i < res.results.length; i++) {
    const mine = groups.filter((g) => g.inner.some((id) => frags[i].has(id)));
    const units: RepeatUnit[] = [];
    if (mine.length && !res.results[i].error) {
      const index = new Map<number, number>();
      exports[i].map.forEach((id, k) => { if (id >= 0) index.set(id, k); });
      for (const g of mine) {
        const cuts = g.crossing.map((c) => { const b = doc.bonds.get(c.bond)!; return [index.get(b.a1), index.get(b.a2)] as [number | undefined, number | undefined]; })
          .filter((c): c is [number, number] => c[0] !== undefined && c[1] !== undefined);
        const pieces = cuts.length ? await chem.fragments(exports[i].molblock, cuts).catch(() => null) : null;
        const at = index.get(g.inner[0]);
        const unit = pieces && !('error' in pieces) ? pieces.find((p) => at !== undefined && p.atoms.includes(at)) : null;
        if (unit) units.push({ text: g.text, count: g.count, counts: unit.counts, exact: unit.exact, mw: unit.mw });
      }
    }
    const w = withRepeats(res.results[i], units);
    results.push(w.r);
    polymers.push(w.polymer);
  }
  if (seq !== analysisSeq) return;
  lastAnalysis = { results, frags };
  panel.innerHTML = results.map((r, i) => polymers[i] ? polymerHtml(r, polymers[i]!) : analysisHtml(r, i, adductSel.value, { stereo: r.error ? '' : stereoSummary(frags[i]), unknown: exports[i].unknownLabels, pubchem: r.error || !r.smiles ? '' : pubchemHtml(pubchemStates.get(r.smiles) ?? { kind: 'idle' }, i) })).join('');
  updatePanels();
}

/**
 * Structure > Stereo Group: puts the selected stereocentres in an enhanced stereo group (abs, &n
 * or orn), as in ChemDraw and V3000 molfiles, or takes them out of one.
 */
async function setStereoGroup(): Promise<void> {
  const sel = [...editor.sel.atoms].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a);
  const centres = sel.filter((a) => live.atom(a.id) || a.enhStereo);
  if (!centres.length) { flash(sel.length ? 'None of the selected atoms is a stereocentre.' : 'Select the stereocentres to group first.'); return; }
  // the next free group number in these structures, for each kind
  const used = { and: new Set<number>(), or: new Set<number>() };
  for (const a of centres) for (const id of doc.fragmentOf(a.id)) {
    const e = doc.atoms.get(id)?.enhStereo;
    if (e && e.type !== 'abs' && !editor.sel.atoms.has(id)) used[e.type].add(e.group ?? 1);
  }
  const first = centres[0].enhStereo;
  const free = (t: 'and' | 'or') => { let n = 1; while (used[t].has(n)) n++; return n; };
  const got = await ask('Stereo group', [
    { name: 'type', label: 'Group', value: first?.type ?? 'and', options: [
      { value: 'abs', label: 'abs: configuration known as drawn' },
      { value: 'and', label: '& (AND): a mixture of both forms' },
      { value: 'or', label: 'or (OR): one form, not known which' },
      { value: 'none', label: 'None' },
    ] },
    { name: 'group', label: 'Number', value: String(first && first.type !== 'abs' ? first.group ?? 1 : free(first?.type === 'or' ? 'or' : 'and')), type: 'number' },
  ], { ok: 'Set', note: `${centres.length} stereocentre${centres.length === 1 ? '' : 's'}. Centres with the same group and number change together: &1 centres are a racemic pair, or1 centres are one unknown enantiomer.` });
  if (!got) return;
  const type = got.type as 'abs' | 'and' | 'or' | 'none';
  const group = Math.max(1, Math.round(Number(got.group) || 1));
  doc.edit('Stereo group', () => {
    for (const a of centres) doc.updateAtom(a.id, { enhStereo: type === 'none' ? undefined : type === 'abs' ? { type } : { type, group } });
  });
  editor.changed();
}

/**
 * Structure > Polymer or Repeat Brackets: labels the selected brackets n (a polymer's repeat unit)
 * or a number (a group repeated that many times). The atoms between the brackets are the unit.
 */
async function setRepeatGroup(): Promise<void> {
  const br = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((s): s is Shape => s?.kind === 'bracket');
  if (!br.length) { flash('Select the brackets first (draw them round the repeat unit with the bracket tool).'); return; }
  // the label goes on the closing bracket (lips pointing back to the left), as ChemDraw puts it
  const closing = br.find((s) => lipDirection(s).x < -0.5) ?? br[br.length - 1];
  const now = br.find((s) => s.repeat)?.repeat ?? 'n';
  const got = await ask('Polymer or repeat brackets', [{ name: 'text', label: 'Label', value: now }], {
    ok: 'Set', note: 'Type n (or another letter) for a polymer\'s repeat unit, or a number for a group repeated that many times. Leave it empty to take the label off. The atoms between the brackets are the unit; the bonds crossing them join it to the rest.',
  });
  if (!got) return;
  const text = got.text.trim();
  doc.edit('Repeat brackets', () => {
    for (const s of br) if (s.repeat && s.id !== closing.id) doc.updateShape(s.id, { repeat: undefined });
    doc.updateShape(closing.id, { repeat: text || undefined });
  });
  editor.changed();
  if (text) {
    const g = repeatGroups(doc).find((x) => x.label.id === closing.id);
    if (!g) flash('Couldn\'t find the bracket facing this one. Draw both brackets, facing each other, round the repeat unit.');
    else if (!g.inner.length) flash('There are no atoms between these brackets.');
    else flash(`${g.inner.length} atom${g.inner.length === 1 ? '' : 's'} in the repeat unit, joined by ${g.crossing.length} bond${g.crossing.length === 1 ? '' : 's'} crossing the brackets.`);
  }
}

let rGroupLast = { rows: '', prefix: '', cols: 'formula-mw', extra: 'Yield (%)' };

/**
 * Structure > R-Group Table: a table under a core structure with R groups (R1, R2…) listing what
 * each group is in each compound, with each compound's number, formula and mass worked out by
 * putting its groups in place. The result is an ordinary table, so anything in it can be typed over.
 */
async function rGroupTable(): Promise<void> {
  const root = editor.sel.atoms.size ? [...editor.sel.atoms][0] : editor.lastEdited;
  if (root === null || !doc.atoms.has(root)) { flash('Select a structure with R groups (R1, R2, X…) first.'); return; }
  const ids = [...doc.fragmentOf(root)];
  const groups = rGroupsOf(doc, ids);
  if (!groups.length) { flash('This structure has no R groups. Type R1, R2… (or R, X, Ar) as atom labels where the groups go.'); return; }
  const labels = groups.map((g) => g.label);
  const got = await ask('R-group table', [
    { name: 'rows', label: `One compound per line: ${labels.join(', ')}`, value: rGroupLast.rows, type: 'textarea', placeholder: labels.map((_, i) => ['Me', 'H', 'Ph', 'OMe'][i % 4]).join(', ') + '\n' + labels.map((_, i) => ['OMe', 'Cl', 'CF3', 'Et'][i % 4]).join(', ') },
    { name: 'prefix', label: 'Compound number', value: rGroupLast.prefix, placeholder: 'e.g. 2 for 2a, 2b…' },
    { name: 'cols', label: 'Worked out', value: rGroupLast.cols, options: [
      { value: 'formula-mw', label: 'Formula and MW' },
      { value: 'formula-mw-exact', label: 'Formula, MW and exact mass' },
      { value: 'none', label: 'Nothing' },
    ] },
    { name: 'extra', label: 'Columns to fill in', value: rGroupLast.extra, placeholder: 'e.g. Yield (%), ee (%)' },
  ], { ok: 'Make table', note: 'Type each compound\'s groups the way you would label an atom (Me, Ph, OMe, CO2Et, Cl, H), separated by commas, or paste cells from Excel. Start a line with #number (#12, Me, H) to give that compound its own number.' });
  if (!got) return;
  rGroupLast = { rows: got.rows, prefix: got.prefix, cols: got.cols, extra: got.extra };
  const parsed = parseRows(got.rows, labels);
  if (!parsed.length) { flash('Type at least one compound\'s groups.'); return; }
  const numbers = rowNumbers(parsed.length, got.prefix);
  const rows = parsed.map((r, i) => ({ number: r.number ?? numbers[i], values: r.values }));
  const cols = { formula: got.cols !== 'none', mw: got.cols !== 'none', exact: got.cols === 'formula-mw-exact', extra: got.extra.split(',').map((e) => e.trim()).filter((e) => e) };
  let masses: RowMass[] = rows.map(() => null);
  if (cols.formula) {
    const mols = rows.map((r) => substituted(doc, ids, Object.fromEntries(labels.map((l, k) => [l, r.values[k]]))));
    const ok = rows.map((r, i) => r.values.every((v) => v) && !mols[i].unknownLabels.length);
    const res = await chem.analyze(mols.map((m) => ({ molblock: m.molblock, map: m.map }))).catch(() => null);
    masses = rows.map((_, i) => {
      const x = res?.results[i];
      return ok[i] && x && !x.error ? { formula: x.formula, mw: x.mw, exact: x.exact } : null;
    });
  }
  const t = tableFromCells(rGroupCells(labels, rows, masses, cols), textMeasure, doc.style.captionSize);
  const atoms = ids.map((id) => doc.atoms.get(id)!);
  const top = { x: (Math.min(...atoms.map((a) => a.x)) + Math.max(...atoms.map((a) => a.x))) / 2, y: Math.max(...atoms.map((a) => a.y)) + doc.style.bondLength * 1.2 };
  placeTable(t, 'R-group table', top);
  const bad = masses.filter((m) => !m).length;
  flash(cols.formula && bad
    ? `Made the table. ${bad} compound${bad === 1 ? '\'s' : 's\''} formula couldn't be worked out (a group left empty or not recognised), shown as ?. Double-click a cell to type it in.`
    : 'Made the table. Double-click any cell to change it; the Style panel has its rows, columns and lines.', 8000);
}

/**
 * Structure > Chiral Flag: the boxed Abs, Rel or Rac below the selected structure (or the one
 * last drawn on), replacing a flag already there.
 */
async function setChiralFlag(): Promise<void> {
  const root = editor.sel.atoms.size ? [...editor.sel.atoms][0] : editor.lastEdited;
  if (root === null || !doc.atoms.has(root)) { flash('Select a structure first.'); return; }
  const atoms = [...doc.fragmentOf(root)].map((id) => doc.atoms.get(id)!);
  const box = { x1: Math.min(...atoms.map((a) => a.x)), y1: Math.min(...atoms.map((a) => a.y)), x2: Math.max(...atoms.map((a) => a.x)), y2: Math.max(...atoms.map((a) => a.y)) };
  const L = doc.style.bondLength;
  const near = [...doc.shapes.values()].find((s) => s.kind === 'symbol' && s.symbol && CHIRAL_FLAGS[s.symbol] && s.x1 < box.x2 + L && s.x2 > box.x1 - L && s.y1 < box.y2 + 2 * L && s.y2 > box.y1 - L);
  const got = await ask('Chiral flag', [{ name: 'flag', label: 'Flag', value: near?.symbol ?? 'Absolute', options: [
    { value: 'Absolute', label: 'Abs: the structure is one enantiomer, as drawn' },
    { value: 'Relative', label: 'Rel: relative configuration only' },
    { value: 'Racemic', label: 'Rac: a racemic mixture' },
    { value: 'none', label: 'None (remove the flag)' },
  ] }], { ok: 'Set' });
  if (!got) return;
  doc.edit('Chiral flag', () => {
    if (near) doc.removeShape(near.id);
    if (got.flag === 'none') return;
    const size = doc.style.captionSize;
    const w = measureText(CHIRAL_FLAGS[got.flag], size) + 4, h = size * 1.15 + 4;
    const x2 = box.x2 + L * 0.3, y1 = box.y2 + L * 0.6;
    doc.addShape({ kind: 'symbol', symbol: got.flag, x1: x2 - w, y1, x2, y2: y1 + h });
  });
  editor.changed();
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
  const centres = [...frag].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a && !!live.atom(a.id)).sort(byPlace).map((a) => shownDescriptor(live.atom(a.id)!));
  const dbl: { x: number; y: number; l: string }[] = [];
  for (const id of frag) for (const bid of doc.adj.get(id) ?? []) {
    const b = doc.bonds.get(bid);
    const l = b && b.a1 === id ? live.bond(bid) : null;
    if (b && l) { const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!; dbl.push({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2, l: shownDescriptor(l) }); }
  }
  dbl.sort(byPlace);
  return [centres.join(', '), dbl.map((d) => d.l).join(', ')].filter(Boolean).join('; ');
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
  const key = checks.version + ':' + doc.version + ':' + labelWarnVersion;
  if (key === warnKey) return;
  warnKey = key;
  const list: { kind: 'atom' | 'bond' | 'caption'; id: number; text: string[] }[] = checks.list();
  for (const [id, text] of labelWarnings) if (doc.captions.has(id)) list.push({ kind: 'caption', id, text: [text] });
  const ignored = checks.ignoredCount() + [...doc.captions.values()].filter((c) => c.ignoreWarnings).length;
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
        else if (w.kind === 'bond') doc.updateBond(w.id, { ignoreWarnings: true });
        else doc.updateCaption(w.id, { ignoreWarnings: true });
      });
      editor.changed();
    });
  }
  $('#w-unignore')?.addEventListener('click', () => {
    doc.edit('Show ignored warnings', () => {
      for (const id of checks.atoms.keys()) if (doc.atoms.get(id)?.ignoreWarnings) doc.updateAtom(id, { ignoreWarnings: false });
      for (const id of checks.bonds.keys()) if (doc.bonds.get(id)?.ignoreWarnings) doc.updateBond(id, { ignoreWarnings: false });
      for (const c of doc.captions.values()) if (c.ignoreWarnings) doc.updateCaption(c.id, { ignoreWarnings: undefined });
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

// font, size and other typed boxes get drop-downs that list every choice
installFontList();
installCombos();
// the free fonts that come with the app load when first used; then text is measured and drawn again
let fontRedraw = 0;
registerBundledFonts(() => {
  clearTimeout(fontRedraw);
  fontRedraw = window.setTimeout(() => {
    forgetTextWidths();
    doc.allDirty = true;
    editor.changed();
    docMode.fontsChanged();
  }, 50);
});
applyRibbonIcons();

const stylePanel = new StylePanel($('#style-section'), $('#style-body'), doc, () => editor.sel, () => editor.changed());
stylePanel.applyLabel = (id, text) => editor.applyLabel(id, text);
stylePanel.tie = (ids) => tieCaptions(ids);

/** Tie captions to the structure nearest each, where they sit now (Style panel). */
function tieCaptions(ids: number[]): void {
  const m = editor.measure();
  let n = 0;
  doc.edit('Tie caption to structure', () => {
    for (const id of ids) {
      const c = doc.captions.get(id);
      if (!c) continue;
      const f = nearestStructure(doc, m.captionBox(c), m);
      const a = f && attachWhereItIs(doc, c, f, m, 'caption');
      if (a) { doc.updateCaption(id, { attach: a }); n++; }
    }
  });
  editor.changed();
  flash(n ? 'Tied: the caption now follows its structure.' : 'There is no structure to tie it to.');
}
// ---------------------------------------------------------------- right-click menu on the drawing

/**
 * What the right-click menu offers: the usual editing commands, then the top menus' commands
 * that fit what was clicked (a structure, an arrow, shapes or empty space), grouped as they are
 * at the top so they are found in the same place.
 */
/** The bond right-clicked last, for Fuse a Ring Here. */
let contextBond: number | null = null;
/** The conformers Fuse a Ring Here offers, in this order. */
const FUSE_RINGS = ['chair', 'boat', 'twist-boat', 'half-chair', 'cyclohexanone', 'envelope', 'c5-twist', 'cyclopentene', 'cyclobutane', 'c7-twist-chair'];

/** Right-click on a bond of a ring drawn in 3-D: the conformers that can join it, each way they can. */
/** Ligands offered on right-clicking a metal, as in the Ligands palette. */
const MENU_LIGANDS = ['pph3', 'pcy3', 'co', 'mecn', 'py', 'cp', 'cpstar', 'benzene', 'allyl', 'ethylene', 'cod', 'dppe', 'dppf', 'binap', 'bipy', 'phen', 'acac', 'imes'];

/** Right-click on metals and hapto bonds: add a ligand, bond to a ring's middle, split a hapto bond, expand a ligand label. */
function metalMenu(): MenuItem[] {
  const out: MenuItem[] = [];
  const metal = editor.selectedMetal();
  if (metal !== null) out.push({ label: 'Add Ligand', items: MENU_LIGANDS.map((id) => ({ cmd: `add-ligand:${id}`, label: templateById(id)?.name ?? id })) });
  const sel = [...editor.sel.atoms].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a && !a.multi);
  if (metal !== null && sel.length >= 3) out.push({ cmd: 'hapto-bond' });
  const hapto = (bid: number) => { const b = doc.bonds.get(bid); return !!b && !!centreEnd(doc, b); };
  if ((contextBond !== null && hapto(contextBond)) || [...editor.sel.atoms].some((id) => (doc.adj.get(id) ?? []).some(hapto))) out.push({ cmd: 'split-hapto' });
  if (editor.expandableLabels().length) out.push({ cmd: 'expand-label' });
  return out;
}

function fuseRingMenu(): MenuItem[] {
  if (contextBond === null) return [];
  const ways = editor.ringFusions(contextBond, FUSE_RINGS);
  if (!ways.length) return [];
  const items: MenuItem[] = [];
  for (const id of FUSE_RINGS) {
    const mine = ways.filter((w) => w.id === id);
    if (!mine.length) continue;
    items.push(mine.length === 1
      ? { cmd: `fuse-ring:${id}:${mine[0].index}`, label: mine[0].name }
      : { label: mine[0].name, items: mine.map((w) => ({ cmd: `fuse-ring:${id}:${w.index}`, label: w.note[0].toUpperCase() + w.note.slice(1) })) });
  }
  return [{ label: 'Fuse a Ring Here', items }];
}

function drawingMenu(): MenuItem[] {
  const s = editor.sel;
  const any = s.atoms.size + s.bonds.size + s.captions.size + s.arrows.size + s.shapes.size > 0;
  const atoms = s.atoms.size > 0;
  const shapes = [...s.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => !!x);
  const design = ws.active.mode === 'design';
  const view: MenuItem = { label: 'View', items: [{ cmd: 'zoom-in' }, { cmd: 'zoom-out' }, { cmd: 'zoom-fit' }, { cmd: 'zoom-actual' }, null, { cmd: 'show-stereo' }, { cmd: 'group-tips' }, { cmd: 'scroll-bars' }, { cmd: 'alignment-guides' }, null, { cmd: 'dark-page' }, { cmd: 'dark-colours' }] };
  if (!any) {
    return [
      { cmd: 'paste' }, { cmd: 'paste-smiles' }, { cmd: 'select-all' }, null,
      { cmd: 'undo' }, { cmd: 'redo' }, null,
      ...(ws.active.mode === 'slides' ? [{ cmd: 'new-comment', label: 'New Comment' }, { cmd: 'show-comments', label: 'Show Comments' }, null] : []),
      { label: 'Insert', items: [{ cmd: 'name-to-structure' }, { cmd: 'periodic-table' }, { cmd: 'insert-picture' }, { cmd: 'text-box' }, ...(design ? [{ cmd: 'design-shapes', label: 'Shape…' }, { cmd: 'connector-tool' }] : []), ...(ws.active.mode === 'slides' ? [{ cmd: 'slide-shapes', label: 'Shape…' }] : [])] },
      { label: 'Scheme', items: [{ cmd: 'clean-up-reaction' }, { cmd: 'arrange-scheme' }, { cmd: 'number-compounds' }, { cmd: 'catalytic-cycle' }] },
      { cmd: 'drawing-style' },
      view,
    ];
  }
  const arrange: MenuItem[] = [
    { cmd: 'align-left' }, { cmd: 'align-hcenter' }, { cmd: 'align-right' }, null,
    { cmd: 'align-top' }, { cmd: 'align-vcenter' }, { cmd: 'align-bottom' }, null,
    { cmd: 'distribute-h' }, { cmd: 'distribute-v' },
  ];
  const turn: MenuItem[] = [
    { cmd: 'flip-h' }, { cmd: 'flip-v' }, null,
    { cmd: 'rotate-cw' }, { cmd: 'rotate-ccw' }, { cmd: 'rotate-180' }, { cmd: 'rotate-dialog' }, null, { cmd: 'scale' },
  ];
  const order: MenuItem[] = shapes.length
    ? [{ cmd: 'shape-front', label: 'Bring to Front' }, { cmd: 'shape-forward', label: 'Bring Forward' }, { cmd: 'shape-backward', label: 'Send Backward' }, { cmd: 'shape-back', label: 'Send to Back' }]
    : [];
  return [
    { cmd: 'cut' }, { cmd: 'copy' }, { cmd: 'paste' }, { cmd: 'delete', label: 'Delete' }, null,
    ...(atoms ? [{ label: 'Copy As', items: [{ cmd: 'copy-smiles' }, { cmd: 'copy-mol' }, { cmd: 'copy-cdxml' }] }, null] : []),
    ...(atoms ? [
      { cmd: 'clean-up' },
      ...fuseRingMenu(),
      ...metalMenu(),
      { label: 'Structure', items: [
        { cmd: 'stereo-labels' }, { cmd: 'aromatic-circles' }, { cmd: 'chain-ends' }, { cmd: 'explicit-h' }, null,
        { cmd: 'contract-label' }, { cmd: 'expand-label' }, { cmd: 'join' }, { cmd: 'bring-front' }, { cmd: 'send-back' }, null,
        { cmd: 'hapto-bond' }, { cmd: 'split-hapto' }, null,
        { cmd: 'enhanced-stereo' }, { cmd: 'chiral-flag' }, { cmd: 'repeat-group' }, { cmd: 'rgroup-table' }, null,
        { cmd: 'check-structure' }, { cmd: 'save-template' }, { cmd: 'define-nickname' }, null,
        { cmd: 'pubchem-lookup' },
      ] },
    ] : []),
    ...([...s.arrows].some((id) => doc.arrows.get(id)?.sweep) ? [{ cmd: 'clean-up-arrow' }] : []),
    ...(s.arrows.size || atoms ? [{ label: 'Scheme', items: [{ cmd: 'clean-up-reaction' }, { cmd: 'clean-up-arrow' }, { cmd: 'arrange-scheme' }, { cmd: 'number-compounds' }, { cmd: 'catalytic-cycle' }] }] : []),
    null,
    { cmd: 'add-frame' },
    ...(atoms ? [{ label: 'Label the Structure', items: [{ cmd: 'add-id-label' }, { cmd: 'add-caption' }, { cmd: 'attach-descriptors' }, null, { cmd: 'number-compounds' }] }] : []),
    { cmd: 'scale' },
    ...(atoms || shapes.some((x) => x.kind === 'ring') ? [{ label: 'Highlight and Fill', items: [{ cmd: 'highlight' }, { cmd: 'remove-highlight' }, { cmd: 'smooth-highlight' }, null, { cmd: 'fill-rings' }, { cmd: 'ring-shadow' }] }] : []),
    { label: 'Align', items: arrange },
    { label: 'Rotate or Flip', items: turn },
    ...(order.length ? [{ label: 'Order', items: order }] : []),
    ...(shapes.some((x) => x.kind === 'picture') ? [{ cmd: 'crop' }, { label: 'Picture Style', items: PICTURE_STYLES.map((p) => ({ cmd: `picture-style-${p.id}`, label: p.name })) }] : []),
    ...(ws.active.mode === 'slides' ? [{ label: 'Animation', items: [
      ...ANIM_COMMANDS.slice(0, EFFECTS.length), null, ...ANIM_COMMANDS.slice(EFFECTS.length), null,
      { cmd: 'remove-animation', label: 'Remove Animation' }, { cmd: 'animation-pane', label: 'Animation Pane' }, { cmd: 'preview-slide', label: 'Preview Slide' },
    ] }, { cmd: 'new-comment', label: 'New Comment' }] : []),
    null,
    { cmd: 'select-all' },
    view,
  ];
}

// ---------------------------------------------------------------- group tooltips (View > Group Tooltips)

/** Resting the mouse on OTBS, Boc, CO2Me… shows the group written out. */
const labelTips = new LabelTooltip(async (tip) => {
  if (!chem.ready) return null;
  const mb = await chem.smilesToMol(tip.smiles).catch(() => null);
  if (!mb) return null;
  const d = new Doc();
  d.style = { ...editor.doc.style };
  d.bulk(() => {
    const ids = addMolfile(d, mb, 0, 0);
    for (const i of starAtoms(tip.smiles)) {
      if (ids[i] !== undefined) d.updateAtom(ids[i], { attach: 'Wavy', attachNum: undefined, z: 0, label: null, charge: 0 });
    }
  });
  const pic = recordPicture(d, 3);
  if (!pic) return null;
  return pictureCanvas(d, pic, 72 * 1.4 * (window.devicePixelRatio || 1)).canvas;
});

function groupTipTarget(e: PointerEvent) {
  if (e.buttons) return null;
  // what is under the pointer now (not the editor's last hover, which can lag a move behind)
  const rect = renderer.overlay.getBoundingClientRect();
  const p = renderer.toDoc(e.clientX - rect.left, e.clientY - rect.top);
  const h = editor.hitTest(p);
  if (h?.kind !== 'atom') return null;
  const d = editor.doc;
  const a = d.atoms.get(h.id);
  if (!a?.label) return null;
  // only on the label's letters, so the tooltip goes as soon as the pointer is off them
  const pad = 2 / Math.max(1e-6, renderer.view.scale);
  if (!renderer.atomInfo(d, a).boxes.some((b) => p.x >= b.x1 - pad && p.x <= b.x2 + pad && p.y >= b.y1 - pad && p.y <= b.y2 + pad)) return null;
  const ext = (d.adj.get(h.id) ?? []).map((bid) => d.bonds.get(bid)!).filter((b) => b && b.display !== 'dative').map((b) => (b.order === 4 ? 1 : b.order));
  return { label: a.label, ext: ext.length ? ext : [1], x: e.clientX, y: e.clientY };
}
// the editor reads the pointer first (its listeners were added first), so its hover is up to date
renderer.overlay.addEventListener('pointermove', (e) => labelTips.over(groupTipTarget(e)));
for (const ev of ['pointerdown', 'pointerleave', 'wheel'] as const) renderer.overlay.addEventListener(ev, () => labelTips.hide());
window.addEventListener('keydown', () => labelTips.hide());
// anywhere off the drawing (a panel, a menu, another window) the tooltip goes too
window.addEventListener('pointermove', (e) => { if (e.target !== renderer.overlay) labelTips.hide(); }, true);
window.addEventListener('blur', () => labelTips.hide());
document.addEventListener('visibilitychange', () => labelTips.hide());

/** Show the page dark (screen only) or as it is, and tick the menu and the eye button. */
function showDark(on: boolean): void {
  dark.on = on;
  showDarkPage(on ? darkPaletteNamed(dark.palette, dark.own) : null);
  editor.dark = on;
  editor.requestOverlay();
  $('[data-cmd="dark-page"][role="menuitemcheckbox"]')?.setAttribute('aria-checked', String(on));
  $('#btn-dark').setAttribute('aria-pressed', String(on));
}

/** View > Dark Page Colours…: pick a palette, change its paper and ink, or keep your own. */
async function darkColours(): Promise<void> {
  const all = (): DarkPalette[] => [...DARK_PALETTES, ...dark.own];
  const cur = darkPaletteNamed(dark.palette, dark.own);
  const got = await ask('Dark page colours', [
    { name: 'palette', label: 'Palette', value: cur.name, options: [...all().map((p) => ({ value: p.name, label: dark.own.includes(p) ? `${p.name} (yours)` : p.name }))] },
    { name: 'paper', label: 'Paper shows as', value: cur.paper, type: 'color' },
    { name: 'ink', label: 'Black ink shows as', value: cur.ink, type: 'color' },
    { name: 'name', label: 'Save as your own, named', value: '', placeholder: 'leave empty to use the palette as it is' },
  ], { ok: 'Use', note: 'Only the screen changes: files, printing, copying and exports keep their white paper and black ink. The colours shown are the palette in use now: pick another palette and leave them alone to use it as it is, or change them (and give a name) to keep your own.' });
  if (!got) return;
  const base = darkPaletteNamed(got.palette, dark.own);
  // colours left as they were mean "this palette as it is"
  const untouched = got.paper === cur.paper && got.ink === cur.ink;
  const changed = !untouched && (got.paper !== base.paper || got.ink !== base.ink);
  const name = got.name.trim();
  if (changed || name) {
    const p: DarkPalette = { name: name || `${base.name} (changed)`, paper: got.paper || base.paper, ink: got.ink || base.ink };
    dark.own = [...dark.own.filter((o) => o.name !== p.name), p];
    dark.palette = p.name;
  } else dark.palette = base.name;
  showDark(true);
  storeSettings();
}

function showGroupTips(on: boolean): void {
  labelTips.enabled = on;
  if (!on) labelTips.hide();
  $('[data-cmd="group-tips"]')?.setAttribute('aria-checked', String(on));
}

editor.onContextMenu = (e) => {
  if (sheetActive() || docActive()) return;
  finishTyping();
  const h = editor.contextPick(e);
  contextBond = h?.kind === 'bond' ? h.id : null;
  showContextMenu(e.clientX, e.clientY, drawingMenu(), { run: (cmd) => void command(cmd), key: commandKey });
};

stylePanel.cropWithMouse = () => cropPicture();
stylePanel.removeWhite = (ids) => void removeWhite(ids);
stylePanel.frames = { add: () => void command('add-frame'), fit: (id) => editor.fitFrame(id) };
stylePanel.ringFill = () => void command('fill-rings');
stylePanel.highlightUsed = (c) => { highlightColour = c; };
stylePanel.highlightStyleUsed = (st) => { highlightStyle = tidyStyle(st); };

// ---------------------------------------------------------------- toolboxes (View > Toolboxes)

let toolboxState: ToolboxState = defaultToolboxes();
/** The drawing tools' bar, which the Drawing Tools toolbox holds wherever it is. */
const toolsNav = $<HTMLElement>('#tools');

/** Every tool on the tool bar (palette items too), by name, for toolboxes. */
const ALL_TOOLS = new Map<string, { title: string; icon: string }>();
for (const group of TOOL_GROUPS) {
  for (const item of group) {
    const pal = 'palette' in item ? item : null;
    for (const t of pal ? pal.items : [item as { name: string; title: string }]) {
      if (t.name === OWN_ADD) continue;
      ALL_TOOLS.set(t.name, { title: t.title, icon: ICONS[t.name] ?? pal?.icon?.(t.name, 28) ?? t.name });
    }
  }
}

/**
 * A tool picked from a toolbox. In Document and Sheet modes, with no drawing open, a drawing
 * tool opens one to use it on: a new structure at the text cursor, or the selected cell's.
 */
function pickTool(name: string): void {
  const mode = ws.active.mode;
  const b = document.body.classList;
  if ((mode === 'document' || mode === 'sheet') && !b.contains('floating-drawing') && !b.contains('split-view')) {
    modeTool[mode] = name;
    editor.setTool(name);
    if (name !== 'select' && name !== 'eraser') {
      if (mode === 'document') docMode.drawWithTool();
      else command('draw-structure');
    }
  } else editor.setTool(name);
  if (name === 'element') periodicTable.open();
}

/** A tool's button in a toolbox: picks the tool, and shows when it is the one in use. */
function toolButton(name: string): HTMLButtonElement | null {
  const t = ALL_TOOLS.get(name);
  if (!t) return null;
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'tool tb-tool';
  b.dataset.tool = name;
  b.title = t.title;
  b.setAttribute('aria-label', t.title);
  b.innerHTML = t.icon;
  b.classList.toggle('active', editor.toolName === name);
  b.addEventListener('click', () => pickTool(name));
  return b;
}

const runFromToolbox = (cmd: string) => { finishTyping(); command(cmd); };
const sep = () => { const d = document.createElement('div'); d.className = 'tb-sep'; return d; };
const cmdRow = (body: HTMLElement, cmds: (string | [string, string] | null)[]) => {
  for (const c of cmds) body.append(!c ? sep() : typeof c === 'string' ? commandButton(c, runFromToolbox) : commandButton(c[0], runFromToolbox, c[1]));
};

/** What the Colours toolbox's swatches do: colour the lines and text, highlight, or fill. */
let colourMode: 'line' | 'highlight' | 'fill' = 'line';

/** The side panel's contents: in the panel at the right, or in the "details" toolbox when taken out. */
const sideContent = $('#side-content');

const TOOLBOX_DEFS: ToolboxDef[] = [
  { id: 'main', title: 'Drawing Tools', build: (body) => body.append(toolsNav) },
  {
    id: 'structure', title: 'Structure',
    build: (body) => cmdRow(body, ['clean-up', 'add-frame', 'fill-rings', 'highlight', 'remove-highlight', null, 'chain-ends', 'explicit-h', 'aromatic-circles', 'stereo-labels', null, 'add-id-label', 'add-caption', 'attach-descriptors', 'number-compounds', null, 'contract-label', 'expand-label', 'hapto-bond', 'name-to-structure']),
  },
  {
    id: 'arrange', title: 'Object',
    build: (body) => cmdRow(body, ['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom', null, 'distribute-h', 'distribute-v', null, 'flip-h', 'flip-v', 'rotate-cw', 'rotate-ccw', null, 'shape-front', 'shape-back']),
  },
  {
    id: 'templates', title: 'Templates',
    build: (body, vertical) => {
      // (many templates: the box scrolls rather than run off the window)
      body.classList.add('tb-grid', 'tb-scroll');
      body.style.setProperty('--cols', vertical ? '2' : '12');
      for (const group of TOOL_GROUPS) for (const item of group) {
        if (!('palette' in item) || !item.palette.startsWith('tpl-') || item.palette === 'tpl-own') continue;
        // a heading over each palette's buttons, so the families are easy to find
        const head = document.createElement('div');
        head.className = 'tb-heading';
        head.textContent = head.title = item.title;
        body.append(head);
        for (const t of item.items) { const b = toolButton(t.name); if (b) body.append(b); }
      }
    },
  },
  {
    id: 'colours', title: 'Colours',
    build: (body, vertical) => {
      const modes = document.createElement('div');
      modes.className = 'tb-modes';
      for (const [m, label, title] of [['line', 'Colour', 'Colour the lines and text'], ['highlight', 'Highlight', 'A band of colour behind atoms and bonds'], ['fill', 'Fill', 'Fill shapes and ring fills']] as const) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.title = title;
        b.setAttribute('aria-pressed', String(colourMode === m));
        b.addEventListener('click', () => { colourMode = m; for (const o of modes.children) o.setAttribute('aria-pressed', String(o === b)); });
        modes.append(b);
      }
      const grid = document.createElement('div');
      grid.className = 'tb-swatches';
      const swatch = (c: string | undefined) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'tb-swatch';
        if (c) b.style.background = c; else { b.textContent = '∅'; b.style.fontSize = '11px'; }
        b.title = c ? c.toUpperCase() : 'None: take the colour, highlight or fill off';
        b.setAttribute('aria-label', b.title);
        b.addEventListener('click', () => {
          if (!editor.colourSelection(c, colourMode)) flash('Select what to colour first.');
          else if (colourMode === 'highlight' && c) highlightColour = c;
        });
        return b;
      };
      grid.append(swatch(undefined));
      for (const c of [...STANDARD_COLOURS, '#ffffff']) grid.append(swatch(c));
      for (const p of getPalettes()) {
        if (!p.colors.length) continue;
        const n = document.createElement('div');
        n.className = 'tb-swatch-name';
        n.textContent = p.name;
        grid.append(n, ...p.colors.map((c) => swatch(c)));
      }
      body.append(modes, grid);
      if (vertical) body.style.maxWidth = '110px';
    },
  },
  {
    id: 'custom', title: 'My Toolbox',
    build: (body) => {
      for (const k of toolboxState.custom) {
        const [kind, name] = [k.slice(0, k.indexOf(':')), k.slice(k.indexOf(':') + 1)];
        const b = kind === 'tool' ? toolButton(name) : commandButton(name, runFromToolbox);
        if (b) body.append(b);
      }
      const edit = commandButton('customize-toolbox', runFromToolbox, toolboxState.custom.length ? '…' : 'Choose what goes here…');
      edit.title = 'Choose What Is in My Toolbox';
      body.append(edit);
    },
  },
];

// The side panel (Style, Warnings, Analysis; Format in documents, Cell in sheets) is a toolbox,
// docked at the right to start with. Its arrow goes with it, so it shows even when the title bar is
// locked away.
TOOLBOX_DEFS.push({ id: 'details', title: 'Side Panel', build: (body) => { body.before($('#side-fold')); body.append(sideContent); } });

const toolboxes = new Toolboxes(TOOLBOX_DEFS, {
  get: () => toolboxState,
  set: (st) => { toolboxState = st; tickToolboxes(); storeSettings(); placeSidePanel(); },
  work: () => $('#work'),
  customize: () => openCustomToolbox(),
  // each mode keeps the side panel folded or open on its own
  folded: (id) => (id === 'details' ? sideIsFolded() : undefined),
  fold: (id) => { if (id !== 'details') return false; command('fold-side'); return true; },
});

/** Tick the shown toolboxes and the lock in the View menu, and show the lock on its button. */
function tickToolboxes(): void {
  for (const id of ['main', 'structure', 'arrange', 'templates', 'colours', 'custom'] as ToolboxId[]) $(`[data-cmd="toolbox-${id}"]`)?.setAttribute('aria-checked', String(!!toolboxState.places[id]?.shown));
  $('[data-cmd="lock-toolboxes"]')?.setAttribute('aria-checked', String(toolboxState.locked));
  $('[data-cmd="fold-side"]')?.setAttribute('aria-checked', String(sideIsFolded()));
  const lock = $('#btn-lock');
  lock.setAttribute('aria-pressed', String(toolboxState.locked));
  lock.querySelector('.lock-icon')!.innerHTML = lockIcon(toolboxState.locked);
  lock.querySelector('.lock-text')!.textContent = toolboxState.locked ? 'Locked' : 'Unlocked';
}

/** Show the side panel folded or open as the mode showing has it, and its arrow to match. */
function placeSidePanel(): void {
  const folded = sideIsFolded();
  $('.toolbox[data-id="details"]')?.classList.toggle('collapsed', folded);
  const fold = $('#side-fold');
  fold.textContent = folded ? '‹' : '›';
  fold.title = folded ? 'Open the side panel (View > Fold Side Panel)' : 'Fold the side panel away (View > Fold Side Panel)';
  fold.setAttribute('aria-label', fold.title);
}
$('#side-fold').addEventListener('click', () => command('fold-side'));

/** The side panel is folded away in the mode showing (each mode keeps its own choice). */
function sideIsFolded(): boolean {
  return sideFolded(toolboxState, ws.active.mode);
}
$('#btn-lock').addEventListener('click', () => command('lock-toolboxes'));

function openCustomToolbox(): void {
  const tools: Pickable[] = [...ALL_TOOLS].map(([name, t]) => ({ key: `tool:${name}`, label: t.title.split(/[.:] /)[0], icon: t.icon }));
  const groups = [{ name: 'Drawing tools', items: tools }, ...menuCommands().filter((g) => g.items.length).map((g) => ({ name: `${g.menu} menu`, items: g.items.map((c) => ({ key: `cmd:${c.cmd}`, label: c.label })) }))];
  customizeToolbox(groups, () => toolboxState.custom, (items) => {
    toolboxState = { ...toolboxState, custom: items, places: { ...toolboxState.places, custom: { ...toolboxState.places.custom, shown: true } } };
    tickToolboxes();
    storeSettings();
    toolboxes.render();
  });
}

toolboxes.render();
tickToolboxes();

// ---------------------------------------------------------------- Search Commands (Alt+Q)

const onScreen = (el: Element) => el.getClientRects().length > 0;

/** A ribbon button's name: its own words, or its tool tip's first phrase when it only shows a sign. */
function ribbonLabel(b: HTMLElement): string {
  const t = b.cloneNode(true) as HTMLElement;
  t.querySelectorAll('.rb-icon, .sw, svg, kbd').forEach((x) => x.remove());
  const own = t.textContent!.replace(/\s+/g, ' ').trim();
  const tip = (b.dataset.tip ?? b.title ?? b.getAttribute('aria-label') ?? '').replace(/\s*\(.*?\)/g, '').split(/[.:;,] /)[0].trim();
  return own.length > 2 ? own : tip || own;
}

function commandItems(): CommandItem[] {
  const out: CommandItem[] = [];
  const runCmd = (cmd: string, label: string) => () => {
    finishTyping();
    if (!command(cmd)) flash(`${label} isn't available here.`);
  };
  for (const wrap of document.querySelectorAll<HTMLElement>('header .menu-wrap')) {
    const menu = wrap.querySelector<HTMLElement>(':scope > button')?.textContent?.trim() ?? '';
    for (const b of wrap.querySelectorAll<HTMLElement>('[data-cmd]')) {
      if (b.hidden || getComputedStyle(b).display === 'none') continue;
      const cmd = b.dataset.cmd!, e = topMenuEntry(cmd);
      const label = e?.label ?? cmd;
      out.push({ id: `cmd:${cmd}`, label, place: `${menu} menu`, more: b.title, key: commandKey(cmd), checked: e?.checked, run: runCmd(cmd, label) });
    }
  }
  for (const rib of document.querySelectorAll<HTMLElement>('.ribbon')) {
    if (rib.hidden || !onScreen(rib)) continue;
    for (const b of rib.querySelectorAll<HTMLButtonElement>('button')) {
      if (b.getAttribute('role') === 'tab' || b.hidden || b.disabled || b.closest('[hidden]:not(.rb-panel)')) continue;
      const panel = b.closest<HTMLElement>('.rb-panel');
      const tabAttr = panel && [...panel.attributes].find((a) => /^data-.*-panel$/.test(a.name));
      const tab = tabAttr ? rib.querySelector<HTMLButtonElement>(`[${tabAttr.name.replace(/-panel$/, '-tab')}="${tabAttr.value}"]`) : null;
      if (tab?.hidden) continue; // a tab shown only now and then (Table Design, Chart)
      const label = ribbonLabel(b);
      if (!label) continue;
      const name = b.dataset.cmd ? `cmd:${b.dataset.cmd}` : b.dataset.sh ? `sh:${b.dataset.sh}` : b.dataset.doc ? `doc:${b.dataset.doc}` : b.id ? `id:${b.id}` : `rb:${rib.id}:${label}`;
      const code = b.dataset.cmd ?? b.dataset.sh ?? b.dataset.doc;
      out.push({
        id: name, label, place: tab ? `${tab.textContent!.trim()} tab` : `${rib.getAttribute('aria-label')} ribbon`, more: b.dataset.tip ?? b.title,
        key: code ? commandKey(code) : undefined,
        run: () => {
          if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
          b.click();
        },
      });
    }
  }
  if (onScreen($('#tools'))) {
    for (const [name] of ALL_TOOLS) {
      const label = toolNames[name] ?? ALL_TOOLS.get(name)!.title.split(/[.:] /)[0];
      out.push({ id: `tool:${name}`, label, place: 'Drawing tools', more: ALL_TOOLS.get(name)!.title, key: keysOf('space', `tool ${name}`)[0],
        run: () => { editor.setTool(name); if (name === 'element') periodicTable.open(); } });
    }
  }
  for (const p of recentFiles) {
    const { name, folder } = recentLabel(p);
    out.push({ id: `recent:${p}`, label: `Open ${name}`, place: folder, more: 'recent file', run: () => void openRecent(p) });
  }
  return uniqueCommands(out);
}
const commandSearch = new CommandSearch(commandItems);
$('#btn-search').addEventListener('click', () => commandSearch.open());
placeSidePanel();
// your palettes show in the Colours toolbox as soon as they change
onPalettes(() => { if (toolboxState.places.colours?.shown) toolboxes.render(); });
stylePanel.reaction = {
  roles: (id) => editor.reactionRoles(id),
  others: () => editor.sel.atoms.size + editor.sel.captions.size + editor.sel.shapes.size,
  setRole: (id, role) => { editor.setReactionRole(id, role); },
  reset: (id) => editor.resetReactionRoles(id),
  select: (id, role) => editor.selectRole(id, role),
  cleanUp: () => command('clean-up-reaction'),
  arrange: () => command('arrange-scheme'),
  sideText: (id) => editor.arrowSideText(id),
  setSideText: (id, side, text) => editor.setArrowSideText(id, side, text),
};
stylePanel.tables = {
  part: () => editor.tablePart,
  setPart: (p) => { editor.tablePart = p; },
  update: (id, t) => editor.updateTable(id, t),
  edit: (id, part) => editor.editTable(id, part),
  measure: textMeasure,
};

let stereoSeen = -1;
// scroll bars over the drawing: they cover what is drawn (or the slide), and the part on screen
const scrollbars = new Scrollbars(host, renderer, () => {
  const d = ws.active.deck;
  return d ? { x1: 0, y1: 0, x2: d.size.w, y2: d.size.h } : doc.bounds();
}, () => editor.requestScene());

function showScrollBars(on: boolean): void {
  scrollbars.shown = on;
  $('[data-cmd="scroll-bars"]')?.setAttribute('aria-checked', String(on));
  scrollbars.update(doc.version);
}

editor.onFrame = () => {
  layers?.refresh();
  scrollbars.update(doc.version);
  updatePanels();
  // while dragging, the warnings list and R/S labels wait for the drop (they changed every frame)
  if (editor.dragging) { warnTip.hidden = true; return; }
  updateWarnings();
  if (doc.version !== stereoSeen) { stereoSeen = doc.version; updateStereo(); }
};
const slideText = new SlideTextRibbon($('#ribbon'), {
  format: (f) => editor.formatText(f),
  look: () => editor.textLook(),
  refocus: () => editor.refocusText(),
  nothing: () => flash('Click into some text, or pick a text box or a shape with text, first.'),
});
CaptionEditor.onState = () => { if (ws.active.mode === 'slides') slideText.refresh(); };
editor.onChange = () => { if (ws.active.mode === 'slides') slideText.refresh(); animUi?.selectionChanged(); updateStereo(); scheduleAnalysis(); updatePanels(); ws.noteChange(); stylePanel.refresh(); void refreshDescriptors(); scheduleLabelCheck(); };
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
for (const id of ['#ribbon', '#design-ribbon']) {
  $(id).addEventListener('click', (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLButtonElement>('button[data-cmd]')?.dataset.cmd;
    if (cmd) command(cmd);
  });
}
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
(window as any).__app = { doc, editor, renderer, chem, live, command, addMolfile, cdxml: (name: string) => writeCdxml(doc, { name, textMeasure: measureText }), openText, stressTest, pasteChemistry, placePicture, sample: sampleMolecule, ws, slideList, presenter, Doc, keymap, names, sheetMode, sheetChem, docMode, docxBytes: () => writeDocx(docMode.file!.t, docFiles),
  pptxBytes: () => { const d = deckNow()!; return writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, transition: s.transition, anims: s.anims, comments: s.comments })) }, pptxOptions()); } };

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
