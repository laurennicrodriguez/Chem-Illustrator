// Charts in Word and PowerPoint files, as those programs keep them (ECMA-376 part 1, 21.2): the
// chart part (written as for Excel, with a copy of every number) and the chart's data as an
// Excel workbook embedded beside it, which their Edit Data opens. Reading takes the chart and
// puts the numbers it cached back into cells.

import { Package, PackageReader, kids } from './ooxml';
import { chartXml, readChartXml, CT_CHART, REL_CHART, CT_CHARTEX, REL_CHARTEX, CX_NS, addChartExStyle } from './xlsx-chart';
import { writeXlsx, type XlsxPictures } from './xlsx';
import { ChartBox, boxBook, boxData, boxFromCaches, PX_PER_PT } from '../sheet/chart-box';
import { newChartId, isChartEx } from '../sheet/chart';

export { CT_CHART, REL_CHART, CX_NS };
export const C_NS = 'http://schemas.openxmlformats.org/drawingml/2006/chart';
const REL_PACKAGE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/package';
const CT_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The data of a chart has no structures in it: nothing to draw. */
const NO_PICTURES: XlsxPictures = { box: () => ({ w: 0, h: 0 }), picture: async () => null };

/** A path from one part's folder to another part ("../charts/chart1.xml"). */
function relative(from: string, to: string): string {
  const a = from.split('/').slice(0, -1), b = to.split('/');
  let i = 0;
  while (i < a.length && i < b.length - 1 && a[i] === b[i]) i++;
  return [...Array(a.length - i).fill('..'), ...b.slice(i)].join('/');
}

/**
 * Add a chart to a package being written: its part (in `dir`/charts) and its data as a workbook
 * (in `dir`/embeddings). Returns the relationship id from `from` to the chart. Histograms and box
 * charts go in the newer chart part of Office 2016 (chartEx), which the caller wraps for older
 * programs.
 */
export async function addChart(pkg: Package, from: string, dir: string, n: number, box: ChartBox, w: number, h: number): Promise<string> {
  const ex = isChartEx(box.chart.kind);
  const path = `${dir}/charts/${ex ? 'chartEx' : 'chart'}${n}.xml`;
  const book = `${dir}/embeddings/Microsoft_Excel_Worksheet${n}.xlsx`;
  pkg.add(book, await writeXlsx(boxBook(box).wb, NO_PICTURES));
  pkg.defaultType('xlsx', CT_XLSX);
  const rid = pkg.relate(path, REL_PACKAGE, relative(path, book));
  const sized = { ...box.chart, w: Math.round(w * PX_PER_PT), h: Math.round(h * PX_PER_PT) };
  const body = ex
    ? chartXml(sized, boxData(box)).replace('<cx:chartData>', `<cx:chartData><cx:externalData r:id="${rid}" cx:autoUpdate="0"/>`)
    : chartXml(sized, boxData(box)).replace(/<\/c:chartSpace>$/, `<c:externalData r:id="${rid}"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>`);
  pkg.add(path, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${body}`, ex ? CT_CHARTEX : CT_CHART);
  if (ex) addChartExStyle(pkg, path, n);
  return pkg.relate(from, ex ? REL_CHARTEX : REL_CHART, relative(from, path));
}

/** The numbers and labels a chart part cached beside each of its references. */
function cachesOf(doc: Document): { ref: string; values: string[] }[] {
  const out: { ref: string; values: string[] }[] = [];
  // a newer chart: each block of data's numbers and labels, with their references
  for (const dim of Array.from(doc.getElementsByTagNameNS(CX_NS, 'numDim')).concat(Array.from(doc.getElementsByTagNameNS(CX_NS, 'strDim')))) {
    const f = kids(dim, 'f')[0]?.textContent?.trim();
    const lvl = kids(dim, 'lvl')[0];
    if (!f || !lvl) continue;
    const n = Number(lvl.getAttribute('ptCount') ?? 0);
    const values: string[] = Array(Math.max(0, Math.min(100000, n))).fill('');
    const text = dim.localName === 'strDim';
    for (const pt of kids(lvl, 'pt')) {
      const i = Number(pt.getAttribute('idx'));
      const v = pt.textContent ?? '';
      if (Number.isInteger(i) && i >= 0 && i < values.length) values[i] = text && v.trim() !== '' && Number.isFinite(Number(v)) ? `'${v}` : v;
    }
    out.push({ ref: f, values });
  }
  // a name given by reference
  for (const td of Array.from(doc.getElementsByTagNameNS(CX_NS, 'txData'))) {
    const f = kids(td, 'f')[0]?.textContent?.trim();
    if (f) out.push({ ref: f, values: [kids(td, 'v')[0]?.textContent ?? ''] });
  }
  for (const tag of ['numRef', 'strRef']) {
    for (const el of Array.from(doc.getElementsByTagNameNS(C_NS, tag))) {
      const f = kids(el, 'f')[0]?.textContent?.trim();
      const cache = kids(el, tag === 'numRef' ? 'numCache' : 'strCache')[0];
      if (!f || !cache) continue;
      const n = Number(kids(cache, 'ptCount')[0]?.getAttribute('val') ?? 0);
      const values: string[] = Array(Math.max(0, Math.min(100000, n))).fill('');
      for (const pt of kids(cache, 'pt')) {
        const i = Number(pt.getAttribute('idx'));
        const v = kids(pt, 'v')[0]?.textContent ?? '';
        // labels that read as numbers stay labels
        if (Number.isInteger(i) && i >= 0 && i < values.length) values[i] = tag === 'strRef' && v.trim() !== '' && Number.isFinite(Number(v)) ? `'${v}` : v;
      }
      out.push({ ref: f, values });
    }
  }
  return out;
}

/** A chart from a Word or PowerPoint file (shown `w` × `h` points), with its data; null when it has nothing this can show. */
export function readChart(pkg: PackageReader, path: string, w: number, h: number): { box: ChartBox; partial: boolean } | null {
  let doc: Document | null;
  try {
    doc = pkg.xml(path);
  } catch {
    return null;
  }
  if (!doc) return null;
  const got = readChartXml(doc, { row: 0, col: 0, dx: 0, dy: 0 }, w * PX_PER_PT, h * PX_PER_PT, newChartId());
  if (!got) return null;
  return { box: boxFromCaches(got.chart, cachesOf(doc)), partial: got.partial };
}
