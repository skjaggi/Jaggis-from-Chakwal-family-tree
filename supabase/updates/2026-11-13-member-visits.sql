-- Records which pages and people signed-in family members open, so the
-- admin can see who visits and what they look at (Dashboard → Visits).
-- Only the admin can read it. Members can add only their own visits.
-- Rows older than 400 days are cleared automatically when new ones arrive.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

create table if not exists public.page_views (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  viewed_at timestamptz not null default now(),
  view text not null check (length(view) <= 40),       -- tree, outline, dashboard, help…
  person_id uuid references public.people (id) on delete set null
);
create index if not exists page_views_user_idx on public.page_views (user_id, viewed_at desc);
create index if not exists page_views_time_idx on public.page_views (viewed_at desc);

alter table public.page_views enable row level security;

drop policy if exists "members add own views" on public.page_views;
create policy "members add own views" on public.page_views for insert to authenticated
  with check (user_id = auth.uid());
drop policy if exists "admin reads views" on public.page_views;
create policy "admin reads views" on public.page_views for select to authenticated
  using (public.is_admin());
drop policy if exists "admin clears views" on public.page_views;
create policy "admin clears views" on public.page_views for delete to authenticated
  using (public.is_admin());

grant insert on public.page_views to authenticated;
grant select, delete on public.page_views to authenticated;

-- Keep the table small: drop rows older than 400 days now and then.
create or replace function public._trim_page_views() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if random() < 0.01 then
    delete from public.page_views where viewed_at < now() - interval '400 days';
  end if;
  return null;
end $$;
drop trigger if exists trim_page_views on public.page_views;
create trigger trim_page_views after insert on public.page_views
  for each statement execute function public._trim_page_views();
