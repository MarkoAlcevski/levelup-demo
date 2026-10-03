import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, diffDays, startOfMonth, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { evaluate } from '@/lib/engine/metrics';
import { missionStreak } from '@/lib/engine/streaks';
import { versionAt } from '@/lib/engine/schedule';
import type { Viewer } from './profile';
import { loadCompletions, loadMissions } from './load';
import { createMissionTx, missionInput, rescheduleMissionTx } from './missions';
import { MAX_BACKFILL_DAYS, removeCompletionTx, upsertCompletionTx } from './completions';
import { afterCompletionChange } from './group-activity';
import { track } from './analytics';

/**
 * Learning, measured the way the user chose: minutes, sessions, pages, lessons or their own unit,
 * with a weekly target they set. Each subject rides on its own routine in the engine
 * (days_per_week × a per-day share of the weekly target), and every day's completion is recomputed
 * from that day's sessions — so a session edited or deleted later can never leave stale credit.
 */

export type LearningMeasure = 'minutes' | 'sessions' | 'pages' | 'lessons' | 'custom';

export interface Subject {
  id: string;
  name: string;
  measure: LearningMeasure;
  unit: string | null;
  weeklyTarget: number;
  daysPerWeek: number;
  missionId: string | null;
  sortOrder: number;
}

export function unitOf(s: Pick<Subject, 'measure' | 'unit'>): string {
  return s.measure === 'minutes' ? 'min' : s.measure === 'custom' ? s.unit ?? 'units' : s.measure;
}

export function perDayTarget(s: Pick<Subject, 'measure' | 'weeklyTarget' | 'daysPerWeek'>): number {
  if (s.measure === 'sessions') return 1;
  const v = s.weeklyTarget / s.daysPerWeek;
  return s.measure === 'minutes' ? Math.max(1, Math.round(v)) : Math.max(0.1, Math.round(v * 10) / 10);
}

function missionShape(s: Pick<Subject, 'measure' | 'unit' | 'weeklyTarget' | 'daysPerWeek'>) {
  return s.measure === 'minutes'
    ? { measure: 'duration' as const, unit: 'min', targetValue: perDayTarget(s) }
    : { measure: 'quantity' as const, unit: s.measure === 'custom' ? (s.unit ?? 'units').slice(0, 16) : s.measure, targetValue: perDayTarget(s) };
}

async function listSubjects(q: Queryable, includeArchived = false): Promise<Subject[]> {
  const rows = await q.query<{ id: string; name: string; measure: LearningMeasure; unit: string | null; weekly_target: number; days_per_week: number; mission_id: string | null; sort_order: number }>(
    `select id, name, measure, unit, weekly_target, days_per_week, mission_id, sort_order from learning_subjects
      ${includeArchived ? '' : 'where archived_at is null'} order by sort_order, created_at`,
  );
  return rows.map((r) => ({
    id: r.id, name: r.name, measure: r.measure, unit: r.unit, weeklyTarget: Number(r.weekly_target), daysPerWeek: r.days_per_week,
    missionId: r.mission_id, sortOrder: r.sort_order,
  }));
}

async function ensureLearningArea(q: Queryable): Promise<string> {
  const [a] = await q.query<{ id: string }>(`select id from areas where kind = 'learning' and archived_at is null order by sort_order limit 1`);
  if (a) return a.id;
  const [n] = await q.query<{ id: string }>(
    `insert into areas (kind, name, sort_order) values ('learning', 'Learning', coalesce((select min(sort_order) from areas), 1)) returning id`,
  );
  return n.id;
}

const subjectInput = z
  .object({
    name: z.string().trim().min(1, 'Name the subject.').max(60),
    measure: z.enum(['minutes', 'sessions', 'pages', 'lessons', 'custom']),
    unit: z.string().trim().min(1).max(16).nullable().optional(),
    weeklyTarget: z.number().positive('Set a weekly target.').max(100000),
    daysPerWeek: z.number().int().min(1).max(7),
  })
  .superRefine((v, ctx) => {
    if (v.measure === 'custom' && !v.unit) ctx.addIssue({ code: 'custom', path: ['unit'], message: 'Name the unit you’re counting.' });
    if (v.measure === 'sessions' && v.weeklyTarget !== v.daysPerWeek) {
      // sessions/week and days/week are the same number for a sessions target
    }
  });
export type SubjectInput = z.input<typeof subjectInput>;

export async function createSubject(viewer: Viewer, raw: SubjectInput) {
  const parsed = subjectInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the subject.' };
  const v = { ...parsed.data, daysPerWeek: parsed.data.measure === 'sessions' ? Math.min(7, Math.ceil(parsed.data.weeklyTarget)) : parsed.data.daysPerWeek };
  const res = await asUser(viewer.userId, async (q) => {
    const areaId = await ensureLearningArea(q);
    const shape = missionShape({ ...v, unit: v.unit ?? null });
    const missionId = await createMissionTx(
      q,
      missionInput.parse({ title: v.name, areaId, ...shape, difficulty: 'normal', proofPolicy: 'optional', cadence: 'weekly', perWeek: v.daysPerWeek }),
      viewer.today,
      undefined,
      'learning',
    );
    const [s] = await q.query<{ id: string }>(
      `insert into learning_subjects (name, measure, unit, weekly_target, days_per_week, mission_id, sort_order)
       values ($1, $2, $3, $4, $5, $6, coalesce((select max(sort_order) + 1 from learning_subjects), 0)) returning id`,
      [v.name, v.measure, v.measure === 'custom' ? v.unit : null, v.weeklyTarget, v.daysPerWeek, missionId],
    );
    await q.query(`update profiles set modules = array_append(modules, 'learning') where id = $1 and not ('learning' = any(modules))`, [viewer.userId]);
    return { ok: true as const, id: s.id };
  });
  if (res.ok) void track(viewer.userId, 'learning_subject_created', { measure: v.measure });
  return res;
}

/** A new target applies from today; last month's weeks are still judged by last month's target. */
export async function updateSubject(viewer: Viewer, id: string, raw: SubjectInput) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid subject.' };
  const parsed = subjectInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the subject.' };
  const v = { ...parsed.data, daysPerWeek: parsed.data.measure === 'sessions' ? Math.min(7, Math.ceil(parsed.data.weeklyTarget)) : parsed.data.daysPerWeek };
  return asUser(viewer.userId, async (q) => {
    const [cur] = await q.query<{ mission_id: string | null }>(`select mission_id from learning_subjects where id = $1`, [id]);
    if (!cur) return { ok: false as const, error: 'Subject not found.' };
    await q.query(
      `update learning_subjects set name = $2, measure = $3, unit = $4, weekly_target = $5, days_per_week = $6 where id = $1`,
      [id, v.name, v.measure, v.measure === 'custom' ? v.unit : null, v.weeklyTarget, v.daysPerWeek],
    );
    if (cur.mission_id) {
      const shape = missionShape({ ...v, unit: v.unit ?? null });
      await q.query(`update missions set title = $2, measure = $3, unit = $4, target_value = $5 where id = $1`, [cur.mission_id, v.name, shape.measure, shape.unit, shape.targetValue]);
      await rescheduleMissionTx(q, cur.mission_id, { cadence: 'weekly', perWeek: v.daysPerWeek }, viewer.today);
    }
    return { ok: true as const };
  });
}

export async function archiveSubject(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid subject.' };
  await asUser(viewer.userId, async (q) => {
    const [s] = await q.query<{ mission_id: string | null }>(`update learning_subjects set archived_at = now() where id = $1 returning mission_id`, [id]);
    if (s?.mission_id) {
      await q.query(`update missions set archived_at = now() where id = $1`, [s.mission_id]);
      await q.query(`delete from mission_schedules where mission_id = $1 and valid_to is null and valid_from >= $2`, [s.mission_id, viewer.today]);
      await q.query(`update mission_schedules set valid_to = $2 where mission_id = $1 and valid_to is null`, [s.mission_id, viewer.today]);
    }
  });
  return { ok: true as const };
}

/**
 * V1 routines in a Learning area ("Read · 30 min daily") can become subjects without losing a day
 * of history: the subject simply adopts the existing routine and its schedule.
 */
export async function adoptRoutineAsSubject(viewer: Viewer, missionId: string) {
  if (!z.uuid().safeParse(missionId).success) return { ok: false as const, error: 'Invalid routine.' };
  return asUser(viewer.userId, async (q) => {
    const [m] = await loadMissions(q, { ids: [missionId] });
    if (!m || m.module) return { ok: false as const, error: 'That routine can’t be adopted.' };
    const v = m.current;
    const days = v?.cadence === 'weekly' ? v.perWeek ?? 1 : v?.cadence === 'days' ? (v.weekdays ?? []).length : v?.cadence === 'daily' ? 7 : 1;
    const measure: LearningMeasure = m.measure === 'duration' ? 'minutes' : m.measure === 'check' ? 'sessions' : m.unit === 'pages' || m.unit === 'lessons' ? (m.unit as LearningMeasure) : 'custom';
    const weekly = measure === 'sessions' ? days : (m.targetValue ?? 1) * days;
    await q.query(`update missions set module = 'learning' where id = $1`, [m.id]);
    if (m.measure === 'check') {
      await q.query(`update missions set measure = 'quantity', unit = 'sessions', target_value = 1 where id = $1`, [m.id]);
    }
    await q.query(
      `insert into learning_subjects (name, measure, unit, weekly_target, days_per_week, mission_id, sort_order)
       values ($1, $2, $3, $4, $5, $6, coalesce((select max(sort_order) + 1 from learning_subjects), 0))`,
      [m.title.slice(0, 60), measure, measure === 'custom' ? (m.unit ?? 'units') : null, weekly, Math.max(1, Math.min(7, days)), m.id],
    );
    return { ok: true as const };
  });
}

// ───────────────────────────────────────────── sessions

/** Recompute one day of one subject from its sessions and write (or remove) the completion. */
async function syncDay(q: Queryable, viewer: Viewer, subject: Subject, day: ISODate): Promise<boolean> {
  if (!subject.missionId || diffDays(day, viewer.today) > MAX_BACKFILL_DAYS || day > viewer.today) return false;
  const [agg] = await q.query<{ minutes: number; quantity: number; n: number }>(
    `select coalesce(sum(minutes), 0)::int as minutes, coalesce(sum(quantity), 0) as quantity, count(*)::int as n
       from learning_sessions where subject_id = $1 and performed_on = $2 and status = 'completed'`,
    [subject.id, day],
  );
  const value = subject.measure === 'minutes' ? Number(agg.minutes) : subject.measure === 'sessions' ? agg.n : Number(agg.quantity);
  if (value > 0) {
    await upsertCompletionTx(q, viewer, { missionId: subject.missionId, day, value, source: 'learning' });
  } else {
    const [c] = await q.query<{ source: string }>(`select source from completions where mission_id = $1 and occurred_on = $2`, [subject.missionId, day]);
    if (c?.source === 'learning') {
      const cleanup = await removeCompletionTx(q, viewer, subject.missionId, day);
      if (cleanup) await cleanup();
    }
  }
  return true;
}

const sessionInput = z.object({
  subjectId: z.uuid(),
  day: z.iso.date(),
  minutes: z.number().int().min(0).max(1440).nullable().optional(),
  quantity: z.number().min(0).max(100000).nullable().optional(),
  topic: z.string().trim().max(120).nullable().optional(),
  note: z.string().trim().max(2000).nullable().optional(),
});
export type LearningSessionInput = z.input<typeof sessionInput>;

export async function logLearningSession(viewer: Viewer, raw: LearningSessionInput, id?: string) {
  const parsed = sessionInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the session.' };
  const v = parsed.data;
  if (v.day > viewer.today) return { ok: false as const, error: 'That day hasn’t happened yet.' };
  if (diffDays(v.day, viewer.today) > MAX_BACKFILL_DAYS) return { ok: false as const, error: `Sessions can be logged up to ${MAX_BACKFILL_DAYS} days back.` };
  if (!(v.minutes && v.minutes > 0) && !(v.quantity && v.quantity > 0)) return { ok: false as const, error: 'Enter how long, or how much.' };
  const out = await asUser(viewer.userId, async (q) => {
    const subjects = await listSubjects(q, true);
    const subject = subjects.find((s) => s.id === v.subjectId);
    if (!subject) return { ok: false as const, error: 'Subject not found.' };
    let oldDay: ISODate | null = null;
    let sessionId: string;
    if (id) {
      const [cur] = await q.query<{ performed_on: string; subject_id: string }>(`select performed_on, subject_id from learning_sessions where id = $1`, [id]);
      if (!cur) return { ok: false as const, error: 'Session not found.' };
      oldDay = cur.performed_on;
      await q.query(
        `update learning_sessions set subject_id = $2, performed_on = $3, minutes = $4, quantity = $5, topic = $6, note = $7, status = 'completed',
                finished_at = coalesce(finished_at, now()) where id = $1`,
        [id, v.subjectId, v.day, v.minutes ?? null, v.quantity ?? null, v.topic || null, v.note || null],
      );
      sessionId = id;
      if (cur.subject_id !== v.subjectId) {
        const prev = subjects.find((s) => s.id === cur.subject_id);
        if (prev) await syncDay(q, viewer, prev, cur.performed_on);
      }
    } else {
      const [row] = await q.query<{ id: string }>(
        `insert into learning_sessions (subject_id, performed_on, minutes, quantity, topic, note, status, finished_at)
         values ($1, $2, $3, $4, $5, $6, 'completed', now()) returning id`,
        [v.subjectId, v.day, v.minutes ?? null, v.quantity ?? null, v.topic || null, v.note || null],
      );
      sessionId = row.id;
    }
    await syncDay(q, viewer, subject, v.day);
    if (oldDay && oldDay !== v.day) await syncDay(q, viewer, subject, oldDay);
    const week = await subjectWeek(q, viewer, subject, v.day);
    return { ok: true as const, id: sessionId, missionId: subject.missionId, week, subjectName: subject.name };
  });
  if (out.ok) {
    void track(viewer.userId, 'learning_session_logged', { measure: 'manual' });
    if (out.missionId) await afterCompletionChange(viewer, out.missionId, v.day);
  }
  return out;
}

export async function startLearningSession(viewer: Viewer, subjectId: string) {
  if (!z.uuid().safeParse(subjectId).success) return { ok: false as const, error: 'Invalid subject.' };
  return asUser(viewer.userId, async (q) => {
    const [active] = await q.query<{ id: string }>(`select id from learning_sessions where status = 'active' limit 1`);
    if (active) return { ok: true as const, id: active.id, resumed: true };
    const [row] = await q.query<{ id: string }>(
      `insert into learning_sessions (subject_id, performed_on, started_at, status) values ($1, $2, now(), 'active') returning id`,
      [subjectId, viewer.today],
    );
    return { ok: true as const, id: row.id, resumed: false };
  });
}

export async function finishLearningSession(viewer: Viewer, id: string, raw: { minutes?: number | null; quantity?: number | null; topic?: string | null; note?: string | null }) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid session.' };
  const [s] = await asUser(viewer.userId, (q) =>
    q.query<{ subject_id: string; started_at: Date | null; performed_on: string }>(`select subject_id, started_at, performed_on from learning_sessions where id = $1 and status = 'active'`, [id]),
  );
  if (!s) return { ok: false as const, error: 'That session has already been saved.' };
  const elapsed = s.started_at ? Math.max(1, Math.round((Date.now() - new Date(s.started_at).getTime()) / 60000)) : null;
  return logLearningSession(viewer, { subjectId: s.subject_id, day: s.performed_on, minutes: raw.minutes ?? elapsed, quantity: raw.quantity ?? null, topic: raw.topic, note: raw.note }, id);
}

export async function deleteLearningSession(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid session.' };
  const res = await asUser(viewer.userId, async (q) => {
    const [s] = await q.query<{ subject_id: string; performed_on: string; status: string }>(`delete from learning_sessions where id = $1 returning subject_id, performed_on, status`, [id]);
    if (!s || s.status !== 'completed') return null;
    const subject = (await listSubjects(q, true)).find((x) => x.id === s.subject_id);
    if (subject) await syncDay(q, viewer, subject, s.performed_on);
    return subject?.missionId ? { missionId: subject.missionId, day: s.performed_on } : null;
  });
  if (res) await afterCompletionChange(viewer, res.missionId, res.day);
  return { ok: true as const };
}

// ───────────────────────────────────────────── read models

export interface SubjectWeek {
  done: number;
  target: number;
  sessions: number;
  days: number;
}

async function subjectWeek(q: Queryable, viewer: Viewer, s: Subject, day: ISODate): Promise<SubjectWeek> {
  const ws = startOfWeek(day, viewer.profile.weekStartsOn);
  const [agg] = await q.query<{ minutes: number; quantity: number; n: number; days: number }>(
    `select coalesce(sum(minutes), 0)::int as minutes, coalesce(sum(quantity), 0) as quantity, count(*)::int as n,
            count(distinct performed_on)::int as days
       from learning_sessions where subject_id = $1 and status = 'completed' and performed_on between $2 and $3`,
    [s.id, ws, addDays(ws, 6)],
  );
  const done = s.measure === 'minutes' ? Number(agg.minutes) : s.measure === 'sessions' ? agg.n : Number(agg.quantity);
  return { done, target: s.weeklyTarget, sessions: agg.n, days: agg.days };
}

export interface SessionRow {
  id: string;
  subjectId: string;
  subject: string;
  measure: LearningMeasure;
  unit: string | null;
  on: ISODate;
  minutes: number | null;
  quantity: number | null;
  topic: string | null;
  note: string | null;
}

export interface SubjectView extends Subject {
  week: SubjectWeek;
  todayAmount: number;
  perDay: number;
  totalMinutes: number;
  totalAmount: number;
  sessions: number;
  weekStreak: number;
  bestWeekStreak: number;
  lastOn: ISODate | null;
  /** weekly amount, last 12 weeks, oldest first */
  trend: number[];
}

export interface LearningHome {
  today: ISODate;
  subjects: SubjectView[];
  active: { id: string; subjectId: string; subject: string; startedAt: string } | null;
  recent: SessionRow[];
  totals: { weekMinutes: number; monthMinutes: number; allMinutes: number; sessions: number };
  legacy: { id: string; title: string }[];
  mostConsistent: { name: string; rate: number } | null;
}

export async function loadLearning(viewer: Viewer): Promise<LearningHome> {
  const { today, profile } = viewer;
  const ws = profile.weekStartsOn;
  return asUser(viewer.userId, async (q) => {
    const subjects = await listSubjects(q);
    const from = addDays(startOfWeek(today, ws), -7 * 12);
    const [sessions, active, legacy, totals] = await Promise.all([
      q.query<{ id: string; subject_id: string; performed_on: string; minutes: number | null; quantity: number | null; topic: string | null; note: string | null }>(
        `select id, subject_id, performed_on, minutes, quantity, topic, note from learning_sessions
          where status = 'completed' and performed_on >= $1 order by performed_on desc, created_at desc`,
        [from],
      ),
      q.query<{ id: string; subject_id: string; started_at: Date }>(`select id, subject_id, started_at from learning_sessions where status = 'active' order by started_at desc limit 1`),
      q.query<{ id: string; title: string }>(
        `select m.id, m.title from missions m join areas a on a.id = m.area_id
          where a.kind = 'learning' and m.module is null and m.archived_at is null order by m.sort_order`,
      ),
      q.query<{ subject_id: string; minutes: number; quantity: number; n: number; last: string | null }>(
        `select subject_id, coalesce(sum(minutes), 0)::int as minutes, coalesce(sum(quantity), 0) as quantity, count(*)::int as n, max(performed_on) as last
           from learning_sessions where status = 'completed' group by subject_id`,
      ),
    ]);
    const missionIds = subjects.map((s) => s.missionId).filter((x): x is string => !!x);
    const missions = missionIds.length ? await loadMissions(q, { ids: missionIds, includeArchived: true }) : [];
    const comps = missionIds.length ? await loadCompletions(q, addDays(from, -7), today, profile.timezone) : [];
    const ev = missions.length ? evaluate(missions, comps.filter((c) => missionIds.includes(c.missionId)), from, today, { today, weekStartsOn: ws }) : null;
    const totalOf = new Map(totals.map((t) => [t.subject_id, t]));
    const thisWeek = startOfWeek(today, ws);
    const amount = (s: Subject, list: typeof sessions) =>
      s.measure === 'minutes' ? list.reduce((a, x) => a + (x.minutes ?? 0), 0) : s.measure === 'sessions' ? list.length : list.reduce((a, x) => a + Number(x.quantity ?? 0), 0);

    const views: SubjectView[] = subjects.map((s) => {
      const own = sessions.filter((x) => x.subject_id === s.id);
      const trend: number[] = [];
      for (let k = 11; k >= 0; k--) {
        const w = addDays(thisWeek, -7 * k);
        trend.push(amount(s, own.filter((x) => x.performed_on >= w && x.performed_on <= addDays(w, 6))));
      }
      const mds = s.missionId ? ev?.byMission.get(s.missionId) : undefined;
      const streak = mds ? missionStreak(mds, today) : { current: 0, best: 0 };
      const t = totalOf.get(s.id);
      const weekList = own.filter((x) => x.performed_on >= thisWeek);
      return {
        ...s,
        week: { done: amount(s, weekList), target: s.weeklyTarget, sessions: weekList.length, days: new Set(weekList.map((x) => x.performed_on)).size },
        todayAmount: amount(s, own.filter((x) => x.performed_on === today)),
        perDay: perDayTarget(s),
        totalMinutes: t?.minutes ?? 0,
        totalAmount: s.measure === 'minutes' ? t?.minutes ?? 0 : s.measure === 'sessions' ? t?.n ?? 0 : Number(t?.quantity ?? 0),
        sessions: t?.n ?? 0,
        weekStreak: streak.current,
        bestWeekStreak: streak.best,
        lastOn: t?.last ?? null,
        trend,
      };
    });
    const nameOf = new Map(subjects.map((s) => [s.id, s]));
    const recent: SessionRow[] = sessions.slice(0, 12).map((x) => {
      const s = nameOf.get(x.subject_id);
      return {
        id: x.id, subjectId: x.subject_id, subject: s?.name ?? 'Archived subject', measure: s?.measure ?? 'minutes', unit: s?.unit ?? null,
        on: x.performed_on, minutes: x.minutes, quantity: x.quantity == null ? null : Number(x.quantity), topic: x.topic, note: x.note,
      };
    });
    const monthStart = startOfMonth(today);
    const minutesIn = (a: ISODate) => sessions.filter((x) => x.performed_on >= a).reduce((s, x) => s + (x.minutes ?? 0), 0);
    // most consistent: best share of weeks (last 12) at or above target
    let mostConsistent: LearningHome['mostConsistent'] = null;
    for (const v of views) {
      const weeksWithData = v.trend.slice(0, 11);
      if (weeksWithData.every((x) => x === 0)) continue;
      const hit = weeksWithData.filter((x) => x >= v.weeklyTarget).length / weeksWithData.length;
      if (!mostConsistent || hit > mostConsistent.rate) mostConsistent = { name: v.name, rate: hit };
    }
    const a = active[0];
    return {
      today,
      subjects: views,
      active: a ? { id: a.id, subjectId: a.subject_id, subject: nameOf.get(a.subject_id)?.name ?? 'Session', startedAt: new Date(a.started_at).toISOString() } : null,
      recent,
      totals: {
        weekMinutes: minutesIn(thisWeek),
        monthMinutes: minutesIn(monthStart),
        allMinutes: totals.reduce((s, t) => s + t.minutes, 0),
        sessions: totals.reduce((s, t) => s + t.n, 0),
      },
      legacy,
      mostConsistent,
    };
  });
}

export interface LearningToday {
  id: string;
  name: string;
  measure: LearningMeasure;
  unit: string;
  missionId: string | null;
  week: SubjectWeek;
  todayAmount: number;
  perDay: number;
  status: 'required' | 'flexible' | 'done' | 'rest';
  active: { id: string; startedAt: string } | null;
}

export async function loadLearningToday(q: Queryable, viewer: Viewer, statusOf: (missionId: string) => 'required' | 'flexible' | 'none' | 'extra' | 'overdue' | 'backlog' | null): Promise<LearningToday[]> {
  const subjects = await listSubjects(q);
  if (!subjects.length) return [];
  const [active] = await q.query<{ id: string; subject_id: string; started_at: Date }>(`select id, subject_id, started_at from learning_sessions where status = 'active' limit 1`);
  const out: LearningToday[] = [];
  for (const s of subjects) {
    const week = await subjectWeek(q, viewer, s, viewer.today);
    const [t] = await q.query<{ minutes: number; quantity: number; n: number }>(
      `select coalesce(sum(minutes), 0)::int as minutes, coalesce(sum(quantity), 0) as quantity, count(*)::int as n
         from learning_sessions where subject_id = $1 and status = 'completed' and performed_on = $2`,
      [s.id, viewer.today],
    );
    const todayAmount = s.measure === 'minutes' ? t.minutes : s.measure === 'sessions' ? t.n : Number(t.quantity);
    const st = s.missionId ? statusOf(s.missionId) : null;
    const status: LearningToday['status'] = todayAmount >= perDayTarget(s) ? 'done' : st === 'required' ? 'required' : week.done >= week.target ? 'rest' : 'flexible';
    out.push({
      id: s.id, name: s.name, measure: s.measure, unit: unitOf(s), missionId: s.missionId, week, todayAmount, perDay: perDayTarget(s), status,
      active: active && active.subject_id === s.id ? { id: active.id, startedAt: new Date(active.started_at).toISOString() } : null,
    });
  }
  return out;
}

export async function listSubjectsFor(viewer: Viewer): Promise<Subject[]> {
  return asUser(viewer.userId, (q) => listSubjects(q));
}

export { versionAt };
