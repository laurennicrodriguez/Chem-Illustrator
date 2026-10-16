// Mouse pointers that say what a click or drag will do. Drawn here as small pictures (no
// picture files), each with a plain system pointer to fall back on.

import type { HandleId } from '../objects';

/** A pointer drawn as a 24 × 24 picture, with its hot spot and a system pointer to fall back on. */
function drawn(svg: string, x: number, y: number, fallback: string): string {
  const body = `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">${svg}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(body)}") ${x} ${y}, ${fallback}`;
}

/** The selection (marquee) tool over empty space: a small square with a shadow, as ChemDraw shows. */
export const MARQUEE = drawn(
  '<rect x="9" y="9" width="9" height="9" fill="#000" opacity="0.35"/>' +
  '<rect x="7.5" y="7.5" width="9" height="9" fill="#fff" stroke="#000" stroke-width="1"/>',
  12, 12, 'default');

/** Over the handle that turns the selection: a curved arrow. */
export const ROTATE = drawn(
  '<path d="M18.5 12a6.5 6.5 0 1 1-2.2-4.9" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' +
  '<path d="M18.5 12a6.5 6.5 0 1 1-2.2-4.9" fill="none" stroke="#000" stroke-width="1.6" stroke-linecap="round"/>' +
  '<path d="M19.6 3.6 L19.4 9.6 L13.6 8.6 Z" fill="#000" stroke="#fff" stroke-width="1" stroke-linejoin="round"/>',
  12, 12, 'grab');

/** The eraser: a rubber block, rubbing out at its lower left tip. */
export const ERASER = drawn(
  '<path d="M4 17 L13 6.5 L20 12.5 L12.5 21 L7.5 21 Z" fill="#fff" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>' +
  '<path d="M4 17 L8.5 11.7 L15.5 17.7 L12.5 21 L7.5 21 Z" fill="#e88a9a" stroke="#000" stroke-width="1.2" stroke-linejoin="round"/>',
  5, 19, 'crosshair');

/** What a resize or end handle shows: arrows along the way it drags. */
export function handleCursor(which: HandleId): string {
  switch (which) {
    case 'n': case 's': return 'ns-resize';
    case 'e': case 'w': return 'ew-resize';
    case 'ne': case 'sw': return 'nesw-resize';
    case 'nw': case 'se': return 'nwse-resize';
    case 'mid': return 'grab';
    default: return 'move'; // an arrow's or line's end: it goes wherever it is dragged
  }
}

/** What the drawing area shows when the pointer is still, by what is under it and the tool. */
export interface PointerState {
  tool: string;
  /** What the pointer is over: an atom or bond, another object, or nothing. */
  over: 'chem' | 'object' | null;
  /** The pointer is over something selected (a drag there moves it). */
  overSelection: boolean;
  /** Ctrl (Cmd on a Mac) is held: a drag copies. */
  ctrl: boolean;
  /** Slides and Design: the select tool keeps the usual arrow, as in PowerPoint. */
  slides: boolean;
  /** Over a text box that takes typing at a click. */
  typing: boolean;
}

export function pointerFor(s: PointerState): string {
  if (s.typing) return 'text';
  if (s.overSelection && s.tool !== 'eraser') return s.ctrl ? 'copy' : 'grab';
  switch (s.tool) {
    case 'select':
      if (s.over) return s.slides ? 'move' : 'crosshair';
      return s.slides ? '' : MARQUEE;
    case 'eraser': return ERASER;
    case 'text': return 'text';
    default: return 'crosshair';
  }
}
