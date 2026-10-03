import { describe, expect, it } from 'vitest';
import { matchMission, parseCommand, resolveDue, splitDue } from './nl';

describe('command grammar', () => {
  it('parses money with symbols, codes and categories', () => {
    expect(parseCommand('€18 lunch')).toMatchObject({ kind: 'money', direction: 'expense', amount: '18', currency: 'EUR', categorySlug: 'restaurants' });
    expect(parseCommand('18,50 groceries at Vero')).toMatchObject({ kind: 'money', amount: '18.50', categorySlug: 'groceries' });
    expect(parseCommand('+1200 freelance landing page')).toMatchObject({ kind: 'money', direction: 'income', categorySlug: 'freelance' });
    expect(parseCommand('350 mkd taxi')).toMatchObject({ kind: 'money', currency: 'MKD', categorySlug: 'transport' });
    expect(parseCommand('12')).toMatchObject({ kind: 'money', amount: '12' });
  });
  it('treats "<mission> <number>" as a log, not money', () => {
    expect(parseCommand('read 25')).toEqual({ kind: 'complete', query: 'read', value: 25, minimum: false });
    expect(parseCommand('steps 9400')).toMatchObject({ kind: 'complete', query: 'steps', value: 9400 });
  });
  it('parses completions, minimums, new missions and navigation', () => {
    expect(parseCommand('gym done')).toMatchObject({ kind: 'complete', query: 'gym', minimum: false });
    expect(parseCommand('done deep work')).toMatchObject({ kind: 'complete', query: 'deep work' });
    expect(parseCommand('min gym')).toMatchObject({ kind: 'complete', query: 'gym', minimum: true });
    expect(parseCommand('add German 3x')).toEqual({ kind: 'mission', title: 'German 3x' });
    expect(parseCommand('evidence')).toMatchObject({ kind: 'navigate', href: '/progress/evidence' });
    expect(parseCommand('how are you')).toBeNull();
  });
  it('matches missions forgivingly', () => {
    const ms = [{ title: 'Deep work' }, { title: 'Read' }, { title: 'In bed by 23:30' }];
    expect(matchMission('deep', ms)?.title).toBe('Deep work');
    expect(matchMission('work', ms)?.title).toBe('Deep work');
    expect(matchMission('bed', ms)?.title).toBe('In bed by 23:30');
    expect(matchMission('run', ms)).toBeNull();
  });

  it('V2: income, learning logs, tasks with dates, routines and new destinations', () => {
    expect(parseCommand('+800 salary')).toMatchObject({ kind: 'money', direction: 'income', amount: '800', categorySlug: 'salary' });
    expect(parseCommand('log German 45')).toEqual({ kind: 'complete', query: 'German', value: 45, minimum: false });
    expect(parseCommand('add task call Martin tomorrow')).toEqual({ kind: 'task', title: 'call Martin', due: { kind: 'tomorrow' } });
    expect(parseCommand('task pay rent on friday')).toEqual({ kind: 'task', title: 'pay rent', due: { kind: 'weekday', iso: 5 } });
    expect(parseCommand('todo renew passport')).toEqual({ kind: 'task', title: 'renew passport', due: null });
    expect(parseCommand('add routine Outreach')).toEqual({ kind: 'mission', title: 'Outreach' });
    expect(parseCommand('trained')).toMatchObject({ kind: 'complete', query: 'gym' });
    expect(parseCommand('journal')).toMatchObject({ kind: 'navigate', href: '/journal' });
    expect(parseCommand('groups')).toMatchObject({ kind: 'navigate', href: '/groups' });
    expect(parseCommand('plan')).toMatchObject({ kind: 'navigate', href: '/areas' });
    expect(parseCommand('you')).toMatchObject({ kind: 'navigate', href: '/profile' });
  });
  it('resolves due words against today', () => {
    // 2026-09-27 is a Sunday
    expect(resolveDue({ kind: 'tomorrow' }, '2026-09-27')).toBe('2026-09-28');
    expect(resolveDue({ kind: 'weekday', iso: 5 }, '2026-09-27')).toBe('2026-10-02');
    expect(resolveDue({ kind: 'weekday', iso: 7 }, '2026-09-27')).toBe('2026-10-04');
    expect(resolveDue({ kind: 'in', days: 3 }, '2026-09-27')).toBe('2026-09-30');
    expect(resolveDue({ kind: 'date', date: '2026-01-01' }, '2026-09-27')).toBeNull();
    expect(splitDue('call mom in 2 days')).toEqual({ title: 'call mom', due: { kind: 'in', days: 2 } });
    expect(splitDue('buy milk')).toEqual({ title: 'buy milk', due: null });
    expect(splitDue('water the plants')).toEqual({ title: 'water the plants', due: null });
  });
});
