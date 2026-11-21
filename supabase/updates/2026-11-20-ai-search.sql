-- Pilot AI helper (admins only): settings with a daily spending limit, a log of
-- every AI call and its cost, and research findings waiting for review.
-- Undo with 2026-11-20-ai-search.rollback.sql.

-- ---------------------------------------------------------------- AI helper (pilot)
-- "Ask the family tree" and "Find more about this person" (#/ai). Admins
-- only while it is being tested. The AI itself runs in the edge functions
-- ask-tree and research-person, which hold the Claude API key; the browser
-- never sees it. Nothing the AI finds changes the tree: findings wait here
-- until an admin uses them (through the usual edit form) or declines them.

-- One row of settings: the daily spending limit and which Claude model to use.
create table if not exists public.ai_settings (
  id int primary key default 1 check (id = 1),
  daily_cap_usd numeric(8, 2) not null default 2.00 check (daily_cap_usd between 0 and 100),
  model text not null default 'claude-opus-5-5'
    check (model in ('claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5')),
  updated_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_at timestamptz not null default now()
);
insert into public.ai_settings (id) values (1) on conflict (id) do nothing;

create or replace function public._ai_settings_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.id := 1;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists ai_settings_stamp on public.ai_settings;
create trigger ai_settings_stamp before update on public.ai_settings
  for each row execute function public._ai_settings_stamp();

alter table public.ai_settings enable row level security;
revoke all on public.ai_settings from anon;
grant select, update on public.ai_settings to authenticated;
drop policy if exists "admin reads ai settings" on public.ai_settings;
create policy "admin reads ai settings" on public.ai_settings for select to authenticated
  using (public.is_admin());
drop policy if exists "admin changes ai settings" on public.ai_settings;
create policy "admin changes ai settings" on public.ai_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Every AI call and what it cost (written by the edge functions only), so
-- the daily limit can be kept and the admin can see the spending.
create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('ask', 'research')),
  person_id uuid references public.people (id) on delete set null,
  model text,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cache_read_tokens int not null default 0,
  cache_write_tokens int not null default 0,
  web_searches int not null default 0,
  cost_usd numeric(10, 4) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists ai_usage_created_idx on public.ai_usage (created_at);
alter table public.ai_usage enable row level security;
revoke all on public.ai_usage from anon;
revoke insert, update, delete on public.ai_usage from authenticated;
grant select on public.ai_usage to authenticated;
drop policy if exists "admin reads ai usage" on public.ai_usage;
create policy "admin reads ai usage" on public.ai_usage for select to authenticated
  using (public.is_admin());

-- What a web search found about a person who has passed away. `request` is
-- exactly what was sent out for the search (so the admin can check that no
-- living person's details left the site); `result` holds the summary,
-- confidence, source links and suggested details.
create table if not exists public.ai_findings (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people (id) on delete cascade,
  status text not null default 'running'
    check (status in ('running', 'pending', 'used', 'declined', 'failed')),
  request jsonb not null default '{}'::jsonb,
  result jsonb,
  error text,
  cost_usd numeric(10, 4) not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000)
);
create index if not exists ai_findings_person_idx on public.ai_findings (person_id, created_at desc);

-- Who used or declined a finding, and when, is filled in by the database.
create or replace function public._ai_findings_review_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status is distinct from old.status and new.status in ('used', 'declined') then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists ai_findings_review_stamp on public.ai_findings;
create trigger ai_findings_review_stamp before update on public.ai_findings
  for each row execute function public._ai_findings_review_stamp();

alter table public.ai_findings enable row level security;
revoke all on public.ai_findings from anon;
revoke insert on public.ai_findings from authenticated;
grant select, update, delete on public.ai_findings to authenticated;
drop policy if exists "admin reads ai findings" on public.ai_findings;
create policy "admin reads ai findings" on public.ai_findings for select to authenticated
  using (public.is_admin());
drop policy if exists "admin reviews ai findings" on public.ai_findings;
create policy "admin reviews ai findings" on public.ai_findings for update to authenticated
  using (public.is_admin()) with check (public.is_admin() and status in ('pending', 'used', 'declined'));
drop policy if exists "admin removes ai findings" on public.ai_findings;
create policy "admin removes ai findings" on public.ai_findings for delete to authenticated
  using (public.is_admin());
