-- Stream bulk_opt_ins changes so "In: you, Dana" updates live when a
-- groupmate opts in (spec §5 — the one-tap opt-in is the headline moment,
-- it should appear without a pull-to-refresh). Same guard as 0007: bare
-- Postgres in CI has no supabase_realtime publication, and this is liveness,
-- not correctness — the client refetches on item/membership changes anyway.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'bulk_opt_ins'
    ) then
      alter publication supabase_realtime add table public.bulk_opt_ins;
    end if;
  else
    raise notice 'supabase_realtime publication not found; skipping (bare Postgres)';
  end if;
end $$;
