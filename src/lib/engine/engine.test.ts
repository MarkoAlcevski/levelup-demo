import { describe, expect, it } from 'vitest';
import { addDays, clockInZone, eachDay, isoWeekNumber, startOfWeek, todayIn } from './dates';
import { creditFor, outcomeForValue } from './outcome';
import { completionXp, levelFromXp, xpForLevel } from './xp';
import { byDay, evaluateMission } from './schedule';
import { evaluate, execution, consistency, tallyRange, heatLevel } from './metrics';
import { streakStats, missionStreak } from './streaks';
import { momentum } from './momentum';
import { formatMoney, parseAmount, RateBook, applyRate, parseRate } from './money';
import { balanceSheet, flowTotals, targetPace, runwayMonths, type AccountRec, type TxRec } from './finance';
import { comparePeriods, pctChange } from './period';
import type { CompletionRec, MissionDef, Outcome } from './types';

const opts = { today: '2026-09-26', weekStartsOn: 1 };

function mission(p: Partial<MissionDef> & { id: string }): MissionDef {
  return {
    areaId: 'a1', title: p.id, measure: 'check', unit: null, targetValue: null, minimumValue: null,
    minimumLabel: null, exceedRatio: 1.25, difficulty: 'normal', isPriority: false,
    schedules: [{ cadence: 'daily', perWeek: null, weekdays: null, dueOn: null, validFrom: '2026-01-01', validTo: null }],
    ...p,
  };
}

function done(missionId: string, day: string, outcome: Outcome = 'full', credit = 1): CompletionRec {
  const kept = outcome === 'full' || outcome === 'exceeded' || outcome === 'minimum';
  return { missionId, day, outcome, kept, credit, value: null, targetValue: null, difficulty: 'normal', loggedHour: 9, reason: null };
}

describe('dates', () => {
  it('handles week starts and ISO weeks', () => {
    expect(startOfWeek('2026-09-26', 1)).toBe('2026-09-21'); // Saturday → Monday
    expect(startOfWeek('2026-09-26', 0)).toBe('2026-09-20'); // Sunday start
    expect(isoWeekNumber('2026-09-26')).toBe(39);
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(eachDay('2026-12-30', '2027-01-02')).toHaveLength(4);
  });
  it('resolves local dates and hours across timezones', () => {
    const instant = new Date('2026-09-26T22:30:00Z');
    expect(todayIn('Europe/Skopje', instant)).toBe('2026-09-27'); // already tomorrow in Skopje
    expect(todayIn('America/New_York', instant)).toBe('2026-09-26');
    expect(clockInZone(instant, 'Europe/Skopje')).toEqual({ hour: 0, minute: 30 });
    expect(todayIn('Not/AZone', instant)).toBe('2026-09-26'); // falls back to UTC
  });
});

describe('outcomes and credit', () => {
  const m = { measure: 'duration' as const, targetValue: 60, minimumValue: 20, exceedRatio: 1.5 };
  it('derives outcomes from logged values', () => {
    expect(outcomeForValue(m, 0)).toBe('missed');
    expect(outcomeForValue(m, 10)).toBe('partial');
    expect(outcomeForValue(m, 20)).toBe('minimum');
    expect(outcomeForValue(m, 59)).toBe('minimum');
    expect(outcomeForValue(m, 60)).toBe('full');
    expect(outcomeForValue(m, 100)).toBe('exceeded');
  });
  it('credits measured work proportionally and caps at 1', () => {
    expect(creditFor(m, 'minimum', 20)).toBeCloseTo(0.333, 3);
    expect(creditFor(m, 'exceeded', 100)).toBe(1);
    expect(creditFor(m, 'partial', 10)).toBeCloseTo(0.167, 3);
  });
  it('gives a check mission minimum half credit', () => {
    const c = { measure: 'check' as const, targetValue: null, minimumValue: null, exceedRatio: 1.25 };
    expect(creditFor(c, 'full', null)).toBe(1);
    expect(creditFor(c, 'minimum', null)).toBe(0.5);
    expect(creditFor(c, 'skipped', null)).toBe(0);
  });
});

describe('xp and levels', () => {
  it('scores difficulty × outcome', () => {
    expect(completionXp('hard', 'full')).toBe(40);
    expect(completionXp('hard', 'minimum')).toBe(20);
    expect(completionXp('extreme', 'exceeded')).toBe(88);
    expect(completionXp('easy', 'missed')).toBe(0);
  });
  it('maps xp to levels on the 50·L·(L−1) curve', () => {
    expect(levelFromXp(0).level).toBe(1);
    expect(levelFromXp(99).level).toBe(1);
    expect(levelFromXp(100).level).toBe(2);
    expect(levelFromXp(xpForLevel(18)).level).toBe(18);
    expect(levelFromXp(xpForLevel(18) - 1).level).toBe(17);
    const l = levelFromXp(15_300 + 900);
    expect(l.level).toBe(18);
    expect(l.span).toBe(1800);
    expect(l.progress).toBeCloseTo(0.5, 5);
  });
});

describe('weekly quota scheduling', () => {
  const gym = mission({
    id: 'gym',
    schedules: [{ cadence: 'weekly', perWeek: 4, weekdays: null, dueOn: null, validFrom: '2026-01-01', validTo: null }],
  });
  const week = { start: '2026-09-14', end: '2026-09-20' }; // Mon–Sun, fully in the past

  it('sums daily due to exactly the quota when the quota is missed', () => {
    const mds = evaluateMission(gym, byDay([done('gym', '2026-09-14')]), week.start, week.end, opts);
    const due = mds.filter((d) => d.counts).length;
    const kept = mds.filter((d) => d.counts && d.completion?.kept).length;
    expect(due).toBe(4);
    expect(kept).toBe(1);
    // slack runs out on Friday: Fri/Sat/Sun become required
    expect(mds.map((d) => d.status)).toEqual(['flexible', 'flexible', 'flexible', 'flexible', 'required', 'required', 'required']);
  });

  it('treats sessions beyond the quota as extra, never inflating due', () => {
    const cs = ['14', '15', '16', '17', '18'].map((d) => done('gym', `2026-09-${d}`));
    const mds = evaluateMission(gym, byDay(cs), week.start, week.end, opts);
    expect(mds.filter((d) => d.counts).length).toBe(4);
    expect(mds.filter((d) => d.status === 'extra').length).toBe(1);
  });

  it('is flexible, not failing, mid-week with slack', () => {
    const mds = evaluateMission(gym, byDay([done('gym', '2026-09-21')]), '2026-09-21', '2026-09-26', opts);
    const today = mds.at(-1)!;
    expect(today.weekly).toMatchObject({ quota: 4, done: 1, remaining: 3, daysLeft: 2 });
    expect(today.status).toBe('required'); // 3 needed, 2 days left → no slack
  });

  it('prorates the first partial week', () => {
    const late = mission({
      id: 'late',
      schedules: [{ cadence: 'weekly', perWeek: 4, weekdays: null, dueOn: null, validFrom: '2026-09-18', validTo: null }],
    });
    const mds = evaluateMission(late, new Map(), '2026-09-18', '2026-09-20', opts);
    expect(mds[0].weekly?.quota).toBe(2); // 3 active days → round(4·3/7) = 2
  });
});

describe('fixed days and one-time missions', () => {
  it('only requires listed weekdays', () => {
    const dw = mission({
      id: 'dw',
      schedules: [{ cadence: 'days', perWeek: null, weekdays: [1, 2, 3, 4, 5], dueOn: null, validFrom: '2026-01-01', validTo: null }],
    });
    const mds = evaluateMission(dw, new Map(), '2026-09-14', '2026-09-20', opts);
    expect(mds.filter((d) => d.counts).length).toBe(5);
  });
  it('counts an overdue one-time mission once, on its deadline', () => {
    const task = mission({
      id: 't',
      schedules: [{ cadence: 'once', perWeek: null, weekdays: null, dueOn: '2026-09-20', validFrom: '2026-09-01', validTo: null }],
    });
    const mds = evaluateMission(task, new Map(), '2026-09-18', '2026-09-26', opts);
    expect(mds.filter((d) => d.counts).map((d) => d.day)).toEqual(['2026-09-20']);
    expect(mds.at(-1)!.status).toBe('overdue');
    const late = evaluateMission(task, byDay([done('t', '2026-09-24')]), '2026-09-18', '2026-09-26', opts);
    expect(late.filter((d) => d.counts).map((d) => d.day)).toEqual(['2026-09-24']);
  });
});

describe('rates', () => {
  const read = mission({ id: 'read' });
  it('excludes today\'s open items and excused days from the denominator', () => {
    const cs = [
      done('read', '2026-09-22'),
      done('read', '2026-09-23', 'minimum', 0.5),
      done('read', '2026-09-24', 'skipped', 0),
      // 25th missed, 26th (today) open
    ];
    const ev = evaluate([read], cs, '2026-09-22', '2026-09-26', opts);
    const t = tallyRange(ev, '2026-09-22', '2026-09-26');
    expect(t.settledDue).toBe(3);
    expect(t.open).toBe(1);
    expect(t.excused).toBe(1);
    expect(consistency(t)).toBeCloseTo(2 / 3, 5);
    expect(execution(t)).toBeCloseTo(1.5 / 3, 5);
  });
  it('returns null, not zero, when nothing was due', () => {
    const ev = evaluate([], [], '2026-09-22', '2026-09-26', opts);
    expect(execution(tallyRange(ev, '2026-09-22', '2026-09-26'))).toBeNull();
    expect(heatLevel(ev.days[0])).toBe(0);
  });
});

describe('streaks and recovery', () => {
  const a = mission({ id: 'a' });
  it('forgives a single bad day with a 1-day recovery and keeps best', () => {
    const days = eachDay('2026-09-10', '2026-09-26');
    const cs = days.filter((d) => d !== '2026-09-16' && d !== '2026-09-26').map((d) => done('a', d));
    const ev = evaluate([a], cs, '2026-09-10', '2026-09-26', opts);
    const s = streakStats(ev.days, '2026-09-26');
    expect(s.best).toBe(9); // 17th → 25th
    expect(s.current).toBe(9); // today pending, not broken
    expect(s.todayMark).toBe('pending');
    expect(s.recoveries).toEqual([{ brokeOn: '2026-09-16', recoveredOn: '2026-09-17', days: 1 }]);
    expect(s.comebacks).toBe(0);
  });
  it('counts weekly-quota streaks in weeks', () => {
    const gym = mission({
      id: 'gym',
      schedules: [{ cadence: 'weekly', perWeek: 2, weekdays: null, dueOn: null, validFrom: '2026-08-31', validTo: null }],
    });
    const cs = ['2026-08-31', '2026-09-01', '2026-09-07', '2026-09-08', '2026-09-14', '2026-09-21'].map((d) => done('gym', d));
    const ev = evaluate([gym], cs, '2026-08-31', '2026-09-26', opts);
    const st = missionStreak(ev.byMission.get('gym')!, '2026-09-26');
    expect(st.unit).toBe('week');
    expect(st.best).toBe(2); // week of 14th failed (1 of 2)
    expect(st.current).toBe(0); // current week open (1 of 2) doesn't count yet, 14th week failed
  });
});

describe('momentum', () => {
  const a = mission({ id: 'a' });
  const b = mission({ id: 'b' });
  it('reads strong for sustained execution and slipping after a drop', () => {
    const days = eachDay('2026-08-01', '2026-09-25');
    const strong = days.flatMap((d) => [done('a', d), done('b', d)]);
    const ev = evaluate([a, b], strong, '2026-08-01', '2026-09-26', opts);
    const m = momentum(ev.days, '2026-09-26');
    expect(m.score).toBe(100);
    expect(m.label).toBe('strong');

    // last week: only half of the work gets done
    const slipping = days.flatMap((d) => (d < '2026-09-19' ? [done('a', d), done('b', d)] : [done('a', d)]));
    const ev2 = evaluate([a, b], slipping, '2026-08-01', '2026-09-26', opts);
    const m2 = momentum(ev2.days, '2026-09-26');
    expect(m2.label).toBe('slipping');
    expect(m2.trend!).toBeLessThanOrEqual(-8);

    // three straight zero days reads as a reset, not a slide
    const stopped = days.flatMap((d) => (d < '2026-09-23' ? [done('a', d), done('b', d)] : []));
    const m3 = momentum(evaluate([a, b], stopped, '2026-08-01', '2026-09-26', opts).days, '2026-09-26');
    expect(m3.label).toBe('resetting');
  });
  it('claims nothing with under five days of data', () => {
    const ev = evaluate([a], [done('a', '2026-09-25')], '2026-09-23', '2026-09-26', opts);
    expect(momentum(ev.days, '2026-09-26')).toMatchObject({ label: 'building', score: null });
  });
});

describe('money', () => {
  it('parses user amounts in either decimal convention', () => {
    expect(parseAmount('18', 'EUR')).toBe(1800);
    expect(parseAmount('18.5', 'EUR')).toBe(1850);
    expect(parseAmount('1,234.56', 'EUR')).toBe(123456);
    expect(parseAmount('1.234,56', 'EUR')).toBe(123456);
    expect(parseAmount('12,5', 'EUR')).toBe(1250);
    expect(parseAmount('€ 7', 'EUR')).toBe(700);
    expect(parseAmount('1.005', 'EUR')).toBeNull(); // more precision than cents
    expect(parseAmount('abc', 'EUR')).toBeNull();
    expect(parseAmount('1500', 'JPY')).toBe(1500);
  });
  it('formats with sign and symbol', () => {
    expect(formatMoney(64800, 'EUR', { signed: true })).toBe('+€648.00');
    expect(formatMoney(-78200, 'EUR', { compact: true })).toBe('−€782');
    expect(formatMoney(1845000, 'MKD', { whole: true })).toBe('ден 18,450');
  });
  it('converts exactly with half-even rounding', () => {
    expect(applyRate(1000, 'EUR', 'MKD', parseRate('61.495'))).toBe(61495);
    expect(applyRate(61495, 'MKD', 'EUR', parseRate('61.495'), true)).toBe(1000);
    // 1 cent × 0.5 = 0.5 → rounds to even (0); 3 × 0.5 = 1.5 → 2
    expect(applyRate(1, 'EUR', 'XXX', parseRate('0.5'))).toBe(0);
    expect(applyRate(3, 'EUR', 'XXX', parseRate('0.5'))).toBe(2);
  });
  it('uses the latest rate on or before the date, inverse and pivot pairs, never 1:1', () => {
    const book = new RateBook([
      { base: 'EUR', quote: 'MKD', rate: '61.5', on: '2026-01-01', source: 't' },
      { base: 'EUR', quote: 'MKD', rate: '61.6', on: '2026-06-01', source: 't' },
      { base: 'EUR', quote: 'USD', rate: '1.2', on: '2026-01-01', source: 't' },
    ]);
    expect(book.convert(61500, 'MKD', 'EUR', '2026-03-01')!.minor).toBe(1000);
    expect(book.convert(61600, 'MKD', 'EUR', '2026-07-01')!.minor).toBe(1000);
    expect(book.convert(1200, 'USD', 'MKD', '2026-03-01')!.minor).toBe(61500); // via EUR
    expect(book.convert(100, 'GBP', 'EUR', '2026-03-01')).toBeNull();
  });
});

describe('finance', () => {
  const ctx = { base: 'EUR', book: new RateBook([{ base: 'EUR', quote: 'MKD', rate: '61.5', on: '2026-01-01', source: 't' }]) };
  const acct = (id: string, type: AccountRec['type'], currency = 'EUR', opening = 0): AccountRec => ({
    id, name: id, type, institution: null, currency, openingMinor: opening, openingOn: '2026-01-01',
    isLiquid: type !== 'investment', includeInNetWorth: true, archived: false,
  });
  const accounts = [acct('bank', 'checking', 'EUR', 100000), acct('cash', 'cash', 'MKD', 615000), acct('save', 'savings'), acct('card', 'credit')];
  const tx = (p: Partial<TxRec> & Pick<TxRec, 'id' | 'accountId' | 'kind' | 'amountMinor'>): TxRec => ({
    currency: accounts.find((a) => a.id === p.accountId)!.currency, on: '2026-09-10', categoryId: null,
    counterparty: null, transferId: null, seriesId: null, isEarnedReward: false, ...p,
  });
  const txs: TxRec[] = [
    tx({ id: '1', accountId: 'bank', kind: 'income', amountMinor: 143000, counterparty: 'HeyReach' }),
    tx({ id: '2', accountId: 'cash', kind: 'expense', amountMinor: -123000 }), // 1,230 MKD = €20
    tx({ id: '3', accountId: 'bank', kind: 'expense', amountMinor: -5000 }),
    tx({ id: '4', accountId: 'bank', kind: 'expense', amountMinor: 1000 }), // refund
    tx({ id: '5', accountId: 'bank', kind: 'transfer', amountMinor: -20000, transferId: 't1' }),
    tx({ id: '6', accountId: 'save', kind: 'transfer', amountMinor: 20000, transferId: 't1' }),
    tx({ id: '7', accountId: 'card', kind: 'expense', amountMinor: -3000 }),
  ];
  const period = { preset: '30d' as const, start: '2026-08-28', end: '2026-09-26', label: '30 days' };
  const map = new Map(accounts.map((a) => [a.id, a]));

  it('never counts transfers as spending, nets refunds, converts currencies', () => {
    const f = flowTotals(txs, map, period, '2026-09-26', ctx);
    expect(f.income).toBe(143000);
    expect(f.expenses).toBe(2000 + 5000 - 1000 + 3000);
    expect(f.net).toBe(143000 - 9000);
    expect(f.savingsRate).toBeCloseTo(134000 / 143000, 6);
    expect(f.movedToSavings).toBe(20000);
    expect(f.avgDailySpend).toBe(300);
  });
  it('has no savings rate without income', () => {
    const f = flowTotals(txs.filter((t) => t.kind !== 'income'), map, period, '2026-09-26', ctx);
    expect(f.savingsRate).toBeNull();
  });
  it('builds a balance sheet with liabilities as negative balances', () => {
    const bs = balanceSheet(accounts, txs, [], '2026-09-26', ctx);
    // bank €1,000 + 1,430 − 50 + 10 − 200 = €2,190; cash 6,150 − 1,230 MKD = 4,920 MKD = €80; save €200; card −€30
    expect(bs.accounts.find((a) => a.account.id === 'bank')!.native).toBe(219000);
    expect(bs.accounts.find((a) => a.account.id === 'cash')!.converted).toBe(8000);
    expect(bs.liabilities).toBe(3000);
    expect(bs.netWorth).toBe(219000 + 8000 + 20000 - 3000);
  });
  it('computes target pace and runway', () => {
    const p = targetPace(150000, 113000, { start: '2026-09-01', end: '2026-09-30' }, '2026-09-22');
    expect(p.remaining).toBe(37000);
    expect(p.daysLeft).toBe(8);
    expect(p.requiredPerDay).toBe(4625); // €46.25/day
    expect(runwayMonths(600000, 75000)).toBe(8);
    expect(runwayMonths(600000, 0)).toBeNull();
  });
});

describe('periods', () => {
  it('compares month-to-date with the same span of last month', () => {
    const { current, previous } = comparePeriods('month', '2026-09-26');
    expect(current).toMatchObject({ start: '2026-09-01', end: '2026-09-26' });
    expect(previous).toMatchObject({ start: '2026-08-01', end: '2026-08-26' });
  });
  it('compares rolling windows back-to-back', () => {
    const { current, previous } = comparePeriods('30d', '2026-09-26');
    expect(current.start).toBe('2026-08-28');
    expect(previous).toMatchObject({ start: '2026-07-29', end: '2026-08-27' });
  });
  it('refuses percentage change from zero', () => {
    expect(pctChange(100, 0)).toBeNull();
    expect(pctChange(1430, 1050)).toBeCloseTo(0.3619, 4);
  });
});
