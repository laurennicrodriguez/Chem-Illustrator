// Hotkeys as data. Every key is a binding from a key press to an action, in one of these
// places: pointing at an atom, at a bond, at empty space, anywhere, in slides, in sheets, in
// documents, or while typing a caption.
// The defaults copy ChemDraw (checked in ChemDraw 25, see the notes in DEFAULT_KEYS); the
// person's own changes are kept separately, as a small readable list in the settings file,
// so new defaults in later versions still reach them.

export type KeyContext = 'atom' | 'bond' | 'space' | 'command' | 'slides' | 'sheet' | 'document' | 'text';

export const CONTEXTS: { id: KeyContext; title: string; note: string }[] = [
  { id: 'atom', title: 'Pointing at an atom', note: 'Point at an atom (it highlights blue) and press the key. Letters are case-sensitive: F and f do different things.' },
  { id: 'bond', title: 'Pointing at a bond', note: 'Point at a bond and press the key.' },
  { id: 'space', title: 'Pointing at empty space', note: 'Switch tools when nothing is highlighted.' },
  { id: 'command', title: 'Anywhere', note: 'Menu commands. Plain keys here only work when nothing is highlighted.' },
  { id: 'slides', title: 'In slides', note: 'Menu commands for slides. While slides are showing, these keys come before the ones for anywhere.' },
  { id: 'sheet', title: 'In sheets', note: "Excel's keys for sheets. While a sheet is showing, these keys come before the ones for anywhere." },
  { id: 'document', title: 'In documents', note: "Word's keys for documents. While a document is showing, these come before the ones for typing and for anywhere." },
  { id: 'text', title: 'Typing text', note: 'Styling while typing a caption, a text box or a document.' },
];

/** The parts of a KeyboardEvent a key press is read from (so tests can pass plain objects). */
export interface KeyPress {
  key: string;
  code?: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  getModifierState?(key: string): boolean;
}

const MODIFIERS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock', 'NumLock', 'ScrollLock', 'Fn', 'FnLock', 'Hyper', 'Super', 'Symbol', 'OS', 'Dead', 'Unidentified', 'Process', 'Compose']);

/** Physical keys whose character is the same on most layouts, for Ctrl and Alt shortcuts. */
const CODE_CHARS: Record<string, string> = {
  Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`',
  NumpadAdd: '+', NumpadSubtract: '-', NumpadMultiply: '*', NumpadDivide: '/', NumpadDecimal: '.',
};

/**
 * The name of a key press, as stored in the key map:
 * - a plain character is itself, case and all ("f", "F" for Shift+F, "+", "'");
 * - other keys go by name, with Shift written out ("Enter", "Shift+Tab", "Space", "F5");
 * - with Ctrl or Alt, the modifiers come first in a fixed order and letters are capitals
 *   ("Ctrl+Shift+K", "Ctrl+Alt+C", "Alt+ArrowUp"). Cmd on a Mac counts as Ctrl.
 * Null for a modifier on its own.
 */
export function chordOf(e: KeyPress): string | null {
  const key = e.key;
  if (!key || MODIFIERS.has(key)) return null;
  const altGr = !!e.getModifierState?.('AltGraph');
  const ctrl = !altGr && !!(e.ctrlKey || e.metaKey);
  const alt = !altGr && !!e.altKey;
  const shift = !!e.shiftKey;
  const printable = key.length === 1 && key !== ' ';
  if (ctrl || alt) {
    // The letter or digit on the key, as the keyboard layout gives it (Ctrl+Z is Z on a German or
    // French keyboard too, wherever the key sits). Ctrl and Alt change the character on some
    // keyboards (Alt+K is ˚ on a Mac), and other alphabets have no A to Z, so then the physical
    // key is read instead.
    const code = e.code ?? '';
    let base: string;
    const m = /^Key([A-Z])$/.exec(code) || /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (/^[a-z0-9]$/i.test(key)) base = key.toUpperCase();
    else if (m) base = m[1];
    else if (CODE_CHARS[code]) base = CODE_CHARS[code];
    else if (printable) base = key.toUpperCase();
    else base = keyName(key);
    return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', base].filter(Boolean).join('+');
  }
  // the number pad's + and − (and a typed minus sign) work as the main keyboard's
  if (e.code === 'NumpadSubtract' || key === '−' || key === 'Subtract') return '-';
  if (e.code === 'NumpadAdd' || key === 'Add') return '+';
  if (printable) return key;
  return (shift ? 'Shift+' : '') + keyName(key);
}

function keyName(key: string): string {
  if (key === ' ') return 'Space';
  if (key === 'Esc') return 'Escape';
  if (key === 'Del') return 'Delete';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

const ARROWS: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };

/** A key as people read it: "Shift+F", "f", "Ctrl+Shift+K", "Alt+↑". */
export function displayChord(chord: string, mac = false): string {
  if (chord.length === 1) return /[A-Z]/.test(chord) ? `Shift+${chord}` : chord;
  const parts = chord.split('+');
  // "Ctrl++" splits into an empty last part
  if (chord.endsWith('++')) { parts.splice(parts.length - 2, 2, '+'); }
  return parts
    .map((p) => (p === 'Ctrl' && mac ? '⌘' : p === 'Alt' && mac ? '⌥' : ARROWS[p] ?? p))
    .join('+');
}

/** "label CF3" → verb "label", arg "CF3". */
export function parseAction(action: string): { verb: string; arg: string } {
  const i = action.indexOf(' ');
  return i < 0 ? { verb: action, arg: '' } : { verb: action.slice(0, i), arg: action.slice(i + 1) };
}

// ------------------------------------------------------------------ what each action is called

const ATOM_ACTIONS: Record<string, string> = {
  bond: 'Grow a bond (zig-zag)',
  'ring-bond': 'Grow a bond (ring mode: the other side; longer on busy atoms)',
  carbonyl: 'C=O (an end atom becomes C=O with the chain carrying on)',
  phenyl: 'Phenyl',
  wedge: 'Wedge (plus Me on an end atom)',
  'hash-wedge': 'Hashed wedge (plus Me on an end atom)',
  cyclohexyl: 'Cyclohexyl, or spiro on a ring atom',
  cyclopentyl: 'Cyclopentyl, or spiro on a ring atom',
  cyclobutyl: 'Cyclobutyl, or spiro on a CH2',
  cyclopropyl: 'Cyclopropyl, or spiro on a CH2',
  methylidene: '=CH2 (then 1 for E, 0 for Z)',
  dimethyl: 'Two methyls (iPr, gem-dimethyl)',
  tbu: 't-Bu (on a CH2 in a chain: a wedge and a plain bond)',
  'cp-hapto': 'η⁵-Cp on a metal',
  'arene-hapto': 'η⁶-benzene on a metal',
  alkyne: 'Alkyne',
  sulfonyl: 'Sulfonyl (SO2)',
  plus: 'Charge +1',
  minus: 'Charge −1',
  number: 'Show or hide the atom number',
  attach: 'Attachment point',
  nickname: 'Choose a nickname…',
  properties: 'Atom properties (Style panel)',
  'edit-label': 'Type a label',
  clear: 'Remove the label, then the atom',
  select: 'Select the atom',
};

const BOND_ACTIONS: Record<string, string> = {
  single: 'Single', double: 'Double', triple: 'Triple', dashed: 'Dashed', partial: 'Partial (transition state)', 'dashed-double': 'Dashed double',
  bold: 'Bold', 'bold-double': 'Bold double', wavy: 'Wavy', wedge: 'Wedge (again to reverse)',
  'hash-wedge': 'Hashed wedge (again to reverse)', hashed: 'Hashed', left: 'Double bond: second line left',
  center: 'Double bond: centred', right: 'Double bond: second line right', properties: 'Bond properties (Style panel)',
  select: 'Select the bond', delete: 'Delete the bond',
};

const FUSE_ACTIONS: Record<string, string> = {
  benzene: 'Fuse benzene', cyclopentadiene: 'Fuse cyclopentadiene', '3': 'Fuse cyclopropane', '4': 'Fuse cyclobutane',
  '5': 'Fuse cyclopentane', '6': 'Fuse cyclohexane', '7': 'Fuse cycloheptane', '8': 'Fuse cyclooctane',
  chair: 'Fuse a chair cyclohexane (trans on a chair)', 'chair-2': 'Fuse the other chair cyclohexane (cis on a chair)',
};

const HOTSPOT_ACTIONS: Record<string, string> = {
  left: 'Move the highlight left', right: 'Move the highlight right', up: 'Move the highlight up', down: 'Move the highlight down',
  'far-left': 'Move the highlight about 3 bonds left', 'far-right': 'Move the highlight about 3 bonds right',
  'far-up': 'Move the highlight about 3 bonds up', 'far-down': 'Move the highlight about 3 bonds down',
};

export const COMMAND_NAMES: Record<string, string> = {
  new: 'New drawing', open: 'Open…', save: 'Save', 'save-as': 'Save As…', 'export-mol': 'Export Molfile…',
  undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste',
  'copy-smiles': 'Copy as SMILES', 'paste-smiles': 'Paste SMILES', 'copy-mol': 'Copy as molfile', 'copy-cdxml': 'Copy as CDXML text',
  'select-all': 'Select all', 'next-structure': 'Select the next structure', 'prev-structure': 'Select the previous structure',
  'nudge-left': 'Nudge left 1 pt', 'nudge-right': 'Nudge right 1 pt', 'nudge-up': 'Nudge up 1 pt', 'nudge-down': 'Nudge down 1 pt',
  'nudge-far-left': 'Nudge left 10 pt', 'nudge-far-right': 'Nudge right 10 pt', 'nudge-far-up': 'Nudge up 10 pt', 'nudge-far-down': 'Nudge down 10 pt',
  'align-left': 'Align left edges', 'align-hcenter': 'Align centres across', 'align-right': 'Align right edges',
  'align-top': 'Align top edges', 'align-vcenter': 'Align middles down', 'align-bottom': 'Align bottom edges',
  'distribute-h': 'Space evenly across', 'distribute-v': 'Space evenly down',
  'flip-h': 'Flip left to right', 'flip-v': 'Flip top to bottom',
  'rotate-cw': 'Rotate 90° clockwise', 'rotate-ccw': 'Rotate 90° anticlockwise', 'rotate-180': 'Rotate 180°',
  'turn-ccw-1': 'Turn 1° anticlockwise', 'turn-cw-1': 'Turn 1° clockwise',
  'turn-ccw-15': 'Turn 15° anticlockwise', 'turn-cw-15': 'Turn 15° clockwise',
  'rotate-dialog': 'Rotate by an angle…', scale: 'Scale…',
  'reaction-right': 'Reaction: arrow and copy to the right', 'reaction-left': 'Reaction: arrow and copy to the left',
  'reaction-down': 'Reaction: arrow and copy below', 'reaction-up': 'Reaction: arrow and copy above',
  'fixed-length': 'Fixed bond lengths on or off', 'fixed-angles': 'Fixed angles on or off',
  join: 'Join two selected atoms or bonds',
  'clean-up': 'Clean Up Structure', 'aromatic-circles': 'Aromatic rings: circle or double bonds', 'periodic-table': 'Periodic Table…', 'chain-ends': 'Show terminal methyls (or hide)', 'methyls-ch3': 'Terminal methyls as CH3', 'methyls-me': 'Terminal methyls as Me', highlight: 'Highlight', 'remove-highlight': 'Remove Highlight', 'smooth-highlight': 'Smooth Highlight (on or off)', 'centre-highlight': 'Centre Highlight on Double Bonds (on or off)', 'soft-highlight': 'Soft Highlight Edges (on or off)', 'outline-highlight': 'Outline-Only Highlight (on or off)', 'shadow-highlight': 'Highlight Shadow (on or off)', 'glow-highlight': 'Highlight Glow (on or off)', 'highlight-look': 'Highlight Look…', 'select-highlight': 'Select Highlight', 'save-highlight-look': 'Save Highlight Look…', 'delete-highlight-look': 'Delete Highlight Look…', 'fill-rings': 'Fill Rings', 'ring-shadow': 'Ring Fill Shadow (on or off)', 'contract-label': 'Contract Label…', 'expand-label': 'Expand Label', 'hapto-bond': 'Bond Metal to Ring (η)', 'split-hapto': 'Split Hapto Bond', 'define-nickname': 'Define Nickname…', 'delete-nickname': 'Delete Nickname…', 'save-template': 'Save as Template…', 'delete-template': 'Delete Template…', 'explicit-h': 'H atoms: hide or draw', 'clean-up-reaction': 'Clean Up Reaction', 'clean-up-arrow': 'Clean Up Arrow', 'arrow-s-shape': 'Make S-Shaped Arrow', 'arrow-single-curve': 'Make Single-Curve Arrow', 'flip-arrow-bend': 'Flip Arrow Bend', 'homolysis-arrows': 'Homolysis Arrows (fishhook pair)', 'attach-arrow': 'Attach to Structure', 'detach-arrow': 'Detach from Structure', 'command-search': 'Search Commands…', 'help-here': 'Help on This Tool or Mode', group: 'Group', ungroup: 'Ungroup', 'link-text': 'Link Text to Structure', 'unlink-text': 'Unlink Text', 'next-region': 'Next part of the window', 'prev-region': 'Previous part of the window', print: 'Print…', 'arrange-scheme': 'Arrange Scheme…', 'catalytic-cycle': 'Catalytic Cycle…', 'energy-diagram': 'Energy Diagram…', 'ts-brackets': 'Transition State Brackets ‡', 'edit-energy': 'Edit Energy Diagram…', 'insert-diagram': 'Diagram…', 'edit-diagram': 'Edit Diagram…', 'diagram-to-shapes': 'Convert Diagram to Shapes', 'animate-reaction': 'Animate Reaction…', 'animate-step': 'Animate This Step…', 'number-compounds': 'Number Compounds…', 'scheme-settings': 'Scheme Settings…', 'add-id-label': 'Add ID Label', 'lock-structures': 'Lock structures (Slides)', 'add-caption': 'Add Caption', 'bring-front': 'Bring Bond to Front', 'send-back': 'Send Bond to Back', 'show-roles': 'Show reaction roles on or off', 'check-structure': 'Check Structure (next warning)', 'stereo-labels': 'Show stereo labels',
  'name-to-structure': 'Name to Structure…',
  'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', 'zoom-fit': 'Fit the drawing in the window', 'zoom-actual': 'Actual size',
  hotkeys: 'Hotkeys…', 'typing-spelling': 'Typing and Spelling…', 'mode-colours': 'Mode Colours…', 'edit-palettes': 'Colour Palettes…', preferences: 'Settings…',
  'new-slides': 'New slides', 'close-tab': 'Close the file', 'next-tab': 'Next file', 'prev-tab': 'Previous file',
  'export-pdf': 'Export PDF…', 'insert-picture': 'Insert a picture…', crop: 'Crop the selected picture',
  'new-slide': 'New slide', 'duplicate-slide': 'Duplicate slide', 'delete-slide': 'Delete slide',
  'cut-slides': 'Cut slides', 'copy-slides': 'Copy slides', 'paste-slides': 'Paste slides', 'paste-slides-keep': 'Paste slides keeping their own look',
  'hide-slide': 'Hide slide (or show it again)', 'selection-pane': 'Selection Pane: every object on the slide, to pick, hide or rename', 'reuse-slides': 'Reuse slides from another PowerPoint file…',
  'next-slide': 'Next slide', 'prev-slide': 'Previous slide', 'slide-master': 'Slide Master…', 'format-background': 'Format Background… (colour, gradient, picture or pattern)',
  present: 'Present from the first slide', 'present-current': 'Present from this slide', 'presenter-view': 'Presenter View (notes, next slide and timer)',
  'dev-tools': 'Developer tools on or off (speed panel, stress test)',
  // sheets
  'new-sheet': 'New sheet', 'insert-sheet': 'Insert a worksheet',
  'cell-bold': 'Bold (cells)', 'cell-italic': 'Italic (cells)', 'cell-underline': 'Underline (cells)',
  'fill-down': 'Fill down', 'fill-right': 'Fill right', autosum: 'AutoSum', find: 'Find…',
  'format-cells': 'Number format (in the panel)', 'format-general': 'General number format', 'format-number': 'Number with 2 decimal places',
  'format-percent': 'Percentage', 'format-scientific': 'Scientific notation', 'format-chem': 'Formula style in cells on or off',
  'insert-cells': 'Insert rows or columns', 'delete-cells': 'Delete rows or columns',
  'hide-rows': 'Hide rows', 'unhide-rows': 'Show hidden rows', 'hide-cols': 'Hide columns', 'unhide-cols': 'Show hidden columns',
  'sort-up': 'Sort smallest to largest', 'sort-down': 'Sort largest to smallest', filter: 'Filter on or off',
  'filter-structure': 'Filter by a substructure…', 'freeze-header': 'Freeze the header row on or off',
  'property-column': 'Insert property column…', 'isotope-pattern': 'Isotope pattern…', 'structure-from-name': 'Structure from name or SMILES…',
  'draw-structure': 'Draw a structure in the cell', 'reset-calculated': 'Reset to the calculated value',
  'merge-cells': 'Merge and centre',
  'new-note': 'New note on the cell (or change its note)', 'edit-note': 'Change the cell\'s note', 'delete-note': 'Delete the notes and comments in the selection',
  'show-note': 'Show the cell\'s note all the time (or only when pointed at)', 'show-all-notes': 'Show all notes (on or off)', 'convert-notes': 'Convert notes to comments',
  'data-validation': 'Data validation…', 'circle-invalid': 'Circle invalid data (on or off)', 'pick-from-list': 'Pick from the drop-down list',
  'insert-picture-sheet': 'Insert a picture over the cells…', 'insert-text-box': 'Insert a text box over the cells', 'format-object': 'Format the picked shape or picture…',
  'page-setup': 'Page setup…', 'header-footer': 'Header and footer…', 'print-titles': 'Print titles…', 'page-scale': 'Print scale…',
  'set-print-area': 'Set the print area to the selection', 'clear-print-area': 'Clear the print area', 'insert-page-break': 'Insert a page break',
  'print-gridlines': 'Print gridlines (on or off)', 'print-headings': 'Print row and column headings (on or off)', 'show-page-breaks': 'Show page breaks (on or off)', 'print-preview': 'Print preview',
  // documents
  'new-document': 'New document', 'doc-align-left': 'Align text left', 'doc-align-center': 'Centre text', 'doc-align-right': 'Align text right',
  'doc-justify': 'Justify text', 'style-normal': 'Normal style', 'style-title': 'Title style', 'style-h1': 'Heading 1 style', 'style-h2': 'Heading 2 style',
  'style-h3': 'Heading 3 style', 'style-caption': 'Caption style', 'page-break': 'Page break', 'col-break': 'Column break', 'breaks-nextPage': 'Section break (next page)', 'breaks-continuous': 'Section break (continuous)', 'breaks-evenPage': 'Section break (even page)', 'breaks-oddPage': 'Section break (odd page)', 'linenums-continuous': 'Line numbers', 'linenums-none': 'No line numbers', 'linenums-options': 'Line numbering options…', 'page-number-format': 'Page number format…', 'line-single': 'Single line spacing',
  'line-1-5': '1.5 line spacing', 'line-double': 'Double line spacing', 'font-bigger': 'Larger text', 'font-smaller': 'Smaller text',
  'doc-bullets': 'Bullets', 'doc-numbering': 'Numbering', replace: 'Find and replace…', 'insert-structure': 'Insert a structure (draw it)',
  'insert-caption': 'Insert a caption…', 'cross-reference': 'Insert a cross-reference…', 'compound-number': 'Insert a compound number…', 'structure-from-name-doc': 'Insert a structure from a name or SMILES…',
  'insert-citation': 'Insert a citation…', 'insert-bibliography': 'Insert the bibliography', 'manage-references': 'Manage references…',
  'insert-toc': 'Insert a table of contents…', 'insert-tof': 'Insert a table of figures…', 'insert-footnote': 'Insert a footnote', 'insert-link': 'Insert or change a link (web page, DOI, file, place in the file)…', 'remove-link': 'Remove the link', 'open-link': 'Open the link', 'insert-bookmark': 'Insert, go to or delete a bookmark…', 'insert-endnote': 'Insert an endnote', 'note-options': 'Footnote and endnote options…', 'insert-equation': 'Insert an equation…', 'edit-equation': 'Change the equation…', 'track-changes': 'Track changes (on or off)', 'accept-change': 'Accept the change', 'reject-change': 'Reject the change',
  'accept-all': 'Accept all changes', 'reject-all': 'Reject all changes', 'next-change': 'Next change', 'prev-change': 'Previous change', 'review-name': 'Your name on changes…', 'compare-docs': 'Compare two versions of a document…', 'combine-docs': 'Combine reviewers\' copies of a document…', 'new-comment': 'New comment', 'delete-comment': 'Delete the comment', 'delete-all-comments': 'Delete all comments', 'resolve-comment': 'Resolve the comment (or reopen it)', 'next-comment': 'Next comment', 'prev-comment': 'Previous comment', 'show-comments': 'Show comments (on or off)',
  'view-print': 'Print Layout view', 'view-read': 'Read Mode', 'view-web': 'Web Layout view', 'view-outline': 'Outline view', 'view-draft': 'Draft view',
  'view-sideways': 'Pages side to side (on or off)', 'view-multiple': 'Multiple pages (on or off)', 'view-one-page': 'One page', 'view-split': 'Split the window (on or off)',
  'doc-new-window': 'New window on the document', 'outline-promote': 'Promote (outline)', 'outline-demote': 'Demote (outline)', 'outline-heading1': 'Promote to Heading 1',
  'outline-body': 'Demote to body text', 'outline-up': 'Move the paragraph up (outline)', 'outline-down': 'Move the paragraph down (outline)',
  'outline-expand': 'Expand the heading (outline)', 'outline-collapse': 'Collapse the heading (outline)', 'outline-all': 'Show all levels (outline)',
  'outline-level-1': 'Show level 1 (outline)', 'outline-level-2': 'Show levels 1 and 2 (outline)', 'outline-level-3': 'Show levels 1 to 3 (outline)',
  'outline-first': 'Show the first line only (outline, on or off)', 'outline-format': 'Show text formatting (outline, on or off)',
};

const TEXT_ACTIONS: Record<string, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', sub: 'Subscript', sup: 'Superscript', formula: 'Formula style', link: 'Insert or change a link…',
};

/** Tool names, filled in by the app (the tool bar knows what each tool is called). */
let toolNames: Record<string, string> = {};
export function registerToolNames(names: Record<string, string>): void {
  toolNames = { ...names };
}

const TABLES: Record<string, Record<string, string>> = {
  atom: ATOM_ACTIONS, bond: BOND_ACTIONS, fuse: FUSE_ACTIONS, hotspot: HOTSPOT_ACTIONS, command: COMMAND_NAMES, text: TEXT_ACTIONS,
};

/** What an action is called in the Hotkeys window and tool tips. */
export function actionName(action: string): string {
  const { verb, arg } = parseAction(action);
  if (verb === 'label') return `Label ${arg}`;
  if (verb === 'tool') return toolNames[arg] ? `${toolNames[arg]} tool` : `Tool: ${arg}`;
  return TABLES[verb]?.[arg] ?? action;
}

/** Every action that can have a key in a place, whether or not it has one now. */
export function actionsFor(ctx: KeyContext): string[] {
  const pre = (verb: string, table: Record<string, string>) => Object.keys(table).map((k) => `${verb} ${k}`);
  switch (ctx) {
    case 'atom': return [...pre('atom', ATOM_ACTIONS), ...pre('hotspot', HOTSPOT_ACTIONS)];
    case 'bond': return [...pre('bond', BOND_ACTIONS), ...pre('fuse', FUSE_ACTIONS), ...pre('hotspot', HOTSPOT_ACTIONS)];
    case 'space': return Object.keys(toolNames).map((t) => `tool ${t}`);
    case 'command': case 'slides': case 'sheet': case 'document': return pre('command', COMMAND_NAMES);
    case 'text': return pre('text', TEXT_ACTIONS);
  }
}

/** Whether an action string means something in a place (labels on atoms, tools in space…). */
export function validAction(ctx: KeyContext, action: string): boolean {
  const { verb, arg } = parseAction(action);
  if (!arg) return false;
  switch (ctx) {
    case 'atom': return verb === 'label' || (verb === 'atom' && arg in ATOM_ACTIONS) || (verb === 'hotspot' && arg in HOTSPOT_ACTIONS);
    case 'bond': return (verb === 'bond' && arg in BOND_ACTIONS) || (verb === 'fuse' && arg in FUSE_ACTIONS) || (verb === 'hotspot' && arg in HOTSPOT_ACTIONS);
    case 'space': return verb === 'tool';
    case 'command': case 'slides': case 'sheet': case 'document': return verb === 'command' && arg in COMMAND_NAMES;
    case 'text': return verb === 'text' && arg in TEXT_ACTIONS;
  }
}

// ------------------------------------------------------------------ ChemDraw's defaults

const labels = (m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `label ${v}`]));
const verbs = (verb: string, m: Record<string, string>) => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, `${verb} ${v}`]));
const HOTSPOT_KEYS = verbs('hotspot', {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  'Shift+ArrowLeft': 'far-left', 'Shift+ArrowRight': 'far-right', 'Shift+ArrowUp': 'far-up', 'Shift+ArrowDown': 'far-down',
});

/**
 * ChemDraw's default keys (User Guide pp. 67–84, then checked in ChemDraw 25). Where the guide
 * and ChemDraw disagree, ChemDraw wins: k on an atom makes a sulfonyl group, not a K label.
 */
export const DEFAULT_KEYS: Record<KeyContext, Record<string, string>> = {
  atom: {
    ...labels({
      f: 'F', F: 'CF3', p: 'P', P: 'Ph', A: 'Ac', h: 'H', b: 'Br', B: 'B', i: 'I', r: 'R',
      s: 'S', S: 'Si', m: 'Me', n: 'N', w: 'N', N: 'NO2', c: 'C', l: 'Cl', C: 'Cl', x: 'X',
      o: 'O', q: 'O', d: 'D', e: 'Et', E: 'CO2Me', Z: 'N3', M: 'MgBr', L: 'Li', O: 'OMe',
      Q: 'Fmoc', H: 'Cbz', y: 'Boc', Y: 'Boc',
    }),
    ...verbs('atom', {
      '0': 'ring-bond', '1': 'bond', '2': 'carbonyl', '3': 'phenyl', a: 'phenyl', '4': 'wedge', '5': 'hash-wedge',
      '6': 'cyclohexyl', '7': 'cyclopentyl', '8': 'methylidene', '9': 'dimethyl', z: 'alkyne', v: 'cyclopropyl',
      u: 'cyclobutyl', K: 'tbu', k: 'sulfonyl', '+': 'plus', '-': 'minus', "'": 'number', '.': 'attach',
      '=': 'nickname', '/': 'properties', '?': 'properties', Enter: 'edit-label', Backspace: 'clear', Delete: 'clear',
      g: 'select', j: 'cp-hapto', J: 'arene-hapto',
    }),
    ...HOTSPOT_KEYS,
  },
  bond: {
    ...verbs('bond', {
      '1': 'single', '2': 'double', '3': 'triple', d: 'dashed', p: 'partial', D: 'dashed-double', b: 'bold', B: 'bold-double',
      y: 'wavy', w: 'wedge', h: 'hash-wedge', W: 'hash-wedge', H: 'hashed', l: 'left', c: 'center', r: 'right',
      '/': 'properties', '?': 'properties', g: 'select', Delete: 'delete', Backspace: 'delete',
    }),
    ...verbs('fuse', {
      a: 'benzene', z: 'cyclopentadiene', v: '3', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': 'chair', '0': 'chair-2',
    }),
    ...HOTSPOT_KEYS,
  },
  space: verbs('tool', {
    Space: 'select', x: 'bond-single', X: 'chain', t: 'text', e: 'arrow', j: 'ring-benzene', J: 'ring-cp',
    T: 'bracket-square',
    // not ChemDraw's, but free keys over empty space
    w: 'bond-wedge', h: 'bond-hashWedge', '2': 'bond-double', '3': 'ring-3', '4': 'ring-4', '5': 'ring-5',
    '6': 'ring-6', '7': 'ring-7', '8': 'ring-8',
  }),
  command: verbs('command', {
    'Ctrl+N': 'new', 'Ctrl+O': 'open', 'Ctrl+S': 'save', 'Ctrl+Shift+S': 'save-as',
    'Ctrl+Z': 'undo', 'Ctrl+Y': 'redo', 'Ctrl+Shift+Z': 'redo',
    'Ctrl+X': 'cut', 'Ctrl+C': 'copy', 'Ctrl+V': 'paste',
    'Ctrl+Alt+C': 'copy-smiles', 'Ctrl+Alt+P': 'paste-smiles', 'Ctrl+Alt+O': 'copy-mol', 'Ctrl+D': 'copy-cdxml',
    'Ctrl+A': 'select-all', Tab: 'next-structure', 'Shift+Tab': 'prev-structure',
    ArrowLeft: 'nudge-left', ArrowRight: 'nudge-right', ArrowUp: 'nudge-up', ArrowDown: 'nudge-down',
    'Shift+ArrowLeft': 'nudge-far-left', 'Shift+ArrowRight': 'nudge-far-right', 'Shift+ArrowUp': 'nudge-far-up', 'Shift+ArrowDown': 'nudge-far-down',
    'Ctrl+Alt+Shift+L': 'align-left', 'Ctrl+Alt+Shift+C': 'align-hcenter', 'Ctrl+Alt+Shift+R': 'align-right',
    'Ctrl+Alt+Shift+T': 'align-top', 'Ctrl+Alt+Shift+M': 'align-vcenter', 'Ctrl+Alt+Shift+B': 'align-bottom',
    'Ctrl+Alt+Shift+H': 'distribute-h', 'Ctrl+Alt+Shift+V': 'distribute-v',
    'Ctrl+Shift+H': 'flip-h', 'Ctrl+Shift+V': 'flip-v',
    'Alt+ArrowLeft': 'turn-ccw-1', 'Alt+ArrowRight': 'turn-cw-1', 'Alt+ArrowUp': 'turn-ccw-15', 'Alt+ArrowDown': 'turn-cw-15',
    'Ctrl+R': 'rotate-dialog', 'Ctrl+K': 'scale',
    'Ctrl+ArrowRight': 'reaction-right', 'Ctrl+ArrowLeft': 'reaction-left', 'Ctrl+ArrowDown': 'reaction-down', 'Ctrl+ArrowUp': 'reaction-up',
    'Ctrl+L': 'fixed-length', 'Ctrl+E': 'fixed-angles', 'Ctrl+J': 'join', 'Ctrl+G': 'group', 'Ctrl+Shift+G': 'ungroup',
    'Ctrl+Shift+K': 'clean-up', 'Alt+K': 'aromatic-circles', 'Ctrl+Shift+R': 'clean-up-reaction', 'Ctrl+Shift+N': 'name-to-structure',
    'Ctrl+0': 'zoom-fit', 'Ctrl+=': 'zoom-in', 'Ctrl+Shift+=': 'zoom-in', 'Ctrl++': 'zoom-in', 'Ctrl+-': 'zoom-out',
    F5: 'zoom-actual', F6: 'zoom-fit', F7: 'zoom-in', F8: 'zoom-out',
    'Ctrl+W': 'close-tab', 'Ctrl+Tab': 'next-tab', 'Ctrl+Shift+Tab': 'prev-tab', 'Alt+Q': 'command-search', F1: 'help-here', 'Ctrl+,': 'preferences', 'Ctrl+P': 'print', 'Ctrl+F6': 'next-region', 'Ctrl+Shift+F6': 'prev-region',
  }),
  // PowerPoint's keys
  slides: verbs('command', {
    'Alt+F10': 'selection-pane', F5: 'present', 'Shift+F5': 'present-current', 'Alt+F5': 'presenter-view', 'Ctrl+M': 'new-slide', 'Ctrl+N': 'new-slides',
    PageDown: 'next-slide', PageUp: 'prev-slide', 'Ctrl+Alt+M': 'new-comment', 'Alt+=': 'insert-equation', 'Ctrl+K': 'insert-link',
  }),
  // Excel's keys
  sheet: verbs('command', {
    'Ctrl+B': 'cell-bold', 'Ctrl+I': 'cell-italic', 'Ctrl+U': 'cell-underline',
    'Ctrl+2': 'cell-bold', 'Ctrl+3': 'cell-italic', 'Ctrl+4': 'cell-underline',
    'Ctrl+D': 'fill-down', 'Ctrl+R': 'fill-right', 'Alt+=': 'autosum', 'Ctrl+F': 'find', 'Ctrl+1': 'format-cells',
    'Ctrl+Shift+`': 'format-general', 'Ctrl+Shift+1': 'format-number', 'Ctrl+Shift+5': 'format-percent', 'Ctrl+Shift+6': 'format-scientific',
    'Ctrl+Shift+=': 'insert-cells', 'Ctrl++': 'insert-cells', 'Ctrl+-': 'delete-cells',
    'Ctrl+9': 'hide-rows', 'Ctrl+Shift+9': 'unhide-rows', 'Ctrl+0': 'hide-cols', 'Ctrl+Shift+0': 'unhide-cols',
    'Ctrl+Shift+L': 'filter', 'Ctrl+N': 'new-sheet', 'Shift+F11': 'insert-sheet',
    'Ctrl+Shift+N': 'structure-from-name', 'Shift+F2': 'new-note', 'Ctrl+Alt+M': 'new-comment', 'Ctrl+K': 'insert-link',
  }),
  // Word's keys
  document: verbs('command', {
    'Ctrl+L': 'doc-align-left', 'Ctrl+E': 'doc-align-center', 'Ctrl+R': 'doc-align-right', 'Ctrl+J': 'doc-justify',
    'Ctrl+Alt+1': 'style-h1', 'Ctrl+Alt+2': 'style-h2', 'Ctrl+Alt+3': 'style-h3', 'Ctrl+Shift+N': 'style-normal',
    'Ctrl+Enter': 'page-break', 'Ctrl+Shift+Enter': 'col-break', 'Ctrl+1': 'line-single', 'Ctrl+5': 'line-1-5', 'Ctrl+2': 'line-double',
    'Ctrl+]': 'font-bigger', 'Ctrl+[': 'font-smaller', 'Ctrl+Shift+L': 'doc-bullets',
    'Ctrl+F': 'find', 'Ctrl+H': 'replace', 'Ctrl+N': 'new-document', 'Ctrl+Shift+E': 'track-changes', 'Ctrl+Alt+M': 'new-comment', 'Alt+=': 'insert-equation',
    'Ctrl+Alt+F': 'insert-footnote', 'Ctrl+Alt+D': 'insert-endnote', 'Ctrl+K': 'insert-link', 'Ctrl+Shift+F5': 'insert-bookmark',
    'Ctrl+Alt+N': 'view-draft', 'Ctrl+Alt+S': 'view-split',
    'Alt+Shift+ArrowLeft': 'outline-promote', 'Alt+Shift+ArrowRight': 'outline-demote', 'Alt+Shift+ArrowUp': 'outline-up', 'Alt+Shift+ArrowDown': 'outline-down',
    'Alt+Shift+=': 'outline-expand', 'Alt+Shift+-': 'outline-collapse', 'Alt+Shift+A': 'outline-all', 'Alt+Shift+N': 'compound-number',
    'Alt+Shift+1': 'outline-level-1', 'Alt+Shift+2': 'outline-level-2', 'Alt+Shift+3': 'outline-level-3',
  }),
  text: verbs('text', {
    'Ctrl+B': 'bold', 'Ctrl+I': 'italic', 'Ctrl+U': 'underline', 'Ctrl+=': 'sub', 'Ctrl+Shift+=': 'sup', 'Ctrl++': 'sup',
    F9: 'sub', F10: 'sup', 'Ctrl+F': 'formula', 'Ctrl+K': 'link',
  }),
};

// ------------------------------------------------------------------ the person's key map

/** The person's changes: a key bound to a different action, or null for a default key removed. */
export type KeyOverrides = Partial<Record<KeyContext, Record<string, string | null>>>;

const CTX_IDS = CONTEXTS.map((c) => c.id);

export class Keymap {
  private maps = {} as Record<KeyContext, Map<string, string>>;
  private changes: KeyOverrides = {};
  private listeners: (() => void)[] = [];

  constructor(overrides: KeyOverrides = {}) {
    this.setOverrides(overrides);
  }

  /** The action a key does in a place, if any. */
  lookup(ctx: KeyContext, chord: string): string | undefined {
    return this.maps[ctx].get(chord);
  }

  /** The keys that do an action in a place, defaults first. */
  keysFor(ctx: KeyContext, action: string): string[] {
    const out: string[] = [];
    for (const [k, a] of this.maps[ctx]) if (a === action) out.push(k);
    return out;
  }

  /** Every binding in a place. */
  entries(ctx: KeyContext): [string, string][] {
    return [...this.maps[ctx]];
  }

  /**
   * Give a key an action in a place (null takes the key away). Returns the action the key did
   * before, if it was something else, so the window can say that action lost its key.
   */
  bind(ctx: KeyContext, chord: string, action: string | null): string | undefined {
    const before = this.maps[ctx].get(chord);
    const def = DEFAULT_KEYS[ctx][chord];
    const ch = (this.changes[ctx] ??= {});
    if ((action ?? undefined) === def) delete ch[chord];
    else ch[chord] = action;
    if (!Object.keys(ch).length) delete this.changes[ctx];
    this.rebuild(ctx);
    this.emit();
    return before !== undefined && before !== action ? before : undefined;
  }

  /** Whether a key in a place is as ChemDraw has it. */
  isDefault(ctx: KeyContext, chord: string): boolean {
    return !this.changes[ctx] || !(chord in this.changes[ctx]!);
  }

  /** Whether an action's keys are as ChemDraw has them. */
  actionIsDefault(ctx: KeyContext, action: string): boolean {
    const ch = this.changes[ctx];
    if (!ch) return true;
    for (const [k, a] of Object.entries(ch)) if (a === action || DEFAULT_KEYS[ctx][k] === action) return false;
    return true;
  }

  /** Put one action's keys back to ChemDraw's. */
  resetAction(ctx: KeyContext, action: string): void {
    const ch = this.changes[ctx];
    if (!ch) return;
    for (const [k, a] of Object.entries(ch)) if (a === action || DEFAULT_KEYS[ctx][k] === action) delete ch[k];
    if (!Object.keys(ch).length) delete this.changes[ctx];
    this.rebuild(ctx);
    this.emit();
  }

  /** Back to ChemDraw's keys everywhere. */
  resetAll(): void {
    this.setOverrides({});
  }

  /** The person's changes, ready to save. */
  overrides(): KeyOverrides {
    return JSON.parse(JSON.stringify(this.changes));
  }

  /** Load saved changes. Anything that doesn't make sense is skipped, never fatal. */
  setOverrides(o: KeyOverrides): void {
    this.changes = {};
    for (const ctx of CTX_IDS) {
      const src = o?.[ctx];
      if (!src || typeof src !== 'object') continue;
      const ch: Record<string, string | null> = {};
      for (const [k, v] of Object.entries(src)) {
        if (!k) continue;
        if (v === null) { if (k in DEFAULT_KEYS[ctx]) ch[k] = null; }
        else if (typeof v === 'string' && validAction(ctx, v)) ch[k] = v;
      }
      if (Object.keys(ch).length) this.changes[ctx] = ch;
    }
    for (const ctx of CTX_IDS) this.rebuild(ctx);
    this.emit();
  }

  onChange(fn: () => void): void {
    this.listeners.push(fn);
  }

  private rebuild(ctx: KeyContext): void {
    const m = new Map(Object.entries(DEFAULT_KEYS[ctx]));
    for (const [k, v] of Object.entries(this.changes[ctx] ?? {})) {
      if (v === null) m.delete(k);
      else m.set(k, v);
    }
    this.maps[ctx] = m;
  }

  private emit(): void {
    for (const f of this.listeners) f();
  }
}

/** The app's key map. */
export const keymap = new Keymap();
