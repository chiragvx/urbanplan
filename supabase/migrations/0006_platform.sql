-- The dashboard (/dashboard/): what a professional platform keeps besides the projects themselves.
--  * projects: a small summary for the project cards (plot, homes, money, a thumbnail's geometry), a star, an archive,
--    a folder, and when it was last opened.
--  * folders: the user's own groups of projects.
--  * profiles: preferences (units, currency, default authority, theme), notification choices, an avatar, a phone,
--    a job title, where they work; and when they last signed in.
--  * avatars: a public bucket of profile pictures, a folder per user.
--  * activity: a feed per user of what happened on their projects (saved, shared, commented, joined).
--  * delete_my_account(): the signed-in user's own account, projects and files gone, from the browser.
-- Everything is optional for the app: the dashboard reads what's there and works without these (it says so).
-- Run once in the Supabase SQL editor, after 0005_project_invites.sql.

-- ---------------- projects ----------------
alter table public.projects add column if not exists summary jsonb;           -- written by the app on save: see src/dash/summary.ts
alter table public.projects add column if not exists starred boolean not null default false;
alter table public.projects add column if not exists archived_at timestamptz;
alter table public.projects add column if not exists folder uuid;
alter table public.projects add column if not exists opened_at timestamptz;
create index if not exists projects_owner_folder on public.projects (owner, folder);
-- "updated" means the work changed: opening, starring, filing or the card's summary leave it alone
create or replace function public.touch_project() returns trigger language plpgsql as $$
begin
  if (new.name, new.revision, new.edits, new.bytes, new.visibility) is distinct from (old.name, old.revision, old.edits, old.bytes, old.visibility)
  then new.updated_at = now(); else new.updated_at = old.updated_at; end if;
  return new;
end;
$$;
drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects for each row execute function public.touch_project();

-- ---------------- folders ----------------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  created_at timestamptz not null default now()
);
create index if not exists folders_owner on public.folders (owner, name);
alter table public.folders enable row level security;
create policy "folders: own" on public.folders for all using (auth.uid() = owner) with check (auth.uid() = owner);

do $$ begin
  alter table public.projects add constraint projects_folder_fk foreign key (folder) references public.folders (id) on delete set null;
exception when duplicate_object then null; end $$;

-- ---------------- profiles ----------------
alter table public.profiles add column if not exists avatar_url text;
alter table public.profiles add column if not exists title text check (char_length(title) <= 80);
alter table public.profiles add column if not exists phone text check (char_length(phone) <= 32);
alter table public.profiles add column if not exists city text check (char_length(city) <= 80);
alter table public.profiles add column if not exists country text check (char_length(country) <= 80);
-- { units: 'metric'|'imperial', area: 'm2'|'sqft', currency: 'INR'|'USD'|…, authority: 'pune'|…, theme: 'system'|'light'|'dark', start: 'site'|… }
alter table public.profiles add column if not exists prefs jsonb not null default '{}'::jsonb;
-- { comments: true, invites: true, digest: 'weekly'|'off', product: false }
alter table public.profiles add column if not exists notify jsonb not null default '{"comments": true, "invites": true, "digest": "weekly", "product": false}'::jsonb;
alter table public.profiles add column if not exists last_seen_at timestamptz;
-- (the browser may change these too; the plan stays ours)
grant update (avatar_url, title, phone, city, country, prefs, notify, last_seen_at) on public.profiles to authenticated;

-- ---------------- avatars ----------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 2097152, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do nothing;
create policy "avatars: read all" on storage.objects for select using (bucket_id = 'avatars');
create policy "avatars: add own" on storage.objects for insert to authenticated with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: replace own" on storage.objects for update to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatars: delete own" on storage.objects for delete to authenticated using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

-- ---------------- activity ----------------
create table if not exists public.activity (
  id bigint generated always as identity primary key,
  project uuid references public.projects (id) on delete cascade,
  actor uuid default auth.uid() references auth.users (id) on delete set null,
  actor_name text check (char_length(actor_name) <= 80),
  kind text not null check (kind in ('created', 'saved', 'renamed', 'shared', 'joined', 'commented', 'version', 'exported', 'deleted')),
  detail text check (char_length(detail) <= 200),
  created_at timestamptz not null default now()
);
create index if not exists activity_project on public.activity (project, created_at desc);
alter table public.activity enable row level security;
-- anyone on the project reads its feed (project_role from 0004); you write only as yourself
create policy "activity: read on my projects" on public.activity for select using (project is null and actor = auth.uid() or public.project_role(project) is not null);
create policy "activity: add as me" on public.activity for insert with check (actor = auth.uid() and (project is null or public.project_role(project) is not null));

-- the feed fills itself for the big moments, so it doesn't depend on every client remembering to log
create or replace function public.log_project_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'projects' and tg_op = 'INSERT' then
    insert into public.activity (project, actor, kind, detail) values (new.id, new.owner, 'created', new.name);
  elsif tg_table_name = 'projects' and tg_op = 'UPDATE' and new.name is distinct from old.name then
    insert into public.activity (project, actor, kind, detail) values (new.id, auth.uid(), 'renamed', new.name);
  elsif tg_table_name = 'project_members' and tg_op = 'INSERT' then
    insert into public.activity (project, actor, kind, detail) values (new.project, auth.uid(), 'shared', new.email || ' as ' || new.role);
  elsif tg_table_name = 'project_comments' and tg_op = 'INSERT' then
    insert into public.activity (project, actor, actor_name, kind, detail) values (new.project, new.author, new.author_name, 'commented', left(new.body, 200));
  end if;
  return new;
end;
$$;
drop trigger if exists projects_activity on public.projects;
create trigger projects_activity after insert or update of name on public.projects for each row execute function public.log_project_activity();
drop trigger if exists members_activity on public.project_members;
create trigger members_activity after insert on public.project_members for each row execute function public.log_project_activity();
drop trigger if exists comments_activity on public.project_comments;
create trigger comments_activity after insert on public.project_comments for each row execute function public.log_project_activity();

-- ---------------- the account itself ----------------
-- Deletes the caller's projects (rows; their files are removed by the app first, as Storage can't be cleared from SQL
-- under RLS), profile and sign-in. Security definer: a user can only ever delete themselves (auth.uid()).
create or replace function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not signed in'; end if;
  delete from public.projects where owner = me;
  delete from public.folders where owner = me;
  delete from public.profiles where id = me;
  delete from auth.users where id = me;
end;
$$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- storage used, for the plan page: the caller's projects' files and versions
create or replace function public.my_usage() returns table (projects bigint, bytes bigint, versions bigint)
language sql stable security definer set search_path = public as $$
  select (select count(*) from public.projects where owner = auth.uid()),
         coalesce((select sum(bytes) from public.projects where owner = auth.uid()), 0) + coalesce((select sum(bytes) from public.project_versions where owner = auth.uid()), 0),
         (select count(*) from public.project_versions where owner = auth.uid())
$$;
grant execute on function public.my_usage() to authenticated;
