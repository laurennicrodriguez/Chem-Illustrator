// The drawing's file: its name, where it is saved, and whether it has unsaved changes.
// New, Open, Save, Save As and Export go through here.

import { Doc, Entity, Kind } from '../model';
import { readCdxml } from './cdxml';
import { writeCdxml } from './cdxml-write';
import { measureText } from '../render/renderer';
import { toMolfile } from '../chem/molfile';
import { FileRef, CDXML, MOL, openFileDialog, saveFileDialog, writeFile, canSaveInPlace, askSaveChanges, showError, withExtension } from './files';

export interface DocumentHooks {
  /** Show a drawing read from a file; false if it could not be read. */
  load(text: string, name: string): boolean;
  /** Clear the drawing. */
  reset(): void;
  /** A short message at the bottom of the window. */
  flash(msg: string): void;
  /** The window title changed. */
  title(text: string): void;
}

export class DocumentFile {
  name = 'Untitled.cdxml';
  ref: FileRef = { kind: 'none' };
  private savedVersion: number;
  private lastTitle = '';

  constructor(private doc: Doc, private hooks: DocumentHooks) {
    this.savedVersion = doc.version;
    this.updateTitle();
  }

  get dirty(): boolean {
    return this.doc.version !== this.savedVersion;
  }

  updateTitle(): void {
    const t = `${this.dirty ? '• ' : ''}${this.name} – Chem Illustrator`;
    if (t !== this.lastTitle) { this.lastTitle = t; this.hooks.title(t); }
  }

  /** Call after replacing the drawing wholesale, so it counts as unchanged. */
  markSaved(): void {
    this.savedVersion = this.doc.version;
    this.updateTitle();
  }

  /** Offer to save unsaved changes. False means the user chose to stay. */
  async confirmClose(): Promise<boolean> {
    if (!this.dirty) return true;
    const answer = await askSaveChanges(this.name);
    if (answer === 'cancel') return false;
    if (answer === 'save') return this.save();
    return true;
  }

  async newDrawing(): Promise<void> {
    if (!(await this.confirmClose())) return;
    this.hooks.reset();
    this.name = 'Untitled.cdxml';
    this.ref = { kind: 'none' };
    this.markSaved();
  }

  async open(): Promise<void> {
    if (!(await this.confirmClose())) return;
    let f;
    try {
      f = await openFileDialog([CDXML]);
    } catch (e) {
      await showError('Could not open the file: ' + String(e));
      return;
    }
    if (f) this.loadText(f.text, f.name, f.ref);
  }

  /** A file dropped on the window or picked some other way. */
  async openText(text: string, name: string, ref: FileRef = { kind: 'none' }): Promise<boolean> {
    if (!(await this.confirmClose())) return false;
    return this.loadText(text, name, ref);
  }

  private loadText(text: string, name: string, ref: FileRef): boolean {
    if (!this.hooks.load(text, name)) return false;
    this.name = name;
    this.ref = ref;
    this.markSaved();
    return true;
  }

  async save(): Promise<boolean> {
    if (!canSaveInPlace(this.ref)) return this.saveAs();
    return this.writeTo(this.ref, this.name);
  }

  async saveAs(): Promise<boolean> {
    const target = await saveFileDialog(withExtension(this.name, CDXML.extension), CDXML).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return false;
    return this.writeTo(target.ref, target.name);
  }

  private async writeTo(ref: FileRef, name: string): Promise<boolean> {
    let text: string;
    try {
      text = writeCdxml(this.doc, { name, textMeasure: measureText });
      await writeFile(ref, name, text, CDXML);
    } catch (e) {
      await showError(`Could not save ${name}: ${String(e)}`);
      return false;
    }
    adoptSaved(this.doc, text);
    this.ref = ref;
    this.name = name;
    this.markSaved();
    this.hooks.flash(ref.kind === 'none' ? `Downloaded ${name}` : `Saved ${name}`);
    return true;
  }

  /** Save the selected structures (or the whole drawing) as a molfile. */
  async exportMolfile(atoms: Iterable<number>): Promise<void> {
    const ids = [...atoms];
    if (!ids.length) { this.hooks.flash('There is no structure to export.'); return; }
    const { molblock, unknownLabels } = toMolfile(this.doc, ids);
    const target = await saveFileDialog(withExtension(this.name, MOL.extension), MOL).catch(async (e) => { await showError(String(e)); return null; });
    if (!target) return;
    try {
      await writeFile(target.ref, target.name, molblock, MOL);
    } catch (e) {
      await showError(`Could not save ${target.name}: ${String(e)}`);
      return;
    }
    const left = unknownLabels.length ? ` (left out, not understood: ${unknownLabels.join(', ')})` : '';
    this.hooks.flash(`Saved ${target.name}${left}`);
  }
}

/**
 * After a save, the saved text becomes the file the drawing is compared with next time, so
 * saving again without changes writes the same bytes and later saves only touch new edits.
 */
export function adoptSaved(doc: Doc, text: string): void {
  let back: Doc;
  try {
    back = readCdxml(text).doc;
  } catch {
    return;
  }
  const src = back.source;
  if (!src) return;
  const maps: [Kind, Map<number, Entity>][] = [['a', doc.atoms], ['b', doc.bonds], ['c', doc.captions], ['r', doc.arrows], ['s', doc.shapes]];
  let count = 0;
  for (const [kind, m] of maps) {
    for (const id of m.keys()) {
      if (!src.ord.has(kind + id)) return; // the file numbers things differently; keep comparing with the old one
      count++;
    }
  }
  if (count !== src.ord.size) return;
  const orig = new Map<string, Entity>();
  for (const [kind, m] of maps) for (const e of m.values()) orig.set(kind + e.id, structuredClone(e));
  doc.source = { text, ord: src.ord, orig, maxId: src.maxId };
  doc.reserveIds(src.maxId); // ids the file uses inside abbreviations stay taken
}
