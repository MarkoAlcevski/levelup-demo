import { describe, expect, it } from 'vitest';
import { detectRecords, displayWeight, fromKg, gymCalendar, monthSummary, nextWorkout, sessionTotals, toKg, type LoggedSession } from './gym';
import {
  championshipPoints, computeStandings, fmtAmount, isPerfectSeason, ofAmount, pledgeFor, rankStandings, seasonAwards, seasonBounds, seasonFrom, seasonLabel, yearTable,
  type Standing,
} from './groups';
import { budgetProgress, classifyChanges, monthPlan, nextDue, occurrences, occurrencesIn, projectCash, targetProgress } from './money-plan';

// ───────────────────────────────────────────── gym

const session = (id: string, on: string, sets: [number, number][], opts: Partial<LoggedSession> = {}): LoggedSession => ({
  id,
  name: 'Push',
  workoutDayId: 'd1',
  performedOn: on,
  startedAt: `${on}T18:00:00Z`,
  durationSeconds: 3600,
  weightUnit: 'kg',
  exercises: [{ exerciseId: 'bench', name: 'Bench Press', sets: sets.map(([weight, reps]) => ({ weight, reps, kind: 'working' as const, done: true })) }],
  ...opts,
});

describe('gym: units never destroy what was logged', () => {
  it('converts kg ⇄ lb without drifting', () => {
    expect(toKg(100, 'lb')).toBeCloseTo(45.359, 3);
    expect(fromKg(toKg(225, 'lb'), 'lb')).toBeCloseTo(225, 9);
    expect(displayWeight(100, 'kg', 'kg')).toBe(100);
    expect(displayWeight(100, 'kg', 'lb')).toBe(220.5); // shown to the nearest quarter pound
  });
  it('totals count only ticked working sets with reps', () => {
    const s = session('s', '2026-09-20', [[60, 8], [60, 8]]);
    s.exercises[0].sets.push({ weight: 40, reps: 10, kind: 'warmup', done: true }, { weight: 60, reps: 8, kind: 'working', done: false });
    expect(sessionTotals(s)).toEqual({ sets: 2, exercises: 1, reps: 16, volumeKg: 960 });
  });
  it('a session logged in lb totals in kg', () => {
    expect(sessionTotals(session('s', '2026-09-20', [[100, 10]], { weightUnit: 'lb' })).volumeKg).toBeCloseTo(453.6, 1);
  });
});

describe('gym: personal records', () => {
  it('the first time is a baseline, not a record', () => {
    expect(detectRecords([], session('a', '2026-09-01', [[60, 8]]))).toEqual([]);
  });
  it('heavier weight is a weight PR; more reps at the same weight is a rep PR', () => {
    const before = [session('a', '2026-09-01', [[60, 8]])];
    const heavier = detectRecords(before, session('b', '2026-09-04', [[62.5, 6]]));
    expect(heavier.find((r) => r.kind === 'weight')).toMatchObject({ value: 62.5, previous: 60 });
    const reps = detectRecords(before, session('c', '2026-09-04', [[60, 10]]));
    expect(reps.find((r) => r.kind === 'reps')).toMatchObject({ value: 10, previous: 8, weightKg: 60 });
  });
  it('fewer reps at a lighter weight is not a record', () => {
    const before = [session('a', '2026-09-01', [[60, 8]])];
    expect(detectRecords(before, session('b', '2026-09-04', [[55, 8]])).filter((r) => r.kind !== 'volume')).toEqual([]);
  });
});

describe('gym: the next workout follows the user’s own split', () => {
  const days = [
    { id: 'push', name: 'Push', position: 0, weekday: 1 },
    { id: 'pull', name: 'Pull', position: 1, weekday: 3 },
    { id: 'legs', name: 'Legs', position: 2, weekday: 5 },
  ];
  it('flexible: cycles in order after the last one trained', () => {
    expect(nextWorkout('flexible', days, null, '2026-09-27', false)?.day.id).toBe('push');
    expect(nextWorkout('flexible', days, 'pull', '2026-09-27', false)?.day.id).toBe('legs');
    expect(nextWorkout('flexible', days, 'legs', '2026-09-27', false)?.day.id).toBe('push');
  });
  it('fixed days: today’s day, or the next assigned weekday', () => {
    // 2026-09-28 is a Monday
    expect(nextWorkout('scheduled', days, null, '2026-09-28', false)).toMatchObject({ day: { id: 'push' }, on: '2026-09-28' });
    expect(nextWorkout('scheduled', days, null, '2026-09-28', true)).toMatchObject({ day: { id: 'pull' }, on: '2026-09-30' });
  });
});

describe('gym: the calendar and the month', () => {
  it('marks done, planned, missed and rest days and counts weeks', () => {
    const weeks = gymCalendar({
      month: '2026-09-01',
      today: '2026-09-16',
      weekStartsOn: 1,
      mode: 'scheduled',
      keptDays: new Set(['2026-09-14']),
      isScheduled: (d) => ['2026-09-14', '2026-09-15', '2026-09-17'].includes(d),
      plannedName: () => 'Push',
      sessionsByDay: new Map([['2026-09-14', [{ id: 's1', name: 'Push' }]]]),
      weeklyTarget: () => null,
    });
    const wk = weeks.find((w) => w.weekStart === '2026-09-14')!;
    const state = (d: string) => wk.days.find((x) => x.day === d)!.state;
    expect([state('2026-09-14'), state('2026-09-15'), state('2026-09-16'), state('2026-09-17')]).toEqual(['done', 'missed', 'rest', 'planned']);
    expect(wk).toMatchObject({ done: 1, target: 3 });
  });
  it('a quick-logged day (routine kept, no sets) still shows as done', () => {
    const weeks = gymCalendar({
      month: '2026-09-01', today: '2026-09-27', weekStartsOn: 1, mode: 'flexible', keptDays: new Set(['2026-09-27']),
      isScheduled: () => false, plannedName: () => null, sessionsByDay: new Map(), weeklyTarget: () => 4,
    });
    const day = weeks.flatMap((w) => w.days).find((d) => d.day === '2026-09-27')!;
    expect(day).toMatchObject({ state: 'done', loggedOnly: true });
  });
  it('the month summary is plain arithmetic', () => {
    const m = monthSummary({ month: '2026-09-01', mode: 'flexible', perWeek: 4, scheduledDays: 0, sessions: [session('a', '2026-09-02', [[60, 8]]), session('b', '2026-10-01', [[60, 8]])], loggedOnlyDays: 1, records: 0 });
    expect(m).toMatchObject({ workouts: 2, target: 17, sets: 1 });
  });
});

// ───────────────────────────────────────────── groups

const member = (userId: string, target: number, unit: 'workouts' | 'minutes' = 'workouts', startsOn = '2026-09-01') => ({ userId, name: userId, target, unit, startsOn });
const acts = (userId: string, days: string[], amount = 1) => days.map((day) => ({ userId, day, amount, proofed: false }));
const september = { start: '2026-09-01', end: '2026-09-30' };

describe('groups: commitment, not volume, wins', () => {
  it('pledges prorate by days; discrete units round', () => {
    expect(pledgeFor(4, 7, 'workouts')).toBe(4);
    expect(pledgeFor(4, 3, 'workouts')).toBe(2);
    expect(pledgeFor(300, 3, 'minutes')).toBe(128.6);
  });
  it('4 of 4 beats 6 of 8, and extra work is capped each week', () => {
    // week of 2026-09-07..13 only, closed season
    const window = { start: '2026-09-07', end: '2026-09-13' };
    const rows = computeStandings({
      window, today: '2026-09-20', weekStartsOn: 1, final: true, proofRequired: false, proofMatters: false,
      members: [member('keeper', 4, 'workouts', '2026-09-07'), member('grinder', 8, 'workouts', '2026-09-07'), member('extra', 3, 'workouts', '2026-09-07')],
      activity: [
        ...acts('keeper', ['2026-09-07', '2026-09-08', '2026-09-10', '2026-09-12']),
        ...acts('grinder', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12']),
        ...acts('extra', ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13']),
      ],
    });
    const by = Object.fromEntries(rows.map((r) => [r.userId, r]));
    expect(by.keeper.rate).toBe(1);
    expect(by.grinder.rate).toBe(0.75);
    expect(by.extra).toMatchObject({ rate: 1, done: 7, eligible: 3 }); // 7 done, only 3 count
    expect(by.grinder.rank).toBe(3);
  });
  it('ties break on perfect weeks, then pledged work done — then stay a declared tie', () => {
    const rows = computeStandings({
      window: september, today: '2026-10-05', weekStartsOn: 1, final: true, proofRequired: false, proofMatters: false,
      members: [member('a', 1), member('b', 1)],
      activity: [...acts('a', ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30']), ...acts('b', ['2026-09-02', '2026-09-09', '2026-09-16', '2026-09-23', '2026-09-30'])],
    });
    expect(rows.map((r) => [r.rank, r.tied])).toEqual([[1, true], [1, true]]);
  });
  it('joining mid-season prorates the pledge from the join day', () => {
    const [r] = computeStandings({
      window: september, today: '2026-10-01', weekStartsOn: 1, final: true, proofRequired: false, proofMatters: false,
      members: [member('late', 7, 'workouts', '2026-09-28')],
      activity: acts('late', ['2026-09-28', '2026-09-29', '2026-09-30']),
    });
    expect(r).toMatchObject({ pledged: 3, eligible: 3, rate: 1 });
  });
  it('proof-required groups only count proofed days', () => {
    const [r] = computeStandings({
      window: { start: '2026-09-07', end: '2026-09-13' }, today: '2026-09-20', weekStartsOn: 1, final: true, proofRequired: true, proofMatters: true,
      members: [member('p', 2, 'workouts', '2026-09-07')],
      activity: [{ userId: 'p', day: '2026-09-07', amount: 1, proofed: true }, { userId: 'p', day: '2026-09-08', amount: 1, proofed: false }],
    });
    expect(r.rate).toBe(0.5);
  });
  it('championship points follow the published formula and cap at 9', () => {
    expect(championshipPoints({ rank: 1, rate: 1 }, true)).toBe(9);
    expect(championshipPoints({ rank: 2, rate: 0.8 }, false)).toBe(5);
    expect(championshipPoints({ rank: 4, rate: 0.6 }, false)).toBe(1);
    expect(championshipPoints({ rank: 1, rate: 0 }, false)).toBe(0); // nobody wins by doing nothing
    expect(isPerfectSeason({ rate: 1, perfectWeeks: 4, weeks: 4 })).toBe(true);
  });
  it('awards need a real result', () => {
    const idle = rankStandings([{ userId: 'x', name: 'X', unit: 'workouts', target: 3, done: 0, eligible: 0, pledged: 12, pledgedToDate: 12, rate: 0, perfectWeeks: 0, weeks: 4, proofed: 0, proofRate: null, rank: 0, tied: false, weekly: [] } as Standing], false);
    expect(seasonAwards(idle, 'September 2026', new Map(), true)).toEqual([]);
  });
  it('the year table sums points, wins break ties', () => {
    const t = yearTable([
      { userId: 'a', name: 'A', points: 9, rank: 1, rate: 1 },
      { userId: 'b', name: 'B', points: 5, rank: 2, rate: 0.8 },
      { userId: 'b', name: 'B', points: 9, rank: 1, rate: 1 },
      { userId: 'a', name: 'A', points: 5, rank: 2, rate: 0.8 },
    ]);
    expect(t.map((r) => [r.name, r.points, r.wins, r.rank, r.tied])).toEqual([['A', 14, 1, 1, true], ['B', 14, 1, 1, true]]);
  });
  it('seasons: months are labelled; a stub season runs on to the next full period', () => {
    expect(seasonLabel('month', seasonBounds('month', '2026-01-01', '2026-09-10', 1), 9)).toBe('September 2026');
    expect(seasonFrom('month', '2026-09-27', '2026-09-27', 1)).toEqual({ start: '2026-09-27', end: '2026-10-31' });
    expect(seasonFrom('month', '2026-09-10', '2026-09-10', 1)).toEqual({ start: '2026-09-10', end: '2026-09-30' });
    expect(seasonFrom('week', '2026-09-27', '2026-09-27', 1)).toEqual({ start: '2026-09-27', end: '2026-10-04' });
  });
  it('amounts read naturally', () => {
    expect(fmtAmount(1, 'workouts')).toBe('1 workout');
    expect(fmtAmount(150, 'minutes')).toBe('2h 30m');
    expect(ofAmount(3, 4, 'workouts')).toBe('3 of 4 workouts');
  });
});

// ───────────────────────────────────────────── money plan

describe('money plan: arithmetic only', () => {
  const monthly = { cadence: 'month' as const, intervalCount: 1, nextOn: '2026-08-05', status: 'active' as const };
  it('recurring items project forward from an old next date', () => {
    expect(occurrences(monthly, '2026-09-01', '2026-11-30')).toEqual(['2026-09-05', '2026-10-05', '2026-11-05']);
    expect(nextDue(monthly, '2026-09-27')).toBe('2026-10-05');
    expect(occurrences({ ...monthly, status: 'paused' as never }, '2026-09-01', '2026-12-31')).toEqual([]);
    // this month's plan still counts the rent paid on the 1st, even though the next one is due in October
    expect(occurrencesIn({ ...monthly, nextOn: '2026-10-01' }, '2026-09-01', '2026-09-30')).toEqual(['2026-09-01']);
    expect(occurrencesIn({ ...monthly, nextOn: '2026-10-31' }, '2026-08-01', '2026-09-30')).toEqual(['2026-08-31', '2026-09-30']);
    expect(occurrencesIn({ ...monthly, nextOn: '2026-10-01', startedOn: '2026-09-15' }, '2026-09-01', '2026-09-30')).toEqual([]);
  });
  it('budgets state used, remaining and pace', () => {
    const b = budgetProgress(15000, 13200, { start: '2026-09-01', end: '2026-09-30' }, '2026-09-19');
    expect(b).toMatchObject({ remaining: 1800, daysLeft: 11, status: 'pace_over' });
    expect(budgetProgress(15000, 16000, { start: '2026-09-01', end: '2026-09-30' }, '2026-09-19').status).toBe('over');
  });
  it('targets: income remaining per day, ceilings, debt paid down', () => {
    expect(targetProgress('income', 200000, 150000, { today: '2026-09-20', periodEnd: '2026-09-30' })).toMatchObject({ remaining: 50000, daysLeft: 10, perDay: 5000, met: false });
    expect(targetProgress('spending_ceiling', 100000, 120000, { today: '2026-09-20', periodEnd: '2026-09-30' })).toMatchObject({ over: true, met: false });
    expect(targetProgress('debt_payoff', 0, 3000, { today: '2026-09-20', periodEnd: null, start: 10000 })).toMatchObject({ current: 7000, progress: 0.7, met: false });
  });
  it('the monthly plan compares plan with actual', () => {
    const p = monthPlan({
      month: '2026-09-01', today: '2026-09-15', recurringIncome: 300000, recurringExpenses: 120000, expectedIncome: 50000, categoryBudgets: 60000,
      overallBudget: null, plannedSavings: 50000, plannedInvestments: 20000, actual: { income: 300000, expenses: 90000, savings: 0, investments: 0 },
    });
    expect(p.planned).toEqual({ income: 350000, spending: 180000, savings: 50000, investments: 20000, remaining: 100000 });
    expect(p.actual.remaining).toBe(210000);
    expect(p.elapsed).toBeCloseTo(0.5, 5);
  });
  it('a 30/60/90-day projection is recurring items plus budgeted spending, nothing else', () => {
    const ctx = { base: 'EUR', book: { convert: (m: number) => ({ minor: m }) } } as never;
    const pr = projectCash({
      today: '2026-09-27', startLiquid: 100000, ctx, budgetMonthly: 0, horizon: 90,
      series: [{ ...monthly, id: 's', name: 'Salary', kind: 'income', amountMinor: 200000, currency: 'EUR' } as never, { ...monthly, nextOn: '2026-10-01', id: 'r', name: 'Rent', kind: 'expense', amountMinor: 80000, currency: 'EUR' } as never],
    });
    expect(pr.at.map((x) => x.balance)).toEqual([100000 - 80000 + 200000, 100000 + 2 * (200000 - 80000), 100000 + 3 * (200000 - 80000)]);
    expect(pr.lowest.balance).toBe(20000);
  });
  it('reports sort what changed from what held steady, with explicit thresholds', () => {
    const r = classifyChanges(
      [
        { label: 'Restaurants', current: 30000, previous: 20000, change: 0.5, upIsGood: false },
        { label: 'Groceries', current: 40000, previous: 40400, change: -0.0099, upIsGood: false },
        { label: 'Coffee', current: 1200, previous: 1000, change: 0.2, upIsGood: false },
      ],
      5000,
    );
    expect(r.changed.map((c) => c.label)).toEqual(['Restaurants']);
    expect(r.stable.map((c) => c.label)).toEqual(['Groceries']);
  });
});
