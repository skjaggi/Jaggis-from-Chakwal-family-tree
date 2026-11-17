-- Family Library: one new table (links to videos and articles about the
-- family) and +3 blessings for each suggested link the admin approves.
-- Changes no existing data. Safe to run more than once.
-- Undo: 2026-11-17-library.rollback.sql

-- The family Library: links to videos, articles and other writing about the
-- Jaggis of Chakwal. Any family member can suggest a link; it shows once the
-- admin approves it. A link can be tagged with people in the tree, so it also
-- shows on their card.
create table if not exists public.library_links (
  id uuid primary key default gen_random_uuid(),
  url text not null check (url ~* '^https?://[^[:space:]]+$' and length(url) <= 2000),
  title text not null check (length(trim(title)) between 1 and 200),
  source text check (source is null or length(source) <= 120),        -- e.g. YouTube, Dawn newspaper
  note text check (note is null or length(note) <= 2000),             -- why it matters to the family
  topic text not null default 'Other' check (length(trim(topic)) between 1 and 60),
  person_ids uuid[] not null default '{}',                            -- people in the tree it is about
  image_url text check (image_url is null or (image_url ~* '^https://[^[:space:]]+$' and length(image_url) <= 2000)),
  visibility text not null default 'public' check (visibility in ('public', 'family')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'declined')),
  submitted_by uuid default auth.uid() references auth.users (id) on delete set null,
  submitted_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  review_note text check (review_note is null or length(review_note) <= 1000)
);
-- The same link can't be in the Library (or waiting) twice.
create unique index if not exists library_links_url_once on public.library_links (lower(url)) where status <> 'declined';

-- Who decided, and when, is filled in by the database, not by the browser.
create or replace function public._library_review_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.submitted_by := coalesce(auth.uid(), new.submitted_by);
    new.submitted_at := now();
    if public.is_admin() then new.status := 'approved'; end if;  -- the admin's own links go live at once
    new.reviewed_by := case when new.status = 'pending' then null else auth.uid() end;
    new.reviewed_at := case when new.status = 'pending' then null else now() end;
  elsif new.status is distinct from old.status then
    new.reviewed_by := auth.uid();
    new.reviewed_at := now();
  end if;
  return new;
end $$;
drop trigger if exists library_review_stamp on public.library_links;
create trigger library_review_stamp before insert or update on public.library_links
  for each row execute function public._library_review_stamp();

alter table public.library_links enable row level security;
grant select on public.library_links to anon, authenticated;
grant insert, update, delete on public.library_links to authenticated;

-- Everyone (signed in or not) sees approved public links.
drop policy if exists "anyone reads public library links" on public.library_links;
create policy "anyone reads public library links" on public.library_links for select to anon, authenticated
  using (status = 'approved' and visibility = 'public');
-- Family members also see family-only links and their own suggestions; the admin sees everything.
drop policy if exists "family reads library links" on public.library_links;
create policy "family reads library links" on public.library_links for select to authenticated
  using (public.is_admin() or (exists (select 1 from public.profiles where id = auth.uid())
         and (status = 'approved' or submitted_by = auth.uid())));
-- Members suggest (it waits for approval); the admin adds straight away.
drop policy if exists "family suggests library links" on public.library_links;
create policy "family suggests library links" on public.library_links for insert to authenticated
  with check (public.is_admin() or (exists (select 1 from public.profiles where id = auth.uid()) and status = 'pending'));
-- Only the admin approves, declines or edits.
drop policy if exists "admin edits library links" on public.library_links;
create policy "admin edits library links" on public.library_links for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
-- The admin can remove any link; members can withdraw their own while it waits.
drop policy if exists "remove library links" on public.library_links;
create policy "remove library links" on public.library_links for delete to authenticated
  using (public.is_admin() or (submitted_by = auth.uid() and status = 'pending'));

-- Every blessing earned by every current member (removed members left out).
-- Any signed-in family member may read it: it powers the Blessings page.
--   kind: add_person | edit_person | set_photo | add_link | claim | invite | library | adjust
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
    -- A suggested Library link the admin approved: 3 blessings.
    select l.submitted_by, coalesce(l.reviewed_at, l.submitted_at), 3, 'library', false, 'Library link: ' || l.title
      from library_links l where l.status = 'approved' and l.submitted_by is not null
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
