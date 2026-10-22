// Drawing a chart of Document and Slides modes (a chart with its own data) into a box on the
// page or slide. The chart is laid out at the box's size, so resizing it reflows the chart (its
// text stays the same size) as in Word and PowerPoint, rather than stretching a picture.

import type { SeriesData } from '../sheet/chart';
import { ChartBox, boxData, PX_PER_PT } from '../sheet/chart-box';
import { drawChart, chartCanvas } from './chart-draw';

const data = new WeakMap<ChartBox, SeriesData[]>();

/** The box's series (worked out once: boxes are never changed in place). */
export function chartBoxData(b: ChartBox): SeriesData[] {
  let d = data.get(b);
  if (!d) { d = boxData(b); data.set(b, d); }
  return d;
}

/** Draw the chart into the box x, y, w × h (in the context's units, points). */
export function paintChartBox(ctx: CanvasRenderingContext2D, b: ChartBox, x: number, y: number, w: number, h: number): void {
  const cw = Math.max(1, Math.abs(w) * PX_PER_PT), ch = Math.max(1, Math.abs(h) * PX_PER_PT);
  ctx.save();
  ctx.translate(Math.min(x, x + w), Math.min(y, y + h));
  ctx.scale(1 / PX_PER_PT, 1 / PX_PER_PT);
  try {
    drawChart(ctx, { ...b.chart, w: cw, h: ch }, chartBoxData(b), cw, ch);
  } finally {
    ctx.restore();
  }
}

/** The chart as a PNG data URL `w` × `h` points, at `scale` pixels per pixel (for the picture other programs see). */
export function chartBoxPng(b: ChartBox, w: number, h: number, scale = 3): string {
  try {
    const cw = Math.max(1, Math.round(w * PX_PER_PT)), ch = Math.max(1, Math.round(h * PX_PER_PT));
    return chartCanvas({ ...b.chart, w: cw, h: ch }, chartBoxData(b), scale).toDataURL('image/png');
  } catch {
    // (no canvas: tests)
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/w8AAgMBApH3oiYAAAAASUVORK5CYII=';
  }
}
