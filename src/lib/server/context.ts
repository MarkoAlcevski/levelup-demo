import 'server-only';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { asUser } from '@/lib/db';
import { getSession } from '@/lib/auth/session';
import { clockInZone, todayIn } from '@/lib/engine/dates';
import { readProfile, type Viewer } from './profile';

export type { Profile, Viewer } from './profile';
export { readProfile } from './profile';

function viewerFor(userId: string, email: string, profile: NonNullable<Awaited<ReturnType<typeof readProfile>>>): Viewer {
  const now = new Date();
  const { hour, minute } = clockInZone(now, profile.timezone);
  return { userId, email, profile, today: todayIn(profile.timezone, now), hour, minute };
}

/** The signed-in, onboarded user plus their local "now". Cached per request; redirects otherwise. */
export const getViewer = cache(async (): Promise<Viewer> => {
  const session = await getSession();
  if (!session) redirect('/login');
  const profile = await asUser(session.userId, (q) => readProfile(q, session.userId));
  if (!profile) redirect('/login');
  if (!profile.onboardedAt) redirect('/onboarding');
  return viewerFor(session.userId, session.email, profile);
});

/** Signed in, onboarded or not (the onboarding flow itself). */
export const getViewerAllowingOnboarding = cache(async (): Promise<Viewer> => {
  const session = await getSession();
  if (!session) redirect('/login');
  const profile = await asUser(session.userId, (q) => readProfile(q, session.userId));
  if (!profile) redirect('/login');
  return viewerFor(session.userId, session.email, profile);
});

/** For Server Actions / route handlers: no redirects, null when signed out. */
export async function viewerOrNull(): Promise<Viewer | null> {
  const session = await getSession();
  if (!session) return null;
  const profile = await asUser(session.userId, (q) => readProfile(q, session.userId));
  if (!profile) return null;
  return viewerFor(session.userId, session.email, profile);
}
