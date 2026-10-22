// Picture Format settings as PowerPoint and Word keep them, both ways. Brightness, contrast,
// recolouring, the see-through colour and the see-through amount are DrawingML's own picture
// effects on the blip, which Office applies as it shows the picture. Sharpening and Remove
// Background are Office 2010's: Office keeps the picture with them worked in, and the original
// beside it as a layer with the effects listed, so the effects can be changed again; we do the
// same. A picture cut to a shape is the picture's preset geometry.

import type { BackgroundRemoval, PictureFx } from '../model';
import { SEPIA_LIGHT, WASHOUT, knownShape, tidyFx } from '../render/picture-fx';
import { hex6, kid, kids, NS } from './ooxml';

/** Office 2010's drawing namespace, and the blip extension that holds a picture's layer and effects. */
export const NS_A14 = 'http://schemas.microsoft.com/office/drawing/2010/main';
export const IMG_PROPS_EXT = '{BEBA8EAE-BF5A-486C-A8C5-ECC9F3942E4B}';

const pct = (v: number) => Math.round(v * 100000);
const srgb = (c: string, more = '') => `<a:srgbClr val="${hex6(c)}">${more}</a:srgbClr>`;

/** The effects Office applies as it shows the picture, as children of a:blip (in the order it applies them). */
export function blipEffectsXml(fx: PictureFx | undefined): string {
  const f = tidyFx(fx);
  if (!f) return '';
  const out: string[] = [];
  if (f.clear) out.push(`<a:clrChange><a:clrFrom>${srgb(f.clear)}</a:clrFrom><a:clrTo>${srgb(f.clear, '<a:alpha val="0"/>')}</a:clrTo></a:clrChange>`);
  if (f.bright || f.contrast) out.push(`<a:lum${f.bright ? ` bright="${pct(f.bright)}"` : ''}${f.contrast ? ` contrast="${pct(f.contrast)}"` : ''}/>`);
  const rc = f.recolor;
  if (rc?.kind === 'grey') out.push('<a:grayscl/>');
  else if (rc?.kind === 'bw') out.push(`<a:biLevel thresh="${pct(rc.level ?? 0.5)}"/>`);
  else if (rc?.kind === 'washout') out.push(`<a:lum bright="${pct(WASHOUT.bright)}" contrast="${pct(WASHOUT.contrast)}"/>`);
  else if (rc?.kind === 'sepia') out.push(`<a:duotone><a:prstClr val="black"/>${srgb(SEPIA_LIGHT)}</a:duotone>`);
  else if (rc?.kind === 'tint') out.push(`<a:duotone>${srgb(rc.dark)}${srgb(rc.light)}</a:duotone>`);
  if (f.alpha) out.push(`<a:alphaModFix amt="${pct(1 - f.alpha)}"/>`);
  return out.join('');
}

/** A mark of Remove Background as Office keeps one: a short stroke, in thousandths of a percent of the picture. */
const markXml = (tag: string, [x, y]: [number, number]) => {
  const px = Math.round(x * 100000), py = Math.round(y * 100000);
  return `<a14:${tag} x1="${px}" y1="${py}" x2="${Math.min(100000, px + 1)}" y2="${py}"/>`;
};

/**
 * The extension listing the layer (the original picture, `layerId`) and the effects worked into
 * the blip: Remove Background (over the part shown, `crop`) and sharpening or softening.
 */
export function imgPropsXml(fx: PictureFx | undefined, layerId: string, crop?: { l: number; t: number; r: number; b: number } | null): string {
  const f = tidyFx(fx);
  if (!f || (!f.bg && !f.sharpen)) return '';
  const fxs: string[] = [];
  if (f.bg) {
    const c = crop ?? { l: 0, t: 0, r: 0, b: 0 };
    const marks = [...(f.bg.keep ?? []).map((p) => markXml('foregroundMark', p)), ...(f.bg.drop ?? []).map((p) => markXml('backgroundMark', p))];
    fxs.push(`<a14:imgEffect><a14:backgroundRemoval t="${pct(c.t)}" b="${pct(1 - c.b)}" l="${pct(c.l)}" r="${pct(1 - c.r)}">${marks.join('')}</a14:backgroundRemoval></a14:imgEffect>`);
  }
  if (f.sharpen) fxs.push(`<a14:imgEffect><a14:sharpenSoften amount="${pct(f.sharpen)}"/></a14:imgEffect>`);
  return `<a:ext uri="${IMG_PROPS_EXT}"><a14:imgProps xmlns:a14="${NS_A14}"><a14:imgLayer r:embed="${layerId}">${fxs.join('')}</a14:imgLayer></a14:imgProps></a:ext>`;
}

/** The picture's geometry: the shape it is cut to, else `fallback` (a rectangle, or its rounded corners). */
export function pictureGeomXml(fx: PictureFx | undefined, fallback: string): string {
  const s = tidyFx(fx)?.shape;
  return s ? `<a:prstGeom prst="${s}"><a:avLst/></a:prstGeom>` : fallback;
}

// ---------------------------------------------------------------- reading

/** A colour inside a DrawingML element: sRGB or a preset (theme colours count as black or white by name). */
function colourIn(el: Element | null): string | null {
  if (!el) return null;
  const v = el.getAttribute('val') ?? '';
  if (el.localName === 'srgbClr' && /^[0-9a-f]{6}$/i.test(v)) return `#${v.toLowerCase()}`;
  if (el.localName === 'prstClr' || el.localName === 'schemeClr') {
    if (/^(black|dk1|tx1)$/i.test(v)) return '#000000';
    if (/^(white|lt1|bg1)$/i.test(v)) return '#ffffff';
  }
  if (el.localName === 'sysClr') return `#${(el.getAttribute('lastClr') ?? '000000').toLowerCase()}`;
  return null;
}

/** What a read picture's settings came to, and what it had that isn't kept here. */
export interface ReadPictureFx {
  fx?: PictureFx;
  /** The layer: the original picture, when the blip has effects worked in (its relationship id). */
  layer?: string;
  /** Effects Office has that aren't kept here (artistic effects, saturation, colour temperature…). */
  dropped: boolean;
}

const num = (el: Element, name: string, dflt = 0) => {
  const v = Number(el.getAttribute(name));
  return Number.isFinite(v) && el.hasAttribute(name) ? v / 100000 : dflt;
};

/** A picture's settings from its a:blip (and its geometry from spPr). */
export function readPictureFx(blip: Element | null, spPr: Element | null): ReadPictureFx {
  const fx: PictureFx = {};
  let dropped = false;
  let layer: string | undefined;
  for (const el of kids(blip)) {
    switch (el.localName) {
      case 'lum': {
        const b = num(el, 'bright'), c = num(el, 'contrast');
        if (Math.abs(b - WASHOUT.bright) < 0.005 && Math.abs(c - WASHOUT.contrast) < 0.005) fx.recolor = { kind: 'washout' };
        else { if (b) fx.bright = b; if (c) fx.contrast = c; }
        break;
      }
      case 'grayscl': fx.recolor = { kind: 'grey' }; break;
      case 'biLevel': fx.recolor = { kind: 'bw', ...(num(el, 'thresh', 0.5) !== 0.5 ? { level: num(el, 'thresh', 0.5) } : {}) }; break;
      case 'duotone': {
        const [a, b] = kids(el).map(colourIn);
        if (a && b) fx.recolor = a === '#000000' && b === SEPIA_LIGHT ? { kind: 'sepia' } : { kind: 'tint', dark: a, light: b };
        else dropped = true;
        break;
      }
      case 'alphaModFix': {
        const a = +(1 - num(el, 'amt', 1)).toFixed(5);
        if (a > 0.001) fx.alpha = Math.min(1, a);
        break;
      }
      case 'clrChange': {
        const from = colourIn(kids(kid(el, 'clrFrom'))[0] ?? null);
        if (from) fx.clear = from;
        break;
      }
      case 'extLst': {
        for (const ext of kids(el, 'ext')) {
          const props = kid(ext, 'imgProps');
          const lay = kid(props, 'imgLayer');
          if (!lay) continue;
          layer = lay.getAttributeNS(NS.r, 'embed') ?? undefined;
          for (const e of kids(lay, 'imgEffect')) {
            const it = kids(e)[0];
            if (!it) continue;
            if (it.localName === 'sharpenSoften') { const v = num(it, 'amount'); if (v) fx.sharpen = Math.max(-1, Math.min(1, v)); }
            else if (it.localName === 'brightnessContrast') { const b = num(it, 'bright'), c = num(it, 'contrast'); if (b) fx.bright = b; if (c) fx.contrast = c; }
            else if (it.localName === 'backgroundRemoval') {
              const bg: BackgroundRemoval = {};
              const pts = (tag: string) => kids(it, tag).map((m) => [num(m, 'x1'), num(m, 'y1')] as [number, number]);
              const keep = pts('foregroundMark'), drop = pts('backgroundMark');
              if (keep.length) bg.keep = keep;
              if (drop.length) bg.drop = drop;
              fx.bg = bg;
            } else dropped = true;
          }
        }
        break;
      }
      case 'alphaBiLevel': case 'alphaCeiling': case 'alphaFloor': case 'alphaInv': case 'alphaMod': case 'alphaRepl':
      case 'blur': case 'clrRepl': case 'fillOverlay': case 'hsl': case 'tint':
        dropped = true;
        break;
    }
  }
  const prst = kid(spPr, 'prstGeom')?.getAttribute('prst');
  if (prst && prst !== 'rect' && prst !== 'roundRect' && knownShape(prst)) fx.shape = prst;
  const tidy = tidyFx(fx);
  return { ...(tidy ? { fx: tidy } : {}), ...(layer ? { layer } : {}), dropped };
}

