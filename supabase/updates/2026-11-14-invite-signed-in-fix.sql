-- Invites showed "signed in" the moment the invitation email went out.
-- Supabase creates the invited login first and only then stamps invited_at,
-- so the old check saw no invited_at and counted the invite as accepted.
-- Now an invite only counts once the person has really signed in
-- (last_sign_in_at set), and the sign-in trigger ignores updates that
-- don't change it. Then the four invites wrongly marked are reset.
-- Backup of the reset rows: backups/2026-11-14-invites-accepted.json.
-- Undo: 2026-11-14-invite-signed-in-fix.rollback.sql

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
  -- A login counts as "signed in" only once they actually sign in (see below).
  if new.last_sign_in_at is not null then
    update public.invites set accepted_at = now() where email = inv.email;
  end if;
  return new;
end $$;

create or replace function public.handle_user_signed_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is not null and new.last_sign_in_at is distinct from old.last_sign_in_at then
    update public.invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  end if;
  return new;
end $$;

-- Reset invites marked signed in whose login has never signed in.
update public.invites i set accepted_at = null
  from auth.users u
 where lower(u.email) = i.email and i.accepted_at is not null and u.last_sign_in_at is null;
