// Character widths of Arial (the same as Helvetica), in thousandths of the font size, for
// printable ASCII. ChemDraw measures labels with these, so files we write place text the
// same way on any computer, whether or not Arial is installed.

const W = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // p-z { | } ~
];

/** Width of `text` in Arial at `size` points. Characters outside ASCII count as an average letter. */
export function arialWidth(text: string, size: number): number {
  let w = 0;
  for (const ch of text) {
    const c = ch.codePointAt(0)! - 32;
    w += c >= 0 && c < W.length ? W[c] : ch === '−' ? 584 : 556;
  }
  return (w / 1000) * size;
}
