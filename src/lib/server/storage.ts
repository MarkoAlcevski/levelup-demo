import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir } from '@/lib/db';

/**
 * Private object storage.
 *   local    — files under KEPT_DATA_DIR/storage (default, zero setup)
 *   supabase — Supabase Storage private buckets (set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).
 *              Written against the Storage REST API; not exercised in this environment.
 * Object paths always start with the owner's user id; the database enforces the same rule.
 */

export type Bucket = 'proofs' | 'receipts';

const SAFE_PATH = /^[0-9a-f-]{36}\/\d{4}\/\d{2}\/[0-9a-f-]{36}(?:\.thumb)?\.(?:webp|jpg|png|pdf|mp4|mov|webm)$/;

export function assertSafePath(p: string): void {
  if (!SAFE_PATH.test(p)) throw new Error('unsafe object path');
}

interface StorageDriver {
  put(bucket: Bucket, objectPath: string, data: Buffer, contentType: string): Promise<void>;
  get(bucket: Bucket, objectPath: string): Promise<Buffer | null>;
  remove(bucket: Bucket, paths: string[]): Promise<void>;
}

const objectFile = (bucket: Bucket, objectPath: string) => path.join(/*turbopackIgnore: true*/ dataDir(), 'storage', bucket, objectPath);

const local: StorageDriver = {
  async put(bucket, objectPath, data) {
    assertSafePath(objectPath);
    const file = objectFile(bucket, objectPath);
    await mkdir(/*turbopackIgnore: true*/ path.dirname(file), { recursive: true });
    await writeFile(/*turbopackIgnore: true*/ file, data, { flag: 'wx' }); // never overwrite: objects are immutable
  },
  async get(bucket, objectPath) {
    assertSafePath(objectPath);
    try {
      return await readFile(/*turbopackIgnore: true*/ objectFile(bucket, objectPath));
    } catch {
      return null;
    }
  },
  async remove(bucket, paths) {
    for (const p of paths) {
      assertSafePath(p);
      await rm(/*turbopackIgnore: true*/ objectFile(bucket, p), { force: true });
    }
  },
};

function supabaseDriver(url: string, key: string): StorageDriver {
  const base = `${url.replace(/\/$/, '')}/storage/v1`;
  const auth = { Authorization: `Bearer ${key}`, apikey: key };
  return {
    async put(bucket, objectPath, data, contentType) {
      assertSafePath(objectPath);
      const res = await fetch(`${base}/object/${bucket}/${objectPath}`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': contentType, 'x-upsert': 'false' },
        body: new Uint8Array(data),
      });
      if (!res.ok) throw new Error(`storage put failed: ${res.status}`);
    },
    async get(bucket, objectPath) {
      assertSafePath(objectPath);
      const res = await fetch(`${base}/object/${bucket}/${objectPath}`, { headers: auth });
      return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
    },
    async remove(bucket, paths) {
      paths.forEach(assertSafePath);
      if (!paths.length) return;
      await fetch(`${base}/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: paths }),
      });
    },
  };
}

export function storage(): StorageDriver {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return url && key ? supabaseDriver(url, key) : local;
}

// ───────────────────────────────────────────── signed URLs

function secret(): string {
  const s = process.env.KEPT_SECRET;
  if (!s || s.length < 32 || s.startsWith('change-me')) {
    if (process.env.NODE_ENV === 'production') throw new Error('KEPT_SECRET must be set to 32+ random bytes');
    return 'dev-only-insecure-secret-dev-only-insecure-secret';
  }
  return s;
}

export type Variant = 'thumb' | 'full';

function sign(fileId: string, variant: Variant, exp: number, userId: string): string {
  return createHmac('sha256', secret()).update(`${fileId}.${variant}.${exp}.${userId}`).digest('base64url');
}

/** Short-lived URL for a private file, bound to its owner. */
export function signedFileUrl(fileId: string, variant: Variant, userId: string, ttlSeconds = 900): string {
  // round expiry to 5 minutes so URLs stay stable across renders (better browser caching)
  const exp = Math.ceil((Date.now() / 1000 + ttlSeconds) / 300) * 300;
  return `/api/files/${fileId}?v=${variant}&e=${exp}&s=${sign(fileId, variant, exp, userId)}`;
}

export function verifyFileSignature(fileId: string, variant: Variant, exp: number, sig: string, userId: string): boolean {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = Buffer.from(sign(fileId, variant, exp, userId));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
