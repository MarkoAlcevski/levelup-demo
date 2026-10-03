import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { loadAreaDetail } from '@/lib/server/areas';
import { isGymKind } from '@/lib/modules';
import { Page } from '@/components/page';
import { AreaDetailView } from '@/components/areas/area-detail';

export const metadata: Metadata = { title: 'Area' };

export default async function AreaPage({ params }: { params: Promise<{ id: string }> }) {
  const viewer = await getViewer();
  const { id } = await params;
  const data = await loadAreaDetail(viewer, id);
  if (!data) notFound();
  if (!data.area.archived && isGymKind(data.area.kind) && !data.routines.length && !data.tasks.length) redirect('/gym');
  if (!data.area.archived && data.area.kind === 'learning' && !data.routines.length && !data.tasks.length) redirect('/learning');
  return (
    <Page title={data.area.name} kicker="Area" back={{ href: '/areas', label: 'Areas' }}>
      <AreaDetailView data={data} />
    </Page>
  );
}
