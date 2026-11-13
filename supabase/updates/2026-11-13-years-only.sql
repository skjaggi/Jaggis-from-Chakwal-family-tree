-- Keep only the year of birth and death for anyone who already has a full date.
-- "1952-03-04" -> "1952"; "c. 1890" and "1930s" are left as they are.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.
update public.person_details
set birth_date = case
    when birth_date ~* '^\s*(c\.|ca\.?|circa|about|abt\.?|approx\.?|~)' then 'c. ' || substring(birth_date from '\d{4}')
    else substring(birth_date from '\d{4}s?')
  end
where birth_date ~ '\d{4}'
  and birth_date !~ '^(c\. )?\d{4}s?$';

update public.person_details
set death_date = case
    when death_date ~* '^\s*(c\.|ca\.?|circa|about|abt\.?|approx\.?|~)' then 'c. ' || substring(death_date from '\d{4}')
    else substring(death_date from '\d{4}s?')
  end
where death_date ~ '\d{4}'
  and death_date !~ '^(c\. )?\d{4}s?$';

select count(*) as people_with_birth_year from public.person_details where birth_date is not null;
