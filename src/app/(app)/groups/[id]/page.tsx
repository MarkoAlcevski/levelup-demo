import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { GROUP_KIND_LABEL, loadGroup } from '@/lib/server/groups';
import { Page } from '@/components/page';
import { GroupView } from '@/components/groups/group-view';

export const metadata: Metadata = { title: 'Group' };

export default async function GroupPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ new?: string }> }) {
  const viewer = await getViewer();
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const data = await loadGroup(viewer, id);
  if (!data?.me) notFound();
  return (
    <Page title={data.group.name} kicker={`${GROUP_KIND_LABEL[data.group.kind]} group`} back={{ href: '/groups', label: 'Groups' }}>
      <GroupView data={data} isNew={sp.new === '1'} />
    </Page>
  );
}
