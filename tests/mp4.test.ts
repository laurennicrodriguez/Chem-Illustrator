// @vitest-environment jsdom
//
// The MP4 container written round the animation's video frames (src/morph/mp4.ts). The frames
// themselves come from the system's encoder; this checks the boxes a player reads to find them.

import { describe, it, expect } from 'vitest';
import { muxMp4 } from '../src/morph/mp4';
import { unzipSync, strFromU8 } from 'fflate';
import { Doc } from '../src/model';
import { defaultMaster } from '../src/deck/deck';
import { writePptx, videoTimingXml, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { dataUrl } from '../src/render/images';

/** Top-level boxes, and a box found by its path. */
function boxes(b: Uint8Array, start = 0, end = b.length): { type: string; at: number; size: number }[] {
  const dv = new DataView(b.buffer, b.byteOffset);
  const out = [];
  for (let o = start; o + 8 <= end;) {
    const size = dv.getUint32(o);
    out.push({ type: String.fromCharCode(...b.subarray(o + 4, o + 8)), at: o, size });
    o += size;
  }
  return out;
}
const SKIP: Record<string, number> = { stsd: 16, avc1: 86 };
function find(b: Uint8Array, path: string[]): { at: number; size: number } {
  let start = 0, end = b.length;
  let hit = { at: 0, size: 0 };
  for (const type of path) {
    const x = boxes(b, start, end).find((y) => y.type === type);
    if (!x) throw new Error('no ' + type);
    hit = x;
    start = x.at + (SKIP[type] ?? 8);
    end = x.at + x.size;
  }
  return hit;
}

describe('MP4 container', () => {
  const samples = [
    { data: new Uint8Array([0, 0, 0, 3, 0x65, 1, 2]), key: true },
    { data: new Uint8Array([0, 0, 0, 2, 0x41, 9]), key: false },
    { data: new Uint8Array([0, 0, 0, 2, 0x41, 8]), key: false },
  ];
  const avcC = new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 0]);
  const f = muxMp4(320, 240, 24, avcC, samples);
  const dv = new DataView(f.buffer);
  const stbl = ['moov', 'trak', 'mdia', 'minf', 'stbl'];

  it('is ftyp, mdat and moov, end to end', () => {
    expect(boxes(f).map((x) => x.type)).toEqual(['ftyp', 'mdat', 'moov']);
    const last = boxes(f).at(-1)!;
    expect(last.at + last.size).toBe(f.length);
  });

  it('points at the frames, keeps their sizes and marks the key frames', () => {
    const stco = find(f, [...stbl, 'stco']);
    const off = dv.getUint32(stco.at + 16);
    expect([...f.subarray(off, off + 13)]).toEqual([...samples[0].data, ...samples[1].data]);
    const stsz = find(f, [...stbl, 'stsz']);
    expect(dv.getUint32(stsz.at + 16)).toBe(3);
    expect([0, 1, 2].map((i) => dv.getUint32(stsz.at + 20 + 4 * i))).toEqual([7, 6, 6]);
    const stss = find(f, [...stbl, 'stss']);
    expect(dv.getUint32(stss.at + 12)).toBe(1);
    expect(dv.getUint32(stss.at + 16)).toBe(1);
  });

  it('carries the size, the stream description and the timing', () => {
    const avc1 = find(f, [...stbl, 'stsd', 'avc1']);
    expect(dv.getUint16(avc1.at + 32)).toBe(320);
    expect(dv.getUint16(avc1.at + 34)).toBe(240);
    const c = find(f, [...stbl, 'stsd', 'avc1', 'avcC']);
    expect([...f.subarray(c.at + 8, c.at + c.size)]).toEqual([...avcC]);
    const stts = find(f, [...stbl, 'stts']);
    expect(dv.getUint32(stts.at + 16)).toBe(3);
    expect(dv.getUint32(stts.at + 20)).toBe(3750); // 90 kHz / 24 fps
    const mdhd = find(f, ['moov', 'trak', 'mdia', 'mdhd']);
    expect(dv.getUint32(mdhd.at + 20)).toBe(90000);
    expect(dv.getUint32(mdhd.at + 24)).toBe(3 * 3750);
  });
});

describe('videos in PowerPoint', () => {
  it('start by themselves and repeat unless they play once', () => {
    const x = videoTimingXml([{ spid: 4, once: false }, { spid: 5, once: true }]);
    expect(x).toContain('presetClass="mediacall"');
    expect(x.match(/<p:spTgt spid="4"\/>/g)!.length).toBe(2);
    expect(x).toMatch(/<p:cTn id="\d+" repeatCount="indefinite" fill="hold" display="0">.*<p:spTgt spid="4"\/>/);
    const ids = [...x.matchAll(/<p:cTn id="(\d+)"/g)].map((m) => Number(m[1]));
    expect(ids).toEqual(ids.map((_, i) => i + 1));
    expect(videoTimingXml([])).toBe('');
  });
});

describe('an animation on a slide', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 40, 0, 0, 0, 30]);
  const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
  const mp4 = muxMp4(40, 30, 24, new Uint8Array([1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 0]), [{ data: new Uint8Array([0, 0, 0, 1, 0x65]), key: true }]);
  const save = () => {
    const doc = new Doc();
    doc.style = { ...defaultMaster().drawing } as Doc['style'];
    doc.edit('video', () => { doc.addShape({ kind: 'picture', x1: 100, y1: 100, x2: 400, y2: 325, src: dataUrl(PNG, 'image/png'), px: { w: 40, h: 30 }, video: { src: dataUrl(mp4, 'video/mp4') } }); });
    return writePptx({ size: { w: 960, h: 540 }, master: defaultMaster(), slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
  };

  it('is a PowerPoint video that plays by itself', async () => {
    const files = unzipSync(await save());
    const slide = strFromU8(files['ppt/slides/slide1.xml']);
    expect(slide).toContain('<a:videoFile r:link=');
    expect(slide).toContain('<p14:media');
    // PowerPoint's own extension id: with any other it ignores the embedded copy and looks for a linked file
    expect(slide).toContain('<p:ext uri="{DAA4B4D4-6D71-4841-9C94-3DE7FCFB9230}"><p14:media');
    expect(slide).toContain('presetClass="mediacall"');
    expect([...files['ppt/media/media1.mp4']]).toEqual([...mp4]);
    expect(strFromU8(files['[Content_Types].xml'])).toContain('Extension="mp4" ContentType="video/mp4"');
    const rels = strFromU8(files['ppt/slides/_rels/slide1.xml.rels']);
    expect(rels).toContain('relationships/media');
    expect(rels).toContain('relationships/video');
  });

  it('comes back as a video', async () => {
    const back = readPptx(await save());
    const pics = back.slides[0].contents.shapes.filter((s) => s.kind === 'picture');
    expect(pics).toHaveLength(1);
    expect(pics[0].video?.src).toBe(dataUrl(mp4, 'video/mp4'));
  });
});
