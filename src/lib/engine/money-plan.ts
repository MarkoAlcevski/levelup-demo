import { addDays, addMonths, daysInMonth, diffDays, endOfMonth, startOfMonth, type ISODate } from './dates';
import type { Ctx, SeriesRec } from './finance';

/**
 * The user's own financial model: recurring items, budgets, targets, a monthly plan — compared
 * with what the ledger says. Every output is arithmetic the UI can state in a sentence
 * ("€132 of €150 used with 11 days remaining"). Nothing here recommends anything.
 */

// ───────────────────────────────────────────── recurring occurrences

const STEP_MONTHS: Record<SeriesRec['cadence'], number> = { week: 0, month: 1, quarter: 3, year: 12 };

function step(d: ISODate, cadence: SeriesRec['cadence'], n: number): ISODate {
  return cadence === 'week' ? addDays(d, 7 * n) : addMonths(d, STEP_MONTHS[cadence] * n);
}

/**
 * Dates a series falls on within [from, to]. `nextOn` is the next due date the user gave; if it is
 * in the past (nobody moved it forward), occurrences are projected from it on the same rhythm.
 */
export function occurrences(s: Pick<SeriesRec, 'cadence' | 'intervalCount' | 'nextOn' | 'status'> & { endedOn?: ISODate | null }, from: ISODate, to: ISODate): ISODate[] {
  if (s.status !== 'active' || !s.nextOn) return [];
  const n = Math.max(1, s.intervalCount);
  let d = s.nextOn;
  let guard = 0;
  while (d < from && guard++ < 2000) d = step(d, s.cadence, n);
  const out: ISODate[] = [];
  guard = 0;
  while (d <= to && guard++ < 400) {
    if (s.endedOn && d > s.endedOn) break;
    out.push(d);
    d = step(d, s.cadence, n);
  }
  return out;
}

/**
 * Dates a series falls on within [from, to], including ones already behind `nextOn` (a bill paid on
 * the 1st still belongs to this month's plan). Each date is computed from `nextOn` directly, so a
 * 31st never drifts to the 28th, and nothing is invented before the series started.
 */
export function occurrencesIn(
  s: Pick<SeriesRec, 'cadence' | 'intervalCount' | 'nextOn' | 'status'> & { startedOn?: ISODate | null; endedOn?: ISODate | null },
  from: ISODate,
  to: ISODate,
): ISODate[] {
  if (s.status !== 'active' || !s.nextOn) return [];
  const n = Math.max(1, s.intervalCount);
  const out: ISODate[] = [];
  for (let k = -1; k > -600; k--) {
    const d = step(s.nextOn, s.cadence, k * n);
    if (d < from || (s.startedOn && d < s.startedOn)) break;
    if (d <= to) out.unshift(d);
  }
  for (let k = 0; k < 600; k++) {
    const d = step(s.nextOn, s.cadence, k * n);
    if (d > to || (s.endedOn && d > s.endedOn)) break;
    if (d >= from) out.push(d);
  }
  return out;
}

/** The next due date on or after `today`. */
export function nextDue(s: Pick<SeriesRec, 'cadence' | 'intervalCount' | 'nextOn' | 'status'>, today: ISODate): ISODate | null {
  return occurrences(s, today, addDays(today, 800))[0] ?? null;
}

// ───────────────────────────────────────────── budgets

export interface BudgetProgress {
  amount: number;
  spent: number;
  remaining: number;
  used: number;
  /** share of the period elapsed, 0–1 */
  elapsed: number;
  daysLeft: number;
  /** if spending continued at the period's average daily rate */
  projected: number;
  status: 'under' | 'pace_over' | 'over';
}

export function budgetProgress(amount: number, spent: number, period: { start: ISODate; end: ISODate }, today: ISODate): BudgetProgress {
  const total = diffDays(period.start, period.end) + 1;
  const elapsedDays = Math.min(total, Math.max(1, diffDays(period.start, today) + 1));
  const projected = today >= period.end ? spent : Math.round((spent / elapsedDays) * total);
  return {
    amount,
    spent,
    remaining: amount - spent,
    used: amount > 0 ? spent / amount : 0,
    elapsed: elapsedDays / total,
    daysLeft: Math.max(0, diffDays(today, period.end)),
    projected,
    status: spent > amount ? 'over' : projected > amount ? 'pace_over' : 'under',
  };
}

// ───────────────────────────────────────────── targets

export type TargetKind = 'income' | 'savings' | 'investment' | 'spending_ceiling' | 'emergency_fund' | 'net_worth' | 'debt_payoff';
export const MONTHLY_TARGETS: ReadonlySet<TargetKind> = new Set(['income', 'savings', 'investment', 'spending_ceiling']);

export interface TargetProgress {
  kind: TargetKind;
  target: number;
  current: number;
  progress: number;
  remaining: number;
  daysLeft: number | null;
  /** arithmetic only: what an even split of the remainder over the days left would be */
  perDay: number | null;
  met: boolean;
  /** for a ceiling: over it */
  over: boolean;
}

export function targetProgress(kind: TargetKind, target: number, current: number, opts: { today: ISODate; periodEnd: ISODate | null; start?: number | null }): TargetProgress {
  const daysLeft = opts.periodEnd ? Math.max(0, diffDays(opts.today, opts.periodEnd)) : null;
  if (kind === 'spending_ceiling') {
    const remaining = target - current;
    return {
      kind, target, current, progress: target > 0 ? current / target : 0, remaining, daysLeft,
      perDay: daysLeft && remaining > 0 ? Math.floor(remaining / daysLeft) : daysLeft === 0 ? null : 0,
      met: current <= target, over: current > target,
    };
  }
  if (kind === 'debt_payoff') {
    const start = Math.max(0, opts.start ?? target);
    const owed = Math.max(0, current);
    const paid = Math.max(0, start - owed);
    return {
      kind, target: start, current: paid, progress: start > 0 ? Math.min(1, paid / start) : 1, remaining: owed, daysLeft,
      perDay: daysLeft ? Math.ceil(owed / daysLeft) : null, met: owed === 0, over: false,
    };
  }
  const remaining = Math.max(0, target - current);
  return {
    kind, target, current, progress: target > 0 ? Math.max(0, current / target) : 0, remaining, daysLeft,
    perDay: remaining === 0 ? 0 : daysLeft ? Math.ceil(remaining / daysLeft) : null,
    met: current >= target, over: false,
  };
}

// ───────────────────────────────────────────── the monthly plan

export interface MonthPlanInput {
  month: ISODate;
  today: ISODate;
  recurringIncome: number;
  recurringExpenses: number;
  expectedIncome: number;
  /** Σ category budgets (variable spending the user planned) */
  categoryBudgets: number;
  /** overall monthly spending budget, if set */
  overallBudget: number | null;
  plannedSavings: number;
  plannedInvestments: number;
  actual: { income: number; expenses: number; savings: number; investments: number };
}

export interface MonthPlan {
  planned: { income: number; spending: number; savings: number; investments: number; remaining: number };
  actual: { income: number; spending: number; savings: number; investments: number; remaining: number };
  /** month elapsed, 0–1 */
  elapsed: number;
  hasPlan: boolean;
}

export function monthPlan(i: MonthPlanInput): MonthPlan {
  const income = i.recurringIncome + i.expectedIncome;
  const spending = Math.max(i.overallBudget ?? 0, i.recurringExpenses + i.categoryBudgets);
  const planned = { income, spending, savings: i.plannedSavings, investments: i.plannedInvestments, remaining: income - spending - i.plannedSavings - i.plannedInvestments };
  const a = i.actual;
  const start = startOfMonth(i.month);
  const end = endOfMonth(i.month);
  const elapsed = i.today >= end ? 1 : Math.max(0, (diffDays(start, i.today) + 1) / daysInMonth(start));
  return {
    planned,
    actual: { income: a.income, spending: a.expenses, savings: a.savings, investments: a.investments, remaining: a.income - a.expenses - a.savings - a.investments },
    elapsed,
    hasPlan: income > 0 || spending > 0 || i.plannedSavings > 0 || i.plannedInvestments > 0,
  };
}

// ───────────────────────────────────────────── cash-flow projection

export interface ProjectionItem {
  on: ISODate;
  name: string;
  amount: number; // base minor units, signed
  kind: 'income' | 'expense' | 'budget';
}

export interface Projection {
  start: number;
  points: { day: ISODate; balance: number }[];
  at: { days: number; balance: number }[];
  lowest: { day: ISODate; balance: number };
  upcoming: ProjectionItem[];
  budgetPerDay: number;
}

/**
 * A projection, not a prediction: today's liquid cash, plus recurring income, minus recurring bills,
 * minus planned variable spending (the user's budgets spread evenly). Nothing else is assumed.
 */
export function projectCash(opts: {
  today: ISODate;
  startLiquid: number;
  series: (SeriesRec & { endedOn?: ISODate | null })[];
  ctx: Ctx;
  budgetMonthly: number;
  horizon?: number;
}): Projection {
  const horizon = opts.horizon ?? 90;
  const end = addDays(opts.today, horizon);
  const items: ProjectionItem[] = [];
  for (const s of opts.series) {
    for (const d of occurrences(s, addDays(opts.today, 1), end)) {
      const c = opts.ctx.book.convert(s.amountMinor, s.currency, opts.ctx.base, opts.today);
      if (!c) continue;
      items.push({ on: d, name: s.name, amount: s.kind === 'income' ? c.minor : -c.minor, kind: s.kind });
    }
  }
  items.sort((a, b) => (a.on < b.on ? -1 : a.on > b.on ? 1 : 0));
  const budgetPerDay = Math.round(opts.budgetMonthly / 30.44);
  const points: { day: ISODate; balance: number }[] = [{ day: opts.today, balance: opts.startLiquid }];
  let bal = opts.startLiquid;
  let lowest = { day: opts.today, balance: bal };
  for (let i = 1; i <= horizon; i++) {
    const day = addDays(opts.today, i);
    bal -= budgetPerDay;
    for (const it of items) if (it.on === day) bal += it.amount;
    points.push({ day, balance: bal });
    if (bal < lowest.balance) lowest = { day, balance: bal };
  }
  return {
    start: opts.startLiquid,
    points,
    at: [30, 60, 90].filter((n) => n <= horizon).map((n) => ({ days: n, balance: points[n].balance })),
    lowest,
    upcoming: items.slice(0, 12),
    budgetPerDay,
  };
}

// ───────────────────────────────────────────── statements for reports

export interface Change {
  label: string;
  current: number;
  previous: number;
  /** relative change, null when the previous value was 0 */
  change: number | null;
  upIsGood: boolean;
}

/**
 * Sort changes into what changed / what held steady. Thresholds are explicit: "changed" means at
 * least 15% AND at least `minAbs` in money; "stable" means within 5%. Everything else is left out.
 */
export function classifyChanges(changes: Change[], minAbs: number): { changed: Change[]; stable: Change[] } {
  const changed: Change[] = [];
  const stable: Change[] = [];
  for (const c of changes) {
    if (c.previous === 0 && c.current === 0) continue;
    const abs = Math.abs(c.current - c.previous);
    if (c.change != null && Math.abs(c.change) >= 0.15 && abs >= minAbs) changed.push(c);
    else if (c.change != null && Math.abs(c.change) < 0.05) stable.push(c);
  }
  changed.sort((a, b) => Math.abs(b.current - b.previous) - Math.abs(a.current - a.previous));
  return { changed, stable };
}

export function monthKey(d: ISODate): string {
  return d.slice(0, 7);
}
