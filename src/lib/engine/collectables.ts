/**
 * Collectables: ten characters in two themed sets, found in boxes. Every set has one character of
 * each rarity — Common, Uncommon, Epic, Legendary and a Secret one that stays hidden until someone
 * pulls it. Boxes cost LevelCoins (which only come from quests), every pull is rolled on the server
 * with real randomness, and a pity counter guarantees a Legendary or better within a set number of
 * boxes. Duplicates are spares you can trade with group mates. Owning the whole set wins a prize, as
 * long as enough of it came out of your own boxes rather than trades.
 */

export type SetKey = 'gym' | 'finance';
export type Rarity = 'common' | 'uncommon' | 'epic' | 'legendary' | 'secret';

export const RARITIES: Rarity[] = ['common', 'uncommon', 'epic', 'legendary', 'secret'];
export const RARITY_LABEL: Record<Rarity, string> = { common: 'Common', uncommon: 'Uncommon', epic: 'Epic', legendary: 'Legendary', secret: 'Secret' };

/** Chance per box. They add up to 1. */
export const ODDS: Record<Rarity, number> = { common: 0.5, uncommon: 0.28, epic: 0.15, legendary: 0.06, secret: 0.01 };
/** Boxes of one theme in a row without a Legendary or Secret before the next one is guaranteed to be. */
export const PITY = 20;

export interface Character {
  key: string;
  set: SetKey;
  rarity: Rarity;
  name: string;
  /** one line of personality */
  tagline: string;
  /** flat NFT-style backdrop behind the art */
  backdrop: string;
}

export const CHARACTERS: Character[] = [
  { key: 'kettle_head', set: 'gym', rarity: 'common', name: 'Kettle Head', backdrop: '#E7D3AE', tagline: 'Head full of iron. Thinks about nothing but the next set.' },
  { key: 'gym_rat', set: 'gym', rarity: 'uncommon', name: 'Gym Rat', backdrop: '#9CC7B6', tagline: 'Lives at the gym. Pays rent in chalk.' },
  { key: 'swole_shiba', set: 'gym', rarity: 'epic', name: 'Swole Shiba', backdrop: '#F0A65C', tagline: 'Much gains. Very consistent.' },
  { key: 'iron_rhino', set: 'gym', rarity: 'legendary', name: 'Iron Rhino', backdrop: '#B6C3E2', tagline: 'Never skips leg day. Never skips any day.' },
  { key: 'marble_titan', set: 'gym', rarity: 'secret', name: 'Marble Titan', backdrop: '#D8CFBF', tagline: 'Carved one rep at a time.' },
  { key: 'cash_cat', set: 'finance', rarity: 'common', name: 'Cash Cat', backdrop: '#E9D6B2', tagline: 'Counts every note. Twice.' },
  { key: 'money_printer', set: 'finance', rarity: 'uncommon', name: 'Money Printer', backdrop: '#9DC8B7', tagline: 'Goes brrr, but only after the budget is set.' },
  { key: 'wall_street_wolf', set: 'finance', rarity: 'epic', name: 'Wall Street Wolf', backdrop: '#EFA55E', tagline: 'Has a plan for every note in the case.' },
  { key: 'stonks_bull', set: 'finance', rarity: 'legendary', name: 'Stonks Bull', backdrop: '#B8C5E3', tagline: 'Only knows one direction.' },
  { key: 'the_whale', set: 'finance', rarity: 'secret', name: 'The Whale', backdrop: '#D7D2C4', tagline: 'Moves markets. Mostly his own.' },
];

export const CHARACTER_BY_KEY = new Map(CHARACTERS.map((c) => [c.key, c]));
export const isCharacter = (key: string) => CHARACTER_BY_KEY.has(key);

export interface SetInfo {
  key: SetKey;
  name: string;
  theme: string;
  prize: string;
  code: string;
  box: { name: string; cost: number; blurb: string };
}

export const SETS: SetInfo[] = [
  {
    key: 'gym', name: 'Iron set', theme: 'Gym', prize: 'Gym gear or a supplement pack from a LevelUp partner', code: 'GYM',
    box: { name: 'Iron Crate', cost: 150, blurb: 'One gym character' },
  },
  {
    key: 'finance', name: 'Capital set', theme: 'Finance', prize: 'A month of an AI subscription or a paid online course', code: 'FIN',
    box: { name: 'Cash Case', cost: 150, blurb: 'One finance character' },
  },
];
export const SET_BY_KEY = new Map(SETS.map((s) => [s.key, s]));

/** Of a set's five, at least this many must come out of your own boxes, not trades, to claim the prize. */
export const SELF_OPENED_FOR_PRIZE = 3;
/** Open offers you can have out at once. */
export const MAX_OPEN_OFFERS = 5;
/** Offers nobody answered stop counting after a week. */
export const OFFER_DAYS = 7;

/** Boxes opened since the last Legendary or Secret, newest last. */
export function sinceHigh(rarities: Rarity[]): number {
  let n = 0;
  for (let i = rarities.length - 1; i >= 0 && rarities[i] !== 'legendary' && rarities[i] !== 'secret'; i--) n++;
  return n;
}

/**
 * One pull from a theme's box. `rand` returns [0, 1). When the pity counter is up, only Legendary
 * and Secret can come out, in the same proportion they have to each other.
 */
export function rollBox(set: SetKey, rand: () => number, since: number): Character {
  const pool = RARITIES.filter((r) => since < PITY - 1 || r === 'legendary' || r === 'secret');
  const total = pool.reduce((s, r) => s + ODDS[r], 0);
  let x = rand() * total;
  let rarity: Rarity = pool[pool.length - 1];
  for (const r of pool) {
    if (x < ODDS[r]) {
      rarity = r;
      break;
    }
    x -= ODDS[r];
  }
  return CHARACTERS.find((c) => c.set === set && c.rarity === rarity)!;
}

export const oddsLabel = (r: Rarity) => `${Math.round(ODDS[r] * 1000) / 10}%`;

export interface Copy {
  character_key: string;
  /** did the current owner pull this copy from their own box? */
  mine: boolean;
}

export interface SetProgress {
  owned: number;
  total: number;
  /** characters in the set where one of your copies came from your own box */
  selfOpened: number;
  complete: boolean;
  canClaim: boolean;
  /** why the prize can't be claimed yet */
  blocker: string | null;
}

export function setProgress(set: SetKey, copies: Copy[]): SetProgress {
  const chars = CHARACTERS.filter((c) => c.set === set);
  const owned = chars.filter((c) => copies.some((x) => x.character_key === c.key)).length;
  const selfOpened = chars.filter((c) => copies.some((x) => x.character_key === c.key && x.mine)).length;
  const complete = owned === chars.length;
  const canClaim = complete && selfOpened >= SELF_OPENED_FOR_PRIZE;
  const blocker = !complete
    ? `${chars.length - owned} to go`
    : selfOpened < SELF_OPENED_FOR_PRIZE
      ? `At least ${SELF_OPENED_FOR_PRIZE} of the 5 must come from your own boxes. Open ${SELF_OPENED_FOR_PRIZE - selfOpened} more yourself.`
      : null;
  return { owned, total: chars.length, selfOpened, complete, canClaim, blocker };
}

/**
 * Which copy leaves in a trade: one you didn't pull yourself first (so a trade never costs you your
 * own pull if it can help it), then the newest.
 */
export function copyToGive<T extends { mine: boolean; acquired: string }>(copies: T[]): T | null {
  if (!copies.length) return null;
  return [...copies].sort((a, b) => (a.mine === b.mine ? (a.acquired < b.acquired ? 1 : -1) : a.mine ? 1 : -1))[0];
}

/** A prize code: LU-GYM-7K2Q9M. Letters and digits that can't be confused with each other. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function prizeCode(set: SetKey, pick: (n: number) => number): string {
  return `LU-${SET_BY_KEY.get(set)!.code}-${Array.from({ length: 6 }, () => CODE_ALPHABET[pick(CODE_ALPHABET.length)]).join('')}`;
}
