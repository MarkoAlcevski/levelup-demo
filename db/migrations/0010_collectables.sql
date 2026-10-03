-- LevelUp · 0010 · Collectables replace monster cards; trading between group mates; the guided tour.
--
-- Integrity model, enforced here:
--   * Monster cards are gone: their table is dropped and the LevelCoins spent on boxes are refunded.
--   * Collectables, trades and prize claims are written by the SERVER only (owner role), after it has
--     checked the price, the unlock rule, the balance and group membership. Users can read their own
--     rows and nothing else, and have no insert / update / delete grant, so nobody can mint a
--     collectable, fake a trade or claim a prize by talking to the database directly.
--   * You can see a friend's collection only while you share an active group with them.

-- ───────────────────────────────────────────── monster cards out, their coins back
drop table public.card_pulls;
delete from public.coin_events where source = 'box';
alter table public.coin_events drop constraint coin_events_source_check;
alter table public.coin_events add constraint coin_events_source_check
  check (source in ('quest', 'bonus', 'seed', 'collectable'));

-- ───────────────────────────────────────────── collectables: one row per copy
create table public.collectables (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  bought_by uuid references auth.users(id) on delete set null,     -- who paid for this copy (keeps across trades)
  character_key text not null check (character_key ~ '^[a-z0-9_]{2,40}$'),
  purchase_id uuid not null unique,                                -- one purchase; retries never charge twice
  bought_at timestamptz not null default now(),
  acquired_at timestamptz not null default now()                   -- when the current owner got it
);
create index collectables_owner_idx on public.collectables (owner_id, character_key);

alter table public.collectables enable row level security;
create policy collectables_read_own on public.collectables for select to authenticated using (owner_id = (select auth.uid()));
grant select on public.collectables to authenticated;

-- ───────────────────────────────────────────── trade offers: one copy for one copy
create table public.collectable_trades (
  id uuid primary key default gen_random_uuid(),
  from_user uuid not null references auth.users(id) on delete cascade,
  to_user uuid not null references auth.users(id) on delete cascade,
  give_key text not null check (give_key ~ '^[a-z0-9_]{2,40}$'),   -- what from_user hands over
  get_key text not null check (get_key ~ '^[a-z0-9_]{2,40}$'),     -- what from_user asks for in return
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'cancelled', 'failed')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  check (from_user <> to_user)
);
create index collectable_trades_to_idx on public.collectable_trades (to_user, status, created_at desc);
create index collectable_trades_from_idx on public.collectable_trades (from_user, status, created_at desc);

alter table public.collectable_trades enable row level security;
create policy collectable_trades_read_own on public.collectable_trades for select to authenticated
  using (from_user = (select auth.uid()) or to_user = (select auth.uid()));
grant select on public.collectable_trades to authenticated;

-- ───────────────────────────────────────────── a full set, claimed once
create table public.collectable_prizes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  set_key text not null check (set_key in ('gym', 'finance')),
  code text not null unique check (code ~ '^LU-[A-Z]{3}-[A-Z0-9]{6}$'),
  claimed_at timestamptz not null default now(),
  unique (user_id, set_key)
);

alter table public.collectable_prizes enable row level security;
create policy collectable_prizes_read_own on public.collectable_prizes for select to authenticated using (user_id = (select auth.uid()));
grant select on public.collectable_prizes to authenticated;

-- ───────────────────────────────────────────── who you can trade with
create or replace function public.shares_group(p_other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
      join public.group_members b on b.group_id = a.group_id
     where a.user_id = auth.uid() and a.status = 'active'
       and b.user_id = p_other and b.status = 'active'
       and p_other <> auth.uid()
  )
$$;
revoke execute on function public.shares_group(uuid) from public;
grant execute on function public.shares_group(uuid) to authenticated;

-- a group mate's collection (counts per character), and nothing for anyone else
create or replace function public.mate_collectables(p_user uuid)
returns table (character_key text, copies int)
language sql stable security definer set search_path = '' as $$
  select c.character_key, count(*)::int
    from public.collectables c
   where c.owner_id = p_user and public.shares_group(p_user)
   group by c.character_key
$$;
revoke execute on function public.mate_collectables(uuid) from public;
grant execute on function public.mate_collectables(uuid) to authenticated;

-- ───────────────────────────────────────────── the guided tour, shown once to every new member
alter table public.profiles add column tutorial_done_at timestamptz;
