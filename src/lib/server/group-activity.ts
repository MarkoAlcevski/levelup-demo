import 'server-only';
import { asSystem, type Queryable } from '@/lib/db';
import { startOfWeek, type ISODate } from '@/lib/engine/dates';
import { fmtAmount, pledgeFor, type GroupUnit } from '@/lib/engine/groups';
import type { Viewer } from './profile';

/**
 * The group feed follows the record, never the other way round. When a completion of a routine
 * that a member linked to a group changes, the matching feed line is written (or removed), and a
 * "hit this week's target" line appears when the week's pledge is met. Only the headline goes out —
 * "Filip completed Legs" — never weights, reps, notes or proof (unless that proof was shared).
 *
 * Runs after the user's own transaction has committed, with owner privileges (members cannot write
 * the feed), and never throws into the product.
 */

interface LinkRow {
  group_id: string;
  unit: GroupUnit | null;
  proof_share: 'never' | 'ask' | 'auto';
  module: 'gym' | 'learning' | null;
  title: string;
}

async function linkedGroups(q: Queryable, userId: string, missionId: string): Promise<LinkRow[]> {
  return q.query<LinkRow>(
    `select gm.group_id, gm.unit, gm.proof_share, m.module, m.title
       from public.group_members gm
       join public.groups g on g.id = gm.group_id and g.archived_at is null
       join public.missions m on m.id = gm.mission_id
      where gm.user_id = $1 and gm.mission_id = $2 and gm.status = 'active'`,
    [userId, missionId],
  );
}

async function headline(q: Queryable, userId: string, link: LinkRow, missionId: string, day: ISODate, value: number | null): Promise<string> {
  if (link.module === 'gym') {
    const sessions = await q.query<{ name: string }>(
      `select name from public.workout_sessions where user_id = $1 and performed_on = $2 and status = 'completed' order by started_at`,
      [userId, day],
    );
    return sessions.length ? `completed ${[...new Set(sessions.map((s) => s.name))].join(' + ')}` : 'logged a workout';
  }
  if (link.module === 'learning') {
    const [s] = await q.query<{ name: string; measure: string; unit: string | null }>(
      `select name, measure, unit from public.learning_subjects where mission_id = $1`,
      [missionId],
    );
    if (s && value != null) {
      const unit: GroupUnit = s.measure === 'minutes' ? 'minutes' : s.measure === 'sessions' ? 'sessions' : s.measure === 'pages' ? 'pages' : s.measure === 'lessons' ? 'lessons' : 'units';
      return `logged ${fmtAmount(value, unit)}${unit === 'units' && s.unit ? ` ${s.unit}` : ''} of ${s.name}`;
    }
    return `studied ${s?.name ?? link.title}`;
  }
  return `kept ${link.title}`;
}

export async function afterCompletionChange(viewer: Viewer, missionId: string, day: ISODate): Promise<void> {
  try {
    await asSystem(async (q) => {
      const links = await linkedGroups(q, viewer.userId, missionId);
      if (!links.length) return;
      const [c] = await q.query<{ id: string; kept: boolean; value: number | null; outcome: string }>(
        `select id, kept, value, outcome from public.completions where user_id = $1 and mission_id = $2 and occurred_on = $3`,
        [viewer.userId, missionId, day],
      );
      for (const link of links) {
        const key = `c:${missionId}:${day}`;
        const counts = c && c.outcome !== 'missed' && c.outcome !== 'skipped' && (c.kept || (link.unit != null && !['workouts', 'times'].includes(link.unit) && (c.value ?? 0) > 0));
        if (!counts) {
          await q.query(`delete from public.group_activity where group_id = $1 and source_key = $2`, [link.group_id, key]);
        } else {
          const title = await headline(q, viewer.userId, link, missionId, day, c.value == null ? null : Number(c.value));
          const [shared] = await q.query<{ proof_id: string }>(
            `select s.proof_id from public.group_proof_shares s join public.proofs p on p.id = s.proof_id
              where s.group_id = $1 and p.completion_id = $2 order by s.shared_at limit 1`,
            [link.group_id, c.id],
          );
          await q.query(
            `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, proof_id, source_key)
             values ($1, $2, 'activity', $3, $4, $5, $6)
             on conflict (group_id, source_key) do update set title = excluded.title, proof_id = excluded.proof_id`,
            [link.group_id, viewer.userId, title, day, shared?.proof_id ?? null, key],
          );
        }
        await weekTargetLine(q, viewer.userId, link.group_id, day);
      }
    });
  } catch (e) {
    console.error('[kept] group activity failed', (e as Error).message);
  }
}

/** "Marko hit this week's target (4/4)" — once per member per week, withdrawn if it stops being true. */
async function weekTargetLine(q: Queryable, userId: string, groupId: string, day: ISODate) {
  const [season] = await q.query<{ id: string; starts_on: string; ends_on: string }>(
    `select id, starts_on, ends_on from public.group_seasons where group_id = $1 and status = 'active' and $2 between starts_on and ends_on`,
    [groupId, day],
  );
  if (!season) return;
  const [commit] = await q.query<{ target: number; unit: GroupUnit; starts_on: string }>(
    `select target, unit, starts_on from public.group_commitments where season_id = $1 and user_id = $2`,
    [season.id, userId],
  );
  if (!commit) return;
  const [g] = await q.query<{ proof_policy: string }>(`select proof_policy from public.groups where id = $1`, [groupId]);
  const ws = startOfWeek(day, 1);
  const from = [ws, season.starts_on, commit.starts_on].sort().at(-1)!;
  const to = [addSix(ws), season.ends_on].sort()[0];
  const rows = await q.query<{ user_id: string; amount: number; proofed: boolean }>(
    `select user_id, amount, proofed from public.group_activity_raw($1, $2, $3) where user_id = $4`,
    [groupId, from, to, userId],
  );
  const done = rows.filter((r) => g?.proof_policy !== 'proof_required' || r.proofed).reduce((s, r) => s + Number(r.amount), 0);
  const days = Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const pledge = pledgeFor(Number(commit.target), days, commit.unit);
  const key = `wk:${season.id}:${ws}`;
  if (pledge > 0 && done >= pledge) {
    await q.query(
      `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, source_key)
       values ($1, $2, 'week_target', $3, $4, $5) on conflict (group_id, source_key) do nothing`,
      [groupId, userId, `hit this week’s target · ${fmtAmount(done, commit.unit)} of ${fmtAmount(pledge, commit.unit)}`, day, `${key}:${userId}`],
    );
  } else {
    await q.query(`delete from public.group_activity where group_id = $1 and source_key = $2`, [groupId, `${key}:${userId}`]);
  }
}

function addSix(d: ISODate): ISODate {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + 6);
  return t.toISOString().slice(0, 10);
}

/**
 * Proof sharing is explicit. "auto" members share proof on routines they linked to a group as soon
 * as it's attached; "ask" members get a Share action; "never" means never.
 * Returns the groups that could receive this proof but haven't (for the Share prompt).
 */
export async function afterProofAttached(viewer: Viewer, proofId: string): Promise<{ groupId: string; name: string }[]> {
  try {
    return await asSystem(async (q) => {
      const [p] = await q.query<{ completion_id: string; mission_id: string; occurred_on: string }>(
        `select p.completion_id, c.mission_id, c.occurred_on from public.proofs p join public.completions c on c.id = p.completion_id
          where p.id = $1 and p.user_id = $2`,
        [proofId, viewer.userId],
      );
      if (!p) return [];
      const links = await q.query<{ group_id: string; name: string; proof_share: string }>(
        `select gm.group_id, g.name, gm.proof_share from public.group_members gm join public.groups g on g.id = gm.group_id
          where gm.user_id = $1 and gm.mission_id = $2 and gm.status = 'active' and g.archived_at is null`,
        [viewer.userId, p.mission_id],
      );
      const ask: { groupId: string; name: string }[] = [];
      for (const l of links) {
        if (l.proof_share === 'auto') {
          await q.query(
            `insert into public.group_proof_shares (group_id, user_id, proof_id) values ($1, $2, $3) on conflict do nothing`,
            [l.group_id, viewer.userId, proofId],
          );
          await q.query(
            `update public.group_activity set proof_id = coalesce(proof_id, $3) where group_id = $1 and source_key = $2`,
            [l.group_id, `c:${p.mission_id}:${p.occurred_on}`, proofId],
          );
        } else if (l.proof_share === 'ask') ask.push({ groupId: l.group_id, name: l.name });
      }
      return ask;
    });
  } catch (e) {
    console.error('[kept] proof share failed', (e as Error).message);
    return [];
  }
}

/** After a manual share/unshare, point the day's feed line at the proof (or away from it). */
export async function refreshActivityProof(groupId: string, userId: string, proofId: string): Promise<void> {
  await asSystem(async (q) => {
    const [p] = await q.query<{ mission_id: string; occurred_on: string }>(
      `select c.mission_id, c.occurred_on from public.proofs p join public.completions c on c.id = p.completion_id where p.id = $1 and p.user_id = $2`,
      [proofId, userId],
    );
    if (!p) return;
    const [shared] = await q.query<{ n: number }>(`select count(*)::int as n from public.group_proof_shares where group_id = $1 and proof_id = $2`, [groupId, proofId]);
    await q.query(
      `update public.group_activity set proof_id = $3 where group_id = $1 and source_key = $2 and user_id = $4`,
      [groupId, `c:${p.mission_id}:${p.occurred_on}`, shared.n ? proofId : null, userId],
    );
  });
}
