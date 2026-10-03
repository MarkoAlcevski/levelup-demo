import Link from 'next/link';
import { cn } from '@/lib/cn';
import { ProfileButton } from '@/components/shell/viewer';

/**
 * Consistent page frame: title, optional actions, optional sub-navigation. On phones the avatar
 * (→ Profile) sits top-right on every page, so Profile never needs a tab.
 */
export function Page({
  title,
  kicker,
  actions,
  subnav,
  children,
  width = 'md',
  back,
}: {
  title: string;
  kicker?: React.ReactNode;
  actions?: React.ReactNode;
  subnav?: React.ReactNode;
  children: React.ReactNode;
  width?: 'md' | 'lg';
  back?: { href: string; label: string };
}) {
  return (
    <div className={cn('mx-auto w-full px-4 pt-[max(20px,env(safe-area-inset-top))] pb-40 lg:px-8 lg:pt-10 lg:pb-16', width === 'lg' ? 'max-w-[1080px]' : 'max-w-[760px]')}>
      {back && (
        <Link href={back.href} className="-ml-1 mb-2 inline-flex min-h-11 items-center gap-1 px-1 text-sm text-ink-3 hover:text-ink">
          <span aria-hidden>←</span> {back.label}
        </Link>
      )}
      <header data-tour="page" className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {kicker && <p className="label-mono mb-1.5">{kicker}</p>}
          <h1 className="text-[28px] font-semibold leading-tight tracking-[-0.03em] text-ink">{title}</h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <ProfileButton size={40} className="lg:hidden" />
        </div>
      </header>
      {subnav && <div className="mt-4">{subnav}</div>}
      <div className="mt-6 flex flex-col gap-8">{children}</div>
    </div>
  );
}

export function Section({ title, aside, children, id, className }: { title: string; aside?: React.ReactNode; children: React.ReactNode; id?: string; className?: string }) {
  return (
    <section aria-labelledby={id ? `${id}-h` : undefined} id={id} className={className}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h2 id={id ? `${id}-h` : undefined} className="text-[17px] font-semibold tracking-[-0.015em] text-ink">
          {title}
        </h2>
        {aside && <div className="text-[13px] text-ink-3">{aside}</div>}
      </div>
      {children}
    </section>
  );
}

/** Link-based segmented switch for URL state (range pickers). */
export function RangeLinks({ options, current, param = 'range', base, extra = '' }: { options: { value: string; label: string }[]; current: string; param?: string; base: string; extra?: string }) {
  return (
    <nav aria-label="Range" className="no-scrollbar flex overflow-x-auto rounded-[12px] bg-sunken p-1">
      {options.map((o) => (
        <a
          key={o.value}
          href={`${base}?${param}=${o.value}${extra}`}
          aria-current={o.value === current ? 'true' : undefined}
          className={cn(
            'pressable flex h-9 min-w-11 flex-1 shrink-0 items-center justify-center whitespace-nowrap rounded-[9px] px-2.5 text-[13px] font-medium',
            o.value === current ? 'bg-raised text-ink shadow-[0_1px_2px_rgb(0_0_0/0.2),0_0_0_1px_var(--line-2)]' : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {o.label}
        </a>
      ))}
    </nav>
  );
}

/** Tabs under a page title (Money, Gym, Progress). Server-rendered: the active tab comes from the page. */
export function Subnav({ tabs, active, label }: { tabs: { href: string; label: string; key: string }[]; active: string; label: string }) {
  return (
    <nav aria-label={label} data-tour="subnav" className="no-scrollbar -mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 lg:mx-0 lg:px-0">
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <Link
            key={t.key}
            href={t.href}
            aria-current={on ? 'page' : undefined}
            className={cn('relative -mb-px flex min-h-11 shrink-0 items-center px-3 text-sm font-medium transition-colors', on ? 'text-ink' : 'text-ink-3 hover:text-ink-2')}
          >
            {t.label}
            {on && <span className="absolute inset-x-3 -bottom-px h-[2px] rounded-full bg-accent" />}
          </Link>
        );
      })}
    </nav>
  );
}

/** A quiet empty state: what will appear here, and one action. */
export function Empty({ title, body, action }: { title: string; body: string; action?: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-lg font-semibold text-ink">{title}</p>
      <p className="mx-auto mt-1.5 max-w-md text-sm text-ink-3">{body}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </div>
  );
}
