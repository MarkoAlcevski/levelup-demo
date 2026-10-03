import type { Metadata } from 'next';
import Link from 'next/link';
import { CaretRight } from '@phosphor-icons/react/dist/ssr';
import { getViewer } from '@/lib/server/context';
import { ensureWeeklyReviews, listReviews } from '@/lib/server/reviews';
import { addMonths, formatRange, monthName, startOfMonth } from '@/lib/engine/dates';
import { fmtPct } from '@/lib/format';
import { Page, Section } from '@/components/page';
import { ProgressSubnav } from '@/components/progress/subnav';
import { Delta } from '@/components/viz/marks';

export const metadata: Metadata = { title: 'Reports' };

/** Weekly and 30-day reports, plus the monthly money reports when Money is on. */
export default async function ReportsPage() {
  const viewer = await getViewer();
  await ensureWeeklyReviews(viewer);
  const reviews = await listReviews(viewer, 40);
  const money = viewer.profile.modules.includes('money');
  const thisMonth = startOfMonth(viewer.today);
  const months = [0, -1, -2].map((k) => addMonths(thisMonth, k));
  return (
    <Page title="Reports" subnav={<ProgressSubnav />}>
      <p className="-mt-2 text-[15px] text-ink-3">A weekly report lands every Monday, a longer one every 30 days. Every number in them comes from what you logged.</p>
      {reviews.length ? (
        <ul className="divide-y divide-line">
          {reviews.map((r) => (
            <li key={r.id}>
              <Link href={`/review/${r.id}`} className="flex min-h-16 items-center gap-4 py-3 hover:bg-sunken/40">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[15px] font-medium text-ink">
                    {r.kind === 'week' ? 'Week' : '30 days'} · {formatRange(r.start, r.end)}
                    {!r.viewed && <span className="rounded-full bg-accent px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.04em] text-accent-ink">New</span>}
                  </p>
                  <p className="text-[13px] text-ink-3">
                    {r.kept} of {r.planned} done
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[17px] font-semibold text-ink tnum">{fmtPct(r.execution)}</p>
                  <Delta value={r.execution != null && r.prevExecution != null ? (r.execution - r.prevExecution) * 100 : null} kind="pp" />
                </div>
                <CaretRight size={16} className="text-ink-3" />
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-[16px] border border-dashed border-line-strong px-6 py-10 text-center">
          <p className="text-lg font-semibold text-ink">Your first report arrives after your first full week</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-3">Keep checking things off — on Monday you’ll get the numbers, the patterns, and one thing to change.</p>
        </div>
      )}
      {money && (
        <Section title="Money reports">
          <ul className="divide-y divide-line">
            {months.map((m) => (
              <li key={m}>
                <Link href={`/money/report/${m.slice(0, 7)}`} className="flex min-h-13 items-center justify-between gap-3 py-2 text-[15px] text-ink hover:text-ink">
                  {monthName(m, true)} {m.slice(0, 4)}
                  <span className="flex items-center gap-2 text-[13px] text-ink-3">
                    {m === thisMonth ? 'so far' : ''} <CaretRight size={16} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
