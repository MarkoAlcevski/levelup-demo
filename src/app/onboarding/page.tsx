import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getViewerAllowingOnboarding } from '@/lib/server/context';
import { OnboardingFlow } from '@/components/onboarding/onboarding-flow';

export const metadata: Metadata = { title: 'Set up' };

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const viewer = await getViewerAllowingOnboarding();
  const { next } = await searchParams;
  const safeNext = next && next.startsWith('/groups/join/') ? next : null;
  if (viewer.profile.onboardedAt) redirect(safeNext ?? '/today');
  return <OnboardingFlow defaultName={viewer.profile.displayName} defaultCurrency={viewer.profile.baseCurrency} next={safeNext} />;
}
