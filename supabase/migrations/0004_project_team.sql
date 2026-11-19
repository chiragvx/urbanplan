-- Teams and comments on projects (Pro first; the editor's maps can use the same tables).
--  * project_members: people the owner adds by email, as an editor (opens and saves the project) or a viewer (opens
--    it and comments). Matched on the signed-in user's email, so an invite works before the person has an account.
--  * project_comments: a thread per project, each comment tagged with the step it was written on, resolvable.
-- Who may do what is one function, project_role(project): 'owner', 'editor', 'viewer' or null.
-- Run once in the Supabase SQL editor, after 0002_projects.sql.

create table if not exists public.project_members (
  project uuid not null references public.projects (id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'editor' check (role in ('editor', 'viewer')),
  added_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (project, email)
);
create index if not exists project_members_email on public.project_members (email);

create table if not exists public.project_comments (
  id bigint generated always as identity primary key,
  project uuid not null references public.projects (id) on delete cascade,
  author uuid not null default auth.uid() references auth.users (id) on delete cascade,
  author_name text check (char_length(author_name) <= 80),
  body text not null check (char_length(body) between 1 and 2000),
  step text check (char_length(step) <= 24),        -- where it was written: site, build, design, money, approve, explore
  resolved boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists project_comments_project on public.project_comments (project, created_at);

-- the caller's role on a project (security definer: the policies below can't recurse through RLS)
create or replace function public.project_role(pid uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.projects p where p.id = pid and p.owner = auth.uid()) then 'owner'
    else (select m.role from public.project_members m
          where m.project = pid and m.email = lower(coalesce(auth.jwt() ->> 'email', '')) limit 1)
  end
$$;
-- the same for a file in the projects bucket (<owner>/<project>/…): only when the folders are really that project and
-- its owner, null for anything else
create or replace function public.project_file_role(path text) returns text
language sql stable security definer set search_path = public as $$
  select case when split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    and exists (select 1 from public.projects p where p.id = split_part(path, '/', 2)::uuid and p.owner::text = split_part(path, '/', 1))
    then public.project_role(split_part(path, '/', 2)::uuid) end
$$;
grant execute on function public.project_role(uuid) to authenticated;
grant execute on function public.project_file_role(text) to authenticated;

alter table public.project_members enable row level security;
alter table public.project_comments enable row level security;

-- projects: members read; editors save (the revision, name and size: never the owner, see the trigger)
drop policy if exists "projects: read as member" on public.projects;
create policy "projects: read as member" on public.projects
  for select using (public.project_role(id) in ('editor', 'viewer'));
drop policy if exists "projects: update as editor" on public.projects;
create policy "projects: update as editor" on public.projects
  for update using (public.project_role(id) = 'editor') with check (public.project_role(id) = 'editor');

create or replace function public.projects_keep_owner() returns trigger language plpgsql as $$
begin
  if new.owner <> old.owner then raise exception 'A project''s owner can''t be changed'; end if;
  if new.visibility <> old.visibility and old.owner <> auth.uid() then raise exception 'Only the owner can change who sees a project'; end if;
  return new;
end $$;
drop trigger if exists projects_keep_owner on public.projects;
create trigger projects_keep_owner before update on public.projects
  for each row execute function public.projects_keep_owner();

-- members: everyone on the project sees the list; the owner adds and removes; anyone may leave
drop policy if exists "members: read" on public.project_members;
create policy "members: read" on public.project_members
  for select using (public.project_role(project) is not null);
drop policy if exists "members: add" on public.project_members;
create policy "members: add" on public.project_members
  for insert with check (public.project_role(project) = 'owner');
drop policy if exists "members: change" on public.project_members;
create policy "members: change" on public.project_members
  for update using (public.project_role(project) = 'owner') with check (public.project_role(project) = 'owner');
drop policy if exists "members: remove or leave" on public.project_members;
create policy "members: remove or leave" on public.project_members
  for delete using (public.project_role(project) = 'owner' or email = lower(coalesce(auth.jwt() ->> 'email', '')));

-- comments: everyone on the project reads and writes; the author or the owner / an editor resolves; the author or
-- the owner deletes
drop policy if exists "comments: read" on public.project_comments;
create policy "comments: read" on public.project_comments
  for select using (public.project_role(project) is not null);
drop policy if exists "comments: write" on public.project_comments;
create policy "comments: write" on public.project_comments
  for insert with check (author = auth.uid() and public.project_role(project) is not null);
drop policy if exists "comments: resolve" on public.project_comments;
create policy "comments: resolve" on public.project_comments
  for update using (author = auth.uid() or public.project_role(project) in ('owner', 'editor'))
  with check (author = auth.uid() or public.project_role(project) in ('owner', 'editor'));
drop policy if exists "comments: delete" on public.project_comments;
create policy "comments: delete" on public.project_comments
  for delete using (author = auth.uid() or public.project_role(project) = 'owner');

-- the files: members read the project's file; editors replace its current file (not its versions)
drop policy if exists "project files: read as member" on storage.objects;
create policy "project files: read as member" on storage.objects
  for select to authenticated using (bucket_id = 'projects' and public.project_file_role(name) is not null);
drop policy if exists "project files: save as editor" on storage.objects;
create policy "project files: save as editor" on storage.objects
  for insert to authenticated with check (bucket_id = 'projects' and name like '%/current.json.gz'
    and public.project_file_role(name) = 'editor');
drop policy if exists "project files: replace as editor" on storage.objects;
create policy "project files: replace as editor" on storage.objects
  for update to authenticated using (bucket_id = 'projects' and name like '%/current.json.gz'
    and public.project_file_role(name) = 'editor');
