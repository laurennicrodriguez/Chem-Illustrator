// Workspace files (File > Save Workspace, Open Workspace): a short list of the tabs that were
// open, in order, which one was showing and which drawing sat beside a document, sheet or deck
// in split view. Files in the workspace's own folder are listed by name, so the folder can be
// moved or copied (to OneDrive, another computer) and still open; others by their full path.

import type { FileType } from './files';

export const WORKSPACE: FileType = { description: 'Chem Illustrator workspace', extension: 'ciworkspace', mime: 'application/json' };

export interface WorkspaceEntry {
  /** The file: a name or path relative to the workspace file's folder, or a full path. */
  file: string;
  /** Split view: the entry (by position) of the drawing shown beside this tab. */
  beside?: number;
}

export interface WorkspaceList {
  tabs: WorkspaceEntry[];
  /** The tab showing, by position. */
  active: number;
}

/** The workspace as the text saved in its file. */
export function workspaceText(w: WorkspaceList): string {
  return JSON.stringify({ app: 'Chem Illustrator', kind: 'workspace', version: 1, ...w }, null, 2) + '\n';
}

/** Read a workspace file, keeping only what makes sense. Throws when it isn't one. */
export function parseWorkspace(text: string): WorkspaceList {
  let raw: unknown;
  try { raw = JSON.parse(text); } catch { throw new Error('this is not a workspace file'); }
  const r = raw as Record<string, unknown>;
  if (!r || typeof r !== 'object' || r.kind !== 'workspace' || !Array.isArray(r.tabs)) throw new Error('this is not a workspace file');
  const tabs: WorkspaceEntry[] = [];
  for (const t of r.tabs as unknown[]) {
    const e = t as Record<string, unknown>;
    if (!e || typeof e.file !== 'string' || !e.file.trim()) continue;
    tabs.push({ file: e.file, ...(Number.isInteger(e.beside) ? { beside: e.beside as number } : {}) });
  }
  for (const t of tabs) if (t.beside !== undefined && !(t.beside >= 0 && t.beside < tabs.length)) delete t.beside;
  const active = Number.isInteger(r.active) && (r.active as number) >= 0 && (r.active as number) < tabs.length ? (r.active as number) : 0;
  return { tabs, active };
}

/** The folder a file is in ("C:\Work\a.cdxml" → "C:\Work"). */
export function folderOf(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return i <= 0 ? path.slice(0, i + 1) : path.slice(0, i);
}

/** A file in a folder, joined with the folder's own kind of slash. */
export function joinPath(folder: string, name: string): string {
  const sep = folder.includes('\\') ? '\\' : '/';
  return folder.endsWith(sep) ? folder + name : folder + sep + name;
}

const isWindowsPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

/** Whether a path is a full one rather than relative to a folder. */
export function isAbsolute(p: string): boolean {
  return p.startsWith('/') || isWindowsPath(p);
}

function parts(p: string): string[] {
  return p.split(/[\\/]+/).filter(Boolean);
}

/**
 * How the workspace file lists a file: relative ("Scheme 1.cdxml", "figures/Fig 2.cdxml") when
 * it is in the workspace's folder or below it, otherwise the full path.
 */
export function relativeTo(folder: string, path: string): string {
  const win = isWindowsPath(folder) || isWindowsPath(path);
  const same = (a: string, b: string) => (win ? a.toLowerCase() === b.toLowerCase() : a === b);
  const f = parts(folder), p = parts(path);
  if (p.length <= f.length || !f.every((x, i) => same(x, p[i]))) return path;
  return p.slice(f.length).join('/');
}

/** The full path of a listed file. */
export function resolveIn(folder: string, file: string): string {
  if (isAbsolute(file)) return file;
  const sep = folder.includes('\\') ? '\\' : '/';
  return joinPath(folder, parts(file).join(sep));
}

/** A file name not already taken (case ignored, as on Windows): "Untitled.cdxml", "Untitled (2).cdxml"… */
export function freeName(name: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map((n) => n.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  const m = /^(.*?)(\.[^.]*)?$/.exec(name)!;
  for (let n = 2; ; n++) {
    const next = `${m[1]} (${n})${m[2] ?? ''}`;
    if (!used.has(next.toLowerCase())) return next;
  }
}

/** Characters Windows doesn't allow in file names, swapped for dashes. */
export function safeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').replace(/[. ]+$/, '') || 'Untitled';
}
