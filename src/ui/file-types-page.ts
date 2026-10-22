// Settings ▸ File Types: which kinds of file the app offers to open from Explorer ("Open with"),
// and a button to Windows' Default apps page, where the person can make it the default (Windows
// keeps that choice for the person: no app can make itself the default). On macOS and Linux the
// installer lists the types, and the page says where to choose the default.

import { showDialog } from './dialog-host';

export const FILE_TYPES: { ext: string; label: string; chemistry: boolean }[] = [
  { ext: 'cdxml', label: 'ChemDraw XML drawings (.cdxml)', chemistry: true },
  { ext: 'cdx', label: 'ChemDraw drawings (.cdx)', chemistry: true },
  { ext: 'mol', label: 'Molfiles (.mol)', chemistry: true },
  { ext: 'sdf', label: 'Structure-data files (.sdf)', chemistry: true },
  { ext: 'docx', label: 'Word documents (.docx)', chemistry: false },
  { ext: 'pptx', label: 'PowerPoint presentations (.pptx)', chemistry: false },
  { ext: 'xlsx', label: 'Excel workbooks (.xlsx)', chemistry: false },
];

export interface FileTypesHost {
  /** 'windows', 'mac', 'linux', or 'web'. */
  platform: 'windows' | 'mac' | 'linux' | 'web';
  get(): Promise<string[]>;
  set(types: string[]): Promise<void>;
  openDefaults(): Promise<void>;
  flash(msg: string): void;
}

export async function fileTypesPage(host: FileTypesHost): Promise<void> {
  const d = document.createElement('dialog');
  d.className = 'ask file-types';
  const form = document.createElement('form');
  const h = document.createElement('h2');
  h.textContent = 'File Types';
  form.append(h);
  const note = (text: string) => {
    const p = document.createElement('p');
    p.className = 'muted';
    p.textContent = text;
    form.append(p);
    return p;
  };
  const buttons = document.createElement('p');
  buttons.className = 'ask-buttons';
  const done = () => { if (d.open) d.close(); d.remove(); };

  if (host.platform !== 'windows') {
    note(host.platform === 'web'
      ? 'The web version opens files from File ▸ Open, or dropped on the window. The desktop app can be opened from your files directly.'
      : host.platform === 'mac'
        ? 'Chem Illustrator is offered for .cdxml, .cdx, .mol, .sdf, .docx, .pptx and .xlsx files: right-click a file in Finder and choose Open With. To always open a kind of file here, choose File ▸ Get Info in Finder, pick Chem Illustrator under Open with, and click Change All.'
        : 'Chem Illustrator is offered for .cdxml, .cdx, .mol, .sdf, .docx, .pptx and .xlsx files in your file manager\'s Open With menu. Your desktop\'s settings (Default Applications) choose which program opens each kind of file.');
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'primary';
    ok.textContent = 'OK';
    buttons.append(ok);
    form.append(buttons);
    form.addEventListener('submit', (e) => { e.preventDefault(); done(); });
  } else {
    note('Ticked kinds of file show Chem Illustrator under "Open with" when you right-click them in Explorer. This never changes the program that opens them now: ChemDraw, Word, PowerPoint and Excel stay the default unless you change it.');
    const now = new Set(await host.get().catch(() => [] as string[]));
    const boxes = new Map<string, HTMLInputElement>();
    for (const t of FILE_TYPES) {
      const row = document.createElement('label');
      row.className = 'ask-row ask-check';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.checked = now.has(t.ext);
      boxes.set(t.ext, box);
      const name = document.createElement('span');
      name.textContent = t.label;
      row.append(box, name);
      form.append(row);
    }
    const defaults = document.createElement('p');
    defaults.className = 'ask-help muted';
    defaults.textContent = 'To open a kind of file here when you double-click it, make Chem Illustrator its default in Windows Settings. Windows asks you to choose there itself; no program is allowed to make itself the default.';
    const open = document.createElement('button');
    open.type = 'button';
    open.textContent = 'Choose Defaults in Windows Settings…';
    open.addEventListener('click', () => void host.openDefaults().catch((e) => host.flash(String(e))));
    form.append(defaults, open);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', done);
    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'primary';
    save.textContent = 'Save';
    buttons.append(cancel, save);
    form.append(buttons);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const types = [...boxes].filter(([, b]) => b.checked).map(([ext]) => ext);
      try {
        await host.set(types);
        host.flash(types.length ? `Chem Illustrator is now under "Open with" for ${types.map((t) => `.${t}`).join(', ')}.` : 'Chem Illustrator is off every "Open with" list.');
      } catch (err) {
        host.flash(String(err));
      }
      done();
    });
  }
  d.append(form);
  d.addEventListener('close', () => d.remove());
  document.body.append(d);
  showDialog(d);
}
