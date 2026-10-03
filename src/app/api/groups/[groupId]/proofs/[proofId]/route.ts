import { type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { sharedProofFile } from '@/lib/server/groups';
import { storage } from '@/lib/server/storage';

/**
 * A proof its owner shared with a group, served to that group's members only. Membership and the
 * share are checked in Postgres on every request; nothing else in the owner's evidence is reachable.
 */
export async function GET(req: NextRequest, ctx: { params: Promise<{ groupId: string; proofId: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return new Response('Forbidden', { status: 403 });
  const { groupId, proofId } = await ctx.params;
  const row = await sharedProofFile(viewer, groupId, proofId);
  if (!row || !row.bucket || !row.object_path) return new Response('Not found', { status: 404 });
  const thumb = req.nextUrl.searchParams.get('v') === 'thumb' && row.thumb_path;
  const data = await storage().get(row.bucket, thumb ? row.thumb_path! : row.object_path);
  if (!data) return new Response('Not found', { status: 404 });
  const mime = thumb ? 'image/webp' : row.mime_type ?? 'application/octet-stream';
  return new Response(new Uint8Array(data), {
    headers: {
      'Content-Type': mime,
      'Content-Length': String(data.length),
      'Cache-Control': 'private, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    },
  });
}
