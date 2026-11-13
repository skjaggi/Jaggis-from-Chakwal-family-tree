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

-- ---------------------------------------------------------------- open questions

-- Open questions: things the family is still trying to find out
-- ("Who was Kesar Mal's wife?"). Signed-in family can read and add them;
-- the admin marks them answered or removes them.
create table if not exists public.research_questions (
  id uuid primary key default gen_random_uuid(),
  question text not null check (length(trim(question)) > 0),
  person_id uuid references public.people (id) on delete set null,
  next_step text,
  status text not null default 'open' check (status in ('open', 'answered', 'dropped')),
  answer text,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.research_questions enable row level security;

drop policy if exists "family reads questions" on public.research_questions;
create policy "family reads questions" on public.research_questions for select to authenticated
  using (exists (select 1 from public.profiles where id = auth.uid()));
drop policy if exists "family adds questions" on public.research_questions;
create policy "family adds questions" on public.research_questions for insert to authenticated
  with check (created_by = auth.uid() and status = 'open' and answer is null
              and exists (select 1 from public.profiles where id = auth.uid()));
drop policy if exists "admin manages questions" on public.research_questions;
create policy "admin manages questions" on public.research_questions for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
drop policy if exists "author removes own open question" on public.research_questions;
create policy "author removes own open question" on public.research_questions for delete to authenticated
  using (created_by = auth.uid() and status = 'open');

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

-- ---------------------------------------------------------------- who added and updated each person
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


-- ---------------------------------------------------------------- branch owners ("This is me")
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
