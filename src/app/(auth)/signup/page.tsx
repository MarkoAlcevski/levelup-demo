import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth/session';
import { inviteCode } from '@/lib/config';
import { AuthForm } from '@/components/auth/auth-form';

export const metadata: Metadata = { title: 'Create account' };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const next = sp.next && sp.next.startsWith('/groups/join/') ? sp.next : null;
  if (await getSession()) redirect(next ?? '/today');
  return (
    <>
      <h1 className="text-[28px] font-semibold tracking-[-0.03em] text-ink">Create your account</h1>
      <p className="mt-1.5 mb-8 text-[15px] text-ink-3">Thirty seconds to set up. Everything stays private to you.</p>
      <AuthForm mode="signup" demo={false} invite={!!inviteCode()} next={next} notice={next ? 'Create an account, then you’ll join the group.' : undefined} />
    </>
  );
}
