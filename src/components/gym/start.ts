'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { LastPerformance, StartDay } from '@/lib/server/gym';
import { activeDraft, draftFromTemplate, emptyDraft, saveDraft } from '@/lib/client/workout';

/**
 * Start a workout from anywhere (Today, Gym, the calendar, quick add). The workout is created on
 * the phone from the program already on screen, so starting works even with no signal.
 * An unfinished workout is always resumed rather than silently replaced.
 */
export function useStartWorkout(opts: { start: StartDay[]; last: Record<string, LastPerformance>; today: string; unit: 'kg' | 'lb'; serverActiveId?: string | null }) {
  const router = useRouter();
  const { start, last, today, unit, serverActiveId } = opts;
  return useCallback(
    (dayId: string | null, name?: string) => {
      const existing = activeDraft();
      if (existing) {
        router.push(`/gym/workout?id=${existing.id}`);
        return;
      }
      if (serverActiveId) {
        router.push(`/gym/workout?id=${serverActiveId}`);
        return;
      }
      const day = dayId ? start.find((d) => d.id === dayId) : null;
      const draft = day ? draftFromTemplate(day, last, today, unit) : emptyDraft(name || 'Workout', today, unit);
      saveDraft(draft);
      router.push(`/gym/workout?id=${draft.id}`);
    },
    [router, start, last, today, unit, serverActiveId],
  );
}
