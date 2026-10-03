-- Kept · 0007 · Money plan: targets you set, budgets you chose, the month you planned.
--
-- Everything here is user-declared intent. Kept compares it with what the ledger says actually
-- happened and states the arithmetic ("€132 of €150 used, 11 days left") — it never invents a
-- savings rate or tells anyone what to cancel.

-- ───────────────────────────────────────────── financial targets
--   monthly targets reset every calendar month:  income · savings (income − spending) · investment
--                                                (money moved into investment accounts) · spending_ceiling
--   balance targets are reached once:             emergency_fund · net_worth · debt_payoff
create table public.finance_targets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'savings', 'investment', 'spending_ceiling', 'emergency_fund', 'net_worth', 'debt_payoff')),
  title text not null check (char_length(title) between 1 and 80),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  account_id uuid,                     -- emergency fund: the account that holds it; debt: the loan / card
  start_minor bigint,                  -- debt payoff: what was owed when the target was set
  target_on date,                      -- optional deadline for balance targets
  achieved_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete set null (account_id)
);
create trigger finance_targets_updated before update on public.finance_targets
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── the monthly plan
-- Recurring income and bills come from recurring_series, budgets from budgets; this row holds the
-- parts only the user knows: variable income they expect, and what they intend to save and invest.
create table public.money_plans (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month date not null check (extract(day from month) = 1),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  expected_income_minor bigint not null default 0 check (expected_income_minor >= 0),
  planned_savings_minor bigint not null default 0 check (planned_savings_minor >= 0),
  planned_investments_minor bigint not null default 0 check (planned_investments_minor >= 0),
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, month)
);
create trigger money_plans_updated before update on public.money_plans
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── budgets: one current budget per category (null = overall)
alter table public.budgets add column updated_at timestamptz not null default now();
create unique index budgets_current_uidx on public.budgets
  (user_id, coalesce(category_id, '00000000-0000-0000-0000-000000000000'::uuid)) where active_to is null;
create trigger budgets_updated before update on public.budgets
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── receipts: one row per attached file
create index receipts_transaction_idx on public.receipts (transaction_id) where transaction_id is not null;

do $$
declare t text;
begin
  foreach t in array array['finance_targets', 'money_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
