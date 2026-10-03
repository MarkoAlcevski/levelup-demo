import 'server-only';
import { z } from 'zod';
import { asSystem, asUser } from '@/lib/db';
import type { ISODate } from '@/lib/engine/dates';
import type { Viewer } from './profile';
import { storeUpload } from './files';
import { storage, type Bucket } from './storage';
import { allow } from './rate-limit';
import { track } from './analytics';

/**
 * Gym pics: photos a member posts into a gym group. Only that group's members can see them; the
 * poster can delete their own, owners and admins can remove any. Photos go through the same
 * pipeline as proof — the bytes decide the type, images are re-encoded (which strips EXIF / GPS) —
 * and are served through a membership-checked function, never a public URL.
 */

export interface GroupPic {
  id: string;
  userId: string;
  name: string;
  caption: string | null;
  on: ISODate;
  mine: boolean;
  canDelete: boolean;
  width: number | null;
  height: number | null;
}

const PAGE = 30;

export async function listPics(viewer: Viewer, groupId: string, before?: string | null): Promise<{ pics: GroupPic[]; next: string | null } | null> {
  if (!z.uuid().safeParse(groupId).success) return null;
  return asUser(viewer.userId, async (q) => {
    const [me] = await q.query<{ role: string }>(`select role from group_members where group_id = $1 and user_id = $2 and status = 'active'`, [groupId, viewer.userId]);
    if (!me) return null;
    const params: unknown[] = [groupId];
    let where = '';
    if (before && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(before)) {
      params.push(before);
      where = `and p.created_at < $2`;
    }
    params.push(PAGE + 1);
    const rows = await q.query<{ id: string; user_id: string; caption: string | null; taken_on: string; created_at: Date; display_name: string | null; width: number | null; height: number | null }>(
      `select p.id, p.user_id, p.caption, p.taken_on, p.created_at, m.display_name, f.width, f.height
         from group_pics p
         left join group_members m on m.group_id = p.group_id and m.user_id = p.user_id
         left join lateral public.group_pic_file(p.group_id, p.id) f on true
        where p.group_id = $1 ${where}
        order by p.created_at desc limit $${params.length}`,
      params,
    );
    const admin = me.role === 'owner' || me.role === 'admin';
    const pics = rows.slice(0, PAGE).map((r) => ({
      id: r.id, userId: r.user_id, name: r.display_name ?? 'Former member', caption: r.caption, on: r.taken_on,
      mine: r.user_id === viewer.userId, canDelete: r.user_id === viewer.userId || admin, width: r.width, height: r.height,
    }));
    return { pics, next: rows.length > PAGE ? new Date(rows[PAGE - 1].created_at).toISOString() : null };
  });
}

export async function postPic(viewer: Viewer, groupId: string, data: Buffer, captionRaw: string | null): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (!z.uuid().safeParse(groupId).success) return { ok: false, error: 'Invalid group.' };
  const caption = (captionRaw ?? '').trim().slice(0, 140) || null;
  if (!allow(`gympic:${viewer.userId}`, 20, 86_400_000)) return { ok: false, error: 'That’s 20 pics today — save some for tomorrow.' };
  const [g] = await asUser(viewer.userId, (q) =>
    q.query<{ kind: string; archived_at: Date | null }>(
      `select g.kind, g.archived_at from groups g join group_members m on m.group_id = g.id where g.id = $1 and m.user_id = $2 and m.status = 'active'`,
      [groupId, viewer.userId],
    ),
  );
  if (!g || g.archived_at) return { ok: false, error: 'You’re not in this group.' };
  if (g.kind !== 'gym') return { ok: false, error: 'Gym pics live in gym groups.' };
  let cleanup: (() => Promise<void>) | null = null;
  try {
    const id = await asUser(viewer.userId, async (q) => {
      const stored = await storeUpload(q, viewer.userId, 'proofs', data, viewer.today);
      if (!stored.ok) throw Object.assign(new Error(/type isn’t supported/.test(stored.error) ? 'That isn’t a photo LevelUp can read — use a JPEG, PNG or WebP image.' : stored.error), { user: true });
      cleanup = stored.cleanup;
      if (stored.file.kind !== 'photo' && stored.file.kind !== 'screenshot') throw Object.assign(new Error('Gym pics are photos — use a JPEG, PNG or WebP image.'), { user: true });
      const [row] = await q.query<{ id: string }>(
        `insert into group_pics (group_id, file_id, caption, taken_on) values ($1, $2, $3, $4) returning id`,
        [groupId, stored.file.id, caption, viewer.today],
      );
      return row.id;
    });
    await asSystem((q) =>
      q.query(
        `insert into public.group_activity (group_id, user_id, kind, title, occurred_on, pic_id, source_key) values ($1, $2, 'pic', $3, $4, $5, $6)
         on conflict (group_id, source_key) do nothing`,
        [groupId, viewer.userId, caption ? `posted a gym pic: “${caption.slice(0, 60)}”` : 'posted a gym pic', viewer.today, id, `pic:${id}`],
      ),
    );
    void track(viewer.userId, 'gym_pic_posted', { caption: !!caption });
    return { ok: true, id };
  } catch (e) {
    if (cleanup) await (cleanup as () => Promise<void>)();
    if ((e as { user?: boolean }).user) return { ok: false, error: (e as Error).message };
    throw e;
  }
}

export async function deletePic(viewer: Viewer, groupId: string, picId: string) {
  if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(picId).success) return { ok: false as const, error: 'Invalid pic.' };
  const rows = await asUser(viewer.userId, (q) =>
    q.query<{ file_id: string; user_id: string }>(`delete from group_pics where id = $1 and group_id = $2 returning file_id, user_id`, [picId, groupId]),
  );
  if (!rows.length) return { ok: false as const, error: 'You can only delete your own pics.' };
  // the photo file belongs to the poster; remove it with the pic (an admin may be the one deleting)
  const [f] = await asSystem((q) =>
    q.query<{ bucket: Bucket; object_path: string; thumb_path: string | null }>(
      `delete from public.files where id = $1 and user_id = $2 returning bucket, object_path, thumb_path`,
      [rows[0].file_id, rows[0].user_id],
    ),
  );
  if (f) await storage().remove(f.bucket, [f.object_path, ...(f.thumb_path ? [f.thumb_path] : [])]).catch(() => {});
  return { ok: true as const };
}

export async function picFile(viewer: Viewer, groupId: string, picId: string) {
  if (!z.uuid().safeParse(groupId).success || !z.uuid().safeParse(picId).success) return null;
  const [row] = await asUser(viewer.userId, (q) =>
    q.query<{ bucket: Bucket; object_path: string; thumb_path: string | null; mime_type: string }>(
      `select bucket, object_path, thumb_path, mime_type from group_pic_file($1, $2)`,
      [groupId, picId],
    ),
  );
  return row ?? null;
}
