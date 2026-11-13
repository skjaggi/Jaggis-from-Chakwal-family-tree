-- Someone who married into the family: nobody but the admin can add their
-- parents, and so their brothers and sisters, to the tree. This applies to
-- suggestions as well as to branch admins' own changes.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

create or replace function public._no_married_in_family() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  l jsonb := new.payload -> 'link';
begin
  if public.is_admin() then return new; end if;
  if (new.kind = 'add_person' and l ->> 'as' = 'parent' and public._is_married_in((l ->> 'of')::uuid))
     or (new.kind = 'add_link' and new.payload ->> 'type' = 'parent_child'
         and public._is_married_in((new.payload ->> 'child_id')::uuid)) then
    raise exception 'The parents, brothers and sisters of someone who married into the family are not added to this tree. Please ask the admin if this is needed.';
  end if;
  return new;
end $$;

drop trigger if exists no_married_in_family on public.change_requests;
create trigger no_married_in_family before insert on public.change_requests
  for each row execute function public._no_married_in_family();
