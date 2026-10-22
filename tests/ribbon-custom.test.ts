// View > Customize the Ribbon: tabs and groups in your order, moved, renamed or hidden, and groups of your own.

import { describe, expect, it } from 'vitest';
import { groupKey, groupLayout, parseRibbons, tabOrder, type RibbonPlan } from '../src/ui/ribbon-custom';

const plan: RibbonPlan = { tabs: [
  { key: 'home', groups: ['g:clipboard', 'g:font', 'g:paragraph'] },
  { key: 'insert', groups: ['g:tables', 'g:pictures'] },
  { key: 'view', groups: ['g:zoom'] },
] };

describe('customizing the ribbon', () => {
  it('names groups after their labels, uniquely', () => {
    const taken = new Set<string>();
    expect(groupKey('Pictures, Text and Shapes', taken)).toBe('g:pictures-text-and-shapes');
    expect(groupKey('Slides', taken)).toBe('g:slides');
    expect(groupKey('Slides', taken)).toBe('g:slides-2');
    expect(groupKey('…', taken)).toBe('g:group');
  });

  it('puts the tabs in your order, the rest after as they come', () => {
    expect(tabOrder(plan)).toEqual(['home', 'insert', 'view']);
    expect(tabOrder(plan, { tabs: ['view', 'gone'] })).toEqual(['view', 'home', 'insert']);
  });

  it('lays groups out where you put them, the rest where they come', () => {
    expect(groupLayout(plan)).toEqual({ home: ['g:clipboard', 'g:font', 'g:paragraph'], insert: ['g:tables', 'g:pictures'], view: ['g:zoom'] });
    // reordered in Home, Zoom moved to Insert's front, a group of your own in View
    const p = { groups: { home: ['g:paragraph', 'g:clipboard'], insert: ['g:zoom'], view: ['own:abc', 'g:nonsense'] }, own: { abc: { title: 'Mine', items: [] } } };
    expect(groupLayout(plan, p)).toEqual({ home: ['g:paragraph', 'g:clipboard', 'g:font'], insert: ['g:zoom', 'g:tables', 'g:pictures'], view: ['own:abc'] });
    // a group of your own not placed anywhere goes at the end of the first tab
    expect(groupLayout(plan, { own: { x1: { title: 'X', items: [] } } }).home.at(-1)).toBe('own:x1');
  });

  it('reads saved ribbons, keeping only what makes sense', () => {
    const r = parseRibbons({
      slides: {
        tabs: ['insert', 'home', 7, '<b>'], hiddenTabs: ['view'], tabNames: { home: '  Start ', bad: 3 },
        groups: { home: ['g:font', 'own:abc', 'g:font', 'rm -rf'], insert: ['g:font', 'g:tables'] },
        hiddenGroups: ['g:zoom'], groupNames: { 'g:font': 'Letters' },
        own: { abc: { title: 'Mine', items: ['cmd:clean-up', 'sh:paste', 'evil:<x>'] }, 'BAD ID': { title: 'x', items: [] } },
      },
      nonsense: { tabs: ['a'] },
      sheet: 'no',
    });
    expect(Object.keys(r)).toEqual(['slides']);
    expect(r.slides).toEqual({
      tabs: ['insert', 'home'], hiddenTabs: ['view'], tabNames: { home: 'Start' },
      // a group is in one tab only
      groups: { home: ['g:font', 'own:abc'], insert: ['g:tables'] },
      hiddenGroups: ['g:zoom'], groupNames: { 'g:font': 'Letters' },
      own: { abc: { title: 'Mine', items: ['cmd:clean-up', 'sh:paste'] } },
    });
    expect(parseRibbons(null)).toEqual({});
  });
});
