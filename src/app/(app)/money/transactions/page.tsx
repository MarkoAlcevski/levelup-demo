import type { Metadata } from 'next';
import Link from 'next/link';
import { getViewer } from '@/lib/server/context';
import { loadLedger, type LedgerFilters } from '@/lib/server/money';
import { isISODate } from '@/lib/engine/dates';
import { formatMoney } from '@/lib/engine/money';
import { Page } from '@/components/page';
import { MoneySubnav } from '@/components/money/subnav';
import { LedgerControls } from '@/components/money/ledger-filters';
import { QuickMoney, TxList } from '@/components/money/money-client';

export const metadata: Metadata = { title: 'Transactions' };

const UUID = /^[0-9a-f-]{36}$/i;
const KINDS = ['income', 'expense', 'transfer', 'adjustment'] as const;
const SORTS = ['date_desc', 'date_asc', 'amount_desc', 'amount_asc'] as const;

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const viewer = await getViewer();
  const sp = await searchParams;
  const filters: LedgerFilters = {
    q: sp.q?.slice(0, 80) || null,
    from: isISODate(sp.from) ? sp.from : null,
    to: isISODate(sp.to) ? sp.to : null,
    kind: (KINDS as readonly string[]).includes(sp.kind ?? '') ? (sp.kind as LedgerFilters['kind']) : null,
    accountId: sp.accountId && UUID.test(sp.accountId) ? sp.accountId : null,
    categoryId: sp.categoryId && UUID.test(sp.categoryId) ? sp.categoryId : null,
    tag: sp.tag?.slice(0, 24) || null,
    merchant: sp.merchant?.slice(0, 80) || null,
    sort: (SORTS as readonly string[]).includes(sp.sort ?? '') ? (sp.sort as LedgerFilters['sort']) : 'date_desc',
    page: Math.max(1, Number(sp.page) || 1),
  };
  const d = await loadLedger(viewer, filters);
  const qs = (page: number) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v != null && v !== '' && k !== 'page') p.set(k, String(v));
    p.set('page', String(page));
    return `/money/transactions?${p}`;
  };
  return (
    <Page title="Transactions" subnav={<MoneySubnav active="transactions" />}>
      <QuickMoney />
      <LedgerControls filters={filters} accounts={d.accounts} categories={d.categories} tags={d.tags} />
      <p className="-mt-4 text-[13px] text-ink-3 tnum">
        {d.total.toLocaleString('en-US')} transaction{d.total === 1 ? '' : 's'} · in {formatMoney(d.totals.income, d.base, { compact: true })} · out {formatMoney(d.totals.expenses, d.base, { compact: true })}
        {d.total ? ` (in ${d.base})` : ''}
      </p>
      <div className="-mt-4">
        <TxList items={d.items} base={d.base} today={d.today} showAccount={!filters.accountId} />
      </div>
      {d.pages > 1 && (
        <nav aria-label="Pages" className="flex items-center justify-between">
          {d.page > 1 ? (
            <Link href={qs(d.page - 1)} className="pressable inline-flex h-11 items-center rounded-[12px] border border-line-strong px-4 text-[15px] font-medium text-ink hover:bg-sunken">
              ← Newer
            </Link>
          ) : (
            <span />
          )}
          <span className="text-[13px] text-ink-3 tnum">
            Page {d.page} of {d.pages}
          </span>
          {d.page < d.pages ? (
            <Link href={qs(d.page + 1)} className="pressable inline-flex h-11 items-center rounded-[12px] border border-line-strong px-4 text-[15px] font-medium text-ink hover:bg-sunken">
              Older →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </Page>
  );
}
