'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ChartLineUp, MagnifyingGlass, Notebook as NotebookIcon, Plus, SquaresFour, SunHorizon, Trophy, UsersThree, Wallet } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { APP_NAME } from '@/lib/brand';
import { LevelRing, LogoMark } from '@/components/viz/marks';
import { useQuickAdd } from './quick-add';
import { useCommandBar } from './command-bar';
import { useViewerInfo } from './viewer';

/**
 * Five destinations, each one question:
 *   Today — what do I do now?   Areas — what am I tracking?   Groups — how are my friends doing?
 *   Money — does my money make sense?   Progress — what did it all add up to?
 */
const ITEMS = [
  { href: '/today', label: 'Today', Icon: SunHorizon, match: ['/today', '/quests'] },
  { href: '/areas', label: 'Areas', Icon: SquaresFour, match: ['/areas', '/gym', '/learning'] },
  { href: '/groups', label: 'Groups', Icon: UsersThree, match: ['/groups'] },
  { href: '/money', label: 'Money', Icon: Wallet, match: ['/money'] },
  { href: '/progress', label: 'Progress', Icon: ChartLineUp, match: ['/progress', '/review', '/journal'] },
] as const;

function isActive(pathname: string, match: readonly string[]) {
  return match.some((m) => pathname === m || pathname.startsWith(m + '/'));
}

export function TabBar() {
  const pathname = usePathname();
  const quick = useQuickAdd();
  const hideFab = pathname.startsWith('/gym/workout') || pathname === '/groups/new' || pathname.startsWith('/gym/program');
  return (
    <>
      <nav
        aria-label="Primary"
        data-tour="nav"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-bg/85 backdrop-blur-xl supports-[backdrop-filter]:bg-bg/72 lg:hidden"
      >
        <ul className="mx-auto flex max-w-lg items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
          {ITEMS.map(({ href, label, Icon, match }) => {
            const active = isActive(pathname, match);
            return (
              <li key={href} className="flex-1">
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium tracking-[0.01em] transition-colors',
                    active ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  <Icon size={24} weight={active ? 'fill' : 'regular'} className={active ? 'text-accent-text' : undefined} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      {!hideFab && (
        <button
          type="button"
          onClick={() => quick.open()}
          aria-label="Quick add"
          data-tour="quick-add"
          className="pressable fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-accent-ink shadow-[0_10px_30px_-8px_var(--accent)] bottom-[calc(76px+env(safe-area-inset-bottom))] lg:hidden"
        >
          <Plus size={24} weight="bold" />
        </button>
      )}
    </>
  );
}

export function SideRail() {
  const pathname = usePathname();
  const quick = useQuickAdd();
  const command = useCommandBar();
  const v = useViewerInfo();
  return (
    <aside className="sticky top-0 hidden h-dvh w-[232px] shrink-0 flex-col border-r border-line px-3 py-5 lg:flex">
      <Link href="/today" className="flex items-center gap-2.5 px-3 pb-6 text-[17px] font-semibold tracking-[-0.02em] text-ink">
        <LogoMark size={22} />
        {APP_NAME}
      </Link>
      <button
        type="button"
        onClick={() => quick.open()}
        data-tour="quick-add"
        className="pressable mb-2 flex h-10 items-center gap-2 rounded-[10px] bg-accent px-3 text-sm font-semibold text-accent-ink"
      >
        <Plus size={16} weight="bold" /> Quick add
        <kbd className="ml-auto font-mono text-[11px] font-medium opacity-70">N</kbd>
      </button>
      <button
        type="button"
        onClick={() => command.open()}
        className="pressable mb-5 flex h-10 items-center gap-2 rounded-[10px] border border-line px-3 text-sm text-ink-3 hover:border-line-strong hover:text-ink-2"
      >
        <MagnifyingGlass size={16} /> Search or log…
        <kbd className="ml-auto font-mono text-[11px]">⌘K</kbd>
      </button>
      <nav aria-label="Primary" data-tour="nav">
        <ul className="flex flex-col gap-0.5">
          {ITEMS.map(({ href, label, Icon, match }) => {
            const active = isActive(pathname, match);
            return (
              <li key={href}>
                <Link
                  href={href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors',
                    active ? 'bg-sunken text-ink' : 'text-ink-3 hover:bg-surface hover:text-ink-2',
                  )}
                >
                  <Icon size={20} weight={active ? 'fill' : 'regular'} className={active ? 'text-accent-text' : undefined} />
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <Link
        href={`/journal/${v.today}`}
        className={cn(
          'mt-4 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors',
          pathname.startsWith('/journal') ? 'bg-sunken text-ink' : 'text-ink-3 hover:bg-surface hover:text-ink-2',
        )}
      >
        <NotebookIcon size={20} /> Today’s journal
      </Link>
      <Link
        href="/quests?tab=collectables"
        className={cn(
          'mt-1 flex h-10 items-center gap-3 rounded-[10px] px-3 text-[15px] font-medium transition-colors',
          pathname.startsWith('/quests') ? 'bg-sunken text-ink' : 'text-ink-3 hover:bg-surface hover:text-ink-2',
        )}
      >
        <Trophy size={20} /> Collectables
      </Link>
      <Link href="/profile" className={cn('mt-auto flex items-center gap-3 rounded-[12px] px-2 py-2 hover:bg-surface', pathname.startsWith('/profile') && 'bg-sunken')}>
        <LevelRing level={v.level} progress={v.progress} size={36} />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{v.name || 'Profile'}</span>
          <span className="block text-xs text-ink-3">Level {v.level}</span>
        </span>
      </Link>
    </aside>
  );
}
