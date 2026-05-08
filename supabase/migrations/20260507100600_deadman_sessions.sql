-- Run in Supabase SQL Editor (or apply via migration).
-- Fixes typo from draft: use NOT NULL, not "NOT FALSE".

create table if not exists deadman_sessions (
  session_id text primary key,
  operator_name text not null,
  contacts jsonb not null,
  interval_ms integer not null default 120000,
  last_ping timestamptz not null default now(),
  expires_at timestamptz not null,
  location jsonb,
  escalated boolean not null default false,
  created_at timestamptz not null default now()
);
