// @vitest-environment jsdom
//
// ChemDraw style sheets (.cds): they open like any drawing (CDX or CDXML inside), offer their
// settings as a drawing style, and are never written back to.

import { describe, it, expect, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false, invoke: async () => { throw new Error('no disk here'); } }));

import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks } from '../src/workspace';
import { writeCdxml } from '../src/io/cdxml-write';
import { cdxmlToCdx } from '../src/io/cdx';
import type { DocStyle } from '../src/style';

const measure = (t: string, s: number) => t.length * s * 0.5;

function workspace(over: Partial<WorkspaceHooks> = {}) {
  const host = new Doc();
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: () => {},
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure,
    sheets: { read: async () => { throw new Error('no sheets here'); }, write: async () => '' },
    documents: { read: async () => { throw new Error('no documents here'); }, write: async () => new Uint8Array() },
    ...over,
  };
  return { host, ws: new Workspace(host, hooks) };
}

/** A style sheet's text: settings and an empty page. */
function sheetText(): string {
  const d = new Doc();
  d.style = { ...d.style, name: 'x', bondLength: 21.6, lineWidth: 0.85, boldWidth: 3, labelSize: 8, labelFont: 'Helvetica' };
  return writeCdxml(d, { name: 'x.cdxml', textMeasure: measure });
}

describe('ChemDraw style sheets', () => {
  for (const [kind, bytes] of [['CDX', () => cdxmlToCdx(sheetText())], ['CDXML', () => new TextEncoder().encode(sheetText())]] as const) {
    it(`open (${kind} inside) and offer their settings as a style`, async () => {
      const offered: DocStyle[] = [];
      const { ws, host } = workspace({ styleSheet: (_t, st) => offered.push(st) });
      expect(await ws.openBytes(bytes(), 'Group style.cds', { kind: 'path', path: '/w/Group style.cds' })).toBe(true);
      expect(ws.active.mode).toBe('drawing');
      expect(host.style.bondLength).toBeCloseTo(21.6);
      expect(offered).toHaveLength(1);
      expect(offered[0]).toMatchObject({ bondLength: 21.6, lineWidth: 0.85, boldWidth: 3, labelSize: 8, labelFont: 'Helvetica' });
      // Save goes through Save As (as .cdxml or .cdx), never back into the style sheet
      expect(ws.savesInPlace(ws.active)).toBe(false);
    });
  }

  it('are not offered for ordinary drawings', async () => {
    const offered: DocStyle[] = [];
    const { ws } = workspace({ styleSheet: (_t, st) => offered.push(st) });
    expect(await ws.openBytes(cdxmlToCdx(sheetText()), 'Scheme.cdx')).toBe(true);
    expect(offered).toEqual([]);
  });
});
