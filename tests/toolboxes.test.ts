// Toolboxes (View > Toolboxes): where each one goes when dropped, and reading their settings.

import { describe, expect, it } from 'vitest';
import { defaultToolboxes, dropTarget, parseToolboxes, boxLocked, withAllLocked, withBoxLocked, sideFolded, withSideFolded, freeSpot, boxItems, withItems, withItemsReset, withNewBox, withTitle, withBoxMoved, withoutBox, withBoxesRestored, boxIds, boxTitle, moved, inserted, withFlyout, slotAt, withLayoutReset } from '../src/ui/toolboxes';

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

  it('puts a new floating toolbox in free space from the top right, clear of the others', () => {
    const work = { left: 100, top: 100, right: 900, bottom: 700 };
    // the first goes in the top right corner
    expect(freeSpot(200, 80, work, [])).toEqual({ x: 692, y: 108 });
    // the next goes below it
    const first = { left: 692, top: 108, right: 892, bottom: 188 };
    const next = freeSpot(200, 80, work, [first]);
    expect(next.x).toBe(692);
    expect(next.y).toBeGreaterThanOrEqual(196);
    // too big to fit anywhere: the top right corner
    expect(freeSpot(1000, 900, work, [])).toEqual({ x: 108, y: 108 });
  });
});

describe('Customize Toolboxes', () => {
  const given = ['cmd:clean-up', 'cmd:add-frame', 'sep', 'cmd:fill-rings'];

  it('keeps each toolbox\'s buttons as changed, or as they come', () => {
    let s = defaultToolboxes();
    expect(boxItems(s, 'structure', given)).toEqual(given);
    s = withItems(s, 'structure', ['cmd:fill-rings', 'cmd:clean-up']);
    expect(boxItems(s, 'structure', given)).toEqual(['cmd:fill-rings', 'cmd:clean-up']);
    // My Toolbox keeps its own list, as before
    s = withItems(s, 'custom', ['tool:chain']);
    expect(s.custom).toEqual(['tool:chain']);
    expect(boxItems(withItemsReset(s, 'structure', given), 'structure', given)).toEqual(given);
    // kept in the settings, without the nonsense
    const back = parseToolboxes(JSON.parse(JSON.stringify({ ...s, items: { ...s.items, colours: ['cmd:x'], nonsense: ['cmd:x'], arrange: ['cmd:ok', '<script>', 7, 'sep', 'sep', 'cmd:ok'] } })));
    expect(back.items).toEqual({ structure: ['cmd:fill-rings', 'cmd:clean-up'], arrange: ['cmd:ok', 'sep', 'sep'] });
    expect(back.custom).toEqual(['tool:chain']);
  });

  it('makes, renames, orders and deletes toolboxes', () => {
    let s = defaultToolboxes();
    const made = withNewBox(s, 'Lab set', { x: 40, y: 50 }, 'own-lab');
    s = made.state;
    expect(made.id).toBe('own-lab');
    expect(s.places['own-lab']).toMatchObject({ shown: true, dock: 'float', x: 40, y: 50 });
    expect(boxIds(s).at(-1)).toBe('own-lab');
    expect(boxTitle(s, 'own-lab')).toBe('Lab set');
    s = withTitle(s, 'own-lab', '  Mine  ');
    s = withTitle(s, 'structure', 'Chemistry');
    expect([boxTitle(s, 'own-lab'), boxTitle(s, 'structure', 'Structure'), boxTitle(s, 'arrange', 'Object')]).toEqual(['Mine', 'Chemistry', 'Object']);
    s = withBoxMoved(s, 'own-lab', -100);
    expect(boxIds(s)[0]).toBe('own-lab');
    s = withBoxMoved(s, 'own-lab', 1);
    expect(boxIds(s).slice(0, 2)).toEqual(['main', 'own-lab']);
    // all of it kept in the settings
    const back = parseToolboxes(JSON.parse(JSON.stringify(s)));
    expect(boxIds(back)).toEqual(boxIds(s));
    expect(boxTitle(back, 'own-lab')).toBe('Mine');
    expect(back.places['own-lab']).toMatchObject({ x: 40, y: 50 });
    // the app's toolboxes go until restored; your own go for good; the drawing tools and side panel stay
    s = withoutBox(withoutBox(withoutBox(withoutBox(s, 'colours'), 'own-lab'), 'main'), 'details');
    expect(boxIds(s)).not.toContain('colours');
    expect(boxIds(s)).not.toContain('own-lab');
    expect(boxIds(s)).toContain('main');
    expect(boxIds(s)).toContain('details');
    expect(s.places).not.toHaveProperty('own-lab');
    s = withBoxesRestored(s);
    expect(boxIds(s)).toContain('colours');
    expect(boxTitle(s, 'structure', 'Structure')).toBe('Structure');
  });

  it('moves and puts buttons in lists', () => {
    expect(moved(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
    expect(moved(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
    expect(inserted(['a', 'b'], 'x', 1)).toEqual(['a', 'x', 'b']);
    // one already there moves rather than doubling
    expect(inserted(['a', 'b', 'c'], 'a', 3)).toEqual(['b', 'c', 'a']);
    expect(inserted(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    // dividers can be there more than once
    expect(inserted(['a', 'sep', 'b'], 'sep', 3)).toEqual(['a', 'sep', 'b', 'sep']);
  });

  it('keeps fly-outs\' tools as changed', () => {
    let s = withFlyout(defaultToolboxes(), 'arrows', ['arrow-curved', 'arrow-plain']);
    expect(parseToolboxes(JSON.parse(JSON.stringify(s))).flyouts).toEqual({ arrows: ['arrow-curved', 'arrow-plain'] });
    s = withFlyout(s, 'arrows', null);
    expect(s.flyouts).toEqual({});
    expect(parseToolboxes({ jiggle: false }).jiggle).toBe(false);
  });

  it('finds where a dragged icon goes in a packed grid', () => {
    // two rows of three 40-pixel icons
    const box = (i: number) => ({ left: (i % 3) * 50, right: (i % 3) * 50 + 40, top: Math.floor(i / 3) * 50, bottom: Math.floor(i / 3) * 50 + 40 });
    const boxes = [0, 1, 2, 3, 4].map(box);
    expect(slotAt(boxes, 5, 20)).toBe(0);
    expect(slotAt(boxes, 30, 20)).toBe(1);
    // past the end of the first row: before the second row's first
    expect(slotAt(boxes, 200, 20)).toBe(3);
    expect(slotAt(boxes, 60, 70)).toBe(4);
    expect(slotAt(boxes, 140, 70)).toBe(5);
    expect(slotAt(boxes, 10, 300)).toBe(5);
  });
});

describe('Reset Toolboxes', () => {
  it('puts every toolbox back where it starts, keeping what is in them', () => {
    let st = parseToolboxes({ locked: false, sideByMode: { drawing: true }, places: { main: { shown: true, dock: 'top', x: 5, y: 5, collapsed: true, locked: true }, structure: { shown: true, dock: 'float', x: 1, y: 1 } }, custom: ['cmd:clean-up'], own: [{ id: 'own-a', title: 'Mine' }], removed: ['colours'] });
    st = withLayoutReset(st);
    const d = defaultToolboxes();
    expect(st.places.main).toEqual(d.places.main);
    expect(st.places.structure.shown).toBe(false);
    expect(st.places.colours.shown).toBe(false);
    expect(st.places['own-a']).toMatchObject({ shown: true, dock: 'float' });
    expect(st.locked).toBe(true);
    expect(st.sideByMode).toBeUndefined();
    expect(st.custom).toEqual(['cmd:clean-up']);
    expect(st.own).toEqual([{ id: 'own-a', title: 'Mine' }]);
  });
});
