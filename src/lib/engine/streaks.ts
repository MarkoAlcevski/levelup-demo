import { diffDays, type ISODate } from './dates';
import type { DaySummary } from './metrics';
import type { MissionDay } from './schedule';

/**
 * Streaks without the cliff.
 *
 * A day is KEPT when you kept at least `threshold` (default 50%) of what was due.
 * Days with nothing due are NEUTRAL: they neither extend nor break a run.
 * Today is PENDING until it qualifies — it can extend the streak, never break it.
 *
 * Alongside current/best we track RECOVERY: every time a run breaks, how many days until the
 * next kept day. "Recovered in 1 day" is the number that actually predicts long-term consistency.
 */

export type DayMark = 'kept' | 'broken' | 'neutral' | 'pending';

export function markDay(d: DaySummary, today: ISODate, threshold: number): DayMark {
  if (d.day > today) return 'neutral';
  const due = d.day === today ? d.settledDue + d.open : d.settledDue;
  if (due === 0) return 'neutral';
  if (d.kept / due >= threshold - 1e-9) return 'kept';
  return d.day === today ? 'pending' : 'broken';
}

export interface Recovery {
  brokeOn: ISODate;
  recoveredOn: ISODate;
  /** broken days before the comeback */
  days: number;
}

export interface StreakStats {
  current: number;
  currentStart: ISODate | null;
  best: number;
  bestStart: ISODate | null;
  bestEnd: ISODate | null;
  recoveries: Recovery[];
  /** mean broken days per gap, over the recoveries passed in */
  avgRecovery: number | null;
  /** comebacks after 3+ broken days */
  comebacks: number;
  /** consecutive broken days right now (0 when the run is alive) */
  currentGap: number;
  /** days since the last kept day (0 = today is kept) */
  daysSinceKept: number | null;
  todayMark: DayMark;
}

export function streakStats(days: DaySummary[], today: ISODate, threshold = 0.5): StreakStats {
  const marks = days.map((d) => ({ day: d.day, mark: markDay(d, today, threshold) }));

  let best = 0;
  let bestStart: ISODate | null = null;
  let bestEnd: ISODate | null = null;
  let run = 0;
  let runStart: ISODate | null = null;
  const recoveries: Recovery[] = [];
  let gap = 0;
  let gapStart: ISODate | null = null;
  let lastKept: ISODate | null = null;

  for (const { day, mark } of marks) {
    if (mark === 'kept') {
      if (run === 0) runStart = day;
      run++;
      if (run > best) {
        best = run;
        bestStart = runStart;
        bestEnd = day;
      }
      if (gap > 0 && gapStart && lastKept) recoveries.push({ brokeOn: gapStart, recoveredOn: day, days: gap });
      gap = 0;
      gapStart = null;
      lastKept = day;
    } else if (mark === 'broken') {
      run = 0;
      runStart = null;
      if (gap === 0) gapStart = day;
      gap++;
    }
  }

  // current run: walk back from the end, skipping neutral and pending days
  let current = 0;
  let currentStart: ISODate | null = null;
  for (let i = marks.length - 1; i >= 0; i--) {
    const { day, mark } = marks[i];
    if (mark === 'neutral' || mark === 'pending') continue;
    if (mark === 'broken') break;
    current++;
    currentStart = day;
  }

  const comebacks = recoveries.filter((r) => r.days >= 3).length;
  const avgRecovery = recoveries.length ? recoveries.reduce((s, r) => s + r.days, 0) / recoveries.length : null;
  const todayMark = marks.find((m) => m.day === today)?.mark ?? 'neutral';

  return {
    current,
    currentStart,
    best,
    bestStart,
    bestEnd,
    recoveries,
    avgRecovery,
    comebacks,
    currentGap: current > 0 ? 0 : gap,
    daysSinceKept: lastKept ? diffDays(lastKept, today) : null,
    todayMark,
  };
}

/**
 * Per-mission streak. Daily / fixed-day missions count consecutive due occurrences kept
 * (excused occurrences are skipped). Weekly-quota missions count consecutive weeks with the
 * quota met — the current week only counts once it's met, and never breaks the run while open.
 */
export interface MissionStreak {
  unit: 'day' | 'week';
  current: number;
  best: number;
}

export function missionStreak(mds: MissionDay[], today: ISODate): MissionStreak {
  const weekly = mds.find((md) => md.weekly)?.weekly != null;
  if (weekly) {
    const weeks = new Map<ISODate, { quota: number; done: number; end: ISODate }>();
    for (const md of mds) {
      if (!md.weekly || md.day > today) continue;
      const w = weeks.get(md.weekly.weekStart);
      const done = md.weekly.done;
      if (!w || done > w.done) weeks.set(md.weekly.weekStart, { quota: md.weekly.quota, done, end: md.weekly.weekEnd });
    }
    const list = [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    let best = 0;
    let run = 0;
    const results: ('met' | 'failed' | 'open')[] = list.map(([, w]) =>
      w.done >= w.quota ? 'met' : w.end >= today ? 'open' : 'failed',
    );
    for (const r of results) {
      if (r === 'met') best = Math.max(best, ++run);
      else if (r === 'failed') run = 0;
    }
    let current = 0;
    for (let i = results.length - 1; i >= 0; i--) {
      if (results[i] === 'open') continue;
      if (results[i] === 'failed') break;
      current++;
    }
    return { unit: 'week', current, best };
  }

  const seq: boolean[] = [];
  for (const md of mds) {
    if (md.day > today || !md.counts) continue;
    if (md.completion?.outcome === 'skipped') continue;
    if (md.day === today && !md.completion) continue; // still open
    seq.push(!!md.completion?.kept);
  }
  let best = 0;
  let run = 0;
  for (const k of seq) {
    if (k) best = Math.max(best, ++run);
    else run = 0;
  }
  let current = 0;
  for (let i = seq.length - 1; i >= 0 && seq[i]; i--) current++;
  return { unit: 'day', current, best };
}
