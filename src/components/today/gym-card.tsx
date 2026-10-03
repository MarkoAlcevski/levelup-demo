'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowRight, Barbell, CheckCircle, Play } from '@phosphor-icons/react';
import type { GymToday } from '@/lib/server/gym';
import { putCompletion } from '@/lib/client/api';
import { activeDraft, type WorkoutDraft } from '@/lib/client/workout';
import { weekdayName } from '@/lib/engine/dates';
import { fmtMinutes } from '@/lib/format';
import { Button } from '@/components/ui/primitives';
import { Pips } from '@/components/viz/marks';
import { useToast } from '@/components/ui/toast';
import { useViewerInfo } from '@/components/shell/viewer';
import { useStartWorkout } from '@/components/gym/start';

function ago(iso: string): string {
  const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.floor(m / 60)}h ${m % 60}m ago`;
}

/** Gym on Today looks like Gym: the next workout from YOUR program, and one button to start it. */
export function GymCard({ gym, today, missionId }: { gym: GymToday; today: string; missionId?: string | null }) {
  const v = useViewerInfo();
  const router = useRouter();
  const toast = useToast();
  const [pending, begin] = useTransition();
  const start = useStartWorkout({ start: gym.start, last: gym.last, today, unit: v.weightUnit, serverActiveId: gym.active?.id ?? null });
  const [local, setLocal] = useState<WorkoutDraft | null>(null);
  useEffect(() => setLocal(activeDraft()), []);
  const active = local ? { id: local.id, name: local.name, startedAt: local.startedAt, sets: local.exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).length, 0) } : gym.active ? { ...gym.active, sets: null } : null;
  const target = gym.week.target;

  const logWithoutDetails = () =>
    begin(async () => {
      if (!missionId) return;
      const res = await putCompletion({ missionId, day: today, outcome: 'full' });
      if (res.ok && !('queued' in res)) toast.show({ title: 'Workout logged', detail: res.xpGained ? `+${res.xpGained} points` : undefined, tone: 'accent' });
      else if (!res.ok) toast.show({ title: 'error' in res ? res.error : 'Couldn’t save.', tone: 'error' });
      router.refresh();
    });

  return (
    <section aria-labelledby="gym-today-h">
      <div className="mb-2 flex items-center gap-2">
        <h2 id="gym-today-h" className="label-mono flex items-center gap-2">
          <Barbell size={13} /> Gym
        </h2>
        {target != null && (
          <span className="ml-auto flex items-center gap-2 text-xs text-ink-3 tnum">
            {Math.min(gym.week.done, target)} / {target} this week
            <Pips done={Math.min(gym.week.done, target)} total={target} />
          </span>
        )}
      </div>

      <div className="rounded-[16px] border border-line-strong bg-surface p-4">
        {active ? (
          <>
            <p className="label-mono text-accent-text">Workout in progress</p>
            <p className="mt-1 text-[22px] font-semibold tracking-[-0.02em] text-ink">{active.name}</p>
            <p className="text-[13px] text-ink-3">
              Started {ago(active.startedAt)}
              {active.sets != null ? ` · ${active.sets} set${active.sets === 1 ? '' : 's'} logged` : ''}
            </p>
            <Button size="lg" block className="mt-4" onClick={() => router.push(`/gym/workout?id=${active.id}`)}>
              <Play size={18} weight="fill" /> Resume workout
            </Button>
          </>
        ) : gym.status === 'done' ? (
          <>
            <p className="label-mono flex items-center gap-1.5 text-accent-text">
              <CheckCircle size={14} weight="fill" /> Done today
            </p>
            <ul className="mt-2 flex flex-col gap-1">
              {gym.today.map((s) => (
                <li key={s.id}>
                  <Link href={`/gym/session/${s.id}`} className="flex min-h-11 items-center gap-3 hover:text-ink">
                    <span className="min-w-0 flex-1">
                      <span className="block text-[18px] font-semibold tracking-[-0.015em] text-ink">{s.name}</span>
                      <span className="block text-[13px] text-ink-3">
                        {[s.durationSeconds ? fmtMinutes(s.durationSeconds / 60) : null, `${s.sets} sets`, `${s.exercises} exercises`].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <ArrowRight size={16} className="text-ink-3" />
                  </Link>
                </li>
              ))}
              {gym.loggedOnly && <li className="text-[15px] text-ink-2">Logged without details.</li>}
            </ul>
          </>
        ) : gym.next ? (
          <>
            <p className="label-mono">{gym.status === 'planned' ? 'Today’s workout' : gym.status === 'rest' ? (gym.mode === 'scheduled' ? 'Rest day' : 'Week target hit') : 'Next workout'}</p>
            <p className="mt-1 text-[24px] font-semibold tracking-[-0.025em] text-ink">{gym.next.name}</p>
            <p className="text-[13px] text-ink-3">
              {gym.next.exercises} exercise{gym.next.exercises === 1 ? '' : 's'}
              {gym.status === 'rest' && gym.mode === 'scheduled' && !gym.next.isToday ? ` · planned ${weekdayName(gym.next.on, true)}` : ''}
              {gym.status === 'flexible' && target != null ? ` · ${Math.max(0, target - gym.week.done)} to go this week` : ''}
            </p>
            {gym.status === 'rest' ? (
              <Button variant="secondary" block className="mt-4" onClick={() => start(gym.next!.dayId)}>
                Train anyway
              </Button>
            ) : (
              <Button size="lg" block className="mt-4" onClick={() => start(gym.next!.dayId)}>
                <Play size={18} weight="fill" /> Start workout
              </Button>
            )}
            {gym.status !== 'rest' && missionId && (
              <button type="button" onClick={logWithoutDetails} disabled={pending} className="mt-2 inline-flex min-h-10 w-full items-center justify-center text-[13px] text-ink-3 hover:text-ink">
                Log without details
              </button>
            )}
          </>
        ) : (
          <Link href="/gym/program" className="flex min-h-12 items-center justify-between text-[15px] text-ink-2 hover:text-ink">
            Add workout days to your program <ArrowRight size={16} />
          </Link>
        )}
      </div>
    </section>
  );
}
