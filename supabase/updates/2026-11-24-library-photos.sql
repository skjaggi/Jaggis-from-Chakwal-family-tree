-- 24 Nov 2026: group photos in the family Library, with names on the faces.
-- Family tree database (jaggi-family-tree). Rollback: 2026-11-24-library-photos.rollback.sql
-- ---------------------------------------------------------------- group photos in the library
-- A group photo used on the Faces page can be kept in the Library's Family Album (24 Nov 2026).
-- It is a Library item of kind 'photo': the picture is in the private bucket
-- library-photos (folder = the item's id), and faces holds the tagged faces as
-- [{person_id, x, y, w, h}] with x, y, w, h as fractions of the picture, so a
-- name can show over each face. person_ids lists the same people, so the photo
-- also shows under "In the Library" on their cards. Photos are for signed-in
-- family members only, never public. Members' photos wait for approval like links.
alter table public.library_links add column if not exists kind text not null default 'link';
alter table public.library_links add column if not exists photo_path text;
alter table public.library_links add column if not exists faces jsonb not null default '[]'::jsonb;
alter table public.library_links alter column url drop not null;
-- The Family Album page for each photo: where and when it was taken (as the family
-- remembers it, e.g. "Delhi" and "December 2019"), and the name of who added it.
alter table public.library_links add column if not exists taken_where text check (taken_where is null or length(taken_where) <= 120);
alter table public.library_links add column if not exists taken_when text check (taken_when is null or length(taken_when) <= 60);
alter table public.library_links add column if not exists added_by_name text check (added_by_name is null or length(added_by_name) <= 120);
alter table public.library_links drop constraint if exists library_links_kind_ok;
alter table public.library_links add constraint library_links_kind_ok check (
  (kind = 'link' and url is not null and photo_path is null)
  or (kind = 'photo' and url is null and visibility = 'family'
      and photo_path = id::text || '/photo.jpg'
      and jsonb_typeof(faces) = 'array' and jsonb_array_length(faces) <= 100));

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('library-photos', 'library-photos', false, 10485760, array['image/jpeg'])
on conflict (id) do nothing;
-- The person who added the photo (or the admin) puts the picture in its folder.
drop policy if exists "add library photos" on storage.objects;
create policy "add library photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'library-photos' and exists (
    select 1 from public.library_links l where l.id::text = (storage.foldername(name))[1]
      and l.kind = 'photo' and (public.is_admin() or l.submitted_by = auth.uid())));
-- Family members see approved photos; the sender sees theirs while it waits; the admin sees all.
drop policy if exists "family sees library photos" on storage.objects;
create policy "family sees library photos" on storage.objects for select to authenticated
  using (bucket_id = 'library-photos' and exists (
    select 1 from public.library_links l where l.id::text = (storage.foldername(name))[1]
      and (public.is_admin() or l.submitted_by = auth.uid()
           or (l.status = 'approved' and exists (select 1 from public.profiles where id = auth.uid())))));
-- Removed with the Library item: by the admin, or by the sender while it waits.
drop policy if exists "remove library photos" on storage.objects;
create policy "remove library photos" on storage.objects for delete to authenticated
  using (bucket_id = 'library-photos' and (public.is_admin() or exists (
    select 1 from public.library_links l where l.id::text = (storage.foldername(name))[1]
      and l.submitted_by = auth.uid() and l.status = 'pending')));

