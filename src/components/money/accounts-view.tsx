'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CaretRight } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { formatMoney } from '@/lib/engine/money';
import type { AccountsPage, AccountView } from '@/lib/server/money';
import { archiveAccountAction, reconcileAccountAction, updateAccountAction, valuationAction } from '@/lib/actions';
import { Button, Field, Input, Select, Switch } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Sparkline } from '@/components/viz/marks';
import { useToast } from '@/components/ui/toast';
import { TxList } from './money-client';

export const TYPE_LABEL: Record<string, string> = {
  cash: 'Cash', checking: 'Bank', savings: 'Savings', credit: 'Credit card', investment: 'Brokerage', crypto: 'Crypto',
  business: 'Business', loan: 'Loan', property: 'Property', other: 'Other',
};

export function AccountsList({ data }: { data: AccountsPage }) {
  const [open, setOpen] = useState<string | null>(null);
  const live = data.accounts.filter((a) => !a.archived);
  const archived = data.accounts.filter((a) => a.archived);
  const f = (n: number) => formatMoney(n, data.base, { compact: true });
  const row = (a: AccountView) => (
    <li key={a.id}>
      <button type="button" onClick={() => setOpen(a.id)} className="flex min-h-16 w-full items-center gap-3 py-2.5 text-left">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-medium text-ink">{a.name}</span>
          <span className="block truncate text-[13px] text-ink-3">
            {[TYPE_LABEL[a.type], a.currency, a.institution && a.institution !== a.name ? a.institution : null, !a.includeInNetWorth ? 'not in net worth' : null, a.isLiquid ? 'liquid' : null].filter(Boolean).join(' · ')}
          </span>
        </span>
        <Sparkline values={a.history} width={56} height={24} className="shrink-0" />
        <span className="w-[108px] shrink-0 text-right">
          <span className={cn('block text-[15px] font-semibold tnum', a.native < 0 ? 'text-bad' : 'text-ink')}>{formatMoney(a.native, a.currency, { compact: true })}</span>
          {a.currency !== data.base && a.converted != null && <span className="block text-[12px] text-ink-3 tnum">≈ {f(a.converted)}</span>}
        </span>
        <CaretRight size={14} className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
  const selected = data.accounts.find((a) => a.id === open) ?? null;
  return (
    <>
      <ul className="divide-y divide-line">{live.map(row)}</ul>
      {archived.length > 0 && (
        <details className="mt-2">
          <summary className="label-mono flex min-h-11 cursor-pointer items-center">Archived · {archived.length}</summary>
          <ul className="divide-y divide-line opacity-70">{archived.map(row)}</ul>
        </details>
      )}
      <AccountSheet account={selected} base={data.base} today={data.today} onClose={() => setOpen(null)} />
    </>
  );
}

function AccountSheet({ account: a, base, today, onClose }: { account: AccountView | null; base: string; today: string; onClose: () => void }) {
  const [mode, setMode] = useState<'view' | 'balance' | 'edit'>('view');
  const [actual, setActual] = useState('');
  const [form, setForm] = useState<{ name: string; type: string; institution: string; isLiquid: boolean; includeInNetWorth: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  if (!a) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;
  const close = () => {
    setMode('view');
    setActual('');
    setError(null);
    onClose();
  };
  return (
    <Sheet open onClose={close} title={a.name} description={`${TYPE_LABEL[a.type]} · ${a.currency}`}>
      {mode === 'view' && (
        <div className="flex flex-col gap-5 pt-1">
          <div>
            <p className={cn('text-[36px] font-semibold leading-none tracking-[-0.035em] tnum', a.native < 0 ? 'text-bad' : 'text-ink')}>{formatMoney(a.native, a.currency)}</p>
            {a.currency !== base && a.converted != null && <p className="mt-1 text-[13px] text-ink-3">≈ {formatMoney(a.converted, base)}</p>}
            {a.valued && <p className="mt-1 text-[13px] text-ink-3">{a.lastValuation ? `Value last updated ${formatDay(a.lastValuation, today)}` : 'No value recorded yet'}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => setMode('balance')}>{a.valued ? 'Update value' : 'Update balance'}</Button>
            <Button
              variant="outline"
              onClick={() => {
                setForm({ name: a.name, type: a.type, institution: a.institution ?? '', isLiquid: a.isLiquid, includeInNetWorth: a.includeInNetWorth });
                setMode('edit');
              }}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              loading={pending}
              onClick={() =>
                start(async () => {
                  await archiveAccountAction(a.id, !a.archived);
                  toast.show({ title: a.archived ? 'Account restored' : 'Account archived', detail: a.archived ? undefined : 'Its transactions stay in your history.' });
                  close();
                  router.refresh();
                })
              }
            >
              {a.archived ? 'Unarchive' : 'Archive'}
            </Button>
          </div>
          <section aria-label="Recent transactions">
            <p className="label-mono">Recent</p>
            <TxList items={a.recent} base={base} today={today} showAccount={false} />
          </section>
        </div>
      )}
      {mode === 'balance' && (
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            start(async () => {
              if (a.valued) {
                const r = await valuationAction(a.id, actual);
                if (!r.ok) return setError(r.error);
                toast.show({ title: 'Value updated', detail: 'Net worth uses it from today.' });
              } else {
                const r = await reconcileAccountAction(a.id, actual);
                if (!r.ok) return setError(r.error);
                toast.show(
                  r.diff === 0
                    ? { title: 'Already matches', detail: 'LevelUp’s balance equals your bank’s.' }
                    : { title: 'Balance updated', detail: `Adjustment of ${formatMoney(r.diff, r.currency, { signed: true })} recorded — you can see or delete it in Transactions.` },
                );
              }
              close();
              router.refresh();
            });
          }}
        >
          <p className="text-[14px] text-ink-2">
            {a.valued
              ? 'Enter what it’s worth today. Later transactions add to that value.'
              : `LevelUp shows ${formatMoney(a.native, a.currency)}. Enter the balance your bank or wallet shows now — the difference is recorded as a visible adjustment, never hidden inside past transactions.`}
          </p>
          <Field label={a.valued ? `Value today (${a.currency})` : `Real balance (${a.currency})`} htmlFor="acc-actual" error={error}>
            <Input id="acc-actual" autoFocus inputMode="decimal" value={actual} onChange={(e) => setActual(e.target.value.replace(/[^\d.,-]/g, ''))} className="text-lg font-semibold tnum" />
          </Field>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={!actual}>
              Save
            </Button>
          </div>
        </form>
      )}
      {mode === 'edit' && form && (
        <form
          className="flex flex-col gap-4 pt-1"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await updateAccountAction(a.id, { ...form, institution: form.institution || null });
              if (!r.ok) return setError(r.error);
              close();
              router.refresh();
            });
          }}
        >
          <Field label="Name" htmlFor="ae-name">
            <Input id="ae-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} maxLength={60} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Type" htmlFor="ae-type">
              <Select id="ae-type" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {Object.entries(TYPE_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Institution" htmlFor="ae-inst">
              <Input id="ae-inst" value={form.institution} onChange={(e) => setForm({ ...form, institution: e.target.value })} maxLength={60} />
            </Field>
          </div>
          <Switch checked={form.isLiquid} onChange={(v) => setForm({ ...form, isLiquid: v })} label="Liquid" description="Counts as cash you could spend (used for runway)." />
          <Switch checked={form.includeInNetWorth} onChange={(v) => setForm({ ...form, includeInNetWorth: v })} label="Include in net worth" />
          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setMode('view')}>
              Back
            </Button>
            <Button type="submit" size="lg" className="flex-1" loading={pending}>
              Save
            </Button>
          </div>
        </form>
      )}
    </Sheet>
  );
}
