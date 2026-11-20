-- Undo 2026-11-20-book-drafts.sql: removes the family book drafts table and
-- the photo bucket's access rule. This deletes every saved book, so back them
-- up first if any were made:
--   select * from public.book_drafts;
-- Photos uploaded for books stay in the "book-photos" bucket until it is
-- emptied and deleted in the Supabase dashboard (Storage → book-photos →
-- Empty bucket, then Delete bucket); SQL can't remove stored files.
drop policy if exists "admin manages book photos" on storage.objects;
drop table if exists public.book_drafts;
drop function if exists public._book_drafts_stamp();
