import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CaretLeft, CaretRight } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { loadJournalDay } from '@/lib/server/journal';
import { addDays, diffDays, formatDay, monthName, weekdayName } from '@/lib/engine/dates';
import { Page } from '@/components/page';
import { JournalEditor } from '@/components/journal/journal-editor';

export const metadata: Metadata = { title: 'Journal' };

function relative(day: string, today: string): string {
  const d = diffDays(today, day);
  if (d === 0) return 'Today';
  if (d === -1) return 'Yesterday';
  if (d === 1) return 'Tomorrow';
  return d < 0 ? `${-d} days ago` : `In ${d} days`;
}

/** One page per day, any day of any year. */
export default async function JournalDayPage({ params }: { params: Promise<{ day: string }> }) {
  const viewer = await getViewer();
  const { day } = await params;
  const data = await loadJournalDay(viewer, day);
  if (!data) notFound();
  const today = data.today;
  const prev = addDays(day, -1);
  const next = addDays(day, 1);
  const title = `${weekdayName(day, true)}, ${Number(day.slice(8, 10))} ${monthName(day, true)}`;
  const navLink = 'pressable inline-flex min-h-11 items-center gap-1 rounded-[10px] px-2 text-[14px] text-ink-3 hover:bg-sunken hover:text-ink';
  return (
    <Page
      title={title}
      kicker={`Journal · ${day.slice(0, 4)} · ${relative(day, today)}`}
      back={{ href: `/journal?y=${day.slice(0, 4)}&m=${Number(day.slice(5, 7))}`, label: 'Journal' }}
    >
      <nav aria-label="Days" className="-mt-4 -mx-2 flex items-center justify-between">
        <Link href={`/journal/${prev}`} className={navLink} aria-label={`Previous day, ${formatDay(prev, today)}`}>
          <CaretLeft size={14} /> {weekdayName(prev)} {Number(prev.slice(8, 10))}
        </Link>
        {day !== today && (
          <Link href={`/journal/${today}`} className={navLink}>
            Today
          </Link>
        )}
        <Link href={`/journal/${next}`} className={navLink} aria-label={`Next day, ${formatDay(next, today)}`}>
          {weekdayName(next)} {Number(next.slice(8, 10))} <CaretRight size={14} />
        </Link>
      </nav>
      <JournalEditor key={day} day={day} today={today} entry={data.entry} facts={data.facts} carried={data.carried} />
    </Page>
  );
}
