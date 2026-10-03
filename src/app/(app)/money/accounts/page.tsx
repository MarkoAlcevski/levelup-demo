import type { Metadata } from 'next';
import { getViewer } from '@/lib/server/context';
import { loadAccounts } from '@/lib/server/money';
import { formatMoney } from '@/lib/engine/money';
import { monthName } from '@/lib/engine/dates';
import { Empty, Page, Section } from '@/components/page';
import { MoneySubnav } from '@/components/money/subnav';
import { AddAccountButton } from '@/components/money/money-client';
import { AccountsList } from '@/components/money/accounts-view';
import { Line } from '@/components/viz/bars';

export const metadata: Metadata = { title: 'Accounts' };

export default async function AccountsPageRoute({ searchParams }: { searchParams: Promise<{ add?: string }> }) {
  const viewer = await getViewer();
  const { add } = await searchParams;
  const d = await loadAccounts(viewer);
  const f = (n: number) => formatMoney(n, d.base, { compact: true });
  if (!d.accounts.length) {
    return (
      <Page title="Accounts" subnav={<MoneySubnav active="accounts" />}>
        <Empty
          title="No accounts yet"
          body="Cash, checking, savings, Wise, Revolut, a broker, a loan — each keeps its own currency, and net worth converts with rates LevelUp shows you."
          action={<AddAccountButton base={d.base} variant="primary" label="Add account" autoOpen={add === '1'} />}
        />
      </Page>
    );
  }
  const trend = d.trend.filter((t, i) => i === d.trend.length - 1 || t.value !== 0);
  return (
    <Page title="Accounts" subnav={<MoneySubnav active="accounts" />} actions={<AddAccountButton base={d.base} autoOpen={add === '1'} />}>
      <section aria-labelledby="nw-h">
        <p id="nw-h" className="label-mono">Net worth</p>
        <p className="mt-1 text-[40px] font-semibold leading-none tracking-[-0.04em] text-ink tnum">{f(d.netWorth)}</p>
        <dl className="mt-5 grid grid-cols-3 gap-x-4 gap-y-4">
          {[
            ['Liquid', d.liquid],
            ['Cash & bank', d.cash],
            ['Investments', d.investments],
            ['Assets', d.assets],
            ['Liabilities', -d.liabilities],
          ].map(([k, v]) => (
            <div key={k as string}>
              <dt className="label-mono">{k}</dt>
              <dd className="mt-1 text-[17px] font-semibold text-ink tnum">{f(v as number)}</dd>
            </div>
          ))}
        </dl>
      </section>
      {trend.length > 1 && (
        <Section title="Net worth over time" aside="month end">
          <Line label="Net worth at each month end" format={(n) => f(n)} points={trend.map((t) => ({ label: monthName(t.month + '-01'), value: t.value }))} />
        </Section>
      )}
      <Section title="Accounts" aside="tap to update a balance">
        <AccountsList data={d} />
      </Section>
      {d.rateNotes.length > 0 && <p className="text-xs text-ink-3">Converted to {d.base} at: {d.rateNotes.join(' · ')}.</p>}
    </Page>
  );
}
