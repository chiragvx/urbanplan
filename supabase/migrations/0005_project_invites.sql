-- Invites for project teams (after 0004_project_team.sql). Run once in the Supabase SQL editor.
--  * joined_at: set the first time the person opens the project, signed in with that email (join_project), so the
--    owner sees who's still to come in.
--  * invited_at: when the invite email last went (written by /api/invite with the service key; it limits resends).

alter table public.project_members add column if not exists joined_at timestamptz;
alter table public.project_members add column if not exists invited_at timestamptz;

-- the signed-in person marks themselves joined on a project they were added to; nothing else can be changed this way
create or replace function public.join_project(pid uuid) returns void
language sql security definer set search_path = public as $$
  update public.project_members set joined_at = now()
  where project = pid and joined_at is null and email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;
revoke all on function public.join_project(uuid) from public, anon;
grant execute on function public.join_project(uuid) to authenticated;
