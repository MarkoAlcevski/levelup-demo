import { NextResponse, type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { LIMITS } from '@/lib/server/files';
import { listPics, postPic } from '@/lib/server/group-pics';

/** Gym pics for one group: GET a page (members only), POST a new photo (multipart: file, caption). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { groupId } = await ctx.params;
  const page = await listPics(viewer, groupId, req.nextUrl.searchParams.get('before'));
  if (!page) return NextResponse.json({ ok: false, error: 'not found' }, { status: 404 });
  return NextResponse.json({ ok: true, ...page });
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { groupId } = await ctx.params;
  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > LIMITS.image + 1024 * 64) return NextResponse.json({ ok: false, error: 'That photo is too large (max 15 MB).' }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Upload failed. Try again.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'Choose a photo.' }, { status: 400 });
  if (file.size > LIMITS.image) return NextResponse.json({ ok: false, error: 'That photo is too large (max 15 MB).' }, { status: 413 });
  const res = await postPic(viewer, groupId, Buffer.from(await file.arrayBuffer()), String(form.get('caption') ?? ''));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
