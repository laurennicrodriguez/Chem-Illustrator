// Review > Check Accessibility: a box beside the work listing what makes it hard to use with a
// screen reader or to read, grouped by rule (errors, then warnings, then tips), as Office's
// Accessibility pane does. Clicking an item goes to it; items missing alt text have a button to
// add it there and then. Alt Text… itself asks for the description in a small window.

import { FloatBox } from './float-box';
import { ask } from './ask';
import { groupIssues, RULES, type Issue, type IssuePlace } from '../accessibility';

export interface AccessibilityHost {
  /** The issues in the file showing. */
  check(): Issue[];
  /** Go to (and select) what an issue is about. */
  goTo(place: IssuePlace): void;
  /** Ask for alt text for what an issue is about; true when it was set. */
  fixAlt(place: IssuePlace): Promise<boolean>;
}

const LEVEL_NAMES = { error: 'Errors', warning: 'Warnings', tip: 'Tips' } as const;

/** Ask for alt text (what it shows, in a sentence or two). Null when cancelled; '' takes it off. */
export async function askAltText(what: string, now: string | undefined, note?: string): Promise<string | null> {
  const got = await ask(`Alt Text: ${what}`, [
    { name: 'alt', label: 'Description', value: now ?? '', type: 'textarea', placeholder: 'What it shows, in a sentence or two, for people who can\'t see it' },
  ], { ok: 'Save', note: note ?? 'Screen readers read this out in place of it, and Word, PowerPoint and Excel keep it as its alt text. Leave it empty to take the alt text off.' });
  return got ? got.alt.trim() : null;
}

export class AccessibilityPane {
  private box: FloatBox;
  private summary: HTMLParagraphElement;
  private list: HTMLDivElement;
  /** Rules folded shut by the person (kept while the app is open). */
  private shut = new Set<string>();

  constructor(private host: AccessibilityHost) {
    this.box = new FloatBox('Accessibility', () => {});
    this.box.el.classList.add('a11y-pane');
    (this.box.el.querySelector('.fb-pin') as HTMLElement | null)?.setAttribute('hidden', '');
    const top = document.createElement('div');
    top.className = 'a11y-top';
    this.summary = document.createElement('p');
    this.summary.className = 'a11y-summary';
    this.summary.setAttribute('role', 'status');
    const again = document.createElement('button');
    again.type = 'button';
    again.textContent = 'Check Again';
    again.title = 'Look through the file again after changes';
    again.addEventListener('click', () => this.refresh());
    top.append(this.summary, again);
    this.list = document.createElement('div');
    this.list.className = 'a11y-list';
    this.box.body.append(top, this.list);
  }

  get open(): boolean {
    return this.box.open;
  }

  show(near?: HTMLElement | null): void {
    this.refresh();
    this.box.show(near);
  }

  close(): void {
    this.box.close();
  }

  /** Check the file showing again (when the pane is open). */
  refresh(): void {
    let issues: Issue[];
    try {
      issues = this.host.check();
    } catch (e) {
      this.summary.textContent = `Could not check this file: ${e instanceof Error ? e.message : String(e)}`;
      this.list.replaceChildren();
      return;
    }
    const count = (l: Issue['level']) => issues.filter((i) => i.level === l).length;
    const e = count('error'), w = count('warning'), t = count('tip');
    this.summary.textContent = issues.length
      ? [e && `${e} error${e > 1 ? 's' : ''}`, w && `${w} warning${w > 1 ? 's' : ''}`, t && `${t} tip${t > 1 ? 's' : ''}`].filter(Boolean).join(', ')
      : 'No accessibility issues found. People with disabilities should find this file easy to read.';
    this.list.replaceChildren();
    let level: string | null = null;
    for (const g of groupIssues(issues)) {
      if (g.level !== level) {
        level = g.level;
        const h = document.createElement('h3');
        h.className = `a11y-level a11y-${g.level}`;
        h.textContent = LEVEL_NAMES[g.level];
        this.list.append(h);
      }
      const rule = RULES[g.rule];
      const d = document.createElement('details');
      d.className = 'a11y-rule';
      d.open = !this.shut.has(g.rule);
      d.addEventListener('toggle', () => { if (d.open) this.shut.delete(g.rule); else this.shut.add(g.rule); });
      const sum = document.createElement('summary');
      sum.textContent = `${rule.name} (${g.items.length})`;
      const why = document.createElement('p');
      why.className = 'muted small a11y-why';
      why.textContent = `${rule.why} ${rule.fix}`;
      d.append(sum, why);
      for (const i of g.items) d.append(this.item(i));
      this.list.append(d);
    }
  }

  private item(i: Issue): HTMLElement {
    const row = document.createElement('div');
    row.className = 'a11y-item';
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'a11y-go';
    go.textContent = i.where;
    go.title = 'Go to it';
    go.addEventListener('click', () => this.host.goTo(i.place));
    row.append(go);
    if (i.detail) {
      const p = document.createElement('span');
      p.className = 'muted small a11y-detail';
      p.textContent = i.detail;
      row.append(p);
    }
    if (i.rule === 'alt-missing' || i.rule === 'alt-smiles') {
      const fix = document.createElement('button');
      fix.type = 'button';
      fix.className = 'a11y-fix';
      fix.textContent = 'Add Alt Text…';
      fix.addEventListener('click', async () => {
        this.host.goTo(i.place);
        if (await this.host.fixAlt(i.place)) this.refresh();
      });
      row.append(fix);
    }
    return row;
  }
}
