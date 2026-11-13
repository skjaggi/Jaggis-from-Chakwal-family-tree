-- "This is me": a signed-in family member claims their own box and becomes
-- the "branch admin" for it. Once the admin
-- approves the claim, they look after their own part of the tree:
--   * themselves, their spouse(s), all their descendants and the descendants'
--     spouses: they can edit them, add children and spouses, change photos,
--     and their changes go live straight away;
--   * their deceased direct ancestors: they can edit their details and photo;
--   * they approve other people's suggestions for that part of the tree.
-- Someone who married into the family can claim their own box and look after
-- their own children, but cannot add their own parents or other spouses, so no
-- second family tree grows from them. A claim of the box the invitation was
-- linked to is approved at once; any other box needs the person who sent
-- the invitation, or the admin, to approve it. One box per account and one
-- account per box. Adding parents, linking or unlinking
-- people, and removing people always need the admin. When two owners from
-- different lines both cover a person (for example two relatives who married
-- each other), changes to that person go to the admin. The admin can undo any
-- edit or addition from the Review page.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

alter table public.profiles add column if not exists claimed_person_id uuid references public.people (id) on delete set null;
-- One box per account (one column) and one account per box (this index).
create unique index if not exists profiles_claimed_person_idx on public.profiles (claimed_person_id) where claimed_person_id is not null;

alter table public.change_requests add column if not exists before jsonb;
alter table public.change_requests drop constraint if exists change_requests_kind_check;
alter table public.change_requests add constraint change_requests_kind_check
  check (kind in ('add_person', 'edit_person', 'add_link', 'remove_link', 'set_photo', 'remove_photo', 'delete_person', 'claim_person'));
-- Only one claim waiting at a time per account, and per box.
create unique index if not exists change_requests_one_claim_each on public.change_requests (submitted_by)
  where kind = 'claim_person' and status = 'pending';
create unique index if not exists change_requests_one_claim_per_box on public.change_requests (target_person_id)
  where kind = 'claim_person' and status = 'pending';
alter table public.change_requests drop constraint if exists change_requests_status_check;
alter table public.change_requests add constraint change_requests_status_check
  check (status in ('pending', 'approved', 'rejected', 'undone'));

-- Someone with no parents in the tree whose spouse has parents in the tree.
create or replace function public._is_married_in(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select not exists (select 1 from parent_child where child_id = p)
     and exists (select 1 from unions u
                  where p in (u.partner_a, u.partner_b)
                    and exists (select 1 from parent_child pc
                                 where pc.child_id = case when u.partner_a = p then u.partner_b else u.partner_a end));
$$;

-- The people a claimed person looks after: themselves, their descendants and
-- the descendants' spouses, plus their own spouses unless they married in.
create or replace function public._branch_of(c uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive down(id) as (
    select c
    union
    select pc.child_id from parent_child pc join down on pc.parent_id = down.id
  ),
  spouses as (
    select case when u.partner_a = d.id then u.partner_b else u.partner_a end as id
      from unions u join down d on d.id in (u.partner_a, u.partner_b)
     where d.id <> c or not public._is_married_in(c)
  )
  select id from down union select id from spouses;
$$;

-- Deceased direct ancestors of a claimed person (details and photo only).
create or replace function public._ancestors_of(c uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive up(id) as (
    select pc.parent_id from parent_child pc where pc.child_id = c
    union
    select pc.parent_id from parent_child pc join up on pc.child_id = up.id
  )
  select up.id from up join people pe on pe.id = up.id where pe.is_living = false;
$$;

-- Can user u manage changes to person p? scope 'branch' (add children or
-- spouses) or 'person' (edit details or photo, which also covers deceased
-- ancestors). Refused when an owner from another line also covers p.
create or replace function public._can_manage_person(u uuid, p uuid, scope text) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  c uuid;
begin
  select claimed_person_id into c from profiles where id = u;
  if c is null or p is null then return false; end if;
  if not (p in (select public._branch_of(c))
          or (scope = 'person' and p in (select public._ancestors_of(c)))) then
    return false;
  end if;
  -- Another owner who also covers p, from a different line, means the admin decides.
  return not exists (
    select 1 from profiles o
     where o.id <> u and o.claimed_person_id is not null
       and (p in (select public._branch_of(o.claimed_person_id))
            or (scope = 'person' and p in (select public._ancestors_of(o.claimed_person_id))))
       and o.claimed_person_id not in (select public._branch_of(c))
       and c not in (select public._branch_of(o.claimed_person_id)));
end $$;

-- Claims follow the invitation: the box the inviter linked the invite to can
-- be claimed straight away; any other box needs the inviter (or the admin) to
-- approve the claim.
create or replace function public._inviter_of(u uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select i.invited_by from invites i join profiles pr on pr.email = i.email where pr.id = u;
$$;
create or replace function public._invited_box(u uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select i.person_id from invites i join profiles pr on pr.email = i.email where pr.id = u;
$$;
create or replace function public.can_approve_claim(u uuid, claimant uuid, box uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(u is not null and (public.is_admin()
    or u = public._inviter_of(claimant)
    or (u = claimant and box = public._invited_box(claimant))), false);
$$;

-- Can user u approve this change (their own or someone else's)?
create or replace function public.can_manage_change(u uuid, kind text, payload jsonb) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  l jsonb := payload -> 'link';
  x uuid;
begin
  if u is null then return false; end if;
  if kind in ('edit_person', 'set_photo', 'remove_photo') then
    return public._can_manage_person(u, (payload ->> 'person_id')::uuid, 'person');
  elsif kind = 'add_person' and l is not null then
    x := (l ->> 'of')::uuid;
    if l ->> 'as' = 'child' then
      return public._can_manage_person(u, x, 'branch')
         and (l ->> 'other_parent' is null or public._can_manage_person(u, (l ->> 'other_parent')::uuid, 'branch'));
    elsif l ->> 'as' = 'spouse' then
      -- Spouses are added to blood relatives only, never to someone who married in.
      return public._can_manage_person(u, x, 'branch') and not public._is_married_in(x)
         and exists (select 1 from parent_child where child_id = x);
    end if;
  end if;
  return false; -- parents, links, removals and claims stay with the admin
end $$;

-- The people this user looks after, for the site to label buttons.
-- edit_only = true for deceased ancestors (details and photo only).
create or replace function public.my_managed_people()
returns table (person_id uuid, edit_only boolean)
language sql stable security definer set search_path = public as $$
  with me as (select claimed_person_id c from profiles where id = auth.uid() and claimed_person_id is not null)
  select b, false from me, public._branch_of(me.c) b
  union
  select a, true from me, public._ancestors_of(me.c) a
   where a not in (select public._branch_of(me.c));
$$;

-- Who has claimed this box, for the person's card (signed-in family only).
create or replace function public.person_claimed_by(p uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
    from profiles where claimed_person_id = p and auth.uid() is not null;
$$;

-- A family member's name, so owners can see who sent a suggestion.
create or replace function public.member_name(u uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce(nullif(display_name, ''), split_part(email, '@', 1))
    from profiles where id = u and auth.uid() is not null;
$$;
revoke execute on function public.member_name(uuid) from public, anon;
grant execute on function public.member_name(uuid) to authenticated;

-- Admin only: take away someone's "This is me" claim (they stop being a
-- branch admin; their account and changes stay).
create or replace function public.revoke_claim(u uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Only the admin can remove a branch admin'; end if;
  update profiles set claimed_person_id = null where id = u;
end $$;
revoke execute on function public.revoke_claim(uuid) from public, anon;
grant execute on function public.revoke_claim(uuid) to authenticated;

-- Snapshot of a person before a change, so the admin can undo it.
create or replace function public._snapshot(pid uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('person', to_jsonb(pe) - 'id' - 'created_at' - 'generation' - 'birth_order' - 'photo_path' - 'photo_visibility',
                            'details', coalesce(to_jsonb(d) - 'person_id', '{}'::jsonb))
    from people pe left join person_details d on d.person_id = pe.id where pe.id = pid;
$$;

create or replace function public.approve_change_request(request_id uuid, note text default null, extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.change_requests;
  result uuid;
  snap jsonb;
begin
  select * into r from change_requests where id = request_id for update;
  if not found then raise exception 'Change request not found'; end if;
  if r.kind = 'claim_person' then
    if not public.can_approve_claim(auth.uid(), r.submitted_by, r.target_person_id) then
      raise exception 'Only the person who invited them, or the admin, can approve this claim';
    end if;
  elsif not (public.is_admin() or public.can_manage_change(auth.uid(), r.kind, r.payload)) then
    raise exception 'Only the admin or the owner of this part of the tree can approve this change';
  end if;
  if r.status <> 'pending' then raise exception 'This change was already %', r.status; end if;
  if r.kind = 'edit_person' then snap := public._snapshot((r.payload ->> 'person_id')::uuid); end if;
  if r.kind = 'claim_person' then
    if exists (select 1 from profiles where claimed_person_id = r.target_person_id and id <> r.submitted_by) then
      raise exception 'Someone else has already claimed this person';
    end if;
    if exists (select 1 from profiles where id = r.submitted_by and claimed_person_id is not null and claimed_person_id <> r.target_person_id) then
      raise exception 'This account has already claimed another person; each account can claim only one';
    end if;
    update profiles set claimed_person_id = r.target_person_id, person_id = r.target_person_id where id = r.submitted_by;
    result := r.target_person_id;
  else
    result := public._apply_change(r, coalesce(extra, '{}'::jsonb));
  end if;
  update change_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note,
         result_person_id = result, before = snap
   where id = request_id;
  return result;
end $$;

create or replace function public.reject_change_request(request_id uuid, note text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.change_requests;
begin
  select * into r from change_requests where id = request_id;
  if not (public.is_admin()
          or (r.kind = 'claim_person' and coalesce(auth.uid() = public._inviter_of(r.submitted_by), false))
          or (r.kind <> 'claim_person' and public.can_manage_change(auth.uid(), r.kind, r.payload))) then
    raise exception 'Only the admin or the owner of this part of the tree can turn down this change';
  end if;
  update change_requests
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note
   where id = request_id and status = 'pending';
  if not found then raise exception 'No pending change with that id'; end if;
end $$;

-- Admin only: undo an approved edit, addition or claim.
create or replace function public.undo_change_request(request_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  r public.change_requests;
  pid uuid;
  p jsonb;
  d jsonb;
begin
  if not public.is_admin() then raise exception 'Only the admin can undo changes'; end if;
  select * into r from change_requests where id = request_id for update;
  if not found or r.status <> 'approved' then raise exception 'Only approved changes can be undone'; end if;
  if r.kind = 'edit_person' then
    if r.before is null then raise exception 'This change was made before undo was possible'; end if;
    pid := (r.payload ->> 'person_id')::uuid;
    p := r.before -> 'person';
    d := r.before -> 'details';
    -- Put back only the fields this change touched.
    update people set
      title       = case when r.payload -> 'person' ? 'title' then p ->> 'title' else title end,
      given_name  = case when r.payload -> 'person' ? 'given_name' then coalesce(p ->> 'given_name', given_name) else given_name end,
      surname     = case when r.payload -> 'person' ? 'surname' then p ->> 'surname' else surname end,
      other_names = case when r.payload -> 'person' ? 'other_names' then p ->> 'other_names' else other_names end,
      gender      = case when r.payload -> 'person' ? 'gender' then coalesce(p ->> 'gender', 'unknown') else gender end,
      is_living   = case when r.payload -> 'person' ? 'is_living' then (p ->> 'is_living')::boolean else is_living end
    where id = pid;
    update person_details set
      visibility  = case when r.payload -> 'details' ? 'visibility' then coalesce(d ->> 'visibility', visibility) else visibility end,
      birth_date  = case when r.payload -> 'details' ? 'birth_date' then d ->> 'birth_date' else birth_date end,
      birth_place = case when r.payload -> 'details' ? 'birth_place' then d ->> 'birth_place' else birth_place end,
      death_date  = case when r.payload -> 'details' ? 'death_date' then d ->> 'death_date' else death_date end,
      death_place = case when r.payload -> 'details' ? 'death_place' then d ->> 'death_place' else death_place end,
      profession  = case when r.payload -> 'details' ? 'profession' then d ->> 'profession' else profession end,
      notes       = case when r.payload -> 'details' ? 'notes' then d ->> 'notes' else notes end,
      sources     = case when r.payload -> 'details' ? 'sources' then d ->> 'sources' else sources end,
      uncertainty = case when r.payload -> 'details' ? 'uncertainty' then d ->> 'uncertainty' else uncertainty end
    where person_id = pid;
  elsif r.kind = 'add_person' then
    if exists (select 1 from parent_child where parent_id = r.result_person_id)
       or (select count(*) from unions where r.result_person_id in (partner_a, partner_b)) > 1 then
      raise exception 'Someone has since been added under this person; remove them first';
    end if;
    delete from people where id = r.result_person_id;
  elsif r.kind = 'claim_person' then
    update profiles set claimed_person_id = null where id = r.submitted_by and claimed_person_id = r.target_person_id;
  else
    raise exception 'This kind of change cannot be undone here';
  end if;
  update change_requests set status = 'undone', review_note = coalesce(review_note || ' · ', '') || 'Undone by admin' where id = request_id;
end $$;

revoke execute on function public._is_married_in(uuid) from public, anon, authenticated;
revoke execute on function public._branch_of(uuid) from public, anon, authenticated;
revoke execute on function public._ancestors_of(uuid) from public, anon, authenticated;
revoke execute on function public._can_manage_person(uuid, uuid, text) from public, anon, authenticated;
revoke execute on function public._snapshot(uuid) from public, anon, authenticated;
revoke execute on function public._inviter_of(uuid) from public, anon;
grant execute on function public._inviter_of(uuid) to authenticated; -- used by a row policy
revoke execute on function public._invited_box(uuid) from public, anon, authenticated;
revoke execute on function public.can_approve_claim(uuid, uuid, uuid) from public, anon;
grant execute on function public.can_approve_claim(uuid, uuid, uuid) to authenticated;
revoke execute on function public.can_manage_change(uuid, text, jsonb) from public, anon;
revoke execute on function public.my_managed_people() from public, anon;
revoke execute on function public.person_claimed_by(uuid) from public, anon;
revoke execute on function public.approve_change_request(uuid, text, jsonb) from public, anon;
revoke execute on function public.reject_change_request(uuid, text) from public, anon;
revoke execute on function public.undo_change_request(uuid) from public, anon;
grant execute on function public.can_manage_change(uuid, text, jsonb) to authenticated;
grant execute on function public.my_managed_people() to authenticated;
grant execute on function public.person_claimed_by(uuid) to authenticated;
grant execute on function public.approve_change_request(uuid, text, jsonb) to authenticated;
grant execute on function public.reject_change_request(uuid, text) to authenticated;
grant execute on function public.undo_change_request(uuid) to authenticated;

-- Owners see the suggestions waiting for their part of the tree.
drop policy if exists "read own changes or admin" on public.change_requests;
create policy "read own changes or admin" on public.change_requests for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin()
         or (status = 'pending' and public.can_manage_change(auth.uid(), kind, payload))
         or (status = 'pending' and kind = 'claim_person' and public._inviter_of(submitted_by) = auth.uid()));

-- Photos: owners can read the photos waiting for their part of the tree,
-- put approved photos in place, and tidy up the old ones.
drop policy if exists "uploader or admin reads pending photos" on storage.objects;
create policy "uploader or admin reads pending photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos-pending' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
         or exists (select 1 from public.change_requests cr
                     where cr.kind = 'set_photo' and cr.payload ->> 'path' = name
                       and public.can_manage_change(auth.uid(), cr.kind, cr.payload))));
drop policy if exists "admin deletes pending photos" on storage.objects;
create policy "admin deletes pending photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos-pending' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()
         or exists (select 1 from public.change_requests cr
                     where cr.kind = 'set_photo' and cr.payload ->> 'path' = name
                       and public.can_manage_change(auth.uid(), cr.kind, cr.payload))));
drop policy if exists "owners manage their branch photos" on storage.objects;
create policy "owners manage their branch photos" on storage.objects for all to authenticated
  using (bucket_id in ('photos-public', 'photos-branch')
         and (storage.foldername(name))[1] in (select m.person_id::text from public.my_managed_people() m))
  with check (bucket_id in ('photos-public', 'photos-branch')
         and (storage.foldername(name))[1] in (select m.person_id::text from public.my_managed_people() m));

-- The "Added and updated by" list also shows who claimed the box.
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
