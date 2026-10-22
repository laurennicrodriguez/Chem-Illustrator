import { describe, it, expect } from 'vitest';
import { slug, resolveLink, guideSpot } from '../src/ui/guide-window';

describe('the built-in User Guide', () => {
  it('makes heading anchors the way GitHub does', () => {
    expect(slug('Text, periodic table and fragmentation')).toBe('text-periodic-table-and-fragmentation');
    expect(slug('Arrows, mechanism symbols, shapes and brackets')).toBe('arrows-mechanism-symbols-shapes-and-brackets');
    expect(slug('Moving, turning and the Format menu')).toBe('moving-turning-and-the-format-menu');
  });

  it('follows links between the pages and to pictures', () => {
    expect(resolveLink('README.md', 'guide/drawing.md')).toEqual({ page: 'guide/drawing.md', anchor: '' });
    expect(resolveLink('guide/slides.md', 'design.md#icons')).toEqual({ page: 'guide/design.md', anchor: 'icons' });
    expect(resolveLink('guide/slides.md', '../images/slides.png')).toEqual({ page: 'images/slides.png', anchor: '' });
    expect(resolveLink('guide/slides.md', '#themes')).toEqual({ page: 'guide/slides.md', anchor: 'themes' });
    expect(resolveLink('guide/slides.md', 'https://example.org/x')).toBeNull();
  });

  it('opens F1 help at the tool or mode in use, at headings that exist', async () => {
    const { readFileSync } = await import('node:fs');
    const anchors = (page: string) => new Set(readFileSync(`docs/${page}`, 'utf8').split('\n').filter((l) => /^#+\s/.test(l)).map((l) => slug(l.replace(/^#+\s+/, ''))));
    const drawing = anchors('guide/drawing.md');
    for (const kind of ['select', 'eraser', 'bond', 'chain', 'ring', 'template', 'text', 'element', 'fragment', 'arrow', 'symbol', 'shape', 'bracket', 'line', 'mark']) {
      const at = guideSpot('drawing', kind);
      expect(at.page).toBe('guide/drawing.md');
      expect(drawing.has(at.anchor), `${kind} → ${at.anchor}`).toBe(true);
    }
    expect(guideSpot('sheet')).toEqual({ page: 'guide/sheets.md', anchor: '' });
    expect(guideSpot('design', 'bond').page).toBe('guide/design.md');
  });
});
