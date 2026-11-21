-- Undo 2026-11-21-book-share-links.sql: every shared book link stops working.
-- The books themselves (book_drafts, book-photos) are not touched. Empty the
-- "book-shared" bucket in Storage first if it has photos, then run this.
drop policy if exists "admin manages shared book photos" on storage.objects;
delete from storage.buckets where id = 'book-shared';
drop function if exists public.shared_book(uuid);
drop table if exists public.book_shares;
