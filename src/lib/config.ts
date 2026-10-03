import 'server-only';

/**
 * Deployment switches (all optional):
 *   KEPT_INVITE_CODE   sign-up requires this code — send it to friends with the link
 *   KEPT_DEMO_MODE     off | shared | sandbox
 *                      shared  = one demo account rebuilt on each click (local development)
 *                      sandbox = every visitor gets a private demo account, deleted after 24 h (hosting)
 */
export function inviteCode(): string | null {
  return process.env.KEPT_INVITE_CODE?.trim() || null;
}

export type DemoMode = 'off' | 'shared' | 'sandbox';

export function demoMode(): DemoMode {
  const v = process.env.KEPT_DEMO_MODE?.trim();
  if (v === 'off' || v === 'shared' || v === 'sandbox') return v;
  if (process.env.KEPT_DISABLE_DEMO === '1') return 'off';
  return process.env.KEPT_DEMO_PASSWORD ? 'shared' : 'off';
}
