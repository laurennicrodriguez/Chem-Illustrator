// Nate's requests of 16 October: Shift keeps a drag straight, Shift and Ctrl change how handles
// resize, and the pointer says what a click or drag will do.

import { describe, it, expect } from 'vitest';
import { lockAxis } from '../src/geom';
import { resizeBox, dragShapeHandle } from '../src/objects';
import { pointerFor, handleCursor, MARQUEE, ERASER, BEND, type PointerState } from '../src/editor/cursors';
import type { Shape } from '../src/model';

describe('a drag with Shift held', () => {
  it('goes straight across or straight up and down, whichever is closer', () => {
    expect(lockAxis({ x: 30, y: 4 })).toEqual({ x: 30, y: 0 });
    expect(lockAxis({ x: -3, y: -20 })).toEqual({ x: 0, y: -20 });
    // exactly diagonal: across
    expect(lockAxis({ x: 5, y: 5 })).toEqual({ x: 5, y: 0 });
  });
});

describe('resizing by a handle', () => {
  const box = { x1: 0, y1: 0, x2: 40, y2: 20 };
  it('moves only the dragged side or corner', () => {
    expect(resizeBox(box, 'se', { x: 50, y: 30 })).toEqual({ x1: 0, y1: 0, x2: 50, y2: 30 });
    expect(resizeBox(box, 'w', { x: 10, y: 99 })).toEqual({ x1: 10, y1: 0, x2: 40, y2: 20 });
  });
  it('keeps the proportions from a corner with Shift (the larger stretch decides)', () => {
    expect(resizeBox(box, 'se', { x: 80, y: 22 }, { keep: true })).toEqual({ x1: 0, y1: 0, x2: 80, y2: 40 });
    expect(resizeBox(box, 'nw', { x: 20, y: -20 }, { keep: true })).toEqual({ x1: -40, y1: -20, x2: 40, y2: 20 });
  });
  it('grows about the middle with Ctrl', () => {
    expect(resizeBox(box, 'e', { x: 50, y: 0 }, { centre: true })).toEqual({ x1: -10, y1: 0, x2: 50, y2: 20 });
    expect(resizeBox(box, 'se', { x: 40, y: 20 }, { centre: true })).toEqual({ x1: 0, y1: 0, x2: 40, y2: 20 });
    expect(resizeBox(box, 'se', { x: 60, y: 20 }, { centre: true, keep: true })).toEqual({ x1: -20, y1: -10, x2: 60, y2: 30 });
  });
  it('turns a shape over when a side is dragged past the other one', () => {
    expect(resizeBox(box, 'e', { x: -10, y: 0 })).toEqual({ x1: -10, y1: 0, x2: 0, y2: 20 });
  });
  it('keeps a picture in proportion unless Alt is held, and Shift keeps it even then', () => {
    const pic = { id: 1, kind: 'picture', x1: 0, y1: 0, x2: 40, y2: 20 } as Shape;
    expect(dragShapeHandle(pic, 'se', { x: 80, y: 22 }, false)).toEqual({ x1: 0, y1: 0, x2: 80, y2: 40 });
    expect(dragShapeHandle(pic, 'se', { x: 80, y: 22 }, true)).toEqual({ x1: 0, y1: 0, x2: 80, y2: 22 });
    expect(dragShapeHandle(pic, 'se', { x: 80, y: 22 }, true, { keep: true })).toEqual({ x1: 0, y1: 0, x2: 80, y2: 40 });
  });
  it('keeps a circle round about its middle with Ctrl', () => {
    const c = { id: 1, kind: 'oval', x1: 0, y1: 0, x2: 20, y2: 20, circle: true } as unknown as Shape;
    const r = dragShapeHandle(c, 'se', { x: 25, y: 12 }, false, { centre: true });
    expect(r).toEqual({ x1: -5, y1: -5, x2: 25, y2: 25 });
  });
});

describe('the pointer', () => {
  const at = (s: Partial<PointerState>): string => pointerFor({ tool: 'select', over: null, overSelection: false, ctrl: false, slides: false, typing: false, ...s });
  it('is the shadowed square for the selection tool over empty space, and a cross over atoms and bonds', () => {
    expect(at({})).toBe(MARQUEE);
    expect(MARQUEE).toMatch(/^url\("data:image\/svg\+xml,.*"\) 12 12, default$/);
    expect(at({ over: 'chem' })).toBe('crosshair');
  });
  it('is a hand over the selection, and shows a copy while Ctrl is held', () => {
    expect(at({ over: 'chem', overSelection: true })).toBe('grab');
    expect(at({ over: 'chem', overSelection: true, ctrl: true })).toBe('copy');
    expect(at({ tool: 'bond', over: 'chem', overSelection: true, ctrl: true })).toBe('copy');
  });
  it('keeps the usual arrow in Slides, as in PowerPoint', () => {
    expect(at({ slides: true })).toBe('');
    expect(at({ slides: true, over: 'object' })).toBe('move');
    expect(at({ slides: true, over: 'object', typing: true })).toBe('text');
  });
  it('fits the tool', () => {
    expect(at({ tool: 'bond' })).toBe('crosshair');
    expect(at({ tool: 'ring', over: 'chem' })).toBe('crosshair');
    expect(at({ tool: 'text' })).toBe('text');
    // the eraser rubs out even what is selected
    expect(at({ tool: 'eraser', over: 'chem', overSelection: true })).toBe(ERASER);
  });
  it('shows which way a handle drags', () => {
    expect(handleCursor('n')).toBe('ns-resize');
    expect(handleCursor('e')).toBe('ew-resize');
    expect(handleCursor('ne')).toBe('nesw-resize');
    expect(handleCursor('se')).toBe('nwse-resize');
    expect(handleCursor('head')).toBe('move');
    // the middle of an arrow bends it: its own pointer, not the hand that moves things
    expect(handleCursor('mid')).toBe(BEND);
    expect(handleCursor('b0')).toBe(BEND);
  });
});
