/**
 * Daily quests and what they pay. Auto quests come from your own plan (the workout, learning that's
 * due, the journal, clearing the day); the rest you write yourself each day. Coins buy boxes.
 *
 * Kept small on purpose: a full day is worth about one box, so a Legendary means months of kept days.
 */

export type AutoQuestKind = 'workout' | 'learning' | 'journal' | 'plan';
export type QuestSize = 'small' | 'medium' | 'big';

export const AUTO_REWARD: Record<AutoQuestKind, number> = { workout: 30, learning: 20, journal: 10, plan: 25 };
export const SIZE_REWARD: Record<QuestSize, number> = { small: 10, medium: 20, big: 40 };
export const SIZE_LABEL: Record<QuestSize, string> = { small: 'Small', medium: 'Medium', big: 'Big' };
/** Your own quests pay for the first five of a day; more are fine, they're just for you. */
export const PAID_CUSTOM_PER_DAY = 5;
export const MAX_CUSTOM_PER_DAY = 12;
/** Every required quest of the day done. */
export const SWEEP_BONUS = 20;

export interface QuestView {
  key: string;
  kind: AutoQuestKind | 'custom';
  title: string;
  detail: string | null;
  reward: number;
  done: boolean;
  /** counts toward the sweep bonus (optional quests, like a flexible training day, don't) */
  required: boolean;
  /** coins already credited for it */
  paid: boolean;
  id?: string;
  size?: QuestSize;
  href?: string;
}

/** Rewards for a day's custom quests in the order they were added: the first five pay. */
export function customRewards<T extends { size: QuestSize }>(quests: T[]): number[] {
  return quests.map((q, i) => (i < PAID_CUSTOM_PER_DAY ? SIZE_REWARD[q.size] : 0));
}

export function sweepDone(quests: Pick<QuestView, 'required' | 'done'>[]): boolean {
  const req = quests.filter((q) => q.required);
  return req.length > 0 && req.every((q) => q.done);
}
