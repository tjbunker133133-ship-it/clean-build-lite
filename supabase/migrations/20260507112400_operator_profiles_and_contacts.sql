-- Backend-linked emergency contacts schema.
--
-- Purpose: provide read-only readiness/visibility hooks for the existing
-- HUD (PreflightPanel + DeadManPanel) without introducing auth yet.
-- Permissive RLS policies are used as a placeholder so the anon key can
-- read/write while we wire UI integration. Tighten when auth lands.

create extension if not exists pgcrypto;

create table if not exists operator_profiles (
  id uuid primary key default gen_random_uuid(),
  operator_name text not null,
  created_at timestamptz default now()
);

create table if not exists emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid references operator_profiles(id) on delete cascade,
  contact_name text not null,
  email text not null,
  relationship text,
  priority integer default 1,
  created_at timestamptz default now()
);

create index if not exists emergency_contacts_operator_idx
  on emergency_contacts (operator_id);
create index if not exists emergency_contacts_priority_idx
  on emergency_contacts (priority);

alter table operator_profiles enable row level security;
alter table emergency_contacts enable row level security;

drop policy if exists "operator_profiles_anon_all" on operator_profiles;
create policy "operator_profiles_anon_all"
  on operator_profiles
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists "emergency_contacts_anon_all" on emergency_contacts;
create policy "emergency_contacts_anon_all"
  on emergency_contacts
  for all
  to anon, authenticated
  using (true)
  with check (true);
