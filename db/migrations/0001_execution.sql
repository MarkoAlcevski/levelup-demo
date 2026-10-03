-- Kept · 0001 · Execution core
-- Runs unchanged on Supabase and on local PGlite (after db/local/0000_supabase_shim.sql).
--
-- Conventions
--   * Every user-owned row carries user_id, defaulting to auth.uid(), and RLS pins it to the caller.
--   * Parents expose unique (id, user_id); children reference (parent_id, user_id). A row can therefore
--     never point at another user's row, even with a guessed UUID — integrity is enforced by the
--     database, not by application code remembering to check.
--   * Enumerations are text + check constraints: cheap to evolve, readable in dumps.
--   * History is append/derive friendly: schedules are versioned, completions snapshot their target,
--     XP is a ledger keyed for idempotency, reviews store the stats they were generated from.

create or replace function public.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ───────────────────────────────────────────── profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 60),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 64),
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6), -- 0 = Sunday, 1 = Monday
  base_currency char(3) not null default 'EUR' check (base_currency ~ '^[A-Z]{3}$'),
  theme text not null default 'system' check (theme in ('system', 'dark', 'light')),
  accent text not null default 'volt' check (accent in ('volt', 'ember', 'cobalt', 'ivory')),
  notification_level text not null default 'balanced'
    check (notification_level in ('off', 'minimal', 'balanced', 'active')),
  streak_threshold numeric(3,2) not null default 0.50 check (streak_threshold between 0.10 and 1.00),
  onboarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── life areas
create table public.areas (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('body', 'work', 'learning', 'money', 'health', 'relationships', 'personal', 'custom')),
  name text not null check (char_length(name) between 1 and 40),
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create index areas_user_idx on public.areas (user_id, sort_order) where archived_at is null;

-- ───────────────────────────────────────────── projects (quest lines)
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  description text check (char_length(description) <= 2000),
  status text not null default 'active' check (status in ('active', 'done', 'dropped')),
  target_on date,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (area_id, user_id) references public.areas (id, user_id) on delete set null (area_id)
);
create index projects_user_idx on public.projects (user_id, status);
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── missions
-- A mission is WHAT you commit to. WHEN it is due lives in mission_schedules (versioned),
-- so changing "gym 4×/week" to "3×/week" never rewrites last month's rates.
create table public.missions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid not null,
  project_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  measure text not null default 'check' check (measure in ('check', 'duration', 'quantity')),
  unit text check (char_length(unit) between 1 and 16),                 -- 'min', 'steps', 'pages', 'messages'
  target_value numeric(12,2) check (target_value > 0),
  minimum_value numeric(12,2) check (minimum_value > 0),
  minimum_label text check (char_length(minimum_label) between 1 and 80), -- "20-min home workout"
  exceed_ratio numeric(4,2) not null default 1.25 check (exceed_ratio >= 1),
  difficulty text not null default 'normal' check (difficulty in ('easy', 'normal', 'hard', 'extreme')),
  proof_policy text not null default 'optional' check (proof_policy in ('off', 'optional', 'recommended', 'required')),
  time_of_day text check (time_of_day in ('morning', 'afternoon', 'evening')),
  is_priority boolean not null default false,
  sort_order int not null default 0,
  notes text check (char_length(notes) <= 2000),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (area_id, user_id) references public.areas (id, user_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id),
  check (measure = 'check' or (target_value is not null and unit is not null)),
  check (minimum_value is null or target_value is null or minimum_value <= target_value)
);
create index missions_user_idx on public.missions (user_id, area_id) where archived_at is null;
create index missions_project_idx on public.missions (project_id) where project_id is not null;
create trigger missions_updated before update on public.missions
  for each row execute function public.set_updated_at();

create table public.mission_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mission_id uuid not null,
  cadence text not null check (cadence in ('daily', 'weekly', 'days', 'once')),
  per_week smallint check (per_week between 1 and 7),          -- weekly quota ("4× a week")
  weekdays smallint[] check (weekdays <@ array[1,2,3,4,5,6,7]::smallint[]), -- ISO weekdays, 1 = Monday
  due_on date,                                                  -- once: optional deadline
  valid_from date not null,
  valid_to date,                                                -- exclusive; null = current version
  created_at timestamptz not null default now(),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete cascade,
  check (cadence <> 'weekly' or per_week is not null),
  check (cadence <> 'days' or cardinality(weekdays) between 1 and 7),
  check (valid_to is null or valid_to > valid_from)
);
create index mission_schedules_mission_idx on public.mission_schedules (mission_id, valid_from);
create index mission_schedules_user_idx on public.mission_schedules (user_id);
-- At most one open version per mission.
create unique index mission_schedules_current_uidx on public.mission_schedules (mission_id) where valid_to is null;

-- ───────────────────────────────────────────── completions
-- One row per mission per local day. Missed and excused days are rows too when the user
-- gives a reason, so the pattern engine can learn from them. "Kept" = met at least the minimum.
create table public.completions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  mission_id uuid not null,
  occurred_on date not null,                                    -- the local day it counts for
  outcome text not null check (outcome in ('exceeded', 'full', 'minimum', 'partial', 'missed', 'skipped')),
  kept boolean generated always as (outcome in ('exceeded', 'full', 'minimum')) stored,
  value numeric(12,2) check (value >= 0),
  target_value numeric(12,2),                                   -- snapshot at write time
  minimum_value numeric(12,2),                                  -- snapshot at write time
  difficulty text not null check (difficulty in ('easy', 'normal', 'hard', 'extreme')), -- snapshot
  credit numeric(4,3) not null check (credit between 0 and 1), -- share of the full commitment executed
  reason text check (reason in ('no_time', 'forgot', 'low_energy', 'unexpected', 'procrastinated',
                                'too_hard', 'not_important', 'rest', 'sick', 'travel', 'other')),
  note text check (char_length(note) <= 2000),
  logged_at timestamptz not null default now(),                -- wall clock; powers time-of-day patterns
  source text not null default 'app' check (source in ('app', 'offline', 'quick_add', 'command', 'review', 'import', 'seed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (mission_id, occurred_on),
  unique (id, user_id),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete cascade,
  check (outcome not in ('missed', 'skipped') or credit = 0)
);
create index completions_user_day_idx on public.completions (user_id, occurred_on);
create trigger completions_updated before update on public.completions
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── files + proof
-- files is the single registry of everything in object storage (quota, cleanup, signed URLs).
create table public.files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  bucket text not null check (bucket in ('proofs', 'receipts')),
  object_path text not null check (object_path ~ '^[0-9a-f-]{36}/'),  -- always "<user_id>/…"
  thumb_path text,
  mime_type text not null check (mime_type in ('image/webp', 'image/jpeg', 'image/png', 'video/mp4',
                                               'video/quicktime', 'video/webm', 'application/pdf')),
  byte_size bigint not null check (byte_size > 0 and byte_size <= 104857600),
  width int check (width > 0),
  height int check (height > 0),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  unique (bucket, object_path),
  check (split_part(object_path, '/', 1) = user_id::text)
);
create index files_user_idx on public.files (user_id, created_at desc);

create table public.proofs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  completion_id uuid not null,
  kind text not null check (kind in ('photo', 'video', 'screenshot', 'file', 'note', 'link')),
  file_id uuid,
  body text check (char_length(body) <= 4000),
  url text check (char_length(url) <= 2048 and url ~* '^https?://'),
  captured_on date not null,                                    -- = completion day; gallery sort key
  created_at timestamptz not null default now(),
  foreign key (completion_id, user_id) references public.completions (id, user_id) on delete cascade,
  foreign key (file_id, user_id) references public.files (id, user_id),
  check (
    (kind in ('photo', 'video', 'screenshot', 'file') and file_id is not null)
    or (kind = 'note' and body is not null)
    or (kind = 'link' and url is not null)
  )
);
create index proofs_user_day_idx on public.proofs (user_id, captured_on desc);
create index proofs_completion_idx on public.proofs (completion_id);

-- ───────────────────────────────────────────── XP ledger
-- Derived, idempotent facts: (source, source_key) identifies what earned it, so recomputing
-- XP after a rule change is an upsert, and undoing a completion deletes exactly one row.
create table public.xp_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  source text not null check (source in ('completion', 'weekly_quota', 'keystone', 'perfect_day', 'perfect_week',
                                         'achievement', 'project', 'goal', 'adjustment')),
  source_key text not null check (char_length(source_key) <= 200),
  area_id uuid,
  amount int not null check (amount between -100000 and 100000),
  occurred_on date not null,
  created_at timestamptz not null default now(),
  unique (user_id, source, source_key),
  foreign key (area_id, user_id) references public.areas (id, user_id) on delete set null (area_id)
);
create index xp_events_user_day_idx on public.xp_events (user_id, occurred_on);

-- ───────────────────────────────────────────── keystone (one per week)
create table public.keystones (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  week_start date not null,
  title text not null check (char_length(title) between 1 and 140),
  mission_id uuid,
  project_id uuid,
  status text not null default 'open' check (status in ('open', 'done', 'missed')),
  done_at timestamptz,
  note text check (char_length(note) <= 2000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, week_start),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete set null (mission_id),
  foreign key (project_id, user_id) references public.projects (id, user_id) on delete set null (project_id)
);
create trigger keystones_updated before update on public.keystones
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── goals (outcome vs input)
create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  area_id uuid,
  title text not null check (char_length(title) between 1 and 120),
  kind text not null check (kind in ('outcome', 'input')),
  metric text not null check (metric in ('manual', 'income_month', 'savings_balance', 'net_worth',
                                         'mission_count', 'mission_total')),
  unit text check (char_length(unit) <= 16),
  currency char(3) check (currency ~ '^[A-Z]{3}$'),
  start_value numeric(14,2) not null default 0,
  target_value numeric(14,2) not null,
  mission_id uuid,                                              -- input goals measured from a mission
  start_on date not null,
  target_on date,
  status text not null default 'active' check (status in ('active', 'achieved', 'dropped')),
  achieved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (area_id, user_id) references public.areas (id, user_id) on delete set null (area_id),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete set null (mission_id),
  check (target_on is null or target_on > start_on),
  check (metric not in ('mission_count', 'mission_total') or mission_id is not null)
);
create trigger goals_updated before update on public.goals
  for each row execute function public.set_updated_at();

create table public.goal_missions (
  goal_id uuid not null,
  mission_id uuid not null,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  primary key (goal_id, mission_id),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade,
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete cascade
);

create table public.goal_checkins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  goal_id uuid not null,
  value numeric(14,2) not null,
  recorded_on date not null,
  note text check (char_length(note) <= 500),
  created_at timestamptz not null default now(),
  unique (goal_id, recorded_on),
  foreign key (goal_id, user_id) references public.goals (id, user_id) on delete cascade
);

-- ───────────────────────────────────────────── day log (morning check-in + night review)
create table public.day_logs (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  energy text check (energy in ('low', 'normal', 'high')),
  available_minutes int check (available_minutes between 0 and 1440),
  rating smallint check (rating between 1 and 5),
  note text check (char_length(note) <= 2000),
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create trigger day_logs_updated before update on public.day_logs
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── rewards + marks
-- Marks balance = lifetime XP − marks spent. Spending never touches XP, so levels never drop.
create table public.rewards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 80),
  cost_marks int not null check (cost_marks between 1 and 10000000),
  money_amount_minor bigint check (money_amount_minor > 0),
  money_currency char(3) check (money_currency ~ '^[A-Z]{3}$'),
  requirement jsonb not null default '{}'::jsonb,               -- {"achievement": "...", "streak": 14, ...}
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id),
  check ((money_amount_minor is null) = (money_currency is null))
);

create table public.reward_redemptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  reward_id uuid not null,
  cost_marks int not null check (cost_marks > 0),               -- snapshot: repricing never rewrites history
  redeemed_at timestamptz not null default now(),
  transaction_id uuid,                                          -- set when the spend was logged (0002)
  note text check (char_length(note) <= 500),
  foreign key (reward_id, user_id) references public.rewards (id, user_id) on delete cascade
);
create index reward_redemptions_user_idx on public.reward_redemptions (user_id, redeemed_at desc);

-- ───────────────────────────────────────────── achievements, records, timeline, reviews
-- Achievement definitions live in code (src/lib/engine/achievements.ts), keyed and versioned there.
create table public.achievement_unlocks (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  achievement_key text not null check (achievement_key ~ '^[a-z0-9_]{2,64}$'),
  unlocked_on date not null,
  context jsonb not null default '{}'::jsonb,
  seen_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (user_id, achievement_key)
);

create table public.personal_records (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  record_key text not null check (record_key ~ '^[a-z0-9_:.-]{2,96}$'),
  value numeric(16,2) not null,
  previous_value numeric(16,2),
  achieved_on date not null,
  context jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, record_key)
);

create table public.timeline_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  occurred_on date not null,
  kind text not null check (kind in ('start', 'record', 'achievement', 'keystone', 'project', 'goal',
                                     'level', 'milestone', 'money', 'manual')),
  title text not null check (char_length(title) between 1 and 140),
  detail text check (char_length(detail) <= 500),
  source_key text not null check (char_length(source_key) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, kind, source_key)
);
create index timeline_user_day_idx on public.timeline_events (user_id, occurred_on desc);

create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('week', 'month', 'custom', 'year')),
  period_start date not null,
  period_end date not null,                                     -- inclusive
  stats jsonb not null,                                         -- deterministic snapshot the review was built from
  insights jsonb not null default '[]'::jsonb,
  narrative text,                                               -- optional AI prose over `stats`; never the source of numbers
  engine_version int not null,
  generated_at timestamptz not null default now(),
  viewed_at timestamptz,
  unique (user_id, kind, period_start, period_end),
  check (period_end >= period_start)
);
create index reviews_user_idx on public.reviews (user_id, period_end desc);

-- ───────────────────────────────────────────── signup hook
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────────────────────── row level security
alter table public.profiles enable row level security;
create policy profiles_own on public.profiles for all to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));
grant select, insert, update on public.profiles to authenticated;

do $$
declare t text;
begin
  foreach t in array array[
    'areas', 'projects', 'missions', 'mission_schedules', 'completions', 'files', 'proofs',
    'xp_events', 'keystones', 'goals', 'goal_missions', 'goal_checkins', 'day_logs', 'rewards',
    'reward_redemptions', 'achievement_unlocks', 'personal_records', 'timeline_events', 'reviews'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
