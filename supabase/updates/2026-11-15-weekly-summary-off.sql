-- Pause the Monday summary email (Sunil, Nov 14: no weekly emails for now).
-- The job is only switched off, not deleted. Undo with the .rollback.sql file.
select cron.alter_job(jobid, active := false) from cron.job where jobname = 'weekly-summary';
