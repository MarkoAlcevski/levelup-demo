'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Funnel, MagnifyingGlass, X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import type { LedgerFilters } from '@/lib/server/money';
import { Button, Field, Input, Select } from '@/components/ui/primitives';

/** Search + filters for the ledger, kept in the URL so every view is shareable and reloadable. */
export function LedgerControls({
  filters,
  accounts,
  categories,
  tags,
}: {
  filters: LedgerFilters;
  accounts: { id: string; name: string; currency: string }[];
  categories: { id: string; name: string; kind: 'income' | 'expense' }[];
  tags: string[];
}) {
  const router = useRouter();
  const [q, setQ] = useState(filters.q ?? '');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(filters);
  const push = (next: LedgerFilters) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v != null && v !== '' && k !== 'page') p.set(k, String(v));
    router.push(`/money/transactions${p.toString() ? `?${p}` : ''}`);
  };
  const active = [filters.kind, filters.accountId, filters.categoryId, filters.tag, filters.merchant, filters.from, filters.to].filter(Boolean).length;

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          push({ ...filters, q });
        }}
      >
        <label className="relative flex-1">
          <span className="sr-only">Search transactions</span>
          <MagnifyingGlass size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Merchant, note, category, #tag" className="pl-10" enterKeyHint="search" />
        </label>
        <Button type="button" variant={active ? 'primary' : 'outline'} size="lg" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="Filters">
          <Funnel size={18} /> {active || ''}
        </Button>
      </form>
      {open && (
        <div className="grid grid-cols-2 gap-3 rounded-[16px] border border-line p-3">
          <Field label="Type" htmlFor="lf-kind">
            <Select id="lf-kind" value={f.kind ?? ''} onChange={(e) => setF({ ...f, kind: (e.target.value || null) as LedgerFilters['kind'] })}>
              <option value="">All</option>
              <option value="expense">Expenses</option>
              <option value="income">Income</option>
              <option value="transfer">Transfers</option>
              <option value="adjustment">Adjustments</option>
            </Select>
          </Field>
          <Field label="Account" htmlFor="lf-acct">
            <Select id="lf-acct" value={f.accountId ?? ''} onChange={(e) => setF({ ...f, accountId: e.target.value || null })}>
              <option value="">All</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="lf-cat">
            <Select id="lf-cat" value={f.categoryId ?? ''} onChange={(e) => setF({ ...f, categoryId: e.target.value || null })}>
              <option value="">All</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.kind === 'income' ? ' (income)' : ''}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Tag" htmlFor="lf-tag">
            <Select id="lf-tag" value={f.tag ?? ''} onChange={(e) => setF({ ...f, tag: e.target.value || null })}>
              <option value="">All</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  #{t}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" htmlFor="lf-from">
            <Input id="lf-from" type="date" value={f.from ?? ''} onChange={(e) => setF({ ...f, from: e.target.value || null })} />
          </Field>
          <Field label="To" htmlFor="lf-to">
            <Input id="lf-to" type="date" value={f.to ?? ''} onChange={(e) => setF({ ...f, to: e.target.value || null })} />
          </Field>
          <Field label="Merchant / source" htmlFor="lf-m" className="col-span-2">
            <Input id="lf-m" value={f.merchant ?? ''} onChange={(e) => setF({ ...f, merchant: e.target.value || null })} placeholder="Exact name" />
          </Field>
          <Field label="Sort" htmlFor="lf-sort" className="col-span-2">
            <Select id="lf-sort" value={f.sort ?? 'date_desc'} onChange={(e) => setF({ ...f, sort: e.target.value as LedgerFilters['sort'] })}>
              <option value="date_desc">Newest first</option>
              <option value="date_asc">Oldest first</option>
              <option value="amount_desc">Largest first</option>
              <option value="amount_asc">Smallest first</option>
            </Select>
          </Field>
          <div className="col-span-2 flex gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setF({});
                setQ('');
                push({});
              }}
            >
              <X size={14} /> Clear
            </Button>
            <Button className="flex-1" onClick={() => { setOpen(false); push({ ...f, q }); }}>
              Show results
            </Button>
          </div>
        </div>
      )}
      {active > 0 && !open && (
        <div className="flex flex-wrap gap-1.5">
          {[
            filters.kind && `Type: ${filters.kind}`,
            filters.accountId && `Account: ${accounts.find((a) => a.id === filters.accountId)?.name ?? '…'}`,
            filters.categoryId && `Category: ${categories.find((c) => c.id === filters.categoryId)?.name ?? '…'}`,
            filters.tag && `#${filters.tag}`,
            filters.merchant && filters.merchant,
            filters.from && `from ${filters.from}`,
            filters.to && `to ${filters.to}`,
          ]
            .filter(Boolean)
            .map((l) => (
              <span key={l as string} className={cn('rounded-full bg-sunken px-3 py-1 text-[13px] text-ink-2')}>
                {l}
              </span>
            ))}
        </div>
      )}
    </div>
  );
}
