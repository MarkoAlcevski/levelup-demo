import { Subnav } from '@/components/page';

export function MoneySubnav({ active }: { active: 'overview' | 'transactions' | 'accounts' | 'plan' | 'analysis' }) {
  return (
    <Subnav
      label="Money sections"
      active={active}
      tabs={[
        { key: 'overview', href: '/money', label: 'Overview' },
        { key: 'transactions', href: '/money/transactions', label: 'Transactions' },
        { key: 'accounts', href: '/money/accounts', label: 'Accounts' },
        { key: 'plan', href: '/money/plan', label: 'Plan' },
        { key: 'analysis', href: '/money/analysis', label: 'Analysis' },
      ]}
    />
  );
}
