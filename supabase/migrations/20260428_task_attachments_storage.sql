-- Create private storage bucket for task/bill attachments
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-attachments',
  'task-attachments',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "task_attachments_select_own" on storage.objects;
create policy "task_attachments_select_own"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'task-attachments'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "task_attachments_insert_own" on storage.objects;
create policy "task_attachments_insert_own"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'task-attachments'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "task_attachments_update_own" on storage.objects;
create policy "task_attachments_update_own"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'task-attachments'
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'task-attachments'
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "task_attachments_delete_own" on storage.objects;
create policy "task_attachments_delete_own"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'task-attachments'
  and split_part(name, '/', 1) = auth.uid()::text
);
