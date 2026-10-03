import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/context';
import { loadMoneyAnalysis } from '@/lib/server/money';
import { formatDay, monthName } from '@/lib/engine/dates';
import { formatMoney } from '@/lib/engine/money';
import { pctChange } from '@/lib/engine/period';
import { parsePeriodArgs, type PeriodSearch } from '@/lib/period-args';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Page, Section } from '@/components/page';
import { Delta, Meter } from '@/components/viz/marks';
import { CashflowChart } from '@/components/viz/cashflow-chart';
import { Line } from '@/components/viz/bars';
import { MoneySubnav } from '@/components/money/subnav';
import { PeriodPicker } from '@/components/money/period-picker';

export const metadata: Metadata = { title: 'Money analysis' };

/** Everything, because you asked: trends, sources, categories, runway, anomalies, projections, reports. */
export default async function MoneyAnalysisPage({ searchParams }: { searchParams: Promise<PeriodSearch> }) {
  const viewer = await getViewer();
  const args = parsePeriodArgs(await searchParams, '30d');
  const d = await loadMoneyAnalysis(viewer, args);
  const base = d.base;
  const f = (n: number, o: { signed?: boolean } = {}) => formatMoney(n, base, { compact: true, ...o });
  const vs = d.previous ? `vs ${d.previous.label}` : '';
  const maxCat = Math.max(1, ...d.categories.map((c) => c.amount));
  const inc = d.income;
  const totalSpend = d.fixed + d.variable;

  return (
    <Page title="Analysis" kicker="Money" subnav={<MoneySubnav active="analysis" />} width="lg">
      <PeriodPicker base="/money/analysis" preset={args.preset} compare={args.compare} custom={args.custom} compareCustom={args.compareCustom} today={viewer.today} />
      <p className="-mt-6 text-[13px] text-ink-3">
        {d.period.label} · {formatDay(d.period.start)} – {formatDay(d.period.end)}
        {d.previous ? ` · compared with ${d.previous.label}` : ''} · in {base}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-5 lg:grid-cols-4">
        {[
          { k: 'Income', v: f(d.flows.income), delta: <Delta value={d.prevFlows ? pctChange(d.flows.income, d.prevFlows.income) : null} kind="pct" vs={vs} /> },
          { k: 'Spent', v: f(d.flows.expenses), delta: <Delta value={d.prevFlows ? pctChange(d.flows.expenses, d.prevFlows.expenses) : null} kind="pct" upIsGood={false} vs={vs} /> },
          { k: 'Net cash flow', v: f(d.flows.net, { signed: true }), delta: d.prevFlows ? <span className="text-xs text-ink-3 tnum">was {f(d.prevFlows.net, { signed: true })}</span> : null },
          { k: 'Savings rate', v: fmtPct(d.flows.savingsRate, 1), delta: <Delta value={d.flows.savingsRate != null && d.prevFlows?.savingsRate != null ? (d.flows.savingsRate - d.prevFlows.savingsRate) * 100 : null} kind="pp" vs={vs} /> },
          { k: 'Net worth', v: f(d.netWorth), delta: d.netWorthPrev != null ? <span className="text-xs text-ink-3 tnum">{f(d.netWorth - d.netWorthPrev, { signed: true })} change</span> : null },
          { k: 'Daily spend', v: f(d.flows.avgDailySpend), delta: <Delta value={d.prevFlows ? pctChange(d.flows.avgDailySpend, d.prevFlows.avgDailySpend) : null} kind="pct" upIsGood={false} vs={vs} /> },
          { k: 'Saved & invested', v: f(d.flows.movedToSavings + d.flows.movedToInvestments), delta: <span className="text-xs text-ink-3">moved to savings/investments</span> },
          { k: 'Runway', v: d.runway == null ? '—' : `${d.runway.toFixed(1)} mo`, delta: <span className="text-xs text-ink-3">liquid ÷ essential spend</span> },
        ].map((x) => (
          <div key={x.k}>
            <dt className="label-mono">{x.k}</dt>
            <dd className="mt-1 text-[24px] font-semibold tracking-[-0.03em] text-ink tnum">{x.v}</dd>
            <dd className="mt-0.5 min-h-4">{x.delta}</dd>
          </div>
        ))}
      </dl>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Cash flow" aside="income vs spending, by month">
          <CashflowChart months={d.months} currency={base} />
        </Section>
        <Section title="Net worth" aside="month end">
          <Line label="Net worth at month end" format={(n) => f(n)} points={d.netWorthTrend.map((t) => ({ label: monthName(t.label), value: t.value }))} />
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Spending by category" aside={d.previous ? 'change vs comparison' : undefined}>
          <ul className="divide-y divide-line">
            {d.categories.slice(0, 10).map((c) => (
              <li key={c.slug} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] text-ink">
                    {c.name}
                    {c.isFixed && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">fixed</span>}
                    {c.isEssential && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">essential</span>}
                  </span>
                  <span className="flex items-baseline gap-2.5">
                    <Delta value={c.prev != null && c.prev > 0 ? (c.amount - c.prev) / c.prev : null} kind="pct" upIsGood={false} />
                    <span className="text-[15px] font-semibold text-ink tnum">{f(c.amount)}</span>
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <Meter value={c.amount / maxCat} tone="ink" className="flex-1" />
                  <span className="w-10 text-right text-xs text-ink-3 tnum">{fmtPct(c.share)}</span>
                </div>
              </li>
            ))}
            {!d.categories.length && <li className="py-5 text-sm text-ink-3">No spending in this period.</li>}
          </ul>
        </Section>

        <Section title="Income sources" aside={inc.avg3 != null ? `3-month average ${f(inc.avg3)}` : undefined}>
          <ul className="divide-y divide-line">
            {d.sources.map((s) => (
              <li key={s.source} className="py-2.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-[15px] text-ink">
                    {s.source}
                    {s.recurring && <span className="ml-2 font-mono text-[10px] uppercase tracking-[0.06em] text-ink-3">recurring</span>}
                  </span>
                  <span className="text-[15px] font-semibold text-ink tnum">{f(s.amount)}</span>
                </div>
                <div className="mt-1.5 flex items-center gap-3">
                  <Meter value={s.share} className="flex-1" />
                  <span className="w-10 text-right text-xs text-ink-3 tnum">{fmtPct(s.share)}</span>
                </div>
              </li>
            ))}
            {!d.sources.length && <li className="py-5 text-sm text-ink-3">No income in this period.</li>}
          </ul>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="text-ink-3">Largest source</dt>
              <dd className="text-ink">{inc.largestShareNow ? `${inc.largestShareNow.source} · ${fmtPct(inc.largestShareNow.share)} of last month` : '—'}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Volatility</dt>
              <dd className="text-ink">{inc.volatility == null ? 'Needs 3 full months' : `${inc.volatility < 0.15 ? 'Low' : inc.volatility < 0.35 ? 'Moderate' : 'High'} (${fmtPct(inc.volatility)} month-to-month)`}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Month over month</dt>
              <dd className="text-ink">{inc.momGrowth == null ? '—' : `${inc.momGrowth >= 0 ? '+' : '−'}${fmtPct(Math.abs(inc.momGrowth), 1)}`}</dd>
            </div>
            <div>
              <dt className="text-ink-3">Concentration 3 months ago</dt>
              <dd className="text-ink">{inc.largestShare3mAgo ? `${inc.largestShare3mAgo.source} · ${fmtPct(inc.largestShare3mAgo.share)}` : '—'}</dd>
            </div>
          </dl>
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="How spending splits" aside="your category settings">
          {totalSpend > 0 ? (
            <div className="flex flex-col gap-4">
              {[
                ['Fixed', d.fixed, 'Variable', d.variable],
                ['Essential', d.essential, 'Discretionary', d.discretionary],
              ].map(([a, av, b, bv]) => (
                <div key={a as string}>
                  <div className="flex h-3 overflow-hidden rounded-full bg-sunken">
                    <span className="h-full bg-ink-2" style={{ width: `${((av as number) / totalSpend) * 100}%` }} />
                  </div>
                  <div className="mt-1.5 flex justify-between text-[13px]">
                    <span className="text-ink-2">
                      {a} <span className="text-ink tnum">{f(av as number)}</span> <span className="text-ink-3">· {fmtPct((av as number) / totalSpend)}</span>
                    </span>
                    <span className="text-ink-2">
                      {b} <span className="text-ink tnum">{f(bv as number)}</span>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-3">No spending in this period.</p>
          )}
          <p className="mt-3 text-[12px] text-ink-3">Runway: {f(d.liquid)} liquid ÷ {f(d.essentialMonthly)} essential spending per month (90-day average) = {d.runway == null ? '—' : `${d.runway.toFixed(1)} months`}.</p>
        </Section>

        <Section title="Anomalies" aside="≥ 30% and ≥ €20 above the usual">
          {d.anomalies.length ? (
            <ul className="flex flex-col gap-2.5">
              {d.anomalies.map((a) => (
                <li key={a.name} className="flex gap-3 text-[15px] leading-6 text-ink-2">
                  <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-warn" aria-hidden />
                  <span>
                    <span className="font-medium text-ink">{a.name}</span>: {f(a.amount)}, {fmtPct(a.change)} above its average for a period this long ({f(a.baseline)}).
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">Nothing unusual in this period.</p>
          )}
        </Section>
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <Section title="Subscriptions" aside={<Link href="/money/plan" className="-my-2 inline-flex min-h-11 items-center font-medium text-ink hover:underline">Manage →</Link>}>
          <p className="text-[15px] text-ink-2">
            {d.subscriptions.count} active · <span className="text-ink tnum">{f(d.subscriptions.monthly)}</span> a month · <span className="text-ink tnum">{f(d.subscriptions.annual)}</span> a year
          </p>
          {d.subscriptions.byVerdict.cancel + d.subscriptions.byVerdict.questionable > 0 && (
            <p className="mt-1 text-[13px] text-ink-3">{f((d.subscriptions.byVerdict.cancel + d.subscriptions.byVerdict.questionable) * 12)} a year is marked questionable or cancel — by you.</p>
          )}
        </Section>
        <Section title="If the last 90 days continued" aside="a projection, not a prediction">
          <dl className="grid grid-cols-2 gap-3">
            {[
              ['Income / year', f(d.forecast.projectedAnnualIncome)],
              ['Spending / year', f(d.forecast.projectedAnnualExpenses)],
              ['Saved / year', f(d.forecast.projectedAnnualSavings, { signed: true })],
              ['Net worth, Dec 31', f(d.forecast.projectedYearEndNetWorth)],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-[12px] text-ink-3">{k}</dt>
                <dd className="text-lg font-semibold text-ink tnum">{v}</dd>
              </div>
            ))}
          </dl>
        </Section>
      </div>

      <Section title="Monthly reports">
        {d.reportMonths.length ? (
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {d.reportMonths.map((m) => (
              <li key={m}>
                <Link href={`/money/report/${m}`} className={cn('pressable flex min-h-12 items-center justify-between rounded-[12px] border border-line px-3.5 text-[15px] text-ink hover:border-line-strong')}>
                  {monthName(`${m}-01`)} {m.slice(0, 4)}
                  <span aria-hidden className="text-ink-3">→</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">A report appears for every month with transactions.</p>
        )}
      </Section>

      {d.rateNotes.length > 0 && <p className="text-xs text-ink-3">Converted to {base} at: {d.rateNotes.join(' · ')}.</p>}
    </Page>
  );
}
