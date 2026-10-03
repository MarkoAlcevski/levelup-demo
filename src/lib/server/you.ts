import 'server-only';
import { z } from 'zod';
import { asUser, type Queryable } from '@/lib/db';
import { addDays, addMonths, endOfMonth, startOfMonth, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { monthlyFlows } from '@/lib/engine/finance';
import { consistency, evaluate, tallyRange } from '@/lib/engine/metrics';
import { missionStreak, streakStats } from '@/lib/engine/streaks';
import { ACCENT_UNLOCKS, levelFromXp } from '@/lib/engine/xp';
import { ACHIEVEMENTS, type AchievementStats } from '@/lib/engine/achievements';
import { parseAmount } from '@/lib/engine/money';
import type { Viewer } from './profile';
import { firstActiveDay, loadAreas, loadCompletions, loadMissions, marksSpent, totalXp } from './load';
import { upsertXp } from './completions';
import { readRecords, type RecordKey } from './records';
import { loadFinance } from './money';
import { track } from './analytics';

export interface AchievementView {
  key: string;
  title: string;
  description: string;
  tier: 'bronze' | 'silver' | 'gold';
  unlockedOn: ISODate | null;
  isNew: boolean;
  progress: number;
  label: string;
  hidden: boolean;
}

export interface RewardView {
  id: string;
  title: string;
  cost: number;
  moneyMinor: number | null;
  moneyCurrency: string | null;
  redeemedCount: number;
  lastRedeemed: string | null;
}

export interface YouData {
  name: string;
  email: string;
  /** level comes from lifetime points, which never go down */
  level: ReturnType<typeof levelFromXp>;
  /** lifetime points minus what rewards spent */
  available: number;
  spent: number;
  streak: { current: number; best: number };
  accents: { accent: 'volt' | 'ember' | 'cobalt' | 'ivory'; name: string; level: number; unlocked: boolean }[];
  achievements: AchievementView[];
  rewards: RewardView[];
  records: { key: string; label: string; value: string; on: ISODate | null; href?: string }[];
  timeline: { id: string; day: ISODate; kind: string; title: string; detail: string | null }[];
  settings: {
    displayName: string; timezone: string; weekStartsOn: number; baseCurrency: string;
    theme: 'system' | 'dark' | 'light'; accent: 'volt' | 'ember' | 'cobalt' | 'ivory'; notificationLevel: 'off' | 'minimal' | 'balanced' | 'active';
    weightUnit: 'kg' | 'lb'; modules: string[]; worldVisible: boolean;
  };
  memberSince: ISODate;
}

async function achievementStats(q: Queryable, viewer: Viewer): Promise<{ stats: AchievementStats; streak: { current: number; best: number } }> {
  const today = viewer.today;
  const ws = viewer.profile.weekStartsOn;
  const first = (await firstActiveDay(q)) ?? today;
  const [missions, completions, areas, proofRows, keystones, xp, records, recordEvents] = await Promise.all([
    loadMissions(q, { includeArchived: true }),
    loadCompletions(q, addDays(first, -7), today, viewer.profile.timezone),
    loadAreas(q),
    q.query<{ captured_on: string }>(`select captured_on from proofs order by captured_on, created_at`),
    q.query<{ done_at: Date }>(`select done_at from keystones where status = 'done' order by done_at`),
    totalXp(q),
    readRecords(q),
    q.query<{ n: number }>(`select count(*)::int as n from timeline_events where kind = 'record'`),
  ]);
  const ev = evaluate(missions, completions, first, today, { today, weekStartsOn: ws });
  const st = streakStats(ev.days, today, viewer.profile.streakThreshold);

  let bestWeek: AchievementStats['bestWeekConsistency'] = null;
  const perfectWeeks: { end: ISODate }[] = [];
  for (let w = startOfWeek(first, ws); addDays(w, 6) < today; w = addDays(w, 7)) {
    const t = tallyRange(ev, w, addDays(w, 6));
    const c = consistency(t);
    if (c == null || t.settledDue < 10) continue;
    if (!bestWeek || c > bestWeek.value) bestWeek = { value: c, due: t.settledDue, end: addDays(w, 6) };
    if (t.kept === t.settledDue) perfectWeeks.push({ end: addDays(w, 6) });
  }

  // weekly targets: longest run of consecutive weeks met, and the week the 4th in a row closed
  let quotaBest = 0;
  let quotaEnded: ISODate | null = null;
  for (const [, mds] of ev.byMission) {
    if (!mds.some((m) => m.weekly)) continue;
    quotaBest = Math.max(quotaBest, missionStreak(mds, today).best);
    const weeks = new Map<ISODate, { done: number; quota: number; end: ISODate }>();
    for (const md of mds) {
      if (!md.weekly || md.day > today) continue;
      const w = weeks.get(md.weekly.weekStart);
      if (!w || md.weekly.done > w.done) weeks.set(md.weekly.weekStart, { done: md.weekly.done, quota: md.weekly.quota, end: md.weekly.weekEnd });
    }
    let run = 0;
    for (const [, w] of [...weeks.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      if (w.done >= w.quota) {
        run++;
        if (run === 4 && (!quotaEnded || w.end < quotaEnded)) quotaEnded = w.end < today ? w.end : today;
      } else if (w.end < today) run = 0;
    }
  }

  const areaKind = new Map(areas.map((a) => [a.id, a.kind]));
  const byArea: AchievementStats['keptByArea'] = {};
  const missionArea = new Map(missions.map((m) => [m.id, areaKind.get(m.areaId) ?? 'custom']));
  const missionMeasure = new Map(missions.map((m) => [m.id, m.measure]));
  for (const c of completions) {
    const k = missionArea.get(c.missionId) ?? 'custom';
    const a = (byArea[k] ??= { kept: 0, minutes: 0, hundredthHourOn: null, hundredthOn: null });
    if (c.kept) {
      a.kept++;
      if (a.kept === 100) a.hundredthOn = c.day;
    }
    if (missionMeasure.get(c.missionId) === 'duration' && c.value && c.outcome !== 'missed' && c.outcome !== 'skipped') {
      const before = a.minutes;
      a.minutes += c.value;
      if (before < 6000 && a.minutes >= 6000) a.hundredthHourOn = c.day;
    }
  }

  const [sessions, learning, champs, incomeTargets] = await Promise.all([
    q.query<{ performed_on: string }>(`select performed_on from workout_sessions where status = 'completed' order by performed_on, started_at`),
    q.query<{ performed_on: string; minutes: number | null }>(`select performed_on, minutes from learning_sessions where status = 'completed' order by performed_on, created_at`),
    q.query<{ ends_on: string }>(
      `select s.ends_on from group_awards a join group_seasons s on s.id = a.season_id where a.kind = 'champion' and a.user_id = $1 order by s.ends_on`,
      [viewer.userId],
    ),
    q.query<{ amount_minor: number; currency: string; created_at: Date }>(`select amount_minor, currency, created_at from finance_targets where kind = 'income' order by created_at`),
  ]);
  let learningMinutes = 0;
  let learningHundredHoursOn: ISODate | null = null;
  for (const l of learning) {
    const before = learningMinutes;
    learningMinutes += l.minutes ?? 0;
    if (before < 6000 && learningMinutes >= 6000) learningHundredHoursOn = l.performed_on;
  }
  const perfectMonths: { end: ISODate }[] = [];
  for (let m = startOfMonth(first); endOfMonth(m) < today; m = addMonths(m, 1)) {
    const t = tallyRange(ev, m, endOfMonth(m));
    if (t.settledDue >= 20 && t.kept === t.settledDue) perfectMonths.push({ end: endOfMonth(m) });
  }
  let incomeTargetMetOn: ISODate | null = null;
  if (incomeTargets.length) {
    const base = viewer.profile.baseCurrency;
    const f = await loadFinance(q, base);
    const months = monthlyFlows(f.txs, f.categoryMap, today, 24, { base, book: f.book });
    for (const t of incomeTargets) {
      const created = new Date(t.created_at).toISOString().slice(0, 7);
      const amount = f.book.convert(Number(t.amount_minor), t.currency, base, today)?.minor ?? Number(t.amount_minor);
      const hit = months.find((m) => m.month >= created && m.income >= amount);
      if (hit) {
        const on = hit.end < today ? hit.end : today;
        if (!incomeTargetMetOn || on < incomeTargetMetOn) incomeTargetMetOn = on;
      }
    }
  }

  const keptList = completions.filter((c) => c.kept);
  const longest = records.get('longest_run');
  const daily = await q.query<{ d: string; xp: number }>(`select occurred_on as d, sum(amount)::int8 as xp from xp_events group by occurred_on order by occurred_on`);
  const levelReachedOn: Record<number, ISODate> = {};
  let cum = 0;
  for (const row of daily) {
    const before = levelFromXp(cum).level;
    cum += Number(row.xp);
    const after = levelFromXp(cum).level;
    for (let l = before + 1; l <= after; l++) levelReachedOn[l] = row.d;
  }
  const stats: AchievementStats = {
    keptTotal: keptList.length,
    firstKeptOn: keptList[0]?.day ?? null,
    bestRun: Math.max(st.best, longest?.value ?? 0),
    bestRunEnd: longest && longest.value >= st.best ? longest.achievedOn : st.bestEnd,
    bestWeekConsistency: bestWeek,
    perfectWeeks,
    consecutiveQuotaWeeks: { best: quotaBest, endedOn: quotaEnded },
    comebacks: st.recoveries.filter((r) => r.days >= 3).map((r) => ({ on: r.recoveredOn })),
    keptByArea: byArea,
    proofs: proofRows.length,
    fiftiethProofOn: proofRows[49]?.captured_on ?? null,
    keystonesDone: keystones.length,
    fifthKeystoneOn: keystones[4] ? new Date(keystones[4].done_at).toISOString().slice(0, 10) : null,
    level: levelFromXp(xp).level,
    levelReachedOn,
    earlyKept: keptList.filter((c) => c.loggedHour != null && c.loggedHour < 8).length,
    recordsBroken: recordEvents[0]?.n ?? 0,
    workouts: {
      count: sessions.length,
      firstOn: sessions[0]?.performed_on ?? null,
      tenthOn: sessions[9]?.performed_on ?? null,
      hundredthOn: sessions[99]?.performed_on ?? null,
    },
    learningMinutes,
    learningHundredHoursOn,
    perfectMonths,
    championships: champs.map((c) => ({ on: c.ends_on })),
    incomeTargetMetOn,
  };
  return { stats, streak: { current: st.current, best: Math.max(st.best, longest?.value ?? 0) } };
}

/** Evaluate achievements, persist new unlocks (+ XP, + timeline), return the view. */
async function syncAchievements(q: Queryable, viewer: Viewer): Promise<{ list: AchievementView[]; streak: { current: number; best: number } }> {
  const { stats, streak } = await achievementStats(q, viewer);
  const stored = new Map(
    (await q.query<{ achievement_key: string; unlocked_on: string; seen_at: Date | null }>(`select achievement_key, unlocked_on, seen_at from achievement_unlocks`)).map((r) => [r.achievement_key, r]),
  );
  const out: AchievementView[] = [];
  for (const def of ACHIEVEMENTS) {
    if (def.legacy && !stored.has(def.key)) continue; // V1-only badges stay with the people who earned them
    const r = def.check(stats);
    let row = stored.get(def.key);
    if (!row && r.progress >= 1) {
      const on = r.on && r.on <= viewer.today ? r.on : viewer.today;
      await q.query(`insert into achievement_unlocks (achievement_key, unlocked_on) values ($1, $2) on conflict do nothing`, [def.key, on]);
      if (def.xp) await upsertXp(q, 'achievement', def.key, null, def.xp, on);
      await q.query(
        `insert into timeline_events (occurred_on, kind, title, detail, source_key) values ($1, 'achievement', $2, $3, $4) on conflict do nothing`,
        [on, def.title, def.description, def.key],
      );
      row = { achievement_key: def.key, unlocked_on: on, seen_at: null };
      void track(viewer.userId, 'achievement_unlocked', { key: def.key });
    }
    out.push({
      key: def.key,
      title: def.title,
      description: def.description,
      tier: def.tier,
      unlockedOn: row?.unlocked_on ?? null,
      isNew: !!row && !row.seen_at,
      progress: row ? 1 : r.progress,
      label: row ? 'Earned' : r.label,
      hidden: !!def.hidden && !row,
    });
  }
  await q.query(`update achievement_unlocks set seen_at = now() where seen_at is null`);
  return { list: out, streak };
}

export async function loadYou(viewer: Viewer): Promise<YouData> {
  return asUser(viewer.userId, async (q) => {
    const { list: achievements, streak } = await syncAchievements(q, viewer);
    const [xp, spent, stored, workoutStats, learningStats, rewards, timeline] = await Promise.all([
      totalXp(q),
      marksSpent(q),
      readRecords(q),
      q.query<{ best_week: number | null; best_week_start: string | null }>(
        `with w as (select date_trunc('week', performed_on)::date as wk, count(*)::int as n from workout_sessions where status = 'completed' group by 1)
         select (select max(n) from w) as best_week, (select wk::text from w order by n desc, wk limit 1) as best_week_start`,
      ),
      q.query<{ best_day: number | null; best_day_on: string | null }>(
        `with d as (select performed_on, sum(coalesce(minutes, 0))::int as m from learning_sessions where status = 'completed' group by 1)
         select (select max(m) from d) as best_day, (select performed_on::text from d order by m desc, performed_on limit 1) as best_day_on`,
      ),
      q.query<{ id: string; title: string; cost_marks: number; money_amount_minor: number | null; money_currency: string | null; n: number; last: Date | null }>(
        `select r.id, r.title, r.cost_marks, r.money_amount_minor, r.money_currency,
                (select count(*)::int from reward_redemptions x where x.reward_id = r.id) as n,
                (select max(redeemed_at) from reward_redemptions x where x.reward_id = r.id) as last
           from rewards r where r.archived_at is null order by r.cost_marks`,
      ),
      q.query<{ id: string; occurred_on: string; kind: string; title: string; detail: string | null }>(
        `select id, occurred_on, kind, title, detail from timeline_events order by occurred_on desc, created_at desc limit 40`,
      ),
    ]);
    const level = levelFromXp(xp);
    const p = viewer.profile;
    const records: YouData['records'] = [];
    if (streak.best > 0) records.push({ key: 'run', label: 'Longest streak', value: `${streak.best} day${streak.best === 1 ? '' : 's'}`, on: stored.get('longest_run')?.achievedOn ?? null });
    const rec = (k: RecordKey, label: string, fmt: (v: number) => string) => {
      const s = stored.get(k);
      if (s && s.value > 0) records.push({ key: k, label, value: fmt(s.value), on: s.achievedOn });
    };
    rec('best_day_kept', 'Most done in a day', (v) => `${v} routine${v === 1 ? '' : 's'}`);
    rec('best_week_execution', 'Best week', (v) => `${Math.round(v)}% done`);
    rec('most_xp_day', 'Most points in a day', (v) => Math.round(v).toLocaleString('en-US'));
    const w = workoutStats[0];
    if (w && Number(w.best_week) > 0) records.push({ key: 'gym-week', label: 'Most workouts in a week', value: String(w.best_week), on: w.best_week_start, href: '/gym/stats' });
    const l = learningStats[0];
    if (l && Number(l.best_day) > 0) {
      const m = Number(l.best_day);
      records.push({ key: 'learn-day', label: 'Longest learning day', value: m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`, on: l.best_day_on, href: '/learning' });
    }
    return {
      name: p.displayName,
      email: viewer.email,
      level,
      available: Math.max(0, xp - spent),
      spent,
      streak,
      records,
      accents: ACCENT_UNLOCKS.map((u) => ({ ...u, unlocked: level.level >= u.level })),
      achievements,
      rewards: rewards.map((r) => ({
        id: r.id, title: r.title, cost: r.cost_marks, moneyMinor: r.money_amount_minor == null ? null : Number(r.money_amount_minor),
        moneyCurrency: r.money_currency, redeemedCount: r.n, lastRedeemed: r.last ? new Date(r.last).toISOString().slice(0, 10) : null,
      })),
      timeline: timeline.map((t) => ({ id: t.id, day: t.occurred_on, kind: t.kind, title: t.title, detail: t.detail })),
      settings: {
        displayName: p.displayName, timezone: p.timezone, weekStartsOn: p.weekStartsOn, baseCurrency: p.baseCurrency,
        theme: p.theme, accent: p.accent, notificationLevel: p.notificationLevel, weightUnit: p.weightUnit, modules: p.modules,
        worldVisible: p.worldVisible,
      },
      memberSince: new Date(p.createdAt).toISOString().slice(0, 10),
    };
  });
}

// ───────────────────────────────────────────── rewards

const rewardInput = z.object({
  title: z.string().trim().min(1, 'Name the reward.').max(80),
  cost: z.number().int().min(10, 'At least 10 points.').max(10_000_000),
  money: z.string().trim().max(24).nullable().optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable().optional(),
});

export async function createReward(viewer: Viewer, raw: z.input<typeof rewardInput>) {
  const parsed = rewardInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the reward.' };
  const v = parsed.data;
  const currency = v.currency ?? viewer.profile.baseCurrency;
  const money = v.money ? parseAmount(v.money, currency) : null;
  if (v.money && (money == null || money <= 0)) return { ok: false as const, error: 'That price doesn’t look like an amount.' };
  await asUser(viewer.userId, (q) =>
    q.query(`insert into rewards (title, cost_marks, money_amount_minor, money_currency) values ($1, $2, $3, $4)`, [v.title, v.cost, money, money ? currency : null]),
  );
  void track(viewer.userId, 'reward_created', { priced: !!money });
  return { ok: true as const };
}

/**
 * Redeem: spend available points (lifetime points — and so the level — never drop). If the reward costs real money and the
 * user says so, log it as an expense flagged as earned, so the finance side stays true.
 */
export async function redeemReward(viewer: Viewer, rewardId: string, logExpense: { accountId: string } | null) {
  if (!z.uuid().safeParse(rewardId).success) return { ok: false as const, error: 'Invalid reward.' };
  const res = await asUser(viewer.userId, async (q) => {
    const [r] = await q.query<{ id: string; title: string; cost_marks: number; money_amount_minor: number | null; money_currency: string | null }>(
      `select id, title, cost_marks, money_amount_minor, money_currency from rewards where id = $1 and archived_at is null`,
      [rewardId],
    );
    if (!r) return { ok: false as const, error: 'Reward not found.' };
    const balance = (await totalXp(q)) - (await marksSpent(q));
    if (balance < r.cost_marks) return { ok: false as const, error: `You need ${(r.cost_marks - balance).toLocaleString('en-US')} more points.` };
    let txId: string | null = null;
    if (logExpense && r.money_amount_minor) {
      const [acct] = await q.query<{ id: string; currency: string }>(`select id, currency from accounts where id = $1 and archived_at is null`, [logExpense.accountId]);
      if (acct && acct.currency === r.money_currency) {
        const [cat] = await q.query<{ id: string }>(`select id from categories where kind = 'expense' and slug = 'entertainment'`);
        const [t] = await q.query<{ id: string }>(
          `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, category_id, counterparty, note, is_earned_reward, source)
           values ($1, 'expense', $2, $3, $4, $5, $6, 'Earned reward', true, 'app') returning id`,
          [acct.id, -Number(r.money_amount_minor), acct.currency, viewer.today, cat?.id ?? null, r.title],
        );
        txId = t.id;
      }
    }
    await q.query(`insert into reward_redemptions (reward_id, cost_marks, transaction_id) values ($1, $2, $3)`, [r.id, r.cost_marks, txId]);
    return { ok: true as const, title: r.title, balance: balance - r.cost_marks, logged: !!txId };
  });
  if (res.ok) void track(viewer.userId, 'reward_redeemed', { logged: res.logged });
  return res;
}
