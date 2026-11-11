-- 009: priority names. Emergency stays; Urgent becomes Business Hours and Standard becomes Scheduled.
-- Run after 008.

alter table public.leads drop constraint if exists leads_priority_check;
update public.leads set priority = 'business_hours' where priority = 'urgent';
update public.leads set priority = 'scheduled' where priority = 'standard';
alter table public.leads add constraint leads_priority_check
  check (priority in ('emergency', 'business_hours', 'scheduled'));
