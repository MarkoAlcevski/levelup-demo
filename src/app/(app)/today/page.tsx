import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadToday } from '@/lib/server/today';
import { loadQuestDay } from '@/lib/server/quests';
import { TodayView } from '@/components/today/today-view';

export const metadata: Metadata = { title: 'Today' };

export default async function TodayPage() {
  const viewer = await getViewer();
  const [data, quests] = await Promise.all([loadToday(viewer), loadQuestDay(viewer).catch(() => null)]);
  return <TodayView data={data} quests={quests} />;
}
