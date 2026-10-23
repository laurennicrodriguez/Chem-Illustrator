// The app window: menus, a tab for each open file (drawings, slide decks and sheets), the
// toolbar, the drawing area (with the slide list and notes in Slides mode, or the grid in Sheet
// mode), and the panels on the right.

import { readDocumentFile, writeDocumentFile } from './io/doc-files';
import { newDocDesign, setNewDocDesign } from './document/themes';
import { fieldEnv } from './document/fields';
import type { QuickPart } from './document/quick-parts';
import { SLIDE_TABLE_STYLES, DEFAULT_SLIDE_TABLE_STYLE } from './deck/table-styles';
import { commandIcon } from './ui/command-icons';
import './app.css';
import type { MethylStyle } from './chem/hydrogens';
import { STANDARD_COLOURS, usedColours } from './colours';
import { ICONS } from './icons';
import { Toolboxes, lockIcon, sideFolded, commandButton, defaultToolboxes, menuCommands, boxIds, boxGrid, boxTitle, flyGrid, isEditable, isOwnBox, overflowOf, type Pickable, type ToolboxDef, type ToolboxState } from './ui/toolboxes';
import { gridItems, inBlock, shownGrid, wrapped, type Grid, type Shown } from './ui/toolbox-grid';
import { ToolboxEditor } from './ui/toolbox-editor';
import { RibbonEditor } from './ui/ribbon-editor';
import { readRibbons, applyRibbon, type RibbonInfo, type RibbonsPrefs } from './ui/ribbon-custom';
import { editPalettes, getPalettes, onPalettes, setPalettes, useDrawingColours, usePaletteMenus } from './ui/palette-ui';
import { Doc, Atom, Caption, Shape, type TextRun, outsideValence, Contents, CHIRAL_FLAGS, PICTURE_STYLES, type PictureLook, type Attachment, type HighlightStyle, type ShapeMath, PAPER, keepOnPage } from './model';
import { Renderer, measureText, forgetTextWidths } from './render/renderer';
import { Editor, TOOLS, type HighlightToggle, type Selection } from './editor/editor';
import { BUILT_IN_LOOKS, type HighlightLookPreset } from './ui/highlight-looks';
import { selectionBox, POINTS, type Align } from './editor/arrange';
import { selectedGroups } from './editor/groups';
import { readCdxml, ReadStats } from './io/cdxml';
import { ChemClient } from './chem/client';
import type { FragmentResult } from './worker/chem-worker';
import { COMMON_ADDUCTS } from './chem/hrms';
import { pubchemName, pubchemCid, pubchemCompound, compoundPage } from './chem/pubchem';
import { pubchemHtml, pubchemRuns, type PubChemState } from './ui/pubchem-panel';
import { paragraphPages } from './document/doc-file';
import { reviewAuthor, setReviewAuthor } from './document/revisions';
import { analysisHtml, electronsHtml, analysisRuns, withRepeats, polymerHtml, descriptorRuns, DEFAULT_DESCRIPTORS, type RepeatUnit } from './ui/analysis-panel';
import { attachedAtoms, attachWhereItIs, defaultGap, nearestStructure, placeAttached, structureSig } from './editor/attached';
import { repeatGroups, lipDirection } from './chem/polymer';
import { rGroupsOf, substituted, rowNumbers, parseRows, rGroupCells, type RowMass } from './chem/rgroup';
import type { Rect, Vec } from './geom';
import { isCurved } from './objects';
import { captionPlaces, fragmentRuns } from './chem/fragments';
import { toMolfile, addMolfile } from './chem/molfile';
import { bestFit, fitMove, fitMatters } from './chem/orient';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { copyDrawing, copyImage, forgetCopy, looksLikeChemistry, extractDrawing, insertDrawing, isEmpty, nativeClipboard, readClipboardText, readNativeClipboard, readPasteEvent, readWebClipboard, clipboardFormats, fitPasted, typicalBondLength, Pasted,
  nativeFirst, writeNativeFormats, looksLikeCdxml, cfHtml, fromCfHtml, CELLS_FORMAT, OWN_FORMAT, CDX_FORMAT, setWordObjects, embeddedPicture, packFormats } from './io/clipboard';
import { cdxToCdxml } from './io/cdx';
import { writeCdxml } from './io/cdxml-write';
import { WORKSPACE, folderOf } from './io/workspace-file';
import { askLink, followLink, setLinkHost, type LinkPlace } from './ui/links-ui';
import { SHOW_JUMPS, cellOfLink, linkSpans, normalizeLink, removeLink, setLink, slideOfLink } from './links';
import { openFileDialog, openBytesDialog, openAnyBytesDialog, stampOf, readRef, saveFileDialog, writeFile, showError, baseName, readPath, withExtension, setEmbeddedWriter, KEYMAP_FILE, SETTINGS_FILE, MOL, PDF, PICTURE, SVG, TIFF, EMF, EPS, PPTX, DOCX, PICTURE_EXTENSIONS, type FileType } from './io/files';
import { readPptx } from './io/pptx-read';
import { pickReuseSlides } from './ui/reuse-slides';
import { writeTiff } from './render/tiff';
import { itemsToEps } from './render/eps';
import { Workspace, Tab } from './workspace';
import { Deck, LayoutId, WIDE, STANDARD, Image as SlideImage, sizeName, SlideSize, slideBackground, slideColours, type SlideSource, contentArea, deckLayouts, type SizeFit } from './deck/deck';
import { shapeMathPicture, shapeMathScale, shapeMathSize } from './deck/equation';
import { askEquation } from './ui/equation-dialog';
import { solid } from './deck/background';
import { formatBackground } from './ui/background-dialog';
import { pictureFormat } from './ui/picture-dialog';
import { fxPng } from './render/picture-fx';
import { drawSlidePage, recordSlide, paintSlide, drawDrawing, SURROUND } from './deck/slide-view';
import { writePdf, jpegInfo, PdfPage, PdfImage } from './io/pdf';
import { SlideList } from './ui/slide-list';
import { DesignLibrary, GEO_DRAG_TYPE, pickDesignSize, sizeLabel } from './ui/design-panel';
import { ShapeMenu } from './ui/shape-menu';
import { loadIcons, whenIconsLoaded } from './design/icons';
import { SlideTextRibbon } from './ui/slide-text-ribbon';
import { CaptionEditor } from './ui/caption-editor';
import { LayersPanel } from './ui/layers-panel';
import { Scrollbars } from './ui/scrollbars';
import { Presenter, type ShowOptions } from './ui/present';
import { editHeaderFooter } from './ui/header-footer-dialog';
import { setUpShow, editCustomShows } from './ui/show-setup-dialog';
import { defaultShow, showOrder } from './deck/show-setup';
import { recordingToWav, NARRATION_NAME } from './deck/narration';
import { clockText } from './deck/show-link';
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
import { EFFECTS, animName, newAnim, highlightParts } from './deck/animation';
import { SLIDE_TEMPLATES, applyTemplate, type SlideTemplate } from './deck/templates';
import { editLayouts } from './ui/layout-editor';
import { pickSlideSize } from './ui/slide-size-dialog';import { pickTemplate } from './ui/template-gallery';
import { showContextMenu, topMenuEntry, type MenuItem } from './ui/context-menu';
import { defaultHandout, handoutLayout, handoutPageSvg, notesPageSize, notesPageSvg, type HandoutSetup } from './deck/notes-pages';
import { OutlineView } from './ui/outline-view';
import { NotesPageView, editHandoutMaster, editNotesMaster } from './ui/notes-page-view';
import { GuideTip, SlideRulers, drawGuides, gridAndGuides } from './ui/slide-guides';
import { defaultView, guideNear, rulerText, snapMove, type RulerPrefs, type SlideView } from './deck/guides';
import { effectPatch, effectsMenu, showStyleGallery, styleColours, stylePatch } from './ui/shape-styles';
import { CommandSearch, uniqueCommands, type CommandItem } from './ui/command-search';
import { fillTemplate, templateSize } from './design/templates';
import { askCycle } from './ui/cycle-dialog';
import { askEnergy } from './ui/energy-dialog';
import { askDiagram } from './ui/diagram-dialog';
import { putDiagram, type DiagramData } from './design/diagrams';
import type { EnergyData } from './design/energy';
import { editChart, chartPoints } from './ui/chart-editor';
import { editMedia } from './ui/media-dialog';
import { refreshZooms, summaryParts, zoomGrid, zoomShape } from './deck/zoom';
import { inkShape } from './ui/show-ink';
import { AUDIO_TYPES, VIDEO_TYPES, mediaMime, probeAudio, probeVideo, speakerPng } from './deck/media';
import { newChartBox, sizedBox } from './sheet/chart-box';
import { chartBoxPng } from './render/chart-box-paint';
import { itemsToSvg } from './render/svg';
import { itemsToEmf, type EmfBox } from './render/emf';
import type { Item } from './render/vector';
import { PAPERS, defaultPaper, orient, placeIn, inside, placeSvg, pageSvg } from './print-layout';
import { printPages } from './ui/print';
import { dataUrl, fromDataUrl, imageSize, loadImage, onImageReady, pictureMime, showableSrc, webpToPng } from './render/images';
import { freeRing, fusedRing, placeRing, sprout, ringOnAtom, ringDir } from './chem/chemgeom';
import { Toolbar, ToolbarItem, PaletteDef, type ToolDef } from './ui/toolbar';
import { StylePanel, tidyStyle } from './ui/style-panel';
import { installCombos } from './ui/combo';
import { installFontList, registerBundledFonts, bundledFaces, pdfFonts } from './fonts';
import { applyRibbonIcons } from './ui/ribbon-icons';
import { TEMPLATES, Template, templateById, ownTemplates, setOwnTemplates, templateFromAtoms } from './chem/templates';
import { centreEnd } from './chem/hapto';
import { countElectrons } from './chem/electrons';
import { addNicknames, removeNickname, isBuiltInNickname, builtInNicknames, labelPrefs, tokenize as tokenizeLabel } from './chem/labels';
import { selectedGroup } from './chem/group-smiles';
import { templateIcon } from './ui/template-icons';
import { StructureChecks } from './chem/warnings';
import { idText, labelClashes, parseIdStart, type IdStyle } from './chem/compound-numbers';
import { schemeItems, isReactionArrow } from './chem/reaction';
import { labelsOf, schemePrefs, setSchemePrefs, SPACING, type SchemePrefs } from './chem/scheme-layout';
import { plainText, savableChar } from './richtext';
import { htmlToRich } from './text/html';
import { LiveStereo } from './chem/live-stereo';
import { setStereoShown, shownDescriptor, axialStyle } from './chem/stereo';
import { keymap, registerToolNames, displayChord, actionName, chordOf, parseAction, KeyContext, KeyOverrides } from './editor/keymap';
import { loadSettings, saveSettings, settingsLocation, exportText, importSettings, Settings } from './settings';
import { showDialog } from './ui/dialog-host';
import { HotkeysDialog } from './ui/hotkeys-dialog';
import { TypingDialog } from './ui/typing-dialog';
import { ModeColoursDialog, ModeColours, DEFAULT_MODE_COLOURS, applyModeColours } from './ui/mode-colours';
import { typingPrefs, setTypingPrefs, onTypingPrefs } from './text/typing';
import { NicknameChooser } from './ui/nickname-chooser';
import { ask } from './ui/ask';
import { UpdateUI } from './ui/update-ui';
import { canUpdate, appVersion, portableInfo, STAGE, STAGE_NOTE, UPDATE_CHANNELS, type UpdateChannel } from './updates';
import { computerName } from './feedback';
import { GuideWindow, guideSpot } from './ui/guide-window';
import { SettingsWindow } from './ui/settings-window';
import { fileTypesPage, FILE_TYPES } from './ui/file-types-page';
import { watchRibbons, fitRibbons, setRibbonCollapsed, ribbonCollapsed } from './ui/ribbon-fit';
import { placeTitleBar, titleBarPlace } from './ui/title-bar';
import { FeedbackDialog } from './ui/feedback-dialog';
import { addRecent, removeRecent, recentLabel } from './recent';
import { NameReader, captionName, attachmentAtoms, cxNotes } from './chem/names';
import { NameDialog } from './ui/name-dialog';
import { ArrangeDialog } from './ui/arrange-dialog';
import { AnimateDialog } from './ui/animate-dialog';
import { PeriodicTable } from './ui/periodic-table';
import { SheetMode, ClipboardCells } from './ui/sheet-mode';
import { DocumentMode, DocPaste } from './ui/doc-mode';
import { docBoxPrefs, parseDocPins } from './ui/doc-panel';
import { docRulerPrefs } from './ui/ruler';
import { formulaBarPrefs } from './ui/sheet-views-ui';
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
import { fromEmbedSource, type Embedded } from './io/ole-object';
import { objectPicture, type ObjectPicture } from './render/object-picture';
import { ACS_1996, DocStyle } from './style';
import { emptyTable, tableFromCells } from './table';
import type { TableData } from './model';
import { checkDrawing, checkDocument, checkWorkbook, repeatedTitles, structureAlt, setStructureAlt, type Issue, type IssuePlace } from './accessibility';
import { AccessibilityPane, askAltText } from './ui/accessibility-pane';
import { SlideComparePane } from './ui/slide-compare';
import { pickFileTemplate } from './ui/file-templates';
import type { PastedRows } from './io/table-clip';
import { Keeper } from './keep/keeper';
import { DEFAULT_KEEP, type KeepPrefs } from './keep/prefs';
import { Brush, paintObjects, pickObjectLook, type ObjectLook, type TextLook } from './format-painter';
import { SymbolWindow } from './ui/symbol-window';
import { Navigator, EdgeArrows, paintGrid, paintTint, type Target } from './ui/orientation';
import { type OrientPrefs, DEFAULT_ORIENT } from './orientation-prefs';
import { addRecent as addRecentSymbol } from './text/symbols';
import type { CellBlock } from './sheet/workbook';

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
  // the style panel shows R/S and E/Z of what is selected
  stylePanel.refresh();
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
/** The style each mode's new tabs take when you haven't chosen one: slides are seen from the back of a room, so their structures are twice ACS size. */
const MODE_STYLE_DEFAULTS: Partial<Record<StyleMode, string>> = { slides: 'Slides (ACS 1996 × 2)' };
const modeStyleFor = (mode: StyleMode): string | undefined => modeStyles[mode] ?? MODE_STYLE_DEFAULTS[mode];
/** View > Dark Page: on or off, which palette, and your own palettes. */
const dark = { on: false, palette: 'Graphite', own: [] as DarkPalette[] };
/** Finding your way round drawings (Settings ▸ Navigation): navigator, edge arrows, dot grid, outside tint, Fit and Go to Selection buttons. */
let orientPrefs: OrientPrefs = { ...DEFAULT_ORIENT };
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
// a slide, page or drawing still fitted to the window is fitted again, so a smaller window never cuts it off
new ResizeObserver(() => {
  const refit = editor.stillFitted;
  if (!resize()) return;
  if (refit) editor.fit();
  editor.frame();
}).observe(host);

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
    { name: 'arrow-s', title: 'S-shaped curved arrow (two bends), for electrons that have to go round something. Snaps like the curved arrow; hold Alt to draw freely' },
    { name: 'arrow-s-fishhook', title: 'S-shaped half-headed arrow (one electron, two bends). Snaps like the curved arrow; hold Alt to draw freely' },
    { name: 'arrow-pen', title: 'Pen arrow. Click to place anchors, drag to pull out curve handles, Enter or double-click to finish. Its ends stick to the atom, bond or lone pair they start and end on. On a selected pen arrow: click its line to add an anchor, click an anchor to delete it, Alt+click to make it a corner, Alt+drag to pull handles out' },
    { name: 'arrow-pen-fishhook', title: 'Pen half-headed arrow (one electron). Click to place anchors, drag to pull out curve handles, Enter or double-click to finish' },
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
    { name: 'bracket-ts', title: 'Transition-state brackets: square brackets with ‡ at the upper right' },
    { name: 'bracket-left', title: 'Single bracket [ (left half only)' },
    { name: 'bracket-right', title: 'Single bracket ] (right half only)' },
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
    { name: 'sym-ddagger', title: 'Double dagger (‡) for a transition state: click where it goes' },
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
// 3-D templates kept off the palettes until they are redrawn; Fuse a Ring Here still uses some of them.
const OFF_PALETTE = new Set([
  'boat-ae', 'twist-boat', 'half-chair', 'half-chair-ae', 'cyclohexanone', 'envelope', 'envelope-ae', 'c5-twist', 'cyclopentene',
  'cyclobutane', 'cyclobutane-ae', 'cyclopropane-ae', 'c7-twist-chair', 'c8-boat-chair', 'c8-crown', 'cot-tub',
  'cis-bicyclooctane', 'perhydroazulene', 'twistane',
]);
const templatePalette = (group: Template['group'] | Template['group'][], palette: string, title: string, columns: number, iconSize?: number): PaletteDef => ({
  palette,
  title,
  items: TEMPLATES.filter((t) => (Array.isArray(group) ? group.includes(t.group) : t.group === group) && !OFF_PALETTE.has(t.id)).map((t) => ({ name: `tpl-${t.id}`, title: t.name })),
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
    { name: 'bond-partial', title: 'Partial bond: one forming or breaking in a transition state, drawn dashed. It leaves both atoms\' hydrogens as they were (hotkey P over a bond)' },
    { name: 'bond-wavy', title: 'Wavy bond' },
    { name: 'bond-dative', title: 'Dative bond: draw from the donor atom to the acceptor. Click again to reverse' },
    { name: 'bond-hapto', title: 'Hapto (η) bond: drag from a metal into a ring or onto a π-bond to bond it to the middle (η⁵-Cp, η⁶-arene, η²-alkene); click inside a ring or on a bond for a new metal there. Click a hapto bond to draw it to each atom' },
    { name: 'chain', title: 'Chain: drag to draw a zig-zag chain, or click to type how many atoms (Alt+click: the same number again)' },
  ],
  // the everyday tools next, where they show without scrolling
  [
    { name: 'text', title: 'Text: click an atom to label it, or empty space for a caption' },
    ARROWS,
    SYMBOLS,
    BRACKETS,
    SHAPES,
    { name: 'fragment', title: 'Mass fragmentation: drag a line across bonds (or click a bond) to break them and label each piece with its formula and mass' },
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
    templatePalette(['conformers', 'fused'], 'tpl-conformers', 'Conformers and fused rings in 3-D', 5, 64),
    templatePalette(['projections', 'stereo'], 'tpl-projections', 'Projections and stereocentres', 6, 56),
    templatePalette('cycloalkanes', 'tpl-cycloalkanes', 'Large rings', 6, 56),
    templatePalette('aromatics', 'tpl-aromatics', 'Aromatics', 6, 56),
    templatePalette('perspective', 'tpl-perspective', 'Rings in perspective', 6, 56),
    templatePalette(['geometries', 'organometallic'], 'tpl-metal', 'Metal complexes', 6, 64),
    templatePalette('metallocenes', 'tpl-metallocenes', 'Metallocenes and half-sandwich complexes', 6, 64),
    templatePalette('ligands', 'tpl-ligands', 'Ligands', 6, 64),
    OWN_PALETTE,
  ],
];

/** Tools kept off the bar, still reached by their keys, Search and the menus (Chemistry > Periodic Table). */
const OFF_BAR: ToolbarItem[] = [
  { name: 'bond-quadruple', title: 'Quadruple bond (metal–metal)' },
  { name: 'element', title: 'Periodic table: pick an element, then click atoms to change them' },
];

const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

/** The keys that do an action, as people read them. */
function keysOf(ctx: KeyContext, action: string): string[] {
  return keymap.keysFor(ctx, action).map((k) => displayChord(k, isMac));
}

// Tool names for the Hotkeys window: the tool tip up to its first full stop or colon.
const toolNames: Record<string, string> = {};
for (const group of [...TOOL_GROUPS, OFF_BAR]) {
  for (const item of group) {
    for (const t of 'palette' in item ? item.items : [item]) toolNames[t.name] = t.title.replace(/\s*\(.*?\)/g, '').split(/[.:] /)[0];
  }
}
registerToolNames(toolNames);

/** Each fly-out palette by name, and the palette each tool in one comes in (for its picture). */
const PALETTES = new Map<string, PaletteDef>();
const TOOL_PALETTE = new Map<string, PaletteDef>();
for (const group of TOOL_GROUPS) for (const item of group) {
  if (!('palette' in item)) continue;
  PALETTES.set(item.palette, item);
  for (const t of item.items) TOOL_PALETTE.set(t.name, item);
}
/** What the Drawing Tools toolbox comes with: the tool bar's groups, a divider between each. */
const MAIN_ITEMS: string[] = TOOL_GROUPS.flatMap((g, i) => [...(i ? ['sep'] : []), ...g.map((it) => ('palette' in it ? `pal:${it.palette}` : `tool:${it.name}`))]);

const periodicTable = new PeriodicTable((z) => editor.pickElement(z), () => editor.element);
const toolbar = new Toolbar($<HTMLDivElement>('#tools'), TOOL_GROUPS, (name) => {
  if (name === OWN_ADD) { void saveTemplate(); return; }
  pickTool(name);
}, (name) => {
  const keys = keysOf('space', `tool ${name}`);
  return keys.length ? ` (${keys.join(', ')})` : '';
}, (name, size) => TOOL_PALETTE.get(name)?.icon?.(name, size));

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
const CURVE_HINT = 'Drag from where the electrons start (lone pair, bond, radical, charge) to where they go (atom, bond, or the gap where a new bond forms); swing out to one side to bend that way. The arrow sticks to the structure. Drag the middle dot (an S: its diamonds) to change the curve.';
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
/** View > Ruler and Gridlines (kept in the settings); the rulers' units and where they count from. */
const slideLook = { ruler: false, grid: false };
const rulerPrefs: RulerPrefs = { units: 'in', from: 'centre' };
/** A guide being dragged: which, and the guides as they are while it moves. */
let guideDrag: { which: { axis: 'x' | 'y'; i: number }; view: SlideView } | null = null;
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
    const mime = /\.(cdxml|cdx|pptx|xlsx|xlsm|xls|ods|docx|csv|tsv|txt|sdf?)$/i.test(f.name) ? null : pictureMime(f.name, bytes);
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
    // a scheme too big for the slide's content area is made smaller to fit it, below the title
    const area = slideContentArea(), b = got.doc.bounds(), L = typicalBondLength(got.doc);
    if (area && b && L) {
      const k = Math.min(1, (0.95 * (area.x2 - area.x1)) / Math.max(1, b.x2 - b.x1), (0.95 * (area.y2 - area.y1)) / Math.max(1, b.y2 - b.y1));
      if (k < 0.999) fitPasted(got.doc, doc.style, L * k);
    }
    editor.sel = insertDrawing(doc, got.doc, pasteCentre());
    editor.changed();
  } else if (got.kind === 'text') await pasteText(got.text, got.html);
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

/** The table style last picked for a slide table (PowerPoint's default, Medium Style 2 – Accent 1, at first). */
let lastTableStyle = DEFAULT_SLIDE_TABLE_STYLE;

/** Insert > Table: an empty table of the rows and columns asked for, ready to type into. */
async function insertTable(): Promise<void> {
  finishTyping();
  // on slides the look is a choice: a journal's ACS rules, or a PowerPoint style
  const onSlide = !!deckNow();
  const got = await ask('Insert Table', [
    { name: 'rows', label: 'Rows', value: '4', type: 'number' },
    { name: 'cols', label: 'Columns', value: '3', type: 'number' },
    ...(onSlide ? [{ name: 'style', label: 'Style', value: lastTableStyle, options: [{ value: '', label: 'ACS rules' }, ...SLIDE_TABLE_STYLES.map((st) => ({ value: st.id, label: st.name }))] }] : []),
  ], { ok: 'Insert', note: onSlide ? 'The Style panel changes the style, its options, the cells\' colours and which cells are merged.' : 'An ACS-style table: a rule above and below the heading row and under the last row. The Style panel changes the lines, headings, rows and columns.' });
  if (!got) return;
  const rows = Math.max(1, Math.min(500, Math.round(Number(got.rows) || 4)));
  const cols = Math.max(1, Math.min(60, Math.round(Number(got.cols) || 3)));
  if (onSlide) lastTableStyle = got.style ?? '';
  // columns centred (the Style panel lines up each column its own way)
  const t0 = { ...emptyTable(rows, cols, doc.style.captionSize), align: Array(cols).fill('center') };
  const id = placeTable(onSlide && got.style ? { ...t0, style: got.style } : t0, 'Insert table');
  editor.editTable(id, { r: 0, c: 0 });
}

/** The part of the slide showing that pasted things go in (below the title), in Slides mode. */
function slideContentArea(): Rect | null {
  const deck = deckNow();
  return deck ? contentArea(deck.current?.layout ?? 'blank', deck.size, deck.master) : null;
}

/** Where pasted things go: the middle of the slide's content area in Slides mode, else the middle of the window. */
function pasteCentre(): { x: number; y: number } {
  const a = slideContentArea();
  return a ? { x: (a.x1 + a.x2) / 2, y: (a.y1 + a.y2) / 2 } : renderer.toDoc(renderer.width / 2, renderer.height / 2);
}

/** Paste a SMILES string or a molfile as a structure. With `quiet`, text that isn't one is left (false) without a message. */
async function pasteChemistry(text: string, quiet = false): Promise<boolean> {
  if (!chem.ready) { flash('The chemistry engine is still loading.'); return true; }
  const c = pasteCentre();
  let mb: string | null = text.includes('M  END') ? text : null;
  if (!mb && !/\s/.test(text)) mb = await chem.smilesToMol(text);
  if (!mb) { if (!quiet) flash('Paste a SMILES string or a molfile.'); return false; }
  try {
    let ids: number[] = [];
    doc.edit('Paste', () => { ids = addMolfile(doc, mb!, c.x, c.y); });
    selectNewAtoms(ids);
  } catch (err) {
    flash(String(err));
  }
  return true;
}

/**
 * Pasted text on a drawing, slide or design: a SMILES string or a molfile becomes a structure;
 * other text (a Document's, Word's, a web page's) a text box in the middle, with its bold,
 * italics, sub- and superscripts and colours from the HTML that came with it.
 */
async function pasteText(text: string, html?: string): Promise<void> {
  if (looksLikeChemistry(text) && await pasteChemistry(text, true)) return;
  const rich = html ? htmlToRich(html) : null;
  // (the drawing's caption font and size, as typed text gets)
  const runs = (rich?.runs ?? [{ text } as TextRun]).map(({ size: _s, font: _f, obj: _o, ...r }: TextRun) => r).filter((r) => r.text);
  if (!runs.length) { flash('There is nothing to paste.'); return; }
  const paras = rich && rich.paras.length > 1 ? rich.paras : undefined;
  finishTyping();
  renderer.useStyle(doc);
  const c = pasteCentre();
  // long text wraps: to the slide's content area, or about 25 bond lengths on a drawing
  const area = slideContentArea();
  const most = area ? area.x2 - area.x1 : doc.style.bondLength * 25;
  const frame = (wrap?: number) => renderer.captionFrame({ id: -1, x: 0, y: 0, runs, justify: 'left', ...(paras ? { paras } : {}), ...(wrap ? { wrap } : {}) } as Caption);
  let b = frame();
  const wrap = b.x2 - b.x1 > most ? most : undefined;
  if (wrap) b = frame(wrap);
  let id = 0;
  doc.edit('Paste text', () => {
    id = doc.addCaption({ x: c.x - (b.x1 + b.x2) / 2, y: c.y - (b.y1 + b.y2) / 2, runs, justify: 'left', ...(paras ? { paras } : {}), ...(wrap ? { wrap } : {}) }).id;
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set([id]), arrows: new Set(), shapes: new Set() };
  editor.changed();
}

/** Insert ▸ Catalytic Cycle…: a ready-made cycle to edit, or the selected structures put round one. */
async function insertCycle(): Promise<void> {
  finishTyping();
  const got = await askCycle(editor.selectedStructures().length);
  if (got) editor.insertCycle(got.spec, got.look, pasteCentre(), deckNow()?.size);
}

/** The Energy Diagram window's preview: the diagram as it will be drawn, fitted to the canvas. */
function paintEnergyPreview(d: EnergyData, canvas: HTMLCanvasElement): void {
  const { doc: tmp, box } = editor.energyPreview(d);
  const w = canvas.clientWidth || 360, h = canvas.clientHeight || 200, dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const bw = box.x2 - box.x1, bh = box.y2 - box.y1, pad = 8;
  const k = Math.min((w - 2 * pad) / bw, (h - 2 * pad) / bh);
  ctx.setTransform(k * dpr, 0, 0, k * dpr, (w / 2 - (box.x1 + bw / 2) * k) * dpr, (h / 2 - (box.y1 + bh / 2) * k) * dpr);
  drawDrawing(ctx, tmp);
}

/** Insert ▸ Energy Diagram…, or the selected diagram's numbers to change (`id`, its frame). */
async function energyDiagram(id: number | null): Promise<void> {
  finishTyping();
  const L = doc.style.bondLength;
  const now = id !== null ? doc.shapes.get(id)?.energy ?? null : null;
  const got = await askEnergy(now, { w: Math.round(18 * L), h: Math.round(12 * L) }, paintEnergyPreview);
  if (got) editor.putEnergyDiagram(got, pasteCentre(), now ? id! : undefined, deckNow()?.size);
}
editor.onEnergy = (id) => void energyDiagram(id);

/** A diagram drawn as an SVG picture, for the diagram window's preview and its layout buttons. */
function diagramSvg(d: DiagramData): string {
  const x = new Doc();
  x.edit('Diagram', () => putDiagram(x, POINTS, d, { x: 0, y: 0 }));
  const pic = recordPicture(x, 2);
  return pic ? pictureSvg(pic) : '';
}

/** Insert ▸ Diagram…, or the selected diagram's text and look to change (`id`, its frame). */
async function smartDiagram(id: number | null): Promise<void> {
  finishTyping();
  const now = id !== null ? doc.shapes.get(id)?.diagram ?? null : null;
  const got = await askDiagram(now, { preview: diagramSvg, scale: deckNow() ? 1 : 0.7, doc });
  if (got) editor.putDiagramAt(got, pasteCentre(), now ? id! : undefined, deckNow()?.size);
}
editor.onDiagram = (id) => void smartDiagram(id);

/** A document's diagram: a new one, or the one in a figure (its drawing) to change. Null when cancelled. */
async function documentDiagram(contents: Contents | null): Promise<Contents | null> {
  const d = structureDoc(contents ?? { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] }, docStyle());
  const frame = [...d.shapes.values()].find((s) => s.diagram);
  const got = await askDiagram(frame?.diagram ?? null, { preview: diagramSvg, scale: 0.75, doc: d });
  if (!got) return null;
  d.edit(frame ? 'Change Diagram' : 'Diagram', () => putDiagram(d, POINTS, got, frame ? { x: Math.min(frame.x1, frame.x2), y: Math.min(frame.y1, frame.y2) } : { x: 0, y: 0 }, frame?.id));
  return d.contents();
}

/** Insert > Chart: a chart with its own data (sample data to type over), in the middle of the slide or window. */
async function insertChart(): Promise<void> {
  finishTyping();
  const deck = deckNow();
  // on a slide: most of the slide, with text the size PowerPoint gives a chart's (about 13 pt)
  const slides = !!deck && ws.active.mode === 'slides';
  const fit = deck ? Math.min(slides ? 2 : 1, (deck.size.w * 0.7) / 360, (deck.size.h * 0.7) / 216) : 1;
  const box = newChartBox('column', 360 * fit, 216 * fit);
  if (slides) box.chart.fontSize = 18;
  const got = await editChart(box, true, flash);
  if (!got || got === 'delete') return;
  const { w, h } = chartPoints(got.chart);
  const c = pasteCentre();
  let made: Shape | null = null;
  doc.edit('Insert chart', () => {
    made = doc.addShape({ kind: 'picture', x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, src: chartBoxPng(got, w, h), px: { w: got.chart.w, h: got.chart.h }, chart: got });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([made!.id]) };
  editor.changed();
}

/** Double-clicking a chart on a slide or drawing: its data and settings. */
async function editChartShape(id: number): Promise<void> {
  finishTyping();
  const s = doc.shapes.get(id);
  if (!s?.chart) return;
  const x = Math.min(s.x1, s.x2), y = Math.min(s.y1, s.y2);
  const got = await editChart(sizedBox(s.chart, Math.abs(s.x2 - s.x1), Math.abs(s.y2 - s.y1)), false, flash);
  if (!got || !doc.shapes.get(id)?.chart) return;
  if (got === 'delete') { doc.edit('Delete chart', () => doc.removeShape(id)); editor.changed(); return; }
  const { w, h } = chartPoints(got.chart);
  doc.edit('Change chart', () => doc.updateShape(id, { chart: got, src: chartBoxPng(got, w, h), px: { w: got.chart.w, h: got.chart.h }, x1: x, y1: y, x2: x + w, y2: y + h, crop: undefined }));
  editor.changed();
}
editor.onChart = (id) => void editChartShape(id);

/** A video or sound's Playback window (double-click it, or Playback… in the panel). */
async function editMediaShape(id: number): Promise<void> {
  finishTyping();
  const s = doc.shapes.get(id);
  if (!s?.video) return;
  const got = await editMedia(s.video);
  if (!got || !doc.shapes.get(id)?.video) return;
  doc.edit(s.video.audio ? 'Audio playback' : 'Video playback', () => doc.updateShape(id, { video: got }));
  editor.changed();
}
editor.onMedia = (id) => void editMediaShape(id);

/** Insert > Video or Audio: a file put on the slide, starting when clicked and playing once, as in PowerPoint. */
async function insertMedia(audio: boolean): Promise<void> {
  const exts = Object.keys(audio ? AUDIO_TYPES : VIDEO_TYPES);
  let f;
  try {
    f = await openBytesDialog(audio ? 'Sounds' : 'Videos', [], exts);
  } catch (e) {
    await showError('Could not open the file: ' + String(e));
    return;
  }
  if (!f) return;
  const type = mediaMime(f.name);
  if (!type) { flash(`${f.name} isn't a ${audio ? 'sound' : 'video'} file this takes (${exts.join(', ')}).`); return; }
  if (f.bytes.length > 200 * 1024 * 1024) flash('This is a big file: it is kept inside the slide file, which grows by as much.', 8000);
  const src = dataUrl(f.bytes, type.mime);
  let px = { w: 128, h: 128 }, poster = '', length = 0;
  if (type.audio) {
    poster = speakerPng();
    length = await probeAudio(src);
  } else {
    flash('Reading the video…');
    const got = await probeVideo(src);
    if (!got) { flash(`This computer can't play ${f.name}. MP4 (H.264) videos play everywhere, PowerPoint too.`, 8000); }
    if (got) { px = { w: got.w, h: got.h }; poster = got.poster; length = got.length; }
  }
  if (!poster) poster = speakerPng();
  finishTyping();
  const deck = deckNow();
  const room = deck ? { w: deck.size.w * 0.6, h: deck.size.h * 0.6 } : { w: (renderer.width * 0.6) / renderer.view.scale, h: (renderer.height * 0.6) / renderer.view.scale };
  const k = type.audio ? 0.375 : Math.min(0.75, room.w / px.w, room.h / px.h);
  const w = px.w * k, h = px.h * k;
  const c = deck && type.audio ? { x: deck.size.w / 2, y: deck.size.h / 2 } : pasteCentre();
  let made: Shape | null = null;
  doc.edit(type.audio ? 'Insert audio' : 'Insert video', () => {
    made = doc.addShape({
      kind: 'picture', x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, px, src: poster,
      video: { src, ...(type.audio ? { audio: true } : {}), start: 'click', once: true, ...(length ? { length: +length.toFixed(3) } : {}) },
    });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([made!.id]) };
  editor.changed();
  flash(`${type.audio ? 'Sound' : 'Video'} added: it starts when clicked in the show. Double-click it to trim it or change how it plays.`, 6000);
}

/**
 * Insert > Zoom > Slide Zoom: pictures of the slides picked, on this slide; clicked in the show,
 * each zooms into its slide. Summary Zoom: a new slide before the first one picked, with a zoom
 * for each part of the deck (from each slide picked to the next), each coming back to it.
 */
async function insertZoom(summary: boolean): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') { flash('Zooms go on slides: use File > New Slides, or open a PowerPoint file.'); return; }
  finishTyping();
  refreshZooms(d);
  const pick = await pickReuseSlides('', d, false, summary
    ? { title: 'Summary Zoom', note: 'Click the first slide of each part of your talk (Shift+click picks a run). A new slide goes in before the first of them, with a zoom for each part: in the show, a click on one plays its part and comes back.', verb: (n) => (n ? `Insert Summary Zoom (${n} part${n === 1 ? '' : 's'})` : 'Insert Summary Zoom') }
    : { title: 'Slide Zoom', note: 'Click the slides to zoom to (Shift+click picks a run). In the show, a click on a zoom zooms into its slide; turn on Return to Zoom in the panel to come back afterwards.', verb: (n) => (n > 1 ? `Insert ${n} Zooms` : 'Insert Zoom') });
  if (!pick?.indices.length) return;
  if (summary) {
    const parts = summaryParts(pick.indices, d.slides.length);
    const ids = parts.map((p) => ({ first: d.slides[p.first].id, last: d.slides[p.last].id }));
    const at = parts[0].first;
    d.insertSlide(at, 'title-only', (sd) => {
      const title = [...sd.captions.values()].find((c) => c.ph === 'title');
      if (title) sd.updateCaption(title.id, { runs: [{ text: 'Summary' }] });
      const area = { x1: d.size.w * 0.06, y1: d.size.h * 0.26, x2: d.size.w * 0.94, y2: d.size.h * 0.94 };
      // the slides moved one along: their pictures are drawn from the deck before the new slide goes in
      zoomGrid(ids.length, d.size, area).forEach((box, k) => {
        const i = d.slides.findIndex((s) => s.id === ids[k].first);
        const z = i >= 0 ? zoomShape(d, i, box, { back: true, ...(ids[k].last !== ids[k].first ? { to: `#slide=${ids[k].last}` } : {}) }) : null;
        if (z) sd.addShape(z);
      });
    }, 'Insert Summary Zoom');
    flash('Summary Zoom added. In the show, click a zoom to play its part; the show comes back here after it.', 7000);
    return;
  }
  const area = { x1: d.size.w * 0.1, y1: d.size.h * 0.3, x2: d.size.w * 0.9, y2: d.size.h * 0.9 };
  const boxes = zoomGrid(pick.indices.length, d.size, area);
  const made: number[] = [];
  doc.edit(pick.indices.length > 1 ? 'Insert slide zooms' : 'Insert slide zoom', () => {
    pick.indices.forEach((i, k) => { const z = zoomShape(d, i, boxes[k], {}); if (z) made.push(doc.addShape(z).id); });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set(made) };
  editor.changed();
}

/** What a click does in the slide show (Insert > Action), for the selected shapes or action buttons. */
async function actionSettings(): Promise<void> {
  const d = deckNow();
  const shapes = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((s): s is Shape => !!s && s.kind === 'geo' && !s.diagram && !s.energy);
  if (!d || !shapes.length) { flash('Select an action button or a shape on a slide first (Insert > Shapes > Action buttons).'); return; }
  const cur = shapes[0].link ?? '';
  const slides = d.slides.map((s, i) => ({ value: `#slide=${s.id}`, label: `Slide ${i + 1}${slideTitle(d, i) ? `: ${slideTitle(d, i)}` : ''}` }));
  const jumps = Object.entries(SHOW_JUMPS).map(([value, label]) => ({ value, label }));
  const kind = !cur ? 'none' : cur in SHOW_JUMPS || slideOfLink(cur) !== null ? 'place' : 'url';
  const got = await ask('Action Settings', [
    { name: 'kind', label: 'On a click', value: kind, options: [{ value: 'none', label: 'Nothing' }, { value: 'place', label: 'Go to a slide' }, { value: 'url', label: 'Open a web page or file' }] },
    { name: 'place', label: 'Slide', value: kind === 'place' ? cur : '#next', options: [...jumps, ...slides] },
    { name: 'url', label: 'Web page or file', value: kind === 'url' ? cur : '', placeholder: 'https://… or a file path' },
  ], { ok: 'OK', note: 'What happens when this is clicked in the slide show. Saved as PowerPoint\'s own action.' });
  if (!got) return;
  const link = got.kind === 'place' ? got.place : got.kind === 'url' ? normalizeLink(got.url) ?? '' : '';
  doc.edit('Action settings', () => { for (const s of shapes) doc.updateShape(s.id, { link: link || undefined }); });
  editor.changed();
}

/**
 * Insert > Equation on a slide or design: typed as LaTeX in the equation window, in the
 * master's body text (its font, colour and size), in the middle of the slide.
 */
// ------------------------------------------------------------------ links

/** A slide's title (its title placeholder's text), for the link window's list. */
function slideTitle(d: Deck, i: number): string {
  for (const c of d.docOf(i).captions.values()) if (c.ph === 'title') return plainText(c.runs).replace(/\s+/g, ' ').trim();
  return '';
}

/** The places in the deck a link can go to: each slide (by its title), and the slide show's own jumps. */
function slidePlaces(): { places: LinkPlace[]; title: string } | null {
  const d = deckNow();
  if (!d || ws.active.mode === 'design') return null;
  const places: LinkPlace[] = d.slides.map((s, i) => ({ link: `#slide=${s.id}`, label: `${i + 1}. ${slideTitle(d, i) || `Slide ${i + 1}`}` }));
  places.push({ link: '', label: 'In the slide show' }, ...Object.entries(SHOW_JUMPS).map(([link, label]) => ({ link, label, depth: 1 })));
  return { places, title: 'Slide in this deck' };
}

/** The selected captions (not one being typed). */
function pickedCaptions(): Caption[] {
  return [...editor.sel.captions].map((id) => doc.captions.get(id)).filter((c): c is Caption => !!c);
}

/**
 * Insert > Link (Ctrl+K) in drawings and slides: the text being typed (its selection), or the
 * whole text of the selected captions and text boxes, as PowerPoint links a whole shape.
 */
async function insertLink(): Promise<void> {
  const typing = editor.typingCaption;
  if (typing) { await typing.editLink(); return; }
  const caps = pickedCaptions();
  if (!caps.length) { flash('Select the text to link (or a text box or caption), then choose Link. Ctrl+K while typing links the selected words.'); return; }
  const first = caps[0];
  const old = linkSpans(first.runs)[0]?.link;
  const text = caps.length === 1 ? plainText(first.runs) : '';
  const p = slidePlaces();
  const got = await askLink({ text: caps.length === 1 && !text.includes('\n') ? text : null, link: old, places: p?.places, placeTitle: p?.title });
  if (!got) return;
  doc.edit('remove' in got ? 'Remove Link' : old ? 'Edit Link' : 'Insert Link', () => {
    for (const c of caps) {
      const n = plainText(c.runs).length;
      const runs = 'remove' in got ? removeLink(c.runs, 0, n) : setLink(c.runs, 0, n, got.link, caps.length === 1 ? got.text : undefined).runs;
      doc.updateCaption(c.id, { runs });
    }
  });
  editor.changed();
}

/** Remove Link on the text being typed, or on the selected captions. */
function removeLinks(): boolean {
  const typing = editor.typingCaption;
  if (typing) { typing.ed.removeLink(); return true; }
  const caps = pickedCaptions().filter((c) => c.runs.some((r) => r.link));
  if (!caps.length) { flash('Select text with a link first.'); return false; }
  doc.edit('Remove Link', () => { for (const c of caps) doc.updateCaption(c.id, { runs: removeLink(c.runs, 0, plainText(c.runs).length) }); });
  editor.changed();
  return true;
}

/** Open Link: the link in the text being typed, or the first in the selected captions. */
function openLink(): boolean {
  const link = editor.typingCaption?.ed.linkHere()?.link ?? pickedCaptions().map((c) => linkSpans(c.runs)[0]?.link).find(Boolean);
  if (!link) { flash('Select text with a link first.'); return false; }
  void followLink(link);
  return true;
}

CaptionEditor.linkPlaces = () => slidePlaces();

setLinkHost({
  goTo(place) {
    if (docActive()) return docMode.goToPlace(place);
    if (sheetActive()) return sheetMode.goToPlace(place);
    const d = deckNow();
    const id = slideOfLink(place);
    if (d && id !== null) {
      const i = d.slides.findIndex((s) => s.id === id);
      if (i < 0) return false;
      goSlide(i);
      return true;
    }
    if (d && place in SHOW_JUMPS) {
      // outside the slide show, the jumps go to the slide they would show
      const i = place === '#first' ? 0 : place === '#last' ? d.slides.length - 1 : place === '#next' ? d.index + 1 : d.index - 1;
      goSlide(Math.max(0, Math.min(d.slides.length - 1, i)));
      return true;
    }
    return false;
  },
  placeName(place) {
    if (docActive()) return docMode.placeName(place);
    const d = deckNow();
    const id = slideOfLink(place);
    if (d && id !== null) {
      const i = d.slides.findIndex((s) => s.id === id);
      return i < 0 ? null : `Slide ${i + 1}${slideTitle(d, i) ? `: ${slideTitle(d, i)}` : ''}`;
    }
    if (place in SHOW_JUMPS) return SHOW_JUMPS[place];
    const cell = cellOfLink(place);
    return cell ? `Cell ${cell.sheet ? `${cell.sheet}!` : ''}${cell.cell}` : null;
  },
  async openHere(path) {
    // drawings, documents, slides, sheets and workspaces open in a tab here
    if (!/\.(cdxml|cdx|docx|pptx|xlsx|xlsm|xls|ods|csv|tsv|sdf|sd)$/i.test(path) && !path.toLowerCase().endsWith(`.${WORKSPACE.extension}`)) return false;
    if (!isTauri()) return false;
    await openRecent(path);
    return true;
  },
  folder: () => (ws.active.ref.kind === 'path' ? folderOf(ws.active.ref.path) : null),
  flash: (text) => flash(text, 6000),
});

async function insertEquation(): Promise<void> {
  const deck = deckNow();
  if (!deck) { flash('Equations go on slides, designs and documents.'); return; }
  finishTyping();
  const m = deck.master;
  const font = m.bodyFont;
  const got = await askEquation({ tex: '', font, ok: 'Insert', app: 'PowerPoint' });
  if (!got || deckNow() !== deck) return;
  const math: ShapeMath = { tex: got.tex, size: m.bodySize, color: slideColours(m, deck.current?.layout ?? 'blank').textColor, font };
  const { w, h } = shapeMathSize(math, measureText);
  const c = pasteCentre();
  let made: Shape | null = null;
  doc.edit('Insert equation', () => {
    made = doc.addShape({ kind: 'picture', x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, src: shapeMathPicture(math, measureText), px: { w: Math.round(w), h: Math.round(h) }, math });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([made!.id]) };
  editor.changed();
}

/** Double-clicking an equation: change it in the equation window. Its box keeps its top left corner and how much it was enlarged. */
async function editEquationShape(id: number): Promise<void> {
  finishTyping();
  const s = doc.shapes.get(id);
  if (!s?.math) return;
  const k = shapeMathScale(s.math, s.x2 - s.x1, s.y2 - s.y1, measureText);
  const got = await askEquation({ tex: s.math.tex, font: s.math.font ?? 'Arial', ok: 'Apply', app: 'PowerPoint' });
  const now = doc.shapes.get(id);
  if (!got || !now?.math || got.tex === now.math.tex) return;
  const math = { ...now.math, tex: got.tex };
  const { w, h } = shapeMathSize(math, measureText);
  const x = Math.min(now.x1, now.x2), y = Math.min(now.y1, now.y2);
  doc.edit('Change equation', () => doc.updateShape(id, { math, src: shapeMathPicture(math, measureText), px: { w: Math.round(w), h: Math.round(h) }, x1: x, y1: y, x2: x + w * k, y2: y + h * k }));
  editor.changed();
}
editor.onEquation = (id) => void editEquationShape(id);

/** Select just these (new) atoms and their bonds. */
function selectNewAtoms(ids: number[]): void {
  editor.sel = { atoms: new Set(ids), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
  for (const id of ids) for (const b of doc.adj.get(id) ?? []) editor.sel.bonds.add(b);
  editor.changed();
}

// ------------------------------------------------------------------ name to structure

const names = new NameReader(new URL('opsin/opsin-data.dat', document.baseURI).href);
let namesReady = false;

/** Names the name reader can't read are looked up on PubChem (Edit > Settings). */
let pubchemNames = true;

/** Why a name couldn't be turned into a structure: a plain message, the part that couldn't be read, and the name reader's own words. */
interface NameError { error: string; bad?: string; details?: string }

/** A short message for a name that couldn't be read, with the part the name reader stopped at. */
function unreadableName(name: string, parser: string): NameError {
  const ctx = /not understandable in the context it was used:\s*(.+?)\s*\.?$/m.exec(parser)?.[1];
  const sect = /following section of the name:\s*(.+?)\s*(?:The following|$)/m.exec(parser)?.[1];
  const bad = [ctx, sect].find((x) => x && name.includes(x.trim()))?.trim();
  return { error: `Couldn't read "${name.trim()}". Check the spelling, or try a CAS number, SMILES or a simpler name.`, bad };
}

/**
 * A name as a laid-out molfile, or why not. Systematic names are read here, on this computer;
 * a name that can't be read (a trade name, an abbreviation) is looked up on PubChem, unless
 * that is turned off in Edit > Settings.
 */
async function nameToMolfile(name: string): Promise<{ mb: string; attach: number[]; warnings: string[] } | NameError> {
  const r = await names.read(name);
  namesReady = true;
  if (!chem.ready) return { error: 'The chemistry engine is still loading; try again in a moment.' };
  if (!r.ok) {
    const why = r.message.trim().replace(/([^.])$/, '$1.');
    const failed = (more: string): NameError => ({ ...unreadableName(name, why), details: `${why}${more ? ' ' + more : ''}` });
    if (!pubchemNames || !name.trim()) return failed('');
    let found: Awaited<ReturnType<typeof pubchemName>>;
    try {
      found = await pubchemName(name);
    } catch (e) {
      return failed(`Looking it up on PubChem didn't work: ${(e as Error).message}`);
    }
    if (!found) return failed('PubChem doesn\'t know this name either.');
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
const numbering = { style: 'numbers' as IdStyle, prefix: '', suffix: '', bold: true, same: true, align: true };

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
 * Chemistry > Reactions and Schemes > Scheme Settings: spacing between structures and + signs, and the text above and below
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
 * Chemistry > Labels and Numbers > Number Compounds: ID labels under the selected structures (or all), in scheme order,
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
    { name: 'align', label: 'Line up the numbers in each row', value: String(numbering.align), type: 'checkbox' },
    { name: 'old', label: 'IDs already there', value: 'renumber', options: [{ value: 'renumber', label: 'Number again' }, { value: 'keep', label: 'Keep' }] },
    { name: 'reagents', label: 'Reagents over arrows', value: 'skip', options: [{ value: 'skip', label: 'Leave unnumbered' }, { value: 'number', label: 'Number them too' }] },
  ], { ok: 'Number', note: 'Puts an ID under each selected structure (or every structure), following the arrows of a scheme, else left to right and top to bottom. Each is tied to its structure and is ordinary text you can change. For 1a, 1b, “Start at” is the number.' });
  if (!got) return;
  const style = got.style as IdStyle;
  const start = parseIdStart(got.start, style);
  if (start === null) { flash(`“${got.start}” isn't a place to start counting ${style === 'roman' || style === 'ROMAN' ? 'in roman numerals' : style === 'lower' || style === 'upper' ? 'in letters' : 'from'}.`); return; }
  Object.assign(numbering, { style, prefix: got.prefix, suffix: got.suffix, bold: got.bold === 'true', same: got.same === 'true', align: got.align === 'true' });
  let keyOf: ((atoms: number[]) => string | undefined) | undefined;
  if (numbering.same) {
    const keys = await structureKeys();
    keyOf = (atoms) => keys.get(atoms[0]);
  }
  const n = editor.numberCompounds({ start: Math.max(0, start), style, prefix: got.prefix, suffix: got.suffix, bold: numbering.bold, align: numbering.align, keep: got.old === 'keep', reagents: got.reagents === 'number', keyOf });
  if (!n) flash('No structures to number.');
}

/**
 * Chemistry > Labels and Numbers > Add ID Label and Add Caption: text centred under each chosen structure, tied to
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

/** Chemistry > Nicknames and Templates > Save as Template: the selected structure goes into My templates. */
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

/** Chemistry > Nicknames and Templates > Delete Template…: take one of your own templates away. */
async function deleteTemplate(): Promise<void> {
  const list = ownTemplates();
  if (!list.length) { flash('You have no templates of your own yet (Chemistry > Nicknames and Templates > Save as Template).'); return; }
  const got = await ask('Delete Template', [{ name: 'id', label: 'Template', value: list[list.length - 1].id, options: list.map((t) => ({ value: t.id, label: t.name })) }], { ok: 'Delete' });
  if (!got) return;
  useOwnTemplates(list.filter((t) => t.id !== got.id));
  if (editor.toolName === `tpl-${got.id}`) editor.setTool('bond-single');
  storeSettings();
}

/** Chemistry > Nicknames and Templates > Define Nickname…: the selected group gets a name that can be typed as a label. */
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

/** Chemistry > Nicknames and Templates > Delete Nickname…: take one of your own nicknames away. */
async function deleteNickname(): Promise<void> {
  const names = Object.keys(ownNicknames);
  if (!names.length) { flash('You have no nicknames of your own yet (Chemistry > Nicknames and Templates > Define Nickname).'); return; }
  const got = await ask('Delete Nickname', [{ name: 'name', label: 'Nickname', value: names[0], options: names.map((n) => ({ value: n, label: `${n}  (${ownNicknames[n]})` })) }], { ok: 'Delete' });
  if (!got) return;
  const { [got.name]: _, ...rest } = ownNicknames;
  ownNicknames = rest;
  removeNickname(got.name);
  renderer.repaintAll();
  editor.requestScene();
  storeSettings();
}

/** Chemistry > Contract Label…: fold the selected group into one label (Undo opens it again). */
/**
 * Chemistry > Expand Label: the selected labels drawn out as atoms and bonds. Ligands on a
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

/** Canonical SMILES of each built-in nickname with its join point (worked out once). */
let nicknameKeys: Promise<Map<string, string[]>> | null = null;

async function groupKey(smiles: string): Promise<string | null> {
  const mb = await chem.smilesToMol('*' + smiles);
  return mb ? chem.molToSmiles(mb) : null;
}

/** The built-in nicknames that mean exactly this group (SMILES from where it joins). */
async function builtInNamesFor(smiles: string): Promise<string[]> {
  if (!chem.ready) return [];
  nicknameKeys ??= (async () => {
    const m = new Map<string, string[]>();
    for (const [name, smi] of builtInNicknames()) {
      if (smi.includes('*')) continue;
      const k = await groupKey(smi);
      if (k) m.set(k, [...(m.get(k) ?? []), name]);
    }
    return m;
  })();
  const k = await groupKey(smiles);
  return (k && (await nicknameKeys).get(k)) || [];
}

async function contractLabel(): Promise<void> {
  const g = selectedGroup(doc, editor.sel.atoms);
  if ('error' in g) { flash(g.error, 6000); return; }
  // when the selection is a group the program already has a name for (Ph, TBS, Boc), offer that name
  const same = await builtInNamesFor(g.smiles);
  const got = await ask('Contract Label', [{ name: 'name', label: 'Label', value: same[0] ?? '' }],
    { ok: 'Contract', note: `The selected group becomes one label with this name.${same.length > 1 ? ` It is also known as ${same.slice(1).join(', ')}.` : ''} The formula and mass still count the whole group, and ChemDraw sees the group inside the label.` });
  if (!got) return;
  const err = editor.contractLabel(got.name, same);
  if (err) flash(err, 6000);
}

const arrangeDialog = new ArrangeDialog({ apply: (o) => editor.arrangeScheme(o), undo: () => editor.undo() });
const animateDialog = new AnimateDialog({
  doc: () => doc,
  renderer: () => renderer,
  selectedAtoms: () => new Set(editor.sel.atoms),
  setMorph: (arrow, m) => doc.edit('Animation Pairing', () => doc.updateArrow(arrow, { morph: m })),
  name: () => ws.active.name,
  flash: (msg) => flash(msg, 6000),
  onSlide: () => ws.active.mode === 'slides',
  putOnSlide: (v) => placeClip(v),
});
/** The reaction arrow picked (for Animate This Step), if one is. */
/** Is a curved (mechanism) arrow among the selection? */
const pickedCurved = (): boolean => [...editor.sel.arrows].some((id) => { const r = doc.arrows.get(id); return !!r && isCurved(r); });
const pickedReactionArrow = (): number | undefined => [...editor.sel.arrows].find((id) => { const r = doc.arrows.get(id); return !!r && isReactionArrow(r); });
const nameDialog = new NameDialog(async (name) => {
  const got = await nameToMolfile(name);
  if ('error' in got) return got;
  const c = renderer.toDoc(renderer.width / 2, renderer.height / 2);
  try {
    let ids: number[] = [];
    doc.edit('Name to Structure', () => { ids = addNamed(got, c.x, c.y); });
    selectNewAtoms(ids);
  } catch (err) {
    return { error: String(err) };
  }
  if (got.warnings.length) flash('Note: ' + got.warnings.join(' '), 9000);
  return null;
}, () => !namesReady);

/**
 * Chemistry > Name to Structure. Selected captions are read as names and replaced by their
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
  const atoms = [...(editor.sel.atoms.size ? editor.sel.atoms : doc.atoms.keys())];
  const { molblock } = toMolfile(doc, atoms);
  let smiles = await chem.molToSmiles(molblock);
  if (!smiles) {
    // most often an atom with too many bonds: say which, and offer the SMILES as drawn
    const ids = new Set(atoms);
    const bad = checks.list().find((w) => w.kind === 'atom' && ids.has(w.id));
    if (!bad) { flash('There is no structure to copy.'); return; }
    editor.reveal('atom', bad.id);
    const loose = await chem.molToSmiles(molblock, true);
    if (!loose) { flash(`Not copied: ${bad.text.join(' ')}`, 8000); return; }
    const go = await ask('Copy as SMILES', [], { ok: 'Copy Anyway', note: `The structure can't be read as drawn (the atom with the problem is now selected). ${bad.text.join(' ')} Copy the SMILES anyway? Other programs may refuse it.` });
    if (!go) return;
    smiles = loose;
  }
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
function flash(msg: string, ms = 3500, action?: { label: string; run: () => void }): void {
  const el = $('#flash');
  el.textContent = msg;
  el.classList.toggle('has-action', !!action);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => { el.classList.remove('show'); action.run(); });
    el.append(' ', b);
  }
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
    return { png, svg: pictureSvg(pic), w: pic.box.x2 - pic.box.x1, h: pic.box.y2 - pic.box.y1, x: pic.box.x1, y: pic.box.y1 };
  },
  svgToPng,
  bakePicture: (p) => fxPng(p, 'baked'),
  fonts: bundledFaces,
  smiles: (contents, style) => drawingSmiles(structureDoc(contents, style)),
};

/** Opening Word files: ChemDraw objects in them become structures, kept at the size they had. */
const docRead: DocxReadDeps = {
  chemdraw: (cdx, style) => docRead.cdxml!(cdxToCdxml(cdx), style),
  cdxml: (text, style) => {
    const d = readCdxml(text).doc;
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
    (ws.pane ?? tab).fitted = editor.stillFitted;
    if (tab.deck) { tab.deck.onChange = () => {}; tab.deck.onSwitch = () => {}; tab.deck.onMotion = () => {}; }
  },
  enter: (tab, opened) => enterTab(tab, opened),
  // every way of closing a tab (×, middle-click, Delete, Ctrl+W) finishes a figure or cell structure first
  closing: () => finishTyping(),
  changed: () => { renderTabs(); updateTitle(); layoutSplit(); tickAutoSave(); },
  flash,
  pptx: pptxOptions(),
  measure: measureText,
  sheets: {
    read: (bytes, name) => readSheetFile(bytes, name, sheetFiles),
    write: (book, name) => writeSheetFile(book, name, sheetFiles),
  },
  documents: {
    read: (bytes, name) => readDocumentFile(bytes, name, docRead),
    write: (d, name) => writeDocumentFile(d, name, docFiles),
  },
  newStyle: (mode) => { const n = modeStyleFor(mode); return n ? styleNamed(n, ownStyles) ?? null : null; },
  newPage: () => (defaultPage ? { ...defaultPage } : null),
  newMaster: (m) => { const t = themeById(slideTemplate); return t && t.id !== 'plain' ? applyTemplate(m, t) : null; },
  beforeWrite: (tab, ref, name, how) => keeper.beforeWrite(tab, ref, name, how),
  saved: (tab, data, how, was) => keeper.saved(tab, data, how, was),
  autoSaveFailed: (tab, msg) => keeper.autoSaveFailed(tab, msg),
  opened: (tab) => keeper.opened(tab),
  dropped: (tab) => {
    keeper.dropped(tab);
    // a drawing being edited for Word: Word hears that the editing is over
    const id = embeddedTabs.get(tab);
    if (id !== undefined) { embeddedTabs.delete(tab); void invoke('ole_close', { id }).catch(() => {}); }
  },
});

// AutoSave, recovery copies, Version History and shared folders (File > AutoSave and Recovery Options)
let keepPrefs: KeepPrefs = { ...DEFAULT_KEEP };
const keeper = new Keeper({
  ws,
  prefs: () => keepPrefs,
  setPrefs: (p) => { keepPrefs = p; tickAutoSave(); renderTabs(); storeSettings(); },
  flash,
  refresh: () => { renderTabs(); updateTitle(); tickAutoSave(); },
});
/** File > AutoSave shows whether the tab showing saves itself. */
function tickAutoSave(): void {
  const b = document.querySelector<HTMLElement>('[data-cmd="autosave"]');
  if (!b) return;
  const t = ws.active;
  b.setAttribute('aria-checked', String(keeper.autoSaveWanted(t) && ws.canAutoSave(t)));
}

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
    bakePicture: (p) => fxPng(p, 'baked'),
    fonts: bundledFaces,
    smiles: drawingSmiles,
  };
}

/** The structures in a drawing as SMILES (for alt text), or null when there are none or the chemistry engine isn't ready. */
async function drawingSmiles(d: Doc): Promise<string | null> {
  if (!chem.ready || !d.atoms.size) return null;
  const { molblock, unknownLabels } = toMolfile(d, d.atoms.keys());
  return unknownLabels.length ? null : chem.molToSmiles(molblock);
}

/** The slide deck showing (in Slides mode), or null for a drawing. */
function deckNow(): Deck | null {
  return ws.active.deck ?? null;
}

/** Slides' Selection Pane is open (Home > Selection Pane, Alt+F10). */
let selectionPane = false;

/** Design's Layers panel, or Slides' Selection Pane when it is open, in the right-hand panel. */
function showLayers(tab = ws.active): void {
  const design = tab.mode === 'design', slides = !!tab.deck && !design;
  layers?.show(design || (slides && selectionPane) ? doc : null, slides);
  for (const b of document.querySelectorAll('[data-cmd="selection-pane"]')) b.setAttribute('aria-pressed', String(slides && selectionPane));
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
  showLayers(tab);
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
  // another tab: back to Normal view
  if (sorterOn) {
    sorterOn = false;
    sorterEl.hidden = true;
    sorterList.show(null);
  }
  if (outlineView.shown) outlineView.show(false);
  if (notesView.shown) { notesView.show(false); $('#notes-pane').classList.remove('np-hidden'); }
  showSheetParts();
  editor.paused = sheet || words;
  sheetMode.show(sheet ? tab : null);
  if (words) fieldEnv.fileName = ws.mainOf(tab).name;
  docMode.show(words ? tab : null);
  renderer.screen = !!deck;
  renderer.page = deck ? slidePage : drawingBackdrop;
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
  } else { slideList.show(null); showRulers(); }
  animUi?.update();
  slideCmts?.slideChanged();
  layoutSplit();
  // the slide list and notes take room from the drawing area
  resize();
  const viewOf = ws.pane ?? tab;
  if (viewOf.view && (!opened || ws.pane) && !(viewOf.fitted && !ws.pane && !slideSplit)) renderer.view = { ...viewOf.view };
  else if (ws.pane || slideSplit) fitSplitDrawing();
  else editor.fit();
  renderer.repaintAll();
  // (fit leaves an empty drawing alone, so ask for the scene here: else the last tab's drawing stays on screen)
  editor.requestScene();
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
    drawSlidePage(ctx, d.page(), SURROUND);
    if (ws.active.mode === 'design' && designGrid.on) drawGrid(ctx, d.size, designGrid.step);
    if (ws.active.mode === 'slides') {
      const v = d.settings.view;
      if (slideLook.grid) drawGrid(ctx, d.size, v?.grid ?? defaultView(d.size).grid);
      if (v?.showGuides) drawGuides(ctx, v, d.size, renderer.view.scale, guideDrag?.which);
    }
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
const slideListKey = (d: Deck) => `${d.slides.map((s) => s.id + (s.notes.trim() ? 'n' : '') + (s.hidden ? 'h' : '') + (s.section !== undefined ? `s${s.section}` : '')).join(',')}|${d.sections.map((x) => `${x.id}:${x.name}`).join('/')}|${d.size.w}x${d.size.h}|${d.looks}`;

function deckChanged(deck: Deck): void {
  const key = slideListKey(deck);
  if (key !== listKey || masterSeen !== deck.master) {
    listKey = key;
    masterSeen = deck.master;
    indexSeen = deck.index;
    slideList.rebuild();
    if (sorterOn) sorterList.rebuild();
    outlineView.rebuild();
    notesView.rebuild();
  } else if (deck.index !== indexSeen) {
    // going to another slide moves the highlight; no picture needs drawing again
    indexSeen = deck.index;
    slideList.switched();
    if (sorterOn) sorterList.switched();
    outlineView.mark(deck.index);
  } else {
    slideList.refresh();
    if (sorterOn) sorterList.refresh();
  }
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

/** The layouts last put in the Layout box and the Format menu (they change with the slide master). */
let layoutsShown = '';

/** The Layout box and Format > Slide Layout list the deck's layouts: the five built in, as edited, then the ones made here. */
function showLayoutMenus(deck: Deck): void {
  const list = deckLayouts(deck.master);
  const key = JSON.stringify(list.map((l) => [l.id, l.name]));
  if (key === layoutsShown) return;
  layoutsShown = key;
  layoutSel.replaceChildren(...list.map((l) => new Option(l.name, l.id)));
  const sub = document.querySelector<HTMLElement>('#layout-menu');
  if (sub) {
    const items: HTMLElement[] = list.map((l) => {
      const b = document.createElement('button');
      b.setAttribute('role', 'menuitemradio');
      b.setAttribute('aria-checked', 'false');
      b.dataset.cmd = `layout-${l.id}`;
      const span = document.createElement('span');
      span.textContent = l.name;
      b.append(span);
      return b;
    });
    const hr = document.createElement('hr');
    const edit = document.createElement('button');
    edit.setAttribute('role', 'menuitem');
    edit.dataset.cmd = 'edit-layouts';
    edit.textContent = 'Edit Layouts…';
    sub.replaceChildren(...items, hr, edit);
  }
}

/** The layout and size boxes and the Format menu show the slide being edited. */
function showSlideState(): void {
  const deck = deckNow();
  showRulers();
  if (!deck?.current) return;
  showLayoutMenus(deck);
  layoutSel.value = deck.current.layout;
  const named = deck.size.w === WIDE.w && deck.size.h === WIDE.h ? 'wide' : deck.size.w === STANDARD.w && deck.size.h === STANDARD.h ? 'standard' : 'custom';
  let custom = sizeSel.querySelector<HTMLOptionElement>('option[value="custom"]');
  if (named === 'custom') {
    if (!custom) { custom = new Option('', 'custom'); sizeSel.add(custom); }
    custom.text = sizeName(deck.size);
  } else custom?.remove();
  sizeSel.value = named;
  for (const b of document.querySelectorAll<HTMLElement>('[data-cmd^="layout-"]')) b.setAttribute('aria-checked', String(b.dataset.cmd === `layout-${deck.current.layout}`));
  for (const b of document.querySelectorAll<HTMLElement>('[data-cmd="view-normal"], [data-cmd="view-sorter"]')) {
    const on = b.dataset.cmd === 'view-sorter' ? slideViewNow() === 'sorter' : slideViewNow() === 'normal';
    b.setAttribute(b.getAttribute('role') === 'menuitemradio' ? 'aria-checked' : 'aria-pressed', String(on));
  }
  $('[data-cmd="size-wide"]')?.setAttribute('aria-checked', String(named === 'wide'));
  $('[data-cmd="size-standard"]')?.setAttribute('aria-checked', String(named === 'standard'));
  const hidden = String(!!deck.current.hidden);
  for (const b of document.querySelectorAll('[data-cmd="hide-slide"]')) b.setAttribute(b.getAttribute('role') === 'menuitemcheckbox' ? 'aria-checked' : 'aria-pressed', hidden);
  // Set Up Show's two the ribbon shows as ticks
  const show = deck.settings.show;
  for (const b of document.querySelectorAll<HTMLInputElement>('[data-cmd="use-timings"]')) b.checked = !show?.manual;
  for (const b of document.querySelectorAll<HTMLInputElement>('[data-cmd="play-narrations"]')) b.checked = !show?.noNarration;
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
  host: () => $('#canvas-host'),
  view: () => renderer.view,
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
  pick: (w) => { finishTyping(); editor.selectThese({ atoms: new Set(w.atoms), bonds: new Set(), captions: new Set(w.captions), arrows: new Set(w.arrows), shapes: new Set(w.shapes) }); },
  picked: () => ({ shapes: [...editor.sel.shapes], captions: [...editor.sel.captions], atoms: [...editor.sel.atoms], arrows: [...editor.sel.arrows] }),
});
layers.onClose = () => { selectionPane = false; showLayers(); };
const lib = (designLib = new DesignLibrary($('#design-lib'), (id) => { finishTyping(); editor.setTool(`geo:${id}`); }));
// Design mode's shapes and icons fold away to a thin strip (remembered on this computer)
{
  const el = $('#design-lib');
  const fold = document.createElement('button');
  fold.type = 'button';
  fold.className = 'dl-fold';
  const KEY = 'chem-illustrator.design-lib-folded';
  const show = (folded: boolean) => {
    el.classList.toggle('folded', folded);
    fold.textContent = folded ? '›' : '‹';
    fold.title = folded ? 'Open the shapes and icons' : 'Fold the shapes and icons away, for more room for the page';
    fold.setAttribute('aria-label', fold.title);
    fold.setAttribute('aria-expanded', String(!folded));
  };
  let folded = false;
  try { folded = localStorage.getItem(KEY) === '1'; } catch { /* no storage: start open */ }
  show(folded);
  fold.addEventListener('click', () => {
    folded = !el.classList.contains('folded');
    show(folded);
    try { localStorage.setItem(KEY, folded ? '1' : '0'); } catch { /* not remembered */ }
  });
  el.querySelector('.dl-tabs')?.append(fold);
}
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
  if (!d || (!d.master.fill && !d.current?.background && d.master.background.toLowerCase() === dzBg.value.toLowerCase())) return;
  finishTyping();
  // a colour here takes the place of a gradient or picture set with Format Background
  d.setAllBackgrounds(solid(dzBg.value));
});

/** The Design ribbon shows the page's size and background. */
function showDesignState(): void {
  const d = deckNow();
  if (!d) return;
  $('#dz-size').textContent = sizeLabel(d.size);
  if (/^#[0-9a-f]{6}$/i.test(d.master.background)) dzBg.value = d.master.background;
}

// ---------------------------------------------------------------- Slides' rulers, gridlines and guides

const guideTip = new GuideTip(host);
const rulers = new SlideRulers(host, {
  view: () => renderer.view,
  size: () => deckNow()?.size ?? null,
  prefs: () => rulerPrefs,
  selection: () => (editor.hasSelection() ? editor.selBox() : null),
  newGuide: (axis, e) => {
    const d = deckNow();
    if (!d) return;
    const view = slideViewOf(d);
    // a new guide, shown, dragged from the ruler
    const next = { ...view, showGuides: true, guides: { x: [...view.guides.x], y: [...view.guides.y] } };
    next.guides[axis].push(axis === 'x' ? -1e6 : -1e6);
    startGuideDrag(d, next, { axis, i: next.guides[axis].length - 1 }, e, 'Add guide', view);
  },
});

/** The deck's guides and grid (PowerPoint's first ones when it has none). */
function slideViewOf(d: Deck): SlideView {
  return d.settings.view ?? defaultView(d.size);
}


/** Drag a guide (or a copy of it): its place shown by the pointer; let go off the slide to take it away. One undo step. */
function startGuideDrag(d: Deck, view: SlideView, which: { axis: 'x' | 'y'; i: number }, e: PointerEvent, label: string, before = slideViewOf(d)): void {
  finishTyping();
  guideDrag = { which, view };
  const el = renderer.overlay;
  el.style.cursor = which.axis === 'x' ? 'col-resize' : 'row-resize';
  const hostBox = host.getBoundingClientRect();
  const move = (ev: PointerEvent) => {
    const p = { x: (ev.clientX - hostBox.left - renderer.view.ox) / renderer.view.scale, y: (ev.clientY - hostBox.top - renderer.view.oy) / renderer.view.scale };
    let v = which.axis === 'x' ? p.x : p.y;
    // to a sixteenth of an inch (or a millimetre), Alt: anywhere
    if (!ev.altKey) { const step = rulerPrefs.units === 'in' ? 4.5 : 72 / 25.4; const zero = rulerPrefs.from === 'centre' ? (which.axis === 'x' ? d.size.w : d.size.h) / 2 : 0; v = zero + Math.round((v - zero) / step) * step; }
    view.guides[which.axis][which.i] = v;
    const off = v < 0 || v > (which.axis === 'x' ? d.size.w : d.size.h);
    guideTip.show(off ? 'Let go to take the guide away' : rulerText(v, d.size, which.axis, rulerPrefs), ev.clientX - hostBox.left, ev.clientY - hostBox.top);
    renderer.repaintAll();
    editor.requestScene();
  };
  const up = () => {
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    el.style.cursor = '';
    guideTip.hide();
    guideDrag = null;
    const v = view.guides[which.axis][which.i];
    const off = v < 0 || v > (which.axis === 'x' ? d.size.w : d.size.h);
    if (off) view.guides[which.axis].splice(which.i, 1);
    d.settings.view = before;
    d.setSettings({ ...d.settings, view }, off ? 'Remove guide' : label);
    renderer.repaintAll();
    editor.requestScene();
  };
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', up, true);
  move(e);
}

// on the slide, a guide is picked up where nothing else is: a drag moves it, Ctrl+drag copies it
renderer.overlay.addEventListener('pointerdown', (e) => {
  const d = deckNow();
  if (e.button !== 0 || !d || ws.active.mode !== 'slides' || sorterOn || !d.settings.view?.showGuides || editor.toolName !== 'select') return;
  const { p, taken } = editor.pointAt(e);
  if (taken) return;
  const view = d.settings.view;
  const near = guideNear(view, p, 4 / renderer.view.scale);
  if (!near) return;
  e.preventDefault();
  e.stopPropagation();
  const next: SlideView = { ...view, guides: { x: [...view.guides.x], y: [...view.guides.y] } };
  let which = near;
  if (e.ctrlKey || e.metaKey) { next.guides[near.axis].push(next.guides[near.axis][near.i]); which = { axis: near.axis, i: next.guides[near.axis].length - 1 }; }
  startGuideDrag(d, next, which, e, e.ctrlKey || e.metaKey ? 'Copy guide' : 'Move guide');
}, true);
// over a guide, the pointer says it can be dragged
renderer.overlay.addEventListener('pointermove', (e) => {
  const d = deckNow();
  if (guideDrag || e.buttons || !d || ws.active.mode !== 'slides' || !d.settings.view?.showGuides || editor.toolName !== 'select') return;
  const { p, taken } = editor.pointAt(e);
  const near = taken ? null : guideNear(d.settings.view, p, 4 / renderer.view.scale);
  if (near) renderer.overlay.style.cursor = near.axis === 'x' ? 'col-resize' : 'row-resize';
});

editor.moveSnap = (box, raw, tol) => {
  const d = deckNow();
  return d && ws.active.mode === 'slides' ? snapMove(box, raw, d.settings.view ?? null, tol) : raw;
};

/** The rulers show in Normal view of slides when View > Ruler is ticked. */
function showRulers(): void {
  rulers.show(slideLook.ruler && ws.active.mode === 'slides' && !sorterOn && !!deckNow());
  for (const b of document.querySelectorAll<HTMLInputElement>('[data-cmd="view-slide-ruler"]')) b.checked = slideLook.ruler;
  for (const b of document.querySelectorAll<HTMLInputElement>('[data-cmd="view-gridlines"]')) b.checked = slideLook.grid;
  const g = !!deckNow()?.settings.view?.showGuides;
  for (const b of document.querySelectorAll<HTMLInputElement>('[data-cmd="view-guides"]')) b.checked = g;
}

/** View > Guides on or off (saved with the file, as PowerPoint does). */
function toggleGuides(): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  const v = slideViewOf(d);
  d.setSettings({ ...d.settings, view: { ...v, guides: { x: [...v.guides.x], y: [...v.guides.y] }, showGuides: !v.showGuides } }, v.showGuides ? 'Hide guides' : 'Show guides');
  showRulers();
  renderer.repaintAll();
  editor.requestScene();
}

/** View > Grid Settings: snapping, the grid, the guides, the rulers' units. */
async function gridSettings(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  const got = await gridAndGuides(slideViewOf(d), { grid: slideLook.grid, smart: guidesOn.slides }, rulerPrefs, d.size);
  if (!got) return;
  slideLook.grid = got.grid;
  guidesOn.slides = got.smart;
  Object.assign(rulerPrefs, got.prefs);
  d.setSettings({ ...d.settings, view: got.view }, 'Grid and guides');
  showGuides();
  showRulers();
  storeSettings();
  renderer.repaintAll();
  editor.requestScene();
}

/** Add a guide down (or across) the middle of the slide, shown. */
function addGuide(axis: 'x' | 'y'): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  const v = slideViewOf(d);
  const next = { ...v, showGuides: true, guides: { x: [...v.guides.x], y: [...v.guides.y] } };
  next.guides[axis].push((axis === 'x' ? d.size.w : d.size.h) / 2);
  d.setSettings({ ...d.settings, view: next }, 'Add guide');
  showRulers();
  renderer.repaintAll();
  editor.requestScene();
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

const slideListHooks = {
  go: (i: number) => goSlide(i),
  remove: (ix: number[]) => removeSlides(ix),
  duplicate: (ix: number[]) => { const d = deckNow(); if (d) { finishTyping(); d.duplicate(ix); } },
  add: () => newSlide(),
  copy: (ix: number[]) => copySlides(ix, false),
  cut: (ix: number[]) => copySlides(ix, true),
  paste: () => pasteSlides(),
  menu: (x: number, y: number) => showContextMenu(x, y, slideListMenu(), { run: (cmd) => void command(cmd), key: commandKey }),
  sectionMenu: (x: number, y: number, id: number) => {
    showContextMenu(x, y, [...sectionItems(), null, { cmd: 'add-section' }], {
      run: (cmd) => { sectionPicked = id; void command(cmd); },
      key: commandKey,
    });
  },
  renameSection: (id: number) => void renameSection(id),
};
const slideList = new SlideList($('#slide-list'), slideListHooks);

// View > Slide Sorter: every slide in rows of larger pictures, over the slide being edited.
// Double-click a slide (or press Enter) to go back to Normal view on it.
let sorterOn = false;
const sorterEl = $('#slide-sorter');
const sorterList = new SlideList(sorterEl, { ...slideListHooks, open: (i) => { goSlide(i); setSorter(false); } }, { grid: true, thumbW: 220 });

/** Slide Sorter on or off (Normal view). */
function setSorter(on: boolean): void {
  const d = deckNow();
  if (on && (!d || ws.active.mode !== 'slides')) { flash('Slide Sorter is for slides: use File > New Slides, or open a PowerPoint file.'); return; }
  if (on === sorterOn) { if (on) sorterList.focus(); return; }
  finishTyping();
  sorterOn = on;
  sorterEl.hidden = !on;
  $('#slide-list').hidden = on || ws.active.mode !== 'slides';
  sorterList.show(on ? d : null);
  if (on) {
    sorterList.picked = new Set(slideList.pickedList());
    sorterList.rebuild();
    sorterList.focus();
  } else {
    if (d) slideList.show(d);
    overlay.focus();
  }
  editor.paused = on;
  resize();
  showSlideState();
}

// View > Outline View: the outline in place of the slide list; View > Notes Page: the notes pages over the slide
const outlineView = new OutlineView($('#slide-list').parentElement!, {
  deck: () => (ws.active.mode === 'slides' ? deckNow() : null),
  go: (i) => goSlide(i),
  focusSlide: () => overlay.focus(),
});
const notesView = new NotesPageView(host, {
  deck: () => (ws.active.mode === 'slides' ? deckNow() : null),
  open: (i) => { setSlideView('normal'); goSlide(i); },
});

/** Which of Normal, Outline, Slide Sorter and Notes Page shows. */
function slideViewNow(): 'normal' | 'outline' | 'sorter' | 'notes' {
  return sorterOn ? 'sorter' : notesView.shown ? 'notes' : outlineView.shown ? 'outline' : 'normal';
}

/** Change the slides' view (Normal, Outline, Slide Sorter or Notes Page). */
function setSlideView(v: 'normal' | 'outline' | 'sorter' | 'notes'): void {
  const d = deckNow();
  if (v !== 'normal' && (!d || ws.active.mode !== 'slides')) { flash('That view is for slides: use File > New Slides, or open a PowerPoint file.'); return; }
  finishTyping();
  if (v !== 'sorter' && sorterOn) setSorter(false);
  if (v !== 'notes' && notesView.shown) { notesView.show(false); $('#notes-pane').classList.remove('np-hidden'); editor.paused = false; }
  if (v !== 'outline' && outlineView.shown) { outlineView.show(false); $('#slide-list').hidden = ws.active.mode !== 'slides'; if (d) slideList.show(d); }
  if (v === 'sorter') setSorter(true);
  if (v === 'outline' && !outlineView.shown) { $('#slide-list').hidden = true; outlineView.show(true); }
  if (v === 'notes' && !notesView.shown) {
    $('#notes-pane').classList.add('np-hidden');
    editor.paused = true;
    notesView.show(true);
    notesView.reveal(d!.index);
  }
  resize();
  showSlideState();
  for (const b of document.querySelectorAll<HTMLElement>('[data-cmd="view-outline"], [data-cmd="view-notes-page"]')) {
    const on = b.dataset.cmd === 'view-outline' ? outlineView.shown : notesView.shown;
    if (b.getAttribute('role') !== 'menuitem') b.setAttribute('aria-pressed', String(on));
  }
  if (v === 'normal') overlay.focus();
}

/** View > Notes Master and Handout Master: their settings, as one step of the history. */
async function editPageMaster(which: 'notes' | 'handout'): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') { flash('Notes pages and handouts are for slides.'); return; }
  finishTyping();
  const next = which === 'notes' ? await editNotesMaster(d.master) : await editHandoutMaster(d.master);
  if (!next || deckNow() !== d) return;
  d.setMaster(next);
  if (notesView.shown) notesView.rebuild();
}

/** The slides picked in the list showing: Slide Sorter's, or the slide list's. */
function pickedSlides(): number[] {
  return (sorterOn ? sorterList : slideList).pickedList();
}

/** Right-click in the slide list: what PowerPoint offers there. */
function slideListMenu(): MenuItem[] {
  return [
    { cmd: 'cut-slides', label: 'Cut' }, { cmd: 'copy-slides', label: 'Copy' }, { cmd: 'paste-slides', label: 'Paste' },
    { cmd: 'paste-slides-keep', label: 'Paste (Keep Source Formatting)' },
    null,
    { cmd: 'new-slide' }, { cmd: 'duplicate-slide' }, { cmd: 'delete-slide' },
    null,
    { label: 'Layout', items: deckLayouts(deckNow()?.master).map((l) => ({ cmd: `layout-${l.id}`, label: l.name })) },
    { cmd: 'format-background' },
    { cmd: 'hide-slide' },
    null,
    { cmd: 'add-section' },
    ...(deckNow()?.sections.length ? [{ label: 'Section', items: sectionItems() }] : []),
    null,
    { cmd: 'reuse-slides' },
    ...(sorterOn ? [null, { cmd: 'view-normal', label: 'Open in Normal View' }] : []),
  ];
}

/** The section commands, as in PowerPoint's right-click on a section. */
function sectionItems(): MenuItem[] {
  return [
    { cmd: 'rename-section' }, { cmd: 'remove-section' }, { cmd: 'remove-section-slides' }, { cmd: 'remove-all-sections' },
    null,
    { cmd: 'section-up' }, { cmd: 'section-down' },
    null,
    { cmd: 'collapse-sections' }, { cmd: 'expand-sections' },
  ];
}

/** The section a section command works on: the one whose heading was right-clicked, else the slide being edited's. */
let sectionPicked: number | null = null;
function pickedSection(d: Deck): number | null {
  const id = sectionPicked;
  sectionPicked = null;
  if (id !== null && d.sections.some((x) => x.id === id)) return id;
  return d.current?.section ?? null;
}

async function renameSection(id?: number): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const sid = id ?? pickedSection(d);
  const sec = d.sections.find((x) => x.id === sid);
  if (!sec) { flash('This deck has no sections yet: use Add Section.'); return; }
  const got = await ask('Rename Section', [{ name: 'name', label: 'Section name', value: sec.name }], { ok: 'Rename' });
  if (got && deckNow() === d) d.renameSection(sec.id, got.name);
}

/** The section commands, by name. */
function sectionCommand(cmd: string): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  if (cmd === 'add-section') {
    const first = (sorterOn ? sorterList : slideList).pickedList()[0] ?? d.index;
    const id = d.addSection(first);
    void renameSection(id);
    return;
  }
  if (cmd === 'collapse-sections' || cmd === 'expand-sections') { d.foldAll(cmd === 'collapse-sections'); return; }
  if (cmd === 'remove-all-sections') { d.removeAllSections(); return; }
  const id = pickedSection(d);
  if (id === null) { flash('This deck has no sections yet: use Add Section.'); return; }
  if (cmd === 'rename-section') { void renameSection(id); return; }
  if (cmd === 'remove-section') d.removeSection(id);
  else if (cmd === 'remove-section-slides') { if (!d.removeSection(id, true)) flash('A presentation needs at least one slide, so this section\'s slides were kept.'); }
  else if (cmd === 'section-up' || cmd === 'section-down') {
    const k = d.sections.findIndex((x) => x.id === id);
    d.moveSection(id, k + (cmd === 'section-up' ? -1 : 1));
  }
}

/**
 * Slides copied or cut (in the slide list, or Edit > Copy Slides), with the deck they came from,
 * for pasting into any deck that is open.
 */
let slideClip: SlideSource | null = null;

function copySlides(ix: number[], cut: boolean): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  slideClip = d.copySlides(ix);
  const n = slideClip.slides.length;
  const what = `${n} slide${n === 1 ? '' : 's'}`;
  if (cut && !d.remove(ix)) { flash(`Copied ${what}: a presentation needs at least one slide, so nothing was cut.`); return; }
  flash(`${cut ? 'Cut' : 'Copied'} ${what}. Click in the slide list of this deck or another and press Ctrl+V to paste.`);
}

/**
 * Paste the slides copied after the last slide picked, in this deck's look; `keep` keeps each
 * slide's own background, fonts and colours. When the look would change, a button offers the
 * other way, as PowerPoint's Paste Options do.
 */
function pasteSlides(keep?: boolean): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  if (!slideClip) { flash('Copy slides first: pick them in the slide list and press Ctrl+C (or Edit > Copy Slides).'); return; }
  finishTyping();
  const src = slideClip;
  const after = pickedSlides().at(-1) ?? d.index;
  const n = d.pasteSlides(src, !!keep, after);
  const what = `${n} slide${n === 1 ? '' : 's'}`;
  const sameLook = JSON.stringify(src.master) === JSON.stringify(d.master);
  if (keep !== undefined || sameLook) { flash(`Pasted ${what}.`); return; }
  const edits = d.edits;
  flash(`Pasted ${what} in this deck's look.`, 8000, {
    label: 'Keep source formatting',
    run: () => {
      // put them in again their own way, in place of the ones just pasted (if nothing has changed since)
      if (deckNow() !== d || d.edits !== edits) { flash('Use Edit > Paste Slides (Keep Source Formatting) to paste them with their own look.'); return; }
      d.undo();
      d.pasteSlides(src, true, after);
      flash(`Pasted ${what} with their own look.`);
    },
  });
}

/** Keep Source Formatting, as last chosen in Reuse Slides. */
let reuseKeep = false;

/** Reuse Slides: pick slides from another PowerPoint file to put in after this one. */
async function reuseSlides(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const f = await openBytesDialog('PowerPoint presentations', [PPTX]).catch(async (e) => { await showError(String(e)); return null; });
  if (!f) return;
  let got: ReturnType<typeof readPptx>;
  try {
    got = readPptx(f.bytes);
  } catch (e) {
    flash(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`, 8000);
    return;
  }
  if (!got.slides.length) { flash(`${f.name} has no slides.`); return; }
  // the file's slides in a deck of their own, to show and copy from
  const from = new Deck(new Doc());
  from.load(got.slides.map((s) => from.makeSlide(s.layout, s.contents, s.notes, s)), got.size, got.master);
  const pick = await pickReuseSlides(f.name, from, reuseKeep);
  if (!pick || deckNow() !== d) return;
  reuseKeep = pick.keep;
  const n = d.pasteSlides(from.copySlides(pick.indices), pick.keep, pickedSlides().at(-1) ?? d.index);
  flash(`Inserted ${n} slide${n === 1 ? '' : 's'} from ${f.name}.${got.warnings.length ? ' ' + got.warnings.join(' ') : ''}`, got.warnings.length ? 12000 : 3500);
}

function hideSlides(): void {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const ix = pickedSlides();
  // as in PowerPoint: hide them all unless they are all hidden already
  const hide = !ix.every((i) => d.slides[i]?.hidden);
  d.setHidden(hide, ix);
  const n = ix.length;
  flash(hide ? `${n > 1 ? `${n} slides are` : 'The slide is'} hidden: the slide show skips ${n > 1 ? 'them' : 'it'}, and PowerPoint will too.` : `${n > 1 ? `${n} slides` : 'The slide'} will show in the slide show again.`);
}

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

function setSlideSize(size: { w: number; h: number }, fit: SizeFit = 'centre'): void {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  d.setSize(size, fit);
  editor.fit();
}

layoutSel.addEventListener('change', () => { setLayout(layoutSel.value as LayoutId); layoutSel.blur(); });
sizeSel.addEventListener('change', () => {
  if (sizeSel.value === 'wide') setSlideSize(WIDE);
  else if (sizeSel.value === 'standard') setSlideSize(STANDARD);
  else if (sizeSel.value === 'pick') { showSlideState(); void customSlideSize(); }
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

/**
 * Chemistry > Orient Like First: each selected structure (or, with `scheme`, each structure in
 * the drawing) is turned, and turned over if need be, so the part it shares with the first
 * structure (top left, as a scheme is read) lies the same way round. Configuration is kept.
 * Returns how many structures were turned, or null when there was nothing to compare.
 */
async function orientLikeFirst(scheme = false): Promise<number | null> {
  if (!chem.ready) { flash('The chemistry engine is still loading; try again in a moment.'); return null; }
  const picked = editor.sel.atoms;
  const frags = doc.fragments().filter((f) => [...f].some((id) => !doc.atoms.get(id)?.multi) && (scheme || !picked.size ? true : [...f].some((id) => picked.has(id))));
  if (!scheme && !picked.size) return null;
  if (frags.length < 2) return null;
  const box = (f: Set<number>) => {
    let x1 = Infinity, y1 = Infinity;
    for (const id of f) { const a = doc.atoms.get(id)!; x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); }
    return { x1, y1 };
  };
  // the first structure in reading order: the top row, then the leftmost in it
  const top = Math.min(...frags.map((f) => box(f).y1));
  const row = frags.filter((f) => box(f).y1 <= top + doc.style.bondLength * 2);
  const ref = row.reduce((p, q) => (box(q).x1 < box(p).x1 ? q : p));
  const others = frags.filter((f) => f !== ref);
  const refEx = toMolfile(doc, ref);
  const exs = others.map((f) => toMolfile(doc, f));
  const pairs = await chem.common(refEx.molblock, exs.map((e) => e.molblock)).catch(() => null);
  if (!pairs) { flash('Could not compare the structures.'); return 0; }
  const moves: { atoms: Set<number>; f: (p: Vec) => Vec; mirror: boolean }[] = [];
  others.forEach((f, i) => {
    const pr = pairs[i];
    if (!pr) return;
    const from: Vec[] = [], to: Vec[] = [];
    for (const [r, m] of pr) {
      const ra = doc.atoms.get(refEx.map[r] ?? -1), ma = doc.atoms.get(exs[i].map[m] ?? -1);
      if (ra && ma) { to.push(ra); from.push(ma); }
    }
    // only a real shared part: three atoms or more, and a good share of the structure
    if (from.length < 3 || from.length < 0.3 * f.size) return;
    const fit = bestFit(from, to);
    if (!fit || !fitMatters(fit)) return;
    let cx = 0, cy = 0;
    for (const id of f) { const a = doc.atoms.get(id)!; cx += a.x; cy += a.y; }
    moves.push({ atoms: f, f: fitMove(fit, { x: cx / f.size, y: cy / f.size }), mirror: fit.mirror });
  });
  if (moves.length) editor.reorient(moves);
  return moves.length;
}

/** After a flip: nothing selected, or a plain flip that made the mirror image of a structure with wedges. */
function flipped(r: boolean | 'stereo'): void {
  if (!r) flash('Select something to flip.');
  else if (r === 'stereo') flash('Flipped: the wedged centres are now the mirror image (the enantiomer). To keep the configuration, undo and use Flip, Keeping Configuration.', 7000, { label: 'Undo', run: () => undo() });
}

/** Undo and Redo: in Slides mode the deck's history covers every slide and the slide list; a sheet has its own. */
function undo(): void {
  if (sheetActive()) { sheetMode.undo(); return; }
  if (docActive()) { docMode.run('undo'); return; }
  const d = deckNow();
  if (!d) { editor.undo(); return; }
  finishTyping();
  if (d.undo()) editor.afterUndo();
  refreshHistory();
}

function redo(): void {
  if (sheetActive()) { sheetMode.redo(); return; }
  if (docActive()) { docMode.run('redo'); return; }
  const d = deckNow();
  if (!d) { editor.redo(); return; }
  finishTyping();
  if (d.redo()) editor.afterUndo();
  refreshHistory();
}

/** The name of the step Undo (or Redo) would take back in the tab in front: null with nothing to take back, '' when it has no name. */
function historyStep(redo: boolean): string | null {
  if (sheetActive()) return sheetMode.history(redo);
  if (docActive()) return docMode.canUndo(redo) ? '' : null;
  const h = deckNow() ?? doc;
  if (!(redo ? h.canRedo() : h.canUndo())) return null;
  return redo ? h.redoLabel : h.undoLabel;
}

/**
 * Undo and Redo greyed out with nothing to take back, and named after the step they would
 * (Undo Add Ring), on the toolbar and in the Edit menu. Checked after each click and key press.
 */
let historyQueued = false;
function refreshHistory(): void {
  if (historyQueued) return;
  historyQueued = true;
  requestAnimationFrame(() => {
    historyQueued = false;
    for (const [cmd, verb] of [['undo', 'Undo'], ['redo', 'Redo']] as const) {
      const step = historyStep(cmd === 'redo');
      const name = step ? `${verb} ${step}` : verb;
      const k = commandKey(cmd);
      const btn = $<HTMLButtonElement>(`#btn-${cmd}`);
      btn.disabled = step === null;
      btn.title = step === null ? `Nothing to ${verb.toLowerCase()}` : k ? `${name} (${k})` : name;
      for (const item of document.querySelectorAll<HTMLButtonElement>(`header .menu [data-cmd="${cmd}"]`)) {
        item.disabled = step === null;
        const label = item.firstChild;
        if (label?.nodeType === Node.TEXT_NODE) label.textContent = name;
      }
    }
  });
}
for (const ev of ['pointerup', 'keyup'] as const) document.addEventListener(ev, refreshHistory, true);

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
  refreshHistory();
  fitRibbons();
  const items = ws.tabs.map((t) => {
    const el = document.createElement('div');
    el.className = `tab tab-${t.mode}${t === ws.active ? ' active' : ''}${t.dirty ? ' dirty' : ''}`;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t === ws.active));
    // the keys reach the tab showing; the arrow keys go along to the others
    el.tabIndex = t === ws.active ? 0 : -1;
    el.addEventListener('keydown', (e) => {
      if (e.target !== el) return;
      const i = ws.tabs.indexOf(t);
      const to = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? ws.tabs.length - 1 : null;
      if (to !== null) {
        e.preventDefault();
        const n = ws.tabs[(to + ws.tabs.length) % ws.tabs.length];
        if (n !== ws.active) ws.activate(n);
        $('#tabs').querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
      } else if (e.key === 'Delete') { e.preventDefault(); void ws.close(t); }
    });
    el.title = (t.ref.kind === 'path' ? t.ref.path : t.name) + (t.dirty ? ' (not saved)' : '')
      + (t.savedAt ? `\n${t.savedHow === 'autosaved' ? 'AutoSaved' : 'Saved'} ${new Date(t.savedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}` : '')
      + (keeper.autoSaveWanted(t) && ws.canAutoSave(t) ? ' (AutoSave on)' : '');
    const icon = document.createElement('span');
    icon.className = 'tab-icon';
    icon.innerHTML = TAB_ICONS[t.mode][0];
    icon.title = TAB_ICONS[t.mode][1];
    const name = document.createElement('span');
    name.className = 'tab-name';
    name.textContent = ws.label(t);
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
  tabStrip.replaceChildren(...items);
  tabStrip.querySelector('.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  showTabArrows();
}

// The tab strip scrolls when the tabs don't fit; arrows at its ends, a list of every open file,
// and one + button for a new file of any kind stay pinned at the right.
const tabStrip = document.createElement('div');
tabStrip.className = 'tab-strip';
const tabButton = (cls: string, text: string, title: string) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `tab-ctl ${cls}`;
  b.textContent = text;
  b.title = title;
  b.setAttribute('aria-label', title);
  return b;
};
const tabLeft = tabButton('tab-left', '‹', 'Scroll the tabs left');
const tabRight = tabButton('tab-right', '›', 'Scroll the tabs right');
const tabList = tabButton('tab-list', '▾', 'List of open files');
const tabAdd = tabButton('tab-add', '+', 'New file: drawing, slides, sheet, document or design');
tabLeft.addEventListener('click', () => tabStrip.scrollBy({ left: -tabStrip.clientWidth * 0.7, behavior: 'smooth' }));
tabRight.addEventListener('click', () => tabStrip.scrollBy({ left: tabStrip.clientWidth * 0.7, behavior: 'smooth' }));
tabStrip.addEventListener('scroll', () => showTabArrows(), { passive: true });
tabStrip.addEventListener('wheel', (e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { tabStrip.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
new ResizeObserver(() => showTabArrows()).observe(tabStrip);
const menuAt = (b: HTMLElement) => { const r = b.getBoundingClientRect(); return [Math.max(4, r.right - 220), r.bottom + 2] as const; };
tabList.addEventListener('click', () => {
  const [x, y] = menuAt(tabList);
  showContextMenu(x, y, ws.tabs.map((t) => ({ cmd: `tab-show:${t.id}`, label: `${t === ws.active ? '✓ ' : ''}${ws.label(t)}${t.dirty ? ' •' : ''}` })), {
    run: (cmd) => { const t = ws.tabs.find((x) => `tab-show:${x.id}` === cmd); if (t) ws.activate(t); },
    key: () => undefined,
  });
});
tabAdd.addEventListener('click', () => {
  const [x, y] = menuAt(tabAdd);
  showContextMenu(x, y, [
    { cmd: 'new', label: 'Drawing' }, { cmd: 'new-slides', label: 'Slides' }, { cmd: 'new-sheet', label: 'Sheet' },
    { cmd: 'new-document', label: 'Document' }, { cmd: 'new-design', label: 'Design (TOC graphic, abstract, poster, figure)' },
    { cmd: 'new-from-template', label: 'Document or Sheet from Template…' },
  ], { run: (cmd) => void command(cmd), key: commandKey });
});
tabsEl.replaceChildren(tabLeft, tabStrip, tabRight, tabList, tabAdd);

function showTabArrows(): void {
  const over = tabStrip.scrollWidth > tabStrip.clientWidth + 1;
  tabLeft.hidden = tabRight.hidden = !over;
  tabLeft.disabled = tabStrip.scrollLeft <= 0;
  tabRight.disabled = tabStrip.scrollLeft + tabStrip.clientWidth >= tabStrip.scrollWidth - 1;
}

// Tabs are dragged along the strip to put them in another order (as in browsers).
let tabDragged = false;
function dragTab(e: PointerEvent, el: HTMLElement, t: Tab): void {
  if (e.button !== 0 || (e.target as HTMLElement).closest('.tab-close')) return;
  tabDragged = false;
  const startX = e.clientX;
  const tabs = [...tabStrip.querySelectorAll<HTMLElement>('.tab')];
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

// ---------------------------------------------------------------- embedded objects (Insert > Object)

/** Ask for a file of any kind, to put in a document as an object. */
async function pickObjectFile(): Promise<{ name: string; bytes: Uint8Array } | null> {
  try {
    return await openAnyBytesDialog();
  } catch (e) {
    await showError('Could not open the file: ' + String(e));
    return null;
  }
}

/** The picture an object shows: a workbook's cells, a PDF's first page, a picture, or an icon. */
function objectPictureOf(name: string, bytes: Uint8Array, icon: boolean): Promise<ObjectPicture> {
  return objectPicture(name, bytes, icon, {
    readBook: async (b) => (await readSheetFile(b, name, sheetFiles)).book,
    pdfPage: (b) => import('./render/pdf-page').then((m) => m.pdfFirstPage(b)),
  });
}

/**
 * Open an object's file in its own program: written to a folder of its own in the temporary
 * folder and opened as a double-click in Explorer would. While it is open (up to a working day)
 * the file is checked every couple of seconds, and each save there is handed to `changed` once
 * the file has stopped changing. In a browser the file is downloaded instead.
 */
async function openObjectFile(file: { name: string; bytes: Uint8Array }, changed: (bytes: Uint8Array) => void): Promise<string | null> {
  const ext = /\.([^.\\/]+)$/.exec(file.name)?.[1] ?? 'bin';
  if (!isTauri()) {
    await writeFile({ kind: 'none' }, file.name, file.bytes, { description: file.name, extension: ext, mime: 'application/octet-stream' });
    return `${file.name} was downloaded: in a browser it can't open in its program or bring changes back here (the desktop app does both).`;
  }
  let path: string;
  try {
    const dir = await invoke<string>('ole_object_folder');
    path = `${dir}${/Windows/i.test(navigator.userAgent) ? '\\' : '/'}${file.name.replace(/[\\/:*?"<>|]/g, '_')}`;
    await writeFile({ kind: 'path', path }, file.name, file.bytes, { description: file.name, extension: ext, mime: 'application/octet-stream' });
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(path);
  } catch (e) {
    return `Could not open ${file.name}: ${String(e)}`;
  }
  const stamp = async () => { const s = await stampOf({ kind: 'path', path }); return s ? `${s.modified}:${s.size}` : ''; };
  let seen = await stamp(), pending = '';
  const until = Date.now() + 10 * 3600e3;
  const timer = window.setInterval(() => {
    if (Date.now() > until) { window.clearInterval(timer); return; }
    void stamp().then(async (now) => {
      if (!now || now === seen) { pending = ''; return; }
      // wait for one more look at the same stamp: the program may still be writing
      if (now !== pending) { pending = now; return; }
      const bytes = await readRef({ kind: 'path', path });
      if (!bytes?.length) return;
      seen = now;
      pending = '';
      changed(bytes);
    });
  }, 1500);
  return null;
}

/** Another program's object on the Windows clipboard (Excel's cells, for one), with the picture it came with. */
async function clipboardObject(): Promise<{ embed: Embedded; picture: { bytes: Uint8Array; mime: string } | null } | null> {
  const got = await nativeFirst(['Embedded Object']).catch(() => null);
  const embed = got ? fromEmbedSource(got[1]) : null;
  if (!embed) return null;
  const pic = await nativeFirst(['PNG', 'CF_ENHMETAFILE']).catch(() => null);
  return { embed, picture: pic ? { bytes: pic[1], mime: pic[0] === 'PNG' ? 'image/png' : 'image/x-emf' } : null };
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

/**
 * An animation from Chemistry > Animate > Animate Reaction on the slide: a video (its first frame shown while
 * editing) or an animated GIF, in the middle of the slide, at most 80% of it.
 */
function placeClip(v: { mp4?: Uint8Array; still: Uint8Array; gif?: Uint8Array; w: number; h: number }): void {
  finishTyping();
  const deck = deckNow();
  const room = deck ? { w: deck.size.w * 0.8, h: deck.size.h * 0.8 } : { w: (renderer.width * 0.8) / renderer.view.scale, h: (renderer.height * 0.8) / renderer.view.scale };
  const k = Math.min(0.75, room.w / v.w, room.h / v.h);
  const w = v.w * k, h = v.h * k;
  const c = deck ? { x: deck.size.w / 2, y: deck.size.h / 2 } : pasteCentre();
  let made: Shape | null = null;
  doc.edit('Put Animation on Slide', () => {
    made = doc.addShape({
      kind: 'picture', x1: c.x - w / 2, y1: c.y - h / 2, x2: c.x + w / 2, y2: c.y + h / 2, px: { w: v.w, h: v.h },
      ...(v.mp4 ? { src: dataUrl(v.still, 'image/png'), video: { src: dataUrl(v.mp4, 'video/mp4') } } : { src: dataUrl(v.gif!, 'image/gif') }),
    });
  });
  editor.sel = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set([made!.id]) };
  editor.changed();
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

/**
 * Picture Format…: the selected pictures' corrections, colours, see-through, Remove Background
 * and shape; the first one's crop too (cropping to proportions keeps its width).
 */
async function formatPicture(): Promise<void> {
  const pics = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => x?.kind === 'picture' && !!x.src && !x.chart && !x.math && !x.video);
  if (!pics.length) { flash('Select a picture first.'); return; }
  const p = pics[0];
  const got = await pictureFormat({ src: p.src!, fx: p.fx, crop: p.crop, w: Math.abs(p.x2 - p.x1), h: Math.abs(p.y2 - p.y1), count: pics.length });
  if (!got) return;
  doc.edit('Picture format', () => {
    for (const x of pics) doc.updateShape(x.id, { fx: got.fx && structuredClone(got.fx) });
    if (got.crop) {
      const c = got.crop;
      const x1 = Math.min(p.x1, p.x2), y1 = Math.min(p.y1, p.y2), w = Math.abs(p.x2 - p.x1);
      doc.updateShape(p.id, { crop: c.l || c.t || c.r || c.b ? c : undefined, ...(got.aspect ? { x1, y1, x2: x1 + w, y2: y1 + w / got.aspect } : {}) });
    }
  });
  editor.requestScene();
  stylePanel.refresh();
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
    : book ? book.sheets.some((s) => [...s.cells.values()].some((c) => !!c.structure)) : doc.atoms.size > 0 || doc.captions.size > 0;
  const got = await editDrawingStyle({
    current, own: ownStyles, kindPlural: STYLE_KINDS[mode].plural, where: STYLE_KINDS[mode].where,
    isDefault: modeStyleFor(mode) === current.name, hasStructures,
  });
  if (!got || ws.active !== tab) return;
  ownStyles = got.own;
  if (got.forNew) modeStyles[mode] = got.style.name;
  else if (modeStyleFor(mode) === current.name || modeStyleFor(mode) === got.style.name) {
    // no longer the default for new tabs: back to the standard one (or, where that is this style, plain ACS)
    delete modeStyles[mode];
    if (modeStyleFor(mode) === got.style.name) modeStyles[mode] = 'ACS Document 1996';
  }
  if (modeStyles[mode] && !styleNamed(modeStyles[mode]!, ownStyles)) {
    // a default that isn't a built-in style is kept as one of your own, so new tabs can find it
    ownStyles = [...ownStyles, { ...got.style }];
  }
  storeSettings();
  const next = got.style;
  if (deck) deck.setDrawingStyle(next, got.how);
  else if (book) {
    book.setDrawingStyle(next, (c, old) => restyleContents(c, old, next, got.how));
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

/**
 * Design > Format Background: the background of the slides picked in the slide list (the one
 * being edited when nothing else is picked), or of every slide; a design's page in Design mode.
 */
async function backgroundDialog(): Promise<void> {
  const d = deckNow();
  if (!d?.current) return;
  finishTyping();
  const design = ws.active.mode === 'design';
  const picked = design ? [d.index] : pickedSlides();
  const first = d.slides[picked[0]] ?? d.current;
  const page = d.page(d.slides.indexOf(first));
  const got = await formatBackground({
    current: slideBackground(page.master, page.layout, page.own),
    own: picked.some((i) => !!d.slides[i]?.background),
    hideGraphics: !!first.hideGraphics,
    count: picked.length,
    design,
    textColour: d.master.textColor,
    aspect: d.size.w / d.size.h,
    preview: (canvas, w, h, bg, hideGraphics) => {
      const i = d.slides.indexOf(first);
      if (i >= 0) paintSlide(canvas, w, h, window.devicePixelRatio || 1, { ...d.page(i), own: bg, hideGraphics }, d.docOf(i));
    },
    pickPicture: async (): Promise<SlideImage | null> => {
      const p = await pickPicture();
      return p ? { src: dataUrl(p.bytes, p.mime), px: imageSize(p.bytes, p.mime) ?? { w: 200, h: 200 } } : null;
    },
  });
  // the deck may have gone (its tab closed) while the window was open
  if (!got || deckNow() !== d) return;
  if (got.action === 'reset') d.setBackground(undefined, picked, got.hideGraphics);
  else if (got.action === 'all' || design) d.setAllBackgrounds(got.bg, got.hideGraphics);
  else d.setBackground(got.bg, picked, got.hideGraphics);
}

/** Design > Templates: a ready-made look for every slide, and optionally for new decks too. */
let slideTemplate: string | null = null;
/** Your own slide themes (made in Design > Templates), kept in the settings. */
let slideThemes: SlideTemplate[] = [];
const themeById = (id: string | null) => [...SLIDE_TEMPLATES, ...slideThemes].find((x) => x.id === id);
async function slideTemplates(): Promise<void> {
  const d = deckNow();
  if (!d) return;
  finishTyping();
  const got = await pickSlideTemplate(d.master, d.size, slideTemplate, slideThemes);
  if (!got) return;
  if (JSON.stringify(got.mine) !== JSON.stringify(slideThemes)) {
    slideThemes = got.mine;
    // a theme for new decks that has been deleted: back to the plain look
    if (slideTemplate && !themeById(slideTemplate)) slideTemplate = null;
    storeSettings();
  }
  const t = got.template;
  if (!t) return;
  if (deckNow() === d) d.setMaster(applyTemplate(d.master, t));
  if (got.forNew) {
    slideTemplate = t.id;
    storeSettings();
    flash(`New slide decks will start with ${t.name}. Pick Plain to go back.`);
  }
}

/** Slide Master > Edit Layouts: the deck's layouts and their placeholders. */
async function editSlideLayouts(): Promise<void> {
  const d = deckNow();
  if (!d?.current || ws.active.mode !== 'slides') { flash('Layouts are for slides: use File > New Slides, or open a PowerPoint file.'); return; }
  finishTyping();
  const used = new Map<LayoutId, number>();
  for (const s of d.slides) used.set(s.layout, (used.get(s.layout) ?? 0) + 1);
  const got = await editLayouts({ master: d.master, size: d.size, current: d.current.layout, used });
  if (got && deckNow() === d) d.setLayouts(got);
}

/** Design > Slide Size > Custom Slide Size: any size, with what is on the slides scaled to fit or kept as it is. */
async function customSlideSize(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const got = await pickSlideSize(d.size);
  if (got && deckNow() === d) setSlideSize(got.size, got.fit);
}

function present(fromHere: boolean, notes = false, how: { custom?: number; windowed?: boolean; rehearse?: boolean; record?: boolean } = {}): void {
  const d = deckNow();
  if (!d) { flash('Present shows slides: use File > New Slides, or open a PowerPoint file.'); return; }
  if (presenter.running || presenterView.running) return;
  finishTyping();
  // Set Up Show: the slides it plays, how it goes on, and the rest
  const setup = d.settings.show ?? defaultShow();
  const order = showOrder(d.slides, setup, d.settings.customShows ?? [], how.custom ?? setup.custom);
  if (order && !order.length) { flash('The show has no slides to play: every slide it names is hidden or gone (Slide Show > Set Up Show).'); return; }
  const kiosk = setup.type === 'kiosk' && !how.rehearse && !how.windowed;
  if (kiosk && !d.slides.some((s) => s.transition?.advanceAfter)) flash('At a kiosk the show goes on only by the slides\' times: give them times with Rehearse Timings (or Transitions > After). Esc ends the show.', 9000);
  const opts: ShowOptions = {
    order, noAnimation: setup.noAnimation, noNarration: setup.noNarration, manual: setup.manual, loop: setup.loop, kiosk,
    windowed: how.windowed || (setup.type === 'window' && !notes && !how.rehearse), rehearse: how.rehearse, record: how.record,
  };
  editor.paused = true;
  refreshZooms(d);
  // from the start: the first slide that isn't hidden; from here: this slide even when hidden, as in PowerPoint
  const from = fromHere ? d.index : order ? order[0] : d.firstShown();
  void (notes ? presenterView.start(d, from, opts) : presenter.start(d, from, opts));
}

/** Rehearse Timings and Record, kept: each slide's time, and its narration as a sound on it. */
presenter.onRehearsed = (r) => {
  const d = deckNow();
  if (!d) return;
  void (async () => {
    if (r.recordings.size) {
      const sounds = new Map<number, { src: string; seconds: number }>();
      for (const [i, blob] of r.recordings) {
        try {
          const w = await recordingToWav(blob);
          if (w.seconds > 0.2) sounds.set(i, { src: dataUrl(w.bytes, 'audio/wav'), seconds: w.seconds });
        } catch { /* a recording this computer can't read is left out */ }
      }
      const ix = [...sounds.keys()].filter((i) => i >= 0 && i < d.slides.length);
      if (ix.length) {
        const poster = speakerPng(), s = 24;
        d.editSlides('Record narration', ix, (sd, i) => {
          // a new recording takes the place of the slide's old one
          for (const sh of [...sd.shapes.values()]) if (sh.video?.narration) sd.removeShape(sh.id);
          const n = sounds.get(i)!;
          sd.addShape({
            kind: 'picture', x1: d.size.w - s - 12, y1: d.size.h - s - 12, x2: d.size.w - 12, y2: d.size.h - 12, px: { w: 128, h: 128 }, src: poster, name: NARRATION_NAME,
            video: { src: n.src, audio: true, start: 'auto', once: true, hide: true, narration: true, length: +n.seconds.toFixed(3) },
          });
        });
      } else flash('Nothing was recorded (the microphone gave no sound).');
    }
    d.setTimings(r.times, r.recordings.size ? 'Record slide show timings' : 'Rehearse timings');
    flash(`Kept: the show takes ${clockText(r.total)}${r.recordings.size ? ', with narration on the slides' : ''}. Set Up Show > Advance slides can turn the times off.`, 8000);
  })();
};

/** Insert > Header & Footer (Date & Time, Slide Number): the slides', notes pages' and handouts' header and footer. */
async function headerFooter(tab: 'slide' | 'notes' = 'slide'): Promise<void> {
  const d = deckNow();
  if (!d?.current || ws.active.mode !== 'slides') return;
  finishTyping();
  const ix = pickedSlides();
  const got = await editHeaderFooter(d.master, d.current, ix.length, tab);
  if (!got || deckNow() !== d) return;
  d.setHeaderFooter(got.master, got.show, got.scope === 'picked' ? ix : undefined);
}

/** Slide Show > Set Up Show. */
async function setUpShowCmd(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const got = await setUpShow(d.settings.show, d.settings.customShows ?? [], d.slides.length);
  if (got && deckNow() === d) d.setSettings({ ...d.settings, show: got }, 'Set up show');
  showSlideState();
}

/** Custom Slide Show > Custom Shows: make and change them (and play one). */
async function customShowsCmd(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const names = d.slides.map((s, i) => {
    const t = [...d.docOf(i).captions.values()].find((c) => c.ph === 'title');
    const words = t ? t.runs.map((r) => r.text).join('').replace(/\s+/g, ' ').trim() : '';
    return { id: s.id, name: `${i + 1}. ${words || 'Slide ' + (i + 1)}${s.hidden ? ' (hidden)' : ''}` };
  });
  const got = await editCustomShows(d.settings.customShows ?? [], names);
  if (!got || deckNow() !== d) return;
  const show = d.settings.show && d.settings.show.custom !== undefined && !got.shows.some((c) => c.id === d.settings.show!.custom) ? { ...d.settings.show, custom: undefined } : d.settings.show;
  if (show && show.custom === undefined) delete show.custom;
  d.setSettings({ ...d.settings, customShows: got.shows, ...(show ? { show } : {}) }, 'Custom shows');
  if (got.play !== undefined) present(false, false, { custom: got.play });
}

/** Custom Slide Show: the deck's custom shows to play, and Custom Shows… */
function customShowMenu(anchor: HTMLElement): void {
  const d = deckNow();
  if (!d) return;
  const r = anchor.getBoundingClientRect();
  const shows = d.settings.customShows ?? [];
  showContextMenu(r.left, r.bottom, [
    ...shows.map((c) => ({ cmd: `custom-show:${c.id}`, label: c.name })),
    ...(shows.length ? [null] : []),
    { cmd: 'custom-shows', label: 'Custom Shows…' },
  ], { run: (cmd) => (cmd.startsWith('custom-show:') ? present(false, false, { custom: Number(cmd.slice(12)) }) : void command(cmd)), key: commandKey });
}

/** Ink drawn in the slide show, kept: shapes on its slides, as one step to undo. */
presenter.onKeepInk = presenterView.onKeepInk = (ink) => {
  const d = deckNow();
  if (!d) return;
  const indices = [...ink.keys()].filter((i) => i >= 0 && i < d.slides.length);
  if (!indices.length) return;
  d.editSlides('Keep ink', indices, (sd, i) => {
    for (const st of ink.get(i) ?? []) { const sh = inkShape(st); if (sh) sd.addShape(sh); }
  });
  editor.requestScene();
  flash(`Ink kept on ${indices.length} slide${indices.length === 1 ? '' : 's'}. Each line is a shape: move it, recolour it or delete it.`, 6000);
};

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
    pages = recordPages(docFile.t, docFile.printLayout(), (c, style) => figures.record(c, style).pic);
  } else if (deck) {
    pages = deck.slides.map((s, i) => ({
      w: deck.size.w, h: deck.size.h,
      items: recordSlide(deck.page(i), deck.docOf(i)),
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
    const bytes = await writePdf(pages, { title: tab.name.replace(/\.[^.]+$/, ''), image: pdfImage, fonts: pdfFonts });
    await writeFile(target.ref, target.name, bytes, PDF);
  } catch (e) {
    await showError(`Could not save ${target.name}: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }
  flash(`Saved ${target.name}${pages.length > 1 ? ` (${pages.length} pages)` : ''}`);
}

// ---------------------------------------------------------------- printing

/** The choices made in the Print window, kept while the app is open. */
const printChoices = { paper: defaultPaper(navigator.language) as string, orient: 'auto', size: 'actual', handout: '1', frame: 'true', sheet: 'all' };
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
    const area = !!sheetMode.view.sheet?.pageSetup?.printArea?.length;
    const v = await ask('Print', [
      { name: 'sheet', label: 'Print', value: printChoices.sheet, options: [
        { value: 'all', label: area ? 'The print area' : 'The whole sheet' },
        ...(area ? [{ value: 'used', label: 'The whole sheet (ignore the print area)' }] : []),
        { value: 'sel', label: 'The selected cells' },
      ] },
    ], { ok: 'Print…', note: 'Paper, orientation, margins, scaling, titles, headers and footers come from the Page Layout tab (Page Setup…). Copies and the printer are chosen in the next window: set its paper to match.' });
    if (!v) return;
    Object.assign(printChoices, v);
    const got = sheetMode.printedSheet({ selection: v.sheet === 'sel', ignoreArea: v.sheet === 'used', file: tab.name });
    if (!got) { flash('There is nothing in this sheet to print.'); return; }
    printPages({ pages: got.pages, w: got.w, h: got.h });
    return;
  }
  const docFile = docActive() ? tab.document : null;
  if (docFile) {
    // the pages as laid out on screen
    const pages = recordPages(docFile.t, docFile.printLayout(), (c, style) => figures.record(c, style).pic);
    if (!pages.length) return;
    printPages({ pages: pages.map(pageSvgOf), w: pages[0].w, h: pages[0].h });
    return;
  }
  if (deck) {
    const slide = (i: number) => itemsToSvg(recordSlide(deck.page(i), deck.docOf(i)), { x1: 0, y1: 0, x2: deck.size.w, y2: deck.size.h });
    if (tab.mode === 'design') { printPages({ pages: [slide(deck.index)], w: deck.size.w, h: deck.size.h }); return; }
    const m = deck.master;
    const v = await ask('Print', [
      { name: 'handout', label: 'Layout', value: printChoices.handout, options: [
        { value: '1', label: 'Full page slides' }, { value: 'notes', label: 'Notes Pages (as the Notes Master sets them)' },
        { value: 'master', label: `Handouts as the Handout Master sets them (${(m.handout ?? defaultHandout()).perPage} a page)` },
        { value: '2', label: 'Handouts: 2 slides a page' }, { value: '3', label: 'Handouts: 3 slides a page, with lines for notes' },
        { value: '4', label: 'Handouts: 4 slides a page' }, { value: '6', label: 'Handouts: 6 slides a page' }, { value: '9', label: 'Handouts: 9 slides a page' },
      ] },
      { name: 'paper', label: 'Paper (handouts)', value: printChoices.paper, options: PAPER_OPTIONS },
      { name: 'frame', label: 'Frame the slides (handouts)', value: printChoices.frame, type: 'checkbox' },
    ], { ok: 'Print…', note: 'Full page slides print at the slide\'s own shape, notes pages at 7.5 × 10 in; the next window fits them to the paper. Handouts and notes pages carry the header and footer from Insert > Header & Footer > Notes and Handouts. Copies and which pages are chosen in the next window.' });
    if (!v) return;
    Object.assign(printChoices, v);
    if (v.handout === '1') { printPages({ pages: deck.slides.map((_, i) => slide(i)), w: deck.size.w, h: deck.size.h }); return; }
    if (v.handout === 'notes') {
      const size = notesPageSize(m.notesPage);
      const pages = deck.slides.map((s, i) => notesPageSvg(m, deck.size, slide(i), s.notes, i + 1, (t, k) => measureText(t, k, m.notesPage?.font || m.bodyFont || 'Arial'), placeSvg));
      printPages({ pages, w: size.w, h: size.h });
      return;
    }
    const setup: HandoutSetup = v.handout === 'master' ? { ...(m.handout ?? defaultHandout()) } : { ...(m.handout ?? defaultHandout()), perPage: Number(v.handout) as HandoutSetup['perPage'] };
    setup.frame = v.frame === 'true';
    const paper = PAPERS[v.paper] ?? PAPERS.letter;
    const pages: string[] = [];
    for (let first = 0, page = 1; first < deck.slides.length; first += setup.perPage, page++) {
      const svgs = deck.slides.slice(first, first + setup.perPage).map((_, k) => slide(first + k));
      pages.push(handoutPageSvg(m, deck.size, setup, svgs, page, placeSvg, paper));
    }
    const L = handoutLayout(deck.size, setup, paper);
    printPages({ pages, w: L.page.w, h: L.page.h });
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
 * File > Export Picture: the page (a design or the current slide) or the drawing as a PNG or
 * TIFF at the resolution picked, or as an SVG, EMF or EPS, on its background colour or see-through.
 */
async function exportPicture(): Promise<void> {
  const tab = ws.active, deck = tab.deck;
  const what = deck ? (tab.mode === 'design' ? 'the page' : 'this slide') : 'the drawing';
  const v = await ask('Export Picture', [
    { name: 'format', label: 'Format', value: 'png', options: [
      { value: 'png', label: 'PNG (a picture of dots: journals, Word, web)' },
      { value: 'tiff', label: 'TIFF (a picture of dots, LZW-compressed: what many journals ask for)' },
      { value: 'svg', label: 'SVG (shapes that stay sharp: Illustrator, Inkscape, web)' },
      { value: 'emf', label: 'EMF (shapes that stay sharp: Word, PowerPoint on Windows)' },
      { value: 'eps', label: 'EPS (shapes that stay sharp: older journal systems, Illustrator)' },
    ] },
    { name: 'dpi', label: 'Resolution (PNG, TIFF)', value: '300', type: 'number', unit: 'dpi' },
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
  let items: () => { items: Item[]; box: EmfBox };
  let svg: () => string;
  let png: (k: number) => HTMLCanvasElement;
  if (deck) {
    const i = deck.index;
    const page = clear ? { ...deck.page(i), own: solid(CLEAR) } : deck.page(i);
    ({ w, h } = deck.size);
    items = () => ({ items: recordSlide(page, deck.docOf(i)).filter((it) => !(it.kind === 'path' && it.fill === CLEAR)), box: { x1: 0, y1: 0, x2: w, y2: h } });
    svg = () => { const p = items(); return itemsToSvg(p.items, p.box); };
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
    items = () => ({ items: [...back, ...pic.items], box: b });
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
  const type = ({ svg: SVG, tiff: TIFF, emf: EMF, eps: EPS } as Record<string, FileType>)[v.format] ?? PICTURE;
  const target = await saveFileDialog(withExtension(tab.name, type.extension), type).catch(async (e) => { await showError(String(e)); return null; });
  if (!target) return;
  let note = '';
  try {
    if (type === SVG) await writeFile(target.ref, target.name, svg(), SVG);
    else if (type === EMF) { const p = items(); await writeFile(target.ref, target.name, itemsToEmf(p.items, p.box), EMF); }
    else if (type === EPS) { const p = items(); await writeFile(target.ref, target.name, await itemsToEps(p.items, p.box, pdfImage, tab.name.replace(/\.[^.]+$/, '')), EPS); }
    else {
      const k = bitmapScale(w, h, dpi, EXPORT_MAX_SIDE, EXPORT_MAX_PIXELS);
      const c = png(k);
      const got = Math.round((c.width / w) * 72);
      if (got < dpi - 1) note = ` at ${got} dpi (the most for a page this big)`;
      if (type === TIFF) {
        const px = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        await writeFile(target.ref, target.name, writeTiff(px, c.width, c.height, (c.width / w) * 72, clear), TIFF);
      } else {
        const bytes = new Uint8Array(await (await canvasPng(c)).arrayBuffer());
        await writeFile(target.ref, target.name, pngWithDpi(bytes, (c.width / w) * 72), PICTURE);
      }
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

const SHEET_HINT = 'Type in a cell, or double-click to change it. Insert > Structure in Cell puts a structure in a cell; Insert > Insert Property Columns works out formula, MW, HRMS m/z and more.';

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
  command: (name) => command(name),
  changed: (book) => ws.noteChange(book && ws.tabs.find((t) => t.book === book)),
  isOpen: (book) => ws.tabs.some((t) => t.book === book),
  toStructure: (text, style) => textToStructure(text, style),
  writeCells: (own, text, html) => writeCells(own, text, html),
  copyStructure: async (contents, style) => (await copyDrawing(structureDoc(contents, style), null)).replace(/^Copied the whole drawing/, 'Copied the structure'),
  readCells: (e) => readCells(e),
  askName: () => docMode.askReviewName(),
  pickPicture: () => pickPicture(),
  print: () => void printNow(),
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
  for (const el of document.querySelectorAll<HTMLElement>('.sheet-only, .no-sheet, .doc-only, .no-doc')) {
    const c = el.classList;
    el.hidden = (c.contains('sheet-only') && !sheet) || (c.contains('no-sheet') && sheet) || (c.contains('doc-only') && !words)
      || (c.contains('no-doc') && words);
  }
  tickMenuModes();
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
    if ('error' in named) return { error: named.bad !== undefined || named.details ? `"${t}" isn't SMILES or a name that could be read. Check the spelling, or try a CAS number or a simpler name.` : named.error };
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
  forgetCopy();
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
let cellEdit: { done: (c: Contents | null) => void; saved: Doc; view: typeof renderer.view } | null = null;

function editCellStructure(contents: Contents | null, title: string, done: (c: Contents | null) => void, style: DocStyle = sheetStyle()): void {
  finishCellStructure(true);
  const blank: Contents = { atoms: [], bonds: [], captions: [], arrows: [], shapes: [] };
  const drawing = structureDoc(contents ?? blank, style);
  editor.clearSelection();
  doc.swap(drawing);
  // the drawing beside (split view) waits in `drawing`, its zoom kept for after
  cellEdit = { done, saved: drawing, view: { ...renderer.view } };
  ws.aside = ws.pane ? drawing : null;
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
  ws.aside = null;
  // the drawing beside is back as it was: not changed, at its own zoom
  if (ws.pane) ws.pane.seen = doc.version;
  renderer.view = e.view;
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
  'sheet-new-window': () => { sheetMode.view.commitEdit(); ws.newWindow(); },
  // (through the sheet's own command, which copies a selected chart rather than the cells under it)
  cut: () => sheetMode.run('cut'),
  copy: () => sheetMode.run('copy'),
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
/** Insert > Quick Parts: saved pieces of text (kept with the settings). */
let docQuickParts: QuickPart[] = [];

const docStyle = (): DocStyle => ws.active.document?.t.drawingStyle ?? ACS_1996;

const docMode = new DocumentMode({
  flash,
  key: (e) => docKey(e),
  command: (name) => command(name),
  changed: () => ws.noteChange(),
  editDrawing: (contents, title, done) => editCellStructure(contents, title, done, docStyle()),
  editDiagram: (contents) => documentDiagram(contents),
  copyDrawing: async (contents, style) => (await copyDrawing(structureDoc(contents, style), null)).replace(/^Copied the whole drawing/, 'Copied the structure'),
  copiedOther: () => forgetCopy(),
  copyPicture: (src) => copyImage(src),
  readPaste: (e) => readDocPaste(e),
  toStructure: (text, style) => textToStructure(text, style),
  pickPicture: () => pickPicture(),
  pickObjectFile: () => pickObjectFile(),
  objectPicture: (name, bytes, icon) => objectPictureOf(name, bytes, icon),
  openObjectFile: (file, changed) => openObjectFile(file, changed),
  clipboardObject: nativeClipboard ? () => clipboardObject() : undefined,
  pickReferenceFile: () => pickReferenceFile(),
  preferredChanged: () => storeSettings(),
  reviewNameChanged: () => storeSettings(),
  quickParts: () => docQuickParts,
  setQuickParts: (list) => { docQuickParts = list; storeSettings(); },
  setNewDesign: (d) => { setNewDocDesign(d); storeSettings(); },
  openDocuments: () => {
    const seen = new Set<unknown>();
    return ws.tabs.filter((t) => t.mode === 'document' && t.document && !seen.has(t.document) && seen.add(t.document)).map((t) => ({ name: ws.label(t), t: t.document!.t }));
  },
  pickDocument: async () => {
    const f = await openBytesDialog('Word documents', [DOCX]).catch(async (e) => { await showError(String(e)); return null; });
    if (!f) return null;
    try {
      const { doc, warnings } = await readDocx(f.bytes, docRead);
      if (warnings.length) flash(`${f.name}: ${warnings.join(' ')}`, 8000);
      return { name: f.name, t: doc };
    } catch (e) {
      await showError(`Could not open ${f.name}: ${String(e)}`);
      return null;
    }
  },
  showDocument: (t, name) => { ws.showDocument(t, name); },
  newTable: (rows, cols, style) => tableDrawing(emptyTable(rows, cols, style.captionSize), style),
  measure: measureText,
});
docBoxPrefs.changed = () => storeSettings();
docRulerPrefs.changed = () => storeSettings();
formulaBarPrefs.changed = () => storeSettings();
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
  'insert-diagram': () => void docMode.insertDiagram(),
  'insert-icons': () => {
    const b = document.querySelector<HTMLElement>('#doc-ribbon [data-doc="insert-icons"]');
    const anchor = b && b.offsetParent ? b : document.querySelector<HTMLElement>('#doc-ribbon .rb-tabs')!;
    shapeMenu.show(anchor, 'Click an icon to put it in the text at the caret. Double-click it there to change its size or colour.', (id) => docMode.insertShape(id), 'icons');
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
  // View > New Window: the document in another tab too, with its own view and place
  'doc-new-window': () => { ws.newWindow(); },
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
const ANY_TAB = new Set(['new-from-template', 'check-accessibility', 'format-painter', 'insert-symbol', 'edit-palettes', 'preferences', 'export-settings', 'import-settings', 'customize-ribbon', 'toolbox-main', 'toolbox-structure', 'toolbox-arrange', 'toolbox-templates', 'toolbox-colours', 'toolbox-highlight', 'toolbox-custom', 'fold-side', 'customize-toolbox', 'lock-toolboxes', 'reset-toolboxes', 'new', 'new-slides', 'new-design', 'new-sheet', 'new-document', 'open', 'save', 'save-as', 'autosave', 'version-history', 'recover-work', 'keep-options', 'close-tab', 'next-tab', 'prev-tab', 'undo', 'redo',
  'drawing-style', 'navigation-settings', 'dark-page', 'dark-colours', 'alignment-guides', 'hotkeys', 'typing-spelling', 'mode-colours', 'dev-tools', 'scroll-bars', 'title-bar-in-menu', 'collapse-ribbon', 'text-bar-docked', 'text-bar-floating', 'text-bar-hidden', 'group-tips', 'show-stereo', 'clipboard-formats', 'split-view', 'command-search', 'next-region', 'prev-region', 'print',
  'help', 'about', 'user-guide', 'help-here', 'send-feedback', 'report-problem', 'check-updates']);

// ---------------------------------------------------------------- accessibility (Review > Check Accessibility, Alt Text…)

/** What makes the file showing hard to use with a screen reader or to read. */
function accessibilityIssues(): Issue[] {
  if (sheetActive()) return ws.active.book ? checkWorkbook(ws.active.book) : [];
  if (docActive()) { const t = docMode.file?.t; return t ? checkDocument(t) : []; }
  const deck = deckNow();
  if (deck && ws.active.mode === 'slides') {
    const out: Issue[] = [];
    const titles: (string | null)[] = [];
    deck.slides.forEach((_, i) => {
      const d = deck.docOf(i);
      out.push(...checkDrawing(d, { slide: i, slideTitle: true, ...(d === doc ? { captionBox: (c: Caption) => renderer.captionBox(c) } : {}) }));
      const t = [...d.captions.values()].find((c) => c.ph === 'title');
      titles.push(t ? t.runs.map((r) => r.text).join('') : null);
    });
    return [...out, ...repeatedTitles(titles)];
  }
  return checkDrawing(doc, { captionBox: (c) => renderer.captionBox(c) });
}

/** Go to what an accessibility issue is about, and select it. */
function goToIssue(p: IssuePlace): void {
  if (sheetActive()) { sheetMode.goToIssue(p); return; }
  if (docActive()) {
    if (p.kind === 'doc-object') docMode.goToObject(p.id);
    else if (p.kind === 'doc-para') docMode.revealPara(p.para);
    return;
  }
  if (p.kind !== 'drawing') return;
  const deck = deckNow();
  if (deck && p.slide !== undefined) deck.go(p.slide);
  // brought into view (zoomed in to it), then picked whole
  if (p.atoms?.length) editor.reveal('atom', p.atoms[0]);
  else if (p.captions?.length) editor.reveal('caption', p.captions[0]);
  editor.selectThese({ atoms: new Set(p.atoms ?? []), bonds: new Set(), captions: new Set(p.captions ?? []), arrows: new Set(), shapes: new Set(p.shapes ?? []) });
}

/** Alt Text… in a drawing, on a slide or in a design: for the picture or chart picked, or else the structure picked. */
async function drawingAltText(): Promise<boolean> {
  const pics = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => x?.kind === 'picture');
  if (pics.length === 1) {
    const p = pics[0];
    const got = await askAltText(p.chart ? 'chart' : p.math ? 'equation' : p.video ? (p.video.audio ? 'sound' : 'video') : 'picture', p.alt);
    if (got === null || !doc.shapes.has(p.id)) return false;
    doc.edit('Alt text', () => doc.updateShape(p.id, { alt: got || undefined }));
    return true;
  }
  const atom = [...editor.sel.atoms].find((id) => doc.atoms.has(id));
  if (pics.length === 0 && atom !== undefined) {
    const frag = [...doc.fragmentOf(atom)].map((id) => doc.atoms.get(id)).filter((a): a is Atom => !!a);
    const got = await askAltText('structure', structureAlt(frag), 'Screen readers read this out in place of the structure, and PowerPoint and Word keep it as the picture\'s alt text. Left empty, the structure is described by its SMILES.');
    if (got === null || !doc.atoms.has(atom)) return false;
    setStructureAlt(doc, atom, got);
    return true;
  }
  flash(pics.length > 1 ? 'Select one picture at a time for Alt Text.' : 'Click a picture, chart or structure first, then Alt Text.');
  return false;
}

const accessibility = new AccessibilityPane({
  check: accessibilityIssues,
  goTo: goToIssue,
  fixAlt: async (p) => {
    if (sheetActive()) return sheetMode.altText();
    if (docActive()) return p.kind === 'doc-object' ? docMode.altText(p.id) : false;
    return drawingAltText();
  },
});

const slideCompare = new SlideComparePane({
  deck: () => (ws.active.mode === 'slides' ? deckNow() : null),
  flash: (m, ms) => flash(m, ms),
  changed: () => { const d = deckNow(); if (d) deckChanged(d); },
});

/** File > New from Template: a document or sheet started from one of our templates. */
async function newFromTemplate(): Promise<void> {
  finishTyping();
  const got = await pickFileTemplate(sheetActive() ? 'sheet' : 'document');
  if (!got) return;
  if (got.kind === 'sheet') {
    ws.newSheet(got.template?.make());
  } else ws.newDocument(got.template?.make());
  if (got.template) flash(`New ${got.template.name.toLowerCase()}: type over the text in [brackets].`);
}

/** Review > Compare (slides): another version of this deck, from an open tab or a PowerPoint file, to review slide by slide. */
async function compareSlides(): Promise<void> {
  const d = deckNow();
  if (!d || ws.active.mode !== 'slides') return;
  finishTyping();
  const others = ws.tabs.filter((t) => t !== ws.active && t.mode === 'slides' && t.deck);
  let pick = 'file';
  if (others.length) {
    const got = await ask('Compare Presentations', [{
      name: 'with', label: 'Compare with', value: 'file',
      options: [{ value: 'file', label: 'A PowerPoint file…' }, ...others.map((t, i) => ({ value: String(i), label: t.name }))],
    }], { ok: 'Compare', note: 'Each slide that differs in the other version is listed, to accept into this deck or reject.' });
    if (!got) return;
    pick = got.with;
  }
  const theirs = new Deck(new Doc());
  let name: string;
  if (pick === 'file') {
    const f = await openBytesDialog('PowerPoint presentations', [PPTX]).catch(async (e) => { await showError(String(e)); return null; });
    if (!f) return;
    try {
      const got = readPptx(f.bytes);
      theirs.load(got.slides.map((s) => theirs.makeSlide(s.layout, s.contents, s.notes, s, got.master)), got.size, got.master);
    } catch (e) {
      flash(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`, 8000);
      return;
    }
    name = f.name;
  } else {
    const t = others[Number(pick)];
    const src = t.deck!.copySlides(t.deck!.slides.map((_, i) => i));
    theirs.load(src.slides.map((s) => theirs.makeSlide(s.layout, s.contents, s.notes, s.motion, src.master)), src.size, src.master);
    name = t.name;
  }
  if (deckNow() !== d) return;
  const n = slideCompare.start(d, theirs, name, document.querySelector<HTMLElement>('[data-cmd="compare-slides"]:not([hidden])'));
  flash(n ? `${n} change${n === 1 ? '' : 's'} from ${name} to review.` : `${name} has the same slides as this deck.`);
}

/** Run a menu command in the way that suits the tab showing. False when it doesn't apply there. */
function command(name: string): boolean {
  // View > Toolboxes: one of your own
  if (name.startsWith('toolbox-own-')) { toolboxes.toggle(name.slice('toolbox-'.length)); return true; }
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
  if (name.startsWith('shape-fx:')) { void shapeEffect(name); return true; }
  if (name.startsWith('add-ligand:')) {
    if (editor.addLigand(name.slice('add-ligand:'.length))) return true;
    flash('Select one metal first, then add the ligand to it.');
    return false;
  }
  if (name.startsWith('fuse-ring:')) {
    const [, id, index] = name.split(':');
    return contextBond !== null && editor.fuseRing(contextBond, id, Number(index));
  }
  if (name.startsWith('layout-') && ws.active.mode === 'slides') { setLayout(name.slice('layout-'.length)); return true; }
  const run = COMMANDS[name];
  return !!run && run() !== false;
}

/** Where the last right-click menu on the page opened (a gallery picked from it opens there). */
let rightClickAt = { left: 0, bottom: 0 };

/** The design shapes picked (the ones Shape Styles and Shape Effects change). */
function pickedGeo(): Shape[] {
  return [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => x?.kind === 'geo' && !x.diagram);
}

/** Where a ribbon button's drop-down goes: under the button showing, or under the tabs. */
function dropAnchor(cmd: string): HTMLElement {
  const b = [...document.querySelectorAll<HTMLElement>(`[data-cmd="${cmd}"]`)].find((x) => x.offsetParent);
  return b ?? document.querySelector<HTMLElement>('#ribbon .rb-tabs')!;
}

/** Shape Styles: the gallery of ready-made looks for the shapes picked, in the deck's colours. */
function shapeStyles(at?: { left: number; bottom: number }): void {
  if (!pickedGeo().length) { flash('Select a shape first (Insert > Shapes).'); return; }
  const m = deckNow()?.master;
  const colours = styleColours(m?.textColor ?? '#333333', m?.accent ?? '#2f6fb0', m?.accent2 ?? '#c0504d');
  showStyleGallery(at ?? dropAnchor('shape-styles'), colours, (look, c) => {
    const shapes = pickedGeo();
    finishTyping();
    const { textColor, ...patch } = stylePatch(look, c);
    doc.edit('Shape style', () => {
      for (const s of shapes) {
        const text = s.text && { ...s.text, runs: s.text.runs.map((r) => ({ ...r, color: textColor })) };
        doc.updateShape(s.id, { ...patch, ...(text ? { text } : {}) });
      }
    });
    editor.changed();
  });
}

/** Shape Effects: shadow, reflection, glow, soft edges and bevel, from a menu under the button (or at the pointer). */
function shapeEffects(at?: { x: number; y: number }): void {
  if (!pickedGeo().length) { flash('Select a shape first (Insert > Shapes).'); return; }
  const r = dropAnchor('shape-effects').getBoundingClientRect();
  showContextMenu(at?.x ?? r.left, at?.y ?? r.bottom, effectsMenu(), { run: (cmd) => void command(cmd), key: () => undefined });
}

/** One of the Shape Effects menu's choices, for every shape picked. */
async function shapeEffect(cmd: string): Promise<boolean> {
  const shapes = pickedGeo();
  if (!shapes.length) { flash('Select a shape first (Insert > Shapes).'); return false; }
  finishTyping();
  if (cmd === 'shape-fx:glow:options') {
    const g = shapes[0].glow ?? { color: shapes[0].fillColor ?? shapes[0].color ?? '#ffc000', size: 8, transparency: 0.4 };
    const v = await ask('Glow', [
      { name: 'color', label: 'Colour', value: g.color, type: 'color' },
      { name: 'size', label: 'Size (pt)', value: String(g.size), type: 'number' },
      { name: 'clear', label: 'Transparency (%)', value: String(Math.round(g.transparency * 100)), type: 'number' },
    ], { ok: 'Apply' });
    if (!v) return false;
    const size = Math.max(0, Math.min(150, Number(v.size) || 0));
    const glow = size > 0 ? { color: v.color, size, transparency: Math.max(0, Math.min(1, (Number(v.clear) || 0) / 100)) } : undefined;
    doc.edit('Glow', () => { for (const s of shapes) doc.updateShape(s.id, { glow }); });
    editor.changed();
    return true;
  }
  const label = { shadow: 'Shadow', reflection: 'Reflection', glow: 'Glow', soft: 'Soft edges', bevel: 'Bevel' }[cmd.split(':')[1]] ?? 'Shape effect';
  doc.edit(label, () => { for (const s of shapes) { const p = effectPatch(cmd, s); if (p) doc.updateShape(s.id, p); } });
  editor.changed();
  return true;
}

/** Shape Fill > Picture: a picture from a file fills the shapes picked, stretched to each. */
async function shapePictureFill(): Promise<void> {
  const shapes = pickedGeo();
  if (!shapes.length) { flash('Select a shape first (Insert > Shapes).'); return; }
  const p = await pickPicture();
  if (!p) return;
  if (!/^image\/(png|jpeg|gif)$/.test(p.mime)) { flash('A shape can be filled with a PNG, JPEG or GIF picture.'); return; }
  finishTyping();
  const picFill = { src: dataUrl(p.bytes, p.mime), px: imageSize(p.bytes, p.mime) ?? { w: 100, h: 100 } };
  doc.edit('Picture fill', () => { for (const s of shapes) doc.updateShape(s.id, { picFill, filled: true }); });
  editor.changed();
}

/** Shape Fill > No Picture: back to the shapes' own fill colour. */
function shapeNoPictureFill(): void {
  const shapes = pickedGeo().filter((s) => s.picFill);
  if (!shapes.length) { flash('None of the shapes picked has a picture fill.'); return; }
  doc.edit('Picture fill', () => { for (const s of shapes) doc.updateShape(s.id, { picFill: undefined }); });
  editor.changed();
}

/** Picture Style (right-click on a picture): a ready-made frame, corners and shadow for the pictures picked. */
function setPictureStyle(look: PictureLook | undefined): boolean {
  const pics = [...editor.sel.shapes].map((id) => doc.shapes.get(id)).filter((x): x is Shape => x?.kind === 'picture');
  if (!pics.length) { flash('Select a picture first.'); return false; }
  doc.edit('Picture style', () => { for (const p of pics) doc.updateShape(p.id, { look: look && { ...look } }); });
  return true;
}

/** Slide commands that don't apply to a design's single page. */
const SLIDE_ONLY = new Set(['compare-slides', 'section-menu', 'new-slide', 'duplicate-slide', 'delete-slide', 'cut-slides', 'copy-slides', 'paste-slides', 'paste-slides-keep', 'hide-slide', 'reuse-slides', 'size-wide', 'size-standard', 'size-custom', 'slide-master', 'slide-templates',
  'edit-layouts', 'view-sorter', 'add-section', 'rename-section', 'remove-section', 'remove-section-slides', 'remove-all-sections', 'section-up', 'section-down', 'collapse-sections', 'expand-sections',
  'slide-transitions', 'slide-animations', 'animation-pane', 'preview-slide', 'remove-animation', 'insert-slide-zoom', 'insert-summary-zoom', 'action-settings', 'insert-video', 'insert-audio',
  'reading-view', 'rehearse-timings', 'record-show', 'set-up-show', 'custom-shows', 'custom-show-menu', 'use-timings', 'play-narrations', 'header-footer', 'insert-date-time', 'insert-slide-number', 'view-slide-ruler', 'view-gridlines', 'view-guides', 'grid-settings', 'add-vertical-guide', 'add-horizontal-guide', 'view-outline', 'view-notes-page', 'notes-master', 'handout-master']);

/** The animation commands: an effect for the selected objects (the right-click menu's Animation). */
const ANIM_COMMANDS: { cmd: string; label: string }[] = [false, true].flatMap((exit) => EFFECTS.filter((e) => !(exit && e.emph)).map((e) => ({
  cmd: `animate-${e.id}${exit ? '-out' : ''}`, label: animName(newAnim({ kind: 'shape', id: 0 }, e.id, exit)),
})));

const COMMANDS: Record<string, () => unknown> = {
  new: () => { finishTyping(); ws.newDrawing(); },
  'check-accessibility': () => { finishTyping(); if (accessibility.open) accessibility.refresh(); else accessibility.show(document.querySelector<HTMLElement>('[data-cmd="check-accessibility"]:not([hidden])')); },
  'alt-text': () => { finishTyping(); void drawingAltText(); },
  'new-slides': () => { finishTyping(); ws.newSlides(); },
  'new-design': () => newDesign(),
  'design-size': () => designSize(),
  'connector-tool': () => { finishTyping(); editor.setTool('connector'); },
  'connector-elbow-tool': () => { finishTyping(); editor.setTool('connector-elbow'); },
  'shape-styles': () => shapeStyles(),
  'view-slide-ruler': () => { slideLook.ruler = !slideLook.ruler; showRulers(); storeSettings(); },
  'view-gridlines': () => { slideLook.grid = !slideLook.grid; showRulers(); storeSettings(); renderer.repaintAll(); editor.requestScene(); },
  'view-guides': () => toggleGuides(),
  'grid-settings': () => void gridSettings(),
  'add-vertical-guide': () => addGuide('x'),
  'add-horizontal-guide': () => addGuide('y'),
  'shape-styles-here': () => shapeStyles(rightClickAt),
  'shape-effects': () => shapeEffects(),
  'shape-picture-fill': () => void shapePictureFill(),
  'shape-no-picture-fill': () => shapeNoPictureFill(),
  'slide-shapes': () => {
    shapeMenu.show(dropAnchor('slide-shapes'), 'Click a shape, then click or drag on the slide. Type in it once placed.', (id) => { finishTyping(); editor.setTool(`geo:${id}`); });
  },
  'slide-icons': () => {
    const b = document.querySelector<HTMLElement>('#ribbon [data-cmd="slide-icons"]:not([hidden])');
    const anchor = b && b.offsetParent ? b : document.querySelector<HTMLElement>('#ribbon .rb-tabs')!;
    shapeMenu.show(anchor, 'Click an icon, then click or drag on the slide. Change its colour in the Style panel.', (id) => { finishTyping(); editor.setTool(`geo:${id}`); }, 'icons');
  },
  'design-shapes': () => { if (ws.active.mode === 'design') { lib.showTab('shapes'); lib.focusSearch(); } else flash('Shapes are in Design mode: use File > New Design.'); },
  'design-icons': () => { if (ws.active.mode === 'design') { lib.showTab('icons'); lib.focusSearch(); } else flash('Icons are in Design, Slides and Document modes.'); },
  // the Insert menu's Shapes and Icons, in whichever mode is showing (Documents have their own)
  'insert-shapes': () => (ws.active.mode === 'design' ? COMMANDS['design-shapes']() : ws.active.mode === 'slides' ? COMMANDS['slide-shapes']() : flash('Shapes go on slides, designs and documents.')),
  'insert-icons': () => (ws.active.mode === 'design' ? COMMANDS['design-icons']() : ws.active.mode === 'slides' ? COMMANDS['slide-icons']() : flash('Icons go on slides, designs and documents.')),
  'shape-front': () => editor.setShapeLayer('front') || flash('Select the shapes to bring to the front.'),
  'shape-back': () => editor.setShapeLayer('back') || flash('Select the shapes to send to the back.'),
  'shape-forward': () => editor.setShapeLayer('forward') || flash('Select the shapes to bring forward.'),
  'shape-backward': () => editor.setShapeLayer('backward') || flash('Select the shapes to send backward.'),
  'new-sheet': () => { finishTyping(); ws.newSheet(); },
  'new-document': () => { finishTyping(); ws.newDocument(); },
  'new-from-template': () => { void newFromTemplate(); },
  open: () => ws.open(),
  save: () => { finishTyping(); return ws.save(focusTab()); },
  'save-as': () => { finishTyping(); return ws.saveAs(focusTab()); },
  autosave: () => { finishTyping(); return keeper.toggleAutoSave(focusTab()); },
  'version-history': () => { finishTyping(); return keeper.historyCommand(focusTab()); },
  'recover-work': () => keeper.recoverCommand(),
  'keep-options': () => settingsWindow.open('autosave'),
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
  'insert-video': () => void insertMedia(false),
  'insert-slide-zoom': () => void insertZoom(false),
  'insert-summary-zoom': () => void insertZoom(true),
  'action-settings': () => void actionSettings(),
  'insert-audio': () => void insertMedia(true),
  'media-playback': () => { const id = [...editor.sel.shapes].find((x) => doc.shapes.get(x)?.video); if (id === undefined) { flash('Click a video or sound first.'); return; } void editMediaShape(id); },
  'insert-table': () => { void insertTable(); },
  'insert-chart': () => { void insertChart(); },
  'edit-chart': () => { const id = [...editor.sel.shapes].find((x) => doc.shapes.get(x)?.chart); if (id === undefined) { flash('Click a chart first.'); return; } void editChartShape(id); },
  crop: () => cropPicture(),
  'picture-format': () => { void formatPicture(); },
  'text-box': () => { editor.setTool('text'); flash('Click to type, or drag across to make a text box that wraps.'); },
  'format-painter': () => formatPainter(),
  'insert-symbol': () => symbolWindow.open(),
  'new-slide': () => newSlide(),
  'duplicate-slide': () => { const d = deckNow(); if (d) { finishTyping(); d.duplicate(pickedSlides()); } },
  'delete-slide': () => removeSlides(pickedSlides()),
  'cut-slides': () => copySlides(pickedSlides(), true),
  'copy-slides': () => copySlides(pickedSlides(), false),
  'paste-slides': () => pasteSlides(),
  'paste-slides-keep': () => pasteSlides(true),
  'hide-slide': () => hideSlides(),
  'selection-pane': () => { selectionPane = !selectionPane; showLayers(); },
  'reuse-slides': () => reuseSlides(),
  'compare-slides': () => compareSlides(),
  'insert-equation': () => insertEquation(),
  'insert-link': () => insertLink(),
  'remove-link': () => removeLinks(),
  'open-link': () => openLink(),
  'insert-bookmark': () => { flash('Bookmarks are for documents: they name a place in the text for links to go to.'); return false; },
  'edit-equation': () => { const id = [...editor.sel.shapes].find((x) => doc.shapes.get(x)?.math); if (id === undefined) { flash('Click an equation first (or double-click it).'); return; } void editEquationShape(id); },
  'next-slide': () => { const d = deckNow(); if (!d) return false; goSlide(d.index + 1); },
  'prev-slide': () => { const d = deckNow(); if (!d) return false; goSlide(d.index - 1); },
  'size-wide': () => setSlideSize(WIDE),
  'size-standard': () => setSlideSize(STANDARD),
  'size-custom': () => customSlideSize(),
  'edit-layouts': () => editSlideLayouts(),
  'section-menu': () => {
    const b = document.querySelector<HTMLElement>('#ribbon [data-cmd="section-menu"]');
    const r = b?.getBoundingClientRect();
    const d = deckNow();
    const items: MenuItem[] = d?.sections.length ? [{ cmd: 'add-section' }, null, ...sectionItems()] : [{ cmd: 'add-section' }];
    showContextMenu(r ? r.left : 200, r ? r.bottom + 2 : 120, items, { run: (cmd) => void command(cmd), key: commandKey });
  },
  'view-normal': () => setSlideView('normal'),
  'view-outline': () => setSlideView(outlineView.shown ? 'normal' : 'outline'),
  'view-notes-page': () => setSlideView(notesView.shown ? 'normal' : 'notes'),
  'notes-master': () => void editPageMaster('notes'),
  'handout-master': () => void editPageMaster('handout'),
  'view-sorter': () => setSlideView('sorter'),
  ...Object.fromEntries(['add-section', 'rename-section', 'remove-section', 'remove-section-slides', 'remove-all-sections', 'section-up', 'section-down', 'collapse-sections', 'expand-sections'].map((c) => [c, () => sectionCommand(c)])),
  'slide-master': () => slideMaster(),
  'format-background': () => backgroundDialog(),
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
  'drawing-style': () => settingsWindow.open('style'),
  present: () => present(false),
  'present-current': () => present(true),
  'presenter-view': () => present(false, true),
  'reading-view': () => present(true, false, { windowed: true }),
  'rehearse-timings': () => present(false, false, { rehearse: true }),
  'record-show': () => present(false, false, { rehearse: true, record: true }),
  'set-up-show': () => void setUpShowCmd(),
  'custom-shows': () => void customShowsCmd(),
  'custom-show-menu': () => {
    const b = document.querySelector<HTMLElement>('#ribbon [data-cmd="custom-show-menu"]');
    customShowMenu(b && b.offsetParent ? b : document.querySelector<HTMLElement>('#ribbon .rb-tabs')!);
  },
  'use-timings': () => {
    const d = deckNow();
    if (!d) return;
    const s = d.settings.show ?? defaultShow();
    d.setSettings({ ...d.settings, show: { ...s, manual: s.manual ? undefined : true } }, s.manual ? 'Use timings' : 'Advance manually');
    showSlideState();
  },
  'play-narrations': () => {
    const d = deckNow();
    if (!d) return;
    const s = d.settings.show ?? defaultShow();
    d.setSettings({ ...d.settings, show: { ...s, noNarration: s.noNarration ? undefined : true } }, s.noNarration ? 'Play narrations' : 'Show without narration');
    showSlideState();
  },
  'header-footer': () => void headerFooter(),
  'insert-date-time': () => void headerFooter(),
  'insert-slide-number': () => void headerFooter(),
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
  'flip-h': () => flipped(editor.flip('h')),
  'flip-v': () => flipped(editor.flip('v')),
  'flip-h-keep': () => flipped(editor.flip('h', true)),
  'flip-v-keep': () => flipped(editor.flip('v', true)),
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
  'collapse-ribbon': () => { setRibbonCollapsed(!ribbonCollapsed()); storeSettings(); },
  'title-bar-in-menu': () => { void placeTitleBar(titleBarPlace() === 'app' ? 'system' : 'app'); storeSettings(); },
  'page-setup': () => void pageSetup(),
  'text-bar-docked': () => { placeTextBar('docked'); storeSettings(); },
  'text-bar-floating': () => { placeTextBar('floating'); storeSettings(); },
  'text-bar-hidden': () => { placeTextBar('hidden'); storeSettings(); },
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
  'dark-colours': () => settingsWindow.open('dark'),
  'zoom-in': () => editor.zoomBy(1.25),
  'zoom-out': () => editor.zoomBy(0.8),
  'zoom-fit': () => editor.fit(),
  'zoom-selection': () => { if (!editor.goToSelection()) flash('Select something first, then Go to Selection brings it into view.'); },
  navigator: () => setOrient({ ...orientPrefs, navigator: !orientPrefs.navigator }),
  'edge-arrows': () => setOrient({ ...orientPrefs, edgeArrows: !orientPrefs.edgeArrows }),
  'dot-grid': () => setOrient({ ...orientPrefs, dotGrid: !orientPrefs.dotGrid }),
  'outside-tint': () => setOrient({ ...orientPrefs, tint: !orientPrefs.tint }),
  'navigation-settings': () => settingsWindow.open('navigation'),
  // 100%: a point on the page is a point on the screen (96 pixels to the inch)
  'zoom-actual': () => editor.zoomTo(96 / 72),
  hotkeys: () => settingsWindow.open('hotkeys'),
  'typing-spelling': () => settingsWindow.open('typing'),
  'mode-colours': () => settingsWindow.open('mode-colours'),
  'edit-palettes': () => settingsWindow.open('palettes'),
  preferences: () => settingsWindow.open('general'),
  'check-updates': () => void updates.check(),
  help: () => openHelp(),
  'user-guide': () => void guide.open(),
  'help-here': () => { const at = guideSpot(menuMode(), editor.tool.kind); void guide.open(at.page, at.anchor); },
  'send-feedback': () => feedback.open(),
  about: () => void appVersion().then((v) => ask('About Chem Illustrator', [], {
    noCancel: true,
    note: `${STAGE_NOTE} Version ${v === 'web' ? 'for the browser' : v} (${STAGE.toLowerCase()}). Free software under the GNU General Public License, version 3: `
      + 'see the licence and the source on GitHub (github.com/nathanohare/Chem-Illustrator). ChemDraw is a trademark of Revvity Signals; '
      + 'Chem Illustrator is not made by or affiliated with Revvity Signals.',
  })),
  'report-problem': () => feedback.open('problem'),
  'command-search': () => commandSearch.open(),
  'next-region': () => cycleRegion(1),
  'prev-region': () => cycleRegion(-1),
  'toolbox-main': () => toolboxes.toggle('main'),
  'toolbox-structure': () => toolboxes.toggle('structure'),
  'toolbox-arrange': () => toolboxes.toggle('arrange'),
  'toolbox-templates': () => toolboxes.toggle('templates'),
  'toolbox-colours': () => toolboxes.toggle('colours'),
  'toolbox-highlight': () => toolboxes.toggle('highlight'),
  'toolbox-custom': () => toolboxes.toggle('custom'),
  // the panel taken out as a toolbox folds up to its title bar; at the right it folds to a strip
  'fold-side': () => foldSide(!sideIsFolded()),
  'customize-toolbox': () => openCustomToolbox(),
  'customize-ribbon': () => ribbonEditor.open(RIBBON_OF_MODE[ws.active.mode]),
  'export-settings': () => void exportSettings(),
  'import-settings': () => void importSettingsFile(),
  'reset-toolboxes': () => { toolboxes.reset(); flash('Toolboxes reset: Drawing Tools docked at the left, the others hidden, all open and locked.', 6000); },
  'lock-toolboxes': () => { toolboxes.setLocked(!toolboxState.locked); flash(toolboxState.locked ? 'Toolboxes locked.' : 'Toolboxes unlocked: drag one by its title to an edge of the drawing to dock it, or anywhere else to float.', 6000); },
  'add-frame': () => editor.addFrame() || flash('Select what to frame: structures, text, arrows or shapes.'),
  'fill-rings': () => flash(editor.fillRings(), 6000),
  'ring-shadow': () => {
    const r = editor.ringShadow();
    flash(!r ? 'Select filled rings (or their structure) first: Fill Rings fills them.' : r === 'on' ? 'Ring fills have a drop shadow. Change its size in the Style panel.' : 'Ring fill shadows off.', 5000);
  },
  'highlight': () => editor.highlight(highlightColour, highlightStyle) ? flash('Highlighted. Change the colour with Highlight in the Style panel.', 5000) : flash('Select the atoms and bonds to highlight.'),
  'remove-highlight': () => editor.highlight(undefined) || flash('Select the atoms and bonds to take the highlight off.'),
  'smooth-highlight': () => toggleHighlight('smooth', 'Round highlights smoothed: one even band, with no disc at each atom. Straight highlights are always one band.', 'Round highlights back to a disc at each atom.'),
  'centre-highlight': () => toggleHighlight('centre', 'Highlight centred between the lines of the double bonds (and inside rings drawn with their double bonds inside).', 'Highlight back on the bonds.'),
  'soft-highlight': () => toggleHighlight('soft', 'Soft edges on. Choose how much fades, and which way, under Soft edges in the Style panel.', 'Sharp edges.'),
  'shadow-highlight': () => toggleHighlight('shadow', 'Highlight shadow on. Change its colour, direction and blur under Shadow in the Style panel.', 'No highlight shadow.'),
  'glow-highlight': () => toggleHighlight('glow', 'Glow on. Change its colour and size under Glow in the Style panel.', 'No glow.'),
  'outline-highlight': () => toggleHighlight('outline', 'Outline only: no fill, a line round the highlight. Change the line under Outline in the Style panel.', 'Filled highlight.'),
  'highlight-look': () => void chooseHighlightLook(),
  'select-highlight': () => {
    // the highlight under the right-click, else those of the selection
    const all: Selection = { atoms: new Set(doc.atoms.keys()), bonds: new Set(doc.bonds.keys()), captions: new Set(), arrows: new Set(), shapes: new Set() };
    const parts = highlightParts(doc, all);
    const hit = parts.filter((p) => (contextBond !== null && p.sel.bonds.has(contextBond)) || [...editor.sel.atoms].some((id) => p.sel.atoms.has(id)) || [...editor.sel.bonds].some((id) => p.sel.bonds.has(id)));
    if (!hit.length) { flash('Right-click a highlight (or select part of one) first.'); return; }
    const sel: Selection = { atoms: new Set(hit.flatMap((p) => [...p.sel.atoms])), bonds: new Set(hit.flatMap((p) => [...p.sel.bonds])), captions: new Set(), arrows: new Set(), shapes: new Set() };
    if (animUi) animUi.selectHighlight(sel); else editor.selectThese(sel);
    if (ws.active.mode === 'slides') flash('Highlight selected: pick an effect in the Animations tab to animate it on its own.', 5000);
  },
  'save-highlight-look': () => void saveHighlightLook(),
  'delete-highlight-look': () => void deleteHighlightLook(),
  'clean-up': () => editor.cleanUp() || flash('Nothing to clean up: the structures are already tidy.'),
  'clean-up-arrow': () => {
    if (!pickedCurved()) { flash('Select one or more curved (mechanism) arrows first.'); return; }
    const n = editor.cleanUpArrows();
    flash(n ? `Tidied ${n} arrow${n === 1 ? '' : 's'}.` : 'The arrows are already as tidy as they can be.');
  },
  'arrow-s-shape': () => {
    if (!pickedCurved()) { flash('Select one or more curved (mechanism) arrows first.'); return; }
    if (!editor.setArrowS(true)) flash('The selected arrows are S-shaped already.');
  },
  'arrow-single-curve': () => {
    if (!pickedCurved()) { flash('Select one or more curved (mechanism) arrows first.'); return; }
    if (!editor.setArrowS(false)) flash('The selected arrows are single curves already.');
  },
  'flip-arrow-bend': () => { if (!editor.flipArrowBend()) flash('Select one or more curved (mechanism) arrows first.'); },
  'homolysis-arrows': () => {
    const n = editor.sel.bonds.size;
    if (!n) flash('Select the bond that breaks first (click it with the selection tool).');
    else if (n > 4) flash('Select just the bond (or bonds) that break: click one with the selection tool, Shift+click for more.', 5000);
    else editor.addHomolysisArrows();
  },
  'attach-arrow': () => {
    const n = editor.attachArrows();
    flash(n ? `${n === 1 ? 'It follows' : `${n} things follow`} the structure now.` : 'Select curved arrows whose ends sit on atoms, bonds or lone pairs (or lone pairs and charges) first.');
  },
  'detach-arrow': () => {
    const n = editor.detachSelection();
    flash(n ? `${n === 1 ? 'It stays' : `${n} things stay`} put when the structure moves now.` : 'Nothing selected is stuck to a structure.');
  },
  'orient-like': async () => {
    const n = await orientLikeFirst();
    if (n === null) flash('Select two or more structures. Each is turned to match the first one (top left), keeping its configuration.', 6000);
    else if (n === 0) flash('Nothing to turn: the structures already match the first one, or share too little with it.');
  },
  'clean-up-reaction-orient': async () => {
    await orientLikeFirst(true);
    if (!editor.cleanUpReaction()) flash('No reaction to tidy: draw starting materials, an arrow and products (the arrow pointing from one to the other), or the scheme is already tidy.', 6000);
  },
  'clean-up-reaction': () => editor.cleanUpReaction() || flash('No reaction to tidy: draw starting materials, an arrow and products (the arrow pointing from one to the other), or the scheme is already tidy.', 6000),
  'arrange-scheme': () => arrangeDialog.open(),
  'catalytic-cycle': () => void insertCycle(),
  'ts-brackets': () => { if (!editor.tsBrackets()) flash('Select the transition state first (draw it with partial bonds: P over a bond).'); },
  'energy-diagram': () => void energyDiagram(null),
  'insert-diagram': () => void smartDiagram(null),
  'edit-diagram': () => { const id = editor.selectedDiagram(); if (id === null) flash('Select a diagram first.'); else void smartDiagram(id); },
  'diagram-to-shapes': () => editor.ungroupSelectedDiagram() || flash('Select a diagram first.'),
  'edit-energy': () => { const id = editor.selectedEnergy(); if (id === null) flash('Select an energy diagram first.'); else void energyDiagram(id); },
  'animate-reaction': () => animateDialog.open(),
  'animate-step': () => {
    const arrow = pickedReactionArrow();
    if (arrow === undefined) { flash('Select a reaction arrow first, or use Animate Reaction for the whole scheme.'); return; }
    animateDialog.open({ arrow });
  },
  'number-compounds': () => void numberCompounds(),
  'scheme-settings': () => settingsWindow.open('schemes'),
  'attach-descriptors': () => void attachDescriptors(),
  'pubchem-lookup': () => void lookUpChosen(),
  'add-id-label': () => void addTiedText('label'),
  'lock-structures': () => toggleStructureLock(),
  'add-caption': () => void addTiedText('caption'),
  'link-text': () => linkText() || flash('Select the text to link (and the structure to link it to; else it goes to the nearest).'),
  'unlink-text': () => unlinkText() || flash('Select linked text, or a structure with text linked to it.'),
  group: () => editor.group() || flash('Select two or more things to group: structures, text, arrows or shapes.'),
  ungroup: () => editor.ungroup() || flash('Select a group to take apart.'),
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
// A submenu opens when pointed at, clicked or entered with the right arrow key, and sits on the
// screen beside its item (fixed, so a menu that scrolls doesn't cut it off).
const menus = [...document.querySelectorAll<HTMLDivElement>('header > .menu-wrap')].map((w) => ({
  btn: w.querySelector<HTMLButtonElement>(':scope > button')!,
  list: w.querySelector<HTMLDivElement>(':scope > .menu')!,
}));
type Menu = (typeof menus)[number];
let openMenu: Menu | null = null;
/** The items arrow keys move through in one menu or submenu: not hidden, not greyed out. */
const menuItems = (list: HTMLElement) =>
  [...list.querySelectorAll<HTMLButtonElement>(':scope > button, :scope > .submenu > button, :scope > .recent-files > button')]
    .filter((b) => !b.hidden && !b.disabled && b.getClientRects().length > 0);
function closeSubs(inside: HTMLElement): void {
  for (const sub of inside.querySelectorAll<HTMLElement>('.menu.sub')) {
    sub.hidden = true;
    sub.parentElement!.querySelector(':scope > button')!.setAttribute('aria-expanded', 'false');
  }
}
function openSub(item: HTMLButtonElement, focus: boolean): void {
  const list = item.parentElement!.parentElement as HTMLElement;
  closeSubs(list);
  const sub = item.nextElementSibling as HTMLElement;
  sub.hidden = false;
  item.setAttribute('aria-expanded', 'true');
  const r = item.getBoundingClientRect(), w = sub.offsetWidth, h = sub.offsetHeight;
  const left = r.right + w + 4 <= innerWidth ? r.right + 2 : Math.max(4, r.left - w - 2);
  sub.style.left = `${left}px`;
  sub.style.top = `${Math.max(4, Math.min(r.top - 5, innerHeight - h - 4))}px`;
  if (focus) menuItems(sub)[0]?.focus();
}
function showMenu(m: Menu | null, focus = true): void {
  openMenu = m;
  for (const x of menus) {
    if (x !== m) closeSubs(x.list);
    x.list.hidden = x !== m;
    x.btn.setAttribute('aria-expanded', String(x === m));
  }
  if (!m) return;
  refreshHistory();
  m.list.style.setProperty('--menu-top', `${m.btn.getBoundingClientRect().bottom}px`);
  if (focus) menuItems(m.list)[0]?.focus();
}
for (const m of menus) {
  m.btn.addEventListener('click', () => showMenu(openMenu === m ? null : m));
  m.btn.addEventListener('pointerenter', () => { if (openMenu && openMenu !== m) showMenu(m, false); });
  m.list.addEventListener('scroll', () => closeSubs(m.list));
  m.list.addEventListener('pointerover', (e) => {
    const item = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!item || item.disabled) return;
    if (item.classList.contains('has-sub')) { if (item.getAttribute('aria-expanded') !== 'true') openSub(item, false); }
    else closeSubs(item.parentElement!.closest('.menu')!);
  });
  m.list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!b || b.disabled) return;
    if (b.classList.contains('has-sub')) { openSub(b, false); return; }
    const recent = b.dataset.recent;
    if (recent !== undefined) { showMenu(null); void openRecent(recent); return; }
    const cmd = b.dataset.cmd;
    if (!cmd) return;
    showMenu(null);
    command(cmd);
  });
  m.list.addEventListener('keydown', (e) => {
    const here = (document.activeElement as HTMLElement | null)?.closest<HTMLElement>('.menu') ?? m.list;
    const items = menuItems(here);
    const now = document.activeElement as HTMLButtonElement;
    const i = items.indexOf(now);
    const j = menus.indexOf(m);
    const parentItem = here === m.list ? null : here.parentElement!.querySelector<HTMLButtonElement>(':scope > button');
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (parentItem) { closeSubs(parentItem.parentElement!.parentElement as HTMLElement); parentItem.focus(); }
      else { showMenu(null); m.btn.focus(); }
    }
    else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === 'ArrowRight' && now.classList.contains('has-sub')) { e.preventDefault(); openSub(now, true); }
    else if (e.key === 'ArrowLeft' && parentItem) {
      e.preventDefault();
      closeSubs(parentItem.parentElement!.parentElement as HTMLElement);
      parentItem.focus();
    }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      showMenu(menus[(j + (e.key === 'ArrowRight' ? 1 : -1) + menus.length) % menus.length]);
    }
  });
}
addEventListener('resize', () => { if (openMenu) showMenu(null); });

// ---------------------------------------------------------------- the keyboard round the window

// F10, or Alt pressed and let go on its own, goes to the menu bar (and back); there the arrow
// keys move along it and Down opens a menu. Alt with a menu's underlined letter opens that menu,
// as in Office. Ctrl+F6 moves on round the window's parts (the keys can be changed).
const MNEMONICS = new Map<string, Menu>();
for (const m of menus) {
  const letter = m.btn.getAttribute('aria-keyshortcuts')?.match(/^Alt\+(\w)$/)?.[1];
  if (letter) MNEMONICS.set(letter.toUpperCase(), m);
  m.btn.addEventListener('keydown', (e) => {
    const j = menus.indexOf(m);
    const go = (k: number) => { e.preventDefault(); const n = menus[(k + menus.length) % menus.length]; if (openMenu) showMenu(n); else n.btn.focus(); };
    if (e.key === 'ArrowRight') go(j + 1);
    else if (e.key === 'ArrowLeft') go(j - 1);
    else if (e.key === 'ArrowDown') { e.preventDefault(); showMenu(m); }
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(menus.length - 1);
    else if (e.key === 'Escape' && !openMenu) { e.preventDefault(); leaveMenuBar(); }
  });
}
/** Where the keys were before going to the menu bar, to go back to. */
let beforeMenus: HTMLElement | null = null;
function enterMenuBar(): void {
  const a = document.activeElement as HTMLElement | null;
  if (!a?.closest('header')) beforeMenus = a;
  menus[0].btn.focus();
}
function leaveMenuBar(): void {
  showMenu(null);
  document.body.classList.remove('show-mnemonics');
  if (beforeMenus?.isConnected && beforeMenus !== document.body) beforeMenus.focus();
  else focusWork();
  beforeMenus = null;
}
const inMenuBar = () => !!(document.activeElement as HTMLElement | null)?.closest('header > .menu-wrap');

/** The keys to the drawing, sheet or document showing. */
function focusWork(): void {
  if (sheetActive()) sheetMode.focus();
  else if (docActive()) docMode.focus();
  else $('#overlay').focus();
}

/**
 * The parts of the window that Ctrl+F6 goes round, in order: each finds what takes the keys in
 * it (null when that part isn't showing).
 */
const REGIONS: { inside: string; first: () => HTMLElement | null }[] = [
  { inside: 'header', first: () => menus[0].btn },
  { inside: '#tabs', first: () => $('#tabs').querySelector<HTMLElement>('[aria-selected="true"]') ?? $('#tabs').querySelector<HTMLElement>('[role="tab"], button') },
  { inside: '.ribbon', first: () => [...document.querySelectorAll<HTMLElement>('.ribbon')].find(onScreenEl)?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"], button:not([disabled])') ?? null },
  { inside: '#tools', first: () => onScreenEl($('#tools')) ? $('#tools').querySelector<HTMLElement>('button.tool.active') ?? $('#tools').querySelector<HTMLElement>('button.tool') : null },
  { inside: '#work', first: () => { focusWork(); return document.activeElement as HTMLElement; } },
  { inside: '#side-content', first: () => onScreenEl($('#side-content')) ? [...$('#side-content').querySelectorAll<HTMLElement>('button:not([disabled]), input, select, [tabindex="0"]')].find(onScreenEl) ?? null : null },
];
function onScreenEl(el: Element): boolean { return el.getClientRects().length > 0; }

/** Move the keys to the next (or previous) part of the window. */
function cycleRegion(step: 1 | -1): void {
  showMenu(null);
  const a = document.activeElement as HTMLElement | null;
  let at = a ? REGIONS.findIndex((r) => a.closest(r.inside)) : -1;
  if (at < 0) at = step > 0 ? -1 : REGIONS.length;
  for (let k = 1; k <= REGIONS.length; k++) {
    const r = REGIONS[(at + step * k + REGIONS.length * 2) % REGIONS.length];
    const el = r.first();
    if (!el || !onScreenEl(el)) continue;
    if (document.activeElement !== el) el.focus();
    if (document.activeElement === el || el.contains(document.activeElement)) return;
  }
}

let altAlone = false;
window.addEventListener('keydown', (e) => {
  if (e.key === 'Alt') { altAlone = !e.repeat && !e.ctrlKey && !e.metaKey && !e.shiftKey; if (altAlone) document.body.classList.add('show-mnemonics'); return; }
  altAlone = false;
  // Ctrl+F6 works from anywhere, a text box too
  const chord = chordOf(e);
  const step = chord && !(e.target as HTMLElement | null)?.closest?.('dialog')
    ? keymap.keysFor('command', 'command next-region').includes(chord) ? 1 : keymap.keysFor('command', 'command prev-region').includes(chord) ? -1 : 0 : 0;
  if (step) { e.preventDefault(); e.stopImmediatePropagation(); cycleRegion(step); return; }
  if (isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.('dialog')) return;
  if (e.key === 'F10' && !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey) {
    e.preventDefault();
    if (inMenuBar() || openMenu) leaveMenuBar();
    else { document.body.classList.add('show-mnemonics'); enterMenuBar(); }
    return;
  }
  // Alt and a menu's letter (by the key's place, so it works whatever the keyboard writes)
  if (e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && /^Key[A-Z]$/.test(e.code)) {
    const m = MNEMONICS.get(e.code.slice(3));
    if (m) { e.preventDefault(); e.stopImmediatePropagation(); if (!inMenuBar()) beforeMenus = document.activeElement as HTMLElement | null; showMenu(m); }
  }
}, true);
window.addEventListener('keyup', (e) => {
  if (e.key !== 'Alt') return;
  const alone = altAlone;
  altAlone = false;
  if (!alone) { if (!inMenuBar()) document.body.classList.remove('show-mnemonics'); return; }
  if (isTyping(e.target) || (e.target as HTMLElement | null)?.closest?.('dialog')) { document.body.classList.remove('show-mnemonics'); return; }
  e.preventDefault();
  if (inMenuBar() || openMenu) leaveMenuBar();
  else enterMenuBar();
});
window.addEventListener('pointerdown', () => { altAlone = false; }, true);
window.addEventListener('blur', () => { altAlone = false; document.body.classList.remove('show-mnemonics'); });
document.addEventListener('focusin', () => { if (!inMenuBar() && !openMenu) document.body.classList.remove('show-mnemonics'); });

/** The mode the menus serve: drawing a structure for a cell or a document counts as Drawing. */
function menuMode(): string { return drawingOnTop() ? 'drawing' : ws.active.mode; }

/**
 * Every mode has the same menus; an item that only works in some modes (data-modes, or the
 * data-item-modes of its menu) is greyed out in the others, so the menus never change shape.
 */
function tickMenuModes(): void {
  const mode = menuMode();
  for (const el of document.querySelectorAll<HTMLElement>('header .menu > button, header .menu > .submenu, header .menu.sub > button')) {
    const modes = el.dataset.modes ?? el.closest<HTMLElement>('[data-item-modes]')?.dataset.itemModes;
    if (!modes) continue;
    const on = modes.split(' ').includes(mode);
    const b = el instanceof HTMLButtonElement ? el : el.querySelector<HTMLButtonElement>(':scope > button');
    if (b) b.disabled = !on;
  }
}
tickMenuModes();
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
  $('#split-insert').textContent = st.main.mode === 'document' ? 'Insert into Document' : st.main.mode === 'sheet' ? 'Insert into Cell' : st.main.mode === 'design' ? 'Insert into Design' : 'Insert into Slide';
  // while a figure's or cell's structure is drawn, Done puts that in; the drawing beside waits
  $<HTMLButtonElement>('#split-insert').disabled = !!cellEdit;
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
  if (!st || !st.main.deck) return;
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
    flash('Split view puts a drawing beside a document, sheet, slides or design: show one of those (or start one with the + tabs) and choose View > Split View there.', 8000);
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
  flash(`${drawing.name} is beside the ${t.mode === 'document' ? 'document' : t.mode === 'sheet' ? 'sheet' : t.mode === 'design' ? 'design' : 'slides'}. Click a side to work on it; the bar above the drawing picks another drawing and puts structures in.`, 7000);
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
  if (!st || cellEdit) return;
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

/** The colour Chemistry > Highlight and Fill > Highlight uses: the one last chosen in the Style panel (a soft yellow at first). */
let highlightColour = '#ffe680';
/** The look new highlights take: the one last chosen in the Style panel. */
let highlightStyle: HighlightStyle | undefined;
/** Your own saved highlight looks (the ready-made ones are BUILT_IN_LOOKS). */
let ownLooks: HighlightLookPreset[] = [];

/** Turn a highlight setting on or off for the selected highlights; new highlights take the same look. */
function toggleHighlight(key: HighlightToggle, on: string, off: string): void {
  const r = editor.toggleHighlight(key);
  if (!r) { flash('Select highlighted atoms and bonds first.'); return; }
  const sel = [...editor.sel.atoms].map((id) => doc.atoms.get(id)?.hl).concat([...editor.sel.bonds].map((id) => doc.bonds.get(id)?.hl));
  highlightStyle = tidyStyle({ ...highlightStyle, ...(sel.find(Boolean) ?? {}) });
  flash(r === 'on' ? on : off, 6000);
}

/** Every highlight look: the ready-made ones, then your own. */
const allLooks = (): HighlightLookPreset[] => [...BUILT_IN_LOOKS, ...ownLooks];

/** Give the selection a look (the selected highlights keep their colour unless the look has its own). */
function applyHighlightLook(look: HighlightLookPreset): void {
  // nothing highlighted in the selection yet: highlight it in the last colour used
  const any = [...editor.sel.atoms].some((id) => doc.atoms.get(id)?.highlight) || [...editor.sel.bonds].some((id) => doc.bonds.get(id)?.highlight);
  if (!editor.highlightLook(look.colour ?? (any ? undefined : highlightColour), look.style)) { flash('Select the atoms and bonds to give the look to.'); return; }
  highlightStyle = tidyStyle(look.style);
  if (look.colour) highlightColour = look.colour;
}

/** Chemistry > Highlight and Fill > Highlight Look…: pick a look for the selection. */
async function chooseHighlightLook(): Promise<void> {
  const looks = allLooks();
  const got = await ask('Highlight look', [
    { name: 'look', label: 'Look', value: '0', options: looks.map((l, i) => ({ value: String(i), label: i >= BUILT_IN_LOOKS.length ? `${l.name} (yours)` : l.name })) },
  ], { ok: 'Use', note: 'The ready-made looks keep the highlight\'s colour; your own looks have their colour too. Save the look of a highlight you have set up with Chemistry > Highlight and Fill > Save Highlight Look.' });
  const look = got && looks[Number(got.look)];
  if (look) applyHighlightLook(look);
}

/** The colour and look of the first highlighted atom or bond selected. */
function selectedHighlight(): { colour: string; style: HighlightStyle } | null {
  for (const id of editor.sel.bonds) { const b = doc.bonds.get(id); if (b?.highlight) return { colour: b.highlight, style: b.hl ?? {} }; }
  for (const id of editor.sel.atoms) { const a = doc.atoms.get(id); if (a?.highlight) return { colour: a.highlight, style: a.hl ?? {} }; }
  return null;
}

/** Chemistry > Highlight and Fill > Save Highlight Look…: keep the selected highlight's look under a name. */
async function saveHighlightLook(): Promise<void> {
  const h = selectedHighlight();
  if (!h) { flash('Select a highlight that looks the way you want first.'); return; }
  const got = await ask('Save highlight look', [
    { name: 'name', label: 'Name', value: '', placeholder: 'for example Reacting bonds' },
    { name: 'colour', label: 'Keep its colour too', value: 'true', type: 'checkbox' },
  ], { ok: 'Save', note: 'It is offered in Chemistry > Highlight and Fill > Highlight Look, in the Style panel and in the Highlight toolbox, in every drawing.' });
  const name = got?.name.trim();
  if (!got || !name) return;
  const look: HighlightLookPreset = { name, ...(got.colour === 'true' ? { colour: h.colour } : {}), style: tidyStyle(h.style) ?? {} };
  ownLooks = [...ownLooks.filter((l) => l.name !== name), look];
  storeSettings();
  looksChanged();
  flash(`Saved the look “${name}”.`);
}

/** Chemistry > Highlight and Fill > Delete Highlight Look…: forget one of your own looks. */
async function deleteHighlightLook(): Promise<void> {
  if (!ownLooks.length) { flash('You have no saved highlight looks yet (Chemistry > Highlight and Fill > Save Highlight Look).'); return; }
  const got = await ask('Delete highlight look', [{ name: 'look', label: 'Look', value: ownLooks[0].name, options: ownLooks.map((l) => ({ value: l.name, label: l.name })) }], { ok: 'Delete' });
  if (!got) return;
  ownLooks = ownLooks.filter((l) => l.name !== got.look);
  storeSettings();
  looksChanged();
}

/** Show the saved looks again wherever they are offered. */
function looksChanged(): void {
  if (toolboxState.places.highlight?.shown || toolboxState.places.colours?.shown) toolboxes.render();
  stylePanel.refresh(true);
}

/** Tick the chosen way of writing terminal methyls in the Chemistry menu. */
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

/** Ask before a command with nothing selected changes every structure on the page (Edit > Settings). */
let askWholeDrawing = true;
/** Where linked text goes (Edit > Settings). */
let linkSide: Settings['linkSide'] = 'keep';

/**
 * Show Terminal Methyls: on the selection, or with nothing selected on every structure, after
 * asking when there are several (some may be meant one way and some the other).
 */
async function toggleTerminalMethyls(): Promise<void> {
  const doc = editor.doc;
  if (!editor.sel.atoms.size && askWholeDrawing && doc.fragments().length > 1) {
    const r = await ask('Every structure on the page?', [
      { name: 'again', label: 'Don\u2019t ask again (Edit > Settings)', type: 'checkbox', value: 'false' },
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
/** Characters typed from Insert > Symbol lately, newest first (saved in the settings). */
let recentSymbols: string[] = [];
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

// Newer versions of the desktop app (File > Check for Updates…, Edit > Settings)
let updateCheck = true;
let updateChannel: UpdateChannel = 'latest';
let skipVersion: string | null = null;
const updates = new UpdateUI({
  unsaved: () => ws.tabs.filter((t) => t.dirty).map((t) => t.name),
  skipped: () => skipVersion,
  skip: (v) => { skipVersion = v; storeSettings(); },
  channel: () => updateChannel,
});
for (const el of document.querySelectorAll<HTMLElement>('.desktop-only')) el.hidden = !canUpdate;
let versionText = canUpdate ? '' : 'Web version';
void Promise.all([appVersion(), portableInfo()]).then(([v, portable]) => {
  versionText = canUpdate ? `Version ${v} ${STAGE.toLowerCase()}${portable ? ' (portable)' : ''}` : `Web version (${STAGE.toLowerCase()})`;
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

// ---------------------------------------------------------------- opening files from outside

const platform = !isTauri() ? 'web' as const : /Windows/.test(navigator.userAgent) ? 'windows' as const : isMac ? 'mac' as const : 'linux' as const;
const fileTypesHost = {
  platform,
  get: () => invoke<string[]>('file_types_get'),
  set: (types: string[]) => invoke<void>('file_types_set', { types }),
  openDefaults: () => invoke<void>('file_types_defaults'),
  objects: {
    get: () => invoke<boolean>('ole_registered'),
    set: async (on: boolean) => { await invoke<void>('ole_register', { on }); setWordObjects(on); },
  },
  flash: (msg: string) => flash(msg, 7000),
};
let fileTypesOffered = false;
let wordObjectsOffered = false;

/** A drawing Word, PowerPoint or Excel asked to edit here (src-tauri/src/ole.rs). */
interface EmbeddedEdit { id: number; cdxml: string; app: string; doc: string }
/** Tabs editing drawings for other programs, by tab (a Save As to a file still ends the editing when the tab closes). */
const embeddedTabs = new Map<Tab, number>();
const embeddedTab = (id: number): Tab | undefined => [...embeddedTabs].find(([, i]) => i === id)?.[0];

async function openEmbedded(e: EmbeddedEdit): Promise<void> {
  const ref = { kind: 'embedded' as const, id: e.id, app: e.app, doc: e.doc };
  const from = e.doc || e.app || 'another program';
  const name = `Drawing in ${from}`;
  let t: Tab | null;
  if (e.cdxml.trim()) t = await ws.openAs(new TextEncoder().encode(e.cdxml), 'drawing.cdxml', { name, ref, dirty: false, stamp: null });
  else {
    // a new drawing (Insert ▸ Object in Word)
    t = ws.newDrawing();
    t.ref = ref;
    t.name = name;
    renderTabs();
  }
  if (!t) { void invoke('ole_close', { id: e.id }).catch(() => {}); return; }
  embeddedTabs.set(t, e.id);
  flash(`Editing the drawing from ${from}. Save (Ctrl+S) puts it back there; close this tab when you're done.`, 9000);
}

/**
 * Windows: drawings in Word, PowerPoint and Excel that open here when double-clicked. The first
 * time the app starts it registers them (a portable copy leaves the computer alone); after that it
 * keeps the registration pointing at this copy of the app. Settings ▸ File Types turns it off.
 */
async function startWordObjects(): Promise<void> {
  if (platform !== 'windows') return;
  const { listen } = await import('@tauri-apps/api/event');
  setEmbeddedWriter(async (ref, cdxml) => {
    const block = packFormats([['CDXML', new TextEncoder().encode(cdxml)], ['EMF', embeddedPicture(readCdxml(cdxml).doc, cdxml)]]);
    await invoke('ole_save', block, { headers: { 'ole-id': String(ref.id) } });
  });
  await listen<EmbeddedEdit>('ole-edit', (e) => void openEmbedded(e.payload));
  await listen<number>('ole-show', (e) => { const t = embeddedTab(e.payload); if (t) ws.activate(t); });
  // the document was closed in Word: the drawing stays here as an unsaved drawing
  await listen<number>('ole-closed', (e) => {
    const t = embeddedTab(e.payload);
    if (!t) return;
    embeddedTabs.delete(t);
    if (t.ref.kind === 'embedded') {
      flash(`${t.ref.doc || t.ref.app} was closed, so this drawing can't go back into it. It stays here; save it as a file to keep it.`, 9000);
      t.ref = { kind: 'none' };
      t.name = withExtension(t.name, 'cdxml');
      renderTabs();
    }
  });
  for (const e of await invoke<EmbeddedEdit[]>('ole_pending').catch(() => [])) await openEmbedded(e);
  let on = await invoke<boolean>('ole_registered').catch(() => false);
  if (on) await invoke('ole_register', { on: true }).catch(() => {});
  else if (!wordObjectsOffered && !(await portableInfo())) {
    on = await invoke('ole_register', { on: true }).then(() => true, () => false);
  }
  if (!wordObjectsOffered) { wordObjectsOffered = true; storeSettings(); }
  setWordObjects(on);
}

/** The files the desktop app was opened with (double-clicked, or Open with), and any opened while it runs. */
async function openOutsideFiles(): Promise<void> {
  if (!isTauri()) return;
  const { listen } = await import('@tauri-apps/api/event');
  // listening first, so no file is missed between asking and listening
  await listen<string[]>('open-files', (e) => { for (const p of e.payload) void openRecent(p); });
  for (const p of await invoke<string[]>('launch_files').catch(() => [])) await openRecent(p);
  // the first time the Windows app starts, it joins the chemistry files' "Open with" lists
  // (never the default: Settings ▸ File Types explains how); a portable copy leaves the computer alone
  if (platform === 'windows' && !fileTypesOffered && !(await portableInfo())) {
    fileTypesOffered = true;
    const now = await fileTypesHost.get().catch(() => [] as string[]);
    await fileTypesHost.set([...new Set([...now, ...FILE_TYPES.filter((t) => t.chemistry).map((t) => t.ext)])]).catch(() => {});
    storeSettings();
  }
}

/** Settings ▸ Drawing: how structures are written and drawn, set once rather than per structure. */
async function drawingPreferences(): Promise<void> {
  const r = await ask('Drawing', [
    { name: 'methyl', label: 'Terminal methyls written as', value: editor.options.methylStyle, options: [{ value: 'Me', label: 'Me' }, { value: 'CH3', label: 'CH3' }],
      help: 'Show Terminal Methyls writes them this way; methyls already written out in the selection (or the whole drawing, with nothing selected) change too.' },
    { name: 'axial', label: 'Axial chirality written as', value: axialStyle.helicity ? 'PM' : 'RaSa', options: [{ value: 'RaSa', label: 'Ra / Sa' }, { value: 'PM', label: 'P / M (helicity)' }],
      help: 'Labels on biaryls and allenes follow the choice at once. Ra is the same as M, and Sa as P.' },
    { name: 'charges', label: 'Charges from the + and − keys', value: editor.options.circledCharges ? 'circled' : 'plain', options: [{ value: 'plain', label: 'Plain sign (N+)' }, { value: 'circled', label: 'In a circle (⊕, ⊖)' }],
      help: 'Charges already drawn keep their look; the circle tools on the Object toolbox always draw a circled charge.' },
    { name: 'textAtom', label: 'An atom or group typed with the Text tool beside a bond end (Br, OMe) becomes that atom', type: 'checkbox', value: String(editor.options.textToAtom) },
    { name: 'supR', label: 'R groups numbered R1, R12… show the number raised (R¹, R¹²)', type: 'checkbox', value: String(labelPrefs.superscriptR),
      help: 'Longer labels (OR1, CO2R1) and labels from files are left as they are.' },
    { name: 'reroute', label: 'Mechanism arrows find their own way round again when a change leaves them running into a structure, a label or another arrow', type: 'checkbox', value: String(editor.options.rerouteArrows),
      help: 'Arrows you bent by hand stay as they are.' },
  ], { ok: 'Save' });
  if (!r) return;
  editor.options.circledCharges = r.charges === 'circled';
  editor.options.textToAtom = r.textAtom === 'true';
  editor.options.rerouteArrows = r.reroute === 'true';
  if (labelPrefs.superscriptR !== (r.supR === 'true')) {
    labelPrefs.superscriptR = r.supR === 'true';
    doc.allDirty = true;
    editor.requestScene();
  }
  showHelicity(r.axial === 'PM');
  if (r.methyl !== editor.options.methylStyle) chooseMethylStyle(r.methyl as MethylStyle);
  else storeSettings();
}

/** Settings ▸ General: selecting, groups, linked text, and your name on tracked changes. */
async function generalPreferences(): Promise<void> {
  const r = await ask('General', [
    { name: 'groupClick', label: 'Clicking something in a group selects', value: editor.options.groupClick, options: [{ value: 'group', label: 'The whole group' }, { value: 'item', label: 'Just that thing' }] },
    { name: 'groupOutline', label: 'Outline the rest of a group when part of it is selected', type: 'checkbox', value: String(editor.options.groupOutline) },
    { name: 'linkSide', label: 'Text linked to a structure goes', value: linkSide, options: [{ value: 'keep', label: 'Where it is' }, { value: 'below', label: 'Below' }, { value: 'above', label: 'Above' }, { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' }] },
    { name: 'ask', label: 'Ask before changing every structure on the page when nothing is selected', type: 'checkbox', value: String(askWholeDrawing) },
    { name: 'reviewer', label: 'Your name on tracked changes in documents', value: reviewAuthor() },
  ], { ok: 'Save' });
  if (!r) return;
  editor.options.groupClick = r.groupClick === 'item' ? 'item' : 'group';
  editor.options.groupOutline = r.groupOutline === 'true';
  linkSide = (['below', 'above', 'left', 'right'].includes(r.linkSide) ? r.linkSide : 'keep') as Settings['linkSide'];
  askWholeDrawing = r.ask === 'true';
  setReviewAuthor(r.reviewer ?? '');
  storeSettings();
}

/** Settings ▸ Online: what the program asks the internet for. */
async function onlinePreferences(): Promise<void> {
  const r = await ask('Online', [
    { name: 'pubchem', label: 'Look up names the name reader can\'t read on PubChem', type: 'checkbox', value: String(pubchemNames),
      help: 'Sends the name typed to PubChem, a free NIH database. Names the program can read itself never leave this computer.' },
    ...(canUpdate ? [{ name: 'updates', label: 'Check for a newer version when the app starts', type: 'checkbox' as const, value: String(updateCheck),
      help: 'Asks GitHub for the latest release number; nothing about you or your files is sent.' },
    { name: 'channel', label: 'Updates', options: UPDATE_CHANNELS, value: updateChannel,
      help: 'Stable versions have been tried out on a real computer before they are offered, so they change less often and have fewer surprises. Latest gets every new feature and fix the day it is made.' }] : []),
  ], { ok: 'Save' });
  if (!r) return;
  pubchemNames = r.pubchem === 'true';
  if (canUpdate) {
    // turning the check back on also forgets a skipped version
    if (r.updates === 'true' && !updateCheck) skipVersion = null;
    updateCheck = r.updates === 'true';
    // the other channel's versions are new to you: forget a skipped one
    if ((r.channel === 'stable' || r.channel === 'latest') && r.channel !== updateChannel) { updateChannel = r.channel; skipVersion = null; }
  }
  storeSettings();
}

let settingsLoaded = false;
// your palettes show in every colour box, in every mode
usePaletteMenus();
useDrawingColours(() => usedColours(editor.doc));
onPalettes(() => storeSettings());
/** Save the key map and preferences (after the saved ones have been read, so they aren't lost). */
function storeSettings(): void {
  if (!settingsLoaded) return;
  saveSettings(currentSettings(), (msg) => flash(msg, 10000));
}

/** Every setting as it is now. */
function currentSettings(): Settings {
  return {
    hotkeys: keymap.overrides(),
    keepHotspotOnBond: editor.options.keepHotspotOnBond,
    fixedLength: editor.options.fixedLength,
    fixedAngles: editor.options.fixedAngles,
    devTools,
    showRoles: editor.showRoles,
    scrollBars: scrollbars.shown,
    titleBar: titleBarPlace(),
    ribbonCollapsed: ribbonCollapsed(),
    textBar: CaptionEditor.barPlace,
    page: defaultPage,
    welcomed,
    groupTips: labelTips.enabled,
    chemTyping: typingPrefs.chemistry,
    stereoItalic: typingPrefs.stereoItalic,
    boldNumbers: typingPrefs.boldNumbers,
    autoLinks: typingPrefs.links,
    linkCtrlClick: typingPrefs.linkCtrlClick,
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
    textToAtom: editor.options.textToAtom,
    groupClick: editor.options.groupClick,
    groupOutline: editor.options.groupOutline,
    rerouteArrows: editor.options.rerouteArrows,
    superscriptR: labelPrefs.superscriptR,
    linkSide,
    slideTemplate,
    slideThemes,
    askWholeDrawing,
    palettes: getPalettes(),
    toolboxes: toolboxState,
    ribbons: ribbonPrefs,
    myStyles: ownStyles,
    modeStyles,
    darkPage: dark.on,
    darkPalette: dark.palette,
    darkPalettes: dark.own,
    guides: { ...guidesOn },
    orient: { ...orientPrefs },
    docPins: [...docBoxPrefs.pinned],
    docRuler: docRulerPrefs.shown,
    sheetFormulaBar: formulaBarPrefs.shown,
    slideRuler: slideLook.ruler,
    slideGrid: slideLook.grid,
    rulerUnits: rulerPrefs.units,
    rulerFrom: rulerPrefs.from,
    updateCheck,
    updateChannel,
    pubchemNames,
    fileTypesOffered,
    wordObjectsOffered,
    reviewName: reviewAuthor(),
    skipVersion,
    recentFiles,
    recentSymbols,
    scheme: { ...schemePrefs },
    keep: keepPrefs,
    highlightLooks: ownLooks,
    quickParts: docQuickParts,
    docDesign: newDocDesign(),
  };
}

// ---------------------------------------------------------------- Edit > Export Settings and Import Settings

/** Save every setting in one file, to keep or to use on another computer. */
async function exportSettings(say: (text: string) => void = flash): Promise<void> {
  const target = await saveFileDialog('Chem Illustrator settings.json', SETTINGS_FILE).catch((e) => { say(String(e)); return null; });
  if (!target) return;
  await writeFile(target.ref, target.name, exportText(currentSettings()), SETTINGS_FILE).then(
    () => say(`Saved every setting in ${target.name}. Import it on another computer (Edit > Import Settings) to set that one up the same.`),
    (e) => say(`Could not save the settings: ${e}`),
  );
}

/** Use the settings saved in a file with Export Settings (or the keys from a hotkeys file). */
async function importSettingsFile(say: (text: string) => void = flash): Promise<void> {
  const got = await openFileDialog([SETTINGS_FILE]).catch((e) => { say(String(e)); return null; });
  if (!got) return;
  const read = importSettings(got.text, currentSettings());
  if (!read) { say(`${got.name} isn't a Chem Illustrator settings file (use one saved with Export Settings).`); return; }
  applySettings(read.settings);
  storeSettings();
  say(read.only === 'hotkeys' ? `Using the keys from ${got.name}.` : `Using the settings from ${got.name}: keys, toolboxes, preferences, templates, nicknames, styles and palettes. Your recent files stay as they were.`);
}

/** Settings > Import and Export: both, with a word on what goes in the file. */
function settingsTransfer(): void {
  const d = document.createElement('dialog');
  d.className = 'ask settings-transfer';
  d.innerHTML = `<h2>Import and Export Settings</h2>
    <p class="muted">One file holds every setting: hotkeys, toolboxes (and what is in them), preferences, your templates, nicknames, drawing styles, colour palettes, slide themes and highlight looks. Export it to keep a copy, or to set up another computer or a new install the same way; Import uses one. Recent files stay on each computer.</p>
    <div class="ask-buttons"><button type="button" data-act="export">Export Settings…</button><button type="button" data-act="import">Import Settings…</button><button type="button" class="primary" data-act="close">Close</button></div>
    <p class="muted small" aria-live="polite"></p>`;
  const say = (t: string) => { d.querySelector('p.small')!.textContent = t; };
  d.querySelector('[data-act=export]')!.addEventListener('click', () => void exportSettings(say));
  d.querySelector('[data-act=import]')!.addEventListener('click', () => void importSettingsFile(say));
  d.querySelector('[data-act=close]')!.addEventListener('click', () => d.close());
  d.addEventListener('close', () => d.remove());
  showDialog(d);
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
  refreshHistory();
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

/** Use these settings: at start, and when settings are imported (Edit > Import Settings). */
function applySettings(s: Settings): void {
  editor.options.keepHotspotOnBond = s.keepHotspotOnBond;
  editor.options.fixedLength = s.fixedLength;
  editor.options.fixedAngles = s.fixedAngles;
  editor.showRoles = s.showRoles;
  setSchemePrefs(s.scheme);
  $('[data-cmd="show-roles"]')?.setAttribute('aria-checked', String(s.showRoles));
  showDevTools(s.devTools);
  showScrollBars(s.scrollBars);
  setOrient(s.orient, false);
  void placeTitleBar(s.titleBar);
  setRibbonCollapsed(s.ribbonCollapsed);
  defaultPage = s.page;
  welcomed = s.welcomed;
  // the drawing open at start (empty and never saved) takes the default page
  if (!doc.page && !doc.source && !doc.atoms.size && !deckNow()) doc.page = defaultPage && { ...defaultPage };
  placeTextBar(s.textBar);
  showGroupTips(s.groupTips);
  modeColours = s.modeColours;
  applyModeColours(ws.active.mode, modeColours);
  keymap.setOverrides(s.hotkeys);
  setTypingPrefs({ chemistry: s.chemTyping, stereoItalic: s.stereoItalic, boldNumbers: s.boldNumbers, links: s.autoLinks, linkCtrlClick: s.linkCtrlClick, spelling: s.spellCheck, replacements: s.replacements, dictionary: s.dictionary });
  ownNicknames = s.nicknames;
  addNicknames(ownNicknames);
  useOwnTemplates(s.templates);
  splitWidth = s.splitWidth;
  applySplitWidth();
  setPreferredStyle(s.citeStyle, s.citeOptions);
  editor.options.methylStyle = s.methylStyle;
  showHelicity(s.axialStyle === 'PM');
  editor.options.circledCharges = s.circledCharges;
  editor.options.textToAtom = s.textToAtom;
  editor.options.groupClick = s.groupClick;
  editor.options.groupOutline = s.groupOutline;
  editor.options.rerouteArrows = s.rerouteArrows;
  labelPrefs.superscriptR = s.superscriptR;
  linkSide = s.linkSide;
  slideTemplate = s.slideTemplate;
  slideThemes = s.slideThemes;
  askWholeDrawing = s.askWholeDrawing;
  updateCheck = s.updateCheck;
  updateChannel = s.updateChannel;
  pubchemNames = s.pubchemNames;
  fileTypesOffered = s.fileTypesOffered;
  wordObjectsOffered = s.wordObjectsOffered;
  setReviewAuthor(s.reviewName);
  docQuickParts = s.quickParts;
  setNewDocDesign(s.docDesign);
  skipVersion = s.skipVersion;
  recentFiles = s.recentFiles;
  recentSymbols = s.recentSymbols;
  keepPrefs = s.keep;
  tickAutoSave();
  ownLooks = s.highlightLooks;
  renderRecent();
  setPalettes(s.palettes);
  toolboxState = s.toolboxes;
  ribbonPrefs = s.ribbons;
  applyRibbons();
  ownStyles = s.myStyles;
  modeStyles = s.modeStyles;
  dark.palette = s.darkPalette;
  dark.own = s.darkPalettes;
  showDark(s.darkPage);
  Object.assign(guidesOn, s.guides);
  docBoxPrefs.pinned = parseDocPins(s.docPins);
  docRulerPrefs.shown = !!s.docRuler;
  formulaBarPrefs.shown = s.sheetFormulaBar !== false;
  sheetMode.showFormulaBar();
  slideLook.ruler = !!s.slideRuler;
  slideLook.grid = !!s.slideGrid;
  rulerPrefs.units = s.rulerUnits;
  rulerPrefs.from = s.rulerFrom;
  docMode.showRuler();
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
  refreshKeys();
}

void loadSettings().then((s) => {
  applySettings(s);
  settingsLoaded = true;
  void keeper.start();
  void openOutsideFiles();
  void startWordObjects();
  // (a moment after starting, once a file opened with the app has had time to load)
  setTimeout(showWelcome, 800);
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
editor.say = (msg) => flash(msg, 6000);
editor.onNickname = (atomId) => nicknames.open((name) => editor.runAction(`label ${name}`, { kind: 'atom', id: atomId }));
// / or ? on an atom or bond: select it and show its settings in the Style panel
editor.onProperties = () => {
  // after the panel has caught up with the new selection
  setTimeout(() => {
    const sec = $('#style-section');
    if (sec.hidden || sec.classList.contains('empty')) return;
    sec.scrollIntoView({ block: 'nearest' });
    sec.querySelector<HTMLElement>('input, select, button')?.focus();
  }, 60);
};

// Unsaved work: ask before the window closes.
if (isTauri()) {
  getCurrentWindow().onCloseRequested(async (e) => {
    finishTyping();
    if (!(await ws.closeAll())) e.preventDefault();
    // closing normally: the recovery copies and lock files aren't needed
    else await keeper.end();
  }).catch(() => {});
} else {
  window.addEventListener('beforeunload', (e) => {
    finishTyping();
    if (ws.anyDirty) e.preventDefault();
    // with nothing unsaved the copies can go; otherwise they stay, in case the page is left
    else void keeper.end();
  });
}

/** For the speed tests: a ChemDraw file's text into the drawing showing, timed. */
function openText(text: string, name: string): ReadStats | null {
  const t0 = performance.now();
  try {
    const { doc: loaded, stats } = readCdxml(text);
    doc.loadFrom(loaded, true);
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

/** Chemistry > Look Up > Look Up on PubChem (and the right-click menu): the structure picked, shown in the Analysis panel. */
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
 * Chemistry > Attach Descriptors (and the Analysis panel's button): the formula and masses under
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

/** The R groups (R1, R2, X, Ar…) written in a structure's labels, alone or inside longer ones (OR1). */
function rGroupNames(ids: Set<number>): string[] {
  const out = new Set<string>();
  for (const id of ids) {
    const a = doc.atoms.get(id);
    if (a?.label) for (const t of tokenizeLabel(a.label)) if (t.kind === 'generic') out.add(t.text);
  }
  return [...out].sort((p, q) => p.localeCompare(q, undefined, { numeric: true }));
}

let saidSelection = '';
/** Tell screen readers what is selected: "Selected C6H5Br, 7 atoms". */
function saySelection(results: FragmentResult[]): void {
  const n = editor.sel.atoms.size;
  const key = n ? [...editor.sel.atoms].sort((a, b) => a - b).join(',') + ':' + doc.version : '';
  if (key === saidSelection) return;
  saidSelection = key;
  if (!n) return;
  const formulas = results.filter((r) => !r.error && r.formula).map((r) => r.formula);
  $('#sr-say').textContent = `Selected ${formulas.length ? formulas.join(', ') + ', ' : ''}${n} atom${n === 1 ? '' : 's'}`;
}

let analysisHadSel = false, clearedAt = -1;
async function runAnalysis(force: boolean): Promise<void> {
  if (!chem.ready) return;
  // Analyse the selected structures, or else the one last drawn on.
  let roots: number[] = [];
  // clearing the selection clears the panel, until something is drawn again
  if (editor.sel.atoms.size) analysisHadSel = true;
  else if (analysisHadSel) { analysisHadSel = false; clearedAt = doc.version; }
  if (editor.sel.atoms.size) roots = [...editor.sel.atoms];
  else if (editor.lastEdited !== null && doc.atoms.has(editor.lastEdited) && doc.version !== clearedAt) roots = [editor.lastEdited];
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
  saySelection(results);
  panel.innerHTML = results.map((r, i) => polymers[i] ? polymerHtml(r, polymers[i]!) : analysisHtml(r, i, adductSel.value, { stereo: r.error ? '' : stereoSummary(frags[i]), unknown: exports[i].unknownLabels, electrons: electronsHtml(countElectrons(doc, frags[i].values().next().value!)), rGroups: rGroupNames(frags[i]), pubchem: r.error || !r.smiles ? '' : pubchemHtml(pubchemStates.get(r.smiles) ?? { kind: 'idle' }, i) })).join('');
  updatePanels();
}

/**
 * Chemistry > Stereo Group: puts the selected stereocentres in an enhanced stereo group (abs, &n
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
 * Chemistry > Polymer or Repeat Brackets: labels the selected brackets n (a polymer's repeat unit)
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
 * Chemistry > Polymers and R-Groups > R-Group Table: a table under a core structure with R groups (R1, R2…) listing what
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
 * Chemistry > Chiral Flag: the boxed Abs, Rel or Rac below the selected structure (or the one
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
 * Chemistry > Show Stereo Labels: shows the R/S and E/Z labels of the selected structures (or of
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

/** Chemistry > Check Structure: go to the next problem after the one selected. */
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
// the icon library loads on its own once the window is up; then anything with icons in it is drawn again
whenIconsLoaded(() => {
  // (only a drawing with shapes can hold icons: a big structure opened at start-up isn't drawn twice)
  if (doc.shapes.size) doc.allDirty = true;
  editor.changed();
  docMode.fontsChanged();
});
setTimeout(() => void loadIcons().catch(() => flash('The icon library could not be loaded.')), 0);
applyRibbonIcons();

const stylePanel = new StylePanel($('#style-section'), $('#style-body'), doc, () => editor.sel, () => editor.changed());
stylePanel.onEditChart = (id) => void editChartShape(id);
stylePanel.turnable = () => editor.textFirst;
stylePanel.onEditMedia = (id) => void editMediaShape(id);
stylePanel.onEditEquation = (id) => void editEquationShape(id);
stylePanel.onEquationColour = (ids, color) => {
  doc.edit('Equation colour', () => {
    for (const id of ids) {
      const s = doc.shapes.get(id);
      if (!s?.math) continue;
      const math = { ...s.math, color };
      doc.updateShape(id, { math, src: shapeMathPicture(math, measureText) });
    }
  });
  editor.changed();
};
stylePanel.applyLabel = (id, text) => editor.applyLabel(id, text);
stylePanel.tie = (ids) => tieCaptions(ids);

/**
 * Tie captions (text boxes) to a structure: `to` (a selected structure's atoms), or else the one
 * nearest each. They stay where they are, or go to the side chosen in Edit > Settings.
 */
function tieCaptions(ids: number[], to: Set<number> | null = null): void {
  const m = editor.measure();
  let n = 0;
  doc.edit('Link text to structure', () => {
    for (const id of ids) {
      const c = doc.captions.get(id);
      if (!c) continue;
      const f = to ?? nearestStructure(doc, m.captionBox(c), m);
      if (!f?.size) continue;
      const side = linkSide === 'keep' ? undefined : linkSide;
      const a = side ? { atoms: [...f], side, gap: defaultGap(doc), shift: 0, role: 'caption' as const } : attachWhereItIs(doc, c, f, m, 'caption');
      if (!a) continue;
      doc.updateCaption(id, { attach: a, ...(side ? { justify: side === 'right' ? 'left' as const : side === 'left' ? 'right' as const : 'center' as const } : {}) });
      n++;
    }
  });
  editor.changed();
  flash(n ? `Linked: the text now moves with its structure. Selecting either one shows the link.` : 'There is no structure to link it to.');
}

/** Format > Link Text to Structure: the selected text to the selected structure (or the nearest). */
function linkText(): boolean {
  const caps = [...editor.sel.captions].filter((id) => doc.captions.has(id));
  if (!caps.length) return false;
  const first = [...editor.sel.atoms].find((id) => doc.atoms.has(id));
  tieCaptions(caps, first === undefined ? null : doc.fragmentOf(first));
  return true;
}

/** Format > Unlink Text: the selected text (or the text tied to the selected structures) stays put. */
function unlinkText(): boolean {
  const ids = new Set([...editor.sel.captions].filter((id) => doc.captions.get(id)?.attach));
  for (const c of doc.captions.values()) if (c.attach?.atoms.some((a) => editor.sel.atoms.has(a))) ids.add(c.id);
  if (!ids.size) return false;
  doc.edit('Unlink text', () => { for (const id of ids) doc.updateCaption(id, { attach: undefined }); });
  editor.changed();
  return true;
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
  const view: MenuItem = { label: 'View', items: [{ cmd: 'zoom-in' }, { cmd: 'zoom-out' }, { cmd: 'zoom-fit' }, { cmd: 'zoom-selection' }, { cmd: 'zoom-actual' }, null, { cmd: 'show-stereo' }, { cmd: 'group-tips' }, { cmd: 'scroll-bars' }, { cmd: 'alignment-guides' }, null, { cmd: 'dark-page' }, { cmd: 'dark-colours' }] };
  if (!any) {
    return [
      { cmd: 'paste' }, { cmd: 'paste-smiles' }, { cmd: 'select-all' }, null,
      { cmd: 'undo' }, { cmd: 'redo' }, null,
      ...(ws.active.mode === 'slides' ? [{ cmd: 'new-comment', label: 'New Comment' }, { cmd: 'show-comments', label: 'Show Comments' }, null] : []),
      ...(ws.active.mode === 'slides' || design ? [{ cmd: 'format-background', label: 'Format Background…' }, null] : []),
      { label: 'Insert', items: [{ cmd: 'name-to-structure' }, { cmd: 'periodic-table' }, { cmd: 'insert-picture' }, { cmd: 'text-box' }, { cmd: 'insert-symbol' }, ...(design ? [{ cmd: 'design-shapes', label: 'Shape…' }, { cmd: 'design-icons', label: 'Icon…' }, { cmd: 'connector-tool' }] : []), ...(ws.active.mode === 'slides' ? [{ cmd: 'slide-shapes', label: 'Shape…' }, { cmd: 'slide-icons', label: 'Icon…' }] : [])] },
      { label: 'Scheme', items: [{ cmd: 'clean-up-reaction' }, { cmd: 'arrange-scheme' }, { cmd: 'number-compounds' }, { cmd: 'catalytic-cycle' }, { cmd: 'energy-diagram' }, { cmd: 'ts-brackets' }, null, { cmd: 'animate-reaction' }] },
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
    { cmd: 'flip-h' }, { cmd: 'flip-v' }, { cmd: 'flip-h-keep' }, { cmd: 'flip-v-keep' }, null,
    { cmd: 'rotate-cw' }, { cmd: 'rotate-ccw' }, { cmd: 'rotate-180' }, { cmd: 'rotate-dialog' }, null, { cmd: 'scale' },
  ];
  const order: MenuItem[] = shapes.length
    ? [{ cmd: 'shape-front', label: 'Bring to Front' }, { cmd: 'shape-forward', label: 'Bring Forward' }, { cmd: 'shape-backward', label: 'Send Backward' }, { cmd: 'shape-back', label: 'Send to Back' }]
    : [];
  return [
    { cmd: 'cut' }, { cmd: 'copy' }, { cmd: 'paste' }, { cmd: 'delete', label: 'Delete' }, { cmd: 'format-painter' }, null,
    ...(editor.selectedEnergy() !== null ? [{ cmd: 'edit-energy' }, null] : []),
    ...(editor.selectedDiagram() !== null ? [{ cmd: 'edit-diagram' }, { cmd: 'diagram-to-shapes' }, null] : []),
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
    ...(pickedCurved() ? [{ cmd: 'clean-up-arrow' }, { label: 'Mechanism Arrow', items: [
      { cmd: 'arrow-s-shape' }, { cmd: 'arrow-single-curve' }, { cmd: 'flip-arrow-bend' }, null, { cmd: 'attach-arrow' }, { cmd: 'detach-arrow' },
    ] }] : []),
    ...(s.bonds.size && s.bonds.size <= 2 && !s.arrows.size ? [{ cmd: 'homolysis-arrows' }] : []),
    ...(pickedReactionArrow() !== undefined ? [{ cmd: 'animate-step' }] : []),
    ...(s.arrows.size || atoms ? [{ label: 'Scheme', items: [{ cmd: 'clean-up-reaction' }, { cmd: 'clean-up-arrow' }, { cmd: 'arrange-scheme' }, { cmd: 'number-compounds' }, { cmd: 'catalytic-cycle' }, { cmd: 'energy-diagram' }, { cmd: 'ts-brackets' }, null, { cmd: 'animate-reaction' }, ...(pickedReactionArrow() !== undefined ? [{ cmd: 'animate-step' }] : [])] }] : []),
    null,
    { cmd: 'add-frame' },
    ...(atoms ? [{ label: 'Label the Structure', items: [{ cmd: 'add-id-label' }, { cmd: 'add-caption' }, { cmd: 'attach-descriptors' }, null, { cmd: 'number-compounds' }] }] : []),
    { cmd: 'scale' },
    ...(atoms || shapes.some((x) => x.kind === 'ring') ? [{ label: 'Highlight and Fill', items: [{ cmd: 'highlight' }, { cmd: 'remove-highlight' }, { cmd: 'highlight-look' }, { cmd: 'select-highlight' }, null, { cmd: 'smooth-highlight' }, { cmd: 'centre-highlight' }, { cmd: 'soft-highlight' }, { cmd: 'outline-highlight' }, { cmd: 'shadow-highlight' }, { cmd: 'glow-highlight' }, { cmd: 'save-highlight-look' }, null, { cmd: 'fill-rings' }, { cmd: 'ring-shadow' }] }] : []),
    ...(s.captions.size ? [{ cmd: 'link-text' }] : []),
    ...([...s.captions].some((id) => doc.captions.get(id)?.runs.some((r) => r.link))
      ? [{ cmd: 'open-link', label: 'Open Link' }, { cmd: 'insert-link', label: 'Edit Link…' }, { cmd: 'remove-link', label: 'Remove Link' }]
      : s.captions.size ? [{ cmd: 'insert-link', label: 'Link…' }] : []),
    ...([...s.captions].some((id) => doc.captions.get(id)?.attach) ? [{ cmd: 'unlink-text' }] : []),
    ...(selectedGroups(doc, s).size ? [{ cmd: 'ungroup' }] : []),
    ...(s.atoms.size + s.captions.size + s.arrows.size + s.shapes.size > 1 ? [{ cmd: 'group' }] : []),
    { label: 'Align', items: arrange },
    { label: 'Rotate or Flip', items: turn },
    ...(order.length ? [{ label: 'Order', items: order }] : []),
    ...(shapes.some((x) => x.chart) ? [{ cmd: 'edit-chart', label: 'Edit Chart…' }] : []),
    ...((shapes.length === 1 && shapes[0].kind === 'picture') || (atoms && !shapes.length) ? [{ cmd: 'alt-text', label: 'Alt Text…' }] : []),
    ...(shapes.some((x) => x.kind === 'geo' && !x.diagram) ? [
      { cmd: 'shape-styles-here', label: 'Shape Style…' },
      { label: 'Shape Effects', items: effectsMenu() },
      { label: 'Shape Fill', items: [{ cmd: 'shape-picture-fill', label: 'Picture…' }, { cmd: 'shape-no-picture-fill', label: 'No Picture' }] },
    ] : []),
    ...(shapes.some((x) => x.kind === 'picture') ? [{ cmd: 'crop' }, { cmd: 'picture-format' }, { label: 'Picture Style', items: PICTURE_STYLES.map((p) => ({ cmd: `picture-style-${p.id}`, label: p.name })) }] : []),
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
  const ext = (d.adj.get(h.id) ?? []).map((bid) => d.bonds.get(bid)!).filter((b) => b && !outsideValence(b)).map((b) => (b.order === 4 ? 1 : b.order));
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
  rightClickAt = { left: e.clientX, bottom: e.clientY };
  showContextMenu(e.clientX, e.clientY, drawingMenu(), { run: (cmd) => void command(cmd), key: commandKey });
};

stylePanel.cropWithMouse = () => cropPicture();
stylePanel.formatPicture = () => void formatPicture();
stylePanel.removeWhite = (ids) => void removeWhite(ids);
stylePanel.frames = { add: () => void command('add-frame'), fit: (id) => editor.fitFrame(id) };
stylePanel.diagram = {
  edit: (id) => void smartDiagram(id),
  restyle: (id, patch) => { const d = doc.shapes.get(id)?.diagram; if (d) editor.putDiagramAt({ ...d, ...patch }, pasteCentre(), id); },
  ungroup: (id) => editor.ungroupSelectedDiagram(id),
};
stylePanel.energy = {
  edit: (id) => void energyDiagram(id),
  restyle: (id, patch) => { const d = doc.shapes.get(id)?.energy; if (d) editor.putEnergyDiagram({ ...d, ...patch }, pasteCentre(), id); },
};
stylePanel.ringFill = () => void command('fill-rings');
stylePanel.highlightUsed = (c) => { highlightColour = c; };
stylePanel.highlightStyleUsed = (st) => { highlightStyle = tidyStyle(st); };
// ---------------------------------------------------------------- Format Painter

/** What the brush holds: the look of some text, of things on a drawing, or the formats of cells. */
type HeldLook = { kind: 'text'; look: TextLook } | { kind: 'things'; look: ObjectLook } | { kind: 'cells'; block: CellBlock };
const brush = new Brush<HeldLook>();
const PAINTER_BUTTONS = '[data-cmd="format-painter"]:not([role="menuitem"]), [data-doc="format-painter"], [data-sh="format-painter"]';

/** Home > Format Painter (every mode): pick up the look of the selection; a double-click keeps the brush. */
function formatPainter(): void {
  const where = sheetActive() ? 'sheet' : docActive() ? 'document' : 'drawing';
  const got = brush.press(where, (): HeldLook | null => {
    if (where === 'sheet') { const block = sheetMode.pickFormats(); return block && { kind: 'cells', block }; }
    if (where === 'document') { const look = docMode.pickLook(); return look && { kind: 'text', look }; }
    const cap = editor.typingCaption;
    if (cap) return { kind: 'text', look: cap.ed.pickLook() };
    const look = pickObjectLook(editor.doc, editor.sel);
    return look && { kind: 'things', look };
  });
  if (got === 'picked') flash(where === 'sheet' ? 'Format Painter: click or drag over the cells to give them these formats. Double-click the button to keep painting; Esc stops.' : 'Format Painter: click or drag over what should take this look. Double-click the button to keep painting; Esc stops.', 6000);
  else if (got === 'sticky') flash('Format Painter stays on: paint as many things as you like, then press Esc or click Format Painter again.', 6000);
  else if (got === 'nothing') flash(where === 'sheet' ? 'Select the cells whose formats you want to copy, then click Format Painter.' : 'Select what has the look you want to copy (or put the caret in the text), then click Format Painter.');
  else if (got === 'dropped') flash('Format Painter off.');
}

/** The text look the brush holds (text picked up, or the text of a caption or shape picked up). */
function heldText(): TextLook | undefined {
  const l = brush.look;
  return l?.kind === 'text' ? l.look : l?.kind === 'things' ? l.look.text : undefined;
}

/** Paint text being typed in (a document, a caption, a text box or a cell of a table). */
function paintText(ed: import('./text/editing').TextEditing): void {
  const look = heldText();
  if (look && ed.paintLook(look)) brush.used();
}

/** Paint things clicked or boxed on a drawing, slide or design. A click on empty space puts a one-off brush down. */
function paintThings(sel: { atoms: Set<number>; bonds: Set<number>; captions: Set<number>; arrows: Set<number>; shapes: Set<number> }): void {
  const l = brush.look;
  if (!l || l.kind === 'cells') return;
  const look: ObjectLook = l.kind === 'things' ? l.look : { text: l.look, colour: { color: l.look.run.color } };
  const any = sel.atoms.size + sel.bonds.size + sel.captions.size + sel.arrows.size + sel.shapes.size > 0;
  let n = 0;
  if (any) editor.doc.edit('Format Painter', () => { n = paintObjects(editor.doc, sel, look); });
  if (n) { editor.changed(); brush.used(); }
  else if (!any) brush.used();
  else flash('That has no look to take from what was picked up (a table or chart keeps its own).');
}

brush.onChange = () => {
  const l = brush.look;
  editor.painter = l && l.kind !== 'cells' ? { things: paintThings, text: paintText } : null;
  docMode.painter = heldText() ? paintText : null;
  sheetMode.view.painter = l?.kind === 'cells' ? () => { sheetMode.paintFormats(l.block); brush.used(); } : null;
  for (const b of document.querySelectorAll(PAINTER_BUTTONS)) b.setAttribute('aria-pressed', String(!!l));
  editor.requestOverlay();
};

// Escape puts the brush down (before anything else sees the key; a window's own Escape comes first)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !brush.held || (e.target as Element | null)?.closest?.('dialog')) return;
  e.preventDefault();
  e.stopPropagation();
  brush.drop();
  flash('Format Painter off.');
}, true);

// ---------------------------------------------------------------- Insert > Symbol

const symbolWindow = new SymbolWindow({
  insert: (ch) => {
    if (sheetActive()) {
      if (sheetMode.view.typeText(ch)) return true;
      flash('Pick a cell to type the symbol into.');
      return false;
    }
    if (docActive()) {
      if (docMode.insertText(ch)) return true;
      flash('Symbols can\'t be typed in Read Mode: go back to Print Layout (View).');
      return false;
    }
    const cap = editor.typingCaption;
    if (cap) cap.ed.type(ch);
    else editor.typeNew(ch);
    return true;
  },
  recent: () => recentSymbols,
  used: (ch) => { recentSymbols = addRecentSymbol(recentSymbols, ch); storeSettings(); },
  warn: (ch) => (ws.active.mode === 'drawing' && !savableChar(ch) ? 'ChemDraw may not show this character in a ChemDraw file (it isn\'t in its usual fonts or the Symbol font).' : ''),
});

stylePanel.highlightLooks = { list: allLooks, apply: (l) => applyHighlightLook(l), save: () => void saveHighlightLook() };

// ---------------------------------------------------------------- toolboxes (View > Toolboxes)

let toolboxState: ToolboxState = defaultToolboxes();
/** The drawing tools' bar, which the Drawing Tools toolbox holds wherever it is. */
const toolsNav = $<HTMLElement>('#tools');

/** Every tool on the tool bar (palette items too), by name, for toolboxes. */
const ALL_TOOLS = new Map<string, { title: string; icon: string }>();
for (const group of [...TOOL_GROUPS, OFF_BAR]) {
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

/** What the Colours toolbox's swatches do: colour the lines and text, highlight, or fill. */
let colourMode: 'line' | 'highlight' | 'fill' = 'line';

/** The side panel's contents: in the panel at the right, or in the "details" toolbox when taken out. */
const sideContent = $('#side-content');

/** The highlight looks as buttons: one click gives the selection that look. */
function looksList(vertical: boolean): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tb-looks' + (vertical ? ' vertical' : '');
  const head = document.createElement('div');
  head.className = 'tb-heading';
  head.textContent = 'Looks';
  box.append(head);
  for (const look of allLooks()) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tb-look';
    const dot = document.createElement('span');
    dot.className = 'tb-look-dot';
    dot.style.background = look.colour ?? 'transparent';
    if (!look.colour) dot.classList.add('keeps');
    b.append(dot, look.name);
    b.title = `${look.name}${look.colour ? '' : ' (keeps the highlight\'s colour)'}`;
    b.addEventListener('click', () => { finishTyping(); applyHighlightLook(look); });
    box.append(b);
  }
  return box;
}

/** The toolboxes' names, as they come. */
const BOX_TITLES: Record<string, string> = {
  main: 'Drawing Tools', structure: 'Structure', arrange: 'Object', templates: 'Templates', colours: 'Colours', highlight: 'Highlight', custom: 'My Toolbox', details: 'Side Panel',
};
/** What the toolboxes of buttons come with ("cmd:", "tool:", "pal:", "w:looks", "sep"). */
const cmds = (list: (string | null)[]) => list.map((c) => (c ? `cmd:${c}` : 'sep'));
const BOX_ITEMS: Record<string, readonly string[]> = {
  main: MAIN_ITEMS,
  structure: cmds(['clean-up', 'add-frame', 'fill-rings', 'highlight', 'remove-highlight', null, 'chain-ends', 'explicit-h', 'aromatic-circles', 'stereo-labels', null, 'add-id-label', 'add-caption', 'attach-descriptors', 'number-compounds', null, 'contract-label', 'expand-label', 'hapto-bond', 'name-to-structure']),
  arrange: cmds(['align-left', 'align-hcenter', 'align-right', 'align-top', 'align-vcenter', 'align-bottom', null, 'distribute-h', 'distribute-v', null, 'flip-h', 'flip-v', 'rotate-cw', 'rotate-ccw', null, 'shape-front', 'shape-back']),
  highlight: [...cmds(['highlight', 'remove-highlight', null, 'smooth-highlight', 'centre-highlight', 'soft-highlight', 'outline-highlight', 'shadow-highlight', 'glow-highlight', null, 'save-highlight-look']), 'w:looks'],
  custom: defaultToolboxes().custom,
};
/** Short names on toolbox buttons for commands with no icon. */
const SHORT_LABEL: Record<string, string> = {
  'smooth-highlight': 'Smooth', 'centre-highlight': 'Centre', 'soft-highlight': 'Soft', 'outline-highlight': 'Outline only',
  'shadow-highlight': 'Shadow', 'glow-highlight': 'Glow', 'save-highlight-look': 'Save look…',
};

/** The tools a fly-out palette comes with. */
const givenTools = (name: string): string[] => PALETTES.get(name)?.items.filter((t) => ALL_TOOLS.has(t.name)).map((t) => t.name) ?? [];

/** A fly-out's tools on their grid, as Customize Toolboxes has them. */
function paletteGrid(name: string): Grid {
  return flyGrid(toolboxState, name, toolboxState.flyouts?.[name] ?? givenTools(name), PALETTES.get(name)?.columns ?? 3);
}

/** A fly-out palette with the tools Customize Toolboxes gave it, on their grid (null when it has none). */
function paletteNow(name: string): PaletteDef | null {
  const base = PALETTES.get(name);
  if (!base) return null;
  // (My templates holds what you save, so its tools aren't chosen)
  if ((!toolboxState.flyouts?.[name] && !toolboxState.flyGrids?.[name]) || name === 'tpl-own') return base.items.length ? base : null;
  const g = paletteGrid(name);
  const tool = (n: string) => base.items.find((i) => i.name === n) ?? (ALL_TOOLS.has(n) ? { name: n, title: ALL_TOOLS.get(n)!.title } : null);
  const cells = g.cells.map((n) => (n && tool(n) ? n : null));
  const items = cells.filter((n): n is string => !!n).map((n) => tool(n)!);
  return items.length ? { ...base, items, cells, columns: g.cols } : null;
}

/** How each toolbox's grid shows now, and what it does when the window is too short for it. */
const SHOWN = new WeakMap<HTMLElement, { s: Shown; wrap: boolean; across: boolean }>();

/**
 * A toolbox's buttons, as Customize Toolboxes has them: tools, palettes, commands and the
 * highlight looks, each in its cell of the toolbox's grid (empty cells kept, so groups stay apart).
 */
function buildBox(body: HTMLElement, id: string, vertical: boolean): void {
  const g = boxGrid(toolboxState, id, BOX_ITEMS[id]);
  const dock = toolboxState.places[id]?.dock ?? 'float';
  const s = shownGrid(g, dock);
  const cells = document.createElement('div');
  cells.className = 'tb-cells';
  cells.style.gridTemplateColumns = `repeat(${s.cols}, minmax(34px, auto))`;
  const make = (k: string): HTMLElement | null => {
    const name = k.slice(k.indexOf(':') + 1);
    // the drawing tools' buttons are the tool bar's own (it shows the one in use, and each palette's last pick)
    if (k.startsWith('tool:')) { const t = ALL_TOOLS.get(name); return id === 'main' ? (t ? toolbar.toolButton({ name, title: t.title }) : null) : toolButton(name); }
    if (k.startsWith('pal:')) { const p = paletteNow(name); return p && toolbar.paletteButton(p); }
    if (k.startsWith('cmd:')) return commandButton(name, runFromToolbox, SHORT_LABEL[name]);
    if (k === 'w:looks') return looksList(vertical);
    return null;
  };
  const fillCells = () => {
    g.cells.forEach((k, i) => {
      const b = (k && make(k)) || Object.assign(document.createElement('span'), { className: 'tb-gap' });
      b.classList.add('tb-cell');
      b.dataset.cell = String(i);
      if (k === 'w:looks') b.classList.add('tb-wide');
      cells.append(b);
    });
  };
  const wrap = overflowOf(toolboxState, id) === 'wrap';
  SHOWN.set(cells, { s, wrap, across: dock === 'top' || dock === 'bottom' });
  if (id === 'main') { toolbar.fill((root) => { fillCells(); root.append(cells); }); body.append(toolsNav); }
  else { fillCells(); body.append(cells); }
  layCells(cells);
  if (id !== 'main' && !gridItems(g).length) {
    const edit = commandButton('customize-toolbox', () => openCustomToolbox(id), 'Choose what goes here…');
    edit.title = 'Customize Toolboxes: drag tools and commands into this one';
    body.append(edit);
  }
}

/** The toolboxes laid out by the app itself (the rest show buttons chosen in Customize Toolboxes). */
const SPECIAL_BOXES: Record<string, (body: HTMLElement, vertical: boolean) => void> = {
  templates: (body, vertical) => {
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
  colours: (body, vertical) => {
    const modes = document.createElement('div');
    modes.className = 'tb-modes';
    // in Highlight mode, the saved looks too
    const looks = looksList(vertical);
    looks.hidden = colourMode !== 'highlight';
    for (const [m, label, title] of [['line', 'Colour', 'Colour the lines and text'], ['highlight', 'Highlight', 'A band of colour behind atoms and bonds'], ['fill', 'Fill', 'Fill shapes and ring fills']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.setAttribute('aria-pressed', String(colourMode === m));
      b.addEventListener('click', () => { colourMode = m; for (const o of modes.children) o.setAttribute('aria-pressed', String(o === b)); looks.hidden = m !== 'highlight'; });
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
    body.append(modes, grid, looks);
    if (vertical) body.style.maxWidth = '110px';
  },
  // The side panel (Style, Warnings, Analysis; Format in documents, Cell in sheets) is a toolbox,
  // docked at the right to start with. Its arrow goes with it, so it shows even when the title bar is
  // locked away.
  details: (body) => { body.before($('#side-fold')); body.append(sideContent); },
};

/** The toolboxes there are now (the drawing tools first, as the others' buttons may come from its bar). */
function toolboxDefs(): ToolboxDef[] {
  const ids = boxIds(toolboxState);
  return ['main', ...ids.filter((id) => id !== 'main')].map((id) => ({
    id,
    title: boxTitle(toolboxState, id, BOX_TITLES[id]),
    build: (body: HTMLElement, vertical: boolean) => (SPECIAL_BOXES[id] && !isEditable(id) ? SPECIAL_BOXES[id](body, vertical) : buildBox(body, id, vertical)),
  }));
}

const toolboxes = new Toolboxes(toolboxDefs, {
  get: () => toolboxState,
  set: (st) => { toolboxState = st; tickToolboxes(); storeSettings(); placeSidePanel(); },
  work: () => $('#work'),
  customize: (id) => openCustomToolbox(id),
  // each mode keeps the side panel folded or open on its own
  folded: (id) => (id === 'details' ? sideIsFolded() : undefined),
  fold: (id) => { if (id !== 'details') return false; command('fold-side'); return true; },
  say: (text) => flash(text),
  rendered: () => fitTools(),
});

/**
 * Put a toolbox's buttons in their cells on screen: as the grid has them, or wrapped when only
 * `fit` rows (columns, along the top or bottom) have room. Thin lines go between the rows that have them.
 */
function layCells(cells: HTMLElement, fit?: number): void {
  const info = SHOWN.get(cells);
  if (!info) return;
  const { s, across } = info;
  const full = across ? s.cols : s.rows;
  const { at, starts } = wrapped(s, Math.min(full, fit ?? full), across);
  const blocks = starts.length;
  // the longest block sets how many rows (columns, along the top or bottom) there are
  const len = Math.max(...starts.map((st, b) => (starts[b + 1] ?? full) - st));
  cells.style.gridTemplateColumns = `repeat(${across ? len : s.cols * blocks}, minmax(34px, auto))`;
  cells.style.gridTemplateRows = `repeat(${across ? s.rows * blocks : len}, minmax(32px, auto))`;
  cells.querySelectorAll('.tb-line').forEach((l) => l.remove());
  // a line where a block starts is not needed: the blocks stand apart
  const lineRows = new Set(across ? s.lineRows : s.lineRows.filter((r) => !starts.includes(r)));
  const lineCols = new Set(across ? s.lineCols.filter((c) => !starts.includes(c)) : s.lineCols);
  for (const el of cells.querySelectorAll<HTMLElement>(':scope > .tb-cell')) {
    const i = Number(el.dataset.cell);
    const p = at[i], o = s.at[i];
    el.style.gridRow = String(p.r + 1);
    const room = across ? len - p.c : s.cols - (p.c % s.cols);
    el.style.gridColumn = el.classList.contains('tb-wide') ? `${p.c + 1} / span ${Math.max(1, room)}` : String(p.c + 1);
    el.classList.toggle('tb-after-line', lineRows.has(o.r));
    el.classList.toggle('tb-after-vline', lineCols.has(o.c));
    el.classList.toggle('tb-block', p.start);
  }
  // the lines themselves, across each block of the grid (or down it, turned on its side)
  const line = (r: number, c: number, span: number, down: boolean) => {
    const l = document.createElement('div');
    l.className = 'tb-line' + (down ? ' down' : '');
    l.style.gridRow = down ? `${r + 1} / span ${span}` : String(r + 1);
    l.style.gridColumn = down ? String(c + 1) : `${c + 1} / span ${span}`;
    cells.append(l);
  };
  const size = (b: number) => (starts[b + 1] ?? full) - starts[b];
  for (let b = 0; b < blocks; b++) {
    if (!across) {
      for (const r of lineRows) { const k = inBlock(starts, r); if (k.b === b) line(k.i, b * s.cols, s.cols, false); }
      for (const c of lineCols) line(0, b * s.cols + c, size(b), true);
    } else {
      for (const r of lineRows) line(b * s.rows + r, 0, size(b), false);
      for (const c of lineCols) { const k = inBlock(starts, c); if (k.b === b) line(b * s.rows, k.i, s.rows, true); }
    }
  }
}

/**
 * A toolbox set to wrap, with too little room for its grid, takes fewer rows and puts the rest in
 * more columns beside them (or, along the top or bottom, fewer columns and more rows). One set to
 * scroll scrolls. A dock down a side fades at its foot while there is more below to scroll to.
 */
function fitTools(): void {
  const all = [...document.querySelectorAll<HTMLElement>('.toolbox .tb-cells')].filter((c) => SHOWN.has(c));
  for (const c of all) layCells(c);
  for (const c of all) {
    const { s, wrap, across } = SHOWN.get(c)!;
    const box = c.closest<HTMLElement>('.toolbox');
    if (!wrap || !box || box.classList.contains('collapsed')) continue;
    const dock = box.parentElement!;
    const floating = box.classList.contains('floating');
    const over = () => (floating ? box.scrollHeight > box.clientHeight + 1 : across ? c.scrollWidth > dock.clientWidth - 16 : dock.scrollHeight > dock.clientHeight + 1);
    for (let f = (across ? s.cols : s.rows) - 1; f >= 1 && over(); f--) layCells(c, f);
  }
  fadeDocks();
}
function fadeDocks(): void {
  for (const d of document.querySelectorAll<HTMLElement>('.dock-v')) d.classList.toggle('more-below', d.scrollTop + d.clientHeight < d.scrollHeight - 2);
}
for (const d of document.querySelectorAll<HTMLElement>('.dock-v')) d.addEventListener('scroll', fadeDocks, { passive: true });
addEventListener('resize', () => fitTools());

/** Tick the shown toolboxes and the lock in the View menu, and show the lock on its button. */
function tickToolboxes(): void {
  fillToolboxMenu();
  $('[data-cmd="lock-toolboxes"]')?.setAttribute('aria-checked', String(toolboxState.locked));
  $('[data-cmd="fold-side"]')?.setAttribute('aria-checked', String(sideIsFolded()));
  const lock = $('#btn-lock');
  lock.setAttribute('aria-pressed', String(toolboxState.locked));
  lock.querySelector('.lock-icon')!.innerHTML = lockIcon(toolboxState.locked);
  lock.querySelector('.lock-text')!.textContent = toolboxState.locked ? 'Locked' : 'Unlocked';
  lock.title = toolboxState.locked
    ? 'Toolbox layout locked: the toolboxes stay where they are. Click to unlock every toolbox, then drag one by its title to move it. This locks the layout only, never the drawing.'
    : 'Toolbox layout unlocked: drag a toolbox by its title to an edge to dock it, or anywhere to float it. Click to lock every toolbox where it is.';
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

/** Below this window width the side panel folds by itself, so the drawing keeps its room. */
const NARROW_WINDOW = 1200;
const narrowWindow = () => innerWidth < NARROW_WINDOW;
/** The side panel opened by hand while the window is narrow (forgotten when it widens). */
let narrowOpen = false;

/** The side panel is folded away in the mode showing (each mode keeps its own choice), or the window is narrow. */
function sideIsFolded(): boolean {
  return sideFolded(toolboxState, ws.active.mode) || (narrowWindow() && !narrowOpen);
}

/** Fold or open the side panel. In a narrow window that lasts until it widens; otherwise it is kept for the mode. */
function foldSide(fold: boolean): void {
  if (narrowWindow()) {
    narrowOpen = !fold;
    if (!fold && sideFolded(toolboxState, ws.active.mode)) { toolboxes.setSideCollapsed(ws.active.mode, false); return; }
    placeSidePanel();
    tickToolboxes();
    return;
  }
  toolboxes.setSideCollapsed(ws.active.mode, fold);
}
let wasNarrow = narrowWindow();
addEventListener('resize', () => {
  const now = narrowWindow();
  if (now === wasNarrow) return;
  wasNarrow = now;
  if (!now) narrowOpen = false;
  placeSidePanel();
  tickToolboxes();
});
$('#btn-lock').addEventListener('click', () => command('lock-toolboxes'));

/** Where View > Toolboxes' entries start (the line above them). */
let toolboxMenuTop: Element | null = null;

/** View > Toolboxes: a ticked entry for each toolbox there is now, named and in the order Customize Toolboxes has them. */
function fillToolboxMenu(): void {
  const first = document.querySelector<HTMLElement>('header .menu [data-cmd^="toolbox-"]');
  if (!first) return;
  toolboxMenuTop ??= first.previousElementSibling;
  const menu = first.parentElement!;
  const have = new Map([...menu.querySelectorAll<HTMLElement>(':scope > [data-cmd^="toolbox-"]')].map((b) => [b.dataset.cmd!.slice('toolbox-'.length), b]));
  let at = toolboxMenuTop;
  for (const id of boxIds(toolboxState)) {
    if (id === 'details') continue;
    let b = have.get(id);
    if (!b) {
      b = document.createElement('button');
      b.setAttribute('role', 'menuitemcheckbox');
      b.dataset.cmd = `toolbox-${id}`;
      b.title = 'A toolbox of your own (View > Toolboxes > Customize Toolboxes changes it)';
      b.append(document.createElement('span'));
    }
    have.delete(id);
    b.hidden = false;
    b.querySelector('span')!.textContent = `Toolbox: ${boxTitle(toolboxState, id, BOX_TITLES[id])}`;
    b.setAttribute('aria-checked', String(!!toolboxState.places[id]?.shown));
    if (at) at.after(b); else menu.prepend(b);
    at = b;
  }
  // deleted ones: your own go, the app's wait for Restore
  for (const [id, b] of have) { if (isOwnBox(id)) b.remove(); else b.hidden = true; }
}

/** A tool's or command's name and icon in Customize Toolboxes. */
function describeItem(key: string): Pickable {
  const name = key.slice(key.indexOf(':') + 1);
  if (key === 'sep') return { key, label: 'Divider', icon: undefined };
  if (key === 'w:looks') return { key, label: 'Highlight looks', icon: LOOKS_ICON };
  if (key.startsWith('tool:')) { const t = ALL_TOOLS.get(name); return { key, label: t ? t.title.split(/[.:] /)[0] : name, icon: t?.icon }; }
  if (key.startsWith('pal:')) { const p = PALETTES.get(name); return { key, label: p?.title ?? name, icon: p?.items[0] && (ALL_TOOLS.get(p.items[0].name)?.icon) }; }
  return { key, label: topMenuEntry(name)?.label ?? SHORT_LABEL[name] ?? name, icon: commandIcon(name) };
}
const LOOKS_ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="6" cy="7" r="2.2" fill="currentColor" fill-opacity="0.35"/><circle cx="6" cy="12" r="2.2"/><circle cx="6" cy="17" r="2.2" fill="currentColor" fill-opacity="0.6"/><line x1="11" y1="7" x2="20" y2="7"/><line x1="11" y1="12" x2="20" y2="12"/><line x1="11" y1="17" x2="18" y2="17"/></svg>';

/** Everything that can go in a toolbox, for Customize Toolboxes' list. */
function toolboxCatalogue(): { name: string; items: Pickable[] }[] {
  const d = (key: string) => describeItem(key);
  const loose = [...TOOL_GROUPS.flat(), ...OFF_BAR].filter((it): it is ToolDef => !('palette' in it)).map((t) => d(`tool:${t.name}`));
  const groups: { name: string; items: Pickable[] }[] = [
    { name: 'Drawing tools', items: loose },
    { name: 'Fly-out palettes', items: [...PALETTES.keys()].map((p) => d(`pal:${p}`)) },
    { name: 'Lists', items: [d('w:looks')] },
  ];
  for (const p of PALETTES.values()) if (p.palette !== 'tpl-own' || p.items.length > 1) groups.push({ name: p.title, items: p.items.filter((t) => ALL_TOOLS.has(t.name)).map((t) => d(`tool:${t.name}`)) });
  for (const g of menuCommands()) if (g.items.length) groups.push({ name: `${g.menu} menu`, items: g.items.filter((c) => !c.cmd.startsWith('toolbox-')).map((c) => ({ key: `cmd:${c.cmd}`, label: c.label, icon: commandIcon(c.cmd) })) });
  return groups;
}

const toolboxEditor = new ToolboxEditor({
  get: () => toolboxState,
  set: (st) => { toolboxState = st; tickToolboxes(); storeSettings(); toolboxes.render(); placeSidePanel(); },
  catalogue: toolboxCatalogue,
  describe: describeItem,
  title: (id) => BOX_TITLES[id] ?? 'My Toolbox',
  given: (id) => BOX_ITEMS[id] ?? [],
  palette: (name) => { const p = PALETTES.get(name); return p && name !== 'tpl-own' ? { title: p.title } : null; },
  flyGrid: paletteGrid,
  newPlace: () => { const w = $('#work').getBoundingClientRect(); return { x: Math.round(Math.max(w.left + 8, w.right - 300)), y: Math.round(w.top + 40) }; },
});

// ---------------------------------------------------------------- View > Customize the Ribbon

/** Each ribbon's tabs and groups as you put them (kept in the settings). */
let ribbonPrefs: RibbonsPrefs = {};
/** The ribbons as they came (read the first time they are laid out). */
let ribbonInfo: RibbonInfo[] | null = null;
const ribbonsNow = () => (ribbonInfo ??= readRibbons());
/** The ribbon each mode shows (drawings have none: the Slides one is offered). */
const RIBBON_OF_MODE: Record<string, string> = { slides: 'slides', document: 'doc', sheet: 'sheet', design: 'design', drawing: 'slides' };

/** Lay every ribbon out with your changes. */
function applyRibbons(): void {
  // (nothing changed and nothing laid out yet: the ribbons are as they come)
  if (!ribbonInfo && !Object.keys(ribbonPrefs).length) return;
  for (const info of ribbonsNow()) applyRibbon(info, ribbonPrefs[info.id], { run: (cmd) => { finishTyping(); command(cmd); } });
  fitRibbons();
}

const ribbonEditor = new RibbonEditor({
  ribbons: ribbonsNow,
  get: () => ribbonPrefs,
  set: (p) => { ribbonPrefs = p; applyRibbons(); storeSettings(); },
  menus: () => menuCommands().filter((g) => g.items.length).map((g) => ({ name: `${g.menu} menu`, items: g.items.filter((c) => !c.cmd.startsWith('toolbox-')).map((c) => ({ key: `cmd:${c.cmd}`, label: c.label, icon: commandIcon(c.cmd) })) })),
  jiggle: () => toolboxState.jiggle !== false,
});
// right-click a ribbon's tabs (or a group's name) to customize it
for (const [mode, id] of [['slides', '#ribbon'], ['document', '#doc-ribbon'], ['sheet', '#sheet-ribbon'], ['design', '#design-ribbon']] as const) {
  $(id).addEventListener('contextmenu', (e) => {
    if (!(e.target as Element).closest('.rb-tabs, .rb-label')) return;
    e.preventDefault();
    showContextMenu(e.clientX, e.clientY, [
      { cmd: 'customize-ribbon', label: 'Customize the Ribbon…' },
      { cmd: 'collapse-ribbon', label: ribbonCollapsed() ? 'Show the Whole Ribbon' : 'Collapse the Ribbon' },
    ], { key: (c) => commandKey(c), run: (c) => (c === 'customize-ribbon' ? ribbonEditor.open(RIBBON_OF_MODE[mode]) : command(c)) });
  });
}

/** View > Toolboxes > Customize Toolboxes, at a toolbox (My Toolbox unless one is named). */
function openCustomToolbox(id?: string): void {
  toolboxEditor.open(id);
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

/** A command's picture for the search list: the one drawn for it, or the one on its ribbon button. */
function searchIcon(cmd: string | undefined, b?: HTMLElement): string | undefined {
  const from = (el: Element | null | undefined) => {
    if (!el) return undefined;
    const svg = el.querySelector('svg');
    if (svg) return svg.outerHTML;
    const glyph = el.querySelector('.rb-icon')?.textContent?.trim();
    return glyph && glyph.length <= 2 ? `<span>${glyph.replace(/[<&]/g, '')}</span>` : undefined;
  };
  return from(b) ?? (cmd ? commandIcon(cmd) ?? from(document.querySelector(`.ribbon [data-cmd="${cmd}"]`)) : undefined);
}

function commandItems(): CommandItem[] {
  const out: CommandItem[] = [];
  const runCmd = (cmd: string, label: string) => () => {
    finishTyping();
    if (!command(cmd)) flash(`${label} isn't available here.`);
  };
  for (const wrap of document.querySelectorAll<HTMLElement>('header .menu-wrap')) {
    const menu = wrap.querySelector<HTMLElement>(':scope > button')?.textContent?.trim() ?? '';
    for (const b of wrap.querySelectorAll<HTMLButtonElement>('[data-cmd]')) {
      if (b.hidden || b.disabled || getComputedStyle(b).display === 'none') continue;
      const sub = b.closest('.submenu')?.querySelector<HTMLButtonElement>(':scope > button');
      if (sub?.disabled) continue; // a submenu for another mode
      const cmd = b.dataset.cmd!, e = topMenuEntry(cmd);
      const label = e?.label ?? cmd;
      out.push({ id: `cmd:${cmd}`, label, place: sub ? `${menu} ▸ ${sub.textContent!.trim()}` : `${menu} menu`, more: b.title, key: commandKey(cmd),
        checked: e?.checked, icon: searchIcon(cmd), run: runCmd(cmd, label) });
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
        icon: searchIcon(b.dataset.cmd, b),
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
      const icon = ALL_TOOLS.get(name)!.icon;
      out.push({ id: `tool:${name}`, label, place: 'Drawing tools', more: ALL_TOOLS.get(name)!.title, key: keysOf('space', `tool ${name}`)[0],
        icon: icon.startsWith('<') ? icon : undefined,
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
const guide = new GuideWindow(openWebPage);
watchRibbons(() => storeSettings());
const settingsWindow = new SettingsWindow([
  { id: 'general', title: 'General', words: 'groups selecting click outline linked text above below ask whole page tracked changes reviewer name', open: generalPreferences },
  { id: 'drawing', title: 'Drawing', words: 'methyl me ch3 axial chirality ra sa helicity charges circled text tool atom r groups superscript mechanism arrows reroute', open: drawingPreferences },
  { id: 'style', title: 'Drawing Style', words: 'bond length line width font journal acs rsc wiley elsevier thieme hash spacing margin', open: drawingStyleDialog },
  { id: 'hotkeys', title: 'Hotkeys', words: 'keys keyboard shortcuts import export reset', open: () => hotkeysDialog.open() },
  { id: 'typing', title: 'Text and Spelling', words: 'typing spelling dictionary autocorrect replacements chemistry formulas subscripts', open: () => typingDialog.open() },
  { id: 'palettes', title: 'Colour Palettes', words: 'colours colors palette rows', open: () => editPalettes() },
  { id: 'mode-colours', title: 'Mode Colours', words: 'tab colours accent window drawing slides sheet document design appearance', open: () => modeDialog.open() },
  { id: 'navigation', title: 'Navigation', words: 'navigator minimap map overview edge arrows off screen lost find dot grid dots tint outside fit go to selection orientation zoom', open: navigationSettings },
  { id: 'dark', title: 'Dark Page', words: 'dark mode night paper ink graphite slate appearance colours', open: darkColours },
  { id: 'schemes', title: 'Schemes', words: 'scheme arrow gap plus text size reagents conditions boxes', open: schemeSettings },
  { id: 'autosave', title: 'AutoSave and Recovery', words: 'autosave recovery versions backup copies shared folders onedrive', open: () => keeper.optionsCommand() },
  { id: 'online', title: 'Online', words: 'pubchem internet names lookup updates check version privacy stable latest channel beta', open: onlinePreferences },
  { id: 'transfer', title: 'Import and Export', words: 'backup back up copy move settings file new computer install reinstall export import toolboxes hotkeys', open: settingsTransfer },
  { id: 'files', title: 'File Types', words: 'open with default app explorer finder associations cdxml cdx mol sdf docx pptx xlsx double-click', open: () => fileTypesPage(fileTypesHost) },
]);
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
let outlineSeen = -1;
// scroll bars over the drawing: they cover what is drawn (or the slide), and the part on screen
const scrollbars = new Scrollbars(host, renderer, () => {
  const d = ws.active.deck;
  return d ? { x1: 0, y1: 0, x2: d.size.w, y2: d.size.h } : doc.bounds();
}, () => editor.requestScene());

// ---------------------------------------------------------------- finding your way round (Settings ▸ Navigation)


/** Drawings: the dot grid, painted behind everything (on screen only; never saved, printed or copied). */
const drawingBackdrop = {
  draw(ctx: CanvasRenderingContext2D): void { paintGrid(ctx, orientPrefs, renderer.dpr, dark.on); },
};
if (!renderer.page && !deckNow()) renderer.page = drawingBackdrop;

/** Is an endless drawing showing in the window (not a slide, design, sheet or document)? */
const drawingShown = () => !deckNow() && !editor.paused;

/** What the edge arrows point to: each structure, and (when set) text, arrows and shapes. Worked out again when the drawing changes, not while dragging. */
let targetsCache: { version: number; to: OrientPrefs['arrowsTo']; list: Target[] } | null = null;
function arrowTargets(): Target[] {
  if (targetsCache && (targetsCache.version === doc.version || editor.dragging) && targetsCache.to === orientPrefs.arrowsTo) return targetsCache.list;
  const list: Target[] = [];
  const box = (pts: { x: number; y: number }[]) => {
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts) { if (p.x < x1) x1 = p.x; if (p.y < y1) y1 = p.y; if (p.x > x2) x2 = p.x; if (p.y > y2) y2 = p.y; }
    return { x1, y1, x2, y2 };
  };
  for (const f of doc.fragments()) list.push({ what: 'structure', box: box([...f].map((id) => doc.atoms.get(id)!)) });
  if (orientPrefs.arrowsTo === 'everything') {
    for (const c of doc.captions.values()) list.push({ what: 'text', box: { x1: c.x, y1: c.y - 10, x2: c.x + (c.width ?? 40), y2: c.y + 4 } });
    for (const r of doc.arrows.values()) list.push({ what: 'arrow', box: box([r.tail, r.head]) });
    for (const sh of doc.shapes.values()) list.push({ what: 'shape', box: { x1: Math.min(sh.x1, sh.x2), y1: Math.min(sh.y1, sh.y2), x2: Math.max(sh.x1, sh.x2), y2: Math.max(sh.y1, sh.y2) } });
  }
  targetsCache = { version: doc.version, to: orientPrefs.arrowsTo, list };
  return list;
}

const navMap = new Navigator(host, renderer, () => orientPrefs, {
  content: () => doc.bounds(),
  version: () => doc.version,
  paint: (ctx) => drawDrawing(ctx, doc),
  background: () => doc.background,
  moved: () => editor.requestScene(),
  fit: () => command('zoom-fit'),
  busy: () => editor.dragging,
});
const edgeArrows = new EdgeArrows(host, renderer, () => editor.requestScene());
editor.underlay = (ctx) => { if (drawingShown()) paintTint(ctx, orientPrefs, renderer, doc.bounds(), doc.style.labelSize * 1.5 + doc.style.bondLength); };

/** Each frame: the navigator and the edge arrows follow the view and the drawing. */
function updateOrientation(): void {
  const on = drawingShown();
  navMap.update(on);
  edgeArrows.update(on && orientPrefs.edgeArrows ? arrowTargets() : null, doc.version, navMap.box());
}

/** Use these navigation settings: tick the View menu, show or hide the buttons, and repaint (the grid is in the drawing's tiles). */
function setOrient(next: OrientPrefs, store = true): void {
  const gridChanged = next.dotGrid !== orientPrefs.dotGrid || next.gridSpacing !== orientPrefs.gridSpacing || next.gridStrength !== orientPrefs.gridStrength;
  orientPrefs = { ...next };
  targetsCache = null;
  for (const [cmd, on] of [['navigator', orientPrefs.navigator], ['edge-arrows', orientPrefs.edgeArrows], ['dot-grid', orientPrefs.dotGrid], ['outside-tint', orientPrefs.tint]] as const) {
    for (const el of document.querySelectorAll(`[data-cmd="${cmd}"][role="menuitemcheckbox"]`)) el.setAttribute('aria-checked', String(on));
  }
  $('#go-buttons').hidden = !orientPrefs.goButtons;
  if (gridChanged) renderer.repaintAll();
  editor.requestScene();
  if (store) storeSettings();
}

/** Settings ▸ Navigation. */
async function navigationSettings(): Promise<void> {
  const o = orientPrefs;
  const strength = [{ value: 'faint', label: 'Faint' }, { value: 'light', label: 'Light' }, { value: 'strong', label: 'Stronger' }];
  const r = await ask('Navigation', [
    { name: 'navigator', label: 'Navigator: a small map of the whole drawing in a corner (click or drag in it to move there; double-click to fit)', type: 'checkbox', value: String(o.navigator) },
    { name: 'navCorner', label: 'Navigator corner', value: o.navCorner, options: [{ value: 'br', label: 'Bottom right' }, { value: 'bl', label: 'Bottom left' }, { value: 'tr', label: 'Top right' }, { value: 'tl', label: 'Top left' }] },
    { name: 'navSize', label: 'Navigator size', value: o.navSize, options: [{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }] },
    { name: 'navHideAll', label: 'Hide the navigator while the whole drawing is on screen', type: 'checkbox', value: String(o.navHideAll) },
    { name: 'edgeArrows', label: 'Edge arrows: point to things scrolled out of sight (click one to go there)', type: 'checkbox', value: String(o.edgeArrows) },
    { name: 'arrowsTo', label: 'Edge arrows point to', value: o.arrowsTo, options: [{ value: 'structures', label: 'Structures' }, { value: 'everything', label: 'Structures, text, arrows and shapes' }] },
    { name: 'dotGrid', label: 'Dot grid behind the drawing', type: 'checkbox', value: String(o.dotGrid),
      help: 'On screen only: files, printing, copying and exports have no grid. The dots spread out as you zoom out.' },
    { name: 'gridSpacing', label: 'Dot spacing', value: o.gridSpacing, options: [{ value: 'fine', label: 'Fine (¼ inch)' }, { value: 'normal', label: 'Normal (½ inch)' }, { value: 'wide', label: 'Wide (1 inch)' }] },
    { name: 'gridStrength', label: 'Dots', value: o.gridStrength, options: strength },
    { name: 'tint', label: 'Tint the empty space beyond everything drawn', type: 'checkbox', value: String(o.tint),
      help: 'On screen only. Shows at a glance which way the drawing is when nothing of it is in the window.' },
    { name: 'tintStrength', label: 'Tint', value: o.tintStrength, options: strength },
    { name: 'goButtons', label: 'Fit and Go to Selection buttons in the status bar', type: 'checkbox', value: String(o.goButtons),
      help: 'F6 fits the drawing and Shift+F6 goes to the selection, with or without the buttons (Edit ▸ Hotkeys changes the keys).' },
  ], { ok: 'Save' });
  if (!r) return;
  setOrient({
    navigator: r.navigator === 'true', navCorner: r.navCorner as OrientPrefs['navCorner'], navSize: r.navSize as OrientPrefs['navSize'], navHideAll: r.navHideAll === 'true',
    edgeArrows: r.edgeArrows === 'true', arrowsTo: r.arrowsTo === 'everything' ? 'everything' : 'structures',
    dotGrid: r.dotGrid === 'true', gridSpacing: r.gridSpacing as OrientPrefs['gridSpacing'], gridStrength: r.gridStrength as OrientPrefs['gridStrength'],
    tint: r.tint === 'true', tintStrength: r.tintStrength as OrientPrefs['tintStrength'],
    goButtons: r.goButtons === 'true',
  });
}

$('#go-fit').addEventListener('click', () => { command('zoom-fit'); $('#overlay').focus({ preventScroll: true }); });
$('#go-sel').addEventListener('click', () => { command('zoom-selection'); $('#overlay').focus({ preventScroll: true }); });

// ---------------------------------------------------------------- the page in drawings

/** The page new drawings start on (File > Page Setup's default). */
let defaultPage: Settings['page'] = { name: 'letter', w: 540, h: 720, grow: true };

// ---------------------------------------------------------------- the welcome card

/** The welcome card has been closed for good. */
let welcomed = false;
const welcomeCard = $('#welcome');
/** Show the welcome card on a first, empty drawing; it goes when closed or when drawing starts. */
function showWelcome(): void {
  if (welcomed || doc.atoms.size || doc.captions.size || doc.shapes.size || deckNow() || ws.active.mode !== 'drawing') return;
  welcomeCard.hidden = false;
  const seen = doc.version;
  const off = () => {
    if (welcomeCard.hidden) return;
    welcomeCard.hidden = true;
    welcomed = true;
    storeSettings();
  };
  $('#welcome-close').addEventListener('click', () => { off(); $('#overlay').focus({ preventScroll: true }); }, { once: true });
  welcomeCard.querySelector('[data-cmd="user-guide"]')?.addEventListener('click', (e) => { e.preventDefault(); off(); command('user-guide'); }, { once: true });
  // drawing anything puts it away
  const watch = () => { if (welcomeCard.hidden) return; if (doc.version !== seen) off(); else requestAnimationFrame(watch); };
  requestAnimationFrame(watch);
}

/** File > Page Setup…: the drawing's paper size and way up, whether it adds pages, and the default for new drawings. */
async function pageSetup(): Promise<void> {
  const p = doc.page;
  const land = !!p && p.w > p.h;
  const paper = p ? PAPER.find((x) => (Math.abs(x.w - p.w) < 1 && Math.abs(x.h - p.h) < 1) || (Math.abs(x.w - p.h) < 1 && Math.abs(x.h - p.w) < 1)) : undefined;
  const got = await ask('Page Setup', [
    { name: 'paper', label: 'Paper', value: !p ? 'none' : paper?.name ?? 'custom', options: [...PAPER.map((x) => ({ value: x.name, label: x.label })), { value: 'custom', label: 'Your own size' }, { value: 'none', label: 'No page (an endless drawing)' }] },
    { name: 'way', label: 'Way up', value: land ? 'landscape' : 'portrait', options: [{ value: 'portrait', label: 'Portrait' }, { value: 'landscape', label: 'Landscape' }] },
    { name: 'w', label: 'Your own size: width (in)', value: String(Math.round(((p?.w ?? 540) + 72) / 72 * 100) / 100), type: 'number' },
    { name: 'h', label: 'Your own size: height (in)', value: String(Math.round(((p?.h ?? 720) + 72) / 72 * 100) / 100), type: 'number' },
    { name: 'grow', label: 'When the drawing goes past the page', value: !p || p.grow ? 'grow' : 'keep', options: [{ value: 'grow', label: 'Add pages (as ChemDraw does)' }, { value: 'keep', label: 'Keep it on the page when saving' }] },
    { name: 'dflt', label: 'Use this for new drawings', type: 'checkbox', value: 'false' },
  ], { ok: 'OK', note: 'Sizes are the paper; the page drawn on is half an inch in from each edge, as in ChemDraw. The page isn\'t drawn on screen (the drawing stays endless); it is saved with the file for ChemDraw.' });
  if (!got) return;
  let next: Settings['page'] = null;
  if (got.paper !== 'none') {
    const pp = PAPER.find((x) => x.name === got.paper);
    let w = pp ? pp.w : Math.max(1, Number(got.w) || 8.5) * 72 - 72, h = pp ? pp.h : Math.max(1, Number(got.h) || 11) * 72 - 72;
    if ((got.way === 'landscape') !== (w > h)) [w, h] = [h, w];
    next = { w: Math.max(72, w), h: Math.max(72, h), grow: got.grow !== 'keep', ...(pp ? { name: pp.name } : {}) };
  }
  doc.page = next;
  ws.noteChange();
  if (got.dflt === 'true') { defaultPage = next && { ...next }; storeSettings(); }
  if (next && !next.grow && !keepOnPage(doc)) flash('The drawing is bigger than the page, so it can\'t all be kept on it. Choose a bigger page, or add pages.', 7000);
  editor.changed();
  renderer.repaintAll();
  editor.requestScene();
}

/** View > Text Formatting Bar: along the top of the drawing, floating by the text, or hidden. */
function placeTextBar(where: Settings['textBar']): void {
  CaptionEditor.barPlace = where;
  for (const w of ['docked', 'floating', 'hidden']) $(`[data-cmd="text-bar-${w}"]`)?.setAttribute('aria-checked', String(w === where));
}

function showScrollBars(on: boolean): void {
  scrollbars.shown = on;
  $('[data-cmd="scroll-bars"]')?.setAttribute('aria-checked', String(on));
  scrollbars.update(doc.version);
}

/** The status bar's zoom box: what the zoom is now, as a percentage of actual size. */
const zoomPick = $<HTMLSelectElement>('#zoom-pick');
let zoomShown = -1;
function showZoom(): void {
  const pct = Math.round((renderer.view.scale / (96 / 72)) * 100);
  if (pct === zoomShown) return;
  zoomShown = pct;
  const own = zoomPick.querySelector<HTMLOptionElement>('option[value="now"]')!;
  const listed = [...zoomPick.options].find((o) => o.value === String(pct));
  own.hidden = !!listed;
  own.textContent = `${pct}%`;
  zoomPick.value = listed ? listed.value : 'now';
}
zoomPick.addEventListener('change', () => {
  const v = zoomPick.value;
  if (v === 'fit') command('zoom-fit');
  else if (v === 'actual') command('zoom-actual');
  else if (/^\d+$/.test(v)) editor.zoomTo((Number(v) / 100) * (96 / 72));
  zoomShown = -1;
  showZoom();
  $('#overlay').focus({ preventScroll: true });
});

editor.onFrame = () => {
  showZoom();
  rulers.update();
  // what is typed on the slide shows in the outline
  if (outlineView.shown && doc.version !== outlineSeen) { outlineSeen = doc.version; outlineView.rebuild(); }
  layers?.refresh();
  scrollbars.update(doc.version);
  updateOrientation();
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
  box: (c) => editor.setTextBox(c),
  boxLook: () => editor.textBoxLook(),
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
  // (ticks in the ribbon too)
  $(id).addEventListener('change', (e) => {
    const cmd = (e.target as HTMLElement).closest<HTMLInputElement>('input[type="checkbox"][data-cmd]')?.dataset.cmd;
    if (cmd) command(cmd);
  });
}
// the Beta mark beside the program's name says what beta means here
$('#stage-badge').addEventListener('click', () => command('about'));

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
(window as any).__app = { doc, editor, renderer, chem, live, command, addMolfile, keeper, cdxml: (name: string) => writeCdxml(doc, { name, textMeasure: measureText }), openText, stressTest, pasteChemistry, smiles: async (loose = false) => chem.molToSmiles(toMolfile(doc, doc.atoms.keys()).molblock, loose), placePicture, sample: sampleMolecule, ws, slideList, presenter, Doc, keymap, names, sheetMode, sheetChem, docMode, docxBytes: () => writeDocx(docMode.file!.t, docFiles),
  pptxBytes: () => { const d = deckNow()!; return writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ id: s.id, layout: s.layout, doc: d.docOf(i), notes: s.notes, transition: s.transition, anims: s.anims, comments: s.comments })) }, pptxOptions()); } };

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
