-- Hide married women's maiden names from signed-out visitors (Nov 18, 2026).
--
-- A mother's maiden name is a common security question, so Sunil decided:
--   * Every woman with a spouse in the tree (born into the family or married
--     in, living or deceased) shows to visitors as her first name plus her
--     married last name. The married last name is the last word of
--     "Married last name / other names" (bracketed notes and "?" ignored).
--     If there is none, or it is the same as her last name at birth, visitors
--     see only her first name. "Also known as" is hidden from visitors.
--   * Visitors cannot find her by her maiden name in search (they never get it).
--   * Signed-in family see full names as before.
-- Visitors read names only through public_names(); the surname and
-- other_names columns are no longer readable without signing in.
-- NOTE: a new column on people must be granted to anon explicitly.
-- Rollback: 2026-11-18-hide-maiden-names.rollback.sql

create or replace function public._married_last_name(other text, maiden text, given text)
returns text language sql immutable set search_path = public as $$
  -- Last word of "Married last name / other names", ignoring (notes). Nothing
  -- when it ends in "?" (married name not known), or when that word is her
  -- maiden name or part of her first name.
  select case
           when w is null or c ~ '\?$' or lower(w) = lower(coalesce(maiden, ''))
                or lower(w) = any (string_to_array(lower(coalesce(given, '')), ' ')) then null
           when w = lower(w) then initcap(w)
           else w
         end
    from (select trim(regexp_replace(coalesce(other, ''), '\([^)]*\)', '', 'g')) as c) a
    cross join lateral (select (regexp_match(a.c, '([^\s?]+)$'))[1] as w) b;
$$;
revoke all on function public._married_last_name(text, text, text) from public, anon, authenticated;

create or replace function public.public_names()
returns table (id uuid, surname text, other_names text)
language sql stable security definer set search_path = public as $$
  select p.id,
         case when m.married then public._married_last_name(p.other_names, p.surname, p.given_name) else p.surname end,
         case when m.married then null else p.other_names end
    from people p
    cross join lateral (
      select p.gender is distinct from 'male'
             and exists (select 1 from unions u where p.id in (u.partner_a, u.partner_b)) as married
    ) m;
$$;
revoke all on function public.public_names() from public;
grant execute on function public.public_names() to anon, authenticated;

revoke select on public.people from anon;
grant select (id, title, given_name, gender, generation, birth_order, is_living, photo_path, photo_visibility, created_at, updated_at)
  on public.people to anon;
