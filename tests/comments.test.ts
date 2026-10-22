// @vitest-environment jsdom
//
// Comments in documents (Review > New Comment): where they sit in the text, how they follow
// editing, and how they are saved in Word files and opened again.

import { describe, it, expect } from 'vitest';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { newDocument, paraFromStyle, runStyleOf, type DocText } from '../src/document/document';
import { cmtIds, cmtString, commentRanges, commentSpan, initials, markComment, nextCommentId, placedComments, unmarkComment, type CommentThread } from '../src/document/comments';
import * as rt from '../src/richtext';
import { Doc, type TextRun } from '../src/model';
import { Deck } from '../src/deck/deck';
import { writePptx, type PptxOptions } from '../src/io/pptx-write';
import { readPptx } from '../src/io/pptx-read';
import { NS } from '../src/io/ooxml';
import { readModernComments, readCommentAuthors, readLegacyComments } from '../src/io/pptx-comments';
import type { PinnedComment } from '../src/document/comments';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const runsOf = (text: string): TextRun[] => [{ text }];
const on = (runs: TextRun[], id: number) => { const r = commentRanges(runs).get(id); return r ? rt.plainText(runs).slice(r.start, r.end) : null; };

describe('comment marks on the text', () => {
  it('keeps ids sorted and joined', () => {
    expect(cmtString([3, 1, 3])).toBe('1,3');
    expect(cmtString([])).toBeUndefined();
    expect(cmtIds('1,3')).toEqual([1, 3]);
    expect(cmtIds(undefined)).toEqual([]);
  });

  it('marks a stretch, and overlapping comments share text', () => {
    let runs = markComment(runsOf('The yield was 85%.'), 4, 9, 0);
    runs = markComment(runs, 0, 9, 1);
    expect(on(runs, 0)).toBe('yield');
    expect(on(runs, 1)).toBe('The yield');
    expect(rt.plainText(runs)).toBe('The yield was 85%.');
    runs = unmarkComment(runs, 1);
    expect(on(runs, 1)).toBeNull();
    expect(on(runs, 0)).toBe('yield');
    expect(unmarkComment(runs, 0)).toEqual(runsOf('The yield was 85%.'));
  });

  it('stays on its words when text is typed before them', () => {
    const runs = markComment(runsOf('stirred overnight'), 8, 17, 0);
    const typed = rt.replaceRange(runs, 0, 0, [{ text: 'was ' }]);
    expect(on(typed, 0)).toBe('overnight');
  });

  it('is not extended by typing just after it', () => {
    const runs = markComment(runsOf('yield here'), 0, 5, 0);
    expect(rt.typingStyle(runs, 5, 5, {}).cmt).toBeUndefined();
    // inside the comment, typing joins it
    expect(rt.typingStyle(runs, 3, 3, {}).cmt).toBe('0');
  });

  it('puts a new comment on the selection, else the word at the caret', () => {
    expect(commentSpan('The yield was', 4, 9)).toEqual([4, 9]);
    expect(commentSpan('The yield was', 6, 6)).toEqual([4, 9]);
    expect(commentSpan('The yield was', 9, 9)).toEqual([4, 9]);
    expect(commentSpan('a. b', 2, 2)).toEqual([1, 2]);
    expect(commentSpan('', 0, 0)).toBeNull();
    expect(commentSpan('\n\n', 1, 1)).toBeNull();
  });

  it('lists comments in the order of the text, leaving out those with no text', () => {
    let runs = markComment(runsOf('one two three'), 8, 13, 0);
    runs = markComment(runs, 0, 3, 1);
    const comments: Record<number, CommentThread> = { 0: { author: 'A', date: '', text: 'x' }, 1: { author: 'B', date: '', text: 'y' }, 2: { author: 'C', date: '', text: 'gone' } };
    expect(placedComments(runs, comments).map((p) => p.id)).toEqual([1, 0]);
    expect(nextCommentId(comments)).toBe(3);
    expect(nextCommentId(undefined)).toBe(0);
  });

  it('gives initials as Word does', () => {
    expect(initials("Nate O'Hare")).toBe('NO');
    expect(initials('ana')).toBe('AN');
    expect(initials('  ')).toBe('');
  });
});

describe('comments in Word files', () => {
  const NATE = { author: 'Nate', date: '2026-10-14T21:00:00Z' };
  const ANA = { author: 'Ana', date: '2026-10-14T22:00:00Z' };
  function sample(): DocText {
    const d = newDocument();
    const n = runStyleOf(d.styles.Normal);
    const text = 'The mixture was stirred for 2 h.\nThen filtered through Celite.';
    let runs: TextRun[] = [{ ...n, text }];
    runs = markComment(runs, text.indexOf('2 h'), text.indexOf('2 h') + 3, 0);
    // a comment over the paragraph break
    runs = markComment(runs, text.indexOf('stirred'), text.indexOf('Then') + 4, 1);
    return {
      ...d, runs, paras: [paraFromStyle(d.styles.Normal, {}), paraFromStyle(d.styles.Normal, {})],
      comments: {
        0: { ...NATE, text: 'Check the time\nin the notebook.', replies: [{ ...ANA, text: 'It was 16 h.' }] },
        1: { ...ANA, text: 'Reword?', done: true },
        // on no text: left out
        5: { ...NATE, text: 'orphan' },
      },
    };
  }

  it('writes Word\'s comments part, ranges and replies', async () => {
    const files = unzipSync(await writeDocx(sample(), deps));
    const body = strFromU8(files['word/document.xml']);
    const notes = strFromU8(files['word/comments.xml']);
    const ex = strFromU8(files['word/commentsExtended.xml']);
    expect(body).toContain('<w:commentRangeStart w:id="0"/>');
    // the reply (Word id 2, after the comments' own) shares its comment's range
    expect(body).toContain('<w:commentRangeStart w:id="2"/>');
    expect(body).toMatch(/<w:commentRangeEnd w:id="0"\/><w:r><w:commentReference w:id="0"\/><\/w:r>/);
    expect(body.match(/<w:commentRangeStart /g)?.length).toBe(3);
    expect(body.match(/<w:commentRangeEnd /g)?.length).toBe(3);
    // comment 1 opens in the first paragraph and closes in the second
    const paras = body.split('</w:p>');
    expect(paras.findIndex((p) => p.includes('commentRangeStart w:id="1"'))).toBeLessThan(paras.findIndex((p) => p.includes('commentRangeEnd w:id="1"')));
    expect(notes).toContain('w:author="Nate" w:date="2026-10-14T21:00:00Z" w:initials="NA"');
    expect(notes).toContain('in the notebook.');
    expect(notes).not.toContain('orphan');
    expect(ex).toMatch(/w15:paraIdParent="[0-9A-F]{8}"/);
    expect(ex).toContain('w15:done="1"');
    expect(strFromU8(files['[Content_Types].xml'])).toContain('wordprocessingml.comments+xml');
    expect(strFromU8(files['word/_rels/document.xml.rels'])).toContain('commentsExtended');
  });

  it('opens them again with their words, replies and Resolved marks', async () => {
    const before = sample();
    const back = (await readDocx(await writeDocx(before, deps))).doc;
    expect(rt.plainText(back.runs)).toBe(rt.plainText(before.runs));
    const placed = placedComments(back.runs, back.comments);
    const text = rt.plainText(back.runs);
    const byText = Object.fromEntries(placed.map((p) => [p.c.text, text.slice(p.start, p.end)]));
    expect(byText['Check the time\nin the notebook.']).toBe('2 h');
    expect(byText['Reword?']).toBe('stirred for 2 h.\nThen');
    expect(placed.length).toBe(2);
    const first = placed.find((p) => p.c.author === 'Nate')!.c;
    expect(first.replies).toEqual([{ author: 'Ana', date: '2026-10-14T22:00:00.000Z', text: 'It was 16 h.' }]);
    expect(placed.find((p) => p.c.text === 'Reword?')!.c.done).toBe(true);
    expect(first.done).toBeFalsy();
  });

  it('writes and reads Word\'s comment times as local clock time, preferring Word 365\'s UTC time', async () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    try {
      const files = unzipSync(await writeDocx(sample(), deps));
      // 21:00 UTC is 16:00 in Chicago in October; Word shows w:date as it stands
      expect(strFromU8(files['word/comments.xml'])).toContain('w:date="2026-10-14T16:00:00Z"');
      const back = (await readDocx(zipSync(files))).doc;
      expect(Object.values(back.comments ?? {}).map((c) => c.date)).toContain('2026-10-14T21:00:00.000Z');
      // a file from Word 365: its UTC time wins over w:date
      // (copied so the zip library takes them as files)
      const u8 = (t: string) => { const b = strToU8(t), out = new Uint8Array(b.length); out.set(b); return out; };
      // (a comment is known by its last paragraph)
      const first = /<w:comment w:id="0"[^]*?<\/w:comment>/.exec(strFromU8(files['word/comments.xml']))![0];
      const para = [...first.matchAll(/w14:paraId="([0-9A-F]+)"/g)].pop()![1];
      files['word/commentsIds.xml'] = u8(`<w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"><w16cid:commentId w16cid:paraId="${para}" w16cid:durableId="1257A547"/></w16cid:commentsIds>`);
      files['word/commentsExtensible.xml'] = u8('<w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"><w16cex:commentExtensible w16cex:durableId="1257A547" w16cex:dateUtc="2026-10-14T21:30:00Z"/></w16cex:commentsExtensible>');
      files['word/_rels/document.xml.rels'] = u8(strFromU8(files['word/_rels/document.xml.rels']).replace('</Relationships>',
        '<Relationship Id="rIdX1" Type="http://schemas.microsoft.com/office/2016/09/relationships/commentsIds" Target="commentsIds.xml"/>' +
        '<Relationship Id="rIdX2" Type="http://schemas.microsoft.com/office/2018/08/relationships/commentsExtensible" Target="commentsExtensible.xml"/></Relationships>'));
      const word365 = (await readDocx(zipSync(files))).doc;
      expect(Object.values(word365.comments ?? {}).find((c) => c.author === 'Nate')?.date).toBe('2026-10-14T21:30:00.000Z');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });

  it('writes no comment parts for a document without comments', async () => {
    const d = newDocument();
    d.runs = [{ ...runStyleOf(d.styles.Normal), text: 'Plain' }];
    const files = unzipSync(await writeDocx(d, deps));
    expect(files['word/comments.xml']).toBeUndefined();
    expect(strFromU8(files['word/document.xml'])).not.toContain('comment');
    expect((await readDocx(await writeDocx(d, deps))).doc.comments).toBeUndefined();
  });
});

describe('comments on slides', () => {
  const opts: PptxOptions = { async picture() { return null; }, async svgToPng() { return PNG; } };
  const pinned = (over: Partial<PinnedComment> = {}): PinnedComment => ({ id: 0, x: 100, y: 50, author: 'Nate', date: '2026-10-14T21:00:00.000Z', text: 'Bigger structure?', ...over });

  it('are a step of the deck\'s Undo', () => {
    const d = Deck.blank(new Doc());
    d.attach();
    d.setComments([pinned()], 'New comment');
    expect(d.current!.comments?.length).toBe(1);
    d.setComments([pinned({ text: 'Changed' })], 'Edit comment');
    d.undo();
    expect(d.current!.comments?.[0].text).toBe('Bigger structure?');
    d.undo();
    expect(d.current!.comments).toBeUndefined();
    d.redo();
    expect(d.current!.comments?.[0].text).toBe('Bigger structure?');
  });

  it('go with a slide when it is duplicated', () => {
    const d = Deck.blank(new Doc());
    d.attach();
    d.setComments([pinned({ replies: [{ author: 'Ana', date: '', text: 'Yes' }] })]);
    d.duplicate();
    expect(d.slides[1].comments?.[0].replies?.[0].text).toBe('Yes');
    // a copy, not the same list
    expect(d.slides[1].comments).not.toBe(d.slides[0].comments);
  });

  it('are saved as PowerPoint comments and opened again with their replies and Resolved marks', async () => {
    const host = new Doc();
    const d = Deck.blank(host);
    d.attach();
    d.addSlide('blank');
    const comments = [
      pinned({ replies: [{ author: 'Ana', date: '2026-10-14T22:00:00.000Z', text: 'Agreed.\nWill fix.' }] }),
      pinned({ id: 1, x: 300.5, y: 200, author: 'Ana', text: 'Typo in title', done: true }),
    ];
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: s.notes, comments: i === 1 ? comments : undefined })) }, opts);
    const files = unzipSync(bytes);
    expect(strFromU8(files['ppt/commentAuthors.xml'])).toMatch(/<p:cmAuthor id="0" name="Nate" initials="NA" lastIdx="1"/);
    const cm = strFromU8(files['ppt/comments/comment2.xml']);
    expect(cm).toContain('<p:pos x="800" y="400"/>');
    expect(cm).toContain('dt="2026-10-14T21:00:00.000"');
    expect(cm).toContain('<p15:parentCm authorId="0" idx="1"/>');
    // every comment says its time is UTC, else PowerPoint takes it as local time
    expect(cm.match(/timeZoneBias="0"/g)).toHaveLength(3);
    expect(files['ppt/comments/comment1.xml']).toBeUndefined();
    expect(strFromU8(files['ppt/slides/_rels/slide2.xml.rels'])).toContain('../comments/comment2.xml');
    const back = readPptx(bytes);
    expect(back.slides[0].comments).toBeUndefined();
    const got = back.slides[1].comments!;
    expect(got.map((c) => [c.author, c.text, c.x, c.y, !!c.done])).toEqual([['Nate', 'Bigger structure?', 100, 50, false], ['Ana', 'Typo in title', 300.5, 200, true]]);
    expect(got[0].replies).toEqual([{ author: 'Ana', date: '2026-10-14T22:00:00.000Z', text: 'Agreed.\nWill fix.' }]);
    expect(got[0].date).toBe('2026-10-14T21:00:00.000Z');
  });

  it('reads PowerPoint\'s local comment times with their time-zone bias', () => {
    const parse = (x: string) => new DOMParser().parseFromString(x, 'application/xml');
    const P15 = 'http://schemas.microsoft.com/office/powerpoint/2012/main';
    const authors = readCommentAuthors(parse(`<p:cmAuthorLst xmlns:p="${NS.p}"><p:cmAuthor id="1" name="Nate" initials="N" lastIdx="1" clrIdx="0"/></p:cmAuthorLst>`));
    const list = readLegacyComments(parse(`<p:cmLst xmlns:p="${NS.p}"><p:cm authorId="1" dt="2026-10-22T02:36:30.459" idx="1"><p:pos x="10" y="10"/><p:text>Hi</p:text>` +
      `<p:extLst><p:ext uri="{C676402C-5697-4E1C-873F-D02D1690AC5C}"><p15:threadingInfo xmlns:p15="${P15}" timeZoneBias="300"/></p:ext></p:extLst></p:cm></p:cmLst>`), authors);
    expect(list[0].date).toBe('2026-10-22T07:36:30.459Z');
  });

  it('reads PowerPoint 365\'s newer comments', () => {
    const P188 = 'http://schemas.microsoft.com/office/powerpoint/2018/8/main';
    const parse = (x: string) => new DOMParser().parseFromString(x, 'application/xml');
    const authors = readCommentAuthors(parse(`<p188:authorLst xmlns:p188="${P188}"><p188:author id="{A1}" name="Nate O'Hare" initials="NO"/><p188:author id="{B2}" name="Ana" initials="A"/></p188:authorLst>`));
    const body = (t: string) => `<p188:txBody><a:bodyPr xmlns:a="${NS.a}"/><a:p xmlns:a="${NS.a}"><a:r><a:t>${t}</a:t></a:r></a:p></p188:txBody>`;
    const list = readModernComments(parse(`<p188:cmLst xmlns:p188="${P188}"><p188:cm id="{C1}" authorId="{A1}" created="2026-10-14T21:00:00.000" status="resolved">` +
      `<p188:replyLst><p188:reply id="{R1}" authorId="{B2}" created="2026-10-14T22:00:00.000">${body('Done')}</p188:reply></p188:replyLst>${body('Check yield')}</p188:cm></p188:cmLst>`), authors);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ author: "Nate O'Hare", text: 'Check yield', done: true, date: '2026-10-14T21:00:00.000Z', replies: [{ author: 'Ana', text: 'Done' }] });
    expect(list[0].x).toBeGreaterThanOrEqual(0);
  });

  it('opens a file whose comments part is damaged, without them', async () => {
    const d = Deck.blank(new Doc());
    d.attach();
    const bytes = await writePptx({ size: d.size, master: d.master, slides: d.slides.map((s, i) => ({ layout: s.layout, doc: d.docOf(i), notes: '', comments: [pinned()] })) }, opts);
    const files = unzipSync(bytes);
    files['ppt/comments/comment1.xml'] = strToU8('<p:cmLst');
    const back = readPptx(zipSync(files));
    expect(back.slides).toHaveLength(1);
    expect(back.slides[0].comments).toBeUndefined();
  });
});
