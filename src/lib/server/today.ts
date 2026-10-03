import 'server-only';
import { asUser } from '@/lib/db';
import { addDays, diffDays, formatDay, greetingFor, isoWeekNumber, startOfWeek, weekdayName, type ISODate } from '@/lib/engine/dates';
import { evaluate } from '@/lib/engine/metrics';
import { describeCadence, type SlotStatus, type WeeklyState } from '@/lib/engine/schedule';
import { missionStreak, streakStats } from '@/lib/engine/streaks';
import { completionXp, levelFromXp, type LevelInfo } from '@/lib/engine/xp';
import type { AreaKind, Difficulty, Measure, Outcome, ProofPolicy } from '@/lib/engine/types';
import { isGymKind } from '@/lib/modules';
import type { Viewer } from './context';
import { loadAreas, loadCompletions, loadMissions, totalXp, xpBetween } from './load';
import { readKeystone, type Keystone } from './keystone';
import { ensureWeeklyReviews, latestUnviewedReview } from './reviews';
import { loadGymToday, type GymToday } from './gym';
import { loadLearningToday, type LearningToday } from './learning';

/**
 * Today answers one question: what do I need to do today?
 * Gym looks like Gym (next workout, Start), Learning looks like Learning (target, Start / Log),
 * everything else is a checkable routine or task. Scores live in Progress; points appear as feedback.
 */

export interface TodayMission {
  id: string;
  title: string;
  areaId: string;
  areaKind: AreaKind;
  areaName: string;
  areaIcon: string | null;
  measure: Measure;
  unit: string | null;
  target: number | null;
  minimum: number | null;
  minimumLabel: string | null;
  exceedRatio: number;
  difficulty: Difficulty;
  proofPolicy: ProofPolicy;
  timeOfDay: 'morning' | 'afternoon' | 'evening' | null;
  isPriority: boolean;
  isTask: boolean;
  status: SlotStatus;
  inRing: boolean;
  cadence: string;
  dueOn: ISODate | null;
  completion: { outcome: Outcome; value: number | null; kept: boolean; credit: number; proofs: number; id: string } | null;
  weekly: WeeklyState | null;
  streak: { current: number; unit: 'day' | 'week' };
  points: number;
}

export type RingSegment = 'exceeded' | 'full' | 'minimum' | 'partial' | 'missed' | 'open' | 'excused';

export interface TodayData {
  today: ISODate;
  dateLabel: string;
  greeting: string;
  name: string;
  weekNumber: number;
  daysLeftInWeek: number;
  level: LevelInfo;
  pointsToday: number;
  streak: number;
  modules: ('gym' | 'learning' | 'money')[];
  /** Gym + Learning routines in today's plan (required today, or done today). Routine rows are counted on the client. */
  moduleProgress: { done: number; total: number; segments: RingSegment[] };
  focus: Keystone | null;
  gym: GymToday | null;
  gymMissionId: string | null;
  learning: LearningToday[];
  /** routine / task groups by area */
  groups: { id: string; name: string; kind: AreaKind; icon: string | null; missions: TodayMission[] }[];
  anyDay: TodayMission[];
  done: TodayMission[];
  journal: { written: boolean; plan: string | null };
  reviewReady: { id: string; label: string } | null;
  setup: { gym: boolean; learning: boolean; money: boolean; areas: boolean };
  firstDay: boolean;
}

const HISTORY_DAYS = 60;

export async function loadToday(viewer: Viewer): Promise<TodayData> {
  const { today, profile } = viewer;
  const ws = profile.weekStartsOn;
  const from = addDays(today, -(HISTORY_DAYS - 1));

  await ensureWeeklyReviews(viewer).catch((e) => console.error('[kept] review generation failed', e));

  return asUser(viewer.userId, async (q) => {
    const [areas, missions, completions, xpAll, xpToday, keystone, proofCounts, review, journal, counts] = await Promise.all([
      loadAreas(q),
      loadMissions(q, { includeArchived: true }),
      loadCompletions(q, addDays(from, -7), today, profile.timezone),
      totalXp(q),
      xpBetween(q, today, today),
      readKeystone(q, startOfWeek(today, ws)),
      q.query<{ completion_id: string; n: number }>(
        `select p.completion_id, count(*)::int as n from proofs p join completions c on c.id = p.completion_id
          where c.occurred_on = $1 group by p.completion_id`,
        [today],
      ),
      latestUnviewedReview(q),
      q.query<{ day: string; plan: string | null; did: string | null; notes: string | null }>(
        `select day, plan, did, notes from journal_entries where day in ($1, $2)`,
        [today, addDays(today, -1)],
      ),
      q.query<{ accounts: number; programs: number; subjects: number }>(
        `select (select count(*) from accounts where archived_at is null)::int as accounts,
                (select count(*) from workout_programs where archived_at is null)::int as programs,
                (select count(*) from learning_subjects where archived_at is null)::int as subjects`,
      ),
    ]);
    const proofsBy = new Map(proofCounts.map((r) => [r.completion_id, r.n]));
    const areaById = new Map(areas.map((a) => [a.id, a]));
    const keystoneIds = new Set(keystone?.missionId ? [keystone.missionId] : []);
    const ev = evaluate(missions, completions, from, today, { today, weekStartsOn: ws, keystoneMissionIds: keystoneIds });
    const todayIdx = ev.days.length - 1;

    const active = missions.filter((m) => !m.archivedAt && areaById.has(m.areaId));
    const statusOf = new Map<string, SlotStatus>();
    const rows: TodayMission[] = [];
    let gymMissionId: string | null = null;
    for (const m of active) {
      const mds = ev.byMission.get(m.id)!;
      const md = mds[todayIdx];
      statusOf.set(m.id, md.status);
      if (m.module === 'gym') gymMissionId = m.id;
      if (m.module) continue;
      const area = areaById.get(m.areaId)!;
      const c = md.completion;
      const version = m.current;
      const s = missionStreak(mds, today);
      rows.push({
        id: m.id,
        title: m.title,
        areaId: m.areaId,
        areaKind: area.kind,
        areaName: area.name,
        areaIcon: area.icon,
        measure: m.measure,
        unit: m.unit,
        target: m.targetValue,
        minimum: m.minimumValue,
        minimumLabel: m.minimumLabel,
        exceedRatio: m.exceedRatio,
        difficulty: m.difficulty,
        proofPolicy: m.proofPolicy,
        timeOfDay: m.timeOfDay,
        isPriority: m.isPriority,
        isTask: version?.cadence === 'once',
        status: md.status,
        inRing: md.status === 'required' && (version?.cadence !== 'once' || md.dueOn === today),
        cadence: describeCadence(version),
        dueOn: md.dueOn,
        completion: c && c.id
          ? { outcome: c.outcome, value: c.value, kept: c.kept, credit: c.credit, proofs: proofsBy.get(c.id) ?? 0, id: c.id }
          : null,
        weekly: md.weekly,
        streak: { current: s.current, unit: s.unit },
        points: completionXp(m.difficulty, 'full'),
      });
    }

    // module cards
    const gymKeptToday = gymMissionId ? !!ev.byMission.get(gymMissionId)![todayIdx].completion?.kept : false;
    const gym = profile.modules.includes('gym') || counts[0].programs ? await loadGymToday(q, viewer, gymKeptToday) : null;
    const learning = await loadLearningToday(q, viewer, (id) => statusOf.get(id) ?? null);

    // Rows never jump groups when completed: the plan decides where they live.
    const visible = (r: TodayMission) => r.status === 'required' || r.status === 'overdue';
    const doneToday = (r: TodayMission) => !!r.completion && r.completion.outcome !== 'missed';
    const groups: TodayData['groups'] = [];
    for (const a of areas) {
      const list = rows.filter((r) => r.areaId === a.id && visible(r));
      if (!list.length) continue;
      list.sort((x, y) => Number(y.isPriority) - Number(x.isPriority));
      groups.push({ id: a.id, name: isGymKind(a.kind) ? a.name : a.name, kind: a.kind, icon: a.icon, missions: list });
    }
    const anyDay = rows.filter((r) => r.status === 'flexible' && !doneToday(r));
    const done = rows.filter((r) => !visible(r) && ((r.status === 'flexible' && doneToday(r)) || r.status === 'extra' || (r.weekly && r.weekly.done >= r.weekly.quota)));

    // module progress: gym + learning routines required today or done today
    const segments: RingSegment[] = [];
    let total = 0;
    let kept = 0;
    const push = (outcome: Outcome | null, counts: boolean) => {
      if (!counts) return;
      if (outcome === 'skipped') {
        segments.push('excused');
        return;
      }
      total++;
      if (outcome === 'full' || outcome === 'exceeded' || outcome === 'minimum') kept++;
      segments.push(outcome ?? 'open');
    };
    for (const m of active.filter((x) => x.module)) {
      const md = ev.byMission.get(m.id)![todayIdx];
      const inPlan = md.status === 'required' || !!md.completion?.kept;
      push(md.completion?.outcome ?? null, inPlan);
    }

    const st = streakStats(ev.days, today, profile.streakThreshold);
    const hasProgram = counts[0].programs > 0;
    const everCompleted = completions.some((c) => c.kept);
    const customAreas = areas.filter((a) => !isGymKind(a.kind) && a.kind !== 'learning');
    return {
      today,
      dateLabel: `${weekdayName(today, true)}, ${formatDay(today)}`,
      greeting: greetingFor(viewer.hour),
      name: profile.displayName,
      weekNumber: isoWeekNumber(today),
      daysLeftInWeek: diffDays(today, addDays(startOfWeek(today, ws), 6)) + 1,
      level: levelFromXp(xpAll),
      pointsToday: xpToday,
      streak: st.current,
      modules: profile.modules,
      moduleProgress: { done: kept, total, segments },
      focus: keystone,
      gym,
      gymMissionId,
      learning,
      groups,
      anyDay,
      done,
      journal: (() => {
        const mine = journal.find((j) => j.day === today);
        const before = journal.find((j) => j.day !== today);
        // "what you wanted to do today" is what you wrote yesterday under "What I want to do"
        return { written: !!(mine?.did || mine?.notes || mine?.plan), plan: before?.plan?.trim() ? before.plan : null };
      })(),
      reviewReady: review,
      setup: {
        gym: profile.modules.includes('gym') && !hasProgram,
        learning: profile.modules.includes('learning') && counts[0].subjects === 0,
        money: profile.modules.includes('money') && counts[0].accounts === 0,
        areas: customAreas.length === 0 && !rows.length,
      },
      firstDay: !everCompleted,
    };
  });
}
