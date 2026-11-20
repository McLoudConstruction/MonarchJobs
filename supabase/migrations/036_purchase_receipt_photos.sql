-- Receipt photos on purchases (Priority 2). Run after 035. Safe to run twice.
-- A purchase may carry one kept receipt picture. Owner only, like the purchases themselves (migration 021).
-- Files live in the private `purchase-receipts` bucket as {job_id}/{uuid}.jpg. Nothing is ever overwritten or deleted.

alter table public.job_purchases add column if not exists receipt_path text;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('purchase-receipts', 'purchase-receipts', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists purchase_receipt_files_select on storage.objects;
drop policy if exists purchase_receipt_files_insert on storage.objects;
create policy purchase_receipt_files_select on storage.objects for select
  using (bucket_id = 'purchase-receipts' and public.is_owner());
create policy purchase_receipt_files_insert on storage.objects for insert
  with check (bucket_id = 'purchase-receipts' and public.is_owner()
              and split_part(name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$');
