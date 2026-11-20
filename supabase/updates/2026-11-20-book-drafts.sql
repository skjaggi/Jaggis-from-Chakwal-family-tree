-- Family book maker: one new table for book drafts (admins only) and a
-- private storage bucket for photos uploaded for a book. Changes no
-- existing data. Safe to run more than once.
-- Undo: 2026-11-20-book-drafts.rollback.sql

-- Books made with the family book maker (#/book). Admins only while it is
-- being tested. A draft holds the book's settings (design, size, where it
-- starts) and the admin's changes on top of the tree (text, photos, added,
-- moved and hidden pages) as one JSON document. The tree itself is never
-- changed by a book.
create table if not exists public.book_drafts (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) between 1 and 200),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) <= 2000000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Who last changed a book, and when, is filled in by the database.
create or replace function public._book_drafts_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists book_drafts_stamp on public.book_drafts;
create trigger book_drafts_stamp before insert or update on public.book_drafts
  for each row execute function public._book_drafts_stamp();

alter table public.book_drafts enable row level security;
revoke all on public.book_drafts from anon;
grant select, insert, update, delete on public.book_drafts to authenticated;
drop policy if exists "admin manages book drafts" on public.book_drafts;
create policy "admin manages book drafts" on public.book_drafts for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Photos uploaded for a book (large print scans, up to 15 MB). Private: only
-- admins can see or add them, and they never show on the website.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('book-photos', 'book-photos', false, 15728640, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "admin manages book photos" on storage.objects;
create policy "admin manages book photos" on storage.objects for all to authenticated
  using (bucket_id = 'book-photos' and public.is_admin())
  with check (bucket_id = 'book-photos' and public.is_admin());
