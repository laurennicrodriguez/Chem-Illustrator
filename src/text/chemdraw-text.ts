// Saving text that ChemDraw can't format itself. ChemDraw's captions have no lists, paragraph
// spacing or per-paragraph alignment, so a caption with any of these is saved the way ChemDraw
// can show it (each bullet or number written as text in front of its paragraph), and its
// paragraph formatting goes in a hidden object tag beside the text. Reading the file back, the
// tag puts everything back as it was, provided the text still matches it; if the text was
// changed in ChemDraw, the tag no longer fits and the text is read just as ChemDraw shows it.

import type { ParaStyle, TextRun } from '../model';
import { normalizeRuns, plainText, replaceRange, styleOf } from '../richtext';
import { fitParas, listMarkers, paraCount, paraRange, splitParagraphs, storedParas } from './paragraphs';

/** Name of the hidden object tag that carries the paragraph formatting. */
export const TEXT_TAG = 'Chem Illustrator text';

export interface TextTag {
  v: 1;
  paras?: ParaStyle[];
  lineSpacing?: number;
  /** Checksum of the text as saved, so a text edited elsewhere is recognised. */
  sum: string;
}

/** A short checksum of a text (FNV-1a, 32 bits). */
export function textSum(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** What goes in front of a paragraph in ChemDraw: tabs for the level, then the bullet or number. */
export function markerPrefix(p: ParaStyle, marker: string | null): string {
  if (!p.list) return '';
  const level = Math.max(0, Math.min(8, p.level ?? 0));
  return marker ? `${'\t'.repeat(level)}${marker}\t` : '\t'.repeat(level + 1);
}

/**
 * The runs to save for ChemDraw and the tag to save with them (null when the text has nothing
 * ChemDraw can't hold).
 */
export function runsForChemDraw(c: { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number }): { runs: TextRun[]; tag: TextTag | null } {
  const text = plainText(c.runs);
  const paras = fitParas(c.paras, paraCount(text));
  const stored = storedParas(paras);
  const spacing = c.lineSpacing && c.lineSpacing !== 1 ? c.lineSpacing : undefined;
  if (!stored && !spacing) return { runs: c.runs, tag: null };
  const markers = listMarkers(paras);
  const out: TextRun[] = [];
  splitParagraphs(c.runs).forEach((pr, i) => {
    if (i > 0) out.push({ ...(out[out.length - 1] ? styleOf(out[out.length - 1]) : {}), text: '\n' });
    const prefix = markerPrefix(paras[i], markers[i]);
    if (prefix) {
      // the bullet or number in the paragraph's own size, font and colour
      const first = pr[0];
      out.push({ text: prefix, ...(first?.size !== undefined ? { size: first.size } : {}), ...(first?.font ? { font: first.font } : {}), ...(first?.color ? { color: first.color } : {}) });
    }
    out.push(...pr.map((r) => ({ ...r })));
  });
  const runs = normalizeRuns(out);
  const tag: TextTag = { v: 1, sum: textSum(plainText(runs)) };
  if (stored) tag.paras = stored;
  if (spacing) tag.lineSpacing = spacing;
  return { runs, tag };
}

/** Read a tag's value; null if it isn't one of ours. */
export function parseTextTag(value: string | null): TextTag | null {
  if (!value) return null;
  try {
    const t = JSON.parse(value) as TextTag;
    return t && t.v === 1 && typeof t.sum === 'string' ? t : null;
  } catch {
    return null;
  }
}

/** Undo runsForChemDraw: take the bullets and numbers off again, if the text still fits the tag. */
export function runsFromChemDraw(runs: TextRun[], tag: TextTag | null): { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number } {
  if (!tag || textSum(plainText(runs)) !== tag.sum) return { runs };
  let text = plainText(runs);
  const paras = fitParas(tag.paras, paraCount(text));
  const markers = listMarkers(paras);
  let out = runs;
  for (let i = paras.length - 1; i >= 0; i--) {
    const prefix = markerPrefix(paras[i], markers[i]);
    if (!prefix) continue;
    const { start } = paraRange(text, i);
    if (text.slice(start, start + prefix.length) !== prefix) continue;
    out = replaceRange(out, start, start + prefix.length, []);
    text = text.slice(0, start) + text.slice(start + prefix.length);
  }
  const res: { runs: TextRun[]; paras?: ParaStyle[]; lineSpacing?: number } = { runs: out };
  const stored = storedParas(paras);
  if (stored) res.paras = stored;
  if (tag.lineSpacing) res.lineSpacing = tag.lineSpacing;
  return res;
}
