// Where recovery copies and earlier versions are kept. The desktop app keeps them as files in
// its own data folder ("Kept"); a browser keeps them in the page's IndexedDB storage. Keys are
// short paths of plain names: "recovery/<session>/<file>" and "versions/<file id>/<file>".

import { invoke, isTauri } from '@tauri-apps/api/core';

export interface KeptEntry {
  name: string;
  size: number;
  /** Milliseconds since 1970. */
  modified: number;
  folder: boolean;
}

export interface KeepStore {
  put(key: string, data: Uint8Array): Promise<void>;
  /** Null when there is nothing under the key. */
  get(key: string): Promise<Uint8Array | null>;
  /** What a folder holds, one level down (nothing when it isn't there). */
  list(folder: string): Promise<KeptEntry[]>;
  /** Delete a copy, or a folder with everything in it. */
  remove(key: string): Promise<void>;
  /** Where the copies are, to say so in AutoSave and Recovery Options. */
  where(): Promise<string>;
}

/** A name that is safe as one part of a key. */
export function keyPart(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^\.+/, '').slice(0, 100) || 'x';
}

export async function getText(store: KeepStore, key: string): Promise<string | null> {
  const b = await store.get(key);
  return b ? new TextDecoder().decode(b) : null;
}

export function putText(store: KeepStore, key: string, text: string): Promise<void> {
  return store.put(key, new TextEncoder().encode(text));
}

/** The desktop app: files in the app's data folder. */
export const desktopStore: KeepStore = {
  put: (key, data) => invoke('keep_put', data, { headers: { key } }),
  async get(key) {
    try { return new Uint8Array(await invoke<ArrayBuffer>('keep_get', { key })); } catch { return null; }
  },
  list: (folder) => invoke<KeptEntry[]>('keep_list', { key: folder }),
  remove: (key) => invoke('keep_remove', { key }),
  where: () => invoke<string>('keep_folder'),
};

/** Copies kept in memory (tests, and browsers that block storage). */
export function memoryStore(clock: () => number = Date.now): KeepStore & { files: Map<string, { data: Uint8Array; modified: number }> } {
  const files = new Map<string, { data: Uint8Array; modified: number }>();
  return {
    files,
    async put(key, data) { files.set(key, { data: data.slice(), modified: clock() }); },
    async get(key) { return files.get(key)?.data.slice() ?? null; },
    async list(folder) { return listKeys(folder, [...files].map(([k, v]) => ({ key: k, size: v.data.length, modified: v.modified }))); },
    async remove(key) { for (const k of [...files.keys()]) if (k === key || k.startsWith(key + '/')) files.delete(k); },
    async where() { return 'memory (not kept after closing)'; },
  };
}

/** One level of a flat list of keys, as folders and files. */
function listKeys(folder: string, all: { key: string; size: number; modified: number }[]): KeptEntry[] {
  const pre = folder.replace(/\/$/, '') + '/';
  const out = new Map<string, KeptEntry>();
  for (const f of all) {
    if (!f.key.startsWith(pre)) continue;
    const rest = f.key.slice(pre.length);
    const slash = rest.indexOf('/');
    const name = slash < 0 ? rest : rest.slice(0, slash);
    const had = out.get(name);
    if (slash < 0) out.set(name, { name, size: f.size, modified: f.modified, folder: false });
    else out.set(name, { name, size: (had?.size ?? 0) + f.size, modified: Math.max(had?.modified ?? 0, f.modified), folder: true });
  }
  return [...out.values()];
}

/** A browser: the page's IndexedDB storage. */
function browserStore(): KeepStore {
  let db: Promise<IDBDatabase> | null = null;
  const open = () => db ??= new Promise((resolve, reject) => {
    const r = indexedDB.open('chem-illustrator-kept', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kept');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  const run = async <T>(mode: IDBTransactionMode, f: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const s = (await open()).transaction('kept', mode).objectStore('kept');
    return new Promise((resolve, reject) => {
      const r = f(s);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  };
  type Row = { data: Uint8Array; modified: number };
  const all = async () => {
    const s = (await open()).transaction('kept', 'readonly').objectStore('kept');
    const out: { key: string; size: number; modified: number }[] = [];
    return new Promise<typeof out>((resolve, reject) => {
      const r = s.openCursor();
      r.onsuccess = () => {
        const c = r.result;
        if (!c) { resolve(out); return; }
        const row = c.value as Row;
        out.push({ key: String(c.key), size: row.data.length, modified: row.modified });
        c.continue();
      };
      r.onerror = () => reject(r.error);
    });
  };
  return {
    async put(key, data) { await run('readwrite', (s) => s.put({ data: data.slice(), modified: Date.now() } satisfies Row, key)); },
    async get(key) { const r = await run('readonly', (s) => s.get(key)) as Row | undefined; return r ? r.data : null; },
    async list(folder) { return listKeys(folder, await all()); },
    async remove(key) {
      for (const f of await all()) if (f.key === key || f.key.startsWith(key + '/')) await run('readwrite', (s) => s.delete(f.key));
    },
    async where() { return 'this browser’s storage for the page'; },
  };
}

/** The store for where the app is running. */
export function keepStore(): KeepStore {
  if (isTauri()) return desktopStore;
  return typeof indexedDB !== 'undefined' ? browserStore() : memoryStore();
}
