import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <p className="label-mono">404</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink">Nothing on record here.</h1>
      <p className="mt-2 text-[15px] text-ink-3">The page moved, or it was never kept.</p>
      <Link href="/today" className="pressable mt-6 inline-flex h-11 items-center rounded-[12px] bg-accent px-5 font-medium text-accent-ink">
        Back to Today
      </Link>
    </div>
  );
}
