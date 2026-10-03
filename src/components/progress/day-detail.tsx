'use client';

import { useEffect, useState } from 'react';
import { cn } from '@/lib/cn';
import { fmtValue, fmtPct } from '@/lib/format';
import { dayDetailAction } from '@/lib/actions';
import type { DayDetail } from '@/lib/server/progress';
import { AreaIcon } from '@/components/icons';
import { KeystoneGlyph } from '@/components/viz/marks';
import { ProofTile } from '@/components/evidence/proof-tile';

const STATUS: Record<DayDetail['items'][number]['status'], { label: string; cls: string }> = {
  kept: { label: 'Kept', cls: 'text-accent-text' },
  extra: { label: 'Extra', cls: 'text-accent-text' },
  partial: { label: 'Partial', cls: 'text-ink-2' },
  open: { label: 'Open', cls: 'text-ink-3' },
  excused: { label: 'Excused', cls: 'text-ink-3' },
  missed: { label: 'Missed', cls: 'text-bad' },
};

const REASON: Record<string, string> = {
  no_time: 'no time', forgot: 'forgot', low_energy: 'low energy', unexpected: 'something came up', procrastinated: 'procrastinated',
  too_hard: 'too hard', not_important: 'not important', rest: 'rest', sick: 'sick', travel: 'travel', other: 'other',
};

export function DayDetailView({ day }: { day: string }) {
  const [data, setData] = useState<DayDetail | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    setData(undefined);
    void dayDetailAction(day).then((d) => alive && setData(d));
    return () => {
      alive = false;
    };
  }, [day]);

  if (data === undefined) {
    return (
      <div className="flex flex-col gap-3 pt-2" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-10 animate-pulse rounded-[10px] bg-sunken" />
        ))}
      </div>
    );
  }
  if (!data) return <p className="py-6 text-sm text-ink-3">Nothing to show for this day.</p>;

  return (
    <div className="flex flex-col gap-6 pt-1">
      <dl className="grid grid-cols-3 gap-3">
        <div>
          <dt className="label-mono">Kept</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">
            {data.kept}
            <span className="text-base text-ink-3">/{data.planned}</span>
          </dd>
        </div>
        <div>
          <dt className="label-mono">Execution</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">{fmtPct(data.execution)}</dd>
        </div>
        <div>
          <dt className="label-mono">Points</dt>
          <dd className="mt-1 text-2xl font-semibold text-ink">+{data.xp}</dd>
        </div>
      </dl>

      {data.keystone && (
        <p className="flex items-center gap-2 rounded-[12px] bg-accent-soft px-3.5 py-2.5 text-sm text-ink">
          <KeystoneGlyph size={14} filled className="text-accent-text" /> Weekly Focus done: {data.keystone}
        </p>
      )}

      {data.items.length > 0 ? (
        <ul className="flex flex-col divide-y divide-line">
          {data.items.map((it) => (
            <li key={it.missionId} className="flex items-center gap-3 py-2.5">
              <AreaIcon kind={it.areaKind} size={16} className="shrink-0 text-ink-3" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-ink">{it.title}</p>
                {(it.note || it.reason) && (
                  <p className="truncate text-[13px] text-ink-3">{it.note ?? `Reason: ${REASON[it.reason!] ?? it.reason}`}</p>
                )}
              </div>
              {it.value != null && <span className="text-[13px] text-ink-2 tnum">{fmtValue(it.value, it.unit)}</span>}
              <span className={cn('w-16 text-right text-[13px] font-medium', STATUS[it.status].cls)}>
                {it.outcome === 'minimum' ? 'Minimum' : it.outcome === 'exceeded' ? 'Exceeded' : STATUS[it.status].label}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-3">Nothing was due this day.</p>
      )}

      {data.proofs.length > 0 && (
        <section>
          <h3 className="label-mono mb-2">Proof</h3>
          <div className="grid grid-cols-3 gap-2">
            {data.proofs.map((p) => (
              <ProofTile key={p.id} proof={p} compact />
            ))}
          </div>
        </section>
      )}

      {data.money.length > 0 && (
        <section>
          <h3 className="label-mono mb-2">Money</h3>
          <ul className="flex flex-col divide-y divide-line">
            {data.money.map((t, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-[15px]">
                <span className="truncate text-ink-2">{t.label}</span>
                <span className={cn('tnum', t.kind === 'income' ? 'text-good' : 'text-ink')}>{t.amount}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
