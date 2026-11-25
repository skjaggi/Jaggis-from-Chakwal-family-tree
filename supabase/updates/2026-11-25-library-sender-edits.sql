-- Album photos can be edited by the admin AND by the family member who added
-- them (Sunil, 25 Nov 2026): title, topic, words, where and when, and the names
-- on the faces. Approving, declining and everything else stays with the admin.
-- Jaggi family tree database (jaggi-family-tree). Undo: 2026-11-25-library-sender-edits.rollback.sql
begin;
-- The admin edits any link or photo. The family member who added a photo to the
-- Family Album may also edit it (Sunil, 25 Nov 2026): its title, topic, words,
-- where and when, and the names on its faces. Only the admin approves, declines
-- or changes anything else (checked by _library_own_edit_guard below).
drop policy if exists "admin edits library links" on public.library_links;
drop policy if exists "admin or the sender edits library links" on public.library_links;
create policy "admin or the sender edits library links" on public.library_links for update to authenticated
  using (public.is_admin() or (kind = 'photo' and submitted_by = auth.uid() and exists (select 1 from public.profiles where id = auth.uid())))
  with check (public.is_admin() or (kind = 'photo' and submitted_by = auth.uid()));
create or replace function public._library_own_edit_guard() returns trigger
language plpgsql set search_path = public as $$
declare
  mine constant text[] := array['title', 'topic', 'note', 'taken_where', 'taken_when', 'faces', 'person_ids'];
begin
  -- The admin, and our own functions (which don't run as a signed-in member), change anything.
  if current_user <> 'authenticated' or public.is_admin() then return new; end if;
  if (to_jsonb(new) - mine) is distinct from (to_jsonb(old) - mine) then
    raise exception 'Only the admin can change that.' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists library_own_edit_guard on public.library_links;
create trigger library_own_edit_guard before update on public.library_links
  for each row execute function public._library_own_edit_guard();
commit;

-- Check: should list one row, "admin or the sender edits library links".
select policyname from pg_policies where tablename = 'library_links' and cmd = 'UPDATE';
