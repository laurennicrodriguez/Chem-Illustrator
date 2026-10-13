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
export const CDX: FileType = { description: 'ChemDraw drawing', extension: 'cdx', mime: 'chemical/x-cdx' };
export const PPTX: FileType = { description: 'PowerPoint presentation', extension: 'pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
export const PDF: FileType = { description: 'PDF document', extension: 'pdf', mime: 'application/pdf' };
export const PICTURE: FileType = { description: 'Picture', extension: 'png', mime: 'image/png' };
/** Picture files that can go on a slide. */
export const PICTURE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'emf', 'bmp', 'webp'];
export const MOL: FileType = { description: 'MDL molfile', extension: 'mol', mime: 'chemical/x-mdl-molfile' };
export const KEYMAP_FILE: FileType = { description: 'Chem Illustrator hotkeys', extension: 'json', mime: 'application/json' };

// The parts of the File System Access API used here (Chrome and Edge only).
interface FileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }>;
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

/** The extension of a file name, in lower case ("" if none). */
export function extensionOf(name: string): string {
  const m = /\.([^.\\/]+)$/.exec(name);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Ask for a file and read its bytes. `extensions` lists what may be picked (the first group
 * named `label` holds them all, for "any file this can open"). Null when the user cancels.
 */
export async function openBytesDialog(label: string, types: FileType[], extra: string[] = []): Promise<{ name: string; bytes: Uint8Array; ref: FileRef } | null> {
  const exts = [...new Set([...types.map((t) => t.extension), ...extra])];
  if (desktop) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const filters = [{ name: label, extensions: exts }, ...types.map((t) => ({ name: t.description, extensions: [t.extension] }))];
    const path = await open({ multiple: false, directory: false, filters });
    if (typeof path !== 'string') return null;
    const buf = await invoke<ArrayBuffer>('read_binary_file', { path });
    return { name: baseName(path), bytes: new Uint8Array(buf), ref: { kind: 'path', path } };
  }
  if (pw.showOpenFilePicker) {
    try {
      const accept: Record<string, string[]> = { 'application/octet-stream': exts.map((e) => '.' + e) };
      const [handle] = await pw.showOpenFilePicker({ types: [{ description: label, accept }] });
      const file = await handle.getFile();
      return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ref: { kind: 'handle', handle } };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  const file = await uploadBox(exts.map((e) => ({ description: e, extension: e, mime: '' })));
  return file ? { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()), ref: { kind: 'none' } } : null;
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
 * Ask where to save, offering one or more file types (the first is the default). The type
 * chosen is the extension of the name returned. Null when the user cancels. In browsers
 * without a save dialog the answer is a download with the suggested name.
 */
export async function saveFileDialog(suggestedName: string, type: FileType | FileType[]): Promise<{ name: string; ref: FileRef } | null> {
  const types = Array.isArray(type) ? type : [type];
  if (desktop) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName, filters: types.map((t) => ({ name: t.description, extensions: [t.extension] })) });
    if (!path) return null;
    // some systems leave off the extension when the user types a bare name
    const full = /\.[^.\\/]+$/.test(baseName(path)) ? path : path + '.' + types[0].extension;
    return { name: baseName(full), ref: { kind: 'path', path: full } };
  }
  if (pw.showSaveFilePicker) {
    try {
      const handle = await pw.showSaveFilePicker({ suggestedName, types: types.map((t) => ({ description: t.description, accept: { [t.mime]: ['.' + t.extension] } })) });
      return { name: handle.name, ref: { kind: 'handle', handle } };
    } catch (e) {
      if (isAbort(e)) return null;
      throw e;
    }
  }
  return { name: suggestedName, ref: { kind: 'none' } };
}

/** Write text or bytes to a file chosen earlier (or download it when the browser cannot write files). */
export async function writeFile(ref: FileRef, name: string, data: string | Uint8Array, type: FileType): Promise<void> {
  if (ref.kind === 'path') {
    if (typeof data === 'string') await invoke('write_text_file', { path: ref.path, contents: data });
    else await invoke('write_binary_file', data, { headers: { path: encodeURIComponent(ref.path) } });
  } else if (ref.kind === 'handle') {
    const w = await ref.handle.createWritable();
    await w.write(data);
    await w.close();
  } else {
    const url = URL.createObjectURL(new Blob([data as BlobPart], { type: type.mime }));
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
