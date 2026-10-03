import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadLearning } from '@/lib/server/learning';
import { Page } from '@/components/page';
import { LearningView } from '@/components/learning/learning-view';

export const metadata: Metadata = { title: 'Learning' };

export default async function LearningPage() {
  const viewer = await getViewer();
  const data = await loadLearning(viewer);
  return (
    <Page title="Learning" back={{ href: '/areas', label: 'Areas' }}>
      <LearningView data={data} />
    </Page>
  );
}
