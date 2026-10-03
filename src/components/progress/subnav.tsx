'use client';

import { usePathname } from 'next/navigation';
import { Subnav } from '@/components/page';

const TABS = [
  { href: '/progress', label: 'Overview', key: 'overview' },
  { href: '/journal', label: 'Journal', key: 'journal' },
  { href: '/progress/reports', label: 'Reports', key: 'reports' },
  { href: '/progress/evidence', label: 'Evidence', key: 'evidence' },
];

/** Progress · Journal · Reports · Evidence — the Progress tab's four views. */
export function ProgressSubnav() {
  const pathname = usePathname();
  const active = pathname.startsWith('/journal')
    ? 'journal'
    : pathname.startsWith('/progress/reports') || pathname.startsWith('/review')
      ? 'reports'
      : pathname.startsWith('/progress/evidence')
        ? 'evidence'
        : 'overview';
  return <Subnav tabs={TABS} active={active} label="Progress sections" />;
}
