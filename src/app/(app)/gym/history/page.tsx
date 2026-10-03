import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadGymHistory } from '@/lib/server/gym';
import { Page } from '@/components/page';
import { GymSubnav } from '@/components/gym/subnav';
import { HistoryList } from '@/components/gym/history-list';

export const metadata: Metadata = { title: 'Workout history' };

export default async function GymHistoryPage() {
  const viewer = await getViewer();
  const first = await loadGymHistory(viewer, null);
  return (
    <Page title="History" back={{ href: '/gym', label: 'Gym' }} subnav={<GymSubnav active="history" />}>
      <HistoryList initial={first.items} next={first.next} today={viewer.today} unit={viewer.profile.weightUnit} />
    </Page>
  );
}
