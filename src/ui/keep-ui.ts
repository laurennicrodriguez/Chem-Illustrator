// The windows and notices for AutoSave, recovery and Version History: the corner notices about
// files changed or open elsewhere, Recover Unsaved Work, Version History, and AutoSave and
// Recovery Options.

import { ask } from './ask';
import type { KeepPrefs } from '../keep/prefs';
import type { Session, CopiedTab } from '../keep/recovery';
import { VERSION_LABEL, type Version } from '../keep/versions';

// ---------------------------------------------------------------- notices

export interface NoticeButton {
  label: string;
  run: () => void;
  main?: boolean;
  /** Leave the notice up after the click. */
  stay?: boolean;
}

const notices = new Map<string, HTMLElement>();

function stack(): HTMLElement {
  let el = document.querySelector<HTMLElement>('.keep-notices');
  if (!el) {
    el = document.createElement('div');
    el.className = 'keep-notices';
    document.body.append(el);
  }
  return el;
}

/** A notice in the corner, until a button is clicked. Another with the same key takes its place. */
export function notice(key: string, title: string, text: string, buttons: NoticeButton[]): void {
  closeNotice(key);
  const box = document.createElement('div');
  box.className = 'update-box keep-notice';
  box.setAttribute('role', 'alert');
  const h = document.createElement('strong');
  h.textContent = title;
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  const row = document.createElement('div');
  row.className = 'update-buttons';
  for (const b of buttons) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = b.label;
    if (b.main) el.className = 'primary';
    el.addEventListener('click', () => { if (!b.stay) closeNotice(key); b.run(); });
    row.append(el);
  }
  box.append(h, p, row);
  stack().append(box);
  notices.set(key, box);
}

export function closeNotice(key: string): void {
  notices.get(key)?.remove();
  notices.delete(key);
}

/** Close every notice whose key starts with this. */
export function closeNotices(prefix: string): void {
  for (const k of [...notices.keys()]) if (k.startsWith(prefix)) closeNotice(k);
}

export function hasNotice(key: string): boolean {
  return notices.has(key);
}

// ---------------------------------------------------------------- small windows

function dialog(cls: string, title: string): { d: HTMLDialogElement; form: HTMLFormElement; buttons: HTMLElement } {
  const d = document.createElement('dialog');
  d.className = `ask ${cls}`;
  const form = document.createElement('form');
  form.method = 'dialog';
  const h = document.createElement('h2');
  h.textContent = title;
  const buttons = document.createElement('p');
  buttons.className = 'ask-buttons';
  form.append(h);
  d.append(form);
  return { d, form, buttons };
}

function para(text: string): HTMLParagraphElement {
  const p = document.createElement('p');
  p.className = 'muted';
  p.textContent = text;
  return p;
}

/** A question with buttons of its own; resolves with the button's index, or -1 when closed. */
export function choose(title: string, text: string, labels: string[], main = 0): Promise<number> {
  return new Promise((resolve) => {
    const { d, form, buttons } = dialog('keep-choose', title);
    form.append(para(text));
    let answer = -1;
    labels.forEach((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (i === main) b.className = 'primary';
      b.addEventListener('click', () => { answer = i; d.close(); });
      buttons.append(b);
    });
    form.append(buttons);
    d.addEventListener('close', () => { d.remove(); resolve(answer); });
    document.body.append(d);
    d.showModal();
    buttons.querySelector<HTMLButtonElement>('.primary')?.focus();
  });
}

export function when(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === today.toDateString()) return `today ${time}`;
  const y = new Date(today);
  y.setDate(y.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `yesterday ${time}`;
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}) }) + ' ' + time;
}

export function sizeText(n: number): string {
  return n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

// ---------------------------------------------------------------- Recover Unsaved Work

export interface RecoverChoice {
  action: 'reopen' | 'later' | 'discard';
  picked: { session: Session; tab: CopiedTab }[];
}

/** The copies left when the app stopped unexpectedly: which to reopen. */
export function recoverDialog(sessions: Session[], atStart: boolean): Promise<RecoverChoice | null> {
  return new Promise((resolve) => {
    const { d, form, buttons } = dialog('keep-recover', 'Recover Unsaved Work');
    form.append(para(atStart
      ? 'Chem Illustrator closed before these were saved. These are the copies made last; pick the ones to reopen. Reopened files aren’t saved until you save them.'
      : 'Copies of unsaved work left when Chem Illustrator closed unexpectedly. Pick the ones to reopen.'));
    const list = document.createElement('div');
    list.className = 'keep-list';
    const boxes: { input: HTMLInputElement; session: Session; tab: CopiedTab }[] = [];
    for (const s of sessions) {
      const head = document.createElement('div');
      head.className = 'keep-list-head';
      head.textContent = `Left ${when(s.beat)}`;
      list.append(head);
      for (const t of s.tabs) {
        const row = document.createElement('label');
        row.className = 'keep-row';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = true;
        const name = document.createElement('span');
        name.className = 'keep-name';
        name.textContent = t.name;
        const where = document.createElement('small');
        where.className = 'muted';
        where.textContent = (t.path ? t.path : 'never saved') + ` · copied ${when(t.copied)}`;
        name.append(document.createElement('br'), where);
        row.append(input, name);
        list.append(row);
        boxes.push({ input, session: s, tab: t });
      }
    }
    form.append(list);
    let result: RecoverChoice | null = null;
    const button = (label: string, action: RecoverChoice['action'], main = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (main) b.className = 'primary';
      b.addEventListener('click', () => {
        const picked = boxes.filter((x) => x.input.checked).map(({ session, tab }) => ({ session, tab }));
        if (action !== 'later' && !picked.length) return;
        result = { action, picked };
        d.close();
      });
      buttons.append(b);
    };
    button('Delete Copies', 'discard');
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    buttons.append(spacer);
    button(atStart ? 'Not Now' : 'Close', 'later');
    button('Reopen', 'reopen', true);
    form.append(buttons, para(atStart ? '“Not Now” keeps them: File ▸ Recover Unsaved Work… has them later.' : 'Copies are deleted after the number of days set in File ▸ AutoSave and Recovery Options.'));
    d.addEventListener('close', () => { d.remove(); resolve(result); });
    document.body.append(d);
    d.showModal();
  });
}

// ---------------------------------------------------------------- Version History

export interface VersionActions {
  open(v: Version): void;
  restore(v: Version): Promise<boolean>;
  remove(v: Version): Promise<void>;
}

/** The kept versions of the tab's file, newest first, to open, restore or delete. */
export function versionDialog(fileName: string, place: string, versions: Version[], note: string, act: VersionActions): void {
  const { d, form, buttons } = dialog('keep-versions', `Version History: ${fileName}`);
  form.append(para(place));
  const list = document.createElement('div');
  list.className = 'keep-list';
  list.setAttribute('role', 'listbox');
  let picked: Version | null = versions[0] ?? null;
  const rows = new Map<Version, HTMLElement>();
  const pick = (v: Version | null) => {
    picked = v;
    for (const [x, el] of rows) el.setAttribute('aria-selected', String(x === v));
    for (const b of buttons.querySelectorAll<HTMLButtonElement>('button[data-needs]')) b.disabled = !v;
  };
  const render = () => {
    rows.clear();
    list.replaceChildren();
    if (!versions.length) list.append(para('No versions kept yet. One is kept each time the file is saved here.'));
    for (const v of versions) {
      const row = document.createElement('div');
      row.className = 'keep-row keep-version';
      row.setAttribute('role', 'option');
      row.tabIndex = 0;
      const a = document.createElement('span');
      a.className = 'keep-name';
      a.textContent = when(v.at);
      const b = document.createElement('small');
      b.className = 'muted';
      b.textContent = `${VERSION_LABEL[v.how]} · ${sizeText(v.size)}`;
      row.append(a, b);
      row.addEventListener('click', () => pick(v));
      row.addEventListener('dblclick', () => { pick(v); act.open(v); d.close(); });
      row.addEventListener('keydown', (e) => {
        const i = versions.indexOf(v);
        if (e.key === 'ArrowDown' && versions[i + 1]) { e.preventDefault(); pick(versions[i + 1]); rows.get(versions[i + 1])?.focus(); }
        if (e.key === 'ArrowUp' && versions[i - 1]) { e.preventDefault(); pick(versions[i - 1]); rows.get(versions[i - 1])?.focus(); }
      });
      rows.set(v, row);
      list.append(row);
    }
    pick(picked && versions.includes(picked) ? picked : versions[0] ?? null);
  };
  form.append(list);
  const button = (label: string, title: string, fn: () => void, needs = true, main = false) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.title = title;
    if (needs) b.dataset.needs = '1';
    if (main) b.className = 'primary';
    b.addEventListener('click', fn);
    buttons.append(b);
  };
  button('Delete', 'Delete this kept version (the file itself is not changed)', () => {
    const v = picked;
    if (!v) return;
    void act.remove(v).then(() => { versions = versions.filter((x) => x !== v); render(); });
  });
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  buttons.append(spacer);
  button('Close', '', () => d.close(), false);
  button('Restore', 'Put this version in the tab in place of what it has now (what it has now is kept as a version first)', () => {
    const v = picked;
    if (v) void act.restore(v).then((ok) => { if (ok) d.close(); });
  });
  button('Open a Copy', 'Open this version in a new tab, to look at or copy from, leaving the file as it is', () => { if (picked) { act.open(picked); d.close(); } }, true, true);
  form.append(buttons, para(note));
  render();
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  d.showModal();
}

// ---------------------------------------------------------------- options

const MINUTE_CHOICES = [0, 1, 2, 5, 10, 15, 30];

/** File > AutoSave and Recovery Options. */
export async function optionsDialog(p: KeepPrefs, where: string, desktop: boolean): Promise<KeepPrefs | null> {
  const pending = ask('AutoSave and Recovery Options', [
    { name: 'autoSave', label: 'AutoSave: files already saved save themselves as you work (File ▸ AutoSave switches it for one file)', type: 'checkbox', value: String(p.autoSave) },
    { name: 'autoSaveSeconds', label: 'AutoSave after the last change', type: 'number', value: String(p.autoSaveSeconds), unit: 'seconds' },
    { name: 'recoveryMinutes', label: 'Copy unsaved work for recovery', value: String(MINUTE_CHOICES.includes(p.recoveryMinutes) ? p.recoveryMinutes : 2),
      options: MINUTE_CHOICES.map((m) => ({ value: String(m), label: m === 0 ? 'Never' : m === 1 ? 'Every minute' : `Every ${m} minutes` })) },
    { name: 'recoveryDays', label: 'Keep copies left after a crash for', type: 'number', value: String(p.recoveryDays), unit: 'days' },
    { name: 'versionsKeep', label: 'Version History: versions kept of each file (0: none)', type: 'number', value: String(p.versionsKeep) },
    { name: 'versionsDays', label: 'Delete versions older than (0: never)', type: 'number', value: String(p.versionsDays), unit: 'days' },
    { name: 'versionMinutes', label: 'While AutoSave is on, add a version at most every', type: 'number', value: String(p.versionMinutes), unit: 'minutes' },
    { name: 'changedOnDisk', label: 'When a file changes outside Chem Illustrator', value: p.changedOnDisk, options: [
      { value: 'ask', label: 'Ask what to do' },
      { value: 'reload', label: 'Reload it, unless it has unsaved changes here' },
      { value: 'ignore', label: 'Do nothing' },
    ] },
    ...(desktop ? [
      { name: 'lockFiles', label: 'Mark files I have open with a small hidden lock file, as Word and LibreOffice do, so others (and other copies of this app) can see', type: 'checkbox' as const, value: String(p.lockFiles) },
      { name: 'warnOpenElsewhere', label: 'Tell me when a file I have open is also open somewhere else, or OneDrive made a conflict copy of it', type: 'checkbox' as const, value: String(p.warnOpenElsewhere) },
    ] : []),
  ], { ok: 'Save', note: `A Save always adds a version. Recovery copies and versions are kept in ${where}.` });
  // room for the longer labels (the window is in the page as soon as ask() is called)
  [...document.querySelectorAll('dialog.ask')].pop()?.classList.add('keep-options');
  const r = await pending;
  if (!r) return null;
  const num = (k: string, d: number) => { const v = Number(r[k]); return isFinite(v) ? v : d; };
  return {
    autoSave: r.autoSave === 'true',
    autoSaveSeconds: num('autoSaveSeconds', p.autoSaveSeconds),
    recoveryMinutes: num('recoveryMinutes', p.recoveryMinutes),
    recoveryDays: num('recoveryDays', p.recoveryDays),
    versionsKeep: num('versionsKeep', p.versionsKeep),
    versionsDays: num('versionsDays', p.versionsDays),
    versionMinutes: num('versionMinutes', p.versionMinutes),
    changedOnDisk: r.changedOnDisk as KeepPrefs['changedOnDisk'],
    lockFiles: desktop ? r.lockFiles === 'true' : p.lockFiles,
    warnOpenElsewhere: desktop ? r.warnOpenElsewhere === 'true' : p.warnOpenElsewhere,
  };
}
