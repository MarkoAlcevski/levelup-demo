import type { Metadata } from 'next';
import { Page } from '@/components/page';
import { JoinCodeForm } from '@/components/groups/group-forms';

export const metadata: Metadata = { title: 'Join a group' };

export default function JoinPage() {
  return (
    <Page title="Join a group" back={{ href: '/groups', label: 'Groups' }}>
      <div className="flex flex-col gap-2">
        <JoinCodeForm />
        <p className="text-[13px] text-ink-3">Ask whoever invited you for the 8-character code.</p>
      </div>
    </Page>
  );
}
