import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { ArrowLeft } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { getReview } from '@/lib/server/reviews';
import { actionPlan } from '@/lib/engine/review';
import { formatDay, startOfWeek, weekdayName } from '@/lib/engine/dates';
import { asUser } from '@/lib/db';
import { readKeystone } from '@/lib/server/keystone';
import { formatMoney } from '@/lib/engine/money';
import { fmtHours, fmtPct } from '@/lib/format';
import { cn } from '@/lib/cn';
import { Delta, Meter } from '@/components/viz/marks';
import { AreaIconServer } from '@/components/icons-server';
import { NextKeystone } from '@/components/review/next-keystone';

export const metadata: Metadata = { title: 'Review' };

export default async function ReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const viewer = await getViewer();
  const r = await getReview(viewer, id);
  if (!r) notFound();
  const currentKeystone = await asUser(viewer.userId, (q) => readKeystone(q, startOfWeek(viewer.today, viewer.profile.weekStartsOn)));
  const s = r.stats;
  const isWeek = r.kind === 'week';
  const delta = s.execution != null && s.prev.execution != null ? (s.execution - s.prev.execution) * 100 : null;
  const plan = !isWeek ? actionPlan(s, r.insights) : null;
  const total = s.outcomes.full + s.outcomes.exceeded + s.outcomes.minimum + s.outcomes.partial + s.outcomes.missed;
  const seg = (n: number) => (total ? `${(n / total) * 100}%` : '0%');
  const money = s.money;

  return (
    <article className="mx-auto w-full max-w-[760px] px-4 pt-[max(20px,env(safe-area-inset-top))] pb-40 lg:px-8 lg:pt-10 lg:pb-16">
      <Link href="/progress/reports" className="-ml-1 inline-flex min-h-11 items-center gap-1.5 px-1 text-sm text-ink-3 hover:text-ink">
        <ArrowLeft size={14} /> Reports
      </Link>

      {/* 1 · headline */}
      <header className="mt-6">
        <p className="label-mono">{isWeek ? 'Weekly report' : '30-day report'} · {s.label}</p>
        <div className="mt-4 flex flex-wrap items-end gap-x-5 gap-y-2">
          <p className="text-[76px] font-semibold leading-[0.9] tracking-[-0.05em] text-ink">{fmtPct(s.execution)}</p>
          <div className="pb-2">
            <Delta value={delta} kind="pp" className="text-sm" vs={isWeek ? 'vs last week' : 'vs previous 30 days'} />
            <p className="text-sm text-ink-3">execution</p>
          </div>
        </div>
        <p className="mt-4 max-w-xl text-lg leading-7 text-ink-2 text-pretty">
          You planned <span className="font-semibold text-ink">{s.planned}</span> and kept{' '}
          <span className="font-semibold text-ink">{s.kept}</span>
          {s.outcomes.minimum > 0 && <> — {s.outcomes.minimum} of them at the minimum</>}.
          {s.keystone && (s.keystone.status === 'done' ? ' The Weekly Focus got done.' : ' The Weekly Focus didn’t.')}
        </p>
      </header>

      {/* 2 · outcomes */}
      <section aria-label="Outcomes" className="mt-10">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-sunken">
          <span className="h-full bg-accent" style={{ width: seg(s.outcomes.full + s.outcomes.exceeded) }} />
          <span className="h-full border-l-2 border-bg bg-accent/55" style={{ width: seg(s.outcomes.minimum) }} />
          <span className="h-full border-l-2 border-bg bg-accent/25" style={{ width: seg(s.outcomes.partial) }} />
        </div>
        <dl className="mt-4 grid grid-cols-5 gap-2">
          {[
            ['Full', s.outcomes.full + s.outcomes.exceeded],
            ['Minimum', s.outcomes.minimum],
            ['Partial', s.outcomes.partial],
            ['Missed', s.outcomes.missed],
            ['Excused', s.outcomes.excused],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[12px] text-ink-3">{k}</dt>
              <dd className="text-2xl font-semibold tracking-[-0.02em] text-ink">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      {/* 3 · areas */}
      <section aria-labelledby="areas-h" className="mt-12">
        <h2 id="areas-h" className="label-mono mb-3">By area</h2>
        <ul className="flex flex-col gap-4">
          {s.areas.map((a) => (
            <li key={a.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                  <AreaIconServer kind={a.kind} size={15} className="text-ink-3" /> {a.name}
                </span>
                <span className="flex items-baseline gap-2.5">
                  <Delta value={a.deltaPp} kind="pp" />
                  <span className="w-12 text-right text-[15px] font-semibold text-ink tnum">{fmtPct(a.execution)}</span>
                </span>
              </div>
              <Meter className="mt-2" value={a.execution} previous={a.prevExecution} label={`${a.name} ${fmtPct(a.execution)}`} />
            </li>
          ))}
        </ul>
      </section>

      {/* 4 · days */}
      {isWeek && (
        <section aria-labelledby="days-h" className="mt-12">
          <h2 id="days-h" className="label-mono mb-3">By day</h2>
          <div className="grid grid-cols-7 gap-2">
            {s.days.map((d) => {
              const v = d.execution ?? 0;
              const best = s.bestDay?.day === d.day;
              const worst = s.worstDay?.day === d.day;
              return (
                <div key={d.day} className="flex flex-col items-center gap-2">
                  <div className="relative flex h-28 w-full items-end overflow-hidden rounded-[8px] bg-sunken">
                    <div className={cn('w-full rounded-t-[4px]', best ? 'bg-accent' : 'bg-ink-3/45')} style={{ height: `${Math.max(3, v * 100)}%` }} />
                  </div>
                  <span className={cn('font-mono text-[11px]', best ? 'text-accent-text' : worst ? 'text-bad' : 'text-ink-3')}>{weekdayName(d.day)}</span>
                  <span className="text-xs text-ink-2 tnum">{d.execution == null ? '—' : fmtPct(d.execution)}</span>
                </div>
              );
            })}
          </div>
          {s.bestDay && (
            <p className="mt-4 text-sm text-ink-2">
              Best day: <span className="text-ink">{weekdayName(s.bestDay.day, true)}</span> ({fmtPct(s.bestDay.execution)})
              {s.worstDay && (
                <>
                  {' '}· Hardest: <span className="text-ink">{weekdayName(s.worstDay.day, true)}</span> ({fmtPct(s.worstDay.execution)})
                </>
              )}
            </p>
          )}
        </section>
      )}

      {/* 5 · the numbers */}
      <section aria-labelledby="nums-h" className="mt-12">
        <h2 id="nums-h" className="label-mono mb-3">The numbers</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border border-line bg-line sm:grid-cols-3">
          {[
            ['Most consistent', s.mostConsistent ? s.mostConsistent.title : '—', s.mostConsistent ? `${s.mostConsistent.kept} of ${s.mostConsistent.planned} kept` : ''],
            ['Most missed', s.mostMissed ? s.mostMissed.title : 'Nothing', s.mostMissed ? `${s.mostMissed.planned - s.mostMissed.kept} of ${s.mostMissed.planned} missed` : 'Every commitment kept'],
            ['Strongest area', s.strongestArea?.name ?? '—', s.strongestArea ? fmtPct(s.strongestArea.execution) : ''],
            ['Weakest area', s.weakestArea?.name ?? '—', s.weakestArea ? fmtPct(s.weakestArea.execution) : ''],
            ['Focused time', s.minutes ? fmtHours(s.minutes) : '—', s.prev.minutes ? `${fmtHours(s.prev.minutes)} before` : ''],
            ['Points earned', `+${s.xp.toLocaleString('en-US')}`, s.prev.xp ? `${s.prev.xp.toLocaleString('en-US')} before` : ''],
            ['Proof', String(s.proofs), s.proofs === 1 ? 'piece of evidence' : 'pieces of evidence'],
            ['Momentum', s.momentum.end == null ? '—' : String(s.momentum.end), s.momentum.start != null && s.momentum.end != null ? `${s.momentum.end - s.momentum.start >= 0 ? '+' : ''}${s.momentum.end - s.momentum.start} this period` : ''],
            ['Streak', `${s.streak.current} days`, `best ${s.streak.best}`],
          ].map(([k, v, sub]) => (
            <div key={k} className="bg-surface px-4 py-3.5">
              <dt className="text-[12px] text-ink-3">{k}</dt>
              <dd className="mt-0.5 truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">{v}</dd>
              {sub && <dd className="truncate text-xs text-ink-3">{sub}</dd>}
            </div>
          ))}
        </dl>
      </section>

      {/* 6 · insights */}
      {r.insights.length > 0 && (
        <section aria-labelledby="ins-h" className="mt-12">
          <h2 id="ins-h" className="label-mono mb-3">What the data says</h2>
          <ul className="flex flex-col gap-3">
            {r.insights.map((i) => (
              <li key={i.key} className="card px-4 py-4">
                <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
                  <span className={cn('size-2 rounded-full', i.tone === 'positive' ? 'bg-accent' : i.tone === 'warning' ? 'bg-warn' : 'bg-ink-3')} aria-hidden />
                  {i.title}
                </p>
                <p className="mt-1.5 text-[15px] leading-6 text-ink-2">{i.body}</p>
                {i.suggestion && <p className="mt-2 text-[15px] leading-6 text-ink">→ {i.suggestion}</p>}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-ink-3">Every insight is computed from your records — no guesses. Correlations are described as moving together, never as causes.</p>
        </section>
      )}

      {/* 7 · plan (30-day) */}
      {plan && (
        <section aria-labelledby="plan-h" className="mt-12">
          <h2 id="plan-h" className="label-mono mb-3">Next 30 days</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ['Keep doing', plan.keep],
              ['Change', plan.change],
              ['Stop', plan.stop],
              ['Next 30 days', plan.next],
            ] as const).map(([k, list]) => (
              <div key={k} className="card px-4 py-4">
                <h3 className="text-[15px] font-semibold text-ink">{k}</h3>
                {list.length ? (
                  <ul className="mt-2 flex list-disc flex-col gap-1.5 pl-5 text-[14px] leading-5 text-ink-2 marker:text-ink-3">
                    {list.map((x, n) => (
                      <li key={n}>{x}</li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[14px] text-ink-3">Nothing the data supports saying here.</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 8 · money */}
      {money && (
        <section aria-labelledby="money-h" className="mt-12">
          <h2 id="money-h" className="label-mono mb-3">Money</h2>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ['Income', formatMoney(money.income, money.base, { compact: true }), money.prevIncome != null && money.prevIncome !== 0 ? (money.income - money.prevIncome) / money.prevIncome : null, true],
              ['Expenses', formatMoney(money.expenses, money.base, { compact: true }), money.prevExpenses != null && money.prevExpenses !== 0 ? (money.expenses - money.prevExpenses) / money.prevExpenses : null, false],
              ['Net', formatMoney(money.net, money.base, { compact: true, signed: true }), null, true],
              ['Savings rate', fmtPct(money.savingsRate), null, true],
            ].map(([k, v, d, good]) => (
              <div key={k as string} className="card px-4 py-3.5">
                <dt className="text-[12px] text-ink-3">{k as string}</dt>
                <dd className="mt-0.5 text-xl font-semibold tracking-[-0.02em] text-ink">{v as string}</dd>
                {d != null && <Delta value={d as number} kind="pct" upIsGood={good as boolean} />}
              </div>
            ))}
          </dl>
        </section>
      )}

      {isWeek && (
        <section className="mt-12 rounded-[16px] border border-line-strong bg-surface px-5 py-5">
          <p className="text-[17px] font-semibold text-ink">One change for next week</p>
          <p className="mt-1 text-sm text-ink-3">Pick next week’s Weekly Focus — the one thing that makes the week a win.</p>
          <div className="mt-4">
            <NextKeystone current={currentKeystone?.title ?? null} />
          </div>
        </section>
      )}

      <p className="mt-10 text-center text-xs text-ink-3">
        Generated {formatDay(s.end)} from {s.planned} planned commitments · review engine v{s.version}
      </p>
    </article>
  );
}
