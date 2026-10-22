// TIFF pictures, the format many journals ask figures in. Written from the TIFF 6.0
// specification (Adobe, 1992): a baseline RGB file, 8 bits a channel, with an alpha channel
// when the picture is see-through, LZW-compressed in strips, and the resolution it was made at.

/** LZW compression as TIFF does it (section 13): 9 to 12 bit codes, most significant bit first, with the "early change". */
export function lzw(data: Uint8Array): Uint8Array {
  const CLEAR = 256, EOI = 257;
  let out = new Uint8Array(Math.max(64, data.length >> 1));
  let len = 0, acc = 0, bits = 0, width = 9;
  const put = (code: number) => {
    acc = (acc << width) | code;
    bits += width;
    while (bits >= 8) {
      if (len === out.length) { const next = new Uint8Array(out.length * 2); next.set(out); out = next; }
      out[len++] = (acc >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  };
  let table = new Map<number, number>();
  let next = 258;
  put(CLEAR);
  if (!data.length) { put(EOI); }
  else {
    let w = data[0];
    for (let i = 1; i < data.length; i++) {
      const k = data[i], key = (w << 8) | k;
      const hit = table.get(key);
      if (hit !== undefined) { w = hit; continue; }
      put(w);
      table.set(key, next++);
      // the code width grows when the table outgrows it; the reader, a code behind, sees this one
      // code early (TIFF's "early change")
      if (next === 512) width = 10;
      else if (next === 1024) width = 11;
      else if (next === 2048) width = 12;
      if (next === 4094) { put(CLEAR); table = new Map(); next = 258; width = 9; }
      w = k;
    }
    put(w);
    put(EOI);
  }
  if (bits > 0) {
    if (len === out.length) { const n2 = new Uint8Array(out.length + 1); n2.set(out); out = n2; }
    out[len++] = (acc << (8 - bits)) & 0xff;
  }
  return out.slice(0, len);
}

/**
 * A TIFF file from a canvas's pixels (red, green, blue, alpha, a row at a time). `alpha` keeps
 * the see-through parts; otherwise the alpha channel is dropped. `dpi` is written in the file.
 */
export function writeTiff(rgba: Uint8Array | Uint8ClampedArray, w: number, h: number, dpi: number, alpha: boolean): Uint8Array {
  const spp = alpha ? 4 : 3;
  const rowBytes = w * spp;
  const rowsPerStrip = Math.max(1, Math.min(h, Math.floor(65536 / Math.max(1, rowBytes))));
  const strips: Uint8Array[] = [];
  for (let y = 0; y < h; y += rowsPerStrip) {
    const rows = Math.min(rowsPerStrip, h - y);
    const raw = new Uint8Array(rows * rowBytes);
    for (let r = 0; r < rows; r++) {
      const src = (y + r) * w * 4;
      for (let x = 0; x < w; x++) {
        const s = src + x * 4, d = r * rowBytes + x * spp;
        raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2];
        if (alpha) raw[d + 3] = rgba[s + 3];
      }
    }
    strips.push(lzw(raw));
  }
  // layout: header, then the strips, then the bits-per-sample values, resolutions, strip tables, then the directory
  const SHORT = 3, LONG = 4, RATIONAL = 5;
  let at = 8;
  const stripAt: number[] = [];
  for (const s of strips) { stripAt.push(at); at += s.length + (s.length & 1); }
  const bpsAt = at; at += spp * 2;
  const xresAt = at; at += 8;
  const yresAt = at; at += 8;
  const many = strips.length > 1;
  const offsAt = at; if (many) at += strips.length * 4;
  const countsAt = at; if (many) at += strips.length * 4;
  const entries: [number, number, number, number][] = [
    [256, LONG, 1, w], // width
    [257, LONG, 1, h], // height
    [258, SHORT, spp, bpsAt], // bits per sample (8 each)
    [259, SHORT, 1, 5], // LZW
    [262, SHORT, 1, 2], // RGB
    [273, LONG, strips.length, many ? offsAt : stripAt[0]],
    [277, SHORT, 1, spp],
    [278, LONG, 1, rowsPerStrip],
    [279, LONG, strips.length, many ? countsAt : strips[0].length],
    [282, RATIONAL, 1, xresAt],
    [283, RATIONAL, 1, yresAt],
    [284, SHORT, 1, 1], // chunky
    [296, SHORT, 1, 2], // resolution in inches
  ];
  if (alpha) entries.push([338, SHORT, 1, 2]); // the extra channel is unassociated alpha
  const ifdAt = at;
  at += 2 + entries.length * 12 + 4;
  const out = new Uint8Array(at);
  const v = new DataView(out.buffer);
  out[0] = 0x49; out[1] = 0x49; v.setUint16(2, 42, true); v.setUint32(4, ifdAt, true);
  strips.forEach((s, i) => out.set(s, stripAt[i]));
  for (let i = 0; i < spp; i++) v.setUint16(bpsAt + i * 2, 8, true);
  // dots per inch as a fraction with a denominator of 100
  const res = Math.round(dpi * 100);
  v.setUint32(xresAt, res, true); v.setUint32(xresAt + 4, 100, true);
  v.setUint32(yresAt, res, true); v.setUint32(yresAt + 4, 100, true);
  if (many) strips.forEach((s, i) => { v.setUint32(offsAt + i * 4, stripAt[i], true); v.setUint32(countsAt + i * 4, s.length, true); });
  v.setUint16(ifdAt, entries.length, true);
  entries.forEach(([tag, type, count, value], i) => {
    const e = ifdAt + 2 + i * 12;
    v.setUint16(e, tag, true); v.setUint16(e + 2, type, true); v.setUint32(e + 4, count, true);
    // a single short sits in the first two bytes of the value; anything bigger than four bytes is an offset
    if (type === SHORT && count === 1) v.setUint16(e + 8, value, true);
    else v.setUint32(e + 8, value, true);
  });
  v.setUint32(ifdAt + 2 + entries.length * 12, 0, true);
  return out;
}
