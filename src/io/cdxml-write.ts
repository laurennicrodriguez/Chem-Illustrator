// Writing ChemDraw CDXML files.
//
// A drawing opened from a CDXML file is saved by editing that file: objects that did not
// change are left exactly as ChemDraw wrote them (including things this program cannot draw
// yet, such as pictures, reaction schemes and atom-number tags), changed objects are rewritten,
// deleted ones are removed and new ones are added. A new drawing is written from scratch in
// the same form ChemDraw uses, so ChemDraw opens both.

import { Doc, Atom, Bond, Caption, Arrow, Shape, TextRun, Entity, Kind } from '../model';
import { SYMBOLS } from '../chem/elements';
import { labelSpec, layoutLabel, labelDir, labelGraph, tokenize, isGenericLabel, Measure, MiniGraph, kekulize } from '../chem/labels';
import { Vec, DEG, arcCenter, norm, sub, Rect } from '../geom';
import { kids, descendants } from './xml';
import { arialWidth } from '../text-metrics';
import { toSymbolPieces, isSymbolFont, faceFromStyle } from '../richtext';
import { atomStereoText, bondStereoText, StereoPlacer, PlacedLabel } from '../chem/stereo';

export interface WriteOptions {
  /** Text width in points; by default Arial's own widths, as ChemDraw uses. */
  measure?: Measure;
  /** File name stored in the document. */
  name?: string;
}

const NEW_PROLOG = '<?xml version="1.0" encoding="UTF-8" ?>\n<!DOCTYPE CDXML SYSTEM "http://www.cambridgesoft.com/xml/cdxml.dtd" >\n';
const CAP = 0.716; // Arial cap height / font size

/** ChemDraw writes coordinates with two decimals. */
const f2 = (n: number): string => (Math.abs(n) < 0.005 ? 0 : n).toFixed(2);
const pt = (p: Vec): string => `${f2(p.x)} ${f2(p.y)}`;
const pt3 = (p: Vec): string => `${f2(p.x)} ${f2(p.y)} 0`;
const box = (r: Rect): string => `${f2(r.x1)} ${f2(r.y1)} ${f2(r.x2)} ${f2(r.y2)}`;

const POSITION_ATTRS = ['p', 'BoundingBox', 'Head3D', 'Tail3D', 'Center3D', 'MajorAxisEnd3D', 'MinorAxisEnd3D'];

export function writeCdxml(doc: Doc, opts: WriteOptions = {}): string {
  return new CdxmlWriter(doc, opts).write();
}

class CdxmlWriter {
  private x!: XMLDocument;
  private root!: Element;
  private page!: Element;
  private all: Element[] = [];
  private prolog = NEW_PROLOG;
  private nextId = 1;
  private colors: string[] = ['#000000', '#ffffff'];
  private colortable!: Element;
  private fonttable!: Element;
  private fontIds = new Map<string, string>();
  private measure: Measure;
  /** Spots for stereo labels and atom numbers (made when first needed). */
  private placerMade: StereoPlacer | null = null;
  /** Fragment element each atom ends up in. */
  private fragOfAtom = new Map<number, Element>();
  /** Neighbours of each atom as read from the file. */
  private origNeighbors = new Map<number, Set<number>>();
  private changed = false;
  /** Older copies of arrows that ChemDraw keeps for old versions, by the arrow they belong to. */
  private legacy: Map<string, Element[]> | null = null;

  constructor(private doc: Doc, private opts: WriteOptions) {
    this.measure = opts.measure ?? arialWidth;
  }

  write(): string {
    const doc = this.doc;
    const src = doc.source;
    if (src) this.openSource();
    else this.newDocument();
    let maxId = src?.maxId ?? 0;
    for (const m of [doc.atoms, doc.bonds, doc.captions, doc.arrows, doc.shapes] as Map<number, Entity>[]) for (const id of m.keys()) if (id > maxId) maxId = id;
    this.nextId = maxId + 1;

    if (src) {
      for (const b of src.orig.values()) {
        if (!('a1' in b)) continue;
        const bond = b as Bond;
        for (const [p, q] of [[bond.a1, bond.a2], [bond.a2, bond.a1]]) {
          let s = this.origNeighbors.get(p);
          if (!s) this.origNeighbors.set(p, (s = new Set()));
          s.add(q);
        }
      }
      this.removeDeleted();
    }
    this.writeStructures();
    for (const c of doc.captions.values()) this.writeCaption(c);
    for (const r of doc.arrows.values()) this.writeArrow(r);
    for (const s of doc.shapes.values()) this.writeShape(s);
    if (src) this.cleanUp();

    // the file name stored inside; an untouched file is not rewritten just for a rename
    if (this.opts.name !== undefined && (this.changed || !src) && this.root.getAttribute('Name') !== this.opts.name) {
      this.root.setAttribute('Name', this.opts.name);
      this.changed = true;
    }
    if (src && !this.changed) return src.text;
    const b = doc.bounds();
    if (b) this.root.setAttribute('BoundingBox', box(b));
    if (!src) this.sizePage(b);
    return this.prolog + new XMLSerializer().serializeToString(this.root) + '\n';
  }

  // ------------------------------------------------------------------ document set-up

  private openSource(): void {
    const text = this.doc.source!.text;
    const start = text.search(/<CDXML[\s>]/);
    this.prolog = start > 0 ? text.slice(0, start) : NEW_PROLOG;
    this.x = new DOMParser().parseFromString(text.replace(/<!DOCTYPE[^>]*>/i, ''), 'application/xml');
    this.root = this.x.documentElement;
    this.all = descendants(this.root);
    this.page = this.child(this.root, 'page') ?? this.root.appendChild(this.el('page', { id: this.id() }));
    this.colortable = this.child(this.root, 'colortable') ?? this.root.insertBefore(this.x.createElement('colortable'), this.root.firstChild);
    for (const c of kids(this.colortable)) this.colors.push(rgbHex(c));
    this.fonttable = this.child(this.root, 'fonttable') ?? this.root.insertBefore(this.x.createElement('fonttable'), this.colortable.nextSibling);
    for (const f of kids(this.fonttable)) {
      const name = (f.getAttribute('name') ?? '').toLowerCase();
      if (!this.fontIds.has(name)) this.fontIds.set(name, f.getAttribute('id') ?? '');
    }
  }

  private newDocument(): void {
    this.x = new DOMParser().parseFromString('<CDXML/>', 'application/xml');
    this.root = this.x.documentElement;
    const st = this.doc.style;
    const attrs: Record<string, string> = {
      CreationProgram: 'Chem Illustrator',
      Name: this.opts.name ?? '',
      LabelFont: '3', LabelSize: String(st.labelSize), LabelFace: '96',
      CaptionFont: '3', CaptionSize: String(st.captionSize), CaptionFace: String(st.captionFace),
      HashSpacing: f2(st.hashSpacing), MarginWidth: f2(st.marginWidth), LineWidth: f2(st.lineWidth),
      BoldWidth: f2(st.boldWidth), BondLength: f2(st.bondLength), BondSpacing: String(st.bondSpacing),
      ChainAngle: String(st.chainAngle), LabelJustification: 'Auto', CaptionJustification: 'Left',
      color: '0', bgcolor: '1',
    };
    for (const [k, v] of Object.entries(attrs)) this.root.setAttribute(k, v);
    this.colortable = this.root.appendChild(this.x.createElement('colortable'));
    this.colorIndex('#ffffff', true);
    this.colorIndex('#000000', true);
    this.fonttable = this.root.appendChild(this.x.createElement('fonttable'));
    this.fonttable.appendChild(this.el('font', { id: '3', charset: 'iso-8859-1', name: 'Arial' }));
    this.fontIds.set('arial', '3');
    this.page = this.root.appendChild(this.el('page', { id: '' }));
    if (this.doc.background !== '#ffffff') this.root.setAttribute('bgcolor', String(this.colorIndex(this.doc.background, true)));
    this.changed = true;
  }

  /** Grow a new document's page to hold the drawing (ChemDraw's US Letter page is 540 × 720 pt). */
  private sizePage(b: Rect | null): void {
    const W = 540, H = 720;
    const wp = Math.max(1, Math.ceil(((b?.x2 ?? 0) + 36) / W)), hp = Math.max(1, Math.ceil(((b?.y2 ?? 0) + 36) / H));
    this.page.setAttribute('id', this.id());
    for (const [k, v] of Object.entries({ BoundingBox: `0 0 ${f2(W * wp)} ${f2(H * hp)}`, HeaderPosition: '36', FooterPosition: '36', PrintTrimMarks: 'yes', HeightPages: String(hp), WidthPages: String(wp) })) this.page.setAttribute(k, v);
  }

  // ------------------------------------------------------------------ small helpers

  private id(): string {
    return String(this.nextId++);
  }

  private el(name: string, attrs: Record<string, string | number | null | undefined> = {}): Element {
    const e = this.x.createElement(name);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined && v !== '') e.setAttribute(k, String(v));
    return e;
  }

  private child(e: Element, name: string): Element | null {
    for (const c of kids(e)) if (c.nodeName === name) return c;
    return null;
  }

  private set(e: Element, name: string, v: string | number | null | undefined): void {
    if (v === null || v === undefined || v === '') e.removeAttribute(name);
    else e.setAttribute(name, String(v));
  }

  /** Index in the file's colour list (0 black, 1 white, then the colour table). */
  private colorIndex(hex: string, forceTable = false): number {
    const h = hex.toLowerCase();
    if (!forceTable) {
      if (h === '#000000') return 0;
      if (h === '#ffffff') return 1;
    }
    const i = this.colors.indexOf(h, 2);
    if (i >= 2) return i;
    const [r, g, b] = [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16) / 255);
    this.colortable.appendChild(this.el('color', { r: r.toFixed(4), g: g.toFixed(4), b: b.toFixed(4) }));
    this.colors.push(h);
    return this.colors.length - 1;
  }

  private colorAttr(hex: string | undefined): string | null {
    return hex && hex.toLowerCase() !== '#000000' ? String(this.colorIndex(hex)) : null;
  }

  private fontId(name = 'Arial'): string {
    const key = name.toLowerCase();
    let id = this.fontIds.get(key);
    if (id) return id;
    let max = 2;
    for (const v of this.fontIds.values()) max = Math.max(max, Number(v) || 0);
    id = String(max + 1);
    this.fonttable.appendChild(this.el('font', { id, charset: isSymbolFont(name) ? 'Unknown' : 'iso-8859-1', name }));
    this.fontIds.set(key, id);
    return id;
  }

  /** The element an entity was read from, if it is still in the file. */
  private source(kind: Kind, id: number, names: string[]): Element | null {
    const o = this.doc.source?.ord.get(kind + id);
    if (o === undefined) return null;
    const e = this.all[o];
    return e && names.includes(e.nodeName) ? e : null;
  }

  private orig<T extends Entity>(kind: Kind, id: number): T | null {
    return (this.doc.source?.orig.get(kind + id) as T) ?? null;
  }

  private nodeId(atomId: number): string {
    return this.source('a', atomId, ['n'])?.getAttribute('id') ?? String(atomId);
  }

  // ------------------------------------------------------------------ deletions

  private removeDeleted(): void {
    const doc = this.doc;
    const maps: Record<Kind, Map<number, Entity>> = { a: doc.atoms, b: doc.bonds, c: doc.captions, r: doc.arrows, s: doc.shapes };
    for (const [key, o] of doc.source!.ord) {
      const kind = key[0] as Kind;
      if (maps[kind].has(Number(key.slice(1)))) continue;
      const e = this.all[o];
      if (!e?.parentNode) continue;
      if (kind === 'r') this.removeLegacyArrow(e);
      e.parentNode.removeChild(e);
      this.changed = true;
    }
  }

  /**
   * ChemDraw keeps an older copy of each arrow (a line or arc graphic) for old versions, and
   * reaction schemes refer to that copy, so it is kept in step with the arrow.
   */
  private legacyOf(arrow: Element): Element[] {
    const id = arrow.getAttribute('id');
    if (!id) return [];
    if (!this.legacy) {
      this.legacy = new Map();
      for (const g of this.all) {
        const by = g.nodeName === 'graphic' ? g.getAttribute('SupersededBy') : null;
        if (by) this.legacy.set(by, [...(this.legacy.get(by) ?? []), g]);
      }
    }
    return this.legacy.get(id) ?? [];
  }

  private removeLegacyArrow(arrow: Element): void {
    for (const g of this.legacyOf(arrow)) g.parentNode?.removeChild(g);
  }

  /** Lines are stored head then tail; arcs head then centre. */
  private updateLegacyArrow(arrow: Element, r: Arrow): void {
    for (const g of this.legacyOf(arrow)) {
      if (g.getAttribute('GraphicType') === 'Arc') {
        if (r.sweep) g.setAttribute('BoundingBox', `${pt(r.head)} ${pt(arcCenter(r.tail, r.head, r.sweep).center)}`);
      } else g.setAttribute('BoundingBox', `${pt(r.head)} ${pt(r.tail)}`);
    }
  }

  // ------------------------------------------------------------------ structures

  private writeStructures(): void {
    const doc = this.doc;
    const comps = doc.fragments().sort((a, b) => b.size - a.size);
    const claimed = new Set<Element>();
    for (const comp of comps) {
      // Reuse the file's fragment that holds most of this structure; split-off parts get new ones.
      const counts = new Map<Element, number>();
      for (const id of comp) {
        const f = this.source('a', id, ['n'])?.parentElement;
        if (f && f.nodeName === 'fragment') counts.set(f, (counts.get(f) ?? 0) + 1);
      }
      let target: Element | null = null, best = 0, near: Element | null = null;
      for (const [f, n] of counts) {
        near = near ?? f;
        if (!claimed.has(f) && n > best) { target = f; best = n; }
      }
      if (!target) {
        target = this.el('fragment', { id: this.id() });
        if (near?.parentNode) near.parentNode.insertBefore(target, near.nextSibling);
        else this.page.appendChild(target);
        this.changed = true;
      }
      claimed.add(target);
      for (const id of comp) this.fragOfAtom.set(id, target);
    }
    const touched = new Set<Element>();
    for (const a of doc.atoms.values()) if (this.writeAtom(a)) touched.add(this.fragOfAtom.get(a.id)!);
    for (const b of doc.bonds.values()) if (this.writeBond(b)) touched.add(this.fragOfAtom.get(b.a1)!);
    for (const f of touched) this.fitFragment(f);
  }

  private neighborsMovedApart(a: Atom): boolean {
    const o = this.orig<Atom>('a', a.id)!;
    const dx = a.x - o.x, dy = a.y - o.y;
    for (const n of this.doc.neighbors(a.id)) {
      const on = this.orig<Atom>('a', n.id);
      if (!on || Math.abs(n.x - on.x - dx) > 1e-6 || Math.abs(n.y - on.y - dy) > 1e-6) return true;
    }
    return false;
  }

  private connectivityChanged(a: Atom): boolean {
    const was = this.origNeighbors.get(a.id) ?? new Set<number>();
    const now = this.doc.neighbors(a.id);
    if (now.length !== was.size) return true;
    for (const n of now) if (!was.has(n.id)) return true;
    for (const bid of this.doc.adj.get(a.id) ?? []) if (!this.orig('b', bid)) return true;
    return false;
  }

  /** Returns true when the atom's element was written or changed. */
  private writeAtom(a: Atom): boolean {
    const target = this.fragOfAtom.get(a.id)!;
    const e = this.source('a', a.id, ['n']);
    const o = this.orig<Atom>('a', a.id);
    if (!e || !o) {
      const n = this.buildNode(a);
      target.insertBefore(n, this.child(target, 'b') ?? this.child(target, 'graphic'));
      this.changed = true;
      return true;
    }
    let wrote = false;
    if (e.parentElement !== target) {
      target.insertBefore(e, this.child(target, 'b'));
      wrote = true;
    }
    const conn = this.connectivityChanged(a);
    const others = !sameExcept(a, o, ['x', 'y']);
    if (!others && !conn && !this.neighborsMovedApart(a)) {
      if (a.x !== o.x || a.y !== o.y) { shift(e, a.x - o.x, a.y - o.y); wrote = true; }
      // the label of an atom that didn't change can still change with its neighbours
      if (!a.attach && this.atomStereo(e, a, false)) wrote = true;
    } else {
      this.patchNode(e, a, o);
      wrote = true;
    }
    if (wrote) this.changed = true;
    return wrote;
  }

  private writeBond(b: Bond): boolean {
    const target = this.fragOfAtom.get(b.a1)!;
    const e = this.source('b', b.id, ['b']);
    const o = this.orig<Bond>('b', b.id);
    if (!e || !o) {
      target.appendChild(this.buildBond(b));
      this.changed = true;
      return true;
    }
    let wrote = false;
    if (e.parentElement !== target) { target.appendChild(e); wrote = true; }
    if (!sameExcept(b, o, [])) {
      this.patchBond(e, b);
      wrote = true;
    } else {
      const p = this.doc.atoms.get(b.a1)!, q = this.doc.atoms.get(b.a2)!;
      if ((this.connectivityChanged(p) || this.connectivityChanged(q)) && e.hasAttribute('BondCircularOrdering')) {
        e.removeAttribute('BondCircularOrdering');
        wrote = true;
      }
      if (this.bondStereo(e, b, false)) wrote = true;
    }
    if (wrote) this.changed = true;
    return wrote;
  }

  /** Keep a fragment's box around its atoms after edits. */
  private fitFragment(f: Element): void {
    if (!f.parentNode) return;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const n of kids(f)) {
      if (n.nodeName !== 'n') continue;
      const [x, y] = nums(n.getAttribute('p'));
      const t = this.child(n, 't');
      const bb = t ? nums(t.getAttribute('BoundingBox')) : [];
      const pts = bb.length === 4 ? [[x, y], [bb[0], bb[1]], [bb[2], bb[3]]] : [[x, y]];
      for (const [px, py] of pts) { x1 = Math.min(x1, px); y1 = Math.min(y1, py); x2 = Math.max(x2, px); y2 = Math.max(y2, py); }
    }
    if (x1 === Infinity) return; // no atoms left; cleanUp drops it unless it still holds a symbol
    f.setAttribute('BoundingBox', box({ x1, y1, x2, y2 }));
  }

  private buildNode(a: Atom): Element {
    if (a.attach) return this.el('n', { id: a.id, p: pt(a), NodeType: 'ExternalConnectionPoint', ExternalConnectionType: a.attach === 'Unspecified' ? null : a.attach, ExternalConnectionNum: a.attachNum ?? null });
    const n = this.el('n', { id: a.id, p: pt(a) });
    this.nodeCore(n, a);
    this.nodeLabel(n, a, true);
    this.atomStereo(n, a, true);
    this.atomNumber(n, a);
    return n;
  }

  private get placer(): StereoPlacer {
    return (this.placerMade ??= new StereoPlacer(this.doc, this.measure));
  }

  /** The atom number (the ' key): ChemDraw's AtomNumber, ShowAtomNumber and a tag with the text. */
  private atomNumber(n: Element, a: Atom): void {
    this.set(n, 'ShowAtomNumber', a.showNumber ? 'yes' : null);
    this.set(n, 'AtomNumber', a.atomNumber ?? null);
    const old = kids(n).find((c) => c.nodeName === 'objecttag' && c.getAttribute('Name') === 'number');
    if (old) n.removeChild(old);
    if (!a.showNumber || !a.atomNumber) return;
    const p = this.placer.number(a);
    const tag = this.el('objecttag', { TagType: 'Unknown', Name: 'number' });
    const t = this.el('t', { p: pt(p), BoundingBox: box({ x1: p.x, y1: p.y - CAP * p.size, x2: p.x + this.measure(a.atomNumber, p.size), y2: p.y }), CaptionLineHeight: 'variable' });
    const s = this.el('s', { font: this.fontId(), size: f2(p.size).replace(/\.00$/, ''), color: '0' });
    s.textContent = a.atomNumber;
    t.appendChild(s);
    tag.appendChild(t);
    n.appendChild(tag);
  }

  private patchNode(n: Element, a: Atom, o: Atom): void {
    const dx = a.x - o.x, dy = a.y - o.y;
    n.setAttribute('p', pt(a));
    if (a.attach) {
      this.set(n, 'NodeType', 'ExternalConnectionPoint');
      this.set(n, 'ExternalConnectionType', a.attach === 'Unspecified' ? null : a.attach);
      this.set(n, 'ExternalConnectionNum', a.attachNum ?? null);
      // an atom turned into a point of attachment loses its label and element
      for (const c of kids(n)) if (c.nodeName === 't' || c.nodeName === 'fragment' || c.nodeName === 'objecttag') n.removeChild(c);
      for (const k of ['Element', 'NumHydrogens', 'NeedsClean', 'GenericNickname', 'Charge', 'Isotope', 'ShowAtomNumber', 'AtomNumber']) n.removeAttribute(k);
      return;
    }
    if (o.attach) for (const k of ['NodeType', 'ExternalConnectionType', 'ExternalConnectionNum']) n.removeAttribute(k);
    this.patchNodeBody(n, a, o, dx, dy);
    this.atomNumber(n, a);
  }

  private patchNodeBody(n: Element, a: Atom, o: Atom, dx: number, dy: number): void {
    for (const c of kids(n)) if (c.nodeName !== 't' && c.nodeName !== 'fragment') shift(c, dx, dy);
    this.nodeCore(n, a);
    this.atomStereo(n, a, true);
    const sameLabel = a.label === o.label && a.z === o.z && a.charge === o.charge && a.isotope === o.isotope && !!a.hideCharge === !!o.hideCharge;
    const t = this.child(n, 't');
    if (sameLabel && a.label !== null) {
      // A text label (abbreviation, R group…) keeps its text, styling and structure; only its placement changes.
      const inner = this.child(n, 'fragment');
      if (inner) shift(inner, dx, dy);
      if (t) this.placeLabel(t, a);
      return;
    }
    if (sameLabel && t && t.textContent === this.autoText(a).text) {
      // An element label whose hydrogens did not change keeps ChemDraw's text and styling.
      this.placeLabel(t, a);
      return;
    }
    this.nodeLabel(n, a, !sameLabel || a.label === null);
  }

  /** An atom's (R)/(S) label and descriptor. Returns true when the node changed. */
  private atomStereo(n: Element, a: Atom, patched: boolean): boolean {
    const info = this.doc.stereo;
    const text = atomStereoText(a, info);
    const place = text ? this.placer.atom(a, text) : null;
    return this.syncStereo(n, 'ShowAtomStereo', 'AS', !!a.showStereo, text, place, info?.atom(a.id), patched);
  }

  private bondStereo(e: Element, b: Bond, patched: boolean): boolean {
    const info = this.doc.stereo;
    const text = bondStereoText(b, info);
    const place = text ? this.placer.bond(b, text) : null;
    return this.syncStereo(e, 'ShowBondStereo', 'BS', !!b.showStereo, text, place, info?.bond(b.id), patched);
  }

  /**
   * Make a stereo label in the file say what the drawing shows: ChemDraw's tag holding the text
   * (at an absolute position), the "show" flag, and the descriptor (AS or BS). An untouched
   * element is left exactly as it was unless its label's text or place changed.
   */
  private syncStereo(e: Element, showAttr: string, descAttr: string, show: boolean, text: string | null, place: PlacedLabel | null, desc: string | null | undefined, patched: boolean): boolean {
    const old = kids(e).find((c) => c.nodeName === 'objecttag' && c.getAttribute('Name') === 'stereo') ?? null;
    let same = !old && !text;
    if (old && text && place) {
      const t = this.child(old, 't');
      const [x, y] = nums(t?.getAttribute('p') ?? null);
      same = (t?.textContent ?? '') === text && Math.abs(x - place.x) < 0.01 && Math.abs(y - place.y) < 0.01;
    }
    // ChemDraw shows a label only on atoms and bonds marked to show one
    show = show || !!text;
    const showNow = e.getAttribute(showAttr) === 'yes';
    if (same && !patched && showNow === show) return false;
    // not worked out (no chemistry engine): the descriptor the label states
    if (desc === undefined && text) desc = /^\(?([RSrsEZ])\)?$/.exec(text.trim())?.[1];
    if (!same) {
      if (old) e.removeChild(old);
      if (text && place) {
        const tag = this.el('objecttag', { TagType: 'Unknown', Name: 'stereo' });
        const t = this.el('t', { p: pt(place), BoundingBox: box({ x1: place.x, y1: place.y - CAP * place.size, x2: place.x + this.measure(text, place.size), y2: place.y + 0.2 * place.size }), CaptionLineHeight: 'variable' });
        const s = this.el('s', { font: this.fontId(), size: f2(place.size).replace(/\.00$/, ''), color: '0', face: place.italic ? 2 : 0 });
        s.textContent = text;
        t.appendChild(s);
        tag.appendChild(t);
        e.appendChild(tag);
      }
    }
    this.set(e, showAttr, show ? 'yes' : null);
    // the descriptor ChemDraw keeps; when we don't know it, ChemDraw works it out again
    if (patched || !same) this.set(e, descAttr, desc ?? null);
    return true;
  }

  /** Text of an atom's label as ChemDraw stores it ("OH", "NH3+", "OMe"), and its hydrogen count. */
  private autoText(a: Atom): { text: string; hCount: number } {
    const doc = this.doc;
    const spec = labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), !a.hideCharge);
    if (!spec) return { text: '', hCount: 0 };
    const chargeText = !a.hideCharge && a.charge ? (Math.abs(a.charge) > 1 ? String(Math.abs(a.charge)) : '') + (a.charge > 0 ? '+' : '-') : '';
    if (a.label !== null) return { text: a.label + (chargeText && !/[+\-−]$/.test(a.label) ? chargeText : ''), hCount: 0 };
    const sym = a.isotope === 2 && a.z === 1 ? 'D' : SYMBOLS[a.z] ?? '?';
    return { text: sym + (spec.hCount ? 'H' + (spec.hCount > 1 ? spec.hCount : '') : '') + chargeText, hCount: spec.hCount };
  }

  /** Element, charge, isotope, colour and size of a node. */
  private nodeCore(n: Element, a: Atom): void {
    const labelled = a.label !== null;
    this.set(n, 'Element', !labelled && a.z !== 6 ? a.z : labelled ? n.getAttribute('Element') : null);
    this.set(n, 'Charge', a.charge || null);
    this.set(n, 'Isotope', a.isotope || null);
    this.set(n, 'color', this.colorAttr(a.color));
    this.set(n, 'LabelSize', a.s && a.s !== 1 ? f2(a.s * this.doc.style.labelSize) : null);
    this.set(n, 'IgnoreWarnings', a.ignoreWarnings ? 'yes' : null);
    this.set(n, 'Radical', a.radical ? a.radical[0].toUpperCase() + a.radical.slice(1) : null);
  }

  /** The node's label text and what it stands for (element + H count, abbreviation, R group). */
  private nodeLabel(n: Element, a: Atom, rebuildInner: boolean): void {
    // keep the old label's font and bold/italic style
    const oldS = this.child(this.child(n, 't') ?? n, 's');
    const keepFont = oldS?.getAttribute('font') ?? null;
    const keepBits = Number(oldS?.getAttribute('face') ?? 0) & 7;
    for (const c of kids(n)) if (c.nodeName === 't' || (rebuildInner && c.nodeName === 'fragment')) n.removeChild(c);
    if (rebuildInner) for (const k of ['NodeType', 'GenericNickname', 'Warning', 'NumHydrogens', 'NeedsClean']) n.removeAttribute(k);
    if (!labelSpec(a.z, a.label, a.charge, a.isotope, this.doc.valenceSum(a.id), this.doc.degree(a.id), !a.hideCharge)) return;
    const { text, hCount } = this.autoText(a);
    if (a.label === null) n.setAttribute('NumHydrogens', String(hCount));
    else if (rebuildInner) this.labelChemistry(n, a);
    n.setAttribute('NeedsClean', 'yes');
    const size = this.doc.style.labelSize * (a.s ?? 1);
    const t = this.el('t', {});
    const color = this.colorAttr(a.color);
    const digits = a.supDigits ? /\d+$/.exec(text) : null;
    const runs: TextRun[] = digits ? [{ text: text.slice(0, digits.index), formula: true }, { text: digits[0], sup: true }] : [{ text, formula: true }];
    for (const r of runs) {
      const s = this.el('s', { font: keepFont ?? this.fontId(), size: f2(size).replace(/\.00$/, ''), color: color ?? '0', face: (faceOf(r) ?? 0) | keepBits });
      s.textContent = r.text;
      t.appendChild(s);
    }
    n.appendChild(t);
    this.placeLabel(t, a);
  }

  /** What a text label means chemically, in ChemDraw's terms. */
  private labelChemistry(n: Element, a: Atom): void {
    const label = a.label!;
    const toks = tokenize(label);
    if (isGenericLabel(label) || (toks.length === 1 && toks[0].kind === 'generic')) {
      n.setAttribute('NodeType', 'GenericNickname');
      n.setAttribute('GenericNickname', label);
      return;
    }
    const g = labelGraph(label);
    if (!g) { n.setAttribute('NodeType', 'Unspecified'); return; }
    const heavy = g.atoms.length === 1 && !g.atoms[0].dummy && toks.every((t) => t.kind === 'el');
    if (heavy) {
      // e.g. "NH" typed as a label: an element with its hydrogens
      n.setAttribute('Element', String(g.atoms[0].z));
      n.setAttribute('NumHydrogens', String(toks.filter((t) => t.text === 'H').reduce((s, t) => s + Math.max(1, t.count), 0)));
      return;
    }
    n.removeAttribute('Element');
    n.setAttribute('NodeType', toks.length === 1 && toks[0].kind === 'nick' && toks[0].count <= 1 ? 'Nickname' : 'Fragment');
    n.insertBefore(this.innerFragment(a, g), n.firstChild);
  }

  /** The atoms an abbreviation stands for, joined to the outside through connection points. */
  private innerFragment(a: Atom, g: MiniGraph): Element {
    const doc = this.doc;
    const f = this.el('fragment', { id: this.id() });
    const neighbors = doc.neighbors(a.id);
    let away = { x: 0, y: 0 };
    for (const nb of neighbors) { const d = norm(sub(a, nb)); away = { x: away.x + d.x, y: away.y + d.y }; }
    away = Math.hypot(away.x, away.y) < 1e-6 ? { x: 1, y: 0 } : norm(away);
    const L = doc.style.bondLength * (a.s ?? 1);
    const across = { x: -away.y, y: away.x };
    const ids: string[] = [];
    g.atoms.forEach((m, i) => {
      // a simple zig-zag away from the structure; ChemDraw lays it out properly if the label is expanded
      const p = { x: a.x + away.x * L * 0.87 * i + across.x * (i % 2) * L * 0.5, y: a.y + away.y * L * 0.87 * i + across.y * (i % 2) * L * 0.5 };
      const id = this.id();
      ids.push(id);
      f.appendChild(this.el('n', {
        id, p: pt(p),
        Element: m.dummy || m.z === 6 ? null : m.z,
        Charge: m.charge || null,
        NodeType: m.dummy ? 'GenericNickname' : null,
        GenericNickname: m.dummy ? 'R' : null,
      }));
    });
    const ext: string[] = [];
    const count = Math.max(1, neighbors.length);
    for (let k = 0; k < count; k++) {
      const id = this.id();
      ext.push(id);
      f.appendChild(this.el('n', { id, p: pt(neighbors[k] ?? a), NodeType: 'ExternalConnectionPoint', ExternalConnectionNum: count > 1 ? k + 1 : null }));
    }
    for (const b of kekulize(g)) f.appendChild(this.el('b', { id: this.id(), B: ids[b.a], E: ids[b.b], Order: orderAttr(b.order) }));
    for (const x of ext) f.appendChild(this.el('b', { id: this.id(), B: x, E: ids[0] }));
    return f;
  }

  /** Position, box and justification of an atom label, from the same layout used on screen. */
  private placeLabel(t: Element, a: Atom): void {
    const doc = this.doc;
    const spec = labelSpec(a.z, a.label, a.charge, a.isotope, doc.valenceSum(a.id), doc.degree(a.id), !a.hideCharge);
    if (!spec) return;
    if (a.supDigits) spec.supDigits = true;
    const dirs = doc.neighbors(a.id).map((nb) => norm(sub(nb, a)));
    const size = doc.style.labelSize * (a.s ?? 1);
    const layout = layoutLabel(spec, dirs, size, this.measure, a.just);
    const dir = labelDir(spec, dirs, a.just);
    // ChemDraw puts the baseline 0.39 × size below the atom (the screen layout uses half the
    // cap height), the box top 0.835 × size above the baseline, and the bottom on the baseline
    // unless there are subscripts or descenders.
    const baseline = 0.39 * size;
    const dy = baseline - (CAP * size) / 2;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    let below = /[gjpqy,]/.test(layout.runs.map((r) => r.text).join(''));
    layout.boxes.forEach((b, i) => {
      const run = layout.runs[i];
      x1 = Math.min(x1, b.x1); x2 = Math.max(x2, b.x2);
      if (run.size >= size) { y1 = Math.min(y1, b.y1 + dy - (0.835 - CAP) * size); y2 = Math.max(y2, b.y2 + dy); return; }
      // a smaller run: a subscript count, a superscript number (R¹) or a charge
      const rowBase = layout.runs.find((r) => r.size >= size && Math.abs(r.dy - run.dy) < size)?.dy ?? (CAP * size) / 2;
      if (run.dy > rowBase) below = true;
      else if (/^\d+$/.test(run.text)) y1 = Math.min(y1, rowBase + dy - 1.15 * size);
    });
    if (below) y2 = Math.max(y2, baseline + 0.23 * size);
    const right = dir === 'left' && [...layout.runs.map((r) => r.text).join('')].length > 1;
    t.setAttribute('p', pt({ x: a.x + (right ? x2 : x1), y: a.y + baseline }));
    t.setAttribute('BoundingBox', box({ x1: a.x + x1, y1: a.y + y1, x2: a.x + x2, y2: a.y + y2 }));
    t.setAttribute('LabelJustification', right ? 'Right' : 'Left');
    t.setAttribute('LabelAlignment', dir === 'up' ? 'Above' : dir === 'down' ? 'Below' : right ? 'Right' : 'Left');
    t.removeAttribute('Justification');
  }

  private buildBond(b: Bond): Element {
    const e = this.el('b', { id: b.id });
    this.patchBond(e, b);
    return e;
  }

  private patchBond(e: Element, b: Bond): void {
    e.setAttribute('B', this.nodeId(b.a1));
    e.setAttribute('E', this.nodeId(b.a2));
    this.set(e, 'Order', orderAttr(b.order));
    this.set(e, 'Display', DISPLAY[b.display] ?? null);
    e.removeAttribute('Display2');
    const dp = b.order === 2 || b.order === 1.5 ? { left: 'Left', right: 'Right', center: 'Center', auto: null }[b.dpos] : null;
    this.set(e, 'DoublePosition', dp);
    this.set(e, 'color', this.colorAttr(b.color));
    this.set(e, 'LineWidth', b.s && b.s !== 1 ? f2(b.s * this.doc.style.lineWidth) : null);
    this.set(e, 'IgnoreWarnings', b.ignoreWarnings ? 'yes' : null);
    e.removeAttribute('BondCircularOrdering');
    this.bondStereo(e, b, true);
  }

  // ------------------------------------------------------------------ captions, arrows, shapes

  private writeCaption(c: Caption): void {
    const e = this.source('c', c.id, ['t']);
    const o = this.orig<Caption>('c', c.id);
    if (e && o) {
      if (sameExcept(c, o, [])) return;
      if (sameExcept(c, o, ['x', 'y'])) shift(e, c.x - o.x, c.y - o.y);
      else this.fillCaption(e, c);
    } else {
      const t = this.el('t', { id: c.id });
      this.fillCaption(t, c);
      this.page.appendChild(t);
    }
    this.changed = true;
  }

  private fillCaption(t: Element, c: Caption): void {
    for (const ch of kids(t)) if (ch.nodeName === 's') t.removeChild(ch);
    const def = this.doc.style.captionSize;
    // measure each line to place the text box
    const lines: number[] = [0];
    let maxSize = 0;
    for (const r of c.runs) {
      const size = r.size ?? def;
      maxSize = Math.max(maxSize, size);
      const parts = r.text.split('\n');
      parts.forEach((part, i) => {
        if (i > 0) lines.push(0);
        lines[lines.length - 1] += this.measure(part, r.sub || r.sup ? size * 0.75 : size);
      });
      // Greek letters and signs that an ordinary font can't hold go in the Symbol font, as ChemDraw does
      for (const piece of toSymbolPieces(r.text)) {
        const s = this.el('s', { font: this.fontId(piece.symbol ? 'Symbol' : r.font ?? 'Arial'), size: f2(size).replace(/\.00$/, ''), color: this.colorAttr(r.color) ?? '0', face: faceOf(r) });
        s.textContent = piece.text;
        t.appendChild(s);
      }
    }
    const width = c.width ?? Math.max(...lines);
    const lh = c.lineHeight ?? maxSize * 1.15;
    const px = c.justify === 'center' ? c.x + width / 2 : c.justify === 'right' ? c.x + width : c.x;
    t.setAttribute('p', pt({ x: px, y: c.y }));
    t.setAttribute('BoundingBox', box({ x1: c.x, y1: c.y - maxSize * CAP, x2: c.x + width, y2: c.y + (lines.length - 1) * lh + maxSize * 0.2 }));
    this.set(t, 'Justification', c.justify === 'left' ? null : c.justify === 'center' ? 'Center' : 'Right');
    this.set(t, 'CaptionJustification', null);
    // ChemDraw lists where each line ends (in the text as stored); without the list it drops blank lines.
    const ends = lineEnds(kids(t).filter((k) => k.nodeName === 's').map((k) => k.textContent ?? '').join(''));
    this.set(t, 'LineHeight', c.lineHeight ? f2(c.lineHeight) : ends.length > 1 ? 'auto' : null);
    this.set(t, 'LineStarts', ends.length > 1 ? ends.join(' ') : null);
    t.removeAttribute('WordWrapWidth');
  }

  private writeArrow(r: Arrow): void {
    const e = this.source('r', r.id, ['arrow']);
    const o = this.orig<Arrow>('r', r.id);
    if (e && o) {
      if (sameExcept(r, o, [])) return;
      const d = { x: r.tail.x - o.tail.x, y: r.tail.y - o.tail.y };
      const moved = { ...o, tail: r.tail, head: { x: o.head.x + d.x, y: o.head.y + d.y } };
      if (sameExcept(r, moved, [])) {
        shift(e, d.x, d.y);
        for (const g of this.legacyOf(e)) shift(g, d.x, d.y);
      } else {
        this.fillArrow(e, r);
        this.updateLegacyArrow(e, r);
      }
    } else {
      const a = this.el('arrow', { id: r.id });
      this.fillArrow(a, r);
      this.page.appendChild(a);
    }
    this.changed = true;
  }

  private fillArrow(e: Element, r: Arrow): void {
    const lw = r.lineWidth ?? this.doc.style.lineWidth;
    const headName = (h: Arrow['headStyle']) => (h === 'full' ? 'Full' : h === 'halfLeft' ? 'HalfLeft' : h === 'halfRight' ? 'HalfRight' : null);
    const headSize = Math.round((r.headLength / lw) * 100);
    const attrs: Record<string, string | number | null> = {
      FillType: 'None',
      ArrowheadHead: headName(r.headStyle),
      ArrowheadTail: headName(r.tailStyle),
      ArrowheadType: r.headType === 'hollow' ? 'Hollow' : r.headType === 'angle' ? 'Angle' : 'Solid',
      HeadSize: headSize,
      ArrowheadCenterSize: Math.round(headSize * 0.875),
      ArrowheadWidth: Math.round((r.headWidth / lw) * 100),
      LineType: r.line === 'dashed' ? 'Dashed' : r.line === 'bold' ? 'Bold' : r.line === 'wavy' ? 'Wavy' : null,
      NoGo: r.noGo ? 'Cross' : null,
      ArrowShaftSpacing: r.equilibrium ? 300 : r.shaftSpacing ? Math.round((r.shaftSpacing / lw) * 100) : null,
      LineWidth: r.lineWidth !== undefined ? f2(r.lineWidth) : null,
      color: this.colorAttr(r.color),
      Head3D: pt3(r.head),
      Tail3D: pt3(r.tail),
    };
    let x1 = Math.min(r.head.x, r.tail.x), y1 = Math.min(r.head.y, r.tail.y), x2 = Math.max(r.head.x, r.tail.x), y2 = Math.max(r.head.y, r.tail.y);
    if (r.sweep) {
      const { center, radius } = arcCenter(r.tail, r.head, r.sweep);
      attrs.Center3D = pt3(center);
      attrs.MajorAxisEnd3D = pt3({ x: center.x + radius, y: center.y });
      attrs.MinorAxisEnd3D = pt3({ x: center.x, y: center.y + radius });
      attrs.AngularSize = f2(-r.sweep / DEG);
      x1 = center.x - radius; y1 = center.y - radius; x2 = center.x + radius; y2 = center.y + radius;
    } else {
      // ChemDraw also stores these for straight arrows
      const c = { x: (r.head.x + r.tail.x) / 2, y: (r.head.y + r.tail.y) / 2 };
      const L = Math.hypot(r.head.x - r.tail.x, r.head.y - r.tail.y);
      attrs.Center3D = pt3(c);
      attrs.MajorAxisEnd3D = pt3({ x: c.x + L, y: c.y });
      attrs.MinorAxisEnd3D = pt3({ x: c.x, y: c.y + L });
      attrs.AngularSize = null;
    }
    const pad = r.headWidth;
    attrs.BoundingBox = box({ x1: x1 - pad, y1: y1 - pad, x2: x2 + pad, y2: y2 + pad });
    for (const [k, v] of Object.entries(attrs)) this.set(e, k, v);
  }

  private writeShape(s: Shape): void {
    const names = s.picture ? ['embeddedobject'] : ['graphic'];
    const e = this.source('s', s.id, names);
    const o = this.orig<Shape>('s', s.id);
    if (e && o) {
      if (sameExcept(s, o, [])) return;
      const dx = s.x1 - o.x1, dy = s.y1 - o.y1;
      if (sameExcept(s, { ...o, x1: o.x1 + dx, y1: o.y1 + dy, x2: o.x2 + dx, y2: o.y2 + dy }, [])) shift(e, dx, dy);
      else if (!s.picture) this.fillShape(e, s);
    } else {
      if (s.picture) return; // a copied picture placeholder has no picture to write
      const g = this.el('graphic', { id: s.id });
      this.fillShape(g, s);
      // circled charges and lone pairs belong with their structure; a circled charge also
      // names the atom whose charge it shows, so ChemDraw leaves the charge off that label
      const owner = s.kind === 'symbol' ? this.chargeOwner(s) : null;
      if (owner) g.appendChild(this.el('represent', { attribute: 'Charge', object: this.nodeId(owner.id) }));
      const host = owner ? this.fragOfAtom.get(owner.id) ?? null : s.kind === 'symbol' ? this.nearestFragment(s) : null;
      (host ?? this.page).appendChild(g);
    }
    this.changed = true;
  }

  /** The atom whose charge a circled ⊕/⊖ shows: the nearest atom with a hidden charge of that sign. */
  private chargeOwner(s: Shape): Atom | null {
    const sign = s.symbol === 'CirclePlus' || s.symbol === 'Plus' ? 1 : s.symbol === 'CircleMinus' || s.symbol === 'Minus' ? -1 : 0;
    if (!sign) return null;
    const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    let best: Atom | null = null, bestD = Infinity;
    for (const a of this.doc.atomsNear(c, this.doc.style.bondLength * 1.5)) {
      if (!a.hideCharge || Math.sign(a.charge) !== sign) continue;
      const d = Math.hypot(a.x - c.x, a.y - c.y);
      if (d < bestD) { best = a; bestD = d; }
    }
    return best;
  }

  private nearestFragment(s: Shape): Element | null {
    const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
    const near = this.doc.atomsNear(c, this.doc.style.bondLength);
    return near.length ? this.fragOfAtom.get(near[0].id) ?? null : null;
  }

  private fillShape(g: Element, s: Shape): void {
    for (const k of ['GraphicType', 'LineType', 'RectangleType', 'OvalType', 'SymbolType', 'BracketType', 'Center3D', 'MajorAxisEnd3D', 'MinorAxisEnd3D', 'ArrowType', 'CornerRadius', 'ShadowSize']) g.removeAttribute(k);
    const style = [s.dashed && 'Dashed', s.bold && 'Bold'].filter(Boolean).join(' ') || null;
    const set = (k: string, v: string | null) => this.set(g, k, v);
    set('color', this.colorAttr(s.color));
    switch (s.kind) {
      case 'line':
        set('GraphicType', 'Line');
        set('BoundingBox', box(s));
        set('LineType', style);
        break;
      case 'rect':
        set('GraphicType', 'Rectangle');
        // ChemDraw puts a box's shadow toward the first corner it stores, and stores the
        // bottom-right corner first
        set('BoundingBox', s.shadow ? box({ x1: Math.max(s.x1, s.x2), y1: Math.max(s.y1, s.y2), x2: Math.min(s.x1, s.x2), y2: Math.min(s.y1, s.y2) }) : box(s));
        set('RectangleType', [s.rounded && 'RoundEdge', s.shadow && 'Shadow', s.filled && 'Filled', s.dashed && 'Dashed', s.bold && 'Bold'].filter(Boolean).join(' ') || 'Plain');
        // in hundredths of the line width, as ChemDraw stores them
        set('CornerRadius', s.rounded ? String(Math.round(((s.radius ?? 6 * this.doc.style.lineWidth) / this.doc.style.lineWidth) * 100)) : null);
        set('ShadowSize', s.shadow ? String(Math.round(((s.shadowSize ?? 4 * this.doc.style.lineWidth) / this.doc.style.lineWidth) * 100)) : null);
        break;
      case 'oval': {
        const c = { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
        const rx = Math.abs(s.x2 - s.x1) / 2, ry = Math.abs(s.y2 - s.y1) / 2;
        set('GraphicType', 'Oval');
        set('BoundingBox', box(s));
        set('Center3D', pt3(c));
        set('MajorAxisEnd3D', pt3({ x: c.x + rx, y: c.y }));
        set('MinorAxisEnd3D', pt3({ x: c.x, y: c.y + ry }));
        set('OvalType', [Math.abs(rx - ry) < 0.01 && 'Circle', s.filled && 'Filled', s.dashed && 'Dashed', s.bold && 'Bold', s.shadow && 'Shadowed'].filter(Boolean).join(' ') || null);
        break;
      }
      case 'symbol': {
        set('GraphicType', 'Symbol');
        set('SymbolType', s.symbol ?? 'CirclePlus');
        // circled charges are stored as their width along the bottom edge
        set('BoundingBox', s.symbol === 'LonePair' || s.symbol === 'Electron' ? box(s) : `${f2(s.x2)} ${f2(s.y2)} ${f2(s.x1)} ${f2(s.y2)}`);
        break;
      }
      case 'bracket': {
        const t = s.bracket === 'round' ? 'Round' : s.bracket === 'curly' ? 'Curly' : 'Square';
        set('GraphicType', 'Bracket');
        set('BracketType', s.pair ? t + 'Pair' : t);
        set('BoundingBox', box(s));
        break;
      }
    }
  }

  // ------------------------------------------------------------------ tidy references

  /** Drop references to objects that no longer exist (reaction steps, charge symbols, empty groups). */
  private cleanUp(): void {
    if (!this.changed) return;
    const all = descendants(this.root);
    const named = (name: string) => all.filter((e) => e.nodeName === name);
    const ids = new Set<string>();
    for (const e of all) { const id = e.getAttribute('id'); if (id) ids.add(id); }
    for (const st of named('step')) {
      for (const at of Array.from(st.attributes)) {
        if (!at.name.startsWith('ReactionStep')) continue;
        const list = at.value.trim().split(/\s+/).filter(Boolean);
        if (at.name === 'ReactionStepAtomMap') { if (list.some((x) => !ids.has(x))) st.removeAttribute(at.name); continue; }
        const kept = list.filter((x) => ids.has(x));
        if (kept.length !== list.length) this.set(st, at.name, kept.join(' '));
      }
    }
    for (const r of named('represent')) if (!ids.has(r.getAttribute('object') ?? '')) r.parentNode?.removeChild(r);
    for (const c of named('crossingbond')) if (!ids.has(c.getAttribute('BondID') ?? '')) c.parentNode?.removeChild(c);
    for (const g of named('group')) if (!g.firstElementChild) g.parentNode?.removeChild(g);
    for (const f of named('fragment')) {
      if (f.parentElement?.nodeName === 'n') continue;
      // a structure with nothing left in it (ChemDraw also keeps lone charge symbols in fragments)
      if (!kids(f).some((c) => c.nodeName === 'n' || c.nodeName === 'graphic')) f.parentNode?.removeChild(f);
    }
  }
}

// ------------------------------------------------------------------ helpers

const DISPLAY: Partial<Record<Bond['display'], string>> = {
  wedge: 'WedgeBegin', hashWedge: 'WedgedHashBegin', hash: 'Hash', bold: 'Bold', dash: 'Dash', wavy: 'Wavy',
};

/** UTF-8 byte offset of the end of each line (after its line break), as CDXML LineStarts. */
export function lineEnds(text: string): number[] {
  const out: number[] = [];
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (ch === '\n') out.push(bytes);
  }
  if (!out.length || out[out.length - 1] !== bytes) out.push(bytes);
  return out;
}

function orderAttr(order: number): string | null {
  return order === 1 ? null : String(order);
}

function faceOf(r: TextRun): number | null {
  return faceFromStyle(r);
}

function nums(v: string | null): number[] {
  return v ? v.trim().split(/\s+/).map(Number) : [];
}

function rgbHex(c: Element): string {
  const h = (k: string) => Math.round(Math.max(0, Math.min(1, Number(c.getAttribute(k) ?? 0))) * 255).toString(16).padStart(2, '0');
  return '#' + h('r') + h('g') + h('b');
}

/** Move an element and everything inside it. */
function shift(e: Element, dx: number, dy: number): void {
  if (!dx && !dy) return;
  for (const name of POSITION_ATTRS) {
    const v = e.getAttribute(name);
    if (v === null) continue;
    const n = nums(v);
    const is3D = name.endsWith('3D');
    const out = n.map((x, i) => (is3D ? (i % 3 === 0 ? x + dx : i % 3 === 1 ? x + dy : x) : i % 2 === 0 ? x + dx : x + dy));
    e.setAttribute(name, out.map((x, i) => (is3D && i % 3 === 2 ? String(x) : f2(x))).join(' '));
  }
  for (const c of kids(e)) shift(c, dx, dy);
}

/** Are two entities equal, ignoring the listed fields? */
function sameExcept(a: object, b: object, skip: string[]): boolean {
  const ka = Object.keys(a).filter((k) => !skip.includes(k) && (a as any)[k] !== undefined);
  const kb = Object.keys(b).filter((k) => !skip.includes(k) && (b as any)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  return true;
}

function deepEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (typeof x !== 'object' || typeof y !== 'object' || !x || !y) return false;
  if (Array.isArray(x) !== Array.isArray(y)) return false;
  const kx = Object.keys(x).filter((k) => (x as any)[k] !== undefined), ky = Object.keys(y).filter((k) => (y as any)[k] !== undefined);
  if (kx.length !== ky.length) return false;
  return kx.every((k) => deepEqual((x as any)[k], (y as any)[k]));
}
