import { type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { picFile } from '@/lib/server/group-pics';
import { storage } from '@/lib/server/storage';

/** One gym pic, for members of its group only (checked in Postgres on every request). ?v=thumb for the small one. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ groupId: string; picId: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return new Response('Forbidden', { status: 403 });
  const { groupId, picId } = await ctx.params;
  const row = await picFile(viewer, groupId, picId);
  if (!row) return new Response('Not found', { status: 404 });
  const thumb = req.nextUrl.searchParams.get('v') === 'thumb' && row.thumb_path;
  const data = await storage().get(row.bucket, thumb ? row.thumb_path! : row.object_path);
  if (!data) return new Response('Not found', { status: 404 });
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': thumb ? 'image/webp' : row.mime_type,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=600',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
