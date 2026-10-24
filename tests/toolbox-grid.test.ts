// Toolboxes on grids of fixed cells (Customize Toolboxes): laying out the old lists, resizing,
// putting buttons in cells, turning and wrapping on screen, and reading the settings.
import { describe, expect, it } from 'vitest';
import { added, cutOff, emptied, inBlock, listToGrid, nextFree, parseGrid, placed, resized, shownGrid, withLine, withoutGone, wrapped, wrapStarts } from '../src/ui/toolbox-grid';
import { boxGrid, defaultToolboxes, flyGrid, overflowOf, parseToolboxes, withFlyGrid, withFlyout, withGrid, withItemsReset, withNewBox, withoutBox, withoutGoneItems } from '../src/ui/toolboxes';

describe('toolbox grids', () => {
  it('lays a list out as it showed: each group on new rows, with a line above it', () => {
    const g = listToGrid(['tool:a', 'tool:b', 'sep', 'tool:c', 'tool:d', 'tool:e', 'sep', 'tool:f'], 2);
    expect(g.cols).toBe(2);
    expect(g.rows).toBe(4);
    expect(g.cells).toEqual(['tool:a', 'tool:b', 'tool:c', 'tool:d', 'tool:e', null, 'tool:f', null]);
    expect(g.lines).toEqual([1, 3]);
    // unset width: as wide as the longest group, one group a row
    const w = listToGrid(['cmd:a', 'cmd:b', 'cmd:c', 'sep', 'cmd:d']);
    expect([w.cols, w.rows]).toEqual([3, 2]);
    expect(w.cells).toEqual(['cmd:a', 'cmd:b', 'cmd:c', 'cmd:d', null, null]);
  });

  it('keeps buttons in their cells when resized, and says which a smaller grid cuts off', () => {
    const g = listToGrid(['tool:a', 'tool:b', 'tool:c', 'tool:d', 'tool:e', 'tool:f'], 3);
    expect(cutOff(g, 2, 2)).toEqual(['tool:c', 'tool:f']);
    expect(cutOff(g, 3, 5)).toEqual([]);
    const big = resized(g, 4, 3);
    expect(big.cells).toEqual(['tool:a', 'tool:b', 'tool:c', null, 'tool:d', 'tool:e', 'tool:f', null, null, null, null, null]);
    const small = resized(g, 2, 1);
    expect(small.cells).toEqual(['tool:a', 'tool:b']);
  });

  it('moves a button to a cell, swapping, and pushes one aside for a new button', () => {
    const g = { cols: 2, rows: 2, cells: ['a', 'b', null, 'c'] };
    expect(placed(g, 'c', 0)!.cells).toEqual(['c', 'b', null, 'a']);
    expect(placed(g, 'c', 2)!.cells).toEqual(['a', 'b', 'c', null]);
    // a new one into a taken cell: what was there goes to the next empty cell
    expect(placed(g, 'd', 1)!.cells).toEqual(['a', 'd', 'b', 'c']);
    expect(placed({ cols: 1, rows: 1, cells: ['a'] }, 'b', 0)).toBeNull();
    expect(nextFree(['a', null, 'b', null], 2)).toBe(3);
    expect(emptied(g, 0).cells).toEqual([null, 'b', null, 'c']);
  });

  it('adds a button in the first empty cell, or in a new row when the grid is full', () => {
    const g = { cols: 2, rows: 1, cells: ['a', 'b'] };
    const n = added(g, 'c');
    expect([n.cols, n.rows]).toEqual([2, 2]);
    expect(n.cells).toEqual(['a', 'b', 'c', null]);
    expect(added(n, 'a')).toBe(n);
  });

  it('puts lines between rows, never above the first', () => {
    let g = { cols: 2, rows: 3, cells: Array(6).fill(null) };
    g = withLine(g, 2, true);
    g = withLine(g, 0, true);
    expect(g.lines).toEqual([2]);
    expect(withLine(g, 2, false).lines).toBeUndefined();
  });

  it('turns a tall grid on its side along the top or bottom, and a wide one down a side', () => {
    const tall = listToGrid(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `tool:${x}`), 2);
    expect(shownGrid(tall, 'left').turned).toBe(false);
    expect(shownGrid(tall, 'float').turned).toBe(false);
    const top = shownGrid(tall, 'top');
    expect([top.turned, top.cols, top.rows]).toEqual([true, 3, 2]);
    // tool:c (row 1, column 0) shows in row 0, column 1
    expect(top.at[2]).toEqual({ r: 0, c: 1 });
    const wide = { cols: 5, rows: 2, cells: Array(10).fill(null), lines: [1] };
    const left = shownGrid(wide, 'right');
    expect([left.turned, left.cols, left.rows, left.lineCols, left.lineRows]).toEqual([true, 2, 5, [1], []]);
  });

  it('wraps rows into more columns, or columns into more rows, when there is no room', () => {
    const g = listToGrid(['a', 'b', 'c', 'd', 'e', 'f'].map((x) => `tool:${x}`), 2);
    const s = shownGrid(g, 'left');
    const w = wrapped(s, 2, false).at;
    // rows 0-1 stay; row 2 goes beside them, starting a block
    expect(w[4]).toEqual({ r: 0, c: 2, start: true });
    expect(w[5]).toEqual({ r: 0, c: 3, start: false });
    expect(w[3]).toEqual({ r: 1, c: 1, start: false });
    const t = shownGrid(g, 'top');
    const a = wrapped(t, 2, true).at;
    // column 2 (tool:e, tool:f) goes below the first two
    expect(a[4]).toEqual({ r: 2, c: 0, start: true });
    expect(a[5]).toEqual({ r: 3, c: 0, start: false });
  });

  it('wraps between groups where it can, so groups stay whole', () => {
    // groups start at rows 0, 1, 8, 11 and 15 of 23; room for 22
    expect(wrapStarts(23, 22, [1, 8, 11, 15])).toEqual([0, 15]);
    // room for 10: break before row 8, then before 15, then where the room ends
    expect(wrapStarts(23, 10, [1, 8, 11, 15])).toEqual([0, 8, 15]);
    // a group longer than the room is cut where the room ends
    expect(wrapStarts(9, 4)).toEqual([0, 4, 8]);
    expect(inBlock([0, 8, 15], 9)).toEqual({ b: 1, i: 1 });
  });

  it('reads grids from the settings, dropping what makes no sense', () => {
    const g = parseGrid({ cols: 2, rows: 2, cells: ['tool:a', 'tool:a', 'bad item', 7, 'tool:b'], lines: [0, 1, 1, 9] }, (k) => /^tool:\w+$/.test(k));
    expect(g).toEqual({ cols: 2, rows: 2, cells: ['tool:a', null, null, null], lines: [1] });
    expect(parseGrid({ cols: 999, rows: 0, cells: [] }, () => true)).toMatchObject({ cols: 20, rows: 1 });
    expect(parseGrid('nope', () => true)).toBeNull();
  });
});

describe('toolbox grids in the settings', () => {
  it('lays out the boxes as they come, until changed', () => {
    const st = defaultToolboxes();
    const main = boxGrid(st, 'main', ['tool:select', 'tool:eraser', 'sep', 'tool:bond-single']);
    expect([main.cols, main.rows, main.lines]).toEqual([2, 2, [1]]);
    const changed = withGrid(st, 'main', { cols: 3, rows: 1, cells: ['tool:select', null, 'tool:eraser'] });
    expect(boxGrid(changed, 'main', ['tool:select']).cells).toEqual(['tool:select', null, 'tool:eraser']);
    // Reset brings back the toolbox as it comes
    expect(withItemsReset(changed, 'main').grids?.main).toBeUndefined();
    // a new toolbox of your own starts as an empty 4 × 3, and its grid goes with it
    const { state, id } = withNewBox(st, 'Mine');
    const own = boxGrid(state, id);
    expect([own.cols, own.rows, own.cells.every((c) => c === null)]).toEqual([4, 3, true]);
    expect(withoutBox(withGrid(state, id, own), id).grids?.[id]).toBeUndefined();
  });

  it('keeps fly-out grids, and older lists of fly-out tools still lay out', () => {
    const st = withFlyout(defaultToolboxes(), 'arrows', ['arrow', 'arrow-eq', 'arrow-retro']);
    expect(flyGrid(st, 'arrows', st.flyouts!.arrows, 2).cells).toEqual(['arrow', 'arrow-eq', 'arrow-retro', null]);
    const n = withFlyGrid(st, 'arrows', { cols: 1, rows: 3, cells: ['arrow-retro', null, 'arrow'] });
    expect(n.flyouts?.arrows).toBeUndefined();
    expect(flyGrid(n, 'arrows', [], 2).cells).toEqual(['arrow-retro', null, 'arrow']);
    expect(withFlyGrid(n, 'arrows', null).flyGrids?.arrows).toBeUndefined();
  });

  it('exports and imports grids, fly-out grids and scroll or wrap', () => {
    let st = withGrid(defaultToolboxes(), 'structure', { cols: 2, rows: 2, cells: ['cmd:clean-up', null, null, 'cmd:add-frame'], lines: [1] });
    st = withFlyGrid(st, 'arrows', { cols: 2, rows: 1, cells: [null, 'arrow'] });
    st = { ...st, overflow: { structure: 'wrap', main: 'scroll' } };
    const back = parseToolboxes(JSON.parse(JSON.stringify(st)));
    expect(back.grids).toEqual(st.grids);
    expect(back.flyGrids).toEqual(st.flyGrids);
    expect(overflowOf(back, 'structure')).toBe('wrap');
    expect(overflowOf(back, 'main')).toBe('scroll');
    // unset: the drawing tools wrap as they always have, the rest scroll
    expect(overflowOf(defaultToolboxes(), 'main')).toBe('wrap');
    expect(overflowOf(defaultToolboxes(), 'arrange')).toBe('scroll');
    // a grid for a toolbox that isn't there, or can't be laid out, is dropped
    expect(parseToolboxes({ grids: { nowhere: { cols: 1, rows: 1, cells: ['cmd:x'] }, templates: { cols: 1, rows: 1, cells: [] } } }).grids).toBeUndefined();
  });

  it('closes up the cells of palettes and tools the app no longer has, leaving no empty rows', () => {
    // two blocks: a, gone1, b | gone2, gone3, c, gone4 (gone ones: palettes taken off the bar)
    const g = { cols: 2, rows: 5, cells: ['a', 'pal:gone1', 'b', null, 'pal:gone2', 'pal:gone3', 'c', 'pal:gone4', null, null], lines: [2] };
    const out = withoutGone(g, (k) => !k.startsWith('pal:gone'));
    expect(out.cells).toEqual(['a', 'b', 'c', null, null, null]);
    expect([out.rows, out.lines]).toEqual([3, [1]]);
    // nothing gone: the same grid; a gap left on purpose stays
    expect(withoutGone(g, () => true)).toBe(g);
    const gap = withoutGone({ cols: 2, rows: 2, cells: ['a', null, 'x', 'b'] }, (k) => k !== 'x');
    expect(gap.cells).toEqual(['a', null, 'b', null]);
  });

  it('takes retired palettes and templates out of saved toolboxes and fly-outs', () => {
    const st = {
      ...defaultToolboxes(),
      items: { main: ['tool:select', 'pal:tpl-fused', 'sep', 'pal:tpl-rings'] },
      grids: { main: { cols: 2, rows: 2, cells: ['pal:tpl-conformers', 'pal:tpl-fused', 'pal:tpl-bicyclics', 'pal:tpl-own'] } },
      flyouts: { 'tpl-fused': ['tpl-twistane'], 'tpl-conformers': ['tpl-chair', 'tpl-envelope'] },
      flyGrids: { 'tpl-bicyclics': { cols: 1, rows: 1, cells: ['tpl-twistane'] } },
    };
    const pals = new Set(['tpl-rings', 'tpl-conformers', 'tpl-own']);
    const tools = new Set(['select', 'tpl-chair']);
    const item = (k: string) => (k.startsWith('pal:') ? pals.has(k.slice(4)) : k.startsWith('tool:') ? tools.has(k.slice(5)) : true);
    const out = withoutGoneItems(st, item, (p, n) => pals.has(p) && tools.has(n));
    expect(out.items!.main).toEqual(['tool:select', 'sep', 'pal:tpl-rings']);
    expect(out.grids!.main.cells).toEqual(['pal:tpl-conformers', 'pal:tpl-own']);
    // a fly-out of a palette that is gone goes; one that keeps some tools loses the hidden ones
    expect(out.flyouts).toEqual({ 'tpl-conformers': ['tpl-chair'] });
    expect(out.flyGrids).toEqual({});
  });
});
