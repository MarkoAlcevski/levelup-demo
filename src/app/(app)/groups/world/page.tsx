import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/context';
import { WORLD_METRICS, loadWorld, type WorldMetric } from '@/lib/server/world';
import { formatDay } from '@/lib/engine/dates';
import { Page } from '@/components/page';
import { WorldBoardView } from '@/components/groups/world-board';

export const metadata: Metadata = { title: 'World leaderboard' };

export default async function WorldPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const metric: WorldMetric = WORLD_METRICS.some((x) => x.key === sp.m) ? (sp.m as WorldMetric) : 'coins';
  const board = await loadWorld(viewer, metric);
  const info = WORLD_METRICS.find((x) => x.key === metric)!;
  return (
    <Page title="World" kicker={metric === 'collectors' ? 'Leaderboard · all time' : `Leaderboard · week of ${formatDay(board.weekOf)}`} back={{ href: '/groups', label: 'Groups' }}>
      <nav aria-label="Leaderboards" data-tour="world-tabs" className="flex rounded-[12px] bg-sunken p-1">
        {WORLD_METRICS.map((m) => {
          const on = m.key === metric;
          return (
            <Link
              key={m.key}
              href={`/groups/world?m=${m.key}`}
              aria-current={on ? 'page' : undefined}
              scroll={false}
              className={
                on
                  ? 'pressable flex h-10 flex-1 items-center justify-center rounded-[9px] bg-raised text-sm font-medium text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_1px_var(--line-2)]'
                  : 'pressable flex h-10 flex-1 items-center justify-center rounded-[9px] text-sm font-medium text-ink-3 hover:text-ink-2'
              }
            >
              {m.label}
            </Link>
          );
        })}
      </nav>
      <WorldBoardView board={board} unit={info.unit} />
    </Page>
  );
}
