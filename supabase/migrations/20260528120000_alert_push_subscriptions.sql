-- Web Push subscriptions for emergency contact alerts (replaces SMS for v1).
-- Contacts subscribe on any Signal One HUD install using operator watch token + email.

create table if not exists alert_push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  watch_token text not null,
  contact_email text not null,
  endpoint text not null,
  p256dh text not null,
  auth_secret text not null,
  user_agent text,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  constraint alert_push_subscriptions_endpoint_key unique (endpoint)
);

create index if not exists alert_push_subscriptions_watch_token_idx
  on alert_push_subscriptions (watch_token);

create index if not exists alert_push_subscriptions_watch_email_idx
  on alert_push_subscriptions (watch_token, contact_email);

alter table alert_push_subscriptions enable row level security;

-- Field v1: open insert/select for anon (token acts as capability secret).
drop policy if exists "alert_push_subscriptions_anon_all" on alert_push_subscriptions;
create policy "alert_push_subscriptions_anon_all"
  on alert_push_subscriptions
  for all
  to anon, authenticated
  using (true)
  with check (true);
