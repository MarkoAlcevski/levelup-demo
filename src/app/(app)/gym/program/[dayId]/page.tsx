import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { asUser } from '@/lib/db';
import { getViewer } from '@/lib/server/context';
import { getProgram } from '@/lib/server/gym';
import { Page } from '@/components/page';
import { DayEditor } from '@/components/gym/day-editor';

export const metadata: Metadata = { title: 'Workout' };

export default async function DayPage({ params }: { params: Promise<{ dayId: string }> }) {
  const viewer = await getViewer();
  const { dayId } = await params;
  const program = await asUser(viewer.userId, (q) => getProgram(q));
  const day = program?.days.find((d) => d.id === dayId);
  if (!day) notFound();
  return (
    <Page title={day.name} kicker="Workout" back={{ href: '/gym/program', label: 'Program' }}>
      <DayEditor day={day} unit={viewer.profile.weightUnit} />
    </Page>
  );
}
