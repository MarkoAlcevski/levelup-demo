-- LOCAL ONLY. Email + password auth for running without a Supabase project.
-- Never granted to anon/authenticated: only the server's owner connection touches this schema.
-- On Supabase, Supabase Auth replaces all of it (see docs/ARCHITECTURE.md → Deploying).

create schema if not exists local_auth;
revoke all on schema local_auth from public;

create table if not exists local_auth.credentials (
  user_id uuid primary key references auth.users(id) on delete cascade,
  password_hash text not null,          -- scrypt$N$r$p$salt$hash
  updated_at timestamptz not null default now()
);

create table if not exists local_auth.sessions (
  id text primary key,                  -- sha256(token); the raw token only ever lives in the cookie
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  user_agent text
);
create index if not exists sessions_user_idx on local_auth.sessions(user_id);

create table if not exists local_auth.attempts (
  key text primary key,                 -- 'login:<email>' or 'signup:<ip>'
  count int not null default 0,
  window_start timestamptz not null default now()
);
