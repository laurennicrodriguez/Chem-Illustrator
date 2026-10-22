// Slide Show > Set Up Show, and custom shows: how the show runs (full screen with a speaker, in a
// window for one person to read, or at a kiosk going round by itself), which slides it plays
// (all, a run of them, or a custom show), whether it goes on by itself after each slide's
// rehearsed time, loops, plays narrations and animations. A custom show is a named list of the
// deck's slides, in any order, played as a show of its own.
//
// Both are saved where PowerPoint keeps them: the show settings in presProps.xml (p:showPr) and
// custom shows in presentation.xml (p:custShowLst), naming the slides by their relationships.

export type ShowType = 'speaker' | 'window' | 'kiosk';

export interface ShowSetup {
  /** Presented by a speaker (full screen), browsed by an individual (in a window), or browsed at a kiosk (full screen, round and round). */
  type: ShowType;
  /** Go back to the start after the last slide, until Esc (always so at a kiosk). */
  loop?: boolean;
  /** Recorded narrations are not played. */
  noNarration?: boolean;
  /** Animations are not played: each slide comes in with everything on it. */
  noAnimation?: boolean;
  /** Clicks only go on (Advance slides: Manually); else each slide's rehearsed time does too. */
  manual?: boolean;
  /** The slides it plays: from slide `from` to slide `to` (counted from 1), or the custom show `custom`. All when none is given. */
  from?: number;
  to?: number;
  custom?: number;
}

export interface CustomShow { id: number; name: string; /** The deck's slides, by their ids, in the order shown. */ slides: number[] }

export const defaultShow = (): ShowSetup => ({ type: 'speaker' });

export const SHOW_TYPES: { id: ShowType; name: string; tip: string }[] = [
  { id: 'speaker', name: 'Presented by a speaker (full screen)', tip: 'The usual slide show: full screen, a click or key goes on' },
  { id: 'window', name: 'Browsed by an individual (window)', tip: 'In a window with Back and Next buttons, for someone reading the slides by themselves' },
  { id: 'kiosk', name: 'Browsed at a kiosk (full screen)', tip: 'Full screen, going on by itself after each slide\'s time and round again, until Esc. Clicks only follow links and action buttons' },
];

/** The slides a show plays, in order (by their place in the deck), leaving out hidden ones; null: every slide not hidden. */
export function showOrder(slides: { id: number; hidden?: boolean }[], setup: ShowSetup, shows: CustomShow[], custom = setup.custom): number[] | null {
  if (custom !== undefined) {
    const cs = shows.find((s) => s.id === custom);
    if (cs) return cs.slides.map((id) => slides.findIndex((s) => s.id === id)).filter((i) => i >= 0);
  }
  if (setup.from === undefined && setup.to === undefined) return null;
  const from = Math.max(1, setup.from ?? 1), to = Math.min(slides.length, setup.to ?? slides.length);
  const out: number[] = [];
  for (let i = from - 1; i < to; i++) if (!slides[i]?.hidden) out.push(i);
  return out;
}

/** The show settings as PowerPoint's p:showPr (empty when they are all as a new deck has them). */
export function showPrXml(setup: ShowSetup | undefined, shows: CustomShow[]): string {
  const s = setup ?? defaultShow();
  const custom = s.custom !== undefined && shows.some((c) => c.id === s.custom) ? s.custom : undefined;
  const plain = s.type === 'speaker' && !s.loop && !s.noNarration && !s.noAnimation && !s.manual && custom === undefined && s.from === undefined && s.to === undefined;
  if (plain) return '';
  const attrs = `${s.loop || s.type === 'kiosk' ? ' loop="1"' : ''}${s.noNarration ? ' showNarration="0"' : ' showNarration="1"'}${s.noAnimation ? ' showAnimation="0"' : ''}${s.manual ? ' useTimings="0"' : ''}`;
  const kind = s.type === 'kiosk' ? '<p:kiosk/>' : s.type === 'window' ? '<p:browse/>' : '<p:present/>';
  const which = custom !== undefined ? `<p:custShow id="${custom}"/>` : s.from !== undefined || s.to !== undefined ? `<p:sldRg st="${s.from ?? 1}" end="${s.to ?? 9999}"/>` : '<p:sldAll/>';
  return `<p:showPr${attrs}>${kind}${which}</p:showPr>`;
}

/** Custom shows as PowerPoint's p:custShowLst; `rel` gives each slide's relationship id in presentation.xml (by its id). */
export function custShowsXml(shows: CustomShow[], rel: (slideId: number) => string | undefined, esc: (s: string) => string): string {
  const list = shows.map((c) => {
    const rids = c.slides.map(rel).filter((r): r is string => !!r);
    return `<p:custShow name="${esc(c.name)}" id="${c.id}"><p:sldLst>${rids.map((r) => `<p:sld r:id="${r}"/>`).join('')}</p:sldLst></p:custShow>`;
  });
  return list.length ? `<p:custShowLst>${list.join('')}</p:custShowLst>` : '';
}

const kidsOf = (el: Element | null | undefined, name: string) => (el ? Array.from(el.children).filter((c) => c.localName === name) : []);
const yes = (v: string | null, dflt: boolean) => (v === null ? dflt : /^(1|true)$/.test(v));

/** The show settings from PowerPoint's presProps.xml root (p:presentationPr). */
export function readShowPr(root: Element | null): ShowSetup | undefined {
  const pr = kidsOf(root, 'showPr')[0];
  if (!pr) return undefined;
  const type: ShowType = kidsOf(pr, 'kiosk').length ? 'kiosk' : kidsOf(pr, 'browse').length ? 'window' : 'speaker';
  const out: ShowSetup = { type };
  if (yes(pr.getAttribute('loop'), false) && type !== 'kiosk') out.loop = true;
  if (!yes(pr.getAttribute('showNarration'), true)) out.noNarration = true;
  if (!yes(pr.getAttribute('showAnimation'), true)) out.noAnimation = true;
  if (!yes(pr.getAttribute('useTimings'), true)) out.manual = true;
  const rg = kidsOf(pr, 'sldRg')[0];
  if (rg) {
    const st = Number(rg.getAttribute('st')), end = Number(rg.getAttribute('end'));
    if (Number.isFinite(st)) out.from = st;
    if (Number.isFinite(end) && end < 9999) out.to = end;
  }
  const cs = kidsOf(pr, 'custShow')[0];
  if (cs && Number.isFinite(Number(cs.getAttribute('id')))) out.custom = Number(cs.getAttribute('id'));
  return out;
}

/** Custom shows from presentation.xml's root; `slideOf` gives a relationship id's slide (its place in the deck), or -1. */
export function readCustShows(root: Element, slideOf: (rid: string) => number, rAttr: (el: Element) => string | null): { id: number; name: string; slides: number[] }[] {
  return kidsOf(kidsOf(root, 'custShowLst')[0], 'custShow').map((c, k) => ({
    id: Number.isFinite(Number(c.getAttribute('id'))) ? Number(c.getAttribute('id')) : k,
    name: c.getAttribute('name') ?? `Custom Show ${k + 1}`,
    // (places in the deck here: the deck turns them into its slides' ids)
    slides: kidsOf(kidsOf(c, 'sldLst')[0], 'sld').map((s) => slideOf(rAttr(s) ?? '')).filter((i) => i >= 0),
  }));
}
