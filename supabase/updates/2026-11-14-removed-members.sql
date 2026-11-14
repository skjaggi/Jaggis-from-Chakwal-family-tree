-- Removing someone on the Members page now also blocks their login.
-- The admin-only edge function remove-member bans the Supabase login (it is
-- not deleted, so it can be restored and their earlier changes keep their
-- name), deletes the invite and frees any box they claimed. What it removed is
-- kept here so the admin can restore them from the Members page.
-- Undo: 2026-11-14-removed-members.rollback.sql
create table if not exists public.removed_members (
  email text primary key,
  user_id uuid,
  snapshot jsonb not null,          -- the invite and profile rows as they were
  removed_by uuid references auth.users (id) on delete set null,
  removed_at timestamptz not null default now()
);
alter table public.removed_members enable row level security;
drop policy if exists "admin reads removed members" on public.removed_members;
create policy "admin reads removed members" on public.removed_members for select to authenticated
  using (public.is_admin());
-- Writes happen only in the edge function (service role).
