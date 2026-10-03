import 'server-only';
import { asSystem, type Queryable } from '@/lib/db';
import { addDays, type ISODate } from '@/lib/engine/dates';
import {
  championshipPoints, computeStandings, isPerfectSeason, seasonAwards, seasonFrom, seasonLabel, yearTable,
  type GroupUnit, type SeasonLength, type Standing,
} from '@/lib/engine/groups';

/**
 * Season bookkeeping. This is the trusted side of Groups: it runs with owner privileges because
 * results, locked targets, awards and the activity feed must never be writable by a member.
 * Everything it reads is the same aggregate a member could see (group_activity_raw), and nothing here
 * touches profiles, finances or private proof. Every function is idempotent — safe to call on every
 * page view, which is exactly how seasons advance (lazily, like weekly reviews).
 */

export interface GroupRow {
  id: string;
  name: string;
  kind: 'gym' | 'learning' | 'custom';
  season_length: SeasonLength;
  season_days: number | null;
  proof_policy: 'self_report' | 'proof_optional' | 'proof_required';
  target_rule: 'personal' | 'same';
  same_target: number | null;
  min_target: number | null;
  max_target: number | null;
  created_at: Date;
}

export interface SeasonRow {
  id: string;
  number: number;
  starts_on: string;
  ends_on: string;
  status: 'active' | 'closed';
}

const WEEK_STARTS_ON = 1;

function day(d: Date | string): ISODate {
  return new Date(d).toISOString().slice(0, 10);
}

export function effectiveTarget(g: Pick<GroupRow, 'target_rule' | 'same_target' | 'min_target' | 'max_target'>, desired: number | null): number | null {
  if (g.target_rule === 'same') return g.same_target;
  if (desired == null) return null;
  let t = desired;
  if (g.min_target != null) t = Math.max(t, Number(g.min_target));
  if (g.max_target != null) t = Math.min(t, Number(g.max_target));
  return t;
}

async function snapshotCommitments(q: Queryable, g: GroupRow, season: SeasonRow, startsOn: ISODate) {
  const members = await q.query<{ user_id: string; target: number | null; unit: string | null; mission_id: string | null }>(
    `select user_id, target, unit, mission_id from public.group_members where group_id = $1 and status = 'active'`,
    [g.id],
  );
  for (const m of members) {
    const target = effectiveTarget(g, m.target == null ? null : Number(m.target));
    if (!m.mission_id || target == null || !m.unit) continue;
    await q.query(
      `insert into public.group_commitments (season_id, group_id, user_id, target, unit, starts_on)
       values ($1, $2, $3, $4, $5, $6) on conflict (season_id, user_id) do nothing`,
      [season.id, g.id, m.user_id, target, m.unit, startsOn],
    );
  }
}

async function openSeason(q: Queryable, g: GroupRow, number: number, start: ISODate): Promise<SeasonRow> {
  const bounds = seasonFrom(g.season_length, day(g.created_at), start, WEEK_STARTS_ON, g.season_days);
  const [s] = await q.query<SeasonRow>(
    `insert into public.group_seasons (group_id, number, starts_on, ends_on) values ($1, $2, $3, $4)
     on conflict (group_id, number) do update set number = excluded.number
     returning id, number, starts_on, ends_on, status`,
    [g.id, number, start, bounds.end],
  );
  await snapshotCommitments(q, g, s, start);
  return s;
}

export async function loadStandingsInputs(q: Queryable, g: GroupRow, s: SeasonRow, to: ISODate) {
  const [commitments, names, activity] = await Promise.all([
    q.query<{ user_id: string; target: number; unit: GroupUnit; starts_on: string }>(
      `select user_id, target, unit, starts_on from public.group_commitments where season_id = $1`,
      [s.id],
    ),
    q.query<{ user_id: string; display_name: string; status: string }>(
      `select user_id, display_name, status from public.group_members where group_id = $1`,
      [g.id],
    ),
    q.query<{ user_id: string; day: string; amount: number; proofed: boolean }>(
      `select user_id, day, amount, proofed from public.group_activity_raw($1, $2, $3)`,
      [g.id, s.starts_on, to],
    ),
  ]);
  const nameOf = new Map(names.map((n) => [n.user_id, n]));
  const members = commitments
    .filter((c) => nameOf.get(c.user_id)?.status === 'active')
    .map((c) => ({ userId: c.user_id, name: nameOf.get(c.user_id)!.display_name, target: Number(c.target), unit: c.unit, startsOn: c.starts_on }));
  return {
    members,
    activity: activity.map((a) => ({ userId: a.user_id, day: a.day, amount: Number(a.amount), proofed: a.proofed })),
  };
}

async function closeSeason(q: Queryable, g: GroupRow, s: SeasonRow, today: ISODate): Promise<void> {
  const { members, activity } = await loadStandingsInputs(q, g, s, s.ends_on);
  const standings: Standing[] = computeStandings({
    window: { start: s.starts_on, end: s.ends_on },
    today,
    weekStartsOn: WEEK_STARTS_ON,
    final: true,
    proofRequired: g.proof_policy === 'proof_required',
    proofMatters: g.proof_policy !== 'self_report',
    members,
    activity,
  });
  const label = seasonLabel(g.season_length, { start: s.starts_on, end: s.ends_on }, s.number);
  for (const r of standings) {
    const perfect = isPerfectSeason(r);
    await q.query(
      `insert into public.group_results (season_id, group_id, user_id, display_name, rank, tied, done, eligible, pledged, rate,
                                         perfect_weeks, weeks, proofed, target, unit, points)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       on conflict (season_id, user_id) do nothing`,
      [s.id, g.id, r.userId, r.name, r.rank, r.tied, r.done, r.eligible, r.pledged, Math.round(r.rate * 10000) / 10000,
        r.perfectWeeks, r.weeks, g.proof_policy === 'self_report' ? null : r.proofed, r.target, r.unit, championshipPoints(r, perfect)],
    );
  }

  // awards: compare with the previous closed season for "most improved"
  const prev = await q.query<{ user_id: string; rate: number }>(
    `select r.user_id, r.rate from public.group_results r join public.group_seasons s on s.id = r.season_id
      where s.group_id = $1 and s.number = $2`,
    [g.id, s.number - 1],
  );
  const units = new Set(standings.map((r) => r.unit));
  const awards = seasonAwards(standings, label, new Map(prev.map((p) => [p.user_id, Number(p.rate)])), units.size === 1);
  for (const a of awards) {
    await q.query(
      `insert into public.group_awards (group_id, season_id, user_id, kind, title, detail) values ($1, $2, $3, $4, $5, $6)
       on conflict do nothing`,
      [g.id, s.id, a.userId, a.kind, a.title, a.detail],
    );
    await q.query(
      `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, source_key) values ($1, $2, 'award', $3, $4, $5)
       on conflict (group_id, source_key) do nothing`,
      [g.id, a.userId, a.kind === 'champion' ? `won ${label}` : `earned ${a.title}`, s.ends_on, `award:${s.id}:${a.kind}:${a.userId}`],
    );
    if (a.kind === 'champion') {
      await q.query(
        `insert into public.timeline_events (user_id, occurred_on, kind, title, detail, source_key) values ($1, $2, 'group', $3, $4, $5)
         on conflict (user_id, kind, source_key) do nothing`,
        [a.userId, s.ends_on, `${a.title} · ${g.name}`, a.detail, `group:${s.id}`],
      );
    }
  }
  await q.query(`update public.group_seasons set status = 'closed', closed_at = now() where id = $1`, [s.id]);

  // the year closes with the last season that ends in it
  const nextStart = addDays(s.ends_on, 1);
  if (nextStart.slice(0, 4) !== s.ends_on.slice(0, 4)) await awardYear(q, g, Number(s.ends_on.slice(0, 4)));
}

async function awardYear(q: Queryable, g: GroupRow, year: number) {
  const rows = await q.query<{ user_id: string; display_name: string; points: number; rank: number; rate: number }>(
    `select r.user_id, r.display_name, r.points, r.rank, r.rate from public.group_results r
       join public.group_seasons s on s.id = r.season_id
      where s.group_id = $1 and s.status = 'closed' and extract(year from s.ends_on) = $2`,
    [g.id, year],
  );
  const table = yearTable(rows.map((r) => ({ userId: r.user_id, name: r.display_name, points: Number(r.points), rank: Number(r.rank), rate: Number(r.rate) })));
  const winners = table.filter((r) => r.rank === 1 && r.points > 0);
  for (const w of winners) {
    const title = winners.length > 1 ? `${year} co-champion` : `${year} champion`;
    await q.query(
      `insert into public.group_awards (group_id, year, user_id, kind, title, detail) values ($1, $2, $3, 'year_champion', $4, $5)
       on conflict do nothing`,
      [g.id, year, w.userId, title, `${w.points} championship points · ${w.wins} season${w.wins === 1 ? '' : 's'} won`],
    );
    await q.query(
      `insert into public.timeline_events (user_id, occurred_on, kind, title, detail, source_key) values ($1, $2, 'group', $3, $4, $5)
       on conflict (user_id, kind, source_key) do nothing`,
      [w.userId, `${year}-12-31`, `${title} · ${g.name}`, `${w.points} points`, `group-year:${g.id}:${year}`],
    );
  }
}

/** Open the first season, close any that ended, open the next — as many as have passed. */
export async function ensureGroupSeasons(groupId: string, today: ISODate): Promise<void> {
  await asSystem(async (q) => {
    const [g] = await q.query<GroupRow>(`select * from public.groups where id = $1 and archived_at is null for update`, [groupId]);
    if (!g) return;
    let seasons = await q.query<SeasonRow>(
      `select id, number, starts_on, ends_on, status from public.group_seasons where group_id = $1 order by number`,
      [groupId],
    );
    if (!seasons.length) {
      await openSeason(q, g, 1, day(g.created_at) <= today ? day(g.created_at) : today);
      seasons = await q.query<SeasonRow>(`select id, number, starts_on, ends_on, status from public.group_seasons where group_id = $1 order by number`, [groupId]);
    }
    let current = seasons.at(-1)!;
    for (let guard = 0; guard < 400 && current.ends_on < today; guard++) {
      if (current.status === 'active') await closeSeason(q, g, current, today);
      current = await openSeason(q, g, current.number + 1, addDays(current.ends_on, 1));
    }
  });
}

/** A member who joins or links their routine mid-season gets a pledge from today (prorated). */
export async function lockCommitmentNow(groupId: string, userId: string, today: ISODate): Promise<void> {
  await asSystem(async (q) => {
    const [g] = await q.query<GroupRow>(`select * from public.groups where id = $1`, [groupId]);
    const [s] = await q.query<SeasonRow>(`select id, number, starts_on, ends_on, status from public.group_seasons where group_id = $1 and status = 'active'`, [groupId]);
    const [m] = await q.query<{ target: number | null; unit: string | null; mission_id: string | null; status: string }>(
      `select target, unit, mission_id, status from public.group_members where group_id = $1 and user_id = $2`,
      [groupId, userId],
    );
    if (!g || !s || !m || m.status !== 'active' || !m.mission_id || !m.unit) return;
    const target = effectiveTarget(g, m.target == null ? null : Number(m.target));
    if (target == null) return;
    const starts = today < s.starts_on ? s.starts_on : today;
    await q.query(
      `insert into public.group_commitments (season_id, group_id, user_id, target, unit, starts_on)
       values ($1, $2, $3, $4, $5, $6) on conflict (season_id, user_id) do nothing`,
      [s.id, groupId, userId, target, m.unit, starts],
    );
  });
}

/** Owner action: end the running season today (results are final from this moment). */
export async function endSeasonToday(groupId: string, today: ISODate): Promise<boolean> {
  const ended = await asSystem(async (q) => {
    const [s] = await q.query<SeasonRow>(`select id, number, starts_on, ends_on, status from public.group_seasons where group_id = $1 and status = 'active'`, [groupId]);
    if (!s) return false;
    await q.query(`update public.group_seasons set ends_on = $2 where id = $1`, [s.id, today]);
    return true;
  });
  if (!ended) return false;
  // close it as if tomorrow had come; the next season opens tomorrow
  await ensureGroupSeasons(groupId, addDays(today, 1));
  return true;
}

export async function recordActivity(groupId: string, userId: string, kind: 'joined' | 'left', title: string, on: ISODate, key: string) {
  await asSystem((q) =>
    q.query(
      `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, source_key) values ($1, $2, $3, $4, $5, $6)
       on conflict (group_id, source_key) do nothing`,
      [groupId, userId, kind, title, on, key],
    ),
  );
}
