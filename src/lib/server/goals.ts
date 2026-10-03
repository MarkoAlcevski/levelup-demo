import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, diffDays, type ISODate } from '@/lib/engine/dates';
import { evaluate, execution, tallyRange } from '@/lib/engine/metrics';
import { flowTotals } from '@/lib/engine/finance';
import { formatMoney } from '@/lib/engine/money';
import type { AreaKind } from '@/lib/engine/types';
import type { Viewer } from './profile';
import { loadCompletions, loadMissions, type MissionMeta } from './load';
import { loadFinance } from './money';
import { track } from './analytics';

/**
 * Goals the user writes for themselves, inside an area ("Reach €5k MRR", "Read 20 books").
 * Health compares actual progress with a straight line from start to deadline — and always says
 * both numbers — instead of guessing at motivation.
 */

export type GoalHealth = 'ahead' | 'on_track' | 'behind' | 'at_risk' | 'no_data' | 'achieved';

export interface GoalView {
  id: string;
  title: string;
  kind: 'outcome' | 'input';
  metric: string;
  unit: string | null;
  currency: string | null;
  start: number;
  target: number;
  current: number | null;
  progress: number | null;
  expected: number;
  health: GoalHealth;
  explanation: string;
  startOn: ISODate;
  targetOn: ISODate | null;
  daysLeft: number | null;
  inputs: { id: string; title: string; execution: number | null; prev: number | null }[];
  areaId: string | null;
  areaKind: AreaKind | null;
}

type GoalRow = {
  id: string; title: string; kind: 'outcome' | 'input'; metric: string; unit: string | null; currency: string | null; start_value: number;
  target_value: number; start_on: string; target_on: string | null; status: string; area_id: string | null; mission_id: string | null;
};

export async function loadGoals(q: Queryable, viewer: Viewer, opts: { areaId?: string } = {}): Promise<GoalView[]> {
  const { today, profile } = viewer;
  const goals = await q.query<GoalRow>(
    `select id, title, kind, metric, unit, currency, start_value, target_value, start_on, target_on, status, area_id, mission_id
       from goals where status <> 'dropped' ${opts.areaId ? 'and area_id = $1' : ''} order by created_at`,
    opts.areaId ? [opts.areaId] : [],
  );
  if (!goals.length) return [];
  const [links, checkins, areas] = await Promise.all([
    q.query<{ goal_id: string; mission_id: string }>(`select goal_id, mission_id from goal_missions`),
    q.query<{ goal_id: string; value: number; recorded_on: string }>(`select goal_id, value, recorded_on from goal_checkins order by recorded_on`),
    q.query<{ id: string; kind: AreaKind }>(`select id, kind from areas`),
  ]);
  const inputIds = [...new Set([...links.map((l) => l.mission_id), ...goals.map((g) => g.mission_id).filter((x): x is string => !!x)])];
  const missions = inputIds.length ? await loadMissions(q, { ids: inputIds, includeArchived: true }) : [];
  const from = addDays(today, -41);
  const completions = inputIds.length ? await loadCompletions(q, addDays(from, -7), today, profile.timezone) : [];
  const ev = missions.length ? evaluate(missions, completions.filter((c) => inputIds.includes(c.missionId)), from, today, { today, weekStartsOn: profile.weekStartsOn }) : null;
  const finance = goals.some((g) => g.metric === 'income_month') ? await loadFinance(q, profile.baseCurrency) : null;

  return goals.map((g) => {
    const inputs = links
      .filter((l) => l.goal_id === g.id)
      .map((l) => missions.find((m) => m.id === l.mission_id))
      .filter((m): m is MissionMeta => !!m)
      .map((m) => ({
        id: m.id,
        title: m.title,
        execution: ev ? execution(tallyRange(ev, addDays(today, -13), today, (x) => x.id === m.id)) : null,
        prev: ev ? execution(tallyRange(ev, addDays(today, -27), addDays(today, -14), (x) => x.id === m.id)) : null,
      }));
    let current: number | null = null;
    if (g.metric === 'manual') {
      const cs = checkins.filter((c) => c.goal_id === g.id);
      current = cs.length ? Number(cs.at(-1)!.value) : null;
    } else if (g.metric === 'income_month' && finance) {
      const period = { preset: '30d' as const, start: addDays(today, -29), end: today, label: '' };
      const f = flowTotals(finance.txs, finance.accountMap, period, today, { base: profile.baseCurrency, book: finance.book });
      current = f.txCount ? f.income / 100 : null;
    } else if ((g.metric === 'mission_count' || g.metric === 'mission_total') && g.mission_id) {
      const cs = completions.filter((c) => c.missionId === g.mission_id && c.day >= g.start_on);
      current = g.metric === 'mission_count' ? cs.filter((c) => c.kept).length : cs.reduce((s, c) => s + (c.value ?? 0), 0);
    }
    return goalView(g, current, inputs, today, areas.find((a) => a.id === g.area_id)?.kind ?? null, profile.baseCurrency);
  });
}

/**
 * Goal health, explained. Expected progress is linear between start and target date.
 * ratio = actual progress ÷ expected progress: ≥ 1.10 ahead · ≥ 0.95 on track · ≥ 0.75 behind · else at risk.
 */
function goalView(g: GoalRow, current: number | null, inputs: GoalView['inputs'], today: ISODate, areaKind: AreaKind | null, base: string): GoalView {
  const start = Number(g.start_value);
  const target = Number(g.target_value);
  const span = target - start;
  const progress = current == null || span === 0 ? null : Math.max(0, (current - start) / span);
  const total = g.target_on ? Math.max(1, diffDays(g.start_on, g.target_on)) : null;
  const elapsed = Math.max(0, diffDays(g.start_on, today));
  const expected = total ? Math.min(1, elapsed / total) : 0;
  const daysLeft = g.target_on ? Math.max(0, diffDays(today, g.target_on)) : null;
  const fmt = (v: number) =>
    g.metric === 'income_month' ? formatMoney(Math.round(v * 100), g.currency ?? base, { whole: true }) : `${Math.round(v * 10) / 10}${g.unit ? ` ${g.unit}` : ''}`;
  const withData = inputs.filter((i) => i.execution != null && i.prev != null);
  const inputTrend = withData.length ? withData.reduce((s, i) => s + (i.execution! - i.prev!), 0) / withData.length : null;
  const trendText = inputTrend == null ? '' : inputTrend > 0.05 ? ' Linked routines are trending up over 14 days.' : inputTrend < -0.05 ? ' Linked routines slipped over the last 14 days.' : ' Linked routines are steady.';

  let health: GoalHealth;
  let explanation: string;
  if (g.status === 'achieved' || (progress != null && progress >= 1)) {
    health = 'achieved';
    explanation = `Reached ${fmt(current ?? target)}.`;
  } else if (progress == null) {
    health = 'no_data';
    explanation = g.metric === 'manual' ? 'Log a check-in to start tracking this goal.' : 'No data yet for this goal.';
  } else if (!total) {
    health = 'on_track';
    explanation = `${fmt(current!)} of ${fmt(target)}. No deadline set.${trendText}`;
  } else if (expected < 0.05) {
    health = 'on_track';
    explanation = `Just started — ${fmt(current!)} of ${fmt(target)}.${trendText}`;
  } else {
    const ratio = progress / expected;
    health = ratio >= 1.1 ? 'ahead' : ratio >= 0.95 ? 'on_track' : ratio >= 0.75 ? 'behind' : 'at_risk';
    const gap = Math.round(Math.abs(1 - ratio) * 100);
    const where = `${fmt(current!)} now; a straight line to the deadline passes ${fmt(start + span * expected)} today.`;
    explanation = health === 'ahead' ? `${gap}% ahead of that line — ${where}${trendText}` : health === 'on_track' ? `On the line — ${where}${trendText}` : `${gap}% behind that line — ${where}${trendText}`;
  }
  return {
    id: g.id, title: g.title, kind: g.kind, metric: g.metric, unit: g.unit, currency: g.currency, start, target, current, progress, expected,
    health, explanation, startOn: g.start_on, targetOn: g.target_on, daysLeft, inputs, areaId: g.area_id, areaKind,
  };
}

const goalInput = z.object({
  title: z.string().trim().min(1, 'Name the goal.').max(120),
  areaId: z.uuid().nullable().optional(),
  unit: z.string().trim().max(16).nullable().optional(),
  startValue: z.number().finite().min(-1e9).max(1e9).default(0),
  targetValue: z.number().finite().min(-1e9).max(1e9),
  targetOn: z.iso.date().nullable().optional(),
  missionIds: z.array(z.uuid()).max(8).default([]),
});
export type GoalInput = z.input<typeof goalInput>;

export async function createGoal(viewer: Viewer, raw: GoalInput) {
  const parsed = goalInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the goal.' };
  const v = parsed.data;
  if (v.targetValue === v.startValue) return { ok: false as const, error: 'The target has to differ from where you start.' };
  if (v.targetOn && v.targetOn <= viewer.today) return { ok: false as const, error: 'Pick a deadline in the future.' };
  await asUser(viewer.userId, async (q) => {
    const [g] = await q.query<{ id: string }>(
      `insert into goals (area_id, title, kind, metric, unit, start_value, target_value, start_on, target_on)
       values ($1, $2, 'outcome', 'manual', $3, $4, $5, $6, $7) returning id`,
      [v.areaId ?? null, v.title, v.unit || null, v.startValue, v.targetValue, viewer.today, v.targetOn ?? null],
    );
    for (const m of v.missionIds) await q.query(`insert into goal_missions (goal_id, mission_id) values ($1, $2) on conflict do nothing`, [g.id, m]);
    await q.query(`insert into goal_checkins (goal_id, value, recorded_on) values ($1, $2, $3) on conflict do nothing`, [g.id, v.startValue, viewer.today]);
  });
  void track(viewer.userId, 'goal_created', {});
  return { ok: true as const };
}

const checkinInput = z.object({ goalId: z.uuid(), value: z.number().finite().min(-1e9).max(1e9) });

export async function addGoalCheckin(viewer: Viewer, raw: z.input<typeof checkinInput>) {
  const parsed = checkinInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: 'Enter a number.' };
  await asUser(viewer.userId, (q) =>
    q.query(
      `insert into goal_checkins (goal_id, value, recorded_on) values ($1, $2, $3)
       on conflict (goal_id, recorded_on) do update set value = excluded.value`,
      [parsed.data.goalId, parsed.data.value, viewer.today],
    ),
  );
  return { ok: true as const };
}

export async function dropGoal(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid goal.' };
  await asUser(viewer.userId, (q) => q.query(`update goals set status = 'dropped' where id = $1`, [id]));
  return { ok: true as const };
}
