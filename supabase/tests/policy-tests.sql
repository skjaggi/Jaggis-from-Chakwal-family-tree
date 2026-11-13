-- Behaviour tests for privacy rules and the approval flow.
\set ON_ERROR_STOP 1
create or replace function pg_temp.expect(ok boolean, what text) returns void language plpgsql as $$
begin if not ok then raise exception 'FAILED: %', what; end if; raise notice 'ok: %', what; end $$;
create or replace function pg_temp.pid(n text) returns uuid language sql as $$ select id from public.people where given_name = n $$;

-- Sign-up gate
insert into public.invites (email, role) values ('admin@example.com', 'admin');
insert into public.invites (email, role, person_id) values ('sunil@example.com', 'member', pg_temp.pid('Sunil Kumar'));
insert into public.invites (email, role, person_id) values ('om@example.com', 'member', pg_temp.pid('Om Parkash'));
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000a', 'Admin@Example.com');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000b', 'sunil@example.com');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-00000000000c', 'om@example.com');
do $$ begin
  begin
    insert into auth.users (email) values ('stranger@example.com');
    raise exception 'FAILED: uninvited signup allowed';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: uninvited email rejected (%)', sqlerrm;
  end;
end $$;
select pg_temp.expect((select role from public.profiles where email = 'admin@example.com') = 'admin', 'admin profile created from invite');
-- Login created by an invitation email: not "signed in" until they sign in
insert into public.invites (email, role) values ('emailed@example.com', 'member');
insert into auth.users (id, email, invited_at) values ('00000000-0000-0000-0000-0000000000e1', 'emailed@example.com', now());
select pg_temp.expect((select accepted_at from public.invites where email = 'emailed@example.com') is null, 'invite email alone does not count as signed in');
update auth.users set last_sign_in_at = now() where email = 'emailed@example.com';
select pg_temp.expect((select accepted_at from public.invites where email = 'emailed@example.com') is not null, 'first sign-in marks the invite as used');

-- Anonymous visitor
begin;
set local role anon;
select pg_temp.expect((select count(*) from public.people) = 70, 'anon sees all 70 names');
select pg_temp.expect((select count(*) from public.person_details) = (select count(*) from public.people where generation <= 4), 'anon sees only public details (generations 1-4)');
select pg_temp.expect(not exists (select 1 from public.person_details where person_id = pg_temp.pid('Sunil Kumar')), 'anon cannot read living person details');
rollback;

-- Member invites a relative
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select public.invite_relative('Cousin@Example.com', 'Cousin', pg_temp.pid('Om Parkash'));
select pg_temp.expect((select role from public.invites where email = 'cousin@example.com') = 'member', 'member can invite a relative, as a member');
select pg_temp.expect((select invited_by from public.invites where email = 'cousin@example.com') = '00000000-0000-0000-0000-00000000000b', 'invite records who invited');
select pg_temp.expect((select count(*) from public.invites) = 1, 'member sees only invites they sent');
do $$ begin
  begin
    perform public.invite_relative('cousin@example.com');
    raise exception 'FAILED: duplicate invite allowed';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: duplicate invite refused (%)', sqlerrm;
  end;
  begin
    insert into public.invites (email, role) values ('sneaky@example.com', 'admin');
    raise exception 'FAILED: member wrote invites directly';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: member cannot write invites directly';
  end;
end $$;
rollback;
begin;
set local role anon;
do $$ begin
  begin
    perform public.invite_relative('x@example.com');
    raise exception 'FAILED: anon invited';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: visitors cannot invite';
  end;
end $$;
rollback;

-- Member in Tapashi Ram's branch
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect(exists (select 1 from public.person_details where person_id = pg_temp.pid('Sunil Kumar')), 'member sees own details');
select pg_temp.expect(exists (select 1 from public.person_details where person_id = pg_temp.pid('Rekha')), 'member sees cousin via a daughter (Ghai) line');
select pg_temp.expect(exists (select 1 from public.person_details where person_id = pg_temp.pid('Soma Rani')), 'member sees married-in spouse in branch');
select pg_temp.expect(not exists (select 1 from public.person_details where person_id = pg_temp.pid('Ram Lal')), 'member cannot see another branch');
select pg_temp.expect(not exists (select 1 from public.person_details where person_id = pg_temp.pid('Yog Raj')), 'member cannot see Prabh Dyal branch');
-- Members cannot write the tree directly
do $$ begin
  begin
    insert into public.people (given_name) values ('Sneaky');
    raise exception 'FAILED: member inserted a person directly';
  exception when insufficient_privilege then raise notice 'ok: direct insert blocked';
  end;
end $$;
select pg_temp.expect((select count(*) from public.people where given_name='Sneaky') = 0, 'no direct writes');
-- Cannot self-approve
do $$ begin
  begin
    insert into public.change_requests (kind, payload, status) values ('edit_person', '{}', 'approved');
    raise exception 'FAILED: member inserted an approved request';
  exception when insufficient_privilege then raise notice 'ok: cannot submit pre-approved request';
  end;
end $$;
insert into public.change_requests (kind, target_person_id, payload, summary)
values ('add_person', pg_temp.pid('Sunil Kumar'),
  jsonb_build_object('person', jsonb_build_object('given_name','Test Child','surname','Jaggi','gender','female','is_living',true),
                     'details', jsonb_build_object('birth_date','2001','visibility','branch'),
                     'link', jsonb_build_object('as','child','of',pg_temp.pid('Sunil Kumar'))),
  'Add Test Child');
do $$ begin
  begin
    perform public.approve_change_request((select id from public.change_requests limit 1));
    raise exception 'FAILED: member approved';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: member cannot approve (%)', sqlerrm;
  end;
end $$;
commit;
reset role;

-- Other member cannot see Sunil's pending request
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect((select count(*) from public.change_requests) = 0, 'members only see their own requests');
rollback;

-- Admin approves
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select public.approve_change_request((select id from public.change_requests where summary = 'Add Test Child'), 'looks good');
select pg_temp.expect((select generation from public.people where given_name = 'Test Child') = 7, 'new child gets generation 7');
select pg_temp.expect(exists (select 1 from public.parent_child where child_id = pg_temp.pid('Test Child') and parent_id = pg_temp.pid('Sunil Kumar')), 'child linked to parent');
select pg_temp.expect((select status from public.change_requests where summary = 'Add Test Child') = 'approved', 'request marked approved');
-- edit
insert into public.change_requests (kind, target_person_id, payload)
values ('edit_person', pg_temp.pid('Sunil Kumar'), jsonb_build_object('person_id', pg_temp.pid('Sunil Kumar'),
  'person', jsonb_build_object('gender','male'), 'details', jsonb_build_object('profession','Engineer','visibility','public')));
select public.approve_change_request((select id from public.change_requests where kind='edit_person'));
select pg_temp.expect((select profession from public.person_details where person_id = pg_temp.pid('Sunil Kumar')) = 'Engineer', 'edit applied');
select pg_temp.expect((select given_name from public.people where id = pg_temp.pid('Sunil Kumar')) = 'Sunil Kumar', 'edit leaves untouched fields');
-- spouse with divorce
insert into public.change_requests (kind, payload) values ('add_person', jsonb_build_object(
  'person', jsonb_build_object('given_name','Test Spouse'), 'link', jsonb_build_object('as','spouse','of',pg_temp.pid('Sunil Kumar'),'status','divorced')));
select public.approve_change_request((select id from public.change_requests where payload->'person'->>'given_name' = 'Test Spouse'));
select pg_temp.expect(exists (select 1 from public.unions where status='divorced' and partner_b = pg_temp.pid('Test Spouse')), 'divorced marriage recorded');
-- photo needs a final path
insert into public.change_requests (kind, payload) values ('set_photo', jsonb_build_object('person_id', pg_temp.pid('Sunil Kumar'), 'visibility','public', 'path','x/y.jpg'));
do $$ begin
  begin
    perform public.approve_change_request((select id from public.change_requests where kind='set_photo'));
    raise exception 'FAILED: photo approved without a file';
  exception when others then
    if sqlerrm like 'FAILED%' then raise; end if;
    raise notice 'ok: photo approval needs the copied file';
  end;
end $$;
select public.approve_change_request((select id from public.change_requests where kind='set_photo'), null, '{"final_path":"abc/1.jpg"}');
select pg_temp.expect((select photo_path from public.people where id = pg_temp.pid('Sunil Kumar')) = 'abc/1.jpg', 'photo set');
insert into public.change_requests (kind, payload, summary) values ('remove_photo', jsonb_build_object('person_id', pg_temp.pid('Sunil Kumar')), 'rmphoto');
select public.approve_change_request((select id from public.change_requests where summary='rmphoto'));
select pg_temp.expect((select photo_path from public.people where id = pg_temp.pid('Sunil Kumar')) is null, 'photo removed');
-- reject
insert into public.change_requests (kind, payload, summary) values ('delete_person', jsonb_build_object('person_id', pg_temp.pid('Veena')), 'del');
select public.reject_change_request((select id from public.change_requests where summary='del'), 'no');
select pg_temp.expect(pg_temp.pid('Veena') is not null, 'rejected delete leaves person');
-- delete via approve
insert into public.change_requests (kind, payload, summary) values ('delete_person', jsonb_build_object('person_id', pg_temp.pid('Test Spouse')), 'del2');
select public.approve_change_request((select id from public.change_requests where summary='del2'));
select pg_temp.expect(pg_temp.pid('Test Spouse') is null and not exists (select 1 from public.unions where status='divorced'), 'delete removes person and links');
select pg_temp.expect((select count(*) from public.person_details) = (select count(*) from public.people), 'admin sees all details');
commit;
reset role;

-- Open questions
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.research_questions (question, person_id) values ('Who was Kesar Mal''s wife?', pg_temp.pid('Kesar Mal'));
select pg_temp.expect((select count(*) from public.research_questions) = 1, 'member adds and reads a question');
do $$ begin
  begin
    update public.research_questions set status = 'answered';
    if exists (select 1 from public.research_questions where status = 'answered') then raise exception 'FAILED: member answered a question'; end if;
    raise notice 'ok: member cannot mark questions answered';
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
update public.research_questions set status = 'answered', answer = 'Not known yet';
select pg_temp.expect((select status from public.research_questions) = 'answered', 'admin marks a question answered');
set local role anon;
select pg_temp.expect((select count(*) from public.research_questions) = 0, 'visitors cannot read questions');
rollback;

-- Storage: branch photo readable only by branch
insert into storage.objects (bucket_id, name) values ('photos-branch', pg_temp.pid('Sunil Kumar')::text || '/a.jpg');
alter table storage.objects enable row level security;
grant select, insert on storage.objects to authenticated;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select count(*) from storage.objects) = 1, 'branch member reads branch photo');
insert into storage.objects (bucket_id, name) values ('photos-pending', '00000000-0000-0000-0000-00000000000b/p.jpg');
rollback;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect((select count(*) from storage.objects) = 0, 'other branch cannot read branch photo');
do $$ begin
  begin
    insert into storage.objects (bucket_id, name) values ('photos-pending', '00000000-0000-0000-0000-00000000000b/p.jpg');
    raise exception 'FAILED: uploaded into someone else''s folder';
  exception when insufficient_privilege then raise notice 'ok: cannot upload into another user''s folder';
  end;
end $$;
rollback;
