-- Lets signed-in family members invite relatives themselves (no approval step).
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

-- Any signed-in family member can invite a relative, always as a member.
-- The invite works at once; the admin sees who invited whom and can remove it.
create or replace function public.invite_relative(email text, display_name text default null, person_id uuid default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  e text := lower(trim(email));
begin
  if not exists (select 1 from profiles where id = auth.uid()) then
    raise exception 'Please sign in first';
  end if;
  if e is null or e !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Please enter a valid email address';
  end if;
  if exists (select 1 from invites i where i.email = e) then
    raise exception '% has already been invited', e;
  end if;
  if person_id is not null and not exists (select 1 from people p where p.id = person_id) then
    raise exception 'That person is not in the tree';
  end if;
  insert into invites (email, display_name, role, person_id, invited_by)
  values (e, nullif(trim(display_name), ''), 'member', person_id, auth.uid());
end $$;

revoke execute on function public.invite_relative(text, text, uuid) from public, anon;
grant execute on function public.invite_relative(text, text, uuid) to authenticated;

drop policy if exists "members read invites they sent" on public.invites;
create policy "members read invites they sent" on public.invites for select to authenticated
  using (invited_by = auth.uid());
