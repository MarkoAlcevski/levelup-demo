import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, addMonths, endOfMonth, monthName, startOfMonth, type ISODate } from '@/lib/engine/dates';
import {
  balanceSheet, expenseAnomalies, expensesByCategory, flowTotals, incomeBySource, monthlyEquivalent, subscriptionSummary,
  type Ctx, type SeriesRec,
} from '@/lib/engine/finance';
import { formatMoney, parseAmount } from '@/lib/engine/money';
import {
  budgetProgress, classifyChanges, monthPlan, MONTHLY_TARGETS, nextDue, occurrencesIn, projectCash, targetProgress,
  type BudgetProgress, type Change, type MonthPlan, type Projection, type TargetKind, type TargetProgress,
} from '@/lib/engine/money-plan';
import { pctChange } from '@/lib/engine/period';
import type { Viewer } from './profile';
import { loadFinance, type FinanceData, type SeriesFull } from './money';
import { track } from './analytics';

/**
 * Money → Plan: recurring items, subscriptions, budgets, financial targets and the monthly plan,
 * each compared with the ledger. Plus the monthly Money Report. All amounts are in the base
 * currency unless a row says otherwise; conversions use the dated rates the Overview discloses.
 */

export interface SeriesView {
  id: string;
  kind: 'income' | 'expense';
  name: string;
  amountMinor: number;
  currency: string;
  monthly: number | null;
  cadence: SeriesRec['cadence'];
  intervalCount: number;
  nextOn: ISODate | null;
  due: ISODate | null;
  isSubscription: boolean;
  verdict: SeriesRec['verdict'];
  status: SeriesRec['status'];
  accountId: string | null;
  categoryId: string | null;
  counterparty: string | null;
}

export interface BudgetView extends BudgetProgress {
  id: string;
  categoryId: string | null;
  name: string;
  currency: string;
}

export interface TargetView extends TargetProgress {
  id: string;
  title: string;
  currency: string;
  accountId: string | null;
  targetOn: ISODate | null;
  monthly: boolean;
}

export interface MoneyPlanPage {
  base: string;
  today: ISODate;
  month: ISODate;
  income: SeriesView[];
  bills: SeriesView[];
  subscriptions: SeriesView[];
  subscriptionTotals: ReturnType<typeof subscriptionSummary>;
  budgets: BudgetView[];
  targets: TargetView[];
  plan: MonthPlan;
  planRow: { expectedIncome: number; plannedSavings: number; plannedInvestments: number; note: string | null };
  projection: Projection;
  accounts: { id: string; name: string; currency: string; type: string }[];
  categories: { id: string; name: string; kind: 'income' | 'expense' }[];
}

function toSeriesView(s: SeriesFull, f: FinanceData, base: string, today: ISODate): SeriesView {
  return {
    id: s.id, kind: s.kind, name: s.name, amountMinor: s.amountMinor, currency: s.currency,
    monthly: f.book.convert(monthlyEquivalent(s), s.currency, base, today)?.minor ?? null,
    cadence: s.cadence, intervalCount: s.intervalCount, nextOn: s.nextOn, due: nextDue(s, today), isSubscription: s.isSubscription,
    verdict: s.verdict, status: s.status, accountId: s.accountId, categoryId: s.categoryId, counterparty: s.counterparty,
  };
}

async function budgetsFor(q: Queryable, f: FinanceData, ctx: Ctx, month: ISODate, today: ISODate): Promise<BudgetView[]> {
  const rows = await q.query<{ id: string; category_id: string | null; amount_minor: number; currency: string }>(
    `select id, category_id, amount_minor, currency from budgets
      where active_from <= $2 and (active_to is null or active_to >= $1) and period = 'month'
      order by category_id nulls first, created_at`,
    [startOfMonth(month), endOfMonth(month)],
  );
  const period = { start: startOfMonth(month), end: endOfMonth(month) };
  const cats = expensesByCategory(f.txs, f.categoryMap, period, { base: ctx.base, book: ctx.book });
  const total = cats.reduce((s, c) => s + c.amount, 0);
  return rows.map((b) => {
    const spentBase = b.category_id ? cats.find((c) => c.categoryId === b.category_id)?.amount ?? 0 : total;
    const spent = b.currency === ctx.base ? spentBase : ctx.book.convert(spentBase, ctx.base, b.currency, today)?.minor ?? spentBase;
    return {
      id: b.id,
      categoryId: b.category_id,
      name: b.category_id ? f.categoryMap.get(b.category_id)?.name ?? 'Category' : 'All spending',
      currency: b.currency,
      ...budgetProgress(Number(b.amount_minor), spent, period, today),
    };
  });
}

/** Where every target stands today. Monthly targets use the current calendar month. */
export async function targetsFor(q: Queryable, viewer: Viewer, f: FinanceData): Promise<TargetView[]> {
  const { today } = viewer;
  const base = viewer.profile.baseCurrency;
  const ctx = { base, book: f.book };
  const rows = await q.query<{ id: string; kind: TargetKind; title: string; amount_minor: number; currency: string; account_id: string | null; start_minor: number | null; target_on: string | null }>(
    `select id, kind, title, amount_minor, currency, account_id, start_minor, target_on from finance_targets where archived_at is null order by created_at`,
  );
  if (!rows.length) return [];
  const month = { preset: 'month' as const, start: startOfMonth(today), end: endOfMonth(today), label: '' };
  const flows = flowTotals(f.txs, f.accountMap, month, today, ctx);
  const bs = balanceSheet(f.accounts, f.txs, f.valuations, today, ctx);
  const toTarget = (minor: number, cur: string) => (cur === base ? minor : f.book.convert(minor, base, cur, today)?.minor ?? minor);
  return rows.map((t) => {
    let current = 0;
    switch (t.kind) {
      case 'income': current = flows.income; break;
      case 'savings': current = flows.net; break;
      case 'investment': current = flows.movedToInvestments; break;
      case 'spending_ceiling': current = flows.expenses; break;
      case 'net_worth': current = bs.netWorth; break;
      case 'emergency_fund': {
        const a = t.account_id ? bs.accounts.find((x) => x.account.id === t.account_id) : null;
        current = a ? a.converted ?? 0 : bs.liquid;
        break;
      }
      case 'debt_payoff': {
        const a = t.account_id ? bs.accounts.find((x) => x.account.id === t.account_id) : null;
        current = a ? -(a.converted ?? 0) : 0;
        break;
      }
    }
    const monthly = MONTHLY_TARGETS.has(t.kind);
    const inTarget = toTarget(current, t.currency);
    const start = t.start_minor == null ? null : Number(t.start_minor);
    return {
      id: t.id, title: t.title, currency: t.currency, accountId: t.account_id, targetOn: t.target_on, monthly,
      ...targetProgress(t.kind, Number(t.amount_minor), inTarget, { today, periodEnd: monthly ? month.end : t.target_on, start }),
    };
  });
}

export async function loadMoneyPlan(viewer: Viewer): Promise<MoneyPlanPage> {
  const { today, profile } = viewer;
  const base = profile.baseCurrency;
  const month = startOfMonth(today);
  return asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, base);
    const ctx = { base, book: f.book };
    const [budgets, targets, planRows, accounts, categories] = await Promise.all([
      budgetsFor(q, f, ctx, month, today),
      targetsFor(q, viewer, f),
      q.query<{ expected_income_minor: number; planned_savings_minor: number; planned_investments_minor: number; note: string | null; currency: string }>(
        `select expected_income_minor, planned_savings_minor, planned_investments_minor, note, currency from money_plans where month = $1`,
        [month],
      ),
      q.query<{ id: string; name: string; currency: string; type: string }>(`select id, name, currency, type from accounts where archived_at is null order by sort_order, created_at`),
      q.query<{ id: string; name: string; kind: 'income' | 'expense' }>(`select id, name, kind from categories where archived_at is null order by kind, sort_order`),
    ]);
    const live = f.series.filter((s) => s.status !== 'ended');
    const views = live.map((s) => toSeriesView(s, f, base, today)).sort((a, b) => (a.due ?? '9999') < (b.due ?? '9999') ? -1 : 1);
    const monthEnd = endOfMonth(month);
    const inMonth = (s: SeriesFull) =>
      occurrencesIn(s, month, monthEnd).reduce((sum) => sum + (f.book.convert(s.amountMinor, s.currency, base, today)?.minor ?? 0), 0);
    const recurringIncome = live.filter((s) => s.kind === 'income').reduce((sum, s) => sum + inMonth(s), 0);
    const recurringExpenses = live.filter((s) => s.kind === 'expense').reduce((sum, s) => sum + inMonth(s), 0);
    const inBase = (b: BudgetView) => (b.currency === base ? b.amount : f.book.convert(b.amount, b.currency, base, today)?.minor ?? b.amount);
    const overall = budgets.find((b) => !b.categoryId);
    const categoryBudgets = budgets.filter((b) => b.categoryId).reduce((s, b) => s + inBase(b), 0);
    const flows = flowTotals(f.txs, f.accountMap, { preset: 'month', start: month, end: monthEnd, label: '' }, today, ctx);
    const row = planRows[0];
    const conv = (m: number, cur: string) => (cur === base ? m : f.book.convert(m, cur, base, today)?.minor ?? m);
    const plan = monthPlan({
      month, today, recurringIncome, recurringExpenses,
      expectedIncome: row ? conv(Number(row.expected_income_minor), row.currency) : 0,
      categoryBudgets, overallBudget: overall ? inBase(overall) : null,
      plannedSavings: row ? conv(Number(row.planned_savings_minor), row.currency) : 0,
      plannedInvestments: row ? conv(Number(row.planned_investments_minor), row.currency) : 0,
      actual: { income: flows.income, expenses: flows.expenses, savings: flows.movedToSavings, investments: flows.movedToInvestments },
    });
    const bs = balanceSheet(f.accounts, f.txs, f.valuations, today, ctx);
    const recurringMonthlyExpense = live.filter((s) => s.kind === 'expense' && s.status === 'active').reduce((s, x) => s + (f.book.convert(monthlyEquivalent(x), x.currency, base, today)?.minor ?? 0), 0);
    const budgetMonthly = overall ? Math.max(0, inBase(overall) - recurringMonthlyExpense) : categoryBudgets;
    return {
      base,
      today,
      month,
      income: views.filter((v) => v.kind === 'income'),
      bills: views.filter((v) => v.kind === 'expense' && !v.isSubscription),
      subscriptions: views.filter((v) => v.kind === 'expense' && v.isSubscription),
      subscriptionTotals: subscriptionSummary(f.series, today, ctx),
      budgets,
      targets,
      plan,
      planRow: {
        expectedIncome: row ? conv(Number(row.expected_income_minor), row.currency) : 0,
        plannedSavings: row ? conv(Number(row.planned_savings_minor), row.currency) : 0,
        plannedInvestments: row ? conv(Number(row.planned_investments_minor), row.currency) : 0,
        note: row?.note ?? null,
      },
      projection: projectCash({ today, startLiquid: bs.liquid, series: live.map((s) => ({ ...s, endedOn: s.endedOn })), ctx, budgetMonthly }),
      accounts,
      categories,
    };
  });
}

// ───────────────────────────────────────────── recurring

const seriesInput = z.object({
  kind: z.enum(['income', 'expense']),
  name: z.string().trim().min(1, 'Name it.').max(60),
  amount: z.string().trim().min(1).max(24),
  currency: z.string().regex(/^[A-Z]{3}$/),
  cadence: z.enum(['week', 'month', 'quarter', 'year']),
  intervalCount: z.number().int().min(1).max(12).default(1),
  nextOn: z.iso.date(),
  accountId: z.uuid().nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  counterparty: z.string().trim().max(80).nullable().optional(),
  isSubscription: z.boolean().default(false),
  verdict: z.enum(['essential', 'useful', 'questionable', 'cancel']).nullable().optional(),
});
export type SeriesInput = z.input<typeof seriesInput>;

export async function saveRecurring(viewer: Viewer, id: string | null, raw: SeriesInput) {
  const parsed = seriesInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the item.' };
  const v = parsed.data;
  const amount = parseAmount(v.amount, v.currency);
  if (amount == null || amount <= 0) return { ok: false as const, error: 'Enter an amount above zero.' };
  const res = await asUser(viewer.userId, async (q) => {
    if (v.accountId) {
      const [a] = await q.query<{ currency: string }>(`select currency from accounts where id = $1`, [v.accountId]);
      if (!a) return { ok: false as const, error: 'Account not found.' };
    }
    const params = [v.kind, v.name, amount, v.currency, v.cadence, v.intervalCount, v.nextOn, v.accountId ?? null, v.categoryId ?? null, v.counterparty || null, v.kind === 'expense' && v.isSubscription, v.kind === 'expense' ? v.verdict ?? null : null];
    if (id) {
      const rows = await q.query(
        `update recurring_series set kind = $2, name = $3, amount_minor = $4, currency = $5, cadence = $6, interval_count = $7, next_on = $8,
                account_id = $9, category_id = $10, counterparty = $11, is_subscription = $12, verdict = $13 where id = $1 returning id`,
        [id, ...params],
      );
      if (!rows.length) return { ok: false as const, error: 'Not found.' };
    } else {
      await q.query(
        `insert into recurring_series (kind, name, amount_minor, currency, cadence, interval_count, next_on, account_id, category_id, counterparty,
                                       is_subscription, verdict, started_on)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [...params, viewer.today],
      );
    }
    return { ok: true as const };
  });
  if (res.ok) void track(viewer.userId, 'recurring_saved', { kind: v.kind, subscription: v.isSubscription });
  return res;
}

export async function setRecurringStatus(viewer: Viewer, id: string, status: 'active' | 'paused' | 'ended') {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid item.' };
  await asUser(viewer.userId, (q) =>
    q.query(`update recurring_series set status = $2, ended_on = case when $2 = 'ended' then $3::date else null end where id = $1`, [id, status, viewer.today]),
  );
  return { ok: true as const };
}

// ───────────────────────────────────────────── budgets

const budgetInput = z.object({
  categoryId: z.uuid().nullable(),
  amount: z.string().trim().min(1).max(24),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

/** One current budget per category. A changed amount applies from this month; past months keep theirs. */
export async function saveBudget(viewer: Viewer, raw: z.input<typeof budgetInput>) {
  const parsed = budgetInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: 'Check the budget.' };
  const v = parsed.data;
  const amount = parseAmount(v.amount, v.currency);
  if (amount == null || amount <= 0) return { ok: false as const, error: 'Enter an amount above zero.' };
  const month = startOfMonth(viewer.today);
  await asUser(viewer.userId, async (q) => {
    const [cur] = await q.query<{ id: string; active_from: string }>(
      `select id, active_from from budgets where active_to is null and category_id is not distinct from $1`,
      [v.categoryId],
    );
    if (cur && cur.active_from >= month) {
      await q.query(`update budgets set amount_minor = $2, currency = $3 where id = $1`, [cur.id, amount, v.currency]);
      return;
    }
    if (cur) await q.query(`update budgets set active_to = $2 where id = $1`, [cur.id, addDays(month, -1)]);
    await q.query(`insert into budgets (category_id, amount_minor, currency, period, active_from) values ($1, $2, $3, 'month', $4)`, [v.categoryId, amount, v.currency, month]);
  });
  void track(viewer.userId, 'budget_saved', { overall: !v.categoryId });
  return { ok: true as const };
}

export async function removeBudget(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid budget.' };
  const month = startOfMonth(viewer.today);
  await asUser(viewer.userId, async (q) => {
    const [b] = await q.query<{ active_from: string }>(`select active_from from budgets where id = $1`, [id]);
    if (!b) return;
    if (b.active_from >= month) await q.query(`delete from budgets where id = $1`, [id]);
    else await q.query(`update budgets set active_to = $2 where id = $1`, [id, addDays(month, -1)]);
  });
  return { ok: true as const };
}

// ───────────────────────────────────────────── targets

const targetInput = z.object({
  kind: z.enum(['income', 'savings', 'investment', 'spending_ceiling', 'emergency_fund', 'net_worth', 'debt_payoff']),
  title: z.string().trim().min(1).max(80),
  amount: z.string().trim().max(24).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  accountId: z.uuid().nullable().optional(),
  targetOn: z.iso.date().nullable().optional(),
});
export type TargetInput = z.input<typeof targetInput>;

export async function saveTarget(viewer: Viewer, id: string | null, raw: TargetInput) {
  const parsed = targetInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the target.' };
  const v = parsed.data;
  const res = await asUser(viewer.userId, async (q) => {
    let amount = v.amount ? parseAmount(v.amount, v.currency) : null;
    let start: number | null = null;
    if (v.kind === 'debt_payoff') {
      if (!v.accountId) return { ok: false as const, error: 'Pick the loan or card you’re paying off.' };
      const f = await loadFinance(q, viewer.profile.baseCurrency);
      const bs = balanceSheet(f.accounts, f.txs, f.valuations, viewer.today, { base: viewer.profile.baseCurrency, book: f.book });
      const acct = bs.accounts.find((a) => a.account.id === v.accountId);
      if (!acct) return { ok: false as const, error: 'Account not found.' };
      const owed = -(acct.converted ?? 0);
      if (owed <= 0) return { ok: false as const, error: 'That account doesn’t show anything owed.' };
      start = owed;
      amount = owed;
    }
    if (amount == null || amount <= 0) return { ok: false as const, error: 'Enter an amount above zero.' };
    if (id) {
      const rows = await q.query(
        `update finance_targets set kind = $2, title = $3, amount_minor = $4, currency = $5, account_id = $6, target_on = $7,
                start_minor = coalesce(start_minor, $8) where id = $1 returning id`,
        [id, v.kind, v.title, amount, v.currency, v.accountId ?? null, v.targetOn ?? null, start],
      );
      if (!rows.length) return { ok: false as const, error: 'Target not found.' };
    } else {
      await q.query(
        `insert into finance_targets (kind, title, amount_minor, currency, account_id, target_on, start_minor) values ($1, $2, $3, $4, $5, $6, $7)`,
        [v.kind, v.title, amount, v.currency, v.accountId ?? null, v.targetOn ?? null, start],
      );
    }
    await q.query(`update profiles set modules = array_append(modules, 'money') where id = $1 and not ('money' = any(modules))`, [viewer.userId]);
    return { ok: true as const };
  });
  if (res.ok) void track(viewer.userId, 'target_saved', { kind: v.kind });
  return res;
}

export async function archiveTarget(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid target.' };
  await asUser(viewer.userId, (q) => q.query(`update finance_targets set archived_at = now() where id = $1`, [id]));
  return { ok: true as const };
}

// ───────────────────────────────────────────── the monthly plan

const planInput = z.object({
  expectedIncome: z.string().trim().max(24).default('0'),
  plannedSavings: z.string().trim().max(24).default('0'),
  plannedInvestments: z.string().trim().max(24).default('0'),
  note: z.string().trim().max(500).nullable().optional(),
});

export async function saveMonthPlan(viewer: Viewer, raw: z.input<typeof planInput>) {
  const parsed = planInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: 'Check the plan.' };
  const base = viewer.profile.baseCurrency;
  const v = parsed.data;
  const parse = (s: string) => (s.trim() ? parseAmount(s, base) : 0);
  const [inc, sav, inv] = [parse(v.expectedIncome), parse(v.plannedSavings), parse(v.plannedInvestments)];
  if (inc == null || sav == null || inv == null || inc < 0 || sav < 0 || inv < 0) return { ok: false as const, error: 'Amounts must be zero or more.' };
  await asUser(viewer.userId, (q) =>
    q.query(
      `insert into money_plans (month, currency, expected_income_minor, planned_savings_minor, planned_investments_minor, note)
       values ($1, $2, $3, $4, $5, $6)
       on conflict (user_id, month) do update set currency = excluded.currency, expected_income_minor = excluded.expected_income_minor,
         planned_savings_minor = excluded.planned_savings_minor, planned_investments_minor = excluded.planned_investments_minor, note = excluded.note`,
      [startOfMonth(viewer.today), base, inc, sav, inv, v.note || null],
    ),
  );
  return { ok: true as const };
}

// ───────────────────────────────────────────── the monthly Money Report

export interface MoneyReport {
  base: string;
  month: ISODate;
  label: string;
  complete: boolean;
  hasData: boolean;
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  prev: { income: number; expenses: number; net: number; savingsRate: number | null; label: string };
  netWorth: { start: number; end: number; change: number };
  sources: { source: string; amount: number; share: number }[];
  categories: { name: string; amount: number; prev: number; change: number | null }[];
  budgets: BudgetView[];
  recurring: { monthly: number; prevMonthly: number; started: string[]; ended: string[] };
  anomalies: { name: string; amount: number; baseline: number; change: number }[];
  targets: { title: string; kind: TargetKind; met: boolean; current: number; target: number }[];
  changed: string[];
  stable: string[];
  attention: string[];
}

export async function loadMoneyReport(viewer: Viewer, monthKey: string): Promise<MoneyReport | null> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(monthKey)) return null;
  const { today, profile } = viewer;
  const base = profile.baseCurrency;
  const month = `${monthKey}-01`;
  if (month > today) return null;
  return asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, base);
    const ctx = { base, book: f.book };
    const end = endOfMonth(month);
    const cut = end < today ? end : today;
    const prevMonth = addMonths(month, -1);
    const cur = { preset: 'custom' as const, start: month, end, label: '' };
    const prev = { preset: 'custom' as const, start: prevMonth, end: endOfMonth(prevMonth), label: '' };
    const flows = flowTotals(f.txs, f.accountMap, cur, today, ctx);
    const pflows = flowTotals(f.txs, f.accountMap, prev, today, ctx);
    const nwStart = balanceSheet(f.accounts, f.txs, f.valuations, addDays(month, -1), ctx).netWorth;
    const nwEnd = balanceSheet(f.accounts, f.txs, f.valuations, cut, ctx).netWorth;
    const cats = expensesByCategory(f.txs, f.categoryMap, cur, ctx);
    const pcats = expensesByCategory(f.txs, f.categoryMap, prev, ctx);
    const budgets = await budgetsFor(q, f, ctx, month, cut);
    const activeAt = (d: ISODate) => f.series.filter((s) => s.kind === 'expense' && s.startedOn <= d && (!s.endedOn || s.endedOn > d) && s.status !== 'ended');
    const monthlyOf = (list: SeriesFull[]) => list.reduce((s, x) => s + (f.book.convert(monthlyEquivalent(x), x.currency, base, cut)?.minor ?? 0), 0);
    const anomalies = expenseAnomalies(f.txs, f.categoryMap, { ...cur, end: cut }, ctx, 3000);
    const targets = end < today ? [] : (await targetsFor(q, viewer, f)).filter((t) => t.monthly);
    const fmt = (m: number) => formatMoney(m, base, { compact: true });
    const label = `${monthName(month, true)} ${month.slice(0, 4)}`;

    const changes: Change[] = [
      { label: 'Income', current: flows.income, previous: pflows.income, change: pctChange(flows.income, pflows.income), upIsGood: true },
      { label: 'Spending', current: flows.expenses, previous: pflows.expenses, change: pctChange(flows.expenses, pflows.expenses), upIsGood: false },
      ...cats.slice(0, 8).map((c) => {
        const p = pcats.find((x) => x.slug === c.slug)?.amount ?? 0;
        return { label: `${c.name} spending`, current: c.amount, previous: p, change: pctChange(c.amount, p), upIsGood: false };
      }),
    ];
    const { changed, stable } = classifyChanges(changes, 5000);
    const attention: string[] = [];
    for (const b of budgets.filter((x) => x.status === 'over')) attention.push(`${b.name}: ${formatMoney(b.spent, b.currency, { compact: true })} spent of a ${formatMoney(b.amount, b.currency, { compact: true })} budget.`);
    if (flows.expenses > flows.income && flows.income > 0) attention.push(`Spending (${fmt(flows.expenses)}) was above income (${fmt(flows.income)}).`);
    for (const a of anomalies.slice(0, 2)) attention.push(`${a.name} was ${fmt(a.amount - a.baseline)} above its 3-month average.`);
    for (const t of targets.filter((x) => !x.met && x.kind !== 'spending_ceiling')) attention.push(`${t.title}: ${formatMoney(t.current, t.currency, { compact: true })} of ${formatMoney(t.target, t.currency, { compact: true })}.`);
    for (const t of targets.filter((x) => x.over)) attention.push(`${t.title}: over the ceiling by ${formatMoney(t.current - t.target, t.currency, { compact: true })}.`);
    const started = f.series.filter((s) => s.startedOn >= month && s.startedOn <= end).map((s) => s.name);
    const ended = f.series.filter((s) => s.endedOn && s.endedOn >= month && s.endedOn <= end).map((s) => s.name);

    return {
      base,
      month,
      label,
      complete: end < today,
      hasData: flows.txCount > 0,
      income: flows.income,
      expenses: flows.expenses,
      net: flows.net,
      savingsRate: flows.savingsRate,
      prev: { income: pflows.income, expenses: pflows.expenses, net: pflows.net, savingsRate: pflows.savingsRate, label: `${monthName(prevMonth, true)}` },
      netWorth: { start: nwStart, end: nwEnd, change: nwEnd - nwStart },
      sources: incomeBySource(f.txs, f.categoryMap, cur, ctx).slice(0, 4).map((s) => ({ source: s.source, amount: s.amount, share: s.share })),
      categories: cats.slice(0, 6).map((c) => {
        const p = pcats.find((x) => x.slug === c.slug)?.amount ?? 0;
        return { name: c.name, amount: c.amount, prev: p, change: pctChange(c.amount, p) };
      }),
      budgets,
      recurring: { monthly: monthlyOf(activeAt(cut)), prevMonthly: monthlyOf(activeAt(addDays(month, -1))), started, ended },
      anomalies: anomalies.slice(0, 3).map((a) => ({ name: a.name, amount: a.amount, baseline: a.baseline, change: a.change })),
      targets: targets.map((t) => ({ title: t.title, kind: t.kind, met: t.met, current: t.current, target: t.target })),
      changed: changed.slice(0, 4).map((c) => `${c.label} ${c.current > c.previous ? 'rose' : 'fell'} to ${fmt(c.current)} (${c.change! > 0 ? '+' : '−'}${Math.round(Math.abs(c.change!) * 100)}% vs ${monthName(prevMonth, true)}).`),
      stable: stable.slice(0, 3).map((c) => `${c.label} held steady at ${fmt(c.current)}.`),
      attention: attention.slice(0, 4),
    };
  });
}
