-- The Library (links and the Family Album) is for signed-in family members only
-- (Sunil, 24 Nov 2026). Visitors no longer see links marked "Everyone".
-- Undo: 2026-11-24-library-members-only.rollback.sql
begin;
drop policy if exists "anyone reads public library links" on public.library_links;
commit;
