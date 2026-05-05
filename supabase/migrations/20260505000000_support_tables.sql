create extension if not exists pgcrypto;

create table if not exists public.consultants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  lid_jid text,
  role text not null default 'general',
  active boolean not null default true,
  is_internal_user boolean not null default true,
  receive_sales boolean not null default true,
  receive_support boolean not null default true,
  priority integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lid_phone_map (
  id uuid primary key default gen_random_uuid(),
  lid_jid text not null unique,
  phone text not null,
  source text not null default 'unknown',
  confidence numeric not null default 0.8,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.faq_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text,
  keywords text[] not null default '{}',
  answer text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.lead_tags (
  id uuid primary key default gen_random_uuid(),
  lead_key text not null,
  tag text not null,
  created_by text,
  created_at timestamptz not null default now()
);

create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  lead_key text not null,
  consultant_phone text,
  reminder_text text not null,
  due_at timestamptz,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.events (
  id uuid primary key default gen_random_uuid(),
  lead_key text,
  event_type text not null,
  payload_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_consultants_phone on public.consultants (phone);
create index if not exists idx_consultants_lid_jid on public.consultants (lid_jid);
create index if not exists idx_lid_phone_map_phone on public.lid_phone_map (phone);
create index if not exists idx_faq_items_active on public.faq_items (active);
create index if not exists idx_lead_tags_lead_key on public.lead_tags (lead_key);
create index if not exists idx_reminders_open on public.reminders (done, due_at);
create index if not exists idx_events_lead_key on public.events (lead_key);
create index if not exists idx_events_type_created on public.events (event_type, created_at desc);

alter table public.consultants enable row level security;
alter table public.lid_phone_map enable row level security;
alter table public.faq_items enable row level security;
alter table public.lead_tags enable row level security;
alter table public.reminders enable row level security;
alter table public.events enable row level security;
