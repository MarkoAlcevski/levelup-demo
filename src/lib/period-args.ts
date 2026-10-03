import { isISODate } from '@/lib/engine/dates';
import type { CompareMode, PeriodPreset } from '@/lib/engine/period';

/** URL ↔ period: ?range=30d&vs=previous&from=YYYY-MM-DD&to=YYYY-MM-DD&cfrom=&cto= */
export const RANGE_OPTIONS: { value: PeriodPreset; label: string }[] = [
  { value: '7d', label: '7D' },
  { value: '14d', label: '14D' },
  { value: '30d', label: '30D' },
  { value: 'month', label: 'Month' },
  { value: '90d', label: '90D' },
  { value: 'quarter', label: 'Qtr' },
  { value: 'year', label: 'Year' },
  { value: 'custom', label: 'Custom' },
];

export const COMPARE_OPTIONS: { value: CompareMode; label: string }[] = [
  { value: 'previous', label: 'Previous period' },
  { value: 'previous_month', label: 'Previous month' },
  { value: 'previous_quarter', label: 'Previous quarter' },
  { value: 'last_year', label: 'Same period last year' },
  { value: 'custom', label: 'Custom' },
  { value: 'none', label: 'No comparison' },
];

export interface PeriodSearch {
  range?: string;
  vs?: string;
  from?: string;
  to?: string;
  cfrom?: string;
  cto?: string;
}

export function parsePeriodArgs(sp: PeriodSearch, fallback: PeriodPreset = '30d') {
  const preset = (RANGE_OPTIONS.some((r) => r.value === sp.range) ? sp.range : fallback) as PeriodPreset;
  const compare = (COMPARE_OPTIONS.some((c) => c.value === sp.vs) ? sp.vs : 'previous') as CompareMode;
  const custom = preset === 'custom' && isISODate(sp.from) && isISODate(sp.to) ? { start: sp.from, end: sp.to } : null;
  const compareCustom = compare === 'custom' && isISODate(sp.cfrom) && isISODate(sp.cto) ? { start: sp.cfrom, end: sp.cto } : null;
  return { preset: preset === 'custom' && !custom ? fallback : preset, compare: compare === 'custom' && !compareCustom ? 'previous' : compare, custom, compareCustom };
}

export function periodQuery(a: { preset: string; compare: string; custom?: { start: string; end: string } | null; compareCustom?: { start: string; end: string } | null }): string {
  const p = new URLSearchParams({ range: a.preset, vs: a.compare });
  if (a.custom) {
    p.set('from', a.custom.start);
    p.set('to', a.custom.end);
  }
  if (a.compareCustom) {
    p.set('cfrom', a.compareCustom.start);
    p.set('cto', a.compareCustom.end);
  }
  return p.toString();
}
