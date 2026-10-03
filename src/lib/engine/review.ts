import { addDays, diffDays, formatRange, weekdayName, type ISODate } from './dates';
import { diagnoseMission, pct, type Insight } from './insights';
import { consistency, deltaPp, execution, tallyRange, type Evaluation, type Tally } from './metrics';
import { momentum } from './momentum';
import { streakStats } from './streaks';
import type { AreaDef } from './types';
import type { Anomaly, FlowTotals } from './finance';
import { formatMoney } from './money';

/**
 * Review = deterministic statistics for a period vs the one before, plus rule-based insights.
 * The stats object is stored with the review (reviews.stats) so a review never changes after the
 * fact, and can be regenerated from raw data if the engine version changes.
 */

export const REVIEW_ENGINE_VERSION = 1;

export interface ReviewInput {
  kind: 'week' | 'month' | 'custom';
  start: ISODate;
  end: ISODate;
  prevStart: ISODate;
  prevEnd: ISODate;
  today: ISODate;
  /** must cover at least [prevStart − 56 days, end] */
  ev: Evaluation;
  areas: AreaDef[];
  titles: Map<string, string>;
  xp: number;
  xpPrev: number;
  proofs: number;
  keystone: { title: string; status: 'open' | 'done' | 'missed' } | null;
  streakThreshold: number;
  money?: {
    base: string;
    current: FlowTotals;
    previous: FlowTotals | null;
    anomalies: Anomaly[];
  };
}

export interface AreaRow {
  id: string;
  name: string;
  kind: string;
  planned: number;
  kept: number;
  execution: number | null;
  prevExecution: number | null;
  deltaPp: number | null;
}

export interface MissionRow {
  id: string;
  title: string;
  planned: number;
  kept: number;
  consistency: number | null;
}

export interface ReviewStats {
  version: number;
  kind: ReviewInput['kind'];
  start: ISODate;
  end: ISODate;
  prevStart: ISODate;
  prevEnd: ISODate;
  label: string;
  planned: number;
  kept: number;
  execution: number | null;
  consistency: number | null;
  outcomes: { full: number; exceeded: number; minimum: number; partial: number; missed: number; excused: number };
  prev: { planned: number; kept: number; execution: number | null; consistency: number | null; xp: number; minutes: number };
  areas: AreaRow[];
  days: { day: ISODate; planned: number; kept: number; execution: number | null }[];
  bestDay: { day: ISODate; execution: number } | null;
  worstDay: { day: ISODate; execution: number } | null;
  bestWeekday: { weekday: string; execution: number } | null;
  mostConsistent: MissionRow | null;
  mostMissed: MissionRow | null;
  strongestArea: AreaRow | null;
  weakestArea: AreaRow | null;
  minutes: number;
  xp: number;
  proofs: number;
  keystone: ReviewInput['keystone'];
  momentum: { start: number | null; end: number | null; label: string };
  streak: { current: number; best: number; recoveries: { brokeOn: ISODate; days: number }[] };
  money: null | {
    base: string;
    income: number;
    expenses: number;
    net: number;
    savingsRate: number | null;
    prevIncome: number | null;
    prevExpenses: number | null;
  };
}

function outcomes(t: Tally) {
  return { full: t.full, exceeded: t.exceeded, minimum: t.minimum, partial: t.partial, missed: t.missed, excused: t.excused };
}

export function buildReview(input: ReviewInput): { stats: ReviewStats; insights: Insight[] } {
  const { ev, start, end, prevStart, prevEnd, today } = input;
  const cur = tallyRange(ev, start, end);
  const prev = tallyRange(ev, prevStart, prevEnd);

  const areas: AreaRow[] = input.areas
    .map((a) => {
      const t = tallyRange(ev, start, end, (m) => m.areaId === a.id);
      const p = tallyRange(ev, prevStart, prevEnd, (m) => m.areaId === a.id);
      const e = execution(t);
      const pe = execution(p);
      return {
        id: a.id, name: a.name, kind: a.kind, planned: t.settledDue, kept: t.kept,
        execution: e, prevExecution: pe, deltaPp: deltaPp(e, pe),
      };
    })
    .filter((a) => a.planned > 0);

  const days = ev.days
    .filter((d) => d.day >= start && d.day <= end)
    .map((d) => ({ day: d.day, planned: d.settledDue, kept: d.kept, execution: d.settledDue ? d.credit / d.settledDue : null }));
  const scored = days.filter((d) => d.execution != null && d.planned >= 2) as { day: ISODate; planned: number; kept: number; execution: number }[];
  const bestDay = scored.length ? scored.reduce((a, b) => (b.execution > a.execution ? b : a)) : null;
  const worstDay = scored.length > 1 ? scored.reduce((a, b) => (b.execution < a.execution ? b : a)) : null;

  // weekday profile over the whole evaluated history (more signal than a single week)
  const wd = new Map<string, { credit: number; due: number }>();
  for (const d of ev.days) {
    if (d.day > end || d.settledDue === 0) continue;
    const k = weekdayName(d.day, true);
    const w = wd.get(k) ?? { credit: 0, due: 0 };
    w.credit += d.credit;
    w.due += d.settledDue;
    wd.set(k, w);
  }
  const wdRows = [...wd.entries()].filter(([, w]) => w.due >= 8).map(([weekday, w]) => ({ weekday, execution: w.credit / w.due }));
  const bestWeekday = wdRows.length >= 5 ? wdRows.reduce((a, b) => (b.execution > a.execution ? b : a)) : null;

  const missions: MissionRow[] = [];
  for (const [id] of ev.byMission) {
    const t = tallyRange(ev, start, end, (m) => m.id === id);
    if (t.settledDue === 0) continue;
    missions.push({ id, title: input.titles.get(id) ?? 'Routine', planned: t.settledDue, kept: t.kept, consistency: consistency(t) });
  }
  const eligible = missions.filter((m) => m.planned >= 2);
  const mostConsistent = eligible.length
    ? eligible.reduce((a, b) => ((b.consistency ?? 0) > (a.consistency ?? 0) || ((b.consistency ?? 0) === (a.consistency ?? 0) && b.planned > a.planned) ? b : a))
    : null;
  const missedRows = eligible.filter((m) => m.kept < m.planned);
  const mostMissed = missedRows.length
    ? missedRows.reduce((a, b) => (b.planned - b.kept > a.planned - a.kept ? b : a))
    : null;

  const withExec = areas.filter((a) => a.execution != null);
  const strongestArea = withExec.length ? withExec.reduce((a, b) => (b.execution! > a.execution! ? b : a)) : null;
  const weakestArea = withExec.length > 1 ? withExec.reduce((a, b) => (b.execution! < a.execution! ? b : a)) : null;

  const momStart = momentum(ev.days.filter((d) => d.day <= addDays(start, -1)), addDays(start, -1));
  const momEnd = momentum(ev.days.filter((d) => d.day <= end), end < today ? end : today);
  const streak = streakStats(ev.days.filter((d) => d.day <= end), end < today ? end : today, input.streakThreshold);

  const stats: ReviewStats = {
    version: REVIEW_ENGINE_VERSION,
    kind: input.kind,
    start, end, prevStart, prevEnd,
    label: formatRange(start, end),
    planned: cur.settledDue,
    kept: cur.kept,
    execution: execution(cur),
    consistency: consistency(cur),
    outcomes: outcomes(cur),
    prev: {
      planned: prev.settledDue, kept: prev.kept, execution: execution(prev), consistency: consistency(prev),
      xp: input.xpPrev, minutes: prev.minutes,
    },
    areas,
    days,
    bestDay: bestDay ? { day: bestDay.day, execution: bestDay.execution } : null,
    worstDay: worstDay && worstDay.day !== bestDay?.day ? { day: worstDay.day, execution: worstDay.execution } : null,
    bestWeekday,
    mostConsistent,
    mostMissed,
    strongestArea,
    weakestArea,
    minutes: cur.minutes,
    xp: input.xp,
    proofs: input.proofs,
    keystone: input.keystone,
    momentum: { start: momStart.score, end: momEnd.score, label: momEnd.label },
    streak: {
      current: streak.current,
      best: streak.best,
      recoveries: streak.recoveries.filter((r) => r.recoveredOn >= start && r.recoveredOn <= end).map((r) => ({ brokeOn: r.brokeOn, days: r.days })),
    },
    money: input.money
      ? {
          base: input.money.base,
          income: input.money.current.income,
          expenses: input.money.current.expenses,
          net: input.money.current.net,
          savingsRate: input.money.current.savingsRate,
          prevIncome: input.money.previous?.income ?? null,
          prevExpenses: input.money.previous?.expenses ?? null,
        }
      : null,
  };

  return { stats, insights: reviewInsights(stats, input) };
}

function reviewInsights(s: ReviewStats, input: ReviewInput): Insight[] {
  const out: Insight[] = [];

  // 1. the slipping mission, diagnosed
  if (s.mostMissed && s.mostMissed.planned - s.mostMissed.kept >= 2) {
    const m = input.ev.missions.get(s.mostMissed.id);
    const mds = input.ev.byMission.get(s.mostMissed.id);
    const planned = `You planned ${s.mostMissed.title} ${s.mostMissed.planned} times and kept it ${s.mostMissed.kept}.`;
    const dx = m && mds ? diagnoseMission(m, mds, input.today) : null;
    out.push(
      dx
        ? { ...dx, body: `${planned} ${dx.body}` }
        : {
            key: `missed:${s.mostMissed.id}`,
            kind: 'pattern',
            tone: 'warning',
            title: `${s.mostMissed.title} slipped`,
            body: planned,
            suggestion: 'Set a minimum version, or lower the target for next week.',
            evidence: { planned: s.mostMissed.planned, kept: s.mostMissed.kept },
          },
    );
  }

  // 2. biggest area move
  const movers = s.areas.filter((a) => a.deltaPp != null && Math.abs(a.deltaPp) >= 10);
  if (movers.length) {
    const up = movers.reduce((a, b) => (b.deltaPp! > a.deltaPp! ? b : a));
    const down = movers.reduce((a, b) => (b.deltaPp! < a.deltaPp! ? b : a));
    if (up.deltaPp! > 0) {
      out.push({
        key: `area-up:${up.id}`, kind: 'change', tone: 'positive',
        title: `${up.name} up ${Math.round(up.deltaPp!)} points`,
        body: `${up.name} execution went from ${pct(up.prevExecution!)} to ${pct(up.execution!)}.`,
        evidence: { from: up.prevExecution, to: up.execution },
      });
    }
    if (down.deltaPp! < 0 && down.id !== up.id) {
      out.push({
        key: `area-down:${down.id}`, kind: 'change', tone: 'warning',
        title: `${down.name} down ${Math.abs(Math.round(down.deltaPp!))} points`,
        body: `${down.name} execution fell from ${pct(down.prevExecution!)} to ${pct(down.execution!)}.`,
        evidence: { from: down.prevExecution, to: down.execution },
      });
    }
  }

  // 3. recovery
  if (s.streak.recoveries.length) {
    const fastest = Math.min(...s.streak.recoveries.map((r) => r.days));
    out.push({
      key: 'recovery', kind: 'recovery', tone: 'positive',
      title: s.streak.recoveries.length === 1 ? 'One break, fast recovery' : `${s.streak.recoveries.length} breaks, all recovered`,
      body: s.streak.recoveries.length === 1
        ? `You broke the chain on ${weekdayName(s.streak.recoveries[0].brokeOn, true)} and recovered in ${fastest} day${fastest === 1 ? '' : 's'}.`
        : `Fastest recovery: ${fastest} day${fastest === 1 ? '' : 's'}.`,
      evidence: { breaks: s.streak.recoveries.length, fastest },
    });
  }

  // 4. planning load vs execution
  if (s.prev.planned >= 10 && s.planned >= s.prev.planned * 1.3 && s.execution != null && s.prev.execution != null && s.execution < s.prev.execution) {
    out.push({
      key: 'overplanned', kind: 'planning', tone: 'warning',
      title: 'More planned, less kept',
      body: `You planned ${s.planned} vs ${s.prev.planned} the period before, and execution dropped to ${pct(s.execution)}.`,
      suggestion: 'Cut next week back toward what you actually keep.',
      evidence: { planned: s.planned, prevPlanned: s.prev.planned },
    });
  }

  // 5. best weekday
  if (s.bestWeekday && input.kind !== 'week') {
    out.push({
      key: 'best-weekday', kind: 'pattern', tone: 'neutral',
      title: `${s.bestWeekday.weekday} is your strongest day`,
      body: `Your execution is highest on ${s.bestWeekday.weekday}s (${pct(s.bestWeekday.execution)}).`,
      suggestion: `Put the hardest work of the week on ${s.bestWeekday.weekday}.`,
      evidence: { execution: s.bestWeekday.execution },
    });
  }

  // 6. money
  if (input.money?.anomalies.length) {
    const a = input.money.anomalies[0];
    out.push({
      key: `anomaly:${a.name}`, kind: 'money', tone: 'warning',
      title: `${a.name} ran hot`,
      body: `${a.name} spending was ${formatMoney(a.amount, input.money.base, { compact: true })}, ${pct(a.change)} above your average for the same length of time.`,
      evidence: { amount: a.amount, baseline: a.baseline, change: a.change },
    });
  }

  // 7. keystone
  if (s.keystone) {
    out.push(
      s.keystone.status === 'done'
        ? { key: 'keystone', kind: 'keystone', tone: 'positive', title: 'Weekly Focus done', body: `You finished "${s.keystone.title}".`, evidence: {} }
        : {
            key: 'keystone', kind: 'keystone', tone: 'warning', title: 'Weekly Focus open',
            body: `"${s.keystone.title}" didn't get finished.`,
            suggestion: 'Carry it into next week — or cut it into a smaller focus you can finish.',
            evidence: {},
          },
    );
  }

  return out.slice(0, 5);
}

/**
 * KEEP DOING / CHANGE / STOP / NEXT — assembled only from the review's own numbers and
 * insights. When there's nothing data-backed to say for a column, the column says so.
 */
export interface ActionPlan {
  keep: string[];
  change: string[];
  stop: string[];
  next: string[];
}

export function actionPlan(s: ReviewStats, insights: Insight[]): ActionPlan {
  const keep: string[] = [];
  const change: string[] = [];
  const stop: string[] = [];
  const next: string[] = [];
  const pctS = (n: number | null) => (n == null ? '—' : `${Math.round(n * 100)}%`);

  if (s.mostConsistent && (s.mostConsistent.consistency ?? 0) >= 0.85) {
    keep.push(`${s.mostConsistent.title} — kept ${s.mostConsistent.kept} of ${s.mostConsistent.planned}. Whatever you’re doing there works.`);
  }
  if (s.strongestArea && (s.strongestArea.execution ?? 0) >= 0.8) {
    keep.push(`${s.strongestArea.name} at ${pctS(s.strongestArea.execution)} execution.`);
  }
  for (const r of s.streak.recoveries.filter((r) => r.days <= 1).slice(0, 1)) {
    keep.push(`Bouncing back fast — after the break on ${r.brokeOn.slice(5).replace('-', '/')} you were back the next day.`);
  }
  for (const i of insights.filter((i) => i.tone === 'positive' && i.kind === 'change').slice(0, 1)) keep.push(i.body);

  for (const i of insights.filter((i) => i.tone !== 'positive' && i.suggestion).slice(0, 3)) change.push(`${i.body} ${i.suggestion}`);

  for (const a of s.areas.filter((a) => (a.execution ?? 1) < 0.5 && a.planned >= 8)) {
    stop.push(`Planning ${a.name} at a level you keep ${pctS(a.execution)} of the time. Cut the target until it sticks.`);
  }
  if (s.mostMissed && (s.mostMissed.consistency ?? 1) < 0.4 && s.mostMissed.planned >= 6) {
    stop.push(`Treating ${s.mostMissed.title} as a commitment when it’s kept ${s.mostMissed.kept} of ${s.mostMissed.planned} times — make it smaller or archive it.`);
  }
  if (s.planned > s.prev.planned * 1.3 && s.prev.planned > 0 && (s.execution ?? 0) < (s.prev.execution ?? 0)) {
    stop.push(`Over-planning: ${s.planned} planned vs ${s.prev.planned} before, and execution fell.`);
  }

  if (s.weakestArea && s.weakestArea.id !== s.strongestArea?.id) {
    next.push(`Make ${s.weakestArea.name} the focus: it’s the weakest area at ${pctS(s.weakestArea.execution)}.`);
  }
  if (s.bestWeekday) next.push(`Schedule the hardest work on ${s.bestWeekday.weekday}s — your best day at ${pctS(s.bestWeekday.execution)}.`);
  if (s.execution != null) {
    const target = Math.min(0.95, Math.round((s.execution + 0.05) * 20) / 20);
    next.push(`Aim for ${pctS(target)} execution — ${Math.round((target - s.execution) * 100)} points above this period.`);
  }
  return { keep, change, stop, next };
}

/** Length of a review period in days. */
export function reviewLength(s: Pick<ReviewStats, 'start' | 'end'>): number {
  return diffDays(s.start, s.end) + 1;
}
