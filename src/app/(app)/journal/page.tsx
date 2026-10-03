import type { Metadata } from 'next';
import Link from 'next/link';
import { CaretLeft, CaretRight, PencilSimpleLine } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { loadJournalYear } from '@/lib/server/journal';
import { addDays, daysInMonth, formatDay, jsWeekday, monthName, weekdayLabel, weekdayName, type ISODate } from '@/lib/engine/dates';
import { cn } from '@/lib/cn';
import { Page, Section } from '@/components/page';
import { ProgressSubnav } from '@/components/progress/subnav';

export const metadata: Metadata = { title: 'Journal' };

const pad = (n: number) => String(n).padStart(2, '0');

function monthCells(first: ISODate, weekStartsOn: number): (ISODate | null)[] {
  const lead = (jsWeekday(first) - weekStartsOn + 7) % 7;
  return [...Array<null>(lead).fill(null), ...Array.from({ length: daysInMonth(first) }, (_, i) => addDays(first, i))];
}

/** Every day of every year has a page. The year at a glance, one month up close, the latest pages. */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ y?: string; m?: string }> }) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const today = viewer.today;
  const thisYear = Number(today.slice(0, 4));
  const year = /^\d{4}$/.test(sp.y ?? '') ? Math.min(2100, Math.max(1970, Number(sp.y))) : thisYear;
  const month = /^\d{1,2}$/.test(sp.m ?? '') ? Math.min(12, Math.max(1, Number(sp.m))) : year === thisYear ? Number(today.slice(5, 7)) : 1;
  const data = await loadJournalYear(viewer, year);
  const ws = viewer.profile.weekStartsOn;
  const active = new Set(data.active);
  const heads = Array.from({ length: 7 }, (_, i) => weekdayLabel((ws + i) % 7).slice(0, 1));
  const first = `${year}-${pad(month)}-01`;
  const todayEntry = year === thisYear ? data.entries[today] : undefined;
  const monthCount = Object.keys(data.entries).filter((d) => d.startsWith(`${year}-${pad(month)}`)).length;
  const href = (y: number, m: number) => `/journal?y=${y}&m=${m}`;
  const prevMonth = month === 1 ? href(year - 1, 12) : href(year, month - 1);
  const nextMonth = month === 12 ? href(year + 1, 1) : href(year, month + 1);

  return (
    <Page
      title="Journal"
      subnav={<ProgressSubnav />}
      actions={
        <nav aria-label="Year" className="flex items-center">
          <Link href={href(year - 1, 12)} aria-label={`${year - 1}`} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink">
            <CaretLeft size={16} />
          </Link>
          <span className="w-12 text-center text-[15px] font-semibold text-ink tnum">{year}</span>
          <Link href={href(year + 1, 1)} aria-label={`${year + 1}`} className="pressable grid size-10 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink">
            <CaretRight size={16} />
          </Link>
        </nav>
      }
    >
      <Link href={`/journal/${today}`} className="pressable group block rounded-[18px] border border-line-strong bg-raised px-4 py-4 hover:border-ink-3/60">
        <span className="flex items-center justify-between gap-3">
          <span className="label-mono">Today · {weekdayName(today, true)} {formatDay(today)}</span>
          <PencilSimpleLine size={18} className="text-accent-text" aria-hidden />
        </span>
        {todayEntry?.preview ? (
          <span className="mt-2 line-clamp-3 block text-[16px] leading-6 text-ink">{todayEntry.preview}</span>
        ) : (
          <span className="mt-2 block text-[18px] font-semibold tracking-[-0.02em] text-ink">What did you do today — and what’s next?</span>
        )}
        <span className="mt-2 block text-[14px] font-medium text-accent-text">{todayEntry ? 'Keep writing →' : 'Write today’s page →'}</span>
      </Link>

      <dl className="grid grid-cols-3 gap-4">
        {[
          [`Pages in ${year}`, data.count],
          ['Writing streak', `${data.streak} day${data.streak === 1 ? '' : 's'}`],
          ['This month', monthCount],
        ].map(([k, v]) => (
          <div key={k as string}>
            <dt className="label-mono">{k}</dt>
            <dd className="mt-1 text-[24px] font-semibold tracking-[-0.03em] text-ink tnum">{v}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="month-h">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 id="month-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
            {monthName(first, true)} {year}
          </h2>
          <div className="flex items-center">
            <Link href={prevMonth} aria-label="Previous month" className="pressable grid size-11 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink">
              <CaretLeft size={18} />
            </Link>
            <Link href={nextMonth} aria-label="Next month" className="pressable grid size-11 place-items-center rounded-full text-ink-3 hover:bg-sunken hover:text-ink">
              <CaretRight size={18} />
            </Link>
          </div>
        </div>
        <div className="grid grid-cols-7 gap-1" role="group" aria-label={`${monthName(first, true)} ${year}`}>
          {heads.map((h, i) => (
            <span key={i} className="pb-1 text-center font-mono text-[11px] uppercase text-ink-3" aria-hidden>
              {h}
            </span>
          ))}
          {monthCells(first, ws).map((d, i) => {
            if (!d) return <span key={`x${i}`} aria-hidden />;
            const e = data.entries[d];
            const isToday = d === today;
            const future = d > today;
            const label = `${weekdayName(d, true)} ${formatDay(d)}${e ? ' — written' : active.has(d) ? ' — activity, no page yet' : ''}${isToday ? ' (today)' : ''}`;
            return (
              <Link
                key={d}
                href={`/journal/${d}`}
                aria-label={label}
                className={cn(
                  'pressable relative flex aspect-square min-h-11 flex-col items-center justify-center rounded-[10px] text-[15px] tnum transition-colors',
                  e ? (future ? 'border border-dashed border-accent-text/60 text-ink' : 'bg-accent-soft font-semibold text-ink hover:brightness-110') : future ? 'text-ink-3 hover:bg-sunken' : 'text-ink-2 hover:bg-sunken',
                  isToday && 'ring-2 ring-accent ring-offset-2 ring-offset-surface',
                )}
              >
                {Number(d.slice(8, 10))}
                {e ? (
                  <span className="absolute bottom-1.5 h-[3px] w-3 rounded-full bg-accent-text" aria-hidden />
                ) : active.has(d) ? (
                  <span className="absolute bottom-1.5 size-1 rounded-full bg-ink-3" aria-hidden />
                ) : null}
              </Link>
            );
          })}
        </div>
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-[3px] w-3 rounded-full bg-accent-text" /> written
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-1 rounded-full bg-ink-3" /> did things, no page yet
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[3px] border border-dashed border-accent-text/60" /> planned ahead
          </span>
        </p>
      </section>

      <Section title={`${year} at a glance`} aside={`${data.count} page${data.count === 1 ? '' : 's'}`}>
        <ol className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {Array.from({ length: 12 }, (_, i) => {
            const f = `${year}-${pad(i + 1)}-01`;
            const n = Object.keys(data.entries).filter((d) => d.startsWith(f.slice(0, 7))).length;
            const on = i + 1 === month;
            return (
              <li key={f}>
                <Link
                  href={href(year, i + 1)}
                  aria-current={on ? 'true' : undefined}
                  aria-label={`${monthName(f, true)}: ${n} page${n === 1 ? '' : 's'}`}
                  className={cn('pressable block rounded-[14px] border px-3 py-2.5', on ? 'border-accent-text/50 bg-sunken/60' : 'border-line hover:border-line-strong')}
                >
                  <span className="flex items-baseline justify-between">
                    <span className="text-[13px] font-medium text-ink">{monthName(f)}</span>
                    <span className="font-mono text-[11px] text-ink-3 tnum">{n || ''}</span>
                  </span>
                  <span className="mt-2 grid grid-cols-7 gap-[3px]" aria-hidden>
                    {monthCells(f, ws).map((d, j) =>
                      d ? (
                        <span
                          key={d}
                          className={cn(
                            'aspect-square rounded-[2px]',
                            data.entries[d] ? 'bg-accent' : active.has(d) ? 'bg-ink-3/35' : 'bg-sunken',
                            d === today && 'outline outline-1 outline-offset-1 outline-ink-2',
                          )}
                        />
                      ) : (
                        <span key={`x${j}`} />
                      ),
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ol>
      </Section>

      {data.recent.length > 0 && (
        <Section title="Latest pages">
          <ul className="divide-y divide-line">
            {data.recent.map((r) => (
              <li key={r.day}>
                <Link href={`/journal/${r.day}`} className="group flex min-h-14 flex-col justify-center gap-0.5 py-2.5">
                  <span className="label-mono">
                    {weekdayName(r.day)} {formatDay(r.day, today)}
                  </span>
                  <span className="line-clamp-2 text-[15px] leading-6 text-ink-2 group-hover:text-ink">{r.preview || 'Plans only'}</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
