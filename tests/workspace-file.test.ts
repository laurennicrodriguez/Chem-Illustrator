// @vitest-environment jsdom
//
// Workspaces: the list file, its paths, and saving and opening every tab together.

import { describe, it, expect, vi } from 'vitest';

// a pretend disk for the desktop app's file commands
const disk = new Map<string, Uint8Array>();
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => false,
  invoke: async (cmd: string, args: unknown, opts?: { headers: Record<string, string> }) => {
    const a = args as Record<string, string>;
    if (cmd === 'write_text_file') { disk.set(a.path, new TextEncoder().encode(a.contents)); return; }
    if (cmd === 'write_binary_file') { disk.set(decodeURIComponent(opts!.headers.path), args as Uint8Array); return; }
    if (cmd === 'read_binary_file') {
      const b = disk.get(a.path);
      if (!b) throw new Error('not found');
      return b.slice().buffer;
    }
    if (cmd === 'path_exists') return disk.has(a.path);
    throw new Error('unexpected ' + cmd);
  },
}));

import { Doc } from '../src/model';
import { Workspace, type WorkspaceHooks } from '../src/workspace';
import { writeCdxml } from '../src/io/cdxml-write';
import { workspaceText, parseWorkspace, relativeTo, resolveIn, folderOf, freeName, safeFileName } from '../src/io/workspace-file';

const measure = (t: string, s: number) => t.length * s * 0.5;

function workspace() {
  const host = new Doc();
  const flashes: string[] = [];
  const hooks: WorkspaceHooks = {
    leave: () => {}, enter: () => {}, changed: () => {}, flash: (m) => flashes.push(m),
    pptx: { async picture() { return null; }, async svgToPng() { return new Uint8Array(4); } },
    measure,
    sheets: { read: async () => { throw new Error('no sheets here'); }, write: async () => '' },
    documents: { read: async () => { throw new Error('no documents here'); }, write: async () => new Uint8Array() },
  };
  return { host, ws: new Workspace(host, hooks), flashes };
}

function drawingBytes(): Uint8Array {
  const d = new Doc();
  d.bulk(() => { const a = d.addAtom(0, 0, 6), b = d.addAtom(14, 8, 8); d.addBond(a.id, b.id, 1); });
  return new TextEncoder().encode(writeCdxml(d, { name: 'x.cdxml', textMeasure: measure }));
}

describe('workspace files', () => {
  it('lists files in its own folder by name, and others by full path', () => {
    expect(relativeTo('C:\\Work\\Project', 'C:\\Work\\Project\\Scheme 1.cdxml')).toBe('Scheme 1.cdxml');
    expect(relativeTo('C:\\Work\\Project', 'c:\\work\\project\\figs\\Fig 2.cdxml')).toBe('figs/Fig 2.cdxml');
    expect(relativeTo('C:\\Work\\Project', 'C:\\Work\\Other\\a.cdxml')).toBe('C:\\Work\\Other\\a.cdxml');
    expect(relativeTo('/home/n/ws', '/home/n/wsx/a.cdxml')).toBe('/home/n/wsx/a.cdxml');
    expect(resolveIn('C:\\Work\\Project', 'figs/Fig 2.cdxml')).toBe('C:\\Work\\Project\\figs\\Fig 2.cdxml');
    expect(resolveIn('/home/n/ws', '/data/a.cdxml')).toBe('/data/a.cdxml');
    expect(folderOf('C:\\Work\\a.ciworkspace')).toBe('C:\\Work');
    expect(folderOf('/a.ciworkspace')).toBe('/');
  });

  it('picks file names that are free and allowed', () => {
    expect(freeName('Untitled.cdxml', ['untitled.CDXML', 'Untitled (2).cdxml'])).toBe('Untitled (3).cdxml');
    expect(freeName('Deck.pptx', [])).toBe('Deck.pptx');
    expect(safeFileName('Route: A/B?.cdxml')).toBe('Route- A-B-.cdxml');
  });

  it('reads back what it writes, and drops what makes no sense', () => {
    const w = { tabs: [{ file: 'a.cdxml' }, { file: 'b.docx', beside: 0 }], active: 1 };
    expect(parseWorkspace(workspaceText(w))).toEqual(w);
    const odd = parseWorkspace(JSON.stringify({ kind: 'workspace', tabs: [{ file: 'a.cdxml', beside: 7 }, { nope: 1 }], active: 9 }));
    expect(odd).toEqual({ tabs: [{ file: 'a.cdxml' }], active: 0 });
    expect(() => parseWorkspace('{"hotkeys": {}}')).toThrow();
  });
});

describe('saving and opening a workspace', () => {
  it('saves new tabs and copies into the folder, and opens them all again in order', async () => {
    disk.clear();
    disk.set('/home/n/other/Scheme.cdxml', drawingBytes());
    disk.set('/home/n/ws/Drawing 1.cdxml', new Uint8Array([1])); // already there: not written over
    const { host, ws } = workspace();
    host.edit('Atom', () => host.addAtom(10, 10, 7));
    ws.noteChange();
    expect(await ws.openBytes(disk.get('/home/n/other/Scheme.cdxml')!, 'Scheme.cdxml', { kind: 'path', path: '/home/n/other/Scheme.cdxml' })).toBe(true);
    expect(ws.tabs.map((t) => t.name)).toEqual(['Drawing 1.cdxml', 'Scheme.cdxml']);

    expect(await ws.saveWorkspace('/home/n/ws/Project.ciworkspace', { copyIn: true, saveChanges: true })).toBe(true);
    expect(disk.get('/home/n/ws/Drawing 1.cdxml')).toEqual(new Uint8Array([1]));
    expect(disk.has('/home/n/ws/Drawing 1 (2).cdxml')).toBe(true);
    expect(disk.has('/home/n/ws/Scheme.cdxml')).toBe(true);
    const list = parseWorkspace(new TextDecoder().decode(disk.get('/home/n/ws/Project.ciworkspace')));
    expect(list.tabs.map((t) => t.file)).toEqual(['Drawing 1 (2).cdxml', 'Scheme.cdxml']);
    expect(list.active).toBe(1);
    expect(ws.tabs.every((t) => !t.dirty && t.ref.kind === 'path')).toBe(true);

    const again = workspace();
    await again.ws.openWorkspace(new TextDecoder().decode(disk.get('/home/n/ws/Project.ciworkspace')), '/home/n/ws/Project.ciworkspace');
    expect(again.ws.tabs.map((t) => t.name)).toEqual(['Drawing 1 (2).cdxml', 'Scheme.cdxml']);
    expect(again.ws.active.name).toBe('Scheme.cdxml');
    expect(again.ws.workspacePath).toBe('/home/n/ws/Project.ciworkspace');
  });

  it('leaves files in other folders where they are when asked to', async () => {
    disk.clear();
    disk.set('/data/Scheme.cdxml', drawingBytes());
    const { ws } = workspace();
    await ws.openBytes(disk.get('/data/Scheme.cdxml')!, 'Scheme.cdxml', { kind: 'path', path: '/data/Scheme.cdxml' });
    await ws.saveWorkspace('/home/n/ws/P.ciworkspace', { copyIn: false, saveChanges: true });
    expect(disk.has('/home/n/ws/Scheme.cdxml')).toBe(false);
    expect(parseWorkspace(new TextDecoder().decode(disk.get('/home/n/ws/P.ciworkspace'))).tabs).toEqual([{ file: '/data/Scheme.cdxml' }]);
  });

  it('opens what it can find and names what it can’t', async () => {
    disk.clear();
    disk.set('/home/n/ws/a.cdxml', drawingBytes());
    const { ws, flashes } = workspace();
    await ws.openWorkspace(workspaceText({ tabs: [{ file: 'a.cdxml' }, { file: 'gone.cdxml' }], active: 1 }), '/home/n/ws/P.ciworkspace');
    expect(ws.tabs.map((t) => t.name)).toEqual(['a.cdxml']);
    expect(flashes.at(-1)).toContain('Not found: gone.cdxml');
  });
});
