-- 2026-11-13: findings from the Arya High School plaque (April 1933).
-- Run once in the Supabase SQL Editor on the live database. Safe to re-run.
-- Adds the plaque as a source for Kesar Mal, Prabh Dyal, Bir Chand and Gian Parkash,
-- the spelling "Gyan Parkash", and "Timber merchant" as the brothers' profession.
begin;

-- Plaque as a source (appended, so anything already there is kept).
update public.person_details
set sources = concat_ws(E'\n', nullif(sources, ''), 'Donor plaque, Arya High School, Chakwal, April 1933: ''Built in memory of their Grandfather Bakhshi Kesar Mal Jaggi by his grandsons Bir Chand and Gyan Parkash, Sons of Bakhshi Prabh Dyal Jaggi, Timber Merchants, Chakwal.'' Transcribed at http://speakingstones1.blogspot.com/2018/04/arya-high-school-chakwal-punjab-pakistan.html; reported in Dawn (https://www.dawn.com/news/660028, 2011; https://www.dawn.com/news/1472898, 2019) and The Friday Times (https://thefridaytimes.com/03-Apr-2024/arya-high-school-offers-a-glimpse-of-life-in-pre-partition-chakwal, 2024)'), updated_at = now()
where person_id in ('afdb7bae-43e4-5bf3-9def-84f9e491dcc0', '97fc1acc-a708-5eeb-851a-5ceb567f400a', '1539fd26-add4-5182-b087-3e26fd3b349e', '98e3dd33-dfbe-5c9a-a0be-50683f47ffda')
  and coalesce(sources, '') not like '%Arya High School, Chakwal, April 1933%';

-- Profession.
update public.person_details set profession = 'Timber merchant, Chakwal', updated_at = now()
where person_id in ('1539fd26-add4-5182-b087-3e26fd3b349e', '98e3dd33-dfbe-5c9a-a0be-50683f47ffda') and coalesce(profession, '') = '';

-- Notes: "built" matches the plaque wording.
update public.person_details set notes = replace(notes, 'funded the construction of the Arya High School building', 'built the Arya High School building'), updated_at = now()
where person_id in ('1539fd26-add4-5182-b087-3e26fd3b349e', '98e3dd33-dfbe-5c9a-a0be-50683f47ffda');
update public.person_details set notes = 'Father of Bir Chand and Gyan Parkash; named on their April 1933 Arya High School plaque.', updated_at = now()
where person_id = '97fc1acc-a708-5eeb-851a-5ceb567f400a' and coalesce(notes, '') = '';

-- Other spelling, so search finds him as Gyan Parkash.
update public.people set other_names = 'Gyan Parkash, Gyan Prakash', updated_at = now()
where id = '98e3dd33-dfbe-5c9a-a0be-50683f47ffda' and coalesce(other_names, '') = '';

-- The plaque documents these parent links.
update public.parent_child set note = 'Documented by the Arya High School plaque, Chakwal, April 1933.'
where (parent_id, child_id) in (('afdb7bae-43e4-5bf3-9def-84f9e491dcc0', '97fc1acc-a708-5eeb-851a-5ceb567f400a'), ('97fc1acc-a708-5eeb-851a-5ceb567f400a', '1539fd26-add4-5182-b087-3e26fd3b349e'), ('97fc1acc-a708-5eeb-851a-5ceb567f400a', '98e3dd33-dfbe-5c9a-a0be-50683f47ffda'))
  and note is null;

commit;
select 'Plaque update applied' as result;
