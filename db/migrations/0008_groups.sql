-- Kept · 0008 · Groups: private competitions where everyone keeps their OWN commitment.
--
-- Privacy model, enforced here rather than remembered in code:
--   * A member sees the group, its members' display names, targets, standings, awards and
--     group activity — nothing else. Profiles, areas, missions, completions, proofs and every money
--     table keep their owner-only RLS; no policy in this file references a finance table, and no
--     function returns anything but per-day counts of the routine a member linked.
--   * Proof is never visible to a group unless its owner shares that proof with that group.
--   * Standings are computed on the server from completions (one per routine per day, snapshotted),
--     never accepted from a client. Seasons, locked targets, results, awards and activity have no
--     write grants for users at all: only the server (owner role) writes them.

alter table public.proofs add constraint proofs_id_user_key unique (id, user_id);

create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  kind text not null check (kind in ('gym', 'learning', 'custom')),
  description text check (char_length(description) <= 500),
  season_length text not null default 'month' check (season_length in ('week', 'month', 'custom')),
  season_days smallint check (season_days between 7 and 120),
  proof_policy text not null default 'self_report' check (proof_policy in ('self_report', 'proof_optional', 'proof_required')),
  target_rule text not null default 'personal' check (target_rule in ('personal', 'same')),
  same_target numeric(10,2) check (same_target > 0),
  min_target numeric(10,2) check (min_target > 0),
  max_target numeric(10,2) check (max_target > 0),
  prize text check (char_length(prize) <= 200),                     -- text only; no payments
  join_code text not null unique check (join_code ~ '^[A-Z0-9]{8}$'),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (season_length <> 'custom' or season_days is not null),
  check (target_rule <> 'same' or same_target is not null),
  check (min_target is null or max_target is null or max_target >= min_target)
);
create trigger groups_updated before update on public.groups
  for each row execute function public.set_updated_at();

create table public.group_members (
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'left', 'removed')),
  display_name text not null check (char_length(display_name) between 1 and 40),
  mission_id uuid,                        -- the member's own routine that counts (gym target, learning subject, routine)
  target numeric(10,2) check (target > 0),-- per week, for the NEXT season; the current season is locked in group_commitments
  unit text check (unit in ('workouts', 'minutes', 'sessions', 'pages', 'lessons', 'units', 'times')),
  proof_share text not null default 'ask' check (proof_share in ('never', 'ask', 'auto')),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  primary key (group_id, user_id),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete set null (mission_id)
);
create index group_members_user_idx on public.group_members (user_id) where status = 'active';

create table public.group_seasons (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  number int not null check (number >= 1),
  starts_on date not null,
  ends_on date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  closed_at timestamptz,
  unique (group_id, number),
  check (ends_on >= starts_on)
);
create unique index group_seasons_active_uidx on public.group_seasons (group_id) where status = 'active';

-- A member's weekly target, frozen for one season. Lowering your target on the 25th changes
-- next season, never this one.
create table public.group_commitments (
  season_id uuid not null references public.group_seasons(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  target numeric(10,2) not null check (target > 0),
  unit text not null,
  starts_on date not null,                -- joined mid-season: the pledge is prorated from here
  created_at timestamptz not null default now(),
  primary key (season_id, user_id)
);

-- Final standings, written once when a season closes. Editing old workouts later changes your own
-- history, never a finished season's winner.
create table public.group_results (
  season_id uuid not null references public.group_seasons(id) on delete cascade,
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  rank smallint not null,
  tied boolean not null default false,
  done numeric(12,2) not null,
  eligible numeric(12,2) not null,
  pledged numeric(12,2) not null,
  rate numeric(6,4) not null,
  perfect_weeks smallint not null,
  weeks smallint not null,
  proofed numeric(12,2),
  target numeric(10,2) not null,
  unit text not null,
  points smallint not null default 0,     -- championship points from this season
  primary key (season_id, user_id)
);

create table public.group_awards (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  season_id uuid references public.group_seasons(id) on delete cascade,
  year smallint,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('champion', 'perfect', 'most_improved', 'highest_volume', 'year_champion')),
  title text not null check (char_length(title) <= 120),
  detail text check (char_length(detail) <= 200),
  created_at timestamptz not null default now()
);
create unique index group_awards_uidx on public.group_awards
  (group_id, coalesce(season_id, '00000000-0000-0000-0000-000000000000'::uuid), coalesce(year, 0), kind, user_id);

create table public.group_activity (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('joined', 'left', 'activity', 'week_target', 'season_target', 'award')),
  title text not null check (char_length(title) <= 160),
  occurred_on date not null,
  proof_id uuid,                          -- set only while that proof is shared with this group
  source_key text not null check (char_length(source_key) <= 120),
  created_at timestamptz not null default now(),
  unique (group_id, source_key)
);
create index group_activity_feed_idx on public.group_activity (group_id, created_at desc);

create table public.group_proof_shares (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.groups(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  proof_id uuid not null,
  shared_at timestamptz not null default now(),
  unique (group_id, proof_id),
  foreign key (proof_id, user_id) references public.proofs (id, user_id) on delete cascade
);

-- ───────────────────────────────────────────── membership helpers (no RLS recursion)
create or replace function public.is_group_member(g uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members m
     where m.group_id = g and m.user_id = auth.uid() and m.status = 'active'
  )
$$;

create or replace function public.group_role(g uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.group_members m
   where m.group_id = g and m.user_id = auth.uid() and m.status = 'active'
$$;

-- ───────────────────────────────────────────── creating and joining
create or replace function public.create_group(p jsonb) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
begin
  if uid is null then raise exception 'not signed in'; end if;
  if (select count(*) from public.groups where owner_id = uid and archived_at is null) >= 20 then
    raise exception 'group limit reached';
  end if;
  insert into public.groups (owner_id, name, kind, description, season_length, season_days, proof_policy,
                             target_rule, same_target, min_target, max_target, prize, join_code)
  values (uid, p->>'name', p->>'kind', nullif(p->>'description', ''), coalesce(p->>'season_length', 'month'),
          (p->>'season_days')::smallint, coalesce(p->>'proof_policy', 'self_report'),
          coalesce(p->>'target_rule', 'personal'), (p->>'same_target')::numeric, (p->>'min_target')::numeric,
          (p->>'max_target')::numeric, nullif(p->>'prize', ''), p->>'join_code')
  returning id into gid;
  insert into public.group_members (group_id, user_id, role, status, display_name)
  values (gid, uid, 'owner', 'active', p->>'display_name');
  return gid;
end $$;

create or replace function public.join_group(p_code text, p_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  gid uuid;
  st text;
begin
  if uid is null then raise exception 'not signed in'; end if;
  select id into gid from public.groups where join_code = upper(trim(p_code)) and archived_at is null;
  if gid is null then raise exception 'invalid join code' using errcode = 'P0002'; end if;
  select status into st from public.group_members where group_id = gid and user_id = uid;
  if st = 'removed' then raise exception 'removed from group' using errcode = '42501'; end if;
  if st is null and (select count(*) from public.group_members where group_id = gid and status = 'active') >= 50 then
    raise exception 'group is full';
  end if;
  insert into public.group_members (group_id, user_id, role, status, display_name)
  values (gid, uid, 'member', 'active', p_name)
  on conflict (group_id, user_id) do update
    set status = 'active', left_at = null, display_name = excluded.display_name;
  return gid;
end $$;

-- Peek at a group before joining: name, kind and size only.
create or replace function public.group_preview(p_code text)
returns table (id uuid, name text, kind text, members bigint, season_length text, proof_policy text, target_rule text,
               same_target numeric, min_target numeric, max_target numeric, prize text)
language sql stable security definer set search_path = '' as $$
  select g.id, g.name, g.kind,
         (select count(*) from public.group_members m where m.group_id = g.id and m.status = 'active'),
         g.season_length, g.proof_policy, g.target_rule, g.same_target, g.min_target, g.max_target, g.prize
    from public.groups g
   where g.join_code = upper(trim(p_code)) and g.archived_at is null and auth.uid() is not null
$$;

-- Members can change their own name, link, next-season target and proof sharing, or leave.
-- Only owners/admins can change roles or remove someone, and nobody can make themselves owner.
create or replace function public.group_members_guard() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  me uuid := auth.uid();
  my_role text;
begin
  if me is null then return new; end if;  -- server (owner role) maintenance
  select role into my_role from public.group_members where group_id = old.group_id and user_id = me and status = 'active';
  if old.user_id = me then
    if new.role <> old.role then raise exception 'cannot change your own role'; end if;
    if new.status not in (old.status, 'left') then raise exception 'cannot change membership status'; end if;
    if new.status = 'left' and old.role = 'owner' then raise exception 'the owner cannot leave; transfer or archive the group'; end if;
  else
    if coalesce(my_role, '') not in ('owner', 'admin') then raise exception 'not allowed'; end if;
    if new.role = 'owner' or old.role = 'owner' then raise exception 'ownership cannot change this way'; end if;
    if new.role <> old.role and my_role <> 'owner' then raise exception 'only the owner changes roles'; end if;
    if (new.display_name, new.mission_id, new.target, new.unit, new.proof_share)
       is distinct from (old.display_name, old.mission_id, old.target, old.unit, old.proof_share) then
      raise exception 'only the member edits their own settings';
    end if;
    if new.status not in (old.status, 'removed') then raise exception 'cannot change membership status'; end if;
  end if;
  if new.user_id <> old.user_id or new.group_id <> old.group_id or new.joined_at <> old.joined_at then
    raise exception 'immutable membership fields';
  end if;
  if new.status in ('left', 'removed') and old.status = 'active' then new.left_at = now(); end if;
  return new;
end $$;
create trigger group_members_guard before update on public.group_members
  for each row execute function public.group_members_guard();

-- ───────────────────────────────────────────── standings input (aggregates only)
-- Per member, per day: how much of their linked routine they did, and whether that day carries
-- proof they shared with THIS group. Counted units (workouts, times) count kept days; measured
-- units count the logged amount (40 minutes on a 60-minute day is still 40 minutes of learning).
create or replace function public.group_activity_raw(p_group uuid, p_from date, p_to date)
returns table (user_id uuid, day date, amount numeric, proofed boolean)
language sql stable security definer set search_path = '' as $$
  select c.user_id, c.occurred_on,
         case when m.measure = 'check' or coalesce(gm.unit, 'times') in ('workouts', 'times') then 1::numeric
              else coalesce(c.value, 0) end,
         exists (
           select 1 from public.group_proof_shares s
             join public.proofs p on p.id = s.proof_id
            where s.group_id = p_group and p.completion_id = c.id
         )
    from public.group_members gm
    join public.completions c on c.mission_id = gm.mission_id and c.user_id = gm.user_id
    join public.missions m on m.id = c.mission_id
   where gm.group_id = p_group
     and gm.status = 'active'
     and c.occurred_on between p_from and p_to
     and c.outcome not in ('missed', 'skipped')
     and (c.kept or (m.measure <> 'check' and coalesce(gm.unit, 'times') not in ('workouts', 'times')))
$$;

create or replace function public.group_member_activity(p_group uuid, p_from date, p_to date)
returns table (user_id uuid, day date, amount numeric, proofed boolean)
language sql stable security definer set search_path = '' as $$
  select r.* from public.group_activity_raw(p_group, p_from, p_to) r where public.is_group_member(p_group)
$$;

-- A shared proof's file, for members of the group it was shared with.
create or replace function public.group_shared_proof(p_group uuid, p_proof uuid)
returns table (kind text, body text, url text, bucket text, object_path text, thumb_path text, mime_type text, width int, height int)
language sql stable security definer set search_path = '' as $$
  select p.kind, p.body, p.url, f.bucket, f.object_path, f.thumb_path, f.mime_type, f.width, f.height
    from public.group_proof_shares s
    join public.proofs p on p.id = s.proof_id
    left join public.files f on f.id = p.file_id
   where s.group_id = p_group and s.proof_id = p_proof and public.is_group_member(p_group)
$$;

-- ───────────────────────────────────────────── row level security
alter table public.groups enable row level security;
create policy groups_member_read on public.groups for select to authenticated using (public.is_group_member(id));
create policy groups_admin_update on public.groups for update to authenticated
  using (public.group_role(id) in ('owner', 'admin')) with check (public.group_role(id) in ('owner', 'admin'));
grant select, update on public.groups to authenticated;

alter table public.group_members enable row level security;
create policy group_members_read on public.group_members for select to authenticated using (public.is_group_member(group_id));
create policy group_members_update on public.group_members for update to authenticated
  using (user_id = (select auth.uid()) or public.group_role(group_id) in ('owner', 'admin'))
  with check (user_id = (select auth.uid()) or public.group_role(group_id) in ('owner', 'admin'));
grant select, update on public.group_members to authenticated;

do $$
declare t text;
begin
  foreach t in array array['group_seasons', 'group_commitments', 'group_results', 'group_awards', 'group_activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_group_member(group_id))', t || '_member_read', t);
    execute format('grant select on public.%I to authenticated', t);
  end loop;
end $$;

alter table public.group_proof_shares enable row level security;
create policy group_proof_shares_read on public.group_proof_shares for select to authenticated using (public.is_group_member(group_id));
create policy group_proof_shares_insert on public.group_proof_shares for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_group_member(group_id));
create policy group_proof_shares_delete on public.group_proof_shares for delete to authenticated
  using (user_id = (select auth.uid()));
grant select, insert, delete on public.group_proof_shares to authenticated;

-- functions: members may call the membership-checked ones; the raw aggregate is server-only
-- (Supabase grants new functions to anon/authenticated by default, so revoke those explicitly too)
revoke execute on function public.group_activity_raw(uuid, date, date) from public, anon, authenticated;
revoke execute on function public.create_group(jsonb) from public;
revoke execute on function public.join_group(text, text) from public;
revoke execute on function public.group_preview(text) from public;
revoke execute on function public.group_member_activity(uuid, date, date) from public;
revoke execute on function public.group_shared_proof(uuid, uuid) from public;
grant execute on function public.is_group_member(uuid) to authenticated;
grant execute on function public.group_role(uuid) to authenticated;
grant execute on function public.create_group(jsonb) to authenticated;
grant execute on function public.join_group(text, text) to authenticated;
grant execute on function public.group_preview(text) to authenticated;
grant execute on function public.group_member_activity(uuid, date, date) to authenticated;
grant execute on function public.group_shared_proof(uuid, uuid) to authenticated;
