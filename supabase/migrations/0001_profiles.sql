-- UrbanPlan accounts: a profile per user, created when they sign up, readable and editable only by them.
-- Run once in the Supabase SQL editor (or `supabase db push`).

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  organisation text,
  role text check (role in ('developer', 'architect', 'consultant', 'broker', 'buyer', 'civic', 'other')),
  interest text,                       -- the paid plan they asked about at sign-up (pro / firm), if any
  plan text not null default 'free',   -- set by us, not by the user (see the update policy below)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles: read own" on public.profiles
  for select using (auth.uid() = id);

create policy "profiles: insert own" on public.profiles
  for insert with check (auth.uid() = id and plan = 'free');

create policy "profiles: update own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- from the browser, users can change only their name, organisation and role: never their plan
revoke update on public.profiles from anon, authenticated;
grant update (id, full_name, organisation, role) on public.profiles to authenticated;

-- a profile for every new user, from what they gave at sign-up (email form or Google)
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, role, interest)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    case when new.raw_user_meta_data ->> 'role' in ('developer', 'architect', 'consultant', 'broker', 'buyer', 'civic', 'other')
      then new.raw_user_meta_data ->> 'role' end,
    new.raw_user_meta_data ->> 'interest'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();
