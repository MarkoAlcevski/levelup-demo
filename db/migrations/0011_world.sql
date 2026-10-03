-- LevelUp · 0011 · World leaderboards.
--
-- The world boards are computed by the server from aggregates only (a first name, a last initial and
-- a weekly number); no row of anyone else's is ever readable by a user. Everyone can take themselves
-- off the boards from Profile.
alter table public.profiles add column world_visible boolean not null default true;
