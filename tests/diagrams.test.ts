// @vitest-environment jsdom
//
// SmartArt-style diagrams (Insert ▸ Diagram): shapes and connectors drawn from lines of text inside
// an invisible frame that keeps the text and look, drawn again when either changes or the frame is
// resized, and saved as a group of shapes in PowerPoint and Word files (with words typed into the
// shapes there coming back into the text).

import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { POINTS } from '../src/editor/arrange';
import { shapeBox } from '../src/objects';
import { writeCdxml } from '../src/io/cdxml-write';
import { readCdxml } from '../src/io/cdxml';
import { fillFrameMembers } from '../src/editor/frames';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, objectRun, runStyleOf } from '../src/document/document';
import { geoDef, sectorBox, sectorId, sliceId } from '../src/design/geo';
import {
  DIAGRAM_COLOURS, DIAGRAM_LAYOUTS, diagramContents, diagramFrameOf, diagramParts, heldLines, newDiagram, parseOutline, putDiagram, refitDiagramFigures, refitDiagrams,
  setItemText, textFromShapes, ungroupDiagram, cleanDiagram, inkOn, type DiagramData,
} from '../src/design/diagrams';
import { selectionBox } from '../src/editor/arrange';

function put(d: DiagramData) {
  const doc = new Doc();
  const frame = doc.edit('d', () => putDiagram(doc, POINTS, d, { x: 50, y: 40 }));
  return { doc, frame, s: doc.shapes.get(frame)! };
}

const words = (s: Shape) => s.text?.runs.map((r) => r.text).join('') ?? '';

describe('the text', () => {
  it('makes a tree from Tabs or two spaces, taking out bullets typed in front, and reads [icon] names', () => {
    const items = parseOutline('First\n\tUnder first\n\t\tDeeper\n  Also under first\n\nSecond\n- Third\n[flask] Fourth');
    expect(items.map((x) => x.text)).toEqual(['First', 'Second', 'Third', 'Fourth']);
    expect(items[0].kids.map((x) => x.text)).toEqual(['Under first', 'Also under first']);
    expect(items[0].kids[0].kids[0]).toMatchObject({ text: 'Deeper', depth: 2, n: 3 });
    expect(items[3].icon).toBe('icon:flask');
    // a line's words change, its indent and icon stay
    expect(setItemText('A\n\t[x] B\nC', 2, 'Bee')).toBe('A\n\t[x] Bee\nC');
  });

  it('cleans what a file says, keeping what it can', () => {
    expect(cleanDiagram({ layout: 'cycle', text: 'a', colours: 'nope', accent: 'red', w: -1 })).toMatchObject({ layout: 'cycle', colours: 'accent', accent: '#4472c4', w: 400 });
    expect(cleanDiagram({ text: 1 })).toBeNull();
    expect(inkOn('#4472c4')).toBe('#ffffff');
    expect(inkOn('#dae3f3')).toBe('#000000');
  });
});

describe('layouts', () => {
  it('every layout draws in every colour scheme, inside its box, with all its words, at one size that fits', () => {
    for (const l of DIAGRAM_LAYOUTS) {
      for (const [colours] of DIAGRAM_COLOURS) {
        const d = newDiagram(l.id, null, { colours });
        const { shapes, lines } = diagramParts(d);
        expect(shapes.length, l.id).toBeGreaterThan(0);
        for (const s of shapes) {
          const b = shapeBox(s as Shape);
          expect(b.x1, `${l.id} ${colours}`).toBeGreaterThanOrEqual(-0.5);
          expect(b.y1, `${l.id} ${colours}`).toBeGreaterThanOrEqual(-0.5);
          expect(b.x2, `${l.id} ${colours}`).toBeLessThanOrEqual(d.w + 0.5);
          expect(b.y2, `${l.id} ${colours}`).toBeLessThanOrEqual(d.h + 0.5);
        }
        // every line of the text shows somewhere (but the icon names)
        const shown = shapes.map((s) => words(s as Shape)).join('\n');
        for (const it of l.sample.split('\n')) expect(shown, l.id).toContain(it.trim().replace(/^\[[a-z-]+\]\s*/, '').replace(/[_^]/g, '').slice(0, 4));
        const sizes = new Set(shapes.flatMap((s) => (s.text?.runs ?? []).filter((r) => !r.sub && !r.sup && r.text !== '\n').map((r) => r.size)));
        for (const z of sizes) expect(z!, l.id).toBeGreaterThanOrEqual(4);
        if (l.id === 'cycle') expect(lines.every((x) => x.sweep && x.headStyle === 'full')).toBe(true);
        if (l.id === 'org') expect(lines.every((x) => x.elbow && x.from && x.to)).toBe(true);
      }
    }
  });

  it('gives the item shapes of one diagram one text size (as SmartArt does)', () => {
    const { shapes } = diagramParts(newDiagram('process', 'A\nA much longer step name\nC'));
    const heads = shapes.filter((s) => s.name?.startsWith('Item ')).map((s) => s.text!.runs[0].size);
    expect(new Set(heads).size).toBe(1);
  });

  it('a fixed text size is kept', () => {
    const { shapes } = diagramParts(newDiagram('blocks', 'One\nTwo', { size: 13 }));
    expect(shapes.every((s) => s.text!.runs.every((r) => r.size === 13))).toBe(true);
  });

  it('puts the lines under an item in its shape as bullets, and formulas get subscripts', () => {
    const { shapes } = diagramParts(newDiagram('blocks', 'Reagents\n\tCH2Cl2\n\t\tdry'));
    const s = shapes[0];
    expect(words(s as Shape)).toBe('Reagents\nCH2Cl2\ndry');
    expect(s.text!.paras).toEqual([{}, { list: 'bullet', align: 'left' }, { list: 'bullet', align: 'left', level: 1 }]);
    expect(s.text!.runs.find((r) => r.text === '2')?.sub).toBe(true);
    expect(s.name).toBe('Items 1-3');
    expect(heldLines(s)).toEqual([1, 2, 3]);
  });

  it('draws pyramid layers as trapeziums narrowing upwards (or downwards in a funnel)', () => {
    const up = geoDef(sliceId(0.25)).draw(100, 20).body;
    expect(up[0]).toEqual(['M', 25, 0]);
    const down = geoDef(sliceId(-0.25)).draw(100, 20).body;
    expect(down[2]).toEqual(['L', 75, 20]);
    const { shapes } = diagramParts(newDiagram('pyramid', 'a\nb\nc'));
    expect(shapes[0].geo).toBe(sliceId(0.5));
  });

  it('draws ring pieces to fill their own box, round the right way', () => {
    // the top half of a ring: as wide as the ring, half as high
    const b = sectorBox(Math.PI, 2 * Math.PI, 0.5);
    expect([b.x1, b.y1, b.x2, b.y2].map((v) => Math.round(v * 1000) / 1000)).toEqual([-1, -1, 1, 0]);
    const body = geoDef(sectorId(180, 360, 0.5)).draw(200, 100).body;
    const pts = body.flatMap((s) => (s[0] === 'Z' ? [] : s[0] === 'C' ? [[s[5], s[6]]] : [[s[1], s[2]]]));
    for (const [x, y] of pts) { expect(x).toBeGreaterThanOrEqual(-1e-6); expect(x).toBeLessThanOrEqual(200 + 1e-6); expect(y).toBeGreaterThanOrEqual(-1e-6); expect(y).toBeLessThanOrEqual(100 + 1e-6); }
    expect(pts[0][0]).toBeCloseTo(0, 6);
    expect(Math.max(...pts.map((p) => p[1]))).toBeCloseTo(100, 6);
  });

  it('takes any number of items in the new layouts', () => {
    for (const layout of ['arch', 'arrow-circles', 'honeycomb', 'ring']) {
      for (const n of [1, 2, 5, 9]) {
        const text = Array.from({ length: n }, (_, i) => `Item ${i + 1}`).join('\n');
        const { shapes } = diagramParts(newDiagram(layout, text));
        const items = shapes.filter((s) => /^Item \d+$/.test(s.name ?? ''));
        expect(items.length, `${layout} ${n}`).toBe(n);
      }
    }
    // a bending process: a half turn of band round each circle, over one and under the next
    const { shapes } = diagramParts(newDiagram('arch', 'A\nB\nC'));
    expect(shapes.filter((s) => s.geo?.startsWith('sector:')).map((s) => s.geo)).toEqual([sectorId(180, 360, 0.6 / 0.76), sectorId(0, 180, 0.6 / 0.76), sectorId(180, 360, 0.6 / 0.76)]);
    // a ring with a middle when the others are indented under the first
    const ring = diagramParts(newDiagram('ring', 'Catalyst\n\tA\n\tB\n\tC')).shapes;
    expect(ring.filter((s) => s.geo?.startsWith('sector:')).length).toBe(3);
    expect(ring.filter((s) => s.geo === 'ellipse').length).toBe(1);
  });

  it('an item of just [] has no words, and keeps its place in the text', () => {
    const items = parseOutline('A\n[]\nC');
    expect(items.map((x) => x.text)).toEqual(['A', '', 'C']);
    const { shapes } = diagramParts(newDiagram('arch', 'A\n[]\nC'));
    const blank = shapes.find((s) => s.name === 'Item 2')!;
    expect(blank.text).toBeUndefined();
  });

  it('grows to give each item the room its structure needs, with the words underneath', () => {
    const d = newDiagram('process', 'A\nB\nC');
    const plain = diagramParts(d).shapes;
    const roomy = diagramParts({ ...d, figs: { 2: { w: 300, h: 200 } } }).shapes;
    const w = (ss: typeof plain) => Math.max(...ss.map((s) => s.x2)) - Math.min(...ss.map((s) => s.x1));
    expect(w(roomy)).toBeGreaterThan(w(plain) * 2);
    const b = roomy.find((s) => s.name === 'Item 2')!;
    expect(b.x2 - b.x1).toBeGreaterThan(300);
    expect(b.textValign).toBe('bottom');
  });
});

describe('structures in a diagram', () => {
  /** A diagram in a drawing with the refits an editor runs, and a two-atom structure at `at`. */
  function withStructure(layout: string, text: string, at: (s: Shape) => { x: number; y: number }, L = 80) {
    const { doc, frame } = put(newDiagram(layout, text));
    doc.beforeCommit = (b) => { refitDiagrams(doc, b, POINTS); refitDiagramFigures(doc, b, POINTS); };
    const item = doc.shapes.get(doc.shapes.get(frame)!.frame!.shapes.find((id) => doc.shapes.get(id)!.name === 'Item 2')!)!;
    const p = at(item);
    let a = 0;
    doc.edit('Draw', () => { a = doc.addAtom(p.x - L / 2, p.y, 6).id; const b = doc.addAtom(p.x + L / 2, p.y, 6).id; doc.addBond(a, b, 1); });
    return { doc, frame, a };
  }
  const mid = (s: Shape) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });

  it('keeps room for a structure dropped in an item, grows to fit it, and centres it there', () => {
    const { doc, frame, a } = withStructure('arch', 'A\nB\nC', mid, 200);
    const f = doc.shapes.get(frame)!;
    expect(f.diagram!.figs?.['2']).toBeDefined();
    expect(f.diagram!.figs!['2'].w).toBeGreaterThan(200);
    const item = doc.shapes.get(f.frame!.shapes.find((id) => doc.shapes.get(id)!.name === 'Item 2')!)!;
    const b = selectionBox(doc, { atoms: doc.fragmentOf(a), bonds: new Set(), captions: new Set(), arrows: new Set(), shapes: new Set() }, POINTS)!;
    // inside its circle
    expect(b.x1).toBeGreaterThan(item.x1);
    expect(b.x2).toBeLessThan(item.x2);
    expect((b.x1 + b.x2) / 2).toBeCloseTo((item.x1 + item.x2) / 2, 0);
    // the structure belongs to the diagram, so it moves with it
    expect(f.frame!.atoms.length).toBe(1);
    expect(diagramContents(doc, f).sort()).toEqual([...doc.fragmentOf(a)].sort());
  });

  it('lets the structure go when it is dragged out', () => {
    const { doc, frame, a } = withStructure('process', 'A\nB\nC', mid, 40);
    expect(doc.shapes.get(frame)!.diagram!.figs).toBeDefined();
    doc.edit('Drag', () => doc.moveAtoms(doc.fragmentOf(a), 0, 2000));
    const f = doc.shapes.get(frame)!;
    expect(f.diagram!.figs).toBeUndefined();
    expect(f.frame!.atoms.length).toBe(0);
  });

  it('keeps its structure in place when the text or look changes', () => {
    const { doc, frame, a } = withStructure('honeycomb', 'A\nB\nC', mid, 40);
    const f = doc.shapes.get(frame)!;
    doc.edit('Change', () => putDiagram(doc, POINTS, { ...f.diagram!, colours: 'light', accent: '#584a81' }, { x: f.x1, y: f.y1 }, frame));
    const g = doc.shapes.get(frame)!;
    expect(g.diagram!.figs?.['2']).toBeDefined();
    const item = doc.shapes.get(g.frame!.shapes.find((id) => doc.shapes.get(id)!.name === 'Item 2')!)!;
    const at = doc.atoms.get(a)!;
    expect(at.x).toBeGreaterThan(item.x1);
    expect(at.x).toBeLessThan(item.x2);
  });

  it('keeps its room through PowerPoint, and the structure stays an editable structure', async () => {
    const { doc } = withStructure('ring', 'A\nB\nC\nD', mid, 60);
    // structures go to PowerPoint as pictures holding the drawing
    const opts: PptxOptions = { async picture(d) { return { png: PNG, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', box: d.bounds()! }; }, async svgToPng() { return PNG; } };
    const back = readPptx(await writeDeck(doc, opts)).slides[0].contents;
    const f = back.shapes.find((x) => x.diagram)!;
    expect(f.diagram!.figs?.['2']).toBeDefined();
    expect(back.atoms.length).toBe(2);
    expect(back.bonds.length).toBe(1);
    const d = new Doc();
    d.restoreContents(back);
    expect(diagramContents(d, d.shapes.get(f.id)!).length).toBe(2);
  });

  it('reads only sensible rooms from a file', () => {
    expect(cleanDiagram({ layout: 'arch', text: 'a', figs: { 1: { w: 50, h: 40 }, x: { w: 1, h: 1 }, 2: { w: -3, h: 4 } } })?.figs).toEqual({ 1: { w: 50, h: 40 } });
  });
});

describe('in a drawing', () => {
  it('keeps the shapes in a frame that holds the text, and picks the whole diagram first', () => {
    const { doc, frame, s } = put(newDiagram('process', 'A\nB\nC'));
    expect(s.diagram?.text).toBe('A\nB\nC');
    expect(s.lineWidth).toBe(0);
    expect(s.frame!.shapes.length).toBe(5); // three boxes and two arrows between
    for (const id of s.frame!.shapes) expect(diagramFrameOf(doc, 'shape', id)).toBe(frame);
  });

  it('draws again to fill its frame when the frame is resized by hand', () => {
    const { doc, frame, s } = put(newDiagram('blocks', 'A\nB'));
    const before = s.frame!.shapes.map((id) => shapeBox(doc.shapes.get(id)!));
    doc.beforeCommit = (b) => refitDiagrams(doc, b, POINTS);
    doc.edit('Resize', () => doc.updateShape(frame, { x2: s.x2 + 200 }));
    const after = doc.shapes.get(frame)!;
    expect(after.diagram!.w).toBeGreaterThan(s.diagram!.w + 150);
    const now = after.frame!.shapes.map((id) => shapeBox(doc.shapes.get(id)!));
    expect(now[1].x2).toBeGreaterThan(before[1].x2 + 150);
  });

  it('takes words typed into one of its shapes into its text', () => {
    const { doc, frame, s } = put(newDiagram('blocks', 'A\n\tsub\nB'));
    doc.beforeCommit = (b) => refitDiagrams(doc, b, POINTS);
    const box = doc.shapes.get(s.frame!.shapes[1])!;
    expect(box.name).toBe('Item 3');
    doc.edit('Type', () => doc.updateShape(box.id, { text: { runs: [{ text: 'Bravo' }] } }));
    expect(doc.shapes.get(frame)!.diagram!.text).toBe('A\n\tsub\nBravo');
  });

  it('Convert to Shapes leaves plain shapes', () => {
    const { doc, frame } = put(newDiagram('process', 'A\nB'));
    let ids: number[] = [];
    doc.edit('Convert', () => { ids = ungroupDiagram(doc, frame); });
    expect(doc.shapes.has(frame)).toBe(false);
    expect(ids.length).toBe(3);
    expect([...doc.shapes.values()].some((x) => x.diagram)).toBe(false);
  });

  it('comes back from a ChemDraw file with its text, round its shapes', () => {
    const { doc } = put(newDiagram('cycle', 'One\nTwo\nThree'));
    const back = readCdxml(writeCdxml(doc, { name: 't.cdxml' })).doc;
    fillFrameMembers(back);
    const f = [...back.shapes.values()].find((x) => x.diagram)!;
    expect(f.diagram!.layout).toBe('cycle');
    expect(f.frame!.shapes.length).toBe(3);
  });
});

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
const pptxOpts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
const u8 = (s: string): Uint8Array => { const b = strToU8(s); const o = new Uint8Array(b.length); o.set(b); return o; };

/** A zip with one of its text files changed. */
function edit(bytes: Uint8Array, path: RegExp, f: (x: string) => string): Uint8Array {
  const files = unzipSync(bytes);
  const out: Record<string, Uint8Array> = {};
  for (const [k, v] of Object.entries(files)) out[k] = path.test(k) ? u8(f(strFromU8(v))) : (() => { const o = new Uint8Array(v.length); o.set(v); return o; })();
  return zipSync(out);
}

describe('PowerPoint', () => {
  it('saves a diagram as one group of shapes and connectors, and opens it as a diagram again', async () => {
    const { doc } = put(newDiagram('org', 'Boss\n\tLeft\n\tRight'));
    const file = await writeDeck(doc);
    const slide = strFromU8(unzipSync(file)['ppt/slides/slide1.xml']);
    expect(slide.match(/<p:grpSp>/g)?.length).toBe(1);
    expect(slide).toContain('name="Diagram');
    const group = slide.slice(slide.indexOf('<p:grpSp>'), slide.indexOf('</p:grpSp>'));
    expect(group.match(/<p:sp>/g)?.length).toBe(3);
    expect(group.match(/<p:cxnSp>/g)?.length).toBe(2);
    const back = readPptx(file);
    const d = new Doc();
    d.restoreContents(back.slides[0].contents);
    const f = [...d.shapes.values()].find((x) => x.diagram)!;
    expect(f.diagram!.text).toBe('Boss\n\tLeft\n\tRight');
    expect(f.frame!.shapes.length).toBe(3);
    expect(f.frame!.arrows.length).toBe(2);
    // the connectors stay stuck to the boxes
    for (const id of f.frame!.arrows) expect(f.frame!.shapes).toContain(d.arrows.get(id)!.to!.shape);
    expect(textFromShapes(d, f)).toBe(f.diagram!.text);
  });

  it('takes words changed in PowerPoint into the text', async () => {
    const { doc } = put(newDiagram('process', 'Mix\nHeat'));
    const file = edit(await writeDeck(doc), /slide1\.xml$/, (x) => x.replace('>Heat<', '>Reflux<'));
    const back = readPptx(file);
    const f = back.slides[0].contents.shapes.find((x) => x.diagram)!;
    expect(f.diagram!.text).toBe('Mix\nReflux');
  });

  it('draws a curved arrow as a curve', async () => {
    const { doc } = put(newDiagram('cycle', 'A\nB\nC'));
    const slide = strFromU8(unzipSync(await writeDeck(doc))['ppt/slides/slide1.xml']);
    expect(slide.match(/name="Curved Arrow/g)?.length).toBe(3);
    // and comes back as the same curved arrow
    const back = readPptx(await writeDeck(doc)).slides[0].contents;
    const before = [...doc.arrows.values()][0], after = back.arrows.find((x) => x.sweep)!;
    expect(after.sweep).toBeCloseTo(before.sweep, 6);
    expect(after.tail.x).toBeCloseTo(before.tail.x, 0);
    expect(after.head.y).toBeCloseTo(before.head.y, 0);
  });
});

async function writeDeck(doc: Doc, opts = pptxOpts): Promise<Uint8Array> {
  const { Deck } = await import('../src/deck/deck');
  const host = new Doc();
  const deck = Deck.blank(host);
  return writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
}

describe('Word', () => {
  const deps: DocxDeps = {
    async picture(c) {
      const d = new Doc();
      d.restoreContents(c);
      const b = d.bounds()!;
      return { png: PNG, w: b.x2 - b.x1, h: b.y2 - b.y1, x: b.x1, y: b.y1 };
    },
    async svgToPng() { return PNG; },
  };
  const docWith = (d: DiagramData) => {
    const x = new Doc();
    x.edit('d', () => putDiagram(x, POINTS, d, { x: 0, y: 0 }));
    const t = newDocument();
    const n = runStyleOf(t.styles.Normal);
    return { ...t, objects: { 1: { kind: 'drawing' as const, contents: x.contents() } }, runs: [objectRun(1, n)] };
  };

  it('saves a diagram as a group of Word shapes, with the picture for older Words', async () => {
    const body = strFromU8(unzipSync(await writeDocx(docWith(newDiagram('process', 'Mix\nHeat')), deps))['word/document.xml']);
    expect(body).toContain('<mc:Choice Requires="wpg">');
    expect(body).toContain('<wpg:wgp>');
    expect(body.match(/<wps:wsp>/g)?.length).toBe(3);
    expect(body).toContain('<w:t xml:space="preserve">Heat</w:t>');
    expect(body).toContain('<mc:Fallback><w:drawing>');
    expect(new DOMParser().parseFromString(body, 'application/xml').getElementsByTagName('parsererror').length).toBe(0);
  });

  it('opens it as the diagram again, with words changed in Word (even once Word has replaced the picture)', async () => {
    const file = edit(await writeDocx(docWith(newDiagram('process', 'Mix\nHeat')), deps), /word\/document\.xml$/, (x) =>
      x.replace('>Heat<', '>Reflux<').replace(/<mc:Fallback>.*?<\/mc:Fallback>/, '<mc:Fallback><w:pict/></mc:Fallback>'));
    const { doc } = await readDocx(file);
    const o = Object.values(doc.objects).find((x) => x.kind === 'drawing');
    expect(o?.kind).toBe('drawing');
    const f = o!.kind === 'drawing' ? o!.contents.shapes.find((x) => x.diagram) : undefined;
    expect(f?.diagram?.text).toBe('Mix\nReflux');
    // drawn again with the new words
    expect(o!.kind === 'drawing' && o!.contents.shapes.some((x) => words(x) === 'Reflux')).toBe(true);
  });
});
