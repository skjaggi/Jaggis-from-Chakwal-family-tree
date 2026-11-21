-- AI helper: a separate Claude model for web research, and both models
-- default to Claude Haiku 5.5 (Sunil, Nov 20 2026). Rollback:
-- 2026-11-21-ai-research-model.rollback.sql
alter table public.ai_settings
  add column if not exists research_model text not null default 'claude-haiku-5-5';
alter table public.ai_settings drop constraint if exists ai_settings_research_model_check;
alter table public.ai_settings add constraint ai_settings_research_model_check
  check (research_model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'));
alter table public.ai_settings alter column model set default 'claude-haiku-5-5';
update public.ai_settings set model = 'claude-haiku-5-5', research_model = 'claude-haiku-5-5' where id = 1;
