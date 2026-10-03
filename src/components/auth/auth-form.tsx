'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import { useFormStatus } from 'react-dom';
import { signInAction, signUpAction, startDemoAction, type AuthState } from '@/lib/actions';
import { Button, Field, Input } from '@/components/ui/primitives';

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" block loading={pending}>
      {children}
    </Button>
  );
}

export function AuthForm({ mode, demo, invite = false, notice, next }: { mode: 'login' | 'signup'; demo: boolean; invite?: boolean; notice?: string; next?: string | null }) {
  const [state, action] = useActionState<AuthState, FormData>(mode === 'login' ? signInAction : signUpAction, {});
  const [tz, setTz] = useState('UTC');
  useEffect(() => setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'), []);

  return (
    <div className="flex flex-col gap-6">
      {notice && <p className="rounded-[12px] border border-line-strong bg-surface px-4 py-3 text-sm text-ink-2">{notice}</p>}
      <form action={action} className="flex flex-col gap-4" noValidate>
        <input type="hidden" name="timezone" value={tz} />
        {next && <input type="hidden" name="next" value={next} />}
        {invite && (
          <Field label="Invite code" htmlFor="invite" error={state.field === 'invite' ? state.error : undefined} hint="It came with the link.">
            <Input id="invite" name="invite" autoComplete="off" autoCapitalize="none" spellCheck={false} required aria-invalid={state.field === 'invite' ? true : undefined} />
          </Field>
        )}
        <Field label="Email" htmlFor="email" error={state.field === 'email' || (!state.field && state.error) ? state.error : undefined}>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            defaultValue={state.email}
            required
            aria-invalid={state.error && (state.field === 'email' || !state.field) ? true : undefined}
          />
        </Field>
        <Field
          label="Password"
          htmlFor="password"
          error={state.field === 'password' ? state.error : undefined}
          hint={mode === 'signup' ? 'At least 8 characters.' : undefined}
        >
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            minLength={8}
            required
            aria-invalid={state.field === 'password' ? true : undefined}
          />
        </Field>
        <Submit>{mode === 'login' ? 'Sign in' : 'Create account'}</Submit>
      </form>

      <p className="text-center text-sm text-ink-3">
        {mode === 'login' ? (
          <>
            New here?{' '}
            <Link href={next ? `/signup?next=${encodeURIComponent(next)}` : '/signup'} className="font-medium text-ink underline-offset-4 hover:underline">
              Create an account
            </Link>
          </>
        ) : (
          <>
            Already keeping a record?{' '}
            <Link href={next ? `/login?next=${encodeURIComponent(next)}` : '/login'} className="font-medium text-ink underline-offset-4 hover:underline">
              Sign in
            </Link>
          </>
        )}
      </p>

      {demo && (
        <form action={startDemoAction} className="border-t border-line pt-6">
          <DemoButton />
          <p className="mt-2 text-center text-xs text-ink-3">Months of realistic history in a private demo account — nothing to set up.</p>
        </form>
      )}
    </div>
  );
}

function DemoButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="outline" size="lg" block loading={pending}>
      Explore the demo
    </Button>
  );
}
