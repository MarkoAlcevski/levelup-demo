import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, diffDays, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { evaluate, execution, tallyRange, type Evaluation } from '@/lib/engine/metrics';
import { describeCadence, type MissionDay, type WeeklyState } from '@/lib/engine/schedule';
import { missionStreak } from '@/lib/engine/streaks';
import type { AreaKind, Difficulty, Measure, ProofPolicy } from '@/lib/engine/types';
import { AREA_ICONS, isGymKind } from '@/lib/modules';
import type { Viewer } from './profile';
import { loadCompletions, loadMissions, type MissionMeta } from './load';
import { createMissionTx, missionInput } from './missions';
import { loadGoals, type GoalView } from './goals';
import { loadGymToday, type GymToday } from './gym';
import { loadLearningToday, type LearningToday } from './learning';
import { track } from './analytics';

/**
 * Areas are containers the user makes for their own things — Business, Faith, Coding — holding
 * routines, tasks, goals and optional projects. Gym and Learning are areas with a specialised
 * tool on top. Archiving an area pauses its routines (their schedules close today) and remembers
 * them, so Restore brings everything back; history is never deleted.
 */

export interface RoutineView {
  id: string;
  title: string;
  areaId: string;
  measure: Measure;
  unit: string | null;
  target: number | null;
  minimum: number | null;
  minimumLabel: string | null;
  difficulty: Difficulty;
  proofPolicy: ProofPolicy;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  isPriority: boolean;
  notes: string | null;
  cadence: 'daily' | 'weekly' | 'days' | 'once';
  cadenceLabel: string;
  perWeek: number | null;
  weekdays: number[] | null;
  dueOn: ISODate | null;
  projectId: string | null;
  module: 'gym' | 'learning' | null;
  execution30: number | null;
  weekly: WeeklyState | null;
  week: { kept: number; due: number };
  streak: { current: number; unit: 'day' | 'week' };
  doneOn: ISODate | null;
}

export interface AreaCard {
  id: string;
  kind: AreaKind;
  name: string;
  icon: string | null;
  routines: number;
  tasksOpen: number;
  week: { kept: number; due: number };
  execution30: number | null;
  preview: string[];
}

export interface AreasPage {
  today: ISODate;
  modules: ('gym' | 'learning' | 'money')[];
  gym: GymToday | null;
  learning: LearningToday[];
  gymArea: { id: string } | null;
  learningArea: { id: string } | null;
  areas: AreaCard[];
  archived: { id: string; kind: AreaKind; name: string; icon: string | null; routines: number }[];
}

export function toRoutine(m: MissionMeta, mds: MissionDay[], today: ISODate, weekStart: ISODate, ev: Evaluation, doneOn: ISODate | null): RoutineView {
  const v = m.current;
  const t30 = tallyRange(ev, addDays(today, -29), today, (x) => x.id === m.id);
  const tw = tallyRange(ev, weekStart, today, (x) => x.id === m.id);
  const md = mds[mds.length - 1];
  const s = missionStreak(mds, today);
  return {
    id: m.id, title: m.title, areaId: m.areaId, measure: m.measure, unit: m.unit, target: m.targetValue, minimum: m.minimumValue,
    minimumLabel: m.minimumLabel, difficulty: m.difficulty, proofPolicy: m.proofPolicy, timeOfDay: m.timeOfDay, isPriority: m.isPriority,
    notes: m.notes, cadence: v?.cadence ?? 'daily', cadenceLabel: describeCadence(v), perWeek: v?.perWeek ?? null, weekdays: v?.weekdays ?? null,
    dueOn: v?.dueOn ?? null, projectId: m.projectId, module: m.module, execution30: execution(t30), weekly: md?.weekly ?? null,
    week: { kept: tw.kept + tw.extra, due: tw.settledDue + tw.open }, streak: { current: s.current, unit: s.unit }, doneOn,
  };
}

async function evaluateAll(q: Queryable, viewer: Viewer) {
  const { today, profile } = viewer;
  const from = addDays(today, -41);
  const [missions, completions, onceDone] = await Promise.all([
    loadMissions(q, { includeArchived: true }),
    loadCompletions(q, addDays(from, -7), today, profile.timezone),
    q.query<{ mission_id: string; d: string }>(
      `select c.mission_id, min(c.occurred_on) as d from completions c
         join mission_schedules s on s.mission_id = c.mission_id and s.valid_to is null and s.cadence = 'once'
        where c.kept group by c.mission_id`,
    ),
  ]);
  const ev = evaluate(missions, completions, from, today, { today, weekStartsOn: profile.weekStartsOn });
  return { missions, ev, onceDone: new Map(onceDone.map((r) => [r.mission_id, r.d])) };
}

export async function loadAreasPage(viewer: Viewer): Promise<AreasPage> {
  const { today, profile } = viewer;
  const weekStart = startOfWeek(today, profile.weekStartsOn);
  return asUser(viewer.userId, async (q) => {
    const rows = await q.query<{ id: string; kind: AreaKind; name: string; icon: string | null; sort_order: number; archived_at: Date | null; archived_schedules: unknown }>(
      `select id, kind, name, icon, sort_order, archived_at, archived_schedules from areas order by sort_order, created_at`,
    );
    const { missions, ev, onceDone } = await evaluateAll(q, viewer);
    const gymArea = rows.find((a) => !a.archived_at && isGymKind(a.kind)) ?? null;
    const learningArea = rows.find((a) => !a.archived_at && a.kind === 'learning') ?? null;
    const areas: AreaCard[] = [];
    for (const a of rows.filter((r) => !r.archived_at)) {
      if (a.id === gymArea?.id || a.id === learningArea?.id) continue;
      const own = missions.filter((m) => m.areaId === a.id && !m.archivedAt);
      const f = (m: { areaId: string }) => m.areaId === a.id;
      const tw = tallyRange(ev, weekStart, today, f);
      const routines = own.filter((m) => m.current && m.current.cadence !== 'once');
      const tasksOpen = own.filter((m) => m.current?.cadence === 'once' && !onceDone.has(m.id));
      areas.push({
        id: a.id, kind: a.kind, name: a.name, icon: a.icon, routines: routines.length, tasksOpen: tasksOpen.length,
        week: { kept: tw.kept + tw.extra, due: tw.settledDue + tw.open },
        execution30: execution(tallyRange(ev, addDays(today, -29), today, f)),
        preview: [...routines, ...tasksOpen].slice(0, 3).map((m) => m.title),
      });
    }
    const gymMission = missions.find((m) => m.module === 'gym' && !m.archivedAt);
    const gymKept = gymMission ? !!ev.byMission.get(gymMission.id)?.at(-1)?.completion?.kept : false;
    const statusOf = (id: string) => ev.byMission.get(id)?.at(-1)?.status ?? null;
    return {
      today,
      modules: profile.modules,
      gym: await loadGymToday(q, viewer, gymKept),
      learning: await loadLearningToday(q, viewer, statusOf),
      gymArea: gymArea ? { id: gymArea.id } : null,
      learningArea: learningArea ? { id: learningArea.id } : null,
      areas,
      archived: rows
        .filter((r) => r.archived_at)
        .map((r) => ({ id: r.id, kind: r.kind, name: r.name, icon: r.icon, routines: missions.filter((m) => m.areaId === r.id).length })),
    };
  });
}

export interface ProjectView {
  id: string;
  title: string;
  status: 'active' | 'done' | 'dropped';
  targetOn: ISODate | null;
  tasks: RoutineView[];
  done: number;
}

export interface AreaDetail {
  today: ISODate;
  area: { id: string; kind: AreaKind; name: string; icon: string | null; archived: boolean };
  routines: RoutineView[];
  tasks: RoutineView[];
  doneTasks: RoutineView[];
  projects: ProjectView[];
  goals: GoalView[];
  stats: { week: { kept: number; due: number }; execution30: number | null; prev30: number | null };
  areas: { id: string; kind: AreaKind; name: string; icon: string | null }[];
}

export async function loadAreaDetail(viewer: Viewer, id: string): Promise<AreaDetail | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const { today, profile } = viewer;
  const weekStart = startOfWeek(today, profile.weekStartsOn);
  return asUser(viewer.userId, async (q) => {
    const [a] = await q.query<{ id: string; kind: AreaKind; name: string; icon: string | null; archived_at: Date | null }>(
      `select id, kind, name, icon, archived_at from areas where id = $1`,
      [id],
    );
    if (!a) return null;
    const { missions, ev, onceDone } = await evaluateAll(q, viewer);
    const own = missions.filter((m) => m.areaId === id && !m.archivedAt && !m.module);
    const views = own.map((m) => toRoutine(m, ev.byMission.get(m.id)!, today, weekStart, ev, onceDone.get(m.id) ?? null));
    const routines = views.filter((r) => r.cadence !== 'once');
    const tasks = views.filter((r) => r.cadence === 'once' && !r.doneOn).sort((x, y) => (x.dueOn ?? '9999') < (y.dueOn ?? '9999') ? -1 : 1);
    const doneTasks = views.filter((r) => r.cadence === 'once' && r.doneOn).sort((x, y) => (x.doneOn! < y.doneOn! ? 1 : -1));
    const projectRows = await q.query<{ id: string; title: string; status: ProjectView['status']; target_on: string | null }>(
      `select id, title, status, target_on from projects where area_id = $1 and status <> 'dropped' order by created_at`,
      [id],
    );
    const f = (m: { areaId: string }) => m.areaId === id;
    const [allAreas, goals] = await Promise.all([
      q.query<{ id: string; kind: AreaKind; name: string; icon: string | null }>(`select id, kind, name, icon from areas where archived_at is null order by sort_order`),
      loadGoals(q, viewer, { areaId: id }),
    ]);
    const tw = tallyRange(ev, weekStart, today, f);
    return {
      today,
      area: { id: a.id, kind: a.kind, name: a.name, icon: a.icon, archived: !!a.archived_at },
      routines,
      tasks: tasks.filter((t) => !t.projectId),
      doneTasks: doneTasks.filter((t) => !t.projectId).slice(0, 10),
      projects: projectRows.map((p) => {
        const pt = views.filter((v) => v.projectId === p.id);
        return { id: p.id, title: p.title, status: p.status, targetOn: p.target_on, tasks: pt, done: pt.filter((t) => t.doneOn).length };
      }),
      goals,
      stats: {
        week: { kept: tw.kept + tw.extra, due: tw.settledDue + tw.open },
        execution30: execution(tallyRange(ev, addDays(today, -29), today, f)),
        prev30: execution(tallyRange(ev, addDays(today, -59), addDays(today, -30), f)),
      },
      areas: allAreas.filter((x) => !isGymKind(x.kind) && x.kind !== 'learning'),
    };
  });
}

// ───────────────────────────────────────────── mutations

const iconKey = z.enum(AREA_ICONS).nullable().optional();

const areaInput = z.object({
  name: z.string().trim().min(1, 'Name the area.').max(40),
  icon: iconKey,
  firstRoutine: z
    .object({
      title: z.string().trim().min(1).max(120),
      cadence: z.enum(['daily', 'weekly', 'days']),
      perWeek: z.number().int().min(1).max(7).nullable().optional(),
      weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).nullable().optional(),
    })
    .nullable()
    .optional(),
});
export type AreaInput = z.input<typeof areaInput>;

export async function createAreaTx(q: Queryable, viewer: Viewer, v: z.output<typeof areaInput>): Promise<string> {
  const [a] = await q.query<{ id: string }>(
    `insert into areas (kind, name, icon, sort_order) values ('custom', $1, $2, (select coalesce(max(sort_order), 0) + 1 from areas)) returning id`,
    [v.name, v.icon ?? null],
  );
  if (v.firstRoutine) {
    const r = v.firstRoutine;
    await createMissionTx(
      q,
      missionInput.parse({
        title: r.title, areaId: a.id, cadence: r.cadence,
        perWeek: r.cadence === 'weekly' ? r.perWeek ?? 1 : null, weekdays: r.cadence === 'days' ? r.weekdays ?? [1] : null,
      }),
      viewer.today,
    );
  }
  return a.id;
}

export async function createArea(viewer: Viewer, raw: AreaInput) {
  const parsed = areaInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the area.' };
  const id = await asUser(viewer.userId, (q) => createAreaTx(q, viewer, parsed.data));
  void track(viewer.userId, 'area_created', { routine: !!parsed.data.firstRoutine });
  return { ok: true as const, id };
}

export async function updateArea(viewer: Viewer, id: string, raw: { name: string; icon?: string | null }) {
  const parsed = z.object({ name: z.string().trim().min(1, 'Name the area.').max(40), icon: iconKey }).safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(id).success) return { ok: false as const, error: parsed.error?.issues[0]?.message ?? 'Check the area.' };
  const rows = await asUser(viewer.userId, (q) => q.query(`update areas set name = $2, icon = $3 where id = $1 returning id`, [id, parsed.data.name, parsed.data.icon ?? null]));
  return rows.length ? { ok: true as const } : { ok: false as const, error: 'Area not found.' };
}

export async function reorderAreas(viewer: Viewer, ids: string[]) {
  if (!z.array(z.uuid()).max(100).safeParse(ids).success) return { ok: false as const, error: 'Invalid order.' };
  await asUser(viewer.userId, async (q) => {
    for (const [i, id] of ids.entries()) await q.query(`update areas set sort_order = $2 where id = $1`, [id, i + 1]);
  });
  return { ok: true as const };
}

interface ArchivedSchedule {
  mission_id: string;
  cadence: string;
  per_week: number | null;
  weekdays: number[] | null;
  due_on: string | null;
}

export async function archiveArea(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid area.' };
  const today = viewer.today;
  const ok = await asUser(viewer.userId, async (q) => {
    const open = await q.query<ArchivedSchedule & { id: string; valid_from: string }>(
      `select s.id, s.mission_id, s.cadence, s.per_week, s.weekdays, s.due_on, s.valid_from
         from mission_schedules s join missions m on m.id = s.mission_id
        where m.area_id = $1 and m.archived_at is null and s.valid_to is null`,
      [id],
    );
    const updated = await q.query(
      `update areas set archived_at = now(), archived_schedules = $2 where id = $1 and archived_at is null returning id`,
      [id, JSON.stringify(open.map(({ mission_id, cadence, per_week, weekdays, due_on }) => ({ mission_id, cadence, per_week, weekdays, due_on })))],
    );
    if (!updated.length) return false;
    for (const s of open) {
      if (s.valid_from >= today) await q.query(`delete from mission_schedules where id = $1`, [s.id]);
      else await q.query(`update mission_schedules set valid_to = $2 where id = $1`, [s.id, today]);
    }
    return true;
  });
  if (ok) void track(viewer.userId, 'area_archived', {});
  return ok ? { ok: true as const } : { ok: false as const, error: 'Area not found.' };
}

export async function restoreArea(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid area.' };
  const ok = await asUser(viewer.userId, async (q) => {
    const [a] = await q.query<{ archived_schedules: ArchivedSchedule[] | null }>(
      `select archived_schedules from areas where id = $1 and archived_at is not null`,
      [id],
    );
    if (!a) return false;
    await q.query(`update areas set archived_at = null, archived_schedules = null where id = $1`, [id]);
    for (const s of a.archived_schedules ?? []) {
      const [still] = await q.query<{ id: string }>(`select id from missions where id = $1 and archived_at is null`, [s.mission_id]);
      if (!still) continue;
      const [openNow] = await q.query<{ id: string }>(`select id from mission_schedules where mission_id = $1 and valid_to is null`, [s.mission_id]);
      if (openNow) continue;
      // a version that closed today can simply reopen; otherwise start a new one from today
      const reopened = await q.query(`update mission_schedules set valid_to = null where mission_id = $1 and valid_to = $2 returning id`, [s.mission_id, viewer.today]);
      if (!reopened.length) {
        await q.query(
          `insert into mission_schedules (mission_id, cadence, per_week, weekdays, due_on, valid_from) values ($1, $2, $3, $4, $5, $6)`,
          [s.mission_id, s.cadence, s.per_week, s.weekdays, s.due_on, viewer.today],
        );
      }
    }
    return true;
  });
  return ok ? { ok: true as const } : { ok: false as const, error: 'Area not found.' };
}

// ───────────────────────────────────────────── projects

const projectInput = z.object({
  areaId: z.uuid(),
  title: z.string().trim().min(1, 'Name the project.').max(120),
  targetOn: z.iso.date().nullable().optional(),
});

export async function createProject(viewer: Viewer, raw: z.input<typeof projectInput>) {
  const parsed = projectInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the project.' };
  const [p] = await asUser(viewer.userId, (q) =>
    q.query<{ id: string }>(`insert into projects (area_id, title, target_on) values ($1, $2, $3) returning id`, [parsed.data.areaId, parsed.data.title, parsed.data.targetOn ?? null]),
  );
  return { ok: true as const, id: p.id };
}

export async function setProjectStatus(viewer: Viewer, id: string, status: 'active' | 'done' | 'dropped') {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid project.' };
  await asUser(viewer.userId, (q) =>
    q.query(`update projects set status = $2, completed_at = case when $2 = 'done' then now() else null end where id = $1`, [id, status]),
  );
  return { ok: true as const };
}

export function weekDaysLeft(today: ISODate, weekStartsOn: number): number {
  return diffDays(today, addDays(startOfWeek(today, weekStartsOn), 6)) + 1;
}
