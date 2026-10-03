import { NextResponse, type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { finishSession } from '@/lib/server/gym';
import { allow } from '@/lib/server/rate-limit';

/** Finish a workout: one action saves it, keeps the day's Gym routine and returns the summary. Idempotent. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`wf:${viewer.userId}`, 60, 60_000)) return NextResponse.json({ ok: false, error: 'Slow down a little.' }, { status: 429 });
  const { id } = await ctx.params;
  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const res = await finishSession(viewer, id, body);
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
