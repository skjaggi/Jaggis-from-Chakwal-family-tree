-- Private marriage dates and adoption labels (Nov 18, 2026).
--
-- Before: anyone, even a signed-out visitor, could read every marriage date,
-- end date and marriage note, and whether a child was adopted / step / foster.
-- After:
--   * Marriage dates, end dates and notes follow the same rule as other
--     details: visible to everyone only when both spouses have passed away;
--     otherwise only to the admin and to members whose branch includes either
--     spouse.
--   * Adoptive / step / foster labels and parent-link notes: visible to
--     everyone when the child has passed away; otherwise only to signed-in
--     family. Visitors see an ordinary child line.
-- Who is married to whom, marriage status and who is whose child stay public
-- (the tree is public).
--
-- The site reads the hidden columns through the two functions below.
-- Rollback: 2026-11-18-private-marriage-dates.rollback.sql

-- Visitors and members may read only the harmless columns directly.
revoke select on public.unions from anon, authenticated;
grant select (id, partner_a, partner_b, status, sort_order) on public.unions to anon, authenticated;
revoke select on public.parent_child from anon, authenticated;
grant select (id, parent_id, child_id, confidence) on public.parent_child to anon, authenticated;

-- Marriage dates and notes the caller may see.
create or replace function public.union_details()
returns table (id uuid, start_date text, end_date text, note text)
language sql stable security definer set search_path = public as $$
  select u.id, u.start_date, u.end_date, u.note
    from unions u
    join people a on a.id = u.partner_a
    join people b on b.id = u.partner_b
   where (a.is_living is false and b.is_living is false)
      or public.is_admin()
      or u.partner_a in (select public.my_visible_people())
      or u.partner_b in (select public.my_visible_people());
$$;
revoke all on function public.union_details() from public;
grant execute on function public.union_details() to anon, authenticated;

-- Kind (biological / adoptive / step / foster) and notes of parent links.
-- Visitors get them only for children who have passed away.
create or replace function public.parent_link_details()
returns table (id uuid, kind text, note text)
language sql stable security definer set search_path = public as $$
  select l.id, l.kind, l.note
    from parent_child l
    join people c on c.id = l.child_id
   where c.is_living is false
      or exists (select 1 from profiles where profiles.id = auth.uid());
$$;
revoke all on function public.parent_link_details() from public;
grant execute on function public.parent_link_details() to anon, authenticated;
