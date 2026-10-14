// Toolboxes (View > Toolboxes): where each one goes when dropped, and reading their settings.

import { describe, expect, it } from 'vitest';
import { defaultToolboxes, dropTarget, parseToolboxes } from '../src/ui/toolboxes';

describe('toolboxes', () => {
  const work = { left: 100, top: 100, right: 900, bottom: 700 };

  it('docks a toolbox dropped near an edge of the drawing, and floats it elsewhere', () => {
    expect(dropTarget(110, 400, work)).toBe('left');
    expect(dropTarget(890, 400, work)).toBe('right');
    expect(dropTarget(500, 110, work)).toBe('top');
    expect(dropTarget(500, 690, work)).toBe('bottom');
    expect(dropTarget(500, 400, work)).toBe('float');
  });

  it('starts with only the drawing tools showing, on the left, locked', () => {
    const d = defaultToolboxes();
    expect(d.locked).toBe(true);
    expect(d.places.main).toMatchObject({ shown: true, dock: 'left' });
    expect(Object.values(d.places).filter((p) => p.shown)).toHaveLength(1);
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
});
