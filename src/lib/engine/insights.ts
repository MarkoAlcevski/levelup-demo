import { weekdayLabel, jsWeekday, type ISODate } from './dates';
import type { MissionDay } from './schedule';
import type { CompletionRec, MissionDef, MissReason } from './types';

/**
 * Deterministic insights. Every insight carries the numbers it was built from; if the data is
 * too thin to say something specific, the function returns nothing rather than something vague.
 * An LLM may later rephrase these — it never invents them.
 */

export type InsightTone = 'positive' | 'neutral' | 'warning';

export interface Insight {
  key: string;
  kind: 'pattern' | 'change' | 'recovery' | 'record' | 'money' | 'keystone' | 'planning' | 'streak' | 'quota';
  tone: InsightTone;
  title: string;
  body: string;
  suggestion?: string;
  evidence: Record<string, number | string | null>;
}

const REASON_LABEL: Record<MissReason, string> = {
  no_time: 'no time', forgot: 'forgot', low_energy: 'low energy', unexpected: 'something unexpected',
  procrastinated: 'procrastinated', too_hard: 'too hard', not_important: 'not important anymore',
  rest: 'rest', sick: 'sick', travel: 'travel', other: 'other',
};

export function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function fmtUnit(m: MissionDef, v: number): string {
  const n = Number.isInteger(v) ? v : Math.round(v);
  if (m.unit === 'min') return `${n} min`;
  return `${n.toLocaleString('en-US')} ${m.unit ?? ''}`.trim();
}

function roundNice(v: number): number {
  if (v >= 1000) return Math.round(v / 500) * 500;
  if (v >= 100) return Math.round(v / 10) * 10;
  return Math.max(5, Math.round(v / 5) * 5);
}

interface DueDay {
  day: ISODate;
  kept: boolean;
  hour: number | null;
  completion: CompletionRec | null;
}

function dueDays(mds: MissionDay[], today: ISODate): DueDay[] {
  return mds
    .filter((md) => md.counts && md.day < today)
    .map((md) => ({ day: md.day, kept: !!md.completion?.kept, hour: md.completion?.loggedHour ?? null, completion: md.completion }));
}

/**
 * "When Reading isn't done by 21:00, it gets done 2 of 11 times."
 * For each candidate cut-off hour H: late = due days not kept before H. Of those, how many were
 * kept at H or later? A low late-success rate with enough samples is a real, falsifiable pattern.
 */
export function timeOfDayPattern(m: MissionDef, history: DueDay[]): Insight | null {
  const withHour = history.filter((d) => !d.kept || d.hour != null);
  if (withHour.length < 12) return null;
  let best: { h: number; lateN: number; lateKept: number; earlyRate: number; lateRate: number } | null = null;
  for (const h of [17, 18, 19, 20, 21, 22]) {
    const early = withHour.filter((d) => d.kept && (d.hour as number) < h).length;
    const late = withHour.filter((d) => !(d.kept && (d.hour as number) < h));
    const lateKept = late.filter((d) => d.kept).length;
    if (late.length < 5) continue;
    const lateRate = lateKept / late.length;
    const earlyShare = early / withHour.length;
    if (lateRate <= 0.4 && earlyShare >= 0.3) {
      const score = (1 - lateRate) * late.length;
      if (!best || score > (1 - best.lateRate) * best.lateN) {
        best = { h, lateN: late.length, lateKept, earlyRate: earlyShare, lateRate };
      }
    }
  }
  if (!best) return null;
  const hh = `${String(best.h).padStart(2, '0')}:00`;
  return {
    key: `time:${m.id}`,
    kind: 'pattern',
    tone: 'warning',
    title: `${m.title} rarely happens after ${hh}`,
    body: `When ${m.title} isn't done by ${hh}, it gets done ${best.lateKept} of ${best.lateN} times (${pct(best.lateRate)}).`,
    suggestion: `Put it before ${hh}${m.measure !== 'check' && m.minimumValue == null ? ', or add a minimum version for late days' : ''}.`,
    evidence: { cutoffHour: best.h, lateDays: best.lateN, lateKept: best.lateKept, lateRate: best.lateRate },
  };
}

/** "4 of your last 6 Reading misses were on Fridays." */
export function weekdayPattern(m: MissionDef, history: DueDay[]): Insight | null {
  const misses = history.filter((d) => !d.kept).slice(-10);
  if (misses.length < 4) return null;
  const counts = new Map<number, number>();
  for (const d of misses) counts.set(jsWeekday(d.day), (counts.get(jsWeekday(d.day)) ?? 0) + 1);
  const [wd, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n < 3 || n / misses.length < 0.4) return null;
  const name = weekdayLabel(wd, true);
  return {
    key: `weekday:${m.id}`,
    kind: 'pattern',
    tone: 'warning',
    title: `${name}s are where ${m.title} breaks`,
    body: `${n} of your last ${misses.length} ${m.title} misses were on a ${name}.`,
    suggestion: `Plan a minimum version for ${name}s, or move ${name}'s session to another day.`,
    evidence: { weekday: wd, misses: n, sample: misses.length },
  };
}

/** Measured missions logged well below target: suggest a target the user actually hits. */
export function targetGap(m: MissionDef, history: DueDay[]): Insight | null {
  if (m.measure === 'check' || !m.targetValue) return null;
  const values = history
    .map((d) => d.completion)
    .filter((c): c is CompletionRec => !!c && c.value != null && c.value > 0)
    .map((c) => c.value as number)
    .sort((a, b) => a - b);
  if (values.length < 6) return null;
  const median = values[Math.floor(values.length / 2)];
  if (median >= m.targetValue * 0.75) return null;
  const suggested = roundNice(median * 1.1);
  if (suggested >= m.targetValue) return null;
  return {
    key: `target:${m.id}`,
    kind: 'pattern',
    tone: 'neutral',
    title: `${m.title} target may be too high`,
    body: `On days you log ${m.title}, the median is ${fmtUnit(m, median)} against a ${fmtUnit(m, m.targetValue)} target.`,
    suggestion: `Consider ${fmtUnit(m, suggested)} as the target — hitting it builds more than missing a bigger one.`,
    evidence: { median, target: m.targetValue, suggested, sample: values.length },
  };
}

export function missReasons(m: MissionDef, history: DueDay[]): Insight | null {
  const reasons = history.map((d) => d.completion?.reason).filter((r): r is MissReason => !!r && r !== 'rest');
  if (reasons.length < 3) return null;
  const counts = new Map<MissReason, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  const [top, n] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (n / reasons.length < 0.5) return null;
  const fix: Partial<Record<MissReason, string>> = {
    no_time: 'Schedule it at a fixed time, or add a 10-minute minimum version.',
    forgot: 'Turn on a reminder for it, or attach it to something you already do daily.',
    low_energy: 'Move it to your highest-energy part of the day.',
    procrastinated: 'Make the first step smaller — a minimum version you can start in 2 minutes.',
    too_hard: 'Lower the target for a few weeks, then build back up.',
    not_important: 'Consider archiving it. Fewer commitments, kept, beat many broken.',
  };
  return {
    key: `reason:${m.id}`,
    kind: 'pattern',
    tone: 'neutral',
    title: `${m.title} misses share a cause`,
    body: `${n} of ${reasons.length} logged ${m.title} misses were "${REASON_LABEL[top]}".`,
    suggestion: fix[top],
    evidence: { reason: top, count: n, sample: reasons.length },
  };
}

/** The single most useful diagnosis for a mission that is slipping. */
export function diagnoseMission(m: MissionDef, mds: MissionDay[], today: ISODate): Insight | null {
  const history = dueDays(mds, today);
  return (
    timeOfDayPattern(m, history) ??
    weekdayPattern(m, history) ??
    targetGap(m, history) ??
    missReasons(m, history)
  );
}

// ───────────────────────────────────────────── the one line on Today

export interface TodayContext {
  today: ISODate;
  hourNow: number;
  keptToday: number;
  dueToday: number;
  bestDayKept: number;
  streak: { current: number; best: number; bestThisMonth: number; recoveredYesterday: number | null };
  momentum: { label: string; trend: number | null };
  quotas: { title: string; remaining: number; daysLeft: number; unit: string; quota: number }[];
  timeRisks: { title: string; cutoffHour: number; lateRate: number }[];
}

export function todayInsight(c: TodayContext): Insight | null {
  const left = Math.max(0, c.dueToday - c.keptToday);

  // 1. last chance on a weekly quota
  const lastChance = c.quotas.find((q) => q.remaining > 0 && q.remaining >= q.daysLeft);
  if (lastChance && c.hourNow >= 12) {
    return {
      key: 'quota-last',
      kind: 'quota',
      tone: 'warning',
      title: 'Quota on the line',
      body: lastChance.remaining === 1
        ? `Today is the last chance to hit ${lastChance.title} this week.`
        : `${lastChance.title}: ${lastChance.remaining} left and ${lastChance.daysLeft} days to do them.`,
      evidence: { remaining: lastChance.remaining, daysLeft: lastChance.daysLeft },
    };
  }
  // 2. a known time-of-day risk that's about to bite
  const risk = c.timeRisks.find((r) => c.hourNow >= r.cutoffHour - 2 && c.hourNow < r.cutoffHour);
  if (risk) {
    return {
      key: 'time-risk',
      kind: 'pattern',
      tone: 'warning',
      title: 'Window closing',
      body: `After ${risk.cutoffHour}:00, ${risk.title} gets done ${pct(risk.lateRate)} of the time. It's ${c.hourNow}:00.`,
      evidence: { cutoff: risk.cutoffHour, lateRate: risk.lateRate },
    };
  }
  // 3. record within reach
  if (c.bestDayKept >= 4 && left > 0 && c.keptToday >= c.bestDayKept - 1 && c.keptToday < c.bestDayKept + 1) {
    const need = c.bestDayKept - c.keptToday;
    return {
      key: 'record-day',
      kind: 'record',
      tone: 'positive',
      title: 'Record in reach',
      body: need <= 0
        ? `One more and today beats your best day (${c.bestDayKept} kept).`
        : `One more ties your best day (${c.bestDayKept} kept).`,
      evidence: { best: c.bestDayKept, today: c.keptToday },
    };
  }
  // 4. recovery
  if (c.streak.recoveredYesterday != null) {
    return {
      key: 'recovered',
      kind: 'recovery',
      tone: 'positive',
      title: 'Recovered',
      body: `You recovered in ${c.streak.recoveredYesterday} day${c.streak.recoveredYesterday === 1 ? '' : 's'}. That's the number that matters.`,
      evidence: { days: c.streak.recoveredYesterday },
    };
  }
  // 5. streak context
  if (c.streak.current >= 3 && c.streak.current >= c.streak.best) {
    return {
      key: 'streak-best',
      kind: 'streak',
      tone: 'positive',
      title: 'Longest run yet',
      body: `Day ${c.streak.current} — your longest run so far.`,
      evidence: { current: c.streak.current },
    };
  }
  if (c.streak.current >= 3 && c.streak.current >= c.streak.bestThisMonth) {
    return {
      key: 'streak-month',
      kind: 'streak',
      tone: 'positive',
      title: 'Best run this month',
      body: `You're on your strongest ${c.streak.current}-day run this month.`,
      evidence: { current: c.streak.current },
    };
  }
  // 6. momentum moving
  if (c.momentum.trend != null && c.momentum.trend >= 8) {
    return {
      key: 'momentum-up',
      kind: 'change',
      tone: 'positive',
      title: 'Momentum rising',
      body: `Your last week is running ${c.momentum.trend} points above your 4-week average.`,
      evidence: { trend: c.momentum.trend },
    };
  }
  // 7. a weekly quota one away
  const close = c.quotas.find((q) => q.remaining === 1);
  if (close) {
    return {
      key: 'quota-one',
      kind: 'quota',
      tone: 'neutral',
      title: 'One away',
      body: close.quota === 1
        ? `${close.title} is still open this week — ${close.daysLeft} day${close.daysLeft === 1 ? '' : 's'} left.`
        : `One more ${close.title} ${close.unit} hits your ${close.quota}× this week.`,
      evidence: { remaining: 1, quota: close.quota },
    };
  }
  if (c.dueToday > 0 && left === 0) {
    return { key: 'done', kind: 'streak', tone: 'positive', title: 'Day kept', body: 'Everything due today is kept.', evidence: {} };
  }
  return null;
}

// ───────────────────────────────────────────── planning load

/** "You're planning 3.2× your usual daily workload." Null when it's within normal range. */
export function overPlanning(plannedToday: number, recentKeptPerDay: number[]): { ratio: number; usual: number } | null {
  const sample = recentKeptPerDay.filter((n) => n > 0);
  if (sample.length < 7) return null;
  const sorted = [...sample].sort((a, b) => a - b);
  const usual = sorted[Math.floor(sorted.length / 2)];
  if (usual <= 0) return null;
  const ratio = plannedToday / usual;
  if (ratio < 1.8 || plannedToday - usual < 3) return null;
  return { ratio: Math.round(ratio * 10) / 10, usual };
}
