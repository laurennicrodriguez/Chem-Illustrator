// Character widths of Arial (the same as Helvetica), in thousandths of the font size, for
// printable ASCII and a few common symbols. ChemDraw measures labels with these, so files we
// write place text the same way on any computer, whether or not Arial is installed. Pictures
// for Word and PowerPoint use them too, since those programs draw the text in Arial.

const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];

// Arial Bold (Helvetica-Bold)
const B = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];

// Symbols outside ASCII: [regular, bold]
const EXTRA: Record<string, [number, number]> = {
  '°': [400, 400], '±': [584, 584], '×': [584, 584], '·': [278, 278], '•': [350, 350], '−': [584, 584],
  '–': [556, 556], '—': [1000, 1000], '‘': [222, 278], '’': [222, 278], '“': [333, 500], '”': [333, 500],
  'µ': [556, 611], 'μ': [556, 611], '…': [1000, 1000], '‰': [1000, 1000],
};

function charWidth(ch: string, bold: boolean): number {
  const t = bold ? B : W;
  const c = ch.codePointAt(0)! - 32;
  if (c >= 0 && c < t.length) return t[c];
  const e = EXTRA[ch];
  if (e) return e[bold ? 1 : 0];
  // accented letters are as wide as the plain letter (é as e)
  const base = ch.normalize('NFD').codePointAt(0)! - 32;
  if (base >= 0 && base < t.length) return t[base];
  return bold ? 611 : 556;
}

/** Width of `text` in Arial at `size` points. Unknown characters count as an average letter. */
export function arialWidth(text: string, size: number, bold = false): number {
  let w = 0;
  for (const ch of text) w += charWidth(ch, bold);
  return (w / 1000) * size;
}
