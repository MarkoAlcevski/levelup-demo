import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { loadSessionPage } from '@/lib/server/gym';
import { formatDay, weekdayName } from '@/lib/engine/dates';
import { displayWeight, exerciseKey, fmtNum } from '@/lib/engine/gym';
import { fmtMinutes } from '@/lib/format';
import { Page } from '@/components/page';
import { SessionActions } from '@/components/gym/session-actions';
import { EvidenceStrip } from '@/components/evidence/evidence-strip';

export const metadata: Metadata = { title: 'Workout' };

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  const { id } = await params;
  const d = await loadSessionPage(viewer, id);
  if (!d) notFound();
  const s = d.session;
  const unit = d.unit;
  const w = (x: number | null) => (x == null ? 'BW' : `${fmtNum(displayWeight(x, s.weightUnit, unit))} ${unit}`);
  const wKg = (kg: number | null) => (kg == null ? '' : `${fmtNum(unit === 'kg' ? Math.round(kg * 10) / 10 : Math.round((kg / 0.45359237) * 4) / 4)} ${unit}`);
  const vol = unit === 'kg' ? d.totals.volumeKg : d.totals.volumeKg / 0.45359237;
  return (
    <Page title={s.name} kicker={`${weekdayName(s.performedOn, true)}, ${formatDay(s.performedOn, viewer.today)}`} back={{ href: '/gym', label: 'Gym' }}>
      <dl className="grid grid-cols-4 gap-2">
        {[
          ['Time', s.durationSeconds ? fmtMinutes(s.durationSeconds / 60) : '—'],
          ['Exercises', String(d.totals.exercises)],
          ['Sets', String(d.totals.sets)],
          ['Volume', vol ? `${fmtNum(Math.round(vol))}` : '—'],
        ].map(([k, v]) => (
          <div key={k} className="min-w-0 rounded-[12px] bg-sunken px-2.5 py-2">
            <dt className="label-mono truncate">{k}</dt>
            <dd className="mt-0.5 truncate text-[18px] font-semibold text-ink tnum">{v}</dd>
          </div>
        ))}
      </dl>
      {s.status === 'active' && <p className="-mt-4 text-[13px] text-warn">This workout isn’t finished yet.</p>}
      {d.records.length > 0 && (
        <section aria-label="Records set" className="-mt-2 rounded-[14px] border border-accent/30 bg-accent-soft px-4 py-3">
          <p className="text-[15px] font-semibold text-ink">
            {d.records.length} personal record{d.records.length === 1 ? '' : 's'}
          </p>
          <ul className="mt-1 text-[14px] text-ink-2">
            {d.records.map((r) => (
              <li key={r.key + r.kind}>
                {r.kind === 'weight' ? `Heaviest ${r.name}: ${wKg(r.weightKg)} × ${r.reps}` : r.kind === 'reps' ? `${r.name}: ${r.reps} reps at ${wKg(r.weightKg)} (was ${r.previous})` : `Most volume in ${r.name}: ${wKg(r.value)}`}
              </li>
            ))}
          </ul>
        </section>
      )}
      <ol className="flex flex-col gap-3">
        {s.exercises.map((e) => {
          const sets = e.sets.filter((x) => x.done);
          let n = 0;
          return (
            <li key={e.id} className="rounded-[16px] border border-line bg-surface px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 className="text-[16px] font-semibold text-ink">
                  <Link href={`/gym/exercises/${encodeURIComponent(exerciseKey(e))}`} className="hover:underline">
                    {e.name}
                  </Link>
                </h2>
                {!sets.length && <span className="text-[12px] text-ink-3">skipped</span>}
              </div>
              {e.replacedName && <p className="text-[12px] text-ink-3">instead of {e.replacedName}</p>}
              {sets.length > 0 && (
                <ol className="mt-2 grid grid-cols-[4.5rem_1fr] gap-y-1 font-mono text-[14px] tnum">
                  {sets.map((x) => (
                    <li key={x.id} className="contents">
                      <span className="text-ink-3">{x.kind === 'warmup' ? 'Warm-up' : `Set ${++n}`}</span>
                      <span className={x.kind === 'warmup' ? 'text-ink-3' : 'text-ink'}>
                        {w(x.weight)} × {x.reps ?? '—'}
                      </span>
                    </li>
                  ))}
                </ol>
              )}
              {e.note && <p className="mt-2 text-[13px] text-ink-3">{e.note}</p>}
            </li>
          );
        })}
      </ol>
      {s.note && (
        <section aria-label="Note">
          <p className="label-mono mb-1">Note</p>
          <p className="whitespace-pre-line text-[15px] text-ink-2">{s.note}</p>
        </section>
      )}
      {d.proofs.length > 0 && <EvidenceStrip proofs={d.proofs} total={d.proofs.length} />}
      {s.editedAt && <p className="-mt-4 text-[12px] text-ink-3">Corrected on {formatDay(s.editedAt.slice(0, 10), viewer.today)}.</p>}
      <SessionActions id={s.id} day={s.performedOn} />
    </Page>
  );
}
