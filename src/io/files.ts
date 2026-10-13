// Opening and saving files. The desktop app uses the system's Open and Save dialogs and
// writes straight to the chosen file. In a browser, Chrome and Edge can also save back to
// the file that was opened; other browsers open through an upload box and save as a download.

import { invoke, isTauri } from '@tauri-apps/api/core';

/** Where a drawing lives, so Save can write back to it. */
export type FileRef =
  | { kind: 'path'; path: string }
  | { kind: 'handle'; handle: FileHandle }
  | { kind: 'none' };

export interface FileType {
  description: string;
  extension: string;
  mime: string;
}

export const CDXML: FileType = { description: 'ChemDraw XML drawing', extension: 'cdxml', mime: 'chemical/x-cdxml' };
export const MOL: FileType = { description: 'MDL molfile', extension: 'mol', mime: 'chemical/x-mdl-molfile' };

// The parts of the File System Access API used here (Chrome and Edge only).
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}
interface PickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[];
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
}
type PickerWindow = Window & {
  showOpenFilePicker?: (o: PickerOptions) => Promise<FileHandle[]>;
  showSaveFilePicker?: (o: PickerOptions) => Promise<FileHandle>;
};
const pw = window as PickerWindow;

const desktop = isTauri();

/** File name without folders. */
export function baseName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

/** Same name with a different extension: "Scheme 1.cdxml" → "Scheme 1.mol". */
export function withExtension(name: string, ext: string): string {
  return name.replace(/\.[^.\\/]*$/, '') + '.' + ext;
}

function isAbort(e: unknown): boolean {
  return e instanceof DOMException && e.name === 'AbortError';
}

/** Ask for a file and read it. Null when the user cancels. */
export async function openFileDialog(types: FileType[]): Promise<{ name: string; text: string; ref: FileRef } | null> {
  if (desktop) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const path = await open({ multiple: false, directory: false, filters: types.map((t) => ({ name: t.description, extensions: [t.extension] })) });
    if (typeof path !== 'string') return null;
    const text = await invoke<string>('read_text_file', { path });
    return { name: baseName(path), text, ref: { kind: 'path', path } };
  }
  if (pw.showOpenFilePicker) {
    try {
      const [handle] = await pw.showOpenFilePicker({ types: types.map((t) => ({ description: t.description, accept: { [t.mime]: ['.' + t.extension] } })) });
      const file = await handle.getFile();
      return { name: file.name, text: await file.text(), ref: { kind: 'handle', handle } };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const file = await uploadBox(types);
  return file ? { name: file.name, text: await file.text(), ref: { kind: 'none' } } : null;
}

function uploadBox(types: FileType[]): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = types.map((t) => '.' + t.extension).join(',');
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
    input.addEventListener('cancel', () => resolve(null));
    input.click();
  });
}

/**
 * Ask where to save. Null when the user cancels. In browsers without a save dialog the
 * answer is a download with the suggested name.
 */
export async function saveFileDialog(suggestedName: string, type: FileType): Promise<{ name: string; ref: FileRef } | null> {
  if (desktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName, filters: [{ name: type.description, extensions: [type.extension] }] });
    if (!path) return null;
    // some systems leave off the extension when the user types a bare name
    const full = /\.[^.\\/]+$/.test(baseName(path)) ? path : path + '.' + type.extension;
    return { name: baseName(full), ref: { kind: 'path', path: full } };
  }
  if (pw.showSaveFilePicker) {
    try {
      const handle = await pw.showSaveFilePicker({ suggestedName, types: [{ description: type.description, accept: { [type.mime]: ['.' + type.extension] } }] });
      return { name: handle.name, ref: { kind: 'handle', handle } };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return { name: suggestedName, ref: { kind: 'none' } };
}

/** Write text to a file chosen earlier (or download it when the browser cannot write files). */
export async function writeFile(ref: FileRef, name: string, text: string, type: FileType): Promise<void> {
  if (ref.kind === 'path') {
    await invoke('write_text_file', { path: ref.path, contents: text });
  } else if (ref.kind === 'handle') {
    const w = await ref.handle.createWritable();
    await w.write(text);
    await w.close();
  } else {
    const url = URL.createObjectURL(new Blob([text], { type: type.mime }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
}

/** Can Save write back to this file without asking? */
export function canSaveInPlace(ref: FileRef): boolean {
  return ref.kind !== 'none';
}

/** Before closing or replacing a drawing with unsaved changes: save them, throw them away, or stop. */
export async function askSaveChanges(name: string): Promise<'save' | 'discard' | 'cancel'> {
  if (desktop) {
    const { message } = await import('@tauri-apps/plugin-dialog');
    const r = await message(`Save changes to ${name} before closing it?`, {
      title: 'Chem Illustrator',
      kind: 'warning',
      buttons: { yes: 'Save', no: "Don't Save", cancel: 'Cancel' },
    });
    return r === 'Save' || r === 'Yes' ? 'save' : r === "Don't Save" || r === 'No' ? 'discard' : 'cancel';
  }
  return window.confirm(`${name} has unsaved changes. Close it without saving?`) ? 'discard' : 'cancel';
}

/** Show an error in the system's style. */
export async function showError(message: string): Promise<void> {
  if (desktop) {
    const { message: show } = await import('@tauri-apps/plugin-dialog');
    await show(message, { title: 'Chem Illustrator', kind: 'error' });
  } else window.alert(message);
}
