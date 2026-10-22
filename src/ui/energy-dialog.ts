// Insert ▸ Energy Diagram… (and Edit Energy Diagram…): a table with a row for each species
// along the reaction coordinate and a pair of columns (name, energy) for each pathway, then how
// the diagram looks. Names take _ and ^ for sub- and superscripts (TS1^‡ or just TS1‡).

import { ENERGY_DEFAULTS, ENERGY_PRESETS, PATH_COLOURS, type EnergyData, type EnergyPath } from '../design/energy';

/** How the last diagram looked, so a new one starts the same way. */
let lastLook: Pick<EnergyData, 'style' | 'values' | 'digits' | 'axis' | 'barrier' | 'quantity' | 'unit'> = { ...ENERGY_DEFAULTS, quantity: 'ΔG', unit: 'kcal/mol' };

/** Ask for a diagram: a new one (from a preset), or `editing` with its numbers to change. */
export function askEnergy(editing: EnergyData | null, size: { w: number; h: number }, preview?: (d: EnergyData, canvas: HTMLCanvasElement) => void): Promise<EnergyData | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask energy-dialog';
    d.setAttribute('aria-label', 'Energy diagram');
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `<h2>${editing ? 'Edit Energy Diagram' : 'Energy Diagram'}</h2>
      <label class="ask-row"${editing ? ' hidden' : ''}><span>Start from</span><select name="preset"></select></label>
      <p class="muted energy-blurb"${editing ? ' hidden' : ''}></p>
      <canvas class="energy-preview" aria-label="Preview of the diagram" role="img"></canvas>
      <div class="energy-table-wrap"><table class="energy-table"><thead></thead><tbody></tbody></table></div>
      <p class="energy-rows"><button type="button" data-act="row" title="Another species along the reaction coordinate">+ Species</button>
        <button type="button" data-act="path" title="Another pathway drawn on the same diagram, in its own colour">+ Pathway</button>
        <button type="button" data-act="ddagger" title="Put a double dagger (‡) at the end of the species name you were last in, for a transition state">‡</button></p>
      <p class="muted small">Leave an energy empty where a pathway has nothing (so a one-step route can sit beside a two-step one). Name transition states with ‡ (TS1‡): the ‡ button adds one to the name box you were last in.</p>
      <label class="ask-row"><span>Axis</span><span class="energy-pair"><select name="quantity"><option>ΔG</option><option>ΔG°</option><option>ΔH</option><option>E</option><option>ΔE</option></select>
        <select name="unit"><option>kcal/mol</option><option>kJ/mol</option><option>eV</option></select></span></label>
      <label class="ask-row"><span>Joined by</span><select name="style"><option value="levels">Levels and dashed lines</option><option value="curve">A smooth curve</option></select></label>
      <label class="ask-row"><span>Decimal places</span><span class="energy-pair"><input name="digits" type="number" min="0" max="3" /></span></label>
      <label class="ask-row"><span>Size</span><span class="energy-pair"><input name="w" type="number" min="60" step="any" aria-label="Width" /> × <input name="h" type="number" min="40" step="any" aria-label="Height" /> pt</span></label>
      <label class="ask-row ask-check"><input name="values" type="checkbox" /><span>Show the energies</span></label>
      <label class="ask-row ask-check"><input name="axis" type="checkbox" /><span>Axis with its title, and "Reaction coordinate" along the bottom</span></label>
      <label class="ask-row ask-check"><input name="barrier" type="checkbox" /><span>Mark the largest barrier on each pathway (ΔG‡)</span></label>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">${editing ? 'Redraw' : 'Insert'}</button></p>`;
    const $ = <T extends Element>(q: string) => form.querySelector<T>(q)!;
    const table = $<HTMLTableElement>('.energy-table');
    let paths: { name: string; color: string }[] = [];
    let rows: { label: string; g: string }[][] = [];

    /** Read what is typed back into paths and rows (before the table is redrawn). */
    const read = () => {
      paths = paths.map((p, j) => ({
        name: table.querySelector<HTMLInputElement>(`thead input[data-p="${j}"]`)?.value ?? p.name,
        color: table.querySelector<HTMLInputElement>(`thead input[data-c="${j}"]`)?.value ?? p.color,
      }));
      rows = [...table.tBodies[0].rows].map((tr) => paths.map((_, j) => ({
        label: tr.querySelector<HTMLInputElement>(`input[data-l="${j}"]`)?.value ?? '',
        g: tr.querySelector<HTMLInputElement>(`input[data-g="${j}"]`)?.value ?? '',
      })));
    };
    const draw = () => {
      const head = table.tHead!;
      head.innerHTML = '';
      const tr1 = head.insertRow(), tr2 = head.insertRow();
      paths.forEach((p, j) => {
        const th = document.createElement('th');
        th.colSpan = 2;
        const name = Object.assign(document.createElement('input'), { value: p.name, placeholder: paths.length > 1 ? `pathway ${j + 1}` : 'pathway (optional)' });
        name.dataset.p = String(j);
        name.setAttribute('aria-label', `Pathway ${j + 1} name`);
        const col = Object.assign(document.createElement('input'), { type: 'color', value: p.color });
        col.dataset.c = String(j);
        col.setAttribute('aria-label', `Pathway ${j + 1} colour`);
        th.append(name, col);
        if (paths.length > 1) {
          const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Take out this pathway' });
          del.addEventListener('click', () => { read(); paths.splice(j, 1); for (const r of rows) r.splice(j, 1); draw(); });
          th.append(del);
        }
        tr1.append(th);
        for (const t of ['Species', 'Energy']) tr2.append(Object.assign(document.createElement('th'), { textContent: t }));
      });
      const body = table.tBodies[0];
      body.innerHTML = '';
      rows.forEach((r, i) => {
        const tr = body.insertRow();
        paths.forEach((_, j) => {
          const l = Object.assign(document.createElement('input'), { value: r[j]?.label ?? '' });
          l.dataset.l = String(j);
          l.setAttribute('aria-label', `Species ${i + 1}, pathway ${j + 1}`);
          const g = Object.assign(document.createElement('input'), { value: r[j]?.g ?? '', inputMode: 'decimal' });
          g.dataset.g = String(j);
          g.className = 'energy-num';
          g.setAttribute('aria-label', `Energy ${i + 1}, pathway ${j + 1}`);
          tr.insertCell().append(l);
          tr.insertCell().append(g);
        });
        const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Take out this species' });
        del.addEventListener('click', () => { read(); if (rows.length > 2) rows.splice(i, 1); draw(); });
        tr.insertCell().append(del);
      });
    };
    const load = (ps: EnergyPath[]) => {
      paths = ps.map((p) => ({ name: p.name, color: p.color }));
      const n = Math.max(...ps.map((p) => p.points.length));
      rows = Array.from({ length: n }, (_, i) => ps.map((p) => ({ label: p.points[i]?.label ?? '', g: p.points[i]?.g === null || p.points[i] === undefined ? '' : String(p.points[i].g) })));
      draw();
    };

    const presetSel = $<HTMLSelectElement>('select[name=preset]');
    for (const p of ENERGY_PRESETS) presetSel.append(new Option(p.name, p.id));
    const fillPreset = () => {
      const p = ENERGY_PRESETS.find((x) => x.id === presetSel.value) ?? ENERGY_PRESETS[0];
      $('.energy-blurb').textContent = p.blurb + ' The numbers are only examples: type your own.';
      load(p.data.paths);
    };
    presetSel.addEventListener('change', fillPreset);
    const look = editing ?? { ...lastLook };
    if (editing) load(editing.paths); else fillPreset();
    $<HTMLSelectElement>('select[name=quantity]').value = look.quantity;
    $<HTMLSelectElement>('select[name=unit]').value = look.unit;
    $<HTMLSelectElement>('select[name=style]').value = look.style;
    $<HTMLInputElement>('input[name=digits]').value = String(look.digits);
    $<HTMLInputElement>('input[name=w]').value = String(Math.round(editing?.w ?? size.w));
    $<HTMLInputElement>('input[name=h]').value = String(Math.round(editing?.h ?? size.h));
    $<HTMLInputElement>('input[name=values]').checked = look.values;
    $<HTMLInputElement>('input[name=axis]').checked = look.axis;
    $<HTMLInputElement>('input[name=barrier]').checked = look.barrier;
    form.querySelector('[data-act=row]')!.addEventListener('click', () => { read(); rows.push(paths.map(() => ({ label: '', g: '' }))); draw(); });
    form.querySelector('[data-act=path]')!.addEventListener('click', () => {
      read();
      if (paths.length >= PATH_COLOURS.length) return;
      paths.push({ name: '', color: PATH_COLOURS.find((c) => !paths.some((p) => p.color === c)) ?? '#000000' });
      for (const r of rows) r.push({ label: r[0]?.label ?? '', g: '' });
      draw();
    });

    d.append(form);
    document.body.append(d);
    const finish = (v: EnergyData | null) => { d.remove(); resolve(v); };
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    // a minus sign typed as − or – counts too
    const num = (t: string) => { const v = parseFloat(t.replace(/[−–]/g, '-').replace(',', '.')); return t.trim() && isFinite(v) ? v : null; };
    /** The diagram as the window has it now. */
    const gather = (): EnergyData => {
      read();
      return {
        paths: paths.map((p, j) => ({ name: p.name.trim(), color: p.color, points: rows.map((r) => ({ label: r[j].label.trim(), g: num(r[j].g) })) })),
        quantity: $<HTMLSelectElement>('select[name=quantity]').value,
        unit: $<HTMLSelectElement>('select[name=unit]').value,
        style: $<HTMLSelectElement>('select[name=style]').value as EnergyData['style'],
        values: $<HTMLInputElement>('input[name=values]').checked,
        digits: Math.max(0, Math.min(3, Number($<HTMLInputElement>('input[name=digits]').value) || 0)),
        axis: $<HTMLInputElement>('input[name=axis]').checked,
        barrier: $<HTMLInputElement>('input[name=barrier]').checked,
        w: Math.max(60, Number($<HTMLInputElement>('input[name=w]').value) || size.w),
        h: Math.max(40, Number($<HTMLInputElement>('input[name=h]').value) || size.h),
        ...(editing?.margins ? { margins: editing.margins } : {}),
      };
    };
    // the preview redraws as anything changes (a moment after typing stops)
    const canvas = $<HTMLCanvasElement>('.energy-preview');
    canvas.hidden = !preview;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const redraw = () => {
      if (!preview) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        const out = gather();
        if (out.paths.some((p) => p.points.some((q) => q.g !== null))) { try { preview(out, canvas); } catch { /* a half-typed table */ } }
      }, 120);
    };
    form.addEventListener('input', redraw);
    form.addEventListener('change', redraw);
    form.addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('button')) redraw(); });
    // ‡ goes on the species name last typed in
    let lastName: HTMLInputElement | null = null;
    table.addEventListener('focusin', (e) => { const t = e.target as HTMLInputElement; if (t.dataset?.l !== undefined) lastName = t; });
    form.querySelector('[data-act=ddagger]')!.addEventListener('click', () => {
      const t = lastName && lastName.isConnected ? lastName : table.querySelector<HTMLInputElement>('input[data-l]');
      if (!t) return;
      if (!t.value.endsWith('‡')) t.value += '‡';
      t.focus();
      redraw();
    });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const out = gather();
      if (!out.paths.some((p) => p.points.some((q) => q.g !== null))) return;
      const { style, values, digits, axis, barrier, quantity, unit } = out;
      lastLook = { style, values, digits, axis, barrier, quantity, unit };
      d.close();
      finish(out);
    });
    d.showModal();
    redraw();
  });
}
