import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, diffDays, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { evaluate, isPerfectDay } from '@/lib/engine/metrics';
import { creditFor, defaultValueFor, isKept, outcomeForValue } from '@/lib/engine/outcome';
import { byDay, evaluateMissionDay } from '@/lib/engine/schedule';
import { BONUS_XP, completionXp, levelFromXp, weeklyQuotaXp } from '@/lib/engine/xp';
import type { Outcome } from '@/lib/engine/types';
import { loadCompletions, loadMissions, totalXp } from './load';
import type { Viewer } from './context';
import { track } from './analytics';
import { removeFilesForCompletion } from './files';
import { afterCompletionChange } from './group-activity';

export const completionInput = z.object({
  missionId: z.uuid(),
  day: z.iso.date(),
  outcome: z.enum(['exceeded', 'full', 'minimum', 'partial', 'missed', 'skipped']).optional(),
  value: z.number().min(0).max(1_000_000).nullable().optional(),
  reason: z
    .enum(['no_time', 'forgot', 'low_energy', 'unexpected', 'procrastinated', 'too_hard', 'not_important', 'rest', 'sick', 'travel', 'other'])
    .nullable()
    .optional(),
  note: z.string().max(2000).nullable().optional(),
  source: z.enum(['app', 'offline', 'quick_add', 'command', 'review', 'workout', 'learning']).default('app'),
  /** client wall-clock for offline replays, so time-of-day stays truthful */
  loggedAt: z.iso.datetime({ offset: true }).optional(),
});
export type CompletionInput = z.input<typeof completionInput>;

export interface CompletionResult {
  ok: true;
  missionId: string;
  day: ISODate;
  outcome: Outcome;
  kept: boolean;
  credit: number;
  value: number | null;
  xpGained: number;
  xpTotal: number;
  levelBefore: number;
  levelAfter: number;
  quotaMet: boolean;
  perfectDay: boolean;
  completionId: string;
}

export type ActionError = { ok: false; error: string };

export const MAX_BACKFILL_DAYS = 14;

/**
 * Upsert today's (or a recent day's) completion for a mission, then recompute the XP facts it
 * touches — the completion award, that week's quota bonus, that day's perfect-day bonus — in the
 * same transaction. Idempotent: replaying the same request converges on the same state.
 */
export async function upsertCompletion(viewer: Viewer, raw: CompletionInput): Promise<CompletionResult | ActionError> {
  const parsed = completionInput.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'Invalid completion.' };
  const input = parsed.data;
  const age = diffDays(input.day, viewer.today);
  if (age < 0) return { ok: false, error: "You can't complete something in the future." };
  if (age > MAX_BACKFILL_DAYS) return { ok: false, error: `Only the last ${MAX_BACKFILL_DAYS} days can be edited.` };

  const res = await asUser(viewer.userId, (q) => upsertCompletionTx(q, viewer, input));
  if (res.ok) {
    void track(viewer.userId, res.kept ? 'mission_completed' : 'mission_logged', {
      outcome: res.outcome, source: input.source, backfill: input.day !== viewer.today,
    });
    void afterCompletionChange(viewer, res.missionId, res.day);
  }
  return res;
}

/** The same upsert inside a caller's transaction (finishing a workout, logging a learning session). */
export async function upsertCompletionTx(
  q: Queryable,
  viewer: Viewer,
  input: z.output<typeof completionInput>,
): Promise<CompletionResult | ActionError> {
  const [mission] = await loadMissions(q, { ids: [input.missionId], includeArchived: true });
  if (!mission) return { ok: false, error: 'Not found.' } as ActionError;

  // Measured missions: the value decides the outcome. One-tap (no value) assumes the chosen
  // outcome's natural value — the target for Full, the minimum for Minimum.
  let outcome: Outcome;
  let value: number | null = input.value ?? null;
  if (input.outcome === 'missed' || input.outcome === 'skipped') {
    outcome = input.outcome;
    value = null;
  } else if (mission.measure !== 'check') {
    if (value == null) {
      const wanted = input.outcome ?? 'full';
      value =
        wanted === 'exceeded' && mission.targetValue
          ? Math.ceil(mission.targetValue * mission.exceedRatio)
          : defaultValueFor(mission, wanted);
    }
    outcome = value == null ? 'partial' : outcomeForValue(mission, value);
  } else {
    outcome = input.outcome ?? 'full';
    if (outcome === 'minimum' && !mission.minimumLabel) outcome = 'partial'; // no minimum defined — don't invent one
  }
  const credit = creditFor(mission, outcome, value);
  const xpBefore = await totalXp(q);
  const loggedAt = input.loggedAt ?? new Date().toISOString();

  const [row] = await q.query<{ id: string }>(
    `insert into completions (mission_id, occurred_on, outcome, value, target_value, minimum_value, difficulty, credit,
                              reason, note, logged_at, source)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     on conflict (mission_id, occurred_on) do update set
       outcome = excluded.outcome, value = excluded.value, target_value = excluded.target_value,
       minimum_value = excluded.minimum_value, difficulty = excluded.difficulty, credit = excluded.credit,
       reason = coalesce(excluded.reason, completions.reason), note = coalesce(excluded.note, completions.note),
       logged_at = case when completions.outcome = excluded.outcome then completions.logged_at else excluded.logged_at end,
       source = excluded.source
     returning id`,
    [
      mission.id, input.day, outcome, value, mission.targetValue, mission.minimumValue, mission.difficulty, credit,
      input.reason ?? null, input.note ?? null, loggedAt, input.source,
    ],
  );

  const { quotaMet, perfectDay } = await syncXp(q, viewer, mission.id, row.id, input.day);
  const xpAfter = await totalXp(q);

  return {
    ok: true,
    missionId: mission.id,
    day: input.day,
    outcome,
    kept: isKept(outcome),
    credit,
    value,
    xpGained: xpAfter - xpBefore,
    xpTotal: xpAfter,
    levelBefore: levelFromXp(xpBefore).level,
    levelAfter: levelFromXp(xpAfter).level,
    quotaMet,
    perfectDay,
    completionId: row.id,
  } satisfies CompletionResult;
}

/** Remove a day's completion inside a caller's transaction. Returns the file cleanup to run after commit. */
export async function removeCompletionTx(q: Queryable, viewer: Viewer, missionId: string, day: ISODate): Promise<(() => Promise<void>) | null> {
  const [c] = await q.query<{ id: string }>(`select id from completions where mission_id = $1 and occurred_on = $2`, [missionId, day]);
  if (!c) return null;
  const files = await removeFilesForCompletion(q, c.id);
  await q.query(`delete from completions where id = $1`, [c.id]);
  await q.query(`delete from xp_events where source = 'completion' and source_key = $1`, [c.id]);
  await syncXp(q, viewer, missionId, null, day);
  return files;
}

export async function removeCompletion(viewer: Viewer, missionId: string, day: ISODate): Promise<{ ok: true; xpTotal: number } | ActionError> {
  if (!z.uuid().safeParse(missionId).success || !z.iso.date().safeParse(day).success) return { ok: false, error: 'Invalid request.' };
  if (diffDays(day, viewer.today) > MAX_BACKFILL_DAYS) return { ok: false, error: 'Too old to edit.' };
  const removed = await asUser(viewer.userId, async (q) => {
    const files = await removeCompletionTx(q, viewer, missionId, day);
    if (!files) return null;
    return { xpTotal: await totalXp(q), files };
  });
  if (!removed) return { ok: true, xpTotal: 0 };
  await removed.files();
  void afterCompletionChange(viewer, missionId, day);
  return { ok: true, xpTotal: removed.xpTotal };
}

/** Recompute the derived XP facts a completion change can touch. */
export async function syncXp(q: Queryable, viewer: Viewer, missionId: string, completionId: string | null, day: ISODate) {
  const ws = viewer.profile.weekStartsOn;
  const weekStart = startOfWeek(day, ws);
  const weekEnd = addDays(weekStart, 6);
  const missions = await loadMissions(q, { includeArchived: true });
  const mission = missions.find((m) => m.id === missionId)!;
  const from = addDays(weekStart, -1);
  const completions = await loadCompletions(q, from, weekEnd, viewer.profile.timezone);

  // 1. the completion's own award
  if (completionId) {
    const c = completions.find((x) => x.id === completionId);
    if (c) {
      const amount = completionXp(c.difficulty, c.outcome);
      await upsertXp(q, 'completion', completionId, mission.areaId, amount, day);
    }
  }

  // 2. weekly quota bonus — paid once when the quota is met, taken back if it stops being met
  let quotaMet = false;
  const current = mission.schedules.find((s) => s.validFrom <= day && (!s.validTo || day < s.validTo));
  if (current?.cadence === 'weekly') {
    const own = completions.filter((c) => c.missionId === missionId);
    const md = evaluateMissionDay(mission, byDay(own), weekEnd, { today: viewer.today, weekStartsOn: ws });
    quotaMet = !!md.weekly && md.weekly.done >= md.weekly.quota;
    const key = `${missionId}:${weekStart}`;
    if (quotaMet) {
      const lastKept = own.filter((c) => c.kept && c.day >= weekStart && c.day <= weekEnd).map((c) => c.day).sort().at(-1) ?? day;
      await upsertXp(q, 'weekly_quota', key, mission.areaId, weeklyQuotaXp(mission.difficulty), lastKept);
    } else {
      await q.query(`delete from xp_events where source = 'weekly_quota' and source_key = $1`, [key]);
    }
  }

  // 3. perfect day bonus for the touched day
  const ev = evaluate(missions, completions, day, day, { today: viewer.today, weekStartsOn: ws });
  const perfectDay = isPerfectDay(ev.days[0]);
  if (perfectDay) await upsertXp(q, 'perfect_day', day, null, BONUS_XP.perfectDay, day);
  else await q.query(`delete from xp_events where source = 'perfect_day' and source_key = $1`, [day]);

  return { quotaMet, perfectDay };
}

/**
 * Rebuild every derived XP fact from source rows: completions, weekly quotas, perfect days,
 * finished keystones. Manual adjustments and achievement awards are left untouched.
 * Used by the seed, and after any change to the XP rules.
 */
export async function rebuildXpLedger(q: Queryable, opts: { today: ISODate; weekStartsOn: number; timezone: string }): Promise<number> {
  const { today, weekStartsOn } = opts;
  const [first] = await q.query<{ d: string | null }>(`select min(occurred_on) as d from completions`);
  await q.query(`delete from xp_events where source in ('completion', 'weekly_quota', 'perfect_day', 'perfect_week', 'keystone')`);
  if (!first?.d) return 0;
  const start = startOfWeek(first.d, weekStartsOn);
  const missions = await loadMissions(q, { includeArchived: true });
  const completions = await loadCompletions(q, addDays(start, -7), today, opts.timezone);
  const ev = evaluate(missions, completions, start, today, { today, weekStartsOn });
  const rows: { source: string; source_key: string; area_id: string | null; amount: number; occurred_on: string }[] = [];
  const area = new Map(missions.map((m) => [m.id, m.areaId]));

  for (const c of completions) {
    if (c.day < start) continue;
    const amount = completionXp(c.difficulty, c.outcome);
    if (amount) rows.push({ source: 'completion', source_key: c.id, area_id: area.get(c.missionId) ?? null, amount, occurred_on: c.day });
  }
  for (const [id, mds] of ev.byMission) {
    const m = ev.missions.get(id)!;
    const paid = new Set<string>();
    for (const md of mds) {
      if (!md.weekly || md.weekly.done < md.weekly.quota || paid.has(md.weekly.weekStart)) continue;
      if (!(md.completion?.kept && (md.status === 'required' || md.status === 'flexible'))) continue;
      // pay on the day the quota was reached
      if (md.weekly.done !== md.weekly.quota) continue;
      paid.add(md.weekly.weekStart);
      rows.push({ source: 'weekly_quota', source_key: `${id}:${md.weekly.weekStart}`, area_id: m.areaId, amount: weeklyQuotaXp(m.difficulty), occurred_on: md.day });
    }
  }
  for (const d of ev.days) {
    if (isPerfectDay(d) && d.day <= today) rows.push({ source: 'perfect_day', source_key: d.day, area_id: null, amount: BONUS_XP.perfectDay, occurred_on: d.day });
  }
  const keystones = await q.query<{ id: string; done_at: Date; week_start: string }>(`select id, done_at, week_start from keystones where status = 'done'`);
  for (const k of keystones) {
    const day = k.done_at ? new Date(k.done_at).toISOString().slice(0, 10) : addDays(k.week_start, 6);
    rows.push({ source: 'keystone', source_key: k.id, area_id: null, amount: BONUS_XP.keystone, occurred_on: day < today ? day : today });
  }
  for (let i = 0; i < rows.length; i += 500) {
    await q.query(
      `insert into xp_events (source, source_key, area_id, amount, occurred_on)
       select source, source_key, area_id, amount, occurred_on from jsonb_to_recordset($1::jsonb)
         as x(source text, source_key text, area_id uuid, amount int, occurred_on date)
       on conflict (user_id, source, source_key) do update set amount = excluded.amount, occurred_on = excluded.occurred_on`,
      [JSON.stringify(rows.slice(i, i + 500))],
    );
  }
  return rows.length;
}

export async function upsertXp(
  q: Queryable,
  source: string,
  key: string,
  areaId: string | null,
  amount: number,
  day: ISODate,
): Promise<void> {
  if (amount === 0) {
    await q.query(`delete from xp_events where source = $1 and source_key = $2`, [source, key]);
    return;
  }
  await q.query(
    `insert into xp_events (source, source_key, area_id, amount, occurred_on) values ($1, $2, $3, $4, $5)
     on conflict (user_id, source, source_key) do update set amount = excluded.amount, area_id = excluded.area_id,
       occurred_on = excluded.occurred_on`,
    [source, key, areaId, amount, day],
  );
}
