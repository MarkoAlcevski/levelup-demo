import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/context';
import { loadLedger, loadMoneyOverview } from '@/lib/server/money';
import { asUser } from '@/lib/db';
import { loadFinance } from '@/lib/server/money';
import { targetsFor } from '@/lib/server/money-plan';
import { formatDay } from '@/lib/engine/dates';
import { formatMoney } from '@/lib/engine/money';
import { pctChange } from '@/lib/engine/period';
import { parsePeriodArgs, type PeriodSearch } from '@/lib/period-args';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Empty, Page, Section } from '@/components/page';
import { Delta, Meter } from '@/components/viz/marks';
import { MoneySubnav } from '@/components/money/subnav';
import { PeriodPicker } from '@/components/money/period-picker';
import { AddAccountButton, QuickMoney, TxList } from '@/components/money/money-client';

export const metadata: Metadata = { title: 'Money' };

/** Overview answers one question: how am I doing right now? Everything deeper lives in Analysis. */
export default async function MoneyOverviewPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const viewer = await getViewer();
  const args = parsePeriodArgs(await searchParams, 'month');
  const d = await loadMoneyOverview(viewer, args);
  const base = d.base;
  const f = (n: number, o: { signed?: boolean } = {}) => formatMoney(n, base, { compact: true, ...o });
  const vs = d.previous ? `vs ${d.previous.label}` : '';

  if (!d.hasAccounts) {
    return (
      <Page title="Money" subnav={<MoneySubnav active="overview" />}>
        <Empty
          title="Start with an account"
          body="Add the accounts you actually use — cash, a bank, Wise, Revolut — in any currency. Then expenses, income and transfers take three taps."
          action={<AddAccountButton base={base} variant="primary" label="Add account" />}
        />
      </Page>
    );
  }

  const [ledger, targets] = await Promise.all([
    loadLedger(viewer, { page: 1 }),
    asUser(viewer.userId, async (q) => targetsFor(q, viewer, await loadFinance(q, base))),
  ]);
  const flows = d.flows;
  const prev = d.prevFlows;
  const kpis = [
    { label: 'Income', value: f(flows.income), delta: <Delta value={prev ? pctChange(flows.income, prev.income) : null} kind="pct" vs={vs} /> },
    { label: 'Spent', value: f(flows.expenses), delta: <Delta value={prev ? pctChange(flows.expenses, prev.expenses) : null} kind="pct" upIsGood={false} vs={vs} /> },
    {
      label: 'Net cash flow',
      value: f(flows.net, { signed: true }),
      delta: prev ? (
        <span className={cn('text-xs font-medium tnum', flows.net >= prev.net ? 'text-good' : 'text-bad')}>
          {flows.net >= prev.net ? '↑' : '↓'} {f(Math.abs(flows.net - prev.net))}
          <span className="ml-1 font-normal text-ink-3">{vs}</span>
        </span>
      ) : null,
    },
    {
      label: 'Savings rate',
      value: fmtPct(flows.savingsRate, 1),
      delta: <Delta value={flows.savingsRate != null && prev?.savingsRate != null ? (flows.savingsRate - prev.savingsRate) * 100 : null} kind="pp" vs={vs} />,
    },
  ];

  return (
    <Page title="Money" subnav={<MoneySubnav active="overview" />}>
      <QuickMoney />
      <PeriodPicker base="/money" preset={args.preset} compare={args.compare} custom={args.custom} compareCustom={args.compareCustom} today={viewer.today} />
      <p className="-mt-6 text-[13px] text-ink-3">
        {d.period.label} · {formatDay(d.period.start)} – {formatDay(d.period.end)} · in {base}
      </p>

      <dl className="-mt-2 grid grid-cols-2 gap-x-4 gap-y-5">
        {kpis.map((k) => (
          <div key={k.label}>
            <dt className="label-mono">{k.label}</dt>
            <dd className="mt-1 text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink tnum">{k.value}</dd>
            <dd className="mt-0.5 min-h-4">{k.delta}</dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-2 gap-4 border-y border-line py-4">
        <Link href="/money/accounts" className="group">
          <p className="label-mono">Net worth</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum group-hover:underline">{f(d.netWorth)}</p>
          {d.netWorthPrev != null && <p className="text-[12px] text-ink-3 tnum">{f(d.netWorth - d.netWorthPrev, { signed: true })} since {d.previous ? formatDay(d.previous.end) : ''}</p>}
        </Link>
        <Link href="/money/accounts" className="group">
          <p className="label-mono">Liquid cash</p>
          <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum group-hover:underline">{f(d.liquid)}</p>
          <p className="text-[12px] text-ink-3">cash, bank and savings</p>
        </Link>
      </div>

      {targets.length > 0 && (
        <Section title="Targets" aside={<Link href="/money/plan" className="-my-2 inline-flex min-h-11 items-center font-medium text-ink hover:underline">Plan →</Link>}>
          <ul className="flex flex-col gap-3">
            {targets.slice(0, 2).map((t) => (
              <li key={t.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] font-medium text-ink">{t.title}</span>
                  <span className="shrink-0 text-[13px] text-ink-3 tnum">
                    {formatMoney(t.current, t.currency, { compact: true })} / {formatMoney(t.target, t.currency, { compact: true })}
                  </span>
                </div>
                <Meter className="mt-2" value={Math.min(1, t.progress)} tone={t.over ? 'bad' : 'accent'} label={`${Math.round(t.progress * 100)}%`} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      {d.insights.length > 0 && (
        <Section title="Worth knowing">
          <ul className="flex flex-col gap-2.5">
            {d.insights.map((i) => (
              <li key={i.text} className="flex gap-3 text-[15px] leading-6 text-ink-2">
                <span className={cn('mt-2.5 size-1.5 shrink-0 rounded-full', i.tone === 'warn' ? 'bg-warn' : i.tone === 'good' ? 'bg-good' : 'bg-ink-3')} aria-hidden />
                {i.text}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-3">Facts from your own records — not financial advice.</p>
        </Section>
      )}

      {d.upcoming.items.length > 0 && (
        <Section title="Coming up this month" aside={<Link href="/money/plan" className="-my-2 inline-flex min-h-11 items-center font-medium text-ink hover:underline">Recurring →</Link>}>
          <ul className="divide-y divide-line">
            {d.upcoming.items.slice(0, 4).map((u) => (
              <li key={u.name + u.on} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-[15px] text-ink">{u.name}</span>
                  <span className="block font-mono text-[11px] uppercase text-ink-3">{formatDay(u.on)}</span>
                </span>
                <span className={cn('shrink-0 text-[15px] font-medium tnum', u.kind === 'income' ? 'text-good' : 'text-ink')}>
                  {formatMoney(u.kind === 'income' ? u.amount : -u.amount, base, { signed: true, compact: true })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Recent" aside={<Link href="/money/transactions" className="-my-2 inline-flex min-h-11 items-center font-medium text-ink hover:underline">All transactions →</Link>}>
        <TxList items={ledger.items.slice(0, 6)} base={base} today={viewer.today} />
      </Section>

      {d.rateNotes.length > 0 && <p className="text-xs text-ink-3">Totals in {base}. Converted at: {d.rateNotes.join(' · ')}. Each transaction keeps its own currency.</p>}
      {d.unconverted && <p className="text-xs text-warn">Some amounts have no exchange rate yet and are left out of the totals.</p>}
    </Page>
  );
}
