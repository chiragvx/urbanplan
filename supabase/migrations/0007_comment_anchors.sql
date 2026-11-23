-- Comments where they belong (docs/plans/pro-global-ux.md §2.8): each comment can carry an anchor, what it's about:
--   { at: [x, y, z]  -- a point in the project's metres, where the pin stands
--     obj: { k: 'building' | 'element' | 'feature' | 'plot', id? }  -- the thing it was dropped on, if any
--     option: '<id>'  -- the option it was made on
--     reply: <comment id> }  -- a reply in that comment's thread
-- Comments without one (written before this, from the old Team dialog) keep their step and show in the list only.
-- Run once in the Supabase SQL editor, after 0006_platform.sql. Pro works without it: comments are then saved
-- without their pins, and it says so.
alter table public.project_comments add column if not exists anchor jsonb;
alter table public.project_comments drop constraint if exists project_comments_anchor_size;
alter table public.project_comments add constraint project_comments_anchor_size check (anchor is null or pg_column_size(anchor) <= 2000);
