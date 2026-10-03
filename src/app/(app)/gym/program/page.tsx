import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { asUser } from '@/lib/db';
import { getViewer } from '@/lib/server/context';
import { getProgram } from '@/lib/server/gym';
import { Page } from '@/components/page';
import { GymSubnav } from '@/components/gym/subnav';
import { ProgramEditor } from '@/components/gym/program-editor';

export const metadata: Metadata = { title: 'Program' };

export default async function ProgramPage() {
  const viewer = await getViewer();
  const program = await asUser(viewer.userId, (q) => getProgram(q));
  if (!program) redirect('/gym');
  return (
    <Page title="Program" back={{ href: '/gym', label: 'Gym' }} subnav={<GymSubnav active="program" />}>
      <ProgramEditor program={program} />
    </Page>
  );
}
