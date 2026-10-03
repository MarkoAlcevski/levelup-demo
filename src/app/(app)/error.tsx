'use client';

import { useEffect } from 'react';
import Link from 'next/link';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="label-mono">Something broke</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink">This screen didn’t load.</h1>
      <p className="mt-2 text-[15px] text-ink-3">Your data is safe — nothing you’ve logged is lost. Try again, or head back to Today.</p>
      <div className="mt-6 flex gap-2">
        <button type="button" onClick={reset} className="pressable h-11 rounded-[12px] bg-accent px-5 font-medium text-accent-ink">
          Try again
        </button>
        <Link href="/today" className="pressable inline-flex h-11 items-center rounded-[12px] border border-line-strong px-5 font-medium text-ink">
          Today
        </Link>
      </div>
      {error.digest && <p className="mt-6 font-mono text-[11px] text-ink-3">ref {error.digest}</p>}
    </div>
  );
}
