// Insert ▸ Catalytic Cycle…: pick a ready-made cycle (or a blank one) and change its species,
// steps and what comes in and goes out, in a table per loop; then how it looks. Species are
// typed with _ for subscripts and ^ for superscripts (L_nPd^0); formula digits drop by themselves.

import { CYCLE_PRESETS, STEP_NAMES, shortName, type CycleJoin, type CycleLook, type CycleLoop, type CycleSpec } from '../chem/cycles';

export interface CycleChoice { spec: CycleSpec; look: CycleLook }

/** What was picked last time, so the window opens as it was left. */
let last: { preset: string; look: CycleLook } = { preset: 'suzuki', look: { names: 'short', reagentArrows: true } };

/**
 * Ask for a cycle. `given` is how many structures are selected: when there are some, they are
 * the first loop's species and their names can't be typed.
 */
export function askCycle(given = 0): Promise<CycleChoice | null> {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'ask cycle-dialog';
    d.setAttribute('aria-label', 'Catalytic cycle');
    const form = document.createElement('form');
    form.method = 'dialog';
    form.innerHTML = `<h2>Catalytic Cycle</h2>
      <label class="ask-row"><span>Start from</span><select name="preset"></select></label>
      <p class="muted cycle-blurb"></p>
      <div class="cycle-loops"></div>
      <div class="cycle-join" hidden>
        <label class="ask-row"><span>The loops</span><select name="join">
          <option value="mesh">turn together where two steps meet</option>
          <option value="share">share a species, drawn once</option>
          <option value="beside">sit side by side</option>
        </select></label>
        <label class="ask-row"><span class="join-a">Loop 1's step</span><input name="ja" type="number" min="1" value="1" /></label>
        <label class="ask-row"><span class="join-b">meets loop 2's step</span><input name="jb" type="number" min="1" value="1" /></label>
      </div>
      <label class="ask-row"><span>Direction</span><select name="dir"><option value="cw">Clockwise</option><option value="acw">Anticlockwise</option></select></label>
      <label class="ask-row"><span>Step names</span><select name="names"><option value="short">Short (OA, TM, RE)</option><option value="full">In full (oxidative addition)</option><option value="none">None</option></select></label>
      <label class="ask-row ask-check"><input name="arrows" type="checkbox" /><span>What comes in and goes out on small curved arrows (otherwise written outside the loop)</span></label>
      <p class="muted small">Type _ for a subscript and ^ for a superscript: L_nPd^0, Pd^{II}, X^−. Digits in formulas drop by themselves (ArB(OH)2). Afterwards, every species, name and arrow can be edited, or swapped for a drawn structure (then Chemistry ▸ Arrange ▸ Catalytic cycle tidies it again).</p>
      <datalist id="cycle-steps">${STEP_NAMES.map((n) => `<option value="${n}"></option>`).join('')}</datalist>
      <p class="ask-buttons"><button type="button" data-act="cancel">Cancel</button> <button type="submit" class="primary">Insert</button></p>`;
    const $ = <T extends Element>(q: string) => form.querySelector<T>(q)!;
    const presetSel = $<HTMLSelectElement>('select[name=preset]');
    const groups: Record<string, string> = { classic: 'Classic cycles', two: 'Two loops or two pathways', blank: 'Blank' };
    for (const [g, label] of Object.entries(groups)) {
      const og = document.createElement('optgroup');
      og.label = label;
      for (const p of CYCLE_PRESETS.filter((x) => x.group === g)) og.append(new Option(p.name, p.id));
      presetSel.append(og);
    }
    const loopsEl = $<HTMLDivElement>('.cycle-loops');
    const joinEl = $<HTMLDivElement>('.cycle-join');
    const joinSel = $<HTMLSelectElement>('select[name=join]');
    const ja = $<HTMLInputElement>('input[name=ja]'), jb = $<HTMLInputElement>('input[name=jb]');
    const showJoin = () => {
      const share = joinSel.value === 'share';
      $('.join-a').textContent = share ? 'Loop 1\'s species' : 'Loop 1\'s step';
      $('.join-b').textContent = share ? 'is loop 2\'s species' : 'meets loop 2\'s step';
      for (const el of [ja, jb]) el.closest('label')!.hidden = joinSel.value === 'beside';
    };
    joinSel.addEventListener('change', showJoin);

    /** One loop as a table: a row per species, with the step from it to the next. */
    const loopTable = (loop: CycleLoop, li: number) => {
      const fs = document.createElement('fieldset');
      fs.className = 'cycle-loop';
      const lg = document.createElement('legend');
      lg.textContent = `Loop ${li + 1}`;
      const table = document.createElement('table');
      table.innerHTML = '<thead><tr><th>Species</th><th>Step to the next</th><th>Coming in</th><th>Going out</th><th></th></tr></thead><tbody></tbody>';
      const body = table.tBodies[0];
      const row = (station: string, step = { short: '', name: '', inn: '', out: '' }) => {
        const tr = document.createElement('tr');
        const cell = (name: string, value: string, disabled = false) => {
          const td = document.createElement('td');
          const inp = document.createElement('input');
          inp.name = name;
          inp.value = value;
          inp.disabled = disabled;
          inp.setAttribute('aria-label', { st: 'Species', step: 'Step', inn: 'Coming in', out: 'Going out' }[name]!);
          td.append(inp);
          tr.append(td);
          return inp;
        };
        const fixed = li === 0 && body.rows.length < given;
        cell('st', fixed ? `selected structure ${body.rows.length + 1}` : station, fixed);
        const stepIn = cell('step', step.name);
        stepIn.setAttribute('list', 'cycle-steps');
        tr.dataset.short = step.short;
        stepIn.addEventListener('input', () => { tr.dataset.short = shortName(stepIn.value); });
        cell('inn', step.inn);
        cell('out', step.out);
        const td = document.createElement('td');
        const del = Object.assign(document.createElement('button'), { type: 'button', textContent: '×', title: 'Take out this species and its step' });
        del.addEventListener('click', () => { if (body.rows.length > 2) tr.remove(); });
        td.append(del);
        tr.append(td);
        body.append(tr);
      };
      loop.stations.forEach((s, k) => row(s, loop.steps[k]));
      // selected structures beyond the cycle's species get rows of their own
      if (li === 0) while (body.rows.length < given) row('', { short: '', name: '', inn: '', out: '' });
      const add = Object.assign(document.createElement('button'), { type: 'button', textContent: '+ Species', title: 'Add a species and the step after it' });
      add.addEventListener('click', () => row(''));
      const mid = document.createElement('label');
      mid.className = 'ask-row';
      mid.innerHTML = '<span>In the middle</span>';
      const midIn = Object.assign(document.createElement('input'), { name: 'middle', value: loop.middle ?? '' });
      mid.append(midIn);
      fs.append(lg, table, add, mid);
      return fs;
    };

    const fill = (id: string) => {
      const p = CYCLE_PRESETS.find((x) => x.id === id) ?? CYCLE_PRESETS[0];
      $('.cycle-blurb').textContent = p.blurb;
      loopsEl.replaceChildren(...p.spec.loops.map(loopTable));
      joinEl.hidden = p.spec.loops.length < 2;
      if (p.spec.join) {
        joinSel.value = p.spec.join.kind;
        ja.value = String(p.spec.join.a + 1);
        jb.value = String(p.spec.join.b + 1);
      }
      showJoin();
    };
    presetSel.value = last.preset;
    presetSel.addEventListener('change', () => fill(presetSel.value));
    fill(presetSel.value);
    $<HTMLSelectElement>('select[name=dir]').value = last.look.anticlockwise ? 'acw' : 'cw';
    $<HTMLSelectElement>('select[name=names]').value = last.look.names;
    $<HTMLInputElement>('input[name=arrows]').checked = last.look.reagentArrows;

    d.append(form);
    document.body.append(d);
    const finish = (v: CycleChoice | null) => { d.remove(); resolve(v); };
    form.querySelector('[data-act=cancel]')!.addEventListener('click', () => { d.close(); finish(null); });
    d.addEventListener('cancel', () => finish(null));
    d.addEventListener('keydown', (e) => { if (e.key !== 'Escape') e.stopPropagation(); });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const loops: CycleLoop[] = [...loopsEl.querySelectorAll<HTMLFieldSetElement>('fieldset')].map((fs) => {
        const rows = [...fs.querySelectorAll<HTMLTableRowElement>('tbody tr')];
        const v = (tr: HTMLTableRowElement, n: string) => tr.querySelector<HTMLInputElement>(`input[name=${n}]`)!.value.trim();
        return {
          stations: rows.map((tr) => v(tr, 'st')),
          steps: rows.map((tr) => ({ short: tr.dataset.short ?? '', name: v(tr, 'step'), inn: v(tr, 'inn'), out: v(tr, 'out') })),
          middle: fs.querySelector<HTMLInputElement>('input[name=middle]')!.value.trim(),
        };
      });
      const spec: CycleSpec = { loops };
      if (loops.length > 1) {
        const kind = joinSel.value as CycleJoin['kind'];
        const clamp = (x: string, n: number) => Math.max(0, Math.min(n - 1, (Number(x) || 1) - 1));
        spec.join = { kind, a: clamp(ja.value, loops[0].stations.length), b: clamp(jb.value, loops[1].stations.length) };
      }
      const look: CycleLook = {
        anticlockwise: $<HTMLSelectElement>('select[name=dir]').value === 'acw',
        names: $<HTMLSelectElement>('select[name=names]').value as CycleLook['names'],
        reagentArrows: $<HTMLInputElement>('input[name=arrows]').checked,
      };
      last = { preset: presetSel.value, look };
      d.close();
      finish({ spec, look });
    });
    d.showModal();
  });
}
