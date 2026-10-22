// Slide backgrounds in PowerPoint files (ECMA-376 DrawingML fills inside p:bg): colours,
// gradients, pictures (stretched or tiled) and patterns, each see-through as set. Ours map onto
// PowerPoint's one to one, so they are PowerPoint's own backgrounds in a saved file, and
// PowerPoint's come in as they were (the theme's background fills included).

import { emu, fromEmu, hex6, kid, kids } from './ooxml';
import {
  type Background, type GradientStop, type Sides, type TileAlign, type TileMirror,
  clamp01, isPatternId, pictureFrame, sortedStops,
} from '../deck/background';

const pc = (v: number) => Math.round(v * 100000);
const alphaXml = (transparency?: number) => (transparency ? `<a:alpha val="${pc(1 - clamp01(transparency))}"/>` : '');
const colourXml = (c: string, transparency?: number) => (transparency ? `<a:srgbClr val="${hex6(c)}">${alphaXml(transparency)}</a:srgbClr>` : `<a:srgbClr val="${hex6(c)}"/>`);
const sidesXml = (name: string, s: Sides) => (s.l || s.t || s.r || s.b ? `<a:${name} l="${pc(s.l)}" t="${pc(s.t)}" r="${pc(s.r)}" b="${pc(s.b)}"/>` : `<a:${name}/>`);

/** A picture's file in the package: its relationship id, and its SVG's when it is one. */
export interface BlipIds { id: string; svg: string | null }
const SVG_EXT = '{96DAC541-7B7A-43D3-8B79-37D633B846F1}';
const NS_SVG = 'http://schemas.microsoft.com/office/drawing/2016/SVG/main';

/** A background as a DrawingML fill, for a w × h slide (fill and fit become PowerPoint's cropping and offsets). */
export function fillXml(bg: Background, w: number, h: number, blip: BlipIds | null): string {
  switch (bg.kind) {
    case 'solid': return `<a:solidFill>${colourXml(bg.color, bg.transparency)}</a:solidFill>`;
    case 'gradient': {
      const stops = sortedStops(bg.stops).map((s) => `<a:gs pos="${pc(s.pos)}">${colourXml(s.color, s.transparency)}</a:gs>`).join('');
      const f = bg.focus ?? { x: 0.5, y: 0.5 };
      const how = bg.shape === 'linear'
        ? `<a:lin ang="${Math.round((((bg.angle % 360) + 360) % 360) * 60000)}" scaled="${bg.scaled ? 1 : 0}"/>`
        : `<a:path path="${bg.shape === 'radial' ? 'circle' : 'rect'}"><a:fillToRect l="${pc(f.x)}" t="${pc(f.y)}" r="${pc(1 - f.x)}" b="${pc(1 - f.y)}"/></a:path>`;
      return `<a:gradFill flip="none" rotWithShape="1"><a:gsLst>${stops}</a:gsLst>${how}</a:gradFill>`;
    }
    case 'picture': {
      if (!blip) return '<a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>';
      const ext = blip.svg ? `<a:extLst><a:ext uri="${SVG_EXT}"><asvg:svgBlip xmlns:asvg="${NS_SVG}" r:embed="${blip.svg}"/></a:ext></a:extLst>` : '';
      const alpha = bg.transparency ? `<a:alphaModFix amt="${pc(1 - clamp01(bg.transparency))}"/>` : '';
      const head = `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="${blip.id}">${alpha}${ext}</a:blip>`;
      if (bg.fit === 'tile') {
        const t = { sx: 1, sy: 1, tx: 0, ty: 0, align: 'tl' as TileAlign, mirror: 'none' as TileMirror, ...bg.tile };
        return `${head}<a:srcRect/><a:tile tx="${emu(t.tx)}" ty="${emu(t.ty)}" sx="${pc(t.sx)}" sy="${pc(t.sy)}" flip="${t.mirror}" algn="${t.align}"/></a:blipFill>`;
      }
      const { crop, offsets } = pictureFrame(bg, w, h);
      return `${head}${sidesXml('srcRect', crop)}<a:stretch>${sidesXml('fillRect', offsets)}</a:stretch></a:blipFill>`;
    }
    case 'pattern':
      return `<a:pattFill prst="${bg.pattern}"><a:fgClr>${colourXml(bg.fg)}</a:fgClr><a:bgClr>${colourXml(bg.bg)}</a:bgClr></a:pattFill>`;
  }
}

/** A slide, layout or master's background element. */
export const bgXml = (bg: Background, w: number, h: number, blip: BlipIds | null) => `<p:bg><p:bgPr>${fillXml(bg, w, h, blip)}<a:effectLst/></p:bgPr></p:bg>`;

// ---------------------------------------------------------------- reading

/** What reading a fill needs from the file: colours (through its theme) and pictures. */
export interface FillContext {
  /** The colour in a colour holder (solidFill, gs, fgClr…), with `ph` for the theme's placeholder colour. */
  color(el: Element | null, ph?: Element | null): string | null;
  /** The picture of a blipFill (its data URL, size and the part cut off). */
  picture(blipFill: Element): { src: string; px: { w: number; h: number }; crop?: Sides | null } | null;
  warn(w: string): void;
}

/** How see-through the colour in a colour holder is (its alpha). */
function transparencyIn(el: Element | null, ph?: Element | null): number | undefined {
  const c = kids(el).find((k) => /Clr$/.test(k.localName));
  const val = c?.localName === 'schemeClr' && c.getAttribute('val') === 'phClr' ? kids(ph).find((k) => /Clr$/.test(k.localName)) : c;
  const a = kid(c, 'alpha') ?? kid(val, 'alpha');
  if (!a) return undefined;
  const t = 1 - Number(a.getAttribute('val') ?? 100000) / 100000;
  return t > 0.001 ? clamp01(t) : undefined;
}

const fraction = (el: Element | null, k: string) => Number(el?.getAttribute(k) ?? 0) / 100000;
const sidesOf = (el: Element | null): Sides => ({ l: fraction(el, 'l'), t: fraction(el, 't'), r: fraction(el, 'r'), b: fraction(el, 'b') });
const ALIGN = new Set(['tl', 't', 'tr', 'l', 'ctr', 'r', 'bl', 'b', 'br']);
const near = (a: Sides, b: Sides) => Math.abs(a.l - b.l) + Math.abs(a.t - b.t) + Math.abs(a.r - b.r) + Math.abs(a.b - b.b) < 0.002;
const isZero = (s: Sides) => near(s, { l: 0, t: 0, r: 0, b: 0 });

/**
 * The background in a fill holder (bgPr, or a theme's background fill style): the first fill in
 * it. `ph` is the colour a theme fill's placeholder colour stands for. Null when there is none.
 */
export function readFill(holder: Element | null, size: { w: number; h: number }, x: FillContext, ph?: Element | null): Background | null {
  for (const f of kids(holder)) {
    if (/Fill$/.test(f.localName)) return readOneFill(f, size, x, ph);
  }
  return null;
}

/** One DrawingML fill element (solidFill, gradFill, blipFill, pattFill, noFill) as a background. */
export function readOneFill(f: Element, size: { w: number; h: number }, x: FillContext, ph?: Element | null): Background | null {
  {
    switch (f.localName) {
      case 'noFill': return { kind: 'solid', color: '#ffffff' };
      case 'solidFill': {
        const color = x.color(f, ph);
        if (!color) return null;
        const t = transparencyIn(f, ph);
        return { kind: 'solid', color, ...(t ? { transparency: t } : {}) };
      }
      case 'gradFill': {
        const stops: GradientStop[] = [];
        for (const gs of kids(kid(f, 'gsLst'), 'gs')) {
          const color = x.color(gs, ph);
          if (!color) continue;
          const t = transparencyIn(gs, ph);
          stops.push({ pos: clamp01(Number(gs.getAttribute('pos') ?? 0) / 100000), color, ...(t ? { transparency: t } : {}) });
        }
        if (!stops.length) return null;
        const lin = kid(f, 'lin'), path = kid(f, 'path');
        if (path) {
          const r = kid(path, 'fillToRect');
          // the focus: the middle of the rectangle the gradient starts from
          const s = sidesOf(r);
          const focus = { x: clamp01((s.l + 1 - s.r) / 2), y: clamp01((s.t + 1 - s.b) / 2) };
          return { kind: 'gradient', shape: path.getAttribute('path') === 'circle' ? 'radial' : 'rect', angle: 0, focus, stops: sortedStops(stops) };
        }
        const angle = Number(lin?.getAttribute('ang') ?? 0) / 60000;
        const scaled = lin?.getAttribute('scaled') === '1' || lin?.getAttribute('scaled') === 'true';
        return { kind: 'gradient', shape: 'linear', angle: +angle.toFixed(3), ...(scaled ? { scaled: true } : {}), stops: sortedStops(stops) };
      }
      case 'blipFill': {
        const pic = x.picture(f);
        if (!pic) return null;
        const amt = kid(f, 'blip', 'alphaModFix');
        const t = amt ? 1 - Number(amt.getAttribute('amt') ?? 100000) / 100000 : 0;
        const transparency = t > 0.001 ? { transparency: clamp01(t) } : {};
        const tile = kid(f, 'tile');
        if (tile) {
          const flip = tile.getAttribute('flip') ?? 'none';
          const algn = tile.getAttribute('algn') ?? 'tl';
          return {
            kind: 'picture', src: pic.src, px: pic.px, fit: 'tile', ...transparency,
            tile: {
              sx: Number(tile.getAttribute('sx') ?? 100000) / 100000 || 1, sy: Number(tile.getAttribute('sy') ?? 100000) / 100000 || 1,
              tx: +fromEmu(tile.getAttribute('tx')).toFixed(2), ty: +fromEmu(tile.getAttribute('ty')).toFixed(2),
              align: (ALIGN.has(algn) ? algn : 'tl') as TileAlign, mirror: (['none', 'x', 'y', 'xy'].includes(flip) ? flip : 'none') as TileMirror,
            },
          };
        }
        const crop = pic.crop ?? { l: 0, t: 0, r: 0, b: 0 };
        const offsets = sidesOf(kid(f, 'stretch', 'fillRect'));
        const out: Extract<Background, { kind: 'picture' }> = { kind: 'picture', src: pic.src, px: pic.px, fit: 'stretch', ...transparency };
        // a picture cut or set in to keep its proportions was filling or fitting the slide
        for (const fit of ['fill', 'fit'] as const) {
          const want = pictureFrame({ ...out, fit }, size.w, size.h);
          if (!(isZero(crop) && isZero(offsets)) && near(want.crop, crop) && near(want.offsets, offsets)) return { ...out, fit };
        }
        if (!isZero(crop)) out.crop = crop;
        if (!isZero(offsets)) out.offsets = offsets;
        return out;
      }
      case 'pattFill': {
        const prst = f.getAttribute('prst') ?? 'pct5';
        const fg = x.color(kid(f, 'fgClr'), ph) ?? '#000000', bg = x.color(kid(f, 'bgClr'), ph) ?? '#ffffff';
        return { kind: 'pattern', pattern: isPatternId(prst) ? prst : 'pct50', fg, bg };
      }
      default: return null;
    }
  }
}
