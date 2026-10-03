import { NextResponse, type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { deleteSession, loadSessionForEdit, putSession } from '@/lib/server/gym';
import { allow } from '@/lib/server/rate-limit';

/**
 * A workout, as one resource. The phone PUTs the whole workout (full state, idempotent) as sets are
 * logged — and replays it after being offline — so the server always converges on what was on screen.
 */

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await loadSessionForEdit(viewer, id);
  if (!res) return NextResponse.json({ ok: false, error: 'Not found.' }, { status: 404 });
  return NextResponse.json({ ok: true, ...res });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`w:${viewer.userId}`, 600, 60_000)) return NextResponse.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
  const { id } = await ctx.params;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const res = await putSession(viewer, id, body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const { id } = await ctx.params;
  const res = await deleteSession(viewer, id);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
