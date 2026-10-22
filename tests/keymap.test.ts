// The key map: how key presses are named, ChemDraw's default keys, and the person's changes
// (which are saved, so they must survive bad input).

import { DEFAULT_KEEP } from '../src/keep/prefs';
import { defaultToolboxes } from '../src/ui/toolboxes';
import { DEFAULT_SCHEME_PREFS } from '../src/chem/scheme-layout';
import { describe, it, expect } from 'vitest';
import {
  chordOf, displayChord, parseAction, Keymap, DEFAULT_KEYS, CONTEXTS, validAction, actionName, actionsFor,
  registerToolNames, KeyPress,
} from '../src/editor/keymap';
import { parseSettings, settingsText, DEFAULT_SETTINGS } from '../src/settings';

const press = (key: string, more: Partial<KeyPress> = {}): KeyPress => ({ key, ...more });

describe('naming key presses', () => {
  it('names plain characters by themselves, case and all', () => {
    expect(chordOf(press('f'))).toBe('f');
    expect(chordOf(press('-', { code: 'NumpadSubtract' }))).toBe('-');
    expect(chordOf(press('+', { code: 'NumpadAdd' }))).toBe('+');
    expect(chordOf(press('−'))).toBe('-');
    expect(chordOf(press('F', { shiftKey: true }))).toBe('F');
    expect(chordOf(press("'"))).toBe("'");
    expect(chordOf(press('+', { shiftKey: true }))).toBe('+');
    expect(chordOf(press('1'))).toBe('1');
  });

  it('names other keys, writing Shift out', () => {
    expect(chordOf(press('Enter'))).toBe('Enter');
    expect(chordOf(press(' '))).toBe('Space');
    expect(chordOf(press('Tab', { shiftKey: true }))).toBe('Shift+Tab');
    expect(chordOf(press('ArrowLeft', { shiftKey: true }))).toBe('Shift+ArrowLeft');
    expect(chordOf(press('F5'))).toBe('F5');
    expect(chordOf(press('Esc'))).toBe('Escape');
  });

  it('puts Ctrl, Alt and Shift first and reads letters from the physical key', () => {
    expect(chordOf(press('K', { code: 'KeyK', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+K');
    expect(chordOf(press('c', { code: 'KeyC', ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+C');
    // Alt+K types ˚ on a Mac; the key is still K
    expect(chordOf(press('˚', { code: 'KeyK', altKey: true }))).toBe('Alt+K');
    expect(chordOf(press('ArrowUp', { code: 'ArrowUp', altKey: true }))).toBe('Alt+ArrowUp');
    expect(chordOf(press('=', { code: 'Equal', ctrlKey: true }))).toBe('Ctrl+=');
    expect(chordOf(press('+', { code: 'Equal', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+=');
    expect(chordOf(press('+', { code: 'NumpadAdd', ctrlKey: true }))).toBe('Ctrl++');
    expect(chordOf(press('0', { code: 'Digit0', ctrlKey: true }))).toBe('Ctrl+0');
  });

  it('counts Cmd on a Mac as Ctrl', () => {
    expect(chordOf(press('s', { code: 'KeyS', metaKey: true }))).toBe('Ctrl+S');
  });

  it('treats AltGr characters as plain characters', () => {
    const altGr = (k: string) => k === 'AltGraph';
    expect(chordOf(press('@', { code: 'KeyQ', ctrlKey: true, altKey: true, getModifierState: altGr }))).toBe('@');
  });

  it('ignores a modifier pressed on its own', () => {
    expect(chordOf(press('Shift', { shiftKey: true }))).toBeNull();
    expect(chordOf(press('Control', { ctrlKey: true }))).toBeNull();
  });

  it('shows keys the way people read them', () => {
    expect(displayChord('F')).toBe('Shift+F');
    expect(displayChord('f')).toBe('f');
    expect(displayChord('+')).toBe('+');
    expect(displayChord('Ctrl++')).toBe('Ctrl++');
    expect(displayChord('Alt+ArrowUp')).toBe('Alt+↑');
    expect(displayChord('Ctrl+S', true)).toBe('⌘+S');
    expect(displayChord('Ctrl+Alt+C', true)).toBe('⌘+⌥+C');
  });

  it('splits an action into its verb and argument', () => {
    expect(parseAction('label CO2Me')).toEqual({ verb: 'label', arg: 'CO2Me' });
    expect(parseAction('command zoom-in')).toEqual({ verb: 'command', arg: 'zoom-in' });
  });
});

describe("ChemDraw's default keys", () => {
  registerToolNames({ select: 'Select', 'bond-single': 'Single bond', chain: 'Chain', text: 'Text', arrow: 'Reaction arrow',
    'ring-benzene': 'Benzene', 'ring-cp': 'Cyclopentadiene', 'bracket-square': 'Square brackets', 'bond-wedge': 'Wedge',
    'bond-hashWedge': 'Hashed wedge', 'bond-double': 'Double bond', 'ring-3': 'Cyclopropane', 'ring-4': 'Cyclobutane',
    'ring-5': 'Cyclopentane', 'ring-6': 'Cyclohexane', 'ring-7': 'Cycloheptane', 'ring-8': 'Cyclooctane' });

  it('are all actions that make sense where they are', () => {
    for (const { id } of CONTEXTS) {
      for (const [key, action] of Object.entries(DEFAULT_KEYS[id])) {
        expect(validAction(id, action), `${id} ${key} → ${action}`).toBe(true);
      }
    }
  });

  it('give every action a readable name', () => {
    for (const { id } of CONTEXTS) {
      for (const action of new Set(Object.values(DEFAULT_KEYS[id]))) expect(actionName(action), action).not.toBe(action);
    }
    expect(actionName('label OTBS')).toBe('Label OTBS');
    expect(actionName('tool chain')).toBe('Chain tool');
  });

  it('match what ChemDraw does with k, K, 1, 0 and Ctrl+arrows', () => {
    const km = new Keymap();
    expect(km.lookup('atom', 'k')).toBe('atom sulfonyl');
    expect(km.lookup('atom', 'K')).toBe('atom tbu');
    expect(km.lookup('atom', '1')).toBe('atom bond');
    expect(km.lookup('atom', '0')).toBe('atom ring-bond');
    expect(km.lookup('bond', '9')).toBe('fuse chair');
    expect(km.lookup('command', 'Ctrl+ArrowRight')).toBe('command reaction-right');
    expect(km.lookup('command', 'Ctrl+Shift+K')).toBe('command clean-up');
  });

  it('list every action that could have a key', () => {
    expect(actionsFor('atom')).toContain('atom sulfonyl');
    expect(actionsFor('bond')).toContain('fuse chair-2');
    expect(actionsFor('command')).toContain('command hotkeys');
    expect(actionsFor('space')).toContain('tool chain');
  });
});

describe("the person's key map", () => {
  it('gives a key a new action and says what it did before', () => {
    const km = new Keymap();
    expect(km.bind('atom', 'q', 'atom bond')).toBe('label O');
    expect(km.lookup('atom', 'q')).toBe('atom bond');
    expect(km.keysFor('atom', 'atom bond')).toEqual(['1', 'q']);
    expect(km.isDefault('atom', 'q')).toBe(false);
    expect(km.actionIsDefault('atom', 'atom bond')).toBe(false);
    expect(km.actionIsDefault('atom', 'label O')).toBe(false);
    expect(km.overrides()).toEqual({ atom: { q: 'atom bond' } });
  });

  it("forgets a change that puts ChemDraw's key back", () => {
    const km = new Keymap();
    km.bind('atom', 'q', 'atom bond');
    km.bind('atom', 'q', 'label O');
    expect(km.overrides()).toEqual({});
    expect(km.isDefault('atom', 'q')).toBe(true);
  });

  it('takes a key away, and adds keys of its own', () => {
    const km = new Keymap();
    km.bind('atom', '1', null);
    expect(km.lookup('atom', '1')).toBeUndefined();
    expect(km.overrides()).toEqual({ atom: { '1': null } });
    km.bind('atom', 'Ctrl+Alt+T', 'label OTBS');
    expect(km.lookup('atom', 'Ctrl+Alt+T')).toBe('label OTBS');
    // taking away a key that was the person's own leaves nothing behind
    km.bind('atom', 'Ctrl+Alt+T', null);
    expect(km.overrides()).toEqual({ atom: { '1': null } });
  });

  it("puts one action's keys back", () => {
    const km = new Keymap();
    km.bind('atom', '1', null);
    km.bind('atom', 'q', 'atom bond');
    km.bind('atom', 'g', 'label TBS');
    km.resetAction('atom', 'atom bond');
    expect(km.lookup('atom', '1')).toBe('atom bond');
    expect(km.lookup('atom', 'q')).toBe('label O');
    expect(km.lookup('atom', 'g')).toBe('label TBS');
    km.resetAll();
    expect(km.overrides()).toEqual({});
    expect(km.lookup('atom', 'g')).toBe('atom select');
  });

  it('keeps keys in their own place', () => {
    const km = new Keymap();
    km.bind('bond', '1', 'bond triple');
    expect(km.lookup('atom', '1')).toBe('atom bond');
    expect(km.lookup('bond', '1')).toBe('bond triple');
  });

  it('skips saved changes that make no sense', () => {
    const km = new Keymap({
      atom: { q: 'atom bond', z: 'atom no-such-thing', '': 'label X', w: 42 as unknown as string, 'Ctrl+Q': null },
      bond: { y: 'label O' },
      command: { 'Ctrl+M': 'command zoom-in' },
      nowhere: { a: 'atom bond' },
    } as never);
    expect(km.overrides()).toEqual({ atom: { q: 'atom bond' }, command: { 'Ctrl+M': 'command zoom-in' } });
    expect(new Keymap(null as never).overrides()).toEqual({});
    expect(new Keymap({ atom: 'oops' } as never).overrides()).toEqual({});
  });

  it('tells listeners about changes', () => {
    const km = new Keymap();
    let n = 0;
    km.onChange(() => n++);
    km.bind('atom', 'q', 'atom bond');
    km.resetAll();
    expect(n).toBe(2);
  });
});

describe('the settings file', () => {
  it('starts from the defaults', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('not json')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('[1,2]')).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps what it understands and ignores the rest', () => {
    const s = parseSettings(JSON.stringify({ hotkeys: { atom: { q: 'atom bond' } }, fixedLength: false, keepHotspotOnBond: 'yes', extra: 1 }));
    expect(s).toEqual({ ...DEFAULT_SETTINGS, hotkeys: { atom: { q: 'atom bond' } }, fixedLength: false });
    expect(parseSettings(JSON.stringify({ hotkeys: [1, 2] })).hotkeys).toEqual({});
  });

  it('keeps the developer tools hidden unless they were switched on', () => {
    expect(DEFAULT_SETTINGS.devTools).toBe(false);
    expect(parseSettings(JSON.stringify({ devTools: true })).devTools).toBe(true);
    expect(parseSettings(JSON.stringify({ devTools: 'yes' })).devTools).toBe(false);
  });

  it('keeps typing replacements and dictionary words only when they make sense', () => {
    const s = parseSettings(JSON.stringify({ replacements: [['a', 'b'], ['', 'x'], [1, 2], 'no'], dictionary: ['word', 3, '  '] }));
    expect(s.replacements).toEqual([['a', 'b']]);
    expect(s.dictionary).toEqual(['word']);
    expect(parseSettings(null).replacements.length).toBeGreaterThan(5);
  });

  it('reads back what it writes', () => {
    const s = {
      hotkeys: { command: { 'Ctrl+M': 'command zoom-in' } }, keepHotspotOnBond: false, fixedLength: true, fixedAngles: false, devTools: true, showRoles: false,
      chemTyping: false, spellCheck: true, replacements: [['oC', '°C'], ['rxn', 'reaction']] as [string, string][], dictionary: ['Fooxane'],
      modeColours: { style: 'off' as const, drawing: '#2f6fdf', slides: '#00aa00', sheet: '#1e8a50', document: '#2647a8', design: '#7b3fbf' },
      nicknames: { Qq: 'CC' }, templates: [], splitWidth: 0.6, scrollBars: false, page: { w: 523, h: 770, grow: false, name: 'a4' }, pageEdge: false, welcomed: true, textBar: 'floating' as const, groupTips: false, citeStyle: 'rsc', citeOptions: { lastAuthor: 'none', etAlOver: 5 }, methylStyle: 'Me' as const, axialStyle: 'PM' as const, circledCharges: true, textToAtom: false, groupClick: 'item' as const, groupOutline: false, rerouteArrows: false, superscriptR: false, linkSide: 'left' as const, slideTemplate: 'harbor', askWholeDrawing: false,
      palettes: [{ name: 'Group colours', colors: ['#1f5fbf', '#e69f00'] }],
      toolboxes: { ...defaultToolboxes(), locked: false, custom: ['tool:chain', 'cmd:clean-up'] },
      myStyles: [], modeStyles: { document: 'RSC' }, darkPage: true, darkPalette: 'Slate', darkPalettes: [], guides: { drawing: true, slides: false, design: true }, highlightLooks: [{ name: 'Mine', colour: '#abcdef', style: { glow: true } }], docPins: ['style', 'hf'], updateCheck: false, pubchemNames: false, fileTypesOffered: true, reviewName: 'Nate O.', skipVersion: '0.1.80', recentFiles: ['C:\\Work\\a.cdxml'],
      scheme: { ...DEFAULT_SCHEME_PREFS, structGap: 14, textAlign: 'left', fit: false },
      keep: { ...DEFAULT_KEEP, autoSave: true, recoveryMinutes: 5, changedOnDisk: 'reload' as const, lockFiles: false },
    };
    const text = settingsText(s);
    expect(text).toContain('"app": "Chem Illustrator"');
    expect(parseSettings(text)).toEqual(s);
  });
});

describe('drop-down lists for typed boxes', () => {
  it('lists every choice until typing starts, then what matches first', async () => {
    const { comboChoices } = await import('../src/ui/combo');
    const sizes = ['8', '10', '11', '12', '110'];
    expect(comboChoices(sizes, '11', false)).toEqual(sizes);
    expect(comboChoices(sizes, '11', true)).toEqual(['11', '110']);
    expect(comboChoices(['Arial', 'Times New Roman', 'Georgia'], 'new', true)).toEqual(['Times New Roman']);
    expect(comboChoices(sizes, 'zz', true)).toEqual(sizes);
  });
});
