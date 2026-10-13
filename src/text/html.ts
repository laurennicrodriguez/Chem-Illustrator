// Styled text on the clipboard as HTML, the form Word, PowerPoint, Outlook and web pages all
// read and write. Copying gives HTML with bold, italic, subscripts, sizes, colours, alignment
// and lists, plus an exact copy of our own runs for pasting back here. Pasting reads HTML from
// Word (including its own way of writing lists) and from other programs and web pages.

import type { Justify, ParaStyle, TextRun } from '../model';
import * as rt from '../richtext';
import { fitParas, listMarkers, paraCount, splitParagraphs } from './paragraphs';

/** The attribute that carries our own copy of the text. */
const OWN_ATTR = 'data-chem-illustrator-text';

export interface ClipText {
  runs: TextRun[];
  paras: ParaStyle[];
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const fmt = (n: number) => String(Math.round(n * 100) / 100);

/** HTML for a styled text, for Word and other programs (and for pasting back here exactly). */
export function richToHtml(text: ClipText, opts: { justify?: Justify; defaultSize?: number; font?: string } = {}): string {
  const defaultSize = opts.defaultSize ?? 10;
  const n = paraCount(rt.plainText(text.runs));
  const paras = fitParas(text.paras, n);
  const markers = listMarkers(paras);
  const span = (r: TextRun, t: string, pos: rt.Part['pos']): string => {
    const css: string[] = [`font-family:${r.font ? `'${r.font}'` : opts.font ?? 'Arial'}`, `font-size:${fmt(r.size ?? defaultSize)}pt`];
    if (r.bold) css.push('font-weight:bold');
    if (r.italic) css.push('font-style:italic');
    if (r.underline) css.push('text-decoration:underline');
    if (r.color) css.push(`color:${r.color}`);
    const body = esc(t).replace(/ {2}/g, ' &nbsp;');
    const inner = `<span style="${css.join(';')}">${body}</span>`;
    return pos === 'sub' ? `<sub>${inner}</sub>` : pos === 'sup' ? `<sup>${inner}</sup>` : inner;
  };
  const paraHtml = (runs: TextRun[]): string => {
    let out = '';
    for (const r of runs) {
      if (r.formula && !r.sub && !r.sup) for (const p of rt.formulaParts(r.text)) out += span(r, p.text, p.pos);
      else out += span(r, r.text, r.sub ? 'sub' : r.sup ? 'sup' : 'base');
    }
    return out || '&nbsp;';
  };
  const blocks = splitParagraphs(text.runs);
  let html = '';
  // open lists, innermost last: [kind, level]
  const open: ['ul' | 'ol', number][] = [];
  const closeTo = (level: number) => { while (open.length && open[open.length - 1][1] >= level) html += `</li></${open.pop()![0]}>`; };
  blocks.forEach((runs, i) => {
    const p = paras[i];
    const align = p.align ?? opts.justify ?? 'left';
    const style = [`margin:0`, ...(align !== 'left' ? [`text-align:${align}`] : []),
      ...(p.spaceBefore ? [`margin-top:${fmt(p.spaceBefore)}pt`] : []), ...(p.spaceAfter ? [`margin-bottom:${fmt(p.spaceAfter)}pt`] : []),
      ...(p.indent ? [`margin-left:${fmt(p.indent)}pt`] : [])].join(';');
    if (!p.list) {
      closeTo(0);
      html += `<p style="${style}">${paraHtml(runs)}</p>`;
      return;
    }
    const level = p.level ?? 0;
    const kind = p.list === 'bullet' ? 'ul' : 'ol';
    if (p.cont && open.length && open[open.length - 1][1] === level) {
      html += `<p style="${style}">${paraHtml(runs)}</p>`;
      return;
    }
    // close deeper lists, and a list of another kind at this level
    while (open.length && (open[open.length - 1][1] > level || (open[open.length - 1][1] === level && open[open.length - 1][0] !== kind))) html += `</li></${open.pop()![0]}>`;
    if (open.length && open[open.length - 1][1] === level) html += '</li>';
    else {
      const mark = markers[i];
      const type = kind === 'ol' && mark ? (/^[a-z]+\.$/.test(mark) && !/^[ivxlcdm]+\.$/.test(mark) ? ' type="a"' : /^[ivxlcdm]+\.$/.test(mark) && level % 3 === 2 ? ' type="i"' : '') : '';
      html += `<${kind}${type} style="margin-top:0;margin-bottom:0">`;
      open.push([kind, level]);
    }
    html += `<li><p style="${style}">${paraHtml(runs)}</p>`;
  });
  closeTo(0);
  const own = esc(JSON.stringify({ runs: text.runs, paras: fitParas(text.paras, n) }));
  return `<div ${OWN_ATTR}="${own}">${html}</div>`;
}

/** Plain text for programs that take nothing else: list items start with their bullet or number. */
export function richToPlain(text: ClipText): string {
  const n = paraCount(rt.plainText(text.runs));
  const paras = fitParas(text.paras, n);
  const markers = listMarkers(paras);
  return splitParagraphs(text.runs)
    .map((runs, i) => {
      const p = paras[i];
      const body = runs.map((r) => r.text).join('');
      if (!p.list) return body;
      const pad = '\t'.repeat(p.level ?? 0);
      return markers[i] ? `${pad}${markers[i]}\t${body}` : `${pad}\t${body}`;
    })
    .join('\n');
}

// ------------------------------------------------------------------ pasting HTML

interface Ctx extends rt.RunStyle { pos?: 'sub' | 'sup' }

const BLOCKS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'TR', 'BLOCKQUOTE', 'PRE', 'TABLE', 'UL', 'OL', 'DL', 'DT', 'DD', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER']);
const SKIP = new Set(['STYLE', 'SCRIPT', 'HEAD', 'TITLE', 'META', 'LINK', 'XML', 'O:P', 'TEMPLATE', 'NOSCRIPT']);

/** CSS colour → #rrggbb (or null for black and anything unreadable). */
function cssColor(v: string): string | null {
  v = v.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) v = '#' + [...m[1]].map((c) => c + c).join('');
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(v);
  if (m) v = '#' + [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('');
  const named: Record<string, string> = { red: '#ff0000', blue: '#0000ff', green: '#008000', black: '#000000', white: '#ffffff', gray: '#808080', grey: '#808080', windowtext: '#000000' };
  if (named[v]) v = named[v];
  if (!/^#[0-9a-f]{6}$/.test(v)) return null;
  return v === '#000000' ? null : v;
}

/** Text size from CSS, in points. */
function cssSize(v: string): number | null {
  const m = /^([\d.]+)\s*(pt|px|em|%)?$/.exec(v.trim());
  if (!m) return null;
  const n = Number(m[1]);
  if (!(n > 0)) return null;
  return m[2] === 'px' ? n * 0.75 : m[2] === 'em' || m[2] === '%' ? null : n;
}

function styleDecl(el: Element, prop: string): string | null {
  const s = el.getAttribute('style');
  if (!s) return null;
  for (const part of s.split(';')) {
    const i = part.indexOf(':');
    if (i > 0 && part.slice(0, i).trim().toLowerCase() === prop) return part.slice(i + 1).trim();
  }
  return null;
}

/**
 * Read styled text from HTML. Bold, italic, underline, subscripts, superscripts and colours
 * come with the text; with `keepFonts` its fonts and sizes do too (otherwise the text takes
 * those of the text it is pasted into). Lists come as lists, and alignment with each paragraph.
 */
export function htmlToRich(html: string, opts: { keepFonts?: boolean } = {}): ClipText | null {
  const dom = new DOMParser().parseFromString(html, 'text/html');
  const own = dom.querySelector(`[${OWN_ATTR}]`);
  if (own) {
    try {
      const v = JSON.parse(own.getAttribute(OWN_ATTR)!) as ClipText;
      if (Array.isArray(v.runs)) return { runs: rt.normalizeRuns(v.runs), paras: fitParas(v.paras, paraCount(rt.plainText(v.runs))) };
    } catch { /* read it as HTML */ }
  }
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [{}];
  let started = false;
  // the text so far ends a paragraph: the next text starts a new one, in `nextStyle`
  let breakWanted = false;
  let nextStyle: ParaStyle = {};
  let skipping = false;
  const listStack: ('bullet' | 'number')[] = [];

  const ensurePara = () => {
    if (!started) { paras[0] = nextStyle; started = true; }
    else if (breakWanted) { runs.push({ text: '\n' }); paras.push(nextStyle); }
    breakWanted = false;
    nextStyle = {};
  };
  const addText = (t: string, c: Ctx) => {
    if (!t) return;
    ensurePara();
    const r: TextRun = { text: t };
    if (c.bold) r.bold = true;
    if (c.italic) r.italic = true;
    if (c.underline) r.underline = true;
    if (c.color) r.color = c.color;
    if (c.pos === 'sub') r.sub = true;
    if (c.pos === 'sup') r.sup = true;
    if (opts.keepFonts) {
      if (c.size) r.size = c.size;
      if (c.font && !rt.isSymbolFont(c.font)) r.font = c.font;
    }
    runs.push(r);
  };

  const styleOf = (el: Element, c: Ctx): Ctx => {
    const n: Ctx = { ...c };
    const tag = el.tagName.toUpperCase();
    if (tag === 'B' || tag === 'STRONG') n.bold = true;
    if (tag === 'I' || tag === 'EM') n.italic = true;
    if (tag === 'U' || tag === 'INS') n.underline = true;
    if (tag === 'SUB') n.pos = 'sub';
    if (tag === 'SUP') n.pos = 'sup';
    if (/^H[1-6]$/.test(tag)) n.bold = true;
    const fw = styleDecl(el, 'font-weight');
    if (fw) n.bold = fw === 'bold' || fw === 'bolder' || Number(fw) >= 600;
    const fs = styleDecl(el, 'font-style');
    if (fs) n.italic = fs === 'italic' || fs === 'oblique';
    const td = styleDecl(el, 'text-decoration') ?? styleDecl(el, 'text-decoration-line') ?? styleDecl(el, 'text-underline');
    if (td) n.underline = /underline|single/.test(td);
    const va = styleDecl(el, 'vertical-align');
    if (va) n.pos = va === 'sub' ? 'sub' : va === 'super' ? 'sup' : va === 'baseline' ? undefined : n.pos;
    const col = styleDecl(el, 'color') ?? (tag === 'FONT' ? el.getAttribute('color') : null);
    if (col) { const v = cssColor(col); if (v) n.color = v; else delete n.color; }
    const size = styleDecl(el, 'font-size');
    if (size) { const v = cssSize(size); if (v) n.size = v; }
    const face = styleDecl(el, 'font-family') ?? (tag === 'FONT' ? el.getAttribute('face') : null);
    if (face) n.font = face.split(',')[0].trim().replace(/^['"]|['"]$/g, '');
    return n;
  };

  const blockPara = (el: Element, tag: string): ParaStyle => {
    const p: ParaStyle = {};
    const align = (styleDecl(el, 'text-align') ?? el.getAttribute('align') ?? '').toLowerCase();
    if (align === 'center' || align === 'right' || align === 'justify') p.align = align as Justify;
    const before = cssSize(styleDecl(el, 'margin-top') ?? '');
    const after = cssSize(styleDecl(el, 'margin-bottom') ?? '');
    if (before && before < 100) p.spaceBefore = before;
    if (after && after < 100) p.spaceAfter = after;
    const msoList = /mso-list\s*:\s*l\d+\s+level(\d+)/i.exec(el.getAttribute('style') ?? '');
    if (tag === 'LI' && listStack.length) {
      p.list = listStack[listStack.length - 1];
      if (listStack.length > 1) p.level = listStack.length - 1;
    } else if (msoList) {
      // a Word list item: its level is in the style, its kind in the number or bullet in front
      const marker = wordMarker(el);
      p.list = marker !== null && /^\(?[0-9a-zA-Z]{1,6}[.)]/.test(marker) ? 'number' : 'bullet';
      const level = Number(msoList[1]) - 1;
      if (level > 0) p.level = level;
    } else if (tag === 'LI') p.list = 'bullet';
    return p;
  };

  /** Is there text after this node in its block (a line break at the very end of a paragraph shows nothing)? */
  const textAfter = (n: Node): boolean => {
    for (let s = n.nextSibling; s; s = s.nextSibling) if ((s.textContent ?? '').trim() || s.nodeName === 'BR') return true;
    const up = n.parentElement;
    return !!up && !BLOCKS.has(up.tagName.toUpperCase()) && textAfter(up);
  };

  const walk = (node: Node, c: Ctx) => {
    for (let ch = node.firstChild; ch; ch = ch.nextSibling) {
      if (ch.nodeType === 8) {
        // Word wraps the bullet or number of a list item in [if !supportLists] … [endif]
        const d = (ch as Comment).data;
        if (/\[if !supportLists\]/i.test(d)) skipping = true;
        else if (/\[endif\]/i.test(d)) skipping = false;
        continue;
      }
      if (ch.nodeType === 3) {
        if (skipping) continue;
        let t = (ch as Text).data.replace(/[\r\n\t ]+/g, ' ').replace(/\u00a0/g, ' ');
        if (!started || breakWanted) t = t.replace(/^ +/, '');
        if (c.font && rt.isSymbolFont(c.font)) t = rt.fromSymbolFont(t);
        addText(t, c);
        continue;
      }
      if (ch.nodeType !== 1) continue;
      const el = ch as Element;
      const tag = el.tagName.toUpperCase();
      if (SKIP.has(tag) && tag !== 'O:P') continue;
      if (/mso-list\s*:\s*ignore/i.test(el.getAttribute('style') ?? '')) continue;
      if (tag === 'BR') {
        if (!textAfter(el)) continue;
        const prev = started ? paras[paras.length - 1] : {};
        ensurePara();
        runs.push({ text: '\n' });
        paras.push(cleanList({ ...prev, cont: prev.list ? true : undefined }));
        continue;
      }
      const cc = styleOf(el, c);
      if (tag === 'UL' || tag === 'OL') {
        listStack.push(tag === 'UL' ? 'bullet' : 'number');
        breakWanted = started;
        walk(el, cc);
        listStack.pop();
        breakWanted = started;
        continue;
      }
      if (BLOCKS.has(tag)) {
        const p = blockPara(el, tag);
        breakWanted = started;
        nextStyle = p;
        const before = runs.length;
        walk(el, cc);
        // an empty paragraph (Word writes a blank line as a paragraph holding a space) stays
        if (runs.length === before && (tag === 'P' || /^H[1-6]$/.test(tag)) && (el.textContent !== '' || el.querySelector('br'))) {
          nextStyle = p;
          ensurePara();
          started = true;
        }
        breakWanted = started;
        continue;
      }
      walk(el, cc);
    }
  };
  walk(dom.body ?? dom.documentElement, {});
  const clean = trimParagraphEnds(runs);
  if (!rt.plainText(clean).replace(/\n/g, '')) return null;
  return { runs: clean, paras: fitParas(paras, paraCount(rt.plainText(clean))) };
}

const cleanList = (p: ParaStyle): ParaStyle => {
  const o: ParaStyle = { ...p };
  for (const k of Object.keys(o) as (keyof ParaStyle)[]) if (o[k] === undefined) delete o[k];
  return o;
};

/** The bullet or number Word writes in front of a list item (null if it has none). */
function wordMarker(el: Element): string | null {
  const ign = el.querySelector('[style*="mso-list:Ignore" i], [style*="mso-list: Ignore" i]');
  if (ign) return (ign.textContent ?? '').replace(/ /g, ' ').trim();
  // older Word: the marker sits between the supportLists comments
  let inside = false, out = '';
  const walk = (n: Node) => {
    for (let c = n.firstChild; c; c = c.nextSibling) {
      if (c.nodeType === 8) {
        const d = (c as Comment).data;
        if (/\[if !supportLists\]/i.test(d)) inside = true;
        else if (/\[endif\]/i.test(d)) inside = false;
      } else if (c.nodeType === 3 && inside) out += (c as Text).data;
      else walk(c);
    }
  };
  walk(el);
  out = out.replace(/ /g, ' ').trim();
  return out || null;
}

/** Take spaces off the ends of each paragraph. */
function trimParagraphEnds(runs: TextRun[]): TextRun[] {
  const out = runs.map((r) => ({ ...r }));
  for (let i = 0; i < out.length; i++) {
    const r = out[i];
    const next = out[i + 1];
    if (!next || next.text.startsWith('\n')) r.text = r.text.replace(/ +$/, '');
    r.text = r.text.replace(/ +\n/g, '\n');
  }
  return rt.normalizeRuns(out);
}
