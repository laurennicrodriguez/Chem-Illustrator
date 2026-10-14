// File > Print: where things go on the paper.

import { describe, it, expect } from 'vitest';
import { PAPERS, defaultPaper, orient, placeIn, inside, handoutCells, noteLines, placeSvg, pageSvg } from '../src/print-layout';

describe('print layout', () => {
  it('picks Letter in North America and A4 elsewhere', () => {
    expect(defaultPaper('en-US')).toBe('letter');
    expect(defaultPaper('fr-CA')).toBe('letter');
    expect(defaultPaper('en-GB')).toBe('a4');
    expect(defaultPaper('de')).toBe('a4');
  });

  it('turns the paper to suit the drawing when asked to', () => {
    expect(orient(PAPERS.letter, 'auto', 500, 200)).toEqual({ w: 792, h: 612 });
    expect(orient(PAPERS.letter, 'auto', 200, 500)).toEqual({ w: 612, h: 792 });
    expect(orient(PAPERS.letter, 'portrait', 500, 200)).toEqual({ w: 612, h: 792 });
    expect(orient(PAPERS.a4, 'landscape')).toEqual({ w: 841.89, h: 595.28 });
  });

  it('centres a drawing at its own size, shrinking it only when it would not fit', () => {
    const area = inside({ w: 612, h: 792 }, 36);
    expect(area).toEqual({ x: 36, y: 36, w: 540, h: 720 });
    expect(placeIn(200, 100, area, 'actual')).toEqual({ x: 206, y: 346, w: 200, h: 100, scale: 1 });
    const big = placeIn(1080, 100, area, 'actual');
    expect(big.scale).toBe(0.5);
    expect(big.w).toBe(540);
    expect(placeIn(200, 100, area, 'fit').scale).toBe(2.7);
  });

  it('lays out handouts in a grid on the page', () => {
    const page = { w: 612, h: 792 };
    const two = handoutCells(page, 2);
    expect(two).toHaveLength(2);
    expect(two[0].w).toBe(540);
    expect(two[1].y).toBeCloseTo(36 + two[0].h + 18);
    const six = handoutCells(page, 6);
    expect(six.map((c) => Math.round(c.x))).toEqual([36, 315, 36, 315, 36, 315]);
    expect(handoutCells(page, 9)).toHaveLength(9);
    const three = handoutCells(page, 3);
    expect(three[0].w).toBeCloseTo(261);
    const lines = noteLines(three[0], page);
    expect(lines[0]).toEqual({ x1: 36 + 261 + 18, x2: 576, y: 36 + 22 });
    expect(lines.every((l) => l.y <= three[0].y + three[0].h)).toBe(true);
  });

  it('puts one picture inside another at the place given', () => {
    const inner = '<svg xmlns="http://www.w3.org/2000/svg" width="100pt" height="50pt" viewBox="10 20 100 50">\n<path d="M0 0"/>\n</svg>';
    const placed = placeSvg(inner, { x: 5, y: 6, w: 200, h: 100 });
    expect(placed.startsWith('<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 100 50" x="5" y="6" width="200" height="100" preserveAspectRatio="xMidYMid meet">')).toBe(true);
    expect(pageSvg(612, 792, [placed])).toContain('width="612pt" height="792pt" viewBox="0 0 612 792"');
  });
});
