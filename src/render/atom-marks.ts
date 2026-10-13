// Small marks on atoms that aren't part of the label: the atom number shown with the ' key,
// and the numbered diamond of a point of attachment (the . key). Placement copies ChemDraw 25
// (measured on Nate's PC at a 6 pt label size: the number's baseline starts 0.24 label sizes
// right of the atom and 0.06 above it, in type 0.75 times the label size).

import type { Atom } from '../model';
import type { Rect } from '../geom';

const CAP = 0.716; // Arial cap height / font size

export interface NumberPlace { x: number; y: number; size: number }

/**
 * Where an atom's number goes (the start of its baseline) and its size. `labelSize` is the
 * atom's own label size; `labelBox` the box round its label, if it has one, so the number
 * sits at the label's upper right instead of on top of it. A position the file gave wins.
 */
export function numberPlace(a: Atom, labelSize: number, labelBox?: Rect | null): NumberPlace {
  if (a.numberLabel) return { x: a.x + a.numberLabel.dx, y: a.y + a.numberLabel.dy, size: a.numberLabel.size };
  const size = 0.75 * labelSize;
  if (labelBox) return { x: labelBox.x2 + 0.05 * labelSize, y: labelBox.y1 + CAP * size, size };
  return { x: a.x + 0.24 * labelSize, y: a.y - 0.06 * labelSize, size };
}

/** The black diamond of a numbered point of attachment: its half-width, from the label size. */
export function attachDiamondSize(labelSize: number): number {
  return 0.6 * labelSize;
}

/** Whether an attachment point is drawn as a numbered diamond (rather than a wavy line). */
export function hasAttachDiamond(a: Atom): boolean {
  return !!a.attach && a.attachNum !== undefined && (a.attach === 'Unspecified' || a.attach === 'Diamond');
}
