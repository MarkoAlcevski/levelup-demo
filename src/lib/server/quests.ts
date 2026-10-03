import 'server-only';
import { z } from 'zod';
import { asSystem, asUser, type Queryable } from '@/lib/db';
import { addDays, startOfWeek, type ISODate } from '@/lib/engine/dates';
import { evaluate } from '@/lib/engine/metrics';
import {
  AUTO_REWARD, MAX_CUSTOM_PER_DAY, PAID_CUSTOM_PER_DAY, SWEEP_BONUS, customRewards, sweepDone,
  type QuestSize, type QuestView,
} from '@/lib/engine/quests';
import type { Viewer } from './profile';
import { loadCompletions, loadMissions } from './load';
import { track } from './analytics';

/**
 * Daily quests and the coin ledger. Auto quests are read from the record (never stored), so they
 * can't disagree with it; your own quests are rows you write. Coins are written by the server only
 * (owner role) into an idempotent ledger keyed by day + quest, so nothing is ever paid twice — and a
 * quest that stops being done today (a workout deleted, a quest unticked) gives its coins back.
 */

export interface QuestDay {
  day: ISODate;
  quests: QuestView[];
  coins: number;
  earnedToday: number;
  sweep: { done: boolean; paid: boolean; bonus: number };
  /** coins credited during this load, for the "+30" moment */
  granted: { key: string; amount: number; title: string }[];
  customCount: number;
  paidCustomLeft: number;
}

async function autoQuests(q: Queryable, viewer: Viewer, day: ISODate): Promise<QuestView[]> {
  const ws = viewer.profile.weekStartsOn;
  const from = addDays(startOfWeek(day, ws), -7);
  const [missions, completions, subjects, journal, program] = await Promise.all([
    loadMissions(q),
    loadCompletions(q, from, day, viewer.profile.timezone),
    q.query<{ mission_id: string; name: string; measure: string; unit: string | null; weekly_target: number; days_per_week: number }>(
      `select mission_id, name, measure, unit, weekly_target, days_per_week from learning_subjects where archived_at is null and mission_id is not null order by sort_order`,
    ),
    q.query<{ n: number }>(`select count(*)::int as n from journal_entries where day = $1 and (coalesce(did, '') <> '' or coalesce(notes, '') <> '')`, [day]),
    q.query<{ id: string }>(`select id from workout_programs where archived_at is null limit 1`),
  ]);
  const ev = evaluate(missions, completions, from, day, { today: viewer.today, weekStartsOn: ws });
  const idx = ev.days.length - 1;
  const at = (id: string) => ev.byMission.get(id)?.[idx] ?? null;
  const out: QuestView[] = [];

  const gym = missions.find((m) => m.module === 'gym');
  if (gym && program.length) {
    const md = at(gym.id);
    const done = !!md?.completion?.kept;
    if (md && (done || md.status === 'required' || md.status === 'flexible')) {
      const w = md.weekly;
      out.push({
        key: 'workout', kind: 'workout', reward: AUTO_REWARD.workout, done, paid: false, href: '/gym',
        required: md.status === 'required',
        title: md.status === 'required' || done ? 'Do today’s workout' : 'Train today',
        detail: w ? `${Math.min(w.done, w.quota)} of ${w.quota} this week${md.status === 'flexible' && !done ? ' · optional today' : ''}` : null,
      });
    }
  }

  for (const s of subjects) {
    const md = at(s.mission_id);
    if (!md) continue;
    const done = !!md.completion?.kept;
    if (!(done || md.status === 'required' || md.status === 'flexible')) continue;
    const perDay = s.measure === 'sessions' ? null : Math.round((Number(s.weekly_target) / s.days_per_week) * 10) / 10;
    const unit = s.measure === 'minutes' ? 'min' : s.measure === 'custom' ? s.unit ?? '' : s.measure;
    out.push({
      key: `learning:${s.mission_id}`, kind: 'learning', reward: AUTO_REWARD.learning, done, paid: false, href: '/learning',
      required: md.status === 'required',
      title: `Study ${s.name}`,
      detail: `${perDay != null ? `${perDay} ${unit} today` : 'One session'}${md.status === 'flexible' && !done ? ' · optional today' : ''}`,
    });
  }

  const planned = missions.filter((m) => !m.module).map((m) => at(m.id)).filter((md) => md && md.status === 'required');
  if (planned.length) {
    const kept = planned.filter((md) => md!.completion && (md!.completion.kept || md!.completion.outcome === 'skipped')).length;
    out.push({
      key: 'plan', kind: 'plan', reward: AUTO_REWARD.plan, done: kept === planned.length, paid: false, required: true, href: '/today',
      title: 'Clear today’s plan', detail: `${kept} of ${planned.length} done`,
    });
  }

  out.push({
    key: 'journal', kind: 'journal', reward: AUTO_REWARD.journal, done: (journal[0]?.n ?? 0) > 0, paid: false, required: true, href: `/journal/${day}`,
    title: 'Write in your journal', detail: 'A line is enough',
  });
  return out;
}

/** Credit what's done and not yet paid; take back what was paid but is no longer done (this day only). */
async function reconcile(viewer: Viewer, day: ISODate, quests: QuestView[]): Promise<{ granted: QuestDay['granted']; sweep: QuestDay['sweep'] }> {
  const granted: QuestDay['granted'] = [];
  const result = await asSystem(async (q) => {
    const rows = await q.query<{ source: string; source_key: string; amount: number }>(
      `select source, source_key, amount from public.coin_events where user_id = $1 and source in ('quest', 'bonus') and source_key like $2`,
      [viewer.userId, `${day}:%`],
    );
    const paid = new Map(rows.map((r) => [`${r.source}|${r.source_key}`, Number(r.amount)]));
    for (const quest of quests) {
      const k = `quest|${day}:${quest.key}`;
      const has = paid.has(k);
      if (quest.done && quest.reward > 0 && !has) {
        await q.query(
          `insert into public.coin_events (user_id, source, source_key, amount, occurred_on) values ($1, 'quest', $2, $3, $4) on conflict do nothing`,
          [viewer.userId, `${day}:${quest.key}`, quest.reward, day],
        );
        granted.push({ key: quest.key, amount: quest.reward, title: quest.title });
        quest.paid = true;
      } else if (!quest.done && has) {
        await q.query(`delete from public.coin_events where user_id = $1 and source = 'quest' and source_key = $2`, [viewer.userId, `${day}:${quest.key}`]);
        quest.paid = false;
      } else quest.paid = has && quest.done;
    }
    // paid quests that no longer exist today (a custom quest deleted) give their coins back
    const keys = new Set(quests.map((x) => `quest|${day}:${x.key}`));
    for (const r of rows) {
      if (r.source === 'quest' && !keys.has(`quest|${r.source_key}`)) {
        await q.query(`delete from public.coin_events where user_id = $1 and source = 'quest' and source_key = $2`, [viewer.userId, r.source_key]);
      }
    }
    const sweepKey = `bonus|${day}:sweep`;
    const done = sweepDone(quests);
    const hasSweep = paid.has(sweepKey);
    if (done && !hasSweep) {
      await q.query(
        `insert into public.coin_events (user_id, source, source_key, amount, occurred_on) values ($1, 'bonus', $2, $3, $4) on conflict do nothing`,
        [viewer.userId, `${day}:sweep`, SWEEP_BONUS, day],
      );
      granted.push({ key: 'sweep', amount: SWEEP_BONUS, title: 'Every quest done' });
    } else if (!done && hasSweep) {
      await q.query(`delete from public.coin_events where user_id = $1 and source = 'bonus' and source_key = $2`, [viewer.userId, `${day}:sweep`]);
    }
    return { done, paid: done };
  });
  return { granted, sweep: { ...result, bonus: SWEEP_BONUS } };
}

export async function coinBalance(q: Queryable): Promise<number> {
  const [r] = await q.query<{ n: number }>(`select coalesce(sum(amount), 0)::int as n from coin_events`);
  return Number(r?.n ?? 0);
}

export async function loadQuestDay(viewer: Viewer, day: ISODate = viewer.today): Promise<QuestDay> {
  const { auto, custom } = await asUser(viewer.userId, async (q) => {
    const [auto, custom] = await Promise.all([
      autoQuests(q, viewer, day),
      q.query<{ id: string; title: string; size: QuestSize; done_at: Date | null }>(`select id, title, size, done_at from quests where day = $1 order by created_at`, [day]),
    ]);
    return { auto, custom };
  });
  const rewards = customRewards(custom);
  const mine: QuestView[] = custom.map((c, i) => ({
    key: `custom:${c.id}`, kind: 'custom', id: c.id, size: c.size, title: c.title, detail: rewards[i] ? null : 'For you — beyond today’s five paid quests',
    reward: rewards[i], done: !!c.done_at, required: true, paid: false,
  }));
  const quests = [...auto, ...mine];
  const { granted, sweep } = await reconcile(viewer, day, quests);
  if (granted.length) void track(viewer.userId, 'quest_completed', { count: granted.length });
  const { coins, earned } = await asUser(viewer.userId, async (q) => {
    const [r] = await q.query<{ earned: number }>(`select coalesce(sum(amount), 0)::int as earned from coin_events where occurred_on = $1 and amount > 0`, [day]);
    return { coins: await coinBalance(q), earned: Number(r?.earned ?? 0) };
  });
  return {
    day, quests, coins, earnedToday: earned, sweep, granted,
    customCount: custom.length, paidCustomLeft: Math.max(0, PAID_CUSTOM_PER_DAY - custom.length),
  };
}

const questInput = z.object({
  title: z.string().trim().min(1, 'Name the quest.').max(80),
  size: z.enum(['small', 'medium', 'big']).default('medium'),
});

export async function addQuest(viewer: Viewer, raw: z.input<typeof questInput>) {
  const parsed = questInput.safeParse(raw);
  if (!parsed.success) return { ok: false as const, error: parsed.error.issues[0]?.message ?? 'Check the quest.' };
  const res = await asUser(viewer.userId, async (q) => {
    const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from quests where day = $1`, [viewer.today]);
    if (n >= MAX_CUSTOM_PER_DAY) return { ok: false as const, error: `That’s ${MAX_CUSTOM_PER_DAY} quests today — finish some first.` };
    const [row] = await q.query<{ id: string }>(`insert into quests (day, title, size) values ($1, $2, $3) returning id`, [viewer.today, parsed.data.title, parsed.data.size]);
    return { ok: true as const, id: row.id };
  });
  if (res.ok) void track(viewer.userId, 'quest_created', { size: parsed.data.size });
  return res;
}

/** Tick or untick one of your own quests (today only); coins follow on the next load. */
export async function setQuestDone(viewer: Viewer, id: string, done: boolean) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid quest.' };
  const rows = await asUser(viewer.userId, (q) =>
    q.query(`update quests set done_at = ${done ? 'coalesce(done_at, now())' : 'null'} where id = $1 and day = $2 returning id`, [id, viewer.today]),
  );
  return rows.length ? { ok: true as const } : { ok: false as const, error: 'Only today’s quests can be changed.' };
}

export async function deleteQuest(viewer: Viewer, id: string) {
  if (!z.uuid().safeParse(id).success) return { ok: false as const, error: 'Invalid quest.' };
  await asUser(viewer.userId, (q) => q.query(`delete from quests where id = $1 and day = $2`, [id, viewer.today]));
  return { ok: true as const };
}
