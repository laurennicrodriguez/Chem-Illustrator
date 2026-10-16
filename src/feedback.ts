// Help > Send Feedback: a comment, idea or problem written in the program, sent on as a new
// issue on the project's GitHub page (the person's own browser opens it, filled in, for them to
// check and submit), or copied as plain text for anyone without a GitHub account.

export const REPO_URL = 'https://github.com/nathanohare/Chem-Illustrator';
export const GUIDE_URL = `${REPO_URL}/blob/main/docs/README.md`;

export type FeedbackKind = 'idea' | 'problem' | 'comment';

export const KIND_NAMES: Record<FeedbackKind, string> = {
  idea: 'Feature request',
  problem: 'Problem (bug)',
  comment: 'Comment or question',
};

/** What a title starts with, so the kinds sort themselves on GitHub. */
const KIND_TAG: Record<FeedbackKind, string> = { idea: 'Feature', problem: 'Bug', comment: 'Feedback' };

export interface Feedback {
  kind: FeedbackKind;
  title: string;
  details: string;
  /** For a problem: what was done, step by step, so it can be made to happen again. */
  steps?: string;
  /** The program's version, the computer and the mode, when the person leaves them in. */
  about?: Record<string, string>;
}

export interface Issue { title: string; body: string }

/** The issue's title and text, in Markdown (GitHub shows it formatted; it reads fine as plain text too). */
export function feedbackIssue(f: Feedback): Issue {
  const title = `[${KIND_TAG[f.kind]}] ${f.title.trim() || firstWords(f.details) || KIND_NAMES[f.kind]}`;
  const parts: string[] = [];
  const details = f.details.trim();
  parts.push(`**${KIND_NAMES[f.kind]}**`, '', details || '_(no details given)_');
  if (f.kind === 'problem' && f.steps?.trim()) parts.push('', '**Steps to make it happen**', '', f.steps.trim());
  const about = Object.entries(f.about ?? {}).filter(([, v]) => v);
  if (about.length) parts.push('', '**About the program**', '', ...about.map(([k, v]) => `- ${k}: ${v}`));
  parts.push('', '_Sent from Chem Illustrator (Help ▸ Send Feedback)._');
  return { title, body: parts.join('\n') };
}

/** The first few words of the details, for a title when none was typed. */
function firstWords(s: string, max = 60): string {
  const line = s.trim().split(/\r?\n/)[0] ?? '';
  if (line.length <= max) return line;
  const cut = line.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 30 ? cut.slice(0, sp) : cut).trimEnd()}…`;
}

/**
 * The address of GitHub's New Issue page with the title and text filled in. Browsers and GitHub
 * refuse very long addresses, so text past `maxLength` characters is cut, with a note saying so
 * (`cut` is then true, and the window offers to copy the whole text to paste in instead).
 */
export function issueUrl(issue: Issue, maxLength = 7000): { url: string; cut: boolean } {
  const base = `${REPO_URL}/issues/new?title=${encodeURIComponent(issue.title)}&body=`;
  const full = base + encodeURIComponent(issue.body);
  if (full.length <= maxLength) return { url: full, cut: false };
  const note = '\n\n_(The text was too long to send this way and was cut here: paste the full text from the program over this.)_';
  const room = maxLength - base.length - encodeURIComponent(note).length;
  // cut by characters until the encoded text fits (encoding can make one character up to 12 long)
  let body = issue.body;
  let lo = 0, hi = body.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (encodeURIComponent(body.slice(0, mid)).length <= room) lo = mid; else hi = mid - 1;
  }
  body = body.slice(0, lo);
  // don't split a surrogate pair
  if (/[\uD800-\uDBFF]$/.test(body)) body = body.slice(0, -1);
  return { url: base + encodeURIComponent(body + note), cut: true };
}

/** The feedback as plain text, to paste into an email or message. */
export function feedbackText(issue: Issue): string {
  return `${issue.title}\n\n${issue.body.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^_(.*)_$/gm, '$1')}\n`;
}

/** The computer the program is running on, in a few words (from the browser's description of itself). */
export function computerName(userAgent: string): string {
  if (/Windows NT 10/.test(userAgent)) return 'Windows 10 or 11';
  if (/Windows/.test(userAgent)) return 'Windows';
  if (/Mac OS X|Macintosh/.test(userAgent)) return 'macOS';
  if (/Android/.test(userAgent)) return 'Android';
  if (/iPhone|iPad/.test(userAgent)) return 'iOS';
  if (/Linux/.test(userAgent)) return 'Linux';
  return 'unknown';
}
