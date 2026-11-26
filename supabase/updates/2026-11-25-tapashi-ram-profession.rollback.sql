-- Undo 2026-11-25-tapashi-ram-profession.sql: puts back the earlier spelling.
update public.person_details
   set profession = regexp_replace(profession, '\mBusiness\M', 'bussiness')
 where person_id = '9699b7f6-d1d8-5ab7-804d-e920c2f9957f'
returning person_id, profession;
