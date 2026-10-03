import 'server-only';
import { createHash, randomBytes } from 'node:crypto';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { cache } from 'react';
import { asSystem, type Queryable } from '@/lib/db';
import { dummyHash, hashPassword, verifyPassword } from './password';

/**
 * Local auth: email + password, opaque session tokens.
 * The cookie holds a random 256-bit token; the database only stores its SHA-256, so a leaked
 * database can't be replayed as sessions. Cookies are httpOnly + SameSite=Lax (+ Secure in prod);
 * Server Actions additionally get Next's built-in Origin check against CSRF.
 *
 * Swapping to Supabase Auth replaces this file only: getSession() would return the id from
 * supabase.auth.getUser(), and every query path (asUser) stays identical.
 */

export const SESSION_COOKIE = 'kept_session';
const SESSION_DAYS = 30;

export interface Session {
  userId: string;
  email: string;
}

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

async function setSessionCookie(token: string, expires: Date) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    expires,
  });
}

async function createSession(q: Queryable, userId: string): Promise<void> {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const ua = ((await headers()).get('user-agent') ?? '').slice(0, 300);
  await q.query(
    `insert into local_auth.sessions (id, user_id, expires_at, user_agent) values ($1, $2, $3, $4)`,
    [sha256(token), userId, expires.toISOString(), ua],
  );
  await setSessionCookie(token, expires);
}

/** Current session, cached per request. */
export const getSession = cache(async (): Promise<Session | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const rows = await asSystem((q) =>
    q.query<{ user_id: string; email: string; last_seen_at: Date }>(
      `select s.user_id, u.email, s.last_seen_at
         from local_auth.sessions s join auth.users u on u.id = s.user_id
        where s.id = $1 and s.expires_at > now()`,
      [sha256(token)],
    ),
  );
  const row = rows[0];
  if (!row) return null;
  if (Date.now() - new Date(row.last_seen_at).getTime() > 3_600_000) {
    void asSystem((q) => q.query(`update local_auth.sessions set last_seen_at = now() where id = $1`, [sha256(token)])).catch(() => {});
  }
  return { userId: row.user_id, email: row.email };
});

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect('/login');
  return s;
}

// ───────────────────────────────────────────── rate limiting (attempts table)

async function hit(q: Queryable, key: string, max: number, windowMin: number): Promise<boolean> {
  const rows = await q.query<{ count: number }>(
    `insert into local_auth.attempts (key, count, window_start) values ($1, 1, now())
     on conflict (key) do update set
       count = case when local_auth.attempts.window_start < now() - make_interval(mins => $2) then 1 else local_auth.attempts.count + 1 end,
       window_start = case when local_auth.attempts.window_start < now() - make_interval(mins => $2) then now() else local_auth.attempts.window_start end
     returning count`,
    [key, windowMin],
  );
  return (rows[0]?.count ?? 0) <= max;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get('x-forwarded-for')?.split(',')[0] ?? h.get('x-real-ip') ?? 'local').trim().slice(0, 64);
}

export type AuthResult = { ok: true; userId: string } | { ok: false; error: string; field?: 'email' | 'password' };

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function signUp(emailRaw: string, password: string, timezone: string): Promise<AuthResult> {
  const email = normalizeEmail(emailRaw);
  const ip = await clientIp();
  return asSystem(async (q) => {
    if (!(await hit(q, `signup:${ip}`, 10, 60))) return { ok: false, error: 'Too many sign-ups from this network. Try again in an hour.' };
    const exists = await q.query(`select 1 from auth.users where email = $1`, [email]);
    if (exists.length) return { ok: false, error: 'An account with this email already exists. Sign in instead.', field: 'email' };
    const [user] = await q.query<{ id: string }>(`insert into auth.users (email) values ($1) returning id`, [email]);
    await q.query(`insert into local_auth.credentials (user_id, password_hash) values ($1, $2)`, [user.id, await hashPassword(password)]);
    await q.query(`update public.profiles set timezone = $2 where id = $1`, [user.id, timezone]);
    await createSession(q, user.id);
    return { ok: true, userId: user.id };
  });
}

export async function signIn(emailRaw: string, password: string): Promise<AuthResult> {
  const email = normalizeEmail(emailRaw);
  return asSystem(async (q) => {
    if (!(await hit(q, `login:${email}`, 10, 15))) {
      return { ok: false, error: 'Too many attempts. Wait 15 minutes, then try again.' };
    }
    const rows = await q.query<{ id: string; password_hash: string }>(
      `select u.id, c.password_hash from auth.users u join local_auth.credentials c on c.user_id = u.id where u.email = $1`,
      [email],
    );
    const row = rows[0];
    const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash()));
    if (!row || !ok) return { ok: false, error: 'Email or password is incorrect.' };
    await q.query(`delete from local_auth.attempts where key = $1`, [`login:${email}`]);
    await q.query(`delete from local_auth.sessions where user_id = $1 and expires_at < now()`, [row.id]);
    await createSession(q, row.id);
    return { ok: true, userId: row.id };
  });
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await asSystem((q) => q.query(`delete from local_auth.sessions where id = $1`, [sha256(token)]));
  jar.delete(SESSION_COOKIE);
}

/** Dev/demo only: sign in as a known user id (used after seeding the demo account). */
export async function startSessionFor(userId: string): Promise<void> {
  await asSystem((q) => createSession(q, userId));
}
