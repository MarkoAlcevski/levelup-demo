'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { cn } from '@/lib/cn';
import { createTransactionAction } from '@/lib/actions';
import type { MoneyFormOptions } from '@/lib/server/money';
import { Button, Chip, Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { useToast } from '@/components/ui/toast';

export type TxKind = 'expense' | 'income' | 'transfer';

export interface MoneyPrefill {
  kind?: TxKind;
  amount?: string;
  counterparty?: string;
  categorySlug?: string;
}

export function MoneyForm({
  options,
  today,
  prefill,
  onDone,
  source = 'quick_add',
}: {
  options: MoneyFormOptions;
  today: string;
  prefill?: MoneyPrefill;
  onDone: () => void;
  source?: 'app' | 'quick_add' | 'command';
}) {
  const [kind, setKind] = useState<TxKind>(prefill?.kind ?? 'expense');
  const [amount, setAmount] = useState(prefill?.amount ?? '');
  const [accountId, setAccountId] = useState(
    (prefill?.kind === 'income' ? options.lastAccountByKind?.income : options.lastAccountByKind?.expense) ?? options.lastAccountId ?? options.accounts[0]?.id ?? '',
  );
  const [toAccountId, setToAccountId] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [counterparty, setCounterparty] = useState(prefill?.counterparty ?? '');
  const [on, setOn] = useState(today);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const toast = useToast();

  const cats = useMemo(() => options.categories.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense')), [options, kind]);
  useEffect(() => {
    const pre = prefill?.categorySlug ? cats.find((c) => c.slug === prefill.categorySlug) : null;
    setCategoryId(pre?.id ?? null);
  }, [kind, cats, prefill?.categorySlug]);
  // remember the account used last for this kind of entry
  useEffect(() => {
    const last = kind === 'income' ? options.lastAccountByKind?.income : kind === 'expense' ? options.lastAccountByKind?.expense : null;
    if (last && options.accounts.some((a) => a.id === last)) setAccountId(last);
  }, [kind, options]);
  const merchants = (options.merchants ?? []).filter((m) => m.kind === (kind === 'income' ? 'income' : 'expense')).slice(0, 6);

  const account = options.accounts.find((a) => a.id === accountId);
  const toAccount = options.accounts.find((a) => a.id === toAccountId);
  const crossCurrency = kind === 'transfer' && toAccount && account && toAccount.currency !== account.currency;

  if (!options.accounts.length) {
    return (
      <div className="rounded-[14px] border border-dashed border-line-strong px-5 py-6 text-center">
        <p className="font-medium text-ink">Add an account first</p>
        <p className="mt-1 text-sm text-ink-3">Money is logged against an account — cash, a bank, Wise, Revolut.</p>
        <a href="/money/accounts?add=1" className="pressable mt-4 inline-flex h-10 items-center rounded-[10px] bg-accent px-4 text-sm font-medium text-accent-ink">
          Add account
        </a>
      </div>
    );
  }

  function submit() {
    setError(null);
    start(async () => {
      const res = await createTransactionAction({
        kind,
        amount,
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId || null : null,
        toAmount: crossCurrency ? toAmount : null,
        categoryId: kind === 'transfer' ? null : categoryId,
        counterparty: counterparty || null,
        note: note || null,
        on,
        source,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const cat = cats.find((c) => c.id === categoryId)?.name;
      toast.show({
        title: kind === 'expense' ? `Logged ${amount} ${account?.currency ?? ''}` : kind === 'income' ? `Income logged · ${amount} ${account?.currency ?? ''}` : 'Transfer logged',
        detail: [cat, counterparty].filter(Boolean).join(' · ') || undefined,
      });
      onDone();
    });
  }

  return (
    <form
      className="flex flex-col gap-5 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <Segmented
        label="Type"
        value={kind}
        onChange={setKind}
        options={[
          { value: 'expense', label: 'Expense' },
          { value: 'income', label: 'Income' },
          { value: 'transfer', label: 'Transfer' },
        ]}
      />

      <label className="flex items-baseline gap-3 border-b border-line-strong pb-2 focus-within:border-accent-text">
        <span className="sr-only">Amount</span>
        <span className="text-2xl font-medium text-ink-3">{kind === 'expense' ? '−' : kind === 'income' ? '+' : ''}</span>
        <input
          autoFocus
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))}
          placeholder="0"
          className="tnum min-w-0 flex-1 bg-transparent text-[44px] font-semibold tracking-[-0.03em] text-ink outline-none placeholder:text-ink-3/60"
          aria-label="Amount"
        />
        <span className="font-mono text-sm text-ink-3">{account?.currency}</span>
      </label>

      {kind !== 'transfer' && (
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-medium text-ink-2">Category</span>
          <div className="flex flex-wrap gap-2">
            {cats.slice(0, 8).map((c) => (
              <Chip key={c.id} selected={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? null : c.id)}>
                {c.name}
              </Chip>
            ))}
            {cats.length > 8 && (
              <select
                aria-label="More categories"
                value={cats.slice(8).some((c) => c.id === categoryId) ? categoryId! : ''}
                onChange={(e) => setCategoryId(e.target.value || null)}
                className="h-9 rounded-full border border-line-strong bg-transparent px-3 text-sm text-ink-2"
              >
                <option value="">More…</option>
                {cats.slice(8).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      )}

      <div className={cn('grid gap-3', kind === 'transfer' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-2')}>
        <Field label={kind === 'transfer' ? 'From' : 'Account'} htmlFor="tx-acct">
          <Select id="tx-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {options.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'transfer' ? (
          <Field label="To" htmlFor="tx-to">
            <Select id="tx-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              <option value="">Choose account</option>
              {options.accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Date" htmlFor="tx-date">
            <Input id="tx-date" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value || today)} />
          </Field>
        )}
      </div>

      {crossCurrency && (
        <Field label={`Arrived as (${toAccount!.currency})`} htmlFor="tx-toamt" hint="Enter what actually landed — LevelUp never assumes an exchange rate for your transfers.">
          <Input id="tx-toamt" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} placeholder="0" />
        </Field>
      )}

      {kind !== 'transfer' && merchants.length > 0 && !counterparty && (
        <div className="-mb-2 flex flex-wrap gap-1.5" aria-label="Recent">
          {merchants.map((m) => (
            <button
              key={m.name}
              type="button"
              onClick={() => {
                setCounterparty(m.name);
                if (m.categoryId) setCategoryId(m.categoryId);
              }}
              className="pressable h-8 rounded-full bg-sunken px-3 text-[13px] text-ink-2 hover:text-ink"
            >
              {m.name}
            </button>
          ))}
        </div>
      )}
      {kind !== 'transfer' && (
        <Field label={kind === 'income' ? 'Source' : 'Where'} htmlFor="tx-cp">
          <Input id="tx-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={80} placeholder={kind === 'income' ? 'Client or employer' : 'Merchant (optional)'} />
        </Field>
      )}

      {kind === 'transfer' && (
        <Field label="Date" htmlFor="tx-date2">
          <Input id="tx-date2" type="date" value={on} max={today} onChange={(e) => setOn(e.target.value || today)} />
        </Field>
      )}

      <Field label="Note" htmlFor="tx-note">
        <Input id="tx-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Optional" />
      </Field>

      {error && (
        <p className="text-sm text-bad" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" block loading={pending} disabled={!amount || (kind === 'transfer' && !toAccountId)}>
        {kind === 'expense' ? 'Log expense' : kind === 'income' ? 'Log income' : 'Log transfer'}
      </Button>
    </form>
  );
}
