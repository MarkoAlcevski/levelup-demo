import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadGymHome } from '@/lib/server/gym';
import { Page } from '@/components/page';
import { GymSubnav } from '@/components/gym/subnav';
import { GymSetup } from '@/components/gym/setup';
import { GymHomeView } from '@/components/gym/gym-home';

export const metadata: Metadata = { title: 'Gym' };

export default async function GymPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const viewer = await getViewer();
  const { month } = await searchParams;
  const data = await loadGymHome(viewer, month ?? null);
  if (!data.program) {
    return (
      <Page title="Gym" back={{ href: '/areas', label: 'Areas' }}>
        <GymSetup />
      </Page>
    );
  }
  return (
    <Page title="Gym" back={{ href: '/areas', label: 'Areas' }} subnav={<GymSubnav active="overview" />}>
      <GymHomeView data={data} weekStartsOn={viewer.profile.weekStartsOn} />
    </Page>
  );
}
