import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import type { ISODate } from '@/lib/engine/dates';
import type { Viewer } from './context';
import { track } from './analytics';

export const missionBase = z.object({
    title: z.string().trim().min(1, 'Give it a name.').max(120),
    areaId: z.uuid(),
    measure: z.enum(['check', 'duration', 'quantity']).default('check'),
    unit: z.string().trim().min(1).max(16).nullable().optional(),
    targetValue: z.number().positive().max(1_000_000).nullable().optional(),
    minimumValue: z.number().positive().max(1_000_000).nullable().optional(),
    minimumLabel: z.string().trim().min(1).max(80).nullable().optional(),
    difficulty: z.enum(['easy', 'normal', 'hard', 'extreme']).default('normal'),
    proofPolicy: z.enum(['off', 'optional', 'recommended', 'required']).default('optional'),
    timeOfDay: z.enum(['morning', 'afternoon', 'evening']).nullable().optional(),
    isPriority: z.boolean().default(false),
    notes: z.string().max(2000).nullable().optional(),
    projectId: z.uuid().nullable().optional(),
    cadence: z.enum(['daily', 'weekly', 'days', 'once']),
    perWeek: z.number().int().min(1).max(7).nullable().optional(),
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
    dueOn: z.iso.date().nullable().optional(),
  });

export const missionInput = missionBase.superRefine((v, ctx) => {
    if (v.measure !== 'check' && (!v.targetValue || !v.unit)) {
      ctx.addIssue({ code: 'custom', path: ['targetValue'], message: 'Timed and counted missions need a target.' });
    }
    if (v.minimumValue && v.targetValue && v.minimumValue > v.targetValue) {
      ctx.addIssue({ code: 'custom', path: ['minimumValue'], message: 'The minimum can’t be bigger than the target.' });
    }
    if (v.cadence === 'weekly' && !v.perWeek) ctx.addIssue({ code: 'custom', path: ['perWeek'], message: 'How many times a week?' });
    if (v.cadence === 'days' && !v.weekdays?.length) ctx.addIssue({ code: 'custom', path: ['weekdays'], message: 'Pick at least one day.' });
  });
export type MissionInput = z.input<typeof missionInput>;
type Parsed = z.output<typeof missionInput>;

function minimumLabelFor(v: Parsed): string | null {
  if (v.minimumLabel) return v.minimumLabel;
  if (v.minimumValue && v.unit) return `${v.minimumValue} ${v.unit}`;
  return null;
}

async function insertSchedule(q: Queryable, missionId: string, v: Parsed, validFrom: ISODate) {
  await q.query(
    `insert into mission_schedules (mission_id, cadence, per_week, weekdays, due_on, valid_from)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      missionId, v.cadence,
      v.cadence === 'weekly' ? v.perWeek : null,
      v.cadence === 'days' ? [...new Set(v.weekdays)].sort() : null,
      v.cadence === 'once' ? v.dueOn ?? null : null,
      validFrom,
    ],
  );
}

export async function createMissionTx(q: Queryable, v: Parsed, today: ISODate, sortOrder?: number, module: 'gym' | 'learning' | null = null): Promise<string> {
  const [m] = await q.query<{ id: string }>(
    `insert into missions (area_id, project_id, title, measure, unit, target_value, minimum_value, minimum_label,
                           difficulty, proof_policy, time_of_day, is_priority, notes, sort_order, module)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
             coalesce($14, (select coalesce(max(sort_order), 0) + 1 from missions)), $15)
     returning id`,
    [
      v.areaId, v.projectId ?? null, v.title, v.measure,
      v.measure === 'check' ? null : v.unit, v.measure === 'check' ? null : v.targetValue,
      v.measure === 'check' ? null : v.minimumValue ?? null, minimumLabelFor(v),
      v.difficulty, v.proofPolicy, v.timeOfDay ?? null, v.isPriority, v.notes ?? null, sortOrder ?? null, module,
    ],
  );
  await insertSchedule(q, m.id, v, today);
  return m.id;
}

export interface ScheduleSpec {
  cadence: 'daily' | 'weekly' | 'days' | 'once';
  perWeek?: number | null;
  weekdays?: number[] | null;
  dueOn?: ISODate | null;
}

/**
 * Change WHEN a mission is due without rewriting history: the current version closes today and a
 * new one opens (a version that only started today is simply replaced). No-op when nothing changed.
 */
export async function rescheduleMissionTx(q: Queryable, missionId: string, spec: ScheduleSpec, today: ISODate): Promise<boolean> {
  const [cur] = await q.query<{ id: string; cadence: string; per_week: number | null; weekdays: number[] | null; due_on: string | null; valid_from: string }>(
    `select id, cadence, per_week, weekdays, due_on, valid_from from mission_schedules where mission_id = $1 and valid_to is null`,
    [missionId],
  );
  const weekdays = spec.cadence === 'days' ? [...new Set(spec.weekdays ?? [])].sort() : null;
  const perWeek = spec.cadence === 'weekly' ? spec.perWeek ?? 1 : null;
  const dueOn = spec.cadence === 'once' ? spec.dueOn ?? null : null;
  const same =
    cur &&
    cur.cadence === spec.cadence &&
    (cur.per_week ?? null) === perWeek &&
    JSON.stringify(cur.weekdays ?? null) === JSON.stringify(weekdays) &&
    (cur.due_on ?? null) === dueOn;
  if (same) return false;
  if (cur && cur.valid_from >= today) await q.query(`delete from mission_schedules where id = $1`, [cur.id]);
  else if (cur) await q.query(`update mission_schedules set valid_to = $2 where id = $1`, [cur.id, today]);
  await q.query(
    `insert into mission_schedules (mission_id, cadence, per_week, weekdays, due_on, valid_from) values ($1, $2, $3, $4, $5, $6)`,
    [missionId, spec.cadence, perWeek, weekdays, dueOn, today],
  );
  return true;
}

export async function createMission(viewer: Viewer, raw: MissionInput) {
  const parsed = missionInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const id = await asUser(viewer.userId, (q) => createMissionTx(q, parsed.data, viewer.today));
  void track(viewer.userId, 'mission_created', { measure: parsed.data.measure, cadence: parsed.data.cadence, proof: parsed.data.proofPolicy });
  return { ok: true as const, id };
}

/**
 * Editing a mission never rewrites history: a changed cadence closes the current schedule
 * version today and opens a new one, so last month's rates are still judged by last month's plan.
 */
export async function updateMission(viewer: Viewer, id: string, raw: MissionInput) {
  const parsed = missionInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the form.' };
  const v = parsed.data;
  const ok = await asUser(viewer.userId, async (q) => {
    const [cur] = await q.query<{ id: string; cadence: string; per_week: number | null; weekdays: number[] | null; due_on: string | null; valid_from: string }>(
      `select s.id, s.cadence, s.per_week, s.weekdays, s.due_on, s.valid_from
         from mission_schedules s where s.mission_id = $1 and s.valid_to is null`,
      [id],
    );
    const updated = await q.query(
      `update missions set area_id = $2, title = $3, measure = $4, unit = $5, target_value = $6, minimum_value = $7,
              minimum_label = $8, difficulty = $9, proof_policy = $10, time_of_day = $11, is_priority = $12, notes = $13,
              project_id = $14
        where id = $1 returning id`,
      [
        id, v.areaId, v.title, v.measure, v.measure === 'check' ? null : v.unit, v.measure === 'check' ? null : v.targetValue,
        v.measure === 'check' ? null : v.minimumValue ?? null, minimumLabelFor(v), v.difficulty, v.proofPolicy,
        v.timeOfDay ?? null, v.isPriority, v.notes ?? null, v.projectId ?? null,
      ],
    );
    if (!updated.length) return false;
    const weekdays = v.cadence === 'days' ? [...new Set(v.weekdays)].sort() : null;
    const same =
      cur &&
      cur.cadence === v.cadence &&
      (cur.per_week ?? null) === (v.cadence === 'weekly' ? v.perWeek : null) &&
      JSON.stringify(cur.weekdays ?? null) === JSON.stringify(weekdays) &&
      (cur.due_on ?? null) === (v.cadence === 'once' ? v.dueOn ?? null : null);
    if (!same) {
      if (cur && cur.valid_from >= viewer.today) {
        await q.query(`delete from mission_schedules where id = $1`, [cur.id]);
      } else if (cur) {
        await q.query(`update mission_schedules set valid_to = $2 where id = $1`, [cur.id, viewer.today]);
      }
      await insertSchedule(q, id, v, viewer.today);
    }
    return true;
  });
  if (!ok) return { ok: false as const, error: 'Mission not found.' };
  void track(viewer.userId, 'mission_updated', { cadence: v.cadence });
  return { ok: true as const, id };
}

/** Archive: stops it being due from today; its history (and proof) stays in the record. */
export async function archiveMission(viewer: Viewer, id: string) {
  await asUser(viewer.userId, async (q) => {
    await q.query(`update missions set archived_at = now() where id = $1`, [id]);
    await q.query(`delete from mission_schedules where mission_id = $1 and valid_to is null and valid_from >= $2`, [id, viewer.today]);
    await q.query(`update mission_schedules set valid_to = $2 where mission_id = $1 and valid_to is null`, [id, viewer.today]);
  });
  void track(viewer.userId, 'mission_archived', {});
  return { ok: true as const };
}
