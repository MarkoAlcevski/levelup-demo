-- Kept · 0002 · Money
--
-- Money rules (enforced here, relied on everywhere):
--   * Amounts are integers in the currency's minor unit (cents, deni). No floats, ever.
--   * A transaction's currency always equals its account's currency (trigger below).
--     Paying €10 from an MKD card is stored as −615.00 MKD with original_amount/currency = 10.00 EUR.
--   * Amounts are signed from the account's point of view: + money in, − money out.
--     A transfer is two rows (one per account) sharing transfer_id — savings and investments are
--     transfers, so they are never double-counted as expenses.
--   * Liabilities (credit cards, loans) are accounts whose balance is negative. Net worth is a sum.
--   * Cross-currency totals are computed with explicit rates from fx_rates, and every screen that
--     converts says so. Nothing ever assumes 1 EUR = 1 USD.

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  type text not null check (type in ('cash', 'checking', 'savings', 'credit', 'investment', 'crypto',
                                     'business', 'loan', 'property', 'other')),
  institution text check (char_length(institution) <= 60),        -- Wise, Revolut, …
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  opening_balance_minor bigint not null default 0,
  opening_on date not null,
  is_liquid boolean not null default true,                          -- counts toward runway
  include_in_net_worth boolean not null default true,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id)
);
create index accounts_user_idx on public.accounts (user_id) where archived_at is null;
create trigger accounts_updated before update on public.accounts
  for each row execute function public.set_updated_at();

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  slug text not null check (slug ~ '^[a-z0-9_]{2,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  is_essential boolean not null default false,                      -- runway uses essential spending
  is_fixed boolean not null default false,                          -- fixed vs variable split
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (user_id, kind, slug)
);

create table public.recurring_series (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('income', 'expense')),
  name text not null check (char_length(name) between 1 and 60),
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  cadence text not null check (cadence in ('week', 'month', 'quarter', 'year')),
  interval_count smallint not null default 1 check (interval_count between 1 and 12),
  next_on date,
  account_id uuid,
  category_id uuid,
  counterparty text check (char_length(counterparty) <= 80),
  is_subscription boolean not null default false,
  verdict text check (verdict in ('essential', 'useful', 'questionable', 'cancel')),
  status text not null default 'active' check (status in ('active', 'paused', 'ended')),
  started_on date not null,
  ended_on date,
  url text check (char_length(url) <= 2048 and url ~* '^https?://'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete set null (account_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id)
);
create trigger recurring_series_updated before update on public.recurring_series
  for each row execute function public.set_updated_at();

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null,
  kind text not null check (kind in ('income', 'expense', 'transfer', 'adjustment')),
  amount_minor bigint not null check (amount_minor <> 0),         -- signed, in the account's currency
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  original_amount_minor bigint check (original_amount_minor > 0),  -- foreign-currency purchase, as charged
  original_currency char(3) check (original_currency ~ '^[A-Z]{3}$'),
  occurred_on date not null,
  category_id uuid,
  counterparty text check (char_length(counterparty) <= 80),       -- merchant (expense) or source (income)
  note text check (char_length(note) <= 1000),
  tags text[] not null default '{}' check (cardinality(tags) <= 12),
  transfer_id uuid,                                                -- shared by both legs of a transfer
  series_id uuid,
  is_earned_reward boolean not null default false,                 -- guilt-free spend from a redeemed reward
  source text not null default 'app' check (source in ('app', 'quick_add', 'command', 'receipt', 'recurring',
                                                       'import', 'seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (account_id, user_id) references public.accounts (id, user_id),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete set null (category_id),
  foreign key (series_id, user_id) references public.recurring_series (id, user_id) on delete set null (series_id),
  check ((kind = 'transfer') = (transfer_id is not null)),
  check (kind <> 'income' or amount_minor > 0),
  check ((original_amount_minor is null) = (original_currency is null))
);
create index transactions_user_day_idx on public.transactions (user_id, occurred_on desc);
create index transactions_account_idx on public.transactions (account_id, occurred_on);
create index transactions_category_idx on public.transactions (user_id, category_id, occurred_on);
create index transactions_transfer_idx on public.transactions (transfer_id) where transfer_id is not null;
create trigger transactions_updated before update on public.transactions
  for each row execute function public.set_updated_at();

create or replace function public.transactions_currency_guard() returns trigger
language plpgsql as $$
declare acct_currency char(3);
begin
  select currency into acct_currency from public.accounts where id = new.account_id;
  if acct_currency is null then
    raise exception 'account % not found', new.account_id;
  end if;
  if new.currency <> acct_currency then
    raise exception 'transaction currency % does not match account currency %', new.currency, acct_currency;
  end if;
  return new;
end $$;
create trigger transactions_currency_guard before insert or update of currency, account_id on public.transactions
  for each row execute function public.transactions_currency_guard();

alter table public.reward_redemptions
  add foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete set null (transaction_id);

-- Point-in-time values for things that don't move by transactions (property, broker marks).
create table public.account_valuations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  account_id uuid not null,
  valued_on date not null,
  value_minor bigint not null,
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (account_id, valued_on),
  foreign key (account_id, user_id) references public.accounts (id, user_id) on delete cascade
);

-- 1 base = rate × quote on rate_on. user_id null = shared reference rate; a user's own rows override.
create table public.fx_rates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  base char(3) not null check (base ~ '^[A-Z]{3}$'),
  quote char(3) not null check (quote ~ '^[A-Z]{3}$'),
  rate numeric(20,10) not null check (rate > 0),
  rate_on date not null,
  source text not null default 'manual' check (char_length(source) <= 40),
  created_at timestamptz not null default now(),
  check (base <> quote)
);
create unique index fx_rates_uidx on public.fx_rates
  (coalesce(user_id, '00000000-0000-0000-0000-000000000000'::uuid), base, quote, rate_on);

create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid,                                                -- null = overall spending budget
  amount_minor bigint not null check (amount_minor > 0),
  currency char(3) not null check (currency ~ '^[A-Z]{3}$'),
  period text not null default 'month' check (period in ('week', 'month')),
  active_from date not null,
  active_to date,
  created_at timestamptz not null default now(),
  foreign key (category_id, user_id) references public.categories (id, user_id) on delete cascade
);

create table public.receipts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_id uuid not null,
  transaction_id uuid,
  status text not null default 'uploaded' check (status in ('uploaded', 'extracted', 'confirmed', 'failed')),
  extracted jsonb,                                                 -- OCR output incl. per-field confidence; never auto-saved
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  foreign key (file_id, user_id) references public.files (id, user_id),
  foreign key (transaction_id, user_id) references public.transactions (id, user_id) on delete set null (transaction_id)
);

-- ───────────────────────────────────────────── default categories at signup
create or replace function public.seed_user_categories(uid uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.categories (user_id, kind, slug, name, is_essential, is_fixed, sort_order) values
    (uid, 'expense', 'housing',       'Housing',       true,  true,  1),
    (uid, 'expense', 'groceries',     'Groceries',     true,  false, 2),
    (uid, 'expense', 'restaurants',   'Restaurants',   false, false, 3),
    (uid, 'expense', 'transport',     'Transport',     true,  false, 4),
    (uid, 'expense', 'utilities',     'Utilities',     true,  true,  5),
    (uid, 'expense', 'subscriptions', 'Subscriptions', false, true,  6),
    (uid, 'expense', 'health',        'Health',        true,  false, 7),
    (uid, 'expense', 'fitness',       'Fitness',       false, true,  8),
    (uid, 'expense', 'education',     'Education',     false, false, 9),
    (uid, 'expense', 'shopping',      'Shopping',      false, false, 10),
    (uid, 'expense', 'entertainment', 'Entertainment', false, false, 11),
    (uid, 'expense', 'travel',        'Travel',        false, false, 12),
    (uid, 'expense', 'business',      'Business',      false, false, 13),
    (uid, 'expense', 'gifts',         'Gifts',         false, false, 14),
    (uid, 'expense', 'other',         'Other',         false, false, 15),
    (uid, 'income',  'salary',        'Salary',        false, false, 1),
    (uid, 'income',  'freelance',     'Freelance',     false, false, 2),
    (uid, 'income',  'business',      'Business',      false, false, 3),
    (uid, 'income',  'investment',    'Investment',    false, false, 4),
    (uid, 'income',  'gift',          'Gift',          false, false, 5),
    (uid, 'income',  'other',         'Other',         false, false, 6)
  on conflict (user_id, kind, slug) do nothing
$$;

create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  perform public.seed_user_categories(new.id);
  return new;
end $$;

-- ───────────────────────────────────────────── row level security
do $$
declare t text;
begin
  foreach t in array array[
    'accounts', 'categories', 'recurring_series', 'transactions', 'account_valuations', 'budgets', 'receipts'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.fx_rates enable row level security;
create policy fx_rates_read on public.fx_rates for select to authenticated
  using (user_id is null or user_id = (select auth.uid()));
create policy fx_rates_write on public.fx_rates for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy fx_rates_update on public.fx_rates for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy fx_rates_delete on public.fx_rates for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.fx_rates to authenticated;
