import type { Metadata } from 'next';
import { Page } from '@/components/page';
import { CreateGroupForm } from '@/components/groups/group-forms';

export const metadata: Metadata = { title: 'New group' };

export default function NewGroupPage() {
  return (
    <Page title="New group" back={{ href: '/groups', label: 'Groups' }}>
      <CreateGroupForm />
    </Page>
  );
}
