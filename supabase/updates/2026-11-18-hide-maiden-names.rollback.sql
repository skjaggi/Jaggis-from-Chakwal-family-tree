-- Undo 2026-11-18-hide-maiden-names.sql: visitors can read every name column again.
grant select on public.people to anon;
drop function if exists public.public_names();
drop function if exists public._married_last_name(text, text, text);
