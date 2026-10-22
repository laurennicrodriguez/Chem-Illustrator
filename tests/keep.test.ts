// @vitest-environment jsdom
//
// Keeping work safe: recovery copies and the offer to reopen them, Version History, AutoSave's
// timing, lock files and OneDrive's conflict copies, and the workspace's part in saving.

import { describe, it, expect, vi } from 'vitest';

// a pretend disk for the desktop app's file commands, with change times
const disk = new Map<string, { data: Uint8Array; modified: number }>();
let clock = 1_000_000;
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: unknown, opts?: { headers: Record<string, string> }) => {
    const a = args as Record<string, string>;
    const put = (path: string, data: Uint8Array) => disk.set(path, { data, modified: ++clock });
    if (cmd === 'write_text_file') { put(a.path, new TextEncoder().encode(a.contents)); return; }
    if (cmd === 'write_binary_file') { put(decodeURIComponent(opts!.headers.path), args as Uint8Array); return; }
    if (cmd === 'read_binary_file') {
      const b = disk.get(a.path);
      if (!b) throw new Error('not found');
      return b.data.slice().buffer;
    }
    if (cmd === 'path_exists') return disk.has(a.path);
    if (cmd === 'file_stamp') { const f = disk.get(a.path); return f ? { modified: f.modified, size: f.data.length } : null; }
    throw new Error('unexpected ' + cmd);
  },
}));

import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks, type Tab } from '../src/workspace';
import { writeCdxml } from '../src/io/cdxml-write';
import { memoryStore } from '../src/keep/store';
import { Recovery, STALE_MS, BEAT_MS, parseSession, type Copyable } from '../src/keep/recovery';
import { Versions, fileKey, contentHash } from '../src/keep/versions';
import { AutoSaveClock } from '../src/keep/autosave';
import { parseKeepPrefs, DEFAULT_KEEP } from '../src/keep/prefs';
import {
  lockPath, lockText, parseLock, officeOwnerPaths, parseOfficeOwner, holderText, oneDriveConflictPath, inOneDrive, sameStamp,
} from '../src/keep/shared';

const measure = (t: string, s: number) => t.length * s * 0.5;
const bytes = (s: string) => new TextEncoder().encode(s);
const text = (b: Uint8Array | null) => (b ? new TextDecoder().decode(b) : null);

function copyable(id: number, over: Partial<Copyable> = {}): Copyable {
  return { id, name: `Tab ${id}.cdxml`, mode: 'drawing', path: null, stamp: null, dirty: true, token: 1, copy: async () => ({ name: `Tab ${id}.cdxml`, data: bytes(`drawing ${id}`) }), ...over };
}

describe('recovery copies', () => {
  it('copies tabs with unsaved changes, only when they changed, and drops copies of saved tabs', async () => {
    let now = 5_000_000;
    const store = memoryStore(() => now);
    const r = new Recovery(store, 'me', () => now);
    const copies = vi.fn(async () => ({ name: 'A.cdxml', data: bytes('a1') }));
    expect(await r.copy([copyable(1, { copy: copies }), copyable(2, { dirty: false })])).toBe(1);
    expect(text(await store.get('recovery/me/tab-1.cdxml'))).toBe('a1');
    expect(store.files.has('recovery/me/tab-2.cdxml')).toBe(false);
    // unchanged: not copied again
    expect(await r.copy([copyable(1, { copy: copies })])).toBe(0);
    expect(copies).toHaveBeenCalledTimes(1);
    // saved: its copy goes
    await r.copy([copyable(1, { dirty: false })]);
    expect(store.files.has('recovery/me/tab-1.cdxml')).toBe(false);
    const s = parseSession(text(await store.get('recovery/me/session.json')));
    expect(s?.tabs).toEqual([]);
    // closing normally deletes everything
    await r.end();
    expect([...store.files.keys()]).toEqual([]);
  });

  it('finds what a crashed session left, skips running ones, and tidies empty and old ones', async () => {
    let now = 10_000_000;
    const store = memoryStore(() => now);
    const crashed = new Recovery(store, 'old', () => now);
    await crashed.copy([copyable(1, { path: 'C:\\Work\\Scheme.cdxml', stamp: { modified: 5, size: 9 } }), copyable(2)]);
    const empty = new Recovery(store, 'empty', () => now);
    await empty.beat();
    now += STALE_MS + 1000;
    const running = new Recovery(store, 'running', () => now);
    await running.copy([copyable(3)]);
    const me = new Recovery(store, 'me', () => now);
    const left = await me.leftOver(7);
    expect(left.map((s) => s.session)).toEqual(['old']);
    expect(left[0].tabs.map((t) => [t.name, t.path])).toEqual([['Tab 1.cdxml', 'C:\\Work\\Scheme.cdxml'], ['Tab 2.cdxml', null]]);
    expect(left[0].tabs[0].stamp).toEqual({ modified: 5, size: 9 });
    expect(store.files.has('recovery/empty/session.json')).toBe(false);
    expect(await me.running('running')).toBe(true);
    expect(await me.running('old')).toBe(false);
    // reopen one: the other stays, and isn't asked about at start again
    expect(text(await me.read('old', 'tab-1.cdxml'))).toBe('drawing 1');
    await me.forget(left[0], ['tab-1.cdxml']);
    await me.markOffered(left[0]);
    const again = await me.leftOver(7);
    expect(again[0].tabs.map((t) => t.file)).toEqual(['tab-2.cdxml']);
    expect(again[0].offered).toBe(true);
    // after the days to keep them, they go
    now += 8 * 86_400_000;
    expect(await me.leftOver(7)).toEqual([]);
    expect([...store.files.keys()].some((k) => k.startsWith('recovery/old/'))).toBe(false);
    expect(BEAT_MS).toBeLessThan(STALE_MS);
  });
});

describe('version history', () => {
  it('keeps each save, skips repeats, spaces out AutoSaves, and keeps the limits', async () => {
    let now = Date.UTC(2026, 9, 22, 12);
    const store = memoryStore(() => now);
    const v = new Versions(store, () => now);
    const path = 'C:\\Lab\\Route.cdxml';
    const opts = { keep: 3, days: 30, ext: 'cdxml' };
    expect(v.firstSave(path)).toBe(true);
    expect(await v.add(path, bytes('original'), 'before', opts)).toBe(true);
    now += 1000;
    expect(await v.add(path, bytes('one'), 'saved', opts)).toBe(true);
    expect(v.firstSave('c:\\lab\\route.CDXML')).toBe(false);
    now += 1000;
    expect(await v.add(path, bytes('one'), 'saved', opts)).toBe(false);
    now += 60_000;
    expect(await v.add(path, bytes('two'), 'autosaved', { ...opts, every: 10 })).toBe(false);
    now += 10 * 60_000;
    expect(await v.add(path, bytes('two'), 'autosaved', { ...opts, every: 10 })).toBe(true);
    now += 1000;
    expect(await v.add(path, bytes('three'), 'saved', opts)).toBe(true);
    const list = await v.list(path);
    expect(list.map((x) => x.how)).toEqual(['saved', 'autosaved', 'saved']);
    expect(text(await v.read(path, list[2]))).toBe('one');
    await v.remove(path, list[1]);
    expect((await v.list(path)).length).toBe(2);
    // old versions go when the app starts
    now += 31 * 86_400_000;
    await v.tidy({ keep: 3, days: 30 });
    expect(await v.list(path)).toEqual([]);
    expect([...store.files.keys()]).toEqual([]);
  });

  it('switched off, keeps nothing and deletes nothing', async () => {
    const store = memoryStore();
    const v = new Versions(store);
    expect(await v.add('/a.cdxml', bytes('x'), 'saved', { keep: 0, days: 0, ext: 'cdxml' })).toBe(false);
    expect(store.files.size).toBe(0);
    expect(fileKey('C:\\A\\b.cdxml')).toBe(fileKey('c:/a/B.CDXML'));
    expect(fileKey('/a/b.cdxml')).not.toBe(fileKey('/a/B.cdxml'));
    expect(contentHash(bytes('abc'))).not.toBe(contentHash(bytes('abd')));
  });
});

describe('AutoSave timing', () => {
  it('saves a while after the last change, and during long stretches of work anyway', () => {
    const c = new AutoSaveClock();
    const tab = (token: number, over = {}) => [{ id: 1, token, dirty: true, on: true, ...over }];
    expect(c.due(tab(1), 0, 30_000)).toEqual([]);
    expect(c.due(tab(1), 29_000, 30_000)).toEqual([]);
    expect(c.due(tab(2), 29_500, 30_000)).toEqual([]);
    expect(c.due(tab(2), 59_600, 30_000)).toEqual([1]);
    c.done(1);
    // changes every few seconds: saved after two minutes anyway
    let t = 100_000, saved = -1;
    for (let i = 0; i < 100 && saved < 0; i++, t += 5000) if (c.due(tab(10 + i), t, 30_000).length) saved = t;
    expect(saved - 100_000).toBe(120_000);
    expect(c.due(tab(1, { on: false }), 1e9, 30_000)).toEqual([]);
    expect(c.due(tab(1, { dirty: false }), 1e9, 30_000)).toEqual([]);
  });
});

describe('options', () => {
  it('reads saved options, keeping numbers in range', () => {
    expect(parseKeepPrefs(null)).toEqual(DEFAULT_KEEP);
    const p = parseKeepPrefs({ recoveryMinutes: -3, autoSave: true, autoSaveSeconds: 0.4, versionsKeep: 9999, changedOnDisk: 'reload', lockFiles: 'yes' });
    expect(p).toMatchObject({ recoveryMinutes: 0, autoSave: true, autoSaveSeconds: 2, versionsKeep: 500, changedOnDisk: 'reload', lockFiles: true });
  });
});

describe('shared folders', () => {
  it('writes and reads lock files the way LibreOffice does', () => {
    expect(lockPath('C:\\Lab\\Scheme 1.cdxml')).toBe('C:\\Lab\\.~lock.Scheme 1.cdxml#');
    expect(lockPath('/home/n/a.pptx')).toBe('/home/n/.~lock.a.pptx#');
    const t = lockText({ user: 'nate', host: 'LAB-PC' }, 'abc-1', new Date(2026, 9, 22, 9, 5));
    expect(t).toBe('nate,nate,LAB-PC,22.10.2026 09:05,chem-illustrator:abc-1;');
    expect(parseLock(t)).toEqual({ user: 'nate', host: 'LAB-PC', since: '22.10.2026 09:05', by: 'app', session: 'abc-1' });
    const lo = parseLock('Sam Smith,sam,OFFICE-3,21.10.2026 16:40,file:///C:/Users/sam/AppData/Roaming/LibreOffice/4;');
    expect(lo).toMatchObject({ user: 'sam', host: 'OFFICE-3', by: 'libreoffice' });
    expect(holderText(lo!)).toBe('sam on OFFICE-3 (in LibreOffice), since 21.10.2026 16:40');
    expect(parseLock('junk')).toBeNull();
  });

  it('finds Word, Excel and PowerPoint owner files', () => {
    expect(officeOwnerPaths('C:\\a\\Report.docx')).toEqual(['C:\\a\\~$Report.docx']);
    expect(officeOwnerPaths('C:\\a\\Reports.docx')).toEqual(['C:\\a\\~$Reports.docx', 'C:\\a\\~$eports.docx']);
    expect(officeOwnerPaths('C:\\a\\SI document.docx')).toEqual(['C:\\a\\~$SI document.docx', 'C:\\a\\~$ document.docx']);
    expect(officeOwnerPaths('/a/Data.xlsx')).toEqual(['/a/~$Data.xlsx']);
    expect(officeOwnerPaths('/a/Scheme.cdxml')).toEqual([]);
    // the user name, then again in UTF-16 at byte 55
    const b = new Uint8Array(162);
    const name = 'Nate';
    b[0] = name.length;
    for (let i = 0; i < name.length; i++) { b[1 + i] = name.charCodeAt(i); b[55 + 2 * i] = name.charCodeAt(i); }
    expect(parseOfficeOwner(b)).toMatchObject({ user: 'Nate', by: 'office' });
  });

  it('names OneDrive’s conflict copies and spots OneDrive folders', () => {
    expect(oneDriveConflictPath('C:\\Users\\n\\OneDrive - Auburn University\\Scheme 1.cdxml', 'LAB-PC')).toBe('C:\\Users\\n\\OneDrive - Auburn University\\Scheme 1-LAB-PC.cdxml');
    expect(oneDriveConflictPath('/x/a', '')).toBeNull();
    expect(inOneDrive('C:\\Users\\n\\OneDrive - Auburn University\\a.cdxml')).toBe(true);
    expect(inOneDrive('C:\\Users\\n\\OneDrive\\a.cdxml')).toBe(true);
    expect(inOneDrive('C:\\Work\\a.cdxml')).toBe(false);
    expect(sameStamp({ modified: 1000, size: 5 }, { modified: 1400, size: 5 })).toBe(true);
    expect(sameStamp({ modified: 1000, size: 5 }, { modified: 5000, size: 5 })).toBe(false);
    expect(sameStamp(null, null)).toBe(true);
  });
});

function workspace(over: Partial<WorkspaceHooks> = {}) {
  const host = new Doc();
  const flashes: string[] = [];
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: (m) => flashes.push(m),
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure,
    sheets: { read: async () => { throw new Error('no sheets here'); }, write: async () => '' },
    documents: { read: async () => { throw new Error('no documents here'); }, write: async () => new Uint8Array() },
    ...over,
  };
  return { host, ws: new Workspace(host, hooks), flashes };
}

function drawing(atoms: number): Uint8Array {
  const d = new Doc();
  d.bulk(() => { for (let i = 0; i < atoms; i++) d.addAtom(i * 14, 0, 6); });
  return bytes(writeCdxml(d, { name: 'x.cdxml', textMeasure: measure }));
}

describe('saving, with AutoSave and versions in mind', () => {
  it('asks before writing, says what was written, and remembers when the file changed', async () => {
    disk.clear();
    const order: string[] = [];
    let answer: 'go' | 'stop' | 'save-as' = 'stop';
    const { ws, host } = workspace({
      beforeWrite: async (_t, ref) => { order.push('before ' + (ref.kind === 'path' ? ref.path : '')); return answer; },
      saved: (_t, data, how) => order.push(`saved ${how} ${data.length > 0}`),
    });
    disk.set('/w/a.cdxml', { data: drawing(2), modified: 50 });
    await ws.openBytes(drawing(2), 'a.cdxml', { kind: 'path', path: '/w/a.cdxml' });
    const tab = ws.active;
    expect(tab.stamp).toEqual({ modified: 50, size: drawing(2).length });
    host.edit('add', () => host.addAtom(100, 100, 7));
    ws.noteChange();
    expect(tab.dirty).toBe(true);
    // stopped: nothing written
    expect(await ws.save(tab)).toBe(false);
    expect(disk.get('/w/a.cdxml')!.modified).toBe(50);
    answer = 'go';
    expect(await ws.save(tab, 'autosaved')).toBe(true);
    expect(order).toEqual(['before /w/a.cdxml', 'before /w/a.cdxml', 'saved autosaved true']);
    expect(tab.dirty).toBe(false);
    expect(tab.savedHow).toBe('autosaved');
    expect(tab.stamp?.modified).toBe(disk.get('/w/a.cdxml')!.modified);
    expect(ws.canAutoSave(tab)).toBe(true);
  });

  it('never AutoSaves a file that would lose things, or one with nowhere to go', async () => {
    const { ws } = workspace();
    const t = ws.active;
    expect(ws.canAutoSave(t)).toBe(false);
    t.ref = { kind: 'path', path: '/w/data.csv' };
    t.mode = 'sheet';
    t.name = 'data.csv';
    expect(ws.savesInPlace(t)).toBe(true);
    expect(ws.canAutoSave(t)).toBe(false);
    expect(await ws.save(t, 'autosaved')).toBe(false);
  });

  it('reopens a copy as unsaved work in the file’s place, or in place of another tab', async () => {
    disk.clear();
    const opened: Tab[] = [];
    const { ws, host } = workspace({ opened: (t) => opened.push(t) });
    disk.set('/w/b.cdxml', { data: drawing(1), modified: 70 });
    await ws.openBytes(drawing(1), 'b.cdxml', { kind: 'path', path: '/w/b.cdxml' });
    const old = ws.active;
    ws.newDrawing();
    const copy = (await ws.copyOf(old)).data;
    expect(text(copy)).toContain('<CDXML');
    // an earlier version restored in place: same file, same place in the strip, unsaved
    const at = ws.tabs.indexOf(old);
    const t = await ws.openAs(drawing(3), 'v.cdxml', { name: 'b.cdxml', ref: { kind: 'path', path: '/w/b.cdxml' }, dirty: true, stamp: old.stamp, replace: old });
    expect(t).not.toBeNull();
    expect(ws.tabs.includes(old)).toBe(false);
    expect(ws.tabs.indexOf(t!)).toBe(at);
    expect(t!.dirty).toBe(true);
    expect(host.atoms.size).toBe(3);
    expect(opened.at(-1)).toBe(t);
    ws.noteChange();
    expect(t!.dirty).toBe(true);
  });

  it('keeps changes made while a file was being written as unsaved', async () => {
    disk.clear();
    const { ws, host } = workspace({
      beforeWrite: async () => 'go',
      // an edit arrives while the file is written
      saved: () => {},
    });
    await ws.openBytes(drawing(1), 'c.cdxml', { kind: 'path', path: '/w/c.cdxml' });
    const tab = ws.active;
    host.edit('add', () => host.addAtom(30, 30, 8));
    ws.noteChange();
    const real = ws.encode.bind(ws);
    ws.encode = async (t, n) => { const r = await real(t, n); host.edit('late', () => host.addAtom(60, 60, 8)); return r; };
    expect(await ws.save(tab)).toBe(true);
    expect(tab.dirty).toBe(true);
    ws.encode = real;
    expect(await ws.save(tab)).toBe(true);
    expect(tab.dirty).toBe(false);
  });
});

describe('the keeper, with AutoSave on', () => {
  it('AutoSaves after the delay, keeps versions, and stops for a file changed elsewhere', async () => {
    disk.clear();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(1_700_000_000_000);
    const { Keeper } = await import('../src/keep/keeper');
    const prefs = { ...DEFAULT_KEEP, autoSave: true, autoSaveSeconds: 5, recoveryMinutes: 0 };
    let keeper: InstanceType<typeof Keeper>;
    const { ws, host } = workspace({
      beforeWrite: (t, r, n, h) => keeper.beforeWrite(t, r, n, h),
      saved: (t, d, h, w) => keeper.saved(t, d, h, w),
      autoSaveFailed: (t, m) => keeper.autoSaveFailed(t, m),
      opened: (t) => keeper.opened(t),
      dropped: (t) => keeper.dropped(t),
    });
    const store = memoryStore();
    keeper = new Keeper({ ws, prefs: () => prefs, setPrefs: () => {}, flash: () => {}, refresh: () => {} }, store);
    const tick = () => (keeper as unknown as { tick(): Promise<void> }).tick();
    disk.set('/w/d.cdxml', { data: drawing(1), modified: 10 });
    await ws.openBytes(drawing(1), 'd.cdxml', { kind: 'path', path: '/w/d.cdxml' });
    const tab = ws.active;
    host.edit('add', () => host.addAtom(40, 0, 6));
    ws.noteChange();
    await tick();
    expect(tab.dirty).toBe(true);
    vi.setSystemTime(Date.now() + 6000);
    await tick();
    expect(tab.dirty).toBe(false);
    expect(tab.savedHow).toBe('autosaved');
    await vi.waitFor(async () => expect((await keeper.versions.list('/w/d.cdxml')).map((v) => v.how)).toEqual(['autosaved', 'before']));
    // someone else saves the file: a notice, and AutoSave waits
    disk.set('/w/d.cdxml', { data: drawing(4), modified: 999_999 });
    host.edit('add', () => host.addAtom(80, 0, 6));
    ws.noteChange();
    vi.setSystemTime(Date.now() + 6000);
    await tick();
    expect(document.querySelector('.keep-notice strong')?.textContent).toBe('d.cdxml changed on disk');
    vi.setSystemTime(Date.now() + 20_000);
    await tick();
    expect(tab.dirty).toBe(true);
    expect(disk.get('/w/d.cdxml')!.modified).toBe(999_999);
    // Reload takes their version
    [...document.querySelectorAll<HTMLButtonElement>('.keep-notice button')].find((b) => b.textContent?.startsWith('Reload'))!.click();
    await vi.waitFor(() => expect(host.atoms.size).toBe(4));
    expect(ws.active.dirty).toBe(false);
    expect(ws.tabs.length).toBe(1);
    vi.useRealTimers();
  });
});
