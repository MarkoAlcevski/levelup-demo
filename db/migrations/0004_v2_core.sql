-- Kept · 0004 · V2 core: modules instead of a life philosophy, areas you shape yourself, the journal.
--
-- Forward-only and backwards compatible. Nothing a V1 user created is rewritten:
--   * legacy area kinds (body, work, health, relationships, personal, money) stay valid and readable;
--     the app shows them as ordinary areas (body renders as Gym).
--   * completions, schedules, proofs, XP and reviews are untouched.

-- ───────────────────────────────────────────── modules + preferences
-- Modules are tools the user opted into (Gym, Learning, Money). They are not commitments:
-- enabling Gym creates nothing until the user builds a program.
alter table public.profiles
  add column modules text[] not null default '{}'::text[]
    check (modules <@ array['gym', 'learning', 'money']::text[]),
  add column weight_unit text not null default 'kg' check (weight_unit in ('kg', 'lb'));

-- V1 users saw every module; keep their app exactly as full as it was.
update public.profiles set modules = array['gym', 'learning', 'money'] where onboarded_at is not null;

-- ───────────────────────────────────────────── areas
alter table public.areas drop constraint areas_kind_check;
alter table public.areas add constraint areas_kind_check
  check (kind in ('gym', 'learning', 'custom', 'money', 'body', 'work', 'health', 'relationships', 'personal'));
-- icon: a key from the app's icon set (validated in code); null = the kind's default
alter table public.areas add column icon text check (icon ~ '^[a-z_]{2,24}$');
-- archiving an area closes its routines' schedules; this remembers them so Restore can reopen them
alter table public.areas add column archived_schedules jsonb;
create index areas_user_all_idx on public.areas (user_id, sort_order);

-- ───────────────────────────────────────────── missions (shown as Routines / Tasks)
-- module = the routine is owned by a module (the Gym program's weekly target, a learning subject)
-- and is edited through that module, not the generic routine form.
alter table public.missions add column module text check (module in ('gym', 'learning'));

-- completions can now come from a finished workout or a learning session
alter table public.completions drop constraint completions_source_check;
alter table public.completions add constraint completions_source_check
  check (source in ('app', 'offline', 'quick_add', 'command', 'review', 'import', 'seed', 'workout', 'learning'));

-- timeline gains group moments (season wins, awards)
alter table public.timeline_events drop constraint timeline_events_kind_check;
alter table public.timeline_events add constraint timeline_events_kind_check
  check (kind in ('start', 'record', 'achievement', 'keystone', 'project', 'goal', 'level', 'milestone', 'money', 'manual', 'group'));

-- sparse, useful notifications only
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('day_left', 'quota_close', 'keystone', 'review_ready', 'record', 'achievement', 'level', 'streak_risk', 'system',
                  'workout_left', 'learning_left', 'group_closing', 'money_report', 'subscription_due'));

-- ───────────────────────────────────────────── journal
-- One page per day, for every day of every year: what I did, what I want to do, notes.
-- The facts of the day (workouts, sessions, routines, money) are read live from their own tables
-- and shown beside the words, so the journal never duplicates or drifts from the record.
create table public.journal_entries (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  day date not null,
  did text check (char_length(did) <= 20000),
  plan text check (char_length(plan) <= 20000),
  notes text check (char_length(notes) <= 20000),
  mood smallint check (mood between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
create trigger journal_entries_updated before update on public.journal_entries
  for each row execute function public.set_updated_at();

alter table public.journal_entries enable row level security;
create policy journal_entries_own on public.journal_entries for all to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
grant select, insert, update, delete on public.journal_entries to authenticated;
