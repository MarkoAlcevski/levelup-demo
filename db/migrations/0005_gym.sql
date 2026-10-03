-- Kept · 0005 · Gym: programs you design, workouts you log set by set.
--
--   PROGRAM → WORKOUT DAYS (templates) → TEMPLATE EXERCISES        what you plan to do
--   WORKOUT SESSION → SESSION EXERCISES → SETS                      what you actually did
--
-- Sessions are snapshots: they copy names and targets at the moment they are logged and never
-- read the template again, so renaming "Push" or rebuilding the split never rewrites a past workout.
-- A finished session links to a completion of the program's routine, which is how a workout counts
-- toward the weekly target, streaks, points and group seasons — once per day, idempotently.

-- ───────────────────────────────────────────── exercises
-- Per-user rows. Library exercises are materialised on first use (catalog_key), custom ones have
-- none. Keeping every exercise user-owned lets children use the composite (id, user_id) keys.
create table public.exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  catalog_key text check (catalog_key ~ '^[a-z0-9_]{2,48}$'),
  name text not null check (char_length(name) between 1 and 80),
  muscle text check (muscle in ('chest', 'back', 'shoulders', 'biceps', 'triceps', 'forearms', 'core', 'quads',
                                'hamstrings', 'glutes', 'calves', 'full_body', 'cardio', 'other')),
  equipment text check (equipment in ('barbell', 'dumbbell', 'cable', 'machine', 'bodyweight', 'kettlebell', 'band', 'other')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  unique (id, user_id)
);
create unique index exercises_catalog_uidx on public.exercises (user_id, catalog_key) where catalog_key is not null;
create index exercises_user_idx on public.exercises (user_id, name);

-- ───────────────────────────────────────────── program (the plan)
create table public.workout_programs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null default 'My program' check (char_length(name) between 1 and 60),
  mode text not null check (mode in ('flexible', 'scheduled')),   -- any N days a week, or fixed weekdays
  per_week smallint not null check (per_week between 1 and 7),
  mission_id uuid,                                                 -- the weekly-target routine in the engine
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete set null (mission_id)
);
create unique index workout_programs_current_uidx on public.workout_programs (user_id) where archived_at is null;
create trigger workout_programs_updated before update on public.workout_programs
  for each row execute function public.set_updated_at();

create table public.workout_days (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  program_id uuid not null,
  name text not null check (char_length(name) between 1 and 40),
  position smallint not null check (position between 0 and 99),
  weekday smallint check (weekday between 1 and 7),               -- scheduled programs: ISO weekday
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (program_id, user_id) references public.workout_programs (id, user_id) on delete cascade
);
create index workout_days_program_idx on public.workout_days (program_id, position);
create trigger workout_days_updated before update on public.workout_days
  for each row execute function public.set_updated_at();

create table public.workout_day_exercises (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  workout_day_id uuid not null,
  exercise_id uuid not null,
  position smallint not null check (position between 0 and 99),
  sets smallint not null default 3 check (sets between 1 and 20),
  rep_min smallint check (rep_min between 1 and 200),
  rep_max smallint check (rep_max between 1 and 200),
  weight numeric(7,2) check (weight >= 0 and weight <= 2000),       -- optional starting weight
  rest_seconds smallint check (rest_seconds between 0 and 900),
  note text check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (workout_day_id, user_id) references public.workout_days (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercises (id, user_id),
  check (rep_min is null or rep_max is null or rep_max >= rep_min)
);
create index workout_day_exercises_day_idx on public.workout_day_exercises (workout_day_id, position);

-- ───────────────────────────────────────────── sessions (what happened)
-- ids may be generated on the phone, so a workout can start and be logged with no connection.
create table public.workout_sessions (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  program_id uuid,
  workout_day_id uuid,
  name text not null check (char_length(name) between 1 and 60),  -- snapshot
  performed_on date not null,                                      -- the local day it counts for
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  duration_seconds int check (duration_seconds between 0 and 86400),
  status text not null default 'active' check (status in ('active', 'completed')),
  note text check (char_length(note) <= 2000),
  weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb')),
  completion_id uuid,
  edited_at timestamptz,                                           -- set when a finished workout is corrected
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (program_id, user_id) references public.workout_programs (id, user_id) on delete set null (program_id),
  foreign key (workout_day_id, user_id) references public.workout_days (id, user_id) on delete set null (workout_day_id),
  foreign key (completion_id, user_id) references public.completions (id, user_id) on delete set null (completion_id),
  check (status <> 'completed' or finished_at is not null)
);
create index workout_sessions_user_day_idx on public.workout_sessions (user_id, performed_on desc);
create index workout_sessions_active_idx on public.workout_sessions (user_id) where status = 'active';
create trigger workout_sessions_updated before update on public.workout_sessions
  for each row execute function public.set_updated_at();

create table public.workout_session_exercises (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_id uuid not null,
  exercise_id uuid,
  name text not null check (char_length(name) between 1 and 80),  -- snapshot
  position smallint not null check (position between 0 and 99),
  target_sets smallint check (target_sets between 1 and 20),
  rep_min smallint check (rep_min between 1 and 200),
  rep_max smallint check (rep_max between 1 and 200),
  rest_seconds smallint check (rest_seconds between 0 and 900),
  note text check (char_length(note) <= 500),
  skipped boolean not null default false,
  replaced_name text check (char_length(replaced_name) <= 80),    -- "replaced Bench Press for this session"
  unique (id, user_id),
  foreign key (session_id, user_id) references public.workout_sessions (id, user_id) on delete cascade,
  foreign key (exercise_id, user_id) references public.exercises (id, user_id) on delete set null (exercise_id)
);
create index workout_session_exercises_session_idx on public.workout_session_exercises (session_id, position);
create index workout_session_exercises_exercise_idx on public.workout_session_exercises (user_id, exercise_id);

-- Every set on its own row: 80 kg × 8, 80 × 7, 75 × 9 — never "Bench Press: done".
create table public.workout_sets (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  session_exercise_id uuid not null,
  position smallint not null check (position between 0 and 99),
  weight numeric(7,2) check (weight >= 0 and weight <= 2000),
  reps smallint check (reps between 0 and 1000),
  kind text not null default 'working' check (kind in ('working', 'warmup')),
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (session_exercise_id, user_id) references public.workout_session_exercises (id, user_id) on delete cascade
);
create index workout_sets_exercise_idx on public.workout_sets (session_exercise_id, position);
create trigger workout_sets_updated before update on public.workout_sets
  for each row execute function public.set_updated_at();

-- ───────────────────────────────────────────── optional body data (bodyweight only — not a nutrition app)
create table public.body_measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  measured_on date not null,
  weight numeric(6,2) not null check (weight > 0 and weight < 1000),
  unit text not null default 'kg' check (unit in ('kg', 'lb')),
  note text check (char_length(note) <= 200),
  created_at timestamptz not null default now(),
  unique (user_id, measured_on)
);

-- ───────────────────────────────────────────── row level security
do $$
declare t text;
begin
  foreach t in array array[
    'exercises', 'workout_programs', 'workout_days', 'workout_day_exercises', 'workout_sessions',
    'workout_session_exercises', 'workout_sets', 'body_measurements'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
