// Design templates for slide decks (Design > Templates): calm, flat colour schemes, mostly greys
// and blues with a few brighter ones, each with a pair of fonts that come with the app and a
// simple shape behind every slide. Content slides always have a light background, so structures
// (drawn in black) read well; a few templates give the title slide a dark background of its own.
//
// A template changes only the look: fonts, colours, background and shapes. The logo, footer,
// slide numbers and the drawing style of structures stay as they are, and every value can be
// changed afterwards in Slide > Slide Master.

import type { Master, Decor } from './deck';

export interface SlideTemplate {
  id: string;
  name: string;
  group: 'Light' | 'Dark title slide' | 'Bright';
  background: string;
  titleFont: string;
  bodyFont: string;
  titleColor: string;
  textColor: string;
  footerColor: string;
  accent: string;
  accent2: string;
  decor: Decor;
  titleBold?: boolean;
  titleSlide?: Master['titleSlide'];
}

const T = (id: string, name: string, group: SlideTemplate['group'], t: Omit<SlideTemplate, 'id' | 'name' | 'group'>): SlideTemplate => ({ id, name, group, ...t });

export const SLIDE_TEMPLATES: SlideTemplate[] = [
  // ---------------- light: greys and blues
  T('plain', 'Plain', 'Light', { background: '#ffffff', titleFont: 'Arial', bodyFont: 'Arial', titleColor: '#000000', textColor: '#000000', footerColor: '#7f7f7f', accent: '#2f6fdf', accent2: '#9aa5b1', decor: 'none' }),
  T('slate-rule', 'Slate Rule', 'Light', { background: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter', titleColor: '#1f2a37', textColor: '#374151', footerColor: '#8a94a3', accent: '#3b5b7d', accent2: '#c7d0da', decor: 'title-rule' }),
  T('harbor', 'Harbor', 'Light', { background: '#ffffff', titleFont: 'Source Sans 3', bodyFont: 'Source Sans 3', titleColor: '#1d3a5f', textColor: '#2b3440', footerColor: '#7d8896', accent: '#2f5d8a', accent2: '#a9bfd6', decor: 'top-bar' }),
  T('steel-band', 'Steel Band', 'Light', { background: '#ffffff', titleFont: 'IBM Plex Sans', bodyFont: 'IBM Plex Sans', titleColor: '#ffffff', textColor: '#2a3038', footerColor: '#7f8893', accent: '#3d4f63', accent2: '#aab6c3', decor: 'title-band' }),
  T('mist', 'Mist', 'Light', { background: '#f4f6f8', titleFont: 'Lato', bodyFont: 'Lato', titleColor: '#24313f', textColor: '#34404d', footerColor: '#8592a0', accent: '#6b8096', accent2: '#c5cfda', decor: 'left-strip' }),
  T('graphite-frame', 'Graphite Frame', 'Light', { background: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter', titleColor: '#25282d', textColor: '#3a3e45', footerColor: '#8b9098', accent: '#4a4f57', accent2: '#c4c8ce', decor: 'frame' }),
  T('navy-footer', 'Navy Footer', 'Light', { background: '#ffffff', titleFont: 'Source Sans 3', bodyFont: 'Source Sans 3', titleColor: '#1f3552', textColor: '#2c3542', footerColor: '#ffffff', accent: '#1f3552', accent2: '#8fa4bf', decor: 'footer-band' }),
  T('paper-serif', 'Paper', 'Light', { background: '#fbfaf7', titleFont: 'Source Serif 4', bodyFont: 'Source Sans 3', titleColor: '#2e2a24', textColor: '#3d3830', footerColor: '#958c7e', accent: '#7a6a55', accent2: '#d6cdbf', decor: 'title-rule', titleBold: false }),
  T('notebook', 'Lab Notebook', 'Light', { background: '#fdfdfb', titleFont: 'IBM Plex Sans', bodyFont: 'IBM Plex Sans', titleColor: '#1f3f47', textColor: '#2e3a3d', footerColor: '#7f9196', accent: '#2d6a7a', accent2: '#a8c8cf', decor: 'left-strip' }),
  T('sage', 'Sage', 'Light', { background: '#f6f8f5', titleFont: 'Lato', bodyFont: 'Lato', titleColor: '#2f3d31', textColor: '#3a443b', footerColor: '#869084', accent: '#5f7a63', accent2: '#c3d1c4', decor: 'top-bar' }),
  T('fog-corner', 'Fog Corner', 'Light', { background: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter', titleColor: '#2b3746', textColor: '#3b4655', footerColor: '#8d97a4', accent: '#8a9bb0', accent2: '#d5dce5', decor: 'corner' }),
  T('academic', 'Academic', 'Light', { background: '#ffffff', titleFont: 'Merriweather', bodyFont: 'Source Sans 3', titleColor: '#2a1f22', textColor: '#33302f', footerColor: '#8f8786', accent: '#7a1f2b', accent2: '#d9b8bc', decor: 'title-rule' }),
  // ---------------- dark title slide, light content slides
  T('midnight', 'Midnight', 'Dark title slide', { background: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter', titleColor: '#0f1b2d', textColor: '#2a3442', footerColor: '#8a94a3', accent: '#4c8bf5', accent2: '#1d2c44', decor: 'top-bar',
    titleSlide: { background: '#0f1b2d', titleColor: '#ffffff', textColor: '#c9d4e3' } }),
  T('charcoal', 'Charcoal', 'Dark title slide', { background: '#ffffff', titleFont: 'IBM Plex Sans', bodyFont: 'IBM Plex Sans', titleColor: '#23272e', textColor: '#353a42', footerColor: '#8b9098', accent: '#6c7a89', accent2: '#3a414b', decor: 'title-rule',
    titleSlide: { background: '#23272e', titleColor: '#f2f4f7', textColor: '#c3c9d1' } }),
  T('deep-blue', 'Deep Blue', 'Dark title slide', { background: '#ffffff', titleFont: 'Source Sans 3', bodyFont: 'Source Sans 3', titleColor: '#1d3557', textColor: '#2b3545', footerColor: '#7f8a99', accent: '#1d3557', accent2: '#7d9cc0', decor: 'left-strip',
    titleSlide: { background: '#1d3557', titleColor: '#ffffff', textColor: '#cfdced' } }),
  T('slate-dark', 'Slate', 'Dark title slide', { background: '#f7f8fa', titleFont: 'Lato', bodyFont: 'Lato', titleColor: '#2f3a45', textColor: '#38424d', footerColor: '#8a939d', accent: '#8fb3c9', accent2: '#2f3a45', decor: 'corner',
    titleSlide: { background: '#2f3a45', titleColor: '#ffffff', textColor: '#cdd6df' } }),
  // ---------------- brighter
  T('navy-orange', 'Navy and Orange', 'Bright', { background: '#ffffff', titleFont: 'Montserrat', bodyFont: 'Source Sans 3', titleColor: '#0c2340', textColor: '#26303d', footerColor: '#7f8996', accent: '#e87722', accent2: '#0c2340', decor: 'top-bar' }),
  T('teal', 'Teal', 'Bright', { background: '#ffffff', titleFont: 'Montserrat', bodyFont: 'Lato', titleColor: '#ffffff', textColor: '#25363a', footerColor: '#7b8d90', accent: '#0f8b80', accent2: '#9fd6cf', decor: 'title-band' }),
  T('coral', 'Coral', 'Bright', { background: '#ffffff', titleFont: 'Montserrat', bodyFont: 'Lato', titleColor: '#3a2622', textColor: '#3a3332', footerColor: '#958a88', accent: '#e4572e', accent2: '#f5c3b3', decor: 'left-strip' }),
  T('violet', 'Violet', 'Bright', { background: '#ffffff', titleFont: 'Inter', bodyFont: 'Inter', titleColor: '#2d2147', textColor: '#353042', footerColor: '#8e889c', accent: '#6c4ab6', accent2: '#cfc2ee', decor: 'title-rule' }),
  T('sunrise', 'Sunrise', 'Bright', { background: '#fffaf2', titleFont: 'Lato', bodyFont: 'Lato', titleColor: '#3b2a1a', textColor: '#3d342b', footerColor: '#9a8d7e', accent: '#f2a541', accent2: '#f2545b', decor: 'corner' }),
];

/** The master with a template's look: its fonts, colours, background and shapes; everything else is kept. */
export function applyTemplate(m: Master, t: SlideTemplate): Master {
  return {
    ...m,
    background: t.background, titleFont: t.titleFont, bodyFont: t.bodyFont,
    titleColor: t.titleColor, textColor: t.textColor, footerColor: t.footerColor,
    accent: t.accent, accent2: t.accent2, decor: t.decor,
    titleBold: t.titleBold ?? true,
    titleSlide: t.titleSlide ? { ...t.titleSlide } : undefined,
    template: t.name,
  };
}
