-- DP reports downloaded from /pune/dp-report/: who downloaded which spot, so we know which plots and areas people
-- check (and can follow up with those who did). Free; the download asks for an email sign-in first.
-- Run once in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.dp_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  email text,
  lat double precision not null,
  lon double precision not null,
  area text,                -- the locality page it came from, if any
  cls text,                 -- the DP land use at the point (traced), if any
  created_at timestamptz not null default now()
);

create index if not exists dp_reports_user on public.dp_reports (user_id, created_at desc);

alter table public.dp_reports enable row level security;

create policy "dp_reports: insert own" on public.dp_reports
  for insert with check (auth.uid() = user_id);

create policy "dp_reports: read own" on public.dp_reports
  for select using (auth.uid() = user_id);
