// Solver: the three engines on small models with known answers, run on sheets, and the model
// kept in Excel's hidden names.

import { describe, expect, it } from 'vitest';
import { Workbook } from '../src/sheet/workbook';
import { lp, modelNames, modelFromNames, type SolverModel } from '../src/sheet/solver';
import { runSolver, keepAnswer, answerReport } from '../src/sheet/solver-sheet';

function sheet(cells: Record<string, string>) {
  const wb = new Workbook();
  const s = wb.sheets[0];
  wb.edit('set', () => {
    for (const [ref, v] of Object.entries(cells)) {
      const m = /^([A-Z])(\d+)$/.exec(ref)!;
      s.setInput(Number(m[2]) - 1, m[1].charCodeAt(0) - 65, v);
    }
  });
  return { wb, s };
}

const model = (over: Partial<SolverModel>): SolverModel => ({ objective: '', goal: 'max', vars: '', constraints: [], nonNegative: true, engine: 'simplex', ...over });

describe('Solver', () => {
  it('the simplex method', () => {
    // max 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18 → x = 2, y = 6, 36
    const r = lp([-3, -5], [[1, 0], [0, 2], [3, 2]], [4, 12, 18], ['<=', '<=', '<='], [0, 0], [Infinity, Infinity]);
    expect(r.status).toBe('optimal');
    expect(r.x[0]).toBeCloseTo(2, 9);
    expect(r.x[1]).toBeCloseTo(6, 9);
    expect(lp([1], [[1]], [5], ['>='], [0], [3]).status).toBe('infeasible');
    expect(lp([-1], [[1]], [-5], ['>='], [0], [Infinity]).status).toBe('unbounded');
    // a variable with no lower bound
    const free = lp([1], [[1]], [-3], ['>='], [-Infinity], [Infinity]);
    expect(free.x[0]).toBeCloseTo(-3, 9);
  });

  it('Simplex LP on a sheet: the most product from limited reagents', () => {
    const { wb, s } = sheet({
      A1: '0', A2: '0', A3: '=3*A1+5*A2', A4: '=A1', A5: '=2*A2', A6: '=3*A1+2*A2',
    });
    const m = model({ objective: '=$A$3', vars: '=$A$1:$A$2', constraints: [{ lhs: '=$A$4', rel: '<=', rhs: '4' }, { lhs: '=$A$5', rel: '<=', rhs: '12' }, { lhs: '=$A$6', rel: '<=', rhs: '=18' }] });
    const run = runSolver(wb, s, m);
    if (typeof run === 'string') throw new Error(run);
    expect(run.result.status).toBe('optimal');
    expect(run.result.x[0]).toBeCloseTo(2, 8);
    expect(run.result.x[1]).toBeCloseTo(6, 8);
    // nothing changed until the answer is kept
    expect(s.value(2, 0)).toBe(0);
    wb.edit('Solver', () => keepAnswer(s, run));
    expect(s.value(2, 0)).toBeCloseTo(36, 8);
    const rep = answerReport(s, m, run, new Date());
    expect(rep.some((r) => r[5] === 'Binding')).toBe(true);
    // a model that isn't linear is refused by Simplex LP
    const nl = sheet({ A1: '1', A2: '=A1*A1' });
    const r2 = runSolver(nl.wb, nl.s, model({ objective: '=$A$2', vars: '=$A$1', goal: 'min' }));
    if (typeof r2 === 'string') throw new Error(r2);
    expect(r2.result.status).toBe('notLinear');
  });

  it('whole numbers by branch and bound', () => {
    // knapsack: values 10, 13, 7; weights 5, 6, 4; capacity 10; each 0 or 1 → items 1 and 3 (17)? 2 and 3 (20)
    const { wb, s } = sheet({ A1: '0', A2: '0', A3: '0', B1: '=10*A1+13*A2+7*A3', B2: '=5*A1+6*A2+4*A3' });
    const run = runSolver(wb, s, model({ objective: '=$B$1', vars: '=$A$1:$A$3', constraints: [{ lhs: '=$B$2', rel: '<=', rhs: '10' }, { lhs: '=$A$1:$A$3', rel: 'bin' }] }));
    if (typeof run === 'string') throw new Error(run);
    expect(run.result.x).toEqual([0, 1, 1]);
    expect(run.result.f).toBeCloseTo(-20, 9);
  });

  it('GRG Nonlinear fits a rate constant', () => {
    // first-order decay: concentrations at t = 0…4 for k = 0.35; find k by least squares (start at 1)
    const cells: Record<string, string> = { E1: '1' };
    for (let i = 0; i < 5; i++) {
      cells[`A${i + 1}`] = String(i);
      cells[`B${i + 1}`] = String(Math.exp(-0.35 * i));
      cells[`C${i + 1}`] = `=(B${i + 1}-EXP(-$E$1*A${i + 1}))^2`;
    }
    cells.E2 = '=SUM(C1:C5)';
    const { wb, s } = sheet(cells);
    const run = runSolver(wb, s, model({ engine: 'grg', goal: 'min', objective: '=$E$2', vars: '=$E$1' }));
    if (typeof run === 'string') throw new Error(run);
    expect(['optimal', 'converged']).toContain(run.result.status);
    expect(run.result.x[0]).toBeCloseTo(0.35, 4);
  });

  it('GRG keeps to constraints and Value Of', () => {
    // min x² + y² with x + y ≥ 2 → (1, 1)
    const { wb, s } = sheet({ A1: '3', A2: '0', A3: '=A1^2+A2^2', A4: '=A1+A2' });
    const run = runSolver(wb, s, model({ engine: 'grg', goal: 'min', objective: '=$A$3', vars: '=$A$1:$A$2', constraints: [{ lhs: '=$A$4', rel: '>=', rhs: '2' }] }));
    if (typeof run === 'string') throw new Error(run);
    expect(run.result.x[0]).toBeCloseTo(1, 3);
    expect(run.result.x[1]).toBeCloseTo(1, 3);
    // Value Of: x³ = 27
    const v = sheet({ A1: '1', A2: '=A1^3' });
    const r2 = runSolver(v.wb, v.s, model({ engine: 'grg', goal: 'value', value: 27, objective: '=$A$2', vars: '=$A$1' }));
    if (typeof r2 === 'string') throw new Error(r2);
    expect(r2.result.x[0]).toBeCloseTo(3, 4);
  });

  it('Evolutionary needs bounds, and finds a rough optimum', () => {
    const { wb, s } = sheet({ A1: '0', A2: '=ABS(A1-3.3)+IF(A1>5,0,1)' });
    const none = runSolver(wb, s, model({ engine: 'evolutionary', goal: 'min', objective: '=$A$2', vars: '=$A$1', nonNegative: false }));
    if (typeof none === 'string') throw new Error(none);
    expect(none.result.status).toBe('error');
    // a kink and a step: the least is 1 at x = 3.3 (whole numbers: 1.3 at 3)
    const run = runSolver(wb, s, model({ engine: 'evolutionary', goal: 'min', objective: '=$A$2', vars: '=$A$1', seed: 7, constraints: [{ lhs: '=$A$1', rel: '<=', rhs: '10' }, { lhs: '=$A$1', rel: 'int' }] }));
    if (typeof run === 'string') throw new Error(run);
    expect(run.result.x[0]).toBe(3);
    const free = runSolver(wb, s, model({ engine: 'evolutionary', goal: 'min', objective: '=$A$2', vars: '=$A$1', seed: 7, constraints: [{ lhs: '=$A$1', rel: '<=', rhs: '10' }] }));
    if (typeof free === 'string') throw new Error(free);
    expect(free.result.x[0]).toBeCloseTo(3.3, 3);
  });

  it('keeps the model as Excel keeps it', () => {
    const { s } = sheet({ A1: '1' });
    const m = model({ objective: '=$B$5', vars: '=$B$1:$B$3', goal: 'min', engine: 'grg', constraints: [{ lhs: '=$B$4', rel: '<=', rhs: '=10' }, { lhs: '=$B$1:$B$3', rel: 'int' }] });
    const names = modelNames(m, s);
    expect(names.find((n) => n.name === 'solver_typ')?.formula).toBe('=2');
    expect(names.find((n) => n.name === 'solver_rhs2')?.formula).toBe('="integer"');
    expect(names.every((n) => n.hidden && n.sheet === s)).toBe(true);
    const back = modelFromNames(names, s)!;
    expect(back.objective).toBe('=$B$5');
    expect(back.goal).toBe('min');
    expect(back.constraints).toEqual([{ lhs: '=$B$4', rel: '<=', rhs: '=10' }, { lhs: '=$B$1:$B$3', rel: 'int' }]);
  });
});
