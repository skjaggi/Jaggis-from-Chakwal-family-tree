-- Sharing a family book by link (read-only). When an admin presses "Share"
-- in the book maker, the site saves a finished copy of every page (as the
-- admin sees them) under a new secret link, #/book?view=<token>. Anyone who
-- has that link can turn the pages, signed in or not; nobody can change it.
-- There is no way to list shared books: a copy can only be opened with its
-- exact token. "Stop sharing" deletes the copy and its photos, so the link
-- stops working. Adds one table, one function and one photo bucket; changes
-- no existing data. Safe to run more than once.
-- Undo: 2026-11-21-book-share-links.rollback.sql

create table if not exists public.book_shares (
  token uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.book_drafts(id) on delete cascade,
  title text not null,
  snapshot jsonb not null,           -- { settings, pages: [html, ...] }
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists book_shares_book on public.book_shares (book_id);
alter table public.book_shares enable row level security;
revoke all on public.book_shares from anon;
grant select, insert, update, delete on public.book_shares to authenticated;
drop policy if exists "admin manages book shares" on public.book_shares;
create policy "admin manages book shares" on public.book_shares for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Opening a shared copy by its token: the only way in for everyone else.
create or replace function public.shared_book(t uuid)
returns table (title text, snapshot jsonb, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select s.title, s.snapshot, s.updated_at from public.book_shares s where s.token = t;
$$;
revoke all on function public.shared_book(uuid) from public;
grant execute on function public.shared_book(uuid) to anon, authenticated;

-- Photos in a shared copy (stored as <token>/<file>). The bucket serves a
-- photo to anyone with its exact address, which only the copy holds; only
-- admins can add, list or delete them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('book-shared', 'book-shared', true, 15728640, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
drop policy if exists "admin manages shared book photos" on storage.objects;
create policy "admin manages shared book photos" on storage.objects for all to authenticated
  using (bucket_id = 'book-shared' and public.is_admin())
  with check (bucket_id = 'book-shared' and public.is_admin());
