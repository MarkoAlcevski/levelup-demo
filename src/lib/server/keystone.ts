import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { BONUS_XP } from '@/lib/engine/xp';
import type { Viewer } from './context';
import { upsertXp } from './completions';
import { track } from './analytics';

/**
 * The Keystone: one thing per week that makes the week a win. It sits above everything on
 * Today, and finishing it is the one full-screen celebration of the week.
 */

export interface Keystone {
  id: string;
  weekStart: ISODate;
  title: string;
  missionId: string | null;
  status: 'open' | 'done' | 'missed';
  doneAt: Date | null;
}

export async function readKeystone(q: Queryable, weekStart: ISODate): Promise<Keystone | null> {
  const [r] = await q.query<{ id: string; week_start: string; title: string; mission_id: string | null; status: Keystone['status']; done_at: Date | null }>(
    `select id, week_start, title, mission_id, status, done_at from keystones where week_start = $1`,
    [weekStart],
  );
  return r ? { id: r.id, weekStart: r.week_start, title: r.title, missionId: r.mission_id, status: r.status, doneAt: r.done_at } : null;
}

const keystoneInput = z.object({
  title: z.string().trim().min(1, 'Name the one thing.').max(140),
  missionId: z.uuid().nullable().optional(),
  week: z.enum(['current', 'next']).default('current'),
});

export async function setKeystone(viewer: Viewer, raw: z.input<typeof keystoneInput>) {
  const parsed = keystoneInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid keystone.' };
  const v = parsed.data;
  const ws = startOfWeek(viewer.today, viewer.profile.weekStartsOn);
  const weekStart = v.week === 'next' ? addDays(ws, 7) : ws;
  await asUser(viewer.userId, (q) =>
    q.query(
      `insert into keystones (week_start, title, mission_id) values ($1, $2, $3)
       on conflict (user_id, week_start) do update set title = excluded.title, mission_id = excluded.mission_id`,
      [weekStart, v.title, v.missionId ?? null],
    ),
  );
  void track(viewer.userId, 'keystone_set', { week: v.week, linked: !!v.missionId });
  return { ok: true as const };
}

export async function setKeystoneStatus(viewer: Viewer, id: string, done: boolean) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid weekly focus.' };
  const res = await asUser(viewer.userId, async (q) => {
    const [k] = await q.query<{ id: string; week_start: string; title: string }>(
      `update keystones set status = $2, done_at = case when $2 = 'done' then now() else null end
        where id = $1 returning id, week_start, title`,
      [id, done ? 'done' : 'open'],
    );
    if (!k) return null;
    if (done) {
      await upsertXp(q, 'keystone', k.id, null, BONUS_XP.keystone, viewer.today);
      await q.query(
        `insert into timeline_events (occurred_on, kind, title, source_key) values ($1, 'keystone', $2, $3)
         on conflict (user_id, kind, source_key) do update set occurred_on = excluded.occurred_on, title = excluded.title`,
        [viewer.today, k.title, k.id],
      );
    } else {
      await q.query(`delete from xp_events where source = 'keystone' and source_key = $1`, [k.id]);
      await q.query(`delete from timeline_events where kind = 'keystone' and source_key = $1`, [k.id]);
    }
    return k;
  });
  if (!res) return { ok: false as const, error: 'Weekly focus not found.' };
  if (done) void track(viewer.userId, 'keystone_completed', {});
  return { ok: true as const, xp: done ? BONUS_XP.keystone : 0 };
}
