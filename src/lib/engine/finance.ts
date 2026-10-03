import { addDays, addMonths, diffDays, endOfMonth, monthName, startOfMonth, type ISODate } from './dates';
import { RateBook, type Money } from './money';
import { elapsedDays, pctChange, type Period } from './period';

/**
 * Personal-finance calculations. All inputs are rows from the database; all outputs are
 * integers in the base currency's minor unit (plus explicit lists of anything that couldn't be
 * converted). Formulas:
 *
 *   income           Σ income rows (always positive)
 *   expenses         −Σ expense rows (purchases are negative rows; refunds positive, so they net off)
 *   net cash flow    income − expenses
 *   savings rate     net cash flow / income              (null when income = 0)
 *   avg daily spend  expenses / elapsed days in period
 *   net worth        Σ account balances at a date (liabilities are negative balances)
 *   liquid           Σ positive balances of liquid accounts (cash, current, savings)
 *   runway (months)  liquid / average essential monthly spend over the last 90 days
 *
 * Transfers (incl. moves to savings and investments) are never income or expense.
 */

export type AccountType = 'cash' | 'checking' | 'savings' | 'credit' | 'investment' | 'crypto' | 'business' | 'loan' | 'property' | 'other';
export type TxKind = 'income' | 'expense' | 'transfer' | 'adjustment';

export interface AccountRec {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  openingMinor: number;
  openingOn: ISODate;
  isLiquid: boolean;
  includeInNetWorth: boolean;
  archived: boolean;
}

export interface TxRec {
  id: string;
  accountId: string;
  kind: TxKind;
  amountMinor: number;
  currency: string;
  on: ISODate;
  categoryId: string | null;
  counterparty: string | null;
  transferId: string | null;
  seriesId: string | null;
  isEarnedReward: boolean;
}

export interface CategoryRec {
  id: string;
  kind: 'income' | 'expense';
  slug: string;
  name: string;
  isEssential: boolean;
  isFixed: boolean;
}

export interface ValuationRec {
  accountId: string;
  on: ISODate;
  valueMinor: number;
}

export interface SeriesRec {
  id: string;
  kind: 'income' | 'expense';
  name: string;
  amountMinor: number;
  currency: string;
  cadence: 'week' | 'month' | 'quarter' | 'year';
  intervalCount: number;
  nextOn: ISODate | null;
  isSubscription: boolean;
  verdict: 'essential' | 'useful' | 'questionable' | 'cancel' | null;
  status: 'active' | 'paused' | 'ended';
  categoryId: string | null;
  counterparty: string | null;
}

export interface Ctx {
  base: string;
  book: RateBook;
}

function inPeriod(on: ISODate, p: { start: ISODate; end: ISODate }): boolean {
  return on >= p.start && on <= p.end;
}

/** Converts, or records the amount as unconverted. */
function conv(ctx: Ctx, minor: number, currency: string, on: ISODate, missing: Money[]): number {
  const c = ctx.book.convert(minor, currency, ctx.base, on);
  if (c) return c.minor;
  missing.push({ minor, currency });
  return 0;
}

export interface FlowTotals {
  income: number;
  expenses: number;
  net: number;
  savingsRate: number | null;
  avgDailySpend: number;
  earnedRewardSpend: number;
  movedToSavings: number;
  movedToInvestments: number;
  txCount: number;
  unconverted: Money[];
  currencies: string[];
}

const SAVINGS_TYPES: AccountType[] = ['savings'];
const INVEST_TYPES: AccountType[] = ['investment', 'crypto'];

export function flowTotals(
  txs: TxRec[],
  accounts: Map<string, AccountRec>,
  period: Period,
  today: ISODate,
  ctx: Ctx,
): FlowTotals {
  const missing: Money[] = [];
  let income = 0;
  let expenses = 0;
  let earned = 0;
  let toSavings = 0;
  let toInvest = 0;
  let count = 0;
  const currencies = new Set<string>();
  const byTransfer = new Map<string, TxRec[]>();

  for (const t of txs) {
    if (!inPeriod(t.on, period)) continue;
    currencies.add(t.currency);
    if (t.kind === 'income') {
      income += conv(ctx, t.amountMinor, t.currency, t.on, missing);
      count++;
    } else if (t.kind === 'expense') {
      const v = -conv(ctx, t.amountMinor, t.currency, t.on, missing);
      expenses += v;
      if (t.isEarnedReward) earned += v;
      count++;
    } else if (t.kind === 'transfer' && t.transferId) {
      const list = byTransfer.get(t.transferId) ?? [];
      list.push(t);
      byTransfer.set(t.transferId, list);
    }
  }
  // A transfer counts as saving/investing when money lands in such an account from one that isn't.
  for (const legs of byTransfer.values()) {
    const inflow = legs.find((l) => l.amountMinor > 0);
    const outflow = legs.find((l) => l.amountMinor < 0);
    if (!inflow) continue;
    const to = accounts.get(inflow.accountId);
    const from = outflow ? accounts.get(outflow.accountId) : undefined;
    const v = conv(ctx, inflow.amountMinor, inflow.currency, inflow.on, missing);
    if (to && SAVINGS_TYPES.includes(to.type) && !(from && SAVINGS_TYPES.includes(from.type))) toSavings += v;
    if (to && INVEST_TYPES.includes(to.type) && !(from && INVEST_TYPES.includes(from.type))) toInvest += v;
  }

  const days = Math.max(1, elapsedDays(period, today));
  const net = income - expenses;
  return {
    income,
    expenses,
    net,
    savingsRate: income > 0 ? net / income : null,
    avgDailySpend: Math.round(expenses / days),
    earnedRewardSpend: earned,
    movedToSavings: toSavings,
    movedToInvestments: toInvest,
    txCount: count,
    unconverted: missing,
    currencies: [...currencies],
  };
}

export interface CategoryRow {
  categoryId: string | null;
  name: string;
  slug: string;
  amount: number;
  share: number;
  isEssential: boolean;
  isFixed: boolean;
  count: number;
}

export function expensesByCategory(
  txs: TxRec[],
  categories: Map<string, CategoryRec>,
  period: { start: ISODate; end: ISODate },
  ctx: Ctx,
): CategoryRow[] {
  const missing: Money[] = [];
  const rows = new Map<string, CategoryRow>();
  let total = 0;
  for (const t of txs) {
    if (t.kind !== 'expense' || !inPeriod(t.on, period)) continue;
    const v = -conv(ctx, t.amountMinor, t.currency, t.on, missing);
    const cat = t.categoryId ? categories.get(t.categoryId) : undefined;
    const key = cat?.id ?? 'uncategorized';
    const row = rows.get(key) ?? {
      categoryId: cat?.id ?? null,
      name: cat?.name ?? 'Uncategorized',
      slug: cat?.slug ?? 'uncategorized',
      amount: 0,
      share: 0,
      isEssential: cat?.isEssential ?? false,
      isFixed: cat?.isFixed ?? false,
      count: 0,
    };
    row.amount += v;
    row.count++;
    rows.set(key, row);
    total += v;
  }
  const out = [...rows.values()].filter((r) => r.amount !== 0);
  for (const r of out) r.share = total > 0 ? r.amount / total : 0;
  return out.sort((a, b) => b.amount - a.amount);
}

export interface SourceRow {
  source: string;
  amount: number;
  share: number;
  count: number;
  recurring: boolean;
}

export function incomeBySource(
  txs: TxRec[],
  categories: Map<string, CategoryRec>,
  period: { start: ISODate; end: ISODate },
  ctx: Ctx,
): SourceRow[] {
  const missing: Money[] = [];
  const rows = new Map<string, SourceRow>();
  let total = 0;
  for (const t of txs) {
    if (t.kind !== 'income' || !inPeriod(t.on, period)) continue;
    const v = conv(ctx, t.amountMinor, t.currency, t.on, missing);
    const name = t.counterparty?.trim() || (t.categoryId ? categories.get(t.categoryId)?.name : null) || 'Other';
    const row = rows.get(name) ?? { source: name, amount: 0, share: 0, count: 0, recurring: false };
    row.amount += v;
    row.count++;
    if (t.seriesId) row.recurring = true;
    rows.set(name, row);
    total += v;
  }
  const out = [...rows.values()];
  for (const r of out) r.share = total > 0 ? r.amount / total : 0;
  return out.sort((a, b) => b.amount - a.amount);
}

export interface AccountBalance {
  account: AccountRec;
  native: number;
  converted: number | null;
}

export interface BalanceSheet {
  accounts: AccountBalance[];
  netWorth: number;
  assets: number;
  liabilities: number;
  liquid: number;
  investments: number;
  unconverted: Money[];
}

/** Balance of each account at the end of `asOf`: latest valuation (if any) plus later transactions. */
export function balanceSheet(
  accounts: AccountRec[],
  txs: TxRec[],
  valuations: ValuationRec[],
  asOf: ISODate,
  ctx: Ctx,
): BalanceSheet {
  const missing: Money[] = [];
  const latestVal = new Map<string, ValuationRec>();
  for (const v of valuations) {
    if (v.on > asOf) continue;
    const cur = latestVal.get(v.accountId);
    if (!cur || v.on > cur.on) latestVal.set(v.accountId, v);
  }
  const native = new Map<string, number>();
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const a of accounts) {
    const val = latestVal.get(a.id);
    native.set(a.id, val ? val.valueMinor : a.openingOn <= asOf ? a.openingMinor : 0);
  }
  for (const t of txs) {
    if (t.on > asOf) continue;
    const val = latestVal.get(t.accountId);
    if (val && t.on <= val.on) continue; // already reflected in the valuation
    const acct = byId.get(t.accountId);
    if (acct && t.on < acct.openingOn) continue;
    native.set(t.accountId, (native.get(t.accountId) ?? 0) + t.amountMinor);
  }
  let netWorth = 0;
  let assets = 0;
  let liabilities = 0;
  let liquid = 0;
  let investments = 0;
  const rows: AccountBalance[] = [];
  for (const a of accounts) {
    const n = native.get(a.id) ?? 0;
    const c = ctx.book.convert(n, a.currency, ctx.base, asOf);
    if (!c && n !== 0) missing.push({ minor: n, currency: a.currency });
    const v = c?.minor ?? 0;
    rows.push({ account: a, native: n, converted: c ? c.minor : null });
    if (a.archived && n === 0) continue;
    if (a.includeInNetWorth) {
      netWorth += v;
      if (v >= 0) assets += v;
      else liabilities += -v;
    }
    if (a.isLiquid && v > 0) liquid += v;
    if (INVEST_TYPES.includes(a.type) && v > 0) investments += v;
  }
  return { accounts: rows, netWorth, assets, liabilities, liquid, investments, unconverted: missing };
}

export interface MonthFlow {
  month: string; // YYYY-MM
  label: string;
  start: ISODate;
  end: ISODate;
  income: number;
  expenses: number;
  net: number;
  essential: number;
  partial: boolean; // month still in progress
}

/** Calendar-month flows for the last `n` months ending with the month of `today`. */
export function monthlyFlows(
  txs: TxRec[],
  categories: Map<string, CategoryRec>,
  today: ISODate,
  n: number,
  ctx: Ctx,
): MonthFlow[] {
  const missing: Money[] = [];
  const out: MonthFlow[] = [];
  const first = startOfMonth(addMonths(startOfMonth(today), -(n - 1)));
  for (let i = 0; i < n; i++) {
    const start = addMonths(first, i);
    const end = endOfMonth(start);
    out.push({
      month: start.slice(0, 7), label: monthName(start), start, end,
      income: 0, expenses: 0, net: 0, essential: 0, partial: end > today,
    });
  }
  const idx = new Map(out.map((m, i) => [m.month, i]));
  for (const t of txs) {
    const i = idx.get(t.on.slice(0, 7));
    if (i == null) continue;
    const m = out[i];
    if (t.kind === 'income') m.income += conv(ctx, t.amountMinor, t.currency, t.on, missing);
    else if (t.kind === 'expense') {
      const v = -conv(ctx, t.amountMinor, t.currency, t.on, missing);
      m.expenses += v;
      if (t.categoryId && categories.get(t.categoryId)?.isEssential) m.essential += v;
    }
  }
  for (const m of out) m.net = m.income - m.expenses;
  return out;
}

export interface IncomeAnalysis {
  lastFullMonth: MonthFlow | null;
  momGrowth: number | null; // last full month vs the one before
  avg3: number | null; // mean of last 3 full months
  volatility: number | null; // coefficient of variation over the last 6 full months
  largestShareNow: { source: string; share: number } | null;
  largestShare3mAgo: { source: string; share: number } | null;
}

export function analyzeIncome(
  months: MonthFlow[],
  txs: TxRec[],
  categories: Map<string, CategoryRec>,
  ctx: Ctx,
): IncomeAnalysis {
  // months before any money was logged aren't "zero income" months — they're no data
  const firstActive = months.findIndex((m) => m.income !== 0 || m.expenses !== 0);
  const full = (firstActive < 0 ? [] : months.slice(firstActive)).filter((m) => !m.partial);
  const last = full.at(-1) ?? null;
  const prev = full.at(-2) ?? null;
  const last3 = full.slice(-3);
  const last6 = full.slice(-6).map((m) => m.income);
  const mean6 = last6.length ? last6.reduce((s, v) => s + v, 0) / last6.length : 0;
  const sd6 = last6.length > 1 ? Math.sqrt(last6.reduce((s, v) => s + (v - mean6) ** 2, 0) / (last6.length - 1)) : 0;
  const top = (m: MonthFlow | undefined | null) => {
    if (!m) return null;
    const rows = incomeBySource(txs, categories, m, ctx);
    return rows[0] ? { source: rows[0].source, share: rows[0].share } : null;
  };
  return {
    lastFullMonth: last,
    momGrowth: last && prev ? pctChange(last.income, prev.income) : null,
    avg3: last3.length === 3 ? Math.round(last3.reduce((s, m) => s + m.income, 0) / 3) : null,
    volatility: last6.length >= 3 && mean6 > 0 ? sd6 / mean6 : null,
    largestShareNow: top(last),
    largestShare3mAgo: top(full.at(-4)),
  };
}

export interface Anomaly {
  categoryId: string | null;
  name: string;
  amount: number;
  baseline: number;
  change: number; // fraction above baseline
}

/**
 * Categories that ran meaningfully hot: ≥ 30% above the average of the previous three
 * equal-length windows AND at least `minAbsolute` (base minor units) above it in absolute terms,
 * so a €4 → €9 coffee jump never gets called an "anomaly".
 */
export function expenseAnomalies(
  txs: TxRec[],
  categories: Map<string, CategoryRec>,
  period: Period,
  ctx: Ctx,
  minAbsolute = 2000,
): Anomaly[] {
  const len = diffDays(period.start, period.end) + 1;
  const current = expensesByCategory(txs, categories, period, ctx);
  const windows = [1, 2, 3].map((k) => {
    const end = addDays(period.start, -1 - (k - 1) * len);
    return expensesByCategory(txs, categories, { start: addDays(end, -(len - 1)), end }, ctx);
  });
  const out: Anomaly[] = [];
  for (const row of current) {
    const hist = windows.map((w) => w.find((r) => r.slug === row.slug)?.amount ?? 0);
    const baseline = hist.reduce((s, v) => s + v, 0) / 3;
    if (baseline <= 0) continue;
    const change = (row.amount - baseline) / baseline;
    if (change >= 0.3 && row.amount - baseline >= minAbsolute) {
      out.push({ categoryId: row.categoryId, name: row.name, amount: row.amount, baseline: Math.round(baseline), change });
    }
  }
  return out.sort((a, b) => b.amount - b.baseline - (a.amount - a.baseline));
}

/** Essential spending per month, averaged over the 90 days before `today`. */
export function essentialMonthly(txs: TxRec[], categories: Map<string, CategoryRec>, today: ISODate, ctx: Ctx): number {
  const missing: Money[] = [];
  const start = addDays(today, -89);
  let sum = 0;
  for (const t of txs) {
    if (t.kind !== 'expense' || t.on < start || t.on > today) continue;
    if (!t.categoryId || !categories.get(t.categoryId)?.isEssential) continue;
    sum += -conv(ctx, t.amountMinor, t.currency, t.on, missing);
  }
  return Math.round((sum / 90) * 30.44);
}

export function runwayMonths(liquid: number, monthlyEssential: number): number | null {
  if (monthlyEssential <= 0) return null;
  return liquid / monthlyEssential;
}

const PER_MONTH: Record<SeriesRec['cadence'], number> = { week: 52 / 12, month: 1, quarter: 1 / 3, year: 1 / 12 };

export function monthlyEquivalent(s: Pick<SeriesRec, 'amountMinor' | 'cadence' | 'intervalCount'>): number {
  return Math.round((s.amountMinor * PER_MONTH[s.cadence]) / Math.max(1, s.intervalCount));
}

export interface SubscriptionSummary {
  monthly: number;
  annual: number;
  count: number;
  byVerdict: Record<'essential' | 'useful' | 'questionable' | 'cancel' | 'unrated', number>;
  unconverted: Money[];
}

export function subscriptionSummary(series: SeriesRec[], today: ISODate, ctx: Ctx): SubscriptionSummary {
  const missing: Money[] = [];
  const byVerdict = { essential: 0, useful: 0, questionable: 0, cancel: 0, unrated: 0 };
  let monthly = 0;
  let count = 0;
  for (const s of series) {
    if (!s.isSubscription || s.status !== 'active' || s.kind !== 'expense') continue;
    const m = conv(ctx, monthlyEquivalent(s), s.currency, today, missing);
    monthly += m;
    count++;
    byVerdict[s.verdict ?? 'unrated'] += m;
  }
  return { monthly, annual: monthly * 12, count, byVerdict, unconverted: missing };
}

export interface TargetPace {
  target: number;
  current: number;
  progress: number;
  remaining: number;
  daysLeft: number;
  requiredPerDay: number | null;
  onPace: boolean | null;
}

/** "€1,130 of €1,500 · €370 to go · 8 days left · €46.25/day needed". */
export function targetPace(target: number, current: number, period: { start: ISODate; end: ISODate }, today: ISODate): TargetPace {
  const total = diffDays(period.start, period.end) + 1;
  const elapsed = Math.min(total, Math.max(0, diffDays(period.start, today) + 1));
  const daysLeft = Math.max(0, diffDays(today, period.end));
  const remaining = Math.max(0, target - current);
  const expected = (target * elapsed) / total;
  return {
    target,
    current,
    progress: target > 0 ? current / target : 0,
    remaining,
    daysLeft,
    requiredPerDay: remaining === 0 ? 0 : daysLeft > 0 ? Math.round(remaining / daysLeft) : null,
    onPace: elapsed > 0 ? current >= expected : null,
  };
}

export interface Forecast {
  basisDays: number;
  avgMonthlyIncome: number;
  avgMonthlyExpenses: number;
  projectedAnnualIncome: number;
  projectedAnnualExpenses: number;
  projectedAnnualSavings: number;
  projectedYearEndNetWorth: number;
  monthsToYearEnd: number;
}

/** "If your 90-day averages held…" — a projection, labelled as such everywhere it appears. */
export function forecast(txs: TxRec[], netWorthToday: number, today: ISODate, ctx: Ctx, basisDays = 90): Forecast {
  const missing: Money[] = [];
  const start = addDays(today, -(basisDays - 1));
  let inc = 0;
  let exp = 0;
  for (const t of txs) {
    if (t.on < start || t.on > today) continue;
    if (t.kind === 'income') inc += conv(ctx, t.amountMinor, t.currency, t.on, missing);
    else if (t.kind === 'expense') exp += -conv(ctx, t.amountMinor, t.currency, t.on, missing);
  }
  const perMonth = 30.44 / basisDays;
  const avgMonthlyIncome = Math.round(inc * perMonth);
  const avgMonthlyExpenses = Math.round(exp * perMonth);
  const yearEnd = `${today.slice(0, 4)}-12-31`;
  const monthsToYearEnd = diffDays(today, yearEnd) / 30.44;
  return {
    basisDays,
    avgMonthlyIncome,
    avgMonthlyExpenses,
    projectedAnnualIncome: avgMonthlyIncome * 12,
    projectedAnnualExpenses: avgMonthlyExpenses * 12,
    projectedAnnualSavings: (avgMonthlyIncome - avgMonthlyExpenses) * 12,
    projectedYearEndNetWorth: Math.round(netWorthToday + (avgMonthlyIncome - avgMonthlyExpenses) * monthsToYearEnd),
    monthsToYearEnd,
  };
}
