-- 008: Stage 1 intake on leads. Run after 001 to 007.
-- Restoration leads pick one of three types and carry a triage priority. Everything else the office
-- asks on the first call (loss details, safety, insurance, access, carpet condition, timing) is kept
-- as one JSON document so the question lists can change without another migration.
-- Contact, address, gate code, warnings, PO number, loss summary and notes keep their own columns.

alter table public.leads
  add column restoration_type text
    check (restoration_type in ('extraction', 'mitigation', 'remediation')),
  add column priority text
    check (priority in ('emergency', 'urgent', 'standard')),
  add column intake jsonb not null default '{}'::jsonb;

create index leads_priority_idx on public.leads (priority) where status in ('new', 'quoted');
