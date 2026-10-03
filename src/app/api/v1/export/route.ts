import { asUser } from '@/lib/db';
import { viewerOrNull } from '@/lib/server/context';
import { allow } from '@/lib/server/rate-limit';

/**
 * "Download my data": every row the user owns, as JSON. The record is earned lock-in, never
 * trapped data — leaving with everything should be one tap. File contents are referenced by
 * id (a full archive with the files is a background job in production).
 */
const TABLES = [
  'profiles', 'areas', 'projects', 'missions', 'mission_schedules', 'completions', 'proofs', 'files', 'xp_events', 'keystones',
  'goals', 'goal_missions', 'goal_checkins', 'day_logs', 'rewards', 'reward_redemptions', 'achievement_unlocks', 'personal_records',
  'timeline_events', 'reviews', 'accounts', 'categories', 'recurring_series', 'transactions', 'account_valuations', 'budgets', 'receipts',
  'journal_entries', 'exercises', 'workout_programs', 'workout_days', 'workout_day_exercises', 'workout_sessions', 'workout_session_exercises',
  'workout_sets', 'body_measurements', 'learning_subjects', 'learning_sessions', 'finance_targets', 'money_plans', 'quests', 'coin_events', 'collectables', 'collectable_trades', 'collectable_prizes',
] as const;

/** Group tables are shared with other members; export only the rows that are yours. */
const OWN_GROUP_ROWS: Record<string, string> = {
  group_memberships: `select * from group_members where user_id = auth.uid()`,
  group_pics: `select * from group_pics where user_id = auth.uid()`,
  group_proof_shares: `select * from group_proof_shares where user_id = auth.uid()`,
};

export async function GET() {
  const viewer = await viewerOrNull();
  if (!viewer) return new Response('Unauthorized', { status: 401 });
  if (!allow(`export:${viewer.userId}`, 5, 3_600_000)) return new Response('Try again later', { status: 429 });
  const data = await asUser(viewer.userId, async (q) => {
    const out: Record<string, unknown[]> = {};
    for (const t of TABLES) out[t] = await q.query(`select * from ${t}`);
    for (const [k, sql] of Object.entries(OWN_GROUP_ROWS)) out[k] = await q.query(sql);
    return out;
  });
  const body = JSON.stringify({ exportedAt: new Date().toISOString(), format: 'kept-export-v2', email: viewer.email, data }, null, 2);
  return new Response(body, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="levelup-export-${viewer.today}.json"`,
      'Cache-Control': 'no-store',
    },
  });
}
