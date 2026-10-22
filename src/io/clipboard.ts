// Cut, copy and paste.
//
// A copy puts the selection on the clipboard in several forms, the most detailed first, so
// each program takes the best one it understands:
//   - our own CDXML text, so pasting back into Chem Illustrator keeps everything;
//   - the same drawing as CDX, ChemDraw's format, for pasting into ChemDraw;
//   - an EMF picture, which Word and PowerPoint paste as a sharp, scalable picture; the drawing
//     rides inside it, so copying the picture back out of Word brings back the structure;
//   - a bitmap, for programs that take neither (Paint, chat programs).
// Web pages can only put PNG pictures and text on the clipboard, so on Windows the desktop app
// hands the data to its own clipboard commands (src-tauri/src/clipboard.rs). Elsewhere the
// page's clipboard gets a PNG (and the drawing in a web format where the browser takes one),
// and the drawing itself is kept in memory: pasting that same picture back here gives the drawing.

import { freshGroups } from '../editor/groups';
import { pastedTable, tableHtml, tableTsv, type PastedRows } from './table-clip';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { Doc, TextRun, applyBase, type TableData } from '../model';
import type { DocStyle } from '../style';
import type { Vec } from '../geom';
import type { Selection } from '../editor/editor';
import { readCdxml } from './cdxml';
import { writeCdxml } from './cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from './cdx';
import { measureText } from '../render/renderer';
import { recordPicture, pictureEmf, pictureCanvas, canvasPng, canvasDib } from '../render/picture';
import { emfToSvg } from '../render/emf-read';
import type { Item } from '../render/vector';
import { itemsToEmf, withDrawing, drawingInEmf, type EmfBox } from '../render/emf';
import { imageSize } from '../render/images';

/** Our own clipboard format: the drawing as CDXML text. */
export const OWN_FORMAT = 'Chem Illustrator CDXML';
/** ChemDraw's clipboard format (a CDX file). */
export const CDX_FORMAT = 'ChemDraw Interchange Format';
/** Our drawing on a web page's clipboard, where the browser takes formats of the page's own (Chrome, Edge). */
export const WEB_FORMAT = 'web application/x-chem-illustrator-cdxml';

/** True in the Windows desktop app, where the app's own clipboard commands are used. */
export const nativeClipboard = isTauri() && /Windows/i.test(navigator.userAgent);

// ---------------------------------------------------------------- copying part of a drawing

/** The selected things (everything when `sel` is null) as a drawing of their own. */
export function extractDrawing(doc: Doc, sel: Selection | null): Doc {
  const out = new Doc();
  out.style = { ...doc.style };
  out.background = doc.background;
  const atoms = new Set<number>(sel ? sel.atoms : doc.atoms.keys());
  const bonds = new Set<number>(sel ? sel.bonds : doc.bonds.keys());
  // a selected bond brings its atoms, and selected atoms bring the bonds between them
  for (const id of bonds) {
    const b = doc.bonds.get(id);
    if (b) { atoms.add(b.a1); atoms.add(b.a2); }
  }
  // a ring's middle comes with its atoms; and with the ring and the metal bonded to it, it comes too
  for (const id of [...atoms]) for (const m of doc.atoms.get(id)?.multi ?? []) atoms.add(m);
  if (sel) for (const id of [...atoms]) for (const c of doc.centresOf.get(id) ?? []) {
    const ca = doc.atoms.get(c);
    if (ca?.multi?.every((m) => atoms.has(m)) && doc.neighbors(c).some((n) => atoms.has(n.id))) atoms.add(c);
  }
  if (sel) for (const b of doc.bonds.values()) if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(b.id);
  let maxId = 0;
  const seen = (id: number) => { if (id > maxId) maxId = id; };
  out.bulk(() => {
    for (const id of atoms) {
      const a = doc.atoms.get(id);
      if (!a) continue;
      const copy = structuredClone(a);
      if (copy.multi) copy.multi = copy.multi.filter((m) => atoms.has(m));
      out.addAtom(a.x, a.y, a.z, copy);
      seen(id);
    }
    for (const id of bonds) {
      const b = doc.bonds.get(id);
      if (b && out.atoms.has(b.a1) && out.atoms.has(b.a2)) { out.addBond(b.a1, b.a2, b.order, b.display, structuredClone(b)); seen(id); }
    }
    for (const id of sel ? sel.captions : doc.captions.keys()) {
      const c = doc.captions.get(id);
      if (!c) continue;
      const copy = structuredClone(c);
      if (copy.ph) {
        // a slide's title or text becomes plain text, formatted as it looked on the slide
        copy.runs = applyBase(copy.runs, doc.textStyles?.[copy.ph]);
        delete copy.ph;
        delete copy.boxH;
      }
      out.addCaption(copy);
      seen(id);
    }
    for (const id of sel ? sel.arrows : doc.arrows.keys()) {
      const r = doc.arrows.get(id);
      if (r) { out.addArrow(structuredClone(r)); seen(id); }
    }
    // ring fills come along with their rings, picked or not
    const shapes = new Set<number>(sel ? sel.shapes : doc.shapes.keys());
    if (sel) for (const s of doc.shapes.values()) if (s.kind === 'ring' && s.ring?.length && s.ring.every((a) => atoms.has(a))) shapes.add(s.id);
    for (const id of shapes) {
      const s = doc.shapes.get(id);
      // a placeholder for a picture from ChemDraw has no picture in it to copy
      if (!s || s.picture) continue;
      const copy = structuredClone(s);
      // a ring fill copied without its ring keeps the ring's shape, where the atoms were
      if (copy.kind === 'ring' && copy.ring && !copy.ring.every((a) => atoms.has(a))) {
        copy.poly = copy.ring.every((a) => doc.atoms.has(a)) ? copy.ring.map((a) => { const at = doc.atoms.get(a)!; return { x: at.x, y: at.y }; }) : copy.poly;
        delete copy.ring;
      }
      out.addShape(copy);
      seen(id);
    }
  });
  out.reserveIds(maxId);
  return out;
}

/** The usual bond length in a drawing (the median), or null when it has no bonds. */
export function typicalBondLength(doc: Doc): number | null {
  const ls: number[] = [];
  for (const b of doc.bonds.values()) {
    const p = doc.atoms.get(b.a1), q = doc.atoms.get(b.a2);
    if (p && q) ls.push(Math.hypot(p.x - q.x, p.y - q.y));
  }
  if (!ls.length) return null;
  ls.sort((a, b) => a - b);
  return ls[ls.length >> 1];
}

/**
 * Get a pasted drawing ready for a document drawn in the style `to`. Sizes in a drawing are
 * relative to its own style, so they are converted: labels, lines and text keep the look they
 * had where they came from. With `bondLength`, the drawing is first resized so its bonds are
 * that long (structures pasted on slides take the slide master's bond length); its text and
 * arrowheads grow or shrink with it. Changes `src`, a drawing just read from the clipboard.
 */
export function fitPasted(src: Doc, to: DocStyle, bondLength?: number): void {
  const from = src.style;
  const L = typicalBondLength(src);
  const k = bondLength && L ? bondLength / L : 1;
  const ka = (k * from.labelSize) / to.labelSize, kb = (k * from.lineWidth) / to.lineWidth;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-3;
  if (near(k, 1) && near(ka, 1) && near(kb, 1) && near(from.captionSize, to.captionSize)) return;
  const at = (p: Vec): Vec => ({ x: p.x * k, y: p.y * k });
  const rel = (s: number | undefined, f: number) => (near((s ?? 1) * f, 1) ? undefined : (s ?? 1) * f);
  const run = (r: TextRun): TextRun => {
    const size = (r.size ?? from.captionSize) * k;
    const out: TextRun = { ...r, size };
    if (Math.abs(size - to.captionSize) < 0.01) delete out.size;
    return out;
  };
  const len = (v: number | undefined) => (v === undefined ? undefined : v * k);
  const line = (w: number) => (Math.abs(w - to.lineWidth) < 1e-3 ? undefined : w);
  src.bulk(() => {
    for (const a of [...src.atoms.values()]) src.updateAtom(a.id, { ...at(a), s: rel(a.s, ka) });
    for (const b of [...src.bonds.values()]) src.updateBond(b.id, { s: rel(b.s, kb) });
    for (const c of [...src.captions.values()]) {
      src.updateCaption(c.id, {
        ...at(c), runs: c.runs.map(run), width: len(c.width), wrap: len(c.wrap), lineHeight: len(c.lineHeight), boxH: len(c.boxH),
        paras: c.paras?.map((p) => ({ ...p, spaceBefore: len(p.spaceBefore), spaceAfter: len(p.spaceAfter), indent: len(p.indent) })),
      });
    }
    for (const r of [...src.arrows.values()]) {
      src.updateArrow(r.id, {
        tail: at(r.tail), head: at(r.head), headLength: r.headLength * k, headWidth: r.headWidth * k,
        shaftSpacing: len(r.shaftSpacing), lineWidth: line((r.lineWidth ?? from.lineWidth) * k),
      });
    }
    for (const s of [...src.shapes.values()]) {
      const p1 = at({ x: s.x1, y: s.y1 }), p2 = at({ x: s.x2, y: s.y2 });
      src.updateShape(s.id, { x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, radius: len(s.radius), shadowSize: len(s.shadowSize) });
    }
  });
  src.style = { ...to };
}

/** True when a drawing has nothing in it. */
export function isEmpty(doc: Doc): boolean {
  return !doc.atoms.size && !doc.captions.size && !doc.arrows.size && !doc.shapes.size;
}

/** The table, when a drawing is one table and nothing else. */
export function soleTable(doc: Doc): TableData | null {
  if (doc.atoms.size || doc.captions.size || doc.arrows.size || doc.shapes.size !== 1) return null;
  const s = doc.shapes.values().next().value!;
  return s.kind === 'table' && s.table ? s.table : null;
}

/**
 * Add everything in `src` to `doc` as one undoable step, centred on `center`, and return the
 * new things (to select them).
 */
export function insertDrawing(doc: Doc, src: Doc, center: Vec, label = 'Paste'): Selection {
  const sel: Selection = { atoms: new Set(), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() };
  const b = src.bounds();
  if (!b) return sel;
  const dx = center.x - (b.x1 + b.x2) / 2, dy = center.y - (b.y1 + b.y2) / 2;
  const ids = new Map<number, number>();
  doc.edit(label, () => {
    // (multicentre points after the atoms they stand for, so they can point at the new ones)
    const atoms = [...src.atoms.values()];
    for (const a of [...atoms.filter((x) => !x.multi), ...atoms.filter((x) => x.multi)]) {
      const { id, ...rest } = structuredClone(a);
      if (rest.multi) {
        rest.multi = rest.multi.map((m) => ids.get(m)).filter((m): m is number => m !== undefined);
        if (rest.multi.length < 2) continue;
      }
      const n = doc.addAtom(a.x + dx, a.y + dy, a.z, { ...rest, x: a.x + dx, y: a.y + dy });
      ids.set(id, n.id);
      sel.atoms.add(n.id);
    }
    for (const bd of src.bonds.values()) {
      const a1 = ids.get(bd.a1), a2 = ids.get(bd.a2);
      if (a1 === undefined || a2 === undefined) continue;
      const { id: _id, ...rest } = structuredClone(bd);
      sel.bonds.add(doc.addBond(a1, a2, bd.order, bd.display, { ...rest, a1, a2 }).id);
    }
    for (const c of src.captions.values()) {
      const { id: _id, ...rest } = structuredClone(c);
      sel.captions.add(doc.addCaption({ ...rest, x: c.x + dx, y: c.y + dy }).id);
    }
    for (const r of src.arrows.values()) {
      const { id: _id, ...rest } = structuredClone(r);
      sel.arrows.add(doc.addArrow({ ...rest, tail: { x: r.tail.x + dx, y: r.tail.y + dy }, head: { x: r.head.x + dx, y: r.head.y + dy } }).id);
    }
    for (const s of src.shapes.values()) {
      const { id: _id, ...rest } = structuredClone(s);
      // a ring fill sits on the new copies of its ring's atoms
      const ring = rest.ring?.map((a) => ids.get(a));
      if (rest.ring) rest.ring = ring!.every((a) => a !== undefined) ? (ring as number[]) : undefined;
      if (rest.poly) rest.poly = rest.poly.map((p) => ({ x: p.x + dx, y: p.y + dy }));
      sel.shapes.add(doc.addShape({ ...rest, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }).id);
    }
    // a pasted group is a new group, not part of the one it was copied from
    freshGroups(doc, sel);
  });
  return sel;
}

// ---------------------------------------------------------------- the block sent to the desktop app

/**
 * Several clipboard formats in one block of bytes: a count, then each format's name and data,
 * each preceded by its length (32-bit little-endian). The desktop app reads the same layout.
 */
export function packFormats(items: [string, Uint8Array][]): Uint8Array {
  const enc = new TextEncoder();
  const names = items.map(([n]) => enc.encode(n));
  const size = 4 + items.reduce((s, [, d], i) => s + 8 + names[i].length + d.length, 0);
  const out = new Uint8Array(size);
  const v = new DataView(out.buffer);
  let at = 0;
  v.setUint32(at, items.length, true); at += 4;
  items.forEach(([, data], i) => {
    v.setUint32(at, names[i].length, true); at += 4;
    out.set(names[i], at); at += names[i].length;
    v.setUint32(at, data.length, true); at += 4;
    out.set(data, at); at += data.length;
  });
  return out;
}

export function unpackFormats(block: Uint8Array): [string, Uint8Array][] {
  if (!block.length) return [];
  const v = new DataView(block.buffer, block.byteOffset, block.byteLength);
  const dec = new TextDecoder();
  let at = 0;
  const take = (n: number) => {
    if (at + n > block.length) throw new Error('clipboard data is cut short');
    at += n;
    return block.subarray(at - n, at);
  };
  const u32 = () => { take(4); return v.getUint32(at - 4, true); };
  const out: [string, Uint8Array][] = [];
  for (let i = u32(); i > 0; i--) {
    const name = dec.decode(take(u32()));
    out.push([name, take(u32()).slice()]);
  }
  return out;
}

// ---------------------------------------------------------------- copy and paste

/** The last drawing copied, for pasting back where the clipboard cannot hold it (web pages). */
let lastCopy: string | null = null;
/** A table copied here as tab-separated text, to know it again when it is pasted back (web pages). */
let lastTableText: string | null = null;

/**
 * Whether drawings go on the clipboard as editable objects for Word, PowerPoint and Excel as
 * well as pictures (Windows, once the object type is registered: see src-tauri/src/ole.rs).
 */
let wordObjects = false;
export function setWordObjects(on: boolean): void {
  wordObjects = on;
}

/** "Object Descriptor" data for the Windows app: the picture's size in hundredths of a millimetre (from the EMF's frame). */
function objectSize(emf: Uint8Array): Uint8Array {
  const v = new DataView(emf.buffer, emf.byteOffset, emf.byteLength);
  const out = new DataView(new ArrayBuffer(8));
  if (emf.byteLength >= 40) {
    out.setInt32(0, v.getInt32(32, true) - v.getInt32(24, true), true);
    out.setInt32(4, v.getInt32(36, true) - v.getInt32(28, true), true);
  }
  return new Uint8Array(out.buffer);
}

/** The picture of a whole drawing that Word shows for it, with the drawing inside (for drawings edited for Word). */
export function embeddedPicture(doc: Doc, cdxml: string): Uint8Array {
  const pic = recordPicture(doc);
  return pic ? withDrawing(pictureEmf(pic), cdxml) : new Uint8Array();
}
/** The size in pixels of the picture of the last drawing copied (web pages), to know it again when it is pasted back. */
let lastPictureSize: { w: number; h: number } | null = null;

/**
 * Put the selection (everything when nothing is selected) on the clipboard. Returns a short
 * message for the user. Call it straight from the key press or menu click: browsers only let
 * a page use the clipboard right after the user does something.
 */
export async function copyDrawing(doc: Doc, sel: Selection | null): Promise<string> {
  const part = extractDrawing(doc, sel);
  const pic = isEmpty(part) ? null : recordPicture(part);
  if (!pic) return 'There is nothing to copy.';
  // our own copy keeps pictures in any format, and their cropping; ChemDraw's gets what it reads
  const own = writeCdxml(part, { name: 'Clipboard.cdxml', textMeasure: measureText, own: true });
  const cdxml = hasPictures(part) ? writeCdxml(part, { name: 'Clipboard.cdxml', textMeasure: measureText }) : own;
  lastCopy = own;
  const what = sel ? 'Copied' : 'Copied the whole drawing';
  // a table on its own also goes out as cells, so Word and Excel paste a table they can edit
  // (Paste Special still offers the picture)
  const table = soleTable(part);
  const tsv = table ? tableTsv(table) : null;
  lastTableText = tsv;
  if (nativeClipboard) {
    const { canvas, dpi } = pictureCanvas(part, pic);
    const enc = new TextEncoder();
    const emf = withDrawing(pictureEmf(pic), own);
    // Word, PowerPoint and Excel paste an object they can send back here to edit (a table stays cells)
    const object: [string, Uint8Array][] = wordObjects && !table ? [['Embed Source', enc.encode(own)], ['Object Descriptor', objectSize(emf)]] : [];
    const block = packFormats([
      [OWN_FORMAT, enc.encode(own)],
      [CDX_FORMAT, cdxmlToCdx(cdxml)],
      ...object,
      ...(table ? [['HTML Format', cfHtml(tableHtml(table))], ['CF_UNICODETEXT', enc.encode(tsv!)]] as [string, Uint8Array][] : []),
      ['CF_ENHMETAFILE', emf],
      ['CF_DIB', canvasDib(canvas, dpi)],
    ]);
    await invoke('clipboard_write', block);
    return table ? `${what}. Paste into Word or Excel for a table, or into PowerPoint for a picture.`
      : wordObjects ? `${what}. In Word or PowerPoint, double-click the pasted drawing to edit it here.` : `${what}. Paste into Word or PowerPoint for a picture.`;
  }
  // The PNG goes in as a promise so the clipboard is asked straight away, while the key press
  // still counts (Safari insists on this).
  const { canvas } = pictureCanvas(part, pic);
  lastPictureSize = { w: canvas.width, h: canvas.height };
  const png = canvasPng(canvas);
  try {
    const formats: Record<string, Blob | Promise<Blob>> = { 'image/png': png };
    if (table) {
      formats['text/html'] = new Blob([tableHtml(table)], { type: 'text/html' });
      formats['text/plain'] = new Blob([tsv!], { type: 'text/plain' });
    }
    if (webFormatOk()) formats[WEB_FORMAT] = new Blob([own], { type: WEB_FORMAT.slice(4) });
    await navigator.clipboard.write([new ClipboardItem(formats)]);
  } catch {
    return `${what} for pasting here. This browser would not take the picture.`;
  }
  return table ? `${what} as a table and a picture.` : `${what}. Paste here for the drawing, or elsewhere for a picture.`;
}

/**
 * Copy a picture made of recorded shapes (a chart, say): on Windows as a metafile and a bitmap,
 * so Word and PowerPoint paste it sharp at any size; elsewhere as a PNG.
 */
export async function copyPictureItems(items: Item[], box: EmfBox, canvas: HTMLCanvasElement, dpi: number): Promise<string> {
  lastCopy = null;
  lastTableText = null;
  lastPictureSize = null;
  if (nativeClipboard) {
    await invoke('clipboard_write', packFormats([['CF_ENHMETAFILE', itemsToEmf(items, box)], ['CF_DIB', canvasDib(canvas, dpi)]]));
    return 'Copied as a picture. Paste into Word, PowerPoint or a slide here.';
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': canvasPng(canvas) })]);
  } catch {
    return 'This browser would not take the picture. Use Save as Picture instead.';
  }
  return 'Copied as a picture.';
}

/** Is this the table last copied here (so the copy with its title and column widths can be pasted)? */
const ownTable = (text: string) => !!lastCopy && lastTableText !== null && text.replace(/\r\n/g, '\n').trim() === lastTableText.replace(/\r\n/g, '\n').trim();

const hasPictures = (d: Doc) => [...d.shapes.values()].some((s) => s.kind === 'picture');

/** Whether this browser takes a format of the page's own on the clipboard. */
function webFormatOk(): boolean {
  try {
    return typeof ClipboardItem !== 'undefined' && !!(ClipboardItem as unknown as { supports?: (t: string) => boolean }).supports?.(WEB_FORMAT);
  } catch {
    return false;
  }
}

/**
 * Is this pasted picture the one copied here last? Browsers hand back their own copy of a picture
 * (the same size, not the same bytes), so the size is what is compared.
 */
export function isOwnPicture(bytes: Uint8Array, mime: string): boolean {
  if (!lastCopy || !lastPictureSize) return false;
  const px = imageSize(bytes, mime);
  return !!px && px.w === lastPictureSize.w && px.h === lastPictureSize.h;
}

/** The drawing inside a picture copied from here (a metafile, as Word and PowerPoint copy it), or null. */
export function pictureDrawing(bytes: Uint8Array, mime: string): Doc | null {
  if (mime !== 'image/x-emf') return null;
  const cdxml = drawingInEmf(bytes);
  if (!cdxml) return null;
  try {
    return readCdxml(cdxml).doc;
  } catch {
    return null;
  }
}

/** A pasted picture: the drawing it came from, when it is a copy of one made here, else the picture. */
function picturePasted(bytes: Uint8Array, mime: string): Pasted {
  const inside = pictureDrawing(bytes, mime);
  if (inside) return { kind: 'drawing', doc: inside };
  if (isOwnPicture(bytes, mime)) return { kind: 'drawing', doc: readCdxml(lastCopy!).doc };
  return { kind: 'picture', mime, bytes };
}

/** What a paste found on the clipboard. */
export type Pasted =
  | { kind: 'drawing'; doc: Doc }
  | { kind: 'text'; text: string }
  | { kind: 'picture'; mime: string; bytes: Uint8Array }
  | { kind: 'table'; rows: PastedRows }
  | { kind: 'nothing' };

/** Text that could be a structure (a molfile, or one word that could be SMILES). */
export function looksLikeChemistry(text: string): boolean {
  const t = text.trim();
  return t.includes('M  END') || (!!t && !/\s/.test(t) && /^[A-Za-z0-9@+\-[\]()=#$%/\\.:*~]+$/.test(t));
}

/** A Windows bitmap from the clipboard (no file header) as a .bmp file a web page can show. */
export function dibToBmp(dib: Uint8Array): Uint8Array {
  const v = new DataView(dib.buffer, dib.byteOffset, dib.byteLength);
  const headerSize = v.getUint32(0, true);
  const bits = v.getUint16(14, true);
  const compression = v.getUint32(16, true);
  let colors = v.getUint32(32, true);
  if (!colors && bits <= 8) colors = 1 << bits;
  // three colour masks follow a plain header when the bits are packed by masks
  const masks = headerSize === 40 && compression === 3 ? 12 : 0;
  const out = new Uint8Array(14 + dib.length);
  const o = new DataView(out.buffer);
  out[0] = 0x42; out[1] = 0x4d; // "BM"
  o.setUint32(2, out.length, true);
  o.setUint32(10, 14 + headerSize + masks + colors * 4, true);
  out.set(dib, 14);
  return out;
}

export function looksLikeCdxml(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<CDXML[\s>]/i.test(text);
}

function fromText(text: string): Pasted {
  if (looksLikeCdxml(text)) return { kind: 'drawing', doc: readCdxml(text).doc };
  return { kind: 'text', text: text.trim() };
}

/** The first of these formats on the Windows clipboard. */
export async function nativeFirst(names: string[]): Promise<[string, Uint8Array] | null> {
  const res = await invoke<ArrayBuffer>('clipboard_read', { names });
  return unpackFormats(new Uint8Array(res))[0] ?? null;
}

/**
 * Read the Windows clipboard through the desktop app: a drawing (ours or ChemDraw's) first,
 * then text that could be a structure, then a picture (PNG, SVG, a Windows metafile as
 * MestReNova and Office copy, or a bitmap), then any other text.
 */
export async function readNativeClipboard(): Promise<Pasted> {
  // ("Embed Source" is a drawing from here copied back out of Word: the app reads only its own objects)
  const drawing = await nativeFirst([OWN_FORMAT, 'Embed Source', CDX_FORMAT]);
  if (drawing) {
    const [name, data] = drawing;
    return { kind: 'drawing', doc: readCdxml(name === CDX_FORMAT ? cdxToCdxml(data) : new TextDecoder().decode(data)).doc };
  }
  // a picture of a drawing copied from here, copied back out of Word or PowerPoint: the drawing rides inside it
  const emf = await nativeFirst(['CF_ENHMETAFILE']);
  const inside = emf ? pictureDrawing(emf[1], 'image/x-emf') : null;
  if (inside) return { kind: 'drawing', doc: inside };
  const t = await nativeFirst(['CF_UNICODETEXT']);
  const text = t ? new TextDecoder().decode(t[1]).replace(/\0+$/, '') : '';
  if (looksLikeChemistry(text)) return fromText(text);
  // cells from Excel, Word or a sheet here make a table (Excel also puts a picture of them on the clipboard)
  const html = await nativeFirst(['HTML Format']);
  const table = pastedTable(html ? fromCfHtml(html[1]) : null, text);
  if (table) return { kind: 'table', rows: table };
  // a metafile with lines and text (a spectrum or chart from MestReNova or Excel) stays sharp, so it
  // beats a PNG of the same thing; a metafile that only wraps a photo, or can't be shown, does not
  if (emf && (emfToSvg(emf[1])?.vectors ?? 0) > 0) return { kind: 'picture', mime: 'image/x-emf', bytes: emf[1] };
  const pic = await nativeFirst(['PNG', 'image/svg+xml', 'CF_ENHMETAFILE', 'CF_DIB']);
  if (pic) {
    const [name, data] = pic;
    if (name === 'PNG') return { kind: 'picture', mime: 'image/png', bytes: data };
    if (name === 'image/svg+xml') return { kind: 'picture', mime: 'image/svg+xml', bytes: data };
    if (name === 'CF_ENHMETAFILE') return { kind: 'picture', mime: 'image/x-emf', bytes: data };
    return { kind: 'picture', mime: 'image/bmp', bytes: dibToBmp(data) };
  }
  return text.trim() ? fromText(text) : { kind: 'nothing' };
}

/**
 * What a browser paste event holds: a drawing or structure text, else a picture, else other
 * text, else the last drawing copied here.
 */
export async function readPasteEvent(e: ClipboardEvent): Promise<Pasted> {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (looksLikeCdxml(text) || looksLikeChemistry(text)) return fromText(text);
  if (ownTable(text)) return { kind: 'drawing', doc: readCdxml(lastCopy!).doc };
  const table = pastedTable(e.clipboardData?.getData('text/html'), text);
  if (table) return { kind: 'table', rows: table };
  const file = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'));
  if (file) return picturePasted(new Uint8Array(await file.arrayBuffer()), file.type);
  if (text.trim()) return fromText(text);
  return lastCopy ? { kind: 'drawing', doc: readCdxml(lastCopy).doc } : { kind: 'nothing' };
}

/** For the Paste menu item in a browser, which gets no paste event. */
export async function readWebClipboard(): Promise<Pasted> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (looksLikeCdxml(text) || looksLikeChemistry(text)) return fromText(text);
  if (ownTable(text)) return { kind: 'drawing', doc: readCdxml(lastCopy!).doc };
  // a picture (when the browser lets the page see it)
  const items = await navigator.clipboard.read?.().catch(() => []) ?? [];
  // our drawing, where the browser kept a format of our own
  const own = items.find((it) => it.types.includes(WEB_FORMAT));
  const ownText = own ? await (await own.getType(WEB_FORMAT)).text().catch(() => '') : '';
  if (looksLikeCdxml(ownText)) return fromText(ownText);
  const htmlItem = items.find((it) => it.types.includes('text/html'));
  const html = htmlItem ? await (await htmlItem.getType('text/html')).text() : null;
  const table = pastedTable(html, text);
  if (table) return { kind: 'table', rows: table };
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith('image/'));
    if (type) return picturePasted(new Uint8Array(await (await it.getType(type)).arrayBuffer()), type);
  }
  if (text.trim()) return fromText(text);
  return lastCopy ? { kind: 'drawing', doc: readCdxml(lastCopy).doc } : { kind: 'nothing' };
}

/** The clipboard's plain text, ignoring any drawing on it (Paste SMILES). */
export async function readClipboardText(): Promise<string> {
  if (nativeClipboard) {
    const res = await invoke<ArrayBuffer>('clipboard_read', { names: ['CF_UNICODETEXT'] });
    const [item] = unpackFormats(new Uint8Array(res));
    return item ? new TextDecoder().decode(item[1]).replace(/\0+$/, '') : '';
  }
  return navigator.clipboard.readText();
}

/** Names of the formats on the Windows clipboard (to see what another program copied). */
export async function clipboardFormats(): Promise<string[]> {
  return nativeClipboard ? invoke<string[]>('clipboard_formats') : [];
}

/** Put these formats on the Windows clipboard (most detailed first). */
export async function writeNativeFormats(items: [string, Uint8Array][]): Promise<void> {
  await invoke('clipboard_write', packFormats(items));
}

/** Our own copy of sheet cells on the clipboard. */
export const CELLS_FORMAT = 'Chem Illustrator Cells';

/**
 * HTML for the Windows clipboard ("HTML Format"): a header giving where the page and the copied
 * part start and end, counted in bytes of UTF-8, as Word and Excel read it.
 */
export function cfHtml(fragment: string): Uint8Array {
  const enc = new TextEncoder();
  const pre = '<html><head><meta charset="utf-8"></head><body><!--StartFragment-->';
  const post = '<!--EndFragment--></body></html>';
  const head = (a: number, b: number, c: number, d: number) =>
    `Version:0.9\r\nStartHTML:${pad(a)}\r\nEndHTML:${pad(b)}\r\nStartFragment:${pad(c)}\r\nEndFragment:${pad(d)}\r\n`;
  const pad = (n: number) => String(n).padStart(10, '0');
  const h = head(0, 0, 0, 0).length;
  const startFrag = h + enc.encode(pre).length;
  const endFrag = startFrag + enc.encode(fragment).length;
  const end = endFrag + enc.encode(post).length;
  return enc.encode(head(h, end, startFrag, endFrag) + pre + fragment + post);
}

/** The HTML inside "HTML Format" clipboard data. */
export function fromCfHtml(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  const m = /StartHTML:(\d+)/.exec(text);
  const start = m ? Number(m[1]) : -1;
  if (start > 0) return new TextDecoder().decode(bytes.subarray(start));
  return text.slice(text.indexOf('<'));
}
