import 'server-only';
import type { Queryable } from '@/lib/db';
import { safeTimeZone, type ISODate } from '@/lib/engine/dates';

export interface Profile {
  id: string;
  displayName: string;
  timezone: string;
  weekStartsOn: number;
  baseCurrency: string;
  theme: 'system' | 'dark' | 'light';
  accent: 'volt' | 'ember' | 'cobalt' | 'ivory';
  notificationLevel: 'off' | 'minimal' | 'balanced' | 'active';
  streakThreshold: number;
  onboardedAt: Date | null;
  /** when the guided tour was finished or skipped; null means it still starts on Today */
  tutorialDoneAt: Date | null;
  /** shown on the world leaderboards (first name and last initial) */
  worldVisible: boolean;
  createdAt: Date;
  /** tools the user opted into; nothing is created until they use one */
  modules: ('gym' | 'learning' | 'money')[];
  weightUnit: 'kg' | 'lb';
}

export interface Viewer {
  userId: string;
  email: string;
  profile: Profile;
  today: ISODate;
  hour: number;
  minute: number;
}

interface ProfileRow {
  id: string;
  display_name: string;
  timezone: string;
  week_starts_on: number;
  base_currency: string;
  theme: Profile['theme'];
  accent: Profile['accent'];
  notification_level: Profile['notificationLevel'];
  streak_threshold: number;
  onboarded_at: Date | null;
  tutorial_done_at: Date | null;
  world_visible: boolean | null;
  created_at: Date;
  modules: string[] | null;
  weight_unit: 'kg' | 'lb';
}

export async function readProfile(q: Queryable, userId: string): Promise<Profile | null> {
  const [r] = await q.query<ProfileRow>(`select * from profiles where id = $1`, [userId]);
  if (!r) return null;
  return {
    id: r.id,
    displayName: r.display_name,
    timezone: safeTimeZone(r.timezone),
    weekStartsOn: r.week_starts_on,
    baseCurrency: r.base_currency,
    theme: r.theme,
    accent: r.accent,
    notificationLevel: r.notification_level,
    streakThreshold: Number(r.streak_threshold),
    onboardedAt: r.onboarded_at,
    tutorialDoneAt: r.tutorial_done_at ?? null,
    worldVisible: r.world_visible !== false,
    createdAt: r.created_at,
    modules: (r.modules ?? []).filter((m): m is Profile['modules'][number] => m === 'gym' || m === 'learning' || m === 'money'),
    weightUnit: r.weight_unit === 'lb' ? 'lb' : 'kg',
  };
}
