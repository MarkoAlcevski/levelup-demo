'use client';

import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowsLeftRight, Minus, Plus } from '@phosphor-icons/react';
import { CategoryIcon } from './category-icon';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { formatMoney, CURRENCIES } from '@/lib/engine/money';
import { createAccountAction } from '@/lib/actions';
import type { TxView } from '@/lib/server/money';
import { Button, Field, Input, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useQuickAdd } from '@/components/shell/quick-add';
import { TransactionSheet } from './transaction-sheet';

/** Expense · Income · Transfer — the three things you do most in Money, one tap away. */
export function QuickMoney() {
  const quick = useQuickAdd();
  return (
    <div className="grid grid-cols-3 gap-2">
      {([
        ['expense', 'Expense', Minus],
        ['income', 'Income', Plus],
        ['transfer', 'Transfer', ArrowsLeftRight],
      ] as const).map(([kind, label, Icon]) => (
        <button
          key={kind}
          type="button"
          onClick={() => quick.open(kind)}
          className={cn(
            'pressable flex h-14 items-center justify-center gap-2 rounded-[14px] text-[15px] font-semibold',
            kind === 'expense' ? 'bg-accent text-accent-ink' : 'border border-line-strong text-ink hover:bg-sunken',
          )}
        >
          <Icon size={18} weight="bold" /> {label}
        </button>
      ))}
    </div>
  );
}

export function LogMoneyButton() {
  const quick = useQuickAdd();
  return (
    <Button size="sm" onClick={() => quick.open('expense')}>
      <Plus size={16} weight="bold" /> Log
    </Button>
  );
}

/** A transaction list; tap a row to open, edit, re-categorise, attach a receipt or delete it. */
export function TxList({ items, base, today, showAccount = true }: { items: TxView[]; base: string; today: string; showAccount?: boolean }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!items.length) return <p className="py-5 text-sm text-ink-3">No transactions here yet.</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {items.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setOpen(t.id)} className="flex min-h-14 w-full items-center gap-3 py-2.5 text-left">
              <span className={cn('grid size-9 shrink-0 place-items-center rounded-full', t.kind === 'income' ? 'bg-good/12 text-good' : t.kind === 'adjustment' ? 'bg-warn/12 text-warn' : 'bg-sunken text-ink-2')}>
                <CategoryIcon slug={t.categorySlug} kind={t.kind} />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">
                  {t.kind === 'transfer' ? `${t.account} → ${t.transferTo ?? t.counterparty ?? 'account'}` : t.kind === 'adjustment' ? 'Balance adjustment' : t.counterparty || t.category || (t.kind === 'income' ? 'Income' : 'Expense')}
                </span>
                <span className="block truncate text-[13px] text-ink-3">
                  {[t.kind === 'transfer' || t.kind === 'adjustment' ? null : t.category, showAccount && t.kind !== 'transfer' ? t.account : null, formatDay(t.on, today), t.receipts ? 'receipt' : null, t.tags.length ? t.tags.map((x) => `#${x}`).join(' ') : null]
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className={cn('block text-[15px] font-medium tnum', t.kind === 'income' ? 'text-good' : 'text-ink')}>
                  {formatMoney(t.kind === 'transfer' ? Math.abs(t.amountMinor) : t.amountMinor, t.currency, { signed: t.kind !== 'transfer' })}
                </span>
                {t.currency !== base && t.converted != null && t.kind !== 'transfer' && <span className="block text-[12px] text-ink-3 tnum">≈ {formatMoney(t.converted, base, { signed: true })}</span>}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <TransactionSheet id={open} onClose={() => setOpen(null)} />
    </>
  );
}

const TYPES = [
  ['checking', 'Bank account'],
  ['savings', 'Savings'],
  ['cash', 'Cash'],
  ['credit', 'Credit card'],
  ['investment', 'Brokerage'],
  ['crypto', 'Crypto'],
  ['business', 'Business'],
  ['loan', 'Loan'],
  ['property', 'Property'],
  ['other', 'Other'],
] as const;

export function AddAccountButton({ base, variant = 'outline', autoOpen = false, label = 'Account' }: { base: string; variant?: 'outline' | 'primary'; autoOpen?: boolean; label?: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(autoOpen), [autoOpen]);
  const [f, setF] = useState({ name: '', type: 'checking', institution: '', currency: base, balance: '' });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <>
      <Button size={variant === 'primary' ? 'md' : 'sm'} variant={variant} onClick={() => setOpen(true)}>
        <Plus size={14} weight="bold" /> {label}
      </Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Add account" description="Cash, a bank, Wise, Revolut, a broker — each in its own currency.">
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createAccountAction(f);
              if (!res.ok) return setError(res.error);
              setOpen(false);
              setF({ name: '', type: 'checking', institution: '', currency: base, balance: '' });
              router.refresh();
            });
          }}
        >
          <Field label="Name" htmlFor="a-name">
            <Input id="a-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Revolut, Cash, Savings…" maxLength={60} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="a-type">
              <Select id="a-type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
                {TYPES.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Currency" htmlFor="a-cur">
              <Select id="a-cur" value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value })}>
                {CURRENCIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Institution" htmlFor="a-inst">
            <Input id="a-inst" value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} placeholder="Optional" maxLength={60} />
          </Field>
          <Field label="Current balance" htmlFor="a-bal" hint={f.type === 'credit' || f.type === 'loan' ? 'Enter what you owe — it’s stored as a negative balance.' : undefined}>
            <Input id="a-bal" inputMode="decimal" value={f.balance} onChange={(e) => setF({ ...f, balance: e.target.value })} placeholder="0" />
          </Field>
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <Button type="submit" size="lg" block loading={pending} disabled={!f.name.trim()}>
            Add account
          </Button>
        </form>
      </Sheet>
    </>
  );
}
