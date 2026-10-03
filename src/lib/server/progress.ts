import 'server-only';
import { asUser } from '@/lib/db';
import { addDays, diffDays, eachDay, jsWeekday, maxDate, startOfWeek, startOfYear, type ISODate } from '@/lib/engine/dates';
import { consistency, deltaPp, evaluate, execution, heatLevel, tallyRange, weightedExecution, type Evaluation } from '@/lib/engine/metrics';
import { isGymKind } from '@/lib/modules';
import { momentum, type Momentum } from '@/lib/engine/momentum';
import { streakStats } from '@/lib/engine/streaks';
import { levelFromXp } from '@/lib/engine/xp';
import type { AreaKind, Outcome } from '@/lib/engine/types';
import type { Viewer } from './context';
import { loadAreas, loadCompletions, loadMissions, totalXp } from './load';
import { PROOF_SELECT, toProofView, type ProofView } from './proofs';
import { listReviews, type ReviewSummary } from './reviews';
import { formatMoney } from '@/lib/engine/money';
import { readRecords, syncRecords } from './records';

export type ProgressRange = '7d' | '30d' | '90d' | '1y';
const RANGE_DAYS: Record<ProgressRange, number> = { '7d': 7, '30d': 30, '90d': 90, '1y': 365 };

export interface ScoreCard {
  execution: number | null;
  consistency: number | null;
  prevExecution: number | null;
  prevConsistency: number | null;
  planned: number;
  kept: number;
  full: number;
  minimum: number;
  partial: number;
  missed: number;
  excused: number;
  minutes: number;
}

export interface AreaProgress {
  id: string;
  kind: AreaKind;
  icon: string | null;
  name: string;
  execution: number | null;
  prev: number | null;
  delta: number | null;
  planned: number;
  kept: number;
  /** one factual line: workouts for Gym, time for Learning, done-of-planned otherwise */
  detail: string;
  spark: (number | null)[];
}

export interface HeatCell {
  day: ISODate;
  level: 0 | 1 | 2 | 3 | 4 | 5;
  kept: number;
  due: number;
  future: boolean;
  excused: number;
}

export interface MissionTotal {
  id: string;
  title: string;
  areaKind: AreaKind;
  measure: string;
  unit: string | null;
  sessions: number;
  total: number;
}

export interface ProgressData {
  today: ISODate;
  range: ProgressRange;
  start: ISODate;
  score: ScoreCard;
  momentum: Momentum;
  momentumSeries: (number | null)[];
  trend: { label: string; value: number | null; planned: number }[];
  areas: AreaProgress[];
  heatmap: { year: number; cells: HeatCell[]; firstDay: ISODate | null };
  streak: ReturnType<typeof streakStats>;
  records: { key: string; label: string; value: string; detail: string }[];
  evidence: { recent: ProofView[]; total: number; thisYear: number };
  record: { year: number; kept: number; minutes: number; proofs: number; perMission: MissionTotal[]; activeDays: number };
  reviews: ReviewSummary[];
  level: ReturnType<typeof levelFromXp>;
  /** one plain observation from the numbers, or nothing */
  insight: { title: string; body: string } | null;
}

const WEEKDAY_PLURAL = ['Sundays', 'Mondays', 'Tuesdays', 'Wednesdays', 'Thursdays', 'Fridays', 'Saturdays'];

/** The single most useful thing the numbers say — weakest weekday, the routine that slips, or the trend. */
function pickInsight(ev: Evaluation, start: ISODate, today: ISODate, titles: Map<string, string>, score: ScoreCard, rangeDays: number): ProgressData['insight'] {
  const from = maxDate(ev.start, addDays(today, -Math.max(rangeDays, 42)));
  const to = addDays(today, -1);
  if (to >= from) {
    const byDay = Array.from({ length: 7 }, () => ({ kept: 0, due: 0 }));
    for (const d of eachDay(from, to)) {
      const t = tallyRange(ev, d, d);
      const w = byDay[jsWeekday(d)];
      w.kept += t.kept;
      w.due += t.settledDue;
    }
    const rated = byDay.map((w, i) => ({ i, rate: w.due >= 6 ? w.kept / w.due : null, due: w.due, kept: w.kept })).filter((w) => w.rate != null) as { i: number; rate: number; due: number; kept: number }[];
    if (rated.length >= 4) {
      const worst = rated.reduce((a, b) => (b.rate < a.rate ? b : a));
      const rest = rated.filter((r) => r.i !== worst.i);
      const restRate = rest.reduce((s, r) => s + r.kept, 0) / Math.max(1, rest.reduce((s, r) => s + r.due, 0));
      if (restRate - worst.rate >= 0.15) {
        return {
          title: `${WEEKDAY_PLURAL[worst.i]} are your weakest day`,
          body: `You kept ${Math.round(worst.rate * 100)}% on ${WEEKDAY_PLURAL[worst.i]} against ${Math.round(restRate * 100)}% on other days, over the last ${diffDays(from, to) + 1} days.`,
        };
      }
    }
  }
  let slip: { title: string; kept: number; due: number } | null = null;
  for (const [id] of ev.byMission) {
    const t = tallyRange(ev, start, today, (m) => m.id === id);
    if (t.settledDue >= 4 && t.missed >= 3 && t.kept / t.settledDue < 0.6 && (!slip || t.kept / t.settledDue < slip.kept / slip.due)) {
      slip = { title: titles.get(id) ?? 'A routine', kept: t.kept, due: t.settledDue };
    }
  }
  if (slip) return { title: `${slip.title} is the one that slips`, body: `Done ${slip.kept} of ${slip.due} times in this range — the lowest of your routines.` };
  const delta = deltaPp(score.execution, score.prevExecution);
  if (delta != null && Math.abs(delta) >= 8) {
    return delta > 0
      ? { title: `Up ${Math.round(delta)} points`, body: `Execution rose from ${Math.round((score.prevExecution ?? 0) * 100)}% to ${Math.round((score.execution ?? 0) * 100)}% compared with the ${rangeDays} days before.` }
      : { title: `Down ${Math.round(-delta)} points`, body: `Execution fell from ${Math.round((score.prevExecution ?? 0) * 100)}% to ${Math.round((score.execution ?? 0) * 100)}% compared with the ${rangeDays} days before.` };
  }
  return null;
}

export async function loadProgress(viewer: Viewer, range: ProgressRange): Promise<ProgressData> {
  const { today, profile } = viewer;
  const ws = profile.weekStartsOn;
  const n = RANGE_DAYS[range];
  const start = addDays(today, -(n - 1));
  const prevStart = addDays(start, -n);
  const yearStart = startOfYear(today);
  const evStart = [prevStart, yearStart, addDays(today, -120)].sort()[0];

  const reviews = await listReviews(viewer, 10);

  return asUser(viewer.userId, async (q) => {
    const [areas, missions, completions, xpAll, workouts, learning, proofRows, proofCounts] = await Promise.all([
      loadAreas(q),
      loadMissions(q, { includeArchived: true }),
      loadCompletions(q, addDays(evStart, -7), today, profile.timezone),
      totalXp(q),
      q.query<{ n: number }>(`select count(*)::int as n from workout_sessions where status = 'completed' and performed_on between $1 and $2`, [start, today]),
      q.query<{ minutes: number; sessions: number }>(
        `select coalesce(sum(minutes), 0)::int as minutes, count(*)::int as sessions from learning_sessions where status = 'completed' and performed_on between $1 and $2`,
        [start, today],
      ),
      q.query<Parameters<typeof toProofView>[0]>(`${PROOF_SELECT} order by p.captured_on desc, p.id desc limit 8`),
      q.query<{ total: number; year: number }>(
        `select count(*)::int as total, count(*) filter (where captured_on >= $1)::int as year from proofs`,
        [yearStart],
      ),
    ]);
    const ev = evaluate(missions, completions, evStart, today, { today, weekStartsOn: ws });

    const cur = tallyRange(ev, start, today);
    const prev = tallyRange(ev, prevStart, addDays(start, -1));
    const score: ScoreCard = {
      execution: execution(cur),
      consistency: consistency(cur),
      prevExecution: execution(prev),
      prevConsistency: consistency(prev),
      planned: cur.settledDue,
      kept: cur.kept,
      full: cur.full + cur.exceeded,
      minimum: cur.minimum,
      partial: cur.partial,
      missed: cur.missed,
      excused: cur.excused,
      minutes: cur.minutes,
    };

    // trend: daily for ≤ 90 days, weekly for a year
    const trend: ProgressData['trend'] = [];
    if (range === '1y') {
      for (let w = startOfWeek(start, ws); w <= today; w = addDays(w, 7)) {
        const t = tallyRange(ev, w, addDays(w, 6) > today ? today : addDays(w, 6));
        trend.push({ label: w, value: execution(t), planned: t.settledDue });
      }
    } else {
      for (const d of eachDay(start, today)) {
        const t = tallyRange(ev, d, d);
        trend.push({ label: d, value: execution(t), planned: t.settledDue });
      }
    }

    const sparkWeeks = 8;
    const workoutCount = workouts[0]?.n ?? 0;
    const learnMin = learning[0]?.minutes ?? 0;
    const learnSessions = learning[0]?.sessions ?? 0;
    const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
    const areaRows: AreaProgress[] = areas.map((a) => {
      const f = (m: { areaId: string }) => m.areaId === a.id;
      const t = tallyRange(ev, start, today, f);
      const p = tallyRange(ev, prevStart, addDays(start, -1), f);
      const spark: (number | null)[] = [];
      for (let k = sparkWeeks - 1; k >= 0; k--) {
        const s = addDays(today, -(k * 7 + 6));
        spark.push(execution(tallyRange(ev, s, addDays(s, 6), f)));
      }
      const detail = isGymKind(a.kind)
        ? `${workoutCount} workout${workoutCount === 1 ? '' : 's'} · ${t.kept} of ${t.settledDue} planned done`
        : a.kind === 'learning'
          ? `${hm(learnMin)} over ${learnSessions} session${learnSessions === 1 ? '' : 's'}`
          : `${t.kept} of ${t.settledDue} planned done`;
      return {
        id: a.id, kind: a.kind, icon: a.icon, name: a.name, execution: execution(t), prev: execution(p), delta: deltaPp(execution(t), execution(p)),
        planned: t.settledDue, kept: t.kept, detail, spark,
      };
    }).filter((a) => a.planned > 0 || a.kept > 0 || (isGymKind(a.kind) && workoutCount > 0) || (a.kind === 'learning' && learnSessions > 0));

    // heatmap: the whole calendar year
    const year = Number(today.slice(0, 4));
    const firstDay = completions[0]?.day ?? null;
    const cells: HeatCell[] = eachDay(yearStart, `${year}-12-31`).map((d) => {
      if (d > today) return { day: d, level: 0, kept: 0, due: 0, future: true, excused: 0 };
      const i = diffDays(ev.start, d);
      const s = ev.days[i];
      if (!s) return { day: d, level: 0, kept: 0, due: 0, future: false, excused: 0 };
      return { day: d, level: heatLevel(s), kept: s.kept, due: s.settledDue, future: false, excused: s.excused };
    });

    // momentum history: weekly samples for the sparkline
    const momentumSeries: (number | null)[] = [];
    for (let k = 11; k >= 0; k--) {
      const d = addDays(today, -k * 7);
      momentumSeries.push(momentum(ev.days.filter((x) => x.day <= d), d).score);
    }

    const streak = streakStats(ev.days.filter((d) => d.day >= yearStart || d.day >= addDays(today, -120)), today, profile.streakThreshold);

    // personal records (within the evaluated window: this year + the last 120 days)
    const records: ProgressData['records'] = [];
    const bestDay = ev.days.reduce((b, d) => (d.kept > (b?.kept ?? 0) ? d : b), ev.days[0]);
    if (bestDay && bestDay.kept > 0) records.push({ key: 'best-day', label: 'Most kept in a day', value: String(bestDay.kept), detail: bestDay.day });
    if (streak.best > 0) records.push({ key: 'longest-run', label: 'Longest run', value: `${streak.best} days`, detail: streak.bestEnd ?? '' });
    let bestWeek: { start: ISODate; exec: number } | null = null;
    let bestFocus: { start: ISODate; minutes: number } | null = null;
    for (let w = startOfWeek(ev.start, ws); addDays(w, 6) < today; w = addDays(w, 7)) {
      const t = tallyRange(ev, w, addDays(w, 6));
      const e = weightedExecution(t);
      if (t.settledDue >= 10 && e != null && (!bestWeek || e > bestWeek.exec)) bestWeek = { start: w, exec: e };
      if (!bestFocus || t.minutes > bestFocus.minutes) bestFocus = { start: w, minutes: t.minutes };
    }
    if (bestWeek) records.push({ key: 'best-week', label: 'Best week', value: `${Math.round(bestWeek.exec * 100)}%`, detail: bestWeek.start });
    if (bestFocus && bestFocus.minutes > 0) {
      records.push({ key: 'focus-week', label: 'Most focused week', value: `${Math.round(bestFocus.minutes / 60)} h`, detail: bestFocus.start });
    }
    const [xpDay] = await q.query<{ occurred_on: string; xp: number }>(
      `select occurred_on, sum(amount)::int8 as xp from xp_events group by occurred_on order by xp desc limit 1`,
    );
    if (xpDay) records.push({ key: 'xp-day', label: 'Most points in a day', value: Number(xpDay.xp).toLocaleString('en-US'), detail: xpDay.occurred_on });

    // keep the all-time records table current (only complete days / weeks count)
    const settledBest = ev.days.filter((x) => x.day < today).reduce((b, x) => (x.kept > (b?.kept ?? 0) ? x : b), undefined as (typeof ev.days)[number] | undefined);
    await syncRecords(q, [
      ...(streak.best && streak.bestEnd ? [{ key: 'longest_run' as const, value: streak.best, achievedOn: streak.bestEnd }] : []),
      ...(settledBest ? [{ key: 'best_day_kept' as const, value: settledBest.kept, achievedOn: settledBest.day }] : []),
      ...(bestWeek ? [{ key: 'best_week_execution' as const, value: Math.round(bestWeek.exec * 1000) / 10, achievedOn: addDays(bestWeek.start, 6) }] : []),
      ...(bestFocus && bestFocus.minutes ? [{ key: 'most_focus_week' as const, value: bestFocus.minutes, achievedOn: addDays(bestFocus.start, 6) }] : []),
      ...(xpDay && xpDay.occurred_on < today ? [{ key: 'most_xp_day' as const, value: Number(xpDay.xp), achievedOn: xpDay.occurred_on }] : []),
    ]);
    const stored = await readRecords(q);
    const allTimeRun = stored.get('longest_run');
    if (allTimeRun && allTimeRun.value > streak.best) {
      const i = records.findIndex((r) => r.key === 'longest-run');
      if (i >= 0) records[i] = { key: 'longest-run', label: 'Longest run', value: `${allTimeRun.value} days`, detail: allTimeRun.achievedOn };
    }

    // the Record: this year's totals
    const perMission: MissionTotal[] = [];
    let yearKept = 0;
    let yearMinutes = 0;
    const activeDays = new Set<ISODate>();
    for (const m of missions) {
      const area = areas.find((a) => a.id === m.areaId);
      const cs = completions.filter((c) => c.missionId === m.id && c.day >= yearStart && (c.kept || c.outcome === 'partial'));
      if (!cs.length) continue;
      const kept = cs.filter((c) => c.kept).length;
      yearKept += kept;
      cs.forEach((c) => activeDays.add(c.day));
      const total = cs.reduce((s, c) => s + (c.value ?? 0), 0);
      if (m.measure === 'duration') yearMinutes += total;
      perMission.push({ id: m.id, title: m.title, areaKind: area?.kind ?? 'custom', measure: m.measure, unit: m.unit, sessions: kept, total });
    }
    perMission.sort((a, b) => b.sessions - a.sessions);

    return {
      today,
      range,
      start,
      score,
      momentum: momentum(ev.days, today),
      momentumSeries,
      trend,
      areas: areaRows,
      heatmap: { year, cells, firstDay },
      streak,
      records,
      evidence: {
        recent: proofRows.map((r) => toProofView(r, viewer.userId)),
        total: proofCounts[0]?.total ?? 0,
        thisYear: proofCounts[0]?.year ?? 0,
      },
      record: { year, kept: yearKept, minutes: yearMinutes, proofs: proofCounts[0]?.year ?? 0, perMission, activeDays: activeDays.size },
      reviews,
      level: levelFromXp(xpAll),
      insight: pickInsight(ev, start, today, new Map(missions.map((m) => [m.id, m.title])), score, n),
    };
  });
}

// ───────────────────────────────────────────── one day, in detail

export interface DayDetail {
  day: ISODate;
  planned: number;
  kept: number;
  execution: number | null;
  xp: number;
  items: {
    missionId: string;
    title: string;
    areaKind: AreaKind;
    status: 'kept' | 'partial' | 'missed' | 'excused' | 'open' | 'extra';
    outcome: Outcome | null;
    value: number | null;
    unit: string | null;
    note: string | null;
    reason: string | null;
  }[];
  proofs: ProofView[];
  money: { label: string; amount: string; kind: string }[];
  keystone: string | null;
}

export async function loadDay(viewer: Viewer, day: ISODate): Promise<DayDetail | null> {
  const { today, profile } = viewer;
  if (day > today) return null;
  return asUser(viewer.userId, async (q) => {
    const [areas, missions, completions, xp, proofs, money] = await Promise.all([
      loadAreas(q),
      loadMissions(q, { includeArchived: true }),
      loadCompletions(q, addDays(day, -7), day, profile.timezone),
      q.query<{ xp: number }>(`select coalesce(sum(amount), 0)::int8 as xp from xp_events where occurred_on = $1`, [day]),
      q.query<Parameters<typeof toProofView>[0]>(`${PROOF_SELECT} where p.captured_on = $1 order by p.created_at`, [day]),
      q.query<{ kind: string; amount_minor: number; currency: string; counterparty: string | null; category: string | null }>(
        `select t.kind, t.amount_minor, t.currency, t.counterparty, c.name as category
           from transactions t left join categories c on c.id = t.category_id
          where t.occurred_on = $1 and t.kind in ('income', 'expense') order by t.created_at`,
        [day],
      ),
    ]);
    const ev = evaluate(missions, completions, day, day, { today, weekStartsOn: profile.weekStartsOn });
    const s = ev.days[0];
    const items: DayDetail['items'] = [];
    for (const m of missions) {
      const md = ev.byMission.get(m.id)![0];
      const c = md.completion;
      const area = areas.find((a) => a.id === m.areaId);
      let status: DayDetail['items'][number]['status'] | null = null;
      if (md.status === 'extra' && c?.kept) status = 'extra';
      else if (c?.outcome === 'skipped' && md.status === 'required') status = 'excused';
      else if (md.counts) status = c?.kept ? 'kept' : c?.outcome === 'partial' ? 'partial' : day === today && !c ? 'open' : 'missed';
      if (!status) continue;
      const row = completions.find((x) => x.missionId === m.id && x.day === day);
      items.push({
        missionId: m.id, title: m.title, areaKind: area?.kind ?? 'custom', status, outcome: c?.outcome ?? null,
        value: c?.value ?? null, unit: m.unit, note: row?.note ?? null, reason: c?.reason ?? null,
      });
    }
    const order = { kept: 0, extra: 1, partial: 2, open: 3, excused: 4, missed: 5 };
    items.sort((a, b) => order[a.status] - order[b.status]);
    const [k] = await q.query<{ title: string }>(
      `select title from keystones where status = 'done' and (done_at at time zone $2)::date = $1 limit 1`,
      [day, profile.timezone],
    );
    return {
      day,
      planned: s.settledDue + s.open,
      kept: s.kept,
      execution: execution(s),
      xp: Number(xp[0]?.xp ?? 0),
      items,
      proofs: proofs.map((r) => toProofView(r, viewer.userId)),
      money: money.map((t) => ({
        label: t.counterparty || t.category || (t.kind === 'income' ? 'Income' : 'Expense'),
        amount: formatMoney(Number(t.amount_minor), t.currency, { signed: true }),
        kind: t.kind,
      })),
      keystone: k?.title ?? null,
    };
  });
}
