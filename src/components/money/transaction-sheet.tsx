'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { FilePdf, Paperclip, PencilSimple, Trash, X } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay, weekdayName } from '@/lib/engine/dates';
import { exponent, formatMoney } from '@/lib/engine/money';
import type { MoneyFormOptions, TxDetail } from '@/lib/server/money';
import { deleteTransactionAction, moneyFormAction, transactionDetailAction, updateTransactionAction } from '@/lib/actions';
import { compressImage } from '@/lib/client/api';
import { Button, Field, Input, Segmented, Select } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';

function major(minor: number, currency: string): string {
  const e = exponent(currency);
  return (Math.abs(minor) / 10 ** e).toFixed(e);
}

/** Open a transaction: see it, correct it, attach a receipt, or delete it. */
export function TransactionSheet({ id, onClose }: { id: string | null; onClose: () => void }) {
  const [tx, setTx] = useState<TxDetail | null>(null);
  const [opts, setOpts] = useState<MoneyFormOptions | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const toast = useToast();

  const reload = async (txId: string) => setTx(await transactionDetailAction(txId));
  useEffect(() => {
    setTx(null);
    setEditing(false);
    setConfirmDelete(false);
    setError(null);
    if (!id) return;
    void reload(id);
    void moneyFormAction().then(setOpts);
  }, [id]);

  async function attach(file: File) {
    if (!tx) return;
    setUploading(true);
    const blob = file.type.startsWith('image/') ? await compressImage(file) : file;
    const form = new FormData();
    form.set('transactionId', tx.transferLegs.length ? tx.id : tx.id);
    form.set('file', blob, file.name || 'receipt');
    const res = await fetch('/api/v1/receipts', { method: 'POST', body: form }).then((r) => r.json()).catch(() => ({ ok: false, error: 'You’re offline — try again when connected.' }));
    setUploading(false);
    if (!res.ok) return toast.show({ title: res.error, tone: 'error' });
    toast.show({ title: 'Receipt attached' });
    await reload(tx.id);
    router.refresh();
  }

  const title = tx
    ? tx.kind === 'transfer' ? 'Transfer' : tx.kind === 'adjustment' ? 'Balance adjustment' : tx.counterparty || tx.category || (tx.kind === 'income' ? 'Income' : 'Expense')
    : 'Transaction';

  return (
    <Sheet open={!!id} onClose={onClose} title={editing ? 'Edit transaction' : title}>
      {!tx || !opts ? (
        <div className="h-48 animate-pulse rounded-[14px] bg-sunken" aria-label="Loading" />
      ) : editing ? (
        <EditForm
          tx={tx}
          opts={opts}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await reload(tx.id);
            router.refresh();
            toast.show({ title: 'Transaction updated' });
          }}
        />
      ) : (
        <div className="flex flex-col gap-5 pt-1">
          <div>
            <p className={cn('text-[40px] font-semibold leading-none tracking-[-0.035em] tnum', tx.kind === 'income' ? 'text-good' : 'text-ink')}>
              {formatMoney(tx.kind === 'transfer' ? Math.abs(tx.amountMinor) : tx.amountMinor, tx.currency, { signed: tx.kind !== 'transfer' })}
            </p>
            {tx.originalCurrency && tx.originalAmountMinor != null && <p className="mt-1 text-[13px] text-ink-3">Charged as {formatMoney(tx.originalAmountMinor, tx.originalCurrency)}</p>}
            {tx.currency !== opts.base && tx.converted != null && tx.kind !== 'transfer' && <p className="mt-1 text-[13px] text-ink-3">≈ {formatMoney(tx.converted, opts.base, { signed: true })} at that day’s rate</p>}
          </div>
          <dl className="grid grid-cols-[7rem_1fr] gap-x-4 gap-y-2.5 text-[15px]">
            <dt className="text-ink-3">Date</dt>
            <dd className="text-ink">{weekdayName(tx.on, true)}, {formatDay(tx.on, opts.accounts.length ? tx.on : undefined)}</dd>
            {tx.kind === 'transfer' ? (
              tx.transferLegs.map((l) => (
                <div key={l.accountId} className="contents">
                  <dt className="text-ink-3">{l.amountMinor < 0 ? 'From' : 'To'}</dt>
                  <dd className="text-ink tnum">
                    {l.account} · {formatMoney(Math.abs(l.amountMinor), l.currency)}
                  </dd>
                </div>
              ))
            ) : (
              <>
                <dt className="text-ink-3">Account</dt>
                <dd className="text-ink">{tx.account}</dd>
                {tx.kind !== 'adjustment' && (
                  <>
                    <dt className="text-ink-3">Category</dt>
                    <dd className="text-ink">{tx.category ?? 'Uncategorised'}</dd>
                    <dt className="text-ink-3">{tx.kind === 'income' ? 'Source' : 'Merchant'}</dt>
                    <dd className="text-ink">{tx.counterparty ?? '—'}</dd>
                  </>
                )}
              </>
            )}
            {tx.note && (
              <>
                <dt className="text-ink-3">Note</dt>
                <dd className="whitespace-pre-line text-ink">{tx.note}</dd>
              </>
            )}
            {tx.tags.length > 0 && (
              <>
                <dt className="text-ink-3">Tags</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {tx.tags.map((t) => (
                    <span key={t} className="rounded-full bg-sunken px-2.5 py-0.5 text-[13px] text-ink-2">
                      #{t}
                    </span>
                  ))}
                </dd>
              </>
            )}
            {tx.earned && (
              <>
                <dt className="text-ink-3">Reward</dt>
                <dd className="text-ink">Earned spending — redeemed with points</dd>
              </>
            )}
          </dl>

          <section aria-label="Receipts" className="flex flex-col gap-2">
            <p className="label-mono">Receipts</p>
            {tx.receiptFiles.length > 0 && (
              <ul className="flex flex-wrap gap-2">
                {tx.receiptFiles.map((r) => (
                  <li key={r.id} className="relative">
                    <a href={r.fullUrl} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-[10px] border border-line bg-sunken">
                      {r.thumbUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={r.thumbUrl} alt="Receipt" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center text-ink-3">
                          <FilePdf size={26} />
                        </span>
                      )}
                    </a>
                    <button
                      type="button"
                      aria-label="Remove receipt"
                      onClick={async () => {
                        await fetch(`/api/v1/receipts?id=${r.id}`, { method: 'DELETE' });
                        await reload(tx.id);
                      }}
                      className="absolute -top-2 -right-2 grid size-7 place-items-center rounded-full border border-line-strong bg-raised text-ink-3 hover:text-bad"
                    >
                      <X size={12} weight="bold" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <input ref={fileRef} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} onChange={(e) => e.target.files?.[0] && void attach(e.target.files[0])} />
            <Button variant="outline" onClick={() => fileRef.current?.click()} loading={uploading} className="self-start">
              <Paperclip size={16} /> Attach photo or PDF
            </Button>
            <p className="text-[12px] text-ink-3">Stored privately. Nothing is read from it automatically.</p>
          </section>

          {error && <p className="text-sm text-bad" role="alert">{error}</p>}
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setEditing(true)}>
              <PencilSimple size={16} /> Edit
            </Button>
            {confirmDelete ? (
              <Button
                variant="danger"
                className="flex-1"
                loading={pending}
                onClick={() =>
                  start(async () => {
                    const r = await deleteTransactionAction(tx.id);
                    if (!r.ok) return setError(r.error);
                    toast.show({ title: 'Transaction deleted' });
                    onClose();
                  })
                }
              >
                Delete{tx.kind === 'transfer' ? ' both sides' : ''}
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                <Trash size={16} /> Delete
              </Button>
            )}
          </div>
        </div>
      )}
    </Sheet>
  );
}

function EditForm({ tx, opts, onCancel, onSaved }: { tx: TxDetail; opts: MoneyFormOptions; onCancel: () => void; onSaved: () => void }) {
  const out = tx.transferLegs.find((l) => l.amountMinor < 0);
  const inn = tx.transferLegs.find((l) => l.amountMinor > 0);
  const [kind, setKind] = useState(tx.kind);
  const [amount, setAmount] = useState(major(tx.kind === 'transfer' ? out?.amountMinor ?? tx.amountMinor : tx.amountMinor, tx.kind === 'transfer' ? out?.currency ?? tx.currency : tx.currency));
  const [accountId, setAccountId] = useState(tx.kind === 'transfer' ? out?.accountId ?? tx.accountId : tx.accountId);
  const [toAccountId, setToAccountId] = useState(inn?.accountId ?? '');
  const [toAmount, setToAmount] = useState(inn ? major(inn.amountMinor, inn.currency) : '');
  const [categoryId, setCategoryId] = useState(tx.categoryId ?? '');
  const [counterparty, setCounterparty] = useState(tx.counterparty ?? '');
  const [on, setOn] = useState(tx.on);
  const [note, setNote] = useState(tx.note ?? '');
  const [tags, setTags] = useState(tx.tags.join(', '));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const from = opts.accounts.find((a) => a.id === accountId);
  const to = opts.accounts.find((a) => a.id === toAccountId);
  const cats = opts.categories.filter((c) => c.kind === (kind === 'income' ? 'income' : 'expense'));
  return (
    <form
      className="flex flex-col gap-4 pt-1"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const res = await updateTransactionAction(tx.id, {
            kind,
            amount: kind === 'adjustment' && tx.amountMinor < 0 && !amount.startsWith('-') ? `-${amount}` : amount,
            accountId,
            toAccountId: kind === 'transfer' ? toAccountId : null,
            toAmount: kind === 'transfer' && to && from && to.currency !== from.currency ? toAmount : null,
            categoryId: kind === 'expense' || kind === 'income' ? categoryId || null : null,
            counterparty: counterparty || null,
            note: note || null,
            tags: tags.split(',').map((t) => t.trim().replace(/^#/, '')).filter(Boolean).slice(0, 12),
            on,
          });
          if (!res.ok) return setError(res.error);
          onSaved();
        });
      }}
    >
      {(tx.kind === 'expense' || tx.kind === 'income') && (
        <Segmented label="Type" value={kind as 'expense' | 'income'} onChange={setKind} options={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} />
      )}
      <Field label={`Amount (${from?.currency ?? tx.currency})`} htmlFor="te-amt">
        <Input id="te-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,-]/g, ''))} className="text-lg font-semibold tnum" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label={kind === 'transfer' ? 'From' : 'Account'} htmlFor="te-acct">
          <Select id="te-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {opts.accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </Select>
        </Field>
        {kind === 'transfer' ? (
          <Field label="To" htmlFor="te-to">
            <Select id="te-to" value={toAccountId} onChange={(e) => setToAccountId(e.target.value)}>
              {opts.accounts.filter((a) => a.id !== accountId).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Date" htmlFor="te-date">
            <Input id="te-date" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
          </Field>
        )}
      </div>
      {kind === 'transfer' && to && from && to.currency !== from.currency && (
        <Field label={`Arrived as (${to.currency})`} htmlFor="te-toamt">
          <Input id="te-toamt" inputMode="decimal" value={toAmount} onChange={(e) => setToAmount(e.target.value)} />
        </Field>
      )}
      {kind === 'transfer' && (
        <Field label="Date" htmlFor="te-date2">
          <Input id="te-date2" type="date" value={on} onChange={(e) => setOn(e.target.value)} />
        </Field>
      )}
      {(kind === 'expense' || kind === 'income') && (
        <>
          <Field label="Category" htmlFor="te-cat">
            <Select id="te-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorised</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={kind === 'income' ? 'Source' : 'Merchant'} htmlFor="te-cp">
            <Input id="te-cp" value={counterparty} onChange={(e) => setCounterparty(e.target.value)} maxLength={80} />
          </Field>
        </>
      )}
      <Field label="Note" htmlFor="te-note">
        <Input id="te-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
      </Field>
      <Field label="Tags" htmlFor="te-tags" hint="Comma separated, e.g. trip, work">
        <Input id="te-tags" value={tags} onChange={(e) => setTags(e.target.value)} />
      </Field>
      {error && <p className="text-sm text-bad" role="alert">{error}</p>}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={!amount}>
          Save changes
        </Button>
      </div>
    </form>
  );
}
