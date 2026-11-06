-- 002: encrypted integration credentials (Stripe, Square) and webhook event log.
-- Run after 001.

-- One row per provider. secrets_enc is AES-256-GCM ciphertext written by server code;
-- public_meta holds non-secret values and the last 4 characters of each secret.
-- RLS is enabled with NO policies on purpose: only the service role (server) can read or write.
create table public.integration_credentials (
  provider text primary key check (provider in ('stripe', 'square')),
  public_meta jsonb not null default '{}'::jsonb,
  secrets_enc text,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
alter table public.integration_credentials enable row level security;

-- Raw webhook deliveries. Unique (provider, event_id) makes handlers idempotent.
create table public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('stripe', 'square')),
  event_id text not null,
  event_type text,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  error text,
  unique (provider, event_id)
);
create index webhook_events_received_idx on public.webhook_events (received_at desc);
alter table public.webhook_events enable row level security;

create policy webhook_events_owner_select on public.webhook_events
  for select using (public.current_staff_role() = 'owner');
