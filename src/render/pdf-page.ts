// The first page of a PDF as a picture (an embedded PDF shows it, as Word shows one), drawn by
// PDF.js, which loads only when a PDF is first put in. Its "legacy" build, which brings the
// newest JavaScript it uses with it: the Mac and Linux app windows don't have all of it.

import type { ObjectPicture } from './object-picture';

/** The first page at twice its size (sharp when printed), with its size in points; null when the file can't be drawn. */
export async function pdfFirstPage(bytes: Uint8Array): Promise<ObjectPicture | null> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = (await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url')).default;
  }
  const task = pdfjs.getDocument({ data: bytes.slice() });
  try {
    const doc = await task.promise;
    const page = await doc.getPage(1);
    const own = page.getViewport({ scale: 1 });
    const view = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(view.width);
    canvas.height = Math.ceil(view.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: view }).promise;
    return { src: canvas.toDataURL('image/png'), w: own.width, h: own.height, px: { w: canvas.width, h: canvas.height } };
  } catch {
    return null;
  } finally {
    void task.destroy();
  }
}
