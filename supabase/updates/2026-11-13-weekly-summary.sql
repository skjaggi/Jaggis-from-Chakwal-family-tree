-- Weekly summary email to the admin, every Monday at 8:00 Arizona time
-- (15:00 UTC). Calls the weekly-summary server function with a private key
-- that lives only in the database.
-- Safe to run more than once. Paste into Supabase → SQL Editor → Run.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Private settings: no one can read these through the website.
create table if not exists public.app_secrets (
  name text primary key,
  value text not null
);
alter table public.app_secrets enable row level security;
revoke all on public.app_secrets from anon, authenticated;
insert into public.app_secrets (name, value)
values ('weekly_summary_key', replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''))
on conflict (name) do nothing;

-- The server function checks the key with this; only the server may call it.
create or replace function public.check_app_secret(n text, v text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_secrets where name = n and value = v)
$$;
revoke execute on function public.check_app_secret(text, text) from public, anon, authenticated;
grant execute on function public.check_app_secret(text, text) to service_role;

-- The weekly schedule.
select cron.unschedule(jobid) from cron.job where jobname = 'weekly-summary';
select cron.schedule('weekly-summary', '0 15 * * 1', $job$
  select net.http_post(
    url := 'https://nxsaixeotbijfizievoq.supabase.co/functions/v1/weekly-summary',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-key', (select value from public.app_secrets where name = 'weekly_summary_key')),
    body := '{}'::jsonb)
$job$);
