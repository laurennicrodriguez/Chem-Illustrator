// Recovery copies: every few minutes (File > AutoSave and Recovery Options) each open tab with
// unsaved changes is copied to the app's own folder, with a small list of the tabs (the session's
// manifest) that the app rewrites every half minute while it runs. Closing the app normally
// deletes the copies. If the app stops without closing (a crash, a power cut, Windows restarting
// for updates), the copies stay and the next start offers to reopen them.

import type { KeepStore } from './store';
import { getText, putText, keyPart } from './store';

/** When a file on disk last changed, and its size (to notice changes made elsewhere). */
export interface FileStamp {
  modified: number;
  size: number;
}

/** A tab, as far as recovery needs it. */
export interface Copyable {
  id: number;
  name: string;
  mode: string;
  /** The file it was opened from or saved to (desktop app), or null when it has never been saved. */
  path: string | null;
  stamp: FileStamp | null;
  dirty: boolean;
  /** Changes whenever the tab's contents change. */
  token: number;
  /** The tab's contents as a file of its own kind (name decides how it reopens). */
  copy(): Promise<{ name: string; data: Uint8Array }>;
}

export interface CopiedTab {
  id: number;
  name: string;
  mode: string;
  path: string | null;
  stamp: FileStamp | null;
  /** The copy's file in the session's folder. */
  file: string;
  /** When it was copied. */
  copied: number;
}

export interface Session {
  session: string;
  started: number;
  /** Rewritten every half minute while the app runs. */
  beat: number;
  /** The start-up question has been asked about it once (it stays in File > Recover Unsaved Work). */
  offered?: boolean;
  tabs: CopiedTab[];
}

/** How often a running app says it is still running. */
export const BEAT_MS = 30_000;
/** A session that hasn't said so for this long has stopped. */
export const STALE_MS = 4 * BEAT_MS;

const FOLDER = 'recovery';
const MANIFEST = 'session.json';

export function newSessionId(now = Date.now()): string {
  return now.toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

export function parseSession(text: string | null): Session | null {
  if (!text) return null;
  let r: unknown;
  try { r = JSON.parse(text); } catch { return null; }
  if (!r || typeof r !== 'object') return null;
  const o = r as Record<string, unknown>;
  if (typeof o.session !== 'string' || typeof o.beat !== 'number' || !Array.isArray(o.tabs)) return null;
  const tabs = o.tabs.filter((t): t is CopiedTab => !!t && typeof t === 'object' && typeof (t as CopiedTab).file === 'string' && typeof (t as CopiedTab).name === 'string')
    .map((t) => ({ id: Number(t.id) || 0, name: t.name, mode: String(t.mode ?? ''), path: typeof t.path === 'string' ? t.path : null,
      stamp: t.stamp && typeof t.stamp.modified === 'number' && typeof t.stamp.size === 'number' ? { modified: t.stamp.modified, size: t.stamp.size } : null,
      file: keyPart(t.file), copied: Number(t.copied) || 0 }));
  return { session: o.session, started: typeof o.started === 'number' ? o.started : o.beat, beat: o.beat, offered: o.offered === true, tabs };
}

export class Recovery {
  private tabs = new Map<number, CopiedTab>();
  /** Each copied tab's token when it was copied. */
  private tokens = new Map<number, number>();
  readonly started: number;
  private busy: Promise<unknown> = Promise.resolve();

  constructor(private store: KeepStore, readonly session = newSessionId(), private now: () => number = Date.now) {
    this.started = now();
  }

  private key(file: string): string {
    return `${FOLDER}/${keyPart(this.session)}/${file}`;
  }

  /** One thing at a time, so a slow copy and a beat never write the manifest out of order. */
  private serial<T>(f: () => Promise<T>): Promise<T> {
    const p = this.busy.then(f, f);
    this.busy = p.catch(() => {});
    return p;
  }

  /**
   * Copy the tabs with unsaved changes that changed since they were last copied, and delete the
   * copies of tabs that are saved or closed. Returns how many were copied.
   */
  copy(tabs: Copyable[]): Promise<number> {
    return this.serial(async () => {
      let n = 0;
      const live = new Set<number>();
      for (const t of tabs) {
        if (!t.dirty) continue;
        live.add(t.id);
        const had = this.tabs.get(t.id);
        if (had && this.tokens.get(t.id) === t.token) {
          // unchanged, but its name or file may have been changed by Save As
          Object.assign(had, { name: t.name, path: t.path, stamp: t.stamp, mode: t.mode });
          continue;
        }
        const c = await t.copy();
        const ext = /\.([A-Za-z0-9]+)$/.exec(c.name)?.[1] ?? 'bin';
        const file = `tab-${t.id}.${ext.toLowerCase()}`;
        await this.store.put(this.key(file), c.data);
        if (had && had.file !== file) await this.store.remove(this.key(had.file));
        this.tabs.set(t.id, { id: t.id, name: t.name, mode: t.mode, path: t.path, stamp: t.stamp, file, copied: this.now() });
        this.tokens.set(t.id, t.token);
        n++;
      }
      for (const [id, c] of [...this.tabs]) {
        if (live.has(id)) continue;
        await this.store.remove(this.key(c.file));
        this.tabs.delete(id);
        this.tokens.delete(id);
      }
      await this.writeManifest();
      return n;
    });
  }

  /** Say the app is still running (and keep the list of copies current). */
  beat(): Promise<void> {
    return this.serial(() => this.writeManifest());
  }

  private writeManifest(): Promise<void> {
    const s: Session = { session: this.session, started: this.started, beat: this.now(), tabs: [...this.tabs.values()] };
    return putText(this.store, this.key(MANIFEST), JSON.stringify(s));
  }

  /** The app is closing normally: its copies aren't needed. */
  end(): Promise<void> {
    return this.serial(async () => {
      this.tabs.clear();
      this.tokens.clear();
      await this.store.remove(`${FOLDER}/${keyPart(this.session)}`);
    });
  }

  /** How many tabs have copies now. */
  get count(): number {
    return this.tabs.size;
  }

  /** Whether another session is running now (it said so lately). */
  async running(session: string): Promise<boolean> {
    if (session === this.session) return true;
    const s = parseSession(await getText(this.store, `${FOLDER}/${keyPart(session)}/${MANIFEST}`));
    return !!s && this.now() - s.beat < STALE_MS;
  }

  /**
   * Sessions that stopped without closing and left copies, newest first. Stopped sessions with
   * nothing left in them, and any older than `days`, are deleted on the way.
   */
  async leftOver(days: number): Promise<Session[]> {
    const out: Session[] = [];
    const now = this.now();
    for (const e of await this.store.list(FOLDER)) {
      if (!e.folder || e.name === keyPart(this.session)) continue;
      const s = parseSession(await getText(this.store, `${FOLDER}/${e.name}/${MANIFEST}`));
      const last = s?.beat ?? e.modified;
      if (now - last < STALE_MS) continue; // still running (another window of the app)
      if (!s || !s.tabs.length || now - last > days * 86_400_000) {
        await this.store.remove(`${FOLDER}/${e.name}`);
        continue;
      }
      out.push(s);
    }
    return out.sort((a, b) => b.beat - a.beat);
  }

  /** A left-over copy's bytes. */
  read(session: string, file: string): Promise<Uint8Array | null> {
    return this.store.get(`${FOLDER}/${keyPart(session)}/${keyPart(file)}`);
  }

  /** Delete some of a left-over session's copies (all of them when `files` is left out). */
  async forget(s: Session, files?: string[]): Promise<void> {
    const folder = `${FOLDER}/${keyPart(s.session)}`;
    const keep = files ? s.tabs.filter((t) => !files.includes(t.file)) : [];
    if (!keep.length) { await this.store.remove(folder); return; }
    for (const f of files ?? []) await this.store.remove(`${folder}/${keyPart(f)}`);
    s.tabs = keep;
    await putText(this.store, `${folder}/${MANIFEST}`, JSON.stringify(s));
  }

  /** Don't ask about this session when the app starts again (File > Recover Unsaved Work still has it). */
  async markOffered(s: Session): Promise<void> {
    s.offered = true;
    await putText(this.store, `${FOLDER}/${keyPart(s.session)}/${MANIFEST}`, JSON.stringify(s));
  }
}
