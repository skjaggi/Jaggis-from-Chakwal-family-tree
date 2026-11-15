-- Undo 2026-11-15-blessings.sql. Removes the admin adjustments too, so back
-- them up first if any were made:
--   select * from public.blessing_adjustments;
drop function if exists public.blessings_ledger();
drop function if exists public._detail_blessings(jsonb);
drop table if exists public.blessing_adjustments;
