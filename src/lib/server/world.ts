import 'server-only';
import { asSystem, type Queryable } from '@/lib/db';
import { addDays, startOfWeek, type ISODate } from '@/lib/engine/dates';
import type { Viewer } from './profile';

/**
 * World leaderboards: everyone on LevelUp, ranked by this week's LevelCoins, this week's workouts,
 * or how much of the collection they own. Computed by the server from aggregates, and it shows only a
 * first name and a last initial. People who hid themselves in Profile don't appear.
 *
 * Demo visitors live in a sandbox, so their board is the demo world: a fixed cast of demo players
 * whose numbers change week to week, plus the visitor and their demo friends. Real accounts only ever
 * see real accounts.
 */

export type WorldMetric = 'coins' | 'workouts' | 'collectors';

export const WORLD_METRICS: { key: WorldMetric; label: string; unit: string }[] = [
  { key: 'coins', label: 'LevelCoins', unit: 'LevelCoins this week' },
  { key: 'workouts', label: 'Workouts', unit: 'workouts this week' },
  { key: 'collectors', label: 'Collectors', unit: 'of 10 collected' },
];

export interface WorldRow {
  rank: number;
  name: string;
  value: number;
  me: boolean;
}

export interface WorldBoard {
  metric: WorldMetric;
  weekOf: ISODate;
  rows: WorldRow[];
  /** your row when you're outside the rows shown */
  me: WorldRow | null;
  total: number;
  /** you took yourself off the boards */
  hidden: boolean;
}

const SHOW = 50;
const isDemo = (email: string) => email.toLowerCase().endsWith('@kept.local');

/** "Marko Alcevski" → "Marko A.", "ana" → "Ana". */
export function publicName(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'LevelUp player';
  const cap = (w: string) => w.charAt(0).toLocaleUpperCase() + w.slice(1);
  return parts.length === 1 ? cap(parts[0]) : `${cap(parts[0])} ${parts[parts.length - 1].charAt(0).toLocaleUpperCase()}.`;
}

const DEMO_CAST = [
  'Ana K.', 'Marko P.', 'Elena S.', 'Luka D.', 'Sara M.', 'Nikola T.', 'Ivana R.', 'Stefan J.', 'Mia B.', 'David N.',
  'Teodora V.', 'Aleksandar G.', 'Jovana L.', 'Filip Z.', 'Kristina H.', 'Bojan S.', 'Marija D.', 'Petar K.', 'Lea F.', 'Viktor C.',
  'Hana M.', 'Dimitar A.', 'Nina P.', 'Oliver T.', 'Iva R.', 'Matej B.', 'Sofija N.', 'Andrej L.', 'Tea G.', 'Leon V.',
  'Katarina O.', 'Emir H.', 'Lana J.', 'Goran S.', 'Maša K.', 'Arben D.',
];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** A demo player's number for this week: stable within a week, different next week. */
function demoValue(name: string, metric: WorldMetric, week: ISODate, dayOfWeek: number): number {
  const r = (hash(`${name}|${metric}|${week}`) % 10_000) / 10_000;
  const r2 = (hash(`${week}|${name}`) % 10_000) / 10_000;
  const done = Math.min(1, (dayOfWeek + 1) / 7);
  if (metric === 'coins') return Math.round((r ** 1.6 * 1300 + 60) * done);
  if (metric === 'workouts') return Math.round(r ** 0.8 * 6 * done + (r2 > 0.7 ? 1 : 0));
  return Math.min(10, Math.round(r ** 1.3 * 8 + r2 * 2));
}

async function values(q: Queryable, metric: WorldMetric, ids: string[], week: ISODate): Promise<Map<string, number>> {
  if (!ids.length) return new Map();
  const rows =
    metric === 'coins'
      ? await q.query<{ id: string; v: number }>(
          `select user_id as id, coalesce(sum(amount) filter (where amount > 0 and occurred_on >= $2), 0)::int as v from public.coin_events where user_id = any($1::uuid[]) group by user_id`,
          [ids, week],
        )
      : metric === 'workouts'
        ? await q.query<{ id: string; v: number }>(
            `select c.user_id as id, count(distinct c.occurred_on)::int as v from public.completions c join public.missions m on m.id = c.mission_id
              where m.module = 'gym' and c.kept and c.occurred_on >= $2 and c.user_id = any($1::uuid[]) group by c.user_id`,
            [ids, week],
          )
        : await q.query<{ id: string; v: number }>(
            `select owner_id as id, count(distinct character_key)::int as v from public.collectables where owner_id = any($1::uuid[]) group by owner_id`,
            [ids],
          );
  return new Map(rows.map((r) => [r.id, Number(r.v)]));
}

export async function loadWorld(viewer: Viewer, metric: WorldMetric): Promise<WorldBoard> {
  const week = startOfWeek(viewer.today, 1);
  const dayOfWeek = Math.max(0, Math.round((Date.parse(viewer.today) - Date.parse(week)) / 86_400_000));
  const demo = isDemo(viewer.email);
  return asSystem(async (q) => {
    const people = demo
      ? await q.query<{ id: string; name: string; visible: boolean }>(
          `select p.id, p.display_name as name, p.world_visible as visible from public.profiles p
            where p.id = $1
               or p.id in (select b.user_id from public.group_members a join public.group_members b on b.group_id = a.group_id
                            where a.user_id = $1 and a.status = 'active' and b.status = 'active')`,
          [viewer.userId],
        )
      : await q.query<{ id: string; name: string; visible: boolean }>(
          `select p.id, p.display_name as name, p.world_visible as visible from public.profiles p join auth.users u on u.id = p.id
            where p.onboarded_at is not null and u.email not like '%@kept.local' and (p.world_visible or p.id = $1)`,
          [viewer.userId],
        );
    const self = people.find((p) => p.id === viewer.userId);
    const hidden = self ? !self.visible : false;
    const counted = people.filter((p) => p.visible);
    const vals = await values(q, metric, counted.map((p) => p.id), week);
    const entries: { name: string; value: number; me: boolean }[] = counted.map((p) => ({ name: publicName(p.name), value: vals.get(p.id) ?? 0, me: p.id === viewer.userId }));
    if (demo) for (const name of DEMO_CAST) entries.push({ name, value: demoValue(name, metric, week, dayOfWeek), me: false });
    entries.sort((a, b) => b.value - a.value || Number(b.me) - Number(a.me) || a.name.localeCompare(b.name));
    const ranked: WorldRow[] = [];
    for (const [i, e] of entries.entries()) {
      const rank = i > 0 && e.value === entries[i - 1].value ? ranked[i - 1].rank : i + 1;
      ranked.push({ rank, name: e.name, value: e.value, me: e.me });
    }
    const rows = ranked.slice(0, SHOW);
    const mine = ranked.find((r) => r.me) ?? null;
    return { metric, weekOf: week, rows, me: mine && !rows.includes(mine) ? mine : null, total: ranked.length, hidden };
  });
}

/** Where you stand this week, for the card on Groups. */
export async function myWorldRank(viewer: Viewer): Promise<{ rank: number; total: number; value: number } | null> {
  const board = await loadWorld(viewer, 'coins');
  const me = board.rows.find((r) => r.me) ?? board.me;
  return me ? { rank: me.rank, total: board.total, value: me.value } : null;
}

export const weekLabel = (week: ISODate) => `${week} – ${addDays(week, 6)}`;
