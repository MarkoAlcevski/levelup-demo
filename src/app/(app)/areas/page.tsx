import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadAreasPage } from '@/lib/server/areas';
import { Page } from '@/components/page';
import { AreasView } from '@/components/areas/areas-view';

export const metadata: Metadata = { title: 'Areas' };

export default async function AreasPageRoute() {
  const viewer = await getViewer();
  const data = await loadAreasPage(viewer);
  return (
    <Page title="Areas" kicker="What you’re tracking">
      <AreasView data={data} />
    </Page>
  );
}
