import 'server-only';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { diffDays, formatRange, type ISODate } from '@/lib/engine/dates';
import {
  computeStandings, groupCompletion, seasonLabel, yearTable, type GroupUnit, type SeasonLength, type Standing, type YearRow,
} from '@/lib/engine/groups';
import type { Viewer } from './profile';
import { loadMissions } from './load';
import { getProgram } from './gym';
import { listSubjectsFor, unitOf } from './learning';
import { ensureGroupSeasons, endSeasonToday, lockCommitmentNow, recordActivity, type GroupRow, type SeasonRow } from './group-seasons';
import { refreshActivityProof } from './group-activity';
import { allow } from './rate-limit';
import { track } from './analytics';

/**
 * Groups, read and written as the member (RLS: members see the group, never anyone's private data).
 * Standings come from group_member_activity — per-day amounts of each member's linked routine,
 * computed in Postgres from completions — and the ranking maths is the pure engine in engine/groups.
 */

export const GROUP_KIND_LABEL = { gym: 'Gym', learning: 'Learning', custom: 'Custom' } as const;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newJoinCode(): string {
  return Array.from({ length: 8 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
}

// ───────────────────────────────────────────── list

export interface GroupListItem {
  id: string;
  name: string;
  kind: 'gym' | 'learning' | 'custom';
  members: number;
  season: { label: string; daysLeft: number } | null;
  me: { rank: number; rate: number; linked: boolean } | null;
  leader: { name: string; rate: number } | null;
  role: 'owner' | 'admin' | 'member';
}

export async function listGroups(viewer: Viewer): Promise<GroupListItem[]> {
  const ids = await asUser(viewer.userId, (q) =>
    q.query<{ group_id: string }>(`select group_id from group_members where user_id = $1 and status = 'active'`, [viewer.userId]),
  );
  for (const { group_id } of ids) await ensureGroupSeasons(group_id, viewer.today);
  if (!ids.length) return [];
  return asUser(viewer.userId, async (q) => {
    const out: GroupListItem[] = [];
    for (const { group_id } of ids) {
      const page = await readGroup(q, viewer, group_id);
      if (!page) continue;
      const me = page.standings.find((s) => s.userId === viewer.userId);
      const top = page.standings[0];
      out.push({
        id: page.group.id,
        name: page.group.name,
        kind: page.group.kind,
        members: page.members.length,
        season: page.season ? { label: page.season.label, daysLeft: page.season.daysLeft } : null,
        me: page.me ? { rank: me?.rank ?? 0, rate: me?.rate ?? 0, linked: !!page.me.missionId } : null,
        leader: top && top.rate > 0 ? { name: top.name, rate: top.rate } : null,
        role: page.me?.role ?? 'member',
      });
    }
    return out;
  });
}

// ───────────────────────────────────────────── one group

export interface GroupMember {
  userId: string;
  name: string;
  role: 'owner' | 'admin' | 'member';
  target: number | null;
  unit: GroupUnit | null;
  linked: boolean;
  isMe: boolean;
}

export interface GroupPage {
  today: ISODate;
  group: {
    id: string; name: string; kind: 'gym' | 'learning' | 'custom'; description: string | null; seasonLength: SeasonLength; seasonDays: number | null;
    proofPolicy: 'self_report' | 'proof_optional' | 'proof_required'; targetRule: 'personal' | 'same'; sameTarget: number | null;
    minTarget: number | null; maxTarget: number | null; prize: string | null; joinCode: string | null;
  };
  me: { role: 'owner' | 'admin' | 'member'; missionId: string | null; target: number | null; unit: GroupUnit | null; proofShare: 'never' | 'ask' | 'auto'; name: string } | null;
  members: GroupMember[];
  season: { id: string; number: number; label: string; start: ISODate; end: ISODate; daysLeft: number; range: string; upcoming: boolean } | null;
  standings: Standing[];
  groupRate: number | null;
  myCommitment: { target: number; unit: GroupUnit } | null;
  activity: { id: string; userId: string; name: string; kind: string; title: string; on: ISODate; proofId: string | null; proofKind: string | null; picId: string | null }[];
  hall: { seasonId: string; label: string; range: string; champions: { name: string; detail: string }[]; awards: { name: string; title: string; kind: string }[]; groupRate: number | null }[];
  year: { year: number; rows: YearRow[]; champion: { name: string; title: string } | null } | null;
  records: { label: string; value: string; detail: string }[];
}

async function readGroup(q: Queryable, viewer: Viewer, id: string): Promise<GroupPage | null> {
  const [g] = await q.query<GroupRow & { description: string | null; prize: string | null; join_code: string }>(`select * from groups where id = $1`, [id]);
  if (!g) return null;
  const [members, seasons, activity, results, awards] = await Promise.all([
    q.query<{ user_id: string; display_name: string; role: GroupMember['role']; status: string; target: number | null; unit: GroupUnit | null; mission_id: string | null; proof_share: 'never' | 'ask' | 'auto' }>(
      `select user_id, display_name, role, status, target, unit, mission_id, proof_share from group_members where group_id = $1 order by joined_at`,
      [id],
    ),
    q.query<SeasonRow>(`select id, number, starts_on, ends_on, status from group_seasons where group_id = $1 order by number desc`, [id]),
    q.query<{ id: string; user_id: string; kind: string; title: string; occurred_on: string; proof_id: string | null; pic_id: string | null }>(
      `select id, user_id, kind, title, occurred_on, proof_id, pic_id from group_activity where group_id = $1 order by occurred_on desc, created_at desc limit 40`,
      [id],
    ),
    q.query<{ season_id: string; user_id: string; display_name: string; rank: number; rate: number; points: number; eligible: number; pledged: number; perfect_weeks: number; weeks: number; proofed: number | null }>(
      `select season_id, user_id, display_name, rank, rate, points, eligible, pledged, perfect_weeks, weeks, proofed from group_results where group_id = $1`,
      [id],
    ),
    q.query<{ season_id: string | null; year: number | null; user_id: string; kind: string; title: string; detail: string | null }>(
      `select season_id, year, user_id, kind, title, detail from group_awards where group_id = $1 order by created_at`,
      [id],
    ),
  ]);
  const active = members.filter((m) => m.status === 'active');
  const meRow = active.find((m) => m.user_id === viewer.userId) ?? null;
  const nameOf = new Map(members.map((m) => [m.user_id, m.display_name]));
  const current = seasons.find((s) => s.status === 'active') ?? null;

  let standings: Standing[] = [];
  let myCommitment: GroupPage['myCommitment'] = null;
  if (current) {
    const to = viewer.today < current.ends_on ? viewer.today : current.ends_on;
    const [commitments, act] = await Promise.all([
      q.query<{ user_id: string; target: number; unit: GroupUnit; starts_on: string }>(`select user_id, target, unit, starts_on from group_commitments where season_id = $1`, [current.id]),
      to >= current.starts_on
        ? q.query<{ user_id: string; day: string; amount: number; proofed: boolean }>(`select user_id, day, amount, proofed from group_member_activity($1, $2, $3)`, [id, current.starts_on, to])
        : Promise.resolve([] as { user_id: string; day: string; amount: number; proofed: boolean }[]),
    ]);
    const mine = commitments.find((c) => c.user_id === viewer.userId);
    if (mine) myCommitment = { target: Number(mine.target), unit: mine.unit };
    standings = computeStandings({
      window: { start: current.starts_on, end: current.ends_on },
      today: viewer.today,
      weekStartsOn: 1,
      final: false,
      proofRequired: g.proof_policy === 'proof_required',
      proofMatters: g.proof_policy !== 'self_report',
      members: commitments
        .filter((c) => active.some((m) => m.user_id === c.user_id))
        .map((c) => ({ userId: c.user_id, name: nameOf.get(c.user_id) ?? 'Member', target: Number(c.target), unit: c.unit, startsOn: c.starts_on })),
      activity: act.map((a) => ({ userId: a.user_id, day: a.day, amount: Number(a.amount), proofed: a.proofed })),
    });
  }

  // proof kinds for shared proof in the feed
  const proofIds = activity.map((a) => a.proof_id).filter((x): x is string => !!x);
  const proofKinds = new Map<string, string>();
  for (const pid of proofIds) {
    const [p] = await q.query<{ kind: string }>(`select kind from group_shared_proof($1, $2)`, [id, pid]);
    if (p) proofKinds.set(pid, p.kind);
  }

  const closed = seasons.filter((s) => s.status === 'closed');
  const hall = closed.map((s) => {
    const rs = results.filter((r) => r.season_id === s.id);
    const e = rs.reduce((a, r) => a + Number(r.eligible), 0);
    const p = rs.reduce((a, r) => a + Number(r.pledged), 0);
    return {
      seasonId: s.id,
      label: seasonLabel(g.season_length, { start: s.starts_on, end: s.ends_on }, s.number),
      range: formatRange(s.starts_on, s.ends_on),
      champions: awards.filter((a) => a.season_id === s.id && a.kind === 'champion').map((a) => ({ name: nameOf.get(a.user_id) ?? 'Former member', detail: a.detail ?? '' })),
      awards: awards.filter((a) => a.season_id === s.id && a.kind !== 'champion').map((a) => ({ name: nameOf.get(a.user_id) ?? 'Former member', title: a.title, kind: a.kind })),
      groupRate: p > 0 ? Math.min(1, e / p) : null,
    };
  });

  const yearNow = Number(viewer.today.slice(0, 4));
  const yearResults = results.filter((r) => closed.some((s) => s.id === r.season_id && Number(s.ends_on.slice(0, 4)) === yearNow));
  const yearRows = yearTable(yearResults.map((r) => ({ userId: r.user_id, name: nameOf.get(r.user_id) ?? r.display_name, points: Number(r.points), rank: Number(r.rank), rate: Number(r.rate) })));
  const yearAward = awards.find((a) => a.kind === 'year_champion' && a.year === yearNow);

  // group records, derived from closed seasons
  const records: GroupPage['records'] = [];
  const best = [...hall].filter((h) => h.groupRate != null).sort((a, b) => (b.groupRate ?? 0) - (a.groupRate ?? 0))[0];
  if (best && closed.length >= 1) records.push({ label: 'Best group season', value: `${Math.round((best.groupRate ?? 0) * 100)}%`, detail: best.label });
  const wins = new Map<string, number>();
  for (const a of awards.filter((x) => x.kind === 'champion')) wins.set(a.user_id, (wins.get(a.user_id) ?? 0) + 1);
  const topWins = [...wins.entries()].sort((a, b) => b[1] - a[1])[0];
  if (topWins && topWins[1] >= 2) records.push({ label: 'Most seasons won', value: String(topWins[1]), detail: nameOf.get(topWins[0]) ?? '' });
  let streakBest = 0;
  let run = 0;
  for (const s of [...closed].reverse()) {
    const rs = results.filter((r) => r.season_id === s.id);
    if (rs.length && rs.every((r) => Number(r.rate) >= 0.9999)) streakBest = Math.max(streakBest, ++run);
    else run = 0;
  }
  if (streakBest >= 1) records.push({ label: 'Everyone at 100%', value: `${streakBest} season${streakBest === 1 ? '' : 's'} in a row`, detail: 'the whole group kept its word' });
  if (g.proof_policy !== 'self_report') {
    const mostProof = results.filter((r) => r.proofed != null).sort((a, b) => Number(b.proofed) - Number(a.proofed))[0];
    if (mostProof && Number(mostProof.proofed) > 0) records.push({ label: 'Most verified in a season', value: String(Number(mostProof.proofed)), detail: nameOf.get(mostProof.user_id) ?? '' });
  }

  return {
    today: viewer.today,
    group: {
      id: g.id, name: g.name, kind: g.kind, description: g.description, seasonLength: g.season_length, seasonDays: g.season_days,
      proofPolicy: g.proof_policy, targetRule: g.target_rule, sameTarget: g.same_target == null ? null : Number(g.same_target),
      minTarget: g.min_target == null ? null : Number(g.min_target), maxTarget: g.max_target == null ? null : Number(g.max_target),
      prize: g.prize, joinCode: meRow ? g.join_code : null,
    },
    me: meRow
      ? { role: meRow.role, missionId: meRow.mission_id, target: meRow.target == null ? null : Number(meRow.target), unit: meRow.unit, proofShare: meRow.proof_share, name: meRow.display_name }
      : null,
    members: active.map((m) => ({
      userId: m.user_id, name: m.display_name, role: m.role, target: m.target == null ? null : Number(m.target), unit: m.unit, linked: !!m.mission_id, isMe: m.user_id === viewer.userId,
    })),
    season: current
      ? {
          id: current.id, number: current.number, label: seasonLabel(g.season_length, { start: current.starts_on, end: current.ends_on }, current.number),
          start: current.starts_on, end: current.ends_on, range: formatRange(current.starts_on, current.ends_on), upcoming: viewer.today < current.starts_on,
          daysLeft: Math.max(0, diffDays(viewer.today < current.starts_on ? current.starts_on : viewer.today, current.ends_on) + 1),
        }
      : null,
    standings,
    groupRate: groupCompletion(standings, false),
    myCommitment,
    activity: activity.map((a) => ({
      id: a.id, userId: a.user_id, name: nameOf.get(a.user_id) ?? 'Former member', kind: a.kind, title: a.title, on: a.occurred_on,
      proofId: a.proof_id && proofKinds.has(a.proof_id) ? a.proof_id : null, proofKind: a.proof_id ? proofKinds.get(a.proof_id) ?? null : null,
      picId: a.pic_id,
    })),
    hall,
    year: yearRows.length ? { year: yearNow, rows: yearRows, champion: yearAward ? { name: nameOf.get(yearAward.user_id) ?? '', title: yearAward.title } : null } : null,
    records,
  };
}

export async function loadGroup(viewer: Viewer, id: string): Promise<GroupPage | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const member = await asUser(viewer.userId, (q) => q.query(`select 1 from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [id, viewer.userId]));
  if (!member.length) return null;
  await ensureGroupSeasons(id, viewer.today);
  return asUser(viewer.userId, (q) => readGroup(q, viewer, id));
}

// ───────────────────────────────────────────── linking what counts

export interface LinkOption {
  missionId: string;
  label: string;
  detail: string;
  unit: GroupUnit;
  defaultTarget: number;
}

/** What a member can link for a group of this kind — always their OWN routine. */
export async function linkOptions(viewer: Viewer, kind: 'gym' | 'learning' | 'custom'): Promise<LinkOption[]> {
  if (kind === 'gym') {
    const program = await asUser(viewer.userId, (q) => getProgram(q));
    if (!program?.missionId) return [];
    const perWeek = program.mode === 'scheduled' ? program.days.filter((d) => d.weekday != null).length : program.perWeek;
    return [{ missionId: program.missionId, label: program.name === 'My program' ? 'My gym program' : program.name, detail: `${perWeek} workouts a week`, unit: 'workouts', defaultTarget: perWeek }];
  }
  if (kind === 'learning') {
    const subjects = await listSubjectsFor(viewer);
    return subjects
      .filter((s) => s.missionId)
      .map((s) => {
        const unit: GroupUnit = s.measure === 'minutes' ? 'minutes' : s.measure === 'sessions' ? 'sessions' : s.measure === 'pages' ? 'pages' : s.measure === 'lessons' ? 'lessons' : 'units';
        return { missionId: s.missionId!, label: s.name, detail: `${s.weeklyTarget} ${unitOf(s)} a week`, unit, defaultTarget: s.weeklyTarget };
      });
  }
  const missions = await asUser(viewer.userId, (q) => loadMissions(q));
  return missions
    .filter((m) => !m.module && m.current && m.current.cadence !== 'once')
    .map((m) => {
      const v = m.current!;
      const perWeek = v.cadence === 'daily' ? 7 : v.cadence === 'weekly' ? v.perWeek ?? 1 : (v.weekdays ?? []).length;
      return { missionId: m.id, label: m.title, detail: `${perWeek}× a week`, unit: 'times' as GroupUnit, defaultTarget: perWeek };
    });
}

// ───────────────────────────────────────────── mutations

const groupInput = z
  .object({
    name: z.string().trim().min(1, 'Name the group.').max(60),
    kind: z.enum(['gym', 'learning', 'custom']),
    description: z.string().trim().max(500).nullable().optional(),
    seasonLength: z.enum(['week', 'month', 'custom']).default('month'),
    seasonDays: z.number().int().min(7).max(120).nullable().optional(),
    proofPolicy: z.enum(['self_report', 'proof_optional', 'proof_required']).default('self_report'),
    targetRule: z.enum(['personal', 'same']).default('personal'),
    sameTarget: z.number().positive().max(10000).nullable().optional(),
    minTarget: z.number().positive().max(10000).nullable().optional(),
    maxTarget: z.number().positive().max(10000).nullable().optional(),
    prize: z.string().trim().max(200).nullable().optional(),
    displayName: z.string().trim().min(1, 'How should the group see you?').max(40),
  })
  .superRefine((v, ctx) => {
    if (v.seasonLength === 'custom' && !v.seasonDays) ctx.addIssue({ code: 'custom', path: ['seasonDays'], message: 'How many days is a season?' });
    if (v.targetRule === 'same' && !v.sameTarget) ctx.addIssue({ code: 'custom', path: ['sameTarget'], message: 'Set the shared weekly target.' });
    if (v.targetRule === 'same' && v.kind === 'learning') ctx.addIssue({ code: 'custom', path: ['targetRule'], message: 'Learning groups use personal targets — people measure learning differently.' });
    if (v.minTarget && v.maxTarget && v.maxTarget < v.minTarget) ctx.addIssue({ code: 'custom', path: ['maxTarget'], message: 'The maximum can’t be below the minimum.' });
  });
export type GroupInput = z.input<typeof groupInput>;

export async function createGroup(viewer: Viewer, raw: GroupInput) {
  const parsed = groupInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the group.' };
  const v = parsed.data;
  if (!allow(`gcreate:${viewer.userId}`, 10, 3_600_000)) return { ok: false as const, error: 'That’s a lot of groups in an hour — try later.' };
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const [row] = await asUser(viewer.userId, (q) =>
        q.query<{ id: string }>(`select public.create_group($1::jsonb) as id`, [
          JSON.stringify({
            name: v.name, kind: v.kind, description: v.description ?? '', season_length: v.seasonLength,
            season_days: v.seasonLength === 'custom' ? v.seasonDays : null, proof_policy: v.proofPolicy, target_rule: v.targetRule,
            same_target: v.targetRule === 'same' ? v.sameTarget : null, min_target: v.minTarget ?? null, max_target: v.maxTarget ?? null,
            prize: v.prize ?? '', join_code: newJoinCode(), display_name: v.displayName,
          }),
        ]),
      );
      await ensureGroupSeasons(row.id, viewer.today);
      await recordActivity(row.id, viewer.userId, 'joined', 'started the group', viewer.today, `joined:${viewer.userId}`);
      void track(viewer.userId, 'group_created', { kind: v.kind, season: v.seasonLength, proof: v.proofPolicy });
      return { ok: true as const, id: row.id };
    } catch (e) {
      if (/join_code|unique/i.test((e as Error).message) && attempt < 4) continue;
      if (/group limit/i.test((e as Error).message)) return { ok: false as const, error: 'You can own up to 20 groups.' };
      throw e;
    }
  }
  return { ok: false as const, error: 'Couldn’t create the group. Try again.' };
}

export async function previewGroup(viewer: Viewer, code: string) {
  const c = code.trim().toUpperCase();
  if (!/^[A-Z0-9]{8}$/.test(c)) return null;
  if (!allow(`gpeek:${viewer.userId}`, 30, 600_000)) return null;
  const [row] = await asUser(viewer.userId, (q) =>
    q.query<{ id: string; name: string; kind: 'gym' | 'learning' | 'custom'; members: number; season_length: SeasonLength; proof_policy: string; target_rule: string; same_target: number | null; min_target: number | null; max_target: number | null; prize: string | null }>(
      `select * from public.group_preview($1)`,
      [c],
    ),
  );
  if (!row) return null;
  const [member] = await asUser(viewer.userId, (q) => q.query<{ status: string }>(`select status from group_members where group_id = $1 and user_id = $2`, [row.id, viewer.userId]));
  return { ...row, members: Number(row.members), alreadyMember: member?.status === 'active' };
}

export async function joinGroup(viewer: Viewer, code: string, displayName: string) {
  const c = code.trim().toUpperCase();
  const name = displayName.trim().slice(0, 40);
  if (!/^[A-Z0-9]{8}$/.test(c)) return { ok: false as const, error: 'Join codes are 8 letters and numbers.' };
  if (!name) return { ok: false as const, error: 'How should the group see you?' };
  if (!allow(`gjoin:${viewer.userId}`, 12, 600_000)) return { ok: false as const, error: 'Too many attempts — wait a few minutes.' };
  try {
    const [row] = await asUser(viewer.userId, (q) => q.query<{ id: string }>(`select public.join_group($1, $2) as id`, [c, name]));
    await ensureGroupSeasons(row.id, viewer.today);
    await recordActivity(row.id, viewer.userId, 'joined', 'joined the group', viewer.today, `joined:${viewer.userId}:${viewer.today}`);
    void track(viewer.userId, 'group_joined', {});
    return { ok: true as const, id: row.id };
  } catch (e) {
    const m = (e as Error).message;
    if (/invalid join code/.test(m)) return { ok: false as const, error: 'No group has that code.' };
    if (/removed/.test(m)) return { ok: false as const, error: 'You were removed from this group.' };
    if (/full/.test(m)) return { ok: false as const, error: 'That group is full (50 members).' };
    throw e;
  }
}

const linkInput = z.object({
  missionId: z.uuid(),
  target: z.number().positive().max(10000),
  proofShare: z.enum(['never', 'ask', 'auto']).optional(),
});

/** Link your own routine and pledge a weekly target. Mid-season links lock from today. */
export async function linkMembership(viewer: Viewer, groupId: string, raw: z.input<typeof linkInput>) {
  const parsed = linkInput.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Pick what counts and a target.' };
  const v = parsed.data;
  const page = await loadGroup(viewer, groupId);
  if (!page?.me) return { ok: false as const, error: 'You’re not in this group.' };
  const options = await linkOptions(viewer, page.group.kind);
  const opt = options.find((o) => o.missionId === v.missionId);
  if (!opt) return { ok: false as const, error: 'That routine can’t count for this group.' };
  const g = page.group;
  if (g.targetRule === 'personal') {
    if (g.minTarget != null && v.target < g.minTarget) return { ok: false as const, error: `This group’s targets start at ${g.minTarget} a week.` };
    if (g.maxTarget != null && v.target > g.maxTarget) return { ok: false as const, error: `This group’s targets go up to ${g.maxTarget} a week.` };
  }
  await asUser(viewer.userId, (q) =>
    q.query(
      `update group_members set mission_id = $3, target = $4, unit = $5, proof_share = coalesce($6, proof_share) where group_id = $1 and user_id = $2`,
      [groupId, viewer.userId, v.missionId, g.targetRule === 'same' ? g.sameTarget : v.target, opt.unit, v.proofShare ?? null],
    ),
  );
  await lockCommitmentNow(groupId, viewer.userId, viewer.today);
  return { ok: true as const };
}

const memberSettings = z.object({
  displayName: z.string().trim().min(1).max(40),
  target: z.number().positive().max(10000).nullable().optional(),
  proofShare: z.enum(['never', 'ask', 'auto']),
});

/** Next season's target, name and proof sharing. The running season's pledge stays locked. */
export async function updateMyMembership(viewer: Viewer, groupId: string, raw: z.input<typeof memberSettings>) {
  const parsed = memberSettings.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Check your settings.' };
  const v = parsed.data;
  const page = await loadGroup(viewer, groupId);
  if (!page?.me) return { ok: false as const, error: 'You’re not in this group.' };
  const g = page.group;
  if (v.target != null && g.targetRule === 'personal') {
    if (g.minTarget != null && v.target < g.minTarget) return { ok: false as const, error: `Targets start at ${g.minTarget} a week here.` };
    if (g.maxTarget != null && v.target > g.maxTarget) return { ok: false as const, error: `Targets go up to ${g.maxTarget} a week here.` };
  }
  await asUser(viewer.userId, (q) =>
    q.query(
      `update group_members set display_name = $3, target = coalesce($4, target), proof_share = $5 where group_id = $1 and user_id = $2`,
      [groupId, viewer.userId, v.displayName, g.targetRule === 'same' ? null : v.target ?? null, v.proofShare],
    ),
  );
  return { ok: true as const };
}

export async function leaveGroup(viewer: Viewer, groupId: string) {
  if (!z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Invalid group.' };
  try {
    const rows = await asUser(viewer.userId, (q) => q.query(`update group_members set status = 'left' where group_id = $1 and user_id = $2 and status = 'active' returning user_id`, [groupId, viewer.userId]));
    if (!rows.length) return { ok: false as const, error: 'You’re not in this group.' };
  } catch (e) {
    if (/owner cannot leave/.test((e as Error).message)) return { ok: false as const, error: 'You own this group. Archive it instead, or make someone else owner first.' };
    throw e;
  }
  await recordActivity(groupId, viewer.userId, 'left', 'left the group', viewer.today, `left:${viewer.userId}:${viewer.today}`);
  void track(viewer.userId, 'group_left', {});
  return { ok: true as const };
}

export async function removeMember(viewer: Viewer, groupId: string, userId: string) {
  if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(userId).success) return { ok: false as const, error: 'Invalid member.' };
  try {
    const rows = await asUser(viewer.userId, (q) => q.query(`update group_members set status = 'removed' where group_id = $1 and user_id = $2 and status = 'active' returning user_id`, [groupId, userId]));
    return rows.length ? { ok: true as const } : { ok: false as const, error: 'Only owners and admins can remove members.' };
  } catch {
    return { ok: false as const, error: 'Only owners and admins can remove members.' };
  }
}

const settingsInput = z.object({
  name: z.string().trim().min(1).max(60),
  description: z.string().trim().max(500).nullable().optional(),
  proofPolicy: z.enum(['self_report', 'proof_optional', 'proof_required']),
  minTarget: z.number().positive().max(10000).nullable().optional(),
  maxTarget: z.number().positive().max(10000).nullable().optional(),
  prize: z.string().trim().max(200).nullable().optional(),
});

/** Owner/admin settings. Rules that change scoring apply to the next season's standings too, so they're shown to everyone. */
export async function updateGroupSettings(viewer: Viewer, groupId: string, raw: z.input<typeof settingsInput>) {
  const parsed = settingsInput.safeParse(raw);
  if (!parsed.success || !z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Check the settings.' };
  const v = parsed.data;
  const rows = await asUser(viewer.userId, (q) =>
    q.query(
      `update groups set name = $2, description = $3, proof_policy = $4, min_target = $5, max_target = $6, prize = $7 where id = $1 returning id`,
      [groupId, v.name, v.description || null, v.proofPolicy, v.minTarget ?? null, v.maxTarget ?? null, v.prize || null],
    ),
  );
  return rows.length ? { ok: true as const } : { ok: false as const, error: 'Only owners and admins can change settings.' };
}

export async function archiveGroup(viewer: Viewer, groupId: string) {
  if (!z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Invalid group.' };
  const [me] = await asUser(viewer.userId, (q) => q.query<{ role: string }>(`select role from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [groupId, viewer.userId]));
  if (me?.role !== 'owner') return { ok: false as const, error: 'Only the owner can archive the group.' };
  await asUser(viewer.userId, (q) => q.query(`update groups set archived_at = now() where id = $1`, [groupId]));
  return { ok: true as const };
}

export async function endSeasonNow(viewer: Viewer, groupId: string) {
  if (!z.uuid().safeParse(groupId).success) return { ok: false as const, error: 'Invalid group.' };
  const [me] = await asUser(viewer.userId, (q) => q.query<{ role: string }>(`select role from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [groupId, viewer.userId]));
  if (me?.role !== 'owner') return { ok: false as const, error: 'Only the owner can end a season.' };
  const ended = await endSeasonToday(groupId, viewer.today);
  if (ended) void track(viewer.userId, 'season_closed', { early: true });
  return ended ? { ok: true as const } : { ok: false as const, error: 'No season is running.' };
}

export async function setProofShared(viewer: Viewer, groupId: string, proofId: string, shared: boolean) {
  if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(proofId).success) return { ok: false as const, error: 'Invalid proof.' };
  try {
    await asUser(viewer.userId, (q) =>
      shared
        ? q.query(`insert into group_proof_shares (group_id, proof_id) values ($1, $2) on conflict do nothing`, [groupId, proofId])
        : q.query(`delete from group_proof_shares where group_id = $1 and proof_id = $2`, [groupId, proofId]),
    );
  } catch {
    return { ok: false as const, error: 'That proof can’t be shared with this group.' };
  }
  await refreshActivityProof(groupId, viewer.userId, proofId);
  return { ok: true as const };
}

/** The file behind a proof shared with a group — for its members only. */
export async function sharedProofFile(viewer: Viewer, groupId: string, proofId: string) {
  if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(proofId).success) return null;
  const [row] = await asUser(viewer.userId, (q) =>
    q.query<{ kind: string; body: string | null; url: string | null; bucket: 'proofs' | 'receipts' | null; object_path: string | null; thumb_path: string | null; mime_type: string | null }>(
      `select kind, body, url, bucket, object_path, thumb_path, mime_type from group_shared_proof($1, $2)`,
      [groupId, proofId],
    ),
  );
  return row ?? null;
}
