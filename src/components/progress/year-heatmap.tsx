'use client';

import { useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';
import { formatDay, isoWeekday, monthName, weekdayName } from '@/lib/engine/dates';
import type { HeatCell } from '@/lib/server/progress';
import { Sheet } from '@/components/ui/sheet';
import { DayDetailView } from './day-detail';

const FILL = [
  'var(--heat-0)',
  'color-mix(in oklch, var(--accent) 24%, var(--surface-1))',
  'color-mix(in oklch, var(--accent) 46%, var(--surface-1))',
  'color-mix(in oklch, var(--accent) 72%, var(--surface-1))',
  'var(--accent)',
  'var(--accent)',
];

function describe(c: HeatCell) {
  if (c.future) return `${formatDay(c.day)}: upcoming`;
  if (c.due === 0) return `${formatDay(c.day)}: nothing due${c.excused ? `, ${c.excused} excused` : ''}`;
  return `${weekdayName(c.day)} ${formatDay(c.day)}: ${c.kept} of ${c.due} kept${c.level === 5 ? ', perfect day' : ''}`;
}

/**
 * The year, zoomed out: twelve small calendars. Colour intensity = that day's execution
 * (one hue, light → dark); a centre dot marks a perfect day. Click a day for the full detail;
 * on touch screens a month opens large first, because 14 px cells aren't honest tap targets.
 */
export function YearHeatmap({ cells, today }: { cells: HeatCell[]; today: string }) {
  const [day, setDay] = useState<string | null>(null);
  const [month, setMonth] = useState<number | null>(null);
  const pointer = useRef<string | null>(null);
  const months = useMemo(() => {
    const out: HeatCell[][] = Array.from({ length: 12 }, () => []);
    for (const c of cells) out[Number(c.day.slice(5, 7)) - 1].push(c);
    return out;
  }, [cells]);

  const stats = useMemo(() => {
    const past = cells.filter((c) => !c.future);
    return {
      active: past.filter((c) => c.kept > 0).length,
      perfect: past.filter((c) => c.level === 5).length,
      kept: past.reduce((s, c) => s + c.kept, 0),
    };
  }, [cells]);

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm">
        <span className="text-ink">
          <span className="font-semibold">{stats.kept.toLocaleString('en-US')}</span> <span className="text-ink-3">kept</span>
        </span>
        <span className="text-ink">
          <span className="font-semibold">{stats.active}</span> <span className="text-ink-3">active days</span>
        </span>
        <span className="text-ink">
          <span className="font-semibold">{stats.perfect}</span> <span className="text-ink-3">perfect days</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-x-4 gap-y-5 sm:grid-cols-4 lg:grid-cols-6">
        {months.map((days, mi) => {
          if (!days.length) return null;
          const lead = isoWeekday(days[0].day) - 1;
          const isFuture = days[0].future;
          const past = days.filter((c) => !c.future);
          const active = past.filter((c) => c.kept > 0).length;
          const name = monthName(days[0].day, true);
          // One real target per month (keyboard + touch → large month view). With a mouse,
          // a click on a single day opens that day directly.
          return (
            <button
              key={mi}
              type="button"
              disabled={isFuture}
              onPointerDown={(e) => {
                pointer.current = e.pointerType;
              }}
              onClick={(e) => {
                const d = (e.target as HTMLElement).closest<HTMLElement>('[data-day]')?.dataset.day;
                const mouse = pointer.current === 'mouse';
                pointer.current = null; // keyboard activation has no pointerdown
                if (d && mouse) setDay(d);
                else setMonth(mi);
              }}
              aria-label={isFuture ? `${name}: upcoming` : `${name}: ${active} active ${active === 1 ? 'day' : 'days'} — open month`}
              className="pressable -m-1 flex flex-col self-start rounded-[10px] p-1 text-left hover:bg-sunken/60 disabled:cursor-default disabled:opacity-50"
            >
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">{monthName(days[0].day)}</span>
              <span className="grid grid-cols-7 gap-[3px]" aria-hidden>
                {Array.from({ length: lead }, (_, i) => (
                  <span key={`l${i}`} />
                ))}
                {days.map((c) => (
                  <span
                    key={c.day}
                    data-day={c.future ? undefined : c.day}
                    title={describe(c)}
                    className={cn(
                      'relative aspect-square w-full rounded-[3px] transition-transform duration-150',
                      !c.future && '[@media(pointer:fine)]:hover:scale-125',
                      c.day === today && 'ring-1 ring-ink-2 ring-offset-1 ring-offset-bg',
                      c.due === 0 && c.excused > 0 && 'outline-1 -outline-offset-1 outline-dashed outline-ink-3/50',
                    )}
                    style={{ background: c.future ? 'transparent' : FILL[c.level], boxShadow: c.future ? 'inset 0 0 0 1px var(--line)' : undefined }}
                  >
                    {c.level === 5 && <span className="absolute inset-0 m-auto size-[28%] rounded-full bg-accent-ink/70" />}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-ink-3">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((l) => (
          <span key={l} className="size-3 rounded-[3px]" style={{ background: FILL[l] }} />
        ))}
        <span>More</span>
        <span className="ml-2 flex items-center gap-1.5">
          <span className="relative size-3 rounded-[3px] bg-accent">
            <span className="absolute inset-0 m-auto size-1 rounded-full bg-accent-ink/70" />
          </span>
          Perfect day
        </span>
      </div>

      <Sheet open={month != null} onClose={() => setMonth(null)} title={month != null ? monthName(months[month][0].day, true) : ''} size="md">
        {month != null && (
          <div className="grid grid-cols-7 gap-1.5 pt-1">
            {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => (
              <span key={i} className="text-center font-mono text-[10px] text-ink-3">
                {d}
              </span>
            ))}
            {Array.from({ length: isoWeekday(months[month][0].day) - 1 }, (_, i) => (
              <span key={`b${i}`} />
            ))}
            {months[month].map((c) => (
              <button
                key={c.day}
                type="button"
                disabled={c.future}
                onClick={() => {
                  setMonth(null);
                  setDay(c.day);
                }}
                aria-label={describe(c)}
                className={cn(
                  'pressable relative flex aspect-square flex-col items-center justify-center rounded-[10px] text-sm font-medium disabled:opacity-40',
                  c.level >= 4 ? 'text-accent-ink' : 'text-ink',
                  c.day === today && 'ring-2 ring-ink-2',
                )}
                style={{ background: c.future ? 'transparent' : FILL[c.level], boxShadow: c.future ? 'inset 0 0 0 1px var(--line)' : undefined }}
              >
                {Number(c.day.slice(8))}
                {c.due > 0 && <span className="text-[10px] font-normal opacity-75 tnum">{c.kept}/{c.due}</span>}
              </button>
            ))}
          </div>
        )}
      </Sheet>
      <DaySheet day={day} onClose={() => setDay(null)} />
    </div>
  );
}

export function DaySheet({ day, onClose }: { day: string | null; onClose: () => void }) {
  return (
    <Sheet open={!!day} onClose={onClose} title={day ? `${weekdayName(day, true)}, ${formatDay(day)}` : ''} size="md">
      {day && <DayDetailView day={day} />}
    </Sheet>
  );
}
