import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { loadMoneyReport } from '@/lib/server/money-plan';
import { formatMoney } from '@/lib/engine/money';
import { fmtPct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Page, Section } from '@/components/page';
import { Delta } from '@/components/viz/marks';

export const metadata: Metadata = { title: 'Money report' };

/** The month in money: what came in, what went out, what changed — every line computed, none guessed. */
export default async function MoneyReportPage({ params }: { params: Promise<{ month: string }> }) {
  const viewer = await getViewer();
  const { month } = await params;
  const r = await loadMoneyReport(viewer, month);
  if (!r) notFound();
  const f = (n: number, o: { signed?: boolean } = {}) => formatMoney(n, r.base, { compact: true, ...o });
  const pct = (a: number, b: number) => (b ? (a - b) / Math.abs(b) : null);
  return (
    <Page title={r.label} kicker={r.complete ? 'Money report' : 'Money report · month in progress'} back={{ href: '/money/analysis', label: 'Analysis' }}>
      {!r.hasData ? (
        <p className="text-sm text-ink-3">No transactions this month.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5">
            {[
              ['Income', f(r.income), <Delta key="i" value={pct(r.income, r.prev.income)} kind="pct" vs={`vs ${r.prev.label}`} />],
              ['Spent', f(r.expenses), <Delta key="e" value={pct(r.expenses, r.prev.expenses)} kind="pct" upIsGood={false} vs={`vs ${r.prev.label}`} />],
              ['Net cash flow', f(r.net, { signed: true }), <span key="n" className="text-xs text-ink-3 tnum">{r.prev.label}: {f(r.prev.net, { signed: true })}</span>],
              ['Savings rate', fmtPct(r.savingsRate, 1), <Delta key="s" value={r.savingsRate != null && r.prev.savingsRate != null ? (r.savingsRate - r.prev.savingsRate) * 100 : null} kind="pp" vs={`vs ${r.prev.label}`} />],
            ].map(([k, v, delta]) => (
              <div key={k as string}>
                <dt className="label-mono">{k}</dt>
                <dd className="mt-1 text-[26px] font-semibold tracking-[-0.03em] text-ink tnum">{v}</dd>
                <dd className="mt-0.5 min-h-4">{delta}</dd>
              </div>
            ))}
          </dl>
          <p className="-mt-3 text-[15px] text-ink-2">
            Net worth went from <span className="text-ink tnum">{f(r.netWorth.start)}</span> to <span className="text-ink tnum">{f(r.netWorth.end)}</span> ({f(r.netWorth.change, { signed: true })}).
          </p>

          {(r.changed.length > 0 || r.stable.length > 0 || r.attention.length > 0) && (
            <div className="grid gap-5 sm:grid-cols-3">
              {[
                ['What changed', r.changed, 'bg-ink-2'],
                ['What stayed steady', r.stable, 'bg-good'],
                ['Worth a look', r.attention, 'bg-warn'],
              ].map(([title, lines, dot]) => (
                <section key={title as string} aria-label={title as string}>
                  <h2 className="label-mono mb-2">{title as string}</h2>
                  {(lines as string[]).length ? (
                    <ul className="flex flex-col gap-2">
                      {(lines as string[]).map((l) => (
                        <li key={l} className="flex gap-2.5 text-[14px] leading-5 text-ink-2">
                          <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', dot as string)} aria-hidden />
                          {l}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[13px] text-ink-3">Nothing to report.</p>
                  )}
                </section>
              ))}
            </div>
          )}

          <div className="grid gap-8 sm:grid-cols-2">
            <Section title="Biggest income sources">
              <ul className="divide-y divide-line">
                {r.sources.map((s) => (
                  <li key={s.source} className="flex justify-between gap-3 py-2 text-[15px]">
                    <span className="truncate text-ink-2">{s.source}</span>
                    <span className="shrink-0 text-ink tnum">
                      {f(s.amount)} <span className="text-[12px] text-ink-3">{fmtPct(s.share)}</span>
                    </span>
                  </li>
                ))}
                {!r.sources.length && <li className="py-3 text-sm text-ink-3">No income.</li>}
              </ul>
            </Section>
            <Section title="Biggest spending">
              <ul className="divide-y divide-line">
                {r.categories.map((c) => (
                  <li key={c.name} className="flex items-baseline justify-between gap-3 py-2 text-[15px]">
                    <span className="truncate text-ink-2">{c.name}</span>
                    <span className="flex shrink-0 items-baseline gap-2">
                      <Delta value={c.change} kind="pct" upIsGood={false} />
                      <span className="text-ink tnum">{f(c.amount)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </div>

          {r.budgets.length > 0 && (
            <Section title="Budgets">
              <ul className="divide-y divide-line">
                {r.budgets.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3 py-2 text-[15px]">
                    <span className="text-ink-2">{b.name}</span>
                    <span className={cn('tnum', b.status === 'over' ? 'text-bad' : 'text-ink')}>
                      {formatMoney(b.spent, b.currency, { compact: true })} / {formatMoney(b.amount, b.currency, { compact: true })}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Recurring costs">
            <p className="text-[15px] text-ink-2">
              Recurring spending runs at <span className="text-ink tnum">{f(r.recurring.monthly)}</span> a month
              {r.recurring.prevMonthly !== r.recurring.monthly ? ` (was ${f(r.recurring.prevMonthly)} at the start of the month)` : ', unchanged this month'}.
              {r.recurring.started.length ? ` Started: ${r.recurring.started.join(', ')}.` : ''}
              {r.recurring.ended.length ? ` Ended: ${r.recurring.ended.join(', ')}.` : ''}
            </p>
          </Section>

          {r.targets.length > 0 && (
            <Section title="Targets">
              <ul className="divide-y divide-line">
                {r.targets.map((t) => (
                  <li key={t.title} className="flex justify-between gap-3 py-2 text-[15px]">
                    <span className="text-ink-2">{t.title}</span>
                    <span className={cn('tnum', t.met ? 'text-good' : 'text-ink')}>
                      {f(t.current)} / {f(t.target)}
                      {t.met ? ' ✓' : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <p className="text-xs text-ink-3">Every line above is calculated from your transactions, budgets and targets. Nothing is estimated or written by AI.</p>
        </>
      )}
    </Page>
  );
}
