-- Mark everyone in generations 1-4 as deceased, including the wives who
-- married in (they are recorded at their husband's generation).
-- On 2026-11-13 this changes 8 people, all in generation 4:
--   Chatter, Chunni Lal, Gobind Ram, Prem Singh, Tapashi Ram, Tara Chand,
--   Ishvari Devi and Sita Wanti. Generations 1-3 are already marked deceased.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

-- 1. See who will change:
select given_name, surname, generation
from public.people
where generation <= 4 and is_living is distinct from false
order by given_name;

-- 2. Make the change:
update public.people set is_living = false
where generation <= 4 and is_living is distinct from false;
