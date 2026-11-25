-- Back to: only the admin edits Library links and album photos.
begin;
drop trigger if exists library_own_edit_guard on public.library_links;
drop function if exists public._library_own_edit_guard();
drop policy if exists "admin or the sender edits library links" on public.library_links;
drop policy if exists "admin edits library links" on public.library_links;
create policy "admin edits library links" on public.library_links for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
commit;
