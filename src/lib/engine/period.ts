import {
  addDays, addMonths, diffDays, endOfMonth, formatRange, monthName, startOfMonth, startOfQuarter, startOfWeek,
  startOfYear, type ISODate,
} from './dates';

/**
 * Report periods. Rolling windows (7D / 30D / 90D) answer "did it go up over the last 30 days?"
 * without waiting for a calendar month to close. Calendar periods to date compare against the
 * same span of the previous period (Sep 1–26 vs Aug 1–26), never a full month vs a partial one.
 */

export type PeriodPreset = '7d' | '14d' | '30d' | '90d' | 'week' | 'month' | 'last_month' | 'quarter' | 'year' | 'all' | 'custom';
export type CompareMode = 'previous' | 'previous_month' | 'previous_quarter' | 'last_year' | 'custom' | 'none';

export interface Period {
  preset: PeriodPreset;
  start: ISODate;
  end: ISODate; // inclusive
  label: string;
}

export interface ComparedPeriod {
  current: Period;
  previous: Period | null;
}

export const PRESET_LABEL: Record<PeriodPreset, string> = {
  '7d': '7 days',
  '14d': '14 days',
  '30d': '30 days',
  '90d': '90 days',
  week: 'This week',
  month: 'This month',
  last_month: 'Last month',
  quarter: 'This quarter',
  year: 'This year',
  all: 'All time',
  custom: 'Custom',
};

export function resolvePeriod(
  preset: PeriodPreset,
  today: ISODate,
  opts: { weekStartsOn?: number; custom?: { start: ISODate; end: ISODate }; earliest?: ISODate } = {},
): Period {
  const ws = opts.weekStartsOn ?? 1;
  switch (preset) {
    case '7d':
    case '14d':
    case '30d':
    case '90d': {
      const n = Number(preset.replace('d', ''));
      return { preset, start: addDays(today, -(n - 1)), end: today, label: PRESET_LABEL[preset] };
    }
    case 'week':
      return { preset, start: startOfWeek(today, ws), end: today, label: 'This week' };
    case 'month':
      return { preset, start: startOfMonth(today), end: today, label: monthName(today, true) };
    case 'last_month': {
      const s = startOfMonth(addMonths(startOfMonth(today), -1));
      return { preset, start: s, end: endOfMonth(s), label: monthName(s, true) };
    }
    case 'quarter':
      return { preset, start: startOfQuarter(today), end: today, label: `Q${Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1}` };
    case 'year':
      return { preset, start: startOfYear(today), end: today, label: today.slice(0, 4) };
    case 'all':
      return { preset, start: opts.earliest ?? startOfYear(today), end: today, label: 'All time' };
    case 'custom': {
      const c = opts.custom ?? { start: addDays(today, -29), end: today };
      const [start, end] = c.start <= c.end ? [c.start, c.end] : [c.end, c.start];
      return { preset, start, end, label: formatRange(start, end) };
    }
  }
}

/** The comparison window for a period. */
export function previousPeriod(p: Period, mode: CompareMode, custom?: { start: ISODate; end: ISODate } | null): Period | null {
  if (mode === 'none' || p.preset === 'all') return null;
  const len = diffDays(p.start, p.end) + 1;
  if (mode === 'custom') {
    if (!custom) return null;
    const [start, end] = custom.start <= custom.end ? [custom.start, custom.end] : [custom.end, custom.start];
    return { preset: 'custom', start, end, label: formatRange(start, end) };
  }
  if (mode === 'previous_month' || mode === 'previous_quarter') {
    const k = mode === 'previous_month' ? -1 : -3;
    const start = addMonths(p.start, k);
    const end = addMonths(p.end, k);
    return { preset: 'custom', start, end, label: formatRange(start, end) };
  }
  if (mode === 'last_year') {
    const start = addMonths(p.start, -12);
    const end = addMonths(p.end, -12);
    return { preset: 'custom', start, end, label: formatRange(start, end) };
  }
  if (p.preset === 'month' || p.preset === 'last_month') {
    // same span of the previous month, clamped to its length
    const prevStart = addMonths(startOfMonth(p.start), -1);
    const span = Math.min(len, diffDays(prevStart, endOfMonth(prevStart)) + 1);
    const end = addDays(prevStart, span - 1);
    return { preset: 'custom', start: prevStart, end, label: formatRange(prevStart, end) };
  }
  if (p.preset === 'quarter') {
    const start = addMonths(p.start, -3);
    const end = addDays(start, len - 1);
    return { preset: 'custom', start, end, label: formatRange(start, end) };
  }
  if (p.preset === 'year') {
    const start = addMonths(p.start, -12);
    const end = addDays(start, len - 1);
    return { preset: 'custom', start, end, label: formatRange(start, end) };
  }
  const end = addDays(p.start, -1);
  const start = addDays(end, -(len - 1));
  return { preset: 'custom', start, end, label: formatRange(start, end) };
}

export function comparePeriods(
  preset: PeriodPreset,
  today: ISODate,
  mode: CompareMode = 'previous',
  opts: Parameters<typeof resolvePeriod>[2] & { compareCustom?: { start: ISODate; end: ISODate } | null } = {},
): ComparedPeriod {
  const current = resolvePeriod(preset, today, opts);
  return { current, previous: previousPeriod(current, mode, opts.compareCustom) };
}

/** Days of a period that have actually happened (for per-day averages). */
export function elapsedDays(p: Period, today: ISODate): number {
  const end = p.end < today ? p.end : today;
  return Math.max(0, diffDays(p.start, end) + 1);
}

/** Relative change as a fraction; null when the base is zero (a jump from 0 has no percentage). */
export function pctChange(cur: number, prev: number): number | null {
  if (prev === 0) return null;
  return (cur - prev) / Math.abs(prev);
}
