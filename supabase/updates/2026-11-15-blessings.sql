-- Blessings: points family members earn for approved additions to the tree.
-- Adds one table (admin adjustments) and read-only functions. Changes no
-- existing data. Undo with 2026-11-15-blessings.rollback.sql.

-- Admin adjustments: extra blessings (or a correction) with a reason.
create table if not exists public.blessing_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  points int not null check (points between -500 and 500 and points <> 0),
  reason text not null check (length(trim(reason)) > 0),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.blessing_adjustments enable row level security;
drop policy if exists "admin manages blessing adjustments" on public.blessing_adjustments;
create policy "admin manages blessing adjustments" on public.blessing_adjustments for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Points for the details in a change (before the generation multiplier):
-- a story (notes) 5, years, places,
-- profession and sources 2, anything else 1. Empty values and privacy count 0.
create or replace function public._detail_blessings(j jsonb) returns int
language sql immutable set search_path = public as $$
  select coalesce(sum(case
      when e.value is null or trim(e.value) = '' then 0
      when e.key = 'notes' then 5
      when e.key in ('birth_date', 'death_date', 'birth_place', 'death_place', 'profession', 'sources') then 2
      else 1 end), 0)::int
  from jsonb_each_text(case when jsonb_typeof(j) = 'object' then j else '{}'::jsonb end) e
  where e.key <> 'visibility';
$$;

-- Every blessing earned by every current member (removed members left out).
-- Any signed-in family member may read it: it powers the Blessings page.
--   kind: add_person | edit_person | set_photo | add_link | claim | invite | adjust
--   story: the change added a story (counts toward the Storyteller badge)
create or replace function public.blessings_ledger()
returns table (user_id uuid, name text, person_id uuid, role text, at timestamptz, points int, kind text, story boolean, reason text)
language sql stable security definer set search_path = public as $$
  with members as (
    select p.id, coalesce(nullif(p.display_name, ''), split_part(p.email, '@', 1)) as name,
           p.claimed_person_id, p.role, p.email, p.created_at
      from profiles p
     where auth.uid() is not null
       and not exists (select 1 from removed_members r where r.email = lower(p.email))
  ), rows as (
    select c.submitted_by as user_id, coalesce(c.reviewed_at, c.submitted_at) as at,
           -- Details about the early generations are rarest, so they count more:
           -- x5 for Generation 1, x4 for 2, x3 for 3, x2 for 4.
           (select case pp.generation when 1 then 5 when 2 then 4 when 3 then 3 when 4 then 2 else 1 end
              from (select 1) one left join people pp on pp.id = coalesce((c.payload ->> 'person_id')::uuid, c.result_person_id, c.target_person_id))
           * case c.kind
             when 'add_person' then 5 + public._detail_blessings(c.payload -> 'details')
             when 'edit_person' then public._detail_blessings(c.payload -> 'details')
               + (select count(*)::int from jsonb_object_keys(case when jsonb_typeof(c.payload -> 'person') = 'object' then c.payload -> 'person' else '{}'::jsonb end))
             when 'set_photo' then case when c.summary ilike 'Re-centered%' then 1 else 5 end
             when 'add_link' then 3
           end as points,
           c.kind,
           coalesce(nullif(trim(c.payload -> 'details' ->> 'notes'), ''), '') <> '' as story,
           coalesce(c.summary, c.kind) as reason
      from change_requests c
     where c.status = 'approved' and c.kind in ('add_person', 'edit_person', 'set_photo', 'add_link')
    union all
    select m.id, coalesce((select max(c.reviewed_at) from change_requests c
                            where c.submitted_by = m.id and c.kind = 'claim_person' and c.status = 'approved'), m.created_at),
           5, 'claim', false, 'Claimed their own box'
      from members m where m.claimed_person_id is not null
    union all
    select i.invited_by, i.accepted_at, 10, 'invite', false,
           'Invited ' || coalesce(nullif(i.display_name, ''), 'a relative') || ', who signed in'
      from invites i join members m on m.id = i.invited_by
     where i.accepted_at is not null and lower(i.email) <> lower(m.email)
    union all
    select a.user_id, a.created_at, a.points, 'adjust', false, a.reason
      from blessing_adjustments a
  )
  select m.id, m.name, m.claimed_person_id, m.role, r.at, r.points, r.kind, r.story, r.reason
    from rows r join members m on m.id = r.user_id
   where r.points <> 0;
$$;
revoke all on function public.blessings_ledger() from public, anon;
grant execute on function public.blessings_ledger() to authenticated;
