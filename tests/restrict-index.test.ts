// @vitest-environment jsdom
//
// Restrict Editing (Review > Restrict Editing): a protected document can be changed only in the
// way chosen (not at all, comments, tracked changes, form fields), with Word's password hash;
// form fields; and the index and table of authorities (References > Mark Entry, Insert Index,
// Mark Citation, Insert Table of Authorities), all kept in Word files.

import { describe, it, expect } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { writeDocx, readDocx, type DocxDeps } from '../src/io/docx';
import { DocLayouter } from '../src/document/doc-layout';
import { DocFile } from '../src/document/doc-file';
import { fieldTexts, newDocument, objectRun, paraFromStyle, runStyleOf, EMPTY_FORM, type DocObject, type DocText } from '../src/document/document';
import { allowedEdit, legacyKey, passwordOpens, protection, wordHash } from '../src/document/protect';
import { authorities, indexItems, markAuthority, markIndex, paragraphsWith, parseIndex, parseTa, parseToa, parseXe, taInstr, toaItems, unmark, xeInstr, EMPTY_INDEX } from '../src/document/index-toa';
import { markComment } from '../src/document/comments';
import { decideEverywhere, trackedReplace } from '../src/document/revisions';
import * as rt from '../src/richtext';
import type { ParaStyle, TextRun } from '../src/model';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const deps: DocxDeps = { async picture() { return { png: PNG, w: 10, h: 10 }; }, async svgToPng() { return PNG; } };
const measure = (t: string, s: number) => t.length * s * 0.5;
const layouter = () => new DocLayouter({ measure, drawingSize: () => ({ w: 10, h: 10 }) });
const who = { author: 'Nate', date: '2026-10-22T20:00:00Z' };

/** Paragraphs of text, with objects at the end of some. */
function doc(texts: string[], extra: Partial<DocText> = {}, objs: Record<number, { para: number; o: DocObject }> = {}): DocText {
  const d = { ...newDocument(), ...extra };
  const n = runStyleOf(d.styles.Normal);
  const runs: TextRun[] = [];
  const paras: ParaStyle[] = [];
  const objects: Record<number, DocObject> = {};
  texts.forEach((x, p) => {
    if (p) runs.push({ ...n, text: '\n' });
    runs.push({ ...n, text: x });
    for (const [id, v] of Object.entries(objs)) if (v.para === p) { objects[+id] = v.o; runs.push(objectRun(+id, n)); }
    paras.push(paraFromStyle(d.styles.Normal, {}));
  });
  return { ...d, runs: rt.normalizeRuns(runs), paras, objects };
}

describe('passwords as Word hashes them', () => {
  it('makes the older key and the hash Word checks (as published, and as PHPWord makes them)', () => {
    expect(legacyKey('')).toBe('');
    expect(legacyKey('test')).toMatch(/^[0-9A-F]{8}$/);
    expect(wordHash('test', '', 'SHA-1', 10000)).toBe('M795/MAlmGU8RIsY9Q9uDLHC7bk=');
    expect(wordHash('test', 'uq81pJRRGFIY5U+E9gt8tA==', 'SHA-1', 10000)).toBe('QiDOcpia1YzSVJPiKPwWebl9p/0=');
  });

  it('protects with a new salt each time, and only the password stops it', { timeout: 30000 }, () => {
    const a = protection('readOnly', 'lab notebook'), b = protection('readOnly', 'lab notebook');
    expect(a.salt).not.toBe(b.salt);
    expect(a.alg).toBe('SHA-512');
    expect(a.spin).toBe(100000);
    expect(passwordOpens(a, 'lab notebook')).toBe(true);
    expect(passwordOpens(a, 'Lab notebook')).toBe(false);
    expect(passwordOpens(a, '')).toBe(false);
    // no password: anyone can stop it
    expect(protection('comments', '')).toEqual({ edit: 'comments' });
    expect(passwordOpens({ edit: 'comments' }, '')).toBe(true);
  });
});

describe('what each protection allows', () => {
  const base = doc(['The aldol reaction of 3 gave 4.', 'Yield 78%.']);
  const typed = (t: DocText) => ({ ...t, runs: rt.replaceRange(t.runs, 4, 4, [{ ...t.runs[0], text: 'new ' }]) });

  it('lets anything through when the document is not protected', () => {
    expect(allowedEdit(base, typed(base))).toBe(true);
  });

  it('read only: nothing, not even taking the protection off', () => {
    const d = { ...base, protect: { edit: 'readOnly' as const } };
    expect(allowedEdit(d, typed(d))).toBe(false);
    expect(allowedEdit(d, { ...d, protect: undefined })).toBe(false);
    expect(allowedEdit(d, { ...d, paras: d.paras.map((p) => ({ ...p, align: 'center' as const })) })).toBe(false);
    expect(allowedEdit(d, { ...d })).toBe(true);
  });

  it('comments: comments only', () => {
    const d = { ...base, protect: { edit: 'comments' as const } };
    const commented = { ...d, runs: markComment(d.runs, 4, 9, 1), comments: { 1: { author: 'Nate', date: who.date, text: 'Which aldol?' } } };
    expect(allowedEdit(d, commented)).toBe(true);
    expect(allowedEdit(d, typed(d))).toBe(false);
    expect(allowedEdit(commented, typed(commented))).toBe(false);
  });

  it('tracked changes: tracked edits and comments, but no accepting, no formatting, and tracking stays on', () => {
    const d = { ...base, track: true, protect: { edit: 'trackedChanges' as const } };
    const ins = { ...d, ...trackedReplace(d, 4, 4, [{ ...d.runs[0], text: 'new ' }], undefined, who).t };
    expect(allowedEdit(d, ins)).toBe(true);
    const del = { ...ins, ...trackedReplace(ins, 0, 3, [], undefined, who).t };
    expect(allowedEdit(ins, del)).toBe(true);
    // accepting the change makes it part of the text
    expect(allowedEdit(del, decideEverywhere(del, true))).toBe(false);
    expect(allowedEdit(d, typed(d))).toBe(false);
    expect(allowedEdit(d, { ...d, track: undefined })).toBe(false);
    expect(allowedEdit(d, { ...d, runs: rt.applyStyle(d.runs, 0, 3, { bold: true }) })).toBe(false);
  });

  it('filling in forms: the fields\' entries only', () => {
    const d = doc(['Name: ', 'Done '], { protect: { edit: 'forms' } }, { 1: { para: 0, o: { kind: 'form', type: 'text' } }, 2: { para: 1, o: { kind: 'form', type: 'check' } } });
    const filled = { ...d, objects: { ...d.objects, 1: { kind: 'form', type: 'text', value: 'N. O\'Hare' }, 2: { kind: 'form', type: 'check', checked: true } } } as DocText;
    expect(allowedEdit(d, filled)).toBe(true);
    expect(allowedEdit(d, typed(d))).toBe(false);
    // the field itself can't be changed (made a drop-down)
    expect(allowedEdit(d, { ...d, objects: { ...d.objects, 1: { kind: 'form', type: 'drop', items: ['a'] } } })).toBe(false);
  });

  it('turns changes away in the editor, Undo included, and says so', () => {
    const f = new DocFile(base);
    f.ed.setCaret(4);
    f.ed.type('x');
    expect(rt.plainText(f.t.runs).startsWith('The xaldol')).toBe(true);
    let refused = 0;
    f.onRefused = () => refused++;
    f.ed.update({ ...f.t, protect: { edit: 'readOnly' } }, 'Restrict Editing');
    f.ed.type('y');
    f.ed.backspace();
    f.ed.undo();
    expect(rt.plainText(f.t.runs).startsWith('The xaldol')).toBe(true);
    expect(f.t.protect?.edit).toBe('readOnly');
    expect(refused).toBe(3);
  });

  it('tracks what is typed in a document protected for tracked changes', () => {
    const f = new DocFile({ ...base, track: true, protect: { edit: 'trackedChanges' } });
    f.ed.setCaret(4);
    f.ed.type('crossed ');
    expect(f.t.runs.some((r) => r.rev?.startsWith('ins') && r.text === 'crossed ')).toBe(true);
  });
});

describe('form fields', () => {
  it('show their entry, a ticked or empty box, or the item chosen', () => {
    const d = doc(['a', 'b', 'c', 'd'], {}, {
      1: { para: 0, o: { kind: 'form', type: 'text' } }, 2: { para: 1, o: { kind: 'form', type: 'text', value: 'THF' } },
      3: { para: 2, o: { kind: 'form', type: 'check', checked: true } }, 4: { para: 3, o: { kind: 'form', type: 'drop', items: ['Pd', 'Ni'], value: 'Ni' } },
    });
    const f = fieldTexts(d);
    expect([f.get(1), f.get(2), f.get(3), f.get(4)]).toEqual([EMPTY_FORM, 'THF', '☒', 'Ni']);
  });
});

describe('the index', () => {
  const d0 = doc(['Aldol reaction of ketones.', 'Wittig reaction.', 'The aldol reaction again.', 'Enolates.', 'Ölefination.']);
  let d = markIndex(d0, 0, { main: 'Aldol reaction' }).t;
  d = markIndex(d, 1, { main: 'Wittig reaction' }).t;
  d = markIndex(d, 2, { main: 'aldol reaction', sub: 'asymmetric', bold: true }).t;
  d = markIndex(d, 3, { main: 'Enolates', see: 'See Aldol reaction' }).t;
  d = markIndex(d, 4, { main: 'Ölefination' }).t;
  const pages = ['1', '1', '2', '3', '3'];

  it('lists entries A to Z, ignoring case and accents, with subentries under them and each page once', () => {
    const items = indexItems(d, (p) => pages[p]);
    expect(items.map((i) => [i.level, i.text, i.pages.map((p) => p.label).join(','), i.see ?? ''])).toEqual([
      [1, 'Aldol reaction', '1', ''], [2, 'asymmetric', '2', ''], [1, 'Enolates', '', 'See Aldol reaction'], [1, 'Ölefination', '3', ''], [1, 'Wittig reaction', '1', ''],
    ]);
    expect(items[1].pages[0].bold).toBe(true);
    // a letter over each letter's entries
    expect(indexItems(d, (p) => pages[p], true).filter((i) => i.level === 0).map((i) => i.text)).toEqual(['A', 'E', 'O', 'W']);
  });

  it('marks every paragraph with the word (Mark All), each once', () => {
    expect(paragraphsWith(d0, 'aldol reaction')).toEqual([0, 2]);
    expect(paragraphsWith(d0, 'reaction')).toEqual([0, 1, 2]);
    expect(paragraphsWith(d0, 'act')).toEqual([]);
    const all = markIndex(d0, 0, { main: 'Aldol reaction' }, true);
    expect(all.count).toBe(2);
    expect(markIndex(all.t, 0, { main: 'Aldol reaction' }, true).count).toBe(0);
    expect(indexItems(unmark(all.t, -1, { xe: { main: 'aldol reaction' } }), () => '1')).toEqual([]);
  });

  it('keeps entries with the text as paragraphs are joined', () => {
    const f = new DocFile(d);
    const text = rt.plainText(f.t.runs);
    const at = text.indexOf('\n');
    f.ed.select(at, at + 1);
    f.ed.backspace();
    expect(f.t.paras[0].xe?.map((x) => x.main)).toEqual(['Aldol reaction', 'Wittig reaction']);
  });

  it('is laid out with its page numbers, and tells how to mark entries when there are none', () => {
    const withIndex = doc(['Aldol reaction.', ''], {}, { 9: { para: 1, o: { kind: 'index' } } });
    const marked = markIndex(withIndex, 0, { main: 'Aldol reaction' }).t;
    const lay = layouter().layout(marked);
    const text = lay.text.lines.filter((l) => l.block === 9).map((l) => l.pieces.filter((p) => p.obj === undefined).map((p) => p.text).join('')).join('|');
    expect(text).toBe('Aldol reaction, 1');
    const empty = layouter().layout(withIndex);
    expect(empty.text.lines.filter((l) => l.block === 9).map((l) => l.pieces.map((p) => p.text).join('')).join(' ')).toContain(EMPTY_INDEX.slice(0, 30));
  });
});

describe('the table of authorities', () => {
  const d0 = doc(['See Brown v. Board.', 'Brown again.', 'The Clean Air Act.', 'Brown.', 'Brown.', 'Brown.', 'Brown.']);
  let d = markAuthority(d0, 0, { short: 'Brown', long: 'Brown v. Board of Education, 347 U.S. 483 (1954)', cat: 1 }).t;
  d = markAuthority(d, 2, { short: 'Clean Air Act', long: '42 U.S.C. § 7401 (1970)', cat: 2 }).t;
  d = markAuthority(d, 1, { short: 'Brown' }, true).t;

  it('keeps the long form and category on the first mark, and marks the rest by the short form', () => {
    expect(d.paras[0].ta).toEqual([{ short: 'Brown', long: 'Brown v. Board of Education, 347 U.S. 483 (1954)', cat: 1 }]);
    expect(d.paras[3].ta).toEqual([{ short: 'Brown' }]);
    expect(authorities(d).map((a) => [a.short, a.cat, a.paras.length])).toEqual([['Brown', 1, 6], ['Clean Air Act', 2, 1]]);
  });

  it('lists each category under its heading, with "passim" for five pages or more when asked', () => {
    const pages = ['1', '2', '3', '4', '5', '6', '7'];
    expect(toaItems(d, 0, (p) => pages[p]).map((i) => [i.text, i.pages.map((p) => p.label).join(', ')])).toEqual([
      ['Cases', ''], ['Brown v. Board of Education, 347 U.S. 483 (1954)', '1, 2, 4, 5, 6, 7'], ['Statutes', ''], ['42 U.S.C. § 7401 (1970)', '3'],
    ]);
    expect(toaItems(d, 1, (p) => pages[p], true)[1].pages).toEqual([{ label: 'passim', italic: true }]);
    expect(toaItems(d, 2, (p) => pages[p]).map((i) => i.text)).toEqual(['Statutes', '42 U.S.C. § 7401 (1970)']);
  });
});

describe('Word\'s fields', () => {
  it('writes and reads XE and TA fields, escapes and all', () => {
    const m = { main: 'Grignard: "turbo"', sub: 'LiCl', see: 'See Magnesium', bold: true };
    expect(xeInstr({ main: 'Aldol', sub: 'syn' })).toBe(' XE "Aldol:syn" ');
    expect(parseXe(xeInstr(m))).toEqual(m);
    expect(parseXe(' XE "Ketones:Aldol:syn" \\i ')).toEqual({ main: 'Ketones', sub: 'Aldol, syn', italic: true });
    const ta = { short: 'Brown', long: 'Brown v. Board "of" Ed.', cat: 1 };
    expect(parseTa(taInstr(ta))).toEqual(ta);
    expect(parseTa(' TA \\s "Brown" ')).toEqual({ short: 'Brown' });
    expect(parseIndex(' INDEX \\h "A" \\e "\t" \\c "2" \\z "1033" ')).toEqual({ cols: 2, right: true, letters: true });
    expect(parseIndex(' INDEX \\c "1" ')).toEqual({});
    expect(parseToa(' TOA \\h \\c "3" \\p ')).toEqual({ cat: 3, passim: true });
    expect(parseXe(' TOC \\o ')).toBeNull();
  });

  it('saves the protection, form fields, index entries, citations, the index and the table of authorities, and opens them again', { timeout: 30000 }, async () => {
    let d = doc(['Aldol reaction of ketones. Solvent: ', 'Brown v. Board.', 'Dry? ', 'Metal: ', ''], {}, {
      1: { para: 0, o: { kind: 'form', type: 'text', value: 'THF', name: 'Solvent', help: 'The solvent used' } },
      2: { para: 2, o: { kind: 'form', type: 'check', checked: true } },
      3: { para: 3, o: { kind: 'form', type: 'drop', items: ['Pd', 'Ni', 'Cu'], value: 'Ni' } },
      4: { para: 4, o: { kind: 'index', right: true, letters: true } },
      5: { para: 4, o: { kind: 'toa', cat: 0, passim: true } },
    });
    d = markIndex(d, 0, { main: 'Aldol reaction', sub: 'of ketones' }).t;
    d = markAuthority(d, 1, { short: 'Brown', long: 'Brown v. Board of Education, 347 U.S. 483 (1954)', cat: 1 }).t;
    d = { ...d, protect: protection('forms', 'pw') };
    const bytes = await writeDocx(d, { ...deps, pages: () => ['1', '1', '1', '1', '1'] });
    const files = unzipSync(bytes);
    const body = strFromU8(files['word/document.xml']);
    const settings = strFromU8(files['word/settings.xml']);
    expect(settings).toMatch(/<w:documentProtection w:edit="forms" w:enforcement="1" w:cryptProviderType="rsaAES" w:cryptAlgorithmClass="hash" w:cryptAlgorithmType="typeAny" w:cryptAlgorithmSid="14" w:cryptSpinCount="100000" w:hash="[^"]+" w:salt="[^"]+"\/>/);
    expect(settings.indexOf('documentProtection')).toBeLessThan(settings.indexOf('defaultTabStop'));
    expect(body).toContain(' XE &quot;Aldol reaction:of ketones&quot; ');
    expect(body).toContain(' TA \\l &quot;Brown v. Board of Education, 347 U.S. 483 (1954)&quot; \\s &quot;Brown&quot; \\c 1 ');
    expect(body).toContain(' INDEX \\h &quot;A&quot; \\e &quot;\t&quot; \\c &quot;1&quot; \\z &quot;1033&quot; ');
    expect(body).toContain(' TOA \\h \\c &quot;1&quot; \\p ');
    expect(body).toContain('<w:pStyle w:val="Index2"/>');
    expect(body).toContain('<w:ffData><w:name w:val="Solvent"/><w:enabled/><w:calcOnExit w:val="0"/><w:helpText w:type="text" w:val="The solvent used"/>');
    expect(body).toContain('<w:checkBox><w:sizeAuto/><w:default w:val="0"/><w:checked/></w:checkBox>');
    expect(body).toContain('<w:ddList><w:result w:val="1"/><w:listEntry w:val="Pd"/><w:listEntry w:val="Ni"/><w:listEntry w:val="Cu"/></w:ddList>');
    expect(strFromU8(files['word/styles.xml'])).toContain('<w:name w:val="toa heading"/>');

    const back = (await readDocx(bytes)).doc;
    expect(back.protect).toEqual(d.protect);
    expect(passwordOpens(back.protect!, 'pw')).toBe(true);
    expect(back.paras[0].xe).toEqual([{ main: 'Aldol reaction', sub: 'of ketones' }]);
    expect(back.paras[1].ta).toEqual(d.paras[1].ta);
    const objs = Object.values(back.objects);
    expect(objs.filter((o) => o.kind === 'form')).toEqual([
      { kind: 'form', type: 'text', name: 'Solvent', help: 'The solvent used', value: 'THF' },
      { kind: 'form', type: 'check', name: 'Check2', checked: true },
      { kind: 'form', type: 'drop', name: 'Dropdown3', items: ['Pd', 'Ni', 'Cu'], value: 'Ni' },
    ]);
    expect(objs.filter((o) => o.kind === 'index')).toEqual([{ kind: 'index', right: true, letters: true }]);
    expect(objs.filter((o) => o.kind === 'toa')).toEqual([{ kind: 'toa', cat: 1, passim: true }]);
    // the index's and table's lines are not kept as text as well
    expect(rt.plainText(back.runs).match(/Brown v\. Board/g)).toHaveLength(1);
    expect(rt.plainText(back.runs)).not.toContain('of ketones, 1');
  });
});
