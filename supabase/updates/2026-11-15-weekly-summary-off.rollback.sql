-- Turn the Monday summary email back on.
select cron.alter_job(jobid, active := true) from cron.job where jobname = 'weekly-summary';
