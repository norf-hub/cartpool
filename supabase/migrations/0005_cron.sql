-- Retention schedule (spec §11): purge_retention() daily at 03:17 UTC.
-- pg_cron is available on Supabase (enable it under Database > Extensions).
-- On bare Postgres (CI/tests) this degrades to a NOTICE — the tests
-- exercise purge_retention() directly, not the scheduler.
do $do$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule(
      'cartpool-retention',
      '17 3 * * *',
      'select public.purge_retention()'
    );
  else
    raise notice 'pg_cron unavailable — schedule public.purge_retention() with an external scheduler';
  end if;
exception when others then
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end
$do$;
