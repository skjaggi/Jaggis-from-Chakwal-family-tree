-- Undo 2026-11-14-removed-members.sql. Restore anyone listed first (Members
-- page → Removed → Restore), or their snapshot is lost with the table.
drop table if exists public.removed_members;
