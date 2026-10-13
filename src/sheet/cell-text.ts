// Text in a cell shown as chemistry (the cell's "Chemistry" look): the numbers of C9H8O4 and
// CH2Cl2 lowered, charges and NMR nuclei raised, the d of d6-DMSO in italics. The same rules
// as typing in a caption (src/text/chemtext.ts), applied to the whole text at once.

import { typingFormats, WORD_ENDS, CharLook } from '../text/chemtext';

export interface Piece {
  text: string;
  pos: 'base' | 'sub' | 'sup';
  italic?: boolean;
}

const HILL = /^((?:[A-Z][a-z]?\d*)+)(\d*[+\-−])?$/;

/** The text split into pieces that sit on the line, below it or above it. */
export function chemPieces(text: string): Piece[] {
  const looks: CharLook[] = Array.from(text, () => ({ pos: 'base' as const, italic: false }));
  const hill = HILL.exec(text);
  if (hill) {
    // a formula as the FORMULA function writes it, charge and all
    for (let i = 0; i < hill[1].length; i++) if (/\d/.test(text[i])) looks[i].pos = 'sub';
    for (let i = hill[1].length; i < text.length; i++) looks[i].pos = 'sup';
  } else {
    for (let end = 1; end <= text.length; end++) {
      if (end < text.length && !WORD_ENDS.includes(text[end])) continue;
      for (const e of typingFormats(text, end, (i) => looks[i] ?? { pos: 'base', italic: false })) {
        for (let i = e.start; i < e.end; i++) {
          if (!looks[i]) continue;
          if (e.pos) looks[i].pos = e.pos;
          if (e.italic !== undefined) looks[i].italic = e.italic;
        }
      }
    }
  }
  const out: Piece[] = [];
  for (let i = 0; i < text.length; i++) {
    const l = looks[i];
    const last = out[out.length - 1];
    if (last && last.pos === l.pos && !!last.italic === l.italic) last.text += text[i];
    else out.push({ text: text[i], pos: l.pos, ...(l.italic ? { italic: true } : {}) });
  }
  return out;
}
