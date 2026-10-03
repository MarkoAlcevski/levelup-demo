import { type NextRequest } from 'next/server';
import { z } from 'zod';
import { asUser } from '@/lib/db';
import { viewerOrNull } from '@/lib/server/context';
import { storage, verifyFileSignature, type Bucket, type Variant } from '@/lib/server/storage';

/**
 * Serves a private file. Three independent checks, all must pass:
 *   1. the URL signature (HMAC over file id, variant, expiry and owner) and its expiry,
 *   2. a signed-in session whose user id is the one the URL was signed for,
 *   3. the file row being visible to that user under row-level security.
 * A leaked URL is useless to anyone else and dies within 15 minutes anyway.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const sp = req.nextUrl.searchParams;
  const variant = (sp.get('v') === 'thumb' ? 'thumb' : 'full') as Variant;
  const exp = Number(sp.get('e'));
  const sig = sp.get('s') ?? '';
  if (!z.uuid().safeParse(id).success) return new Response('Not found', { status: 404 });

  const viewer = await viewerOrNull();
  if (!viewer || !verifyFileSignature(id, variant, exp, sig, viewer.userId)) return new Response('Forbidden', { status: 403 });

  const [row] = await asUser(viewer.userId, (q) =>
    q.query<{ bucket: Bucket; object_path: string; thumb_path: string | null; mime_type: string }>(
      `select bucket, object_path, thumb_path, mime_type from files where id = $1`,
      [id],
    ),
  );
  if (!row) return new Response('Not found', { status: 404 });
  const path = variant === 'thumb' && row.thumb_path ? row.thumb_path : row.object_path;
  const data = await storage().get(row.bucket, path);
  if (!data) return new Response('Not found', { status: 404 });
  const mime = variant === 'thumb' && row.thumb_path ? 'image/webp' : row.mime_type;
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=900',
      'Content-Disposition': mime === 'application/pdf' ? 'inline' : 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
