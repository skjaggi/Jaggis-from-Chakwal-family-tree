-- Undo 2026-11-14-invite-signed-in-fix.sql: previous trigger functions and
-- the four accepted_at values as they were (from the backup).
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  inv public.invites;
begin
  select * into inv from public.invites where email = lower(new.email);
  if not found then
    raise exception 'This email address has not been invited to the family tree.';
  end if;
  insert into public.profiles (id, email, display_name, role, person_id)
  values (new.id, lower(new.email), coalesce(inv.display_name, split_part(new.email, '@', 1)), inv.role, inv.person_id)
  on conflict (id) do nothing;
  if new.invited_at is null or new.last_sign_in_at is not null then
    update public.invites set accepted_at = now() where email = inv.email;
  end if;
  return new;
end $$;

create or replace function public.handle_user_signed_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  return new;
end $$;

update public.invites set accepted_at = '2026-11-13 04:16:27.635406+00' where email = 'hkjaggi@hotmail.com' and accepted_at is null;
update public.invites set accepted_at = '2026-11-14 01:31:03.743302+00' where email = 'rickjaggi@gmail.com' and accepted_at is null;
update public.invites set accepted_at = '2026-11-14 19:01:02.708532+00' where email = 'shanuka.jaggi@gmail.com' and accepted_at is null;
update public.invites set accepted_at = '2026-11-14 19:02:08.644936+00' where email = 'shaan.jaggi@outlook.com' and accepted_at is null;
