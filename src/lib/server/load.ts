import 'server-only';
import type { Queryable } from '@/lib/db';
import { clockInZone, type ISODate } from '@/lib/engine/dates';
import type {
  AreaDef, AreaKind, Cadence, CompletionRec, Difficulty, Measure, MissionDef, MissReason, Outcome, ProofPolicy,
  ScheduleVersion,
} from '@/lib/engine/types';

/** Row → engine mappers shared by every read model. */

export interface AreaRow extends AreaDef {
  sortOrder: number;
  icon: string | null;
}

export async function loadAreas(q: Queryable): Promise<AreaRow[]> {
  const rows = await q.query<{ id: string; kind: AreaKind; name: string; sort_order: number; icon: string | null }>(
    `select id, kind, name, sort_order, icon from areas where archived_at is null order by sort_order, created_at`,
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, sortOrder: r.sort_order, icon: r.icon }));
}

export interface MissionMeta extends MissionDef {
  /** owned by a module (Gym program, learning subject): edited there, shown as that module */
  module: 'gym' | 'learning' | null;
  proofPolicy: ProofPolicy;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  notes: string | null;
  projectId: string | null;
  sortOrder: number;
  archivedAt: Date | null;
  createdAt: Date;
  current: ScheduleVersion | null;
}

interface MissionSqlRow {
  id: string;
  area_id: string;
  project_id: string | null;
  title: string;
  measure: Measure;
  unit: string | null;
  target_value: number | null;
  minimum_value: number | null;
  minimum_label: string | null;
  exceed_ratio: number;
  difficulty: Difficulty;
  proof_policy: ProofPolicy;
  time_of_day: MissionMeta['timeOfDay'];
  is_priority: boolean;
  sort_order: number;
  notes: string | null;
  archived_at: Date | null;
  created_at: Date;
  module: 'gym' | 'learning' | null;
  schedules: {
    cadence: Cadence;
    per_week: number | null;
    weekdays: number[] | null;
    due_on: string | null;
    valid_from: string;
    valid_to: string | null;
  }[] | null;
}

export async function loadMissions(q: Queryable, opts: { includeArchived?: boolean; ids?: string[] } = {}): Promise<MissionMeta[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (!opts.includeArchived) where.push('m.archived_at is null');
  if (opts.ids) {
    params.push(opts.ids);
    where.push(`m.id = any($${params.length}::uuid[])`);
  }
  const rows = await q.query<MissionSqlRow>(
    `select m.*,
            (select json_agg(json_build_object(
                'cadence', s.cadence, 'per_week', s.per_week, 'weekdays', s.weekdays, 'due_on', s.due_on,
                'valid_from', s.valid_from, 'valid_to', s.valid_to) order by s.valid_from)
               from mission_schedules s where s.mission_id = m.id) as schedules
       from missions m
      ${where.length ? 'where ' + where.join(' and ') : ''}
      order by m.sort_order, m.created_at`,
    params,
  );
  return rows.map(toMission);
}

function toMission(r: MissionSqlRow): MissionMeta {
  const schedules: ScheduleVersion[] = (r.schedules ?? []).map((s) => ({
    cadence: s.cadence,
    perWeek: s.per_week,
    weekdays: s.weekdays,
    dueOn: s.due_on,
    validFrom: s.valid_from,
    validTo: s.valid_to,
  }));
  return {
    id: r.id,
    areaId: r.area_id,
    title: r.title,
    measure: r.measure,
    unit: r.unit,
    targetValue: r.target_value == null ? null : Number(r.target_value),
    minimumValue: r.minimum_value == null ? null : Number(r.minimum_value),
    minimumLabel: r.minimum_label,
    exceedRatio: Number(r.exceed_ratio),
    difficulty: r.difficulty,
    isPriority: r.is_priority,
    schedules,
    module: r.module ?? null,
    proofPolicy: r.proof_policy,
    timeOfDay: r.time_of_day,
    notes: r.notes,
    projectId: r.project_id,
    sortOrder: r.sort_order,
    archivedAt: r.archived_at,
    createdAt: r.created_at,
    current: schedules.find((s) => s.validTo == null) ?? null,
  };
}

export interface CompletionRow extends CompletionRec {
  id: string;
  note: string | null;
  loggedAt: Date;
  minimumValue: number | null;
}

export async function loadCompletions(q: Queryable, from: ISODate, to: ISODate, timezone: string, missionId?: string): Promise<CompletionRow[]> {
  const rows = await q.query<{
    id: string; mission_id: string; occurred_on: string; outcome: Outcome; kept: boolean; credit: number;
    value: number | null; target_value: number | null; minimum_value: number | null; difficulty: Difficulty;
    logged_at: Date; reason: MissReason | null; note: string | null;
  }>(
    `select id, mission_id, occurred_on, outcome, kept, credit, value, target_value, minimum_value, difficulty,
            logged_at, reason, note
       from completions
      where occurred_on between $1 and $2 ${missionId ? 'and mission_id = $3' : ''}
      order by occurred_on`,
    missionId ? [from, to, missionId] : [from, to],
  );
  return rows.map((r) => ({
    id: r.id,
    missionId: r.mission_id,
    day: r.occurred_on,
    outcome: r.outcome,
    kept: r.kept,
    credit: Number(r.credit),
    value: r.value == null ? null : Number(r.value),
    targetValue: r.target_value == null ? null : Number(r.target_value),
    minimumValue: r.minimum_value == null ? null : Number(r.minimum_value),
    difficulty: r.difficulty,
    loggedHour: clockInZone(new Date(r.logged_at), timezone).hour,
    reason: r.reason,
    note: r.note,
    loggedAt: new Date(r.logged_at),
  }));
}

export async function totalXp(q: Queryable): Promise<number> {
  const [r] = await q.query<{ xp: number }>(`select coalesce(sum(amount), 0)::int8 as xp from xp_events`);
  return Number(r?.xp ?? 0);
}

export async function xpBetween(q: Queryable, from: ISODate, to: ISODate): Promise<number> {
  const [r] = await q.query<{ xp: number }>(
    `select coalesce(sum(amount), 0)::int8 as xp from xp_events where occurred_on between $1 and $2`,
    [from, to],
  );
  return Number(r?.xp ?? 0);
}

export async function marksSpent(q: Queryable): Promise<number> {
  const [r] = await q.query<{ spent: number }>(`select coalesce(sum(cost_marks), 0)::int8 as spent from reward_redemptions`);
  return Number(r?.spent ?? 0);
}

export async function firstActiveDay(q: Queryable): Promise<ISODate | null> {
  const [r] = await q.query<{ d: string | null }>(
    `select least((select min(valid_from) from mission_schedules), (select min(occurred_on) from completions)) as d`,
  );
  return r?.d ?? null;
}
