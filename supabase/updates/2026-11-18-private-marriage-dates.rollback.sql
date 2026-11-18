-- Undo 2026-11-18-private-marriage-dates.sql: everyone can read every column
-- of marriages and parent links again.
grant select on public.unions to anon, authenticated;
grant select on public.parent_child to anon, authenticated;
drop function if exists public.union_details();
drop function if exists public.parent_link_details();
