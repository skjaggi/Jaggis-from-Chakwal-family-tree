-- Undo 2026-11-15-not-duplicates.sql: removes the "Not a duplicate" marks table.
-- The Dashboard keeps working; it simply lists those pairs again.
drop table if exists public.not_duplicates;
