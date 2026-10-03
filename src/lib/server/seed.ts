import 'server-only';
import { randomInt, randomUUID } from 'node:crypto';
import { asSystem, asUser, type Queryable } from '@/lib/db';
import { hashPassword } from '@/lib/auth/password';
import { addDays, addMonths, clockInZone, diffDays, eachDay, isoWeekday, jsWeekday, startOfMonth, startOfWeek, todayIn, type ISODate } from '@/lib/engine/dates';
import { creditFor, outcomeForValue } from '@/lib/engine/outcome';
import type { Difficulty, Measure, Outcome } from '@/lib/engine/types';
import { rebuildXpLedger } from './completions';
import { ensureGroupSeasons } from './group-seasons';
import { storeUpload } from './files';
import { SET_BY_KEY, CHARACTER_BY_KEY } from '@/lib/engine/collectables';
import { SIZE_REWARD, type QuestSize } from '@/lib/engine/quests';
import { storage } from './storage';
import { readProfile } from './profile';
import { loadProgress } from './progress';
import { ensureWeeklyReviews } from './reviews';
import { loadYou } from './you';

/**
 * Demo account: ~150 days of believable history, generated deterministically (fixed PRNG seed)
 * relative to "today", so the dashboards always look lived-in. V2 shape: Gym (an Upper/Lower
 * program with every workout logged set by set), Learning (German, Reading), two areas of the
 * user's own (Business, Health), Money with a plan, a journal, and a group of friends with
 * finished seasons. The behaviour has patterns on purpose — the insight engine should find them:
 *   - execution improves from ~70% to ~88% over the period
 *   - gym almost always happens when started before 18:00; evening attempts fail half the time
 *   - reading collapses on Fridays and whenever it slips past 21:00
 *   - deep work peaks on Tuesdays
 *   - a 3-day break ~6 weeks ago, then a comeback; one bad Wednesday recently, recovered next day
 *   - income grows month over month; restaurant spending ran hot in the last 30 days
 */

const TZ = 'Europe/Skopje';
const HISTORY = 148;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface SeedMission {
  key: string;
  area: string;
  title: string;
  measure: Measure;
  unit?: string;
  target?: number;
  minimum?: number;
  minimumLabel?: string;
  difficulty: Difficulty;
  proof: 'off' | 'optional' | 'recommended' | 'required';
  timeOfDay?: 'morning' | 'afternoon' | 'evening';
  priority?: boolean;
  schedules: { cadence: 'daily' | 'weekly' | 'days' | 'once'; perWeek?: number; weekdays?: number[]; dueOn?: ISODate; from: number; to?: number }[];
  module?: 'gym' | 'learning';
  /** base probability of keeping it on a due day */
  p: number;
  sortOrder: number;
  project?: boolean;
}

/** Local wall-clock → UTC ISO string, for Europe/Skopje (UTC+1, +2 in summer). */
function localToIso(day: ISODate, hour: number, minute: number): string {
  const guess = new Date(`${day}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`);
  const shown = clockInZone(guess, TZ);
  const offsetH = (shown.hour - hour + 24) % 24;
  return new Date(guess.getTime() - offsetH * 3_600_000).toISOString();
}

async function insertJson(q: Queryable, table: string, columns: string, types: string, rows: object[]) {
  for (let i = 0; i < rows.length; i += 400) {
    await q.query(
      `insert into ${table} (${columns}) select ${columns} from jsonb_to_recordset($1::jsonb) as x(${types})`,
      [JSON.stringify(rows.slice(i, i + 400))],
    );
  }
}

function placeholderSvg(label: string, sub: string, hue: number, n: number): string {
  const stripes = Array.from({ length: 24 }, (_, i) => `<rect x="${i * 60 - 400}" y="-50" width="22" height="1400" fill="hsl(${hue} 10% 16%)" transform="rotate(35 400 500)"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1125" viewBox="0 0 900 1125">
    <rect width="900" height="1125" fill="hsl(${hue} 9% 12%)"/>${stripes}
    <rect x="48" y="48" width="804" height="1029" fill="none" stroke="hsl(${hue} 8% 30%)" stroke-width="2" stroke-dasharray="10 10"/>
    <text x="80" y="140" font-family="monospace" font-size="34" fill="hsl(${hue} 10% 62%)" letter-spacing="4">DEMO PROOF · ${n}</text>
    <text x="80" y="250" font-family="sans-serif" font-size="88" font-weight="700" fill="hsl(${hue} 12% 88%)">${label}</text>
    <text x="80" y="310" font-family="monospace" font-size="36" fill="hsl(${hue} 10% 60%)">${sub}</text>
  </svg>`;
}

const SANDBOX = /^sandbox-(\d{13})-[a-z0-9]+@kept\.local$/;
const SANDBOX_TTL_MS = 24 * 3_600_000;

/**
 * A private demo for one visitor: a fresh, fully seeded account nobody else can see.
 * Sandboxes expire after 24 hours; each new one sweeps the expired ones (rows and files).
 */
export async function createDemoSandbox(): Promise<string> {
  await sweepExpiredSandboxes().catch((e) => console.error('[kept] sandbox sweep failed', e));
  const email = `sandbox-${Date.now()}-${randomUUID().slice(0, 8)}@kept.local`;
  return seedDemo(email, randomUUID());
}

export async function sweepExpiredSandboxes(): Promise<number> {
  const users = await asSystem((q) => q.query<{ id: string; email: string }>(`select id, email from auth.users where email like 'sandbox-%@kept.local'`));
  const expired = users.filter((u) => {
    const m = SANDBOX.exec(u.email);
    return m && Date.now() - Number(m[1]) > SANDBOX_TTL_MS;
  });
  for (const u of expired) await deleteUserWithFiles(u.id);
  return expired.length;
}

/** Delete an account: stored objects first, then the user row (every table cascades from it). */
async function deleteUserWithFiles(userId: string): Promise<void> {
  const s = storage();
  const files = await asSystem((q) =>
    q.query<{ bucket: 'proofs' | 'receipts'; object_path: string; thumb_path: string | null }>(
      `select bucket, object_path, thumb_path from public.files where user_id = $1`,
      [userId],
    ),
  );
  for (const f of files) await s.remove(f.bucket, [f.object_path, ...(f.thumb_path ? [f.thumb_path] : [])]).catch(() => {});
  await asSystem((q) => q.query(`delete from auth.users where id = $1`, [userId]));
}

export async function seedDemo(email: string, password: string): Promise<string> {
  const today = todayIn(TZ);
  const nowHour = clockInZone(new Date(), TZ).hour;
  const start = addDays(today, -HISTORY);
  const rand = mulberry32(20260926);
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
  const between = (a: number, b: number) => a + rand() * (b - a);
  const int = (a: number, b: number) => Math.floor(between(a, b + 1));

  // ── account (system): wipe any previous demo user (and their files), create fresh
  const [old] = await asSystem((q) => q.query<{ id: string }>(`select id from auth.users where email = $1`, [email]));
  if (old) {
    const friends = await asSystem((q) => q.query<{ id: string }>(`select id from auth.users where email like $1`, [`demo-member-${old.id.slice(0, 8)}-%@kept.local`]));
    for (const f of friends) await deleteUserWithFiles(f.id);
    await deleteUserWithFiles(old.id);
  }
  const userId = await asSystem(async (q) => {
    const [u] = await q.query<{ id: string }>(`insert into auth.users (email, created_at) values ($1, $2) returning id`, [email, `${start}T08:00:00Z`]);
    await q.query(`insert into local_auth.credentials (user_id, password_hash) values ($1, $2)`, [u.id, await hashPassword(password)]);
    await q.query(
      `update public.profiles set display_name = 'Alex', timezone = $2, week_starts_on = 1, base_currency = 'EUR', onboarded_at = $3, created_at = $3,
              modules = array['gym', 'learning', 'money'], weight_unit = 'kg' where id = $1`,
      [u.id, TZ, `${start}T08:05:00Z`],
    );
    return u.id;
  });

  const proofFiles: { day: ISODate; missionKey: string; label: string }[] = [];

  await asUser(userId, async (q) => {
    // ── areas
    // Gym and Learning are modules; Business and Health are areas the user made
    const areaDefs = [
      ['gym', 'gym', 'Gym', 'barbell'], ['learning', 'learning', 'Learning', 'book'],
      ['work', 'custom', 'Business', 'briefcase'], ['health', 'custom', 'Health', 'heartbeat'],
    ] as const;
    const areaIds = new Map<string, string>();
    for (const [i, [key, kind, name, icon]] of areaDefs.entries()) {
      const [a] = await q.query<{ id: string }>(`insert into areas (kind, name, icon, sort_order, created_at) values ($1, $2, $3, $4, $5) returning id`, [kind, name, icon, i, `${start}T08:05:00Z`]);
      areaIds.set(key, a.id);
    }

    // ── project with steps
    const [project] = await q.query<{ id: string }>(
      `insert into projects (area_id, title, description, target_on, created_at) values ($1, 'Launch the landing page', 'Offer → copy → build → publish → first visitors.', $2, $3) returning id`,
      [areaIds.get('work'), addDays(today, 5), `${addDays(today, -30)}T09:00:00Z`],
    );

    const d = (offsetFromToday: number) => addDays(today, offsetFromToday);
    const gymSwitch = -HISTORY + 61; // 3×/week → 4×/week after two months
    const readSwitch = -HISTORY + 75; // 45 min → 30 min
    const missions: SeedMission[] = [
      { key: 'deepwork', area: 'work', title: 'Deep work', measure: 'duration', unit: 'min', target: 90, minimum: 30, difficulty: 'hard', proof: 'optional', timeOfDay: 'morning', priority: true, schedules: [{ cadence: 'days', weekdays: [1, 2, 3, 4, 5], from: -HISTORY }], p: 0.84, sortOrder: 0 },
      { key: 'outreach', area: 'work', title: 'Outreach', measure: 'quantity', unit: 'messages', target: 20, minimum: 5, difficulty: 'normal', proof: 'optional', schedules: [{ cadence: 'weekly', perWeek: 5, from: -HISTORY }], p: 0.8, sortOrder: 1 },
      { key: 'gym', area: 'gym', module: 'gym', title: 'Gym', measure: 'check', difficulty: 'hard', proof: 'recommended', timeOfDay: 'afternoon', schedules: [{ cadence: 'weekly', perWeek: 3, from: -HISTORY, to: gymSwitch }, { cadence: 'weekly', perWeek: 4, from: gymSwitch }], p: 0.86, sortOrder: 2 },
      { key: 'steps', area: 'health', title: 'Steps', measure: 'quantity', unit: 'steps', target: 8000, minimum: 5000, difficulty: 'easy', proof: 'off', schedules: [{ cadence: 'daily', from: -HISTORY }], p: 0.82, sortOrder: 3 },
      { key: 'read', area: 'learning', module: 'learning', title: 'Reading', measure: 'duration', unit: 'min', target: 30, minimum: 10, difficulty: 'normal', proof: 'optional', timeOfDay: 'evening', schedules: [{ cadence: 'weekly', perWeek: 5, from: -HISTORY }], p: 0.8, sortOrder: 4 },
      { key: 'german', area: 'learning', module: 'learning', title: 'German', measure: 'duration', unit: 'min', target: 45, minimum: 15, difficulty: 'normal', proof: 'optional', schedules: [{ cadence: 'weekly', perWeek: 3, from: -HISTORY + 14 }], p: 0.78, sortOrder: 5 },
      { key: 'sleep', area: 'health', title: 'In bed by 23:30', measure: 'check', difficulty: 'normal', proof: 'off', timeOfDay: 'evening', schedules: [{ cadence: 'daily', from: -HISTORY + 30 }], p: 0.72, sortOrder: 7 },
      { key: 'offer', area: 'work', title: 'Choose the offer', measure: 'check', difficulty: 'hard', proof: 'recommended', schedules: [{ cadence: 'once', dueOn: d(-27), from: -30 }], p: 1, sortOrder: 8, project: true },
      { key: 'copy', area: 'work', title: 'Write the landing copy', measure: 'check', difficulty: 'hard', proof: 'recommended', schedules: [{ cadence: 'once', dueOn: d(-16), from: -30 }], p: 1, sortOrder: 9, project: true },
      { key: 'build', area: 'work', title: 'Build the page', measure: 'check', difficulty: 'extreme', proof: 'recommended', schedules: [{ cadence: 'once', dueOn: d(-7), from: -30 }], p: 1, sortOrder: 10, project: true },
      { key: 'publish', area: 'work', title: 'Publish + first 10 visitors', measure: 'check', difficulty: 'extreme', proof: 'required', schedules: [{ cadence: 'once', dueOn: d(1), from: -30 }], p: 0, sortOrder: 11, project: true },
    ];

    const missionIds = new Map<string, string>();
    for (const m of missions) {
      const created = `${d(m.schedules[0].from)}T08:10:00Z`;
      const [row] = await q.query<{ id: string }>(
        `insert into missions (area_id, project_id, title, measure, unit, target_value, minimum_value, minimum_label, difficulty,
                               proof_policy, time_of_day, is_priority, sort_order, created_at, module)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15) returning id`,
        [
          areaIds.get(m.area), m.project ? project.id : null, m.title, m.measure, m.unit ?? null, m.target ?? null, m.minimum ?? null,
          m.minimumLabel ?? (m.minimum && m.unit ? `${m.minimum} ${m.unit}` : null), m.difficulty, m.proof, m.timeOfDay ?? null,
          !!m.priority, m.sortOrder, created, m.module ?? null,
        ],
      );
      missionIds.set(m.key, row.id);
      for (const s of m.schedules) {
        await q.query(
          `insert into mission_schedules (mission_id, cadence, per_week, weekdays, due_on, valid_from, valid_to) values ($1, $2, $3, $4, $5, $6, $7)`,
          [row.id, s.cadence, s.perWeek ?? null, s.weekdays ?? null, s.dueOn ?? null, d(s.from), s.to != null ? d(s.to) : null],
        );
      }
    }

    // ── behaviour simulation
    type Row = { mission_id: string; occurred_on: string; outcome: Outcome; value: number | null; target_value: number | null; minimum_value: number | null; difficulty: string; credit: number; reason: string | null; note: string | null; logged_at: string; source: string };
    const completions: Row[] = [];
    const breakDays = new Set([d(-44), d(-43), d(-42)]);
    const badDay = d(-10);
    const weekCount = new Map<string, number>();
    const days = eachDay(start, d(-1)).concat([today]);

    for (const day of days) {
      const t = diffDays(start, day) / HISTORY; // 0 → 1 across the period
      const trend = 0.8 + 0.2 * t; // improvement over time
      const wd = isoWeekday(day);
      const isToday = day === today;
      const ws = startOfWeek(day, 1);
      for (const m of missions) {
        if (m.project) continue;
        const sched = m.schedules.find((s) => d(s.from) <= day && (s.to == null || day < d(s.to)));
        if (!sched) continue;
        const id = missionIds.get(m.key)!;
        const wkKey = `${m.key}:${ws}`;
        const doneThisWeek = weekCount.get(wkKey) ?? 0;
        if (sched.cadence === 'days' && !sched.weekdays!.includes(wd)) continue;
        if (sched.cadence === 'weekly') {
          if (doneThisWeek >= sched.perWeek! + (rand() < 0.08 ? 1 : 0)) continue;
          const daysLeft = 8 - wd;
          const need = sched.perWeek! - doneThisWeek;
          const urgency = need >= daysLeft ? 1 : need / daysLeft + 0.2;
          if (rand() > Math.min(1, urgency + 0.15)) continue; // chose not to go today
        }

        // time of the attempt, in local hours
        let hour: number;
        let p = Math.min(0.99, m.p * trend);
        switch (m.key) {
          case 'gym': {
            hour = rand() < 0.62 ? int(7, 17) : int(18, 21);
            p = hour < 18 ? 0.95 : 0.52;
            break;
          }
          case 'read': {
            const late = wd === 5 || wd === 6 || rand() < 0.18;
            hour = late ? int(21, 23) : int(19, 20);
            p = late ? 0.34 : Math.min(0.97, 0.9 * trend + 0.08);
            break;
          }
          case 'deepwork':
            hour = int(8, 11);
            if (wd === 2) p = Math.min(0.99, p + 0.12);
            if (wd === 5) p -= 0.12;
            break;
          case 'steps':
            hour = int(20, 22);
            break;
          case 'sleep':
            hour = 23;
            break;
          default:
            hour = int(10, 19);
        }
        if (breakDays.has(day)) p = 0.04;
        if (day === badDay) p = 0.15;
        if (isToday && hour >= nowHour) continue; // hasn't happened yet today

        const r = rand();
        let outcome: Outcome;
        let value: number | null = null;
        if (r < p) {
          if (m.measure === 'check') outcome = rand() < 0.1 && m.minimumLabel ? 'minimum' : 'full';
          else {
            const shape = rand();
            const tv = m.target!;
            value =
              m.key === 'read' && diffDays(start, day) < 75
                ? Math.round(between(0.55, 1.05) * 45) // old 45-minute target: often short of it
                : shape < 0.15 ? Math.round(between(1.0, 1.6) * tv)
                : shape < 0.3 ? Math.round(between(m.minimum! / tv, 0.95) * tv)
                : tv;
            if (m.key === 'steps') value = Math.round(value / 10) * 10;
            outcome = outcomeForValue({ measure: m.measure, targetValue: m.key === 'read' && diffDays(start, day) < 75 ? 45 : tv, minimumValue: m.minimum ?? null, exceedRatio: 1.25 }, value);
          }
        } else if (r < p + 0.08 && m.measure !== 'check') {
          value = Math.max(1, Math.round(between(0.15, 0.3) * m.target!));
          outcome = outcomeForValue({ measure: m.measure, targetValue: m.target!, minimumValue: m.minimum ?? null, exceedRatio: 1.25 }, value);
          if (outcome !== 'partial') outcome = 'partial';
        } else {
          // a miss: sometimes explained in the night review
          if (breakDays.has(day) && rand() < 0.5) {
            completions.push({ mission_id: id, occurred_on: day, outcome: 'missed', value: null, target_value: m.target ?? null, minimum_value: m.minimum ?? null, difficulty: m.difficulty, credit: 0, reason: 'sick', note: null, logged_at: localToIso(day, 21, 30), source: 'seed' });
          } else if (rand() < 0.35 && !isToday) {
            const reason = m.key === 'read' ? pick(['no_time', 'no_time', 'low_energy', 'procrastinated']) : pick(['no_time', 'unexpected', 'low_energy', 'forgot']);
            completions.push({ mission_id: id, occurred_on: day, outcome: 'missed', value: null, target_value: m.target ?? null, minimum_value: m.minimum ?? null, difficulty: m.difficulty, credit: 0, reason, note: null, logged_at: localToIso(day, 22, int(0, 50)), source: 'seed' });
          }
          continue;
        }
        const target = m.key === 'read' && diffDays(start, day) < 75 ? 45 : m.target ?? null;
        const credit = creditFor({ measure: m.measure, targetValue: target, minimumValue: m.minimum ?? null, exceedRatio: 1.25 }, outcome, value);
        completions.push({
          mission_id: id, occurred_on: day, outcome, value, target_value: target, minimum_value: m.minimum ?? null,
          difficulty: m.difficulty, credit, reason: null, note: null, logged_at: localToIso(day, hour, int(0, 59)), source: 'seed',
        });
        if (outcome === 'full' || outcome === 'exceeded' || outcome === 'minimum') weekCount.set(wkKey, doneThisWeek + 1);
      }
    }

    // project steps, done on (or near) their deadlines
    const projectDone: [string, number, number][] = [['offer', -28, 11], ['copy', -17, 15], ['build', -8, 20]];
    for (const [key, off, hour] of projectDone) {
      completions.push({
        mission_id: missionIds.get(key)!, occurred_on: d(off), outcome: 'full', value: null, target_value: null, minimum_value: null,
        difficulty: missions.find((m) => m.key === key)!.difficulty, credit: 1, reason: null, note: null, logged_at: localToIso(d(off), hour, 30), source: 'seed',
      });
    }

    // notes on a handful of completions
    const noteBank: Record<string, string[]> = {
      deepwork: ['Pricing page v2 done.', 'Wrote the onboarding email sequence.', 'Refactored the outreach script. Cleaner.', 'Three hours on the proposal. Worth it.'],
      read: ['Deep Work — the shutdown ritual chapter.', 'Finished "The Mom Test". Rewriting my interview questions.', '40 pages of Atomic Habits.'],
      gym: ['Deadlift 140 × 3. New best.', 'Legs. Short but honest.', 'Push day, 55 minutes.'],
      outreach: ['23 sent, 4 replies, 1 call booked.', '20 sent to agencies. 2 replies.'],
      german: ['Lesson 14: Konjunktiv II. Painful.', 'Podcast + 30 flashcards.'],
    };
    for (const c of completions) {
      const key = [...missionIds.entries()].find(([, v]) => v === c.mission_id)?.[0] ?? '';
      if (noteBank[key] && c.outcome !== 'missed' && c.outcome !== 'skipped' && rand() < 0.07) c.note = pick(noteBank[key]);
    }

    await insertJson(
      q, 'completions',
      'mission_id, occurred_on, outcome, value, target_value, minimum_value, difficulty, credit, reason, note, logged_at, source',
      'mission_id uuid, occurred_on date, outcome text, value numeric, target_value numeric, minimum_value numeric, difficulty text, credit numeric, reason text, note text, logged_at timestamptz, source text',
      completions,
    );

    // ── proof: notes, links, and honest placeholder photos
    const kept = await q.query<{ id: string; mission_id: string; occurred_on: string; note: string | null }>(
      `select id, mission_id, occurred_on, note from completions where kept order by occurred_on`,
    );
    const keyOf = new Map([...missionIds.entries()].map(([k, v]) => [v, k]));
    const proofRows: { completion_id: string; kind: string; body: string | null; url: string | null; captured_on: string }[] = [];
    for (const c of kept) {
      const key = keyOf.get(c.mission_id)!;
      if (c.note && rand() < 0.8) proofRows.push({ completion_id: c.id, kind: 'note', body: c.note, url: null, captured_on: c.occurred_on });
      else if (key === 'gym' && rand() < 0.3) proofFiles.push({ day: c.occurred_on, missionKey: key, label: 'Gym' });
      else if (key === 'deepwork' && rand() < 0.05) proofRows.push({ completion_id: c.id, kind: 'link', body: 'Commit pushed', url: `https://github.com/alex-demo/landing/commit/${randomUUID().slice(0, 7)}`, captured_on: c.occurred_on });
      else if (key === 'read' && rand() < 0.06) proofFiles.push({ day: c.occurred_on, missionKey: key, label: 'Read' });
      else if (['offer', 'copy', 'build'].includes(key)) proofFiles.push({ day: c.occurred_on, missionKey: key, label: key === 'offer' ? 'Offer' : key === 'copy' ? 'Copy' : 'Build' });
    }
    await insertJson(q, 'proofs', 'completion_id, kind, body, url, captured_on', 'completion_id uuid, kind text, body text, url text, captured_on date', proofRows);

    // ── keystones: one per week
    const keystoneTitles = [
      'Finish the pricing model', 'Ship v1 of the outreach script', 'Deadlift 140 kg', 'Close the first freelance client',
      'Read Deep Work to the end', 'Rebuild the portfolio page', 'Book 5 discovery calls', 'Set up the savings split',
      'Finish German module 3', 'Write 10 case-study drafts', 'Clean up the finances', 'Record the demo video',
      'Get the offer reviewed by 3 people', 'Launch the waitlist', 'Run 10 km', 'Draft the landing copy', 'Build the landing page',
      'Hit 100 outreach messages', 'Design the logo', 'Plan Q4',
    ];
    const thisWeek = startOfWeek(today, 1);
    let ki = 0;
    for (let w = startOfWeek(addDays(start, 7), 1); w < thisWeek; w = addDays(w, 7)) {
      const done = rand() < 0.72 && !(w <= d(-42) && addDays(w, 6) >= d(-44));
      await q.query(
        `insert into keystones (week_start, title, status, done_at, created_at) values ($1, $2, $3, $4, $5)`,
        [w, keystoneTitles[ki++ % keystoneTitles.length], done ? 'done' : 'missed', done ? localToIso(addDays(w, int(2, 5)), 18, 0) : null, `${w}T07:00:00Z`],
      );
    }
    await q.query(
      `insert into keystones (week_start, title, mission_id, status, created_at) values ($1, 'Publish the landing page', $2, 'open', $3)`,
      [thisWeek, missionIds.get('publish'), `${thisWeek}T07:30:00Z`],
    );

    // ── goals
    const [g1] = await q.query<{ id: string }>(
      `insert into goals (area_id, title, kind, metric, currency, start_value, target_value, start_on, target_on) values ($1, 'Reach €3,000/month income', 'outcome', 'income_month', 'EUR', 1000, 3000, $2, $3) returning id`,
      [areaIds.get('work'), start, addMonths(start, 12)],
    );
    for (const k of ['deepwork', 'outreach']) await q.query(`insert into goal_missions (goal_id, mission_id) values ($1, $2)`, [g1.id, missionIds.get(k)]);
    const [g2] = await q.query<{ id: string }>(
      `insert into goals (area_id, title, kind, metric, unit, start_value, target_value, start_on, target_on) values ($1, 'Get to 80 kg', 'outcome', 'manual', 'kg', 86, 80, $2, $3) returning id`,
      [areaIds.get('gym'), start, addMonths(start, 7)],
    );
    await q.query(`insert into goal_missions (goal_id, mission_id) values ($1, $2), ($1, $3)`, [g2.id, missionIds.get('gym'), missionIds.get('steps')]);
    for (let k = 0; k * 14 < HISTORY; k++) {
      const w = 86 - k * 0.42 + between(-0.4, 0.4);
      await q.query(`insert into goal_checkins (goal_id, value, recorded_on) values ($1, $2, $3)`, [g2.id, Math.round(w * 10) / 10, addDays(start, k * 14)]);
    }
    const [g3] = await q.query<{ id: string }>(
      `insert into goals (area_id, title, kind, metric, unit, start_value, target_value, start_on, target_on) values ($1, 'Read 20 books this year', 'input', 'manual', 'books', 0, 20, $2, $3) returning id`,
      [areaIds.get('learning'), `${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`],
    );
    await q.query(`insert into goal_missions (goal_id, mission_id) values ($1, $2)`, [g3.id, missionIds.get('read')]);
    await q.query(`insert into goal_checkins (goal_id, value, recorded_on) values ($1, 9, $2), ($1, 12, $3)`, [g3.id, d(-60), d(-5)]);

    // ── timeline
    const timeline: [ISODate, string, string, string][] = [
      [start, 'start', 'Day 1 of the record', '7 routines across Gym, Learning, Business and Health.'],
      [d(-HISTORY + 61), 'milestone', 'Gym up to 4× a week', 'Raised the weekly target after 8 steady weeks.'],
      [d(-HISTORY + 75), 'milestone', 'Reading target cut to 30 min', 'Hit more often at 30 than at 45.'],
      [d(-41), 'milestone', 'Comeback after 3 days off', 'Back the day after the break ended.'],
      [d(-28), 'project', 'Offer chosen', 'Launch the landing page · step 1 of 4'],
      [d(-17), 'project', 'Landing copy written', 'Launch the landing page · step 2 of 4'],
      [d(-8), 'project', 'Landing page built', 'Launch the landing page · step 3 of 4'],
      [startOfMonth(d(-26)), 'money', 'Best income month yet', 'Income above €1,300 for the first time.'],
    ];
    for (const [day, kind, title, detail] of timeline) {
      await q.query(`insert into timeline_events (occurred_on, kind, title, detail, source_key) values ($1, $2, $3, $4, $5)`, [day, kind, title, detail, `seed:${title}`]);
    }

    await seedMoney(q, today, start, rand);
    await seedModules(q, { today, start, rand, missionIds, completions });
    await seedMoneyPlan(q, today, start);
    await seedJournal(q, { today, rand, completions, missionIds });

    await rebuildXpLedger(q, { today, weekStartsOn: 1, timezone: TZ });
  });

  // a group of friends with a few finished seasons (other users → outside the demo user's transaction)
  const gymMissionId = await asUser(userId, (q) => q.query<{ id: string }>(`select id from missions where module = 'gym' limit 1`));
  // a group is a bonus: if it can't be built, the demo still opens
  const friendIds = gymMissionId[0]
    ? await seedGroup(userId, email, today, rand, gymMissionId[0].id).catch((e) => {
        console.error('[levelup] demo group seed failed', e);
        return [] as string[];
      })
    : [];
  await seedQuestsAndCollectables(userId, today, rand, friendIds).catch((e) => console.error('[levelup] demo quest seed failed', e));

  // ── placeholder photos go through the real storage + files pipeline
  if (proofFiles.length) {
    const sharp = (await import('sharp')).default;
    const s = storage();
    const hueFor: Record<string, number> = { gym: 90, read: 40, offer: 200, copy: 200, build: 200 };
    await asUser(userId, async (q) => {
      for (const [i, f] of proofFiles.entries()) {
        const [c] = await q.query<{ id: string }>(
          `select c.id from completions c join missions m on m.id = c.mission_id where c.occurred_on = $1 and m.title ilike $2 and c.kept limit 1`,
          [f.day, f.missionKey === 'offer' ? 'Choose%' : f.missionKey === 'copy' ? 'Write%' : f.missionKey === 'build' ? 'Build%' : f.label + '%'],
        );
        if (!c) continue;
        const svg = placeholderSvg(f.label, f.day, hueFor[f.missionKey] ?? 220, i + 1);
        const full = await sharp(Buffer.from(svg)).webp({ quality: 80 }).toBuffer();
        const thumb = await sharp(Buffer.from(svg)).resize(480).webp({ quality: 70 }).toBuffer();
        const id = randomUUID();
        const dir = `${userId}/${f.day.slice(0, 4)}/${f.day.slice(5, 7)}`;
        await s.put('proofs', `${dir}/${id}.webp`, full, 'image/webp');
        await s.put('proofs', `${dir}/${id}.thumb.webp`, thumb, 'image/webp');
        await q.query(
          `insert into files (id, bucket, object_path, thumb_path, mime_type, byte_size, width, height) values ($1, 'proofs', $2, $3, 'image/webp', $4, 900, 1125)`,
          [id, `${dir}/${id}.webp`, `${dir}/${id}.thumb.webp`, full.length],
        );
        await q.query(`insert into proofs (completion_id, kind, file_id, captured_on) values ($1, 'photo', $2, $3)`, [c.id, id, f.day]);
      }
    });
  }

  // baseline personal records + reviews so the first visit already has history
  const profile = await asUser(userId, (q) => readProfile(q, userId));
  if (profile) {
    const now = new Date();
    const { hour, minute } = clockInZone(now, TZ);
    const viewer = { userId, email, profile, today, hour, minute };
    await loadProgress(viewer, '30d');
    await ensureWeeklyReviews(viewer);
    await loadYou(viewer); // evaluate achievements now, so the level is final before the first screen
    await asUser(userId, (q) => q.query(`update achievement_unlocks set seen_at = null`)); // still "New" on first visit
  }
  return userId;
}

async function seedMoney(q: Queryable, today: ISODate, start: ISODate, rand: () => number) {
  const between = (a: number, b: number) => a + rand() * (b - a);
  const int = (a: number, b: number) => Math.floor(between(a, b + 1));
  const mkd = (eur: number) => Math.round(eur * 61.495) * 100; // minor units of MKD

  const acc = async (name: string, type: string, institution: string | null, currency: string, opening: number, liquid: boolean, order: number) => {
    const [a] = await q.query<{ id: string }>(
      `insert into accounts (name, type, institution, currency, opening_balance_minor, opening_on, is_liquid, sort_order) values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      [name, type, institution, currency, opening, start, liquid, order],
    );
    return a.id;
  };
  const revolut = await acc('Revolut', 'checking', 'Revolut', 'EUR', 185000, true, 0);
  const bank = await acc('Stopanska', 'checking', 'Stopanska Banka', 'MKD', 4_800_000, true, 1);
  const cash = await acc('Cash', 'cash', null, 'MKD', 600_000, true, 2);
  const savings = await acc('Savings vault', 'savings', 'Revolut', 'EUR', 320000, true, 3);
  const broker = await acc('Broker', 'investment', 'Interactive Brokers', 'EUR', 140000, false, 4);

  const cats = new Map((await q.query<{ id: string; slug: string; kind: string }>(`select id, slug, kind from categories`)).map((c) => [`${c.kind}:${c.slug}`, c.id]));
  const cat = (kind: 'income' | 'expense', slug: string) => cats.get(`${kind}:${slug}`) ?? null;

  const series = async (kind: string, name: string, amount: number, currency: string, account: string, category: string | null, sub: boolean, verdict: string | null, counterparty: string, next: ISODate) => {
    const [s] = await q.query<{ id: string }>(
      `insert into recurring_series (kind, name, amount_minor, currency, cadence, next_on, account_id, category_id, counterparty, is_subscription, verdict, started_on)
       values ($1, $2, $3, $4, 'month', $5, $6, $7, $8, $9, $10, $11) returning id`,
      [kind, name, amount, currency, next, account, category, counterparty, sub, verdict, start],
    );
    return s.id;
  };

  type Tx = { account_id: string; kind: string; amount_minor: number; currency: string; occurred_on: string; category_id: string | null; counterparty: string | null; note: string | null; transfer_id: string | null; series_id: string | null; original_amount_minor: number | null; original_currency: string | null; source: string };
  const txs: Tx[] = [];
  const tx = (p: Partial<Tx> & Pick<Tx, 'account_id' | 'kind' | 'amount_minor' | 'currency' | 'occurred_on'>) =>
    txs.push({ category_id: null, counterparty: null, note: null, transfer_id: null, series_id: null, original_amount_minor: null, original_currency: null, source: 'seed', ...p });

  const nextMonth = (day: number) => {
    const m = startOfMonth(addMonths(startOfMonth(today), 1));
    return `${m.slice(0, 8)}${String(day).padStart(2, '0')}`;
  };
  const salary = await series('income', 'HeyReach', 80000, 'EUR', revolut, cat('income', 'salary'), false, null, 'HeyReach', nextMonth(2));
  const rent = await series('expense', 'Rent', 1_800_000, 'MKD', bank, cat('expense', 'housing'), false, 'essential', 'Landlord', nextMonth(1));
  const gymSub = await series('expense', 'Gym membership', 200_000, 'MKD', bank, cat('expense', 'fitness'), true, 'essential', 'Fitness Zone', nextMonth(5));
  const subs = [
    { name: 'Spotify', amount: 1099, cur: 'EUR', verdict: 'useful', day: 8 },
    { name: 'ChatGPT Plus', amount: 1720, cur: 'EUR', verdict: 'essential', day: 12, usd: 2000 },
    { name: 'iCloud+', amount: 299, cur: 'EUR', verdict: 'useful', day: 15 },
    { name: 'Netflix', amount: 1399, cur: 'EUR', verdict: 'questionable', day: 20 },
    { name: 'Duolingo Super', amount: 1299, cur: 'EUR', verdict: 'cancel', day: 24 },
  ];
  const subIds = new Map<string, string>();
  for (const s of subs) subIds.set(s.name, await series('expense', s.name, s.amount, s.cur, revolut, cat('expense', 'subscriptions'), true, s.verdict, s.name, nextMonth(s.day)));

  const months: ISODate[] = [];
  for (let m = startOfMonth(start); m <= today; m = addMonths(m, 1)) months.push(m);
  const incomeTargets = [105000, 112000, 124000, 138000, 146000, 150000];

  for (const [mi, m] of months.entries()) {
    const inMonth = (day: number) => {
      const s = `${m.slice(0, 8)}${String(day).padStart(2, '0')}`;
      return s >= start && s <= today ? s : null;
    };
    // income
    const payday = inMonth(2);
    if (payday) tx({ account_id: revolut, kind: 'income', amount_minor: 80000, currency: 'EUR', occurred_on: payday, category_id: cat('income', 'salary'), counterparty: 'HeyReach', series_id: salary });
    const target = incomeTargets[Math.min(mi, incomeTargets.length - 1)] - 80000;
    const gigs = target > 50000 ? 2 : 1;
    for (let g = 0; g < gigs; g++) {
      const day = inMonth(g === 0 ? int(8, 14) : int(19, 26));
      if (day) {
        tx({
          account_id: revolut, kind: 'income', amount_minor: Math.round(target / gigs / 100) * 100 + int(-30, 30) * 100, currency: 'EUR',
          occurred_on: day, category_id: cat('income', 'freelance'),
          counterparty: g === 0 ? 'Mitra Studio' : ['Oskar Design', 'Nova Agency', 'Lumen Labs'][mi % 3], note: g === 0 ? 'Landing page build' : 'Outreach setup',
        });
      }
    }
    if (rand() < 0.4) {
      const day = inMonth(int(3, 27));
      if (day) tx({ account_id: cash, kind: 'income', amount_minor: mkd(between(40, 120)), currency: 'MKD', occurred_on: day, category_id: cat('income', 'other'), counterparty: 'Sold old monitor' });
    }

    // fixed costs
    const d1 = inMonth(1);
    if (d1) tx({ account_id: bank, kind: 'expense', amount_minor: -1_800_000, currency: 'MKD', occurred_on: d1, category_id: cat('expense', 'housing'), counterparty: 'Landlord', series_id: rent });
    const d5 = inMonth(5);
    if (d5) tx({ account_id: bank, kind: 'expense', amount_minor: -200_000, currency: 'MKD', occurred_on: d5, category_id: cat('expense', 'fitness'), counterparty: 'Fitness Zone', series_id: gymSub });
    const d9 = inMonth(9);
    if (d9) tx({ account_id: bank, kind: 'expense', amount_minor: -int(2400, 3300) * 100, currency: 'MKD', occurred_on: d9, category_id: cat('expense', 'utilities'), counterparty: 'EVN + Vodovod' });
    const d11 = inMonth(11);
    if (d11 && mi >= 1) tx({ account_id: bank, kind: 'expense', amount_minor: -300_000, currency: 'MKD', occurred_on: d11, category_id: cat('expense', 'education'), counterparty: 'Goethe course' });
    for (const s of subs) {
      const day = inMonth(s.day);
      if (!day) continue;
      if (s.name === 'Duolingo Super' && mi < 2) continue;
      tx({
        account_id: revolut, kind: 'expense', amount_minor: -s.amount, currency: 'EUR', occurred_on: day, category_id: cat('expense', 'subscriptions'),
        counterparty: s.name, series_id: subIds.get(s.name)!, original_amount_minor: s.usd ?? null, original_currency: s.usd ? 'USD' : null,
      });
    }
    const hostingDay = inMonth(18);
    if (hostingDay && mi % 2 === 0) tx({ account_id: revolut, kind: 'expense', amount_minor: -1200, currency: 'EUR', occurred_on: hostingDay, category_id: cat('expense', 'business'), counterparty: 'Hosting' });

    // moving money: EUR → MKD for daily life, then savings + investing
    const conv = inMonth(3);
    if (conv) {
      // €900 → MKD at the bank's rate (a touch worse than the reference rate, as in real life)
      const tid = randomUUID();
      tx({ account_id: revolut, kind: 'transfer', amount_minor: -90000, currency: 'EUR', occurred_on: conv, transfer_id: tid, counterparty: 'Stopanska' });
      tx({ account_id: bank, kind: 'transfer', amount_minor: 5_506_000, currency: 'MKD', occurred_on: conv, transfer_id: tid, counterparty: 'Revolut' });
    }
    const saveDay = inMonth(4);
    if (saveDay) {
      const tid = randomUUID();
      const amount = mi >= 3 ? 30000 : 20000;
      tx({ account_id: revolut, kind: 'transfer', amount_minor: -amount, currency: 'EUR', occurred_on: saveDay, transfer_id: tid, counterparty: 'Savings vault' });
      tx({ account_id: savings, kind: 'transfer', amount_minor: amount, currency: 'EUR', occurred_on: saveDay, transfer_id: tid, counterparty: 'Revolut' });
    }
    const investDay = inMonth(6);
    if (investDay) {
      const tid = randomUUID();
      tx({ account_id: revolut, kind: 'transfer', amount_minor: -15000, currency: 'EUR', occurred_on: investDay, transfer_id: tid, counterparty: 'Broker' });
      tx({ account_id: broker, kind: 'transfer', amount_minor: 15000, currency: 'EUR', occurred_on: investDay, transfer_id: tid, counterparty: 'Revolut' });
    }
    for (const day of [inMonth(int(6, 9)), inMonth(int(20, 24))]) {
      if (!day) continue;
      const tid = randomUUID();
      tx({ account_id: bank, kind: 'transfer', amount_minor: -700_000, currency: 'MKD', occurred_on: day, transfer_id: tid, counterparty: 'Cash' });
      tx({ account_id: cash, kind: 'transfer', amount_minor: 700_000, currency: 'MKD', occurred_on: day, transfer_id: tid, counterparty: 'Stopanska' });
    }
  }

  // day-to-day spending
  const groceries = ['Vero', 'Ramstore', 'Tinex', 'KAM'];
  const restaurants = ['Kaj Maršal', 'Old Town Grill', 'Sushi Co', 'Café Trend', 'Pizza Bar'];
  for (const day of eachDay(start, today)) {
    const wd = jsWeekday(day);
    const recent = diffDays(day, today) < 30;
    if (rand() < 0.34) tx({ account_id: rand() < 0.7 ? bank : cash, kind: 'expense', amount_minor: -int(380, 1700) * 100, currency: 'MKD', occurred_on: day, category_id: cat('expense', 'groceries'), counterparty: groceries[int(0, 3)] });
    const eatOut = (wd === 5 || wd === 6 ? 0.55 : 0.22) * (recent ? 1.45 : 1);
    if (rand() < eatOut) tx({ account_id: rand() < 0.6 ? bank : cash, kind: 'expense', amount_minor: -int(480, 1900) * 100 * (recent && rand() < 0.3 ? 1.6 : 1), currency: 'MKD', occurred_on: day, category_id: cat('expense', 'restaurants'), counterparty: restaurants[int(0, 4)] });
    if (rand() < 0.25) tx({ account_id: cash, kind: 'expense', amount_minor: -int(150, 900) * 100, currency: 'MKD', occurred_on: day, category_id: cat('expense', 'transport'), counterparty: rand() < 0.5 ? 'Taxi' : 'Fuel' });
    if (rand() < 0.05) tx({ account_id: bank, kind: 'expense', amount_minor: -int(1200, 5200) * 100, currency: 'MKD', occurred_on: day, category_id: cat('expense', 'shopping'), counterparty: pick(['Zara', 'Decathlon', 'Neptun', 'Anhoch']) });
    if (rand() < 0.04) tx({ account_id: bank, kind: 'expense', amount_minor: -int(300, 1500) * 100, currency: 'MKD', occurred_on: day, category_id: cat('expense', 'health'), counterparty: 'Pharmacy' });
    if (rand() < 0.05) tx({ account_id: revolut, kind: 'expense', amount_minor: -int(8, 35) * 100, currency: 'EUR', occurred_on: day, category_id: cat('expense', 'entertainment'), counterparty: pick(['Cinema', 'Steam', 'Concert']) });
  }
  function pick<T>(arr: T[]): T {
    return arr[Math.floor(rand() * arr.length)];
  }
  // one refund, one earned-reward purchase
  tx({ account_id: bank, kind: 'expense', amount_minor: 180_000, currency: 'MKD', occurred_on: addDays(today, -20), category_id: cat('expense', 'shopping'), counterparty: 'Decathlon', note: 'Refund — returned shoes' });

  const cleaned = txs.map((t) => ({ ...t, amount_minor: Math.round(t.amount_minor) })).filter((t) => t.amount_minor !== 0);
  await insertJson(
    q, 'transactions',
    'account_id, kind, amount_minor, currency, occurred_on, category_id, counterparty, note, transfer_id, series_id, original_amount_minor, original_currency, source',
    'account_id uuid, kind text, amount_minor int8, currency text, occurred_on date, category_id uuid, counterparty text, note text, transfer_id uuid, series_id uuid, original_amount_minor int8, original_currency text, source text',
    cleaned,
  );

  // rewards: a small personal store, a few already redeemed (one logged as earned spending)
  const reward = async (title: string, cost: number, money: number | null) => {
    const [r] = await q.query<{ id: string }>(
      `insert into rewards (title, cost_marks, money_amount_minor, money_currency, created_at) values ($1, $2, $3, $4, $5) returning id`,
      [title, cost, money, money ? 'EUR' : null, `${start}T09:00:00Z`],
    );
    return r.id;
  };
  const movie = await reward('Guilt-free movie night', 500, null);
  const dinner = await reward('Dinner somewhere nice', 2500, 4500);
  await reward('New running shoes', 6000, 11000);
  await reward('Weekend in Ohrid', 20000, 26000);
  for (const [rid, cost, day] of [[movie, 500, addDays(today, -60)], [movie, 500, addDays(today, -18)]] as const) {
    await q.query(`insert into reward_redemptions (reward_id, cost_marks, redeemed_at) values ($1, $2, $3)`, [rid, cost, `${day}T19:00:00Z`]);
  }
  const dinnerDay = addDays(today, -33);
  const [dtx] = await q.query<{ id: string }>(
    `insert into transactions (account_id, kind, amount_minor, currency, occurred_on, category_id, counterparty, note, is_earned_reward, source)
     values ($1, 'expense', -4500, 'EUR', $2, $3, 'Dinner somewhere nice', 'Earned reward', true, 'seed') returning id`,
    [revolut, dinnerDay, cat('expense', 'restaurants')],
  );
  await q.query(`insert into reward_redemptions (reward_id, cost_marks, redeemed_at, transaction_id) values ($1, 2500, $2, $3)`, [dinner, `${dinnerDay}T20:30:00Z`, dtx.id]);

  // broker marked to market monthly
  let value = 140000;
  for (let m = startOfMonth(start); m <= today; m = addMonths(m, 1)) {
    const day = addDays(addMonths(m, 1), -1) < today ? addDays(addMonths(m, 1), -1) : null;
    if (!day) break;
    value = Math.round((value + 15000) * between(0.99, 1.035));
    await q.query(`insert into account_valuations (account_id, valued_on, value_minor, note) values ($1, $2, $3, 'Month-end statement')`, [broker, day, value]);
  }
}

// ───────────────────────────────────────────── V2: gym program + logged workouts, learning sessions

type SeedCompletion = { mission_id: string; occurred_on: string; outcome: Outcome; value: number | null; note: string | null; logged_at: string };

/** [catalog key, name, muscle, equipment, sets, rep min, rep max, start kg, step kg] */
type PlanItem = [string, string, string, string, number, number, number, number, number];
const PROGRAM: { name: string; items: PlanItem[] }[] = [
  { name: 'Upper A', items: [['bench_press', 'Bench Press', 'chest', 'barbell', 4, 5, 8, 62.5, 2.5], ['barbell_row', 'Barbell Row', 'back', 'barbell', 3, 6, 10, 55, 2.5], ['overhead_press', 'Overhead Press', 'shoulders', 'barbell', 3, 6, 8, 37.5, 1.25], ['lat_pulldown', 'Lat Pulldown', 'back', 'cable', 3, 8, 12, 52.5, 2.5]] },
  { name: 'Lower A', items: [['squat', 'Squat', 'quads', 'barbell', 4, 5, 8, 85, 2.5], ['romanian_deadlift', 'Romanian Deadlift', 'hamstrings', 'barbell', 3, 8, 10, 70, 2.5], ['leg_press', 'Leg Press', 'quads', 'machine', 3, 10, 12, 140, 5], ['standing_calf_raise', 'Standing Calf Raise', 'calves', 'machine', 3, 10, 15, 60, 2.5]] },
  { name: 'Upper B', items: [['incline_db_press', 'Incline Dumbbell Press', 'chest', 'dumbbell', 3, 8, 10, 22, 2], ['pull_up', 'Pull-up', 'back', 'bodyweight', 3, 5, 10, 0, 0], ['db_shoulder_press', 'Dumbbell Shoulder Press', 'shoulders', 'dumbbell', 3, 8, 12, 18, 2], ['seated_cable_row', 'Seated Cable Row', 'back', 'cable', 3, 10, 12, 55, 2.5]] },
  { name: 'Lower B', items: [['deadlift', 'Deadlift', 'back', 'barbell', 3, 3, 5, 115, 5], ['bulgarian_split_squat', 'Bulgarian Split Squat', 'quads', 'dumbbell', 3, 8, 10, 16, 2], ['lying_leg_curl', 'Lying Leg Curl', 'hamstrings', 'machine', 3, 10, 12, 35, 2.5], ['hanging_leg_raise', 'Hanging Leg Raise', 'core', 'bodyweight', 3, 10, 15, 0, 0]] },
];

async function seedModules(
  q: Queryable,
  o: { today: ISODate; start: ISODate; rand: () => number; missionIds: Map<string, string>; completions: SeedCompletion[] },
) {
  const { start, rand } = o;
  const int = (a: number, b: number) => a + Math.floor(rand() * (b - a + 1));
  const gymId = o.missionIds.get('gym')!;

  // ── the program: four named days of the user's own exercises
  const exId = new Map<string, string>();
  for (const day of PROGRAM) {
    for (const [key, name, muscle, equipment] of day.items) {
      if (exId.has(key)) continue;
      const [e] = await q.query<{ id: string }>(
        `insert into exercises (catalog_key, name, muscle, equipment, created_at) values ($1, $2, $3, $4, $5) returning id`,
        [key, name, muscle, equipment, `${start}T09:00:00Z`],
      );
      exId.set(key, e.id);
    }
  }
  const [program] = await q.query<{ id: string }>(
    `insert into workout_programs (name, mode, per_week, mission_id, created_at) values ('Upper / Lower', 'flexible', 4, $1, $2) returning id`,
    [gymId, `${start}T09:00:00Z`],
  );
  const dayIds: string[] = [];
  for (const [i, day] of PROGRAM.entries()) {
    const [d] = await q.query<{ id: string }>(`insert into workout_days (program_id, name, position, created_at) values ($1, $2, $3, $4) returning id`, [program.id, day.name, i, `${start}T09:00:00Z`]);
    dayIds.push(d.id);
    for (const [j, [key, , , , sets, repMin, repMax, startKg]] of day.items.entries()) {
      await q.query(
        `insert into workout_day_exercises (workout_day_id, exercise_id, position, sets, rep_min, rep_max, weight, rest_seconds) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [d.id, exId.get(key), j, sets, repMin, repMax, startKg || null, j < 2 ? 150 : 90],
      );
    }
  }

  // ── every kept gym day is a real logged workout: the split in order, steady progression, honest stalls
  const gymDays = await q.query<{ id: string; occurred_on: string; logged_at: Date; note: string | null }>(
    `select id, occurred_on, logged_at, note from completions where mission_id = $1 and kept order by occurred_on`,
    [gymId],
  );
  const sessions: object[] = [];
  const blocks: object[] = [];
  const sets: object[] = [];
  const seen = new Map<number, number>();
  for (const [n, c] of gymDays.entries()) {
    const di = n % PROGRAM.length;
    const k = seen.get(di) ?? 0;
    seen.set(di, k + 1);
    const day = PROGRAM[di];
    const minutes = int(46, 74);
    const finished = new Date(c.logged_at);
    const sid = randomUUID();
    sessions.push({
      id: sid, program_id: program.id, workout_day_id: dayIds[di], name: day.name, performed_on: c.occurred_on,
      started_at: new Date(finished.getTime() - minutes * 60_000).toISOString(), finished_at: finished.toISOString(),
      duration_seconds: minutes * 60, status: 'completed', note: c.note, weight_unit: 'kg', completion_id: c.id,
    });
    for (const [j, [key, name, , , nSets, repMin, repMax, startKg, stepKg]] of day.items.entries()) {
      const eid = randomUUID();
      blocks.push({ id: eid, session_id: sid, exercise_id: exId.get(key), name, position: j, target_sets: nSets, rep_min: repMin, rep_max: repMax, rest_seconds: j < 2 ? 150 : 90, skipped: false });
      // +1 step every second session of that day, a deload every 7th
      const steps = Math.floor(k / 2) - (k > 0 && k % 7 === 0 ? 2 : 0);
      const kg = startKg > 0 ? Math.round((startKg + Math.max(0, steps) * stepKg) * 4) / 4 : null;
      let pos = 0;
      if (j === 0 && kg) sets.push({ id: randomUUID(), session_exercise_id: eid, position: pos++, weight: Math.round(kg * 0.5 / 2.5) * 2.5, reps: 8, kind: 'warmup', done: true });
      for (let x = 0; x < nSets; x++) {
        const top = kg ? repMax - (k % 2 === 0 ? int(1, 2) : 0) : Math.min(repMax + 4, repMin + Math.floor(k / 3) + int(0, 2));
        const reps = Math.max(repMin - 1, top - x - (rand() < 0.25 ? 1 : 0));
        sets.push({ id: randomUUID(), session_exercise_id: eid, position: pos++, weight: kg, reps, kind: 'working', done: true });
      }
    }
  }
  await insertJson(q, 'workout_sessions', 'id, program_id, workout_day_id, name, performed_on, started_at, finished_at, duration_seconds, status, note, weight_unit, completion_id',
    'id uuid, program_id uuid, workout_day_id uuid, name text, performed_on date, started_at timestamptz, finished_at timestamptz, duration_seconds int, status text, note text, weight_unit text, completion_id uuid', sessions);
  await insertJson(q, 'workout_session_exercises', 'id, session_id, exercise_id, name, position, target_sets, rep_min, rep_max, rest_seconds, skipped',
    'id uuid, session_id uuid, exercise_id uuid, name text, position int, target_sets int, rep_min int, rep_max int, rest_seconds int, skipped boolean', blocks);
  await insertJson(q, 'workout_sets', 'id, session_exercise_id, position, weight, reps, kind, done',
    'id uuid, session_exercise_id uuid, position int, weight numeric, reps int, kind text, done boolean', sets);
  await q.query(`update completions set source = 'workout' where mission_id = $1 and kept`, [gymId]);
  for (let k = 0; k * 14 < HISTORY; k++) {
    await q.query(`insert into body_measurements (measured_on, weight) values ($1, $2) on conflict do nothing`, [addDays(start, k * 14 + 3), Math.round((86 - k * 0.42 + (rand() - 0.5) * 0.8) * 10) / 10]);
  }

  // ── learning: each subject is a routine; each logged day is a session with a topic
  const topics: Record<string, string[]> = {
    german: ['Lesson 12 · Perfekt', 'Konjunktiv II', 'Podcast + flashcards', 'Tutor call', 'Reading Die Zeit', 'Dativ prepositions', 'Writing practice'],
    read: ['Deep Work', 'The Mom Test', 'Atomic Habits', 'Show Your Work', '$100M Offers'],
  };
  for (const [i, [key, name, weekly, days]] of ([['german', 'German', 135, 3], ['read', 'Reading', 150, 5]] as const).entries()) {
    const mission = o.missionIds.get(key)!;
    const [subject] = await q.query<{ id: string }>(
      `insert into learning_subjects (name, measure, weekly_target, days_per_week, mission_id, sort_order, created_at) values ($1, 'minutes', $2, $3, $4, $5, $6) returning id`,
      [name, weekly, days, mission, i, `${start}T09:00:00Z`],
    );
    const rows = o.completions
      .filter((c) => c.mission_id === mission && c.outcome !== 'missed' && c.outcome !== 'skipped' && (c.value ?? 0) > 0)
      .map((c) => {
        const end = new Date(c.logged_at);
        const book = topics[key][Math.floor(diffDays(start, c.occurred_on) / 30) % topics[key].length];
        return {
          subject_id: subject.id, performed_on: c.occurred_on, minutes: c.value, status: 'completed',
          topic: key === 'read' ? book : topics[key][int(0, topics[key].length - 1)], note: c.note,
          started_at: new Date(end.getTime() - (c.value ?? 0) * 60_000).toISOString(), finished_at: end.toISOString(),
        };
      });
    await insertJson(q, 'learning_sessions', 'subject_id, performed_on, minutes, status, topic, note, started_at, finished_at',
      'subject_id uuid, performed_on date, minutes int, status text, topic text, note text, started_at timestamptz, finished_at timestamptz', rows);
  }
}

// ───────────────────────────────────────────── V2: the money plan

async function seedMoneyPlan(q: Queryable, today: ISODate, start: ISODate) {
  const cats = new Map((await q.query<{ id: string; slug: string }>(`select id, slug from categories where kind = 'expense'`)).map((c) => [c.slug, c.id]));
  const from = startOfMonth(start);
  await q.query(`insert into budgets (category_id, amount_minor, currency, active_from) values (null, 100000, 'EUR', $1)`, [from]);
  await q.query(`insert into budgets (category_id, amount_minor, currency, active_from) values ($1, 18000, 'EUR', $2), ($3, 26000, 'EUR', $2)`, [cats.get('restaurants'), from, cats.get('groceries')]);
  const [vault] = await q.query<{ id: string }>(`select id from accounts where name = 'Savings vault'`);
  await q.query(
    `insert into finance_targets (kind, title, amount_minor, currency, account_id, created_at) values
       ('income', 'Earn €3,000 a month', 300000, 'EUR', null, $2),
       ('savings', 'Save €300 a month', 30000, 'EUR', null, $2),
       ('emergency_fund', 'Six months of rent', 700000, 'EUR', $1, $2)`,
    [vault?.id ?? null, `${start}T09:00:00Z`],
  );
  await q.query(
    `insert into money_plans (month, currency, expected_income_minor, planned_savings_minor, planned_investments_minor, note) values ($1, 'EUR', 70000, 30000, 15000, 'Two freelance projects expected.')`,
    [startOfMonth(today)],
  );
}

// ───────────────────────────────────────────── V2: the journal

async function seedJournal(q: Queryable, o: { today: ISODate; rand: () => number; completions: SeedCompletion[]; missionIds: Map<string, string> }) {
  const { today, rand } = o;
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const keyOf = new Map([...o.missionIds.entries()].map(([k, v]) => [v, k]));
  const workouts = await q.query<{ performed_on: string; name: string }>(`select performed_on, name from workout_sessions where status = 'completed'`);
  const workoutOn = new Map(workouts.map((w) => [w.performed_on, w.name]));
  const phrase: Record<string, string> = { deepwork: 'a deep work block', outreach: 'outreach', read: 'reading', german: 'German', steps: 'a long walk' };
  const plans = [
    'Lower B before work. Finish the pricing page. Call the accountant.',
    'Outreach to 20 agencies. German lesson 15. In bed by 23:00.',
    'Deep work on the case study first thing. Gym after lunch, not in the evening.',
    'Ship the waitlist form. Read 30 minutes before bed — no phone.',
    'Review the budget, cancel Duolingo. Upper A.',
    'Two discovery calls. Write the follow-ups the same hour.',
  ];
  const notes = [
    'Energy dips after lunch again — deep work goes before 11 from now on.',
    'Good call with Mitra about a retainer. Worth pricing properly.',
    'Evening gym never happens. Afternoons only.',
    'Checked email before 10 and lost the morning. Again.',
    'Walked home instead of a taxi. Clearer head.',
    'Friday reading never happens. Stop planning it.',
  ];
  const rows: object[] = [];
  for (let back = 70; back >= 1; back--) {
    const day = addDays(today, -back);
    if (back > 1 && rand() < 0.3) continue; // yesterday always has a page, so Today can show what you planned
    const kept = o.completions.filter((c) => c.occurred_on === day && c.outcome !== 'missed' && c.outcome !== 'skipped').map((c) => keyOf.get(c.mission_id) ?? '');
    const parts: string[] = [];
    if (workoutOn.has(day)) parts.push(`trained ${workoutOn.get(day)}`);
    for (const k of ['deepwork', 'outreach', 'german', 'read', 'steps']) if (kept.includes(k)) parts.push(phrase[k]);
    const did = parts.length
      ? `${parts[0][0].toUpperCase()}${parts[0].slice(1)}${parts.length > 1 ? `, ${parts.slice(1, -1).join(', ')}${parts.length > 2 ? ',' : ''} and ${parts.at(-1)}` : ''}.`
      : pick(['Slow day. Rested.', 'Mostly errands and family.', 'Sick, stayed in.']);
    rows.push({ day, did, plan: back === 1 || rand() < 0.6 ? pick(plans) : null, notes: rand() < 0.35 ? pick(notes) : null });
  }
  await insertJson(q, 'journal_entries', 'day, did, plan, notes', 'day date, did text, plan text, notes text', rows);
}

// ───────────────────────────────────────────── V2: a group of friends

const JOIN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

async function seedGroup(ownerId: string, ownerEmail: string, today: ISODate, rand: () => number, gymMissionId: string): Promise<string[]> {
  const sandbox = SANDBOX.exec(ownerEmail);
  const created = addDays(today, -104);
  const friends = [
    { name: 'Filip', perWeek: 4, p: 0.94, splits: ['Push', 'Pull', 'Legs'] },
    { name: 'Mila', perWeek: 3, p: 0.84, splits: ['Full Body A', 'Full Body B'] },
    { name: 'Dario', perWeek: 5, p: 0.62, splits: ['Chest + Back', 'Legs', 'Arms', 'Shoulders'] },
  ];
  // real randomness: the seeded PRNG repeats, and join codes are unique across every demo on the server
  const code = Array.from({ length: 8 }, () => JOIN_ALPHABET[randomInt(JOIN_ALPHABET.length)]).join('');
  const groupId = await asUser(ownerId, async (q) => {
    const [g] = await q.query<{ id: string }>(`select public.create_group($1::jsonb) as id`, [
      JSON.stringify({
        name: 'Iron Pact', kind: 'gym', description: 'Four friends, one rule: do what you said you would.', season_length: 'month',
        proof_policy: 'proof_optional', target_rule: 'personal', min_target: 2, max_target: 6, prize: 'Last place buys the winner a protein tub.',
        join_code: code, display_name: 'Alex',
      }),
    ]);
    await q.query(`update group_members set mission_id = $2, target = 4, unit = 'workouts' where group_id = $1 and user_id = auth.uid()`, [g.id, gymMissionId]);
    return g.id;
  });
  await asSystem(async (q) => {
    await q.query(`update public.groups set created_at = $2 where id = $1`, [groupId, `${created}T10:00:00Z`]);
    await q.query(`update public.group_members set joined_at = $2 where group_id = $1`, [groupId, `${created}T10:00:00Z`]);
  });

  const feed: { user: string; day: ISODate; title: string; key: string }[] = [];
  const friendIds: string[] = [];
  for (const [i, f] of friends.entries()) {
    const email = sandbox ? `sandbox-${sandbox[1]}-f${i}${randomUUID().slice(0, 6)}@kept.local` : `demo-member-${ownerId.slice(0, 8)}-${i}@kept.local`;
    const fid = await asSystem(async (q) => {
      const [u] = await q.query<{ id: string }>(`insert into auth.users (email, created_at) values ($1, $2) returning id`, [email, `${created}T09:00:00Z`]);
      await q.query(`update public.profiles set display_name = $2, timezone = $3, base_currency = 'EUR', onboarded_at = $4, modules = array['gym'] where id = $1`, [u.id, f.name, TZ, `${created}T09:00:00Z`]);
      return u.id;
    });
    friendIds.push(fid);
    await asUser(fid, async (q) => {
      const [area] = await q.query<{ id: string }>(`insert into areas (kind, name, icon) values ('gym', 'Gym', 'barbell') returning id`);
      const [m] = await q.query<{ id: string }>(`insert into missions (area_id, title, measure, difficulty, module, created_at) values ($1, 'Gym', 'check', 'hard', 'gym', $2) returning id`, [area.id, `${created}T09:00:00Z`]);
      await q.query(`insert into mission_schedules (mission_id, cadence, per_week, valid_from) values ($1, 'weekly', $2, $3)`, [m.id, f.perWeek, created]);
      const rows: object[] = [];
      let week = '';
      let done = 0;
      let n = 0;
      for (const day of eachDay(created, addDays(today, -1))) {
        const ws = startOfWeek(day, 1);
        if (ws !== week) {
          week = ws;
          done = 0;
        }
        const left = diffDays(day, addDays(ws, 6)) + 1;
        const need = f.perWeek - done;
        if (need <= 0) continue;
        const want = need >= left ? 0.97 : need / left + 0.18;
        if (rand() > want || rand() > f.p) continue;
        done++;
        rows.push({ mission_id: m.id, occurred_on: day, outcome: 'full', difficulty: 'hard', credit: 1, logged_at: localToIso(day, 18, 30), source: 'workout' });
        if (diffDays(day, today) <= 12) feed.push({ user: fid, day, title: `completed ${f.splits[n % f.splits.length]}`, key: `c:${m.id}:${day}` });
        n++;
      }
      await insertJson(q, 'completions', 'mission_id, occurred_on, outcome, difficulty, credit, logged_at, source', 'mission_id uuid, occurred_on date, outcome text, difficulty text, credit numeric, logged_at timestamptz, source text', rows);
      await q.query(`select public.join_group($1, $2)`, [code, f.name]);
      await q.query(`update group_members set mission_id = $2, target = $3, unit = 'workouts' where group_id = $1 and user_id = auth.uid()`, [groupId, m.id, f.perWeek]);
    });
    await asSystem((q) => q.query(`update public.group_members set joined_at = $3 where group_id = $1 and user_id = $2`, [groupId, fid, `${addDays(created, i + 1)}T12:00:00Z`]));
  }

  // the owner's recent workouts in the feed
  const recent = await asUser(ownerId, (q) =>
    q.query<{ performed_on: string; name: string }>(`select performed_on, name from workout_sessions where status = 'completed' and performed_on >= $1 order by performed_on`, [addDays(today, -12)]),
  );
  for (const r of recent) feed.push({ user: ownerId, day: r.performed_on, title: `completed ${r.name}`, key: `c:${gymMissionId}:${r.performed_on}` });

  await ensureGroupSeasons(groupId, today);
  await asSystem(async (q) => {
    for (const [i, f] of feed.sort((a, b) => (a.day < b.day ? -1 : 1)).entries()) {
      await q.query(
        `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, source_key, created_at) values ($1, $2, 'activity', $3, $4, $5, $6)
         on conflict (group_id, source_key) do nothing`,
        [groupId, f.user, f.title, f.day, f.key, localToIso(f.day, 19, i % 60)],
      );
    }
    for (const [i, f] of friends.entries()) {
      await q.query(
        `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, source_key, created_at)
         select $1, user_id, 'joined', 'joined the group', $3, 'joined:' || user_id, $4 from public.group_members where group_id = $1 and display_name = $2
         on conflict (group_id, source_key) do nothing`,
        [groupId, f.name, addDays(created, i + 1), `${addDays(created, i + 1)}T12:00:00Z`],
      );
    }
  });

  // gym pics — honest placeholders: a demo has no real photos
  const sharp = (await import('sharp')).default;
  const pics = [
    { user: friendIds[0], name: 'Filip', caption: 'Leg day. Stairs are optional now.', back: 1, hue: 20 },
    { user: ownerId, name: 'Alex', caption: 'New deadlift best', back: 2, hue: 95 },
    { user: friendIds[1], name: 'Mila', caption: '6 am crew', back: 3, hue: 200 },
    { user: friendIds[2], name: 'Dario', caption: 'Arms, obviously', back: 5, hue: 300 },
    { user: friendIds[0], name: 'Filip', caption: null, back: 8, hue: 30 },
  ].filter((p) => p.user);
  for (const p of pics) {
    const day = addDays(today, -p.back);
    const buf = await sharp(Buffer.from(gymPicSvg(p.name, p.caption, p.hue))).jpeg({ quality: 82 }).toBuffer();
    const picId = await asUser(p.user, async (q) => {
      const stored = await storeUpload(q, p.user, 'proofs', buf, day);
      if (!stored.ok) throw new Error(stored.error);
      const [row] = await q.query<{ id: string }>(
        `insert into group_pics (group_id, file_id, caption, taken_on, created_at) values ($1, $2, $3, $4, $5) returning id`,
        [groupId, stored.file.id, p.caption, day, localToIso(day, 19, 30)],
      );
      return row.id;
    });
    await asSystem((q) =>
      q.query(
        `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, pic_id, source_key, created_at) values ($1, $2, 'pic', $3, $4, $5, $6, $7)
         on conflict (group_id, source_key) do nothing`,
        [groupId, p.user, p.caption ? `posted a gym pic: “${p.caption}”` : 'posted a gym pic', day, picId, `pic:${picId}`, localToIso(day, 19, 31)],
      ),
    );
  }
  return friendIds;
}

function gymPicSvg(name: string, caption: string | null, hue: number): string {
  const stripes = Array.from({ length: 22 }, (_, i) => `<rect x="${i * 64 - 380}" y="-60" width="24" height="1500" fill="hsl(${hue} 12% 17%)" transform="rotate(35 540 540)"/>`).join('');
  const safe = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080" viewBox="0 0 1080 1080">
    <rect width="1080" height="1080" fill="hsl(${hue} 10% 12%)"/>${stripes}
    <rect x="56" y="56" width="968" height="968" fill="none" stroke="hsl(${hue} 10% 32%)" stroke-width="3" stroke-dasharray="12 12"/>
    <text x="100" y="170" font-family="monospace" font-size="40" fill="hsl(${hue} 12% 64%)" letter-spacing="6">DEMO GYM PIC</text>
    <text x="100" y="300" font-family="sans-serif" font-size="96" font-weight="700" fill="hsl(${hue} 14% 90%)">${safe(name)}</text>
    ${caption ? `<text x="100" y="380" font-family="sans-serif" font-size="44" fill="hsl(${hue} 12% 70%)">${safe(caption)}</text>` : ''}
  </svg>`;
}

// ───────────────────────────────────────────── V2: quests, LevelCoins and collectables

async function seedQuestsAndCollectables(userId: string, today: ISODate, rand: () => number, friendIds: string[]) {
  const bank = ['Stretch for 10 minutes', 'Meal prep for the week', 'No phone after 22:00', 'Call Mom', 'Clear the inbox', 'Cold shower', 'Walk 30 minutes', 'Plan tomorrow', 'Drink 2 L of water', 'Tidy the desk'];
  const sizes: QuestSize[] = ['small', 'medium', 'big'];
  const from = addDays(today, -21);
  const { kept, journal } = await asUser(userId, async (q) => ({
    kept: await q.query<{ occurred_on: string; module: string | null; mission_id: string }>(
      `select c.occurred_on, m.module, c.mission_id from completions c join missions m on m.id = c.mission_id where c.kept and c.occurred_on >= $1 and c.occurred_on < $2`,
      [from, today],
    ),
    journal: await q.query<{ day: string }>(`select day from journal_entries where day >= $1 and day < $2`, [from, today]),
  }));
  const coins: { key: string; amount: number; day: ISODate }[] = [];
  await asUser(userId, async (q) => {
    for (let back = 21; back >= 0; back--) {
      const day = addDays(today, -back);
      const n = back === 0 ? 2 : rand() < 0.25 ? 0 : 1 + Math.floor(rand() * 3);
      for (let i = 0; i < n; i++) {
        const size: QuestSize = back === 0 ? (i === 0 ? 'small' : 'medium') : sizes[Math.floor(rand() * 3)];
        const title = back === 0 ? (i === 0 ? 'Stretch for 10 minutes' : 'Meal prep for the week') : bank[Math.floor(rand() * bank.length)];
        const done = back === 0 ? i === 0 : rand() < 0.8;
        const [row] = await q.query<{ id: string }>(
          `insert into quests (day, title, size, done_at, created_at) values ($1, $2, $3, $4, $5) returning id`,
          [day, title, size, done ? localToIso(day, 20, 10 + i) : null, localToIso(day, 8, i)],
        );
        // today's finished quest is credited by the app on first open (the "+10" moment)
        if (done && back > 0 && i < 5) coins.push({ key: `${day}:custom:${row.id}`, amount: SIZE_REWARD[size], day });
      }
      if (back === 0) continue;
      const dayKept = kept.filter((k) => k.occurred_on === day);
      if (dayKept.some((k) => k.module === 'gym')) coins.push({ key: `${day}:workout`, amount: 30, day });
      for (const k of dayKept.filter((x) => x.module === 'learning')) coins.push({ key: `${day}:learning:${k.mission_id}`, amount: 20, day });
      if (journal.some((j) => j.day === day)) coins.push({ key: `${day}:journal`, amount: 10, day });
      if (rand() < 0.3) coins.push({ key: `${day}:sweep`, amount: 20, day });
    }
  });

  // what the demo pulled from boxes: a spare Kettle Head to trade, and LevelCoins left for a few boxes
  const buys: { key: string; back: number }[] = [
    { key: 'kettle_head', back: 19 },
    { key: 'cash_cat', back: 17 },
    { key: 'gym_rat', back: 14 },
    { key: 'money_printer', back: 11 },
    { key: 'kettle_head', back: 9 },
    { key: 'swole_shiba', back: 6 },
    { key: 'wall_street_wolf', back: 3 },
  ];
  const LEFT_FOR_FIRST_VISIT = 620;
  await asSystem(async (q) => {
    let balance = 0;
    for (const c of coins) {
      await q.query(
        `insert into public.coin_events (user_id, source, source_key, amount, occurred_on, created_at) values ($1, $2, $3, $4, $5, $6) on conflict do nothing`,
        [userId, c.key.endsWith(':sweep') ? 'bonus' : 'quest', c.key, c.amount, c.day, localToIso(c.day, 21, 0)],
      );
      balance += c.amount;
    }
    const cost = (key: string) => SET_BY_KEY.get(CHARACTER_BY_KEY.get(key)!.set)!.box.cost;
    const spend = buys.reduce((n, b) => n + cost(b.key), 0);
    const topUp = spend + LEFT_FOR_FIRST_VISIT - balance;
    if (topUp > 0) {
      const day = addDays(today, -21);
      await q.query(
        `insert into public.coin_events (user_id, source, source_key, amount, occurred_on, created_at) values ($1, 'seed', 'welcome', $2, $3, $4) on conflict do nothing`,
        [userId, topUp, day, localToIso(day, 9, 0)],
      );
    }
    for (const b of buys) {
      const day = addDays(today, -b.back);
      const id = randomUUID();
      const at = localToIso(day, 21, 30);
      await q.query(
        `insert into public.collectables (owner_id, bought_by, character_key, purchase_id, bought_at, acquired_at) values ($1, $1, $2, $3, $4, $4)`,
        [userId, b.key, id, at],
      );
      await q.query(
        `insert into public.coin_events (user_id, source, source_key, amount, occurred_on, created_at) values ($1, 'collectable', $2, $3, $4, $5)`,
        [userId, id, -cost(b.key), day, at],
      );
    }

    // the friends' collections, and one offer waiting: Filip's spare Iron Rhino for the spare Kettle Head
    const [filip, mila, dario] = friendIds;
    const theirs: [string | undefined, string[]][] = [
      [filip, ['iron_rhino', 'iron_rhino', 'kettle_head', 'stonks_bull']],
      [mila, ['cash_cat', 'cash_cat', 'money_printer', 'stonks_bull', 'stonks_bull']],
      [dario, ['gym_rat', 'gym_rat', 'swole_shiba']],
    ];
    for (const [owner, keys] of theirs) {
      if (!owner) continue;
      for (const [n, key] of keys.entries()) {
        const at = localToIso(addDays(today, -(12 - n)), 20, 0);
        await q.query(
          `insert into public.collectables (owner_id, bought_by, character_key, purchase_id, bought_at, acquired_at) values ($1, $1, $2, $3, $4, $4)`,
          [owner, key, randomUUID(), at],
        );
      }
    }
    if (filip) {
      await q.query(
        `insert into public.collectable_trades (from_user, to_user, give_key, get_key, created_at) values ($1, $2, 'iron_rhino', 'kettle_head', now() - interval '20 hours')`,
        [filip, userId],
      );
    }
  });
}
