'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, CheckCircle, Play } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay, monthName, weekdayName } from '@/lib/engine/dates';
import type { GymHome } from '@/lib/server/gym';
import { activeDraft, type WorkoutDraft } from '@/lib/client/workout';
import { fmtMinutes, fmtPct } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { Pips } from '@/components/viz/marks';
import { useViewerInfo } from '@/components/shell/viewer';
import { useStartWorkout } from './start';
import { GymDaySheet, MonthCalendar } from './calendar';

const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export function GymHomeView({ data, weekStartsOn }: { data: GymHome; weekStartsOn: number }) {
  const v = useViewerInfo();
  const router = useRouter();
  const [picked, setPicked] = useState<string | null>(null);
  const [local, setLocal] = useState<WorkoutDraft | null>(null);
  useEffect(() => setLocal(activeDraft()), []);
  const start = useStartWorkout({ start: data.start, last: data.last, today: data.today, unit: v.weightUnit, serverActiveId: data.active?.id ?? null });
  const program = data.program!;
  const active = local ? { id: local.id, name: local.name } : data.active;
  const target = data.week.target;
  const s = data.summary;
  const unit = data.unit;

  return (
    <>
      {/* this week */}
      <section aria-labelledby="wk-h" className="flex items-end justify-between gap-4">
        <div>
          <h2 id="wk-h" className="label-mono">This week</h2>
          <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink tnum">
            {data.week.done}
            {target != null && <span className="text-ink-3"> / {target}</span>}
            <span className="ml-2 text-[15px] font-medium tracking-normal text-ink-3">workouts</span>
          </p>
        </div>
        {target != null && <Pips done={Math.min(data.week.done, target)} total={target} className="mb-2" />}
      </section>

      {/* next / active / done */}
      <section aria-label="Next workout" data-tour="gym" className="rounded-[16px] border border-line-strong bg-surface p-4">
        {active ? (
          <>
            <p className="label-mono text-accent-text">Workout in progress</p>
            <p className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-ink">{active.name}</p>
            <Button size="lg" block className="mt-4" onClick={() => router.push(`/gym/workout?id=${active.id}`)}>
              <Play size={18} weight="fill" /> Resume workout
            </Button>
          </>
        ) : (
          <>
            {data.trainedToday.length > 0 && (
              <p className="mb-3 flex items-center gap-1.5 text-[13px] font-medium text-accent-text">
                <CheckCircle size={15} weight="fill" /> Trained today: {data.trainedToday.map((t) => t.name).join(' + ')}
              </p>
            )}
            {data.next ? (
              <>
                <p className="label-mono">{data.next.isToday ? (program.mode === 'scheduled' ? 'Today’s workout' : 'Next workout') : `Next · ${weekdayName(data.next.on, true)}`}</p>
                <p className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-ink">{data.next.name}</p>
                <p className="text-[13px] text-ink-3">{data.next.exercises ? `${data.next.exercises} exercise${data.next.exercises === 1 ? '' : 's'}` : 'No exercises yet'}</p>
                <Button size="lg" block className="mt-4" onClick={() => start(data.next!.dayId)}>
                  <Play size={18} weight="fill" /> {data.trainedToday.length || !data.next.isToday ? 'Start anyway' : 'Start workout'}
                </Button>
              </>
            ) : (
              <p className="text-[15px] text-ink-2">No workout days in your program yet.</p>
            )}
            {program.days.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {program.days.filter((d) => d.id !== data.next?.dayId).map((d) => (
                  <button key={d.id} type="button" onClick={() => start(d.id)} className="pressable inline-flex h-9 items-center rounded-full border border-line-strong px-3 text-[13px] font-medium text-ink-2 hover:border-ink-3 hover:text-ink">
                    Start {d.name}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </section>

      {/* the month */}
      <section aria-labelledby="month-h" className="flex flex-col gap-4">
        <h2 id="month-h" className="sr-only">Month</h2>
        <MonthCalendar weeks={data.calendar} month={data.month} mode={program.mode} weekStartsOn={weekStartsOn} onPick={setPicked} />
        <dl className="grid grid-cols-3 gap-x-4 gap-y-4 border-t border-line pt-4">
          <div>
            <dt className="label-mono">Workouts</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">
              {s.workouts}
              {s.target != null && <span className="text-[15px] text-ink-3"> / {s.target}</span>}
            </dd>
          </div>
          <div>
            <dt className="label-mono">Completion</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{fmtPct(s.completion, 1)}</dd>
          </div>
          <div>
            <dt className="label-mono">Time</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{s.minutes ? fmtMinutes(s.minutes) : '—'}</dd>
          </div>
          <div>
            <dt className="label-mono">Sets</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{s.sets}</dd>
          </div>
          <div>
            <dt className="label-mono">Volume</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{s.volumeKg ? Math.round(unit === 'kg' ? s.volumeKg : s.volumeKg / 0.45359237).toLocaleString('en-US') : '—'}<span className="text-[13px] text-ink-3"> {s.volumeKg ? unit : ''}</span></dd>
          </div>
          <div>
            <dt className="label-mono" title="Exercises with a new best this month">PRs</dt>
            <dd className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink tnum">{s.records}</dd>
          </div>
        </dl>
        <p className="-mt-1 text-[12px] text-ink-3">
          {monthName(data.month, true)}
          {s.target != null ? ` · target ${program.mode === 'flexible' ? `${program.perWeek}/week × the month’s days ÷ 7` : 'from your planned days'}` : ''}
        </p>
      </section>

      {/* program */}
      <section aria-labelledby="prog-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="prog-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Program</h2>
          <Link href="/gym/program" className="-my-2 -mr-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 text-[13px] font-medium text-ink-3 hover:text-ink">
            Edit
          </Link>
        </div>
        <p className="mb-2 text-[13px] text-ink-3">
          {program.mode === 'flexible' ? `Flexible · ${program.perWeek} a week, any days` : `Fixed days · ${program.days.filter((d) => d.weekday).map((d) => WD[(d.weekday ?? 1) - 1]).join(' · ')}`}
        </p>
        <ul className="divide-y divide-line rounded-[16px] border border-line">
          {program.days.map((d) => (
            <li key={d.id}>
              <Link href={`/gym/program/${d.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-sunken/50">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] font-semibold text-ink">{d.name}</span>
                  <span className="block truncate text-[13px] text-ink-3">
                    {d.exercises.length ? d.exercises.map((e) => e.name).join(' · ') : 'Add exercises'}
                  </span>
                </span>
                {d.weekday && <span className="font-mono text-[11px] uppercase text-ink-3">{WD[d.weekday - 1]}</span>}
                <ArrowRight size={14} className="shrink-0 text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      </section>

      {/* recent */}
      <section aria-labelledby="recent-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="recent-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Recent</h2>
          {data.recent.length > 0 && (
            <Link href="/gym/history" className="-my-2 inline-flex min-h-11 items-center text-[13px] font-medium text-ink-3 hover:text-ink">
              All workouts
            </Link>
          )}
        </div>
        {data.recent.length ? (
          <ul className="divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.id}>
                <Link href={`/gym/session/${r.id}`} className="flex min-h-14 items-center gap-3 py-2.5">
                  <span className="w-12 shrink-0 font-mono text-[11px] uppercase text-ink-3">{formatDay(r.on, data.today)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] font-medium text-ink">{r.name}</span>
                    <span className="block text-[13px] text-ink-3">
                      {[r.durationSeconds ? fmtMinutes(r.durationSeconds / 60) : null, `${r.exercises} exercises`, `${r.sets} sets`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <ArrowRight size={14} className="text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Your finished workouts appear here — and on the calendar above.</p>
        )}
      </section>

      {data.otherRoutines.length > 0 && (
        <section aria-labelledby="other-h">
          <h2 id="other-h" className="label-mono mb-1">Also in this area</h2>
          <ul className="divide-y divide-line">
            {data.otherRoutines.map((r) => (
              <li key={r.id} className={cn('flex min-h-11 items-center text-[15px] text-ink-2')}>
                {r.title}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12px] text-ink-3">Routines from before the Gym module. They still appear on Today.</p>
        </section>
      )}

      <GymDaySheet day={picked} onClose={() => setPicked(null)} onStart={(id) => { setPicked(null); start(id); }} unit={unit} />
    </>
  );
}
