// Excel workbooks (.xlsx). Filled in below.

import type { Workbook } from '../sheet/workbook';
import type { Contents } from '../model';
import type { DocStyle } from '../style';

/** Pictures of structures for Excel (it shows a structure as a picture over its cell). */
export interface XlsxPictures {
  picture(contents: Contents, style: DocStyle): Promise<{ png: Uint8Array; w: number; h: number } | null>;
}

export async function writeXlsx(_book: Workbook, _deps: XlsxPictures): Promise<Uint8Array> {
  throw new Error('Saving Excel files is not finished yet.');
}

export async function readXlsx(_bytes: Uint8Array, _deps: XlsxPictures): Promise<{ book: Workbook; warnings: string[] }> {
  throw new Error('Opening Excel files is not finished yet.');
}
