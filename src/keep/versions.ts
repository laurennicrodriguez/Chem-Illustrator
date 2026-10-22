// File > Version History: each time a file is saved, a copy of what was saved is kept in the
// app's own folder, so an earlier state can be opened or brought back. The file as it was before
// the first save here is kept too, so AutoSave can never lose what was there. How many versions
// are kept, and for how long, is set in File > AutoSave and Recovery Options.

import type { KeepStore } from './store';
import { getText, putText, keyPart } from './store';

export type VersionKind = 'saved' | 'autosaved' | 'before' | 'restored';

export interface Version {
  /** The copy's file in the file's versions folder. */
  file: string;
  /** When it was saved. */
  at: number;
  how: VersionKind;
  size: number;
  /** To skip a version that is the same as the one before. */
  hash: string;
}

interface Index {
  /** The file's full path (or its name, in a browser). */
  path: string;
  versions: Version[];
}

const FOLDER = 'versions';
const INDEX = 'index.json';

/** What each kind of version is called in the window. */
export const VERSION_LABEL: Record<VersionKind, string> = {
  saved: 'Saved',
  autosaved: 'AutoSaved',
  before: 'As it was before saving here',
  restored: 'Before an earlier version was restored',
};

/** FNV-1a, 64 bits as hex: a short, stable name for a file's folder, and a check for repeats. */
export function fnv64(bytes: Uint8Array): string {
  let h = 0xcbf29ce484222325n;
  const p = 0x100000001b3n, m = 0xffffffffffffffffn;
  for (let i = 0; i < bytes.length; i++) h = ((h ^ BigInt(bytes[i])) * p) & m;
  return h.toString(16).padStart(16, '0');
}

/** A quicker check for large files: 32-bit FNV-1a with the length. */
export function contentHash(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < bytes.length; i++) h = Math.imul(h ^ bytes[i], 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0') + '-' + bytes.length.toString(36);
}

/** The same file whatever the capitals of a Windows path. */
export function fileKey(path: string): string {
  const win = /^[a-zA-Z]:[\\/]|^\\\\/.test(path);
  const norm = win ? path.replace(/\//g, '\\').toLowerCase() : path;
  return fnv64(new TextEncoder().encode(norm));
}

export class Versions {
  /** Files already saved once in this session (their "before" version is kept). */
  private seen = new Set<string>();

  constructor(private store: KeepStore, private now: () => number = Date.now) {}

  private folder(path: string): string {
    return `${FOLDER}/${fileKey(path)}`;
  }

  private async index(path: string): Promise<Index> {
    let r: unknown = null;
    try { r = JSON.parse((await getText(this.store, `${this.folder(path)}/${INDEX}`)) ?? 'null'); } catch { /* a damaged list starts again */ }
    const versions = r && typeof r === 'object' && Array.isArray((r as Index).versions) ? (r as Index).versions.filter((v) => v && typeof v.file === 'string' && typeof v.at === 'number') : [];
    return { path, versions: versions.map((v) => ({ ...v, file: keyPart(v.file) })) };
  }

  /** The versions kept of a file, newest first. */
  async list(path: string): Promise<Version[]> {
    // newest first; versions kept in the same moment, latest kept first
    return (await this.index(path)).versions.map((v, i) => ({ v, i })).sort((a, b) => b.v.at - a.v.at || b.i - a.i).map((x) => x.v);
  }

  async read(path: string, v: Version): Promise<Uint8Array | null> {
    return this.store.get(`${this.folder(path)}/${keyPart(v.file)}`);
  }

  /** Whether the file's first save in this session is still to come (its old contents should be kept first). */
  firstSave(path: string): boolean {
    return !this.seen.has(fileKey(path));
  }

  /**
   * Keep a version of a file. `keep` versions at most (0 keeps none), none older than `days` (0: no limit).
   * `every` minutes: an AutoSave adds a version only when the newest is at least that old.
   * Returns false when nothing was added (switched off, too soon, or the same as the newest).
   */
  async add(path: string, data: Uint8Array, how: VersionKind, opts: { keep: number; days: number; every?: number; ext: string }): Promise<boolean> {
    if (how === 'saved' || how === 'autosaved') this.seen.add(fileKey(path));
    if (opts.keep <= 0) return false;
    const idx = await this.index(path);
    const now = this.now();
    const newest = idx.versions.reduce<Version | null>((a, v) => (!a || v.at > a.at ? v : a), null);
    const hash = contentHash(data);
    if (newest && newest.hash === hash) return false;
    // AutoSaves are spaced out from the last save kept (not from the file as it was before)
    const lastSave = idx.versions.reduce((a, v) => (v.how === 'saved' || v.how === 'autosaved' ? Math.max(a, v.at) : a), -Infinity);
    if (how === 'autosaved' && opts.every && now - lastSave < opts.every * 60_000) return false;
    const stamp = new Date(now).toISOString().replace(/[-:]/g, '').replace(/\..*/, '');
    let file = `${stamp}-${how}.${keyPart(opts.ext.toLowerCase())}`;
    for (let n = 2; idx.versions.some((v) => v.file === file); n++) file = `${stamp}-${how}-${n}.${keyPart(opts.ext.toLowerCase())}`;
    await this.store.put(`${this.folder(path)}/${file}`, data);
    idx.versions.push({ file, at: now, how, size: data.length, hash });
    await this.prune(idx, opts);
    return true;
  }

  /** Mark the file as saved in this session without keeping anything (Version History off, or nothing there before). */
  saw(path: string): void {
    this.seen.add(fileKey(path));
  }

  async remove(path: string, v: Version): Promise<void> {
    const idx = await this.index(path);
    idx.versions = idx.versions.filter((x) => x.file !== v.file);
    await this.store.remove(`${this.folder(path)}/${keyPart(v.file)}`);
    await this.writeIndex(idx);
  }

  /** Delete versions past the limits for every file, not only those saved lately (when the app starts). */
  async tidy(opts: { keep: number; days: number }): Promise<void> {
    // switched off: what was kept stays until it is switched on again
    if (opts.keep <= 0) return;
    for (const e of await this.store.list(FOLDER)) {
      if (!e.folder) continue;
      let r: Index | null = null;
      try { r = JSON.parse((await getText(this.store, `${FOLDER}/${e.name}/${INDEX}`)) ?? 'null'); } catch { /* left as it is */ }
      if (!r || typeof r.path !== 'string' || fileKey(r.path) !== e.name) continue;
      const idx = await this.index(r.path);
      if (!idx.versions.length) { await this.store.remove(`${FOLDER}/${e.name}`); continue; }
      const before = idx.versions.length;
      await this.prune(idx, opts);
      if (!idx.versions.length && before) await this.store.remove(`${FOLDER}/${e.name}`);
    }
  }

  private async prune(idx: Index, opts: { keep: number; days: number }): Promise<void> {
    const now = this.now();
    const sorted = idx.versions.slice().sort((a, b) => b.at - a.at);
    const keep = sorted.filter((v, i) => i < opts.keep && (!opts.days || now - v.at <= opts.days * 86_400_000));
    for (const v of sorted) if (!keep.includes(v)) await this.store.remove(`${this.folder(idx.path)}/${v.file}`);
    idx.versions = keep;
    await this.writeIndex(idx);
  }

  private writeIndex(idx: Index): Promise<void> {
    return putText(this.store, `${this.folder(idx.path)}/${INDEX}`, JSON.stringify(idx));
  }
}
