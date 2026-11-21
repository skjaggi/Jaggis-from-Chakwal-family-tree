-- Undo 2026-11-21-ai-research-model.sql: one model for everything again
-- (back to the Nov 20 default, Claude Opus 5.5; the current choice is kept).
alter table public.ai_settings drop constraint if exists ai_settings_research_model_check;
alter table public.ai_settings drop column if exists research_model;
alter table public.ai_settings alter column model set default 'claude-opus-5-5';
