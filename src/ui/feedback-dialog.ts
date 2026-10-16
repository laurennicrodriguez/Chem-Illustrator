// The Send Feedback window (Help menu): pick what kind of feedback it is, write it, and either open
// it as a new issue on GitHub (in the computer's browser, to check and submit there) or copy it to
// send another way. Nothing is sent from the program itself.

import { feedbackIssue, feedbackText, issueUrl, KIND_NAMES, REPO_URL, type Feedback, type FeedbackKind } from '../feedback';

export interface FeedbackHost {
  /** Open a web page in the computer's browser. */
  openWebPage(url: string): void;
  /** Copy text to the clipboard, saying so when it's done. */
  copyText(text: string, done: string): Promise<void>;
  /** The program's version, the computer and what is open, to add to the feedback if wanted. */
  about(): Record<string, string>;
}

export class FeedbackDialog {
  /** What was written last time, kept until it is sent or copied, in case the window was closed by mistake. */
  private draft: Feedback = { kind: 'idea', title: '', details: '', steps: '' };
  private withAbout = true;

  constructor(private host: FeedbackHost) {}

  open(kind?: FeedbackKind): void {
    if (kind) this.draft.kind = kind;
    const d = document.createElement('dialog');
    d.className = 'ask feedback-dialog';
    const form = document.createElement('form');
    const h = document.createElement('h2');
    h.textContent = 'Send Feedback';
    const note = document.createElement('p');
    note.className = 'muted';
    note.textContent = 'Ideas, problems and questions are all welcome. Open on GitHub fills in a new issue on the project\'s page for you to check and submit (a free GitHub account is needed). No account? Copy Text, and send it to whoever looks after Chem Illustrator in your lab.';

    const kinds = document.createElement('div');
    kinds.className = 'feedback-kinds';
    kinds.setAttribute('role', 'radiogroup');
    kinds.setAttribute('aria-label', 'Kind of feedback');
    for (const k of Object.keys(KIND_NAMES) as FeedbackKind[]) {
      const lab = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'feedback-kind';
      r.value = k;
      r.checked = this.draft.kind === k;
      r.addEventListener('change', () => { this.draft.kind = k; show(); });
      lab.append(r, ` ${KIND_NAMES[k]}`);
      kinds.append(lab);
    }

    const row = (label: string, field: HTMLElement): HTMLLabelElement => {
      const l = document.createElement('label');
      l.className = 'feedback-field';
      const s = document.createElement('span');
      s.textContent = label;
      l.append(s, field);
      return l;
    };
    const title = document.createElement('input');
    title.type = 'text';
    title.maxLength = 120;
    title.value = this.draft.title;
    const details = document.createElement('textarea');
    details.rows = 6;
    details.value = this.draft.details;
    const steps = document.createElement('textarea');
    steps.rows = 4;
    steps.value = this.draft.steps ?? '';
    steps.placeholder = '1. Open a drawing\n2. …\n3. Then this happens:';
    const titleRow = row('Title (a few words)', title);
    const detailsRow = row('', details);
    const stepsRow = row('Steps to make it happen (if you know them)', steps);

    const aboutBox = document.createElement('input');
    aboutBox.type = 'checkbox';
    aboutBox.checked = this.withAbout;
    const aboutLab = document.createElement('label');
    aboutLab.className = 'feedback-about';
    const aboutText = document.createElement('span');
    aboutLab.append(aboutBox, aboutText);

    const status = document.createElement('p');
    status.className = 'name-status';
    status.setAttribute('role', 'status');

    const buttons = document.createElement('p');
    buttons.className = 'ask-buttons';
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Close';
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.textContent = 'Copy Text';
    copy.title = 'Copy the feedback, to paste into an email or message';
    const send = document.createElement('button');
    send.type = 'submit';
    send.className = 'primary';
    send.textContent = 'Open on GitHub';
    send.title = `Open a new issue on ${REPO_URL.replace('https://', '')}, filled in, in your browser`;
    buttons.append(cancel, copy, send);

    form.append(h, note, kinds, titleRow, detailsRow, stepsRow, aboutLab, status, buttons);
    d.append(form);

    const about = this.host.about();
    const show = (): void => {
      const k = this.draft.kind;
      (detailsRow.firstChild as HTMLElement).textContent =
        k === 'idea' ? 'What would you like it to do? How would it help?' :
        k === 'problem' ? 'What went wrong? What did you expect to happen?' : 'Your comment or question';
      stepsRow.hidden = k !== 'problem';
      aboutText.textContent = ` Include the program's version and computer (${Object.values(about).filter(Boolean).join(', ')})`;
    };
    const read = (): Feedback => {
      this.draft.title = title.value;
      this.draft.details = details.value;
      this.draft.steps = steps.value;
      this.withAbout = aboutBox.checked;
      return { ...this.draft, about: aboutBox.checked ? about : undefined };
    };
    const empty = (f: Feedback): boolean => !f.title.trim() && !f.details.trim();
    show();

    const close = () => { read(); if (d.open) d.close(); };
    const sent = () => { this.draft = { kind: this.draft.kind, title: '', details: '', steps: '' }; };
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const f = read();
      if (empty(f)) { status.textContent = 'Write a title or a few words first.'; status.classList.add('error'); details.focus(); return; }
      const issue = feedbackIssue(f);
      const { url, cut } = issueUrl(issue);
      this.host.openWebPage(url);
      if (cut) {
        void this.host.copyText(feedbackText(issue), 'Copied the full text: paste it over the shortened text on GitHub.');
        status.classList.remove('error');
        status.textContent = 'This was too long to fill in completely, so the full text is on the clipboard: paste it into the issue on GitHub.';
        sent();
        return;
      }
      sent();
      if (d.open) d.close();
    });
    copy.addEventListener('click', () => {
      const f = read();
      if (empty(f)) { status.textContent = 'Write a title or a few words first.'; status.classList.add('error'); details.focus(); return; }
      void this.host.copyText(feedbackText(feedbackIssue(f)), 'Copied your feedback, ready to paste into an email or message.');
      sent();
      if (d.open) d.close();
    });
    for (const el of [title, details, steps]) el.addEventListener('input', () => { status.textContent = ''; status.classList.remove('error'); });
    cancel.addEventListener('click', close);
    d.addEventListener('cancel', () => read());
    d.addEventListener('close', () => d.remove());
    document.body.append(d);
    d.showModal();
    (this.draft.title ? details : title).focus();
  }
}
