'use client';

import { useState } from 'react';
import { Info } from '@phosphor-icons/react';
import { fmtPct } from '@/lib/format';
import { MOMENTUM_COPY, type Momentum } from '@/lib/engine/momentum';
import type { ScoreCard } from '@/lib/server/progress';
import { Sheet } from '@/components/ui/sheet';
import { Delta } from '@/components/viz/marks';

type Which = 'execution' | 'consistency' | 'streak' | 'momentum';

/** Execution · Consistency · Streak · Trend. Tap any of them for the exact arithmetic. */
export function ScoreTiles({
  score,
  momentum,
  streak,
  threshold,
  rangeLabel,
}: {
  score: ScoreCard;
  momentum: Momentum;
  streak: { current: number; best: number };
  threshold: number;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState<Which | null>(null);
  const tiles: { key: Which; label: string; value: string; sub: React.ReactNode }[] = [
    {
      key: 'execution',
      label: 'Execution',
      value: fmtPct(score.execution),
      sub: <Delta value={score.execution != null && score.prevExecution != null ? (score.execution - score.prevExecution) * 100 : null} kind="pp" vs="vs before" />,
    },
    {
      key: 'consistency',
      label: 'Consistency',
      value: fmtPct(score.consistency),
      sub: <Delta value={score.consistency != null && score.prevConsistency != null ? (score.consistency - score.prevConsistency) * 100 : null} kind="pp" vs="vs before" />,
    },
    {
      key: 'streak',
      label: 'Streak',
      value: `${streak.current}`,
      sub: <span className="text-xs text-ink-3">{streak.current === 1 ? 'day' : 'days'} · best {streak.best}</span>,
    },
    {
      key: 'momentum',
      label: 'Trend',
      value: momentum.score == null ? '—' : String(momentum.score),
      sub: <span className="text-xs font-medium text-ink-2">{MOMENTUM_COPY[momentum.label]}</span>,
    },
  ];
  return (
    <>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        {tiles.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setOpen(t.key)}
            aria-label={`${t.label} ${t.value}. How it’s calculated`}
            className="pressable flex flex-col rounded-[16px] border border-line px-4 py-3.5 text-left hover:border-line-strong"
          >
            <span className="flex items-center justify-between text-[13px] font-medium text-ink-2">
              {t.label}
              <Info size={14} className="text-ink-3" aria-hidden />
            </span>
            <span className="mt-1.5 text-[30px] font-semibold leading-none tracking-[-0.035em] text-ink tnum">{t.value}</span>
            <span className="mt-2 min-h-4">{t.sub}</span>
          </button>
        ))}
      </div>
      <Sheet open={open != null} onClose={() => setOpen(null)} title="How this is calculated" size="md">
        {open && <Explain which={open} score={score} momentum={momentum} streak={streak} threshold={threshold} rangeLabel={rangeLabel} />}
      </Sheet>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-[15px]">
      <span className="text-ink-2">{k}</span>
      <span className="font-medium text-ink tnum">{v}</span>
    </div>
  );
}

function Explain({
  which,
  score,
  momentum,
  streak,
  threshold,
  rangeLabel,
}: {
  which: Which;
  score: ScoreCard;
  momentum: Momentum;
  streak: { current: number; best: number };
  threshold: number;
  rangeLabel: string;
}) {
  if (which === 'momentum') {
    return (
      <div className="flex flex-col gap-4 pt-1 text-[15px] leading-6 text-ink-2">
        <p>
          Trend is your daily execution averaged with recent days counting more: a day’s weight halves every 7 days. One bad day costs a few points and fades within two weeks; a bad fortnight doesn’t hide.
        </p>
        <div className="divide-y divide-line rounded-[12px] border border-line px-4">
          <Row k="Score (half-life 7 days)" v={momentum.score ?? '—'} />
          <Row k="Last ~week (half-life 3 days)" v={momentum.short == null ? '—' : fmtPct(momentum.short)} />
          <Row k="Last 28 days, plain average" v={momentum.long == null ? '—' : fmtPct(momentum.long)} />
          <Row k="Week vs 28 days" v={momentum.trend == null ? '—' : `${momentum.trend > 0 ? '+' : ''}${momentum.trend} pts`} />
          <Row k="Days of data" v={momentum.sampleDays} />
        </div>
        <p className="text-[13px] text-ink-3">
          Labels: Resetting under 25 or three empty days in a row · Surging at +8 or more · Slipping at −8 or worse · Strong at 75+ · otherwise Stable. Harder routines weigh more (easy 0.75× → extreme 1.5×).
        </p>
      </div>
    );
  }
  if (which === 'streak') {
    return (
      <div className="flex flex-col gap-4 pt-1 text-[15px] leading-6 text-ink-2">
        <p>
          A day counts toward your streak when you finish at least {Math.round(threshold * 100)}% of what was planned for it. Days with nothing planned and excused days don’t break it. Today only counts once it qualifies.
        </p>
        <div className="divide-y divide-line rounded-[12px] border border-line px-4">
          <Row k="Current streak" v={`${streak.current} ${streak.current === 1 ? 'day' : 'days'}`} />
          <Row k="Best ever" v={`${streak.best} ${streak.best === 1 ? 'day' : 'days'}`} />
        </div>
      </div>
    );
  }
  const exec = which === 'execution';
  return (
    <div className="flex flex-col gap-4 pt-1 text-[15px] leading-6 text-ink-2">
      <p>
        {exec
          ? 'Execution measures how much of the full plan you did. A full completion counts 1; a minimum counts half on yes/no routines; timed and counted routines count proportionally (20 of 60 minutes = 0.33). Nothing counts above 1.'
          : 'Consistency asks one question per planned routine: did you do it, at least at the minimum? Minimum wins count. Partial effort below the minimum doesn’t.'}
      </p>
      <div className="divide-y divide-line rounded-[12px] border border-line px-4">
        <Row k={`Planned (${rangeLabel})`} v={score.planned} />
        <Row k="Full or more" v={score.full} />
        <Row k="Minimum" v={score.minimum} />
        <Row k="Partial" v={score.partial} />
        <Row k="Missed" v={score.missed} />
        <Row k="Excused (left out)" v={score.excused} />
        <Row k={exec ? 'Execution' : 'Consistency'} v={fmtPct(exec ? score.execution : score.consistency, 1)} />
      </div>
      <p className="text-[13px] text-ink-3">
        Excused days never count against you. Today’s open routines aren’t counted until the day is over. Weekly targets count once the week is decided — flexible days you skip cost nothing.
      </p>
    </div>
  );
}
