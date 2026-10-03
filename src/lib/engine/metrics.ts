import { addDays, diffDays, type ISODate } from './dates';
import { byDay, evaluateMission, type EvalOptions, type MissionDay } from './schedule';
import type { CompletionRec, MissionDef } from './types';
import { DIFFICULTY_WEIGHT } from './xp';

/**
 * Rates, precisely:
 *   due         = units that counted (required slots, plus flexible slots you acted on)
 *   settledDue  = due minus today's still-open units — today can't drag a rate down until it's over
 *   CONSISTENCY = kept / settledDue          (did you keep your word, minimum included)
 *   EXECUTION   = Σ credit / settledDue      (how much of the full commitment you did)
 *   WEIGHTED    = same, each unit weighted by difficulty (0.75–1.5) × priority (1.5) — used by momentum
 * Excused days leave the denominator. Extras beyond a weekly quota never enter it.
 * Every rate is null, not 0, when nothing was due: "no data" and "failed" are different things.
 */

export interface Tally {
  due: number;
  settledDue: number;
  kept: number;
  credit: number;
  weightedDue: number;
  weightedCredit: number;
  full: number;
  exceeded: number;
  minimum: number;
  partial: number;
  missed: number;
  excused: number;
  open: number;
  extra: number;
  /** sum of logged minutes on duration missions */
  minutes: number;
}

export interface DaySummary extends Tally {
  day: ISODate;
}

export function emptyTally(): Tally {
  return {
    due: 0, settledDue: 0, kept: 0, credit: 0, weightedDue: 0, weightedCredit: 0,
    full: 0, exceeded: 0, minimum: 0, partial: 0, missed: 0, excused: 0, open: 0, extra: 0, minutes: 0,
  };
}

export function rate(n: number, d: number): number | null {
  return d > 0 ? n / d : null;
}

export function execution(t: Tally): number | null {
  return rate(t.credit, t.settledDue);
}

export function consistency(t: Tally): number | null {
  return rate(t.kept, t.settledDue);
}

export function weightedExecution(t: Tally): number | null {
  return rate(t.weightedCredit, t.weightedDue);
}

/** Percentage-point change, or null when either side has no data. */
export function deltaPp(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null) return null;
  return (cur - prev) * 100;
}

export function unitWeight(m: MissionDef, keystoneMissionIds?: ReadonlySet<string>): number {
  const priority = m.isPriority || keystoneMissionIds?.has(m.id) ? 1.5 : 1;
  return DIFFICULTY_WEIGHT[m.difficulty] * priority;
}

/** Add one mission-day to a tally. */
export function addMissionDay(t: Tally, md: MissionDay, m: MissionDef, today: ISODate, weight = unitWeight(m)): void {
  const c = md.completion;
  if (c && c.value != null && m.measure === 'duration' && c.outcome !== 'skipped' && c.outcome !== 'missed') {
    t.minutes += c.value;
  }
  if (md.status === 'extra') {
    if (c && c.kept) t.extra++;
    return;
  }
  if (c?.outcome === 'skipped') {
    if (md.status === 'required') t.excused++;
    return;
  }
  if (!md.counts) return;

  t.due++;
  if (!c || c.outcome === 'missed') {
    if (md.day < today) {
      t.settledDue++;
      t.weightedDue += weight;
      t.missed++;
    } else if (c?.outcome === 'missed') {
      // explicitly marked missed today
      t.settledDue++;
      t.weightedDue += weight;
      t.missed++;
    } else {
      t.open++;
    }
    return;
  }
  t.settledDue++;
  t.weightedDue += weight;
  t.credit += c.credit;
  t.weightedCredit += c.credit * weight;
  if (c.kept) t.kept++;
  switch (c.outcome) {
    case 'exceeded': t.exceeded++; break;
    case 'full': t.full++; break;
    case 'minimum': t.minimum++; break;
    case 'partial': t.partial++; break;
  }
}

export function mergeTally(into: Tally, t: Tally): Tally {
  for (const k of Object.keys(into) as (keyof Tally)[]) into[k] += t[k];
  return into;
}

export interface Evaluation {
  start: ISODate;
  end: ISODate;
  today: ISODate;
  days: DaySummary[];
  /** mission id → its evaluated days */
  byMission: Map<string, MissionDay[]>;
  missions: Map<string, MissionDef>;
}

/**
 * Evaluate every mission over [start, end]. Completions should cover from 6 days before
 * `start` (weekly quotas look back to the start of the week).
 */
export function evaluate(
  missions: MissionDef[],
  completions: CompletionRec[],
  start: ISODate,
  end: ISODate,
  opts: EvalOptions & { keystoneMissionIds?: ReadonlySet<string> },
): Evaluation {
  const perMission = new Map<string, CompletionRec[]>();
  for (const c of completions) {
    const list = perMission.get(c.missionId);
    if (list) list.push(c);
    else perMission.set(c.missionId, [c]);
  }
  const n = Math.max(0, diffDays(start, end) + 1);
  const days: DaySummary[] = Array.from({ length: n }, (_, i) => ({ day: addDays(start, i), ...emptyTally() }));
  const byMission = new Map<string, MissionDay[]>();
  const mById = new Map<string, MissionDef>();
  for (const m of missions) {
    mById.set(m.id, m);
    const mds = evaluateMission(m, byDay(perMission.get(m.id) ?? []), start, end, opts);
    byMission.set(m.id, mds);
    const w = unitWeight(m, opts.keystoneMissionIds);
    mds.forEach((md, i) => addMissionDay(days[i], md, m, opts.today, w));
  }
  return { start, end, today: opts.today, days, byMission, missions: mById };
}

/** Tally a sub-range of an evaluation, optionally filtered to some missions. */
export function tallyRange(
  ev: Evaluation,
  from: ISODate,
  to: ISODate,
  filter?: (m: MissionDef) => boolean,
): Tally {
  const t = emptyTally();
  const i0 = Math.max(0, diffDays(ev.start, from));
  const i1 = Math.min(ev.days.length - 1, diffDays(ev.start, to));
  if (i1 < i0) return t;
  if (!filter) {
    for (let i = i0; i <= i1; i++) mergeTally(t, ev.days[i]);
    return t;
  }
  for (const [id, mds] of ev.byMission) {
    const m = ev.missions.get(id)!;
    if (!filter(m)) continue;
    const w = unitWeight(m);
    for (let i = i0; i <= i1; i++) addMissionDay(t, mds[i], m, ev.today, w);
  }
  return t;
}

export function isPerfectDay(d: Tally): boolean {
  return d.settledDue >= 3 && d.open === 0 && d.kept === d.settledDue;
}

/** Execution-intensity bucket for the heatmap: 0 = nothing due, 1–4 by execution, 5 = perfect. */
export function heatLevel(d: Tally): 0 | 1 | 2 | 3 | 4 | 5 {
  if (d.settledDue === 0) return 0;
  const e = d.credit / d.settledDue;
  if (d.open === 0 && d.kept === d.settledDue && d.settledDue >= 2) return 5;
  if (e >= 0.8) return 4;
  if (e >= 0.55) return 3;
  if (e >= 0.3) return 2;
  return 1;
}
