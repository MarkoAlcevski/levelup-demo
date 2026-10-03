import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, diffDays, isISODate, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { formatMoney } from '@/lib/engine/money';
import { sessionTotals } from '@/lib/engine/gym';
import type { Viewer } from './profile';
import { loadSessions } from './gym';
import { track } from './analytics';

/**
 * The Journal: one page for every day of every year. Your words — what you did, what you want to
 * do, notes — sit next to the facts Kept already recorded that day (workouts, learning, routines,
 * tasks, money). The facts are read live, never copied, so the page and the record can't disagree.
 */

export interface JournalEntry {
  day: ISODate;
  did: string;
  plan: string;
  notes: string;
  mood: number | null;
  updatedAt: string | null;
}

export interface DayFacts {
  workouts: { id: string; name: string; sets: number; minutes: number | null }[];
  learning: { subject: string; amount: string; topic: string | null }[];
  kept: { title: string; outcome: string; value: string | null }[];
  missed: string[];
  tasksDone: string[];
  money: { spent: string | null; income: string | null; count: number } | null;
  proofs: number;
  focus: { title: string; done: boolean } | null;
}

export interface JournalDay {
  day: ISODate;
  today: ISODate;
  entry: JournalEntry;
  facts: DayFacts;
  prev: ISODate | null;
  next: ISODate | null;
  /** yesterday's "what I want to do", shown on today's page */
  carried: string | null;
}

function emptyEntry(day: ISODate): JournalEntry {
  return { day, did: '', plan: '', notes: '', mood: null, updatedAt: null };
}

async function factsFor(q: Queryable, viewer: Viewer, day: ISODate): Promise<DayFacts> {
  const [comps, learning, money, proofs, focus, sessions] = await Promise.all([
    q.query<{ title: string; outcome: string; value: number | null; unit: string | null; kept: boolean; module: string | null; cadence: string | null }>(
      `select m.title, c.outcome, c.value, m.unit, c.kept, m.module,
              (select s.cadence from mission_schedules s where s.mission_id = m.id and s.valid_from <= c.occurred_on
                 and (s.valid_to is null or c.occurred_on < s.valid_to) limit 1) as cadence
         from completions c join missions m on m.id = c.mission_id where c.occurred_on = $1 order by c.logged_at`,
      [day],
    ),
    q.query<{ name: string; measure: string; unit: string | null; minutes: number | null; quantity: number | null; topic: string | null }>(
      `select s.name, s.measure, s.unit, l.minutes, l.quantity, l.topic from learning_sessions l join learning_subjects s on s.id = l.subject_id
        where l.performed_on = $1 and l.status = 'completed' order by l.created_at`,
      [day],
    ),
    q.query<{ kind: string; amount_minor: number; currency: string }>(
      `select kind, amount_minor, currency from transactions where occurred_on = $1 and kind in ('income', 'expense')`,
      [day],
    ),
    q.query<{ n: number }>(`select count(*)::int as n from proofs where captured_on = $1`, [day]),
    q.query<{ title: string; status: string; done_at: Date | null }>(
      `select title, status, done_at from keystones where week_start = $1`,
      [startOfWeek(day, viewer.profile.weekStartsOn)],
    ),
    loadSessions(q, { status: 'completed', from: day, to: day }),
  ]);
  const byCur = new Map<string, { spent: number; income: number }>();
  for (const t of money) {
    const r = byCur.get(t.currency) ?? { spent: 0, income: 0 };
    if (t.kind === 'expense') r.spent += -Number(t.amount_minor);
    else r.income += Number(t.amount_minor);
    byCur.set(t.currency, r);
  }
  const fmtAll = (k: 'spent' | 'income') =>
    [...byCur.entries()].filter(([, v]) => v[k] !== 0).map(([c, v]) => formatMoney(v[k], c, { compact: true })).join(' + ') || null;
  const regular = comps.filter((c) => !c.module);
  return {
    workouts: [...sessions].reverse().map((s) => ({ id: s.id, name: s.name, sets: sessionTotals(s).sets, minutes: s.durationSeconds ? Math.round(s.durationSeconds / 60) : null })),
    learning: learning.map((l) => ({
      subject: l.name,
      amount: l.measure === 'minutes' ? `${l.minutes ?? 0} min` : l.measure === 'sessions' ? `${l.minutes ? `${l.minutes} min` : '1 session'}` : `${Number(l.quantity ?? 0)} ${l.measure === 'custom' ? l.unit ?? '' : l.measure}`.trim(),
      topic: l.topic,
    })),
    kept: regular.filter((c) => c.kept && c.cadence !== 'once').map((c) => ({ title: c.title, outcome: c.outcome, value: c.value != null ? `${Number(c.value)}${c.unit ? ` ${c.unit}` : ''}` : null })),
    missed: regular.filter((c) => c.outcome === 'missed').map((c) => c.title),
    tasksDone: regular.filter((c) => c.kept && c.cadence === 'once').map((c) => c.title),
    money: money.length ? { spent: fmtAll('spent'), income: fmtAll('income'), count: money.length } : null,
    proofs: proofs[0]?.n ?? 0,
    focus: focus[0] ? { title: focus[0].title, done: focus[0].status === 'done' } : null,
  };
}

export async function loadJournalDay(viewer: Viewer, day: ISODate): Promise<JournalDay | null> {
  if (!isISODate(day) || day < '1970-01-01' || day > '2100-12-31') return null;
  return asUser(viewer.userId, async (q) => {
    const [row] = await q.query<{ day: string; did: string | null; plan: string | null; notes: string | null; mood: number | null; updated_at: Date }>(
      `select day, did, plan, notes, mood, updated_at from journal_entries where day = $1`,
      [day],
    );
    const [prev] = await q.query<{ day: string }>(`select day from journal_entries where day < $1 order by day desc limit 1`, [day]);
    const [next] = await q.query<{ day: string }>(`select day from journal_entries where day > $1 order by day limit 1`, [day]);
    const [yesterday] = await q.query<{ plan: string | null }>(`select plan from journal_entries where day = $1`, [addDays(day, -1)]);
    const facts = day <= viewer.today ? await factsFor(q, viewer, day) : { workouts: [], learning: [], kept: [], missed: [], tasksDone: [], money: null, proofs: 0, focus: null };
    return {
      day,
      today: viewer.today,
      entry: row
        ? { day, did: row.did ?? '', plan: row.plan ?? '', notes: row.notes ?? '', mood: row.mood, updatedAt: new Date(row.updated_at).toISOString() }
        : emptyEntry(day),
      facts,
      prev: prev?.day ?? null,
      next: next?.day ?? null,
      carried: yesterday?.plan?.trim() ? yesterday.plan : null,
    };
  });
}

const entryInput = z.object({
  day: z.iso.date(),
  did: z.string().max(20000).default(''),
  plan: z.string().max(20000).default(''),
  notes: z.string().max(20000).default(''),
  mood: z.number().int().min(1).max(5).nullable().optional(),
});
export type JournalInput = z.input<typeof entryInput>;

export async function saveJournal(viewer: Viewer, raw: JournalInput) {
  const parsed = entryInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: 'That entry is too long.' };
  const v = parsed.data;
  if (v.day < '1970-01-01' || v.day > '2100-12-31') return { ok: false as const, error: 'Invalid day.' };
  const empty = !v.did.trim() && !v.plan.trim() && !v.notes.trim() && v.mood == null;
  const first = await asUser(viewer.userId, async (q) => {
    if (empty) {
      await q.query(`delete from journal_entries where day = $1`, [v.day]);
      return false;
    }
    const [r] = await q.query<{ inserted: boolean }>(
      `insert into journal_entries (day, did, plan, notes, mood) values ($1, $2, $3, $4, $5)
       on conflict (user_id, day) do update set did = excluded.did, plan = excluded.plan, notes = excluded.notes, mood = excluded.mood
       returning (xmax = 0) as inserted`,
      [v.day, v.did || null, v.plan || null, v.notes || null, v.mood ?? null],
    );
    return !!r?.inserted;
  });
  if (first) void track(viewer.userId, 'journal_written', { future: v.day > viewer.today });
  return { ok: true as const, savedAt: new Date().toISOString() };
}

export interface JournalYear {
  year: number;
  today: ISODate;
  /** day → entry summary for days that have one */
  entries: Record<ISODate, { preview: string; mood: number | null; hasPlan: boolean }>;
  /** days with any recorded activity (kept routine, workout, session) */
  active: ISODate[];
  count: number;
  streak: number;
  recent: { day: ISODate; preview: string; mood: number | null }[];
  years: number[];
}

function preview(r: { did: string | null; notes: string | null; plan: string | null }): string {
  const t = (r.did || r.notes || r.plan || '').replace(/\s+/g, ' ').trim();
  return t.length > 140 ? `${t.slice(0, 137)}…` : t;
}

export async function loadJournalYear(viewer: Viewer, year: number): Promise<JournalYear> {
  const y = Math.min(2100, Math.max(1970, Math.floor(year)));
  const from = `${y}-01-01`;
  const to = `${y}-12-31`;
  return asUser(viewer.userId, async (q) => {
    const [rows, active, allDays, years] = await Promise.all([
      q.query<{ day: string; did: string | null; plan: string | null; notes: string | null; mood: number | null }>(
        `select day, did, plan, notes, mood from journal_entries where day between $1 and $2 order by day`,
        [from, to],
      ),
      q.query<{ d: string }>(
        `select distinct occurred_on as d from completions where kept and occurred_on between $1 and $2
         union select distinct performed_on from workout_sessions where status = 'completed' and performed_on between $1 and $2
         union select distinct performed_on from learning_sessions where status = 'completed' and performed_on between $1 and $2`,
        [from, to],
      ),
      q.query<{ day: string }>(`select day from journal_entries where day <= $1 order by day desc limit 400`, [viewer.today]),
      q.query<{ y: number }>(`select distinct extract(year from day)::int as y from journal_entries order by y`),
    ]);
    let streak = 0;
    let cursor = viewer.today;
    const set = new Set(allDays.map((d) => d.day));
    if (!set.has(cursor)) cursor = addDays(cursor, -1); // today can still be written
    while (set.has(cursor)) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    const entries: JournalYear['entries'] = {};
    for (const r of rows) entries[r.day] = { preview: preview(r), mood: r.mood, hasPlan: !!r.plan?.trim() };
    const yearList = new Set([...years.map((r) => r.y), Number(viewer.today.slice(0, 4)), y]);
    return {
      year: y,
      today: viewer.today,
      entries,
      active: active.map((a) => a.d),
      count: rows.length,
      streak,
      recent: [...rows].reverse().filter((r) => r.day <= viewer.today).slice(0, 8).map((r) => ({ day: r.day, preview: preview(r), mood: r.mood })),
      years: [...yearList].sort(),
    };
  });
}

export function journalDayOffset(day: ISODate, today: ISODate): number {
  return diffDays(today, day);
}
