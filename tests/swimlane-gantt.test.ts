// @vitest-environment jsdom
//
// The Visio-style diagrams: a swimlane (cross-functional) flowchart from "Lane: step" lines, and a
// Gantt chart and timeline with dates from "Task: Feb – Apr 2026" lines, each placed on one scale
// of days (or numbered steps). Words typed into their shapes go back into the text, keeping the
// lane and the dates.

import { describe, expect, it } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { Doc, type Shape } from '../src/model';
import { POINTS } from '../src/editor/arrange';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { DIAGRAM_BY_ID, diagramParts, laneSplit, newDiagram, putDiagram, textFromShapes, type DiagramData } from '../src/design/diagrams';
import { schedule, scaleTicks, splitWhen } from '../src/design/schedule';

const words = (s: Pick<Shape, 'text'>) => s.text?.runs.map((r) => r.text).join('') ?? '';
const day = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d) / 86400000;

describe('when things happen', () => {
  it('splits a task from its when at the last colon whose rest is one', () => {
    expect(splitWhen('Ligand synthesis: Feb – Apr 2026')).toEqual({ label: 'Ligand synthesis', when: 'Feb – Apr 2026' });
    expect(splitWhen('Screen at 3:1 ratio: Week 2')).toEqual({ label: 'Screen at 3:1 ratio', when: 'Week 2' });
    expect(splitWhen('Note: read the paper')).toBeNull();
    expect(splitWhen('Synthesis')).toBeNull();
  });

  it('puts months, days and quarters on one scale of days, from the start of the first to the end of the last', () => {
    const { spans, scale } = schedule(['Feb – Apr 2026', '2026-05-04 – 2026-05-08', 'Q3 2026', 'Jul 2026', null, 'nonsense']);
    expect(spans[0]).toEqual({ start: day(2026, 2, 1), end: day(2026, 5, 1), milestone: false });
    expect(spans[1]).toEqual({ start: day(2026, 5, 4), end: day(2026, 5, 9), milestone: false });
    // a quarter alone is a milestone in its middle
    expect(spans[2]?.milestone).toBe(true);
    expect(spans[2]!.start).toBe((day(2026, 7, 1) + day(2026, 10, 1)) / 2);
    expect(spans[3]!.start).toBe((day(2026, 7, 1) + day(2026, 8, 1)) / 2);
    expect(spans[4]).toBeNull();
    expect(spans[5]).toBeNull();
    expect(scale).toMatchObject({ days: true, years: true, min: day(2026, 2, 1) });
  });

  it('a date without a year takes the one before, and a range running backwards runs into the next year', () => {
    const { spans } = schedule(['Sep 2025', 'Nov – Feb', '14 Mar', 'Mar 3 – Mar 5']);
    expect(spans[1]).toMatchObject({ start: day(2025, 11, 1), end: day(2026, 3, 1) });
    expect(spans[2]).toMatchObject({ start: day(2026, 3, 14), milestone: true });
    expect(spans[3]).toMatchObject({ start: day(2026, 3, 3), end: day(2026, 3, 6) });
  });

  it('numbered steps make their own scale, the word carried over ("Week 1 – 3")', () => {
    const { spans, scale } = schedule(['Week 1 – 3', 'Week 4', 'Jan 2026']);
    expect(spans[0]).toEqual({ start: 1, end: 4, milestone: false });
    expect(spans[1]).toEqual({ start: 4.5, end: 4.5, milestone: true });
    // a date doesn't go on a scale of weeks (the first line's kind)
    expect(spans[2]).toBeNull();
    expect(schedule(['Jan 2026', 'Week 2']).spans[1]).toBeNull();
    expect(scale).toMatchObject({ days: false, word: 'Week' });
    expect(scaleTicks(scale!, 10).map((t) => t.label)).toEqual(['Week 1', 'Week 2', 'Week 3', 'Week 4']);
  });

  it('marks the scale by months (with the year on January and the first), weeks or years', () => {
    const { scale } = schedule(['Nov 2025 – Feb 2026']);
    expect(scaleTicks(scale!, 20).map((t) => t.label)).toEqual(['Nov 2025', 'Dec', 'Jan 2026', 'Feb']);
    const short = schedule(['2026-03-02 – 2026-03-29']).scale!;
    expect(scaleTicks(short, 20).map((t) => t.label)).toEqual(['2 Mar', '9 Mar', '16 Mar', '23 Mar']);
    const long = schedule(['2020 – 2026']).scale!;
    expect(long.days).toBe(false);
    // and fewer of them when there isn't room
    expect(scaleTicks(schedule(['Jan – Dec 2026']).scale!, 4).length).toBeLessThanOrEqual(4);
  });
});

describe('a swimlane flowchart', () => {
  it('reads "Lane: step", a step without one staying in the lane before', () => {
    expect(laneSplit('Chemist: Run the reaction')).toEqual({ lane: 'Chemist', words: 'Run the reaction' });
    expect(laneSplit('Analyst:')).toEqual({ lane: 'Analyst', words: '' });
    expect(laneSplit('Run the reaction')).toBeNull();
  });

  it('draws a lane for each, a step in order in its lane, and an arrow from each step to the next', () => {
    const d = newDiagram('swimlane', 'Chemist: Start\nRun the reaction\nAnalyst: Pure enough?\nChemist: End');
    const { shapes, lines } = diagramParts(d);
    const steps = shapes.filter((s) => /^Item \d+$/.test(s.name ?? ''));
    expect(steps.map(words)).toEqual(['Start', 'Run the reaction', 'Pure enough?', 'End']);
    expect(steps.map((s) => s.geo)).toEqual(['fcTerminator', 'roundRect', 'fcDecision', 'fcTerminator']);
    // left to right, the analyst's step in the lane below
    const mid = (s: (typeof steps)[number]) => ({ x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 });
    expect(steps.map((s) => mid(s).x)).toEqual([...steps.map((s) => mid(s).x)].sort((a, b) => a - b));
    expect(mid(steps[2]).y).toBeGreaterThan(mid(steps[1]).y);
    expect(mid(steps[0]).y).toBe(mid(steps[1]).y);
    // the lanes' headings
    expect(shapes.filter((s) => !s.name && words(s)).map(words)).toEqual(['Chemist', 'Analyst']);
    // three arrows, glued to the steps, elbowed where they cross to another lane
    expect(lines.length).toBe(3);
    expect(lines.every((l) => l.headStyle === 'full' && l.from && l.to)).toBe(true);
    expect(lines.map((l) => !!l.elbow)).toEqual([false, true, true]);
  });

  it('keeps lanes in the order they are named, even one named before its first step', () => {
    const { shapes } = diagramParts(newDiagram('swimlane', 'Chemist:\nSupplier:\nAnalyst: NMR\nSupplier: Ship'));
    expect(shapes.filter((s) => !s.name && words(s)).map(words)).toEqual(['Chemist', 'Supplier', 'Analyst']);
  });

  it('with no lanes named, is one lane of steps', () => {
    const { shapes, lines } = diagramParts(newDiagram('swimlane', 'Mix\nHeat\nCool'));
    expect(shapes.filter((s) => s.name).length).toBe(3);
    expect(shapes.filter((s) => !s.name && words(s)).length).toBe(0);
    expect(lines.every((l) => !l.elbow)).toBe(true);
  });
});

describe('a Gantt chart', () => {
  const gantt = (text: string, look: Partial<DiagramData> = {}) => diagramParts(newDiagram('gantt', text, look));

  it('draws a row for each task with a bar over its months, under a scale of them', () => {
    const { shapes, lines } = gantt('Ligands: Jan – Mar 2026\nComplexes: Mar – Apr 2026\nPaper: Jun 2026');
    const labels = shapes.filter((s) => s.name).map(words);
    expect(labels).toEqual(['Ligands', 'Complexes', 'Paper']);
    const bars = shapes.filter((s) => s.geo === 'roundRect');
    expect(bars.length).toBe(2);
    // three months against two, Complexes starting where March starts
    expect((bars[0].x2 - bars[0].x1) / (bars[1].x2 - bars[1].x1)).toBeCloseTo(90 / 61, 1);
    expect(bars[1].x1).toBeGreaterThan(bars[0].x1);
    expect(bars[1].x1).toBeLessThan(bars[0].x2);
    expect(shapes.filter((s) => s.geo === 'diamond').length).toBe(1);
    // the months across the top, a pale line down from each
    expect(shapes.filter((s) => !s.name && words(s)).map(words)).toEqual(['Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun']);
    expect(lines.length).toBe(6);
  });

  it('a heading over indented tasks is a summary bar across them', () => {
    const { shapes } = gantt('Synthesis\n\tLigands: Jan – Feb 2026\n\tComplexes: Apr 2026');
    const summary = shapes.find((s) => s.geo === 'rect' && s.filled && !words(s) && !s.name)!;
    const ligands = shapes.find((s) => s.geo === 'roundRect')!;
    expect(summary.x1).toBeCloseTo(ligands.x1, 6);
    expect(summary.y2 - summary.y1).toBeLessThan(ligands.y2 - ligands.y1);
  });

  it('takes the words typed into a row back into the text, keeping its dates', () => {
    const doc = new Doc();
    const frame = doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('gantt', 'Ligands: Jan – Mar 2026\nScreen: Apr 2026'), { x: 0, y: 0 }));
    const f = doc.shapes.get(frame)!;
    const row = f.frame!.shapes.map((id) => doc.shapes.get(id)!).find((s) => s.name === 'Item 1')!;
    doc.edit('type', () => doc.updateShape(row.id, { text: { runs: [{ ...row.text!.runs[0], text: 'Phosphine ligands' }] } }));
    expect(textFromShapes(doc, doc.shapes.get(frame)!)).toBe('Phosphine ligands: Jan – Mar 2026\nScreen: Apr 2026');
  });
});

describe('a timeline with dates', () => {
  it('puts spans over the line in tracks that don\'t overlap, and milestones on it', () => {
    const d = newDiagram('dated-timeline', null);
    expect(DIAGRAM_BY_ID.get('dated-timeline')?.category).toBe('Timeline');
    const { shapes } = diagramParts(d);
    const bars = shapes.filter((s) => s.geo === 'roundRect');
    expect(bars.map(words)).toEqual(['Literature review', 'Ligand synthesis', 'Catalyst screening']);
    for (let i = 0; i < bars.length; i++) for (let j = i + 1; j < bars.length; j++) {
      const a = bars[i], b = bars[j];
      const overlap = Math.min(a.x2, b.x2) > Math.max(a.x1, b.x1) && Math.min(a.y2, b.y2) > Math.max(a.y1, b.y1);
      expect(overlap).toBe(false);
    }
    expect(shapes.filter((s) => s.geo === 'diamond').length).toBe(3);
    expect(shapes.filter((s) => s.name && s.geo === 'rect').map(words)).toEqual(['Funding starts', 'Candidacy exam', 'Paper submitted']);
  });

  it('with no dates, spaces its points evenly as the plain timeline does', () => {
    const d = newDiagram('dated-timeline', 'A\nB\nC');
    const plain = diagramParts({ ...d, layout: 'timeline' });
    const dated = diagramParts(d);
    expect(dated.shapes.map((s) => [s.geo, s.x1])).toEqual(plain.shapes.map((s) => [s.geo, s.x1]));
  });
});

describe('through PowerPoint', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 1]);
  const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
  const u8 = (s: string): Uint8Array => { const b = strToU8(s); const o = new Uint8Array(b.length); o.set(b); return o; };
  async function writeDeck(doc: Doc): Promise<Uint8Array> {
    const { Deck } = await import('../src/deck/deck');
    const deck = Deck.blank(new Doc());
    return writePptx({ size: deck.size, master: deck.master, slides: [{ layout: 'blank', doc, notes: '' }] }, opts);
  }

  it('a step retyped there keeps its lane', async () => {
    const doc = new Doc();
    doc.edit('d', () => putDiagram(doc, POINTS, newDiagram('swimlane', 'Chemist: Mix\nAnalyst: Weigh'), { x: 0, y: 0 }));
    const files = unzipSync(await writeDeck(doc));
    const out: Record<string, Uint8Array> = {};
    for (const [k, v] of Object.entries(files)) out[k] = /slide1\.xml$/.test(k) ? u8(strFromU8(v).replace('>Weigh<', '>Titrate<')) : new Uint8Array(v);
    const back = readPptx(zipSync(out)).slides[0].contents;
    expect(back.shapes.find((x) => x.diagram)!.diagram!.text).toBe('Chemist: Mix\nAnalyst: Titrate');
  });
});
