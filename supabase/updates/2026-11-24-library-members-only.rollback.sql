-- Undo 2026-11-24-library-members-only.sql: visitors see approved links marked
-- "Everyone" again. No data was changed by the update.
begin;
drop policy if exists "anyone reads public library links" on public.library_links;
create policy "anyone reads public library links" on public.library_links for select to anon, authenticated
  using (status = 'approved' and visibility = 'public');
commit;
