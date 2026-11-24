-- Undo 2026-11-24-library-photos.sql. Removes every group photo from the Library
-- (the pictures in the library-photos bucket must be deleted first, in Storage).
delete from public.library_links where kind = 'photo';
drop policy if exists "add library photos" on storage.objects;
drop policy if exists "family sees library photos" on storage.objects;
drop policy if exists "remove library photos" on storage.objects;
alter table public.library_links drop constraint if exists library_links_kind_ok;
alter table public.library_links alter column url set not null;
alter table public.library_links drop column if exists faces;
alter table public.library_links drop column if exists taken_where;
alter table public.library_links drop column if exists taken_when;
alter table public.library_links drop column if exists added_by_name;
alter table public.library_links drop column if exists photo_path;
alter table public.library_links drop column if exists kind;
