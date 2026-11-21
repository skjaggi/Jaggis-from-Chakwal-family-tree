-- Undo 2026-11-20-ai-search.sql: removes the AI helper's settings, its cost
-- log and every research finding. Nothing in the family tree itself changes.
-- To keep a copy of the findings first:
--   select * from public.ai_findings;
drop table if exists public.ai_findings;
drop function if exists public._ai_findings_review_stamp();
drop table if exists public.ai_usage;
drop table if exists public.ai_settings;
drop function if exists public._ai_settings_stamp();
