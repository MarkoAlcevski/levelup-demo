'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/cn';
import { COMPARE_OPTIONS, RANGE_OPTIONS, periodQuery } from '@/lib/period-args';
import type { CompareMode, PeriodPreset } from '@/lib/engine/period';
import { Button, Input, Select } from '@/components/ui/primitives';

/** Period + comparison. Links for the presets; a small form for custom ranges. */
export function PeriodPicker({
  base,
  preset,
  compare,
  custom,
  compareCustom,
  today,
}: {
  base: string;
  preset: PeriodPreset;
  compare: CompareMode;
  custom: { start: string; end: string } | null;
  compareCustom: { start: string; end: string } | null;
  today: string;
}) {
  const router = useRouter();
  const [showCustom, setShowCustom] = useState(preset === 'custom');
  const [from, setFrom] = useState(custom?.start ?? '');
  const [to, setTo] = useState(custom?.end ?? today);
  const [cf, setCf] = useState(compareCustom?.start ?? '');
  const [ct, setCt] = useState(compareCustom?.end ?? '');
  const go = (next: { preset: PeriodPreset; compare: CompareMode; custom?: { start: string; end: string } | null; compareCustom?: { start: string; end: string } | null }) =>
    router.push(`${base}?${periodQuery({ preset: next.preset, compare: next.compare, custom: next.custom ?? null, compareCustom: next.compareCustom ?? null })}`, { scroll: false });

  return (
    <div className="flex flex-col gap-2">
      <nav aria-label="Period" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:px-0">
        {RANGE_OPTIONS.map((o) => {
          const on = o.value === preset;
          return (
            <button
              key={o.value}
              type="button"
              aria-pressed={on}
              onClick={() => (o.value === 'custom' ? setShowCustom(true) : go({ preset: o.value, compare, compareCustom }))}
              className={cn('pressable h-9 shrink-0 rounded-full px-3.5 text-[13px] font-medium', on ? 'bg-ink text-bg' : 'bg-sunken text-ink-2 hover:text-ink')}
            >
              {o.label}
            </button>
          );
        })}
      </nav>
      {showCustom && (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (from && to) go({ preset: 'custom', compare, custom: { start: from, end: to }, compareCustom });
          }}
        >
          <Input type="date" aria-label="From" value={from} max={today} onChange={(e) => setFrom(e.target.value)} className="h-10 w-auto" />
          <span className="pb-2.5 text-ink-3">–</span>
          <Input type="date" aria-label="To" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="h-10 w-auto" />
          <Button type="submit" size="sm" disabled={!from || !to}>
            Apply
          </Button>
        </form>
      )}
      <div className="flex flex-wrap items-center gap-2 text-[13px] text-ink-3">
        <label htmlFor="cmp" className="shrink-0">Compared with</label>
        <Select
          id="cmp"
          value={compare}
          onChange={(e) => {
            const v = e.target.value as CompareMode;
            if (v !== 'custom') go({ preset, compare: v, custom });
            else go({ preset, compare: 'custom', custom, compareCustom: cf && ct ? { start: cf, end: ct } : null });
          }}
          className="h-9 w-auto rounded-full py-0 pr-9 text-[13px]"
        >
          {COMPARE_OPTIONS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        {compare === 'custom' && (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (cf && ct) go({ preset, compare: 'custom', custom, compareCustom: { start: cf, end: ct } });
            }}
          >
            <Input type="date" aria-label="Compare from" value={cf} max={today} onChange={(e) => setCf(e.target.value)} className="h-9 w-auto" />
            <Input type="date" aria-label="Compare to" value={ct} max={today} onChange={(e) => setCt(e.target.value)} className="h-9 w-auto" />
            <Button type="submit" size="sm" variant="secondary" disabled={!cf || !ct}>
              Compare
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
