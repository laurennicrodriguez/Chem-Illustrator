// Helpers for Office files (PowerPoint, and later Word and Excel). An Office file is a zip
// of XML parts, described in the published Office Open XML standard (ECMA-376).

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

/** Points to English Metric Units, Office's measure (12,700 to the point). */
export const EMU = 12700;
export const emu = (pt: number): number => Math.round(pt * EMU);
export const fromEmu = (v: string | number | null | undefined): number => Number(v ?? 0) / EMU;

export const NS = {
  a: 'http://schemas.openxmlformats.org/drawingml/2006/main',
  r: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
  p: 'http://schemas.openxmlformats.org/presentationml/2006/main',
  rels: 'http://schemas.openxmlformats.org/package/2006/relationships',
  ct: 'http://schemas.openxmlformats.org/package/2006/content-types',
};

/** Relationship types. */
export const REL = {
  officeDocument: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument',
  coreProps: 'http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties',
  extendedProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties',
  slide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide',
  slideLayout: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout',
  slideMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster',
  notesMaster: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesMaster',
  notesSlide: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide',
  theme: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme',
  image: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
  tags: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tags',
  presProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/presProps',
  viewProps: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/viewProps',
  tableStyles: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/tableStyles',
  font: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/font',
};

/** Escape text for XML (also the characters XML 1.0 can't hold at all, which are dropped). */
export function xml(s: string): string {
  return s
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Escape text for an XML attribute: as xml(), with tabs and line breaks kept (a parser turns bare ones into spaces). */
export function xmlAttr(s: string): string {
  return xml(s).replace(/\t/g, '&#9;').replace(/\n/g, '&#10;').replace(/\r/g, '&#13;');
}

/** A colour as six hex digits for Office ("#1a2b3c" → "1A2B3C"); black when unreadable. */
export function hex6(color: string | undefined): string {
  if (!color) return '000000';
  const c = color.trim();
  let m = /^#?([0-9a-f]{6})/i.exec(c);
  if (m) return m[1].toUpperCase();
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c);
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase();
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(c);
  if (rgb) return [rgb[1], rgb[2], rgb[3]].map((v) => Number(v).toString(16).padStart(2, '0')).join('').toUpperCase();
  const named: Record<string, string> = { black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000' };
  return named[c.toLowerCase()] ?? '000000';
}

/** A package being written: parts by path, and the relationships of each part. */
export class Package {
  private parts = new Map<string, Uint8Array>();
  private types = new Map<string, string>();
  private defaults = new Map<string, string>([['rels', 'application/vnd.openxmlformats-package.relationships+xml'], ['xml', 'application/xml']]);
  private rels = new Map<string, { id: string; type: string; target: string; external?: boolean }[]>();

  /** Add a part. `type` is its content type (left out for pictures, which go by extension). */
  add(path: string, data: string | Uint8Array, type?: string): void {
    this.parts.set(path, typeof data === 'string' ? strToU8(data) : data);
    if (type) this.types.set(path, type);
  }

  /** The content type for every part with this extension (pictures). */
  defaultType(ext: string, type: string): void {
    this.defaults.set(ext, type);
  }

  /** Relate `from` (a part path, or '' for the package) to `target`; returns the relationship id. */
  relate(from: string, type: string, target: string, external = false): string {
    const list = this.rels.get(from) ?? [];
    this.rels.set(from, list);
    // the same target and type share one relationship
    const same = list.find((r) => r.type === type && r.target === target);
    if (same) return same.id;
    const id = `rId${list.length + 1}`;
    list.push({ id, type, target, external });
    return id;
  }

  has(path: string): boolean {
    return this.parts.has(path);
  }

  /** The XML parts' text (for finding which fonts they use). */
  *xmlTexts(): Generator<string> {
    for (const [path, data] of this.parts) if (path.endsWith('.xml')) yield strFromU8(data);
  }

  /** The zip file. */
  build(): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    const ct = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`, `<Types xmlns="${NS.ct}">`];
    for (const [ext, type] of this.defaults) ct.push(`<Default Extension="${ext}" ContentType="${type}"/>`);
    for (const [path, type] of this.types) ct.push(`<Override PartName="/${xml(path)}" ContentType="${type}"/>`);
    ct.push('</Types>');
    files['[Content_Types].xml'] = strToU8(ct.join(''));
    for (const [from, list] of this.rels) {
      const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
      const name = from ? `${dir}_rels/${from.slice(dir.length)}.rels` : '_rels/.rels';
      const out = [`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`, `<Relationships xmlns="${NS.rels}">`];
      for (const r of list) {
        out.push(`<Relationship Id="${r.id}" Type="${r.type}" Target="${xml(r.target)}"${r.external ? ' TargetMode="External"' : ''}/>`);
      }
      out.push('</Relationships>');
      files[name] = strToU8(out.join(''));
    }
    for (const [path, data] of this.parts) {
      // pictures are compressed already
      files[path] = data;
    }
    const opts: Record<string, [Uint8Array, { level: 0 | 6 }]> = {};
    for (const [name, data] of Object.entries(files)) {
      // the zip library tells files from folders by their type, so bytes made elsewhere (a
      // text encoder in another window) are copied into this one's
      const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
      opts[name] = [bytes, { level: /\.(png|jpe?g|gif|webp)$/i.test(name) ? 0 : 6 }];
    }
    return zipSync(opts);
  }
}

/** Where a relationship from `from` points, as a path in the package ("../media/a.png" from "ppt/slides/slide1.xml"). */
/**
 * Pictures already put in a package, so the same picture used on many slides or pages is
 * stored once (each use still gets its own relationship to it).
 */
export class MediaFiles {
  private seen = new Map<string, { path: string; bytes: Uint8Array }[]>();

  /** The path the same bytes were stored at, or null. */
  find(bytes: Uint8Array, ext: string): string | null {
    for (const m of this.seen.get(MediaFiles.key(bytes, ext)) ?? []) if (sameBytes(m.bytes, bytes)) return m.path;
    return null;
  }

  note(bytes: Uint8Array, ext: string, path: string): void {
    const k = MediaFiles.key(bytes, ext);
    const list = this.seen.get(k) ?? [];
    list.push({ path, bytes });
    this.seen.set(k, list);
  }

  private static key(bytes: Uint8Array, ext: string): string {
    // FNV-1a over the bytes: quick, and a match is checked byte by byte
    let h = 0x811c9dc5;
    for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
    return `${ext}|${bytes.length}|${h >>> 0}`;
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

export function resolvePath(from: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = from.split('/');
  parts.pop();
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

/** A package being read. */
export class PackageReader {
  private files: Record<string, Uint8Array>;
  private relCache = new Map<string, Map<string, { type: string; target: string; external: boolean }>>();

  constructor(bytes: Uint8Array) {
    this.files = unzipSync(bytes);
  }

  has(path: string): boolean {
    return path in this.files;
  }

  /** Every part's path. */
  names(): string[] {
    return Object.keys(this.files);
  }

  bytes(path: string): Uint8Array | null {
    return this.files[path] ?? null;
  }

  text(path: string): string | null {
    const b = this.files[path];
    return b ? strFromU8(b) : null;
  }

  xml(path: string): Document | null {
    const t = this.text(path);
    if (t === null) return null;
    const doc = new DOMParser().parseFromString(t, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error(`${path} is not readable XML`);
    return doc;
  }

  /** The relationships of a part, by id, with targets as package paths. */
  rels(from: string): Map<string, { type: string; target: string; external: boolean }> {
    let m = this.relCache.get(from);
    if (m) return m;
    m = new Map();
    const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/') + 1) : '';
    const doc = this.xml(from ? `${dir}_rels/${from.slice(dir.length)}.rels` : '_rels/.rels');
    if (doc) {
      for (const r of Array.from(doc.getElementsByTagNameNS(NS.rels, 'Relationship'))) {
        const external = r.getAttribute('TargetMode') === 'External';
        const target = r.getAttribute('Target') ?? '';
        m.set(r.getAttribute('Id') ?? '', { type: r.getAttribute('Type') ?? '', target: external ? target : resolvePath(from || 'x', target), external });
      }
    }
    this.relCache.set(from, m);
    return m;
  }

  /** The first relationship of a type from a part. */
  relOfType(from: string, type: string): string | null {
    for (const r of this.rels(from).values()) if (r.type === type) return r.target;
    return null;
  }
}

// ---------------------------------------------------------------- small DOM helpers

/** Child elements with a local name (any namespace). */
export function kids(el: Element | null | undefined, name?: string): Element[] {
  if (!el) return [];
  const out: Element[] = [];
  for (let c = el.firstElementChild; c; c = c.nextElementSibling) if (!name || c.localName === name) out.push(c);
  return out;
}

/** The first child element with a local name, following a path of names. */
export function kid(el: Element | null | undefined, ...path: string[]): Element | null {
  let cur: Element | null = el ?? null;
  for (const name of path) {
    if (!cur) return null;
    let next: Element | null = null;
    for (let c = cur.firstElementChild; c; c = c.nextElementSibling) if (c.localName === name) { next = c; break; }
    cur = next;
  }
  return cur;
}

/** An attribute in the relationships namespace (r:id, r:embed). */
export function rAttr(el: Element | null | undefined, name: string): string | null {
  return el?.getAttributeNS(NS.r, name) ?? null;
}

/** Does a zip file have an entry with this name (read from its list of contents)? */
export function zipHas(bytes: Uint8Array, entry: string): boolean {
  const want = new TextEncoder().encode(entry);
  outer: for (let i = 0; i + 46 + want.length <= bytes.length; i++) {
    // central directory headers: PK\x01\x02, name length at +28, name at +46
    if (bytes[i] !== 0x50 || bytes[i + 1] !== 0x4b || bytes[i + 2] !== 1 || bytes[i + 3] !== 2) continue;
    const n = bytes[i + 28] | (bytes[i + 29] << 8);
    if (n !== want.length) continue;
    for (let j = 0; j < n; j++) if (bytes[i + 46 + j] !== want[j]) continue outer;
    return true;
  }
  return false;
}
