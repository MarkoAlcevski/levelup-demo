'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { CaretRight, Plus } from '@phosphor-icons/react';
import { cn } from '@/lib/cn';
import { formatDay } from '@/lib/engine/dates';
import { CURRENCIES, exponent, formatMoney } from '@/lib/engine/money';
import type { MoneyPlanPage, SeriesView, TargetView, BudgetView } from '@/lib/server/money-plan';
import {
  archiveTargetAction, recurringStatusAction, removeBudgetAction, saveBudgetAction, saveMonthPlanAction, saveRecurringAction, saveTargetAction,
} from '@/lib/actions';
import { Button, Chip, Field, Input, Segmented, Select, Switch } from '@/components/ui/primitives';
import { Sheet } from '@/components/ui/sheet';
import { Meter } from '@/components/viz/marks';
import { useToast } from '@/components/ui/toast';

const CADENCE: Record<string, string> = { week: 'weekly', month: 'monthly', quarter: 'quarterly', year: 'yearly' };
const VERDICT: Record<string, string> = { essential: 'Essential', useful: 'Useful', questionable: 'Questionable', cancel: 'Cancel' };
const TARGET_KIND: Record<string, { label: string; hint: string }> = {
  income: { label: 'Monthly income', hint: 'Income logged this calendar month.' },
  savings: { label: 'Monthly savings', hint: 'Income minus spending this calendar month.' },
  investment: { label: 'Monthly investing', hint: 'Money moved into investment or crypto accounts this month.' },
  spending_ceiling: { label: 'Spending ceiling', hint: 'Total spending this calendar month stays under this.' },
  emergency_fund: { label: 'Emergency fund', hint: 'Balance of one account (or all liquid cash).' },
  net_worth: { label: 'Net worth', hint: 'Everything you own minus everything you owe.' },
  debt_payoff: { label: 'Pay off a debt', hint: 'Progress from what you owe today down to zero.' },
};

function major(minor: number, currency: string): string {
  const e = exponent(currency);
  return (minor / 10 ** e).toFixed(e).replace(/\.0+$/, '');
}

export function PlanView({ data }: { data: MoneyPlanPage }) {
  const [planOpen, setPlanOpen] = useState(false);
  const [budget, setBudget] = useState<BudgetView | 'new' | null>(null);
  const [target, setTarget] = useState<TargetView | 'new' | null>(null);
  const [series, setSeries] = useState<SeriesView | { kind: 'income' | 'expense'; isSubscription: boolean } | null>(null);
  const base = data.base;
  const f = (n: number, o: { signed?: boolean } = {}) => formatMoney(n, base, { compact: true, ...o });
  const p = data.plan;
  const rows: [string, number, number, boolean][] = [
    ['Income', p.planned.income, p.actual.income, true],
    ['Spending', p.planned.spending, p.actual.spending, false],
    ['Saved', p.planned.savings, p.actual.savings, true],
    ['Invested', p.planned.investments, p.actual.investments, true],
  ];

  return (
    <>
      {/* the month */}
      <section aria-labelledby="plan-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="plan-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">This month</h2>
          <Button size="sm" variant="ghost" onClick={() => setPlanOpen(true)}>
            Edit plan
          </Button>
        </div>
        <div className="overflow-hidden rounded-[16px] border border-line">
          <div className="grid grid-cols-[1fr_auto_auto] gap-x-4 border-b border-line bg-sunken/40 px-4 py-2 font-mono text-[10px] uppercase tracking-[0.08em] text-ink-3">
            <span />
            <span className="w-20 text-right">Planned</span>
            <span className="w-20 text-right">So far</span>
          </div>
          {rows.map(([label, planned, actual]) => (
            <div key={label} className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 border-b border-line px-4 py-2.5 last:border-0">
              <span className="text-[15px] text-ink-2">{label}</span>
              <span className="w-20 text-right text-[15px] text-ink-3 tnum">{planned ? f(planned) : '—'}</span>
              <span className="w-20 text-right text-[15px] font-semibold text-ink tnum">{f(actual)}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto_auto] items-baseline gap-x-4 bg-sunken/40 px-4 py-3">
            <span className="text-[15px] font-medium text-ink">Left over</span>
            <span className="w-20 text-right text-[15px] text-ink-3 tnum">{p.hasPlan ? f(p.planned.remaining, { signed: true }) : '—'}</span>
            <span className={cn('w-20 text-right text-[15px] font-semibold tnum', p.actual.remaining < 0 ? 'text-bad' : 'text-ink')}>{f(p.actual.remaining, { signed: true })}</span>
          </div>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {Math.round(p.elapsed * 100)}% of the month has passed. Planned = recurring items + what you expect + your budgets. {p.hasPlan ? '' : 'Add recurring items, budgets or a plan to compare against.'}
        </p>
      </section>

      {/* targets */}
      <section aria-labelledby="targets-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="targets-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Targets</h2>
          <Button size="sm" variant="ghost" onClick={() => setTarget('new')}>
            <Plus size={14} weight="bold" /> Target
          </Button>
        </div>
        {data.targets.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.targets.map((t) => (
              <li key={t.id}>
                <button type="button" onClick={() => setTarget(t)} className="flex w-full flex-col gap-2 py-3 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-[15px] font-medium text-ink">{t.title}</span>
                    <span className="shrink-0 text-[13px] text-ink-3 tnum">
                      {formatMoney(t.current, t.currency, { compact: true })} / {formatMoney(t.target, t.currency, { compact: true })}
                    </span>
                  </span>
                  <Meter value={Math.min(1, t.progress)} tone={t.over ? 'bad' : 'accent'} label={`${Math.round(t.progress * 100)}%`} />
                  <span className="text-[13px] text-ink-3">{targetLine(t)}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Income, savings, an emergency fund, net worth, a debt — set a number you chose and see the arithmetic.</p>
        )}
      </section>

      {/* budgets */}
      <section aria-labelledby="budgets-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="budgets-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Budgets</h2>
          <Button size="sm" variant="ghost" onClick={() => setBudget('new')}>
            <Plus size={14} weight="bold" /> Budget
          </Button>
        </div>
        {data.budgets.length ? (
          <ul className="flex flex-col divide-y divide-line">
            {data.budgets.map((b) => (
              <li key={b.id}>
                <button type="button" onClick={() => setBudget(b)} className="flex w-full flex-col gap-2 py-3 text-left">
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-[15px] font-medium text-ink">{b.name}</span>
                    <span className={cn('text-[13px] tnum', b.status === 'over' ? 'text-bad' : b.status === 'pace_over' ? 'text-warn' : 'text-ink-3')}>
                      {Math.round(b.used * 100)}% used
                    </span>
                  </span>
                  <span className="relative block">
                    <Meter value={Math.min(1, b.used)} tone={b.status === 'over' ? 'bad' : b.status === 'pace_over' ? 'warn' : 'accent'} label={`${Math.round(b.used * 100)}% of budget used`} />
                    <span className="absolute -top-1 -bottom-1 w-[2px] rounded-full bg-ink-2" style={{ left: `calc(${Math.min(1, b.elapsed) * 100}% - 1px)` }} title="How much of the month has passed" />
                  </span>
                  <span className="text-[13px] text-ink-3">
                    {formatMoney(b.spent, b.currency, { compact: true })} of {formatMoney(b.amount, b.currency, { compact: true })} used with {b.daysLeft} day{b.daysLeft === 1 ? '' : 's'} left
                    {b.status !== 'over' && b.projected > b.amount ? ` · at this pace, ${formatMoney(b.projected, b.currency, { compact: true })} by month end` : ''}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">An overall monthly spending budget, or one per category — Restaurants, Entertainment, Travel.</p>
        )}
      </section>

      {/* recurring */}
      <section aria-labelledby="rec-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="rec-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Recurring</h2>
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => setSeries({ kind: 'income', isSubscription: false })}>
              <Plus size={14} weight="bold" /> Income
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSeries({ kind: 'expense', isSubscription: false })}>
              <Plus size={14} weight="bold" /> Bill
            </Button>
          </div>
        </div>
        {[...data.income, ...data.bills].length ? (
          <ul className="divide-y divide-line">
            {[...data.income, ...data.bills].map((s) => (
              <SeriesRow key={s.id} s={s} base={base} onOpen={() => setSeries(s)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Salary, retainers, rent, insurance — anything that repeats.</p>
        )}
      </section>

      {/* subscriptions */}
      <section aria-labelledby="subs-h">
        <div className="mb-2 flex items-baseline justify-between">
          <div>
            <h2 id="subs-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Subscriptions</h2>
            {data.subscriptions.length > 0 && (
              <p className="text-[13px] text-ink-3 tnum">
                {f(data.subscriptionTotals.monthly)} a month · {f(data.subscriptionTotals.annual)} a year
              </p>
            )}
          </div>
          <Button size="sm" variant="ghost" onClick={() => setSeries({ kind: 'expense', isSubscription: true })}>
            <Plus size={14} weight="bold" /> Subscription
          </Button>
        </div>
        {data.subscriptions.length ? (
          <ul className="divide-y divide-line">
            {data.subscriptions.map((s) => (
              <SeriesRow key={s.id} s={s} base={base} onOpen={() => setSeries(s)} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-3">Track what renews, when, and your own verdict on each one.</p>
        )}
        {data.subscriptionTotals.byVerdict.cancel + data.subscriptionTotals.byVerdict.questionable > 0 && (
          <p className="mt-2 text-[12px] text-ink-3">You marked {f((data.subscriptionTotals.byVerdict.cancel + data.subscriptionTotals.byVerdict.questionable) * 12)} a year as questionable or cancel.</p>
        )}
      </section>

      {/* projection */}
      <section aria-labelledby="proj-h">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 id="proj-h" className="text-[17px] font-semibold tracking-[-0.015em] text-ink">Cash-flow projection</h2>
          <span className="text-[13px] text-ink-3">projection, not a prediction</span>
        </div>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-[12px] bg-sunken px-2.5 py-2">
            <dt className="label-mono">Today</dt>
            <dd className="mt-0.5 truncate text-[15px] font-semibold text-ink tnum">{f(data.projection.start)}</dd>
          </div>
          {data.projection.at.map((a) => (
            <div key={a.days} className="rounded-[12px] bg-sunken px-2.5 py-2">
              <dt className="label-mono">+{a.days} d</dt>
              <dd className={cn('mt-0.5 truncate text-[15px] font-semibold tnum', a.balance < 0 ? 'text-bad' : 'text-ink')}>{f(a.balance)}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-2 text-[12px] leading-5 text-ink-3">
          Liquid cash today, plus recurring income, minus recurring bills and subscriptions
          {data.projection.budgetPerDay ? `, minus your budgets spread evenly (${f(data.projection.budgetPerDay)} a day)` : ' (no budgets set, so day-to-day spending isn’t included)'}. Lowest point: {f(data.projection.lowest.balance)} on {formatDay(data.projection.lowest.day)}.
        </p>
        {data.projection.upcoming.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {data.projection.upcoming.slice(0, 6).map((u, i) => (
              <li key={i} className="flex items-center justify-between py-2 text-[14px]">
                <span className="text-ink-2">
                  <span className="mr-2 font-mono text-[11px] uppercase text-ink-3">{formatDay(u.on)}</span>
                  {u.name}
                </span>
                <span className={cn('tnum', u.amount > 0 ? 'text-good' : 'text-ink')}>{f(u.amount, { signed: true })}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <PlanSheet open={planOpen} onClose={() => setPlanOpen(false)} data={data} />
      <BudgetSheet budget={budget} onClose={() => setBudget(null)} data={data} />
      <TargetSheet target={target} onClose={() => setTarget(null)} data={data} />
      <SeriesSheet series={series} onClose={() => setSeries(null)} data={data} />
    </>
  );
}

function targetLine(t: TargetView): string {
  const m = (n: number) => formatMoney(n, t.currency, { compact: true });
  if (t.kind === 'spending_ceiling') {
    return t.over ? `Over the ceiling by ${m(t.current - t.target)}.` : `${m(t.remaining)} left with ${t.daysLeft ?? 0} days to go${t.perDay ? ` — ${m(t.perDay)} a day if spread evenly` : ''}.`;
  }
  if (t.kind === 'debt_payoff') return t.met ? 'Paid off.' : `${m(t.remaining)} still owed${t.daysLeft != null ? ` · ${t.daysLeft} days to the date you set` : ''}.`;
  if (t.met) return t.monthly ? 'Reached this month.' : 'Reached.';
  return `${m(t.remaining)} to go${t.daysLeft != null ? ` · ${t.daysLeft} days left${t.perDay ? ` · ${m(t.perDay)} a day, as plain arithmetic` : ''}` : ''}.`;
}

function SeriesRow({ s, base, onOpen }: { s: SeriesView; base: string; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className={cn('flex min-h-14 w-full items-center gap-3 py-2.5 text-left', s.status !== 'active' && 'opacity-60')}>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] text-ink">
            {s.name}
            {s.status === 'paused' && <span className="ml-2 font-mono text-[10px] uppercase text-ink-3">paused</span>}
            {s.verdict && <span className={cn('ml-2 font-mono text-[10px] uppercase', s.verdict === 'cancel' ? 'text-bad' : s.verdict === 'questionable' ? 'text-warn' : 'text-ink-3')}>{VERDICT[s.verdict]}</span>}
          </span>
          <span className="block text-[13px] text-ink-3">
            {CADENCE[s.cadence]}
            {s.intervalCount > 1 ? ` ×${s.intervalCount}` : ''}
            {s.due ? ` · next ${formatDay(s.due)}` : ''}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className={cn('block text-[15px] font-medium tnum', s.kind === 'income' ? 'text-good' : 'text-ink')}>{formatMoney(s.kind === 'income' ? s.amountMinor : -s.amountMinor, s.currency, { signed: true, compact: true })}</span>
          {s.cadence !== 'month' && s.monthly != null && <span className="block text-[11px] text-ink-3 tnum">≈ {formatMoney(s.monthly, base, { compact: true })}/mo</span>}
        </span>
        <CaretRight size={14} className="shrink-0 text-ink-3" />
      </button>
    </li>
  );
}

function PlanSheet({ open, onClose, data }: { open: boolean; onClose: () => void; data: MoneyPlanPage }) {
  const [inc, setInc] = useState(data.planRow.expectedIncome ? major(data.planRow.expectedIncome, data.base) : '');
  const [sav, setSav] = useState(data.planRow.plannedSavings ? major(data.planRow.plannedSavings, data.base) : '');
  const [inv, setInv] = useState(data.planRow.plannedInvestments ? major(data.planRow.plannedInvestments, data.base) : '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Sheet open={open} onClose={onClose} title="This month’s plan" description={`Recurring items and budgets are already included. Add what only you know, in ${data.base}.`}>
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveMonthPlanAction({ expectedIncome: inc || '0', plannedSavings: sav || '0', plannedInvestments: inv || '0' });
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        <Field label="Other income you expect" htmlFor="mp-inc" hint="Variable income beyond your recurring items — freelance, bonuses.">
          <Input id="mp-inc" inputMode="decimal" value={inc} onChange={(e) => setInc(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Planned savings" htmlFor="mp-sav">
          <Input id="mp-sav" inputMode="decimal" value={sav} onChange={(e) => setSav(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Planned investing" htmlFor="mp-inv">
          <Input id="mp-inv" inputMode="decimal" value={inv} onChange={(e) => setInv(e.target.value)} placeholder="0" />
        </Field>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending}>
          Save plan
        </Button>
      </form>
    </Sheet>
  );
}

function BudgetSheet({ budget, onClose, data }: { budget: BudgetView | 'new' | null; onClose: () => void; data: MoneyPlanPage }) {
  const existing = budget && budget !== 'new' ? budget : null;
  const [categoryId, setCategoryId] = useState<string>(existing?.categoryId ?? '');
  const [amount, setAmount] = useState(existing ? major(existing.amount, existing.currency) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? data.base);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const key = existing?.id ?? (budget ? 'new' : 'closed');
  return (
    <Sheet key={key} open={!!budget} onClose={onClose} title={existing ? `Budget · ${existing.name}` : 'New budget'} size="sm" description="Monthly. A new amount applies from this month; past months keep theirs.">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveBudgetAction({ categoryId: categoryId || null, amount, currency });
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        {!existing && (
          <Field label="For" htmlFor="bg-cat">
            <Select id="bg-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All spending</option>
              {data.categories.filter((c) => c.kind === 'expense').map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Per month" htmlFor="bg-amt">
            <Input id="bg-amt" autoFocus inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="150" />
          </Field>
          <Field label="Currency" htmlFor="bg-cur">
            <Select id="bg-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <div className="flex gap-2">
          {existing && (
            <Button
              variant="ghost"
              onClick={() =>
                start(async () => {
                  await removeBudgetAction(existing.id);
                  onClose();
                  router.refresh();
                })
              }
            >
              Remove
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={!amount}>
            Save budget
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function TargetSheet({ target, onClose, data }: { target: TargetView | 'new' | null; onClose: () => void; data: MoneyPlanPage }) {
  const existing = target && target !== 'new' ? target : null;
  const [kind, setKind] = useState<string>(existing?.kind ?? 'income');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [amount, setAmount] = useState(existing && existing.kind !== 'debt_payoff' ? major(existing.target, existing.currency) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? data.base);
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [targetOn, setTargetOn] = useState(existing?.targetOn ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const needsAccount = kind === 'debt_payoff';
  const allowsAccount = kind === 'emergency_fund' || kind === 'debt_payoff';
  const balanceTarget = ['emergency_fund', 'net_worth', 'debt_payoff'].includes(kind);
  return (
    <Sheet key={existing?.id ?? (target ? 'new' : 'closed')} open={!!target} onClose={onClose} title={existing ? existing.title : 'New target'} description="A number you chose. LevelUp shows where you are and the plain arithmetic to get there.">
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveTargetAction(existing?.id ?? null, {
              kind: kind as never,
              title: title.trim() || TARGET_KIND[kind].label,
              amount: needsAccount ? undefined : amount,
              currency,
              accountId: allowsAccount ? accountId || null : null,
              targetOn: balanceTarget ? targetOn || null : null,
            });
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        <Field label="Kind" htmlFor="tg-kind" hint={TARGET_KIND[kind].hint}>
          <Select id="tg-kind" value={kind} onChange={(e) => setKind(e.target.value)} disabled={!!existing}>
            {Object.entries(TARGET_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Name" htmlFor="tg-title">
          <Input id="tg-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={80} placeholder={TARGET_KIND[kind].label} />
        </Field>
        {!needsAccount && (
          <div className="grid grid-cols-[1fr_110px] gap-3">
            <Field label={kind === 'spending_ceiling' ? 'Ceiling' : 'Target'} htmlFor="tg-amt">
              <Input id="tg-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="1500" />
            </Field>
            <Field label="Currency" htmlFor="tg-cur">
              <Select id="tg-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                {CURRENCIES.map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </Select>
            </Field>
          </div>
        )}
        {allowsAccount && (
          <Field label={needsAccount ? 'The loan or card' : 'Account (optional)'} htmlFor="tg-acct" hint={needsAccount ? 'Progress starts from what it shows as owed today.' : 'Leave empty to count all liquid cash.'}>
            <Select id="tg-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">{needsAccount ? 'Choose…' : 'All liquid cash'}</option>
              {data.accounts.filter((a) => (needsAccount ? ['credit', 'loan'].includes(a.type) : true)).map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {balanceTarget && (
          <Field label="By (optional)" htmlFor="tg-date">
            <Input id="tg-date" type="date" value={targetOn} onChange={(e) => setTargetOn(e.target.value)} />
          </Field>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <div className="flex gap-2">
          {existing && (
            <Button
              variant="ghost"
              onClick={() =>
                start(async () => {
                  await archiveTargetAction(existing.id);
                  onClose();
                  router.refresh();
                })
              }
            >
              Remove
            </Button>
          )}
          <Button type="submit" size="lg" className="flex-1" loading={pending} disabled={needsAccount ? !accountId : !amount}>
            Save target
          </Button>
        </div>
      </form>
    </Sheet>
  );
}

function SeriesSheet({ series, onClose, data }: { series: SeriesView | { kind: 'income' | 'expense'; isSubscription: boolean } | null; onClose: () => void; data: MoneyPlanPage }) {
  const existing = series && 'id' in series ? series : null;
  const [kind, setKind] = useState<'income' | 'expense'>(series?.kind ?? 'expense');
  const [name, setName] = useState(existing?.name ?? '');
  const [amount, setAmount] = useState(existing ? major(existing.amountMinor, existing.currency) : '');
  const [currency, setCurrency] = useState(existing?.currency ?? data.base);
  const [cadence, setCadence] = useState<'week' | 'month' | 'quarter' | 'year'>(existing?.cadence ?? 'month');
  const [nextOn, setNextOn] = useState(existing?.due ?? existing?.nextOn ?? data.today);
  const [accountId, setAccountId] = useState(existing?.accountId ?? '');
  const [categoryId, setCategoryId] = useState(existing?.categoryId ?? '');
  const [isSub, setIsSub] = useState(existing?.isSubscription ?? (series && !('id' in series) ? series.isSubscription : false));
  const [verdict, setVerdict] = useState<string>(existing?.verdict ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  const toast = useToast();
  const cats = data.categories.filter((c) => c.kind === kind);
  return (
    <Sheet key={existing?.id ?? (series ? `new-${series.kind}-${'isSubscription' in series && series.isSubscription}` : 'closed')} open={!!series} onClose={onClose} title={existing ? existing.name : isSub ? 'New subscription' : kind === 'income' ? 'New recurring income' : 'New recurring bill'}>
      <form
        className="flex flex-col gap-4 pt-1"
        onSubmit={(e) => {
          e.preventDefault();
          start(async () => {
            const r = await saveRecurringAction(existing?.id ?? null, {
              kind, name, amount, currency, cadence, intervalCount: 1, nextOn, accountId: accountId || null, categoryId: categoryId || null,
              counterparty: name, isSubscription: kind === 'expense' && isSub, verdict: kind === 'expense' && isSub && verdict ? (verdict as never) : null,
            });
            if (!r.ok) return setError(r.error);
            onClose();
            router.refresh();
          });
        }}
      >
        {!existing && !isSub && (
          <Segmented label="Kind" value={kind} onChange={setKind} options={[{ value: 'income', label: 'Income' }, { value: 'expense', label: 'Bill' }]} />
        )}
        <Field label="Name" htmlFor="rs-name">
          <Input id="rs-name" autoFocus={!existing} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={kind === 'income' ? 'Salary' : isSub ? 'Netflix' : 'Rent'} />
        </Field>
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Amount" htmlFor="rs-amt">
            <Input id="rs-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0" />
          </Field>
          <Field label="Currency" htmlFor="rs-cur">
            <Select id="rs-cur" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Every" htmlFor="rs-cad">
            <Select id="rs-cad" value={cadence} onChange={(e) => setCadence(e.target.value as typeof cadence)}>
              <option value="week">Week</option>
              <option value="month">Month</option>
              <option value="quarter">Quarter</option>
              <option value="year">Year</option>
            </Select>
          </Field>
          <Field label="Next date" htmlFor="rs-next">
            <Input id="rs-next" type="date" value={nextOn} onChange={(e) => setNextOn(e.target.value)} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Account" htmlFor="rs-acct">
            <Select id="rs-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">—</option>
              {data.accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category" htmlFor="rs-cat">
            <Select id="rs-cat" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">—</option>
              {cats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {kind === 'expense' && <Switch checked={isSub} onChange={setIsSub} label="Subscription" description="Listed with your subscriptions, with a verdict you choose." />}
        {kind === 'expense' && isSub && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-ink-2">Your verdict (optional)</span>
            <div className="flex flex-wrap gap-2">
              {Object.entries(VERDICT).map(([k, v]) => (
                <Chip key={k} selected={verdict === k} onClick={() => setVerdict(verdict === k ? '' : k)}>
                  {v}
                </Chip>
              ))}
            </div>
          </div>
        )}
        {error && <p className="text-sm text-bad" role="alert">{error}</p>}
        <Button type="submit" size="lg" block loading={pending} disabled={!name.trim() || !amount}>
          Save
        </Button>
        {existing && (
          <div className="flex flex-wrap justify-center gap-2">
            {existing.status === 'active' ? (
              <Button variant="ghost" size="sm" onClick={() => start(async () => { await recurringStatusAction(existing.id, 'paused'); toast.show({ title: 'Paused' }); onClose(); router.refresh(); })}>
                Pause
              </Button>
            ) : (
              <Button variant="ghost" size="sm" onClick={() => start(async () => { await recurringStatusAction(existing.id, 'active'); onClose(); router.refresh(); })}>
                Resume
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={() => start(async () => { await recurringStatusAction(existing.id, 'ended'); toast.show({ title: 'Ended', detail: 'Past payments stay in your history.' }); onClose(); router.refresh(); })}>
              End it
            </Button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
