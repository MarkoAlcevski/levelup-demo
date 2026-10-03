import Link from 'next/link';
import { APP_NAME, TAGLINE } from '@/lib/brand';
import { LogoMark } from '@/components/viz/marks';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden border-r border-line bg-surface lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Link href="/" className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em] text-ink">
          <LogoMark size={24} /> {APP_NAME}
        </Link>
        <EvidenceField />
        <div className="relative max-w-md">
          <p className="text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink">Most apps record what you planned.</p>
          <p className="mt-3 text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-ink-3">LevelUp rewards what you did.</p>
        </div>
      </aside>
      <main className="flex flex-col justify-center px-5 py-12 sm:px-10">
        <div className="mx-auto w-full max-w-[380px]">
          <div className="mb-10 lg:hidden">
            <Link href="/" className="flex items-center gap-2.5 text-lg font-semibold tracking-[-0.02em] text-ink">
              <LogoMark size={24} /> {APP_NAME}
            </Link>
            <p className="mt-3 text-sm text-ink-3">{TAGLINE}</p>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}

/** A year of evidence as a quiet field of kept days — pure CSS, deterministic, decorative. */
function EvidenceField() {
  const cells = Array.from({ length: 7 * 30 }, (_, i) => {
    const week = Math.floor(i / 7);
    const trend = week / 30;
    const n = Math.sin(i * 12.9898) * 43758.5453;
    const r = n - Math.floor(n);
    const v = r < 0.12 + (1 - trend) * 0.2 ? 0 : r < 0.35 ? 1 : r < 0.6 + trend * 0.15 ? 2 : 3;
    return v;
  });
  const alpha = ['var(--heat-0)', 'color-mix(in oklch, var(--accent) 28%, transparent)', 'color-mix(in oklch, var(--accent) 58%, transparent)', 'var(--accent)'];
  return (
    <div aria-hidden className="relative my-10 grid w-fit grid-flow-col grid-rows-7 gap-[5px] opacity-90">
      {cells.map((v, i) => (
        <span key={i} className="size-[13px] rounded-[3px]" style={{ background: alpha[v] }} />
      ))}
    </div>
  );
}
