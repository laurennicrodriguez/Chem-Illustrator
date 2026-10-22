// Review > Proofing in Document mode, as Word's: the Spelling and Grammar pane (F7) that goes
// through the document's misspelled words, grammar slips and chemistry formatting slips one by
// one (Ignore, Ignore All, Add to Dictionary, Change, Change All); the Thesaurus (Shift+F7), which
// looks a word up online (Datamuse, a free word-finding service; nothing else is sent); and Word
// Count (Ctrl+Shift+G) with pages, words, characters, paragraphs and lines.

import * as rt from '../richtext';
import type { DocFile } from '../document/doc-file';
import { countDocument } from '../document/word-count';
import type { Issue } from '../text/chemtext';
import { grammarIssues } from '../text/grammar';
import type { Speller } from '../text/spelling';
import { matchCase } from '../text/spelling';
import { FloatBox } from './float-box';

export interface DocProofingHost {
  file(): DocFile | null;
  speller(): Speller | null;
  /** The misspelled words and chemistry slips in the document's text (offsets in its text). */
  checks(): { spell: [number, number][]; issues: Issue[] };
  addWord(word: string): void;
  ignoreWord(word: string): void;
  /** Select some of the document's text and scroll it into view. */
  show(start: number, end: number): void;
  flash(msg: string, ms?: number): void;
  focus(): void;
}

/** One thing the Spelling and Grammar pane stops at. */
export interface ProofProblem {
  kind: 'spelling' | 'grammar' | 'chemistry';
  start: number;
  end: number;
  message: string;
  /** What it could be changed to, best first. */
  choices: string[];
  /** For a chemistry slip, the edits its fix makes. */
  issue?: Issue;
}

/** Every problem in the document's text, in order: spelling, grammar and chemistry formatting. */
export function proofProblems(text: string, spell: [number, number][], issues: Issue[], speller: Speller | null, grammar = true): ProofProblem[] {
  const out: ProofProblem[] = [];
  for (const [a, b] of spell) {
    const w = text.slice(a, b);
    out.push({ kind: 'spelling', start: a, end: b, message: 'Not in the dictionary', choices: speller?.suggestions(w) ?? [] });
  }
  for (const i of issues) out.push({ kind: 'chemistry', start: i.start, end: i.end, message: i.message, choices: [i.fixed], issue: i });
  if (grammar) {
    let at = 0;
    for (const para of text.split('\n')) {
      for (const g of grammarIssues(para)) out.push({ kind: 'grammar', start: g.start + at, end: g.end + at, message: g.message, choices: g.fix !== undefined ? [g.fix] : [] });
      at += para.length + 1;
    }
  }
  // a grammar slip inside a misspelled word is left for the spelling
  out.sort((a, b) => a.start - b.start || (a.kind === 'spelling' ? -1 : 1));
  return out.filter((p, i) => i === 0 || !(p.kind === 'grammar' && out.slice(0, i).some((q) => q.kind !== 'grammar' && q.start <= p.start && q.end >= p.end)));
}

/** The words a thesaurus gives for a word (Datamuse: same meaning, then related). */
export async function lookUpWord(word: string, fetcher: typeof fetch = fetch): Promise<{ synonyms: string[]; related: string[] } | null> {
  const q = encodeURIComponent(word.trim().toLowerCase());
  if (!q) return null;
  try {
    const get = async (rel: string) => {
      const r = await fetcher(`https://api.datamuse.com/words?${rel}=${q}&max=30`);
      if (!r.ok) throw new Error(String(r.status));
      return ((await r.json()) as { word: string }[]).map((x) => x.word).filter((w) => typeof w === 'string');
    };
    const [synonyms, related] = await Promise.all([get('rel_syn'), get('ml')]);
    const seen = new Set(synonyms);
    return { synonyms: synonyms.map((w) => matchCase(w, word)), related: related.filter((w) => !seen.has(w) && w !== word.toLowerCase()).slice(0, 20).map((w) => matchCase(w, word)) };
  } catch {
    return null;
  }
}

/** A ribbon button to open a box under, if it is showing (else the box opens at the right). */
const shown = (el: HTMLElement | null | undefined) => (el && el.offsetParent !== null ? el : null);

export class DocProofingUI {
  private pane: FloatBox | null = null;
  private countBox: FloatBox | null = null;
  private thesaurus: FloatBox | null = null;
  /** Where the pane looks from next, and where it started (to know when it has gone all the way round). */
  private pos = 0;
  private startedAt = 0;
  private wrapped = false;
  private current: ProofProblem | null = null;
  /** Grammar checked as well as spelling (Word's "Check grammar with spelling"). */
  grammar = true;
  private skipped = new Set<string>();

  constructor(private host: DocProofingHost) {}

  // ---------------------------------------------------------------- word count

  /** Review > Word Count: the document's counts, or the selection's. */
  wordCount(pages: number, lines: number, near?: HTMLElement | null): void {
    const f = this.host.file();
    if (!f) return;
    if (!this.countBox) {
      this.countBox = new FloatBox('Word Count', () => {});
      this.countBox.el.classList.add('word-count');
      this.countBox.el.querySelector<HTMLElement>('.fb-pin')?.style.setProperty('display', 'none');
    }
    const box = this.countBox;
    const extras = box.body.querySelector<HTMLInputElement>('input[name="extras"]')?.checked ?? true;
    const ed = f.ed;
    const sel: [number, number] | undefined = !f.box && !ed.collapsed ? [ed.start, ed.end] : undefined;
    const c = countDocument(f.t, extras, sel);
    const row = (label: string, v: number | string) => `<tr><th scope="row">${label}</th><td>${typeof v === 'number' ? v.toLocaleString() : v}</td></tr>`;
    box.title = sel ? 'Word Count (selection)' : 'Word Count';
    box.body.innerHTML = `<table class="wc-table">
      ${sel ? '' : row('Pages', pages)}
      ${row('Words', c.words)}
      ${row('Characters (no spaces)', c.chars)}
      ${row('Characters (with spaces)', c.charsWithSpaces)}
      ${row('Paragraphs', c.paras)}
      ${sel ? '' : row('Lines', lines)}
    </table>
    <label class="wc-extras"><input type="checkbox" name="extras" ${extras ? 'checked' : ''} ${sel ? 'disabled' : ''}/> Include text boxes, footnotes and endnotes</label>
    <div class="wc-buttons"><button type="button" class="wc-close">Close</button></div>`;
    box.body.querySelector('input[name="extras"]')!.addEventListener('change', () => this.wordCount(pages, lines));
    box.body.querySelector('.wc-close')!.addEventListener('click', () => { box.close(); this.host.focus(); });
    if (!box.open) box.show(shown(near));
  }

  // ---------------------------------------------------------------- spelling and grammar

  private problems(): ProofProblem[] {
    const f = this.host.file();
    if (!f) return [];
    const c = this.host.checks();
    return proofProblems(rt.plainText(f.t.runs), c.spell, c.issues, this.host.speller(), this.grammar)
      .filter((p) => !this.skipped.has(`${p.kind}:${p.start}:${rt.plainText(f.t.runs).slice(p.start, p.end)}`));
  }

  /** Review > Spelling & Grammar (F7): the pane, starting at the caret. */
  spelling(near?: HTMLElement | null): void {
    const f = this.host.file();
    if (!f) return;
    if (!this.host.speller()) this.host.flash('The word lists are still loading (or the spelling check is off in Edit > Typing and Spelling): checking grammar and chemistry formatting only.', 4000);
    if (!this.pane) {
      this.pane = new FloatBox('Editor', () => {});
      this.pane.el.classList.add('proof-pane');
      this.pane.el.querySelector<HTMLElement>('.fb-pin')?.style.setProperty('display', 'none');
    }
    this.skipped.clear();
    this.pos = this.startedAt = f.box ? 0 : f.ed.start;
    this.wrapped = this.pos === 0;
    this.next();
    if (!this.pane.open) this.pane.show(shown(near));
  }

  /** On to the next problem from where the pane is. */
  private next(): void {
    const all = this.problems();
    const limit = this.wrapped && this.startedAt > 0 ? this.startedAt : Infinity;
    let p = all.find((x) => x.start >= this.pos && x.start < limit);
    if (!p && !this.wrapped) {
      // on from the start of the document, up to where the check began
      this.wrapped = true;
      this.pos = 0;
      p = all.find((x) => x.start < this.startedAt);
    }
    this.current = p ?? null;
    this.render();
    if (p) this.host.show(p.start, p.end);
  }

  private render(): void {
    const pane = this.pane;
    const f = this.host.file();
    if (!pane || !f) return;
    const p = this.current;
    pane.body.innerHTML = '';
    const el = (tag: string, cls: string, text?: string) => { const e = document.createElement(tag); e.className = cls; if (text !== undefined) e.textContent = text; return e; };
    const button = (label: string, title: string, on: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener('mousedown', (e) => e.preventDefault());
      b.addEventListener('click', on);
      return b;
    };
    if (!p) {
      pane.body.append(el('p', 'pp-done', 'The check is done: nothing more to look at.'));
      const row = el('div', 'pp-buttons');
      row.append(button('Close', 'Close the pane', () => { pane.close(); this.host.focus(); }));
      pane.body.append(row);
      return;
    }
    const text = rt.plainText(f.t.runs);
    const kindName = p.kind === 'spelling' ? 'Spelling' : p.kind === 'grammar' ? 'Grammar' : 'Chemistry formatting';
    pane.body.append(el('div', `pp-kind pp-${p.kind}`, kindName), el('div', 'pp-message', p.message));
    // the words round it, the problem marked
    const ctx = el('div', 'pp-context');
    const ps = text.lastIndexOf('\n', p.start - 1) + 1, pe = text.indexOf('\n', p.end);
    const from = Math.max(ps, p.start - 60), to = Math.min(pe < 0 ? text.length : pe, p.end + 60);
    const mark = el('mark', '', text.slice(p.start, p.end) || '·');
    ctx.append(`${from > ps ? '…' : ''}${text.slice(from, p.start)}`, mark, `${text.slice(p.end, to)}${to < (pe < 0 ? text.length : pe) ? '…' : ''}`);
    pane.body.append(ctx);
    const list = el('div', 'pp-choices');
    list.setAttribute('role', 'listbox');
    let pick = 0;
    const items: HTMLButtonElement[] = [];
    p.choices.forEach((c, i) => {
      const b = button(c === '' ? '(take it out)' : c, p.kind === 'chemistry' ? 'Fix it like this' : 'Change it to this', () => { pick = i; this.change(p, c); });
      b.setAttribute('role', 'option');
      b.addEventListener('focus', () => { pick = i; });
      items.push(b);
      list.append(b);
    });
    if (!p.choices.length) list.append(el('div', 'pp-none', p.kind === 'spelling' ? 'No suggestions' : 'Change it by hand in the text'));
    pane.body.append(list);
    const row = el('div', 'pp-buttons');
    const word = text.slice(p.start, p.end);
    row.append(
      button('Ignore Once', 'Leave it this time', () => { this.skipped.add(`${p.kind}:${p.start}:${word}`); this.pos = p.start + 1; this.next(); }),
      button('Ignore All', p.kind === 'spelling' ? 'Accept this word everywhere until the program is closed' : 'Leave every one like this', () => {
        if (p.kind === 'spelling') this.host.ignoreWord(word);
        else for (const q of this.problems()) if (q.kind === p.kind && q.message === p.message && text.slice(q.start, q.end) === word) this.skipped.add(`${q.kind}:${q.start}:${word}`);
        this.pos = p.start;
        this.next();
      }),
    );
    if (p.kind === 'spelling') row.append(button('Add to Dictionary', 'Accept this word from now on', () => { this.host.addWord(word); this.pos = p.start; this.next(); }));
    row.append(
      button('Change', 'Change it to the choice picked', () => this.change(p, p.choices[pick]), !p.choices.length),
      button('Change All', 'Change it everywhere it is in the document', () => this.changeAll(p, p.choices[pick]), !p.choices.length || p.kind === 'chemistry'),
    );
    pane.body.append(row);
    const opts = el('label', 'pp-opts');
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = this.grammar;
    cb.addEventListener('change', () => { this.grammar = cb.checked; this.pos = p.start; this.next(); });
    opts.append(cb, ' Check grammar as well');
    pane.body.append(opts);
    items[0]?.focus();
  }

  private change(p: ProofProblem, to: string | undefined): void {
    const f = this.host.file();
    if (!f || to === undefined) return;
    if (p.issue) f.ed.fix(p.issue.edits, 'fix');
    else f.ed.fix([{ start: p.start, end: p.end, text: p.kind === 'spelling' ? matchCase(to, rt.plainText(f.t.runs).slice(p.start, p.end)) : to }], 'spell');
    this.pos = p.start + (p.issue ? 0 : to.length) + (p.issue ? 1 : 0);
    this.next();
  }

  private changeAll(p: ProofProblem, to: string | undefined): void {
    const f = this.host.file();
    if (!f || to === undefined) return;
    const text = rt.plainText(f.t.runs);
    const word = text.slice(p.start, p.end);
    const same = this.problems().filter((q) => q.kind === p.kind && text.slice(q.start, q.end) === word && q.message === p.message);
    f.ed.fix(same.map((q) => ({ start: q.start, end: q.end, text: p.kind === 'spelling' ? matchCase(to, word) : to })), 'spell');
    this.host.flash(`${same.length} changed.`);
    this.pos = p.start + to.length;
    this.next();
  }

  // ---------------------------------------------------------------- thesaurus

  /** Review > Thesaurus (Shift+F7): words for the word at the caret (or selected), to put in its place. */
  async lookUp(near?: HTMLElement | null): Promise<void> {
    const f = this.host.file();
    if (!f) return;
    const ed = f.ed;
    const text = ed.text;
    let a = ed.start, b = ed.end;
    if (a === b) {
      while (a > 0 && /[\p{L}'’-]/u.test(text[a - 1])) a--;
      while (b < text.length && /[\p{L}'’-]/u.test(text[b])) b++;
    }
    const word = text.slice(a, b).trim();
    if (!word || word.includes('\n')) { this.host.flash('Put the caret in a word (or select one) to look it up.'); return; }
    if (!this.thesaurus) {
      this.thesaurus = new FloatBox('Thesaurus', () => {});
      this.thesaurus.el.classList.add('thesaurus');
      this.thesaurus.el.querySelector<HTMLElement>('.fb-pin')?.style.setProperty('display', 'none');
    }
    const box = this.thesaurus;
    box.body.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'th-word';
    head.textContent = `${word}: looking it up…`;
    box.body.append(head);
    if (!box.open) box.show(shown(near));
    const got = await lookUpWord(word);
    if (box.body.firstChild !== head) return;
    if (!got) { head.textContent = `${word}: the thesaurus couldn't be reached (it needs the internet).`; return; }
    head.textContent = word;
    const section = (title: string, words: string[]) => {
      if (!words.length) return;
      const h = document.createElement('div');
      h.className = 'th-head';
      h.textContent = title;
      const list = document.createElement('div');
      list.className = 'th-list';
      for (const w of words) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = w;
        btn.title = `Put “${w}” in place of “${word}”`;
        btn.addEventListener('mousedown', (e) => e.preventDefault());
        btn.addEventListener('click', () => {
          if (this.host.file() !== f || ed.text.slice(a, b).trim() !== word) { this.host.flash('The text has changed: look the word up again.'); return; }
          ed.fix([{ start: a, end: b, text: w }], 'Thesaurus');
          box.close();
          this.host.focus();
        });
        list.append(btn);
      }
      box.body.append(h, list);
    };
    section('Same meaning', got.synonyms);
    section('Related', got.related);
    if (!got.synonyms.length && !got.related.length) head.textContent = `${word}: no words found.`;
    const note = document.createElement('p');
    note.className = 'th-note';
    note.textContent = 'Words from Datamuse (datamuse.com); only the word looked up is sent.';
    box.body.append(note);
  }
}
