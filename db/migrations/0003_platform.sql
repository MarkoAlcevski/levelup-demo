-- Kept · 0003 · Platform: notifications, push, product analytics, reference data

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('day_left', 'quota_close', 'keystone', 'review_ready', 'record',
                                     'achievement', 'level', 'streak_risk', 'system')),
  title text not null check (char_length(title) between 1 and 120),
  body text check (char_length(body) <= 400),
  url text check (char_length(url) <= 300 and url ~ '^/'),        -- in-app paths only
  dedupe_key text not null check (char_length(dedupe_key) <= 160), -- one "2 missions left" per day, not five
  scheduled_for timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, scheduled_for desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_secret text not null,
  user_agent text check (char_length(user_agent) <= 300),
  created_at timestamptz not null default now()
);

-- First-party product analytics. Users may insert their own events and read nothing back;
-- the analytics pipeline reads with the service role. Names are object_action in snake_case.
create table public.analytics_events (
  id bigint generated always as identity primary key,
  user_id uuid default auth.uid() references auth.users(id) on delete set null,
  name text not null check (name ~ '^[a-z]+(_[a-z0-9]+)+$' and char_length(name) <= 64),
  props jsonb not null default '{}'::jsonb check (pg_column_size(props) <= 4096),
  occurred_at timestamptz not null default now(),
  session_id text check (char_length(session_id) <= 64),
  client text check (client in ('web', 'pwa', 'ios', 'android', 'server'))
);
create index analytics_events_name_idx on public.analytics_events (name, occurred_at);
create index analytics_events_user_idx on public.analytics_events (user_id, occurred_at);

do $$
declare t text;
begin
  foreach t in array array['notifications', 'push_subscriptions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.analytics_events enable row level security;
create policy analytics_events_insert on public.analytics_events for insert to authenticated
  with check (user_id = (select auth.uid()));
grant insert on public.analytics_events to authenticated;

-- Reference FX rates (1 base = rate quote). The denar has been pegged to the euro since 1997;
-- USD/GBP are reference values for conversion display only and are dated so it's clear how old they are.
insert into public.fx_rates (user_id, base, quote, rate, rate_on, source) values
  (null, 'EUR', 'MKD', 61.4950000000, '2026-01-01', 'reference'),
  (null, 'EUR', 'USD', 1.1700000000,  '2026-01-01', 'reference'),
  (null, 'EUR', 'GBP', 0.8650000000,  '2026-01-01', 'reference'),
  (null, 'EUR', 'CHF', 0.9350000000,  '2026-01-01', 'reference')
on conflict do nothing;
