'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { BookOpenText, CheckCircle, Play, Stop } from '@phosphor-icons/react';
import type { LearningToday } from '@/lib/server/learning';
import { startLearningAction } from '@/lib/actions';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/primitives';
import { Meter } from '@/components/viz/marks';
import { useToast } from '@/components/ui/toast';
import { SessionSheet, fmtAmount } from '@/components/learning/session-sheet';

export function useTicker(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

/** Learning on Today: your subject, your target, how far along the week is — Start or Log. */
export function LearningCard({ subjects, today }: { subjects: LearningToday[]; today: string }) {
  const router = useRouter();
  const toast = useToast();
  const [sheet, setSheet] = useState<{ subjectId: string; finishing?: { id: string; startedAt: string } } | null>(null);
  const [pending, begin] = useTransition();
  const anyActive = subjects.some((s) => s.active);
  const now = useTicker(anyActive);

  return (
    <section aria-labelledby="learning-today-h">
      <h2 id="learning-today-h" className="label-mono mb-1 flex items-center gap-2">
        <BookOpenText size={13} /> Learning
      </h2>
      <ul className="flex flex-col divide-y divide-line">
        {subjects.map((s) => {
          const lite = { measure: s.measure, unit: s.unit === 'min' ? null : s.unit };
          const weekPct = s.week.target > 0 ? s.week.done / s.week.target : 0;
          return (
            <li key={s.id} className="py-3.5">
              <div className="flex items-baseline justify-between gap-3">
                <p className="flex min-w-0 items-center gap-2 truncate text-[17px] font-semibold tracking-[-0.01em] text-ink">
                  {s.status === 'done' && <CheckCircle size={16} weight="fill" className="shrink-0 text-accent-text" aria-label="Done today" />}
                  {s.name}
                </p>
                <p className="shrink-0 text-[13px] text-ink-3 tnum">
                  {fmtAmount(s.week.done, lite)} / {fmtAmount(s.week.target, lite)} <span className="text-ink-3">this week</span>
                </p>
              </div>
              <Meter className="mt-2" value={weekPct} label={`${Math.round(weekPct * 100)}% of this week’s target`} />
              <div className="mt-3 flex items-center gap-2">
                <p className={cn('min-w-0 flex-1 text-[13px]', s.status === 'required' ? 'text-ink-2' : 'text-ink-3')}>
                  {s.active
                    ? <span className="font-medium text-accent-text tnum">● {clock(now - Date.parse(s.active.startedAt))}</span>
                    : s.todayAmount > 0
                      ? `Today ${fmtAmount(s.todayAmount, lite)}${s.perDay ? ` of ${fmtAmount(s.perDay, lite)}` : ''}`
                      : s.status === 'rest'
                        ? 'Week target reached'
                        : `${fmtAmount(s.perDay, lite)} a session`}
                </p>
                {s.active ? (
                  <Button size="sm" onClick={() => setSheet({ subjectId: s.id, finishing: s.active! })}>
                    <Stop size={14} weight="fill" /> Finish
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={pending || anyActive}
                      onClick={() =>
                        begin(async () => {
                          const res = await startLearningAction(s.id);
                          if (!res.ok) toast.show({ title: res.error, tone: 'error' });
                          router.refresh();
                        })
                      }
                    >
                      <Play size={14} weight="fill" /> Start
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setSheet({ subjectId: s.id })}>
                      Log
                    </Button>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      <SessionSheet
        open={!!sheet}
        onClose={() => setSheet(null)}
        subjects={subjects.map((s) => ({ id: s.id, name: s.name, measure: s.measure, unit: s.measure === 'custom' ? s.unit : null }))}
        today={today}
        initialSubjectId={sheet?.subjectId}
        finishing={sheet?.finishing ?? null}
      />
    </section>
  );
}
