import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, addMonths, diffDays, endOfMonth, startOfMonth, type ISODate } from '@/lib/engine/dates';
import {
  analyzeIncome, balanceSheet, essentialMonthly, expenseAnomalies, expensesByCategory, flowTotals, forecast,
  incomeBySource, monthlyFlows, runwayMonths, subscriptionSummary,
  type AccountRec, type AccountType, type CategoryRec, type SeriesRec, type TxKind, type TxRec, type ValuationRec,
} from '@/lib/engine/finance';
import { formatMoney, parseAmount, RateBook, type FxRate } from '@/lib/engine/money';
import { occurrences } from '@/lib/engine/money-plan';
import { comparePeriods, pctChange, type CompareMode, type PeriodPreset } from '@/lib/engine/period';
import type { Viewer } from './context';
import { track } from './analytics';

export interface SeriesFull extends SeriesRec {
  accountId: string | null;
  startedOn: ISODate;
  endedOn: ISODate | null;
}

export interface FinanceData {
  accounts: AccountRec[];
  accountMap: Map<string, AccountRec>;
  categories: CategoryRec[];
  categoryMap: Map<string, CategoryRec>;
  txs: TxRec[];
  valuations: ValuationRec[];
  series: SeriesFull[];
  rates: FxRate[];
  book: RateBook;
}

/** Everything the finance engine needs, straight from the database (RLS-scoped). */
export async function loadFinance(q: Queryable, _base: string): Promise<FinanceData> {
  const [accounts, categories, txs, valuations, series, rates] = await Promise.all([
    q.query<{ id: string; name: string; type: AccountType; institution: string | null; currency: string; opening_balance_minor: number; opening_on: string; is_liquid: boolean; include_in_net_worth: boolean; archived_at: Date | null }>(
      `select id, name, type, institution, currency, opening_balance_minor, opening_on, is_liquid, include_in_net_worth, archived_at
         from accounts order by sort_order, created_at`,
    ),
    q.query<{ id: string; kind: 'income' | 'expense'; slug: string; name: string; is_essential: boolean; is_fixed: boolean }>(
      `select id, kind, slug, name, is_essential, is_fixed from categories where archived_at is null order by kind, sort_order`,
    ),
    q.query<{ id: string; account_id: string; kind: TxKind; amount_minor: number; currency: string; occurred_on: string; category_id: string | null; counterparty: string | null; transfer_id: string | null; series_id: string | null; is_earned_reward: boolean }>(
      `select id, account_id, kind, amount_minor, currency, occurred_on, category_id, counterparty, transfer_id, series_id, is_earned_reward
         from transactions order by occurred_on, created_at`,
    ),
    q.query<{ account_id: string; valued_on: string; value_minor: number }>(`select account_id, valued_on, value_minor from account_valuations`),
    q.query<{ id: string; kind: 'income' | 'expense'; name: string; amount_minor: number; currency: string; cadence: SeriesRec['cadence']; interval_count: number; next_on: string | null; is_subscription: boolean; verdict: SeriesRec['verdict']; status: SeriesRec['status']; category_id: string | null; counterparty: string | null; account_id: string | null; started_on: string; ended_on: string | null }>(
      `select id, kind, name, amount_minor, currency, cadence, interval_count, next_on, is_subscription, verdict, status, category_id, counterparty,
              account_id, started_on, ended_on
         from recurring_series order by name`,
    ),
    q.query<{ base: string; quote: string; rate: number; rate_on: string; source: string; user_id: string | null }>(
      `select base, quote, rate::text as rate, rate_on, source, user_id from fx_rates order by rate_on`,
    ),
  ]);
  const acc: AccountRec[] = accounts.map((a) => ({
    id: a.id, name: a.name, type: a.type, institution: a.institution, currency: a.currency,
    openingMinor: Number(a.opening_balance_minor), openingOn: a.opening_on, isLiquid: a.is_liquid,
    includeInNetWorth: a.include_in_net_worth, archived: !!a.archived_at,
  }));
  const cats: CategoryRec[] = categories.map((c) => ({ id: c.id, kind: c.kind, slug: c.slug, name: c.name, isEssential: c.is_essential, isFixed: c.is_fixed }));
  // user-specific rates override shared reference rates for the same pair and day
  const own = rates.filter((r) => r.user_id);
  const fx: FxRate[] = [...rates.filter((r) => !r.user_id && !own.some((o) => o.base === r.base && o.quote === r.quote && o.rate_on === r.rate_on)), ...own]
    .map((r) => ({ base: r.base, quote: r.quote, rate: String(r.rate), on: r.rate_on, source: r.source }));
  return {
    accounts: acc,
    accountMap: new Map(acc.map((a) => [a.id, a])),
    categories: cats,
    categoryMap: new Map(cats.map((c) => [c.id, c])),
    txs: txs.map((t) => ({
      id: t.id, accountId: t.account_id, kind: t.kind, amountMinor: Number(t.amount_minor), currency: t.currency, on: t.occurred_on,
      categoryId: t.category_id, counterparty: t.counterparty, transferId: t.transfer_id, seriesId: t.series_id, isEarnedReward: t.is_earned_reward,
    })),
    valuations: valuations.map((v) => ({ accountId: v.account_id, on: v.valued_on, valueMinor: Number(v.value_minor) })),
    series: series.map((s) => ({
      id: s.id, kind: s.kind, name: s.name, amountMinor: Number(s.amount_minor), currency: s.currency, cadence: s.cadence,
      intervalCount: s.interval_count, nextOn: s.next_on, isSubscription: s.is_subscription, verdict: s.verdict, status: s.status,
      categoryId: s.category_id, counterparty: s.counterparty, accountId: s.account_id, startedOn: s.started_on, endedOn: s.ended_on,
    })),
    rates: fx,
    book: new RateBook(fx),
  };
}

export interface PeriodArgs {
  preset: PeriodPreset;
  compare: CompareMode;
  custom?: { start: ISODate; end: ISODate } | null;
  compareCustom?: { start: ISODate; end: ISODate } | null;
}

function periods(viewer: Viewer, f: FinanceData, a: PeriodArgs) {
  const earliest = f.txs[0]?.on ?? viewer.today;
  return comparePeriods(a.preset, viewer.today, a.compare, {
    weekStartsOn: viewer.profile.weekStartsOn,
    earliest,
    custom: a.custom ?? undefined,
    compareCustom: a.compareCustom ?? null,
  });
}

// ───────────────────────────────────────────── Overview: how am I doing right now?

export interface MoneyInsight {
  tone: 'neutral' | 'warn' | 'good';
  text: string;
}

export interface MoneyOverview {
  base: string;
  today: ISODate;
  args: PeriodArgs;
  period: { start: ISODate; end: ISODate; label: string };
  previous: { start: ISODate; end: ISODate; label: string } | null;
  hasAccounts: boolean;
  hasData: boolean;
  flows: ReturnType<typeof flowTotals>;
  prevFlows: ReturnType<typeof flowTotals> | null;
  netWorth: number;
  netWorthPrev: number | null;
  liquid: number;
  insights: MoneyInsight[];
  upcoming: { total: number; count: number; items: { name: string; on: ISODate; amount: number; kind: 'income' | 'expense' }[] };
  rateNotes: string[];
  unconverted: boolean;
}

export async function loadMoneyOverview(viewer: Viewer, args: PeriodArgs): Promise<MoneyOverview> {
  const { today, profile } = viewer;
  const base = profile.baseCurrency;
  return asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, base);
    const ctx = { base, book: f.book };
    const { current, previous } = periods(viewer, f, args);
    const flows = flowTotals(f.txs, f.accountMap, current, today, ctx);
    const prevFlows = previous ? flowTotals(f.txs, f.accountMap, previous, today, ctx) : null;
    const bs = balanceSheet(f.accounts, f.txs, f.valuations, today, ctx);
    const bsPrev = previous ? balanceSheet(f.accounts, f.txs, f.valuations, previous.end, ctx) : null;

    // at most two facts worth knowing
    const insights: MoneyInsight[] = [];
    const vs = previous ? ` versus ${previous.label}` : '';
    const incomeChange = prevFlows ? pctChange(flows.income, prevFlows.income) : null;
    if (incomeChange != null && Math.abs(incomeChange) >= 0.1 && Math.abs(flows.income - (prevFlows?.income ?? 0)) >= 5000) {
      insights.push({ tone: incomeChange > 0 ? 'good' : 'warn', text: `Income is ${incomeChange > 0 ? 'up' : 'down'} ${Math.round(Math.abs(incomeChange) * 100)}%${vs}.` });
    }
    const anomalies = diffDays(current.start, current.end) >= 6 ? expenseAnomalies(f.txs, f.categoryMap, current, ctx) : [];
    if (anomalies[0]) {
      const a = anomalies[0];
      insights.push({ tone: 'warn', text: `${a.name} spending is ${formatMoney(a.amount - a.baseline, base, { compact: true })} above its average for a period this long.` });
    }
    const monthEnd = endOfMonth(today);
    const upcomingItems: MoneyOverview['upcoming']['items'] = [];
    for (const s of f.series) {
      for (const d of occurrences(s, addDays(today, 1), monthEnd)) {
        const c = f.book.convert(s.amountMinor, s.currency, base, today);
        if (c) upcomingItems.push({ name: s.name, on: d, amount: c.minor, kind: s.kind });
      }
    }
    upcomingItems.sort((a, b) => (a.on < b.on ? -1 : 1));
    const upcomingOut = upcomingItems.filter((i) => i.kind === 'expense');
    const upcomingTotal = upcomingOut.reduce((s, i) => s + i.amount, 0);
    if (insights.length < 2 && upcomingOut.length) {
      insights.push({ tone: 'neutral', text: `Recurring payments still due this month: ${formatMoney(upcomingTotal, base, { compact: true })} across ${upcomingOut.length} item${upcomingOut.length === 1 ? '' : 's'}.` });
    }
    return {
      base,
      today,
      args,
      period: { start: current.start, end: current.end, label: current.label },
      previous: previous ? { start: previous.start, end: previous.end, label: previous.label } : null,
      hasAccounts: f.accounts.some((a) => !a.archived),
      hasData: f.txs.length > 0,
      flows,
      prevFlows,
      netWorth: bs.netWorth,
      netWorthPrev: bsPrev?.netWorth ?? null,
      liquid: bs.liquid,
      insights: insights.slice(0, 2),
      upcoming: { total: upcomingTotal, count: upcomingOut.length, items: upcomingItems.slice(0, 6) },
      rateNotes: f.book.disclose([...flows.currencies, ...f.accounts.map((a) => a.currency)], base, today),
      unconverted: flows.unconverted.length > 0,
    };
  });
}

// ───────────────────────────────────────────── Analysis: everything, because you asked

export interface MoneyAnalysis {
  base: string;
  today: ISODate;
  args: PeriodArgs;
  period: { start: ISODate; end: ISODate; label: string };
  previous: { start: ISODate; end: ISODate; label: string } | null;
  hasData: boolean;
  flows: ReturnType<typeof flowTotals>;
  prevFlows: ReturnType<typeof flowTotals> | null;
  netWorth: number;
  netWorthPrev: number | null;
  netWorthTrend: { month: string; label: string; value: number }[];
  liquid: number;
  runway: number | null;
  essentialMonthly: number;
  categories: (ReturnType<typeof expensesByCategory>[number] & { prev: number | null })[];
  fixed: number;
  variable: number;
  essential: number;
  discretionary: number;
  sources: ReturnType<typeof incomeBySource>;
  months: ReturnType<typeof monthlyFlows>;
  income: ReturnType<typeof analyzeIncome>;
  anomalies: ReturnType<typeof expenseAnomalies>;
  subscriptions: ReturnType<typeof subscriptionSummary>;
  forecast: ReturnType<typeof forecast>;
  reportMonths: string[];
  rateNotes: string[];
}

export async function loadMoneyAnalysis(viewer: Viewer, args: PeriodArgs): Promise<MoneyAnalysis> {
  const { today, profile } = viewer;
  const base = profile.baseCurrency;
  return asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, base);
    const ctx = { base, book: f.book };
    const { current, previous } = periods(viewer, f, args);
    const flows = flowTotals(f.txs, f.accountMap, current, today, ctx);
    const prevFlows = previous ? flowTotals(f.txs, f.accountMap, previous, today, ctx) : null;
    const bs = balanceSheet(f.accounts, f.txs, f.valuations, today, ctx);
    const bsPrev = previous ? balanceSheet(f.accounts, f.txs, f.valuations, previous.end, ctx) : null;
    const cats = expensesByCategory(f.txs, f.categoryMap, current, ctx);
    const prevCats = previous ? expensesByCategory(f.txs, f.categoryMap, previous, ctx) : [];
    const essential = essentialMonthly(f.txs, f.categoryMap, today, ctx);
    const trend: MoneyAnalysis['netWorthTrend'] = [];
    for (let k = 11; k >= 0; k--) {
      const m = addMonths(startOfMonth(today), -k);
      const end = k === 0 ? today : endOfMonth(m);
      if (f.txs[0] && end < f.txs[0].on && !f.accounts.some((a) => a.openingOn <= end)) continue;
      trend.push({ month: m.slice(0, 7), label: m, value: balanceSheet(f.accounts, f.txs, f.valuations, end, ctx).netWorth });
    }
    const firstMonth = f.txs[0]?.on.slice(0, 7);
    const reportMonths: string[] = [];
    if (firstMonth) {
      for (let m = startOfMonth(today); m.slice(0, 7) >= firstMonth && reportMonths.length < 24; m = addMonths(m, -1)) reportMonths.push(m.slice(0, 7));
    }
    return {
      base,
      today,
      args,
      period: { start: current.start, end: current.end, label: current.label },
      previous: previous ? { start: previous.start, end: previous.end, label: previous.label } : null,
      hasData: f.txs.length > 0 || f.accounts.length > 0,
      flows,
      prevFlows,
      netWorth: bs.netWorth,
      netWorthPrev: bsPrev?.netWorth ?? null,
      netWorthTrend: trend,
      liquid: bs.liquid,
      runway: runwayMonths(bs.liquid, essential),
      essentialMonthly: essential,
      categories: cats.map((c) => ({ ...c, prev: previous ? prevCats.find((p) => p.slug === c.slug)?.amount ?? 0 : null })),
      fixed: cats.filter((c) => c.isFixed).reduce((s, c) => s + c.amount, 0),
      variable: cats.filter((c) => !c.isFixed).reduce((s, c) => s + c.amount, 0),
      essential: cats.filter((c) => c.isEssential).reduce((s, c) => s + c.amount, 0),
      discretionary: cats.filter((c) => !c.isEssential).reduce((s, c) => s + c.amount, 0),
      sources: incomeBySource(f.txs, f.categoryMap, current, ctx),
      months: monthlyFlows(f.txs, f.categoryMap, today, 12, ctx),
      income: analyzeIncome(monthlyFlows(f.txs, f.categoryMap, today, 8, ctx), f.txs, f.categoryMap, ctx),
      anomalies: diffDays(current.start, current.end) >= 6 ? expenseAnomalies(f.txs, f.categoryMap, current, ctx) : [],
      subscriptions: subscriptionSummary(f.series, today, ctx),
      forecast: forecast(f.txs, bs.netWorth, today, ctx),
      reportMonths,
      rateNotes: f.book.disclose([...flows.currencies, ...f.accounts.map((a) => a.currency)], base, today),
    };
  });
}

// ───────────────────────────────────────────── the ledger

export interface TxView {
  id: string;
  kind: TxKind;
  amountMinor: number;
  currency: string;
  converted: number | null;
  on: ISODate;
  category: string | null;
  categoryId: string | null;
  categorySlug: string | null;
  counterparty: string | null;
  account: string;
  accountId: string;
  note: string | null;
  tags: string[];
  transferId: string | null;
  transferTo: string | null;
  originalAmountMinor: number | null;
  originalCurrency: string | null;
  receipts: number;
  earned: boolean;
}

export interface LedgerFilters {
  q?: string | null;
  from?: ISODate | null;
  to?: ISODate | null;
  kind?: 'income' | 'expense' | 'transfer' | 'adjustment' | null;
  accountId?: string | null;
  categoryId?: string | null;
  tag?: string | null;
  merchant?: string | null;
  sort?: 'date_desc' | 'date_asc' | 'amount_desc' | 'amount_asc';
  page?: number;
}

export interface Ledger {
  base: string;
  today: ISODate;
  filters: LedgerFilters;
  items: TxView[];
  total: number;
  page: number;
  pages: number;
  totals: { income: number; expenses: number; count: number };
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; kind: 'income' | 'expense' }[];
  tags: string[];
}

const PAGE = 50;

const TX_SELECT = `
  select t.id, t.kind, t.amount_minor, t.currency, t.occurred_on, c.name as category, c.id as category_id, c.slug, t.counterparty,
         a.name as account, a.id as account_id, t.note, t.tags, t.transfer_id, t.original_amount_minor, t.original_currency, t.is_earned_reward,
         (select b.name from transactions o join accounts b on b.id = o.account_id where o.transfer_id = t.transfer_id and o.id <> t.id limit 1) as transfer_to,
         (select count(*)::int from receipts r where r.transaction_id = t.id) as receipts
    from transactions t join accounts a on a.id = t.account_id left join categories c on c.id = t.category_id`;

type TxSqlRow = {
  id: string; kind: TxKind; amount_minor: number; currency: string; occurred_on: string; category: string | null; category_id: string | null; slug: string | null;
  counterparty: string | null; account: string; account_id: string; note: string | null; tags: string[] | null; transfer_id: string | null;
  original_amount_minor: number | null; original_currency: string | null; is_earned_reward: boolean; transfer_to: string | null; receipts: number;
};

function toTxView(r: TxSqlRow, book: RateBook, base: string): TxView {
  return {
    id: r.id, kind: r.kind, amountMinor: Number(r.amount_minor), currency: r.currency,
    converted: book.convert(Number(r.amount_minor), r.currency, base, r.occurred_on)?.minor ?? null,
    on: r.occurred_on, category: r.category, categoryId: r.category_id, categorySlug: r.slug, counterparty: r.counterparty, account: r.account,
    accountId: r.account_id, note: r.note, tags: r.tags ?? [], transferId: r.transfer_id, transferTo: r.transfer_to,
    originalAmountMinor: r.original_amount_minor == null ? null : Number(r.original_amount_minor), originalCurrency: r.original_currency,
    receipts: r.receipts, earned: r.is_earned_reward,
  };
}

export async function loadLedger(viewer: Viewer, filters: LedgerFilters): Promise<Ledger> {
  const base = viewer.profile.baseCurrency;
  return asUser(viewer.userId, async (q) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (filters.q?.trim()) {
      const like = p(`%${filters.q.trim().replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
      where.push(`(t.counterparty ilike ${like} or t.note ilike ${like} or c.name ilike ${like} or array_to_string(t.tags, ' ') ilike ${like})`);
    }
    if (filters.from) where.push(`t.occurred_on >= ${p(filters.from)}`);
    if (filters.to) where.push(`t.occurred_on <= ${p(filters.to)}`);
    if (filters.kind) where.push(`t.kind = ${p(filters.kind)}`);
    if (filters.accountId) where.push(`t.account_id = ${p(filters.accountId)}`);
    else where.push(`not (t.kind = 'transfer' and t.amount_minor > 0)`); // one row per transfer unless looking at an account
    if (filters.categoryId) where.push(`t.category_id = ${p(filters.categoryId)}`);
    if (filters.tag) where.push(`${p(filters.tag)} = any(t.tags)`);
    if (filters.merchant) where.push(`t.counterparty = ${p(filters.merchant)}`);
    const whereSql = where.length ? `where ${where.join(' and ')}` : '';
    const order = {
      date_desc: 't.occurred_on desc, t.created_at desc',
      date_asc: 't.occurred_on asc, t.created_at asc',
      amount_desc: 'abs(t.amount_minor) desc, t.occurred_on desc',
      amount_asc: 'abs(t.amount_minor) asc, t.occurred_on desc',
    }[filters.sort ?? 'date_desc'];
    const page = Math.max(1, Math.floor(filters.page ?? 1));
    const [rows, all, accounts, categories, tags, rates] = await Promise.all([
      q.query<TxSqlRow>(`${TX_SELECT} ${whereSql} order by ${order} limit ${PAGE} offset ${(page - 1) * PAGE}`, params),
      q.query<{ kind: TxKind; amount_minor: number; currency: string; occurred_on: string }>(
        `select t.kind, t.amount_minor, t.currency, t.occurred_on from transactions t left join categories c on c.id = t.category_id ${whereSql}`,
        params,
      ),
      q.query<{ id: string; name: string; currency: string }>(`select id, name, currency from accounts order by archived_at nulls first, sort_order, created_at`),
      q.query<{ id: string; name: string; kind: 'income' | 'expense' }>(`select id, name, kind from categories where archived_at is null order by kind, sort_order`),
      q.query<{ tag: string }>(`select distinct unnest(tags) as tag from transactions order by tag limit 60`),
      q.query<{ base: string; quote: string; rate: number; rate_on: string; source: string }>(`select base, quote, rate::text as rate, rate_on, source from fx_rates order by rate_on`),
    ]);
    const book = new RateBook(rates.map((r) => ({ base: r.base, quote: r.quote, rate: String(r.rate), on: r.rate_on, source: r.source })));
    let income = 0;
    let expenses = 0;
    for (const t of all) {
      const c = book.convert(Number(t.amount_minor), t.currency, base, t.occurred_on)?.minor ?? 0;
      if (t.kind === 'income') income += c;
      else if (t.kind === 'expense') expenses -= c;
    }
    return {
      base,
      today: viewer.today,
      filters,
      items: rows.map((r) => toTxView(r, book, base)),
      total: all.length,
      page,
      pages: Math.max(1, Math.ceil(all.length / PAGE)),
      totals: { income, expenses, count: all.length },
      accounts,
      categories,
      tags: tags.map((t) => t.tag),
    };
  });
}

export interface TxDetail extends TxView {
  receiptFiles: { id: string; fileId: string; mime: string; thumbUrl: string | null; fullUrl: string }[];
  transferLegs: { accountId: string; account: string; amountMinor: number; currency: string }[];
  seriesId: string | null;
}

export async function loadTransaction(viewer: Viewer, id: string): Promise<TxDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { signedFileUrl } = await import('./storage');
  return asUser(viewer.userId, async (q) => {
    const [row] = await q.query<TxSqlRow & { series_id: string | null }>(`${TX_SELECT.replace('t.is_earned_reward,', 't.is_earned_reward, t.series_id,')} where t.id = $1`, [id]);
    if (!row) return null;
    const f = await loadFinance(q, viewer.profile.baseCurrency);
    const [receipts, legs] = await Promise.all([
      q.query<{ id: string; file_id: string; mime_type: string; thumb_path: string | null }>(
        `select r.id, r.file_id, f.mime_type, f.thumb_path from receipts r join files f on f.id = r.file_id where r.transaction_id = $1 order by r.created_at`,
        [id],
      ),
      row.transfer_id
        ? q.query<{ account_id: string; name: string; amount_minor: number; currency: string }>(
            `select t.account_id, a.name, t.amount_minor, t.currency from transactions t join accounts a on a.id = t.account_id where t.transfer_id = $1 order by t.amount_minor`,
            [row.transfer_id],
          )
        : Promise.resolve([]),
    ]);
    return {
      ...toTxView(row, f.book, viewer.profile.baseCurrency),
      seriesId: row.series_id,
      receiptFiles: receipts.map((r) => ({
        id: r.id, fileId: r.file_id, mime: r.mime_type,
        thumbUrl: r.thumb_path ? signedFileUrl(r.file_id, 'thumb', viewer.userId) : null,
        fullUrl: signedFileUrl(r.file_id, 'full', viewer.userId),
      })),
      transferLegs: legs.map((l) => ({ accountId: l.account_id, account: l.name, amountMinor: Number(l.amount_minor), currency: l.currency })),
    };
  });
}

// ───────────────────────────────────────────── transactions: create / edit / delete

const tagList = z.array(z.string().trim().min(1).max(24).regex(/^[\p{L}\p{N} _-]+$/u)).max(12).default([]);

const txInput = z.object({
  kind: z.enum(['expense', 'income', 'transfer']),
  amount: z.string().trim().min(1).max(24),
  accountId: z.uuid(),
  toAccountId: z.uuid().nullable().optional(),
  toAmount: z.string().trim().max(24).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  counterparty: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  tags: tagList.optional(),
  on: z.iso.date(),
  originalAmount: z.string().trim().max(24).nullable().optional(),
  originalCurrency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
  source: z.enum(['app', 'quick_add', 'command', 'receipt']).default('app'),
});
export type TxInput = z.input<typeof txInput>;

export async function createTransaction(viewer: Viewer, raw: TxInput) {
  const parsed = txInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the amount.' };
  const v = parsed.data;
  if (diffDays(viewer.today, v.on) > 0) return { ok: false as const, error: 'That date is in the future.' };
  if (diffDays(v.on, viewer.today) > 3650) return { ok: false as const, error: 'That date is too far back.' };

  const res = await asUser(viewer.userId, async (q) => {
    const accounts = await q.query<{ id: string; currency: string; name: string }>(`select id, currency, name from accounts where archived_at is null`);
    const from = accounts.find((a) => a.id === v.accountId);
    if (!from) return { ok: false as const, error: 'Pick an account.' };
    const amount = parseAmount(v.amount, from.currency);
    if (amount == null || amount <= 0) return { ok: false as const, error: 'Enter an amount above zero.' };
    let original: number | null = null;
    if (v.originalAmount && v.originalCurrency && v.originalCurrency !== from.currency) original = parseAmount(v.originalAmount, v.originalCurrency);

    if (v.kind === 'transfer') {
      const to = accounts.find((a) => a.id === v.toAccountId);
      if (!to || to.id === from.id) return { ok: false as const, error: 'Pick a different account to move money to.' };
      const toAmount = to.currency === from.currency ? amount : v.toAmount ? parseAmount(v.toAmount, to.currency) : null;
      if (toAmount == null || toAmount <= 0) return { ok: false as const, error: `Enter how much arrived in ${to.currency}.` };
      const transferId = randomUUID();
      await q.query(
        `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, note, transfer_id, source, counterparty, tags)
         values ($1, 'transfer', $2, $3, $4, $5, $6, $7, $8, $13), ($9, 'transfer', $10, $11, $4, $5, $6, $7, $12, $13)`,
        [from.id, -amount, from.currency, v.on, v.note ?? null, transferId, v.source, to.name, to.id, toAmount, to.currency, from.name, v.tags ?? []],
      );
      return { ok: true as const, id: transferId };
    }

    const signed = v.kind === 'expense' ? -amount : amount;
    const [row] = await q.query<{ id: string }>(
      `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, category_id, counterparty, note,
                                 original_amount_minor, original_currency, source, tags)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [from.id, v.kind, signed, from.currency, v.on, v.categoryId ?? null, v.counterparty || null, v.note || null, original, original != null ? v.originalCurrency : null, v.source, v.tags ?? []],
    );
    return { ok: true as const, id: row.id };
  });
  if (res.ok) void track(viewer.userId, 'transaction_logged', { kind: v.kind, source: v.source, backdated: v.on !== viewer.today });
  return res;
}

const txEditInput = z.object({
  kind: z.enum(['expense', 'income', 'transfer', 'adjustment']),
  amount: z.string().trim().min(1).max(24),
  accountId: z.uuid(),
  toAccountId: z.uuid().nullable().optional(),
  toAmount: z.string().trim().max(24).nullable().optional(),
  categoryId: z.uuid().nullable().optional(),
  counterparty: z.string().trim().max(80).nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  tags: tagList.optional(),
  on: z.iso.date(),
});
export type TxEditInput = z.input<typeof txEditInput>;

/**
 * Correct a mistake. Amount, account, date, category, merchant, note and tags can all change; the
 * currency always follows the account (the database guard enforces it). Transfers edit both legs.
 */
export async function updateTransaction(viewer: Viewer, id: string, raw: TxEditInput) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid transaction.' };
  const parsed = txEditInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the transaction.' };
  const v = parsed.data;
  if (v.on > viewer.today) return { ok: false as const, error: 'That date is in the future.' };
  const res = await asUser(viewer.userId, async (q) => {
    const [cur] = await q.query<{ kind: TxKind; transfer_id: string | null; amount_minor: number }>(`select kind, transfer_id, amount_minor from transactions where id = $1`, [id]);
    if (!cur) return { ok: false as const, error: 'Transaction not found.' };
    const accounts = await q.query<{ id: string; currency: string; name: string }>(`select id, currency, name from accounts`);
    const acct = accounts.find((a) => a.id === v.accountId);
    if (!acct) return { ok: false as const, error: 'Pick an account.' };
    const amount = parseAmount(v.amount, acct.currency);
    if (amount == null || amount === 0) return { ok: false as const, error: 'Enter an amount.' };

    if (cur.kind === 'transfer') {
      if (v.kind !== 'transfer') return { ok: false as const, error: 'A transfer stays a transfer — delete it and log a new entry instead.' };
      const to = accounts.find((a) => a.id === v.toAccountId);
      if (!to || to.id === acct.id) return { ok: false as const, error: 'Pick a different account to move money to.' };
      const toAmount = to.currency === acct.currency ? Math.abs(amount) : v.toAmount ? parseAmount(v.toAmount, to.currency) : null;
      if (toAmount == null || toAmount <= 0) return { ok: false as const, error: `Enter how much arrived in ${to.currency}.` };
      await q.query(`delete from transactions where transfer_id = $1`, [cur.transfer_id]);
      await q.query(
        `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, note, transfer_id, source, counterparty, tags)
         values ($1, 'transfer', $2, $3, $4, $5, $6, 'app', $7, $12), ($8, 'transfer', $9, $10, $4, $5, $6, 'app', $11, $12)`,
        [acct.id, -Math.abs(amount), acct.currency, v.on, v.note || null, cur.transfer_id, to.name, to.id, toAmount, to.currency, acct.name, v.tags ?? []],
      );
      return { ok: true as const };
    }
    if (v.kind === 'transfer') return { ok: false as const, error: 'To turn this into a transfer, delete it and log the transfer.' };
    const signed = v.kind === 'adjustment' ? amount : v.kind === 'expense' ? -Math.abs(amount) : Math.abs(amount);
    await q.query(
      `update transactions set kind = $2, amount_minor = $3, account_id = $4, currency = $5, occurred_on = $6, category_id = $7,
              counterparty = $8, note = $9, tags = $10 where id = $1`,
      [id, v.kind, signed, acct.id, acct.currency, v.on, v.kind === 'adjustment' ? null : v.categoryId ?? null, v.counterparty || null, v.note || null, v.tags ?? []],
    );
    return { ok: true as const };
  });
  if (res.ok) void track(viewer.userId, 'transaction_edited', { kind: v.kind });
  return res;
}

export async function deleteTransaction(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid transaction.' };
  await asUser(viewer.userId, async (q) => {
    const [t] = await q.query<{ transfer_id: string | null }>(`select transfer_id from transactions where id = $1`, [id]);
    if (!t) return;
    await q.query(`update receipts set transaction_id = null where transaction_id in (select id from transactions where id = $1 or ($2::uuid is not null and transfer_id = $2))`, [id, t.transfer_id]);
    if (t.transfer_id) await q.query(`delete from transactions where transfer_id = $1`, [t.transfer_id]);
    else await q.query(`delete from transactions where id = $1`, [id]);
  });
  return { ok: true as const };
}

// ───────────────────────────────────────────── accounts

const ACCOUNT_TYPES = ['cash', 'checking', 'savings', 'credit', 'investment', 'crypto', 'business', 'loan', 'property', 'other'] as const;
const LIQUID: readonly string[] = ['cash', 'checking', 'savings'];
const VALUED: readonly string[] = ['investment', 'crypto', 'property'];

const accountInput = z.object({
  name: z.string().trim().min(1, 'Name the account.').max(60),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(60).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  balance: z.string().trim().max(24).default('0'),
});

export async function createAccount(viewer: Viewer, raw: z.input<typeof accountInput>) {
  const parsed = accountInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the account.' };
  const v = parsed.data;
  let opening = parseAmount(v.balance || '0', v.currency);
  if (opening == null) return { ok: false as const, error: 'That balance doesn’t look like an amount.' };
  if ((v.type === 'credit' || v.type === 'loan') && opening > 0) opening = -opening; // money owed
  await asUser(viewer.userId, async (q) => {
    await q.query(
      `insert into accounts (name, type, institution, currency, opening_balance_minor, opening_on, is_liquid, sort_order)
       values ($1, $2, $3, $4, $5, $6, $7, (select coalesce(max(sort_order), 0) + 1 from accounts))`,
      [v.name, v.type, v.institution || null, v.currency, opening, viewer.today, LIQUID.includes(v.type)],
    );
    await q.query(`update profiles set modules = array_append(modules, 'money') where id = $1 and not ('money' = any(modules))`, [viewer.userId]);
  });
  void track(viewer.userId, 'money_account_added', { type: v.type, currency: v.currency });
  return { ok: true as const };
}

const accountEdit = z.object({
  name: z.string().trim().min(1, 'Name the account.').max(60),
  type: z.enum(ACCOUNT_TYPES),
  institution: z.string().trim().max(60).nullable().optional(),
  isLiquid: z.boolean(),
  includeInNetWorth: z.boolean(),
});

export async function updateAccount(viewer: Viewer, id: string, raw: z.input<typeof accountEdit>) {
  const parsed = accountEdit.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(id).success) return { ok: false as const, error: parsed.error?.issues[0]?.message ?? 'Check the account.' };
  const v = parsed.data;
  const rows = await asUser(viewer.userId, (q) =>
    q.query(`update accounts set name = $2, type = $3, institution = $4, is_liquid = $5, include_in_net_worth = $6 where id = $1 returning id`, [
      id, v.name, v.type, v.institution || null, v.isLiquid, v.includeInNetWorth,
    ]),
  );
  return rows.length ? { ok: true as const } : { ok: false as const, error: 'Account not found.' };
}

export async function setAccountArchived(viewer: Viewer, id: string, archived: boolean) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid account.' };
  await asUser(viewer.userId, (q) => q.query(`update accounts set archived_at = case when $2 then now() else null end where id = $1`, [id, archived]));
  return { ok: true as const };
}

/**
 * "My bank says €1,240.18." Kept records the difference as an Adjustment — visible, deletable,
 * never income or spending — instead of silently rewriting history.
 */
export async function reconcileAccount(viewer: Viewer, id: string, actual: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid account.' };
  const res = await asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, viewer.profile.baseCurrency);
    const acct = f.accountMap.get(id);
    if (!acct) return { ok: false as const, error: 'Account not found.' };
    let target = parseAmount(actual, acct.currency);
    if (target == null) return { ok: false as const, error: 'Enter the balance your bank shows.' };
    if ((acct.type === 'credit' || acct.type === 'loan') && target > 0) target = -target;
    const bs = balanceSheet(f.accounts, f.txs, f.valuations, viewer.today, { base: viewer.profile.baseCurrency, book: f.book });
    const current = bs.accounts.find((a) => a.account.id === id)?.native ?? 0;
    const diff = target - current;
    if (diff === 0) return { ok: true as const, diff: 0, currency: acct.currency };
    await q.query(
      `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, note, source) values ($1, 'adjustment', $2, $3, $4, $5, 'app')`,
      [id, diff, acct.currency, viewer.today, `Balance update: ${formatMoney(current, acct.currency)} → ${formatMoney(target, acct.currency)}`],
    );
    return { ok: true as const, diff, currency: acct.currency };
  });
  if (res.ok) void track(viewer.userId, 'balance_reconciled', { changed: res.diff !== 0 });
  return res;
}

/** Brokerage, crypto, property: a dated value; later transactions roll forward from it. */
export async function setValuation(viewer: Viewer, id: string, value: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid account.' };
  return asUser(viewer.userId, async (q) => {
    const [a] = await q.query<{ currency: string; type: string }>(`select currency, type from accounts where id = $1`, [id]);
    if (!a) return { ok: false as const, error: 'Account not found.' };
    let minor = parseAmount(value, a.currency);
    if (minor == null) return { ok: false as const, error: 'Enter a value.' };
    if ((a.type === 'loan' || a.type === 'credit') && minor > 0) minor = -minor;
    await q.query(
      `insert into account_valuations (account_id, valued_on, value_minor, note) values ($1, $2, $3, 'Updated value')
       on conflict (account_id, valued_on) do update set value_minor = excluded.value_minor`,
      [id, viewer.today, minor],
    );
    return { ok: true as const };
  });
}

export interface AccountView {
  id: string;
  name: string;
  type: AccountType;
  institution: string | null;
  currency: string;
  native: number;
  converted: number | null;
  isLiquid: boolean;
  includeInNetWorth: boolean;
  archived: boolean;
  valued: boolean;
  lastValuation: ISODate | null;
  history: number[];
  recent: TxView[];
}

export interface AccountsPage {
  base: string;
  today: ISODate;
  accounts: AccountView[];
  netWorth: number;
  liquid: number;
  assets: number;
  liabilities: number;
  investments: number;
  cash: number;
  trend: { month: string; value: number }[];
  rateNotes: string[];
}

export async function loadAccounts(viewer: Viewer): Promise<AccountsPage> {
  const { today, profile } = viewer;
  const base = profile.baseCurrency;
  return asUser(viewer.userId, async (q) => {
    const f = await loadFinance(q, base);
    const ctx = { base, book: f.book };
    const bs = balanceSheet(f.accounts, f.txs, f.valuations, today, ctx);
    const recentRows = await q.query<TxSqlRow>(
      `${TX_SELECT} where t.occurred_on >= $1 order by t.occurred_on desc, t.created_at desc limit 400`,
      [addDays(today, -120)],
    );
    const months: ISODate[] = [];
    for (let k = 11; k >= 0; k--) months.push(k === 0 ? today : endOfMonth(addMonths(startOfMonth(today), -k)));
    const sheets = months.map((m) => balanceSheet(f.accounts, f.txs, f.valuations, m, ctx));
    const lastVal = new Map<string, ISODate>();
    for (const v of f.valuations) if (!lastVal.has(v.accountId) || v.on > lastVal.get(v.accountId)!) lastVal.set(v.accountId, v.on);
    const accounts: AccountView[] = bs.accounts.map((row) => ({
      id: row.account.id, name: row.account.name, type: row.account.type, institution: row.account.institution, currency: row.account.currency,
      native: row.native, converted: row.converted, isLiquid: row.account.isLiquid, includeInNetWorth: row.account.includeInNetWorth,
      archived: row.account.archived, valued: VALUED.includes(row.account.type), lastValuation: lastVal.get(row.account.id) ?? null,
      history: sheets.map((s) => s.accounts.find((x) => x.account.id === row.account.id)?.native ?? 0),
      recent: recentRows.filter((r) => r.account_id === row.account.id).slice(0, 5).map((r) => toTxView(r, f.book, base)),
    }));
    const cash = bs.accounts.filter((a) => a.account.isLiquid && !a.account.archived).reduce((s, a) => s + Math.max(0, a.converted ?? 0), 0);
    return {
      base,
      today,
      accounts,
      netWorth: bs.netWorth,
      liquid: bs.liquid,
      assets: bs.assets,
      liabilities: bs.liabilities,
      investments: bs.investments,
      cash,
      trend: months.map((m, i) => ({ month: m.slice(0, 7), value: sheets[i].netWorth })),
      rateNotes: f.book.disclose(f.accounts.map((a) => a.currency), base, today),
    };
  });
}

// ───────────────────────────────────────────── quick-add options

export interface MoneyFormOptions {
  base: string;
  accounts: { id: string; name: string; currency: string; type: AccountType }[];
  categories: { id: string; kind: 'income' | 'expense'; name: string; slug: string; uses: number }[];
  lastAccountId: string | null;
  lastAccountByKind: { expense: string | null; income: string | null };
  merchants: { name: string; categoryId: string | null; kind: 'income' | 'expense' }[];
}

/** Accounts, categories by recent use, and the merchants/sources you actually use — for 3-tap logging. */
export async function loadMoneyForm(viewer: Viewer): Promise<MoneyFormOptions> {
  return asUser(viewer.userId, async (q) => {
    const since = addDays(viewer.today, -120);
    const [accounts, categories, last, merchants] = await Promise.all([
      q.query<{ id: string; name: string; currency: string; type: AccountType }>(
        `select id, name, currency, type from accounts where archived_at is null order by sort_order, created_at`,
      ),
      q.query<{ id: string; kind: 'income' | 'expense'; name: string; slug: string; uses: number }>(
        `select c.id, c.kind, c.name, c.slug,
                (select count(*)::int from transactions t where t.category_id = c.id and t.occurred_on > $1) as uses
           from categories c where c.archived_at is null order by uses desc, c.sort_order`,
        [addDays(viewer.today, -90)],
      ),
      q.query<{ kind: string; account_id: string }>(
        `select distinct on (kind) kind, account_id from transactions where kind in ('expense', 'income') order by kind, created_at desc`,
      ),
      q.query<{ counterparty: string; category_id: string | null; kind: 'income' | 'expense'; n: number }>(
        `select counterparty, (array_agg(category_id order by occurred_on desc))[1] as category_id, kind, count(*)::int as n
           from transactions where counterparty is not null and kind in ('expense', 'income') and occurred_on > $1
          group by counterparty, kind order by n desc limit 24`,
        [since],
      ),
    ]);
    const lastBy = (k: string) => last.find((l) => l.kind === k)?.account_id ?? null;
    const lastAny = lastBy('expense') ?? lastBy('income');
    return {
      base: viewer.profile.baseCurrency,
      accounts,
      categories,
      lastAccountId: lastAny ?? accounts[0]?.id ?? null,
      lastAccountByKind: { expense: lastBy('expense'), income: lastBy('income') },
      merchants: merchants.map((m) => ({ name: m.counterparty, categoryId: m.category_id, kind: m.kind })),
    };
  });
}
