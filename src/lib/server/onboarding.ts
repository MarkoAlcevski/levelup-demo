import 'server-only';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { safeTimeZone } from '@/lib/engine/dates';
import { AREA_ICONS } from '@/lib/modules';
import type { Viewer } from './context';
import { createAreaTx } from './areas';
import { track } from './analytics';

/**
 * Thirty seconds, three steps: who you are → which tools you want → in.
 * Nothing is assumed: no default areas, routines, frequencies, goals or budgets. Gym, Learning and
 * Money set themselves up the first time they're opened; custom areas are created as named.
 */

export const onboardingInput = z.object({
  displayName: z.string().trim().max(60).default(''),
  timezone: z.string().max(64),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  modules: z.array(z.enum(['gym', 'learning', 'money'])).max(3),
  areas: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(40),
        icon: z.string().max(24).nullable().optional(),
        firstRoutine: z
          .object({
            title: z.string().trim().min(1).max(120),
            cadence: z.enum(['daily', 'weekly', 'days']),
            perWeek: z.number().int().min(1).max(7).nullable().optional(),
            weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
          })
          .nullable()
          .optional(),
      }),
    )
    .max(6),
});
export type OnboardingInput = z.input<typeof onboardingInput>;

export async function completeOnboarding(viewer: Viewer, raw: OnboardingInput) {
  const parsed = onboardingInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Something is missing.' };
  const v = parsed.data;
  if (!v.modules.length && !v.areas.length) return { ok: false as const, error: 'Pick at least one thing to use.' };
  await asUser(viewer.userId, async (q) => {
    await q.query(
      `update profiles set display_name = $2, timezone = $3, base_currency = $4, modules = $5, onboarded_at = now() where id = $1`,
      [viewer.userId, v.displayName, safeTimeZone(v.timezone), v.baseCurrency, [...new Set(v.modules)]],
    );
    for (const a of v.areas) {
      const icon = a.icon && (AREA_ICONS as readonly string[]).includes(a.icon) ? (a.icon as (typeof AREA_ICONS)[number]) : null;
      await createAreaTx(q, viewer, { name: a.name, icon, firstRoutine: a.firstRoutine ?? null });
    }
    await q.query(
      `insert into timeline_events (occurred_on, kind, title, detail, source_key) values ($1, 'start', 'Day 1', $2, 'start')
       on conflict do nothing`,
      [viewer.today, 'The first day on record.'],
    );
  });
  void track(viewer.userId, 'onboarding_completed', { modules: v.modules.length, areas: v.areas.length });
  return { ok: true as const };
}
