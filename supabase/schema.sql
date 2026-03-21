create table if not exists public.waitlist_signups (
  id bigint generated always as identity primary key,
  email text not null unique,
  priority_tier text not null default 'waitlist'
    check (priority_tier in ('founding', 'priority', 'waitlist')),
  signup_source text not null default 'dropamyn-landing',
  joined_from text not null default 'vercel',
  user_agent text,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

create policy "service role manages waitlist signups"
  on public.waitlist_signups
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ─── Verification codes for email verification ───
create table if not exists public.verification_codes (
  id bigint generated always as identity primary key,
  email text not null,
  code text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default timezone('utc'::text, now())
);

create index if not exists verification_codes_email_idx
  on public.verification_codes (email);

alter table public.verification_codes enable row level security;

create policy "service role manages verification codes"
  on public.verification_codes
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
