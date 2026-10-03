import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadYou } from '@/lib/server/you';
import { Page } from '@/components/page';
import { ProfileView } from '@/components/you/you-view';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage() {
  const viewer = await getViewer();
  const data = await loadYou(viewer);
  return (
    <Page title={data.name || 'Profile'} kicker={data.name ? 'Profile' : undefined}>
      <ProfileView data={data} />
    </Page>
  );
}
