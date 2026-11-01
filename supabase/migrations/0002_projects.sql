-- UrbanPlan projects in the cloud: a row of facts per project (small, listable), the map itself as a gzipped file
-- in Storage (projects/<user id>/<project id>/current.json.gz) and its saved versions beside it (…/v/<time>.json.gz).
-- Rows stay tiny however big a map grows; old versions are thinned by the editor (all of today, one a day for a
-- month, one a week after, at most 50). Each user reads and writes only their own; public projects can be read by all.
-- Run once in the Supabase SQL editor, after 0001_profiles.sql.

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default 'Untitled map',
  region text not null default 'pune',          -- the city the map edits
  edits integer not null default 0,             -- how many objects it changes
  bytes integer not null default 0,             -- the saved file's size (gzipped)
  revision integer not null default 1,          -- +1 a save: a save that read an older revision is kept as a copy
  visibility text not null default 'private' check (visibility in ('private', 'link', 'public')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists projects_owner on public.projects (owner, updated_at desc);

create table if not exists public.project_versions (
  id bigint generated always as identity primary key,
  project uuid not null references public.projects (id) on delete cascade,
  owner uuid not null default auth.uid() references auth.users (id) on delete cascade,
  path text not null,                           -- the file in the projects bucket
  edits integer not null default 0,
  bytes integer not null default 0,
  label text,                                   -- a name the user gave it ("before the DP road"), or null
  created_at timestamptz not null default now()
);
create index if not exists project_versions_project on public.project_versions (project, created_at desc);

alter table public.projects enable row level security;
alter table public.project_versions enable row level security;

create policy "projects: read own or public" on public.projects
  for select using (auth.uid() = owner or visibility = 'public');
create policy "projects: insert own" on public.projects
  for insert with check (auth.uid() = owner);
create policy "projects: update own" on public.projects
  for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "projects: delete own" on public.projects
  for delete using (auth.uid() = owner);

create policy "versions: read own" on public.project_versions
  for select using (auth.uid() = owner);
create policy "versions: insert own" on public.project_versions
  for insert with check (auth.uid() = owner and exists (select 1 from public.projects p where p.id = project and p.owner = auth.uid()));
create policy "versions: update own" on public.project_versions
  for update using (auth.uid() = owner) with check (auth.uid() = owner);
create policy "versions: delete own" on public.project_versions
  for delete using (auth.uid() = owner);

drop trigger if exists projects_touch on public.projects;
create trigger projects_touch before update on public.projects
  for each row execute function public.touch_updated_at();   -- from 0001_profiles.sql

-- the files: a private bucket, a folder per user (20 MB a file at most)
insert into storage.buckets (id, name, public, file_size_limit)
values ('projects', 'projects', false, 20971520)
on conflict (id) do nothing;

create policy "project files: read own" on storage.objects
  for select to authenticated using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: add own" on storage.objects
  for insert to authenticated with check (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: replace own" on storage.objects
  for update to authenticated using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "project files: delete own" on storage.objects
  for delete to authenticated using (bucket_id = 'projects' and (storage.foldername(name))[1] = auth.uid()::text);
