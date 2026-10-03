import 'server-only';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, formatRange, maxDate, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { evaluate } from '@/lib/engine/metrics';
import { buildReview, REVIEW_ENGINE_VERSION, type ReviewStats } from '@/lib/engine/review';
import type { Insight } from '@/lib/engine/insights';
import { expenseAnomalies, flowTotals } from '@/lib/engine/finance';
import type { Viewer } from './context';
import { firstActiveDay, loadAreas, loadCompletions, loadMissions } from './load';
import { loadFinance } from './money';
import { track } from './analytics';

/**
 * Reviews are generated lazily and idempotently: whenever the app is opened, any completed
 * week (and completed 30-day cycle) without a review gets one. A cron / edge function can call
 * the same function in production; the unique index makes double generation impossible.
 */

const MAX_BACKFILL_WEEKS = 8;

interface Period {
  kind: 'week' | 'month';
  start: ISODate;
  end: ISODate;
  prevStart: ISODate;
  prevEnd: ISODate;
}

function duePeriods(today: ISODate, weekStartsOn: number, first: ISODate, existing: Set<string>): Period[] {
  const out: Period[] = [];
  const thisWeek = startOfWeek(today, weekStartsOn);
  for (let k = 1; k <= MAX_BACKFILL_WEEKS; k++) {
    const start = addDays(thisWeek, -7 * k);
    const end = addDays(start, 6);
    if (end < first) break;
    if (!existing.has(`week:${start}`)) out.push({ kind: 'week', start, end, prevStart: addDays(start, -7), prevEnd: addDays(start, -1) });
  }
  // 30-day cycles anchored on the first active day
  for (let k = 0; ; k++) {
    const start = addDays(first, 30 * k);
    const end = addDays(start, 29);
    if (end >= today) break;
    if (addDays(end, 90) < today) continue; // only recent cycles are worth backfilling
    if (!existing.has(`month:${start}`)) out.push({ kind: 'month', start, end, prevStart: addDays(start, -30), prevEnd: addDays(start, -1) });
  }
  return out;
}

export async function ensureWeeklyReviews(viewer: Viewer): Promise<number> {
  const { today, profile } = viewer;
  return asUser(viewer.userId, async (q) => {
    const first = await firstActiveDay(q);
    if (!first) return 0;
    const existingRows = await q.query<{ kind: string; period_start: string }>(`select kind, period_start from reviews`);
    const existing = new Set(existingRows.map((r) => `${r.kind}:${r.period_start}`));
    const todo = duePeriods(today, profile.weekStartsOn, first, existing);
    if (!todo.length) return 0;

    const earliest = todo.reduce((m, p) => (p.prevStart < m ? p.prevStart : m), todo[0].prevStart);
    const evStart = addDays(earliest, -56);
    const lastEnd = todo.reduce((m, p) => (p.end > m ? p.end : m), todo[0].end);
    const [areas, missions, completions, finance] = await Promise.all([
      loadAreas(q),
      loadMissions(q, { includeArchived: true }),
      loadCompletions(q, addDays(evStart, -7), lastEnd, profile.timezone),
      loadFinance(q, profile.baseCurrency),
    ]);
    const ev = evaluate(missions, completions, maxDate(evStart, addDays(first, -1)), lastEnd, { today, weekStartsOn: profile.weekStartsOn });
    const titles = new Map(missions.map((m) => [m.id, m.title]));

    let made = 0;
    for (const p of todo) {
      const [xpRows, proofRows, keystoneRows] = await Promise.all([
        q.query<{ cur: number; prev: number }>(
          `select coalesce(sum(amount) filter (where occurred_on between $1 and $2), 0)::int8 as cur,
                  coalesce(sum(amount) filter (where occurred_on between $3 and $4), 0)::int8 as prev
             from xp_events`,
          [p.start, p.end, p.prevStart, p.prevEnd],
        ),
        q.query<{ n: number }>(`select count(*)::int as n from proofs where captured_on between $1 and $2`, [p.start, p.end]),
        p.kind === 'week'
          ? q.query<{ title: string; status: 'open' | 'done' | 'missed' }>(`select title, status from keystones where week_start = $1`, [p.start])
          : Promise.resolve([] as { title: string; status: 'open' | 'done' | 'missed' }[]),
      ]);
      const hasMoney = finance.txs.some((t) => t.on >= p.prevStart && t.on <= p.end);
      const ctx = { base: profile.baseCurrency, book: finance.book };
      const period = { preset: 'custom' as const, start: p.start, end: p.end, label: formatRange(p.start, p.end) };
      const prevPeriod = { preset: 'custom' as const, start: p.prevStart, end: p.prevEnd, label: '' };
      const { stats, insights } = buildReview({
        kind: p.kind,
        start: p.start,
        end: p.end,
        prevStart: p.prevStart,
        prevEnd: p.prevEnd,
        today,
        ev,
        areas,
        titles,
        xp: Number(xpRows[0]?.cur ?? 0),
        xpPrev: Number(xpRows[0]?.prev ?? 0),
        proofs: proofRows[0]?.n ?? 0,
        keystone: keystoneRows[0] ?? null,
        streakThreshold: profile.streakThreshold,
        money: hasMoney
          ? {
              base: profile.baseCurrency,
              current: flowTotals(finance.txs, finance.accountMap, period, today, ctx),
              previous: flowTotals(finance.txs, finance.accountMap, prevPeriod, today, ctx),
              anomalies: expenseAnomalies(finance.txs, finance.categoryMap, period, ctx, p.kind === 'week' ? 2000 : 3000),
            }
          : undefined,
      });
      if (stats.planned === 0 && stats.prev.planned === 0) continue;
      const inserted = await q.query(
        `insert into reviews (kind, period_start, period_end, stats, insights, engine_version)
         values ($1, $2, $3, $4, $5, $6) on conflict do nothing returning id`,
        [p.kind, p.start, p.end, JSON.stringify(stats), JSON.stringify(insights), REVIEW_ENGINE_VERSION],
      );
      made += inserted.length;
    }
    if (made) void track(viewer.userId, 'review_generated', { count: made });
    return made;
  });
}

/** The newest review of each kind, if it hasn't been opened yet. Older backfilled reviews never nag. */
export async function latestUnviewedReview(q: Queryable): Promise<{ id: string; label: string } | null> {
  const rows = await q.query<{ id: string; period_start: string; period_end: string; kind: string; viewed_at: Date | null }>(
    `select distinct on (kind) id, period_start, period_end, kind, viewed_at
       from reviews where kind in ('week', 'month') and period_end >= current_date - 10
      order by kind, period_end desc`,
  );
  const r = rows.filter((x) => !x.viewed_at).sort((a, b) => (a.period_end < b.period_end ? 1 : -1))[0];
  return r ? { id: r.id, label: `${r.kind === 'week' ? 'Week' : '30 days'} · ${formatRange(r.period_start, r.period_end)}` } : null;
}

export interface ReviewRecord {
  id: string;
  kind: 'week' | 'month' | 'custom' | 'year';
  start: ISODate;
  end: ISODate;
  stats: ReviewStats;
  insights: Insight[];
  viewedAt: Date | null;
}

export async function getReview(viewer: Viewer, id: string): Promise<ReviewRecord | null> {
  return asUser(viewer.userId, async (q) => {
    const [r] = await q.query<{ id: string; kind: ReviewRecord['kind']; period_start: string; period_end: string; stats: ReviewStats; insights: Insight[]; viewed_at: Date | null }>(
      `select id, kind, period_start, period_end, stats, insights, viewed_at from reviews where id = $1`,
      [id],
    );
    if (!r) return null;
    if (!r.viewed_at) {
      await q.query(`update reviews set viewed_at = now() where id = $1`, [id]);
      void track(viewer.userId, 'review_viewed', { kind: r.kind });
    }
    return { id: r.id, kind: r.kind, start: r.period_start, end: r.period_end, stats: r.stats, insights: r.insights, viewedAt: r.viewed_at };
  });
}

export interface ReviewSummary {
  id: string;
  kind: ReviewRecord['kind'];
  start: ISODate;
  end: ISODate;
  execution: number | null;
  prevExecution: number | null;
  planned: number;
  kept: number;
  viewed: boolean;
}

export async function listReviews(viewer: Viewer, limit = 12): Promise<ReviewSummary[]> {
  return asUser(viewer.userId, async (q) => {
    const rows = await q.query<{ id: string; kind: ReviewRecord['kind']; period_start: string; period_end: string; stats: ReviewStats; viewed_at: Date | null }>(
      `select id, kind, period_start, period_end, stats, viewed_at from reviews order by period_end desc, kind limit $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      start: r.period_start,
      end: r.period_end,
      execution: r.stats.execution,
      prevExecution: r.stats.prev.execution,
      planned: r.stats.planned,
      kept: r.stats.kept,
      viewed: !!r.viewed_at,
    }));
  });
}
