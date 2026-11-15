-- Dashboard "Possible duplicates": pairs an admin has marked "Not a duplicate"
-- (two different real people with similar names), so they stop being listed.
-- Only adds a new table; no person data is changed. Safe to run more than once.
-- Undo: 2026-11-15-not-duplicates.rollback.sql
create table if not exists public.not_duplicates (
  person_a uuid not null references public.people (id) on delete cascade,
  person_b uuid not null references public.people (id) on delete cascade,
  marked_by uuid default auth.uid() references auth.users (id) on delete set null,
  marked_at timestamptz not null default now(),
  primary key (person_a, person_b),
  check (person_a < person_b)
);

alter table public.not_duplicates enable row level security;

drop policy if exists "family reads not-duplicates" on public.not_duplicates;
create policy "family reads not-duplicates" on public.not_duplicates for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));
drop policy if exists "admin manages not-duplicates" on public.not_duplicates;
create policy "admin manages not-duplicates" on public.not_duplicates for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
