import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { demoMode } from '@/lib/config';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ demo?: string; next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/') && !sp.next.startsWith('//') ? sp.next : null;
  if (await getSession()) redirect(next ?? '/today');
  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Welcome back</h1>
      <p className="mt-1.5 mb-8 text-[15px] text-ink-3">Pick up where you left off.</p>
      <AuthForm
        mode="login"
        demo={demoMode() !== 'off'}
        next={next}
        notice={sp.demo === 'busy' ? 'Lots of demos started from your network — try again in a little while, or create an account.' : next?.startsWith('/groups/join/') ? 'Sign in or create an account to join the group.' : undefined}
      />
    </>
  );
}
