-- Kept · 0006 · Learning: subjects you chose, measured the way you chose, logged session by session.
--
-- A subject's weekly target ("German · 4 h a week over 4 days") is carried into the completion engine
-- as its own routine: 4× a week with a per-day target of 60 min. Each day's completion is recomputed
-- from that day's sessions, so logging, editing or deleting a session always converges on the truth.

create table public.learning_subjects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  measure text not null check (measure in ('minutes', 'sessions', 'pages', 'lessons', 'custom')),
  unit text check (char_length(unit) between 1 and 16),            -- custom quantity: "problems", "chapters"
  weekly_target numeric(10,2) not null check (weekly_target > 0),
  days_per_week smallint not null check (days_per_week between 1 and 7),
  mission_id uuid,
  sort_order int not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (mission_id, user_id) references public.missions (id, user_id) on delete set null (mission_id),
  check (measure <> 'custom' or unit is not null)
);
create index learning_subjects_user_idx on public.learning_subjects (user_id, sort_order) where archived_at is null;
create trigger learning_subjects_updated before update on public.learning_subjects
  for each row execute function public.set_updated_at();

create table public.learning_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  subject_id uuid not null,
  performed_on date not null,
  started_at timestamptz,
  finished_at timestamptz,
  minutes int check (minutes between 0 and 1440),
  quantity numeric(10,2) check (quantity >= 0 and quantity <= 100000),  -- pages, lessons, custom units
  topic text check (char_length(topic) <= 120),
  note text check (char_length(note) <= 2000),
  status text not null default 'completed' check (status in ('active', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (subject_id, user_id) references public.learning_subjects (id, user_id) on delete cascade,
  check (status <> 'completed' or minutes is not null or quantity is not null)
);
create index learning_sessions_user_day_idx on public.learning_sessions (user_id, performed_on desc);
create index learning_sessions_subject_idx on public.learning_sessions (subject_id, performed_on);
create trigger learning_sessions_updated before update on public.learning_sessions
  for each row execute function public.set_updated_at();

do $$
declare t text;
begin
  foreach t in array array['learning_subjects', 'learning_sessions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format(
      'create policy %I on public.%I for all to authenticated
         using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))',
      t || '_own', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
