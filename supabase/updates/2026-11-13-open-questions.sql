-- Adds the Open questions list on the Dashboard. Safe to run more than once.
-- Paste into Supabase → SQL Editor → Run.

-- Open questions: things the family is still trying to find out
-- ("Who was Kesar Mal's wife?"). Signed-in family can read and add them;
-- the admin marks them answered or removes them.
create table if not exists public.research_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(trim(question)) > 0),
  person_id uuid references public.people (id) on delete set null,
  next_step text,
  status text not null default 'open' check (status in ('open', 'answered', 'dropped')),
  answer text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_questions enable row level security;

drop policy if exists "family reads questions" on public.research_questions;
create policy "family reads questions" on public.research_questions for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));
drop policy if exists "family adds questions" on public.research_questions;
create policy "family adds questions" on public.research_questions for insert to authenticated
  with check (created_by = auth.uid() and status = 'open' and answer is null
              and exists (select 1 from public.profiles where id = auth.uid()));
drop policy if exists "admin manages questions" on public.research_questions;
create policy "admin manages questions" on public.research_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "author removes own open question" on public.research_questions;
create policy "author removes own open question" on public.research_questions for delete to authenticated
  using (created_by = auth.uid() and status = 'open');
