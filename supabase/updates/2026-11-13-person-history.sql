-- Who added and who later updated each person, for the "Added and updated by"
-- list on the person's card. Built from approved changes, so it covers
-- everything already added (nothing to backfill). Signed-in family only.
-- Run once in the Supabase SQL Editor. Safe to run again.

create or replace function public.person_history(p uuid)
returns table (kind text, summary text, by_name text, at timestamptz)
language sql stable security definer set search_path = public as $$
  select cr.kind, cr.summary,
         coalesce(nullif(pr.display_name, ''), split_part(pr.email, '@', 1), 'a family member'),
         coalesce(cr.reviewed_at, cr.submitted_at)
    from change_requests cr
    left join profiles pr on pr.id = cr.submitted_by
   where cr.status = 'approved'
     and auth.uid() is not null
     and (cr.result_person_id = p
          or (cr.result_person_id is null and (cr.target_person_id = p or cr.payload->>'person_id' = p::text)))
   order by 4;
$$;
revoke all on function public.person_history(uuid) from public, anon;
grant execute on function public.person_history(uuid) to authenticated;

-- Show the admin's name properly instead of the start of the email address.
update public.profiles set display_name = 'Sunil Jaggi' where display_name = 'sunil.jaggi01';
