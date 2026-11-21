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
-- What Supabase really does: create the login first, then stamp invited_at.
insert into public.invites (email, role) values ('emailed2@example.com', 'member');
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000e2', 'emailed2@example.com');
update auth.users set invited_at = now(), last_sign_in_at = null where email = 'emailed2@example.com';
select pg_temp.expect((select accepted_at from public.invites where email = 'emailed2@example.com') is null, 'login created then stamped invited does not count as signed in');
update auth.users set last_sign_in_at = now() where email = 'emailed2@example.com';
select pg_temp.expect((select accepted_at from public.invites where email = 'emailed2@example.com') is not null, 'real sign-in after invite marks it used');

-- Anonymous visitor
begin;
set local role anon;
select pg_temp.expect((select count(*) from public.people) = 70, 'anon sees all 70 names');
select pg_temp.expect((select count(*) from public.person_details) = (select count(*) from public.people where generation <= 4), 'anon sees only public details (generations 1-4)');
select pg_temp.expect(not exists (select 1 from public.person_details where person_id = pg_temp.pid('Sunil Kumar')), 'anon cannot read living person details');
select pg_temp.expect((select count(*) from public.unions) > 0 and (select count(*) from public.parent_child) > 0, 'anon sees who is married to and child of whom');
do $$ begin
  begin
    perform start_date from public.unions limit 1;
    raise exception 'FAILED: anon read marriage dates directly';
  exception when insufficient_privilege then raise notice 'ok: anon cannot read marriage dates directly';
  end;
  begin
    perform kind from public.parent_child limit 1;
    raise exception 'FAILED: anon read adoption labels directly';
  exception when insufficient_privilege then raise notice 'ok: anon cannot read adoption labels directly';
  end;
end $$;
rollback;
-- Maiden names of married women are hidden from visitors.
insert into public.people (id, given_name, surname, other_names, gender) values
  ('00000000-0000-0000-0000-0000000000f1', 'Wife', 'Maidenname', 'Wife Maidenname Marriedname', 'female'),
  ('00000000-0000-0000-0000-0000000000f2', 'Husband', 'Jaggi', 'Bobby', 'male'),
  ('00000000-0000-0000-0000-0000000000f3', 'Bride', 'Jaggi', 'Bride ?', 'female'),
  ('00000000-0000-0000-0000-0000000000f4', 'Single', 'Jaggi', 'Sunny', 'female');
insert into public.unions (partner_a, partner_b) values
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f1'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3');
begin;
set local role anon;
do $$ begin
  begin
    perform surname from public.people limit 1;
    raise exception 'FAILED: anon read last names directly';
  exception when insufficient_privilege then raise notice 'ok: anon cannot read last names directly';
  end;
end $$;
select pg_temp.expect((select surname from public.public_names() where id = '00000000-0000-0000-0000-0000000000f1') = 'Marriedname', 'visitor sees a married woman''s married last name');
select pg_temp.expect(not exists (select 1 from public.public_names() where id = '00000000-0000-0000-0000-0000000000f1' and (other_names is not null or surname = 'Maidenname')), 'visitor never gets her maiden name');
select pg_temp.expect((select surname from public.public_names() where id = '00000000-0000-0000-0000-0000000000f3') is null, 'married name unknown: visitor sees first name only');
select pg_temp.expect((select surname || '/' || other_names from public.public_names() where id = '00000000-0000-0000-0000-0000000000f2') = 'Jaggi/Bobby', 'married man keeps his names');
select pg_temp.expect((select surname || '/' || other_names from public.public_names() where id = '00000000-0000-0000-0000-0000000000f4') = 'Jaggi/Sunny', 'unmarried woman keeps her names');
rollback;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select surname from public.people where id = '00000000-0000-0000-0000-0000000000f1') = 'Maidenname', 'signed-in family see the maiden name');
rollback;
delete from public.people where id in ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4');

-- Marriage dates: public only when both spouses have passed away.
update public.unions set start_date = '1950' where partner_a = pg_temp.pid('Om Parkash') or partner_b = pg_temp.pid('Om Parkash');
insert into public.people (id, given_name, is_living) values ('00000000-0000-0000-0000-0000000000d1', 'DeadA', false), ('00000000-0000-0000-0000-0000000000d2', 'DeadB', false), ('00000000-0000-0000-0000-0000000000d3', 'SpouseS', true);
insert into public.unions (partner_a, partner_b, start_date) values (pg_temp.pid('Sunil Kumar'), '00000000-0000-0000-0000-0000000000d3', '1987');
insert into public.unions (partner_a, partner_b, start_date) values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', '1901');
insert into public.parent_child (parent_id, child_id, kind) values ('00000000-0000-0000-0000-0000000000d1', pg_temp.pid('Sunil Kumar'), 'step')
  on conflict (parent_id, child_id) do update set kind = 'step';
begin;
set local role anon;
select pg_temp.expect((select count(*) from public.union_details() where start_date = '1901') = 1, 'anon sees the marriage date of a couple who have both passed away');
select pg_temp.expect(not exists (select 1 from public.union_details() where start_date in ('1950', '1987')), 'anon cannot see marriage dates of living couples');
select pg_temp.expect(not exists (select 1 from public.parent_link_details() d join public.parent_child l on l.id = d.id where l.child_id = pg_temp.pid('Sunil Kumar')), 'anon cannot see a living child''s step/adoption label');
rollback;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect(exists (select 1 from public.union_details() where start_date = '1987'), 'member sees marriage dates in their branch');
select pg_temp.expect((select d.kind from public.parent_link_details() d join public.parent_child l on l.id = d.id where l.child_id = pg_temp.pid('Sunil Kumar') and l.parent_id = '00000000-0000-0000-0000-0000000000d1') = 'step', 'signed-in member sees step/adoption labels');
rollback;
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select count(*) from public.union_details()) = (select count(*) from public.unions), 'admin sees every marriage date');
rollback;
delete from public.people where id in ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000d3');
update public.unions set start_date = null where start_date = '1950';

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

-- "Not a duplicate" marks: only the admin adds them; family can read them
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$ begin
  begin
    insert into public.not_duplicates (person_a, person_b)
      select least(a, b), greatest(a, b) from (select pg_temp.pid('Kesar Mal') a, pg_temp.pid('Sunil Kumar') b) x;
    raise exception 'FAILED: member marked a pair not-duplicate';
  exception when insufficient_privilege then raise notice 'ok: member cannot mark pairs as not duplicates';
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.not_duplicates (person_a, person_b)
  select least(a, b), greatest(a, b) from (select pg_temp.pid('Kesar Mal') a, pg_temp.pid('Sunil Kumar') b) x;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select count(*) from public.not_duplicates) = 1, 'family reads not-duplicate marks');
set local role anon;
select pg_temp.expect((select count(*) from public.not_duplicates) = 0, 'visitors cannot read not-duplicate marks');
rollback;

-- Library: members suggest links, the admin approves; visitors see approved public ones
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
insert into public.library_links (url, title, topic, person_ids)
  values ('https://www.youtube.com/watch?v=abc', 'Chakwal before 1947', 'Chakwal history', array[pg_temp.pid('Sunil Kumar')]);
select pg_temp.expect((select count(*) from public.library_links) = 1, 'member sees their own suggestion');
select pg_temp.expect((select submitted_by from public.library_links) = '00000000-0000-0000-0000-00000000000b', 'suggestion records who sent it');
do $$ begin
  begin
    insert into public.library_links (url, title, status) values ('https://example.com/a', 'Sneaky', 'approved');
    raise exception 'FAILED: member added an approved link';
  exception when insufficient_privilege then raise notice 'ok: member suggestions must wait for approval';
  end;
  begin
    insert into public.library_links (url, title) values ('https://WWW.youtube.com/watch?v=abc', 'Again');
    raise exception 'FAILED: same link suggested twice';
  exception when unique_violation then raise notice 'ok: the same link cannot be added twice';
  end;
  begin
    insert into public.library_links (url, title) values ('javascript:alert(1)', 'Bad');
    raise exception 'FAILED: non-web link accepted';
  exception when check_violation then raise notice 'ok: only web links are accepted';
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect((select count(*) from public.library_links) = 0, 'other members do not see suggestions waiting for approval');
update public.library_links set status = 'approved';
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select status from public.library_links) = 'pending', 'members cannot approve links');
update public.library_links set status = 'approved';
select pg_temp.expect((select reviewed_by from public.library_links) = '00000000-0000-0000-0000-00000000000a', 'approval records the admin');
insert into public.library_links (url, title, visibility) values ('https://example.com/family', 'Family only', 'family');
select pg_temp.expect((select status from public.library_links where visibility = 'family') = 'approved', 'admin links go live at once');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000c';
select pg_temp.expect((select count(*) from public.library_links) = 2, 'members see approved links, family-only too');
delete from public.library_links;
select pg_temp.expect((select count(*) from public.library_links) = 2, 'members cannot remove approved links');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select count(*) from public.blessings_ledger() where kind = 'library' and user_id = '00000000-0000-0000-0000-00000000000b') = 1, 'approved suggestion earns blessings');
select pg_temp.expect((select points from public.blessings_ledger() where kind = 'library' and user_id = '00000000-0000-0000-0000-00000000000b') = 3, 'a library link is worth 3 blessings');
set local role anon;
select pg_temp.expect((select count(*) from public.library_links) = 1, 'visitors see approved public links only');
rollback;

-- Family book drafts: admins only
begin;
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.book_drafts (title, data) values ('Test book', '{"settings": {"template": "heritage"}}');
select pg_temp.expect((select count(*) from public.book_drafts) = 1, 'admin saves and reads a book draft');
select pg_temp.expect((select created_by from public.book_drafts) = '00000000-0000-0000-0000-00000000000a', 'book draft records who made it');
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select count(*) from public.book_drafts) = 0, 'members cannot see book drafts');
do $$ begin
  begin
    insert into public.book_drafts (title) values ('Sneaky book');
    raise exception 'FAILED: member made a book draft';
  exception when insufficient_privilege then raise notice 'ok: members cannot make book drafts';
  end;
end $$;
set local role anon;
do $$ begin
  begin
    perform 1 from public.book_drafts;
    raise exception 'FAILED: visitor read book drafts';
  exception when insufficient_privilege then raise notice 'ok: visitors cannot read book drafts';
  end;
end $$;
rollback;

-- AI helper: admins only; findings come only from the edge functions
begin;
insert into public.ai_findings (person_id, status, result) values (pg_temp.pid('Bhanna Mal'), 'pending', '{"summary": "test"}');
insert into public.ai_usage (kind, cost_usd) values ('ask', 0.03);
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
select pg_temp.expect((select daily_cap_usd from public.ai_settings) = 2.00, 'AI daily limit starts at $2');
update public.ai_settings set daily_cap_usd = 5;
select pg_temp.expect((select daily_cap_usd from public.ai_settings) = 5, 'admin changes the AI daily limit');
select pg_temp.expect((select count(*) from public.ai_usage) = 1, 'admin sees AI spending');
update public.ai_findings set status = 'used';
select pg_temp.expect((select reviewed_by from public.ai_findings) = '00000000-0000-0000-0000-00000000000a', 'using a finding records the admin');
do $$ begin
  begin
    insert into public.ai_findings (person_id) values (pg_temp.pid('Bhanna Mal'));
    raise exception 'FAILED: browser made an AI finding';
  exception when insufficient_privilege then raise notice 'ok: findings are only made by the AI function';
  end;
end $$;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
select pg_temp.expect((select count(*) from public.ai_findings) = 0, 'members cannot see AI findings');
select pg_temp.expect((select count(*) from public.ai_usage) = 0, 'members cannot see AI spending');
select pg_temp.expect((select count(*) from public.ai_settings) = 0, 'members cannot see AI settings');
update public.ai_settings set daily_cap_usd = 99;
set local role anon;
do $$ begin
  begin
    perform 1 from public.ai_findings;
    raise exception 'FAILED: visitor read AI findings';
  exception when insufficient_privilege then raise notice 'ok: visitors cannot read AI findings';
  end;
end $$;
reset role;
select pg_temp.expect((select daily_cap_usd from public.ai_settings) = 5, 'members cannot change the AI daily limit');
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
