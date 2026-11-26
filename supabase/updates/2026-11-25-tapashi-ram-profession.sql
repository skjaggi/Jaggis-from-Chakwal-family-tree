-- Fix the profession typo "bussiness" for Tapashi Ram Jaggi (Sunil, 25 Nov 2026).
-- Run in the Supabase SQL Editor of the project "jaggi-family-tree".
-- Undo: 2026-11-25-tapashi-ram-profession.rollback.sql
-- 1. Look first: this should show one row with "bussiness".
select person_id, profession from public.person_details
 where person_id = '9699b7f6-d1d8-5ab7-804d-e920c2f9957f';
-- 2. The fix (only changes the misspelt word; any other wording stays).
update public.person_details
   set profession = regexp_replace(profession, '\mbussiness\M', 'Business', 'gi')
 where person_id = '9699b7f6-d1d8-5ab7-804d-e920c2f9957f'
   and profession ~* '\mbussiness\M'
returning person_id, profession;
