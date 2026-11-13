-- Lets people remove a profile photo (members' removals wait for approval).
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

alter table public.change_requests drop constraint if exists change_requests_kind_check;
alter table public.change_requests add constraint change_requests_kind_check
  check (kind in ('add_person', 'edit_person', 'add_link', 'remove_link', 'set_photo', 'remove_photo', 'delete_person'));

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

revoke execute on function public._apply_change(public.change_requests, jsonb) from public, anon, authenticated;
