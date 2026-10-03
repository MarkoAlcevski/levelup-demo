'use client';

import Link from 'next/link';
import { motion, useReducedMotion } from 'motion/react';
import { Crown } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import type { WorldBoard, WorldRow } from '@/lib/server/world';
import { LevelCoin, formatCoins } from '@/components/collectables/level-coin';

const MEDAL = ['oklch(0.85 0.15 85)', 'oklch(0.82 0.02 260)', 'oklch(0.7 0.11 55)'];

/** Top three on a podium, everyone else in a list; your row is always visible. */
export function WorldBoardView({ board, unit }: { board: WorldBoard; unit: string }) {
  const reduce = useReducedMotion();
  const top = board.rows.slice(0, 3);
  const rest = board.rows.slice(3);
  const fmt = (v: number) => (board.metric === 'coins' ? formatCoins(v) : String(v));
  const podium = [top[1], top[0], top[2]].filter(Boolean) as WorldRow[];
  return (
    <div className="flex flex-col gap-6" data-tour="world-board">
      {board.hidden && (
        <p className="rounded-[14px] border border-line px-4 py-3 text-[14px] text-ink-2">
          You’re hidden from the world leaderboards.{' '}
          <Link href="/profile" className="font-medium text-accent-text underline underline-offset-2">
            Show me in Profile
          </Link>
        </p>
      )}

      {top.length > 0 && (
        <ol className="grid grid-cols-3 items-end gap-2" aria-label="Top three">
          {podium.map((r) => {
            const place = r.rank;
            const h = place === 1 ? 'h-[132px]' : place === 2 ? 'h-[108px]' : 'h-[92px]';
            return (
              <motion.li
                key={`${r.rank}-${r.name}`}
                className="flex flex-col items-center gap-2"
                initial={reduce ? false : { opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ type: 'spring', stiffness: 220, damping: 20, delay: place === 1 ? 0.15 : place === 2 ? 0.05 : 0.25 }}
              >
                {place === 1 && <Crown size={22} weight="fill" style={{ color: MEDAL[0] }} aria-hidden />}
                <span
                  className={cn('grid size-12 place-items-center rounded-full border-2 text-[18px] font-semibold text-ink', r.me && 'ring-2 ring-accent ring-offset-2 ring-offset-bg')}
                  style={{ borderColor: MEDAL[place - 1] ?? 'var(--line-strong)' }}
                  aria-hidden
                >
                  {r.name.charAt(0)}
                </span>
                <span className="w-full truncate text-center text-[13px] font-medium text-ink">
                  {r.me ? 'You' : r.name}
                </span>
                <div
                  className={cn('flex w-full flex-col items-center justify-start rounded-t-[14px] border border-b-0 border-line bg-surface pt-2', h)}
                  style={{ boxShadow: `inset 0 3px 0 ${MEDAL[place - 1] ?? 'transparent'}` }}
                >
                  <span className="font-mono text-[12px] text-ink-3">#{place}</span>
                  <span className="mt-1 flex items-center gap-1 text-[17px] font-semibold text-ink tnum">
                    {board.metric === 'coins' && <LevelCoin size={14} />}
                    {fmt(r.value)}
                  </span>
                </div>
              </motion.li>
            );
          })}
        </ol>
      )}

      {rest.length > 0 && (
        <ol className="flex flex-col divide-y divide-line rounded-[16px] border border-line" aria-label="Everyone else">
          {rest.map((r, i) => (
            <Row key={`${r.rank}-${r.name}-${i}`} r={r} fmt={fmt} delay={reduce ? 0 : Math.min(i, 12) * 0.03} coins={board.metric === 'coins'} />
          ))}
        </ol>
      )}

      {board.me && (
        <div>
          <p className="label-mono mb-2 text-center">…</p>
          <ol className="rounded-[16px] border border-line">
            <Row r={board.me} fmt={fmt} delay={0} coins={board.metric === 'coins'} />
          </ol>
        </div>
      )}

      <p className="text-[13px] leading-5 text-ink-3">
        {board.total} {board.total === 1 ? 'person' : 'people'} ranked by {unit}. Only a first name and last initial are shown, and anyone can hide from the boards in Profile.
      </p>
    </div>
  );
}

function Row({ r, fmt, delay, coins }: { r: WorldRow; fmt: (v: number) => string; delay: number; coins: boolean }) {
  return (
    <motion.li
      className={cn('flex min-h-14 items-center gap-3 px-4 py-2.5', r.me && 'bg-accent-soft')}
      initial={delay ? { opacity: 0, x: -10 } : false}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay, duration: 0.25 }}
    >
      <span className="w-8 shrink-0 font-mono text-[13px] text-ink-3 tnum">#{r.rank}</span>
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sunken text-[13px] font-semibold text-ink-2" aria-hidden>
        {r.name.charAt(0)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[15px] text-ink">
        {r.name}
        {r.me && <span className="ml-2 rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-ink">You</span>}
      </span>
      <span className="flex items-center gap-1 text-[15px] font-semibold text-ink tnum">
        {coins && <LevelCoin size={13} />}
        {fmt(r.value)}
      </span>
    </motion.li>
  );
}
