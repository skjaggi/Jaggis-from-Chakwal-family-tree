-- Only the admin can remove anyone from the tree, or remove a parent or
-- marriage link. Branch admins and members can't do it, and can't send it
-- as a suggestion either. Photos can still be removed as before.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

create or replace function public._admin_only_removals() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind in ('delete_person', 'remove_link') and not public.is_admin() then
    raise exception 'Only the admin can remove people or relationships from the tree. Please ask the admin if something needs to be removed.';
  end if;
  return new;
end $$;

drop trigger if exists admin_only_removals on public.change_requests;
create trigger admin_only_removals before insert on public.change_requests
  for each row execute function public._admin_only_removals();
