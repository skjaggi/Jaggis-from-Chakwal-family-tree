-- Tests for "This is me" claims and branch owners. Runs after policy-tests.sql.
\set ON_ERROR_STOP 1
create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where given_name = n $$;
create or replace function pg_temp.as_user(u text) returns void language sql as $$ select set_config('request.jwt.claim.sub', u, false) $$;
-- Files a change as user u (directly, as the site would) and returns its id.
create or replace function pg_temp.req(u text, k text, payload jsonb, target uuid default null) returns uuid language sql as $$
  insert into public.change_requests (kind, payload, target_person_id, summary, submitted_by)
  values (k, payload, target, k, u::uuid) returning id $$;
-- Tries to approve as the current user: 'ok' or the error message.
create or replace function pg_temp.try_approve(id uuid) returns text language plpgsql as $$
begin perform public.approve_change_request(id); return 'ok';
exception when others then return sqlerrm; end $$;
create or replace function pg_temp.child_of(parent text, name text) returns jsonb language sql as $$
  select jsonb_build_object('person', jsonb_build_object('given_name', name), 'details', '{}'::jsonb,
                            'link', jsonb_build_object('as', 'child', 'of', pg_temp.pid(parent))) $$;

\set ADMIN '00000000-0000-0000-0000-00000000000a'
\set SUNIL '00000000-0000-0000-0000-00000000000b'
\set OM '00000000-0000-0000-0000-00000000000c'
insert into public.invites (email, role, invited_by) values ('gurjeet@example.com', 'member', '00000000-0000-0000-0000-00000000000b'), ('shakuntala@example.com', 'member', null);
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000d1', 'gurjeet@example.com'),
                                          ('00000000-0000-0000-0000-0000000000d2', 'shakuntala@example.com');
update public.people set is_living = false where given_name in ('Harbans Lal', 'Tapashi Ram');

-- Claiming
select pg_temp.as_user(:'SUNIL');
select pg_temp.req(:'SUNIL', 'claim_person', jsonb_build_object('person_id', pg_temp.pid('Sunil Kumar')), pg_temp.pid('Sunil Kumar')) as claim \gset
do $$ begin
  perform pg_temp.req('00000000-0000-0000-0000-00000000000b', 'claim_person', '{}'::jsonb, pg_temp.pid('Om Parkash'));
  raise exception 'FAILED: second waiting claim allowed';
exception when unique_violation then raise notice 'ok: one waiting claim per account'; end $$;
select pg_temp.expect(pg_temp.try_approve(:'claim') = 'ok', 'claiming the box the invitation was linked to works at once');
select pg_temp.expect((select claimed_person_id from public.profiles where id = :'SUNIL') = pg_temp.pid('Sunil Kumar'), 'claim recorded on the account');
select pg_temp.as_user(:'OM');
select pg_temp.req(:'OM', 'claim_person', '{}'::jsonb, pg_temp.pid('Sunil Kumar')) as dupe \gset
select pg_temp.as_user(:'ADMIN');
select pg_temp.expect(pg_temp.try_approve(:'dupe') like 'Someone else has already claimed%', 'a box can be claimed by only one account');
update public.change_requests set status = 'rejected' where id = :'dupe';
select pg_temp.req(:'SUNIL', 'claim_person', '{}'::jsonb, pg_temp.pid('Om Parkash')) as second \gset
select pg_temp.expect(pg_temp.try_approve(:'second') like 'This account has already claimed%', 'an account can claim only one box');
update public.change_requests set status = 'rejected' where id = :'second';

-- What the owner can do
select pg_temp.as_user(:'SUNIL');
select pg_temp.req(:'SUNIL', 'add_person', pg_temp.child_of('Sunil Kumar', 'Owner Kid')) as kid \gset
select pg_temp.expect(pg_temp.try_approve(:'kid') = 'ok', 'owner adds their own child, live at once');
select pg_temp.req(:'SUNIL', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Kid Spouse'), 'link', jsonb_build_object('as', 'spouse', 'of', pg_temp.pid('Owner Kid')))) as ks \gset
select pg_temp.expect(pg_temp.try_approve(:'ks') = 'ok', 'owner adds a spouse for their child');
select pg_temp.req(:'SUNIL', 'add_person', pg_temp.child_of('Kid Spouse', 'Grandkid')) as gk \gset
select pg_temp.expect(pg_temp.try_approve(:'gk') = 'ok', 'owner adds a child under a descendant''s spouse');
select pg_temp.req(:'SUNIL', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Harbans Lal'), 'details', jsonb_build_object('profession', 'Teacher'))) as anc \gset
select pg_temp.expect(pg_temp.try_approve(:'anc') = 'ok', 'owner edits a deceased parent''s details');
select pg_temp.req(:'SUNIL', 'add_person', pg_temp.child_of('Harbans Lal', 'New Sibling')) as sib \gset
select pg_temp.expect(pg_temp.try_approve(:'sib') like 'Only the admin%', 'owner cannot add a sibling (child of a parent)');
select pg_temp.req(:'SUNIL', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Gurjeet Kumar'), 'details', jsonb_build_object('profession', 'X'))) as bro \gset
select pg_temp.expect(pg_temp.try_approve(:'bro') like 'Only the admin%', 'owner cannot edit a brother');
select pg_temp.req(:'SUNIL', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'P'), 'link', jsonb_build_object('as', 'parent', 'of', pg_temp.pid('Sunil Kumar')))) as par \gset
select pg_temp.expect(pg_temp.try_approve(:'par') like 'Only the admin%', 'owner cannot add parents');
-- Removing people or links: admin only, not even as a suggestion
do $$ begin
  perform pg_temp.req('00000000-0000-0000-0000-00000000000b', 'delete_person', jsonb_build_object('person_id', pg_temp.pid('Owner Kid')), pg_temp.pid('Owner Kid'));
  raise exception 'FAILED: branch admin could ask to remove a person';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: branch admin cannot even ask to remove a person';
end $$;
do $$ begin
  perform pg_temp.req('00000000-0000-0000-0000-00000000000b', 'remove_link', jsonb_build_object('type', 'parent_child', 'id', (select id from public.parent_child limit 1)));
  raise exception 'FAILED: branch admin could ask to remove a link';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: branch admin cannot even ask to remove a link';
end $$;

-- Suggestions from others for the owner's branch
select pg_temp.req(:'OM', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Owner Kid'), 'details', jsonb_build_object('profession', 'Pilot'))) as sugg \gset
begin;
set local role authenticated;
select pg_temp.as_user(:'SUNIL');
select pg_temp.expect(exists (select 1 from public.change_requests where id = :'sugg'), 'owner sees a suggestion for their branch');
select pg_temp.expect(not exists (select 1 from public.change_requests where id = :'bro'::uuid and submitted_by <> :'SUNIL'::uuid), 'owner does not see others'' unrelated changes');
rollback;
select pg_temp.as_user(:'SUNIL');
select pg_temp.expect(pg_temp.try_approve(:'sugg') = 'ok', 'owner approves a suggestion for their branch');
select pg_temp.expect((select profession from public.person_details where person_id = pg_temp.pid('Owner Kid')) = 'Pilot', 'suggestion applied');

-- Admin undo
select pg_temp.as_user(:'ADMIN');
select public.undo_change_request(:'sugg');
select pg_temp.expect((select profession from public.person_details where person_id = pg_temp.pid('Owner Kid')) is null, 'admin undoes an owner-approved edit');
select pg_temp.expect((select status from public.change_requests where id = :'sugg') = 'undone', 'undone change is marked');
select public.undo_change_request(:'gk');
select pg_temp.expect(pg_temp.pid('Grandkid') is null, 'admin undoes an added person');

-- Someone who married in
select pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'claim_person', '{}'::jsonb, pg_temp.pid('Shakuntala Rani')) as sc \gset
select pg_temp.expect(pg_temp.try_approve(:'sc') = 'ok', 'admin approves a married-in claim');
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
select pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Shakuntala Rani'), 'details', jsonb_build_object('birth_place', 'Lahore'))) as se \gset
select pg_temp.expect(pg_temp.try_approve(:'se') = 'ok', 'married-in owner edits their own details');
select pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'add_person', pg_temp.child_of('Gurjeet Kumar', 'Gurjeet Kid')) as sk \gset
select pg_temp.expect(pg_temp.try_approve(:'sk') = 'ok', 'married-in owner adds under their own children');
do $$ begin
  perform pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Her Father'), 'link', jsonb_build_object('as', 'parent', 'of', pg_temp.pid('Shakuntala Rani'))));
  raise exception 'FAILED: married-in owner added a parent';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: married-in owner cannot add their own parents';
end $$;
select pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Other Husband'), 'link', jsonb_build_object('as', 'spouse', 'of', pg_temp.pid('Shakuntala Rani')))) as ss \gset
select pg_temp.expect(pg_temp.try_approve(:'ss') like 'Only the admin%', 'married-in owner cannot add a spouse to themselves');
select pg_temp.req('00000000-0000-0000-0000-0000000000d2', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Harbans Lal'), 'details', jsonb_build_object('notes', 'x'))) as sh \gset
select pg_temp.expect(pg_temp.try_approve(:'sh') like 'Only the admin%', 'married-in owner cannot edit their husband''s side');

-- Two owners from different lines
select pg_temp.req('00000000-0000-0000-0000-0000000000d1', 'claim_person', '{}'::jsonb, pg_temp.pid('Gurjeet Kumar')) as gc \gset
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d1');
select pg_temp.expect(pg_temp.try_approve(:'gc') like 'Only the person who invited%', 'an unlinked claim cannot approve itself');
select pg_temp.as_user(:'OM');
select pg_temp.expect(pg_temp.try_approve(:'gc') like 'Only the person who invited%', 'someone else cannot approve the claim');
begin;
set local role authenticated;
select pg_temp.as_user(:'SUNIL');
select pg_temp.expect(exists (select 1 from public.change_requests where id = :'gc'), 'the inviter sees the claim to approve');
rollback;
select pg_temp.as_user(:'SUNIL');
select pg_temp.expect(pg_temp.try_approve(:'gc') = 'ok', 'the inviter approves their invitee''s claim');
select pg_temp.as_user(:'SUNIL');
select pg_temp.req(:'SUNIL', 'edit_person', jsonb_build_object('person_id', pg_temp.pid('Harbans Lal'), 'details', jsonb_build_object('profession', 'Headmaster'))) as both \gset
select pg_temp.expect(pg_temp.try_approve(:'both') like 'Only the admin%', 'a parent covered by two brothers goes to the admin');
select pg_temp.req(:'SUNIL', 'add_person', pg_temp.child_of('Owner Kid', 'Still Mine')) as mine \gset
select pg_temp.expect(pg_temp.try_approve(:'mine') = 'ok', 'own branch still works with the mother also an owner');
select pg_temp.expect((select count(*) from public.person_history(pg_temp.pid('Owner Kid'))) >= 1, 'history lists the owner''s additions');

-- The admin removes a branch admin
select pg_temp.as_user(:'SUNIL');
do $$ begin
  perform public.revoke_claim('00000000-0000-0000-0000-0000000000d1');
  raise exception 'FAILED: branch admin removed someone';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: only the admin can remove a branch admin';
end $$;
select pg_temp.as_user(:'ADMIN');
select public.revoke_claim(:'SUNIL');
select pg_temp.expect((select claimed_person_id from public.profiles where id = :'SUNIL') is null, 'admin removes a branch admin');
select pg_temp.as_user(:'SUNIL');
select pg_temp.req(:'SUNIL', 'add_person', pg_temp.child_of('Owner Kid', 'After Revoke')) as ar \gset
select pg_temp.expect(pg_temp.try_approve(:'ar') like 'Only the admin%', 'after removal their changes need approval again');

-- Married-in spouses' parents (and so brothers and sisters) are not added
select pg_temp.as_user('00000000-0000-0000-0000-0000000000d2');
do $$ begin
  insert into public.change_requests (kind, payload, summary, submitted_by)
  values ('add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Her Mother'), 'link', jsonb_build_object('as', 'parent', 'of', pg_temp.pid('Shakuntala Rani'))), 'x', '00000000-0000-0000-0000-0000000000d2');
  raise exception 'FAILED: suggestion of a married-in parent accepted';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: nobody can even suggest parents for someone who married in';
end $$;
select pg_temp.as_user(:'OM');
do $$ begin
  insert into public.change_requests (kind, payload, summary, submitted_by)
  values ('add_link', jsonb_build_object('type', 'parent_child', 'parent_id', pg_temp.pid('Om Parkash'), 'child_id', pg_temp.pid('Shakuntala Rani')), 'x', '00000000-0000-0000-0000-00000000000c');
  raise exception 'FAILED: linking a parent to a married-in person accepted';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: nobody can link a parent to someone who married in';
end $$;
select pg_temp.req(:'OM', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Blood Parent'), 'link', jsonb_build_object('as', 'parent', 'of', pg_temp.pid('Om Parkash')))) is not null as ok \gset
select pg_temp.expect(:'ok', 'parents of blood relatives can still be suggested');
select pg_temp.as_user(:'ADMIN');
select pg_temp.req(:'ADMIN', 'add_person', jsonb_build_object('person', jsonb_build_object('given_name', 'Admin Added'), 'link', jsonb_build_object('as', 'parent', 'of', pg_temp.pid('Shakuntala Rani')))) is not null as ok2 \gset
select pg_temp.expect(:'ok2', 'the admin can still add them if needed');

-- Member visits: members add only their own, only the admin reads them
begin;
set local role authenticated;
select pg_temp.as_user(:'SUNIL');
insert into public.page_views (view, person_id) values ('tree', pg_temp.pid('Sunil Kumar'));
select pg_temp.expect((select count(*) from public.page_views) = 0, 'members cannot read visits, not even their own');
do $$ begin
  insert into public.page_views (user_id, view) values ('00000000-0000-0000-0000-00000000000a', 'tree');
  raise exception 'FAILED: member recorded a visit for someone else';
exception when others then
  if sqlerrm like 'FAILED%' then raise; end if;
  raise notice 'ok: members cannot record visits for someone else';
end $$;
select pg_temp.as_user(:'ADMIN');
select pg_temp.expect((select count(*) from public.page_views where user_id = '00000000-0000-0000-0000-00000000000b' and view = 'tree') = 1, 'admin reads member visits');
commit;
