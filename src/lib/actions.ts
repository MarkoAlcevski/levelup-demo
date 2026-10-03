'use server';

import { timingSafeEqual } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { demoMode, inviteCode } from '@/lib/config';
import { allow } from '@/lib/server/rate-limit';
import { redirect } from 'next/navigation';
import { refresh } from 'next/cache';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { safeTimeZone } from '@/lib/engine/dates';
import { signIn, signOut, signUp, startSessionFor } from '@/lib/auth/session';
import { viewerOrNull } from '@/lib/server/context';
import { archiveMission, createMission, updateMission, type MissionInput } from '@/lib/server/missions';
import { completeOnboarding, type OnboardingInput } from '@/lib/server/onboarding';
import { setKeystone, setKeystoneStatus } from '@/lib/server/keystone';
import {
  createAccount, createTransaction, deleteTransaction, loadMoneyForm, loadTransaction, reconcileAccount, setAccountArchived,
  setValuation, updateAccount, updateTransaction, type MoneyFormOptions, type TxDetail, type TxEditInput, type TxInput,
} from '@/lib/server/money';
import {
  archiveTarget, removeBudget, saveBudget, saveMonthPlan, saveRecurring, saveTarget, setRecurringStatus, type SeriesInput, type TargetInput,
} from '@/lib/server/money-plan';
import { addGoalCheckin, createGoal, dropGoal, type GoalInput } from '@/lib/server/goals';
import { loadDay, type DayDetail } from '@/lib/server/progress';
import { listEvidence, deleteProof } from '@/lib/server/proofs';
import { loadAreas } from '@/lib/server/load';
import {
  archiveArea, createArea, createProject, reorderAreas, restoreArea, setProjectStatus, updateArea, type AreaInput,
} from '@/lib/server/areas';
import {
  createCustomExercise, ensureCatalogExercise, listMyExercises, loadStartData, loadGymDay, loadGymHistory, logBodyweight, quickLogWorkout, saveWorkoutDay, setupGym, updateProgram,
  type GymDayDetail, type MyExercise, type ProgramInput, type WorkoutDayInput, type WorkoutSummary,
} from '@/lib/server/gym';
import {
  adoptRoutineAsSubject, archiveSubject, createSubject, deleteLearningSession, finishLearningSession, listSubjectsFor, logLearningSession,
  startLearningSession, updateSubject, type LearningSessionInput, type SubjectInput,
} from '@/lib/server/learning';
import { saveJournal, type JournalInput } from '@/lib/server/journal';
import {
  archiveGroup, createGroup, endSeasonNow, joinGroup, leaveGroup, linkMembership, linkOptions, previewGroup, removeMember,
  setProofShared, updateGroupSettings, updateMyMembership, type GroupInput, type LinkOption,
} from '@/lib/server/groups';
import { track } from '@/lib/server/analytics';

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const UNAUTH = { ok: false as const, error: 'You’re signed out. Sign in again.' };

async function authed<T>(fn: (v: NonNullable<Awaited<ReturnType<typeof viewerOrNull>>>) => Promise<T>, andRefresh = true): Promise<T | typeof UNAUTH> {
  const v = await viewerOrNull();
  if (!v) return UNAUTH;
  const res = await fn(v);
  if (andRefresh && (res as { ok?: boolean })?.ok !== false) refresh();
  return res;
}

// ───────────────────────────────────────────── auth

const credentials = z.object({
  email: z.email('Enter a valid email address.').max(254),
  password: z.string().min(8, 'Use at least 8 characters.').max(200),
});

export interface AuthState {
  error?: string;
  field?: 'email' | 'password' | 'invite';
  email?: string;
}

export async function signUpAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get('email') ?? '');
  const required = inviteCode();
  if (required) {
    const given = String(form.get('invite') ?? '').trim().toLowerCase();
    const a = Buffer.from(given);
    const b = Buffer.from(required.toLowerCase());
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { error: 'That invite code isn’t right. Ask whoever sent you the link.', field: 'invite', email };
    }
  }
  const parsed = credentials.safeParse({ email, password: form.get('password') });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { error: issue.message, field: issue.path[0] === 'email' ? 'email' : 'password', email };
  }
  const tz = safeTimeZone(String(form.get('timezone') ?? 'UTC'));
  const res = await signUp(parsed.data.email, parsed.data.password, tz);
  if (!res.ok) return { error: res.error, field: res.field, email };
  void track(res.userId, 'account_created', {}, 'web');
  const next = String(form.get('next') ?? '');
  redirect(next.startsWith('/groups/join/') ? `/onboarding?next=${encodeURIComponent(next)}` : '/onboarding');
}

export async function signInAction(_: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get('email') ?? '');
  const password = String(form.get('password') ?? '');
  if (!email || !password) return { error: 'Enter your email and password.', email };
  const res = await signIn(email, password);
  if (!res.ok) return { error: res.error, email };
  const next = String(form.get('next') ?? '');
  redirect(next.startsWith('/') && !next.startsWith('//') ? next : '/today');
}

export async function signOutAction() {
  await signOut();
  redirect('/login');
}

/**
 * "Explore the demo". Shared mode rebuilds one demo account (local development); sandbox mode
 * gives every visitor their own private demo, deleted after 24 hours (hosted).
 */
export async function startDemoAction() {
  const mode = demoMode();
  if (mode === 'off') redirect('/login');
  const seed = await import('@/lib/server/seed');
  let userId: string;
  if (mode === 'sandbox') {
    const h = await headers();
    const ip = (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim();
    if (!allow(`demo:${ip}`, 6, 3_600_000)) redirect('/login?demo=busy');
    userId = await seed.createDemoSandbox();
  } else {
    const password = process.env.KEPT_DEMO_PASSWORD!;
    userId = await seed.seedDemo(process.env.KEPT_DEMO_EMAIL || 'demo@kept.local', password);
  }
  await startSessionFor(userId);
  void track(userId, 'demo_started', { mode }, 'web');
  redirect('/today');
}

// ───────────────────────────────────────────── onboarding

export async function completeOnboardingAction(input: OnboardingInput, next?: string | null): Promise<Result> {
  const v = await viewerOrNull();
  if (!v) return UNAUTH;
  const res = await completeOnboarding(v, input);
  if (!res.ok) return res;
  redirect(next && next.startsWith('/groups/join/') ? next : '/today');
}

// ───────────────────────────────────────────── routines & tasks

export async function saveMissionAction(id: string | null, input: MissionInput): Promise<Result<{ id: string }>> {
  return authed((v) => (id ? updateMission(v, id, input) : createMission(v, input)));
}

export async function archiveMissionAction(id: string): Promise<Result> {
  return authed((v) => archiveMission(v, id));
}

export async function getAreasAction(): Promise<{ id: string; kind: string; name: string; icon: string | null }[]> {
  const v = await viewerOrNull();
  if (!v) return [];
  return asUser(v.userId, (q) => loadAreas(q));
}

// ───────────────────────────────────────────── areas, projects, goals

export async function createAreaAction(input: AreaInput): Promise<Result<{ id: string }>> {
  return authed((v) => createArea(v, input));
}
export async function updateAreaAction(id: string, input: { name: string; icon?: string | null }): Promise<Result> {
  return authed((v) => updateArea(v, id, input));
}
export async function reorderAreasAction(ids: string[]): Promise<Result> {
  return authed((v) => reorderAreas(v, ids));
}
export async function archiveAreaAction(id: string): Promise<Result> {
  return authed((v) => archiveArea(v, id));
}
export async function restoreAreaAction(id: string): Promise<Result> {
  return authed((v) => restoreArea(v, id));
}
export async function createProjectAction(input: { areaId: string; title: string; targetOn?: string | null }): Promise<Result<{ id: string }>> {
  return authed((v) => createProject(v, input));
}
export async function setProjectStatusAction(id: string, status: 'active' | 'done' | 'dropped'): Promise<Result> {
  return authed((v) => setProjectStatus(v, id, status));
}
export async function createGoalAction(input: GoalInput): Promise<Result> {
  return authed((v) => createGoal(v, input));
}
export async function goalCheckinAction(goalId: string, value: number): Promise<Result> {
  return authed((v) => addGoalCheckin(v, { goalId, value }));
}
export async function dropGoalAction(id: string): Promise<Result> {
  return authed((v) => dropGoal(v, id));
}

// ───────────────────────────────────────────── weekly focus

export async function setKeystoneAction(input: { title: string; missionId?: string | null; week?: 'current' | 'next' }): Promise<Result> {
  return authed((v) => setKeystone(v, input));
}

export async function keystoneStatusAction(id: string, done: boolean): Promise<Result<{ xp?: number }>> {
  return authed((v) => setKeystoneStatus(v, id, done));
}

// ───────────────────────────────────────────── gym

export async function setupGymAction(input: ProgramInput): Promise<Result<{ id: string; adopted: boolean }>> {
  return authed((v) => setupGym(v, input));
}
export async function updateProgramAction(input: ProgramInput): Promise<Result> {
  return authed((v) => updateProgram(v, input));
}
export async function saveWorkoutDayAction(dayId: string, input: WorkoutDayInput): Promise<Result> {
  return authed((v) => saveWorkoutDay(v, dayId, input));
}
export async function createExerciseAction(input: { name: string; muscle?: string | null; equipment?: string | null }): Promise<Result<{ id: string; name: string }>> {
  return authed((v) => createCustomExercise(v, input as Parameters<typeof createCustomExercise>[1]), false);
}
export async function ensureExerciseAction(catalogKey: string): Promise<Result<{ id: string }>> {
  return authed((v) => ensureCatalogExercise(v, catalogKey), false);
}
export async function listExercisesAction(): Promise<MyExercise[]> {
  const v = await viewerOrNull();
  return v ? listMyExercises(v) : [];
}
export async function gymStartAction() {
  const v = await viewerOrNull();
  return v ? loadStartData(v) : null;
}
export async function gymDayAction(day: string): Promise<GymDayDetail | null> {
  const v = await viewerOrNull();
  if (!v || !z.iso.date().safeParse(day).success) return null;
  return loadGymDay(v, day);
}
export async function gymHistoryAction(cursor: string | null) {
  const v = await viewerOrNull();
  return v ? loadGymHistory(v, cursor) : { items: [], next: null };
}
export async function logBodyweightAction(weight: number, on: string): Promise<Result> {
  return authed((v) => logBodyweight(v, { weight, on }));
}

// ───────────────────────────────────────────── learning

export async function createSubjectAction(input: SubjectInput): Promise<Result<{ id: string }>> {
  return authed((v) => createSubject(v, input));
}
export async function updateSubjectAction(id: string, input: SubjectInput): Promise<Result> {
  return authed((v) => updateSubject(v, id, input));
}
export async function archiveSubjectAction(id: string): Promise<Result> {
  return authed((v) => archiveSubject(v, id));
}
export async function adoptRoutineAction(missionId: string): Promise<Result> {
  return authed((v) => adoptRoutineAsSubject(v, missionId));
}
export async function quickWorkoutAction(): Promise<Result<{ summary: WorkoutSummary }>> {
  return authed((v) => quickLogWorkout(v));
}
export async function logLearningAction(input: LearningSessionInput, id?: string): Promise<Result<{ id: string; week: { done: number; target: number }; subjectName: string }>> {
  return authed((v) => logLearningSession(v, input, id));
}
export async function startLearningAction(subjectId: string): Promise<Result<{ id: string }>> {
  return authed((v) => startLearningSession(v, subjectId));
}
export async function finishLearningAction(id: string, input: { minutes?: number | null; quantity?: number | null; topic?: string | null; note?: string | null }): Promise<Result<{ id: string; week: { done: number; target: number }; subjectName: string }>> {
  return authed((v) => finishLearningSession(v, id, input));
}
export async function deleteLearningAction(id: string): Promise<Result> {
  return authed((v) => deleteLearningSession(v, id));
}
export async function subjectsAction() {
  const v = await viewerOrNull();
  return v ? listSubjectsFor(v) : [];
}

// ───────────────────────────────────────────── journal

export async function saveJournalAction(input: JournalInput): Promise<Result<{ savedAt: string }>> {
  const v = await viewerOrNull();
  if (!v) return UNAUTH;
  return saveJournal(v, input); // autosave: no refresh, the page already shows what was typed
}

// ───────────────────────────────────────────── money

export async function moneyFormAction(): Promise<MoneyFormOptions | null> {
  const v = await viewerOrNull();
  if (!v) return null;
  return loadMoneyForm(v);
}
export async function createTransactionAction(input: TxInput): Promise<Result<{ id: string }>> {
  return authed((v) => createTransaction(v, input));
}
export async function updateTransactionAction(id: string, input: TxEditInput): Promise<Result> {
  return authed((v) => updateTransaction(v, id, input));
}
export async function deleteTransactionAction(id: string): Promise<Result> {
  return authed((v) => deleteTransaction(v, id));
}
export async function transactionDetailAction(id: string): Promise<TxDetail | null> {
  const v = await viewerOrNull();
  return v ? loadTransaction(v, id) : null;
}
export async function createAccountAction(input: { name: string; type: string; institution?: string | null; currency: string; balance: string }): Promise<Result> {
  return authed((v) => createAccount(v, input as Parameters<typeof createAccount>[1]));
}
export async function updateAccountAction(id: string, input: { name: string; type: string; institution?: string | null; isLiquid: boolean; includeInNetWorth: boolean }): Promise<Result> {
  return authed((v) => updateAccount(v, id, input as Parameters<typeof updateAccount>[2]));
}
export async function archiveAccountAction(id: string, archived: boolean): Promise<Result> {
  return authed((v) => setAccountArchived(v, id, archived));
}
export async function reconcileAccountAction(id: string, actual: string): Promise<Result<{ diff: number; currency: string }>> {
  return authed((v) => reconcileAccount(v, id, actual));
}
export async function valuationAction(id: string, value: string): Promise<Result> {
  return authed((v) => setValuation(v, id, value));
}
export async function saveRecurringAction(id: string | null, input: SeriesInput): Promise<Result> {
  return authed((v) => saveRecurring(v, id, input));
}
export async function recurringStatusAction(id: string, status: 'active' | 'paused' | 'ended'): Promise<Result> {
  return authed((v) => setRecurringStatus(v, id, status));
}
export async function saveBudgetAction(input: { categoryId: string | null; amount: string; currency: string }): Promise<Result> {
  return authed((v) => saveBudget(v, input));
}
export async function removeBudgetAction(id: string): Promise<Result> {
  return authed((v) => removeBudget(v, id));
}
export async function saveTargetAction(id: string | null, input: TargetInput): Promise<Result> {
  return authed((v) => saveTarget(v, id, input));
}
export async function archiveTargetAction(id: string): Promise<Result> {
  return authed((v) => archiveTarget(v, id));
}
export async function saveMonthPlanAction(input: { expectedIncome: string; plannedSavings: string; plannedInvestments: string; note?: string | null }): Promise<Result> {
  return authed((v) => saveMonthPlan(v, input));
}

// ───────────────────────────────────────────── groups

export async function createGroupAction(input: GroupInput): Promise<Result<{ id: string }>> {
  return authed((v) => createGroup(v, input));
}
export async function previewGroupAction(code: string) {
  const v = await viewerOrNull();
  return v ? previewGroup(v, code) : null;
}
export async function joinGroupAction(code: string, displayName: string): Promise<Result<{ id: string }>> {
  return authed((v) => joinGroup(v, code, displayName));
}
export async function linkOptionsAction(kind: 'gym' | 'learning' | 'custom'): Promise<LinkOption[]> {
  const v = await viewerOrNull();
  return v ? linkOptions(v, kind) : [];
}
export async function linkMembershipAction(groupId: string, input: { missionId: string; target: number; proofShare?: 'never' | 'ask' | 'auto' }): Promise<Result> {
  return authed((v) => linkMembership(v, groupId, input));
}
export async function updateMembershipAction(groupId: string, input: { displayName: string; target?: number | null; proofShare: 'never' | 'ask' | 'auto' }): Promise<Result> {
  return authed((v) => updateMyMembership(v, groupId, input));
}
export async function leaveGroupAction(groupId: string): Promise<Result> {
  return authed((v) => leaveGroup(v, groupId));
}
export async function removeMemberAction(groupId: string, userId: string): Promise<Result> {
  return authed((v) => removeMember(v, groupId, userId));
}
export async function updateGroupSettingsAction(groupId: string, input: Parameters<typeof updateGroupSettings>[2]): Promise<Result> {
  return authed((v) => updateGroupSettings(v, groupId, input));
}
export async function archiveGroupAction(groupId: string): Promise<Result> {
  return authed((v) => archiveGroup(v, groupId));
}
export async function endSeasonAction(groupId: string): Promise<Result> {
  return authed((v) => endSeasonNow(v, groupId));
}
export async function shareProofAction(groupId: string, proofId: string, shared: boolean): Promise<Result> {
  return authed((v) => setProofShared(v, groupId, proofId, shared));
}

export async function deletePicAction(groupId: string, picId: string): Promise<Result> {
  const { deletePic } = await import('@/lib/server/group-pics');
  return authed((v) => deletePic(v, groupId, picId));
}

// ───────────────────────────────────────────── quests and LevelCoins

export async function questDayAction(): Promise<import('@/lib/server/quests').QuestDay | null> {
  const v = await viewerOrNull();
  if (!v) return null;
  const { loadQuestDay } = await import('@/lib/server/quests');
  return loadQuestDay(v);
}

export async function addQuestAction(input: { title: string; size: 'small' | 'medium' | 'big' }): Promise<Result<{ id: string }>> {
  const { addQuest } = await import('@/lib/server/quests');
  return authed((v) => addQuest(v, input), false);
}

export async function setQuestDoneAction(id: string, done: boolean): Promise<Result> {
  const { setQuestDone } = await import('@/lib/server/quests');
  return authed((v) => setQuestDone(v, id, done), false);
}

export async function deleteQuestAction(id: string): Promise<Result> {
  const { deleteQuest } = await import('@/lib/server/quests');
  return authed((v) => deleteQuest(v, id), false);
}

// ───────────────────────────────────────────── collectables, trades, prizes

export async function openBoxAction(set: 'gym' | 'finance', boxId: string): Promise<Result<{ pull: import('@/lib/server/collectables').Pull; coins: number }>> {
  const { openBox } = await import('@/lib/server/collectables');
  return authed((v) => openBox(v, { set, boxId }), false);
}

export async function mateCollectionAction(mateId: string): Promise<{ key: string; copies: number }[]> {
  const v = await viewerOrNull();
  if (!v) return [];
  const { mateCollection } = await import('@/lib/server/collectables');
  return mateCollection(v, mateId);
}

export async function offerTradeAction(input: { to: string; give: string; get: string }): Promise<Result<{ id: string }>> {
  const { offerTrade } = await import('@/lib/server/collectables');
  return authed((v) => offerTrade(v, input), false);
}

export async function respondTradeAction(id: string, accept: boolean): Promise<Result<{ accepted: boolean }>> {
  const { respondTrade } = await import('@/lib/server/collectables');
  return authed((v) => respondTrade(v, id, accept), false);
}

export async function cancelTradeAction(id: string): Promise<Result> {
  const { cancelTrade } = await import('@/lib/server/collectables');
  return authed((v) => cancelTrade(v, id), false);
}

export async function claimPrizeAction(set: string): Promise<Result<{ code: string }>> {
  const { claimPrize } = await import('@/lib/server/collectables');
  return authed((v) => claimPrize(v, set), false);
}

// ───────────────────────────────────────────── world leaderboards

export async function setWorldVisibleAction(on: boolean): Promise<Result> {
  return authed(async (v) => {
    await asUser(v.userId, (q) => q.query(`update profiles set world_visible = $2 where id = $1`, [v.userId, !!on]));
    return { ok: true as const };
  });
}

// ───────────────────────────────────────────── the guided tour

export async function finishTourAction(skipped: boolean): Promise<Result> {
  return authed(async (v) => {
    await asUser(v.userId, (q) => q.query(`update profiles set tutorial_done_at = coalesce(tutorial_done_at, now()) where id = $1`, [v.userId]));
    void track(v.userId, skipped ? 'tutorial_skipped' : 'tutorial_completed', {});
    return { ok: true as const };
  }, false);
}

// ───────────────────────────────────────────── progress / evidence

export async function dayDetailAction(day: string): Promise<DayDetail | null> {
  const v = await viewerOrNull();
  if (!v || !z.iso.date().safeParse(day).success) return null;
  return loadDay(v, day);
}

export async function evidencePageAction(cursor: string | null, filters: { areaKind?: string | null; month?: string | null; kind?: string | null } = {}) {
  const v = await viewerOrNull();
  if (!v) return { proofs: [], nextCursor: null };
  return listEvidence(v, { cursor, areaKind: filters.areaKind ?? null, month: filters.month ?? null, kind: filters.kind ?? null, limit: 48 });
}

export async function deleteProofAction(id: string): Promise<Result> {
  const v = await viewerOrNull();
  if (!v || !z.uuid().safeParse(id).success) return UNAUTH;
  await deleteProof(v, id);
  refresh();
  return { ok: true };
}

// ───────────────────────────────────────────── rewards

export async function createRewardAction(input: { title: string; cost: number; money?: string | null; currency?: string | null }): Promise<Result> {
  const { createReward } = await import('@/lib/server/you');
  return authed((v) => createReward(v, input));
}

export async function redeemRewardAction(rewardId: string, accountId: string | null): Promise<Result<{ title?: string; balance?: number; logged?: boolean }>> {
  const { redeemReward } = await import('@/lib/server/you');
  return authed((v) => redeemReward(v, rewardId, accountId ? { accountId } : null));
}

// ───────────────────────────────────────────── settings

const settingsInput = z.object({
  displayName: z.string().trim().max(60),
  timezone: z.string().max(64),
  weekStartsOn: z.number().int().min(0).max(6),
  baseCurrency: z.string().regex(/^[A-Z]{3}$/),
  theme: z.enum(['system', 'dark', 'light']),
  accent: z.enum(['volt', 'ember', 'cobalt', 'ivory']),
  notificationLevel: z.enum(['off', 'minimal', 'balanced', 'active']),
  weightUnit: z.enum(['kg', 'lb']).default('kg'),
  modules: z.array(z.enum(['gym', 'learning', 'money'])).max(3).optional(),
});

export async function saveSettingsAction(input: z.input<typeof settingsInput>): Promise<Result> {
  const v = await viewerOrNull();
  if (!v) return UNAUTH;
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Check your settings.' };
  const s = parsed.data;
  // accents are earned: verify the level server-side
  if (s.accent !== 'volt') {
    const need = { ember: 10, cobalt: 20, ivory: 30 }[s.accent];
    const [{ xp }] = await asUser(v.userId, (q) => q.query<{ xp: number }>(`select coalesce(sum(amount), 0)::int8 as xp from xp_events`));
    const { levelFromXp } = await import('@/lib/engine/xp');
    if (levelFromXp(Number(xp)).level < need) return { ok: false, error: `That accent unlocks at level ${need}.` };
  }
  await asUser(v.userId, (q) =>
    q.query(
      `update profiles set display_name = $2, timezone = $3, week_starts_on = $4, base_currency = $5, theme = $6, accent = $7,
              notification_level = $8, weight_unit = $9, modules = coalesce($10, modules) where id = $1`,
      [v.userId, s.displayName, safeTimeZone(s.timezone), s.weekStartsOn, s.baseCurrency, s.theme, s.accent, s.notificationLevel, s.weightUnit, s.modules ?? null],
    ),
  );
  const jar = await cookies();
  jar.set('kept_theme', s.theme, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  jar.set('kept_accent', s.accent, { path: '/', maxAge: 31536000, sameSite: 'lax' });
  refresh();
  return { ok: true };
}

export async function setModuleAction(module: 'gym' | 'learning' | 'money', on: boolean): Promise<Result> {
  if (!['gym', 'learning', 'money'].includes(module)) return { ok: false, error: 'Unknown module.' };
  return authed(async (v) => {
    await asUser(v.userId, (q) =>
      on
        ? q.query(`update profiles set modules = array_append(modules, $2) where id = $1 and not ($2 = any(modules))`, [v.userId, module])
        : q.query(`update profiles set modules = array_remove(modules, $2) where id = $1`, [v.userId, module]),
    );
    return { ok: true as const };
  });
}

// ───────────────────────────────────────────── command bar

export interface CommandContext {
  today: string;
  missions: { id: string; title: string; measure: string; unit: string | null; target: number | null; minimumLabel: string | null; minimum: number | null; module: string | null }[];
  subjects: { id: string; name: string; measure: string; unit: string | null }[];
  areas: { id: string; name: string; kind: string }[];
  modules: string[];
  money: MoneyFormOptions;
}

export async function commandContextAction(): Promise<CommandContext | null> {
  const v = await viewerOrNull();
  if (!v) return null;
  const { loadMissions } = await import('@/lib/server/load');
  const [missions, money, subjects, areas] = await Promise.all([
    asUser(v.userId, (q) => loadMissions(q)),
    loadMoneyForm(v),
    listSubjectsFor(v),
    asUser(v.userId, (q) => loadAreas(q)),
  ]);
  return {
    today: v.today,
    missions: missions.map((m) => ({ id: m.id, title: m.title, measure: m.measure, unit: m.unit, target: m.targetValue, minimumLabel: m.minimumLabel, minimum: m.minimumValue, module: m.module })),
    subjects: subjects.map((s) => ({ id: s.id, name: s.name, measure: s.measure, unit: s.unit })),
    areas: areas.map((a) => ({ id: a.id, name: a.name, kind: a.kind })),
    modules: v.profile.modules,
    money,
  };
}

export async function trackAction(name: 'app_opened' | 'replay_viewed' | 'command_used' | 'offline_replayed', props: Record<string, string | number | boolean> = {}) {
  const v = await viewerOrNull();
  if (!v) return;
  await track(v.userId, name, props, 'web');
}
