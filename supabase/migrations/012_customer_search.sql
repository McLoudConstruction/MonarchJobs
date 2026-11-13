-- 012: find customers while the office is typing on the new-lead form.
-- Any of the three can be left blank. Name matches part of a person's name or a company name,
-- phone matches part of the number (any formatting), email matches part of the address.
-- Runs as the signed-in person, so the same customer access rules as everywhere else apply.
-- Run once, after 011.
create or replace function public.search_customers(p_name text, p_phone text, p_email text)
returns table (id uuid, display_name text, phone text, email text, customer_type text)
language sql stable as $$
  with q as (
    select
      nullif(btrim(coalesce(p_name, '')), '') as name,
      nullif(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), '') as digits,
      nullif(btrim(coalesce(p_email, '')), '') as email
  ),
  esc as (
    -- the typed text is a literal: % _ and \ must not act as wildcards
    select
      case when name is null then null else '%' || replace(replace(replace(lower(name), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as name_like,
      case when digits is null then null else '%' || digits || '%' end as digits_like,
      case when email is null then null else '%' || replace(replace(replace(lower(email), '\', '\\'), '%', '\%'), '_', '\_') || '%' end as email_like
    from q
  )
  select c.id, c.display_name, c.phone, c.email, c.customer_type
  from public.customers c, esc
  where not c.archived
    and (
      (esc.name_like is not null and length((select name from q)) >= 2 and (
        lower(c.display_name) like esc.name_like
        or lower(btrim(c.first_name || ' ' || c.last_name)) like esc.name_like
        or lower(c.company_name) like esc.name_like))
      or (esc.digits_like is not null and length((select digits from q)) >= 4
        and regexp_replace(c.phone, '\D', '', 'g') like esc.digits_like)
      or (esc.email_like is not null and length((select email from q)) >= 3
        and lower(c.email) like esc.email_like)
    )
  order by c.last_visit_at desc nulls last, c.display_name
  limit 6
$$;
