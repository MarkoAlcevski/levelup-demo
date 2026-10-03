import type { AreaKind } from './engine/types';

/**
 * Kept doesn't decide what a life should contain. New users get three optional tools (modules)
 * and the ability to create their own areas — no default routines, targets or life categories.
 */

export type ModuleKey = 'gym' | 'learning' | 'money';

export const MODULES: { key: ModuleKey; name: string; blurb: string }[] = [
  { key: 'gym', name: 'Gym', blurb: 'Build your own program. Log every set.' },
  { key: 'learning', name: 'Learning', blurb: 'Subjects, sessions and time you set.' },
  { key: 'money', name: 'Money', blurb: 'Accounts, spending, budgets, targets.' },
];

/** Icons a user can give an area (keys map to Phosphor icons in components/icons). */
export const AREA_ICONS = [
  'hexagon', 'briefcase', 'code', 'rocket', 'pen', 'camera', 'music', 'microphone', 'video', 'paint',
  'book', 'graduation', 'brain', 'flask', 'chart', 'megaphone', 'handshake', 'target', 'lightning', 'star',
  'run', 'bicycle', 'swim', 'soccer', 'heartbeat', 'heart', 'leaf', 'plant', 'moon', 'sun',
  'church', 'house', 'users', 'compass', 'globe', 'coffee', 'game', 'hammer', 'wrench', 'sparkle',
] as const;
export type AreaIconKey = (typeof AREA_ICONS)[number] | 'barbell' | 'wallet';

const KIND_ICON: Record<AreaKind, AreaIconKey> = {
  gym: 'barbell',
  body: 'barbell',
  learning: 'book',
  money: 'wallet',
  work: 'briefcase',
  health: 'heartbeat',
  relationships: 'users',
  personal: 'compass',
  custom: 'hexagon',
};

export function areaIcon(kind: AreaKind | string, icon?: string | null): AreaIconKey {
  if (icon && (AREA_ICONS as readonly string[]).includes(icon)) return icon as AreaIconKey;
  return KIND_ICON[(kind as AreaKind) in KIND_ICON ? (kind as AreaKind) : 'custom'];
}

/** V1 kinds shown the V2 way: a Body area is the Gym area; everything else is just an area. */
export function isGymKind(kind: AreaKind | string): boolean {
  return kind === 'gym' || kind === 'body';
}

export function isModuleArea(kind: AreaKind | string): boolean {
  return isGymKind(kind) || kind === 'learning';
}

/** Examples only — shown as placeholders, never pre-selected. */
export const AREA_EXAMPLES = ['Business', 'Coding', 'Content', 'Faith', 'University', 'Running', 'Music', 'Side project'];
export const WORKOUT_NAME_EXAMPLES = ['Push', 'Pull', 'Legs', 'Upper', 'Lower', 'Full Body', 'Chest + Back', 'Arms'];
export const SUBJECT_EXAMPLES = ['German', 'Sales', 'Programming', 'Math', 'History', 'Piano'];
