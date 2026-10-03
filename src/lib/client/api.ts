'use client';

import type { CompletionResult } from '@/lib/server/completions';
import type { ProofView } from '@/lib/server/proofs';
import type { Outcome } from '@/lib/engine/types';

/**
 * Client for the completions API with an offline queue. When the network is down, taps are
 * stored locally (latest action per mission+day wins) with their real wall-clock time, and
 * replayed in order when the connection returns. The UI stays optimistic throughout.
 */

export interface CompletionBody {
  missionId: string;
  day: string;
  outcome?: Outcome;
  value?: number | null;
  reason?: string | null;
  note?: string | null;
}

type Queued = { key: string; op: 'put' | 'delete'; body: CompletionBody; loggedAt: string };
const KEY = 'kept_offline_queue_v1';

function readQueue(): Queued[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]') as Queued[];
  } catch {
    return [];
  }
}

function writeQueue(q: Queued[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q));
  } catch {
    /* storage full or blocked — nothing sensible to do */
  }
}

function enqueue(item: Queued) {
  const q = readQueue().filter((x) => x.key !== item.key);
  q.push(item);
  writeQueue(q);
  window.dispatchEvent(new CustomEvent('kept:queue', { detail: q.length }));
}

export function queuedCount(): number {
  return typeof window === 'undefined' ? 0 : readQueue().length;
}

export type Offline = { ok: true; queued: true };

function isNetworkError(e: unknown) {
  return e instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false);
}

export async function putCompletion(body: CompletionBody): Promise<CompletionResult | Offline | { ok: false; error: string }> {
  const loggedAt = new Date().toISOString();
  try {
    const res = await fetch('/api/v1/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...body, loggedAt, source: 'app' }),
    });
    if (res.status === 401) {
      window.location.href = '/login';
      return { ok: false, error: 'Signed out.' };
    }
    return (await res.json()) as CompletionResult | { ok: false; error: string };
  } catch (e) {
    if (!isNetworkError(e)) return { ok: false, error: 'Something went wrong.' };
    enqueue({ key: `${body.missionId}:${body.day}`, op: 'put', body, loggedAt });
    return { ok: true, queued: true };
  }
}

export async function deleteCompletion(missionId: string, day: string): Promise<{ ok: boolean; xpTotal?: number; queued?: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/v1/completions?missionId=${encodeURIComponent(missionId)}&day=${encodeURIComponent(day)}`, { method: 'DELETE' });
    return (await res.json()) as { ok: boolean; xpTotal?: number };
  } catch (e) {
    if (!isNetworkError(e)) return { ok: false, error: 'Something went wrong.' };
    enqueue({ key: `${missionId}:${day}`, op: 'delete', body: { missionId, day }, loggedAt: new Date().toISOString() });
    return { ok: true, queued: true };
  }
}

let flushing = false;
/** Replay queued taps. Returns how many were applied. */
export async function flushQueue(): Promise<number> {
  if (flushing || typeof window === 'undefined' || !navigator.onLine) return 0;
  const q = readQueue();
  if (!q.length) return 0;
  flushing = true;
  let done = 0;
  try {
    for (const item of q) {
      try {
        const res =
          item.op === 'put'
            ? await fetch('/api/v1/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...item.body, loggedAt: item.loggedAt, source: 'offline' }),
              })
            : await fetch(`/api/v1/completions?missionId=${item.body.missionId}&day=${item.body.day}`, { method: 'DELETE' });
        // 4xx means the server rejected it for good (e.g. too old) — drop it rather than retry forever
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 401 && res.status !== 429)) {
          writeQueue(readQueue().filter((x) => x.key !== item.key || x.loggedAt !== item.loggedAt));
          done++;
        } else break;
      } catch {
        break;
      }
    }
  } finally {
    flushing = false;
    window.dispatchEvent(new CustomEvent('kept:queue', { detail: readQueue().length }));
  }
  return done;
}

/** Upload proof with progress (fetch can't report upload progress; XHR can). */
export function uploadProof(
  form: FormData,
  onProgress?: (fraction: number) => void,
): Promise<{ ok: true; proof: ProofView } | { ok: false; error: string }> {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/v1/proofs');
    xhr.responseType = 'json';
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => resolve((xhr.response as { ok: true; proof: ProofView } | { ok: false; error: string }) ?? { ok: false, error: 'Upload failed.' });
    xhr.onerror = () => resolve({ ok: false, error: 'You’re offline — proof can’t upload right now.' });
    xhr.send(form);
  });
}

/** Downscale big photos in the browser before upload: faster on mobile data, and the server re-encodes anyway. */
export async function compressImage(file: File, maxSide = 2048, quality = 0.86): Promise<Blob> {
  if (!file.type.startsWith('image/') || file.type === 'image/gif' || file.size < 400_000) return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas = new OffscreenCanvas(w, h);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
    bitmap.close();
    const type = file.type === 'image/png' && file.size < 3_000_000 ? 'image/png' : 'image/jpeg';
    return await canvas.convertToBlob({ type, quality });
  } catch {
    return file;
  }
}
