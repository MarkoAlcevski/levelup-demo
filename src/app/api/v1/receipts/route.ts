import { NextResponse, type NextRequest } from 'next/server';
import { viewerOrNull } from '@/lib/server/context';
import { allow } from '@/lib/server/rate-limit';
import { LIMITS } from '@/lib/server/files';
import { attachReceipt, removeReceipt } from '@/lib/server/receipts';

/** Attach a receipt (multipart: transactionId + file) or remove one (?id=). */
export async function POST(req: NextRequest) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  if (!allow(`r:${viewer.userId}`, 60, 60_000)) return NextResponse.json({ ok: false, error: 'Too many uploads — wait a minute.' }, { status: 429 });
  if (Number(req.headers.get('content-length') ?? 0) > LIMITS.image + 65_536) return NextResponse.json({ ok: false, error: 'File is too large.' }, { status: 413 });
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'Upload failed. Try again.' }, { status: 400 });
  }
  const file = form.get('file');
  if (!(file instanceof File) || file.size === 0) return NextResponse.json({ ok: false, error: 'Choose a file.' }, { status: 400 });
  const res = await attachReceipt(viewer, String(form.get('transactionId') ?? ''), Buffer.from(await file.arrayBuffer()));
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}

export async function DELETE(req: NextRequest) {
  const viewer = await viewerOrNull();
  if (!viewer) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  const res = await removeReceipt(viewer, req.nextUrl.searchParams.get('id') ?? '');
  return NextResponse.json(res, { status: res.ok ? 200 : 400 });
}
