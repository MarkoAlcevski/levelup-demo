import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { loadGymStats } from '@/lib/server/gym';
import { asUser } from '@/lib/db';
import { getProgram } from '@/lib/server/gym';
import { formatDay, monthName } from '@/lib/engine/dates';
import { fmtNum } from '@/lib/engine/gym';
import { fmtMinutes, fmtPct } from '@/lib/format';
import { Page, Section } from '@/components/page';
import { GymSubnav } from '@/components/gym/subnav';
import { Bars } from '@/components/viz/bars';
import { BodyweightForm } from '@/components/gym/bodyweight';

export const metadata: Metadata = { title: 'Gym stats' };

export default async function GymStatsPage() {
  const viewer = await getViewer();
  if (!(await asUser(viewer.userId, (q) => getProgram(q)))) redirect('/gym');
  const s = await loadGymStats(viewer);
  const unit = s.unit;
  const conv = (kg: number) => (unit === 'kg' ? Math.round(kg * 10) / 10 : Math.round((kg / 0.45359237) * 4) / 4);
  const target = s.weekly.at(-1)?.target ?? null;
  return (
    <Page title="Gym stats" back={{ href: '/gym', label: 'Gym' }} subnav={<GymSubnav active="stats" />}>
      {!s.hasData ? (
        <p className="rounded-[16px] border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-3">Stats start with your first finished workout.</p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
            {[
              ['This week', String(s.thisWeek)],
              ['This month', String(s.thisMonth)],
              ['Consistency · 90 days', fmtPct(s.consistency90)],
              ['Average / week', s.avgPerWeek12 == null ? '—' : String(s.avgPerWeek12)],
              ['Workouts logged', String(s.totalSessions)],
              ['Training time', fmtMinutes(s.totalMinutes)],
              ['Weeks on target', `${s.currentWeekStreak} in a row`],
              ['Best run', `${s.bestWeekStreak} week${s.bestWeekStreak === 1 ? '' : 's'}`],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="label-mono">{k}</dt>
                <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="-mt-4 text-[12px] text-ink-3">Consistency = weeks’ workouts done ÷ what your program asked for, over the last 90 days.</p>

          <Section title="Workouts per week" aside="last 12 weeks">
            <Bars
              label="Workouts per week, last 12 weeks"
              target={target}
              points={s.weekly.map((w) => ({ label: `${Number(w.weekStart.slice(8))}/${Number(w.weekStart.slice(5, 7))}`, value: w.workouts, highlight: w.target != null && w.workouts >= w.target }))}
            />
          </Section>

          <Section title="Volume per week" aside={`${unit} × reps, working sets`}>
            <Bars
              label={`Training volume per week in ${unit}`}
              format={(n) => fmtNum(Math.round(n))}
              points={s.weekly.map((w) => ({ label: `${Number(w.weekStart.slice(8))}/${Number(w.weekStart.slice(5, 7))}`, value: conv(w.volumeKg) }))}
            />
          </Section>

          {s.records.length > 0 && (
            <Section title="Recent records">
              <ul className="divide-y divide-line">
                {s.records.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2.5">
                    <span className="min-w-0 text-[15px] text-ink">
                      {r.kind === 'weight' ? `${r.name} — heaviest set` : r.kind === 'reps' ? `${r.name} — most reps at ${fmtNum(conv(r.weightKg ?? 0))} ${unit}` : `${r.name} — most volume`}
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-semibold text-ink tnum">
                        {r.kind === 'weight' ? `${fmtNum(conv(r.value))} ${unit}` : r.kind === 'reps' ? `${r.reps} reps` : `${fmtNum(Math.round(conv(r.value)))} ${unit}`}
                      </span>
                      <span className="block font-mono text-[11px] text-ink-3">{formatDay(r.on, viewer.today)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Lifts" aside="best set · estimated 1-rep max">
            <ul className="divide-y divide-line">
              {s.lifts.map((l) => (
                <li key={l.key}>
                  <Link href={`/gym/exercises/${encodeURIComponent(l.key)}`} className="flex min-h-14 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-ink">{l.name}</span>
                      <span className="block text-[12px] text-ink-3">
                        {l.sessions} session{l.sessions === 1 ? '' : 's'} · last {formatDay(l.lastOn, viewer.today)}
                      </span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block text-[15px] font-semibold text-ink tnum">{l.bestKg ? `${fmtNum(conv(l.bestKg))} ${unit}` : 'BW'}</span>
                      <span className="block text-[11px] text-ink-3 tnum">{l.bestE1rmKg ? `≈ ${fmtNum(conv(l.bestE1rmKg))} ${unit} est.` : ''}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] text-ink-3">Estimated 1-rep max uses the Epley formula on sets of 12 reps or fewer. It’s an estimate, not a test.</p>
          </Section>
        </>
      )}

      <Section title="Bodyweight" aside="optional">
        {s.bodyweight.length > 0 && (
          <ul className="mb-3 divide-y divide-line">
            {s.bodyweight.slice(-5).reverse().map((b) => (
              <li key={b.on} className="flex items-center justify-between py-2 text-[15px]">
                <span className="text-ink-2">{formatDay(b.on, viewer.today)}</span>
                <span className="font-semibold text-ink tnum">
                  {fmtNum(b.weight)} {b.unit}
                </span>
              </li>
            ))}
          </ul>
        )}
        <BodyweightForm today={viewer.today} unit={unit} />
        <p className="mt-2 text-[12px] text-ink-3">{monthName(viewer.today, true)} · just a number over time. LevelUp isn’t a nutrition app.</p>
      </Section>
    </Page>
  );
}
