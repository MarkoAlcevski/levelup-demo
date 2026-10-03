import { diffDays, type ISODate } from './dates';
import type { DaySummary } from './metrics';

/**
 * MOMENTUM — "is my execution heading up or down right now?"
 *
 *   score  = recency-weighted mean of daily weighted execution, half-life 7 days, last 56 days,
 *            × 100. A day's weight halves every 7 days of age, so one bad day costs ~9 points
 *            from 90 and is mostly forgotten within two weeks. Days with nothing due are skipped,
 *            so rest days never decay it.
 *   short  = same with half-life 3 days (what the last ~week feels like)
 *   long   = plain mean of the last 28 days
 *   trend  = (short − long) × 100, in points
 *
 * Label, first match wins:
 *   RESETTING  score < 25, or the three most recent due-days all had zero credit
 *   SURGING    trend ≥ +8
 *   SLIPPING   trend ≤ −8
 *   STRONG     score ≥ 75
 *   STABLE     otherwise
 * With fewer than 5 due-days of history the label is BUILDING and no score is claimed.
 */

export type MomentumLabel = 'surging' | 'strong' | 'stable' | 'slipping' | 'resetting' | 'building';

export interface Momentum {
  score: number | null;
  label: MomentumLabel;
  trend: number | null;
  short: number | null;
  long: number | null;
  sampleDays: number;
}

export const MOMENTUM_COPY: Record<MomentumLabel, string> = {
  surging: 'Surging',
  strong: 'Strong',
  stable: 'Stable',
  slipping: 'Slipping',
  resetting: 'Resetting',
  building: 'Building',
};

function dayValue(d: DaySummary): number | null {
  return d.weightedDue > 0 ? d.weightedCredit / d.weightedDue : null;
}

function weightedMean(points: { age: number; v: number }[], halfLife: number): number | null {
  let num = 0;
  let den = 0;
  for (const p of points) {
    const w = Math.pow(0.5, p.age / halfLife);
    num += w * p.v;
    den += w;
  }
  return den > 0 ? num / den : null;
}

export function momentum(days: DaySummary[], today: ISODate): Momentum {
  const points = days
    .filter((d) => d.day <= today)
    .map((d) => ({ age: diffDays(d.day, today), v: dayValue(d) }))
    .filter((p): p is { age: number; v: number } => p.v != null && p.age < 56);

  if (points.length < 5) {
    return { score: null, label: 'building', trend: null, short: null, long: null, sampleDays: points.length };
  }

  const main = weightedMean(points, 7)!;
  const short = weightedMean(points.filter((p) => p.age < 14), 3);
  const recent28 = points.filter((p) => p.age < 28);
  const long = recent28.length ? recent28.reduce((s, p) => s + p.v, 0) / recent28.length : null;
  const score = Math.round(main * 100);
  const trend = short != null && long != null ? Math.round((short - long) * 100) : null;

  const lastThree = [...points].sort((a, b) => a.age - b.age).slice(0, 3);
  const threeZeros = lastThree.length === 3 && lastThree.every((p) => p.v === 0);

  let label: MomentumLabel;
  if (score < 25 || threeZeros) label = 'resetting';
  else if (trend != null && trend >= 8) label = 'surging';
  else if (trend != null && trend <= -8) label = 'slipping';
  else if (score >= 75) label = 'strong';
  else label = 'stable';

  return { score, label, trend, short, long, sampleDays: points.length };
}
