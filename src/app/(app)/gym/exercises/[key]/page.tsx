import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { loadExerciseDetail } from '@/lib/server/gym';
import { formatDay } from '@/lib/engine/dates';
import { displayWeight, fmtNum } from '@/lib/engine/gym';
import { Page, Section } from '@/components/page';
import { Line } from '@/components/viz/bars';

export const metadata: Metadata = { title: 'Exercise' };

export default async function ExercisePage({ params }: { params: Promise<{ key: string }> }) {
  const viewer = await getViewer();
  const { key } = await params;
  const d = await loadExerciseDetail(viewer, decodeURIComponent(key));
  if (!d.name) notFound();
  const unit = viewer.profile.weightUnit;
  const conv = (kg: number) => (unit === 'kg' ? Math.round(kg * 10) / 10 : Math.round((kg / 0.45359237) * 4) / 4);
  const chron = [...d.points].reverse();
  const label = (on: string) => `${Number(on.slice(8))}/${Number(on.slice(5, 7))}`;
  return (
    <Page title={d.name} kicker="Exercise history" back={{ href: '/gym/stats', label: 'Stats' }}>
      {d.points.length === 0 ? (
        <p className="text-sm text-ink-3">No finished sets for this exercise yet.</p>
      ) : (
        <>
          <Section title="Heaviest set" aside={unit}>
            <Line label={`Heaviest working set per session, ${unit}`} format={(n) => `${fmtNum(n)} ${unit}`} points={chron.map((p) => ({ label: label(p.on), value: conv(p.topWeightKg) }))} />
          </Section>
          <div className="grid gap-6 sm:grid-cols-2">
            <Section title="Best reps" aside="per session">
              <Line label="Most reps in a set, per session" points={chron.map((p) => ({ label: label(p.on), value: p.bestReps }))} />
            </Section>
            <Section title="Volume" aside={`${unit} × reps`}>
              <Line label={`Volume per session, ${unit}`} format={(n) => fmtNum(Math.round(n))} points={chron.map((p) => ({ label: label(p.on), value: conv(p.volumeKg) }))} />
            </Section>
          </div>
          {d.records.length > 0 && (
            <Section title="Records">
              <ul className="divide-y divide-line">
                {d.records.map((r, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 py-2 text-[15px]">
                    <span className="text-ink-2">{r.kind === 'weight' ? 'Heaviest set' : r.kind === 'reps' ? `Reps at ${fmtNum(conv(r.weightKg ?? 0))} ${unit}` : 'Session volume'}</span>
                    <span className="text-right">
                      <span className="block font-semibold text-ink tnum">{r.kind === 'reps' ? `${r.reps} reps` : `${fmtNum(conv(r.value))} ${unit}`}</span>
                      <span className="block font-mono text-[11px] text-ink-3">{formatDay(r.on, viewer.today)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Every session">
            <ol className="divide-y divide-line">
              {d.points.map((p) => (
                <li key={p.sessionId}>
                  <Link href={`/gym/session/${p.sessionId}`} className="flex min-h-12 items-baseline gap-3 py-2.5">
                    <span className="w-14 shrink-0 font-mono text-[11px] uppercase text-ink-3">{formatDay(p.on, viewer.today)}</span>
                    <span className="min-w-0 flex-1 font-mono text-[14px] leading-6 text-ink tnum">
                      {p.sets.map((s) => `${s.weight != null ? fmtNum(displayWeight(s.weight, p.unit, unit)) : 'BW'}×${s.reps ?? '—'}`).join('  ')}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </Section>
        </>
      )}
    </Page>
  );
}
