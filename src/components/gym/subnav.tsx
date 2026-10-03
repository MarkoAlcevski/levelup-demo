import { Subnav } from '@/components/page';

export function GymSubnav({ active }: { active: 'overview' | 'program' | 'history' | 'stats' }) {
  return (
    <Subnav
      label="Gym sections"
      active={active}
      tabs={[
        { key: 'overview', href: '/gym', label: 'Overview' },
        { key: 'program', href: '/gym/program', label: 'Program' },
        { key: 'history', href: '/gym/history', label: 'History' },
        { key: 'stats', href: '/gym/stats', label: 'Stats' },
      ]}
    />
  );
}
