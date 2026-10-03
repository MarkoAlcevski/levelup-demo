import 'server-only';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import type { Viewer } from './profile';
import { removeFile, storeUpload } from './files';

/**
 * Receipts: a photo, screenshot or PDF attached to a transaction, stored privately like proof.
 * No OCR yet — and when there is, nothing extracted will be saved without the user confirming it.
 */
export async function attachReceipt(viewer: Viewer, transactionId: string, data: Buffer) {
  if (!z.uuid().safeParse(transactionId).success) return { ok: false as const, error: 'Invalid transaction.' };
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const res = await asUser(viewer.userId, async (q) => {
      const [t] = await q.query<{ id: string; occurred_on: string }>(`select id, occurred_on from transactions where id = $1`, [transactionId]);
      if (!t) return { ok: false as const, error: 'Transaction not found.' };
      const [{ n }] = await q.query<{ n: number }>(`select count(*)::int as n from receipts where transaction_id = $1`, [t.id]);
      if (n >= 6) return { ok: false as const, error: 'That’s the maximum receipts for one transaction.' };
      const stored = await storeUpload(q, viewer.userId, 'receipts', data, t.occurred_on);
      if (!stored.ok) return stored;
      cleanup = stored.cleanup;
      if (stored.file.kind === 'video') return { ok: false as const, error: 'Receipts can be photos, screenshots or PDFs.' };
      const [r] = await q.query<{ id: string }>(
        `insert into receipts (file_id, transaction_id, status, confirmed_at) values ($1, $2, 'confirmed', now()) returning id`,
        [stored.file.id, t.id],
      );
      return { ok: true as const, id: r.id };
    });
    if (!res.ok && cleanup) await (cleanup as () => Promise<void>)();
    return res;
  } catch (e) {
    if (cleanup) await (cleanup as () => Promise<void>)();
    throw e;
  }
}

export async function removeReceipt(viewer: Viewer, receiptId: string) {
  if (!z.uuid().safeParse(receiptId).success) return { ok: false as const, error: 'Invalid receipt.' };
  const after = await asUser(viewer.userId, async (q) => {
    const [r] = await q.query<{ file_id: string }>(`delete from receipts where id = $1 returning file_id`, [receiptId]);
    return r ? removeFile(q, r.file_id) : null;
  });
  if (after) await after();
  return { ok: true as const };
}
