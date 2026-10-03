import { NextResponse, type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { removeCompletion, upsertCompletion } from '@/lib/server/completions';
import { allow } from '@/lib/server/rate-limit';

/**
 * JSON API for completions. The Today screen uses it (not a Server Action) so taps can run in
 * parallel and so offline taps can be queued and replayed against a stable URL — the same
 * endpoint a native app would call.
 */

export async function POST(req: NextRequest) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`c:${viewer.userId}`, 240, 60_000)) return NextResponse.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'Invalid JSON.' }, { status: 400 });
  }
  const res = await upsertCompletion(viewer, body as Parameters<typeof upsertCompletion>[1]);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}

export async function DELETE(req: NextRequest) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`c:${viewer.userId}`, 240, 60_000)) return NextResponse.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
  const missionId = req.nextUrl.searchParams.get('missionId') ?? '';
  const day = req.nextUrl.searchParams.get('day') ?? '';
  const res = await removeCompletion(viewer, missionId, day);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
