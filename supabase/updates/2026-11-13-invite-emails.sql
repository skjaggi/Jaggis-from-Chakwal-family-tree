-- For automatic invitation emails: a login created by an invitation email
-- only counts as "signed in" on the Members page once the person signs in.
-- Safe to run more than once.

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
  -- A login made by an invitation email exists before they sign in, so it
  -- only counts as "signed in" once they actually do (see below).
  if new.invited_at is null or new.last_sign_in_at is not null then
    update public.invites set accepted_at = now() where email = inv.email;
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_signed_in() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.invites set accepted_at = now() where email = lower(new.email) and accepted_at is null;
  return new;
end $$;

drop trigger if exists on_auth_user_signed_in on auth.users;
create trigger on_auth_user_signed_in after update of last_sign_in_at on auth.users
  for each row when (new.last_sign_in_at is not null and old.last_sign_in_at is distinct from new.last_sign_in_at)
  execute function public.handle_user_signed_in();
