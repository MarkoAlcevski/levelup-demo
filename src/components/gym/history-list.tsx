'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowRight, Images } from '@phosphor-icons/react';
import { formatDay, monthName } from '@/lib/engine/dates';
import { fmtNum } from '@/lib/engine/gym';
import type { SessionListItem } from '@/lib/server/gym';
import { gymHistoryAction } from '@/lib/actions';
import { fmtMinutes } from '@/lib/format';
import { Button } from '@/components/ui/primitives';

/** Every workout, newest first — the same sessions the calendar shows, as a list. */
export function HistoryList({ initial, next, today, unit }: { initial: SessionListItem[]; next: string | null; today: string; unit: 'kg' | 'lb' }) {
  const [items, setItems] = useState(initial);
  const [cursor, setCursor] = useState(next);
  const [pending, start] = useTransition();
  if (!items.length) return <p className="rounded-[16px] border border-dashed border-line-strong px-6 py-10 text-center text-sm text-ink-3">Finished workouts appear here, newest first.</p>;
  const groups: { month: string; list: SessionListItem[] }[] = [];
  for (const it of items) {
    const m = it.on.slice(0, 7);
    const g = groups.at(-1);
    if (g?.month === m) g.list.push(it);
    else groups.push({ month: m, list: [it] });
  }
  return (
    <div className="flex flex-col gap-6">
      {groups.map((g) => (
        <section key={g.month} aria-label={`${monthName(g.month + '-01', true)} ${g.month.slice(0, 4)}`}>
          <h2 className="label-mono mb-1">
            {monthName(g.month + '-01', true)} {g.month.slice(0, 4)} · {g.list.length}
          </h2>
          <ul className="divide-y divide-line">
            {g.list.map((s) => (
              <li key={s.id}>
                <Link href={`/gym/session/${s.id}`} className="flex min-h-16 items-center gap-3 py-2.5">
                  <span className="w-14 shrink-0 font-mono text-[11px] uppercase text-ink-3">{formatDay(s.on, today)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2 text-[15px] font-medium text-ink">
                      {s.name}
                      {s.proofs > 0 && <Images size={14} weight="fill" className="text-ink-3" aria-label={`${s.proofs} proof`} />}
                    </span>
                    <span className="block text-[13px] text-ink-3">
                      {[s.durationSeconds ? fmtMinutes(s.durationSeconds / 60) : null, `${s.exercises} exercises`, `${s.sets} sets`, s.volumeKg ? `${fmtNum(Math.round(unit === 'kg' ? s.volumeKg : s.volumeKg / 0.45359237))} ${unit}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <ArrowRight size={14} className="text-ink-3" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {cursor && (
        <Button
          variant="outline"
          block
          loading={pending}
          onClick={() =>
            start(async () => {
              const res = await gymHistoryAction(cursor);
              setItems((x) => [...x, ...res.items]);
              setCursor(res.next);
            })
          }
        >
          Load more
        </Button>
      )}
    </div>
  );
}
