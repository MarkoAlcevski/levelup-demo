import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { viewerOrNull } from '@/lib/server/context';
import { upsertCompletion } from '@/lib/server/completions';
import { attachProof } from '@/lib/server/proofs';
import { allow } from '@/lib/server/rate-limit';
import { LIMITS } from '@/lib/server/files';
import { afterProofAttached } from '@/lib/server/group-activity';

const MAX_BYTES = LIMITS.video;

/**
 * Attach proof to a completion. Multipart: kind = file | note | link, plus either
 * completionId, or missionId + day (the completion is created as Full if it doesn't exist —
 * "complete with proof" in one request).
 */
export async function POST(req: NextRequest) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`p:${viewer.userId}`, 60, 60_000)) return NextResponse.json({ ok: false, error: 'Too many uploads — wait a minute.' }, { status: 429 });

  const len = Number(req.headers.get('content-length') ?? 0);
  if (len > MAX_BYTES + 1024 * 64) return NextResponse.json({ ok: false, error: 'File is too large.' }, { status: 413 });

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Upload failed. Try again.' }, { status: 400 });
  }
  const kind = String(form.get('kind') ?? '');
  let completionId = String(form.get('completionId') ?? '');
  if (!z.uuid().safeParse(completionId).success) {
    const missionId = String(form.get('missionId') ?? '');
    const day = String(form.get('day') ?? viewer.today);
    const done = await upsertCompletion(viewer, { missionId, day, source: 'app' });
    if (!done.ok) return NextResponse.json(done, { status: 400 });
    completionId = done.completionId;
  }

  if (kind === 'file') {
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'Choose a file.' }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: 'File is too large.' }, { status: 413 });
    const data = Buffer.from(await file.arrayBuffer());
    return respond(viewer, await attachProof(viewer, { completionId, kind: 'file', data }));
  }
  if (kind === 'note') {
    return respond(viewer, await attachProof(viewer, { completionId, kind: 'note', body: String(form.get('body') ?? '') }));
  }
  if (kind === 'link') {
    return respond(viewer, await attachProof(viewer, { completionId, kind: 'link', url: String(form.get('url') ?? ''), body: String(form.get('body') ?? '') || undefined }));
  }
  return NextResponse.json({ ok: false, error: 'Unknown proof type.' }, { status: 400 });
}

/** Auto-share into groups that asked for it; tell the client which groups it could share with. */
async function respond(viewer: NonNullable<Awaited<ReturnType<typeof viewerOrNull>>>, res: Awaited<ReturnType<typeof attachProof>>) {
  if (!res.ok) return NextResponse.json(res, { status: 400 });
  const shareGroups = await afterProofAttached(viewer, res.proof.id);
  return NextResponse.json({ ...res, shareGroups });
}
