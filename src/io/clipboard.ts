// Cut, copy and paste.
//
// A copy puts the selection on the clipboard in several forms, the most detailed first, so
// each program takes the best one it understands:
//   - our own CDXML text, so pasting back into Chem Illustrator keeps everything;
//   - the same drawing as CDX, ChemDraw's format, for pasting into ChemDraw;
//   - an EMF picture, which Word and PowerPoint paste as a sharp, scalable picture;
//   - a bitmap, for programs that take neither (Paint, chat programs).
// Web pages can only put PNG pictures and text on the clipboard, so on Windows the desktop app
// hands the data to its own clipboard commands (src-tauri/src/clipboard.rs). Elsewhere the
// page's clipboard gets a PNG, and the drawing itself is kept in memory for pasting here.

import { invoke, isTauri } from '@tauri-apps/api/core';
import { Doc } from '../model';
import type { Vec } from '../geom';
import type { Selection } from '../editor/editor';
import { readCdxml } from './cdxml';
import { writeCdxml } from './cdxml-write';
import { cdxmlToCdx, cdxToCdxml } from './cdx';
import { recordPicture, pictureEmf, pictureCanvas, canvasPng, canvasDib } from '../render/picture';

/** Our own clipboard format: the drawing as CDXML text. */
export const OWN_FORMAT = 'Chem Illustrator CDXML';
/** ChemDraw's clipboard format (a CDX file). */
export const CDX_FORMAT = 'ChemDraw Interchange Format';

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
  if (sel) for (const b of doc.bonds.values()) if (atoms.has(b.a1) && atoms.has(b.a2)) bonds.add(b.id);
  let maxId = 0;
  const seen = (id: number) => { if (id > maxId) maxId = id; };
  out.bulk(() => {
    for (const id of atoms) {
      const a = doc.atoms.get(id);
      if (a) { out.addAtom(a.x, a.y, a.z, structuredClone(a)); seen(id); }
    }
    for (const id of bonds) {
      const b = doc.bonds.get(id);
      if (b && out.atoms.has(b.a1) && out.atoms.has(b.a2)) { out.addBond(b.a1, b.a2, b.order, b.display, structuredClone(b)); seen(id); }
    }
    for (const id of sel ? sel.captions : doc.captions.keys()) {
      const c = doc.captions.get(id);
      if (c) { out.addCaption(structuredClone(c)); seen(id); }
    }
    for (const id of sel ? sel.arrows : doc.arrows.keys()) {
      const r = doc.arrows.get(id);
      if (r) { out.addArrow(structuredClone(r)); seen(id); }
    }
    for (const id of sel ? sel.shapes : doc.shapes.keys()) {
      const s = doc.shapes.get(id);
      // a placeholder for a picture from ChemDraw has no picture in it to copy
      if (s && !s.picture) { out.addShape(structuredClone(s)); seen(id); }
    }
  });
  out.reserveIds(maxId);
  return out;
}

/** True when a drawing has nothing in it. */
export function isEmpty(doc: Doc): boolean {
  return !doc.atoms.size && !doc.captions.size && !doc.arrows.size && !doc.shapes.size;
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
    for (const a of src.atoms.values()) {
      const { id, ...rest } = structuredClone(a);
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
      sel.shapes.add(doc.addShape({ ...rest, x1: s.x1 + dx, y1: s.y1 + dy, x2: s.x2 + dx, y2: s.y2 + dy }).id);
    }
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

/**
 * Put the selection (everything when nothing is selected) on the clipboard. Returns a short
 * message for the user. Call it straight from the key press or menu click: browsers only let
 * a page use the clipboard right after the user does something.
 */
export async function copyDrawing(doc: Doc, sel: Selection | null): Promise<string> {
  const part = extractDrawing(doc, sel);
  const pic = isEmpty(part) ? null : recordPicture(part);
  if (!pic) return 'There is nothing to copy.';
  const cdxml = writeCdxml(part, { name: 'Clipboard.cdxml' });
  lastCopy = cdxml;
  const what = sel ? 'Copied' : 'Copied the whole drawing';
  if (nativeClipboard) {
    const { canvas, dpi } = pictureCanvas(part, pic);
    const block = packFormats([
      [OWN_FORMAT, new TextEncoder().encode(cdxml)],
      [CDX_FORMAT, cdxmlToCdx(cdxml)],
      ['CF_ENHMETAFILE', pictureEmf(pic)],
      ['CF_DIB', canvasDib(canvas, dpi)],
    ]);
    await invoke('clipboard_write', block);
    return `${what}. Paste into Word or PowerPoint for a picture.`;
  }
  // The PNG goes in as a promise so the clipboard is asked straight away, while the key press
  // still counts (Safari insists on this).
  const png = canvasPng(pictureCanvas(part, pic).canvas);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  } catch {
    return `${what} for pasting here. This browser would not take the picture.`;
  }
  return `${what} as a picture.`;
}

/** What a paste found on the clipboard. */
export type Pasted =
  | { kind: 'drawing'; doc: Doc }
  | { kind: 'text'; text: string }
  | { kind: 'nothing' };

function looksLikeCdxml(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!DOCTYPE[^>]*>\s*)?<CDXML[\s>]/i.test(text);
}

function fromText(text: string): Pasted {
  if (looksLikeCdxml(text)) return { kind: 'drawing', doc: readCdxml(text).doc };
  return { kind: 'text', text: text.trim() };
}

/** Read the Windows clipboard through the desktop app. */
export async function readNativeClipboard(): Promise<Pasted> {
  const res = await invoke<ArrayBuffer>('clipboard_read', { names: [OWN_FORMAT, CDX_FORMAT, 'CF_UNICODETEXT'] });
  const [item] = unpackFormats(new Uint8Array(res));
  if (!item) return { kind: 'nothing' };
  const [name, data] = item;
  if (name === CDX_FORMAT) return { kind: 'drawing', doc: readCdxml(cdxToCdxml(data)).doc };
  const text = new TextDecoder().decode(data);
  if (name === OWN_FORMAT) return { kind: 'drawing', doc: readCdxml(text).doc };
  return text.trim() ? fromText(text) : { kind: 'nothing' };
}

/** What a browser paste event holds: text if there is any, else the last drawing copied here. */
export function readPasteEvent(e: ClipboardEvent): Pasted {
  const text = e.clipboardData?.getData('text/plain') ?? '';
  if (text.trim()) return fromText(text);
  return lastCopy ? { kind: 'drawing', doc: readCdxml(lastCopy).doc } : { kind: 'nothing' };
}

/** For the Paste menu item in a browser, which gets no paste event. */
export async function readWebClipboard(): Promise<Pasted> {
  const text = await navigator.clipboard.readText().catch(() => '');
  if (text.trim()) return fromText(text);
  return lastCopy ? { kind: 'drawing', doc: readCdxml(lastCopy).doc } : { kind: 'nothing' };
}

/** Names of the formats on the Windows clipboard (to see what another program copied). */
export async function clipboardFormats(): Promise<string[]> {
  return nativeClipboard ? invoke<string[]>('clipboard_formats') : [];
}
