// Toolboxes (View > Toolboxes): where each one goes when dropped, and reading their settings.

import { describe, expect, it } from 'vitest';
import { defaultToolboxes, dropTarget, parseToolboxes, boxLocked, withAllLocked, withBoxLocked, sideFolded, withSideFolded } from '../src/ui/toolboxes';

describe('toolboxes', () => {
  const work = { left: 100, top: 100, right: 900, bottom: 700 };

  it('docks a toolbox dropped near an edge of the drawing, and floats it elsewhere', () => {
    expect(dropTarget(110, 400, work)).toBe('left');
    expect(dropTarget(890, 400, work)).toBe('right');
    expect(dropTarget(500, 110, work)).toBe('top');
    expect(dropTarget(500, 690, work)).toBe('bottom');
    expect(dropTarget(500, 400, work)).toBe('float');
  });

  it('starts with only the drawing tools (left) and the side panel (right) showing, locked', () => {
    const d = defaultToolboxes();
    expect(d.locked).toBe(true);
    expect(d.places.main).toMatchObject({ shown: true, dock: 'left' });
    expect(Object.entries(d.places).filter(([, p]) => p.shown).map(([id]) => id).sort()).toEqual(['details', 'main']);
  });

  it('reads saved settings, keeping only what makes sense', () => {
    const s = parseToolboxes({
      locked: false,
      places: { colours: { shown: true, dock: 'float', x: 300, y: 'x' }, structure: { dock: 'sideways' }, nonsense: { shown: true } },
      custom: ['tool:chain', 'cmd:clean-up', 'rm -rf', 7],
    });
    expect(s.locked).toBe(false);
    expect(s.places.colours).toMatchObject({ shown: true, dock: 'float', x: 300 });
    expect(typeof s.places.colours.y).toBe('number');
    expect(s.places.structure.dock).toBe('float');
    expect(s.places).not.toHaveProperty('nonsense');
    expect(s.custom).toEqual(['tool:chain', 'cmd:clean-up']);
    expect(parseToolboxes(null)).toEqual(defaultToolboxes());
  });

  it('locks each toolbox on its own, and all of them with the big button', () => {
    let s = defaultToolboxes();
    s = { ...s, places: { ...s.places, colours: { ...s.places.colours, shown: true } } };
    s = withBoxLocked(s, 'colours', false);
    expect(boxLocked(s, 'colours')).toBe(false);
    expect(boxLocked(s, 'main')).toBe(true);
    // the big button shows unlocked while any shown toolbox is
    expect(s.locked).toBe(false);
    s = withBoxLocked(s, 'colours', true);
    expect(s.locked).toBe(true);
    s = withAllLocked(s, false);
    expect(['main', 'colours', 'structure'].map((id) => boxLocked(s, id))).toEqual([false, false, false]);
    // kept in the settings
    expect(boxLocked(parseToolboxes(JSON.parse(JSON.stringify(withBoxLocked(s, 'main', true)))), 'main')).toBe(true);
  });

  it('folds the side panel in one mode only', () => {
    let s = defaultToolboxes();
    s = withSideFolded(s, 'sheet', true);
    expect(sideFolded(s, 'sheet')).toBe(true);
    expect(sideFolded(s, 'drawing')).toBe(false);
    // an older settings file's single choice still counts in every mode
    expect(sideFolded(parseToolboxes({ sideCollapsed: true }), 'document')).toBe(true);
    expect(parseToolboxes(JSON.parse(JSON.stringify(s))).sideByMode).toEqual({ sheet: true });
  });
});

describe('the side panel toolbox', () => {
  it('is always shown, docked at the right to start with', () => {
    expect(defaultToolboxes().places.details).toMatchObject({ shown: true, dock: 'right' });
    // older settings could put it away
    expect(parseToolboxes({ places: { details: { shown: false, dock: 'float', x: 50, y: 60 } } }).places.details).toMatchObject({ shown: true, dock: 'float', x: 50, y: 60 });
  });
});
