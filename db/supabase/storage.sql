-- SUPABASE ONLY. Private buckets for proof and receipts; locally the filesystem adapter
-- enforces the same rule (object path must start with the owner's user id).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('proofs',   'proofs',   false, 104857600, array['image/webp', 'image/jpeg', 'image/png', 'video/mp4', 'video/quicktime', 'video/webm', 'application/pdf']),
  ('receipts', 'receipts', false, 15728640,  array['image/webp', 'image/jpeg', 'image/png', 'application/pdf'])
on conflict (id) do nothing;

create policy "own objects: read" on storage.objects for select to authenticated
  using (bucket_id in ('proofs', 'receipts') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own objects: insert" on storage.objects for insert to authenticated
  with check (bucket_id in ('proofs', 'receipts') and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "own objects: delete" on storage.objects for delete to authenticated
  using (bucket_id in ('proofs', 'receipts') and (storage.foldername(name))[1] = (select auth.uid())::text);

-- No update policy: objects are immutable; a replacement is a new object + new files row.
