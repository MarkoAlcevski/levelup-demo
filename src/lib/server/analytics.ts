import 'server-only';
import { asUser } from '@/lib/db';

/**
 * Product analytics — first-party, typed, object_action names. Events never carry content
 * (no titles, amounts, notes): only shapes and counts. The warehouse reads analytics_events
 * with the service role; users can insert their own events and read none.
 *
 * Activation   = onboarding_completed → first mission_completed (same or next day)
 * Deep activation = mission_completed on 3 distinct days within the first 7
 * Retention    = app_opened on D1 / D7 / D30 after account_created
 */
export type EventName =
  | 'account_created'
  | 'demo_started'
  | 'app_opened'
  | 'onboarding_completed'
  | 'mission_created'
  | 'mission_updated'
  | 'mission_archived'
  | 'mission_completed'
  | 'mission_logged'
  | 'completion_undone'
  | 'proof_attached'
  | 'keystone_set'
  | 'keystone_completed'
  | 'review_generated'
  | 'review_viewed'
  | 'transaction_logged'
  | 'money_account_added'
  | 'achievement_unlocked'
  | 'reward_created'
  | 'reward_redeemed'
  | 'goal_created'
  | 'replay_viewed'
  | 'replay_shared'
  | 'command_used'
  | 'offline_replayed'
  | 'area_created'
  | 'area_archived'
  | 'gym_program_created'
  | 'workout_completed'
  | 'learning_subject_created'
  | 'learning_session_logged'
  | 'group_created'
  | 'group_joined'
  | 'group_left'
  | 'season_closed'
  | 'journal_written'
  | 'transaction_edited'
  | 'balance_reconciled'
  | 'budget_saved'
  | 'target_saved'
  | 'recurring_saved'
  | 'quest_created'
  | 'quest_completed'
  | 'gym_pic_posted'
  | 'box_opened'
  | 'trade_offered'
  | 'trade_accepted'
  | 'prize_claimed'
  | 'tutorial_completed'
  | 'tutorial_skipped';

type Props = Record<string, string | number | boolean | null>;

export async function track(userId: string, name: EventName, props: Props = {}, client: 'web' | 'pwa' | 'server' = 'server'): Promise<void> {
  try {
    await asUser(userId, (q) =>
      q.query(`insert into analytics_events (name, props, client) values ($1, $2, $3)`, [name, JSON.stringify(props), client]),
    );
  } catch (e) {
    // analytics must never break the product
    if (process.env.NODE_ENV !== 'production') console.warn('[kept] track failed', name, (e as Error).message);
  }
}
