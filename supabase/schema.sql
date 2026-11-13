-- Jaggi Family Tree: database schema for Supabase (Postgres).
-- Run this once in the Supabase SQL editor, then run seed.sql.
-- It is safe to re-run: objects are created "if not exists" or replaced.
--
-- How the pieces fit:
--   people           one row per person; names are public (the tree is public)
--   person_details   dates, places, profession, notes, sources; each row is
--                    'public' or 'branch' (only that person's branch can read it)
--   parent_child     parent links: biological / adoptive / step / foster,
--                    and 'confirmed' or 'uncertain' (e.g. "Gokal Chand or Chunni Lal")
--   unions           marriages, including divorced / widowed, several per person
--   profiles         one per signed-in user: role (admin/member) and the person
--                    in the tree that the user is
--   invites          emails allowed to sign in; nobody else can create a login
--   change_requests  every add/edit/photo from a member waits here until the
--                    admin approves it; approving applies it to the tree
--
-- "Branch" rule: a member can read branch-only details of everyone descended
-- from their generation-4 ancestor (and from their spouse's generation-4
-- ancestor), their direct ancestors, and the spouses of all of those.
-- The level is set in public.branch_level() below.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- tables

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  title text,                      -- honorific such as "Bakhshi"
  given_name text not null check (length(trim(given_name)) > 0),
  surname text,
  other_names text,                -- married names, nicknames, other spellings
  gender text not null default 'unknown' check (gender in ('male', 'female', 'other', 'unknown')),
  generation int,                  -- 1 = Bakhshi Bhanna Mal Jaggi
  birth_order int,                 -- order among siblings when birth dates are unknown
  is_living boolean,               -- null = not known (treated as living for privacy)
  photo_path text,                 -- "<person id>/<file>" inside the photo bucket, or "img/<file>" shipped with the site
  photo_visibility text not null default 'branch' check (photo_visibility in ('public', 'branch')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.person_details (
  person_id uuid primary key references public.people (id) on delete cascade,
  visibility text not null default 'branch' check (visibility in ('public', 'branch')),
  birth_date text,                 -- free text so "c. 1890" or "1933?" are allowed
  birth_place text,
  death_date text,
  death_place text,
  profession text,
  notes text,
  sources text,                    -- where the information came from
  uncertainty text,                -- what is not certain about this person
  updated_at timestamptz not null default now()
);

create table if not exists public.parent_child (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid not null references public.people (id) on delete cascade,
  child_id uuid not null references public.people (id) on delete cascade,
  kind text not null default 'biological' check (kind in ('biological', 'adoptive', 'step', 'foster')),
  confidence text not null default 'confirmed' check (confidence in ('confirmed', 'uncertain')),
  note text,
  unique (parent_id, child_id),
  check (parent_id <> child_id)
);
alter table public.people add column if not exists birth_order int;
create index if not exists parent_child_child_idx on public.parent_child (child_id);

create table if not exists public.unions (
  id uuid primary key default gen_random_uuid(),
  partner_a uuid not null references public.people (id) on delete cascade,
  partner_b uuid not null references public.people (id) on delete cascade,
  status text not null default 'married' check (status in ('married', 'divorced', 'widowed', 'separated', 'partners')),
  start_date text,
  end_date text,
  sort_order int not null default 0,  -- order of marriages for the same person
  note text,
  check (partner_a <> partner_b)
);
create index if not exists unions_a_idx on public.unions (partner_a);
create index if not exists unions_b_idx on public.unions (partner_b);

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  person_id uuid references public.people (id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.invites (
  email text primary key check (email = lower(email)),
  display_name text,
  role text not null default 'member' check (role in ('admin', 'member')),
  person_id uuid references public.people (id) on delete set null,
  invited_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  accepted_at timestamptz
);

create table if not exists public.change_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('add_person', 'edit_person', 'add_link', 'remove_link', 'set_photo', 'remove_photo', 'delete_person')),
  target_person_id uuid references public.people (id) on delete set null,
  payload jsonb not null,
  summary text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  submitted_by uuid default auth.uid() references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  result_person_id uuid
);
create index if not exists change_requests_status_idx on public.change_requests (status, submitted_at);

-- ---------------------------------------------------------------- helpers

create or replace function public.branch_level() returns int
language sql immutable as $$ select 4 $$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Everyone whose branch-only details the signed-in user may read.
create or replace function public.my_visible_people() returns setof uuid
language sql stable security definer set search_path = public as $$
  with recursive
  me as (
    select person_id as id from public.profiles where id = auth.uid() and person_id is not null
  ),
  me_and_spouses as (
    select id from me
    union
    select case when u.partner_a = me.id then u.partner_b else u.partner_a end
    from public.unions u join me on me.id in (u.partner_a, u.partner_b)
  ),
  anc as (
    select id from me_and_spouses
    union
    select pc.parent_id from public.parent_child pc join anc on pc.child_id = anc.id
  ),
  roots as (
    select a.id from anc a join public.people p on p.id = a.id where p.generation = public.branch_level()
    union
    select id from me_and_spouses
  ),
  des as (
    select id from roots
    union
    select pc.child_id from public.parent_child pc join des on pc.parent_id = des.id
  ),
  line as (
    select id from des union select id from anc
  )
  select id from line
  union
  select case when u.partner_a = l.id then u.partner_b else u.partner_a end
  from public.unions u join line l on l.id in (u.partner_a, u.partner_b);
$$;

create or replace function public.can_see_branch(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_admin() or p in (select public.my_visible_people());
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end $$;

drop trigger if exists people_touch on public.people;
create trigger people_touch before update on public.people
  for each row execute function public.touch_updated_at();
drop trigger if exists person_details_touch on public.person_details;
create trigger person_details_touch before update on public.person_details
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- sign-up gate

-- Only invited emails can create a login. Runs when Supabase Auth creates a user.
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

-- ---------------------------------------------------------------- applying changes

create or replace function public._text(j jsonb, k text) returns text
language sql immutable as $$ select nullif(trim(j ->> k), '') $$;

create or replace function public._check_choice(v text, allowed text[], what text) returns text
language plpgsql immutable as $$
begin
  if v is not null and not (v = any (allowed)) then
    raise exception 'Invalid % "%"', what, v;
  end if;
  return v;
end $$;

-- Applies one change request to the tree. Called only from approve_change_request.
create or replace function public._apply_change(r public.change_requests, extra jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  p jsonb := coalesce(r.payload -> 'person', '{}'::jsonb);
  d jsonb := coalesce(r.payload -> 'details', '{}'::jsonb);
  l jsonb := r.payload -> 'link';
  pid uuid;
  other uuid;
  other_gen int;
  new_gen int;
  living boolean;
begin
  if r.kind = 'add_person' then
    if public._text(p, 'given_name') is null then
      raise exception 'A first name is required';
    end if;
    living := case when p ? 'is_living' and jsonb_typeof(p -> 'is_living') = 'boolean' then (p ->> 'is_living')::boolean end;
    if l is not null then
      other := (l ->> 'of')::uuid;
      select generation into other_gen from people where id = other;
      if not found then raise exception 'The related person no longer exists'; end if;
      new_gen := case l ->> 'as'
        when 'child' then other_gen + 1
        when 'parent' then other_gen - 1
        when 'spouse' then other_gen
        else null end;
    end if;
    insert into people (title, given_name, surname, other_names, gender, generation, is_living)
    values (
      public._text(p, 'title'), public._text(p, 'given_name'), public._text(p, 'surname'),
      public._text(p, 'other_names'),
      coalesce(public._check_choice(public._text(p, 'gender'), array['male','female','other','unknown'], 'gender'), 'unknown'),
      new_gen, living)
    returning id into pid;
    insert into person_details (person_id, visibility, birth_date, birth_place, death_date, death_place, profession, notes, sources, uncertainty)
    values (
      pid,
      coalesce(public._check_choice(public._text(d, 'visibility'), array['public','branch'], 'visibility'),
               case when living = false then 'public' else 'branch' end),
      public._text(d, 'birth_date'), public._text(d, 'birth_place'),
      public._text(d, 'death_date'), public._text(d, 'death_place'),
      public._text(d, 'profession'), public._text(d, 'notes'),
      public._text(d, 'sources'), public._text(d, 'uncertainty'));
    if l is not null then
      if l ->> 'as' = 'child' then
        insert into parent_child (parent_id, child_id, kind, confidence)
        values (other, pid,
          coalesce(public._check_choice(public._text(l, 'kind'), array['biological','adoptive','step','foster'], 'relationship'), 'biological'),
          coalesce(public._check_choice(public._text(l, 'confidence'), array['confirmed','uncertain'], 'confidence'), 'confirmed'));
        -- Also link the child to the parent's spouse when one was chosen.
        if public._text(l, 'other_parent') is not null then
          insert into parent_child (parent_id, child_id, kind, confidence)
          values ((l ->> 'other_parent')::uuid, pid,
            coalesce(public._text(l, 'kind'), 'biological'),
            coalesce(public._text(l, 'confidence'), 'confirmed'))
          on conflict do nothing;
        end if;
      elsif l ->> 'as' = 'parent' then
        insert into parent_child (parent_id, child_id, kind, confidence)
        values (pid, other,
          coalesce(public._check_choice(public._text(l, 'kind'), array['biological','adoptive','step','foster'], 'relationship'), 'biological'),
          coalesce(public._check_choice(public._text(l, 'confidence'), array['confirmed','uncertain'], 'confidence'), 'confirmed'));
      elsif l ->> 'as' = 'spouse' then
        insert into unions (partner_a, partner_b, status, start_date, end_date, sort_order)
        values (other, pid,
          coalesce(public._check_choice(public._text(l, 'status'), array['married','divorced','widowed','separated','partners'], 'marriage status'), 'married'),
          public._text(l, 'start_date'), public._text(l, 'end_date'),
          (select count(*) from unions where other in (partner_a, partner_b)));
      else
        raise exception 'Unknown relationship "%"', l ->> 'as';
      end if;
    end if;
    return pid;

  elsif r.kind = 'edit_person' then
    pid := (r.payload ->> 'person_id')::uuid;
    if not exists (select 1 from people where id = pid) then raise exception 'That person no longer exists'; end if;
    update people set
      title       = case when p ? 'title' then public._text(p, 'title') else title end,
      given_name  = case when p ? 'given_name' then coalesce(public._text(p, 'given_name'), given_name) else given_name end,
      surname     = case when p ? 'surname' then public._text(p, 'surname') else surname end,
      other_names = case when p ? 'other_names' then public._text(p, 'other_names') else other_names end,
      gender      = case when p ? 'gender' then coalesce(public._check_choice(public._text(p, 'gender'), array['male','female','other','unknown'], 'gender'), 'unknown') else gender end,
      is_living   = case when p ? 'is_living' then
                      case when jsonb_typeof(p -> 'is_living') = 'boolean' then (p ->> 'is_living')::boolean end
                    else is_living end
    where id = pid;
    insert into person_details (person_id) values (pid) on conflict do nothing;
    update person_details set
      visibility  = case when d ? 'visibility' then coalesce(public._check_choice(public._text(d, 'visibility'), array['public','branch'], 'visibility'), visibility) else visibility end,
      birth_date  = case when d ? 'birth_date' then public._text(d, 'birth_date') else birth_date end,
      birth_place = case when d ? 'birth_place' then public._text(d, 'birth_place') else birth_place end,
      death_date  = case when d ? 'death_date' then public._text(d, 'death_date') else death_date end,
      death_place = case when d ? 'death_place' then public._text(d, 'death_place') else death_place end,
      profession  = case when d ? 'profession' then public._text(d, 'profession') else profession end,
      notes       = case when d ? 'notes' then public._text(d, 'notes') else notes end,
      sources     = case when d ? 'sources' then public._text(d, 'sources') else sources end,
      uncertainty = case when d ? 'uncertainty' then public._text(d, 'uncertainty') else uncertainty end
    where person_id = pid;
    return pid;

  elsif r.kind = 'add_link' then
    if r.payload ->> 'type' = 'parent_child' then
      insert into parent_child (parent_id, child_id, kind, confidence, note)
      values ((r.payload ->> 'parent_id')::uuid, (r.payload ->> 'child_id')::uuid,
        coalesce(public._check_choice(public._text(r.payload, 'kind'), array['biological','adoptive','step','foster'], 'relationship'), 'biological'),
        coalesce(public._check_choice(public._text(r.payload, 'confidence'), array['confirmed','uncertain'], 'confidence'), 'confirmed'),
        public._text(r.payload, 'note'))
      on conflict (parent_id, child_id) do update set kind = excluded.kind, confidence = excluded.confidence, note = excluded.note;
      return (r.payload ->> 'child_id')::uuid;
    elsif r.payload ->> 'type' = 'union' then
      insert into unions (partner_a, partner_b, status, start_date, end_date, note, sort_order)
      values ((r.payload ->> 'partner_a')::uuid, (r.payload ->> 'partner_b')::uuid,
        coalesce(public._check_choice(public._text(r.payload, 'status'), array['married','divorced','widowed','separated','partners'], 'marriage status'), 'married'),
        public._text(r.payload, 'start_date'), public._text(r.payload, 'end_date'), public._text(r.payload, 'note'),
        (select count(*) from unions where (r.payload ->> 'partner_a')::uuid in (partner_a, partner_b)));
      return (r.payload ->> 'partner_a')::uuid;
    end if;
    raise exception 'Unknown link type';

  elsif r.kind = 'remove_link' then
    if r.payload ->> 'type' = 'parent_child' then
      delete from parent_child where id = (r.payload ->> 'id')::uuid;
    elsif r.payload ->> 'type' = 'union' then
      delete from unions where id = (r.payload ->> 'id')::uuid;
    else
      raise exception 'Unknown link type';
    end if;
    return r.target_person_id;

  elsif r.kind = 'set_photo' then
    pid := (r.payload ->> 'person_id')::uuid;
    -- The admin's browser copies the photo out of the pending bucket and
    -- passes its final path in "extra".
    if public._text(extra, 'final_path') is null then
      raise exception 'The photo has not been copied into place yet';
    end if;
    update people set
      photo_path = public._text(extra, 'final_path'),
      photo_visibility = coalesce(public._check_choice(public._text(r.payload, 'visibility'), array['public','branch'], 'visibility'), 'branch')
    where id = pid;
    if not found then raise exception 'That person no longer exists'; end if;
    return pid;

  elsif r.kind = 'remove_photo' then
    pid := (r.payload ->> 'person_id')::uuid;
    update people set photo_path = null where id = pid;
    if not found then raise exception 'That person no longer exists'; end if;
    return pid;

  elsif r.kind = 'delete_person' then
    pid := (r.payload ->> 'person_id')::uuid;
    delete from people where id = pid;
    return null;
  end if;

  raise exception 'Unknown change type %', r.kind;
end $$;

create or replace function public.approve_change_request(request_id uuid, note text default null, extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  r public.change_requests;
  result uuid;
begin
  if not public.is_admin() then
    raise exception 'Only the admin can approve changes';
  end if;
  select * into r from change_requests where id = request_id for update;
  if not found then raise exception 'Change request not found'; end if;
  if r.status <> 'pending' then raise exception 'This change was already %', r.status; end if;
  result := public._apply_change(r, coalesce(extra, '{}'::jsonb));
  update change_requests
     set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note, result_person_id = result
   where id = request_id;
  return result;
end $$;

create or replace function public.reject_change_request(request_id uuid, note text default null)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Only the admin can reject changes';
  end if;
  update change_requests
     set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(), review_note = note
   where id = request_id and status = 'pending';
  if not found then raise exception 'No pending change with that id'; end if;
end $$;

revoke execute on function public._apply_change(public.change_requests, jsonb) from public, anon, authenticated;
revoke execute on function public.approve_change_request(uuid, text, jsonb) from public, anon;
revoke execute on function public.reject_change_request(uuid, text) from public, anon;
grant execute on function public.approve_change_request(uuid, text, jsonb) to authenticated;
grant execute on function public.reject_change_request(uuid, text) to authenticated;

-- ---------------------------------------------------------------- row level security

alter table public.people enable row level security;
alter table public.person_details enable row level security;
alter table public.parent_child enable row level security;
alter table public.unions enable row level security;
alter table public.profiles enable row level security;
alter table public.invites enable row level security;
alter table public.change_requests enable row level security;

-- The tree itself (names and relationships) is public.
drop policy if exists "people are public" on public.people;
create policy "people are public" on public.people for select using (true);
drop policy if exists "admin writes people" on public.people;
create policy "admin writes people" on public.people for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "details by visibility" on public.person_details;
create policy "details by visibility" on public.person_details for select
  using (visibility = 'public' or public.is_admin() or person_id in (select public.my_visible_people()));
drop policy if exists "admin writes details" on public.person_details;
create policy "admin writes details" on public.person_details for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "parent links are public" on public.parent_child;
create policy "parent links are public" on public.parent_child for select using (true);
drop policy if exists "admin writes parent links" on public.parent_child;
create policy "admin writes parent links" on public.parent_child for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "unions are public" on public.unions;
create policy "unions are public" on public.unions for select using (true);
drop policy if exists "admin writes unions" on public.unions;
create policy "admin writes unions" on public.unions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read own profile or admin" on public.profiles;
create policy "read own profile or admin" on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_admin());
drop policy if exists "admin manages profiles" on public.profiles;
create policy "admin manages profiles" on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admin deletes profiles" on public.profiles;
create policy "admin deletes profiles" on public.profiles for delete to authenticated
  using (public.is_admin());

drop policy if exists "admin manages invites" on public.invites;
create policy "admin manages invites" on public.invites for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "members read invites they sent" on public.invites;
create policy "members read invites they sent" on public.invites for select to authenticated
  using (invited_by = auth.uid());

drop policy if exists "members submit changes" on public.change_requests;
create policy "members submit changes" on public.change_requests for insert to authenticated
  with check (submitted_by = auth.uid() and status = 'pending' and reviewed_by is null and reviewed_at is null);
drop policy if exists "read own changes or admin" on public.change_requests;
create policy "read own changes or admin" on public.change_requests for select to authenticated
  using (submitted_by = auth.uid() or public.is_admin());
drop policy if exists "withdraw own pending change" on public.change_requests;
create policy "withdraw own pending change" on public.change_requests for delete to authenticated
  using ((submitted_by = auth.uid() and status = 'pending') or public.is_admin());

-- ---------------------------------------------------------------- photo storage

-- photos-public:  anyone can view (approved photos marked public)
-- photos-branch:  only the person's branch and the admin can view
-- photos-pending: uploads waiting for approval; only the uploader and admin see them
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('photos-public', 'photos-public', true, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('photos-branch', 'photos-branch', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('photos-pending', 'photos-pending', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists "admin manages approved photos" on storage.objects;
create policy "admin manages approved photos" on storage.objects for all to authenticated
  using (bucket_id in ('photos-public', 'photos-branch') and public.is_admin())
  with check (bucket_id in ('photos-public', 'photos-branch') and public.is_admin());

drop policy if exists "branch reads branch photos" on storage.objects;
create policy "branch reads branch photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos-branch'
         and (storage.foldername(name))[1] in (select v::text from public.my_visible_people() v));

drop policy if exists "members upload pending photos" on storage.objects;
create policy "members upload pending photos" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos-pending' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "uploader or admin reads pending photos" on storage.objects;
create policy "uploader or admin reads pending photos" on storage.objects for select to authenticated
  using (bucket_id = 'photos-pending' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_admin()));

drop policy if exists "admin deletes pending photos" on storage.objects;
create policy "admin deletes pending photos" on storage.objects for delete to authenticated
  using (bucket_id = 'photos-pending' and public.is_admin());
