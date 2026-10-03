import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadQuestDay } from '@/lib/server/quests';
import { loadCollectables } from '@/lib/server/collectables';
import { Page } from '@/components/page';
import { QuestsView } from '@/components/quests/quests-view';

export const metadata: Metadata = { title: 'Quests & collectables' };

/** Daily quests → LevelCoins → collectables, trades and set prizes. */
export default async function QuestsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const day = await loadQuestDay(viewer);
  const collect = await loadCollectables(viewer);
  const tab = sp.tab === 'collectables' || sp.tab === 'cards' || sp.tab === 'boxes' ? 'collectables' : 'quests';
  return (
    <Page title="Quests" kicker="LevelCoins · collectables" back={{ href: '/today', label: 'Today' }}>
      <QuestsView day={day} collect={collect} initialTab={tab} />
    </Page>
  );
}
