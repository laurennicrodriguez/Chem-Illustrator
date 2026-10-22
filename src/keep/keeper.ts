// Keeping work safe, for every kind of tab: recovery copies of unsaved work and the offer to
// reopen them after a crash, AutoSave, Version History, and the shared-folder checks (a file
// changed on disk or open somewhere else, OneDrive's conflict copies). The workspace calls in
// before and after each save; a timer does the rest.

import { invoke, isTauri } from '@tauri-apps/api/core';
import type { Workspace, Tab, SaveHow } from '../workspace';
import { type FileRef, stampOf, readRef, readPath, pathExists, baseName, extensionOf, withExtension } from '../io/files';
import { keepStore, type KeepStore } from './store';
import { Recovery, BEAT_MS, type Copyable, type Session } from './recovery';
import { Versions, type Version } from './versions';
import { AutoSaveClock } from './autosave';
import type { KeepPrefs } from './prefs';
import { sameStamp, lockPath, lockText, parseLock, officeOwnerPaths, parseOfficeOwner, holderText, oneDriveConflictPath, inOneDrive, type Holder } from './shared';
import { notice, closeNotice, closeNotices, choose, recoverDialog, versionDialog, optionsDialog, when } from '../ui/keep-ui';

export interface KeeperHost {
  ws: Workspace;
  prefs(): KeepPrefs;
  setPrefs(p: KeepPrefs): void;
  flash(msg: string, ms?: number): void;
  /** A tab's name, unsaved mark or AutoSave switch changed: show it. */
  refresh(): void;
}

const desktop = isTauri();
/** How often the timer looks for work. */
const TICK_MS = 2000;
/** How often files are checked for changes made elsewhere, and for lock files. */
const DISK_MS = 5000;
const LOCK_MS = 15000;

/** Where a file's versions are filed: its path, or in a browser its name. */
function versionKey(ref: FileRef, name: string): string | null {
  if (ref.kind === 'path') return ref.path;
  if (ref.kind === 'handle') return `browser:${ref.handle.name || name}`;
  return null;
}

function sameRef(a: FileRef, b: FileRef): boolean {
  if (a.kind === 'path' && b.kind === 'path') return a.path === b.path;
  if (a.kind === 'handle' && b.kind === 'handle') return a.handle === b.handle;
  return false;
}

export class Keeper {
  readonly recovery: Recovery;
  readonly versions: Versions;
  private auto = new AutoSaveClock();
  private me: { user: string; host: string } = { user: '', host: '' };
  /** Lock files this app wrote, by tab. */
  private locks = new Map<number, string>();
  /** Who else has each tab's file open, as last told. */
  private holders = new Map<number, string>();
  /** Whether each tab's OneDrive conflict copy was there when last checked. */
  private conflicts = new Map<number, boolean>();
  /** Tabs AutoSave leaves alone until they are saved by hand (a failed AutoSave, or changes on disk to settle). */
  private paused = new Set<number>();
  /** Changed-on-disk notices shown, by tab: the disk's stamp they were about. */
  private told = new Map<number, string>();
  private saving = false;
  private pointerDown = false;
  private lastCopy = 0;
  private lastBeat = 0;
  private lastDisk = 0;
  private lastLocks = 0;
  private checking = false;
  private timer = 0;
  private ended = false;

  constructor(private host: KeeperHost, store: KeepStore = keepStore()) {
    this.recovery = new Recovery(store);
    this.versions = new Versions(store);
  }

  private get ws(): Workspace {
    return this.host.ws;
  }

  private get prefs(): KeepPrefs {
    return this.host.prefs();
  }

  /** Once settings are read: start the timer, offer any left-over copies, tidy old versions. */
  async start(): Promise<void> {
    window.addEventListener('pointerdown', () => { this.pointerDown = true; }, true);
    window.addEventListener('pointerup', () => { this.pointerDown = false; }, true);
    window.addEventListener('pointercancel', () => { this.pointerDown = false; }, true);
    window.addEventListener('focus', () => { this.lastDisk = 0; this.lastLocks = 0; });
    if (desktop) {
      try { this.me = await invoke<{ user: string; host: string }>('who_am_i'); } catch { /* names stay blank */ }
    }
    this.timer = window.setInterval(() => void this.tick(), TICK_MS);
    // files opened before the timer started (a workspace, a file given when starting)
    for (const t of this.ws.fileTabs) if (t.ref.kind === 'path') void this.checkLocks(t);
    try {
      const left = (await this.recovery.leftOver(this.prefs.recoveryDays)).filter((s) => !s.offered);
      if (left.length) await this.offer(left, true);
    } catch { /* nothing to offer */ }
    void this.versions.tidy({ keep: this.prefs.versionsKeep, days: this.prefs.versionsDays }).catch(() => {});
  }

  /** The app is closing normally (after the unsaved-changes questions): copies and locks go. */
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    clearInterval(this.timer);
    await Promise.all([...this.locks.values()].map((p) => invoke('remove_lock_file', { path: p }).catch(() => {})));
    this.locks.clear();
    await this.recovery.end().catch(() => {});
  }

  // ---------------------------------------------------------------- the timer

  /** Something is being dragged, or a window is open: not the moment to save. */
  private busy(): boolean {
    return this.pointerDown || !!document.querySelector('dialog[open]');
  }

  private async tick(): Promise<void> {
    if (this.ended) return;
    const now = Date.now();
    const p = this.prefs;
    // AutoSave, one tab at a time
    if (!this.saving && !this.busy()) {
      const due = this.auto.due(this.ws.fileTabs.map((t) => ({ id: t.id, token: this.ws.token(t), dirty: t.dirty, on: this.autoOn(t) })), now, p.autoSaveSeconds * 1000);
      const tab = this.ws.tabs.find((t) => t.id === due[0]);
      if (tab) {
        this.saving = true;
        try { await this.ws.save(tab, 'autosaved'); } finally { this.saving = false; this.auto.done(tab.id); }
      }
    }
    // recovery copies, and saying the app is still running
    if (p.recoveryMinutes > 0) {
      if (now - this.lastCopy >= p.recoveryMinutes * 60_000 && !this.busy()) {
        this.lastCopy = this.lastBeat = now;
        await this.copyNow().catch(() => {});
      } else if (now - this.lastBeat >= BEAT_MS) {
        this.lastBeat = now;
        await this.recovery.beat().catch(() => {});
      }
    } else if (this.lastCopy) {
      // switched off: the copies made so far go
      this.lastCopy = 0;
      await this.recovery.end().catch(() => {});
    }
    if (this.checking) return;
    this.checking = true;
    try {
      if (now - this.lastDisk >= DISK_MS) {
        this.lastDisk = now;
        for (const t of this.ws.fileTabs) if (this.ws.tabs.includes(t)) await this.checkDisk(t);
      }
      if (desktop && now - this.lastLocks >= LOCK_MS) {
        this.lastLocks = now;
        for (const t of this.ws.fileTabs) if (t.ref.kind === 'path') await this.checkLocks(t);
      }
    } finally {
      this.checking = false;
    }
  }

  /** Copy every tab with unsaved changes now (and delete copies no longer needed). */
  copyNow(): Promise<number> {
    const tabs: Copyable[] = this.ws.fileTabs.map((t) => ({
      id: t.id, name: t.name, mode: t.mode, path: t.ref.kind === 'path' ? t.ref.path : null, stamp: t.stamp,
      dirty: t.dirty, token: this.ws.token(t), copy: () => this.ws.copyOf(t),
    }));
    return this.recovery.copy(tabs);
  }

  // ---------------------------------------------------------------- AutoSave

  /** Whether AutoSave is on for a tab (its own switch, or the option), whatever else stops it. */
  autoSaveWanted(t: Tab): boolean {
    return t.autoSave ?? this.prefs.autoSave;
  }

  private autoOn(t: Tab): boolean {
    return this.autoSaveWanted(t) && this.ws.canAutoSave(t) && !this.paused.has(t.id);
  }

  /** File > AutoSave: switch it for the tab showing. A tab never saved is saved first. */
  async toggleAutoSave(tab: Tab): Promise<void> {
    const on = !this.autoSaveWanted(tab);
    if (on && !this.ws.canAutoSave(tab)) {
      const ext = extensionOf(tab.name);
      if (tab.ref.kind !== 'none' && ['csv', 'tsv', 'txt', 'sdf', 'sd'].includes(ext)) {
        this.host.flash(`AutoSave is off for .${ext} files, which keep only one sheet's values. Save as .xlsx (File ▸ Save As) to use AutoSave.`, 8000);
        return;
      }
      if (!desktop && tab.ref.kind === 'none' && !('showSaveFilePicker' in window)) {
        this.host.flash('AutoSave needs a browser that can save back to a file (Chrome or Edge), or the desktop app.', 8000);
        return;
      }
      this.host.flash('Choose where to save the file; AutoSave then keeps it saved.', 5000);
      if (!(await this.ws.saveAs(tab)) || !this.ws.canAutoSave(tab)) return;
    }
    tab.autoSave = on;
    this.paused.delete(tab.id);
    this.host.flash(on ? `AutoSave on for ${tab.name}: it saves itself a few seconds after each change.` : `AutoSave off for ${tab.name}: press Ctrl+S to save.`, 5000);
    this.host.refresh();
  }

  // ---------------------------------------------------------------- the workspace's save hooks

  async beforeWrite(tab: Tab, ref: FileRef, name: string, how: SaveHow): Promise<'go' | 'stop' | 'save-as'> {
    if (ref.kind === 'none') return 'go';
    const p = this.prefs;
    // saving over a file someone or something else has changed since it was opened or saved here
    if (sameRef(tab.ref, ref) && tab.stamp && p.changedOnDisk !== 'ignore') {
      const disk = await stampOf(ref);
      if (disk && !sameStamp(disk, tab.stamp)) {
        if (how === 'autosaved') {
          this.paused.add(tab.id);
          await this.changedOnDisk(tab, disk);
          return 'stop';
        }
        const i = await choose('File Changed on Disk', `${name} has been changed since you opened or last saved it here (${when(disk.modified)}), by another program, someone else in a shared folder, or OneDrive bringing in changes. Saving now replaces those changes with yours.`,
          ['Cancel', 'Save As…', 'Save Anyway'], 1);
        if (i === 1) return 'save-as';
        if (i !== 2) return 'stop';
      }
    }
    // the file as it was, before this session first writes over it
    const key = versionKey(ref, name);
    if (key && this.versions.firstSave(key)) {
      const was = p.versionsKeep > 0 ? await readRef(ref) : null;
      if (was && was.length) await this.versions.add(key, was, 'before', { keep: p.versionsKeep, days: p.versionsDays, ext: extensionOf(name) }).catch(() => {});
      else this.versions.saw(key);
    }
    return 'go';
  }

  saved(tab: Tab, data: Uint8Array, how: SaveHow, was: FileRef): void {
    const p = this.prefs;
    if (how === 'saved') { this.paused.delete(tab.id); closeNotice(`autosave-${tab.id}`); }
    this.told.delete(tab.id);
    closeNotice(`disk-${tab.id}`);
    const key = versionKey(tab.ref, tab.name);
    if (key) void this.versions.add(key, data, how, { keep: p.versionsKeep, days: p.versionsDays, every: how === 'autosaved' ? p.versionMinutes : 0, ext: extensionOf(tab.name) }).catch(() => {});
    // Save As somewhere else: the lock moves with it
    if (!sameRef(was, tab.ref)) {
      void this.unlock(tab, was).then(() => this.checkLocks(tab));
      this.conflicts.delete(tab.id);
    }
  }

  autoSaveFailed(tab: Tab, message: string): void {
    this.paused.add(tab.id);
    notice(`autosave-${tab.id}`, `AutoSave couldn’t save ${tab.name}`, `${message}\nAutoSave waits until you save it yourself (Ctrl+S). Your changes are still here, and in the recovery copies.`, [
      { label: 'Save As…', run: () => void this.ws.saveAs(tab), main: true },
      { label: 'OK', run: () => {} },
    ]);
  }

  opened(tab: Tab): void {
    this.told.delete(tab.id);
    if (tab.ref.kind === 'path') void this.checkLocks(tab);
  }

  dropped(tab: Tab): void {
    void this.unlock(tab, tab.ref);
    this.locks.delete(tab.id);
    this.holders.delete(tab.id);
    this.conflicts.delete(tab.id);
    this.paused.delete(tab.id);
    this.told.delete(tab.id);
    this.auto.done(tab.id);
    closeNotices(`disk-${tab.id}`);
    closeNotices(`lock-${tab.id}`);
    closeNotices(`onedrive-${tab.id}`);
    closeNotices(`autosave-${tab.id}`);
  }

  // ---------------------------------------------------------------- changed on disk

  private async checkDisk(t: Tab): Promise<void> {
    if (t.ref.kind === 'none' || !t.stamp || this.prefs.changedOnDisk === 'ignore') return;
    const disk = await stampOf(t.ref);
    if (!this.ws.tabs.includes(t) || sameStamp(disk, t.stamp)) return;
    if (!disk) {
      if (t.ref.kind !== 'path') return;
      // moved, renamed or deleted: said once; saving puts it back
      t.stamp = null;
      notice(`disk-${t.id}`, `${t.name} isn’t there any more`, `${t.ref.path} has been moved, renamed or deleted (or its drive is offline). The tab still has everything: Save puts the file back, or Save As puts it somewhere else.`, [
        { label: 'Save As…', run: () => void this.ws.saveAs(t), main: true },
        { label: 'OK', run: () => {} },
      ]);
      return;
    }
    if (!t.dirty && this.prefs.changedOnDisk === 'reload') {
      if (await this.reload(t)) this.host.flash(`${t.name} was changed outside Chem Illustrator, so it has been reloaded.`, 6000);
      return;
    }
    await this.changedOnDisk(t, disk);
  }

  /** Ask what to do about a file changed elsewhere (once for each change). */
  private async changedOnDisk(t: Tab, disk: { modified: number; size: number }): Promise<void> {
    const mark = `${disk.modified}:${disk.size}`;
    if (this.told.get(t.id) === mark) return;
    this.told.set(t.id, mark);
    this.paused.add(t.id);
    const keepMine = () => { t.stamp = disk; this.paused.delete(t.id); this.told.delete(t.id); };
    notice(`disk-${t.id}`, `${t.name} changed on disk`,
      `It was changed ${when(disk.modified)} outside Chem Illustrator: by another program, someone else in a shared folder, or OneDrive bringing in changes.` +
      (t.dirty ? ' You have unsaved changes here too: Reload throws them away, Keep Mine saves over theirs next time, and Open Theirs shows their version in a new tab to compare.' : ' Reload shows their version; Keep Mine leaves the tab as it is.'), [
        { label: t.dirty ? 'Reload (Lose Mine)' : 'Reload', run: () => void this.reload(t), main: !t.dirty },
        { label: 'Keep Mine', run: keepMine, main: t.dirty },
        { label: 'Open Theirs', run: () => { keepMine(); void this.openDiskCopy(t); } },
      ]);
  }

  /** Read the tab's file again, in place of what the tab has. */
  async reload(t: Tab): Promise<boolean> {
    const bytes = await readRef(t.ref);
    if (!bytes) { this.host.flash(`Couldn’t read ${t.name} again.`); return false; }
    const stamp = await stampOf(t.ref);
    const n = await this.ws.openAs(bytes, t.name, { name: t.name, ref: t.ref, dirty: false, stamp, replace: t });
    return !!n;
  }

  private async openDiskCopy(t: Tab): Promise<void> {
    const bytes = await readRef(t.ref);
    if (!bytes) return;
    const stem = t.name.replace(/\.[^.]*$/, ''), ext = t.name.slice(stem.length);
    await this.ws.openAs(bytes, t.name, { name: `${stem} (on disk)${ext}`, ref: { kind: 'none' }, dirty: false, stamp: null });
  }

  // ---------------------------------------------------------------- open elsewhere

  /** Someone else holding the file: a lock file (ours or LibreOffice's) or an Office owner file. */
  private async holder(path: string): Promise<Holder | null> {
    try {
      const h = parseLock(new TextDecoder().decode(await readPath(lockPath(path))));
      if (h) {
        const mine = h.by === 'app' && h.session === this.recovery.session;
        // left behind by a copy of this app on this computer that has stopped
        const stale = h.by === 'app' && h.user === this.me.user && h.host === this.me.host && !!h.session && !(await this.recovery.running(h.session));
        if (!mine && !stale) return h;
      }
    } catch { /* no lock file */ }
    for (const p of officeOwnerPaths(path)) {
      try { const h = parseOfficeOwner(await readPath(p)); if (h) return h; } catch { /* none */ }
    }
    return null;
  }

  private async checkLocks(t: Tab): Promise<void> {
    if (!desktop || t.ref.kind !== 'path') return;
    const path = t.ref.path, p = this.prefs;
    const h = await this.holder(path);
    if (!this.ws.tabs.includes(t) || t.ref.kind !== 'path' || t.ref.path !== path) return;
    if (h) {
      const text = holderText(h);
      if (p.warnOpenElsewhere && this.holders.get(t.id) !== text) {
        notice(`lock-${t.id}`, `${t.name} is open somewhere else`, `Open by ${text}. If you both save, the last save wins and the other changes are lost. Work on a copy, or agree who saves.`, [
          { label: 'Work on a Copy', run: () => this.workOnCopy(t) },
          { label: 'OK', run: () => {}, main: true },
        ]);
      }
      this.holders.set(t.id, text);
    } else {
      if (this.holders.has(t.id)) {
        this.holders.delete(t.id);
        closeNotice(`lock-${t.id}`);
        if (p.warnOpenElsewhere) this.host.flash(`${t.name} is no longer open anywhere else.`, 5000);
      }
      if (p.lockFiles && this.locks.get(t.id) !== lockPath(path)) {
        try {
          await invoke('write_lock_file', { path: lockPath(path), contents: lockText(this.me, this.recovery.session) });
          this.locks.set(t.id, lockPath(path));
        } catch { /* a read-only folder: no lock, nothing else changes */ }
      } else if (!p.lockFiles && this.locks.has(t.id)) await this.unlock(t, t.ref);
    }
    // OneDrive's copy with this computer's name, when a change here and one elsewhere collided
    const copy = p.warnOpenElsewhere && inOneDrive(path) ? oneDriveConflictPath(path, this.me.host) : null;
    if (copy) {
      const there = await pathExists(copy).catch(() => false);
      const before = this.conflicts.get(t.id);
      this.conflicts.set(t.id, there);
      if (there && before === false) {
        notice(`onedrive-${t.id}`, 'OneDrive kept a second copy', `${baseName(copy)} appeared beside ${t.name}: OneDrive makes it when the file was changed in two places at once, to keep both sets of changes. Open it to compare and copy across what you need.`, [
          { label: 'Open It', run: () => void readPath(copy).then((b) => this.ws.openBytes(b, baseName(copy), { kind: 'path', path: copy })), main: true },
          { label: 'OK', run: () => {} },
        ]);
      }
    }
  }

  /** Stop saving to a file someone else has open: the tab becomes an unsaved copy. */
  private workOnCopy(t: Tab): void {
    void this.unlock(t, t.ref);
    const stem = t.name.replace(/\.[^.]*$/, ''), ext = t.name.slice(stem.length);
    t.ref = { kind: 'none' };
    t.name = `${stem} (copy)${ext}`;
    t.stamp = null;
    t.dirty = true;
    if (t.deck || t.book || t.document) t.savedEdits = -1;
    this.holders.delete(t.id);
    this.host.refresh();
    this.host.flash(`Working on a copy: Save asks where to put ${t.name}.`, 6000);
  }

  /** Take this app's lock off a file, unless another tab still has the file open. */
  private async unlock(t: Tab, ref: FileRef): Promise<void> {
    const lock = this.locks.get(t.id);
    if (!lock || ref.kind !== 'path' || lock !== lockPath(ref.path)) return;
    this.locks.delete(t.id);
    const other = this.ws.fileTabs.find((o) => o !== t && o.ref.kind === 'path' && o.ref.path === ref.path);
    if (other) { this.locks.set(other.id, lock); return; }
    await invoke('remove_lock_file', { path: lock }).catch(() => {});
  }

  // ---------------------------------------------------------------- Recover Unsaved Work

  /** File > Recover Unsaved Work…: copies left by sessions that stopped unexpectedly. */
  async recoverCommand(): Promise<void> {
    let left: Session[] = [];
    try { left = await this.recovery.leftOver(this.prefs.recoveryDays); } catch { /* none */ }
    if (!left.length) {
      const m = this.prefs.recoveryMinutes;
      await choose('Recover Unsaved Work', `There is nothing to recover. ${m ? `While you work, each tab with unsaved changes is copied every ${m === 1 ? 'minute' : `${m} minutes`}; the copies are offered here if Chem Illustrator closes before they are saved.` : 'Recovery copies are switched off (File ▸ AutoSave and Recovery Options).'}`, ['OK']);
      return;
    }
    await this.offer(left, false);
  }

  private async offer(left: Session[], atStart: boolean): Promise<void> {
    const r = await recoverDialog(left, atStart);
    if (!r || r.action === 'later') {
      if (atStart) for (const s of left) await this.recovery.markOffered(s).catch(() => {});
      return;
    }
    if (r.action === 'discard') {
      const n = r.picked.length;
      if ((await choose('Delete Copies', `Delete ${n === 1 ? 'this copy' : `these ${n} copies`} of unsaved work? This can’t be undone.`, ['Cancel', 'Delete'], 0)) !== 1) {
        if (atStart) for (const s of left) await this.recovery.markOffered(s).catch(() => {});
        return;
      }
    }
    let opened = 0;
    for (const s of left) {
      const mine = r.picked.filter((x) => x.session === s).map((x) => x.tab);
      if (r.action === 'reopen') {
        for (const t of mine) {
          const bytes = await this.recovery.read(s.session, t.file);
          if (!bytes) continue;
          const taken = t.path && this.ws.fileTabs.some((o) => o.ref.kind === 'path' && o.ref.path === t.path);
          const ref: FileRef = t.path && desktop && !taken ? { kind: 'path', path: t.path } : { kind: 'none' };
          const stem = t.name.replace(/\.[^.]*$/, ''), ext = t.name.slice(stem.length);
          const tab = await this.ws.openAs(bytes, t.file, { name: taken ? `${stem} (recovered)${ext}` : t.name, ref, dirty: true, stamp: ref.kind === 'path' ? t.stamp : null });
          if (tab) opened++;
        }
      }
      await this.recovery.forget(s, mine.map((t) => t.file)).catch(() => {});
      if (atStart && s.tabs.length && mine.length < s.tabs.length) await this.recovery.markOffered(s).catch(() => {});
    }
    if (r.action === 'reopen') this.host.flash(opened ? `Recovered ${opened} file${opened === 1 ? '' : 's'}, not saved yet: Save keeps ${opened === 1 ? 'it' : 'them'} (files that had been saved go back to where they were).` : 'The copies couldn’t be read.', 8000);
    else this.host.flash('Deleted the copies.');
  }

  // ---------------------------------------------------------------- Version History

  /** File > Version History…: the kept versions of the tab's file. */
  async historyCommand(tab: Tab): Promise<void> {
    const key = versionKey(tab.ref, tab.name);
    const p = this.prefs;
    if (!key) {
      await choose('Version History', `${tab.name} hasn’t been saved as a file yet. Once it is, a version is kept each time it’s saved${p.versionsKeep ? '' : ' (when Version History is switched on in File ▸ AutoSave and Recovery Options)'}.`, ['OK']);
      return;
    }
    const list = await this.versions.list(key).catch(() => [] as Version[]);
    const place = tab.ref.kind === 'path' ? tab.ref.path : tab.name;
    const note = p.versionsKeep
      ? `Up to ${p.versionsKeep} versions are kept${p.versionsDays ? `, for ${p.versionsDays} days` : ''} (File ▸ AutoSave and Recovery Options).`
      : 'Version History is switched off: File ▸ AutoSave and Recovery Options switches it on. Versions kept before are still here.';
    versionDialog(tab.name, place, list, note, {
      open: (v) => void this.openVersion(tab, key, v),
      restore: (v) => this.restoreVersion(tab, key, v),
      remove: (v) => this.versions.remove(key, v),
    });
  }

  private async openVersion(tab: Tab, key: string, v: Version): Promise<void> {
    const bytes = await this.versions.read(key, v);
    if (!bytes) { this.host.flash('That version couldn’t be read.'); return; }
    const ext = '.' + (extensionOf(v.file) || extensionOf(tab.name));
    const stem = tab.name.replace(/\.[^.]*$/, '');
    const d = new Date(v.at), two = (n: number) => String(n).padStart(2, '0');
    const stampText = `${d.getDate()} ${d.toLocaleDateString('en-GB', { month: 'short' })} ${two(d.getHours())}.${two(d.getMinutes())}`;
    await this.ws.openAs(bytes, withExtension(v.file, ext.slice(1)), { name: `${stem} (${stampText})${ext}`, ref: { kind: 'none' }, dirty: false, stamp: null });
  }

  private async restoreVersion(tab: Tab, key: string, v: Version): Promise<boolean> {
    if (!this.ws.tabs.includes(tab)) return false;
    const i = await choose('Restore Version', `Put the version from ${when(v.at)} in ${tab.name}, in place of what the tab has now? What it has now is kept as a version first, so this can be undone from Version History.`, ['Cancel', 'Restore'], 1);
    if (i !== 1) return false;
    const bytes = await this.versions.read(key, v);
    if (!bytes) { this.host.flash('That version couldn’t be read.'); return false; }
    const p = this.prefs;
    try {
      const now = await this.ws.encode(tab, tab.name);
      const data = typeof now.data === 'string' ? new TextEncoder().encode(now.data) : now.data;
      await this.versions.add(key, data, 'restored', { keep: Math.max(p.versionsKeep, 1), days: p.versionsDays, ext: extensionOf(tab.name) });
    } catch { /* the version is still restored */ }
    const t = await this.ws.openAs(bytes, withExtension(v.file, extensionOf(v.file) || extensionOf(tab.name)), { name: tab.name, ref: tab.ref, dirty: true, stamp: tab.stamp, replace: tab });
    if (t) this.host.flash(`Restored the version from ${when(v.at)}. ${this.autoOn(t) ? 'AutoSave saves it shortly.' : 'Save to keep it.'}`, 6000);
    return !!t;
  }

  // ---------------------------------------------------------------- options

  async optionsCommand(): Promise<void> {
    let where = 'the app’s data folder';
    try { where = await (desktop ? invoke<string>('keep_folder') : Promise.resolve('this browser’s storage for the page')); } catch { /* the plain words */ }
    const next = await optionsDialog(this.prefs, where, desktop);
    if (!next) return;
    this.host.setPrefs(next);
    this.lastCopy = next.recoveryMinutes ? Date.now() - next.recoveryMinutes * 60_000 : this.lastCopy;
    this.lastLocks = 0;
    this.host.flash(`Saved. ${next.autoSave ? 'AutoSave is on for saved files.' : 'AutoSave is off (File ▸ AutoSave switches it for one file).'} ${next.recoveryMinutes ? `Unsaved work is copied every ${next.recoveryMinutes === 1 ? 'minute' : `${next.recoveryMinutes} minutes`}.` : 'Recovery copies are off.'}`, 6000);
  }
}

