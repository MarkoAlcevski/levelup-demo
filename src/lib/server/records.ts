import 'server-only';
import type { Queryable } from '@/lib/db';
import type { ISODate } from '@/lib/engine/dates';

/**
 * Personal records. The first time a record is computed it becomes the baseline silently;
 * after that, beating it writes a timeline entry ("New record: 34-day run") exactly once.
 */

export type RecordKey = 'longest_run' | 'best_day_kept' | 'best_week_execution' | 'most_focus_week' | 'most_xp_day';

export interface RecordCandidate {
  key: RecordKey;
  value: number;
  achievedOn: ISODate;
}

const TITLE: Record<RecordKey, (v: number) => string> = {
  longest_run: (v) => `New record: ${v}-day run`,
  best_day_kept: (v) => `New record: ${v} kept in one day`,
  best_week_execution: (v) => `Best week yet: ${Math.round(v)}% execution`,
  most_focus_week: (v) => `Most focused week yet: ${Math.round(v / 60)} h`,
  most_xp_day: (v) => `Most points in a day: ${Math.round(v).toLocaleString('en-US')}`,
};

export interface StoredRecord {
  key: RecordKey;
  value: number;
  previous: number | null;
  achievedOn: ISODate;
}

export async function readRecords(q: Queryable): Promise<Map<RecordKey, StoredRecord>> {
  const rows = await q.query<{ record_key: RecordKey; value: number; previous_value: number | null; achieved_on: string }>(
    `select record_key, value, previous_value, achieved_on from personal_records`,
  );
  return new Map(rows.map((r) => [r.record_key, { key: r.record_key, value: Number(r.value), previous: r.previous_value == null ? null : Number(r.previous_value), achievedOn: r.achieved_on }]));
}

export async function syncRecords(q: Queryable, candidates: RecordCandidate[]): Promise<StoredRecord[]> {
  const stored = await readRecords(q);
  const broken: StoredRecord[] = [];
  for (const c of candidates) {
    if (!Number.isFinite(c.value) || c.value <= 0) continue;
    const s = stored.get(c.key);
    if (!s) {
      await q.query(
        `insert into personal_records (record_key, value, achieved_on) values ($1, $2, $3) on conflict do nothing`,
        [c.key, c.value, c.achievedOn],
      );
      continue;
    }
    if (c.value > s.value + 1e-9) {
      await q.query(
        `update personal_records set value = $2, previous_value = $3, achieved_on = $4, updated_at = now() where record_key = $1`,
        [c.key, c.value, s.value, c.achievedOn],
      );
      await q.query(
        `insert into timeline_events (occurred_on, kind, title, detail, source_key) values ($1, 'record', $2, $3, $4)
         on conflict (user_id, kind, source_key) do nothing`,
        [c.achievedOn, TITLE[c.key](c.value), `Previous best: ${formatPrev(c.key, s.value)}.`, `${c.key}:${c.achievedOn}`],
      );
      broken.push({ key: c.key, value: c.value, previous: s.value, achievedOn: c.achievedOn });
    }
  }
  return broken;
}

function formatPrev(key: RecordKey, v: number): string {
  if (key === 'longest_run') return `${v} days`;
  if (key === 'best_week_execution') return `${Math.round(v)}%`;
  if (key === 'most_focus_week') return `${Math.round(v / 60)} h`;
  return Math.round(v).toLocaleString('en-US');
}
