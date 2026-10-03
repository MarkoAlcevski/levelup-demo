import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/context';
import { GROUP_KIND_LABEL, previewGroup } from '@/lib/server/groups';
import { Page } from '@/components/page';
import { JoinGroup } from '@/components/groups/group-forms';

export const metadata: Metadata = { title: 'Join a group' };

const PROOF = { self_report: 'Self-report', proof_optional: 'Proof optional', proof_required: 'Proof required' } as Record<string, string>;
const SEASON = { week: 'Weekly seasons', month: 'Monthly seasons', custom: 'Custom-length seasons' } as Record<string, string>;

export default async function JoinCodePage({ params }: { params: Promise<{ code: string }> }) {
  const viewer = await getViewer();
  const { code } = await params;
  const preview = await previewGroup(viewer, code);
  if (!preview) {
    return (
      <Page title="Join a group" back={{ href: '/groups', label: 'Groups' }}>
        <p className="text-[15px] text-ink-2">That code doesn’t match any group. Check it with whoever invited you — codes are 8 letters and numbers.</p>
        <Link href="/groups/join" className="text-[15px] font-medium text-accent-text">Enter a code →</Link>
      </Page>
    );
  }
  const target =
    preview.target_rule === 'same'
      ? `Everyone: ${Number(preview.same_target)} a week`
      : preview.min_target != null || preview.max_target != null
        ? `Your own target (${[preview.min_target != null ? `min ${Number(preview.min_target)}` : null, preview.max_target != null ? `max ${Number(preview.max_target)}` : null].filter(Boolean).join(', ')})`
        : 'Your own weekly target';
  return (
    <Page title={preview.name} kicker={`${GROUP_KIND_LABEL[preview.kind]} group · ${preview.members} member${preview.members === 1 ? '' : 's'}`} back={{ href: '/groups', label: 'Groups' }}>
      <dl className="grid grid-cols-1 divide-y divide-line rounded-[16px] border border-line px-4">
        {[
          ['Seasons', SEASON[preview.season_length]],
          ['Targets', target],
          ['Proof', PROOF[preview.proof_policy]],
          ...(preview.prize ? [['Prize', preview.prize]] : []),
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-3 text-[15px]">
            <dt className="text-ink-3">{k}</dt>
            <dd className="text-right text-ink">{v}</dd>
          </div>
        ))}
      </dl>
      <JoinGroup code={code.toUpperCase()} preview={preview} />
    </Page>
  );
}
