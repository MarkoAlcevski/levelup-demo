/**
 * Deterministic quick-log grammar for the command bar. No AI: a small, predictable parser
 * handles the 80% case instantly and offline. Anything it can't parse falls through to search.
 *
 *   "€18 lunch"                   → expense 18, "lunch", category restaurants
 *   "18.50 groceries vero"        → expense 18.50, category groceries
 *   "+800 salary"                 → income 800
 *   "gym done" / "done gym"       → log today's workout (or keep a routine called "gym")
 *   "log German 45" / "read 25"   → a learning session, or a value on a routine
 *   "add task call Martin tomorrow" → a task, due tomorrow
 *   "add routine Outreach"        → the routine form, prefilled
 *   "money", "journal", "groups"  → navigate
 */

export type DueWord = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'weekday'; iso: number } | { kind: 'in'; days: number } | { kind: 'date'; date: string };

export type ParsedCommand =
  | { kind: 'navigate'; href: string; label: string }
  | { kind: 'money'; direction: 'expense' | 'income'; amount: string; currency: string | null; text: string; categorySlug: string | null }
  | { kind: 'complete'; query: string; value: number | null; minimum: boolean }
  | { kind: 'task'; title: string; due: DueWord | null }
  | { kind: 'mission'; title: string };

const NAV: [RegExp, string, string][] = [
  [/^(today|home)$/, '/today', 'Today'],
  [/^(areas?|plan|routines?|tasks?|projects?|goals?)$/, '/areas', 'Areas'],
  [/^(gym|workouts?|training|program)$/, '/gym', 'Gym'],
  [/^(gym history|workout history)$/, '/gym/history', 'Gym history'],
  [/^(prs?|personal records|lifts|gym stats)$/, '/gym/stats', 'Gym stats'],
  [/^(learning|study|studying|subjects?)$/, '/learning', 'Learning'],
  [/^(groups?|leaderboard|friends|hall of fame)$/, '/groups', 'Groups'],
  [/^(journal|diary|notes)$/, '/journal', 'Journal'],
  [/^(progress|stats|calendar|heatmap|year|momentum|trend)$/, '/progress', 'Progress'],
  [/^(evidence|proofs?|gallery|photos)$/, '/progress/evidence', 'Evidence'],
  [/^(reports?|reviews?|weekly (review|report))$/, '/progress/reports', 'Reports'],
  [/^(money|finance|spending|net worth)$/, '/money', 'Money'],
  [/^(transactions?|ledger)$/, '/money/transactions', 'Transactions'],
  [/^(accounts?)$/, '/money/accounts', 'Accounts'],
  [/^(budgets?|recurring|subscriptions?|money plan)$/, '/money/plan', 'Money plan'],
  [/^(analysis|money analysis)$/, '/money/analysis', 'Money analysis'],
  [/^(profile|you|settings|level|rewards|achievements|points)$/, '/profile', 'Profile'],
];

const CURRENCY: Record<string, string> = { '€': 'EUR', eur: 'EUR', '$': 'USD', usd: 'USD', '£': 'GBP', gbp: 'GBP', ден: 'MKD', mkd: 'MKD', den: 'MKD', chf: 'CHF' };

const CATEGORY_WORDS: [RegExp, string][] = [
  [/\b(lunch|dinner|breakfast|restaurant|coffee|cafe|café|pizza|burger|sushi|drinks?|bar|brunch|takeaway|wolt|glovo)\b/, 'restaurants'],
  [/\b(groceries|grocery|supermarket|market|vero|tinex|ramstore|kam|food shop)\b/, 'groceries'],
  [/\b(taxi|uber|bolt|fuel|gas|petrol|bus|train|parking|toll)\b/, 'transport'],
  [/\b(rent|landlord)\b/, 'housing'],
  [/\b(electricity|water|internet|phone bill|utilities|evn)\b/, 'utilities'],
  [/\b(netflix|spotify|subscription|icloud|chatgpt|claude|notion|youtube)\b/, 'subscriptions'],
  [/\b(gym|protein|supplements?)\b/, 'fitness'],
  [/\b(book|books|course|lesson|tuition|udemy)\b/, 'education'],
  [/\b(pharmacy|doctor|dentist|medicine)\b/, 'health'],
  [/\b(clothes|shoes|shopping|zara|decathlon|amazon)\b/, 'shopping'],
  [/\b(cinema|movie|concert|game|steam|tickets?)\b/, 'entertainment'],
  [/\b(flight|hotel|airbnb|trip|booking)\b/, 'travel'],
  [/\b(gift|present)\b/, 'gifts'],
  [/\b(hosting|domain|software|ads)\b/, 'business'],
];

const INCOME_WORDS = /\b(income|salary|paid|payment from|invoice|freelance|client|refund)\b/;

export function guessCategory(text: string, direction: 'expense' | 'income'): string | null {
  const t = text.toLowerCase();
  if (direction === 'income') {
    if (/\b(salary|payroll|wage)\b/.test(t)) return 'salary';
    if (/\b(freelance|client|invoice|project)\b/.test(t)) return 'freelance';
    if (/\b(dividend|interest)\b/.test(t)) return 'investment';
    if (/\b(gift)\b/.test(t)) return 'gift';
    return null;
  }
  for (const [re, slug] of CATEGORY_WORDS) if (re.test(t)) return slug;
  return null;
}

const MONEY = /^([+-])?\s*(€|\$|£|ден|den|mkd|eur|usd|gbp|chf)?\s*(\d{1,9}(?:[.,]\d{1,2})?)\s*(€|\$|£|ден|den|mkd|eur|usd|gbp|chf)?(?:\s+(.*))?$/i;

const WEEKDAYS: [RegExp, number][] = [
  [/^mon(day)?$/, 1], [/^tue(s|sday)?$/, 2], [/^wed(nesday)?$/, 3], [/^thu(rs|rsday)?$/, 4], [/^fri(day)?$/, 5], [/^sat(urday)?$/, 6], [/^sun(day)?$/, 7],
];

/** A trailing due-date phrase: "tomorrow", "today", "on friday", "friday", "in 3 days", "2026-10-02". */
export function splitDue(text: string): { title: string; due: DueWord | null } {
  const t = text.trim();
  let m = /^(.*?)\s+(today|tonight)$/i.exec(t);
  if (m) return { title: m[1], due: { kind: 'today' } };
  m = /^(.*?)\s+(tomorrow|tmrw|tmr)$/i.exec(t);
  if (m) return { title: m[1], due: { kind: 'tomorrow' } };
  m = /^(.*?)\s+in\s+(\d{1,3})\s+days?$/i.exec(t);
  if (m) return { title: m[1], due: { kind: 'in', days: Number(m[2]) } };
  m = /^(.*?)\s+(?:on\s+)?(\d{4}-\d{2}-\d{2})$/i.exec(t);
  if (m) return { title: m[1], due: { kind: 'date', date: m[2] } };
  m = /^(.*?)\s+(?:on\s+|next\s+)?([a-z]+)$/i.exec(t);
  if (m) {
    const wd = WEEKDAYS.find(([re]) => re.test(m![2].toLowerCase()));
    if (wd && m[1].trim()) return { title: m[1], due: { kind: 'weekday', iso: wd[1] } };
  }
  return { title: t, due: null };
}

/** Resolve a due word against today (ISO dates, ISO weekdays 1 = Monday). A bare weekday means the next one. */
export function resolveDue(due: DueWord | null, today: string): string | null {
  if (!due) return null;
  const add = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  if (due.kind === 'today') return today;
  if (due.kind === 'tomorrow') return add(1);
  if (due.kind === 'in') return add(Math.min(365, due.days));
  if (due.kind === 'date') return due.date >= today ? due.date : null;
  const cur = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
  const diff = (due.iso - cur + 7) % 7 || 7;
  return add(diff);
}

export function parseCommand(raw: string): ParsedCommand | null {
  const input = raw.trim().replace(/\s+/g, ' ');
  if (!input) return null;
  const lower = input.toLowerCase();

  for (const [re, href, label] of NAV) if (re.test(lower)) return { kind: 'navigate', href, label };

  const task = /^(?:add|new|create)?\s*(?:task|todo|to-do)[:\s]+(.{2,160})$/i.exec(input);
  if (task) {
    const { title, due } = splitDue(task[1]);
    if (title.trim()) return { kind: 'task', title: title.trim().slice(0, 120), due };
  }

  const add = /^(?:add|new|create)(?:\s+(?:routine|mission|habit))?[:\s]+(.{2,120})$/i.exec(input);
  if (add) return { kind: 'mission', title: add[1].trim() };

  const money = MONEY.exec(input);
  if (money) {
    const [, sign, pre, num, post, rest = ''] = money;
    const cur = (pre || post)?.toLowerCase();
    const text = rest.trim();
    const hasSymbol = !!cur || !!sign;
    // "read 25" is a routine log, not money: require a currency symbol, a sign, or a category word
    const direction: 'expense' | 'income' = sign === '+' || INCOME_WORDS.test(text.toLowerCase()) ? 'income' : 'expense';
    const category = guessCategory(text, direction);
    if (hasSymbol || category || !text) {
      return {
        kind: 'money',
        direction,
        amount: num.replace(',', '.'),
        currency: cur ? CURRENCY[cur] ?? null : null,
        text,
        categorySlug: category,
      };
    }
  }

  const done = /^(?:done|did|kept|finished|trained|complete[d]?)\s+(.+)$/i.exec(input) ?? /^(.+?)\s+(?:done|kept|finished|✓|ok)$/i.exec(input);
  if (done) return { kind: 'complete', query: done[1].trim(), value: null, minimum: false };
  if (/^(trained|worked out|lifted)$/i.test(input)) return { kind: 'complete', query: 'gym', value: null, minimum: false };

  const min = /^(?:min(?:imum)?)\s+(.+)$/i.exec(input) ?? /^(.+?)\s+min(?:imum)?$/i.exec(input);
  if (min) return { kind: 'complete', query: min[1].trim(), value: null, minimum: true };

  const logged = /^(?:log\s+)?(.+?)\s+(\d{1,6}(?:[.,]\d+)?)\s*(?:min|mins|minutes|m|steps|pages|lessons|x)?$/i.exec(input);
  if (logged) return { kind: 'complete', query: logged[1].trim(), value: Number(logged[2].replace(',', '.')), minimum: false };

  return null;
}

/** Best title match for a query: exact → prefix → word-prefix → substring. */
export function matchMission<T extends { title: string }>(query: string, missions: T[]): T | null {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const t = (m: T) => m.title.toLowerCase();
  return (
    missions.find((m) => t(m) === q) ??
    missions.find((m) => t(m).startsWith(q)) ??
    missions.find((m) => t(m).split(/\s+/).some((w) => w.startsWith(q))) ??
    missions.find((m) => t(m).includes(q)) ??
    null
  );
}

export const GYM_WORDS = /^(gym|workout|training|lifting|lift|weights|the gym)$/i;
