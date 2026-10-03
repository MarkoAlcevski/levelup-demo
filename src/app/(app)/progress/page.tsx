import type { Metadata } from 'next';
import Link from 'next/link';
import { Lightbulb } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { loadProgress, type ProgressRange } from '@/lib/server/progress';
import { fmtHours, fmtPct } from '@/lib/format';
import { isGymKind } from '@/lib/modules';
import { Page, RangeLinks, Section } from '@/components/page';
import { ProgressSubnav } from '@/components/progress/subnav';
import { ScoreTiles } from '@/components/progress/score-tiles';
import { TrendChart } from '@/components/viz/trend-chart';
import { YearHeatmap } from '@/components/progress/year-heatmap';
import { Delta, Meter } from '@/components/viz/marks';
import { AreaIconServer } from '@/components/icons-server';

export const metadata: Metadata = { title: 'Progress' };

const RANGES: { value: ProgressRange; label: string }[] = [
  { value: '7d', label: '7 days' },
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: '1y', label: 'Year' },
];
const RANGE_LABEL: Record<ProgressRange, string> = { '7d': 'last 7 days', '30d': 'last 30 days', '90d': 'last 90 days', '1y': 'last 12 months' };

export default async function ProgressPage({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const sp = await searchParams;
  const range = (RANGES.some((r) => r.value === sp.range) ? sp.range : '30d') as ProgressRange;
  const viewer = await getViewer();
  const d = await loadProgress(viewer, range);
  const s = d.score;

  return (
    <Page title="Progress" subnav={<ProgressSubnav />}>
      <RangeLinks options={RANGES} current={range} base="/progress" />

      <div className="flex flex-col gap-3">
        <ScoreTiles
          score={s}
          momentum={d.momentum}
          streak={{ current: d.streak.current, best: Math.max(d.streak.best, 0) }}
          threshold={viewer.profile.streakThreshold}
          rangeLabel={RANGE_LABEL[range]}
        />
        <p className="text-[13px] text-ink-3">
          {s.planned > 0 ? (
            <>
              {s.kept} of {s.planned} planned done in the {RANGE_LABEL[range]}
              {s.minimum > 0 ? ` · ${s.minimum} at the minimum` : ''}
              {s.missed > 0 ? ` · ${s.missed} missed` : ''}
              {s.excused > 0 ? ` · ${s.excused} excused` : ''}
              {s.minutes > 0 ? ` · ${fmtHours(s.minutes)} of timed work` : ''}.
            </>
          ) : (
            'Nothing planned in this range yet.'
          )}
        </p>
      </div>

      {d.insight && (
        <aside aria-label="Insight" className="flex gap-3 rounded-[16px] bg-sunken px-4 py-3.5">
          <Lightbulb size={20} className="mt-0.5 shrink-0 text-accent-text" aria-hidden />
          <div>
            <p className="text-[15px] font-semibold text-ink">{d.insight.title}</p>
            <p className="mt-0.5 text-[14px] leading-5 text-ink-2">{d.insight.body}</p>
          </div>
        </aside>
      )}

      <Section title="Execution over time" aside={range === '1y' ? 'by week' : 'by day'}>
        <TrendChart points={d.trend} unit={range === '1y' ? 'week' : 'day'} />
      </Section>

      <Section title="By area" aside="tick = previous period">
        {d.areas.length ? (
          <ul className="divide-y divide-line">
            {d.areas.map((a) => (
              <li key={a.id}>
                <Link href={isGymKind(a.kind) ? '/gym' : a.kind === 'learning' ? '/learning' : `/areas/${a.id}`} className="flex items-center gap-3 py-3.5">
                  <AreaIconServer kind={a.kind} icon={a.icon} size={18} className="shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="truncate text-[15px] font-medium text-ink">{a.name}</span>
                      <span className="flex items-baseline gap-2">
                        <Delta value={a.delta} kind="pp" />
                        <span className="w-12 text-right text-[15px] font-semibold text-ink tnum">{fmtPct(a.execution)}</span>
                      </span>
                    </span>
                    <Meter className="mt-2" value={a.execution} previous={a.prev} label={`${a.name} ${fmtPct(a.execution)}, previously ${fmtPct(a.prev)}`} />
                    <span className="mt-1.5 block text-xs text-ink-3">{a.detail}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Areas show up here once something is planned in them.</p>
        )}
      </Section>

      <Section title={`${d.heatmap.year}, day by day`} aside="tap a day for detail">
        <YearHeatmap cells={d.heatmap.cells} today={d.today} />
        {d.streak.recoveries.length > 0 && (
          <p className="mt-3 text-[13px] text-ink-3">
            You broke the chain {d.streak.recoveries.length} {d.streak.recoveries.length === 1 ? 'time' : 'times'} and were back within a day {d.streak.recoveries.filter((r) => r.days <= 1).length} of them.
          </p>
        )}
      </Section>
    </Page>
  );
}
