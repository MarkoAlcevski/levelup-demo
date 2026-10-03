'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CaretLeft, CaretRight, Check, NotePencil, Play } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { addMonths, formatDay, monthName, weekdayName } from '@/lib/engine/dates';
import { displayWeight, fmtNum, isWorkingSet, sessionTotals, type GymCalendarWeek } from '@/lib/engine/gym';
import type { GymDayDetail } from '@/lib/server/gym';
import { gymDayAction } from '@/lib/actions';
import { fmtMinutes } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';

const HEAD = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];
const HEAD_SUN = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * The month, as training actually happened. Done days carry the workout's name; fixed programs
 * also show planned and missed days; flexible programs show a count per week instead of
 * inventing which day a workout "should" have been.
 */
export function MonthCalendar({
  weeks,
  month,
  mode,
  weekStartsOn,
  onPick,
}: {
  weeks: GymCalendarWeek[];
  month: string;
  mode: 'flexible' | 'scheduled' | null;
  weekStartsOn: number;
  onPick: (day: string) => void;
}) {
  const prev = addMonths(month, -1).slice(0, 7);
  const next = addMonths(month, 1).slice(0, 7);
  const head = weekStartsOn === 0 ? HEAD_SUN : HEAD;
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <Link href={`/gym?month=${prev}`} scroll={false} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink" aria-label={`${monthName(prev + '-01', true)}`}>
          <CaretLeft size={18} />
        </Link>
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">
          {monthName(month, true)} {month.slice(0, 4)}
        </h3>
        <Link href={`/gym?month=${next}`} scroll={false} className="pressable grid size-11 place-items-center rounded-full text-ink-2 hover:bg-sunken hover:text-ink" aria-label={`${monthName(next + '-01', true)}`}>
          <CaretRight size={18} />
        </Link>
      </div>
      <div role="grid" aria-label={`${monthName(month, true)} ${month.slice(0, 4)}`} className="grid grid-cols-[repeat(7,minmax(0,1fr))_40px] gap-y-1">
        <div role="row" className="contents">
          {head.map((d, i) => (
            <span key={i} role="columnheader" className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
              {d}
            </span>
          ))}
          <span role="columnheader" className="pb-1 text-center font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
            Wk
          </span>
        </div>
        {weeks.map((w) => (
          <div role="row" key={w.weekStart} className="contents">
            {w.days.map((d) => {
              const name = d.sessions[0]?.name ?? d.plannedName;
              const label = `${weekdayName(d.day, true)} ${formatDay(d.day)}: ${
                d.state === 'done' ? `done${name ? ` — ${d.sessions.map((s) => s.name).join(', ') || 'logged'}` : ''}` : d.state === 'planned' ? `planned — ${name}` : d.state === 'missed' ? `missed — ${name}` : 'no workout'
              }`;
              return (
                <button
                  key={d.day}
                  type="button"
                  role="gridcell"
                  aria-label={label}
                  onClick={() => onPick(d.day)}
                  className={cn(
                    'pressable relative mx-[2px] flex h-[58px] flex-col items-center justify-start rounded-[10px] pt-1.5 text-center',
                    !d.inMonth && 'opacity-35',
                    d.state === 'done' ? 'bg-accent-soft' : d.state === 'planned' ? 'border border-dashed border-line-strong' : 'hover:bg-sunken',
                    d.isToday && 'ring-2 ring-accent-text ring-offset-0',
                  )}
                >
                  <span className={cn('text-[13px] font-medium tnum leading-none', d.state === 'done' ? 'text-ink' : d.future ? 'text-ink-3' : 'text-ink-2')}>{Number(d.day.slice(8))}</span>
                  {d.state === 'done' && (
                    <span className="mt-1 grid size-[18px] place-items-center rounded-full bg-accent text-accent-ink">
                      <Check size={11} weight="bold" />
                    </span>
                  )}
                  {d.state === 'missed' && <span className="mt-1.5 h-[2px] w-3 rotate-[-30deg] rounded-full bg-ink-3" aria-hidden />}
                  {d.state === 'planned' && <span className="mt-1.5 size-1.5 rounded-full bg-ink-3" aria-hidden />}
                  {name && (d.state !== 'rest') && (
                    <span className={cn('absolute inset-x-0.5 bottom-1 truncate font-mono text-[9px] uppercase leading-none tracking-[0.02em]', d.state === 'done' ? 'text-accent-text' : 'text-ink-3')}>
                      {name}
                    </span>
                  )}
                </button>
              );
            })}
            <span role="gridcell" className="flex h-[58px] flex-col items-center justify-center text-center">
              {w.target != null && (w.days.some((d) => d.inMonth)) ? (
                <span className={cn('font-mono text-[11px] tnum', w.done >= w.target && w.target > 0 ? 'text-accent-text' : 'text-ink-3')}>
                  {Math.min(w.done, 99)}/{w.target}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-ink-3">
        <span className="flex items-center gap-1.5">
          <span className="grid size-3.5 place-items-center rounded-full bg-accent text-accent-ink"><Check size={8} weight="bold" /></span> Trained
        </span>
        {mode === 'scheduled' && (
          <>
            <span className="flex items-center gap-1.5"><span className="size-3 rounded-[4px] border border-dashed border-ink-3" /> Planned</span>
            <span className="flex items-center gap-1.5"><span className="h-[2px] w-3 rotate-[-30deg] rounded-full bg-ink-3" /> Missed</span>
          </>
        )}
        <span className="ml-auto">Wk = done / target that week</span>
      </div>
    </div>
  );
}

/** Tap a date: the full workout that happened, what's planned, or Start. */
export function GymDaySheet({
  day,
  onClose,
  onStart,
  unit,
}: {
  day: string | null;
  onClose: () => void;
  onStart: (dayId: string | null) => void;
  unit: 'kg' | 'lb';
}) {
  const [detail, setDetail] = useState<GymDayDetail | null>(null);
  useEffect(() => {
    setDetail(null);
    if (day) void gymDayAction(day).then(setDetail);
  }, [day]);
  const title = day ? `${weekdayName(day, true)}, ${formatDay(day)}` : '';
  return (
    <Sheet open={!!day} onClose={onClose} title={title}>
      {!detail ? (
        <div className="h-40 animate-pulse rounded-[14px] bg-sunken" aria-label="Loading" />
      ) : (
        <div className="flex flex-col gap-5 pt-1">
          {detail.sessions.map((s) => {
            const t = sessionTotals(s);
            return (
              <article key={s.id} className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{s.name}</h3>
                  <span className="text-[13px] text-ink-3 tnum">
                    {[s.durationSeconds ? fmtMinutes(s.durationSeconds / 60) : null, `${t.sets} sets`].filter(Boolean).join(' · ')}
                  </span>
                </div>
                <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
                  {s.exercises.filter((e) => e.sets.some(isWorkingSet) || e.sets.some((x) => x.done)).map((e) => (
                    <li key={e.id} className="px-3.5 py-2.5">
                      <p className="text-[15px] font-medium text-ink">{e.name}</p>
                      <p className="mt-0.5 font-mono text-[12px] leading-5 text-ink-2 tnum">
                        {e.sets
                          .filter((x) => x.done)
                          .map((x) => `${x.kind === 'warmup' ? 'W ' : ''}${x.weight != null ? `${fmtNum(displayWeight(x.weight, s.weightUnit, unit))}${unit}` : 'BW'} × ${x.reps ?? '—'}`)
                          .join('  ·  ')}
                      </p>
                    </li>
                  ))}
                </ul>
                {s.note && <p className="whitespace-pre-line text-[14px] text-ink-2">{s.note}</p>}
                <div className="flex gap-2">
                  <Link href={`/gym/session/${s.id}`} className="pressable inline-flex h-10 flex-1 items-center justify-center rounded-[10px] bg-sunken px-3 text-sm font-medium text-ink hover:bg-line-strong">
                    Open
                  </Link>
                  <Link href={`/gym/workout?id=${s.id}&edit=1`} className="pressable inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[10px] border border-line-strong px-3 text-sm font-medium text-ink hover:bg-sunken">
                    <NotePencil size={15} /> Edit
                  </Link>
                </div>
              </article>
            );
          })}
          {detail.loggedOnly && <p className="text-[15px] text-ink-2">A workout was logged this day, without details.</p>}
          {detail.planned && !detail.sessions.length && (
            <div className="flex flex-col gap-3">
              <p className="label-mono">{detail.state === 'past' ? 'Planned — not logged' : 'Planned'}</p>
              <h3 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">{detail.planned.name}</h3>
              {detail.planned.exercises.length ? (
                <ul className="flex flex-col divide-y divide-line rounded-[14px] border border-line">
                  {detail.planned.exercises.map((e) => (
                    <li key={e.id} className="flex items-baseline justify-between gap-3 px-3.5 py-2.5">
                      <span className="text-[15px] text-ink">{e.name}</span>
                      <span className="shrink-0 font-mono text-[12px] text-ink-3">
                        {e.sets} × {e.repMin && e.repMax ? `${e.repMin}–${e.repMax}` : e.repMin ?? e.repMax ?? '—'}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-3">No exercises in this workout yet.</p>
              )}
            </div>
          )}
          {detail.state === 'today' && (
            <Button size="lg" block onClick={() => onStart(detail.planned?.dayId ?? null)}>
              <Play size={18} weight="fill" /> {detail.sessions.length ? 'Start another workout' : 'Start workout'}
            </Button>
          )}
          {detail.state === 'future' && <p className="text-[13px] text-ink-3">Workouts are logged on the day — the future can’t be filled in yet.</p>}
          {detail.state === 'past' && !detail.sessions.length && !detail.loggedOnly && !detail.planned && <p className="text-[15px] text-ink-3">No workout this day.</p>}
          {detail.state !== 'future' && (
            <Link href={`/journal/${detail.day}`} className="text-[13px] font-medium text-ink-3 hover:text-ink">
              Open this day’s journal →
            </Link>
          )}
        </div>
      )}
    </Sheet>
  );
}
