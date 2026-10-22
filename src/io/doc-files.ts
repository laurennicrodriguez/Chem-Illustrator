// The word processors' files Document mode opens and saves: Word's .docx (its own), and RTF,
// OpenDocument text (.odt) and old Word documents (.doc, opened only), each chosen by the file's
// contents or, failing that, its name.

import type { DocText } from '../document/document';
import { readDocx, writeDocx, type DocxDeps, type DocxReadDeps } from './docx';
import { isRtf, readRtf, writeRtf } from './rtf';
import { isOdt, readOdt, writeOdt } from './odt';
import { isDoc, readDoc } from './doc-binary';

/** Extensions of documents that open but save as .docx. */
export const DOC_OPEN_ONLY = ['doc'];

const extOf = (name: string) => /\.([^.\\/]+)$/.exec(name)?.[1]?.toLowerCase() ?? '';

/** Is this one of the other word processors' files (not Word's .docx)? */
export function isOtherDocument(bytes: Uint8Array, name: string): boolean {
  const ext = extOf(name);
  return ext === 'rtf' || ext === 'odt' || ext === 'doc' || isRtf(bytes) || isOdt(bytes) || isDoc(bytes);
}

/** Open a document file of any of these kinds. */
export async function readDocumentFile(bytes: Uint8Array, name: string, deps: DocxReadDeps = {}): Promise<{ doc: DocText; warnings: string[] }> {
  if (isRtf(bytes)) return readRtf(bytes);
  if (isOdt(bytes)) return readOdt(bytes);
  if (isDoc(bytes)) return readDoc(bytes);
  const ext = extOf(name);
  if (ext === 'rtf') return readRtf(bytes);
  if (ext === 'odt') return readOdt(bytes);
  if (ext === 'doc') return readDoc(bytes);
  return readDocx(bytes, deps);
}

/** Save a document as its name says: .rtf, .odt, else .docx. */
export async function writeDocumentFile(t: DocText, name: string, deps: DocxDeps): Promise<Uint8Array> {
  const ext = extOf(name);
  if (ext === 'rtf') return writeRtf(t, { picture: deps.picture });
  if (ext === 'odt') return writeOdt(t, { picture: deps.picture });
  return writeDocx(t, deps);
}

/** A note after saving in a format that keeps less than .docx. */
export function documentSaveNote(name: string): string {
  const ext = extOf(name);
  if (ext === 'rtf') return ' (as RTF: live fields, citations, comments and tracked changes are kept as their text; save as .docx to keep everything)';
  if (ext === 'odt') return ' (as OpenDocument: live fields, citations, comments and tracked changes are kept as their text; save as .docx to keep everything)';
  return '';
}
