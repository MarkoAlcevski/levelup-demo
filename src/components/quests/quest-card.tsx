'use client';

import Link from 'next/link';
import { CaretRight, Check } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import type { QuestDay } from '@/lib/server/quests';
import { LevelCoin, formatCoins } from '@/components/collectables/level-coin';

/** Today's quests at a glance; the full list and the collectables live on /quests. */
export function QuestCard({ day }: { day: QuestDay }) {
  const done = day.quests.filter((q) => q.done).length;
  const open = day.quests.filter((q) => !q.done).slice(0, 3);
  return (
    <Link href="/quests" data-tour="quest-card" className="pressable group block rounded-[16px] border border-line px-4 py-3.5 hover:border-line-strong">
      <span className="flex items-center justify-between gap-3">
        <span className="label-mono">
          Quests · {done} of {day.quests.length}
        </span>
        <span className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-ink tnum">
          <LevelCoin size={16} /> {formatCoins(day.coins)}
          <CaretRight size={14} className="text-ink-3 transition-transform group-hover:translate-x-0.5" aria-hidden />
        </span>
      </span>
      {open.length ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {open.map((q) => (
            <li key={q.key} className="flex items-center gap-2.5 text-[14px] text-ink-2">
              <span className="size-4 shrink-0 rounded-full border border-line-strong" aria-hidden />
              <span className="min-w-0 flex-1 truncate">{q.title}</span>
              {q.reward > 0 && <span className="shrink-0 text-[12px] text-ink-3 tnum">+{q.reward}</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className={cn('mt-2 flex items-center gap-2 text-[14px]', day.quests.length ? 'text-good' : 'text-ink-3')}>
          {day.quests.length ? (
            <>
              <Check size={15} weight="bold" /> Every quest done. Open a box with your LevelCoins.
            </>
          ) : (
            'Add a quest for today and earn LevelCoins.'
          )}
        </p>
      )}
    </Link>
  );
}
