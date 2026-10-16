// Font names with a number in them (Source Sans 3) must be quoted for the browser to use them at all.

import { describe, it, expect } from 'vitest';
import { cssFamily, withStack, FONT_STACK } from '../src/text/layout';
import { parseFont } from '../src/render/vector';

describe('font names in CSS', () => {
  it('quotes a name, but not a list, a quoted name or a generic family', () => {
    expect(cssFamily('Source Sans 3')).toBe('"Source Sans 3"');
    expect(cssFamily('Arial')).toBe('"Arial"');
    expect(cssFamily("'Times New Roman'")).toBe("'Times New Roman'");
    expect(cssFamily('Inter, sans-serif')).toBe('Inter, sans-serif');
    expect(cssFamily('sans-serif')).toBe('sans-serif');
    expect(withStack('Source Serif 4')).toBe(`"Source Serif 4", ${FONT_STACK}`);
  });
  it('reads back the plain name from a font setting', () => {
    expect(parseFont(`bold 36px ${withStack('Source Sans 3')}`)).toEqual({ size: 36, family: 'Source Sans 3', bold: true, italic: false });
  });
});
