import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import {
  addDays, diffDays, endOfMonth, isoWeekday, startOfMonth, startOfWeek, type ISODate,
} from '@/lib/engine/dates';
import { evaluate, consistency, tallyRange } from '@/lib/engine/metrics';
import { byDay, evaluateMission, versionAt } from '@/lib/engine/schedule';
import { missionStreak } from '@/lib/engine/streaks';
import {
  detectRecords, exerciseHistory, exerciseKey, gymCalendar, isWorkingSet, monthSummary, nextWorkout, recordTimeline,
  sessionTotals, toKg, type GymCalendarWeek, type LoggedSession, type MonthSummary, type PersonalRecord, type WeightUnit,
} from '@/lib/engine/gym';
import { CATALOG_BY_KEY, type Equipment, type Muscle } from '@/lib/catalog/exercises';
import type { Viewer } from './profile';
import { loadCompletions, loadMissions, type MissionMeta } from './load';
import { createMissionTx, missionInput, rescheduleMissionTx } from './missions';
import { MAX_BACKFILL_DAYS, upsertCompletionTx, removeCompletionTx, type CompletionResult } from './completions';
import { afterCompletionChange } from './group-activity';
import { track } from './analytics';

// ───────────────────────────────────────────── program types

export interface TemplateExercise {
  id: string;
  exerciseId: string;
  name: string;
  muscle: Muscle | null;
  equipment: Equipment | null;
  position: number;
  sets: number;
  repMin: number | null;
  repMax: number | null;
  weight: number | null;
  restSeconds: number | null;
  note: string | null;
}

export interface ProgramDay {
  id: string;
  name: string;
  position: number;
  weekday: number | null;
  exercises: TemplateExercise[];
}

export interface GymProgram {
  id: string;
  name: string;
  mode: 'flexible' | 'scheduled';
  perWeek: number;
  missionId: string | null;
  days: ProgramDay[];
}

export interface LastPerformance {
  sessionId: string;
  on: ISODate;
  unit: WeightUnit;
  sets: { weight: number | null; reps: number | null }[];
}

export async function getProgram(q: Queryable): Promise<GymProgram | null> {
  const [p] = await q.query<{ id: string; name: string; mode: 'flexible' | 'scheduled'; per_week: number; mission_id: string | null }>(
    `select id, name, mode, per_week, mission_id from workout_programs where archived_at is null limit 1`,
  );
  if (!p) return null;
  const days = await q.query<{ id: string; name: string; position: number; weekday: number | null; exercises: TemplateExercise[] | null }>(
    `select d.id, d.name, d.position, d.weekday,
            (select json_agg(json_build_object(
                'id', x.id, 'exerciseId', x.exercise_id, 'name', e.name, 'muscle', e.muscle, 'equipment', e.equipment,
                'position', x.position, 'sets', x.sets, 'repMin', x.rep_min, 'repMax', x.rep_max, 'weight', x.weight,
                'restSeconds', x.rest_seconds, 'note', x.note) order by x.position)
               from workout_day_exercises x join exercises e on e.id = x.exercise_id
              where x.workout_day_id = d.id) as exercises
       from workout_days d where d.program_id = $1 and d.archived_at is null order by d.position`,
    [p.id],
  );
  return {
    id: p.id,
    name: p.name,
    mode: p.mode,
    perWeek: p.per_week,
    missionId: p.mission_id,
    days: days.map((d) => ({
      id: d.id, name: d.name, position: d.position, weekday: d.weekday,
      exercises: (d.exercises ?? []).map((x) => ({ ...x, weight: x.weight == null ? null : Number(x.weight) })),
    })),
  };
}

async function ensureGymArea(q: Queryable): Promise<string> {
  const [a] = await q.query<{ id: string }>(
    `select id from areas where kind in ('gym', 'body') and archived_at is null order by (kind = 'gym') desc, sort_order limit 1`,
  );
  if (a) return a.id;
  const [n] = await q.query<{ id: string }>(
    `insert into areas (kind, name, sort_order) values ('gym', 'Gym', coalesce((select min(sort_order) from areas), 1) - 1) returning id`,
  );
  return n.id;
}

async function enableModule(q: Queryable, userId: string, module: 'gym' | 'learning' | 'money') {
  await q.query(
    `update profiles set modules = array_append(modules, $2) where id = $1 and not ($2 = any(modules))`,
    [userId, module],
  );
}

function scheduleFor(mode: 'flexible' | 'scheduled', perWeek: number, days: { weekday?: number | null }[]) {
  if (mode === 'scheduled') {
    const weekdays = [...new Set(days.map((d) => d.weekday).filter((w): w is number => w != null))];
    return { cadence: 'days' as const, weekdays, perWeek: null };
  }
  return { cadence: 'weekly' as const, perWeek, weekdays: null };
}

// ───────────────────────────────────────────── setting up / editing the program

const dayInput = z.object({
  id: z.uuid().nullable().optional(),
  name: z.string().trim().min(1, 'Name every workout day.').max(40),
  weekday: z.number().int().min(1).max(7).nullable().optional(),
});

const programInput = z
  .object({
    name: z.string().trim().min(1).max(60).default('My program'),
    mode: z.enum(['flexible', 'scheduled']),
    perWeek: z.number().int().min(1).max(7),
    days: z.array(dayInput).min(1, 'Add at least one workout day.').max(7),
  })
  .superRefine((v, ctx) => {
    if (v.mode === 'scheduled') {
      const wd = v.days.map((d) => d.weekday).filter((w) => w != null);
      if (!wd.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Pick a weekday for at least one workout.' });
      if (new Set(wd).size !== wd.length) ctx.addIssue({ code: 'custom', path: ['days'], message: 'Two workouts can’t share a weekday.' });
    }
  });
export type ProgramInput = z.input<typeof programInput>;

/**
 * First Gym open: the user's own split. Nothing about frequency, names or exercises is prescribed.
 * A V1 "Gym" routine in a Body area is adopted (its history stays attached) instead of duplicated.
 */
export async function setupGym(viewer: Viewer, raw: ProgramInput) {
  const parsed = programInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the program.' };
  const v = parsed.data;
  const res = await asUser(viewer.userId, async (q) => {
    if (await getProgram(q)) return { ok: false as const, error: 'You already have a program — edit it instead.' };
    const areaId = await ensureGymArea(q);
    const spec = scheduleFor(v.mode, v.perWeek, v.days);
    const [legacy] = await q.query<{ id: string }>(
      `select m.id from missions m join areas a on a.id = m.area_id
        where m.archived_at is null and m.module is null and m.measure = 'check' and a.kind in ('body', 'gym')
          and m.title ~* '(gym|workout|training|lift)' order by m.created_at limit 1`,
    );
    let missionId: string;
    if (legacy) {
      missionId = legacy.id;
      await q.query(`update missions set module = 'gym' where id = $1`, [missionId]);
      await rescheduleMissionTx(q, missionId, spec, viewer.today);
    } else {
      missionId = await createMissionTx(
        q,
        missionInput.parse({ title: 'Gym', areaId, measure: 'check', difficulty: 'hard', proofPolicy: 'optional', ...spec }),
        viewer.today,
        undefined,
        'gym',
      );
    }
    const [p] = await q.query<{ id: string }>(
      `insert into workout_programs (name, mode, per_week, mission_id) values ($1, $2, $3, $4) returning id`,
      [v.name, v.mode, v.mode === 'scheduled' ? spec.weekdays!.length : v.perWeek, missionId],
    );
    for (const [i, d] of v.days.entries()) {
      await q.query(`insert into workout_days (program_id, name, position, weekday) values ($1, $2, $3, $4)`, [p.id, d.name, i, v.mode === 'scheduled' ? d.weekday ?? null : null]);
    }
    await enableModule(q, viewer.userId, 'gym');
    return { ok: true as const, id: p.id, adopted: !!legacy };
  });
  if (res.ok) void track(viewer.userId, 'gym_program_created', { days: v.days.length, mode: v.mode });
  return res;
}

/** Rename / add / remove / reorder days, switch flexible ↔ scheduled. Past workouts never change. */
export async function updateProgram(viewer: Viewer, raw: ProgramInput) {
  const parsed = programInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the program.' };
  const v = parsed.data;
  return asUser(viewer.userId, async (q) => {
    const program = await getProgram(q);
    if (!program) return { ok: false as const, error: 'Set up your program first.' };
    const spec = scheduleFor(v.mode, v.perWeek, v.days);
    await q.query(`update workout_programs set name = $2, mode = $3, per_week = $4 where id = $1`, [
      program.id, v.name, v.mode, v.mode === 'scheduled' ? spec.weekdays!.length : v.perWeek,
    ]);
    const keep = new Set(v.days.map((d) => d.id).filter(Boolean) as string[]);
    for (const d of program.days) if (!keep.has(d.id)) await q.query(`update workout_days set archived_at = now() where id = $1`, [d.id]);
    for (const [i, d] of v.days.entries()) {
      const weekday = v.mode === 'scheduled' ? d.weekday ?? null : null;
      if (d.id && program.days.some((x) => x.id === d.id)) {
        await q.query(`update workout_days set name = $2, position = $3, weekday = $4 where id = $1`, [d.id, d.name, i, weekday]);
      } else {
        await q.query(`insert into workout_days (program_id, name, position, weekday) values ($1, $2, $3, $4)`, [program.id, d.name, i, weekday]);
      }
    }
    if (program.missionId) await rescheduleMissionTx(q, program.missionId, spec, viewer.today);
    return { ok: true as const };
  });
}

const templateExerciseInput = z.object({
  exerciseId: z.uuid().nullable().optional(),
  catalogKey: z.string().regex(/^[a-z0-9_]{2,48}$/).nullable().optional(),
  sets: z.number().int().min(1).max(20),
  repMin: z.number().int().min(1).max(200).nullable().optional(),
  repMax: z.number().int().min(1).max(200).nullable().optional(),
  weight: z.number().min(0).max(2000).nullable().optional(),
  restSeconds: z.number().int().min(0).max(900).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});

const workoutDayInput = z.object({
  name: z.string().trim().min(1).max(40),
  exercises: z.array(templateExerciseInput).max(30),
});
export type WorkoutDayInput = z.input<typeof workoutDayInput>;

/** Library exercises become the user's own row on first use; custom ones already are. */
async function resolveExercise(q: Queryable, ref: { exerciseId?: string | null; catalogKey?: string | null }): Promise<string | null> {
  if (ref.exerciseId) {
    const [e] = await q.query<{ id: string }>(`select id from exercises where id = $1`, [ref.exerciseId]);
    return e?.id ?? null;
  }
  if (ref.catalogKey) {
    const c = CATALOG_BY_KEY.get(ref.catalogKey);
    if (!c) return null;
    const [e] = await q.query<{ id: string }>(
      `insert into exercises (catalog_key, name, muscle, equipment) values ($1, $2, $3, $4)
       on conflict (user_id, catalog_key) where catalog_key is not null do update set archived_at = null
       returning id`,
      [c.key, c.name, c.muscle, c.equipment],
    );
    return e.id;
  }
  return null;
}

export async function saveWorkoutDay(viewer: Viewer, dayId: string, raw: WorkoutDayInput) {
  if (!z.uuid().safeParse(dayId).success) return { ok: false as const, error: 'Invalid workout.' };
  const parsed = workoutDayInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the exercises.' };
  const v = parsed.data;
  for (const e of v.exercises) {
    if (e.repMin && e.repMax && e.repMax < e.repMin) return { ok: false as const, error: 'The top of a rep range can’t be below the bottom.' };
  }
  return asUser(viewer.userId, async (q) => {
    const [d] = await q.query<{ id: string }>(`update workout_days set name = $2 where id = $1 and archived_at is null returning id`, [dayId, v.name]);
    if (!d) return { ok: false as const, error: 'Workout not found.' };
    await q.query(`delete from workout_day_exercises where workout_day_id = $1`, [dayId]);
    for (const [i, e] of v.exercises.entries()) {
      const exerciseId = await resolveExercise(q, e);
      if (!exerciseId) return { ok: false as const, error: 'One of those exercises no longer exists.' };
      await q.query(
        `insert into workout_day_exercises (workout_day_id, exercise_id, position, sets, rep_min, rep_max, weight, rest_seconds, note)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [dayId, exerciseId, i, e.sets, e.repMin ?? null, e.repMax ?? null, e.weight ?? null, e.restSeconds ?? null, e.note || null],
      );
    }
    return { ok: true as const };
  });
}

const customExerciseInput = z.object({
  name: z.string().trim().min(1, 'Name the exercise.').max(80),
  muscle: z.enum(['chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'quads', 'hamstrings', 'glutes', 'calves', 'full_body', 'cardio', 'other']).nullable().optional(),
  equipment: z.enum(['barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band', 'other']).nullable().optional(),
});

export async function createCustomExercise(viewer: Viewer, raw: z.input<typeof customExerciseInput>) {
  const parsed = customExerciseInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the exercise.' };
  const v = parsed.data;
  const [e] = await asUser(viewer.userId, (q) =>
    q.query<{ id: string }>(`insert into exercises (name, muscle, equipment) values ($1, $2, $3) returning id`, [v.name, v.muscle ?? null, v.equipment ?? null]),
  );
  return { ok: true as const, id: e.id, name: v.name };
}

/** A library exercise picked mid-workout becomes the user's own row, so its history has a stable id. */
export async function ensureCatalogExercise(viewer: Viewer, catalogKey: string): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!/^[a-z0-9_]{2,48}$/.test(catalogKey)) return { ok: false, error: 'Unknown exercise.' };
  const id = await asUser(viewer.userId, (q) => resolveExercise(q, { catalogKey }));
  return id ? { ok: true, id } : { ok: false, error: 'Unknown exercise.' };
}

export interface MyExercise {
  id: string;
  name: string;
  catalogKey: string | null;
  muscle: Muscle | null;
  equipment: Equipment | null;
  sessions: number;
}

export async function listMyExercises(viewer: Viewer): Promise<MyExercise[]> {
  return asUser(viewer.userId, async (q) => {
    const rows = await q.query<{ id: string; name: string; catalog_key: string | null; muscle: Muscle | null; equipment: Equipment | null; n: number }>(
      `select e.id, e.name, e.catalog_key, e.muscle, e.equipment,
              (select count(distinct x.session_id)::int from workout_session_exercises x
                 join workout_sessions s on s.id = x.session_id and s.status = 'completed' where x.exercise_id = e.id) as n
         from exercises e where e.archived_at is null order by n desc, e.name`,
    );
    return rows.map((r) => ({ id: r.id, name: r.name, catalogKey: r.catalog_key, muscle: r.muscle, equipment: r.equipment, sessions: r.n }));
  });
}

// ───────────────────────────────────────────── sessions

const setSnapshot = z.object({
  id: z.uuid(),
  position: z.number().int().min(0).max(99),
  weight: z.number().min(0).max(2000).nullable(),
  reps: z.number().int().min(0).max(1000).nullable(),
  kind: z.enum(['working', 'warmup']).default('working'),
  done: z.boolean(),
});

const exerciseSnapshot = z.object({
  id: z.uuid(),
  exerciseId: z.uuid().nullable(),
  name: z.string().trim().min(1).max(80),
  position: z.number().int().min(0).max(99),
  targetSets: z.number().int().min(1).max(20).nullable().optional(),
  repMin: z.number().int().min(1).max(200).nullable().optional(),
  repMax: z.number().int().min(1).max(200).nullable().optional(),
  restSeconds: z.number().int().min(0).max(900).nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  skipped: z.boolean().default(false),
  replacedName: z.string().max(80).nullable().optional(),
  sets: z.array(setSnapshot).max(30),
});

export const sessionSnapshot = z.object({
  name: z.string().trim().min(1).max(60),
  workoutDayId: z.uuid().nullable().optional(),
  performedOn: z.iso.date(),
  startedAt: z.iso.datetime({ offset: true }),
  note: z.string().max(2000).nullable().optional(),
  durationSeconds: z.number().int().min(0).max(86400).nullable().optional(),
  exercises: z.array(exerciseSnapshot).max(40),
});
export type SessionSnapshot = z.input<typeof sessionSnapshot>;

/**
 * Save the whole workout as the phone currently has it. Idempotent full-state upsert: the client can
 * replay it after being offline and the server converges on exactly what was on screen.
 * Works for an active workout, and for correcting a finished one (which stamps edited_at).
 */
export async function putSession(viewer: Viewer, id: string, raw: unknown) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid workout.' };
  const parsed = sessionSnapshot.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Invalid workout.' };
  const v = parsed.data;
  return asUser(viewer.userId, async (q) => {
    const [existing] = await q.query<{ id: string; status: string; performed_on: string }>(
      `select id, status, performed_on from workout_sessions where id = $1`,
      [id],
    );
    if (!existing) {
      const age = diffDays(v.performedOn, viewer.today);
      if (age < 0) return { ok: false as const, error: 'That day hasn’t happened yet.' };
      if (age > MAX_BACKFILL_DAYS) return { ok: false as const, error: `Workouts can be logged up to ${MAX_BACKFILL_DAYS} days back.` };
      const program = await getProgram(q);
      const dayOk = v.workoutDayId && program?.days.some((d) => d.id === v.workoutDayId);
      await q.query(
        `insert into workout_sessions (id, program_id, workout_day_id, name, performed_on, started_at, note, weight_unit)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [id, program?.id ?? null, dayOk ? v.workoutDayId : null, v.name, v.performedOn, v.startedAt, v.note ?? null, viewer.profile.weightUnit],
      );
    } else {
      await q.query(
        `update workout_sessions set name = $2, note = $3,
                duration_seconds = case when status = 'completed' then coalesce($4, duration_seconds) else duration_seconds end,
                edited_at = case when status = 'completed' then now() else edited_at end
          where id = $1`,
        [id, v.name, v.note ?? null, v.durationSeconds ?? null],
      );
    }
    const exIds = v.exercises.map((e) => e.id);
    await q.query(`delete from workout_session_exercises where session_id = $1 and not (id = any($2::uuid[]))`, [id, exIds]);
    if (v.exercises.length) {
      await q.query(
        `insert into workout_session_exercises (id, session_id, exercise_id, name, position, target_sets, rep_min, rep_max, rest_seconds, note, skipped, replaced_name)
         select x.id, $1, x.exercise_id, x.name, x.position, x.target_sets, x.rep_min, x.rep_max, x.rest_seconds, x.note, x.skipped, x.replaced_name
           from jsonb_to_recordset($2::jsonb) as x(id uuid, exercise_id uuid, name text, position int, target_sets int, rep_min int, rep_max int,
                                                   rest_seconds int, note text, skipped boolean, replaced_name text)
         on conflict (id) do update set exercise_id = excluded.exercise_id, name = excluded.name, position = excluded.position,
           target_sets = excluded.target_sets, rep_min = excluded.rep_min, rep_max = excluded.rep_max, rest_seconds = excluded.rest_seconds,
           note = excluded.note, skipped = excluded.skipped, replaced_name = excluded.replaced_name
         where workout_session_exercises.session_id = $1`,
        [
          id,
          JSON.stringify(v.exercises.map((e) => ({
            id: e.id, exercise_id: e.exerciseId, name: e.name, position: e.position, target_sets: e.targetSets ?? null, rep_min: e.repMin ?? null,
            rep_max: e.repMax ?? null, rest_seconds: e.restSeconds ?? null, note: e.note || null, skipped: e.skipped, replaced_name: e.replacedName ?? null,
          }))),
        ],
      );
    }
    const sets = v.exercises.flatMap((e) => e.sets.map((s) => ({ ...s, exercise: e.id })));
    await q.query(
      `delete from workout_sets where session_exercise_id = any($1::uuid[]) and not (id = any($2::uuid[]))`,
      [exIds, sets.map((s) => s.id)],
    );
    if (sets.length) {
      await q.query(
        `insert into workout_sets (id, session_exercise_id, position, weight, reps, kind, done)
         select x.id, x.exercise, x.position, x.weight, x.reps, x.kind, x.done
           from jsonb_to_recordset($1::jsonb) as x(id uuid, exercise uuid, position int, weight numeric, reps int, kind text, done boolean)
         on conflict (id) do update set session_exercise_id = excluded.session_exercise_id, position = excluded.position,
           weight = excluded.weight, reps = excluded.reps, kind = excluded.kind, done = excluded.done`,
        [JSON.stringify(sets)],
      );
    }
    return { ok: true as const, savedAt: new Date().toISOString() };
  });
}

export interface WorkoutSummary {
  id: string;
  name: string;
  performedOn: ISODate;
  durationSeconds: number;
  exercises: number;
  sets: number;
  volumeKg: number;
  unit: WeightUnit;
  records: PersonalRecord[];
  week: { done: number; target: number | null };
  points: number;
  levelBefore: number;
  levelAfter: number;
  completionId: string | null;
  groups: { groupId: string; name: string }[];
}

const finishInput = z.object({
  note: z.string().max(2000).nullable().optional(),
  durationSeconds: z.number().int().min(60).max(86400).nullable().optional(),
  /** "gym done": the workout happened, the details weren't logged */
  quick: z.boolean().optional(),
});

/**
 * Finish = one action. Saves the workout, keeps the Gym routine for that day (idempotently —
 * a second workout the same day adds no second completion or points), and returns the summary.
 */
export async function finishSession(viewer: Viewer, id: string, raw: unknown): Promise<{ ok: true; summary: WorkoutSummary } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: 'Invalid workout.' };
  const parsed = finishInput.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: 'Invalid workout.' };
  const opts = parsed.data;
  const after = { missionId: null as string | null };
  const res = await asUser(viewer.userId, async (q) => {
    const [s] = await q.query<{ id: string; status: string; started_at: Date; performed_on: string; program_id: string | null; completion_id: string | null }>(
      `select id, status, started_at, performed_on, program_id, completion_id from workout_sessions where id = $1`,
      [id],
    );
    if (!s) return { ok: false as const, error: 'Workout not found — it may not have synced yet.' };
    const [{ n }] = await q.query<{ n: number }>(
      `select count(*)::int as n from workout_sets t join workout_session_exercises e on e.id = t.session_exercise_id
        where e.session_id = $1 and t.done and coalesce(t.reps, 0) > 0`,
      [id],
    );
    if (n === 0 && !opts.quick) return { ok: false as const, error: 'Tick at least one set to finish the workout.' };

    let completion: CompletionResult | null = null;
    if (s.status !== 'completed') {
      // un-ticked placeholder sets are not history
      await q.query(
        `delete from workout_sets t using workout_session_exercises e where e.id = t.session_exercise_id and e.session_id = $1 and not t.done`,
        [id],
      );
      await q.query(
        `update workout_session_exercises e set skipped = true
          where e.session_id = $1 and not exists (select 1 from workout_sets t where t.session_exercise_id = e.id)`,
        [id],
      );
      const started = new Date(s.started_at).getTime();
      const duration = opts.quick ? opts.durationSeconds ?? null : opts.durationSeconds ?? Math.max(60, Math.min(6 * 3600, Math.round((Date.now() - started) / 1000)));
      await q.query(
        `update workout_sessions set status = 'completed', finished_at = now(), duration_seconds = $2, note = coalesce($3, note) where id = $1`,
        [id, duration, opts.note ?? null],
      );
    } else if (opts.note != null || opts.durationSeconds != null) {
      await q.query(`update workout_sessions set note = coalesce($2, note), duration_seconds = coalesce($3, duration_seconds), edited_at = now() where id = $1`, [id, opts.note ?? null, opts.durationSeconds ?? null]);
    }

    const program = await getProgram(q);
    const missionId = program?.missionId ?? null;
    if (missionId && diffDays(s.performed_on, viewer.today) <= MAX_BACKFILL_DAYS) {
      const r = await upsertCompletionTx(q, viewer, { missionId, day: s.performed_on, outcome: 'full', source: 'workout' });
      if (r.ok) {
        completion = r;
        after.missionId = missionId;
        await q.query(`update workout_sessions set completion_id = $2 where id = $1`, [id, r.completionId]);
      }
    }

    const all = await loadSessions(q, { status: 'completed' });
    const current = all.find((x) => x.id === id)!;
    const before = all.filter((x) => x.id !== id && (x.performedOn < current.performedOn || (x.performedOn === current.performedOn && x.startedAt < current.startedAt)));
    const records = detectRecords(before, current);
    for (const r of records.filter((x) => x.kind === 'weight')) {
      await q.query(
        `insert into timeline_events (occurred_on, kind, title, detail, source_key) values ($1, 'record', $2, $3, $4)
         on conflict (user_id, kind, source_key) do nothing`,
        [current.performedOn, `${r.name}: ${Math.round(r.value * 10) / 10} kg`, `Heaviest yet (previous ${Math.round((r.previous ?? 0) * 10) / 10} kg)`, `pr:${r.key}:${current.id}`],
      );
    }
    const totals = sessionTotals(current);
    const week = await weekProgress(q, viewer, program, current.performedOn);
    return {
      ok: true as const,
      summary: {
        id,
        name: current.name,
        performedOn: current.performedOn,
        durationSeconds: current.durationSeconds ?? 0,
        exercises: totals.exercises,
        sets: totals.sets,
        volumeKg: totals.volumeKg,
        unit: current.weightUnit,
        records,
        week,
        points: completion?.xpGained ?? 0,
        levelBefore: completion?.levelBefore ?? 0,
        levelAfter: completion?.levelAfter ?? 0,
        completionId: completion?.completionId ?? s.completion_id,
        groups: [],
      } satisfies WorkoutSummary,
    };
  });
  if (res.ok) {
    void track(viewer.userId, 'workout_completed', { sets: res.summary.sets, records: res.summary.records.length });
    if (after.missionId) await afterCompletionChange(viewer, after.missionId, res.summary.performedOn);
  }
  return res;
}

async function weekProgress(q: Queryable, viewer: Viewer, program: GymProgram | null, day: ISODate): Promise<{ done: number; target: number | null }> {
  if (!program?.missionId) return { done: 0, target: null };
  const ws = startOfWeek(day, viewer.profile.weekStartsOn);
  const [mission] = await loadMissions(q, { ids: [program.missionId], includeArchived: true });
  const comps = await loadCompletions(q, addDays(ws, -1), addDays(ws, 6), viewer.profile.timezone, program.missionId);
  const mds = evaluateMission(mission, byDay(comps), ws, addDays(ws, 6), { today: viewer.today, weekStartsOn: viewer.profile.weekStartsOn });
  const done = comps.filter((c) => c.kept && c.day >= ws && c.day <= addDays(ws, 6)).length;
  const v = versionAt(mission.schedules, day);
  const target = v?.cadence === 'weekly' ? mds.find((m) => m.weekly)?.weekly?.quota ?? v.perWeek : v?.cadence === 'days' ? (v.weekdays ?? []).length : null;
  return { done, target };
}

/** Delete a workout. If it was the day's only one, the day's Gym completion (and its points) go too. */
export async function deleteSession(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid workout.' };
  const changed = { value: null as { missionId: string; day: ISODate } | null };
  const res = await asUser(viewer.userId, async (q) => {
    const [s] = await q.query<{ status: string; performed_on: string; completion_id: string | null }>(
      `select status, performed_on, completion_id from workout_sessions where id = $1`,
      [id],
    );
    if (!s) return { ok: true as const, cleanup: null };
    await q.query(`delete from workout_sessions where id = $1`, [id]);
    if (s.status !== 'completed') return { ok: true as const, cleanup: null };
    const program = await getProgram(q);
    const [{ others }] = await q.query<{ others: number }>(
      `select count(*)::int as others from workout_sessions where performed_on = $1 and status = 'completed'`,
      [s.performed_on],
    );
    if (others === 0 && program?.missionId && diffDays(s.performed_on, viewer.today) <= MAX_BACKFILL_DAYS) {
      const [c] = await q.query<{ source: string }>(`select source from completions where mission_id = $1 and occurred_on = $2`, [program.missionId, s.performed_on]);
      if (c?.source === 'workout') {
        const cleanup = await removeCompletionTx(q, viewer, program.missionId, s.performed_on);
        changed.value = { missionId: program.missionId, day: s.performed_on };
        return { ok: true as const, cleanup };
      }
    }
    return { ok: true as const, cleanup: null };
  });
  if (res.cleanup) await res.cleanup();
  if (changed.value) await afterCompletionChange(viewer, changed.value.missionId, changed.value.day);
  return { ok: true as const };
}

// ───────────────────────────────────────────── reading sessions

export interface DetailSet {
  id: string;
  position: number;
  weight: number | null;
  reps: number | null;
  kind: 'working' | 'warmup';
  done: boolean;
}

export interface DetailExercise {
  id: string;
  exerciseId: string | null;
  name: string;
  position: number;
  targetSets: number | null;
  repMin: number | null;
  repMax: number | null;
  restSeconds: number | null;
  note: string | null;
  skipped: boolean;
  replacedName: string | null;
  sets: DetailSet[];
}

export interface SessionDetail extends Omit<LoggedSession, 'exercises'> {
  status: 'active' | 'completed';
  note: string | null;
  editedAt: string | null;
  finishedAt: string | null;
  exercises: DetailExercise[];
}

export async function loadSessions(
  q: Queryable,
  opts: { status?: 'completed' | 'active'; from?: ISODate; to?: ISODate; ids?: string[]; limit?: number; before?: { on: ISODate; id: string } } = {},
): Promise<SessionDetail[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.status) {
    params.push(opts.status);
    where.push(`s.status = $${params.length}`);
  }
  if (opts.from) {
    params.push(opts.from);
    where.push(`s.performed_on >= $${params.length}`);
  }
  if (opts.to) {
    params.push(opts.to);
    where.push(`s.performed_on <= $${params.length}`);
  }
  if (opts.ids) {
    params.push(opts.ids);
    where.push(`s.id = any($${params.length}::uuid[])`);
  }
  if (opts.before) {
    params.push(opts.before.on, opts.before.id);
    where.push(`(s.performed_on, s.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
  }
  let limit = '';
  if (opts.limit) {
    params.push(opts.limit);
    limit = `limit $${params.length}`;
  }
  const rows = await q.query<{
    id: string; name: string; workout_day_id: string | null; performed_on: string; started_at: Date; finished_at: Date | null;
    duration_seconds: number | null; weight_unit: WeightUnit; status: 'active' | 'completed'; note: string | null; edited_at: Date | null;
    exercises: SessionDetail['exercises'] | null;
  }>(
    `select s.id, s.name, s.workout_day_id, s.performed_on, s.started_at, s.finished_at, s.duration_seconds, s.weight_unit, s.status,
            s.note, s.edited_at,
            (select json_agg(json_build_object(
                'id', e.id, 'exerciseId', e.exercise_id, 'name', e.name, 'position', e.position, 'targetSets', e.target_sets,
                'repMin', e.rep_min, 'repMax', e.rep_max, 'restSeconds', e.rest_seconds, 'note', e.note, 'skipped', e.skipped,
                'replacedName', e.replaced_name,
                'sets', coalesce((select json_agg(json_build_object('id', t.id, 'position', t.position, 'weight', t.weight, 'reps', t.reps,
                                                                    'kind', t.kind, 'done', t.done) order by t.position)
                                    from workout_sets t where t.session_exercise_id = e.id), '[]'::json)) order by e.position)
               from workout_session_exercises e where e.session_id = s.id) as exercises
       from workout_sessions s
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by s.performed_on desc, s.id desc ${limit}`,
    params,
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    workoutDayId: r.workout_day_id,
    performedOn: r.performed_on,
    startedAt: new Date(r.started_at).toISOString(),
    finishedAt: r.finished_at ? new Date(r.finished_at).toISOString() : null,
    durationSeconds: r.duration_seconds,
    weightUnit: r.weight_unit,
    status: r.status,
    note: r.note,
    editedAt: r.edited_at ? new Date(r.edited_at).toISOString() : null,
    exercises: (r.exercises ?? []).map((e) => ({
      ...e,
      sets: e.sets.map((t) => ({ ...t, weight: t.weight == null ? null : Number(t.weight), reps: t.reps == null ? null : Number(t.reps) })),
    })),
  }));
}

export async function lastPerformances(q: Queryable, exerciseIds: string[], excludeSession?: string): Promise<Record<string, LastPerformance>> {
  if (!exerciseIds.length) return {};
  const rows = await q.query<{ exercise_id: string; session_id: string; performed_on: string; weight_unit: WeightUnit; sets: { weight: number | null; reps: number | null }[] }>(
    `select distinct on (e.exercise_id) e.exercise_id, s.id as session_id, s.performed_on, s.weight_unit,
            (select json_agg(json_build_object('weight', t.weight, 'reps', t.reps) order by t.position)
               from workout_sets t where t.session_exercise_id = e.id and t.done and t.kind = 'working') as sets
       from workout_session_exercises e join workout_sessions s on s.id = e.session_id
      where s.status = 'completed' and e.exercise_id = any($1::uuid[]) and ($2::uuid is null or s.id <> $2::uuid)
        and exists (select 1 from workout_sets t where t.session_exercise_id = e.id and t.done and t.kind = 'working')
      order by e.exercise_id, s.performed_on desc, s.started_at desc`,
    [exerciseIds, excludeSession ?? null],
  );
  const out: Record<string, LastPerformance> = {};
  for (const r of rows) {
    out[r.exercise_id] = {
      sessionId: r.session_id,
      on: r.performed_on,
      unit: r.weight_unit,
      sets: (r.sets ?? []).map((s) => ({ weight: s.weight == null ? null : Number(s.weight), reps: s.reps == null ? null : Number(s.reps) })),
    };
  }
  return out;
}

/** A session plus "last time" for each exercise in it — the workout screen and the edit screen. */
export async function loadSessionForEdit(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  return asUser(viewer.userId, async (q) => {
    const [s] = await loadSessions(q, { ids: [id] });
    if (!s) return null;
    const last = await lastPerformances(q, s.exercises.map((e) => e.exerciseId).filter((x): x is string => !!x), id);
    return { session: s, last };
  });
}

// ───────────────────────────────────────────── Gym home

export interface StartDay {
  id: string;
  name: string;
  weekday: number | null;
  exercises: TemplateExercise[];
}

export interface SessionListItem {
  id: string;
  name: string;
  on: ISODate;
  durationSeconds: number | null;
  exercises: number;
  sets: number;
  volumeKg: number;
  proofs: number;
  edited: boolean;
}

export interface GymHome {
  today: ISODate;
  unit: WeightUnit;
  program: GymProgram | null;
  week: { done: number; target: number | null; daysLeft: number };
  next: { dayId: string; name: string; on: ISODate; exercises: number; isToday: boolean } | null;
  active: { id: string; name: string; startedAt: string; sets: number } | null;
  trainedToday: SessionListItem[];
  month: ISODate;
  calendar: GymCalendarWeek[];
  summary: MonthSummary;
  recent: SessionListItem[];
  start: StartDay[];
  last: Record<string, LastPerformance>;
  otherRoutines: { id: string; title: string; cadence: string }[];
  firstSessionOn: ISODate | null;
}

function toListItem(s: SessionDetail, proofs: number): SessionListItem {
  const t = sessionTotals(s);
  return { id: s.id, name: s.name, on: s.performedOn, durationSeconds: s.durationSeconds, exercises: t.exercises, sets: t.sets, volumeKg: t.volumeKg, proofs, edited: !!s.editedAt };
}

async function proofCounts(q: Queryable, sessionIds: string[]): Promise<Map<string, number>> {
  if (!sessionIds.length) return new Map();
  const rows = await q.query<{ id: string; n: number }>(
    `select s.id, count(p.id)::int as n from workout_sessions s join proofs p on p.completion_id = s.completion_id
      where s.id = any($1::uuid[]) group by s.id`,
    [sessionIds],
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}

export async function loadGymHome(viewer: Viewer, monthParam?: string | null): Promise<GymHome> {
  const { today, profile } = viewer;
  const ws = profile.weekStartsOn;
  const month = monthParam && /^\d{4}-\d{2}$/.test(monthParam) ? `${monthParam}-01` : startOfMonth(today);
  return asUser(viewer.userId, async (q) => {
    const program = await getProgram(q);
    const gridFrom = startOfWeek(startOfMonth(month), ws);
    const gridTo = addDays(startOfWeek(endOfMonth(month), ws), 6);
    const from = gridFrom < addDays(today, -7) ? gridFrom : addDays(today, -7);
    const to = gridTo > today ? gridTo : today;
    const [sessions, active, mission, other] = await Promise.all([
      loadSessions(q, { status: 'completed', from: addDays(from, -7), to }),
      loadSessions(q, { status: 'active', limit: 1 }),
      program?.missionId ? loadMissions(q, { ids: [program.missionId], includeArchived: true }).then((m) => m[0] ?? null) : Promise.resolve(null as MissionMeta | null),
      q.query<{ id: string; title: string }>(
        `select m.id, m.title from missions m join areas a on a.id = m.area_id
          where a.kind in ('gym', 'body') and m.module is null and m.archived_at is null order by m.sort_order`,
      ),
    ]);
    const comps = mission ? await loadCompletions(q, addDays(from, -7), to, profile.timezone, mission.id) : [];
    const [firstRow] = await q.query<{ d: string | null }>(`select min(performed_on) as d from workout_sessions where status = 'completed'`);

    // calendar
    const byDayMap = new Map<ISODate, { id: string; name: string }[]>();
    for (const s of [...sessions].reverse()) {
      const list = byDayMap.get(s.performedOn) ?? [];
      list.push({ id: s.id, name: s.name });
      byDayMap.set(s.performedOn, list);
    }
    const keptDays = new Set(comps.filter((c) => c.kept).map((c) => c.day));
    const mds = mission ? evaluateMission(mission, byDay(comps), gridFrom, gridTo, { today, weekStartsOn: ws }) : [];
    const mdOf = new Map(mds.map((m) => [m.day, m]));
    const plannedDays = program?.days ?? [];
    const calendar = gymCalendar({
      month,
      today,
      weekStartsOn: ws,
      mode: program?.mode ?? null,
      keptDays,
      isScheduled: (d) => {
        if (!mission) return false;
        const v = versionAt(mission.schedules, d);
        return v?.cadence === 'days' && (v.weekdays ?? []).includes(isoWeekday(d));
      },
      plannedName: (d) => plannedDays.find((x) => x.weekday === isoWeekday(d))?.name ?? null,
      sessionsByDay: byDayMap,
      weeklyTarget: (w) => {
        const md = mdOf.get(addDays(w, 6)) ?? mdOf.get(w);
        if (md?.weekly) return md.weekly.quota;
        const v = mission ? versionAt(mission.schedules, w) : null;
        return v?.cadence === 'weekly' ? v.perWeek : null;
      },
    });

    const mStart = startOfMonth(month);
    const mEnd = endOfMonth(month);
    const monthSessions = sessions.filter((s) => s.performedOn >= mStart && s.performedOn <= mEnd);
    const loggedOnly = [...keptDays].filter((d) => d >= mStart && d <= mEnd && !byDayMap.has(d)).length;
    const scheduledDays = calendar.flatMap((w) => w.days).filter((d) => d.inMonth && d.plannedName != null).length;
    // records set this month need the whole history; cheap enough at personal scale
    const history = await loadSessions(q, { status: 'completed', to: mEnd });
    // exercises that reached a new best (heaviest, or more reps at a weight) this month — each counted once
    const records = new Set(recordTimeline(history).filter((r) => r.on >= mStart && r.on <= mEnd && r.record.kind !== 'volume').map((r) => r.record.key)).size;
    const summary = monthSummary({ month, mode: program?.mode ?? null, perWeek: program?.perWeek ?? null, scheduledDays, sessions: monthSessions, loggedOnlyDays: loggedOnly, records });

    // this week + next workout
    const weekStart = startOfWeek(today, ws);
    const week = await weekProgress(q, viewer, program, today);
    const trainedToday = sessions.filter((s) => s.performedOn === today);
    const last = history.find((s) => s.workoutDayId && program?.days.some((d) => d.id === s.workoutDayId));
    const next = program ? nextWorkout(program.mode, program.days, last?.workoutDayId ?? null, today, trainedToday.length > 0 || keptDays.has(today)) : null;

    const recent = history.slice(0, 5);
    const pc = await proofCounts(q, [...recent, ...trainedToday].map((s) => s.id));
    const exerciseIds = [...new Set((program?.days ?? []).flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
    const lastPerf = await lastPerformances(q, exerciseIds);

    return {
      today,
      unit: profile.weightUnit,
      program,
      week: { ...week, daysLeft: diffDays(today, addDays(weekStart, 6)) + 1 },
      next: next ? { dayId: next.day.id, name: next.day.name, on: next.on, exercises: next.day.exercises.length, isToday: next.on === today } : null,
      active: active[0] ? { id: active[0].id, name: active[0].name, startedAt: active[0].startedAt, sets: active[0].exercises.reduce((s, e) => s + e.sets.filter((x) => x.done).length, 0) } : null,
      trainedToday: trainedToday.map((s) => toListItem(s, pc.get(s.id) ?? 0)),
      month,
      calendar,
      summary,
      recent: recent.map((s) => toListItem(s, pc.get(s.id) ?? 0)),
      start: (program?.days ?? []).map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, exercises: d.exercises })),
      last: lastPerf,
      otherRoutines: other.map((o) => ({ id: o.id, title: o.title, cadence: '' })),
      firstSessionOn: firstRow?.d ?? null,
    };
  });
}

// ───────────────────────────────────────────── one calendar day

export interface GymDayDetail {
  day: ISODate;
  state: 'future' | 'today' | 'past';
  planned: { dayId: string; name: string; exercises: TemplateExercise[] } | null;
  sessions: SessionDetail[];
  loggedOnly: boolean;
  proofs: Record<string, number>;
}

export async function loadGymDay(viewer: Viewer, day: ISODate): Promise<GymDayDetail> {
  return asUser(viewer.userId, async (q) => {
    const program = await getProgram(q);
    const sessions = (await loadSessions(q, { status: 'completed', from: day, to: day })).reverse();
    const mission = program?.missionId ? (await loadMissions(q, { ids: [program.missionId], includeArchived: true }))[0] : null;
    const [kept] = mission
      ? await q.query<{ kept: boolean }>(`select kept from completions where mission_id = $1 and occurred_on = $2`, [mission.id, day])
      : [];
    let planned: GymDayDetail['planned'] = null;
    if (program) {
      if (program.mode === 'scheduled') {
        const v = mission ? versionAt(mission.schedules, day) : null;
        const d = program.days.find((x) => x.weekday === isoWeekday(day));
        if (d && (day >= viewer.today || (v?.cadence === 'days' && (v.weekdays ?? []).includes(isoWeekday(day))))) {
          planned = { dayId: d.id, name: d.name, exercises: d.exercises };
        }
      }
    }
    const pc = await proofCounts(q, sessions.map((s) => s.id));
    return {
      day,
      state: day > viewer.today ? 'future' : day === viewer.today ? 'today' : 'past',
      planned,
      sessions,
      loggedOnly: !!kept?.kept && sessions.length === 0,
      proofs: Object.fromEntries(pc),
    };
  });
}

// ───────────────────────────────────────────── history + stats

export async function loadGymHistory(viewer: Viewer, cursor?: string | null): Promise<{ items: SessionListItem[]; next: string | null }> {
  return asUser(viewer.userId, async (q) => {
    const before = cursor && /^\d{4}-\d{2}-\d{2}\|[0-9a-f-]{36}$/.test(cursor) ? { on: cursor.slice(0, 10), id: cursor.slice(11) } : undefined;
    const rows = await loadSessions(q, { status: 'completed', limit: 31, before });
    const page = rows.slice(0, 30);
    const pc = await proofCounts(q, page.map((s) => s.id));
    const last = page.at(-1);
    return { items: page.map((s) => toListItem(s, pc.get(s.id) ?? 0)), next: rows.length > 30 && last ? `${last.performedOn}|${last.id}` : null };
  });
}

export interface GymStats {
  unit: WeightUnit;
  hasData: boolean;
  thisWeek: number;
  thisMonth: number;
  consistency90: number | null;
  avgPerWeek12: number | null;
  totalMinutes: number;
  totalSessions: number;
  bestWeekStreak: number;
  currentWeekStreak: number;
  weekly: { weekStart: ISODate; workouts: number; volumeKg: number; target: number | null }[];
  records: { on: ISODate; name: string; kind: PersonalRecord['kind']; value: number; weightKg: number | null; reps: number | null; previous: number | null }[];
  lifts: { key: string; exerciseId: string | null; name: string; sessions: number; bestKg: number; bestE1rmKg: number | null; lastOn: ISODate }[];
  bodyweight: { on: ISODate; weight: number; unit: WeightUnit }[];
}

export async function loadGymStats(viewer: Viewer): Promise<GymStats> {
  const { today, profile } = viewer;
  const ws = profile.weekStartsOn;
  return asUser(viewer.userId, async (q) => {
    const program = await getProgram(q);
    const sessions = await loadSessions(q, { status: 'completed' });
    const bw = await q.query<{ measured_on: string; weight: number; unit: WeightUnit }>(`select measured_on, weight, unit from body_measurements order by measured_on`);
    const mission = program?.missionId ? (await loadMissions(q, { ids: [program.missionId], includeArchived: true }))[0] : null;
    const from = addDays(today, -7 * 26);
    const comps = mission ? await loadCompletions(q, addDays(from, -7), today, profile.timezone, mission.id) : [];
    const ev = mission ? evaluate([mission], comps, from, today, { today, weekStartsOn: ws }) : null;
    const thisWeekStart = startOfWeek(today, ws);
    const monthStart = startOfMonth(today);
    const keptDays = new Set(comps.filter((c) => c.kept).map((c) => c.day));
    const sessionDays = new Set(sessions.map((s) => s.performedOn));
    const countIn = (a: ISODate, b: ISODate) =>
      sessions.filter((s) => s.performedOn >= a && s.performedOn <= b).length + [...keptDays].filter((d) => d >= a && d <= b && !sessionDays.has(d)).length;

    const weekly: GymStats['weekly'] = [];
    for (let k = 11; k >= 0; k--) {
      const w = addDays(thisWeekStart, -7 * k);
      const e = addDays(w, 6);
      const vol = sessions.filter((s) => s.performedOn >= w && s.performedOn <= e).reduce((sum, s) => sum + sessionTotals(s).volumeKg, 0);
      const md = ev?.byMission.get(mission!.id)?.find((m) => m.day === (e <= today ? e : today));
      weekly.push({ weekStart: w, workouts: countIn(w, e), volumeKg: Math.round(vol), target: md?.weekly?.quota ?? (mission ? versionAt(mission.schedules, w)?.weekdays?.length ?? null : null) });
    }
    const past12 = weekly.slice(0, 11);
    const streak = ev && mission ? missionStreak(ev.byMission.get(mission.id)!, today) : { current: 0, best: 0 };
    const t90 = ev ? tallyRange(ev, addDays(today, -89), today) : null;

    const timeline = recordTimeline(sessions);
    const lifts = new Map<string, GymStats['lifts'][number]>();
    for (const s of sessions) {
      for (const e of s.exercises) {
        const work = e.sets.filter(isWorkingSet);
        if (!work.length) continue;
        const k = exerciseKey(e);
        const row = lifts.get(k) ?? { key: k, exerciseId: e.exerciseId, name: e.name, sessions: 0, bestKg: 0, bestE1rmKg: null, lastOn: s.performedOn };
        row.sessions++;
        if (s.performedOn > row.lastOn) row.lastOn = s.performedOn;
        for (const set of work) {
          const w = toKg(set.weight ?? 0, s.weightUnit);
          row.bestKg = Math.max(row.bestKg, w);
          if ((set.reps ?? 0) <= 12 && w > 0) {
            const est = (set.reps ?? 0) === 1 ? w : w * (1 + (set.reps ?? 0) / 30);
            row.bestE1rmKg = Math.max(row.bestE1rmKg ?? 0, Math.round(est * 10) / 10);
          }
        }
        lifts.set(k, row);
      }
    }
    return {
      unit: profile.weightUnit,
      hasData: sessions.length > 0 || keptDays.size > 0,
      thisWeek: countIn(thisWeekStart, today),
      thisMonth: countIn(monthStart, today),
      consistency90: t90 ? consistency(t90) : null,
      avgPerWeek12: past12.some((w) => w.workouts) ? Math.round((past12.reduce((s, w) => s + w.workouts, 0) / past12.length) * 10) / 10 : null,
      totalMinutes: Math.round(sessions.reduce((s, x) => s + (x.durationSeconds ?? 0), 0) / 60),
      totalSessions: sessions.length,
      bestWeekStreak: streak.best,
      currentWeekStreak: streak.current,
      weekly,
      records: timeline.slice(-12).reverse().map((r) => ({ on: r.on, name: r.record.name, kind: r.record.kind, value: r.record.value, weightKg: r.record.weightKg, reps: r.record.reps, previous: r.record.previous })),
      lifts: [...lifts.values()].sort((a, b) => b.sessions - a.sessions),
      bodyweight: bw.map((b) => ({ on: b.measured_on, weight: Number(b.weight), unit: b.unit })),
    };
  });
}

export async function loadExerciseDetail(viewer: Viewer, key: string) {
  return asUser(viewer.userId, async (q) => {
    const sessions = await loadSessions(q, { status: 'completed' });
    const points = exerciseHistory(sessions, key);
    const name = sessions.flatMap((s) => s.exercises).find((e) => exerciseKey(e) === key)?.name ?? null;
    const timeline = recordTimeline(sessions).filter((r) => r.record.key === key).reverse();
    return { key, name, points, records: timeline.map((r) => ({ on: r.on, kind: r.record.kind, value: r.record.value, reps: r.record.reps, weightKg: r.record.weightKg, previous: r.record.previous })) };
  });
}

const bodyweightInput = z.object({ weight: z.number().positive().max(999), on: z.iso.date() });

export async function logBodyweight(viewer: Viewer, raw: z.input<typeof bodyweightInput>) {
  const parsed = bodyweightInput.safeParse(raw);
  if (!parsed.success || parsed.data.on > viewer.today) return { ok: false as const, error: 'Enter a weight.' };
  await asUser(viewer.userId, (q) =>
    q.query(
      `insert into body_measurements (measured_on, weight, unit) values ($1, $2, $3)
       on conflict (user_id, measured_on) do update set weight = excluded.weight, unit = excluded.unit`,
      [parsed.data.on, parsed.data.weight, viewer.profile.weightUnit],
    ),
  );
  return { ok: true as const };
}

// ───────────────────────────────────────────── Today's gym card

export interface GymToday {
  mode: 'flexible' | 'scheduled';
  week: { done: number; target: number | null };
  next: { dayId: string; name: string; exercises: number; on: ISODate; isToday: boolean } | null;
  today: SessionListItem[];
  loggedOnly: boolean;
  active: { id: string; name: string; startedAt: string } | null;
  status: 'planned' | 'flexible' | 'done' | 'rest';
  start: StartDay[];
  last: Record<string, LastPerformance>;
}

export async function loadGymToday(q: Queryable, viewer: Viewer, keptToday: boolean): Promise<GymToday | null> {
  const program = await getProgram(q);
  if (!program) return null;
  const { today } = viewer;
  const [sessionsToday, active, history] = await Promise.all([
    loadSessions(q, { status: 'completed', from: today, to: today }),
    loadSessions(q, { status: 'active', limit: 1 }),
    q.query<{ workout_day_id: string | null }>(
      `select workout_day_id from workout_sessions where status = 'completed' and workout_day_id is not null order by performed_on desc, started_at desc limit 1`,
    ),
  ]);
  const week = await weekProgress(q, viewer, program, today);
  const trained = sessionsToday.length > 0 || keptToday;
  const next = nextWorkout(program.mode, program.days, history[0]?.workout_day_id ?? null, today, trained);
  const exerciseIds = [...new Set(program.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
  const status: GymToday['status'] = trained
    ? 'done'
    : program.mode === 'scheduled'
      ? next?.on === today ? 'planned' : 'rest'
      : week.target != null && week.done >= week.target ? 'rest' : 'flexible';
  return {
    mode: program.mode,
    week,
    next: next ? { dayId: next.day.id, name: next.day.name, exercises: next.day.exercises.length, on: next.on, isToday: next.on === today } : null,
    today: sessionsToday.map((s) => toListItem(s, 0)),
    loggedOnly: keptToday && sessionsToday.length === 0,
    active: active[0] ? { id: active[0].id, name: active[0].name, startedAt: active[0].startedAt } : null,
    status,
    start: program.days.map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, exercises: d.exercises })),
    last: await lastPerformances(q, exerciseIds),
  };
}

// ───────────────────────────────────────────── one workout, in full

export async function loadSessionPage(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return null;
  const { PROOF_SELECT, toProofView } = await import('./proofs');
  return asUser(viewer.userId, async (q) => {
    const all = await loadSessions(q, { status: 'completed' });
    const session = all.find((s) => s.id === id) ?? (await loadSessions(q, { ids: [id] }))[0];
    if (!session) return null;
    const records = recordTimeline(all).filter((r) => r.sessionId === id).map((r) => r.record);
    const [row] = await q.query<{ completion_id: string | null }>(`select completion_id from workout_sessions where id = $1`, [id]);
    const proofs = row?.completion_id
      ? (await q.query<Parameters<typeof toProofView>[0]>(`${PROOF_SELECT} where p.completion_id = $1 order by p.created_at`, [row.completion_id])).map((p) => toProofView(p, viewer.userId))
      : [];
    return { session, records, totals: sessionTotals(session), proofs, completionId: row?.completion_id ?? null, unit: viewer.profile.weightUnit };
  });
}


/** What quick add needs to start a workout from anywhere. */
export async function loadStartData(viewer: Viewer): Promise<{ start: StartDay[]; last: Record<string, LastPerformance>; activeId: string | null; nextDayId: string | null } | null> {
  return asUser(viewer.userId, async (q) => {
    const program = await getProgram(q);
    if (!program) return null;
    const [active] = await q.query<{ id: string }>(`select id from workout_sessions where status = 'active' order by started_at desc limit 1`);
    const [lastDay] = await q.query<{ workout_day_id: string | null }>(
      `select workout_day_id from workout_sessions where status = 'completed' and workout_day_id is not null order by performed_on desc, started_at desc limit 1`,
    );
    const next = nextWorkout(program.mode, program.days, lastDay?.workout_day_id ?? null, viewer.today, false);
    const ids = [...new Set(program.days.flatMap((d) => d.exercises.map((e) => e.exerciseId)))];
    return {
      start: program.days.map((d) => ({ id: d.id, name: d.name, weekday: d.weekday, exercises: d.exercises })),
      last: await lastPerformances(q, ids),
      activeId: active?.id ?? null,
      nextDayId: next?.day.id ?? null,
    };
  });
}

/**
 * "gym done" from the command bar: record today's workout without set details. It is a real
 * session — the calendar, the week count, the Gym routine and any group all see it — named after
 * the workout that was next in the program. One per day; a second one belongs in the logger.
 */
export async function quickLogWorkout(viewer: Viewer): Promise<{ ok: true; summary: WorkoutSummary } | { ok: false; error: string }> {
  const start = await loadStartData(viewer);
  if (!start) return { ok: false, error: 'Set up your gym program first.' };
  if (start.activeId) return { ok: false, error: 'A workout is already running — finish it in Gym.' };
  const [already] = await asUser(viewer.userId, (q) =>
    q.query<{ id: string }>(`select id from workout_sessions where status = 'completed' and performed_on = $1 limit 1`, [viewer.today]),
  );
  if (already) return { ok: false, error: 'Today’s workout is already logged.' };
  const day = start.start.find((d) => d.id === start.nextDayId) ?? start.start[0] ?? null;
  const id = crypto.randomUUID();
  const put = await putSession(viewer, id, {
    name: day?.name ?? 'Workout',
    workoutDayId: day?.id ?? null,
    performedOn: viewer.today,
    startedAt: new Date().toISOString(),
    note: null,
    exercises: [],
  });
  if (!put.ok) return put;
  return finishSession(viewer, id, { quick: true });
}
