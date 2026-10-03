import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import type { Queryable } from '@/lib/db';
import { storage, type Bucket } from './storage';

/**
 * Upload validation happens on the bytes, never the filename or the browser's claimed type:
 * magic numbers decide what a file is. Images are re-encoded (auto-rotated, max 2048 px, WebP),
 * which also strips EXIF — including GPS coordinates a phone camera embeds in every photo.
 */

export type Sniffed =
  | { kind: 'image'; mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }
  | { kind: 'pdf'; mime: 'application/pdf' }
  | { kind: 'video'; mime: 'video/mp4' | 'video/quicktime' | 'video/webm' }
  | { kind: 'heic' }
  | null;

export function sniff(buf: Buffer): Sniffed {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  if (hex.startsWith('ffd8ff')) return { kind: 'image', mime: 'image/jpeg' };
  if (hex.startsWith('89504e470d0a1a0a')) return { kind: 'image', mime: 'image/png' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { kind: 'image', mime: 'image/webp' };
  if (buf.subarray(0, 6).toString('ascii').startsWith('GIF8')) return { kind: 'image', mime: 'image/gif' };
  if (buf.subarray(0, 5).toString('ascii') === '%PDF-') return { kind: 'pdf', mime: 'application/pdf' };
  if (hex.startsWith('1a45dfa3')) return { kind: 'video', mime: 'video/webm' };
  if (buf.subarray(4, 8).toString('ascii') === 'ftyp') {
    const brand = buf.subarray(8, 12).toString('ascii');
    if (['heic', 'heix', 'hevc', 'mif1', 'msf1', 'heis'].includes(brand)) return { kind: 'heic' };
    if (brand === 'qt  ') return { kind: 'video', mime: 'video/quicktime' };
    return { kind: 'video', mime: 'video/mp4' };
  }
  return null;
}

export const LIMITS = { image: 15 * 1024 * 1024, pdf: 10 * 1024 * 1024, video: 60 * 1024 * 1024 };

export interface StoredFile {
  id: string;
  mime: string;
  width: number | null;
  height: number | null;
  kind: 'photo' | 'screenshot' | 'file' | 'video';
}

export type StoreResult = { ok: true; file: StoredFile; cleanup: () => Promise<void> } | { ok: false; error: string };

/** Validate, process and store an upload; insert its `files` row. Caller owns the transaction. */
export async function storeUpload(q: Queryable, userId: string, bucket: Bucket, data: Buffer, day: string): Promise<StoreResult> {
  const kind = sniff(data);
  if (!kind) return { ok: false, error: 'That file type isn’t supported. Use a photo, screenshot, PDF or video.' };
  if (kind.kind === 'heic') return { ok: false, error: 'HEIC photos aren’t supported yet. Set your camera to “Most Compatible” or share as JPEG.' };
  const limit = LIMITS[kind.kind];
  if (data.length > limit) return { ok: false, error: `File is too large (max ${Math.round(limit / 1024 / 1024)} MB).` };

  const id = randomUUID();
  const dir = `${userId}/${day.slice(0, 4)}/${day.slice(5, 7)}`;
  const sha256 = createHash('sha256').update(data).digest('hex');
  const s = storage();
  let objectPath: string;
  let thumbPath: string | null = null;
  let mime: string;
  let width: number | null = null;
  let height: number | null = null;
  let proofKind: StoredFile['kind'];
  let body: Buffer;

  if (kind.kind === 'image') {
    const sharp = (await import('sharp')).default;
    let img;
    try {
      img = sharp(data, { failOn: 'error', limitInputPixels: 50_000_000 }).rotate();
      const meta = await img.metadata();
      if (!meta.width || !meta.height) throw new Error('no dimensions');
    } catch {
      return { ok: false, error: 'That image couldn’t be read. Try exporting it again.' };
    }
    const full = await img.clone().resize({ width: 2048, height: 2048, fit: 'inside', withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
    const thumb = await img.clone().resize({ width: 640, height: 640, fit: 'inside', withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    body = full.data;
    width = full.info.width;
    height = full.info.height;
    mime = 'image/webp';
    objectPath = `${dir}/${id}.webp`;
    thumbPath = `${dir}/${id}.thumb.webp`;
    // screenshots are almost always PNG with no camera metadata; photos come from cameras
    proofKind = kind.mime === 'image/png' ? 'screenshot' : 'photo';
    await s.put(bucket, thumbPath, thumb, 'image/webp');
  } else if (kind.kind === 'pdf') {
    body = data;
    mime = kind.mime;
    objectPath = `${dir}/${id}.pdf`;
    proofKind = 'file';
  } else {
    body = data;
    mime = kind.mime;
    objectPath = `${dir}/${id}.${kind.mime === 'video/webm' ? 'webm' : kind.mime === 'video/quicktime' ? 'mov' : 'mp4'}`;
    proofKind = 'video';
  }

  await s.put(bucket, objectPath, body, mime);
  const cleanup = async () => {
    await s.remove(bucket, [objectPath, ...(thumbPath ? [thumbPath] : [])]).catch(() => {});
  };
  try {
    await q.query(
      `insert into files (id, bucket, object_path, thumb_path, mime_type, byte_size, width, height, sha256)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [id, bucket, objectPath, thumbPath, mime, body.length, width, height, sha256],
    );
  } catch (e) {
    await cleanup();
    throw e;
  }
  return { ok: true, file: { id, mime, width, height, kind: proofKind }, cleanup };
}

/**
 * Delete the file rows behind a completion's proofs. Returns a function that removes the
 * objects from storage — call it only after the transaction commits.
 */
export async function removeFilesForCompletion(q: Queryable, completionId: string): Promise<() => Promise<void>> {
  const rows = await q.query<{ id: string; bucket: Bucket; object_path: string; thumb_path: string | null }>(
    `select f.id, f.bucket, f.object_path, f.thumb_path from proofs p join files f on f.id = p.file_id where p.completion_id = $1`,
    [completionId],
  );
  if (!rows.length) return async () => {};
  await q.query(`delete from proofs where completion_id = $1`, [completionId]);
  await q.query(`delete from files where id = any($1::uuid[])`, [rows.map((r) => r.id)]);
  return async () => {
    const s = storage();
    for (const r of rows) await s.remove(r.bucket, [r.object_path, ...(r.thumb_path ? [r.thumb_path] : [])]).catch(() => {});
  };
}

export async function removeProof(q: Queryable, proofId: string): Promise<() => Promise<void>> {
  const [row] = await q.query<{ file_id: string | null; bucket: Bucket | null; object_path: string | null; thumb_path: string | null }>(
    `select p.file_id, f.bucket, f.object_path, f.thumb_path from proofs p left join files f on f.id = p.file_id where p.id = $1`,
    [proofId],
  );
  if (!row) return async () => {};
  await q.query(`delete from proofs where id = $1`, [proofId]);
  if (row.file_id) await q.query(`delete from files where id = $1`, [row.file_id]);
  return async () => {
    if (row.bucket && row.object_path) {
      await storage().remove(row.bucket, [row.object_path, ...(row.thumb_path ? [row.thumb_path] : [])]).catch(() => {});
    }
  };
}

/** Remove one file row (and, after commit, its objects). */
export async function removeFile(q: Queryable, fileId: string): Promise<() => Promise<void>> {
  const [row] = await q.query<{ bucket: Bucket; object_path: string; thumb_path: string | null }>(
    `delete from files where id = $1 returning bucket, object_path, thumb_path`,
    [fileId],
  );
  if (!row) return async () => {};
  return async () => {
    await storage().remove(row.bucket, [row.object_path, ...(row.thumb_path ? [row.thumb_path] : [])]).catch(() => {});
  };
}
