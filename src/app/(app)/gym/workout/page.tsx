import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewer } from '@/lib/server/context';
import { WorkoutLogger } from '@/components/gym/workout-logger';

export const metadata: Metadata = { title: 'Workout' };

export default async function WorkoutPage({ searchParams }: { searchParams: Promise<{ id?: string; edit?: string }> }) {
  await getViewer();
  const { id, edit } = await searchParams;
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) redirect('/gym');
  return <WorkoutLogger id={id} edit={edit === '1'} />;
}
