import 'server-only';
import { asUser } from '@/lib/db';
import type { ISODate } from '@/lib/engine/dates';
import type { Viewer } from './context';
import { removeProof, storeUpload } from './files';
import { signedFileUrl } from './storage';
import { track } from './analytics';

export interface ProofView {
  id: string;
  kind: 'photo' | 'video' | 'screenshot' | 'file' | 'note' | 'link';
  day: ISODate;
  body: string | null;
  url: string | null;
  thumbUrl: string | null;
  fullUrl: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  missionId: string;
  missionTitle: string;
  areaKind: string;
  areaName: string;
  outcome: string;
  value: number | null;
  unit: string | null;
}

interface ProofSqlRow {
  id: string;
  kind: ProofView['kind'];
  captured_on: string;
  body: string | null;
  url: string | null;
  file_id: string | null;
  width: number | null;
  height: number | null;
  mime_type: string | null;
  thumb_path: string | null;
  mission_id: string;
  title: string;
  area_kind: string;
  area_name: string;
  outcome: string;
  value: number | null;
  unit: string | null;
}

export const PROOF_SELECT = `
  select p.id, p.kind, p.captured_on, p.body, p.url, p.file_id, f.width, f.height, f.mime_type, f.thumb_path,
         c.mission_id, m.title, a.kind as area_kind, a.name as area_name, c.outcome, c.value, m.unit
    from proofs p
    join completions c on c.id = p.completion_id
    join missions m on m.id = c.mission_id
    join areas a on a.id = m.area_id
    left join files f on f.id = p.file_id`;

export function toProofView(r: ProofSqlRow, userId: string): ProofView {
  return {
    id: r.id,
    kind: r.kind,
    day: r.captured_on,
    body: r.body,
    url: r.url,
    thumbUrl: r.file_id && r.thumb_path ? signedFileUrl(r.file_id, 'thumb', userId) : null,
    fullUrl: r.file_id ? signedFileUrl(r.file_id, 'full', userId) : null,
    width: r.width,
    height: r.height,
    mime: r.mime_type,
    missionId: r.mission_id,
    missionTitle: r.title,
    areaKind: r.area_kind,
    areaName: r.area_name,
    outcome: r.outcome,
    value: r.value == null ? null : Number(r.value),
    unit: r.unit,
  };
}

export type AttachInput =
  | { completionId: string; kind: 'file'; data: Buffer }
  | { completionId: string; kind: 'note'; body: string }
  | { completionId: string; kind: 'link'; url: string; body?: string };

export async function attachProof(viewer: Viewer, input: AttachInput): Promise<{ ok: true; proof: ProofView } | { ok: false; error: string }> {
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const res = await asUser(viewer.userId, async (q) => {
      const [c] = await q.query<{ id: string; occurred_on: string }>(`select id, occurred_on from completions where id = $1`, [input.completionId]);
      if (!c) return { ok: false as const, error: 'Complete the mission first, then attach proof.' };
      const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from proofs where completion_id = $1`, [c.id]);
      if (n >= 12) return { ok: false as const, error: 'That’s the maximum proof for one completion.' };

      let proofId: string;
      if (input.kind === 'file') {
        const stored = await storeUpload(q, viewer.userId, 'proofs', input.data, c.occurred_on);
        if (!stored.ok) return stored;
        cleanup = stored.cleanup;
        const [p] = await q.query<{ id: string }>(
          `insert into proofs (completion_id, kind, file_id, captured_on) values ($1, $2, $3, $4) returning id`,
          [c.id, stored.file.kind, stored.file.id, c.occurred_on],
        );
        proofId = p.id;
      } else if (input.kind === 'note') {
        const body = input.body.trim();
        if (!body || body.length > 4000) return { ok: false as const, error: 'Notes are 1–4000 characters.' };
        const [p] = await q.query<{ id: string }>(
          `insert into proofs (completion_id, kind, body, captured_on) values ($1, 'note', $2, $3) returning id`,
          [c.id, body, c.occurred_on],
        );
        proofId = p.id;
      } else {
        let url: URL;
        try {
          url = new URL(input.url.trim());
        } catch {
          return { ok: false as const, error: 'That link doesn’t look valid.' };
        }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') return { ok: false as const, error: 'Only web links can be attached.' };
        const [p] = await q.query<{ id: string }>(
          `insert into proofs (completion_id, kind, url, body, captured_on) values ($1, 'link', $2, $3, $4) returning id`,
          [c.id, url.toString().slice(0, 2048), input.body?.trim() || null, c.occurred_on],
        );
        proofId = p.id;
      }
      const [row] = await q.query<ProofSqlRow>(`${PROOF_SELECT} where p.id = $1`, [proofId]);
      return { ok: true as const, proof: toProofView(row, viewer.userId) };
    });
    if (res.ok) void track(viewer.userId, 'proof_attached', { kind: res.proof.kind });
    else if (cleanup) await (cleanup as () => Promise<void>)();
    return res;
  } catch (e) {
    if (cleanup) await (cleanup as () => Promise<void>)();
    throw e;
  }
}

export async function deleteProof(viewer: Viewer, proofId: string): Promise<{ ok: boolean }> {
  const after = await asUser(viewer.userId, (q) => removeProof(q, proofId));
  await after();
  return { ok: true };
}

export interface RecordTotals {
  year: number;
  kept: number;
  activeDays: number;
  minutes: number;
  proofs: number;
  photos: number;
  perMission: { id: string; title: string; areaKind: string; measure: string; unit: string | null; sessions: number; total: number }[];
  firstDay: string | null;
}

/** "The Record": what this year's work adds up to. */
export async function loadRecordTotals(viewer: Viewer, year: number): Promise<RecordTotals> {
  const from = `${year}-01-01`;
  const to = `${year}-12-31`;
  return asUser(viewer.userId, async (q) => {
    const [per, totals, proofs] = await Promise.all([
      q.query<{ id: string; title: string; kind: string; measure: string; unit: string | null; sessions: number; total: number }>(
        `select m.id, m.title, a.kind, m.measure, m.unit,
                count(*) filter (where c.kept)::int as sessions,
                coalesce(sum(c.value) filter (where c.outcome not in ('missed', 'skipped')), 0) as total
           from completions c join missions m on m.id = c.mission_id join areas a on a.id = m.area_id
          where c.occurred_on between $1 and $2
          group by m.id, m.title, a.kind, m.measure, m.unit
          having count(*) filter (where c.kept) > 0
          order by sessions desc`,
        [from, to],
      ),
      q.query<{ kept: number; days: number; minutes: number; first: string | null }>(
        `select count(*) filter (where c.kept)::int as kept,
                count(distinct c.occurred_on) filter (where c.kept)::int as days,
                coalesce(sum(c.value) filter (where m.measure = 'duration' and c.outcome not in ('missed', 'skipped')), 0) as minutes,
                min(c.occurred_on) as first
           from completions c join missions m on m.id = c.mission_id
          where c.occurred_on between $1 and $2`,
        [from, to],
      ),
      q.query<{ n: number; photos: number }>(
        `select count(*)::int as n, count(*) filter (where kind in ('photo', 'screenshot', 'video'))::int as photos
           from proofs where captured_on between $1 and $2`,
        [from, to],
      ),
    ]);
    return {
      year,
      kept: totals[0]?.kept ?? 0,
      activeDays: totals[0]?.days ?? 0,
      minutes: Number(totals[0]?.minutes ?? 0),
      proofs: proofs[0]?.n ?? 0,
      photos: proofs[0]?.photos ?? 0,
      perMission: per.map((r) => ({ id: r.id, title: r.title, areaKind: r.kind, measure: r.measure, unit: r.unit, sessions: r.sessions, total: Number(r.total) })),
      firstDay: totals[0]?.first ?? null,
    };
  });
}

export interface EvidencePage {
  proofs: ProofView[];
  nextCursor: string | null;
}

/** Proof, newest first. Cursor = "<day>|<id>". */
export async function listEvidence(
  viewer: Viewer,
  opts: { cursor?: string | null; limit?: number; areaKind?: string | null; year?: number | null; month?: string | null; kind?: string | null } = {},
): Promise<EvidencePage> {
  const limit = Math.min(Math.max(opts.limit ?? 48, 1), 120);
  return asUser(viewer.userId, async (q) => {
    const params: unknown[] = [];
    const where: string[] = [];
    if (opts.cursor) {
      const [d, id] = opts.cursor.split('|');
      params.push(d, id);
      where.push(`(p.captured_on, p.id) < ($${params.length - 1}::date, $${params.length}::uuid)`);
    }
    if (opts.areaKind) {
      // an area id, or a kind ('gym' also matches V1 'body' areas)
      if (/^[0-9a-f-]{36}$/.test(opts.areaKind)) {
        params.push(opts.areaKind);
        where.push(`a.id = $${params.length}`);
      } else {
        params.push(opts.areaKind === 'gym' ? ['gym', 'body'] : [opts.areaKind]);
        where.push(`a.kind = any($${params.length}::text[])`);
      }
    }
    if (opts.year) {
      params.push(`${opts.year}-01-01`, `${opts.year}-12-31`);
      where.push(`p.captured_on between $${params.length - 1} and $${params.length}`);
    }
    if (opts.month && /^\d{4}-(0[1-9]|1[0-2])$/.test(opts.month)) {
      params.push(`${opts.month}-01`);
      where.push(`date_trunc('month', p.captured_on) = $${params.length}::date`);
    }
    if (opts.kind === 'image') where.push(`p.kind in ('photo', 'screenshot')`);
    else if (opts.kind && ['photo', 'video', 'screenshot', 'file', 'note', 'link'].includes(opts.kind)) {
      params.push(opts.kind);
      where.push(`p.kind = $${params.length}`);
    }
    params.push(limit + 1);
    const rows = await q.query<ProofSqlRow>(
      `${PROOF_SELECT} ${where.length ? 'where ' + where.join(' and ') : ''}
       order by p.captured_on desc, p.id desc limit $${params.length}`,
      params,
    );
    const page = rows.slice(0, limit).map((r) => toProofView(r, viewer.userId));
    const last = page.at(-1);
    return { proofs: page, nextCursor: rows.length > limit && last ? `${last.day}|${last.id}` : null };
  });
}

export interface EvidenceFacets {
  areas: { id: string; name: string; kind: string; icon: string | null }[];
  months: string[];
  kinds: string[];
}

/** What the evidence wall can be filtered by — only areas, months and types that actually have proof. */
export async function evidenceFacets(viewer: Viewer): Promise<EvidenceFacets> {
  return asUser(viewer.userId, async (q) => {
    const [areas, months, kinds] = await Promise.all([
      q.query<{ id: string; name: string; kind: string; icon: string | null }>(
        `select distinct a.id, a.name, a.kind, a.icon, a.sort_order from proofs p join completions c on c.id = p.completion_id
           join missions m on m.id = c.mission_id join areas a on a.id = m.area_id order by a.sort_order, a.name`,
      ),
      q.query<{ m: string }>(`select distinct to_char(captured_on, 'YYYY-MM') as m from proofs order by m desc limit 36`),
      q.query<{ kind: string }>(`select distinct kind from proofs`),
    ]);
    return { areas: areas.map(({ id, name, kind, icon }) => ({ id, name, kind, icon })), months: months.map((r) => r.m), kinds: kinds.map((k) => k.kind) };
  });
}
