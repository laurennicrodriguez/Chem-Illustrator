// Drawing styles: the journals' published settings for structures (bond length, line widths,
// label font), your own saved styles, and changing a drawing from one style to another.
//
// The built-in values are copied from each publisher's own author guidelines (linked below),
// converted to points (1 cm = 28.35 pt). Where a guideline leaves a value out, it is scaled
// from ACS 1996 in proportion to the bond length, and the note says so.

import { Doc, type Contents } from './model';
import { ACS_1996, DocStyle } from './style';

export interface StylePreset {
  style: DocStyle;
  /** Where the numbers come from. */
  source: string;
  /** Anything worked out rather than read from the guideline. */
  note?: string;
}

const cm = (v: number) => Math.round(v * 28.3465 * 100) / 100;

/** ACS 1996 made bigger or smaller as a whole (for guidelines that give only the text size). */
const scaled = (k: number) => {
  const r = (v: number) => Math.round(v * k * 100) / 100;
  return {
    ...ACS_1996, bondLength: r(ACS_1996.bondLength), lineWidth: r(ACS_1996.lineWidth), boldWidth: r(ACS_1996.boldWidth), marginWidth: r(ACS_1996.marginWidth),
    hashSpacing: r(ACS_1996.hashSpacing), labelSize: r(ACS_1996.labelSize), captionSize: r(ACS_1996.captionSize),
  };
};

export const STYLE_PRESETS: StylePreset[] = [
  {
    style: { ...ACS_1996 },
    source: 'ACS author guidelines, "ACS Stylesheet" (researcher-resources.acs.org); used by every ACS journal',
  },
  {
    style: {
      name: 'RSC', bondLength: cm(0.43), lineWidth: cm(0.016), boldWidth: cm(0.056), hashSpacing: cm(0.062),
      marginWidth: 1.36, bondSpacing: 20, chainAngle: 120, labelFont: 'Arial', labelSize: 7, captionFont: 'Arial', captionSize: 7, captionFace: 96,
    },
    source: 'Royal Society of Chemistry author guidelines (rsc.org, journal author guidelines, "Chemical structures")',
    note: 'The guideline gives no margin width; 1.36 pt keeps ACS 1996\'s proportion to the bond length.',
  },
  {
    style: {
      name: 'Nature journals', bondLength: cm(0.381), lineWidth: cm(0.021), boldWidth: cm(0.055), hashSpacing: cm(0.06),
      marginWidth: cm(0.042), bondSpacing: 18, chainAngle: 120, labelFont: 'Arial', labelSize: 6, captionFont: 'Arial', captionSize: 6.5, captionFace: 96,
    },
    source: 'Nature Portfolio "Style guide for chemical structures" (nature.com); Nature, Nature Chemistry, Nature Communications and the Nature Reviews journals',
  },
  {
    style: {
      name: 'Thieme (Synthesis, Synlett)', bondLength: cm(0.357), lineWidth: cm(0.02), boldWidth: cm(0.049), hashSpacing: cm(0.062),
      marginWidth: cm(0.032), bondSpacing: 18, chainAngle: 120, labelFont: 'Arial', labelSize: 6, captionFont: 'Arial', captionSize: 6, captionFace: 96,
    },
    source: 'Thieme "Instructions for Authors" for Synthesis, Synlett and SynOpen (thieme.de), "Graphic files": the settings shown, with font size 6',
    note: 'The instructions show the numbers but name no font; Arial is used, as for the other journals.',
  },
  {
    style: { ...scaled(7 / 10), name: 'Wiley (Angewandte, Chemistry Europe)' },
    source: 'Wiley-VCH checklists for accepted manuscripts (Angewandte family, Chemistry Europe): Arial or Helvetica only, about 1.8 mm final text (7 pt), lines at least 0.2 pt',
    note: 'Wiley publishes its bond settings only inside its ChemDraw template, so bond length and widths are ACS 1996 scaled to the 7 pt text.',
  },
  {
    style: { ...scaled(7 / 10), name: 'Elsevier (Tetrahedron and others)' },
    source: 'Elsevier "Artwork and media instructions" (elsevier.com): Arial, Courier, Symbol or Times; lettering 7 pt at final size, no smaller than 6 pt',
    note: 'Elsevier gives no bond settings, so bond length and widths are ACS 1996 scaled to the 7 pt text.',
  },
  {
    style: {
      ...ACS_1996, name: 'Slides (ACS 1996 × 2)', bondLength: 28.8, lineWidth: 1.2, boldWidth: 4, marginWidth: 3.2, hashSpacing: 5,
      labelSize: 20, captionSize: 20,
    },
    source: 'ACS 1996 at twice the size, so structures read well on a projector',
  },
];

/** A built-in style by name. */
export function presetNamed(name: string): StylePreset | undefined {
  return STYLE_PRESETS.find((p) => p.style.name === name);
}

const NUMBERS = ['bondLength', 'lineWidth', 'boldWidth', 'marginWidth', 'hashSpacing', 'bondSpacing', 'chainAngle', 'labelSize', 'captionSize'] as const;

/** Do two styles draw the same? (Names aside.) */
export function sameLook(a: DocStyle, b: DocStyle): boolean {
  return NUMBERS.every((k) => Math.abs(a[k] - b[k]) < 1e-6) && a.labelFont === b.labelFont && a.captionFont === b.captionFont;
}

/** A style read back from the settings file: every number present and sensible, else null. */
export function cleanStyle(raw: unknown): DocStyle | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || !r.name.trim()) return null;
  const out: DocStyle = { ...ACS_1996, name: r.name.trim() };
  for (const k of NUMBERS) {
    const v = r[k];
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return null;
    out[k] = v;
  }
  if (typeof r.labelFont === 'string' && r.labelFont.trim()) out.labelFont = r.labelFont.trim();
  if (typeof r.captionFont === 'string' && r.captionFont.trim()) out.captionFont = r.captionFont.trim();
  if (typeof r.captionFace === 'number') out.captionFace = r.captionFace;
  return out;
}

/**
 * How a drawing that already has structures takes a new style:
 * - 'restyle': every structure is redrawn in it. Each is resized about its middle to the new
 *   bond length, and sizes set by hand (Scale) go back to the style's own.
 * - 'new-only': what is there keeps its look (its bonds, labels and captions are given their
 *   present sizes as their own), and only what is drawn from now on takes the new style.
 */
export type RestyleHow = 'restyle' | 'new-only';

/** Change `doc` to style `next`. Call inside an edit; one undo takes it all back. */
export function applyStyle(doc: Doc, next: DocStyle, how: RestyleHow): void {
  const old = doc.style;
  if (how === 'restyle') {
    for (const frag of doc.fragments()) {
      const ids = [...frag];
      const lengths: number[] = [];
      for (const id of ids) for (const bid of doc.adj.get(id) ?? []) {
        const b = doc.bonds.get(bid)!;
        if (b.a1 !== id) continue;
        const p = doc.atoms.get(b.a1)!, q = doc.atoms.get(b.a2)!;
        lengths.push(Math.hypot(p.x - q.x, p.y - q.y));
      }
      if (lengths.length) {
        lengths.sort((x, y) => x - y);
        const f = next.bondLength / lengths[lengths.length >> 1];
        if (Math.abs(f - 1) > 1e-3) {
          let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
          for (const id of ids) { const a = doc.atoms.get(id)!; x1 = Math.min(x1, a.x); y1 = Math.min(y1, a.y); x2 = Math.max(x2, a.x); y2 = Math.max(y2, a.y); }
          const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
          for (const id of ids) { const a = doc.atoms.get(id)!; doc.updateAtom(id, { x: cx + (a.x - cx) * f, y: cy + (a.y - cy) * f }); }
        }
      }
      for (const id of ids) if (doc.atoms.get(id)!.s !== undefined) doc.updateAtom(id, { s: undefined });
      for (const id of ids) for (const bid of doc.adj.get(id) ?? []) {
        const b = doc.bonds.get(bid)!;
        if (b.a1 === id && b.s !== undefined) doc.updateBond(bid, { s: undefined });
      }
    }
    // caption text written in the old style's font and size takes the new one
    for (const c of [...doc.captions.values()]) {
      if (c.ph) continue;
      let changed = false;
      const runs = c.runs.map((r) => {
        const n = { ...r };
        if (r.size !== undefined && Math.abs(r.size - old.captionSize) < 1e-6) { n.size = next.captionSize; changed = true; }
        if (r.font !== undefined && r.font === old.captionFont) { n.font = next.captionFont; changed = true; }
        return n;
      });
      if (changed) doc.updateCaption(c.id, { runs });
    }
  } else {
    // keep today's look: sizes that came from the old style become each item's own
    const kLabel = old.labelSize / next.labelSize, kLine = old.lineWidth / next.lineWidth;
    for (const a of [...doc.atoms.values()]) if (Math.abs(kLabel - 1) > 1e-6) doc.updateAtom(a.id, { s: (a.s ?? 1) * kLabel });
    for (const b of [...doc.bonds.values()]) if (Math.abs(kLine - 1) > 1e-6) doc.updateBond(b.id, { s: (b.s ?? 1) * kLine });
    for (const c of [...doc.captions.values()]) {
      if (c.ph) continue;
      if (!c.runs.some((r) => r.size === undefined || r.font === undefined)) continue;
      doc.updateCaption(c.id, { runs: c.runs.map((r) => ({ ...r, size: r.size ?? old.captionSize, font: r.font ?? old.captionFont })) });
    }
  }
  doc.setStyle({ ...next });
}

/** Change a stored drawing (a document's figure, a slide) to a new style, as `applyStyle` does. */
export function restyleContents(c: Contents, old: DocStyle, next: DocStyle, how: RestyleHow): Contents {
  const d = new Doc();
  d.style = { ...old };
  d.restoreContents(c);
  d.edit('Drawing style', () => applyStyle(d, next, how));
  return d.contents();
}

// ---------------------------------------------------------------- your own styles and defaults

/** The kinds of tab a style can be the default for. */
export type StyleMode = 'drawing' | 'slides' | 'design' | 'document' | 'sheet';
export const STYLE_MODES: StyleMode[] = ['drawing', 'slides', 'design', 'document', 'sheet'];

/** Your own styles read back from the settings file (bad ones and repeated names dropped). */
export function parseOwnStyles(raw: unknown): DocStyle[] {
  if (!Array.isArray(raw)) return [];
  const out: DocStyle[] = [];
  for (const r of raw) {
    const st = cleanStyle(r);
    if (st && !out.some((o) => o.name === st.name)) out.push(st);
  }
  return out;
}

/** Which style each kind of new tab starts with, by name (kinds left out use their usual style). */
export function parseModeStyles(raw: unknown): Partial<Record<StyleMode, string>> {
  const out: Partial<Record<StyleMode, string>> = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  const r = raw as Record<string, unknown>;
  for (const m of STYLE_MODES) if (typeof r[m] === 'string' && (r[m] as string).trim()) out[m] = (r[m] as string).trim();
  return out;
}

/** A style by name: your own first (so you can keep a changed copy under a built-in's name), then the built-in ones. */
export function styleNamed(name: string, own: DocStyle[]): DocStyle | undefined {
  const st = own.find((s) => s.name === name) ?? presetNamed(name)?.style;
  return st ? { ...st } : undefined;
}

/** A style made bigger or smaller as a whole (bond length, widths and font sizes together). */
export function scaleStyle(st: DocStyle, k: number): DocStyle {
  const r = (v: number) => Math.round(v * k * 1000) / 1000;
  return {
    ...st, bondLength: r(st.bondLength), lineWidth: r(st.lineWidth), boldWidth: r(st.boldWidth), marginWidth: r(st.marginWidth),
    hashSpacing: r(st.hashSpacing), labelSize: r(st.labelSize), captionSize: r(st.captionSize),
  };
}
