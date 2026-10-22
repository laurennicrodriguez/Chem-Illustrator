// Notes pages and handouts (View > Notes Page, Notes Master, Handout Master): where the slide's
// picture, its notes and the header, date, footer and page number go on the page, as
// PowerPoint lays them out (7.5 × 10 inches, the slide in the top half, the notes under it), and
// the masters as PowerPoint's own notes master and handout master parts.

import type { Master, NotesHF, SlideSize } from './deck';
import { dateText } from './deck';

/** Notes Master: the page's way up, how much of it the slide's picture takes, and the notes' type. */
export interface NotesPageSetup { landscape?: boolean; slide?: number; font?: string; size?: number }

/** Handout Master: slides to a page, the page's way up, and frames round the slides. */
export interface HandoutSetup { perPage: 1 | 2 | 3 | 4 | 6 | 9; landscape?: boolean; frame?: boolean }

export const HANDOUT_COUNTS = [1, 2, 3, 4, 6, 9] as const;
export const defaultHandout = (): HandoutSetup => ({ perPage: 3, frame: true });

/** A notes page: 7.5 × 10 inches (PowerPoint's notes size), turned for landscape. */
export function notesPageSize(setup?: NotesPageSetup): SlideSize {
  return setup?.landscape ? { w: 720, h: 540 } : { w: 540, h: 720 };
}

export interface Box { x: number; y: number; w: number; h: number }

/** Where things go on a notes page or handout: the header and date along the top, the footer and number along the bottom. */
export interface PageFrame { page: SlideSize; header: Box; date: Box; footer: Box; number: Box }

function frame(page: SlideSize): PageFrame {
  const m = 36, h = 36, w = (page.w - 2 * m) / 2;
  return {
    page,
    header: { x: m, y: 18, w, h },
    date: { x: m + w, y: 18, w, h },
    footer: { x: m, y: page.h - 18 - h, w, h },
    number: { x: m + w, y: page.h - 18 - h, w, h },
  };
}

/** A notes page's layout: its frame, the slide's picture (keeping the slide's shape) and the notes under it. */
export function notesLayout(slide: SlideSize, setup?: NotesPageSetup): PageFrame & { slide: Box; notes: Box } {
  const page = notesPageSize(setup);
  const f = frame(page);
  const share = Math.max(0.2, Math.min(0.75, setup?.slide ?? 0.42));
  const top = 72, room = { w: page.w - 2 * 72, h: page.h * share - top + 24 };
  const k = Math.min(room.w / slide.w, room.h / slide.h);
  const sw = slide.w * k, sh = slide.h * k;
  const pic = { x: (page.w - sw) / 2, y: top, w: sw, h: sh };
  const notesTop = pic.y + pic.h + 24;
  return { ...f, slide: pic, notes: { x: 72, y: notesTop, w: page.w - 144, h: Math.max(36, page.h - 72 - notesTop) } };
}

/** A handout page's layout: its frame and the cells the slides go in (with lines for notes beside three to a page). */
export function handoutLayout(slide: SlideSize, setup: HandoutSetup, paper: SlideSize = { w: 612, h: 792 }): PageFrame & { cells: Box[]; lines: Box[] } {
  const long = Math.max(paper.w, paper.h), short = Math.min(paper.w, paper.h);
  const page = setup.landscape ? { w: long, h: short } : { w: short, h: long };
  const f = frame(page);
  const n = setup.perPage;
  const area = { x: 54, y: 72, w: page.w - 108, h: page.h - 144 };
  const land = !!setup.landscape;
  const cols = n === 1 ? 1 : n === 2 ? (land ? 2 : 1) : n === 3 ? 1 : n === 4 ? 2 : n === 6 ? (land ? 3 : 2) : 3;
  const rows = Math.ceil(n / cols);
  const gap = 18;
  const cw = n === 3 ? area.w / 2 - gap / 2 : (area.w - gap * (cols - 1)) / cols, ch = (area.h - gap * (rows - 1)) / rows;
  const cells: Box[] = [], lines: Box[] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (cells.length >= n) break;
    const k = Math.min(cw / slide.w, ch / slide.h);
    const w = slide.w * k, h = slide.h * k;
    const x = area.x + c * (cw + gap) + (cw - w) / 2, y = area.y + r * (ch + gap) + (ch - h) / 2;
    cells.push({ x, y, w, h });
    if (n === 3) lines.push({ x: area.x + cw + gap, y, w: area.w - cw - gap, h });
  }
  return { ...f, cells, lines };
}

/** The header, date, footer and page number a notes page or handout shows (each empty when off). */
export function pageTexts(hf: NotesHF | undefined, page: number, now = new Date()): { header: string; date: string; footer: string; number: string } {
  if (!hf) return { header: '', date: '', footer: '', number: String(page) };
  return {
    header: hf.header,
    date: hf.date ? dateText({ dateFormat: hf.dateFormat, dateFixed: hf.dateFixed }, now) : '',
    footer: hf.footer,
    number: hf.pageNumbers ? String(page) : '',
  };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The header, date, footer and number as SVG text in a page's frame. */
export function frameSvg(f: PageFrame, t: ReturnType<typeof pageTexts>, font = 'Arial'): string {
  const text = (s: string, b: Box, end: boolean) => s ? `<text x="${end ? b.x + b.w : b.x}" y="${b.y + b.h / 2 + 4}" font-family="${esc(font)}" font-size="11" fill="#444"${end ? ' text-anchor="end"' : ''}>${esc(s)}</text>` : '';
  return text(t.header, f.header, false) + text(t.date, f.date, true) + text(t.footer, f.footer, false) + text(t.number, f.number, true);
}

/**
 * The notes as lines of text in the notes box, wrapped to its width (`measure` gives a text's
 * width at a size). Lines past the bottom are left off.
 */
export function notesLines(text: string, box: Box, size: number, measure: (s: string, size: number) => number): { text: string; y: number }[] {
  const out: { text: string; y: number }[] = [];
  const lead = size * 1.25;
  let y = box.y + size;
  for (const para of text.split('\n')) {
    const words = para.split(/(\s+)/);
    let line = '';
    const push = () => { if (y <= box.y + box.h) out.push({ text: line.trimEnd(), y }); y += lead; line = ''; };
    if (!para.trim()) { push(); continue; }
    for (const w of words) {
      if (line && measure(line + w, size) > box.w && w.trim()) push();
      line += line || w.trim() ? w : '';
    }
    if (line) push();
  }
  return out;
}

/** One notes page as SVG: the slide's picture (an SVG of the slide), its notes, and the header and footer. */
export function notesPageSvg(m: Master, slide: SlideSize, slideSvg: string, notes: string, page: number, measure: (s: string, size: number) => number, place: (svg: string, b: Box) => string): string {
  const setup = m.notesPage;
  const L = notesLayout(slide, setup);
  const size = setup?.size ?? 12, font = setup?.font || m.bodyFont || 'Arial';
  const lines = notesLines(notes, L.notes, size, measure).map((l) => `<text x="${L.notes.x}" y="${l.y}" font-family="${esc(font)}" font-size="${size}" fill="#000">${esc(l.text)}</text>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.page.w}pt" height="${L.page.h}pt" viewBox="0 0 ${L.page.w} ${L.page.h}"><rect width="${L.page.w}" height="${L.page.h}" fill="#fff"/>` +
    place(slideSvg, L.slide) + `<rect x="${L.slide.x}" y="${L.slide.y}" width="${L.slide.w}" height="${L.slide.h}" fill="none" stroke="#000" stroke-width="0.75"/>` +
    lines + frameSvg(L, pageTexts(m.notesHF, page), font) + '</svg>';
}

/** One handout page as SVG: its slides (SVGs), lines for notes when three to a page, frames, header and footer. */
export function handoutPageSvg(m: Master, slide: SlideSize, setup: HandoutSetup, slideSvgs: string[], page: number, place: (svg: string, b: Box) => string, paper?: SlideSize): string {
  const L = handoutLayout(slide, setup, paper);
  const parts: string[] = [];
  slideSvgs.forEach((svg, i) => {
    const c = L.cells[i];
    if (!c) return;
    parts.push(place(svg, c));
    if (setup.frame !== false) parts.push(`<rect x="${c.x}" y="${c.y}" width="${c.w}" height="${c.h}" fill="none" stroke="#888" stroke-width="0.5"/>`);
    const l = L.lines[i];
    if (l) for (let y = l.y + 22; y <= l.y + l.h; y += 22) parts.push(`<line x1="${l.x}" x2="${l.x + l.w}" y1="${y}" y2="${y}" stroke="#bbb" stroke-width="0.5"/>`);
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.page.w}pt" height="${L.page.h}pt" viewBox="0 0 ${L.page.w} ${L.page.h}"><rect width="${L.page.w}" height="${L.page.h}" fill="#fff"/>` +
    parts.join('') + frameSvg(L, pageTexts(m.notesHF, page), m.bodyFont || 'Arial') + '</svg>';
}

// ---------------------------------------------------------------- PowerPoint's notes and handout masters

const EMU = 12700;
const emu = (v: number) => Math.round(v * EMU);
const off = (b: Box) => `<a:xfrm><a:off x="${emu(b.x)}" y="${emu(b.y)}"/><a:ext cx="${emu(b.w)}" cy="${emu(b.h)}"/></a:xfrm>`;

/** The header, date, footer and slide number placeholders of a notes or handout master, and which it shows (p:hf). */
function hfShapes(f: PageFrame, hf: NotesHF | undefined, lang: string, startId: number): { shapes: string; hf: string } {
  const ph = (id: number, name: string, type: string, idx: number, b: Box, algn: string, body: string) =>
    `<p:sp><p:nvSpPr><p:cNvPr id="${id}" name="${name}"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="${type}" sz="quarter" idx="${idx}"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${off(b)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr><p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0" anchor="${type === 'hdr' || type === 'dt' ? 't' : 'b'}"/><a:lstStyle><a:lvl1pPr algn="${algn}"><a:defRPr sz="1200"/></a:lvl1pPr></a:lstStyle>` +
    `<a:p>${body}</a:p></p:txBody></p:sp>`;
  const text = (t: string) => (t ? `<a:r><a:rPr ${lang}/><a:t>${esc(t)}</a:t></a:r>` : `<a:endParaRPr ${lang}/>`);
  const date = hf?.dateFixed?.trim() ? text(hf.dateFixed) : `<a:fld id="{B2E3F1C4-5D6A-4B7C-8E9F-0A1B2C3D4E5F}" type="${hf?.dateFormat ?? 'datetime1'}"><a:rPr ${lang}/><a:t>‹date›</a:t></a:fld>`;
  const num = `<a:fld id="{C3F4A2D5-6E7B-4C8D-9F0A-1B2C3D4E5F60}" type="slidenum"><a:rPr ${lang}/><a:t>‹#›</a:t></a:fld>`;
  const shapes = ph(startId, 'Header Placeholder 1', 'hdr', 0, f.header, 'l', text(hf?.header ?? '')) +
    ph(startId + 1, 'Date Placeholder 2', 'dt', 1, f.date, 'r', date) +
    ph(startId + 2, 'Footer Placeholder 3', 'ftr', 2, f.footer, 'l', text(hf?.footer ?? '')) +
    ph(startId + 3, 'Slide Number Placeholder 4', 'sldNum', 3, f.number, 'r', num);
  // (PowerPoint shows each unless told not to)
  const show = hf ?? { header: '', footer: '', date: false, pageNumbers: true };
  const flags = `${show.header ? '' : ' hdr="0"'}${show.footer ? '' : ' ftr="0"'}${show.date ? '' : ' dt="0"'}${show.pageNumbers ? '' : ' sldNum="0"'}`;
  return { shapes, hf: `<p:hf${flags}/>` };
}

const CLR_MAP = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';

/** PowerPoint's notes master: the slide picture and notes where the Notes Master puts them, the notes' size and the header and footer. */
export function notesMasterXml(m: Master, slide: SlideSize, head: string, ns: string, group: string, lang: string): string {
  const setup = m.notesPage;
  const L = notesLayout(slide, setup);
  const { shapes, hf } = hfShapes(L, m.notesHF, lang, 4);
  const size = Math.round((setup?.size ?? 12) * 100);
  const font = setup?.font ? `<a:latin typeface="${esc(setup.font)}"/>` : '<a:latin typeface="+mn-lt"/>';
  return `${head}<p:notesMaster ${ns}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}` +
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${off(L.slide)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:prstClr val="black"/></a:solidFill></a:ln></p:spPr></p:sp>` +
    `<p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr>` +
    `<p:spPr>${off(L.notes)}<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
    `<p:txBody><a:bodyPr vert="horz" lIns="91440" tIns="45720" rIns="91440" bIns="45720" rtlCol="0"/><a:lstStyle/><a:p><a:pPr lvl="0"/><a:r><a:rPr ${lang}/><a:t>Click to edit Master text styles</a:t></a:r></a:p></p:txBody></p:sp>` +
    shapes + `</p:spTree></p:cSld>${CLR_MAP}${hf}` +
    `<p:notesStyle><a:lvl1pPr marL="0" algn="l" defTabSz="914400" rtl="0" eaLnBrk="1" latinLnBrk="0" hangingPunct="1"><a:defRPr sz="${size}" kern="1200"><a:solidFill><a:schemeClr val="tx1"/></a:solidFill>${font}<a:ea typeface="+mn-ea"/><a:cs typeface="+mn-cs"/></a:defRPr></a:lvl1pPr></p:notesStyle></p:notesMaster>`;
}

/** PowerPoint's handout master: the header, date, footer and page number of printed handouts. */
export function handoutMasterXml(m: Master, slide: SlideSize, head: string, ns: string, group: string, lang: string): string {
  const L = handoutLayout(slide, m.handout ?? defaultHandout());
  const { shapes, hf } = hfShapes(L, m.notesHF, lang, 2);
  return `${head}<p:handoutMaster ${ns}><p:cSld><p:bg><p:bgRef idx="1001"><a:schemeClr val="bg1"/></p:bgRef></p:bg><p:spTree>${group}${shapes}</p:spTree></p:cSld>${CLR_MAP}${hf}</p:handoutMaster>`;
}

/** The header, footer and date a notes or handout master shows (from a file PowerPoint saved), or null. */
export function readMasterHF(root: Element | null | undefined): NotesHF | null {
  if (!root) return null;
  const all = (name: string) => Array.from(root.getElementsByTagNameNS('*', name));
  const hfEl = all('hf')[0];
  const textOf = (type: string) => {
    const sp = all('sp').find((s) => Array.from(s.getElementsByTagNameNS('*', 'ph')).some((p) => p.getAttribute('type') === type));
    if (!sp) return { text: '', field: false };
    const field = sp.getElementsByTagNameNS('*', 'fld').length > 0;
    const text = Array.from(sp.getElementsByTagNameNS('*', 't')).map((t) => t.textContent ?? '').join('');
    return { text, field };
  };
  const on = (a: string) => hfEl?.getAttribute(a) !== '0';
  const dt = textOf('dt');
  const fld = all('fld').find((f) => /^datetime\d+$/.test(f.getAttribute('type') ?? ''));
  return {
    header: on('hdr') ? textOf('hdr').text : '',
    footer: on('ftr') ? textOf('ftr').text : '',
    date: on('dt'),
    ...(fld ? { dateFormat: fld.getAttribute('type') as NotesHF['dateFormat'] } : dt.text && !dt.field ? { dateFixed: dt.text } : {}),
    pageNumbers: on('sldNum'),
  };
}
