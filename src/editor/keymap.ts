// Hotkeys as data. Every key is a binding from a key press to an action, in one of five
// places: pointing at an atom, at a bond, at empty space, anywhere, or while typing a caption.
// The defaults copy ChemDraw (checked in ChemDraw 25, see the notes in DEFAULT_KEYS); the
// person's own changes are kept separately, as a small readable list in the settings file,
// so new defaults in later versions still reach them.

export type KeyContext = 'atom' | 'bond' | 'space' | 'command' | 'text';

export const CONTEXTS: { id: KeyContext; title: string; note: string }[] = [
  { id: 'atom', title: 'Pointing at an atom', note: 'Point at an atom (it highlights blue) and press the key. Letters are case-sensitive: F and f do different things.' },
  { id: 'bond', title: 'Pointing at a bond', note: 'Point at a bond and press the key.' },
  { id: 'space', title: 'Pointing at empty space', note: 'Switch tools when nothing is highlighted.' },
  { id: 'command', title: 'Anywhere', note: 'Menu commands. Plain keys here only work when nothing is highlighted.' },
  { id: 'text', title: 'Typing a caption', note: 'Styling while the caption editor is open.' },
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
    // Ctrl and Alt change the character on some keyboards (Alt+K is ˚ on a Mac), so read
    // letters, digits and common punctuation from the physical key instead.
    const code = e.code ?? '';
    let base: string;
    const m = /^Key([A-Z])$/.exec(code) || /^(?:Digit|Numpad)(\d)$/.exec(code);
    if (m) base = m[1];
    else if (CODE_CHARS[code]) base = CODE_CHARS[code];
    else if (printable) base = key.toUpperCase();
    else base = keyName(key);
    return [ctrl && 'Ctrl', alt && 'Alt', shift && 'Shift', base].filter(Boolean).join('+');
  }
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
  carbonyl: 'C=O, or acetyl on an end atom',
  phenyl: 'Phenyl',
  wedge: 'Wedge (plus Me on an end atom)',
  'hash-wedge': 'Hashed wedge (plus Me on an end atom)',
  cyclohexyl: 'Cyclohexyl, or spiro on a ring atom',
  cyclopentyl: 'Cyclopentyl, or spiro on a ring atom',
  cyclobutyl: 'Cyclobutyl',
  cyclopropyl: 'Cyclopropyl',
  methylidene: '=CH2 (then 1 for E, 0 for Z)',
  dimethyl: 'Two methyls (iPr, gem-dimethyl)',
  tbu: 't-Bu',
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
  single: 'Single', double: 'Double', triple: 'Triple', dashed: 'Dashed', 'dashed-double': 'Dashed double',
  bold: 'Bold', 'bold-double': 'Bold double', wavy: 'Wavy', wedge: 'Wedge (again to reverse)',
  'hash-wedge': 'Hashed wedge (again to reverse)', hashed: 'Hashed', left: 'Double bond: second line left',
  center: 'Double bond: centred', right: 'Double bond: second line right', properties: 'Bond properties (Style panel)',
  select: 'Select the bond', delete: 'Delete the bond',
};

const FUSE_ACTIONS: Record<string, string> = {
  benzene: 'Fuse benzene', cyclopentadiene: 'Fuse cyclopentadiene', '3': 'Fuse cyclopropane', '4': 'Fuse cyclobutane',
  '5': 'Fuse cyclopentane', '6': 'Fuse cyclohexane', '7': 'Fuse cycloheptane', '8': 'Fuse cyclooctane',
  chair: 'Fuse a chair cyclohexane', 'chair-2': 'Fuse the other chair cyclohexane',
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
  'clean-up': 'Clean Up Structure', 'check-structure': 'Check Structure (next warning)', 'stereo-labels': 'Show stereo labels',
  'name-to-structure': 'Name to Structure…',
  'zoom-in': 'Zoom in', 'zoom-out': 'Zoom out', 'zoom-fit': 'Fit the drawing in the window', 'zoom-actual': 'Actual size',
  hotkeys: 'Hotkeys…',
};

const TEXT_ACTIONS: Record<string, string> = {
  bold: 'Bold', italic: 'Italic', underline: 'Underline', sub: 'Subscript', sup: 'Superscript', formula: 'Formula style',
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
    case 'command': return pre('command', COMMAND_NAMES);
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
    case 'command': return verb === 'command' && arg in COMMAND_NAMES;
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
      Q: 'Fmoc', H: 'Cbz', Y: 'Boc',
    }),
    ...verbs('atom', {
      '0': 'ring-bond', '1': 'bond', '2': 'carbonyl', '3': 'phenyl', a: 'phenyl', '4': 'wedge', '5': 'hash-wedge',
      '6': 'cyclohexyl', '7': 'cyclopentyl', '8': 'methylidene', '9': 'dimethyl', z: 'alkyne', v: 'cyclopropyl',
      u: 'cyclobutyl', K: 'tbu', k: 'sulfonyl', '+': 'plus', '-': 'minus', "'": 'number', '.': 'attach',
      '=': 'nickname', '/': 'properties', '?': 'properties', Enter: 'edit-label', Backspace: 'clear', Delete: 'clear',
      g: 'select',
    }),
    ...HOTSPOT_KEYS,
  },
  bond: {
    ...verbs('bond', {
      '1': 'single', '2': 'double', '3': 'triple', d: 'dashed', D: 'dashed-double', b: 'bold', B: 'bold-double',
      y: 'wavy', w: 'wedge', h: 'hash-wedge', H: 'hashed', l: 'left', c: 'center', r: 'right',
      '/': 'properties', '?': 'properties', g: 'select', Delete: 'delete', Backspace: 'delete',
    }),
    ...verbs('fuse', {
      a: 'benzene', z: 'cyclopentadiene', '4': '4', '5': '5', '6': '6', '7': '7', '8': '8', '9': 'chair', '0': 'chair-2',
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
    'Ctrl+L': 'fixed-length', 'Ctrl+E': 'fixed-angles', 'Ctrl+J': 'join',
    'Ctrl+Shift+K': 'clean-up', 'Ctrl+Shift+N': 'name-to-structure',
    'Ctrl+0': 'zoom-fit', 'Ctrl+=': 'zoom-in', 'Ctrl+Shift+=': 'zoom-in', 'Ctrl++': 'zoom-in', 'Ctrl+-': 'zoom-out',
    F5: 'zoom-actual', F6: 'zoom-fit', F7: 'zoom-in', F8: 'zoom-out',
  }),
  text: verbs('text', {
    'Ctrl+B': 'bold', 'Ctrl+I': 'italic', 'Ctrl+U': 'underline', 'Ctrl+=': 'sub', 'Ctrl+Shift+=': 'sup', 'Ctrl++': 'sup',
    F9: 'sub', F10: 'sup', 'Ctrl+F': 'formula',
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
