// The right-click menu's list: lines and groups tidied so it never shows a line at either end,
// two lines together, or a group with nothing in it.

import { describe, it, expect } from 'vitest';
import { tidyItems, type MenuItem } from '../src/ui/context-menu';

describe('right-click menu items', () => {
  it('drops doubled lines, lines at the ends and empty groups', () => {
    const items: MenuItem[] = [null, { cmd: 'cut' }, null, null, { label: 'Order', items: [null] }, null, { cmd: 'copy' }, null];
    expect(tidyItems(items)).toEqual([{ cmd: 'cut' }, null, { cmd: 'copy' }]);
  });
  it('tidies inside groups too', () => {
    expect(tidyItems([{ label: 'Align', items: [{ cmd: 'a' }, null, null, { cmd: 'b' }, null] }]))
      .toEqual([{ label: 'Align', items: [{ cmd: 'a' }, null, { cmd: 'b' }] }]);
  });
});
