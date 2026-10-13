// Enhanced Metafile (EMF) pictures, the vector format Word and PowerPoint paste from the
// Windows clipboard. Written from Microsoft's published [MS-EMF] specification: a header,
// then records that set up the page, pens, brushes and fonts, draw paths and text, and end.
//
// Coordinates are kept in hundredths of a point, so the picture is exactly the drawing's size
// (ChemDraw's 14.4 pt bonds come out 14.4 pt long in Word).

import { Item, Seg, parseColor } from './vector';

const UNIT = 100; // logical units per point
const DEVICE_MM = 300; // reference device: 300 mm square at 0.1 mm per pixel
const DEVICE_PX = DEVICE_MM * 10;

// record types
const EMR = {
  HEADER: 1, POLYBEZIERTO: 5, SETWINDOWEXTEX: 9, SETWINDOWORGEX: 10, SETVIEWPORTEXTEX: 11, SETVIEWPORTORGEX: 12,
  EOF: 14, SETMAPMODE: 17, SETBKMODE: 18, SETPOLYFILLMODE: 19, SETTEXTALIGN: 22, SETTEXTCOLOR: 24, MOVETOEX: 27,
  SELECTOBJECT: 37, CREATEBRUSHINDIRECT: 39, DELETEOBJECT: 40, LINETO: 54, BEGINPATH: 59, ENDPATH: 60,
  CLOSEFIGURE: 61, FILLPATH: 62, STROKEPATH: 64, EXTCREATEFONTINDIRECTW: 82, EXTTEXTOUTW: 84, EXTCREATEPEN: 95,
} as const;
const NULL_BRUSH = 0x80000005;
const NULL_PEN = 0x80000008;
const SYSTEM_FONT = 0x8000000d;

/** A growing little-endian byte buffer. */
class Bytes {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  length = 0;
  private room(n: number): void {
    if (this.length + n <= this.buf.length) return;
    let size = this.buf.length * 2;
    while (size < this.length + n) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buf.subarray(0, this.length));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }
  u8(v: number): void { this.room(1); this.view.setUint8(this.length, v); this.length += 1; }
  u16(v: number): void { this.room(2); this.view.setUint16(this.length, v, true); this.length += 2; }
  u32(v: number): void { this.room(4); this.view.setUint32(this.length, v >>> 0, true); this.length += 4; }
  i32(v: number): void { this.room(4); this.view.setInt32(this.length, Math.round(v), true); this.length += 4; }
  f32(v: number): void { this.room(4); this.view.setFloat32(this.length, v, true); this.length += 4; }
  setU32(at: number, v: number): void { this.view.setUint32(at, v >>> 0, true); }
  setI32(at: number, v: number): void { this.view.setInt32(at, Math.round(v), true); }
  /** UTF-16 text padded with zeros to `chars` characters. */
  utf16(s: string, chars: number): void { for (let i = 0; i < chars; i++) this.u16(i < s.length ? s.charCodeAt(i) : 0); }
  pad4(): void { while (this.length % 4) this.u8(0); }
  bytes(): Uint8Array { return this.buf.slice(0, this.length); }
}

export interface EmfBox { x1: number; y1: number; x2: number; y2: number }

/** Turn recorded drawing items into an EMF file. `box` is the picture area in points. */
export function itemsToEmf(items: Item[], box: EmfBox): Uint8Array {
  const out = new Bytes();
  const W = Math.max(1, box.x2 - box.x1), H = Math.max(1, box.y2 - box.y1);
  const X = (x: number) => (x - box.x1) * UNIT;
  const Y = (y: number) => (y - box.y1) * UNIT;
  let records = 0;
  let start = 0;
  const begin = (type: number) => { start = out.length; out.u32(type); out.u32(0); records++; };
  const end = () => { out.pad4(); out.setU32(start + 4, out.length - start); };
  const rec = (type: number, ...vals: number[]) => { begin(type); for (const v of vals) out.i32(v); end(); };

  // ---- header (filled in at the end with the size and record count)
  const mmW = (W * 25.4) / 72, mmH = (H * 25.4) / 72;
  begin(EMR.HEADER);
  out.i32(0); out.i32(0); out.i32(Math.ceil(mmW * 10) - 1); out.i32(Math.ceil(mmH * 10) - 1); // bounds, device pixels
  out.i32(0); out.i32(0); out.i32(Math.round(mmW * 100)); out.i32(Math.round(mmH * 100)); // frame, 0.01 mm
  out.u32(0x464d4520); // " EMF"
  out.u32(0x00010000);
  const bytesAt = out.length; out.u32(0);
  const recordsAt = out.length; out.u32(0);
  out.u16(7); // handles: 0 plus two pens, two brushes, two fonts
  out.u16(0);
  out.u32(0); out.u32(0); // no description
  out.u32(0); // no palette
  out.i32(DEVICE_PX); out.i32(DEVICE_PX); // reference device in pixels
  out.i32(DEVICE_MM); out.i32(DEVICE_MM); // and in millimetres
  out.u32(0); out.u32(0); out.u32(0); // no pixel format, not OpenGL
  out.i32(DEVICE_MM * 1000); out.i32(DEVICE_MM * 1000); // device size in micrometres
  end();

  // ---- page: hundredths of a point mapped onto the picture's real size
  rec(EMR.SETMAPMODE, 8); // MM_ANISOTROPIC
  rec(EMR.SETWINDOWORGEX, 0, 0);
  rec(EMR.SETWINDOWEXTEX, Math.round(W * UNIT), Math.round(H * UNIT));
  rec(EMR.SETVIEWPORTORGEX, 0, 0);
  rec(EMR.SETVIEWPORTEXTEX, Math.round(mmW * 10), Math.round(mmH * 10));
  rec(EMR.SETBKMODE, 1); // transparent text background
  rec(EMR.SETPOLYFILLMODE, 2); // non-zero winding, as on screen
  rec(EMR.SETTEXTALIGN, 24); // x, y is the start of the baseline

  // ---- pens, brushes and fonts, each created when it changes (two slots so the old one can be deleted)
  const slots = { pen: [1, 2], brush: [3, 4], font: [5, 6] };
  const cur: Record<'pen' | 'brush' | 'font', { key: string; slot: number } | null> = { pen: null, brush: null, font: null };
  const use = (kind: 'pen' | 'brush' | 'font', key: string, create: (slot: number) => void) => {
    const c = cur[kind];
    if (c && c.key === key) return;
    const slot = c && c.slot === slots[kind][0] ? slots[kind][1] : slots[kind][0];
    create(slot);
    rec(EMR.SELECTOBJECT, slot);
    if (c && c.slot > 0) rec(EMR.DELETEOBJECT, c.slot);
    cur[kind] = { key, slot };
  };
  const stock = (kind: 'pen' | 'brush', obj: number) => {
    const c = cur[kind];
    if (c && c.key === 'none') return;
    begin(EMR.SELECTOBJECT); out.u32(obj); end();
    if (c && c.slot > 0) rec(EMR.DELETEOBJECT, c.slot);
    cur[kind] = { key: 'none', slot: -1 };
  };
  let textColor = -1;

  const path = (segs: Seg[]) => {
    rec(EMR.BEGINPATH);
    for (let i = 0; i < segs.length; i++) {
      const s = segs[i];
      if (s.k === 'M') rec(EMR.MOVETOEX, X(s.x), Y(s.y));
      else if (s.k === 'L') rec(EMR.LINETO, X(s.x), Y(s.y));
      else if (s.k === 'Z') rec(EMR.CLOSEFIGURE);
      else {
        // runs of curves go in one record
        const run: Extract<Seg, { k: 'C' }>[] = [];
        while (i < segs.length && segs[i].k === 'C') run.push(segs[i++] as Extract<Seg, { k: 'C' }>);
        i--;
        begin(EMR.POLYBEZIERTO);
        const pts = run.flatMap((c) => [[X(c.x1), Y(c.y1)], [X(c.x2), Y(c.y2)], [X(c.x), Y(c.y)]]);
        out.i32(Math.min(...pts.map((p) => p[0]))); out.i32(Math.min(...pts.map((p) => p[1])));
        out.i32(Math.max(...pts.map((p) => p[0]))); out.i32(Math.max(...pts.map((p) => p[1])));
        out.u32(pts.length);
        for (const [x, y] of pts) { out.i32(x); out.i32(y); }
        end();
      }
    }
    rec(EMR.ENDPATH);
  };
  const bounds = () => { out.i32(0); out.i32(0); out.i32(Math.round(W * UNIT)); out.i32(Math.round(H * UNIT)); };

  for (const it of items) {
    // pictures go with the PNG copy on the clipboard, not in the EMF
    if (it.kind === 'image') continue;
    if (it.kind === 'path') {
      if (!it.segs.some((s) => s.k !== 'M')) continue;
      if (it.fill) {
        const c = colorRef(it.fill);
        if (c === null) continue;
        use('brush', 'b' + c, (slot) => { begin(EMR.CREATEBRUSHINDIRECT); out.u32(slot); out.u32(0); out.u32(c); out.u32(0); end(); });
        stock('pen', NULL_PEN);
        path(it.segs);
        begin(EMR.FILLPATH); bounds(); end();
      } else if (it.stroke) {
        const c = colorRef(it.stroke.color);
        if (c === null) continue;
        const w = Math.max(1, Math.round(it.stroke.width * UNIT));
        const cap = it.stroke.cap === 'round' ? 0 : it.stroke.cap === 'square' ? 0x100 : 0x200;
        const join = it.stroke.join === 'round' ? 0 : it.stroke.join === 'bevel' ? 0x1000 : 0x2000;
        use('pen', `p${c}/${w}/${cap}/${join}`, (slot) => {
          begin(EMR.EXTCREATEPEN);
          out.u32(slot); out.u32(0); out.u32(0); out.u32(0); out.u32(0); // no bitmap
          out.u32(0x00010000 | cap | join); // geometric solid pen
          out.u32(w);
          out.u32(0); out.u32(c); out.u32(0); // solid brush of this colour
          out.u32(0); // no dash pattern (dashes are already cut into pieces)
          end();
        });
        stock('brush', NULL_BRUSH);
        path(it.segs);
        begin(EMR.STROKEPATH); bounds(); end();
      }
    } else {
      const c = colorRef(it.color);
      if (c === null || !it.text) continue;
      const height = Math.round(it.size * UNIT);
      use('font', `${it.family}/${height}/${it.bold}/${it.italic}`, (slot) => {
        begin(EMR.EXTCREATEFONTINDIRECTW);
        out.u32(slot);
        // LOGFONTW
        out.i32(-height); out.i32(0); out.i32(0); out.i32(0);
        out.i32(it.bold ? 700 : 400);
        out.u8(it.italic ? 1 : 0); out.u8(0); out.u8(0);
        out.u8(1); // DEFAULT_CHARSET
        out.u8(4); // OUT_TT_PRECIS
        out.u8(0); out.u8(0); // default clipping and quality
        out.u8(0x22); // variable pitch, Swiss family
        out.utf16(fontName(it.family), 32);
        // the rest of LogFontPanose: full name, style, version fields and PANOSE, all unset
        out.utf16('', 64); out.utf16('', 32);
        for (let i = 0; i < 6; i++) out.u32(0);
        for (let i = 0; i < 12; i++) out.u8(0);
        end();
      });
      if (c !== textColor) { rec(EMR.SETTEXTCOLOR, c); textColor = c; }
      const chars = [...it.text];
      const units: string[] = [];
      const dx: number[] = [];
      chars.forEach((ch, i) => {
        // characters beyond the basic plane take two UTF-16 units; the advance goes on the first
        for (let k = 0; k < ch.length; k++) { units.push(ch[k]); dx.push(k === 0 ? it.widths[i] ?? 0 : 0); }
      });
      // advances are rounded so they add up to the full width without drift
      let acc = 0, prev = 0;
      const dxUnits = dx.map((w) => { acc += w * UNIT; const r = Math.round(acc) - prev; prev += r; return r; });
      begin(EMR.EXTTEXTOUTW);
      const x = X(it.x), y = Y(it.y), tw = dx.reduce((a, b) => a + b, 0) * UNIT;
      out.i32(x); out.i32(y - it.size * UNIT); out.i32(x + tw); out.i32(y + it.size * 0.3 * UNIT); // bounds
      out.u32(1); // GM_COMPATIBLE
      out.f32((25.4 / 72 / UNIT) * 100); out.f32((25.4 / 72 / UNIT) * 100); // page units to 0.01 mm
      out.i32(x); out.i32(y); // reference point
      out.u32(units.length);
      const offString = 76;
      const offDx = offString + Math.ceil((units.length * 2) / 4) * 4;
      out.u32(offString);
      out.u32(0); // no options
      out.i32(0); out.i32(0); out.i32(-1); out.i32(-1); // no clipping rectangle
      out.u32(offDx);
      out.utf16(units.join(''), units.length);
      out.pad4();
      for (const d of dxUnits) out.i32(d);
      end();
    }
  }

  // put the stock pen, brush and font back before deleting ours
  const stocks = { pen: NULL_PEN, brush: NULL_BRUSH, font: SYSTEM_FONT };
  for (const kind of ['pen', 'brush', 'font'] as const) {
    const c = cur[kind];
    if (!c || c.slot < 0) continue;
    begin(EMR.SELECTOBJECT); out.u32(stocks[kind]); end();
    rec(EMR.DELETEOBJECT, c.slot);
  }
  begin(EMR.EOF); out.u32(0); out.u32(16); out.u32(20); end();

  out.setU32(bytesAt, out.length);
  out.setU32(recordsAt, records);
  return out.bytes();
}

/** Windows colour (0x00BBGGRR); null for fully transparent. Partly transparent colours are mixed with white. */
function colorRef(css: string): number | null {
  const { r, g, b, a } = parseColor(css);
  if (a <= 0.01) return null;
  const mix = (v: number) => Math.round(v * a + 255 * (1 - a));
  return mix(r) | (mix(g) << 8) | (mix(b) << 16);
}

/** The font Office should use: the first named family, with generic names mapped to Arial. */
function fontName(family: string): string {
  const f = family.trim();
  return !f || /^(sans-serif|system-ui|helvetica)$/i.test(f) ? 'Arial' : f.slice(0, 31);
}
