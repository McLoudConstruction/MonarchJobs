-- 022: "Customer not present" on the before and after inspections.
-- A tech can lock an inspection record without a signature when the customer is not there. The record is
-- locked exactly like a signed one (signed_at is set by the database), and customer_absent says why there
-- is no signature. Run once in the Supabase SQL Editor.

alter table public.job_inspections add column if not exists customer_absent boolean not null default false;

create or replace function public.job_inspection_guard()
returns trigger language plpgsql as $$
begin
  if old.signed_at is not null then
    raise exception 'INSPECTION_SIGNED';
  end if;
  if new.customer_absent then
    -- locked with no signature and no signer
    new.signature_png := null;
    new.signer_name := null;
    new.signed_at := now();
  elsif new.signature_png is not null then
    if btrim(coalesce(new.signer_name, '')) = '' then raise exception 'INSPECTION_NEEDS_NAME'; end if;
    new.signed_at := now();
  else
    new.signed_at := null;
  end if;
  return new;
end;
$$;
