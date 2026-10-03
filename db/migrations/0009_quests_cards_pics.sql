-- Kept · 0009 · Quests, coins and monster cards; gym pics in groups.
--
-- Integrity model, enforced here:
--   * Quests you set yourself are yours to write (own rows only).
--   * Coins and card pulls are a ledger the SERVER writes (owner role). Users can read their own
--     rows and nothing else, and have no insert / update / delete grant — so nobody can mint coins
--     or conjure a Legendary by talking to the database directly.
--   * Gym pics are visible to members of that group only; you can post into a group you belong to,
--     delete your own, and owners/admins can remove any. The image file itself stays owner-only and
--     is served to members through a membership-checked function, like shared proof.

-- ───────────────────────────────────────────── quests you set yourself (auto quests are derived)
create table public.quests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  title text not null check (char_length(title) between 1 and 80),
  size text not null default 'medium' check (size in ('small', 'medium', 'big')),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index quests_user_day_idx on public.quests (user_id, day, created_at);

alter table public.quests enable row level security;
create policy quests_own on public.quests for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.quests to authenticated;

-- ───────────────────────────────────────────── coins: an idempotent ledger, server-written
create table public.coin_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source text not null check (source in ('quest', 'bonus', 'box', 'seed')),
  source_key text not null check (char_length(source_key) between 1 and 120),
  amount int not null check (amount <> 0 and amount between -100000 and 100000),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_key)
);
create index coin_events_user_idx on public.coin_events (user_id, created_at desc);

alter table public.coin_events enable row level security;
create policy coin_events_read_own on public.coin_events for select to authenticated using (user_id = (select auth.uid()));
grant select on public.coin_events to authenticated;

-- ───────────────────────────────────────────── boxes opened and the cards they gave
create table public.card_pulls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  box_id uuid not null,                      -- one opening; retries with the same id never charge twice
  box_kind text not null check (box_kind in ('box', 'big_box')),
  slot smallint not null check (slot between 0 and 9),
  card_key text not null check (card_key ~ '^[a-z0-9_]{2,40}$'),
  rarity text not null check (rarity in ('common', 'uncommon', 'rare', 'epic', 'legendary')),
  pulled_at timestamptz not null default now(),
  unique (user_id, box_id, slot)
);
create index card_pulls_user_idx on public.card_pulls (user_id, pulled_at desc);

alter table public.card_pulls enable row level security;
create policy card_pulls_read_own on public.card_pulls for select to authenticated using (user_id = (select auth.uid()));
grant select on public.card_pulls to authenticated;

-- ───────────────────────────────────────────── gym pics
create table public.group_pics (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  file_id uuid not null,
  caption text check (char_length(caption) <= 140),
  taken_on date not null,
  created_at timestamptz not null default now(),
  foreign key (file_id, user_id) references public.files (id, user_id) on delete cascade
);
create index group_pics_feed_idx on public.group_pics (group_id, created_at desc);

alter table public.group_pics enable row level security;
create policy group_pics_member_read on public.group_pics for select to authenticated using (public.is_group_member(group_id));
create policy group_pics_member_post on public.group_pics for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
create policy group_pics_delete on public.group_pics for delete to authenticated
  using (user_id = (select auth.uid()) or public.group_role(group_id) in ('owner', 'admin'));
grant select, insert, delete on public.group_pics to authenticated;

-- a pic's file, for members of that group only
create or replace function public.group_pic_file(p_group uuid, p_pic uuid)
returns table (bucket text, object_path text, thumb_path text, mime_type text, width int, height int)
language sql stable security definer set search_path = '' as $$
  select f.bucket, f.object_path, f.thumb_path, f.mime_type, f.width, f.height
    from public.group_pics gp
    join public.files f on f.id = gp.file_id and f.user_id = gp.user_id
   where gp.group_id = p_group and gp.id = p_pic and public.is_group_member(p_group)
$$;
revoke execute on function public.group_pic_file(uuid, uuid) from public;
grant execute on function public.group_pic_file(uuid, uuid) to authenticated;

-- the feed can point at a pic ("Mila posted a gym pic"), and loses the line when the pic goes
alter table public.group_activity add column pic_id uuid references public.group_pics(id) on delete cascade;
alter table public.group_activity drop constraint group_activity_kind_check;
alter table public.group_activity add constraint group_activity_kind_check
  check (kind in ('joined', 'left', 'activity', 'week_target', 'season_target', 'award', 'pic'));
