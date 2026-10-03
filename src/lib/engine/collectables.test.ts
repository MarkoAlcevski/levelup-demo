import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CHARACTERS, ODDS, PITY, RARITIES, SELF_OPENED_FOR_PRIZE, SETS, copyToGive, prizeCode, rollBox, setProgress, sinceHigh } from './collectables';

const pub = (...p: string[]) => path.join(__dirname, '..', '..', '..', 'public', ...p);

describe('the collection', () => {
  it('has two themed sets of five: Common, Uncommon, Epic, Legendary and Secret, with art for each', () => {
    expect(RARITIES).toEqual(['common', 'uncommon', 'epic', 'legendary', 'secret']);
    expect(CHARACTERS).toHaveLength(10);
    expect(new Set(CHARACTERS.map((c) => c.key)).size).toBe(10);
    for (const s of SETS) expect(CHARACTERS.filter((c) => c.set === s.key).map((c) => c.rarity)).toEqual(RARITIES);
    for (const c of CHARACTERS) expect(existsSync(pub('collectables', `${c.key}.webp`))).toBe(true);
    expect(existsSync(pub('collectables', 'boxes', 'iron_crate.webp'))).toBe(true);
    expect(existsSync(pub('collectables', 'boxes', 'cash_case.webp'))).toBe(true);
  });
  it('odds add up to one and get rarer up the ladder', () => {
    expect(RARITIES.reduce((s, r) => s + ODDS[r], 0)).toBeCloseTo(1, 10);
    const odds = RARITIES.map((r) => ODDS[r]);
    expect([...odds].sort((a, b) => b - a)).toEqual(odds);
  });
});

describe('boxes', () => {
  it('a box only ever holds its own theme', () => {
    for (let i = 0; i < 200; i++) {
      expect(rollBox('gym', () => i / 200, 0).set).toBe('gym');
      expect(rollBox('finance', () => i / 200, 0).set).toBe('finance');
    }
  });
  it('maps the roll onto the odds', () => {
    expect(rollBox('gym', () => 0, 0).rarity).toBe('common');
    expect(rollBox('gym', () => 0.49, 0).rarity).toBe('common');
    expect(rollBox('gym', () => 0.5, 0).rarity).toBe('uncommon');
    expect(rollBox('gym', () => 0.8, 0).rarity).toBe('epic');
    expect(rollBox('gym', () => 0.95, 0).rarity).toBe('legendary');
    expect(rollBox('gym', () => 0.995, 0).rarity).toBe('secret');
  });
  it('the pity counter guarantees a Legendary or Secret', () => {
    for (let i = 0; i < 100; i++) {
      const r = rollBox('finance', () => i / 100, PITY - 1).rarity;
      expect(r === 'legendary' || r === 'secret').toBe(true);
    }
    expect(sinceHigh(['common', 'legendary', 'common', 'epic'])).toBe(2);
    expect(sinceHigh(['secret'])).toBe(0);
    expect(sinceHigh(Array(7).fill('common'))).toBe(7);
  });
  it('over many boxes the mix matches the odds', () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 2 ** 32) / 2 ** 32);
    const n = 20000;
    const count: Record<string, number> = {};
    for (let i = 0; i < n; i++) {
      const r = rollBox('gym', rand, 0).rarity;
      count[r] = (count[r] ?? 0) + 1;
    }
    for (const r of RARITIES) expect(count[r] / n).toBeCloseTo(ODDS[r], 1);
  });
});

describe('set prizes', () => {
  const gym = CHARACTERS.filter((c) => c.set === 'gym').map((c) => c.key);
  it('counts distinct characters, not copies', () => {
    const p = setProgress('gym', [gym[0], gym[0], gym[1]].map((k) => ({ character_key: k, mine: true })));
    expect(p).toMatchObject({ owned: 2, total: 5, complete: false, canClaim: false });
  });
  it('a full set can be claimed when at least three of the five came out of your own boxes', () => {
    const three = gym.map((k, i) => ({ character_key: k, mine: i < SELF_OPENED_FOR_PRIZE }));
    expect(setProgress('gym', three)).toMatchObject({ complete: true, canClaim: true, blocker: null });
    const two = gym.map((k, i) => ({ character_key: k, mine: i < 2 }));
    const p = setProgress('gym', two);
    expect(p).toMatchObject({ complete: true, canClaim: false });
    expect(p.blocker).toMatch(/Open 1 more yourself/);
  });
  it('the other set doesn’t count', () => {
    const fin = CHARACTERS.filter((c) => c.set === 'finance').map((c) => ({ character_key: c.key, mine: true }));
    expect(setProgress('gym', fin).owned).toBe(0);
  });
});

describe('trading', () => {
  it('gives away a traded-in copy before one you pulled, newest first', () => {
    const pick = copyToGive([
      { id: 'a', mine: true, acquired: '2026-09-01' },
      { id: 'b', mine: false, acquired: '2026-09-02' },
      { id: 'c', mine: false, acquired: '2026-09-05' },
    ]);
    expect(pick?.id).toBe('c');
    expect(copyToGive([{ id: 'a', mine: true, acquired: '2026-09-01' }, { id: 'd', mine: true, acquired: '2026-09-09' }])?.id).toBe('d');
    expect(copyToGive([])).toBeNull();
  });
  it('prize codes match the database format', () => {
    let n = 0;
    const code = prizeCode('finance', (max) => n++ % max);
    expect(code).toMatch(/^LU-[A-Z]{3}-[A-Z0-9]{6}$/);
    expect(code.startsWith('LU-FIN-')).toBe(true);
  });
});
